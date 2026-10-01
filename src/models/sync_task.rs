use serde::{Deserialize, Serialize};

pub const SYNC_STATUS_PENDING: i32 = 0;
pub const SYNC_STATUS_RUNNING: i32 = 1;
pub const SYNC_STATUS_COMPLETED: i32 = 2;
pub const SYNC_STATUS_FAILED: i32 = 3;

/// 云端同步任务。数据库列沿用历史命名，HTTP JSON 统一使用 camelCase。
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SyncTask {
    pub id: String,
    #[sqlx(rename = "taskType")]
    pub task_type: String,
    #[sqlx(rename = "targetType")]
    pub target_type: String,
    #[sqlx(rename = "targetId")]
    pub target_id: String,
    #[sqlx(rename = "cloud_url")]
    pub cloud_url: String,
    #[sqlx(rename = "localPath")]
    pub local_path: String,
    #[sqlx(rename = "fileSize")]
    pub file_size: i64,
    #[sqlx(rename = "downloaded_size")]
    pub downloaded_size: i64,
    pub status: i32,
    #[sqlx(rename = "retry_count")]
    pub retry_count: i32,
    #[sqlx(rename = "errorMessage")]
    pub error_message: String,
    #[sqlx(rename = "createdAt")]
    pub created_at: String,
    #[sqlx(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchImportRequest {
    pub song_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncTaskQuery {
    pub task_type: Option<String>,
    pub status: Option<i32>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTaskList {
    pub items: Vec<SyncTask>,
    pub total: u64,
    pub page: u32,
    pub page_size: u32,
    pub pending: u64,
    pub running: u64,
    pub completed: u64,
    pub failed: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub configured: bool,
    pub reachable: bool,
    pub api_base_url: String,
    pub download_dir: String,
    pub api_key_configured: bool,
    pub importable_song_count: u64,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTriggerResponse {
    pub task_id: String,
    pub status: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_requests_reject_legacy_or_unknown_fields() {
        assert!(serde_json::from_str::<BatchImportRequest>(r#"{"song_ids":["song-1"]}"#,).is_err());
        assert!(serde_json::from_str::<BatchImportRequest>(
            r#"{"songIds":["song-1"],"song_ids":["song-2"]}"#,
        )
        .is_err());
        assert!(serde_json::from_str::<SyncTaskQuery>(r#"{"page":1,"page_size":20}"#,).is_err());
        assert!(serde_json::from_str::<BatchImportRequest>(r#"{"songIds":["song-1"]}"#,).is_ok());
    }
}
