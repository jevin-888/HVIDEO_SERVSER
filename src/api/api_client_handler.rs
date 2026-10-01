use axum::{
    extract::{Path, State},
    Json,
};

use crate::errors::AppResult;
use crate::models::api_client::*;
use crate::models::common::ApiResponse;
use crate::services::api_client_service::ApiClientService;
use crate::AppState;

/// GET /api/v1/clients - 获取所有 API 客户端
pub async fn list_clients(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<ApiClient>>>> {
    let clients = ApiClientService::list_all(&state.db).await?;
    Ok(Json(ApiResponse::success(clients)))
}

/// POST /api/v1/clients - 注册 API 客户端
pub async fn create_client(
    State(state): State<AppState>,
    Json(req): Json<CreateApiClientRequest>,
) -> AppResult<Json<ApiResponse<ApiClientCreatedResponse>>> {
    let result = ApiClientService::create(&state.db, req).await?;
    Ok(Json(ApiResponse::success(result)))
}

/// PUT /api/v1/clients/:id - 更新 API 客户端
pub async fn update_client(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateApiClientRequest>,
) -> AppResult<Json<ApiResponse<ApiClient>>> {
    let client = ApiClientService::update(&state.db, &id, req).await?;
    Ok(Json(ApiResponse::success(client)))
}

/// DELETE /api/v1/clients/:id - 删除 API 客户端
pub async fn delete_client(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    ApiClientService::delete(&state.db, &id).await?;
    Ok(Json(ApiResponse::success(())))
}
