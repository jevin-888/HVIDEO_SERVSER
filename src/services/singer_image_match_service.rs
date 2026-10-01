use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use chrono::Utc;
use dashmap::DashMap;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::models::singer_image_match::{
    SingerImageMatchError, SingerImageMatchProgress, SingerImageMatchResult,
    SingerImageMatchStatus, SingerImageMatchTask, StartSingerImageMatchRequest,
};

const TARGET_DIR: &str = "static/singer-all";
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif"];
const RESULT_DETAIL_LIMIT: usize = 200;

#[derive(Clone, Default)]
pub struct SingerImageMatchService {
    tasks: Arc<DashMap<String, SingerImageMatchTask>>,
    cancel_flags: Arc<DashMap<String, Arc<AtomicBool>>>,
}

impl SingerImageMatchService {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn start_match(
        &self,
        pool: SqlitePool,
        request: StartSingerImageMatchRequest,
    ) -> AppResult<SingerImageMatchTask> {
        let directory = request.directory.trim().to_string();
        if directory.is_empty() {
            return Err(AppError::BadRequest("请选择歌星图片目录".to_string()));
        }
        let root = PathBuf::from(&directory);
        if !root.is_dir() {
            return Err(AppError::BadRequest(format!(
                "目录不存在或不可访问: {directory}"
            )));
        }
        if self
            .tasks
            .iter()
            .any(|entry| entry.status == SingerImageMatchStatus::Running)
        {
            return Err(AppError::Conflict(
                "已有歌星图片对照任务正在运行".to_string(),
            ));
        }

        let task_id = Uuid::new_v4().to_string();
        let task = SingerImageMatchTask {
            task_id: task_id.clone(),
            directory: directory.clone(),
            overwrite: request.overwrite,
            status: SingerImageMatchStatus::Running,
            started_at: Utc::now(),
            completed_at: None,
            progress: SingerImageMatchProgress::default(),
            result: None,
            error_message: None,
        };
        self.tasks.insert(task_id.clone(), task.clone());
        let cancel_flag = Arc::new(AtomicBool::new(false));
        self.cancel_flags
            .insert(task_id.clone(), cancel_flag.clone());
        let service = self.clone();
        tokio::spawn(async move {
            let result = service
                .run_match(&task_id, pool, root, request.overwrite, cancel_flag.clone())
                .await;
            if let Err(error) = result {
                service.finish_failed(&task_id, error.to_string());
            }
            service.cancel_flags.remove(&task_id);
        });
        Ok(task)
    }

    pub fn get_task(&self, task_id: &str) -> AppResult<SingerImageMatchTask> {
        self.tasks
            .get(task_id)
            .map(|entry| entry.clone())
            .ok_or_else(|| AppError::NotFound("歌星图片对照任务不存在".to_string()))
    }

    pub fn cancel(&self, task_id: &str) -> AppResult<SingerImageMatchTask> {
        let flag = self
            .cancel_flags
            .get(task_id)
            .ok_or_else(|| AppError::NotFound("歌星图片对照任务不存在或已经结束".to_string()))?;
        flag.store(true, Ordering::Relaxed);
        drop(flag);
        self.get_task(task_id)
    }

