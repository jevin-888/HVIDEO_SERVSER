use serde::{Deserialize, Serialize};

pub use crate::models::common::PagedResponse as PaginatedResult;

/// 歌星数据模型
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Artist {
    pub id: String,
    pub name: String,
    pub pinyin: String,
    pub initial: String,
    pub gender: i32,
    pub region: String,
    pub avatar_url: String,
    pub song_count: i32,
    pub status: i32,
    pub createdAt: String,
    pub updatedAt: String,
}

/// 创建歌星请求
#[derive(Debug, Deserialize)]
pub struct CreateArtistRequest {
    pub name: String,
    pub pinyin: Option<String>,
    pub gender: Option<i32>,
    pub region: Option<String>,
    pub avatar_url: Option<String>,
}

/// 更新歌星请求
#[derive(Debug, Deserialize)]
pub struct UpdateArtistRequest {
    pub name: Option<String>,
    pub pinyin: Option<String>,
    pub gender: Option<i32>,
    pub region: Option<String>,
    pub avatar_url: Option<String>,
    pub status: Option<i32>,
}

/// 歌星查询参数
#[derive(Debug, Deserialize)]
pub struct ArtistQuery {
    pub keyword: Option<String>,
    pub initial: Option<String>,
    pub gender: Option<i32>,
    pub region: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}
