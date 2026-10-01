use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingerImageMatchTask {
    pub task_id: String,
    pub directory: String,
    pub overwrite: bool,
    pub status: SingerImageMatchStatus,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub progress: SingerImageMatchProgress,
    pub result: Option<SingerImageMatchResult>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SingerImageMatchStatus {
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingerImageMatchProgress {
    pub scanned_files: u64,
    pub matched_singers: u64,
    pub copied_images: u64,
    pub current_directory: String,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingerImageMatchResult {
    pub total_files_scanned: u64,
    pub matched_count: u64,
    pub copied_count: u64,
    pub unmatched_count: u64,
    pub missing_singer_count: u64,
    pub unmatched_files: Vec<String>,
    pub errors: Vec<SingerImageMatchError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingerImageMatchError {
    pub file_path: String,
    pub error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartSingerImageMatchRequest {
    pub directory: String,
    #[serde(default)]
    pub overwrite: bool,
}