    async fn run_match(
        &self,
        task_id: &str,
        pool: SqlitePool,
        root: PathBuf,
        overwrite: bool,
        cancel_flag: Arc<AtomicBool>,
    ) -> AppResult<()> {
        let rows = sqlx::query("SELECT singerId, singerNo, sourceSingerId FROM singers WHERE singerNo IS NOT NULL AND TRIM(singerNo) <> ''")
            .fetch_all(&pool).await?;
        let singers = rows
            .into_iter()
            .map(|row| {
                (
                    row.get::<i64, _>("singerId"),
                    row.get::<String, _>("singerNo"),
                    row.try_get::<Option<String>, _>("sourceSingerId")
                        .unwrap_or(None),
                )
            })
            .collect::<Vec<_>>();
        let (aliases, singer_nos) = build_aliases(&singers);

        self.update_progress(task_id, |progress| {
            progress.current_directory = "正在统计图片文件...".to_string()
        });
        let scan_root = root.clone();
        let scan_cancel = cancel_flag.clone();
        let files = tokio::task::spawn_blocking(move || collect_images(&scan_root, &scan_cancel))
            .await
            .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))??;
        let total = files.len() as u64;
        std::fs::create_dir_all(TARGET_DIR)?;
        let mut matched_singers = HashSet::new();
        let mut copied_count = 0_u64;
        let mut unmatched_count = 0_u64;
        let mut unmatched_files = Vec::new();
        let mut errors = Vec::new();

        for (index, file) in files.iter().enumerate() {
            if cancel_flag.load(Ordering::Relaxed) {
                self.finish_cancelled(task_id);
                return Ok(());
            }
            let stem = file
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .trim();
            let matched = aliases.get(&stem.to_ascii_lowercase()).cloned();
            if let Some(singer_no) = matched {
                matched_singers.insert(singer_no.clone());
                let extension = file
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("jpg")
                    .to_ascii_lowercase();
                let target = Path::new(TARGET_DIR).join(format!("{singer_no}.{extension}"));
                let source = std::fs::canonicalize(file).unwrap_or_else(|_| file.clone());
                let target_resolved =
                    std::fs::canonicalize(&target).unwrap_or_else(|_| target.clone());
                let has_existing_image = IMAGE_EXTENSIONS.iter().any(|candidate_extension| {
                    Path::new(TARGET_DIR)
                        .join(format!("{singer_no}.{candidate_extension}"))
                        .exists()
                });
                let copy_succeeded =
                    if source != target_resolved && (overwrite || !has_existing_image) {
                        match std::fs::copy(file, &target) {
                            Ok(_) => {
                                copied_count += 1;
                                true
                            }
                            Err(error) if errors.len() < RESULT_DETAIL_LIMIT => {
                                errors.push(SingerImageMatchError {
                                    file_path: file.to_string_lossy().to_string(),
                                    error: error.to_string(),
                                });
                                false
                            }
                            Err(_) => false,
                        }
                    } else {
                        source == target_resolved
                    };
                if overwrite && copy_succeeded {
                    remove_alternate_images(&singer_no, &target, &mut errors);
                }
            } else {
                unmatched_count += 1;
                if unmatched_files.len() < RESULT_DETAIL_LIMIT {
                    unmatched_files.push(file.to_string_lossy().to_string());
                }
            }
            let scanned = (index + 1) as u64;
            self.update_progress(task_id, |progress| {
                progress.scanned_files = scanned;
                progress.matched_singers = matched_singers.len() as u64;
                progress.copied_images = copied_count;
                progress.current_directory =
                    file.parent().unwrap_or(&root).to_string_lossy().to_string();
                progress.percentage = if total == 0 {
                    100.0
                } else {
                    scanned as f64 * 100.0 / total as f64
                };
            });
        }
        let result = SingerImageMatchResult {
            total_files_scanned: total,
            matched_count: matched_singers.len() as u64,
            copied_count,
            unmatched_count,
            missing_singer_count: singer_nos.len().saturating_sub(matched_singers.len()) as u64,
            unmatched_files,
            errors,
        };
        if let Some(mut task) = self.tasks.get_mut(task_id) {
            task.status = SingerImageMatchStatus::Completed;
            task.completed_at = Some(Utc::now());
            task.progress.percentage = 100.0;
            task.progress.current_directory = "歌星图片对照完成".to_string();
            task.result = Some(result);
        }
        Ok(())
    }

    fn update_progress(&self, task_id: &str, update: impl FnOnce(&mut SingerImageMatchProgress)) {
        if let Some(mut task) = self.tasks.get_mut(task_id) {
            update(&mut task.progress);
        }
    }
    fn finish_cancelled(&self, task_id: &str) {
        if let Some(mut task) = self.tasks.get_mut(task_id) {
            task.status = SingerImageMatchStatus::Cancelled;
            task.completed_at = Some(Utc::now());
            task.progress.current_directory = "已取消".to_string();
        }
    }
    fn finish_failed(&self, task_id: &str, message: String) {
        if let Some(mut task) = self.tasks.get_mut(task_id) {
            task.status = SingerImageMatchStatus::Failed;
            task.completed_at = Some(Utc::now());
            task.error_message = Some(message);
        }
    }
}

