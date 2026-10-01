/// 歌曲路径自动匹配服务。
///
/// 管理扫描任务的启动、取消、实时进度、结果和生命周期清理。
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tokio::sync::{broadcast, Mutex};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::models::scan_task::{
    MatchRecord, ScanError, ScanProgress, ScanResult, ScanTask, StartScanRequest, TaskStatus,
    UnmatchedFile, UnrecognizedFile,
};
use crate::scanner::database_matcher::update_song_paths;
use crate::scanner::duplicate_handler::handle_duplicates;
use crate::scanner::file_scanner::scan_directory;
use crate::scanner::id_extractor::extract_song_no_candidates;
use crate::scanner::progress_reporter::ProgressReporter;

const MAX_RETAINED_FINISHED_TASKS: usize = 20;
const MAX_SQL_PARAMETERS: usize = 900;

struct TaskEntry {
    task: ScanTask,
    progress: Arc<Mutex<ScanProgress>>,
    cancel_flag: Arc<Mutex<bool>>,
    broadcast_tx: broadcast::Sender<String>,
}

#[derive(Clone)]
pub struct SongPathMatcherService {
    tasks: Arc<Mutex<HashMap<String, TaskEntry>>>,
}

impl SongPathMatcherService {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 启动新扫描任务。任意时刻只允许一个扫描任务写歌曲库。
    pub async fn start_scan(
        &self,
        pool: sqlx::SqlitePool,
        req: StartScanRequest,
    ) -> Result<String, String> {
        if req.directory.split(';').all(|path| path.trim().is_empty()) {
            return Err("未提供扫描路径".to_string());
        }

        let task_id = Uuid::new_v4().to_string();
        let (tx, _rx) = broadcast::channel::<String>(256);
        let cancel_flag = Arc::new(Mutex::new(false));
        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        let task = ScanTask {
            task_id: task_id.clone(),
            directory: req.directory.clone(),
            delete_duplicates: req.delete_duplicates,
            incremental: req.incremental,
            status: TaskStatus::Running,
            started_at: Utc::now(),
            completed_at: None,
            progress: ScanProgress::default(),
            result: None,
            error_message: None,
        };

        {
            let mut guard = self.tasks.lock().await;
            if guard
                .values()
                .any(|entry| entry.task.status == TaskStatus::Running)
            {
                return Err("已有扫描任务正在运行，请等待完成或先取消任务".to_string());
            }
            prune_finished_tasks(&mut guard);
            guard.insert(
                task_id.clone(),
                TaskEntry {
                    task,
                    progress: progress.clone(),
                    cancel_flag: cancel_flag.clone(),
                    broadcast_tx: tx.clone(),
                },
            );
        }

        let tasks = self.tasks.clone();
        tokio::spawn(run_scan(
            task_id.clone(),
            req,
            pool,
            tasks,
            progress,
            cancel_flag,
            tx,
        ));

        Ok(task_id)
    }

    /// 获取任务实时进度快照。
    pub async fn get_progress(&self, task_id: &str) -> Option<ScanProgress> {
        let progress = {
            let guard = self.tasks.lock().await;
            guard.get(task_id).map(|entry| entry.progress.clone())?
        };
        let snapshot = progress.lock().await.clone();
        Some(snapshot)
    }

    /// 获取完整任务，并覆盖为同一份实时进度状态。
    pub async fn get_task(&self, task_id: &str) -> Option<ScanTask> {
        let (mut task, progress) = {
            let guard = self.tasks.lock().await;
            let entry = guard.get(task_id)?;
            (entry.task.clone(), entry.progress.clone())
        };
        task.progress = progress.lock().await.clone();
        Some(task)
    }

    /// 取消运行中的任务。
    pub async fn cancel_task(&self, task_id: &str) -> Result<(), String> {
        let cancel_flag = {
            let guard = self.tasks.lock().await;
            let entry = guard
                .get(task_id)
                .ok_or_else(|| format!("任务不存在: {}", task_id))?;
            if entry.task.status != TaskStatus::Running {
                return Err(format!("任务已结束，当前状态: {:?}", entry.task.status));
            }
            entry.cancel_flag.clone()
        };
        *cancel_flag.lock().await = true;
        Ok(())
    }

    /// 订阅进度，并返回订阅建立时的任务快照，避免快速任务丢失终态事件。
    pub async fn subscribe_progress(
        &self,
        task_id: &str,
    ) -> Option<(String, broadcast::Receiver<String>)> {
        let (task, progress, receiver) = {
            let guard = self.tasks.lock().await;
            let entry = guard.get(task_id)?;
            (
                entry.task.clone(),
                entry.progress.clone(),
                entry.broadcast_tx.subscribe(),
            )
        };
        let progress = progress.lock().await.clone();
        Some((task_snapshot_message(&task, &progress), receiver))
    }
}

