//! 导航与画面默认配置接口。
//!
//! 这些公开接口给触屏端初始化 SmartL、底部导航和显示布局使用。具体房间状态仍以
//! `/api/v1/rooms/:id/state` 和 WebSocket 推送为准，这里只返回稳定的默认配置，
//! 避免前端拿到空对象后进入未定义状态。

use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::json;

use crate::errors::AppResult;
use crate::models::common::ApiResponse;
use crate::AppState;

const BOTTOM_NAV_KEY: &str = "navigation.bottom";
const DISPLAY_LAYOUT_KEY: &str = "display.layout";
const DISPLAY_STATUS_KEY: &str = "display.status";

fn default_bottom_nav() -> serde_json::Value {
    json!([
        { "id": "home", "name": "首页", "icon": "home", "enabled": true, "active": true },
        { "id": "selected", "name": "已点", "icon": "list", "enabled": true, "active": false },
        { "id": "service", "name": "服务", "icon": "bell", "enabled": true, "active": false },
        { "id": "smart", "name": "智控", "icon": "sliders", "enabled": true, "active": false }
    ])
}

fn default_display_layout() -> serde_json::Value {
    json!({
        "mode": "single",
        "rows": 1,
        "cols": 1,
        "regions": [
            { "id": 1, "x": 0, "y": 0, "width": 1.0, "height": 1.0 }
        ]
    })
}

fn default_display_status() -> serde_json::Value {
    json!({
        "power": true,
        "muted": false,
        "activeRegion": 1,
        "sceneLock": false
    })
}

async fn load_json_setting(
    state: &AppState,
    key: &str,
    default_value: serde_json::Value,
) -> AppResult<serde_json::Value> {
    let raw = sqlx::query_scalar::<_, String>("SELECT value FROM system_settings WHERE key = ?")
        .bind(key)
        .fetch_optional(&state.db)
        .await?;
    Ok(raw
        .and_then(|v| serde_json::from_str::<serde_json::Value>(&v).ok())
        .unwrap_or(default_value))
}

async fn save_json_setting(
    state: &AppState,
    key: &str,
    value: &serde_json::Value,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO system_settings (key, value, updatedAt) VALUES (?, ?, datetime('now','localtime'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt"
    )
    .bind(key)
    .bind(value.to_string())
    .execute(&state.db)
    .await?;
    Ok(())
}

/// GET /api/v1/navigation/smartl - SmartL 默认控制项列表
pub async fn get_smartl() -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    Ok(Json(ApiResponse::success(json!({
        "tabs": [
            { "id": "light", "name": "灯光", "icon": "lightbulb" },
            { "id": "ac", "name": "空调", "icon": "wind" },
            { "id": "audio", "name": "音效", "icon": "music" }
        ],
        "items": [
            { "id": "light-auto", "tab": "light", "command": "light/auto", "name": "自动" },
            { "id": "light-all-on", "tab": "light", "command": "light/99", "name": "全开" },
            { "id": "light-all-off", "tab": "light", "command": "light/0", "name": "全关" },
            { "id": "ac-power", "tab": "ac", "command": "consumer/clickButton/ktOpenButton", "name": "开机" },
            { "id": "ac-temp-down", "tab": "ac", "command": "consumer/clickButton/temMinusButton", "name": "降温" },
            { "id": "ac-temp-up", "tab": "ac", "command": "consumer/clickButton/temAddButton", "name": "升温" },
            { "id": "music-down", "tab": "audio", "command": "music-down", "name": "音乐-" },
            { "id": "music-up", "tab": "audio", "command": "music-up", "name": "音乐+" },
            { "id": "mic-down", "tab": "audio", "command": "mic-down", "name": "话筒-" },
            { "id": "mic-up", "tab": "audio", "command": "mic-up", "name": "话筒+" }
        ]
    }))))
}

/// GET /api/v1/navigation/smartl/status - SmartL 默认控制状态
pub async fn get_smartl_status() -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    Ok(Json(ApiResponse::success(json!({
        "audio": {
            "volume": 50,
            "micVolume": 50,
            "mute": false,
            "effect": "standard"
        },
        "light": {
            "auto": false,
            "scene": null
        },
        "ac": {
            "power": false,
            "temp": 26,
            "mode": "cool",
            "wind": "low"
        }
    }))))
}

/// GET /api/v1/navigation/bottom - 底部导航项
pub async fn get_bottom_nav(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let value = load_json_setting(&state, BOTTOM_NAV_KEY, default_bottom_nav()).await?;
    Ok(Json(ApiResponse::success(value)))
}

/// PUT /api/v1/navigation/bottom/:id - 保存导航项状态
pub async fn update_bottom_nav_item(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let mut items = load_json_setting(&state, BOTTOM_NAV_KEY, default_bottom_nav()).await?;
    if let Some(list) = items.as_array_mut() {
        let mut found = false;
        for item in list.iter_mut() {
            if item.get("id").and_then(|v| v.as_str()) == Some(id.as_str()) {
                if let Some(map) = item.as_object_mut() {
                    if let Some(body_map) = body.as_object() {
                        for (key, value) in body_map {
                            map.insert(key.clone(), value.clone());
                        }
                    }
                }
                found = true;
                break;
            }
        }
        if !found {
            let mut new_item = body;
            if let Some(map) = new_item.as_object_mut() {
                map.insert("id".to_string(), serde_json::Value::String(id.clone()));
            } else {
                new_item = json!({ "id": id, "state": new_item });
            }
            list.push(new_item);
        }
    }
    save_json_setting(&state, BOTTOM_NAV_KEY, &items).await?;
    Ok(Json(ApiResponse::success(json!({
        "id": id,
        "items": items
    }))))
}

/// GET /api/v1/navigation/bottom/current - 当前选中项
pub async fn get_bottom_nav_current(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let items = load_json_setting(&state, BOTTOM_NAV_KEY, default_bottom_nav()).await?;
    let current = items
        .as_array()
        .and_then(|list| {
            list.iter().find(|item| {
                item.get("active")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            })
        })
        .cloned()
        .unwrap_or_else(|| json!({ "id": "home", "name": "首页" }));
    Ok(Json(ApiResponse::success(current)))
}

/// GET /api/v1/display/layout - 默认画面布局
pub async fn get_display_layout(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let value = load_json_setting(&state, DISPLAY_LAYOUT_KEY, default_display_layout()).await?;
    Ok(Json(ApiResponse::success(value)))
}

/// POST /api/v1/display/layout - 保存画面布局
pub async fn set_display_layout(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    save_json_setting(&state, DISPLAY_LAYOUT_KEY, &body).await?;
    Ok(Json(ApiResponse::success(json!({
        "saved": true,
        "layout": body
    }))))
}

/// GET /api/v1/display/status - 默认画面状态
pub async fn get_display_status(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let value = load_json_setting(&state, DISPLAY_STATUS_KEY, default_display_status()).await?;
    Ok(Json(ApiResponse::success(value)))
}

/// PUT /api/v1/display/status - 保存画面状态
pub async fn update_display_status(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    save_json_setting(&state, DISPLAY_STATUS_KEY, &body).await?;
    Ok(Json(ApiResponse::success(json!({
        "saved": true,
        "status": body
    }))))
}
