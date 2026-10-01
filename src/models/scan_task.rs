use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 扫描任务
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanTask {
    pub task_id: String,
    pub directory: String,
    pub delete_duplicates: bool,
    pub incremental: bool,
    pub status: TaskStatus,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub progress: ScanProgress,
    pub result: Option<ScanResult>,
    pub error_message: Option<String>,
}

/// 任务状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Running,
    Completed,
    Cancelled,
    Failed,
}

/// 扫描进度
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub scanned_files: u64,
    pub matched_songs: u64,
    pub current_directory: String,
    pub percentage: f64,
}

/// 扫描结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub total_files_scanned: u64,
    pub matched_count: u64,
    pub matched_records: Vec<MatchRecord>,
    pub unmatched_files: Vec<UnmatchedFile>,
    pub unrecognized_files: Vec<UnrecognizedFile>,
    pub duplicate_files: Vec<DuplicateInfo>,
    pub errors: Vec<ScanError>,
}

/// 匹配记录（成功写入路径的记录）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchRecord {
    pub songId: String,
    pub filePath: String,
}

/// 未匹配文件（提取了 ID 但数据库中不存在该歌曲）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmatchedFile {
    pub filePath: String,
    pub extracted_id: Option<String>,
    pub reason: String,
}

/// 无法识别文件（文件名不符合已知格式，无法提取 songId）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnrecognizedFile {
    pub filePath: String,
    pub reason: String,
}

/// 重复文件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateInfo {
    pub songId: String,
    pub kept_file: String,
    pub duplicate_files: Vec<String>,
    pub deleted_files: Vec<String>,
}

/// 扫描错误
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanError {
    pub filePath: String,
    pub error: String,
}

/// 启动扫描请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartScanRequest {
    pub directory: String,
    #[serde(default)]
    pub delete_duplicates: bool,
    /// 仅更新本次扫描匹配到的歌曲，保留已有歌曲对照和可用状态。
    #[serde(default)]
    pub incremental: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_request_incremental_is_optional_and_strictly_boolean() {
        let old: StartScanRequest = serde_json::from_value(serde_json::json!({"directory":"D:/"})).unwrap();
        assert!(!old.incremental && !old.delete_duplicates);
        let new: StartScanRequest = serde_json::from_value(serde_json::json!({
            "directory":"E:/new", "incremental":true, "deleteDuplicates":true
        })).unwrap();
        assert!(new.incremental && new.delete_duplicates);
        for invalid in [
            serde_json::json!({"directory":"D:/", "incremental":"true"}),
            serde_json::json!({"directory":"D:/", "incrementalMode":true}),
        ] {
            assert!(serde_json::from_value::<StartScanRequest>(invalid).is_err());
        }
    }

    #[test]
    fn scan_result_json_contract_uses_single_canonical_fields() {
        let result = ScanResult {
            total_files_scanned: 1,
            matched_count: 1,
            matched_records: vec![MatchRecord {
                songId: "20690YHD".to_string(),
                filePath: "D:/music/20690YHD.mp4".to_string(),
            }],
            unmatched_files: Vec::new(),
            unrecognized_files: Vec::new(),
            duplicate_files: vec![DuplicateInfo {
                songId: "20690YHD".to_string(),
                kept_file: "D:/music/20690YHD.mp4".to_string(),
                duplicate_files: vec!["E:/music/20690YHD.mp4".to_string()],
                deleted_files: Vec::new(),
            }],
            errors: Vec::new(),
        };

        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["totalFilesScanned"], 1);
        assert_eq!(value["matchedCount"], 1);
        assert_eq!(value["matchedRecords"][0]["songId"], "20690YHD");
        assert_eq!(
            value["matchedRecords"][0]["filePath"],
            "D:/music/20690YHD.mp4"
        );
        assert!(value.get("total_files_scanned").is_none());
        assert!(value.get("matched_records").is_none());
        assert!(value.get("duplicateFiles").is_some());
        assert!(value.get("duplicate_files").is_none());
        assert!(value["duplicateFiles"][0].get("keptFile").is_some());
        assert!(value["duplicateFiles"][0].get("duplicateFiles").is_some());
        assert!(value["duplicateFiles"][0].get("deletedFiles").is_some());
        assert!(value["duplicateFiles"][0].get("kept_file").is_none());
    }
}
