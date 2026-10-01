use std::{collections::VecDeque, path::Path};

use crate::utils::media_path;

pub const DEFAULT_IDLE_SONG_PATH: &str = "YN-song/freesongs";

pub const IDLE_MEDIA_EXTS: &[&str] = &[
    "hvideo", "mp4", "mkv", "avi", "mov", "flv", "mpg", "mpeg", "vob", "dat", "ts",
];

#[derive(Debug, Default, PartialEq, Eq)]
pub struct IdleMediaScan {
    pub scanned_dirs: Vec<String>,
    pub files: Vec<String>,
}

fn contains_parent_segment(path: &str) -> bool {
    path.replace('\\', "/").split('/').any(|part| part == "..")
}

fn normalize_windows_absolute_path(path: &str) -> String {
    let normalized = path.trim().replace('\\', "/");
    let drive = &normalized[..2];
    let tail = normalized[3..]
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect::<Vec<_>>()
        .join("\\");
    if tail.is_empty() {
        format!("{}\\", drive)
    } else {
        format!("{}\\{}", drive, tail)
    }
}

pub fn normalize_idle_song_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return DEFAULT_IDLE_SONG_PATH.to_string();
    }
    if media_path::is_windows_absolute_path(trimmed) {
        return normalize_windows_absolute_path(trimmed);
    }

    let normalized = trimmed
        .replace('\\', "/")
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect::<Vec<_>>()
        .join("/");
    if normalized.is_empty() {
        DEFAULT_IDLE_SONG_PATH.to_string()
    } else {
        normalized
    }
}

/// Validate and normalize a configured idle-song directory.
/// Legacy relative paths remain supported. New absolute Windows paths must stay
/// inside one of the configured media roots so `/media/*` URLs remain safe.
pub fn validate_idle_song_path(path: &str, media_root: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if contains_parent_segment(trimmed) {
        return Err("空闲歌曲路径不能包含 ..".to_string());
    }

    if media_path::is_windows_absolute_path(trimmed) {
        let normalized = normalize_windows_absolute_path(trimmed);
        if media_path::relativize_against_roots(&normalized, media_root).is_none() {
            return Err("空闲歌曲路径必须位于已配置的媒体根目录内".to_string());
        }
        return Ok(normalized);
    }

    let normalized = trimmed.replace('\\', "/");
    if normalized.starts_with('/') || normalized.split('/').any(|part| part.contains(':')) {
        return Err("空闲歌曲路径必须位于已配置的媒体根目录内".to_string());
    }

    Ok(normalize_idle_song_path(&normalized))
}

/// Convert a configured absolute or legacy relative idle directory into the
/// relative path used by the public `/media/*` route.
pub fn idle_song_public_path(media_root: &str, idle_song_path: &str) -> Option<String> {
    let normalized = normalize_idle_song_path(idle_song_path);
    if media_path::is_windows_absolute_path(&normalized) {
        media_path::relativize_against_roots(&normalized, media_root)
    } else {
        Some(media_path::normalize_relative_path(&normalized))
    }
}

pub fn is_idle_media_ext(ext: &str) -> bool {
    let ext = ext.to_ascii_lowercase();
    IDLE_MEDIA_EXTS.contains(&ext.as_str())
}

fn natural_sort_key(value: &str) -> String {
    let mut result = String::with_capacity(value.len() * 2);
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch.is_ascii_digit() {
            let mut number = ch.to_string();
            while chars.peek().is_some_and(|next| next.is_ascii_digit()) {
                number.push(chars.next().expect("peeked digit must exist"));
            }
            result.push_str(&format!("{:0>20}", number));
        } else {
            result.extend(ch.to_lowercase());
        }
    }
    result
}

