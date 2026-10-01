use std::path::Path;

const MEDIA_EXTENSIONS: &[&str] = &[
    "hvideo", "mp4", "mkv", "avi", "mov", "flv", "wmv", "m4v", "mpg", "mpeg", "vob", "dat", "ts",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaPathParts {
    pub absolutePath: String,
    pub relativePath: String,
    pub fileName: String,
    pub public_url: String,
}

pub fn normalize_slashes(path: &str) -> String {
    path.trim().replace('\\', "/")
}

pub fn normalize_relative_path(path: &str) -> String {
    normalize_slashes(path).trim_start_matches('/').to_string()
}

pub fn is_windows_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
}

pub fn is_http_url(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

pub fn is_supported_media_extension(extension: &str) -> bool {
    MEDIA_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
}

pub fn is_media_file_path(path: &str) -> bool {
    let normalized = normalize_slashes(path);
    Path::new(&normalized)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(is_supported_media_extension)
        .unwrap_or(false)
}

pub fn fileName(path: &str) -> String {
    Path::new(&normalize_slashes(path))
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string()
}

pub fn split_media_roots(roots_raw: &str) -> Vec<String> {
    roots_raw
        .split(';')
        .map(|root| normalize_slashes(root).trim_end_matches('/').to_string())
        .filter(|root| !root.is_empty())
        .collect()
}

pub fn relativize_against_roots(path: &str, roots_raw: &str) -> Option<String> {
    let normalized = normalize_slashes(path);
    if !is_windows_absolute_path(&normalized) {
        return Some(normalize_relative_path(&normalized));
    }

    let path_lower = normalized.to_lowercase();
    for root in split_media_roots(roots_raw) {
        let root_lower = root.to_lowercase();
        if path_lower == root_lower {
            return Some(String::new());
        }
        let prefix = format!("{}/", root_lower);
        if path_lower.starts_with(&prefix) {
            return Some(normalize_relative_path(&normalized[root.len()..]));
        }
    }
    None
}

pub fn join_path_and_file(path: &str, fileName: &str) -> String {
    let path = normalize_slashes(path).trim_end_matches('/').to_string();
    let fileName = normalize_slashes(fileName)
        .trim_start_matches('/')
        .to_string();
    if path.is_empty() {
        fileName
    } else if fileName.is_empty() || is_media_file_path(&path) {
        path
    } else {
        format!("{}/{}", path, fileName)
    }
}

pub fn public_media_url_from_relative(relativePath: &str) -> String {
    let relative = normalize_relative_path(relativePath);
    if relative.is_empty() {
        "/media/".to_string()
    } else {
        format!("/media/{}", relative)
    }
}

pub fn public_media_url(path: &str, media_roots_raw: &str) -> String {
    let normalized = normalize_slashes(path);
    if is_http_url(&normalized) || normalized.starts_with("/media/") {
        return normalized;
    }
    if let Some(relative) = relativize_against_roots(&normalized, media_roots_raw) {
        return public_media_url_from_relative(&relative);
    }
    format!(
        "/media/{}",
        normalize_relative_path(&normalized.replace(':', "%3A"))
    )
}

pub fn build_parts(absolutePath: &str, media_roots_raw: &str) -> MediaPathParts {
    let absolutePath = normalize_slashes(absolutePath);
    let relativePath = relativize_against_roots(&absolutePath, media_roots_raw)
        .unwrap_or_else(|| normalize_relative_path(&absolutePath));
    let fileName = fileName(&absolutePath);
    let public_url = public_media_url_from_relative(&relativePath);
    MediaPathParts {
        absolutePath,
        relativePath,
        fileName,
        public_url,
    }
}
