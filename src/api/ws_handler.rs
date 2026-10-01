use axum::extract::ws::{Message, WebSocket};
use axum::Json;
use axum::{
    extract::{ConnectInfo, Path, Query, State, WebSocketUpgrade},
    response::Response,
};
use std::net::SocketAddr;

use crate::errors::AppResult;
use crate::models::common::ApiResponse;
use crate::services::room_service::{RoomClientConnection, RoomService};
use crate::services::terminal_service::TerminalService;
use crate::AppState;

fn request_client_ip(
    headers: &axum::http::HeaderMap,
    addr: Option<&ConnectInfo<SocketAddr>>,
) -> String {
    let peer_ip = addr.map(|value| value.0.ip());
    if peer_ip.is_some_and(|ip| ip.is_loopback()) {
        if let Some(forwarded) = headers
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').next())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return forwarded.to_string();
        }
        if let Some(real_ip) = headers
            .get("x-real-ip")
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return real_ip.to_string();
        }
    }
    peer_ip
        .map(|ip| ip.to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

async fn resolve_ws_client_type(
    pool: &sqlx::SqlitePool,
    terminalId: &str,
    resolved_room_id: Option<&String>,
    clientIp: &str,
) -> String {
    // 1. 管理端路径标识
    if terminalId.starts_with("admin-") {
        return "admin".to_string();
    }

    // 2. 尝试从浏览器 HTTP 来源记录中获取（已通过 track_room_client_http_source 记录）
    if let Some(roomId) = resolved_room_id {
        if let Ok(Some(source)) =
            RoomService::get_room_client_http_source(pool, roomId, clientIp).await
        {
            return source.clientType;
        }
    }

    // 3. 尝试从硬件注册终端表中获取设备类型
    let terminal_type: Option<String> = sqlx::query_scalar(
        "SELECT deviceType FROM terminals WHERE id = ?1 OR (terminalIp <> '' AND terminalIp = ?2) OR id IN
             (SELECT terminalId FROM terminal_connections WHERE ipAddress=?2 AND onlineStatus=1)",
    )
    .bind(terminalId)
    .bind(clientIp)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some(t_type) = terminal_type {
        return match t_type.as_str() {
            "ktv" | "tv" => "display".to_string(),
            "mobile" | "phone" => "phone".to_string(),
            _ => "pc".to_string(),
        };
    }

    // 5. 最终兜底：非主播放 IP 的一律视为触摸屏 (pc)
    "pc".to_string()
}

/// GET /ws/{terminalId}?roomId=xxx - WebSocket 升级
pub async fn ws_upgrade(
    Path(terminalId): Path<String>,
    headers: axum::http::HeaderMap,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    State(state): State<AppState>,
    addr: Option<ConnectInfo<SocketAddr>>,
    ws: WebSocketUpgrade,
) -> Response {
    let clientIp = request_client_ip(&headers, addr.as_ref());
    let pool = state.db.clone();
    let ws_manager = state.ws.clone();
    let roomId = params.get("roomId").cloned();

    ws.on_upgrade(move |socket| async move {
        // 如果 terminalId 是占位符，尝试根据 IP 反查实际 ID
        let final_terminal_id =
            if terminalId == "current" || terminalId == "default" || terminalId == "unknown" {
                match find_terminal_by_ip(&pool, &clientIp).await {
                    Ok(id) => id,
                    Err(_) => terminalId,
                }
            } else {
                terminalId
            };

        // 解析实际的房间ID
        let mut resolved_room_id = None;
        if let Some(rid) = roomId {
            if let Ok(real_id) =
                crate::services::room_service::RoomService::resolve_room_id(&pool, &rid, &clientIp)
                    .await
            {
                resolved_room_id = Some(real_id);
            }
        }

        let clientType = resolve_ws_client_type(
            &pool,
            &final_terminal_id,
            resolved_room_id.as_ref(),
            &clientIp,
        )
        .await;

        ws_manager
            .handle_connection(
                socket,
                final_terminal_id,
                resolved_room_id,
                clientType,
                state,
                clientIp,
            )
            .await;
    })
}

/// GET /ws?roomId=xxx - WebSocket upgrade (no terminalId, find by IP)
pub async fn ws_upgrade_default(
    headers: axum::http::HeaderMap,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    State(state): State<AppState>,
    addr: Option<ConnectInfo<SocketAddr>>,
    ws: WebSocketUpgrade,
) -> Response {
    let clientIp = request_client_ip(&headers, addr.as_ref());
    let pool = state.db.clone();
    let ws_manager = state.ws.clone();
    let roomId = params.get("roomId").cloned();

    ws.on_upgrade(move |socket| async move {
        // 【房间优先识别逻辑】
        // 核心：不再机械地反查终端表，而是根据 roomId 参数确定包厢，再根据 IP 是否匹配来决定身份。
        let rid_param = roomId.unwrap_or_else(|| "current".to_string());

        // 1. 解析实际的房间 ID (UUID)
        let resolved_room_id =
            match RoomService::resolve_room_id(&pool, &rid_param, &clientIp).await {
                Ok(uuid) => Some(uuid),
                Err(_) => Some(rid_param.clone()), // 实在解析不到也保留原始输入供后续逻辑判断
            };

        // 2. 根据房间信息判定角色：是该房间的大屏（Authority）还是普通客户端（Visitor）
        let (terminalId, clientType) = if let Some(ref rid) = resolved_room_id {
            // 获取包厢绑定的主终端 IP
            if let Ok(info) = sqlx::query_as::<_, (String, Option<String>)>(
                "SELECT id, terminalId FROM rooms WHERE id = ?",
            )
            .bind(rid)
            .fetch_optional(&pool)
            .await
            {
                if let Some((_, Some(tid))) = info {
                    if TerminalService::has_ip(&pool, &tid, &clientIp)
                        .await
                        .unwrap_or(false)
                    {
                        (tid, "display".to_string())
                    } else {
                        ("default".to_string(), "pc".to_string())
                    }
                } else {
                    ("default".to_string(), "pc".to_string())
                }
            } else {
                ("default".to_string(), "pc".to_string())
            }
        } else {
            ("default".to_string(), "pc".to_string())
        };

        // 3. 特殊处理：本地连接（管理员面板或其他调试终端）
        let (final_tid, final_type) = if crate::net_utils::is_local_ip(&clientIp) {
            ("server-console".to_string(), "admin".to_string())
        } else {
            (terminalId, clientType)
        };

        ws_manager
            .handle_connection(
                socket,
                final_tid,
                resolved_room_id,
                final_type,
                state,
                clientIp,
            )
            .await;
    })
}

/// GET /ws/scan/{task_id} - 订阅扫描任务进度推送
pub async fn ws_scan_progress(
    Path(task_id): Path<String>,
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| async move {
        handle_scan_ws(socket, state, task_id).await;
    })
}