async fn run_scan(
    task_id: String,
    req: StartScanRequest,
    pool: sqlx::SqlitePool,
    tasks: Arc<Mutex<HashMap<String, TaskEntry>>>,
    progress: Arc<Mutex<ScanProgress>>,
    cancel_flag: Arc<Mutex<bool>>,
    broadcast_tx: broadcast::Sender<String>,
) {
    let reporter = ProgressReporter::new(broadcast_tx.clone());
    let delete_duplicates = req.delete_duplicates;
    let incremental = req.incremental;

    // 每 500ms 推送一次同一份共享进度状态。
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let progress = progress.clone();
        let reporter = ProgressReporter::new(broadcast_tx.clone());
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {
                        reporter.report_progress(&progress.lock().await.clone());
                    }
                }
            }
        });
    }

    let roots: Vec<String> = req
        .directory
        .split(';')
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned)
        .collect();

    {
        let mut value = progress.lock().await;
        value.current_directory = format!("正在准备扫描: {}", req.directory);
        value.percentage = 0.0;
    }

    if is_cancelled(&cancel_flag).await {
        finish_cancelled(&tasks, &task_id, &progress, &reporter, stop_tx).await;
        return;
    }

    // Phase 1：扫描所有选中根目录。递归目录中的 PermissionDenied 已由扫描器跳过；
    // 根目录本身拒绝访问时保留为可跳过根，其他错误仍阻止不完整结果入库。
    let mut media_files = Vec::new();
    let mut scan_errors = Vec::new();
    let mut successful_roots = 0usize;
    let mut scan_set = tokio::task::JoinSet::new();
    for root in roots.iter().cloned() {
        let progress = progress.clone();
        let cancel_flag = cancel_flag.clone();
        scan_set.spawn(async move {
            let result = scan_directory(std::path::Path::new(&root), progress, cancel_flag).await;
            (root, result)
        });
    }

    while let Some(result) = scan_set.join_next().await {
        match result {
            Ok((_, Ok(files))) => {
                successful_roots += 1;
                media_files.extend(files);
            }
            Ok((root, Err(scan_error))) => {
                if scan_error.kind() == std::io::ErrorKind::PermissionDenied {
                    warn!("根目录拒绝访问，跳过并继续其他目录 {}: {}", root, scan_error);
                } else {
                    warn!("目录扫描失败 {}: {}", root, scan_error);
                    scan_errors.push(ScanError {
                        filePath: root,
                        error: format!("扫描目录失败: {}", scan_error),
                    });
                }
            }
            Err(join_error) => {
                error!("目录扫描任务异常: {}", join_error);
                scan_errors.push(ScanError {
                    filePath: req.directory.clone(),
                    error: format!("扫描任务异常: {}", join_error),
                });
            }
        }
    }

    if is_cancelled(&cancel_flag).await {
        finish_cancelled(&tasks, &task_id, &progress, &reporter, stop_tx).await;
        return;
    }

    if successful_roots == 0 {
        let message = scan_errors
            .first()
            .map(|item| item.error.clone())
            .unwrap_or_else(|| "所有扫描目录均失败".to_string());
        let result = ScanResult {
            total_files_scanned: 0,
            matched_count: 0,
            matched_records: Vec::new(),
            unmatched_files: Vec::new(),
            unrecognized_files: Vec::new(),
            duplicate_files: Vec::new(),
            errors: scan_errors,
        };
        finish_failed(
            &tasks,
            &task_id,
            &progress,
            &reporter,
            stop_tx,
            message,
            Some(result),
        )
        .await;
        return;
    }

    media_files.sort();
    info!("Phase 1 完成，共找到 {} 个视频文件", media_files.len());

    // Phase 2：提取 songNo 候选。
    struct FileEntry {
        candidates: Vec<String>,
        filePath: String,
    }

    let mut file_entries = Vec::new();
    let mut unrecognized_files = Vec::new();
    for path in &media_files {
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let file_path = path.to_string_lossy().replace('\\', "/");
        let candidates = extract_song_no_candidates(file_name);
        if candidates.is_empty() {
            unrecognized_files.push(UnrecognizedFile {
                filePath: file_path,
                reason: "无法从文件名中提取歌曲编号".to_string(),
            });
        } else {
            file_entries.push(FileEntry {
                candidates,
                filePath: file_path,
            });
        }
    }
    {
        let mut value = progress.lock().await;
        value.current_directory = "正在匹配歌曲编号...".to_string();
        value.percentage = 10.0;
    }

    // Phase 3：按 SQLite 参数上限安全分批匹配 songNo。
    let total_entries = file_entries.len();
    let mut matched_records = Vec::new();
    let mut unmatched_files = Vec::new();
    let mut match_errors = Vec::new();
    let mut start = 0usize;

    while start < total_entries {
        if is_cancelled(&cancel_flag).await {
            finish_cancelled(&tasks, &task_id, &progress, &reporter, stop_tx).await;
            return;
        }

        let mut end = start;
        let mut parameter_count = 0usize;
        while end < total_entries {
            let next_count = file_entries[end].candidates.len();
            if end > start && parameter_count + next_count > MAX_SQL_PARAMETERS {
                break;
            }
            parameter_count += next_count;
            end += 1;
        }

        let chunk = &file_entries[start..end];
        let mut seen_candidates = HashSet::new();
        let candidate_values: Vec<String> = chunk
            .iter()
            .flat_map(|entry| entry.candidates.iter().cloned())
            .filter(|candidate| seen_candidates.insert(candidate.clone()))
            .collect();
        let placeholders = candidate_values
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT songNo FROM songs WHERE songNo IN ({})",
            placeholders
        );
        let mut query = sqlx::query_scalar::<_, String>(&sql);
        for song_no in &candidate_values {
            query = query.bind(song_no);
        }

        match query.fetch_all(&pool).await {
            Ok(existing) => {
                let existing_song_nos: HashSet<String> = existing.into_iter().collect();
                for entry in chunk {
                    if let Some(song_no) = entry
                        .candidates
                        .iter()
                        .find(|song_no| existing_song_nos.contains(*song_no))
                    {
                        matched_records.push(MatchRecord {
                            songId: song_no.clone(),
                            filePath: entry.filePath.clone(),
                        });
                    } else {
                        unmatched_files.push(UnmatchedFile {
                            filePath: entry.filePath.clone(),
                            extracted_id: Some(entry.candidates.join(",")),
                            reason: "数据库中不存在提取到的 songNo 候选".to_string(),
                        });
                    }
                }
            }
            Err(query_error) => {
                error!("批量查询歌曲编号失败: {}", query_error);
                for entry in chunk {
                    match_errors.push(ScanError {
                        filePath: entry.filePath.clone(),
                        error: format!("数据库查询失败: {}", query_error),
                    });
                }
            }
        }

        start = end;
        let ratio = if total_entries == 0 {
            1.0
        } else {
            start as f64 / total_entries as f64
        };
        let mut value = progress.lock().await;
        value.matched_songs = matched_records.len() as u64;
        value.percentage = 10.0 + ratio * 80.0;
        value.current_directory = format!("匹配中... {}/{}", start, total_entries);
    }

    if total_entries == 0 {
        let mut value = progress.lock().await;
        value.percentage = 90.0;
        value.current_directory = "歌曲编号匹配完成".to_string();
    }

    // 查询异常时禁止继续清空/重建对照库，避免写入不完整结果。
    if !match_errors.is_empty() {
        let message = match_errors[0].error.clone();
        let mut errors = scan_errors;
        errors.extend(match_errors);
        let result = ScanResult {
            total_files_scanned: media_files.len() as u64,
            matched_count: 0,
            matched_records: Vec::new(),
            unmatched_files,
            unrecognized_files,
            duplicate_files: Vec::new(),
            errors,
        };
        finish_failed(
            &tasks,
            &task_id,
            &progress,
            &reporter,
            stop_tx,
            message,
            Some(result),
        )
        .await;
        return;
    }

    // A partial directory scan is not a complete source of truth. Do not clear the
    // existing local availability index when any requested root could not be read.
    if !scan_errors.is_empty() {
        let message = scan_errors[0].error.clone();
        let result = ScanResult {
            total_files_scanned: media_files.len() as u64,
            matched_count: matched_records.len() as u64,
            matched_records,
            unmatched_files,
            unrecognized_files,
            duplicate_files: Vec::new(),
            errors: scan_errors,
        };
        finish_failed(
            &tasks,
            &task_id,
            &progress,
            &reporter,
            stop_tx,
            message,
            Some(result),
        )
        .await;
        return;
    }

    // Phase 4：入库和删除重复统一按 HVIDEO > MKV > MP4 > 其他格式，同级按路径排序。
    {
        let mut value = progress.lock().await;
        value.current_directory = "正在处理重复文件...".to_string();
        value.percentage = 92.0;
    }
    let duplicate_input = matched_records
        .into_iter()
        .map(|record| (record.songId, record.filePath))
        .collect();
    // Keep duplicate files until the database transaction succeeds. Deleting them
    // before the index is committed could lose media if the write later fails.
    let (unique_pairs, mut duplicate_files, duplicate_errors) =
        handle_duplicates(duplicate_input, false).await;
    let matched_records: Vec<MatchRecord> = unique_pairs
        .into_iter()
        .map(|(songId, filePath)| MatchRecord { songId, filePath })
        .collect();

    if is_cancelled(&cancel_flag).await {
        finish_cancelled(&tasks, &task_id, &progress, &reporter, stop_tx).await;
        return;
    }

    // Phase 5：在单一事务中写入对照；增量保留未匹配到的旧记录，全量重建。
    {
        let mut value = progress.lock().await;
        value.current_directory = format!("正在写入路径（共 {} 条）...", matched_records.len());
        value.percentage = 95.0;
    }
    let write_progress = progress.clone();
    let report_write = Arc::new(move |done: usize, total: usize| {
        if let Ok(mut value) = write_progress.try_lock() {
            value.percentage = 95.0 + 4.0 * done as f64 / total.max(1) as f64;
            value.current_directory = if done == total {
                format!("正在提交路径（共 {} 条）...", total)
            } else {
                format!("正在写入路径 {}/{}", done, total)
            };
        }
    });
    let updated = match update_song_paths(&pool, &matched_records, &req.directory, incremental, report_write).await {
        Ok(updated) => updated,
        Err(write_error) => {
            let message = format!("写入数据库失败: {}", write_error);
            error!("{}", message);
            finish_failed(
                &tasks, &task_id, &progress, &reporter, stop_tx, message, None,
            )
            .await;
            return;
        }
    };

    let mut errors = scan_errors;
    errors.extend(duplicate_errors);
    if delete_duplicates {
        for duplicate in &mut duplicate_files {
            for path in &duplicate.duplicate_files {
                match tokio::fs::remove_file(path).await {
                    Ok(()) => duplicate.deleted_files.push(path.clone()),
                    Err(error) => errors.push(ScanError {
                        filePath: path.clone(),
                        error: format!("删除失败: {}", error),
                    }),
                }
            }
        }
    }

    let result = ScanResult {
        total_files_scanned: media_files.len() as u64,
        matched_count: updated,
        matched_records,
        unmatched_files,
        unrecognized_files,
        duplicate_files,
        errors,
    };

    {
        let mut value = progress.lock().await;
        value.percentage = 100.0;
        value.matched_songs = result.matched_records.len() as u64;
        value.current_directory = "扫描完成".to_string();
    }
    let progress_snapshot = progress.lock().await.clone();
    {
        let mut guard = tasks.lock().await;
        if let Some(entry) = guard.get_mut(&task_id) {
            entry.task.status = TaskStatus::Completed;
            entry.task.completed_at = Some(Utc::now());
            entry.task.progress = progress_snapshot;
            entry.task.result = Some(result.clone());
            entry.task.error_message = None;
        }
        prune_finished_tasks(&mut guard);
    }

    let _ = stop_tx.send(());
    reporter.report_completion(&result);
    info!("扫描任务 {} 完成", task_id);
}

