/// 重复文件处理模块
///
/// 对相同 songId 的多个文件按 HVIDEO、MKV、MP4、其他格式排序，同格式按路径排序。
use std::collections::{BTreeMap, HashSet};
use tracing::{info, warn};

use crate::models::scan_task::{DuplicateInfo, ScanError};

fn path_identity(path: &str) -> String {
    let path = crate::utils::media_path::normalize_slashes(path);
    if cfg!(windows) { path.to_ascii_lowercase() } else { path }
}

/// 处理重复文件
///
/// 入库与删除重复共用格式优先级；重复扫描到的同一路径不能成为待删除副本。
///
/// # Returns
/// - `unique_files`: 去重后的 (songId, filePath) 列表
/// - `duplicate_infos`: 重复文件的处理记录
/// - `errors`: 删除失败的错误记录
pub async fn handle_duplicates(
    files: Vec<(String, String)>,
    delete_duplicates: bool,
) -> (Vec<(String, String)>, Vec<DuplicateInfo>, Vec<ScanError>) {
    let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (songId, path) in files {
        groups.entry(songId).or_default().push(path);
    }

    let mut unique_files = Vec::new();
    let mut duplicate_infos = Vec::new();
    let mut errors = Vec::new();

    for (songId, mut paths) in groups {
        paths.sort();
        let mut identities = HashSet::new();
        paths.retain(|path| identities.insert(path_identity(path)));
        paths.sort_by_cached_key(|path| {
            let extension = std::path::Path::new(path).extension()
                .and_then(|extension| extension.to_str())
                .unwrap_or_default().to_ascii_lowercase();
            let priority = match extension.as_str() {
                "hvideo" => 0,
                "mkv" => 1,
                "mp4" => 2,
                _ => 3,
            };
            (priority, path.clone())
        });
        if paths.len() == 1 {
            unique_files.push((songId, paths.remove(0)));
            continue;
        }

        let kept = paths.remove(0);
        let duplicates = paths;
        info!(
            "发现重复文件: songId={}, 保留={}, 共 {} 个重复",
            songId,
            kept,
            duplicates.len()
        );

        let mut deleted_files = Vec::new();
        if delete_duplicates {
            for dup_path in &duplicates {
                match tokio::fs::remove_file(dup_path).await {
                    Ok(_) => {
                        info!("已删除重复文件: {}", dup_path);
                        deleted_files.push(dup_path.clone());
                    }
                    Err(e) => {
                        warn!("删除重复文件失败 {}: {}", dup_path, e);
                        errors.push(ScanError {
                            filePath: dup_path.clone(),
                            error: format!("删除失败: {}", e),
                        });
                    }
                }
            }
        }

        duplicate_infos.push(DuplicateInfo {
            songId: songId.clone(),
            kept_file: kept.clone(),
            duplicate_files: duplicates,
            deleted_files,
        });
        unique_files.push((songId, kept));
    }

    (unique_files, duplicate_infos, errors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_no_duplicates() {
        let files = vec![
            ("1".to_string(), "/a/1.mp4".to_string()),
            ("YN2".to_string(), "/a/2.mp4".to_string()),
        ];
        let (unique, infos, errors) = handle_duplicates(files, false).await;
        assert_eq!(unique.len(), 2);
        assert_eq!(infos.len(), 0);
        assert_eq!(errors.len(), 0);
    }

    #[tokio::test]
    async fn test_duplicates_no_delete() {
        let files = vec![
            ("YN1".to_string(), "/a/1.mp4".to_string()),
            ("YN1".to_string(), "/b/1.mp4".to_string()),
            ("YN1".to_string(), "/c/1.mp4".to_string()),
        ];
        let (unique, infos, errors) = handle_duplicates(files, false).await;
        assert_eq!(unique.len(), 1);
        assert_eq!(infos.len(), 1);
        assert_eq!(infos[0].duplicate_files.len(), 2);
        assert!(infos[0].deleted_files.is_empty());
        assert_eq!(errors.len(), 0);
    }

    #[tokio::test]
    async fn test_duplicates_with_delete() {
        let temp = TempDir::new().unwrap();
        let file1 = temp.path().join("1a.mp4");
        let file2 = temp.path().join("1b.mp4");
        fs::write(&file1, b"test").unwrap();
        fs::write(&file2, b"test").unwrap();

        let files = vec![
            ("1".to_string(), file1.to_str().unwrap().to_string()),
            ("1".to_string(), file2.to_str().unwrap().to_string()),
        ];
        let (unique, infos, errors) = handle_duplicates(files, true).await;
        assert_eq!(unique.len(), 1);
        assert_eq!(infos.len(), 1);
        assert_eq!(infos[0].duplicate_files.len(), 1);
        assert_eq!(infos[0].deleted_files.len(), 1);
        assert_eq!(errors.len(), 0);
        assert!(file1.exists());
        assert!(!file2.exists());
    }

    #[tokio::test]
    async fn test_delete_nonexistent_file_records_error() {
        let files = vec![
            ("5".to_string(), "/real/5.mp4".to_string()),
            ("5".to_string(), "/nonexistent/5.mp4".to_string()),
        ];
        let (unique, infos, errors) = handle_duplicates(files, true).await;
        assert_eq!(unique.len(), 1);
        assert_eq!(infos.len(), 1);
        assert_eq!(errors.len(), 1);
    }

    #[tokio::test]
    async fn test_kept_file_is_deterministic() {
        let files = vec![
            ("1".to_string(), "/z/1.mp4".to_string()),
            ("1".to_string(), "/a/1.mp4".to_string()),
            ("1".to_string(), "/m/1.mp4".to_string()),
        ];
        let (unique, infos, errors) = handle_duplicates(files, false).await;
        assert_eq!(unique, vec![("1".to_string(), "/a/1.mp4".to_string())]);
        assert_eq!(infos[0].kept_file, "/a/1.mp4");
        assert_eq!(
            infos[0].duplicate_files,
            vec!["/m/1.mp4".to_string(), "/z/1.mp4".to_string()]
        );
        assert!(infos[0].deleted_files.is_empty());
        assert!(errors.is_empty());
    }

    #[tokio::test]
    async fn test_multiple_groups() {
        let files = vec![
            ("1".to_string(), "/a/1.mp4".to_string()),
            ("YN2".to_string(), "/a/2.mp4".to_string()),
            ("1".to_string(), "/b/1.mp4".to_string()),
            ("3".to_string(), "/a/3.mp4".to_string()),
            ("YN2".to_string(), "/b/2.mp4".to_string()),
        ];
        let (unique, infos, errors) = handle_duplicates(files, false).await;
        assert_eq!(unique.len(), 3);
        assert_eq!(infos.len(), 2);
        assert_eq!(errors.len(), 0);
    }

    #[tokio::test]
    async fn format_priority_overrides_path_order_and_ignores_extension_case() {
        let candidates = [
            "/z/100.HVIDEO", "/y/100.MkV", "/x/100.MP4", "/a/100.avi",
        ];
        for first in 0..candidates.len() {
            let files = candidates[first..].iter().rev()
                .map(|path| ("100".to_string(), path.to_string())).collect();
            let (unique, infos, errors) = handle_duplicates(files, false).await;
            assert_eq!(unique, vec![("100".into(), candidates[first].into())]);
            assert!(errors.is_empty());
            if first + 1 < candidates.len() {
                assert_eq!(infos[0].kept_file, candidates[first]);
                assert_eq!(infos[0].duplicate_files, candidates[first + 1..]);
                assert!(infos[0].deleted_files.is_empty());
            } else {
                assert!(infos.is_empty());
            }
        }
    }

    #[tokio::test]
    async fn overlapping_roots_never_delete_the_kept_file() {
        let temp = TempDir::new().unwrap();
        let file = temp.path().join("100.hvideo");
        fs::write(&file, b"original").unwrap();
        let path = file.to_string_lossy().into_owned();
        let files = vec![("100".into(), path.clone()), ("100".into(), path.clone())];
        let (unique, infos, errors) = handle_duplicates(files, true).await;
        assert_eq!(unique, vec![("100".into(), path)]);
        assert!(infos.is_empty());
        assert!(errors.is_empty());
        assert_eq!(fs::read(file).unwrap(), b"original");
    }
}
