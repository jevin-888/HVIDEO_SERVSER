use axum::{
    extract::{ConnectInfo, Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use std::net::SocketAddr;

#[derive(Debug, Deserialize)]
pub struct TerminalByMacQuery {
    pub mac: String,
}

/// GET /api/v1/terminals/by-mac - Resolve the current IP for a PAD binding.
pub async fn get_terminal_by_mac(
    State(state): State<AppState>,
    Query(query): Query<TerminalByMacQuery>,
) -> AppResult<Json<ApiResponse<Option<Terminal>>>> {
    let mac = query
        .mac
        .trim()
        .replace(':', "")
        .replace('-', "")
        .replace('.', "")
        .to_ascii_uppercase();
    if mac.len() != 12 || !mac.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest("invalid terminal MAC address".into()));
    }
    let terminal = sqlx::query_as::<_, Terminal>(
        "SELECT * FROM terminals WHERE upper(replace(replace(replace(trim(macAddress), ':', ''), '-', ''), '.', '')) = ? LIMIT 1",
    )
    .bind(mac)
    .fetch_optional(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(terminal)))
}

use crate::discover;
use crate::errors::{AppError, AppResult};
use crate::models::common::ApiResponse;
use crate::models::terminal::*;
use crate::services::activity_service::ActivityService;
use crate::services::auth_service::Claims;
use crate::services::room_service::RoomService;
use crate::services::terminal_service::TerminalService;
use crate::AppState;

