/// 文件扫描器模块
///
/// 递归扫描目录，查找所有视频文件
/// 支持取消令牌和实时进度更新
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::Mutex;
use tokio::task::JoinSet;
use tracing::{debug, warn};

use crate::models::scan_task::ScanProgress;
use crate::utils::media_path;

/// 并发扫描的最大并行目录数
const MAX_CONCURRENT_DIRS: usize = 8;

/// 扫描目录，递归查找所有视频文件
///
/// # Arguments
///
/// * `directory` - 要扫描的根目录路径
/// * `progress` - 共享的进度状态（用于实时更新）
/// * `should_cancel` - 取消标志的共享引用
///
/// # Returns
///
/// * `Result<Vec<PathBuf>, std::io::Error>` - 找到的所有视频文件路径列表
///
/// # Behavior
///
/// - 递归遍历所有子目录
/// - 只收集本地点播支持的视频文件
/// - 排除系统保护目录；拒绝访问的目录跳过，其他读取错误中止扫描，避免用不完整结果更新索引
/// - 定期检查取消标志，如果被取消则提前返回
/// - 实时更新扫描进度（当前目录、已扫描文件数）
pub async fn scan_directory(
    directory: &Path,
    progress: Arc<Mutex<ScanProgress>>,
    should_cancel: Arc<Mutex<bool>>,
) -> Result<Vec<PathBuf>, std::io::Error> {
    if should_skip_path(directory) || *should_cancel.lock().await {
        return Ok(Vec::new());
    }
    // 获取顶层子目录，并发分发扫描任务
    let mut top_dirs: Vec<PathBuf> = Vec::new();
    let mut root_files: Vec<PathBuf> = Vec::new();

    match fs::read_dir(directory).await {
        Ok(mut entries) => {
            loop {
                let entry = match entries.next_entry().await {
                    Ok(Some(entry)) => entry,
                    Ok(None) => break,
                    Err(error) if is_permission_denied(&error) => {
                        warn!("无法读取目录项，跳过目录 {:?}: {}", directory, error);
                        break;
                    }
                    Err(error) => return Err(path_error(directory, error)),
                };
                if *should_cancel.lock().await {
                    break;
                }
                let path = entry.path();
                if should_skip_path(&path) {
                    continue;
                }
                match entry.file_type().await {
                    Ok(ft) if ft.is_dir() => top_dirs.push(path),
                    Ok(ft) => {
                        if ft.is_file() && is_media_file(&path) {
                            root_files.push(path);
                        }
                    }
                    Err(e) if is_permission_denied(&e) => {
                        warn!("无法访问目录项，跳过 {:?}: {}", path, e);
                    }
                    Err(e) => return Err(path_error(&path, e)),
                }
            }
        }
        Err(e) => return Err(path_error(directory, e)),
    }

    // 根目录下直接文件先计入进度
    {
        let mut p = progress.lock().await;
        p.scanned_files += root_files.len() as u64;
        if !root_files.is_empty() {
            p.current_directory = directory.display().to_string();
        }
    }

    // 并发扫描子目录（最多 MAX_CONCURRENT_DIRS 个并行）
    let mut all_files = root_files;
    let mut join_set: JoinSet<Result<Vec<PathBuf>, std::io::Error>> = JoinSet::new();
    let mut dir_iter = top_dirs.into_iter();

    // 初始填满并发槽
    for dir in dir_iter.by_ref().take(MAX_CONCURRENT_DIRS) {
        let p = progress.clone();
        let c = should_cancel.clone();
        join_set.spawn(scan_subdir(dir, p, c));
    }

    while let Some(result) = join_set.join_next().await {
        if *should_cancel.lock().await {
            join_set.abort_all();
            break;
        }
        match result {
            Ok(Ok(files)) => all_files.extend(files),
            Ok(Err(error)) => return Err(error),
            Err(error) => {
                return Err(std::io::Error::other(format!(
                    "扫描子目录任务失败: {}",
                    error
                )))
            }
        }
        // 补充新任务，保持并发数
        if let Some(dir) = dir_iter.next() {
            let p = progress.clone();
            let c = should_cancel.clone();
            join_set.spawn(scan_subdir(dir, p, c));
        }
    }

    debug!("扫描完成，共找到 {} 个视频文件", all_files.len());
    Ok(all_files)
}

