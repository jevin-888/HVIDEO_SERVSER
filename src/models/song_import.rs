use serde::Serialize;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SongImportTask {
    #[sqlx(rename = "taskId")]
    pub task_id: String,
    #[sqlx(rename = "sourcePath")]
    pub file_name: String,
    pub status: String,
    #[sqlx(rename = "totalCount")]
    pub total_count: i64,
    #[sqlx(rename = "processedCount")]
    pub processed_count: i64,
    #[sqlx(rename = "importedCount")]
    pub imported_count: i64,
    #[sqlx(rename = "insertedCount")]
    pub inserted_count: i64,
    #[sqlx(rename = "updatedCount")]
    pub updated_count: i64,
    #[sqlx(rename = "skippedCount")]
    pub skipped_count: i64,
    #[sqlx(rename = "failedCount")]
    pub failed_count: i64,
    #[sqlx(rename = "currentRow")]
    pub current_row: i64,
    #[sqlx(rename = "startedTime")]
    pub started_time: Option<i64>,
    #[sqlx(rename = "finishedTime")]
    pub finished_time: Option<i64>,
    #[sqlx(rename = "errorMessage")]
    pub error_message: Option<String>,
}
