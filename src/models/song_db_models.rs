use serde::{Deserialize, Serialize};

pub use crate::models::common::PagedResponse as SongSearchResult;
pub use crate::models::common::PagedResponse as SingerSearchResult;
pub use crate::models::common::PagedResponse as PaginatedResult;

/// 歌曲条目 — 对齐当前 song.db 的 songs 表字段
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SongEntry {
    #[sqlx(rename = "songId")]
    #[serde(rename = "songId")]
    pub songId: Option<i64>,
    #[sqlx(rename = "songNo")]
    #[serde(rename = "songNo")]
    pub songNo: Option<String>,
    #[sqlx(rename = "songName")]
    #[serde(rename = "songName")]
    pub songName: Option<String>,
    #[sqlx(rename = "songNameNoSpace")]
    #[serde(rename = "songNameNoSpace")]
    pub song_name_no_space: Option<String>,
    #[sqlx(rename = "initialKey")]
    #[serde(rename = "initialKey")]
    pub initialKey: Option<String>,
    pub track: Option<i32>,
    #[sqlx(rename = "scoreEnabled")]
    #[serde(rename = "scoreEnabled")]
    pub score_enabled: Option<i32>,
    #[sqlx(rename = "categoryCode")]
    #[serde(rename = "categoryCode")]
    pub categoryCode: Option<String>,
    #[sqlx(rename = "categoryName")]
    #[serde(rename = "categoryName")]
    pub categoryName: Option<String>,
    #[sqlx(rename = "lightCode")]
    #[serde(rename = "lightCode")]
    pub light_code: Option<String>,
    #[sqlx(rename = "languageCode")]
    #[serde(rename = "languageCode")]
    pub languageCode: Option<String>,
    #[sqlx(rename = "languageName")]
    #[serde(rename = "languageName")]
    pub language_name: Option<String>,
    #[sqlx(rename = "versionName")]
    #[serde(rename = "versionName")]
    pub version_name: Option<String>,
    #[sqlx(rename = "clickTime")]
    #[serde(rename = "clickTime")]
    pub clickTime: Option<i64>,
    #[sqlx(rename = "videoFileType")]
    #[serde(rename = "videoFileType")]
    pub video_file_type: Option<String>,
    #[sqlx(rename = "primarySingerNo")]
    #[serde(rename = "primarySingerNo")]
    pub primarySingerNo: Option<String>,
    #[sqlx(rename = "primarySingerName")]
    #[serde(rename = "primarySingerName")]
    pub primarySingerName: Option<String>,
    #[sqlx(rename = "singerNames")]
    #[serde(rename = "singerNames")]
    pub singerNames: Option<String>,
    #[sqlx(rename = "relativePath")]
    #[serde(rename = "relativePath")]
    pub relativePath: Option<String>,
    #[sqlx(rename = "fileName")]
    #[serde(rename = "fileName")]
    pub fileName: Option<String>,
    #[sqlx(rename = "absolutePath")]
    #[serde(rename = "absolutePath")]
    pub absolutePath: Option<String>,
}

/// 歌星条目 — 对齐当前 song.db 的 singers 表字段
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SingerEntry {
    #[sqlx(rename = "singerId")]
    #[serde(rename = "singerId")]
    pub singer_id: Option<i64>,
    #[sqlx(rename = "singerNo")]
    #[serde(rename = "singerNo")]
    pub singer_no: Option<String>,
    #[sqlx(rename = "singerName")]
    #[serde(rename = "singerName")]
    pub singer_name: Option<String>,
    #[sqlx(rename = "initialKey")]
    #[serde(rename = "initialKey")]
    pub initialKey: Option<String>,
    #[sqlx(rename = "regionCode")]
    #[serde(rename = "regionCode")]
    pub region_code: Option<String>,
    #[sqlx(rename = "regionName")]
    #[serde(rename = "regionName")]
    pub region_name: Option<String>,
    pub hit: Option<i32>,
    #[sqlx(rename = "sexCode")]
    #[serde(rename = "sexCode")]
    pub sex_code: Option<String>,
    #[sqlx(rename = "sexName")]
    #[serde(rename = "sexName")]
    pub sex_name: Option<String>,
}

