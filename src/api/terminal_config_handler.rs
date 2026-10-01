use crate::{
    errors::{AppError, AppResult},
    models::common::ApiResponse,
    services::{
        auth_service::Claims, terminal_config_service as configs, terminal_service::TerminalService,
    },
    AppState,
};
use axum::{
    extract::{ConnectInfo, Extension, Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    time::Duration,
};

fn directory(state: &AppState) -> PathBuf {
    state
        .config_path
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("terminal-configs")
}

fn authorize(claims: &Claims) -> AppResult<()> {
    if claims.permissions.iter().any(|p| p == "admin") {
        Ok(())
    } else {
        Err(AppError::Forbidden("仅管理员可以保存终端配置".into()))
    }
}

pub async fn list(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> AppResult<Json<ApiResponse<Vec<configs::ConfigProfile>>>> {
    authorize(&claims)?;
    let _guard = configs::CONFIG_LOCK.lock().await;
    Ok(Json(ApiResponse::success(configs::list(&directory(
        &state,
    ))?)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureRequest {
    mode: configs::ConfigMode,
}

pub async fn capture(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Json(request): Json<CaptureRequest>,
) -> AppResult<Json<ApiResponse<Option<configs::ConfigProfile>>>> {
    authorize(&claims)?;
    let terminal = TerminalService::get_by_id(&state.db, &id).await?;
    if request.mode == configs::ConfigMode::Default {
        let _guard = configs::CONFIG_LOCK.lock().await;
        configs::follow_template(&directory(&state), &id)?;
        state.ws.broadcast(json!({"type":"terminals_updated"}));
        return Ok(Json(ApiResponse::success(None)));
    }
    let ip = terminal
        .terminalIp
        .parse::<std::net::Ipv4Addr>()
        .map_err(|_| {
            AppError::BadRequest("终端没有可用 IP，请连接设备后再保存模板或自定义配置".into())
        })?;
    let player = crate::discover::verify_player(
        &terminal.terminalIp,
        state.config.discover.udp_port,
        state.server_bind_ip,
    )
    .await
    .map_err(|_| {
        AppError::BadRequest("无法连接终端，请确认设备在线后再保存模板或自定义配置".into())
    })?;
    if terminal.serial.is_empty()
        || !player
            .serial
            .as_deref()
            .is_some_and(|s| s.eq_ignore_ascii_case(&terminal.serial))
    {
        return Err(AppError::Conflict(
            "播放器序列号与登记终端不一致，未保存配置".into(),
        ));
    }
    if player.ports.mobile != 8081 {
        return Err(AppError::BadRequest("播放器未提供局域网配置接口".into()));
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .local_address(IpAddr::V4(state.server_bind_ip))
        .build()
        .map_err(|e| AppError::Internal(e.into()))?;
    let mut response = client
        .get(format!(
            "http://{ip}:{}/api/v1/config.json",
            player.ports.mobile
        ))
        .send()
        .await
        .map_err(|_| AppError::BadRequest("无法连接播放器读取配置".into()))?;
    if !response.status().is_success() {
        return Err(AppError::BadRequest(
            "播放器未提供配置导出，请确认已安装新版播放器".into(),
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::Internal(e.into()))?
    {
        if bytes.len() + chunk.len() > configs::MAX_CONFIG_BYTES {
            return Err(AppError::BadRequest("配置文件超过 4 MB".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    let result: Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::BadRequest("播放器配置响应不是 JSON".into()))?;
    if result["ok"] != true {
        return Err(AppError::BadRequest("播放器读取配置失败".into()));
    }
    let _guard = configs::CONFIG_LOCK.lock().await;
    let current = TerminalService::get_by_id(&state.db, &id).await?;
    if current.terminalIp != terminal.terminalIp || current.serial != terminal.serial {
        return Err(AppError::Conflict("终端地址已改变，请刷新后重试".into()));
    }
    let profile = configs::capture(
        &directory(&state),
        &id,
        ip,
        request.mode,
        result["data"].clone(),
    )?;
    state.ws.broadcast(json!({"type":"terminals_updated"}));
    Ok(Json(ApiResponse::success(Some(profile))))
}

// IP selection uses the TCP peer only, never a client-supplied IP or file path.
pub async fn startup(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> AppResult<Json<ApiResponse<Option<Value>>>> {
    let IpAddr::V4(ip) = peer.ip() else {
        return Err(AppError::BadRequest("仅支持 IPv4 终端".into()));
    };
    let _guard = configs::CONFIG_LOCK.lock().await;
    let data = configs::startup(&directory(&state), ip)?.map(|(profile, config)|
        json!({"mode":profile.mode,"sourceIp":profile.source_ip,"updatedAt":profile.updated_at,"config":config}));
    Ok(Json(ApiResponse::success(data)))
}
