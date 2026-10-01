/// 歌曲编号候选提取器。
///
/// 文件名中的完整 ASCII 字母数字编号优先，纯数字片段仅作为回退候选。
use std::path::Path;

use crate::utils::media_path;

/// 从受支持的视频文件名中提取可能的 songNo，候选顺序即匹配优先级。
///
/// 支持示例：
/// - `12345.mp4` -> `12345`
/// - `YN139029.mp4` -> `YN139029`, `139029`
/// - `20690YHD.mp4` -> `20690YHD`, `20690`
/// - `[20690YHD]歌名.mkv` -> `20690YHD`, `20690`
/// - `20690YHD_歌名.avi` -> `20690YHD`, `20690`
/// - `song_20690YHD.mp4` -> `20690YHD`, `20690`
pub fn extract_song_no_candidates(file_name: &str) -> Vec<String> {
    let path = Path::new(file_name);
    let extension = match path.extension().and_then(|value| value.to_str()) {
        Some(extension) if media_path::is_supported_media_extension(extension) => extension,
        _ => return Vec::new(),
    };
    let stem = &file_name[..file_name.len() - extension.len() - 1];
    if stem.is_empty() {
        return Vec::new();
    }

    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in stem.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch);
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }

    let mut candidates = Vec::new();

    // 先保留完整字母数字编号，防止 YN139029/20690YHD 被错误降级成纯数字。
    for token in &tokens {
        if is_song_no_token(token) {
            push_candidate(&mut candidates, token);
            let uppercase = token.to_ascii_uppercase();
            if uppercase != *token {
                push_candidate(&mut candidates, &uppercase);
            }
        }
    }

    // 再加入每个编号内的连续数字，兼容历史纯数字 songNo。
    for token in &tokens {
        let mut digits = String::new();
        for ch in token.chars() {
            if ch.is_ascii_digit() {
                digits.push(ch);
            } else if !digits.is_empty() {
                push_candidate(&mut candidates, &digits);
                digits.clear();
            }
        }
        if !digits.is_empty() {
            push_candidate(&mut candidates, &digits);
        }
    }

    candidates
}

fn is_song_no_token(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|ch| ch.is_ascii_alphanumeric())
        && value.chars().any(|ch| ch.is_ascii_digit())
}

fn push_candidate(candidates: &mut Vec<String>, candidate: &str) {
    if !candidate.is_empty() && !candidates.iter().any(|value| value == candidate) {
        candidates.push(candidate.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_numeric_song_no() {
        assert_eq!(extract_song_no_candidates("12345.mp4"), vec!["12345"]);
    }

    #[test]
    fn prioritizes_alpha_prefix_song_no() {
        assert_eq!(
            extract_song_no_candidates("YN139029.mp4"),
            vec!["YN139029", "139029"]
        );
    }

    #[test]
    fn prioritizes_alpha_suffix_song_no() {
        assert_eq!(
            extract_song_no_candidates("20690YHD.mp4"),
            vec!["20690YHD", "20690"]
        );
    }

    #[test]
    fn supports_common_wrapped_names() {
        assert_eq!(
            extract_song_no_candidates("[20690YHD]歌名.mkv"),
            vec!["20690YHD", "20690"]
        );
        assert_eq!(
            extract_song_no_candidates("20690YHD_歌名.avi"),
            vec!["20690YHD", "20690"]
        );
        assert_eq!(
            extract_song_no_candidates("song_20690YHD.mp4"),
            vec!["20690YHD", "20690"]
        );
    }

    #[test]
    fn adds_uppercase_database_candidate() {
        assert_eq!(
            extract_song_no_candidates("yn139029.MP4"),
            vec!["yn139029", "YN139029", "139029"]
        );
    }

    #[test]
    fn supports_mixed_alphanumeric_song_no() {
        assert_eq!(
            extract_song_no_candidates("Y1N23.flv"),
            vec!["Y1N23", "1", "23"]
        );
    }

    #[test]
    fn rejects_non_media_and_names_without_digits() {
        assert!(extract_song_no_candidates("12345.txt").is_empty());
        assert!(extract_song_no_candidates("unknown.mp4").is_empty());
        assert!(extract_song_no_candidates(".mp4").is_empty());
    }
}