/// 递归扫描单个子目录（用于并发任务）
async fn scan_subdir(
    root: PathBuf,
    progress: Arc<Mutex<ScanProgress>>,
    should_cancel: Arc<Mutex<bool>>,
) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut files = Vec::new();
    let mut stack = vec![root];

    while let Some(current_dir) = stack.pop() {
        if should_skip_path(&current_dir) {
            continue;
        }
        if *should_cancel.lock().await {
            break;
        }
        {
            let mut p = progress.lock().await;
            p.current_directory = current_dir.display().to_string();
        }
        match fs::read_dir(&current_dir).await {
            Ok(mut entries) => {
                loop {
                    let entry = match entries.next_entry().await {
                        Ok(Some(entry)) => entry,
                        Ok(None) => break,
                        Err(error) if is_permission_denied(&error) => {
                            warn!("无法读取目录项，跳过目录 {:?}: {}", current_dir, error);
                            break;
                        }
                        Err(error) => return Err(path_error(&current_dir, error)),
                    };
                    if *should_cancel.lock().await {
                        break;
                    }
                    let path = entry.path();
                    if should_skip_path(&path) {
                        continue;
                    }
                    match entry.file_type().await {
                        Ok(ft) if ft.is_dir() => stack.push(path),
                        Ok(ft) => {
                            if ft.is_file() && is_media_file(&path) {
                                files.push(path);
                                let mut p = progress.lock().await;
                                p.scanned_files += 1;
                            }
                        }
                        Err(e) if is_permission_denied(&e) => {
                            warn!("无法访问目录项，跳过 {:?}: {}", path, e);
                        }
                        Err(e) => return Err(path_error(&path, e)),
                    }
                }
            }
            Err(e) if is_permission_denied(&e) => {
                warn!("无法访问目录，跳过 {:?}: {}", current_dir, e);
            }
            Err(e) => {
                warn!("无法访问目录 {:?}: {}", current_dir, e);
                return Err(path_error(&current_dir, e));
            }
        }
    }
    Ok(files)
}

fn is_media_file(path: &Path) -> bool {
    media_path::is_media_file_path(path.to_string_lossy().as_ref())
}

fn should_skip_path(path: &Path) -> bool {
    let value = path.to_string_lossy().replace('\\', "/");
    value.split('/').any(|component| {
        component.eq_ignore_ascii_case("$RECYCLE.BIN")
            || component.eq_ignore_ascii_case("System Volume Information")
    })
}

fn path_error(path: &Path, error: std::io::Error) -> std::io::Error {
    std::io::Error::new(error.kind(), format!("{}: {}", path.display(), error))
}