async fn is_cancelled(cancel_flag: &Arc<Mutex<bool>>) -> bool {
    *cancel_flag.lock().await
}

async fn finish_cancelled(
    tasks: &Arc<Mutex<HashMap<String, TaskEntry>>>,
    task_id: &str,
    progress: &Arc<Mutex<ScanProgress>>,
    reporter: &ProgressReporter,
    stop_tx: tokio::sync::oneshot::Sender<()>,
) {
    let progress_snapshot = progress.lock().await.clone();
    {
        let mut guard = tasks.lock().await;
        if let Some(entry) = guard.get_mut(task_id) {
            entry.task.status = TaskStatus::Cancelled;
            entry.task.completed_at = Some(Utc::now());
            entry.task.progress = progress_snapshot;
            entry.task.error_message = None;
        }
        prune_finished_tasks(&mut guard);
    }
    let _ = stop_tx.send(());
    reporter.report_cancelled();
}

async fn finish_failed(
    tasks: &Arc<Mutex<HashMap<String, TaskEntry>>>,
    task_id: &str,
    progress: &Arc<Mutex<ScanProgress>>,
    reporter: &ProgressReporter,
    stop_tx: tokio::sync::oneshot::Sender<()>,
    message: String,
    result: Option<ScanResult>,
) {
    let progress_snapshot = progress.lock().await.clone();
    let report_result = result.clone();
    {
        let mut guard = tasks.lock().await;
        if let Some(entry) = guard.get_mut(task_id) {
            entry.task.status = TaskStatus::Failed;
            entry.task.completed_at = Some(Utc::now());
            entry.task.progress = progress_snapshot;
            entry.task.result = result;
            entry.task.error_message = Some(message.clone());
        }
        prune_finished_tasks(&mut guard);
    }
    let _ = stop_tx.send(());
    reporter.report_error(&message, report_result.as_ref());
}

