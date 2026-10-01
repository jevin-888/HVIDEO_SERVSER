use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::errors::AppResult;
use crate::models::common::ApiResponse;
use crate::AppState;

const PAD_ORDERING_ENABLED_KEY: &str = "pad_ordering.enabled";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PadOrderingStatus {
    pub enabled: bool,
}

fn parse_enabled(value: Option<&str>) -> bool {
    value
        .and_then(|raw| serde_json::from_str::<bool>(raw).ok())
        .unwrap_or(false)
}

async fn load_enabled(state: &AppState) -> AppResult<bool> {
    let value = sqlx::query_scalar::<_, String>("SELECT value FROM system_settings WHERE key = ?")
        .bind(PAD_ORDERING_ENABLED_KEY)
        .fetch_optional(&state.db)
        .await?;

    Ok(parse_enabled(value.as_deref()))
}

/// GET /api/v1/pad-ordering/status
///
/// PAD ordering is a global feature flag and defaults to disabled.
pub async fn get_status(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<PadOrderingStatus>>> {
    Ok(Json(ApiResponse::success(PadOrderingStatus {
        enabled: load_enabled(&state).await?,
    })))
}

/// PUT /api/v1/admin/pad-ordering/status
pub async fn update_status(
    State(state): State<AppState>,
    Json(status): Json<PadOrderingStatus>,
) -> AppResult<Json<ApiResponse<PadOrderingStatus>>> {
    sqlx::query(
        "INSERT INTO system_settings (key, value, updatedAt) VALUES (?, ?, datetime('now','localtime')) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt",
    )
    .bind(PAD_ORDERING_ENABLED_KEY)
    .bind(if status.enabled { "true" } else { "false" })
    .execute(&state.db)
    .await?;

    Ok(Json(ApiResponse::success(status)))
}

#[cfg(test)]
mod tests {
    #[test]
    fn invalid_or_missing_value_defaults_to_disabled() {
        assert!(!super::parse_enabled(None));
        assert!(!super::parse_enabled(Some("invalid")));
        assert!(!super::parse_enabled(Some("false")));
        assert!(super::parse_enabled(Some("true")));
    }
}
