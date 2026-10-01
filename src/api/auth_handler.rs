use axum::{extract::State, Json};

use crate::errors::AppResult;
use crate::models::api_client::{AuthRequest, AuthResponse};
use crate::models::common::ApiResponse;
use crate::services::activity_service::ActivityService;
use crate::services::api_client_service::ApiClientService;
use crate::services::auth_service::AuthService;
use crate::AppState;

/// POST /api/v1/auth/login - API 客户端登录获取 Token
pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<AuthRequest>,
) -> AppResult<Json<ApiResponse<AuthResponse>>> {
    let client = ApiClientService::verify(&state.db, &req.clientKey, &req.clientSecret).await?;

    let permissions: Vec<String> = serde_json::from_str(&client.permissions).unwrap_or_default();

    let (token, expireAt) = AuthService::generate_token(
        &state.config.jwt,
        &client.id,
        &client.clientKey,
        permissions,
    )?;

    let detail = format!("{} {} 登录成功", client.clientName, client.clientKey);
    let _ = ActivityService::record(
        &state.db, &client.id, "login", "auth", &client.id, &detail, "",
    )
    .await;

    Ok(Json(ApiResponse::success(AuthResponse { token, expireAt })))
}