async fn scan_directory_recursive(base_dir: &Path) -> std::io::Result<Vec<String>> {
    let mut pending = VecDeque::from([base_dir.to_path_buf()]);
    let mut files = Vec::new();

    while let Some(directory) = pending.pop_front() {
        let mut entries = match tokio::fs::read_dir(&directory).await {
            Ok(entries) => entries,
            Err(error) if directory == base_dir => return Err(error),
            Err(error) => {
                tracing::warn!(
                    "[idle-scan] nested directory unavailable: path={}, error={}",
                    directory.display(),
                    error
                );
                continue;
            }
        };

        while let Some(entry) = entries.next_entry().await? {
            let file_type = match entry.file_type().await {
                Ok(file_type) => file_type,
                Err(error) => {
                    tracing::warn!(
                        "[idle-scan] failed to inspect entry: path={}, error={}",
                        entry.path().display(),
                        error
                    );
                    continue;
                }
            };
            if file_type.is_dir() {
                pending.push_back(entry.path());
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            let path = entry.path();
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if !is_idle_media_ext(extension) {
                continue;
            }

            let Ok(relative_path) = path.strip_prefix(base_dir) else {
                continue;
            };
            let relative_path = relative_path.to_string_lossy().replace('\\', "/");
            if !relative_path.is_empty() {
                files.push(relative_path);
            }
        }
    }

    files.sort_by(|left, right| {
        natural_sort_key(left)
            .cmp(&natural_sort_key(right))
            .then_with(|| left.cmp(right))
    });
    files.dedup();
    Ok(files)
}

async fn scan_one_directory(full_dir: &Path, result: &mut IdleMediaScan) -> bool {
    result
        .scanned_dirs
        .push(full_dir.to_string_lossy().to_string());

    match scan_directory_recursive(full_dir).await {
        Ok(files) if files.is_empty() => {
            tracing::info!(
                "[idle-scan] directory scanned but no media found: path={}",
                full_dir.display()
            );
            false
        }
        Ok(files) => {
            tracing::info!(
                "[idle-scan] directory scanned recursively: path={}, found_count={}",
                full_dir.display(),
                files.len()
            );
            result.files = files;
            true
        }
        Err(error) => {
            tracing::warn!(
                "[idle-scan] directory unavailable: path={}, error={}",
                full_dir.display(),
                error
            );
            false
        }
    }
}

/// Scan the configured idle directory and return file paths relative to it.
/// Absolute paths are scanned directly once; legacy relative paths are checked
/// against each configured media root in order.
pub async fn scan_idle_media(media_root: &str, idle_song_path: &str) -> IdleMediaScan {
    let idle_song_path = normalize_idle_song_path(idle_song_path);
    let mut result = IdleMediaScan::default();

    if media_path::is_windows_absolute_path(&idle_song_path) {
        if idle_song_public_path(media_root, &idle_song_path).is_none() {
            tracing::warn!(
                "[idle-scan] absolute idle path is outside configured media roots: path={}",
                idle_song_path
            );
            return result;
        }
        scan_one_directory(Path::new(&idle_song_path), &mut result).await;
        return result;
    }

    for root in media_path::split_media_roots(media_root) {
        let full_dir = Path::new(&root).join(&idle_song_path);
        if scan_one_directory(&full_dir, &mut result).await {
            break;
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_relative_idle_song_paths() {
        assert_eq!(
            validate_idle_song_path("  HVideo_Admin_Portable_0.2.0\\freesongs/  ", "D:/"),
            Ok("HVideo_Admin_Portable_0.2.0/freesongs".to_string())
        );
        assert_eq!(
            validate_idle_song_path("", "D:/"),
            Ok(DEFAULT_IDLE_SONG_PATH.to_string())
        );
    }

    #[test]
    fn validates_absolute_path_inside_media_root() {
        assert_eq!(
            validate_idle_song_path("D:/HVIDEO/Hvideo_server/freesongs/", "D:/"),
            Ok("D:\\HVIDEO\\Hvideo_server\\freesongs".to_string())
        );
        assert_eq!(
            idle_song_public_path("D:/", "D:\\HVIDEO\\Hvideo_server\\freesongs"),
            Some("HVIDEO/Hvideo_server/freesongs".to_string())
        );
    }

    #[test]
    fn rejects_paths_outside_media_roots_and_parent_segments() {
        assert!(validate_idle_song_path("E:/freesongs", "D:/").is_err());
        assert!(validate_idle_song_path("../freesongs", "D:/").is_err());
        assert!(validate_idle_song_path("D:/media/../outside", "D:/media").is_err());
        assert!(validate_idle_song_path("/freesongs", "D:/").is_err());
    }

    #[tokio::test]
    async fn recursively_scans_supported_media_and_returns_relative_paths() {
        let temp = tempfile::tempdir().expect("tempdir");
        let idle_dir = temp.path().join("public").join("freesongs");
        tokio::fs::create_dir_all(idle_dir.join("nested"))
            .await
            .expect("create nested directory");
        tokio::fs::write(idle_dir.join("video10.mp4"), b"10")
            .await
            .expect("write video10");
        tokio::fs::write(idle_dir.join("video2.MKV"), b"2")
            .await
            .expect("write video2");
        tokio::fs::write(idle_dir.join("video3.HVIDEO"), b"encrypted")
            .await
            .expect("write encrypted video");
        tokio::fs::write(idle_dir.join("nested").join("clip1.ts"), b"1")
            .await
            .expect("write nested clip");
        tokio::fs::write(idle_dir.join("nested").join("ignore.txt"), b"no")
            .await
            .expect("write ignored file");

        let scan =
            scan_idle_media(temp.path().to_string_lossy().as_ref(), "public/freesongs").await;

        assert_eq!(
            scan.files,
            vec!["nested/clip1.ts", "video2.MKV", "video3.HVIDEO", "video10.mp4"]
        );
        assert_eq!(scan.scanned_dirs.len(), 1);
    }

    #[tokio::test]
    async fn scans_an_absolute_idle_directory_once() {
        let root = tempfile::tempdir().expect("root");
        let idle_dir = root.path().join("freesongs");
        tokio::fs::create_dir_all(&idle_dir)
            .await
            .expect("create freesongs");
        tokio::fs::write(idle_dir.join("idle.mp4"), b"media")
            .await
            .expect("write idle media");

        let scan = scan_idle_media(
            root.path().to_string_lossy().as_ref(),
            idle_dir.to_string_lossy().as_ref(),
        )
        .await;

        assert_eq!(scan.files, vec!["idle.mp4"]);
        assert_eq!(scan.scanned_dirs.len(), 1);
    }

    #[tokio::test]
    async fn continues_to_later_root_when_first_existing_directory_is_empty() {
        let empty_root = tempfile::tempdir().expect("empty root");
        let populated_root = tempfile::tempdir().expect("populated root");
        tokio::fs::create_dir_all(empty_root.path().join("freesongs"))
            .await
            .expect("create empty freesongs");
        tokio::fs::create_dir_all(populated_root.path().join("freesongs"))
            .await
            .expect("create populated freesongs");
        tokio::fs::write(
            populated_root.path().join("freesongs").join("public.mp4"),
            b"media",
        )
        .await
        .expect("write public media");

        let roots = format!(
            "{};{}",
            empty_root.path().display(),
            populated_root.path().display()
        );
        let scan = scan_idle_media(&roots, "freesongs").await;

        assert_eq!(scan.files, vec!["public.mp4"]);
        assert_eq!(scan.scanned_dirs.len(), 2);
    }
}
