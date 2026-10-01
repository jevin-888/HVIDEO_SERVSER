use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    models::{
        common::ApiResponse,
        peripheral::{CreatePresetRequest, PeripheralPreset, UpdatePresetRequest},
    },
    services::room_service::RoomService,
    AppState,
};

// ─── 响应结构 ────────────────────────────────────────────────────────────────

/// 单个房间外设状态
#[derive(Debug, Serialize)]
pub struct PeripheralState {
    pub roomId: String,
    pub roomName: String,
    pub terminalOnline: bool,
    pub terminalIp: Option<String>,
    pub light: serde_json::Value,
    pub ac: serde_json::Value,
    pub effect: serde_json::Value,
    pub updatedAt: String,
}

/// 批量操作结果
#[derive(Debug, Serialize)]
pub struct BatchResult {
    pub total: usize,
    pub success: usize,
    pub failed: Vec<String>,
}

// ─── 请求结构 ────────────────────────────────────────────────────────────────

/// 灯光控制请求（ctrlType: 2=场景, 3=自动; code 为场景码或 "0"/"1"）
#[derive(Debug, Deserialize)]
pub struct LightRequest {
    #[serde(rename = "ctrlType")]
    pub ctrl_type: i64,
    pub code: String,
}

/// 空调控制请求
#[derive(Debug, Deserialize)]
pub struct AcRequest {
    pub power: bool,
    pub temp: Option<i32>,
    pub mode: Option<String>,
    pub wind: Option<String>,
}

/// 音效控制请求
#[derive(Debug, Deserialize)]
pub struct EffectRequest {
    pub mode: String,
}

/// 批量灯光控制请求（roomIds 为 None 时作用于所有房间）
#[derive(Debug, Deserialize)]
pub struct BatchLightRequest {
    pub roomIds: Option<Vec<String>>,
    #[serde(rename = "ctrlType")]
    pub ctrl_type: i64,
    pub code: String,
}