fn is_permission_denied(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::PermissionDenied
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs as std_fs;
    use tempfile::TempDir;

    #[test]
    fn test_system_directory_components() {
        for path in [
            r"D:\System Volume Information",
            r"D:\$RECYCLE.BIN",
            r"D:\system volume information\video.mp4",
            "D:/$recycle.bin/video.mp4",
        ] {
            assert!(should_skip_path(Path::new(path)), "{path}");
        }
        for path in [
            r"D:\videos\song.mp4",
            r"D:\System Volume Information Backup\song.mp4",
            r"D:\videos\$RECYCLE.BIN.mp4",
        ] {
            assert!(!should_skip_path(Path::new(path)), "{path}");
        }
    }

    #[tokio::test]
    async fn test_scan_excludes_system_directories_at_every_depth() {
        let temp = TempDir::new().unwrap();
        for folder in [
            "System Volume Information",
            "$RECYCLE.BIN",
            "videos/system volume information",
            "videos/$recycle.bin",
            "videos/nested",
            "System Volume Information Backup",
        ] {
            let directory = temp.path().join(folder);
            std_fs::create_dir_all(&directory).unwrap();
            std_fs::write(directory.join("song.mp4"), b"test").unwrap();
        }
        let root_video = temp.path().join("root.mp4");
        std_fs::write(&root_video, b"test").unwrap();
        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        let mut files = scan_directory(temp.path(), progress.clone(), Arc::new(Mutex::new(false)))
            .await
            .unwrap();
        let mut expected = vec![
            root_video,
            temp.path().join("videos/nested/song.mp4"),
            temp.path()
                .join("System Volume Information Backup/song.mp4"),
        ];
        files.sort();
        expected.sort();
        assert_eq!(files, expected);
        assert_eq!(progress.lock().await.scanned_files, 3);
    }

    #[tokio::test]
    async fn test_system_directories_are_excluded_before_reading() {
        let temp = TempDir::new().unwrap();
        let missing = temp.path().join("System Volume Information");
        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        let cancel = Arc::new(Mutex::new(false));
        assert!(scan_directory(&missing, progress.clone(), cancel.clone())
            .await
            .unwrap()
            .is_empty());
        assert!(scan_subdir(missing, progress, cancel)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn test_ordinary_directory_errors_include_failing_path() {
        let temp = TempDir::new().unwrap();
        let missing = temp.path().join("missing-videos");
        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        let cancel = Arc::new(Mutex::new(false));
        let root_error = scan_directory(&missing, progress.clone(), cancel.clone())
            .await
            .unwrap_err();
        let child_error = scan_subdir(missing.clone(), progress, cancel)
            .await
            .unwrap_err();
        for error in [root_error, child_error] {
            assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
            assert!(error
                .to_string()
                .contains(missing.to_string_lossy().as_ref()));
        }
    }

    #[test]
    fn permission_denied_is_a_skippable_directory_error() {
        assert!(is_permission_denied(&std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "access denied",
        )));
        assert!(!is_permission_denied(&std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "missing",
        )));
    }

    /// 创建测试目录结构
    async fn create_test_structure() -> TempDir {
        let temp_dir = TempDir::new().unwrap();
        let base = temp_dir.path();

        // 创建目录结构
        std_fs::create_dir_all(base.join("subdir1")).unwrap();
        std_fs::create_dir_all(base.join("subdir2/nested")).unwrap();

        // 创建 .mp4 文件
        std_fs::write(base.join("video1.mp4"), b"test").unwrap();
        std_fs::write(base.join("subdir1/video2.mp4"), b"test").unwrap();
        std_fs::write(base.join("subdir2/video3.mp4"), b"test").unwrap();
        std_fs::write(base.join("subdir2/nested/video4.mp4"), b"test").unwrap();

        // 创建非 .mp4 文件
        std_fs::write(base.join("readme.txt"), b"test").unwrap();
        std_fs::write(base.join("subdir1/image.jpg"), b"test").unwrap();

        temp_dir
    }

    #[tokio::test]
    async fn test_scan_empty_directory() {
        let temp_dir = TempDir::new().unwrap();
        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        let should_cancel = Arc::new(Mutex::new(false));

        let result = scan_directory(temp_dir.path(), progress, should_cancel).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_scan_single_level() {
        let temp_dir = TempDir::new().unwrap();
        std_fs::write(temp_dir.path().join("video1.mp4"), b"test").unwrap();
        std_fs::write(temp_dir.path().join("video2.mp4"), b"test").unwrap();
        std_fs::write(temp_dir.path().join("readme.txt"), b"test").unwrap();

        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        let should_cancel = Arc::new(Mutex::new(false));

        let result = scan_directory(temp_dir.path(), progress.clone(), should_cancel).await;
        assert!(result.is_ok());

        let files = result.unwrap();
        assert_eq!(files.len(), 2);

        let prog = progress.lock().await;
        assert_eq!(prog.scanned_files, 2);
    }

    #[tokio::test]
    async fn test_scan_nested_directories() {
        let temp_dir = create_test_structure().await;
        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        let should_cancel = Arc::new(Mutex::new(false));

        let result = scan_directory(temp_dir.path(), progress.clone(), should_cancel).await;
        assert!(result.is_ok());

        let files = result.unwrap();
        assert_eq!(files.len(), 4); // 4 个 .mp4 文件

        let prog = progress.lock().await;
        assert_eq!(prog.scanned_files, 4);
    }

    #[tokio::test]
    async fn test_scan_filters_non_mp4() {
        let temp_dir = create_test_structure().await;
        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        let should_cancel = Arc::new(Mutex::new(false));

        let result = scan_directory(temp_dir.path(), progress, should_cancel).await;
        assert!(result.is_ok());

        let files = result.unwrap();
        // 确保所有文件都是 .mp4
        for file in &files {
            assert_eq!(file.extension().unwrap(), "mp4");
        }
    }

    #[tokio::test]
    async fn test_scan_cancellation() {
        let temp_dir = create_test_structure().await;
        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        let should_cancel = Arc::new(Mutex::new(false));

        // 立即设置取消标志
        {
            let mut cancel = should_cancel.lock().await;
            *cancel = true;
        }

        let result = scan_directory(temp_dir.path(), progress, should_cancel).await;
        assert!(result.is_ok());

        // 取消后应该返回空列表或部分结果
        let files = result.unwrap();
        assert!(files.len() < 4); // 应该少于完整扫描的结果
    }

    #[tokio::test]
    async fn test_scan_updates_current_directory() {
        let temp_dir = create_test_structure().await;
        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        let should_cancel = Arc::new(Mutex::new(false));

        let _ = scan_directory(temp_dir.path(), progress.clone(), should_cancel).await;

        let prog = progress.lock().await;
        // 当前目录应该被更新过（不为空）
        assert!(!prog.current_directory.is_empty());
    }

    #[tokio::test]
    async fn test_scan_case_insensitive_extension() {
        let temp_dir = TempDir::new().unwrap();
        std_fs::write(temp_dir.path().join("video1.mp4"), b"test").unwrap();
        std_fs::write(temp_dir.path().join("video2.MP4"), b"test").unwrap();
        std_fs::write(temp_dir.path().join("video3.Mp4"), b"test").unwrap();
        std_fs::write(temp_dir.path().join("video4.hvideo"), b"test").unwrap();
        std_fs::write(temp_dir.path().join("video5.HVIDEO"), b"test").unwrap();

        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        let should_cancel = Arc::new(Mutex::new(false));

        let result = scan_directory(temp_dir.path(), progress, should_cancel).await;
        assert!(result.is_ok());

        let files = result.unwrap();
        assert_eq!(files.len(), 5); // 应该识别所有大小写变体
    }
}