/// GET /api/v1/terminals - List terminals.
pub async fn list_terminals(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<Terminal>>>> {
    let terminals = TerminalService::list_all(&state.db).await?;
    Ok(Json(ApiResponse::success(terminals)))
}

/// PAD 选择终端使用的公开精简列表。
pub async fn list_pad_terminals(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<Terminal>>>> {
    let terminals = TerminalService::list_all(&state.db).await?;
    Ok(Json(ApiResponse::success(terminals)))
}

/// POST /api/v1/terminals/register - Verify player identity before registration.
pub async fn register_terminal(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    payload: Result<Json<RegisterPlayerTerminalRequest>, axum::extract::rejection::JsonRejection>,
) -> AppResult<Json<ApiResponse<Terminal>>> {
    let Json(req) = payload.map_err(|error| AppError::BadRequest(error.body_text()))?;
    let expected_serial = TerminalService::usable_serial(&req.serial).ok_or_else(|| {
        AppError::BadRequest(
            "a valid hardware serial is required for terminal registration".to_string(),
        )
    })?;
    let player = discover::verify_player(
        &req.terminalIp,
        state.config.discover.udp_port,
        state.server_bind_ip,
    )
    .await?;
    let reported_serial = player
        .serial
        .as_deref()
        .and_then(TerminalService::usable_serial);
    if reported_serial.as_deref() != Some(expected_serial.as_str()) {
        return Err(AppError::Conflict(
            "entered serial does not match the player at this IP".to_string(),
        ));
    }
    let terminal_limit = state
        .license
        .terminal_limit()
        .map_err(AppError::Forbidden)?;
    let registration =
        discover::register_verified_player(&state.db, &player, terminal_limit).await?;
    state.sync_terminal_registration(&registration).await;
    let terminal = registration.terminal;

    let detail = format!(
        "Verified player terminal {} ({}) registered",
        terminal.name, terminal.terminalIp
    );
    let _ = ActivityService::record(
        &state.db,
        &claims.sub,
        "terminal_register",
        "terminal",
        &terminal.id,
        &detail,
        "",
    )
    .await;
    Ok(Json(ApiResponse::success(terminal)))
}

/// POST /api/v1/terminals/admission - Admit an online VOD player.
/// The source IP is trusted from the TCP connection, not from JSON.
pub async fn admit_terminal(
    State(state): State<AppState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    payload: Result<Json<TerminalAdmissionRequest>, axum::extract::rejection::JsonRejection>,
) -> AppResult<Response> {
    let Json(req) = payload.map_err(|error| AppError::BadRequest(error.body_text()))?;
    if req.protocol_version.trim() != "2.0"
        || req.device_role.trim() != "player"
        || req.app_id.trim() != "com.hsvj.engine"
    {
        return Err(AppError::BadRequest(
            "unsupported terminal protocol identity".to_string(),
        ));
    }
    if req.mac_address.trim().is_empty() {
        return Err(AppError::BadRequest(
            "terminal MAC address is required for admission".to_string(),
        ));
    }
    if !discover::is_supported_player_model(req.model.as_deref()) {
        return Err(AppError::BadRequest(
            "a supported H6 player model is required for admission".to_string(),
        ));
    }

    let license = state.license.ensure_valid().map_err(AppError::Forbidden)?;
    let player_license = license.license.clone().ok_or_else(|| AppError::Forbidden(
        "旧版服务器授权未包含播放器模块和图层，请使用新版服务器授权工具重新签发并导入 server.lic".to_string()
    ))?;
    let terminal_ip = remote.ip().to_string();
    let hardware_info = serde_json::json!({
        "protocolVersion": req.protocol_version,
        "deviceRole": req.device_role,
        "appId": req.app_id,
        "serial": req.serial,
        "model": req.model,
    });
    let registration = TerminalService::register(
        &state.db,
        RegisterTerminalRequest {
            name: req.device_name,
            terminalIp: terminal_ip,
            macAddress: Some(req.mac_address),
            serial: req.serial,
            network: req.network,
            port: req.http_port.filter(|port| *port > 0).map(i32::from),
            deviceType: Some("ktv".to_string()),
            hardwareInfo: Some(hardware_info.to_string()),
            softwareVer: req.software_version,
        },
        license.terminal_limit,
    )
    .await;
    let registration = match registration {
        Ok(value) => value,
        Err(AppError::Forbidden(message)) => {
            let registered = TerminalService::registered_count(&state.db).await?;
            let admission = TerminalAdmission {
                authorized: false,
                switch_to_online_vod: false,
                terminal_id: String::new(),
                terminal_limit: license.terminal_limit,
                registered_terminals: registered,
                remaining_points: license.terminal_limit.saturating_sub(registered),
                expires_at: license.expires_at,
                server_time: chrono::Utc::now().timestamp(),
                contract_version: 2,
                issued_at: license.issued_at,
                permanent: crate::license::is_permanent_license(&license),
                customer_name: license.venue.name.clone(),
                license: player_license,
            };
            let body = ApiResponse {
                code: 403,
                message,
                data: Some(admission),
            };
            return Ok((StatusCode::FORBIDDEN, Json(body)).into_response());
        }
        Err(error) => return Err(error),
    };
    RoomService::auto_create_for_terminal(
        &state.db,
        &registration.terminal.id,
        &registration.terminal.name,
    )
    .await?;
    state.sync_terminal_registration(&registration).await;
    let terminal = registration.terminal;
    let registered = TerminalService::registered_count(&state.db).await?;
    Ok(Json(ApiResponse::success(TerminalAdmission {
        authorized: true,
        switch_to_online_vod: true,
        terminal_id: terminal.id,
        terminal_limit: license.terminal_limit,
        registered_terminals: registered,
        remaining_points: license.terminal_limit.saturating_sub(registered),
        expires_at: license.expires_at,
        server_time: chrono::Utc::now().timestamp(),
        contract_version: 2,
        issued_at: license.issued_at,
        permanent: crate::license::is_permanent_license(&license),
        customer_name: license.venue.name,
        license: player_license,
    })))
    .map(IntoResponse::into_response)
}

/// GET /api/v1/terminals/:id - Get terminal details.
pub async fn get_terminal(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<Terminal>>> {
    let terminal = TerminalService::get_by_id(&state.db, &id).await?;
    Ok(Json(ApiResponse::success(terminal)))
}

/// GET /api/v1/terminals/:id/rooms - List linked rooms.
pub async fn get_terminal_rooms(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<Vec<crate::models::room::Room>>>> {
    let rooms =
        sqlx::query_as::<_, crate::models::room::Room>("SELECT * FROM rooms WHERE terminalId = ?")
            .bind(&id)
            .fetch_all(&state.db)
            .await?;
    Ok(Json(ApiResponse::success(rooms)))
}

/// PUT /api/v1/terminals/:id - Update a terminal.
pub async fn update_terminal(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateTerminalRequest>,
) -> AppResult<Json<ApiResponse<Terminal>>> {
    let updates_name = req.name.is_some();
    let terminal = TerminalService::update(&state.db, &id, req).await?;
    state
        .ws
        .broadcast(serde_json::json!({"type": "terminals_updated"}));
    if updates_name {
        if let Some(room_id) =
            sqlx::query_scalar::<_, String>("SELECT id FROM rooms WHERE terminalId = ?")
                .bind(&id)
                .fetch_optional(&state.db)
                .await?
        {
            super::room_handler::broadcast_room_state_sync(&state, &room_id).await?;
        }
    }
    Ok(Json(ApiResponse::success(terminal)))
}

/// DELETE /api/v1/terminals/:id - Delete a terminal.
pub async fn delete_terminal(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    TerminalService::delete(&state.db, &id).await?;
    Ok(Json(ApiResponse::success(())))
}

/// POST /api/v1/terminals/discover - Discover players with challenge-response.
pub async fn discover_terminals(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> AppResult<Json<ApiResponse<Vec<DiscoveredDevice>>>> {
    let udp_port = state.config.discover.udp_port;
    tracing::info!(
        "[API] Starting player handshake discovery on port {}",
        udp_port
    );

    let players = discover::discover_devices(
        udp_port,
        3,
        state.server_bind_ip,
        state.discovery_broadcast_ip,
    )
    .await;
    let mut discovered = Vec::with_capacity(players.len());

    let terminal_limit = state
        .license
        .terminal_limit()
        .map_err(AppError::Forbidden)?;
    for player in players {
        match discover::register_verified_player(&state.db, &player, terminal_limit).await {
            Ok(registration) => {
                state.sync_terminal_registration(&registration).await;
                let terminal = registration.terminal;
                discovered.push(DiscoveredDevice {
                    terminalIp: player.ip.clone(),
                    port: player.ports.http as i32,
                    isRegistered: true,
                    terminalId: Some(terminal.id),
                    deviceInfo: Some(serde_json::to_string(&player).unwrap_or_default()),
                });
            }
            Err(error) => {
                tracing::error!(
                    "Failed to register verified player {}: {:?}",
                    player.ip,
                    error
                );
            }
        }
    }

    tracing::info!(
        "[API] Player discovery completed; {} devices verified",
        discovered.len()
    );
    let detail = format!("Player handshake discovered {} devices", discovered.len());
    let _ = ActivityService::record(
        &state.db,
        &claims.sub,
        "terminal_discover",
        "terminal",
        "",
        &detail,
        "",
    )
    .await;
    Ok(Json(ApiResponse::success(discovered)))
}