async fn handle_scan_ws(mut socket: WebSocket, state: AppState, task_id: String) {
    let (initial_message, mut receiver) =
        match state.scan_service.subscribe_progress(&task_id).await {
            Some(subscription) => subscription,
            None => {
                let _ = socket
                    .send(Message::Text(
                        serde_json::json!({
                            "type": "error",
                            "message": format!("任务不存在: {}", task_id)
                        })
                        .to_string(),
                    ))
                    .await;
                return;
            }
        };

    // 先发订阅时快照。快速任务即使已经完成，也不会丢失终态。
    if socket
        .send(Message::Text(initial_message.clone()))
        .await
        .is_err()
        || is_terminal_scan_message(&initial_message)
    {
        return;
    }

    loop {
        tokio::select! {
            result = receiver.recv() => {
                match result {
                    Ok(message) => {
                        if socket.send(Message::Text(message.clone())).await.is_err() {
                            break;
                        }
                        if is_terminal_scan_message(&message) {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // 积压时重新订阅并发送当前快照，避免错过终态。
                        if let Some((snapshot, new_receiver)) = state.scan_service.subscribe_progress(&task_id).await {
                            receiver = new_receiver;
                            if socket.send(Message::Text(snapshot.clone())).await.is_err()
                                || is_terminal_scan_message(&snapshot)
                            {
                                break;
                            }
                        } else {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

fn is_terminal_scan_message(message: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(message)
        .ok()
        .and_then(|value| {
            value
                .get("type")
                .and_then(|kind| kind.as_str())
                .map(str::to_owned)
        })
        .map(|kind| matches!(kind.as_str(), "completed" | "cancelled" | "error"))
        .unwrap_or(false)
}

/// 根据IP查找终端ID
async fn find_terminal_by_ip(pool: &sqlx::SqlitePool, ip: &str) -> Result<String, sqlx::Error> {
    if ip.is_empty() {
        return Err(sqlx::Error::RowNotFound);
    }
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM terminals WHERE terminalIp = ?1 OR id IN
         (SELECT terminalId FROM terminal_connections WHERE ipAddress=?1 AND onlineStatus=1)",
    )
    .bind(ip)
    .fetch_one(pool)
    .await
}

/// GET /api/v1/system/ws/connections - 获取所有活跃 WebSocket 连接
pub async fn list_connections(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<crate::ws::ConnectionInfo>>>> {
    let connections = state.ws.get_connections().await;
    Ok(Json(ApiResponse::success(connections)))
}

#[derive(Debug, serde::Deserialize)]
pub struct ConnectionQuery {
    pub room: Option<String>,
    pub roomId: Option<String>,
    pub roomIp: Option<String>,
    pub clientType: Option<String>,
}

/// GET /api/v1/system/room-client-connections?room=A01|roomId=xxx|roomIp=192.168.1.2
pub async fn list_room_client_connections(
    State(state): State<AppState>,
    Query(query): Query<ConnectionQuery>,
) -> AppResult<Json<ApiResponse<Vec<RoomClientConnection>>>> {
    let pool = &state.db;

    // 将各种房间标识符统一解析为 (filter_col, filter_val)
    // filter_col: "roomId" | "roomIp" | None（全量）
    let (room_filter_col, room_filter_val): (Option<&'static str>, Option<String>) =
        if let Some(roomId) = query.roomId {
            (Some("roomId"), Some(roomId))
        } else if let Some(room) = query.room {
            let resolved = RoomService::resolve_room_id(pool, &room, "127.0.0.1")
                .await
                .unwrap_or(room);
            (Some("roomId"), Some(resolved))
        } else if let Some(roomIp) = query.roomIp {
            (Some("roomIp"), Some(roomIp))
        } else {
            (None, None)
        };

    // 动态拼接 WHERE 子句（始终包含 status = 1）
    let mut where_parts = vec!["status = 1".to_string()];
    if let (Some(col), Some(ref val)) = (room_filter_col, &room_filter_val) {
        let _ = val; // used below via bind
        where_parts.push(format!("{} = ?", col));
    }
    if let Some(ref _ct) = query.clientType {
        where_parts.push("clientType = ?".to_string());
    }
    let sql = format!(
        "SELECT * FROM room_client_connections WHERE {} ORDER BY updatedAt DESC, connectedAt DESC",
        where_parts.join(" AND ")
    );

    // 按参数顺序绑定
    let mut q = sqlx::query_as::<_, RoomClientConnection>(&sql);
    if let Some(ref val) = room_filter_val {
        q = q.bind(val);
    }
    if let Some(ref ct) = query.clientType {
        q = q.bind(ct);
    }

    let rows = q.fetch_all(pool).await?;
    Ok(Json(ApiResponse::success(rows)))
}