fn build_aliases(
    singers: &[(i64, String, Option<String>)],
) -> (HashMap<String, String>, HashSet<String>) {
    let mut aliases = HashMap::<String, String>::new();
    let mut singer_nos = HashSet::<String>::new();

    // singerNo is the canonical image key and must win over singerId/sourceSingerId aliases.
    for (_, singer_no, _) in singers {
        singer_nos.insert(singer_no.clone());
        if is_safe_image_key(singer_no) {
            insert_alias(&mut aliases, singer_no, singer_no);
        }
    }
    for (singer_id, singer_no, source_id) in singers {
        if !is_safe_image_key(singer_no) {
            continue;
        }
        insert_alias(&mut aliases, &singer_id.to_string(), singer_no);
        if let Some(source_id) = source_id {
            insert_alias(&mut aliases, source_id, singer_no);
        }
    }
    (aliases, singer_nos)
}

fn is_safe_image_key(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value != "."
        && value != ".."
        && !value
            .chars()
            .any(|character| character.is_control() || r#"<>:"/\|?*"#.contains(character))
}
fn insert_alias(aliases: &mut HashMap<String, String>, alias: &str, singer_no: &str) {
    let alias = alias.trim();
    if alias.is_empty() {
        return;
    }
    aliases
        .entry(alias.to_ascii_lowercase())
        .or_insert_with(|| singer_no.to_string());
}

fn remove_alternate_images(singer_no: &str, keep: &Path, errors: &mut Vec<SingerImageMatchError>) {
    for extension in IMAGE_EXTENSIONS {
        let candidate = Path::new(TARGET_DIR).join(format!("{singer_no}.{extension}"));
        if candidate == keep || !candidate.exists() {
            continue;
        }
        if let Err(error) = std::fs::remove_file(&candidate) {
            if errors.len() < RESULT_DETAIL_LIMIT {
                errors.push(SingerImageMatchError {
                    file_path: candidate.to_string_lossy().to_string(),
                    error: format!("清理旧图片失败: {error}"),
                });
            }
        }
    }
}

fn collect_images(root: &Path, cancel_flag: &AtomicBool) -> AppResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut directories = vec![root.to_path_buf()];
    while let Some(directory) = directories.pop() {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                directories.push(path);
            } else if path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| IMAGE_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
                .unwrap_or(false)
            {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_singer_no_wins_over_fallback_aliases() {
        let singers = vec![
            (1, "2".to_string(), Some("source-a".to_string())),
            (2, "B".to_string(), Some("SOURCE-B".to_string())),
        ];

        let (aliases, singer_nos) = build_aliases(&singers);

        assert_eq!(aliases.get("2").map(String::as_str), Some("2"));
        assert_eq!(aliases.get("1").map(String::as_str), Some("2"));
        assert_eq!(aliases.get("source-a").map(String::as_str), Some("2"));
        assert_eq!(aliases.get("source-b").map(String::as_str), Some("B"));
        assert_eq!(singer_nos.len(), 2);

        let unsafe_singers = vec![(3, "../escape".to_string(), None)];
        let (unsafe_aliases, unsafe_nos) = build_aliases(&unsafe_singers);
        assert!(unsafe_aliases.is_empty());
        assert!(unsafe_nos.contains("../escape"));
    }
}
