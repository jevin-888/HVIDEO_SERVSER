use axum::{
    extract::{Path, Query, State},
    http::{header::CONTENT_TYPE, StatusCode},
    response::IntoResponse,
    Json,
};

use crate::errors::AppResult;
use crate::models::artist::*;
use crate::models::common::ApiResponse;
use crate::services::artist_service::ArtistService;
use crate::AppState;

/// GET /api/v1/artists - 查询歌星列表
pub async fn list_artists(
    State(state): State<AppState>,
    Query(query): Query<ArtistQuery>,
) -> AppResult<Json<ApiResponse<PaginatedResult<Artist>>>> {
    let result = ArtistService::list(&state.db, query).await?;
    Ok(Json(ApiResponse::success(result)))
}

/// POST /api/v1/artists - 创建歌星
pub async fn create_artist(
    State(state): State<AppState>,
    Json(req): Json<CreateArtistRequest>,
) -> AppResult<Json<ApiResponse<Artist>>> {
    let artist = ArtistService::create(&state.db, req).await?;
    Ok(Json(ApiResponse::success(artist)))
}

/// GET /api/v1/artists/:id - 获取单个歌星
pub async fn get_artist(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<Artist>>> {
    let artist = ArtistService::get_by_id(&state.db, &id).await?;
    Ok(Json(ApiResponse::success(artist)))
}

/// PUT /api/v1/artists/:id - 更新歌星
pub async fn update_artist(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateArtistRequest>,
) -> AppResult<Json<ApiResponse<Artist>>> {
    let artist = ArtistService::update(&state.db, &id, req).await?;
    Ok(Json(ApiResponse::success(artist)))
}

/// DELETE /api/v1/artists/:id - 删除歌星
pub async fn delete_artist(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    ArtistService::delete(&state.db, &id).await?;
    Ok(Json(ApiResponse::success(())))
}

/// 歌星图片目录（相对运行目录）：与前端约定一致，对应 D:\Hvideo_server\static\singer-all
const SINGER_IMAGE_DIR: &str = "static/singer-all";
const IMAGE_EXTENSIONS: &[(&str, &str)] = &[
    (".jpg", "image/jpeg"),
    (".jpeg", "image/jpeg"),
    (".png", "image/png"),
    (".gif", "image/gif"),
];

/// GET /api/v1/artists/:id/image - 获取歌星图片（从 static/singer-all 读取，触摸屏/前端使用）
pub async fn get_artist_image(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if id.is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
        return (StatusCode::BAD_REQUEST, "invalid id").into_response();
    }
    if let Some(response) = read_singer_image(&id).await {
        return response;
    }
    if let Ok(Some(singer_id)) =
        sqlx::query_scalar::<_, i64>("SELECT singerId FROM singers WHERE singerNo = ? LIMIT 1")
            .bind(&id)
            .fetch_optional(&state.song_db)
            .await
    {
        if let Some(response) = read_singer_image(&singer_id.to_string()).await {
            return response;
        }
    }
    (StatusCode::NOT_FOUND, "歌星图片不存在").into_response()
}

async fn read_singer_image(id: &str) -> Option<axum::response::Response> {
    for (ext, mime) in IMAGE_EXTENSIONS {
        let path = std::path::Path::new(SINGER_IMAGE_DIR).join(format!("{}{}", id, ext));
        if path.exists() {
            match tokio::fs::read(&path).await {
                Ok(data) => {
                    let mut res = axum::response::Response::new(axum::body::Body::from(data));
                    res.headers_mut()
                        .insert(CONTENT_TYPE, axum::http::HeaderValue::from_static(mime));
                    return Some(res);
                }
                Err(e) => {
                    tracing::warn!("读取歌星图片失败 {}: {}", path.display(), e);
                }
            }
        }
    }
    None
}
