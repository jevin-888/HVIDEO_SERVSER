//! 活动日志 API

use axum::{
    extract::{Query, State},
    Json,
};

use crate::errors::AppResult;
use crate::models::common::ApiResponse;
use crate::services::activity_service::{ActivityItem, ActivityService};
use crate::AppState;

#[derive(serde::Deserialize)]
pub struct ListActivitiesQuery {
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_limit() -> u32 {
    20
}

/// GET /api/v1/activities - 获取最近活动
pub async fn list_activities(
    State(state): State<AppState>,
    Query(query): Query<ListActivitiesQuery>,
) -> AppResult<Json<ApiResponse<Vec<ActivityItem>>>> {
    let items = ActivityService::list_recent(&state.db, query.limit).await?;
    Ok(Json(ApiResponse::success(items)))
}

/// DELETE /api/v1/activities - 清空操作日志
pub async fn clear_activities(State(state): State<AppState>) -> AppResult<Json<ApiResponse<()>>> {
    sqlx::query("DELETE FROM operation_logs")
        .execute(&state.db)
        .await?;
    Ok(Json(ApiResponse::success(())))
}