/// 批量空调控制请求（roomIds 为 None 时作用于所有房间）
#[derive(Debug, Deserialize)]
pub struct BatchAcRequest {
    pub roomIds: Option<Vec<String>>,
    pub power: bool,
    pub temp: Option<i32>,
    pub mode: Option<String>,
    pub wind: Option<String>,
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

fn to_peripheral_state(room: &crate::models::room::RoomWithTerminalInfo) -> PeripheralState {
    let light = serde_json::from_str(&room.lightState)
        .unwrap_or_else(|_| serde_json::json!({"scene": "auto"}));
    let ac = serde_json::from_str(&room.acState)
        .unwrap_or_else(|_| serde_json::json!({"power": false, "temp": 26, "mode": "auto"}));
    let effect = serde_json::from_str(&room.effectState)
        .unwrap_or_else(|_| serde_json::json!({"mode": "standard"}));
    PeripheralState {
        roomId: room.id.clone(),
        roomName: room.name.clone(),
        terminalOnline: room.terminalOnline.unwrap_or(0) == 1,
        terminalIp: room.roomIp.clone(),
        light,
        ac,
        effect,
        updatedAt: room.updatedAt.clone(),
    }
}

// ─── 查询接口 ─────────────────────────────────────────────────────────────────

/// GET /api/v1/admin/peripherals - 所有房间外设状态列表
pub async fn list_peripheral_states(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<PeripheralState>>>> {
    let rooms = RoomService::list_all_with_terminal_info(&state.db).await?;
    let result = rooms.iter().map(to_peripheral_state).collect();
    Ok(Json(ApiResponse::success(result)))
}

/// GET /api/v1/admin/peripherals/:roomId - 单个房间外设状态
pub async fn get_peripheral_state(
    State(state): State<AppState>,
    Path(roomId): Path<String>,
) -> AppResult<Json<ApiResponse<PeripheralState>>> {
    let rooms = RoomService::list_all_with_terminal_info(&state.db).await?;
    let room = rooms
        .iter()
        .find(|r| r.id == roomId)
        .ok_or_else(|| AppError::NotFound(format!("房间不存在: {}", roomId)))?;
    Ok(Json(ApiResponse::success(to_peripheral_state(room))))
}

// ─── 单房间控制 ───────────────────────────────────────────────────────────────

/// PUT /api/v1/admin/peripherals/:roomId/light - 设置房间灯光（写库 + 推送 WS）
pub async fn set_room_light(
    State(state): State<AppState>,
    Path(roomId): Path<String>,
    Json(req): Json<LightRequest>,
) -> AppResult<Json<ApiResponse<()>>> {
    // 统一使用场景码作为主控标识
    let lightState = serde_json::json!({
        "scene": req.code
    });
    RoomService::update_light_state(&state.db, &roomId, &lightState.to_string()).await?;

    // 推送 SetLight 指令（由终端协议适配层处理具体 ctrlType/code 转换）
    state.send_room_push(
        &roomId,
        serde_json::json!({
            "type": "command",
            "action": "SetLight",
            "scene": req.code,
            "source": "admin"
        }),
    );
    crate::api::room_handler::broadcast_room_state_sync(&state, &roomId).await?;
    Ok(Json(ApiResponse::success(())))
}

/// PUT /api/v1/admin/peripherals/:roomId/ac - 设置房间空调（写库 + 推送 WS）
pub async fn set_room_ac(
    State(state): State<AppState>,
    Path(roomId): Path<String>,
    Json(req): Json<AcRequest>,
) -> AppResult<Json<ApiResponse<()>>> {
    let acState = serde_json::json!({
        "power": req.power,
        "temp": req.temp.unwrap_or(26),
        "mode": req.mode.as_deref().unwrap_or("auto"),
        "wind": req.wind.as_deref().unwrap_or("low")
    });
    RoomService::update_ac_state(&state.db, &roomId, &acState.to_string()).await?;

    state.send_room_push(
        &roomId,
        serde_json::json!({
            "type": "command",
            "action": "SetAC",
            "power": acState["power"].clone(),
            "temp": acState["temp"].clone(),
            "mode": acState["mode"].clone(),
            "wind": acState["wind"].clone(),
            "source": "admin"
        }),
    );
    crate::api::room_handler::broadcast_room_state_sync(&state, &roomId).await?;
    Ok(Json(ApiResponse::success(())))
}

/// PUT /api/v1/admin/peripherals/:roomId/effect - 设置房间音效（写库 + 推送 WS）
pub async fn set_room_effect(
    State(state): State<AppState>,
    Path(roomId): Path<String>,
    Json(req): Json<EffectRequest>,
) -> AppResult<Json<ApiResponse<()>>> {
    let effectState = serde_json::json!({ "mode": req.mode });
    RoomService::update_effect_state(&state.db, &roomId, &effectState.to_string()).await?;

    state.send_room_push(
        &roomId,
        serde_json::json!({
            "type": "command",
            "action": "SetEffect",
            "mode": req.mode,
            "source": "admin"
        }),
    );
    crate::api::room_handler::broadcast_room_state_sync(&state, &roomId).await?;
    Ok(Json(ApiResponse::success(())))
}

// ─── 批量控制 ─────────────────────────────────────────────────────────────────

/// POST /api/v1/admin/peripherals/batch/light - 批量控制灯光
pub async fn batch_set_light(
    State(state): State<AppState>,
    Json(req): Json<BatchLightRequest>,
) -> AppResult<Json<ApiResponse<BatchResult>>> {
    let all_rooms = RoomService::list_all_with_terminal_info(&state.db).await?;
    let rooms: Vec<_> = match &req.roomIds {
        Some(ids) => all_rooms
            .into_iter()
            .filter(|r| ids.contains(&r.id))
            .collect(),
        None => all_rooms,
    };

    let lightState = serde_json::json!({ "scene": req.code });
    let mut success = 0usize;
    let mut failed = Vec::new();

    for room in &rooms {
        match RoomService::update_light_state(&state.db, &room.id, &lightState.to_string()).await {
            Ok(_) => {
                state.send_room_push(
                    &room.id,
                    serde_json::json!({
                        "type": "command",
                        "action": "SetLight",
                        "scene": req.code.clone(),
                        "source": "admin"
                    }),
                );
                match crate::api::room_handler::broadcast_room_state_sync(&state, &room.id).await {
                    Ok(_) => success += 1,
                    Err(error) => {
                        tracing::warn!(room_id = %room.id, %error, "批量灯光完整房态广播失败");
                        failed.push(room.id.clone());
                    }
                }
            }
            Err(_) => failed.push(room.id.clone()),
        }
    }

    Ok(Json(ApiResponse::success(BatchResult {
        total: rooms.len(),
        success,
        failed,
    })))
}

/// POST /api/v1/admin/peripherals/batch/ac - 批量控制空调
pub async fn batch_set_ac(
    State(state): State<AppState>,
    Json(req): Json<BatchAcRequest>,
) -> AppResult<Json<ApiResponse<BatchResult>>> {
    let all_rooms = RoomService::list_all_with_terminal_info(&state.db).await?;
    let rooms: Vec<_> = match &req.roomIds {
        Some(ids) => all_rooms
            .into_iter()
            .filter(|r| ids.contains(&r.id))
            .collect(),
        None => all_rooms,
    };

    let acState = serde_json::json!({
        "power": req.power,
        "temp": req.temp.unwrap_or(26),
        "mode": req.mode.as_deref().unwrap_or("auto"),
        "wind": req.wind.as_deref().unwrap_or("low")
    });
    let mut success = 0usize;
    let mut failed = Vec::new();

    for room in &rooms {
        match RoomService::update_ac_state(&state.db, &room.id, &acState.to_string()).await {
            Ok(_) => {
                state.send_room_push(
                    &room.id,
                    serde_json::json!({
                        "type": "command",
                        "action": "SetAC",
                        "power": acState["power"].clone(),
                        "temp": acState["temp"].clone(),
                        "mode": acState["mode"].clone(),
                        "wind": acState["wind"].clone(),
                        "source": "admin"
                    }),
                );
                match crate::api::room_handler::broadcast_room_state_sync(&state, &room.id).await {
                    Ok(_) => success += 1,
                    Err(error) => {
                        tracing::warn!(room_id = %room.id, %error, "批量空调完整房态广播失败");
                        failed.push(room.id.clone());
                    }
                }
            }
            Err(_) => failed.push(room.id.clone()),
        }
    }

    Ok(Json(ApiResponse::success(BatchResult {
        total: rooms.len(),
        success,
        failed,
    })))
}

// ─── 品类预设 CRUD ────────────────────────────────────────────────────────────

/// PeripheralPreset settings 字段（JSON 字符串）解析为 Value 的响应体
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetResponse {
    pub id: String,
    pub presetType: String,
    pub name: String,
    pub settings: serde_json::Value,
    pub sortOrder: i32,
    pub createdAt: String,
    pub updatedAt: String,
}

impl From<PeripheralPreset> for PresetResponse {
    fn from(p: PeripheralPreset) -> Self {
        let settings = serde_json::from_str(&p.settings).unwrap_or(serde_json::json!({}));
        PresetResponse {
            id: p.id,
            presetType: p.presetType,
            name: p.name,
            settings,
            sortOrder: p.sortOrder,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
        }
    }
}

/// GET /api/v1/admin/peripheral-presets?type=light|effect|ac
pub async fn list_presets(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> AppResult<Json<ApiResponse<Vec<PresetResponse>>>> {
    let presetType = params.get("type").cloned().unwrap_or_default();

    let rows = if presetType.is_empty() {
        sqlx::query_as::<_, PeripheralPreset>(
            "SELECT * FROM peripheral_presets ORDER BY presetType, sortOrder, name",
        )
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, PeripheralPreset>(
            "SELECT * FROM peripheral_presets WHERE presetType = ? ORDER BY sortOrder, name",
        )
        .bind(&presetType)
        .fetch_all(&state.db)
        .await?
    };

    let result = rows.into_iter().map(PresetResponse::from).collect();
    Ok(Json(ApiResponse::success(result)))
}

/// GET /api/v1/peripheral/presets?type=light|effect|ac
/// 客户端获取预设列表（公开接口，不需要认证）
pub async fn list_presets_public(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> AppResult<Json<ApiResponse<Vec<PresetResponse>>>> {
    // 复用管理端的逻辑
    list_presets(State(state), Query(params)).await
}

/// POST /api/v1/admin/peripheral-presets
pub async fn create_preset(
    State(state): State<AppState>,
    Json(req): Json<CreatePresetRequest>,
) -> AppResult<Json<ApiResponse<PresetResponse>>> {
    if req.presetType.is_empty() || req.name.trim().is_empty() {
        return Err(AppError::BadRequest("presetType 和 name 不能为空".into()));
    }
    let id = Uuid::new_v4().to_string();
    let settings_str = req.settings.to_string();
    let sort = req.sortOrder.unwrap_or(0);

    sqlx::query(
        "INSERT INTO peripheral_presets (id, presetType, name, settings, sortOrder)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&req.presetType)
    .bind(req.name.trim())
    .bind(&settings_str)
    .bind(sort)
    .execute(&state.db)
    .await?;

    let row =
        sqlx::query_as::<_, PeripheralPreset>("SELECT * FROM peripheral_presets WHERE id = ?")
            .bind(&id)
            .fetch_one(&state.db)
            .await?;

    Ok(Json(ApiResponse::success(PresetResponse::from(row))))
}

/// PUT /api/v1/admin/peripheral-presets/:id
pub async fn update_preset(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdatePresetRequest>,
) -> AppResult<Json<ApiResponse<PresetResponse>>> {
    let existing =
        sqlx::query_as::<_, PeripheralPreset>("SELECT * FROM peripheral_presets WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("预设不存在: {}", id)))?;

    let name = req
        .name
        .as_deref()
        .unwrap_or(&existing.name)
        .trim()
        .to_string();
    let settings_str = req
        .settings
        .map(|v| v.to_string())
        .unwrap_or(existing.settings.clone());
    let sort = req.sortOrder.unwrap_or(existing.sortOrder);

    sqlx::query(
        "UPDATE peripheral_presets
         SET name = ?, settings = ?, sortOrder = ?, updatedAt = datetime('now','localtime')
         WHERE id = ?",
    )
    .bind(&name)
    .bind(&settings_str)
    .bind(sort)
    .bind(&id)
    .execute(&state.db)
    .await?;

    let updated =
        sqlx::query_as::<_, PeripheralPreset>("SELECT * FROM peripheral_presets WHERE id = ?")
            .bind(&id)
            .fetch_one(&state.db)
            .await?;

    Ok(Json(ApiResponse::success(PresetResponse::from(updated))))
}

/// DELETE /api/v1/admin/peripheral-presets/:id
pub async fn delete_preset(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    let affected = sqlx::query("DELETE FROM peripheral_presets WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?
        .rows_affected();

    if affected == 0 {
        return Err(AppError::NotFound(format!("预设不存在: {}", id)));
    }
    Ok(Json(ApiResponse::success(())))
}