fn task_snapshot_message(task: &ScanTask, progress: &ScanProgress) -> String {
    match task.status {
        TaskStatus::Running => serde_json::json!({
            "type": "progress",
            "data": progress,
        })
        .to_string(),
        TaskStatus::Completed => serde_json::json!({
            "type": "completed",
            "data": task.result,
        })
        .to_string(),
        TaskStatus::Cancelled => serde_json::json!({ "type": "cancelled" }).to_string(),
        TaskStatus::Failed => serde_json::json!({
            "type": "error",
            "message": task.error_message.as_deref().unwrap_or("扫描失败"),
            "data": task.result.as_ref(),
        })
        .to_string(),
    }
}

fn prune_finished_tasks(tasks: &mut HashMap<String, TaskEntry>) {
    let mut finished: Vec<(String, chrono::DateTime<Utc>)> = tasks
        .iter()
        .filter(|(_, entry)| entry.task.status != TaskStatus::Running)
        .map(|(task_id, entry)| {
            (
                task_id.clone(),
                entry.task.completed_at.unwrap_or(entry.task.started_at),
            )
        })
        .collect();
    if finished.len() <= MAX_RETAINED_FINISHED_TASKS {
        return;
    }
    finished.sort_by_key(|(_, completed_at)| *completed_at);
    let remove_count = finished.len() - MAX_RETAINED_FINISHED_TASKS;
    for (task_id, _) in finished.into_iter().take(remove_count) {
        tasks.remove(&task_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use tempfile::TempDir;

    async fn create_scan_pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE songs (songNo TEXT PRIMARY KEY, absolutePath TEXT, relativePath TEXT, fileName TEXT, videoFileType TEXT, scoreEnabled INTEGER DEFAULT 0, fileExists INTEGER DEFAULT 0, updatedTime INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE songSearch (songNo TEXT PRIMARY KEY, fileExists INTEGER DEFAULT 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("CREATE TABLE songSingers (songNo TEXT, fileExists INTEGER DEFAULT 0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE songFiles (songNo TEXT PRIMARY KEY, absolutePath TEXT, relativePath TEXT, fileName TEXT, fileExists INTEGER DEFAULT 0, lastCheckedTime INTEGER, lastError TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn wait_for_terminal_task(service: &SongPathMatcherService, task_id: &str) -> ScanTask {
        for _ in 0..100 {
            let task = service.get_task(task_id).await.unwrap();
            if task.status != TaskStatus::Running {
                return task;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("扫描任务未在测试超时前结束");
    }

    #[tokio::test]
    async fn alphanumeric_song_no_matches_end_to_end() {
        let temp = TempDir::new().unwrap();
        std::fs::write(temp.path().join("20690YHD.mp4"), b"video").unwrap();
        let pool = create_scan_pool().await;
        sqlx::query("INSERT INTO songs (songNo) VALUES ('20690YHD')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO songSearch (songNo) VALUES ('20690YHD')")
            .execute(&pool)
            .await
            .unwrap();

        let service = SongPathMatcherService::new();
        let task_id = service
            .start_scan(
                pool.clone(),
                StartScanRequest {
                    directory: temp.path().to_string_lossy().to_string(),
                    delete_duplicates: false, incremental: false,
                },
            )
            .await
            .unwrap();
        let task = wait_for_terminal_task(&service, &task_id).await;

        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(task.progress.scanned_files, 1);
        assert_eq!(task.progress.matched_songs, 1);
        let result = task.result.unwrap();
        assert_eq!(result.matched_count, 1);
        assert_eq!(result.matched_records[0].songId, "20690YHD");
    }

    #[tokio::test]
    async fn scan_prefers_hvideo_over_saved_mkv_and_alphabetically_first_idle_copy() {
        let temp = TempDir::new().unwrap();
        let idle_dir = temp.path().join("HVIDEO/freesongs");
        let mv_dir = temp.path().join("MV");
        std::fs::create_dir_all(&idle_dir).unwrap();
        std::fs::create_dir(&mv_dir).unwrap();
        let idle = idle_dir.join("60000114.mkv");
        let encrypted = mv_dir.join("60000114.hvideo");
        std::fs::write(&idle, b"original video").unwrap();
        std::fs::write(&encrypted, b"encrypted video").unwrap();
        let pool = create_scan_pool().await;
        sqlx::query("INSERT INTO songs(songNo,absolutePath,videoFileType) VALUES('60000114',?,'mkv')")
            .bind(idle.to_string_lossy().as_ref()).execute(&pool).await.unwrap();
        let service = SongPathMatcherService::new();
        for _ in 0..2 {
            let task_id = service.start_scan(pool.clone(), StartScanRequest {
                directory: temp.path().to_string_lossy().into_owned(), delete_duplicates: false, incremental: false,
            }).await.unwrap();
            let task = wait_for_terminal_task(&service, &task_id).await;
            assert_eq!(task.status, TaskStatus::Completed);
            let expected = encrypted.to_string_lossy().replace('\\', "/");
            let catalog: (String,String) = sqlx::query_as("SELECT absolutePath,videoFileType FROM songs WHERE songNo='60000114'")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(catalog, (expected.clone(), "hvideo".into()));
            let playable: String = sqlx::query_scalar("SELECT absolutePath FROM local_available_songs WHERE songNo='60000114'")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(playable, expected);
            assert_eq!(task.result.unwrap().duplicate_files[0].kept_file, expected);
            assert!(idle.is_file() && encrypted.is_file());
        }
    }

    #[tokio::test]
    async fn scan_and_delete_share_format_priority_and_only_delete_after_commit() {
        for extensions in [
            vec!["HVIDEO", "MkV", "MP4", "avi"],
            vec!["MkV", "MP4", "avi"],
            vec!["MP4", "avi"],
        ] {
            for fail_write in [false, true] {
                let temp = TempDir::new().unwrap();
                let mut files = Vec::new();
                for (index, extension) in extensions.iter().enumerate() {
                    // Lower priority files deliberately sort before the winner.
                    let directory = temp.path().join(format!("{}", extensions.len() - index));
                    std::fs::create_dir(&directory).unwrap();
                    let file = directory.join(format!("100.{extension}"));
                    std::fs::write(&file, b"test video").unwrap();
                    files.push(file);
                }
                let pool = create_scan_pool().await;
                let old_path = files.last().unwrap().to_string_lossy().replace('\\', "/");
                sqlx::query("INSERT INTO songs(songNo,absolutePath,videoFileType) VALUES('100',?,'avi')")
                    .bind(&old_path).execute(&pool).await.unwrap();
                if fail_write {
                    sqlx::query("CREATE TRIGGER fail_path_update BEFORE UPDATE ON songs BEGIN SELECT RAISE(ABORT, 'test write failure'); END")
                        .execute(&pool).await.unwrap();
                }
                let service = SongPathMatcherService::new();
                // First scan keeps all copies, second scan deletes only losing files.
                for delete_duplicates in [false, true] {
                    let task_id = service.start_scan(pool.clone(), StartScanRequest {
                        directory: temp.path().to_string_lossy().into_owned(),
                        delete_duplicates, incremental: false,
                    }).await.unwrap();
                    let task = wait_for_terminal_task(&service, &task_id).await;
                    let catalog: (String, String) = sqlx::query_as("SELECT absolutePath,videoFileType FROM songs WHERE songNo='100'")
                        .fetch_one(&pool).await.unwrap();
                    if fail_write {
                        assert_eq!(task.status, TaskStatus::Failed);
                        assert_eq!(catalog, (old_path.clone(), "avi".into()));
                        assert!(files.iter().all(|file| file.is_file()));
                        continue;
                    }
                    assert_eq!(task.status, TaskStatus::Completed);
                    let expected = files[0].to_string_lossy().replace('\\', "/");
                    assert_eq!(catalog, (expected.clone(), extensions[0].to_ascii_lowercase()));
                    for table in ["songFiles", "local_available_songs"] {
                        let path: String = sqlx::query_scalar(&format!("SELECT absolutePath FROM {table} WHERE songNo='100'"))
                            .fetch_one(&pool).await.unwrap();
                        assert_eq!(path, expected);
                    }
                    let result = task.result.unwrap();
                    assert!(result.errors.is_empty());
                    assert_eq!(result.matched_count, 1);
                    assert_eq!(result.duplicate_files[0].kept_file, expected);
                    let deleted_count = if delete_duplicates { files.len() - 1 } else { 0 };
                    assert_eq!(result.duplicate_files[0].deleted_files.len(), deleted_count);
                    assert!(files[0].is_file());
                    for file in &files[1..] {
                        assert_eq!(file.is_file(), !delete_duplicates);
                    }
                }
                pool.close().await;
            }
        }
    }

    #[tokio::test]
    async fn all_selected_directories_share_one_authoritative_song_index() {
        let temp = TempDir::new().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        let unselected = temp.path().join("unselected");
        for (directory, song_no) in [(&first, "100"), (&second, "YN200"), (&unselected, "300")] {
            std::fs::create_dir(directory).unwrap();
            std::fs::write(directory.join(format!("{song_no}.mp4")), b"video").unwrap();
        }
        let pool = create_scan_pool().await;
        sqlx::query("INSERT INTO songs (songNo) VALUES ('100'), ('YN200'), ('300')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO songSearch (songNo) VALUES ('100'), ('YN200'), ('300')")
            .execute(&pool)
            .await
            .unwrap();
        let service = SongPathMatcherService::new();
        let task_id = service
            .start_scan(
                pool.clone(),
                StartScanRequest {
                    directory: format!("{};{}", first.display(), second.display()),
                    delete_duplicates: false, incremental: false,
                },
            )
            .await
            .unwrap();
        let task = wait_for_terminal_task(&service, &task_id).await;
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(task.result.unwrap().matched_count, 2);
        let indexed: Vec<(String, String)> = sqlx::query_as(
            "SELECT songNo, absolutePath FROM local_available_songs ORDER BY songNo",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            indexed,
            vec![
                (
                    "100".to_string(),
                    first.join("100.mp4").to_string_lossy().replace('\\', "/")
                ),
                (
                    "YN200".to_string(),
                    second
                        .join("YN200.mp4")
                        .to_string_lossy()
                        .replace('\\', "/")
                ),
            ]
        );

        let task_id = service
            .start_scan(
                pool.clone(),
                StartScanRequest {
                    directory: second.to_string_lossy().to_string(),
                    delete_duplicates: false, incremental: false,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            wait_for_terminal_task(&service, &task_id).await.status,
            TaskStatus::Completed
        );
        let indexed: Vec<String> =
            sqlx::query_scalar("SELECT songNo FROM local_available_songs ORDER BY songNo")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(indexed, vec!["YN200"]);
        assert!(first.join("100.mp4").is_file());
        assert!(unselected.join("300.mp4").is_file());
    }

    #[tokio::test]
    async fn incremental_scan_preserves_existing_songs_updates_matches_and_rolls_back_on_failure() {
        let temp = TempDir::new().unwrap();
        let old_dir = temp.path().join("old");
        let new_dir = temp.path().join("new");
        let empty_dir = temp.path().join("empty");
        for directory in [&old_dir, &new_dir, &empty_dir] {
            std::fs::create_dir(directory).unwrap();
        }
        for name in ["100.mp4", "300.mkv"] {
            std::fs::write(old_dir.join(name), b"old media").unwrap();
        }
        for name in ["100.mp4", "100.MKV", "100.HVIDEO", "YN200.mp4", "999.mp4"] {
            std::fs::write(new_dir.join(name), b"new media").unwrap();
        }
        let pool = create_scan_pool().await;
        for table in ["songs", "songSearch", "songSingers"] {
            sqlx::query(&format!("INSERT INTO {table}(songNo) VALUES('100'),('YN200'),('300')"))
                .execute(&pool).await.unwrap();
        }
        let service = SongPathMatcherService::new();
        let initial = service.start_scan(pool.clone(), StartScanRequest {
            directory: old_dir.to_string_lossy().into_owned(), delete_duplicates: false, incremental: false,
        }).await.unwrap();
        assert_eq!(wait_for_terminal_task(&service, &initial).await.status, TaskStatus::Completed);

        // Capture every column in every table to catch clearing flags or changing untouched rows.
        async fn snapshot(pool: &sqlx::SqlitePool, song_no: Option<&str>) -> Vec<String> {
            use sqlx::Row;
            let mut result = Vec::new();
            for table in ["songs", "songFiles", "songSearch", "songSingers", "local_available_songs"] {
                let columns = sqlx::query(&format!("PRAGMA table_info({table})"))
                    .fetch_all(pool).await.unwrap();
                let fields = columns.iter().map(|row| {
                    let name: String = row.get("name");
                    format!("'{name}',\"{name}\"")
                }).collect::<Vec<_>>().join(",");
                let rows: Vec<String> = sqlx::query_scalar(&format!(
                    "SELECT json_object({fields}) FROM {table} WHERE (? IS NULL OR songNo=?) ORDER BY songNo"
                )).bind(song_no).bind(song_no).fetch_all(pool).await.unwrap();
                result.push(format!("{table}: {rows:?}"));
            }
            result
        }
        let untouched = snapshot(&pool, Some("300")).await;
        for delete_duplicates in [false, true] {
            let id = service.start_scan(pool.clone(), StartScanRequest {
                directory: new_dir.to_string_lossy().into_owned(), delete_duplicates, incremental: true,
            }).await.unwrap();
            let task = wait_for_terminal_task(&service, &id).await;
            assert_eq!(task.status, TaskStatus::Completed);
            assert!(serde_json::to_value(&task).unwrap()["incremental"].as_bool().unwrap());
            let result = task.result.unwrap();
            assert_eq!(result.matched_count, 2);
            assert_eq!(result.unmatched_files.len(), 1);
            assert!(result.errors.is_empty());
            assert_eq!(result.duplicate_files[0].deleted_files.len(), if delete_duplicates { 2 } else { 0 });
            assert_eq!(snapshot(&pool, Some("300")).await, untouched);
            let indexed: Vec<String> = sqlx::query_scalar("SELECT songNo FROM local_available_songs ORDER BY songNo")
                .fetch_all(&pool).await.unwrap();
            assert_eq!(indexed, vec!["100", "300", "YN200"]);
            let matched: (String, String) = sqlx::query_as("SELECT absolutePath,videoFileType FROM songs WHERE songNo='100'")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(matched, (new_dir.join("100.HVIDEO").to_string_lossy().replace('\\', "/"), "hvideo".into()));
            assert!(old_dir.join("100.mp4").is_file()); // Never delete copies outside this scan.
            assert!(new_dir.join("999.mp4").is_file()); // Unmatched files are also never deleted.
            assert_eq!(new_dir.join("100.MKV").is_file(), !delete_duplicates);
            assert_eq!(new_dir.join("100.mp4").is_file(), !delete_duplicates);
        }

        let before = snapshot(&pool, None).await;
        for unmatched_only in [false, true] {
            if unmatched_only {
                std::fs::write(empty_dir.join("999.mp4"), b"unknown").unwrap();
            }
            let id = service.start_scan(pool.clone(), StartScanRequest {
                directory: empty_dir.to_string_lossy().into_owned(), delete_duplicates: true, incremental: true,
            }).await.unwrap();
            let task = wait_for_terminal_task(&service, &id).await;
            assert_eq!(task.status, TaskStatus::Completed);
            assert_eq!(task.result.unwrap().matched_count, 0);
            assert_eq!(snapshot(&pool, None).await, before);
        }

        // Fail after updating source fields, before writing the playable index: all changes roll back.
        std::fs::write(new_dir.join("100.MKV"), b"duplicate must survive failure").unwrap();
        sqlx::query("CREATE TRIGGER fail_incremental BEFORE INSERT ON local_available_songs BEGIN SELECT RAISE(ABORT, 'test failure'); END")
            .execute(&pool).await.unwrap();
        let id = service.start_scan(pool.clone(), StartScanRequest {
            directory: new_dir.to_string_lossy().into_owned(), delete_duplicates: true, incremental: true,
        }).await.unwrap();
        assert_eq!(wait_for_terminal_task(&service, &id).await.status, TaskStatus::Failed);
        assert_eq!(snapshot(&pool, None).await, before);
        assert!(new_dir.join("100.MKV").is_file());
        pool.close().await;
    }

    #[tokio::test]
    async fn completed_task_subscription_starts_with_completed_snapshot() {
        let temp = TempDir::new().unwrap();
        let pool = create_scan_pool().await;
        let service = SongPathMatcherService::new();
        let task_id = service
            .start_scan(
                pool,
                StartScanRequest {
                    directory: temp.path().to_string_lossy().to_string(),
                    delete_duplicates: false, incremental: false,
                },
            )
            .await
            .unwrap();
        let task = wait_for_terminal_task(&service, &task_id).await;
        assert_eq!(task.status, TaskStatus::Completed);

        let (snapshot, _receiver) = service.subscribe_progress(&task_id).await.unwrap();
        let value: serde_json::Value = serde_json::from_str(&snapshot).unwrap();
        assert_eq!(value["type"], "completed");
        assert!(value["data"].is_object());
    }

    #[tokio::test]
    async fn rejects_second_running_task() {
        let pool = create_scan_pool().await;
        let service = SongPathMatcherService::new();
        let (broadcast_tx, _receiver) = broadcast::channel(4);
        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        service.tasks.lock().await.insert(
            "running-task".to_string(),
            TaskEntry {
                task: ScanTask {
                    task_id: "running-task".to_string(),
                    directory: "D:/".to_string(),
                    delete_duplicates: false,
                    incremental: false,
                    status: TaskStatus::Running,
                    started_at: Utc::now(),
                    completed_at: None,
                    progress: ScanProgress::default(),
                    result: None,
                    error_message: None,
                },
                progress,
                cancel_flag: Arc::new(Mutex::new(false)),
                broadcast_tx,
            },
        );

        let error = service
            .start_scan(
                pool,
                StartScanRequest {
                    directory: "E:/".to_string(),
                    delete_duplicates: false, incremental: false,
                },
            )
            .await
            .unwrap_err();
        assert!(error.contains("已有扫描任务"));
    }

    #[tokio::test]
    async fn partial_root_failure_fails_without_replacing_the_index() {
        let temp = TempDir::new().unwrap();
        let missing = format!("{}-missing", Uuid::new_v4());
        let pool = create_scan_pool().await;
        let service = SongPathMatcherService::new();
        let task_id = service
            .start_scan(
                pool,
                StartScanRequest {
                    directory: format!("{};{}", temp.path().display(), missing),
                    delete_duplicates: false, incremental: false,
                },
            )
            .await
            .unwrap();
        let task = wait_for_terminal_task(&service, &task_id).await;
        assert_eq!(task.status, TaskStatus::Failed);
        assert_eq!(task.result.unwrap().errors.len(), 1);
    }

    #[tokio::test]
    async fn failed_task_subscription_includes_result_data() {
        let pool = create_scan_pool().await;
        let service = SongPathMatcherService::new();
        let missing = format!("{}-missing", Uuid::new_v4());
        let task_id = service
            .start_scan(
                pool,
                StartScanRequest {
                    directory: missing,
                    delete_duplicates: false, incremental: false,
                },
            )
            .await
            .unwrap();
        let task = wait_for_terminal_task(&service, &task_id).await;
        assert_eq!(task.status, TaskStatus::Failed);
        assert!(task.result.is_some());

        let (snapshot, _receiver) = service.subscribe_progress(&task_id).await.unwrap();
        let value: serde_json::Value = serde_json::from_str(&snapshot).unwrap();
        assert_eq!(value["type"], "error");
        assert!(value["message"]
            .as_str()
            .is_some_and(|message| !message.is_empty()));
        assert!(value["data"].is_object());
        assert!(value["data"]["errors"].is_array());
    }

    #[tokio::test]
    async fn all_invalid_roots_fail_with_reason() {
        let pool = create_scan_pool().await;
        let service = SongPathMatcherService::new();
        let missing = format!("{}-missing", Uuid::new_v4());
        let task_id = service
            .start_scan(
                pool,
                StartScanRequest {
                    directory: missing,
                    delete_duplicates: false, incremental: false,
                },
            )
            .await
            .unwrap();
        let task = wait_for_terminal_task(&service, &task_id).await;
        assert_eq!(task.status, TaskStatus::Failed);
        assert!(task.error_message.is_some());
        assert!(!task.result.unwrap().errors.is_empty());
    }
}