/// 字典条目 — 对齐当前 song.db 的 dicts 表字段
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DictEntry {
    #[sqlx(rename = "dictGroup")]
    #[serde(rename = "dictGroup")]
    pub dict_group: Option<String>,
    #[sqlx(rename = "dictCode")]
    #[serde(rename = "dictCode")]
    pub dict_code: Option<String>,
    #[sqlx(rename = "dictName")]
    #[serde(rename = "dictName")]
    pub dict_name: Option<String>,
    pub visible: Option<i32>,
    #[sqlx(rename = "sortOrder")]
    #[serde(rename = "sortOrder")]
    pub sortOrder: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpsertDictRequest {
    pub dict_code: String,
    pub dict_name: String,
    pub visible: Option<i32>,
    pub sortOrder: Option<i32>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictImportResult {
    pub total_count: usize,
    pub inserted_count: usize,
    pub updated_count: usize,
    pub unchanged_count: usize,
}

/// 歌曲搜索参数。默认按 clickTime 降序、songNo 升序，新歌分类按 addedTime 排序。
#[derive(Debug, Deserialize)]
pub struct SongSearchQuery {
    pub keyword: Option<String>,
    #[serde(rename = "searchMode")]
    pub search_mode: Option<String>,
    /// 歌曲编号的字面前缀，与语言和关键词筛选独立组合。
    #[serde(rename = "songNoPrefix")]
    pub song_no_prefix: Option<String>,
    #[serde(rename = "languageCode")]
    pub languageCode: Option<String>,
    pub initial: Option<String>,
    #[serde(rename = "primarySingerNo")]
    pub primarySingerNo: Option<String>,
    #[serde(rename = "categoryCode")]
    pub categoryCode: Option<String>,
    /// 热门歌曲筛选，true 时仅返回 is_hot=1
    #[serde(rename = "isHot")]
    pub is_hot: Option<bool>,
    #[serde(rename = "availableOnly")]
    pub available_only: Option<bool>,
    pub page: Option<u32>,
    #[serde(rename = "pageSize")]
    pub page_size: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct SongDetailQuery {
    #[serde(rename = "availableOnly")]
    pub available_only: Option<bool>,
}

/// 歌星搜索参数
#[derive(Debug, Deserialize)]
pub struct SingerSearchQuery {
    pub keyword: Option<String>,
    #[serde(rename = "regionCode")]
    pub region_code: Option<String>,
    #[serde(rename = "sexCode")]
    pub sex_code: Option<String>,
    pub initial: Option<String>,
    pub page: Option<u32>,
    #[serde(rename = "pageSize")]
    pub page_size: Option<u32>,
}

/// 创建歌曲请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSongRequest {
    pub songNo: String,
    pub songName: String,
    pub primarySingerNo: Option<String>,
    pub primarySingerName: Option<String>,
    pub singerNames: Option<String>,
    pub languageCode: Option<String>,
    pub categoryCode: Option<String>,
    pub relativePath: Option<String>,
    pub fileName: Option<String>,
    pub absolutePath: Option<String>,
    pub video_file_type: Option<String>,
    pub track: Option<i32>,
    pub initialKey: Option<String>,
}

/// 更新歌曲请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSongRequest {
    pub songName: Option<String>,
    pub primarySingerNo: Option<String>,
    pub primarySingerName: Option<String>,
    pub singerNames: Option<String>,
    pub languageCode: Option<String>,
    pub categoryCode: Option<String>,
    pub relativePath: Option<String>,
    pub fileName: Option<String>,
    pub absolutePath: Option<String>,
    pub video_file_type: Option<String>,
    pub track: Option<i32>,
    pub initialKey: Option<String>,
    /// Requested display value from the editor. The service still derives the
    /// stored value from the actual encrypted media and never trusts this flag.
    pub scoreEnabled: Option<i32>,
}

/// 创建歌星请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSingerRequest {
    pub singer_no: String,
    pub singer_name: String,
    pub region_code: Option<String>,
    pub sex_code: Option<String>,
}

/// 更新歌星请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSingerRequest {
    pub singer_name: Option<String>,
    pub region_code: Option<String>,
    pub sex_code: Option<String>,
}

/// 统计数据
#[derive(Debug, Serialize)]
pub struct SongDbStats {
    pub total_songs: i64,
    pub total_singers: i64,
    pub total_languages: i64,
}
