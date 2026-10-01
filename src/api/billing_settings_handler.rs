use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::errors::{AppError, AppResult};
use crate::models::common::ApiResponse;
use crate::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BillingBaseSettingRow {
    pub key: String,
    pub value: String,
    pub updatedAt: String,
}

#[derive(Debug, Serialize)]
pub struct BillingBaseSetting {
    pub key: String,
    pub value: Value,
    pub updatedAt: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBillingBaseSettingRequest {
    pub value: Value,
}

fn allowed_setting_key(key: &str) -> bool {
    matches!(
        key,
        "business_hours"
            | "room_type_rates"
            | "buyout_periods"
            | "activity_rules"
            | "package_configs"
            | "room_type_gifts"
            | "holiday_dates"
            | "trial_singing"
            | "store_info"
    )
}

fn parse_setting(row: BillingBaseSettingRow) -> BillingBaseSetting {
    BillingBaseSetting {
        key: row.key,
        value: serde_json::from_str(&row.value).unwrap_or_else(|_| json!(null)),
        updatedAt: row.updatedAt,
    }
}

pub async fn list_billing_base_settings(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<BillingBaseSetting>>>> {
    let rows = sqlx::query_as::<_, BillingBaseSettingRow>(
        "SELECT key, value, updatedAt FROM billing_base_settings ORDER BY key",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(
        rows.into_iter().map(parse_setting).collect(),
    )))
}

pub async fn get_billing_base_setting(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> AppResult<Json<ApiResponse<BillingBaseSetting>>> {
    if !allowed_setting_key(&key) {
        return Err(AppError::BadRequest("不支持的基础设置项".to_string()));
    }
    let row = sqlx::query_as::<_, BillingBaseSettingRow>(
        "SELECT key, value, updatedAt FROM billing_base_settings WHERE key = ?",
    )
    .bind(&key)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("基础设置不存在".to_string()))?;
    Ok(Json(ApiResponse::success(parse_setting(row))))
}

pub async fn update_billing_base_setting(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<UpdateBillingBaseSettingRequest>,
) -> AppResult<Json<ApiResponse<BillingBaseSetting>>> {
    if !allowed_setting_key(&key) {
        return Err(AppError::BadRequest("不支持的基础设置项".to_string()));
    }
    let value = serde_json::to_string(&req.value).map_err(|e| AppError::Internal(e.into()))?;
    sqlx::query(
        "INSERT INTO billing_base_settings (key, value, updatedAt) VALUES (?, ?, datetime('now','localtime')) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now','localtime')"
    )
    .bind(&key)
    .bind(value)
    .execute(&state.db)
    .await?;
    get_billing_base_setting(State(state), Path(key)).await
}
