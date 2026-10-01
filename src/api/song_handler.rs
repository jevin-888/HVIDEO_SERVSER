use axum::{
    extract::{Path, Query, State},
    Json,
};

use crate::errors::AppResult;
use crate::models::common::ApiResponse;
use crate::models::song::*;
use crate::services::song_service::SongService;
use crate::AppState;

/// GET /api/v1/songs - 查询歌曲列表
pub async fn list_songs(
    State(state): State<AppState>,
    Query(query): Query<SongQuery>,
) -> AppResult<Json<ApiResponse<PaginatedResult<Song>>>> {
    let result = SongService::list(&state.song_db, query).await?;
    Ok(Json(ApiResponse::success(result)))
}

/// POST /api/v1/songs - 创建歌曲
pub async fn create_song(
    State(state): State<AppState>,
    Json(req): Json<CreateSongRequest>,
) -> AppResult<Json<ApiResponse<Song>>> {
    let song = SongService::create(&state.song_db, req).await?;
    Ok(Json(ApiResponse::success(song)))
}

/// GET /api/v1/songs/:id - 获取单个歌曲
pub async fn get_song(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<Song>>> {
    let song = SongService::get_by_id(&state.song_db, &id).await?;
    Ok(Json(ApiResponse::success(song)))
}

/// PUT /api/v1/songs/:id - 更新歌曲
pub async fn update_song(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateSongRequest>,
) -> AppResult<Json<ApiResponse<Song>>> {
    let song = SongService::update(&state.song_db, &id, req).await?;
    Ok(Json(ApiResponse::success(song)))
}

/// DELETE /api/v1/songs/:id - 删除歌曲
pub async fn delete_song(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    SongService::delete(&state.song_db, &id).await?;
    Ok(Json(ApiResponse::success(())))
}
