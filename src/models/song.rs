use serde::{Deserialize, Serialize};

pub use crate::models::common::PagedResponse as PaginatedResult;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Song {
    #[serde(rename = "songId")]
    pub songId: i64,
    #[serde(rename = "songNo")]
    pub songNo: String,
    #[serde(rename = "songName")]
    pub songName: String,
    #[serde(rename = "initialKey")]
    pub initialKey: String,
    #[serde(rename = "primarySingerNo")]
    pub primarySingerNo: String,
    #[serde(rename = "primarySingerName")]
    pub primarySingerName: String,
    #[serde(rename = "singerNames")]
    pub singerNames: String,
    #[serde(rename = "languageCode")]
    pub languageCode: String,
    #[serde(rename = "categoryCode")]
    pub categoryCode: String,
    #[serde(rename = "durationMs")]
    pub durationMs: i64,
    #[serde(rename = "relativePath")]
    pub relativePath: String,
    #[serde(rename = "fileName")]
    pub fileName: String,
    #[serde(rename = "absolutePath")]
    pub absolutePath: String,
    #[serde(rename = "fileSize")]
    pub fileSize: i64,
    #[serde(rename = "clickTime")]
    pub clickTime: i64,
    #[serde(rename = "fileExists")]
    pub fileExists: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSongRequest {
    pub songNo: Option<String>,
    pub songName: String,
    pub initialKey: Option<String>,
    pub primarySingerNo: Option<String>,
    pub primarySingerName: Option<String>,
    pub singerNames: Option<String>,
    pub languageCode: Option<String>,
    pub categoryCode: Option<String>,
    pub relativePath: Option<String>,
    pub fileName: Option<String>,
    pub absolutePath: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSongRequest {
    pub songName: Option<String>,
    pub initialKey: Option<String>,
    pub primarySingerNo: Option<String>,
    pub primarySingerName: Option<String>,
    pub singerNames: Option<String>,
    pub languageCode: Option<String>,
    pub categoryCode: Option<String>,
    pub relativePath: Option<String>,
    pub fileName: Option<String>,
    pub absolutePath: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongQuery {
    pub keyword: Option<String>,
    pub initial: Option<String>,
    pub primarySingerNo: Option<String>,
    pub languageCode: Option<String>,
    pub categoryCode: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}
