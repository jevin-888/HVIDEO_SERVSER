use crate::services::room_service::RoomService;
use axum::extract::ws::{Message, WebSocket};
use chrono;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

pub(crate) fn idle_media_changed_message() -> serde_json::Value {
    serde_json::json!({
        "type": "roomStateChanged",
        "path": "/api/v1/idle-media/scan",
        "timestamp": chrono::Utc::now().timestamp_millis()
    })
}

/// WebSocket 消息类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct WsMessage {
    /// 消息类型
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub msg_type: Option<String>,
    /// 消息方法
    #[serde(rename = "method", skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// 目标房间ID（空表示广播）
    pub roomId: Option<String>,
    /// 消息负载
    pub payload: Option<serde_json::Value>,
    /// 数据
    pub data: Option<serde_json::Value>,
    /// 列表类型
    #[serde(rename = "listType", skip_serializing_if = "Option::is_none")]
    pub list_type: Option<i32>,
    /// 操作键
    #[serde(rename = "opKey", skip_serializing_if = "Option::is_none")]
    pub op_key: Option<i32>,
    /// 状态
    pub state: Option<serde_json::Value>,
    /// 标志
    pub flag: Option<i32>,
    /// 记录
    pub records: Option<serde_json::Value>,
    /// 列表
    pub list: Option<serde_json::Value>,
    /// 源
    pub source: Option<String>,
    /// 动作
    pub action: Option<String>,
}

/// 内部广播消息（附带目标房间ID用于过滤）
#[derive(Debug, Clone)]
struct BroadcastMessage {
    /// 目标房间ID，None 代表全局广播
    targetRoomId: Option<String>,
    /// JSON 消息负载
    payload: serde_json::Value,
}

/// 连接信息
#[derive(Debug, Clone, Serialize)]
pub struct ConnectionInfo {
    pub connection_id: String,
    pub terminalId: String,
    pub clientType: String, // "pc", "mobile", "unknown"
    pub roomId: Option<String>,
    pub clientIp: String, // 记录客户端物理 IP 用于过滤器
    #[serde(skip)]
    pub isRoomAuthority: bool,
    pub terminalName: String,
    pub roomName: String,
    pub connectedAt: String,
}

/// WebSocket 连接管理器
#[derive(Clone)]
pub struct WsManager {
    /// 广播发送器
    broadcast_tx: broadcast::Sender<BroadcastMessage>,
    /// 活跃连接（connection_id -> 连接信息）
    connections: Arc<RwLock<HashMap<String, ConnectionInfo>>>,
}

impl WsManager {
    pub fn new() -> Self {
        let (broadcast_tx, _) = broadcast::channel(4096);
        Self {
            broadcast_tx,
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 广播消息给所有连接
    pub fn broadcast(&self, msg: serde_json::Value) {
        let _ = self.broadcast_tx.send(BroadcastMessage {
            targetRoomId: None,
            payload: msg,
        });
    }

    pub fn send_to_room(&self, roomId: &str, msg: serde_json::Value) {
        let _ = self.broadcast_tx.send(BroadcastMessage {
            targetRoomId: Some(roomId.to_string()),
            payload: msg,
        });
    }

    pub async fn connection_count(&self) -> usize {
        self.connections.read().await.len()
    }

    /// 处理新的 WebSocket 连接
    pub async fn handle_connection(
        &self,
        socket: WebSocket,
        terminalId: String,
        initialRoomId: Option<String>,
        clientType: String,
        state: crate::AppState,
        clientIp: String,
    ) {
        // Connection identities must remain unique when two clients share an IP/type.
        let connection_id = format!("{}-{}-{}", clientIp, clientType, uuid::Uuid::new_v4());
        let (mut sender, mut receiver) = socket.split();
        let mut sx_rx = self.broadcast_tx.subscribe();
        let (direct_tx, mut direct_rx) = tokio::sync::mpsc::channel::<Message>(32);

        // 1. 甄别连接身份：仅明确标记为 server-console 的走极简流程。
        // 原本包含 127.0.0.1 和 default 的判断会导致无法识别房间，现已放开。
        let is_server_side = terminalId == "server-console";

        let t_name: String = if is_server_side {
            terminalId.clone()
        } else {
            // 获取数据库连接池用于反查
            let pool = &state.db;
            match sqlx::query_scalar::<_, String>("SELECT name FROM terminals WHERE id = ?")
                .bind(&terminalId)
                .fetch_optional(pool)
                .await
            {
                Ok(Some(name)) => name,
                _ => terminalId.clone(),
            }
        };

        // 2. 只有正常终端才执行房间识别与初始推送（admin、pc、ktv 等）
        let mut actualRoomId = None;
        let mut r_name = "未配置".to_string();
        let mut auto_joined = false;
        let mut roomIp = String::new(); // 未绑定房间时为空，避免与 127.0.0.1 客户端误判为大屏权威
        let pool = &state.db;

        // 127.0.0.1 是服务端本机访问（admin后台、内部服务等），不参与房间绑定
        let is_loopback =
            clientIp == "127.0.0.1" || clientIp == "::1" || clientIp.starts_with("::ffff:127.");

        if (!is_server_side && !is_loopback) || initialRoomId.is_some() {
            // 解析房间识别流
            if let Some(ref rid) = initialRoomId {
                actualRoomId = RoomService::resolve_room_id(pool, rid, &clientIp)
                    .await
                    .ok();
            }

            if actualRoomId.is_none() && !is_server_side && !is_loopback {
                actualRoomId = RoomService::resolve_room_id(pool, "current", &clientIp)
                    .await
                    .ok();
                if actualRoomId.is_none() {
                    if let Ok(Some(rid)) = sqlx::query_scalar::<_, String>(
                        "SELECT id FROM rooms WHERE terminalId = ? LIMIT 1",
                    )
                    .bind(&terminalId)
                    .fetch_optional(pool)
                    .await
                    {
                        actualRoomId = Some(rid);
                        auto_joined = true;
                    }
                }
            }

            // IP is display metadata only. The room ID owns the channel.
            if let Some(ref rid) = actualRoomId {
                let room_info = sqlx::query_as::<_, (String, Option<String>)>(
                    "SELECT r.name, t.terminalIp FROM rooms r LEFT JOIN terminals t ON r.terminalId = t.id WHERE r.id = ?"
                )
                    .bind(rid)
                    .fetch_optional(pool)
                    .await;
                match room_info {
                    Ok(Some((name, Some(ip)))) => {
                        r_name = name;
                        roomIp = ip; // terminalIp
                    }
                    Ok(Some((name, None))) => {
                        // 未绑定地址只影响显示，频道仍由稳定的房间 ID 标识。
                        r_name = name;
                        tracing::warn!("[WS-CONN] 房间 {} ({}) 尚未绑定终端 IP", r_name, rid);
                    }
                    _ => {}
                }
            }
        }

        let finalRoomId = actualRoomId.clone();
        let is_room_authority = if let Some(ref rid) = actualRoomId {
            is_room_player_ip(pool, rid, &clientIp).await
        } else {
            false
        };
        let conn_info = ConnectionInfo {
            connection_id: connection_id.clone(),
            terminalId: terminalId.clone(),
            roomId: finalRoomId.clone(),
            clientType: clientType.clone(),
            clientIp: clientIp.clone(),
            isRoomAuthority: is_room_authority,
            terminalName: t_name.clone(),
            roomName: r_name.clone(),
            connectedAt: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        };

        // 4. 正式登记连接
        {
            let mut conns = self.connections.write().await;
            conns.insert(connection_id.clone(), conn_info);
        }

        if let Some(ref bound_room_id) = actualRoomId {
            if let Err(err) = RoomService::upsert_room_client_connection(
                pool,
                &connection_id,
                bound_room_id,
                &r_name,
                &roomIp,
                &terminalId,
                &t_name,
                &clientType,
                &clientIp,
            )
            .await
            {
                tracing::warn!("记录房间客户端连接失败 [{}]: {:?}", connection_id, err);
            }
        }

        // 5. 初始状态同步（权威归口重构：已移至 join_room 处执行，避免重连时爆量推送）
        if !is_server_side {
            let short_conn = if connection_id.len() > 8 {
                &connection_id[..8]
            } else {
                &connection_id
            };
            tracing::info!(
                "WS连接建立: 客户端IP: {} (房间: {}, 类型: {}, 连接ID: {})",
                clientIp,
                r_name,
                clientType,
                short_conn
            );
            if auto_joined {
                tracing::debug!("[WS-JOIN] 终端 {} 自动加入房间: {}", t_name, r_name);
            }
        }

        let connections = self.connections.clone();
        let conn_id = connection_id.clone();
        let r_name_for_send = r_name.clone();
        let client_ip_for_send = clientIp.clone();
        // 接收广播消息并转发（按房间过滤）
        let send_task = tokio::spawn(async move {
            let mut ping_interval = tokio::time::interval(tokio::time::Duration::from_secs(15));
            loop {
                tokio::select! {
                    // 每 15 秒发一次 Ping，保持连接活跃
                    _ = ping_interval.tick() => {
                        if sender.send(Message::Ping(vec![].into())).await.is_err() {
                            break;
                        }
                    }
                    // 处理广播消息
                    res = sx_rx.recv() => {
                        match res {
                            Ok(broadcast_msg) => {
                                // 1. 从 connections 读取此连接的实时状态（含 join_room 后更新的 roomId）
                                let (currentRoomId, current_room_name, current_client_ip, current_client_type, current_terminal_id, is_room_authority) = {
                                    let conns = connections.read().await;
                                    if let Some(info) = conns.get(&conn_id) {
                                        (info.roomId.clone(), info.roomName.clone(), info.clientIp.clone(), info.clientType.clone(), info.terminalId.clone(), info.isRoomAuthority)
                                    } else {
                                        (None, r_name_for_send.clone(), client_ip_for_send.clone(), "unknown".to_string(), String::new(), false)
                                    }
                                };
                                let effective_room_id = currentRoomId.as_deref().unwrap_or("");

                                let msg_type = broadcast_msg.payload.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");

                                // admin 连接接收所有房间的定向消息（管理后台需要监控所有房间）
                                let is_admin_conn = current_client_type.contains("admin") || current_terminal_id == "server-console";

                                // 2. 路由分发判定 (Room ID 匹配) — 使用实时 roomId
                                let is_local_conn = crate::net_utils::is_local_ip(&current_client_ip);
                                let should_send = match &broadcast_msg.targetRoomId {
                                    None => true, // 全局广播
                                    Some(target_room) => {
                                        if is_admin_conn {
                                            true
                                        } else if is_local_conn {
                                            false
                                        } else {
                                            room_channel_matches(target_room, effective_room_id)
                                        }
                                    }
                                };

                                if should_send {
                                    // routing rules:
                                    //   roomStateChanged -> all room clients (touch screens + display all need state)
                                    //   commandResult    -> non-display only (no loop back to big screen)
                                    //   command          -> all clients
                                    //   playListChanged  -> all clients
                                    //   anything else    -> drop
                                    let can_receive = if msg_type == "roomStateChanged" {
                                        true
                                    } else if is_admin_conn {
                                        // 管理员依然可以监控其它的指令和同步信号
                                        true
                                    } else if msg_type == "commandResult" {
                                        !is_room_authority
                                    } else if msg_type == "command" || msg_type == "playListChanged" {
                                        true
                                    } else {
                                        false
                                    };

                                    if can_receive {
                                        let final_payload = broadcast_msg.payload.clone();
                                        let desc = match msg_type {
                                            "playListChanged" => "[列表同步]".to_string(),
                                            "roomStateChanged" => "[状态同步]".to_string(),
                                            "playIdleContent" => "[空闲播放]".to_string(),
                                            "command" => {
                                                let action_val = final_payload.get("action");
                                                let action = if let Some(a) = action_val {
                                                    if a.is_string() {
                                                        a.as_str().unwrap_or("未知")
                                                    } else {
                                                        "未知"
                                                    }
                                                } else {
                                                    "未知"
                                                };

                                                let action_zh = match action {
                                                    "Next" | "NextSong" | "SkipSong" => "切歌",
                                                    "Play" => "播放",
                                                    "Pause" => "暂停",
                                                    "SetVolume" => "音量",
                                                    "Replay" => "重唱",
                                                    "SwitchTrack" => {
                                                        match final_payload.get("micStatus").and_then(|v| v.as_i64()) {
                                                            Some(1) => "原唱",
                                                            Some(0) => "伴唱",
                                                            _ => "原伴",
                                                        }
                                                    },
                                                    "MicOn" => "开麦",
                                                    "MicOff" => "关麦",
                                                    _ => action,
                                                };
                                                format!("[cmd-{}]", action_zh)
                                            },
                                            "commandResult" => "[反馈结果]".to_string(),
                                            _ => format!("[{}]", msg_type),
                                        };
                                        tracing::info!("[WS-SEND] {} room:{} ip:{} display:{} payload={}",
                                                desc, current_room_name, current_client_ip, is_room_authority, final_payload
                                        );
                                        let json = serde_json::to_string(&final_payload).unwrap_or_default();
                                        if sender.send(Message::Text(json.into())).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                                tracing::warn!("[WS-SEND] 房间 {} 消息积压，丢弃 {} 条", r_name_for_send, n);
                                continue;
                            }
                        }
                    }
                    // 处理直接回复的消息 (单播)
                    Some(msg) = direct_rx.recv() => {
                        if sender.send(msg).await.is_err() {
                            break;
                        }
                    }
                }
            }
        });

        let connections2 = self.connections.clone();
        let tid2 = terminalId.clone();
        let direct_tx2 = direct_tx.clone();
        let pool_clone = pool.clone();
        let cid_for_recv = connection_id.clone();
        let t_name_for_recv = t_name.clone();
        let client_ip_for_recv = clientIp.clone();
        let state_clone = state.clone();

        // 接收客户端消息
        let recv_task = tokio::spawn(async move {
            loop {
                let res = receiver.next().await;
                match res {
                    Some(Ok(msg)) => {
                        match msg {
                            Message::Text(text) => {
                                // 过滤掉频繁的消息（如业务产生的 ping/pong）避免日志溢出
                                if !text.contains("\"ping\"") && !text.contains("\"pong\"") {
                                    tracing::info!(
                                        "收到客户端消息 [{}]: {}",
                                        t_name_for_recv,
                                        text
                                    );
                                } else {
                                    tracing::trace!(
                                        "收到客户端心跳 [{}]: {}",
                                        t_name_for_recv,
                                        text
                                    );
                                }
                                if let Ok(data) = serde_json::from_str::<serde_json::Value>(&text) {
                                    if let Some(msg_type) =
                                        data.get("type").and_then(|t| t.as_str())
                                    {
                                        if msg_type == "join_room" {
                                            if let Some(roomId) =
                                                data.get("roomId").and_then(|r| r.as_str())
                                            {
                                                tracing::info!(
                                                    "[WS-JOIN] request: clientId={}, clientIp={}, requestedRoomId={}",
                                                    cid_for_recv,
                                                    client_ip_for_recv,
                                                    roomId
                                                );
                                                // Resolve incoming IP/terminal aliases once, then subscribe by stable room ID.
                                                let pool = pool_clone.clone();
                                                let rid_to_resolve = roomId.to_string();
                                                let clientIp = client_ip_for_recv.clone();

                                                let resolve_res = match crate::services::room_service::RoomService::resolve_room_id(&pool, &rid_to_resolve, &clientIp).await {
                                                    Ok(uuid) => {
                                                        // 同时查出房间名和绑定 IP，减少查询次数且保障数据一致性
                                                        let info = sqlx::query_as::<_, (String, Option<String>)>("SELECT r.name, t.terminalIp FROM rooms r LEFT JOIN terminals t ON r.terminalId = t.id WHERE r.id = ?")
                                                            .bind(&uuid)
                                                            .fetch_optional(&pool).await.ok().flatten();

                                                        if let Some((name, Some(ip))) = info {
                                                            Ok((uuid, name, ip))
                                                        } else if let Some((name, None)) = info {
                                                            tracing::warn!("[WS-JOIN] 房间未绑定播放器: 房间 {} ({}) 未绑定终端 IP", name, uuid);
                                                            Err("unbound-room")
                                                        } else {
                                                            Err("not-found")
                                                        }
                                                    },
                                                    Err(_) => Err("invalid-room"),
                                                };

                                                // 处理解析结果
                                                if let Err(e) = resolve_res {
                                                    tracing::warn!(
                                                        "[WS-JOIN] 终端 {} 加入房间失败: {}",
                                                        cid_for_recv,
                                                        e
                                                    );
                                                    continue;
                                                }
                                                let (authority_uuid, roomName, channel_ip) =
                                                    resolve_res.unwrap();

                                                let authority = is_room_player_ip(
                                                    &pool,
                                                    &authority_uuid,
                                                    &clientIp,
                                                )
                                                .await;
                                                let mut conns = connections2.write().await;
                                                if let Some(info) = conns.get_mut(&cid_for_recv) {
                                                    info.roomId = Some(authority_uuid.clone());
                                                    info.isRoomAuthority = authority;
                                                    info.roomName = roomName.clone();

                                                    if let Err(err) =
                                                        RoomService::upsert_room_client_connection(
                                                            &pool_clone,
                                                            &cid_for_recv,
                                                            &authority_uuid,
                                                            &roomName,
                                                            &channel_ip,
                                                            &info.terminalId,
                                                            &info.terminalName,
                                                            &info.clientType,
                                                            &info.clientIp,
                                                        )
                                                        .await
                                                    {
                                                        tracing::warn!(
                                                            "更新房间客户端连接失败 [{}]: {:?}",
                                                            cid_for_recv,
                                                            err
                                                        );
                                                    }
                                                    tracing::info!(
                                                        "连接 {} 加入房间 {}/{}",
                                                        cid_for_recv,
                                                        roomName,
                                                        channel_ip
                                                    );
                                                    // 加入房间后广播一次完整状态，让新连接立即同步
                                                    drop(conns);
                                                    // A reconnect may have missed a settings update while offline.
                                                    if direct_tx
                                                        .send(Message::Text(
                                                            idle_media_changed_message()
                                                                .to_string()
                                                                .into(),
                                                        ))
                                                        .await
                                                        .is_err()
                                                    {
                                                        break;
                                                    }
                                                    match crate::api::room_handler::broadcast_room_state_sync(
                                                        &state_clone,
                                                        &authority_uuid,
                                                    )
                                                    .await
                                                    {
                                                        Ok(()) => tracing::info!(
                                                            "[WS-JOIN] initial room state sent: clientId={}, roomUuid={}, channelIp={}",
                                                            cid_for_recv,
                                                            authority_uuid,
                                                            channel_ip
                                                        ),
                                                        Err(err) => tracing::warn!(
                                                            "[WS-JOIN] failed to send initial room state: clientId={}, roomUuid={}, error={:?}",
                                                            cid_for_recv,
                                                            authority_uuid,
                                                            err
                                                        ),
                                                    }
                                                }
                                            }
                                        } else if msg_type == "command" {
                                            let roomId = {
                                                let conns = connections2.read().await;
                                                conns
                                                    .get(&cid_for_recv)
                                                    .and_then(|info| info.roomId.clone())
                                            };

                                            if let Some(rid) = roomId {
                                                let action = data
                                                    .get("action")
                                                    .and_then(|v| v.as_str())
                                                    .or_else(|| {
                                                        data.get("data")
                                                            .and_then(|d| d.get("action"))
                                                            .and_then(|v| v.as_str())
                                                    })
                                                    .unwrap_or("unknown");
                                                let ok = data
                                                    .get("ok")
                                                    .and_then(|v| v.as_i64())
                                                    .unwrap_or(1);
                                                let error_code = data
                                                    .get("error")
                                                    .cloned()
                                                    .unwrap_or(serde_json::json!(0));
                                                let message = data
                                                    .get("message")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("");

                                                tracing::info!(
                                                    "[播放器命令结果] 房间标识: {} | action={} ok={} error={} message={}",
                                                    rid,
                                                    action,
                                                    ok,
                                                    error_code,
                                                    message
                                                );

                                                // 【重构】使用 AppState 提供的统一 send_room_push 接口
                                                state_clone.send_room_push(&rid, serde_json::json!({
                                                    "type": "commandResult",
                                                    "action": action,
                                                    "ok": ok,
                                                    "error": error_code,
                                                    "message": message,
                                                    "source": data.get("source").cloned().unwrap_or(serde_json::json!("player")),
                                                    "raw": data.get("raw").cloned().unwrap_or(serde_json::Value::Null),
                                                    "timestamp": chrono::Utc::now().timestamp_millis()
                                                }));
                                            } else {
                                                tracing::warn!(
                                                    "收到播放器 command 结果但连接 {} 尚未加入房间",
                                                    tid2
                                                );
                                            }
                                        } else if msg_type == "ping" {
                                            // 收到业务心跳，立即回复 pong
                                            let pong = serde_json::json!({
                                                "type": "pong",
                                                "timestamp": chrono::Utc::now().timestamp_millis()
                                            });
                                            let _ = direct_tx2
                                                .send(Message::Text(pong.to_string().into()))
                                                .await;
                                            tracing::info!(
                                                "[WS] 已响应终端 {} 的心跳请求 (pong)",
                                                t_name_for_recv
                                            );
                                        }
                                    }
                                }
                            }
                            Message::Close(_) => break,
                            Message::Ping(payload) => {
                                let _ = direct_tx2.send(Message::Pong(payload)).await;
                            }
                            Message::Pong(_) => {
                                tracing::trace!(
                                    "[WS-PINGER] Received PONG from terminal: {} ({})",
                                    t_name_for_recv,
                                    client_ip_for_recv
                                );
                            }
                            _ => {}
                        }
                    }
                    Some(Err(e)) => {
                        let err_str = format!("{:?}", e);
                        if err_str.contains("ResetWithoutClosingHandshake") {
                            // 这种错误通常是浏览器刷新或直接关闭标签页导致的，属于正常现象，降级为 DEBUG 避免误导
                            tracing::debug!(
                                "WebSocket 连接正常重置 [{} ({})]: {}",
                                t_name_for_recv,
                                client_ip_for_recv,
                                err_str
                            );
                        } else {
                            tracing::error!(
                                "WebSocket接收错误 [{} ({})]: {:?}",
                                t_name_for_recv,
                                client_ip_for_recv,
                                e
                            );
                        }
                        break;
                    }
                    None => break,
                }
            }
        });

        // 等待任一任务结束
        tokio::select! {
            _ = send_task => {},
            _ = recv_task => {},
        }

        // 清理连接
        {
            let mut conns = self.connections.write().await;
            conns.remove(&connection_id);
        }

        if let Err(err) =
            RoomService::mark_room_client_connection_disconnected(pool, &connection_id).await
        {
            tracing::warn!("删除房间客户端连接记录失败 [{}]: {:?}", connection_id, err);
        }

        // Device liveness belongs to verified per-interface heartbeats.
        tracing::info!("WebSocket 连接断开: {} ({})", t_name, clientIp);
    }

    /// 获取所有在线连接详情
    pub async fn get_connections(&self) -> Vec<ConnectionInfo> {
        self.connections.read().await.values().cloned().collect()
    }
}

fn room_channel_matches(target: &str, subscribed: &str) -> bool {
    !subscribed.is_empty() && target == subscribed
}

async fn is_room_player_ip(pool: &sqlx::SqlitePool, room_id: &str, ip: &str) -> bool {
    let terminal_id: Option<String> = sqlx::query_scalar("SELECT terminalId FROM rooms WHERE id=?")
        .bind(room_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    if let Some(terminal_id) = terminal_id {
        crate::services::terminal_service::TerminalService::has_ip(pool, &terminal_id, ip)
            .await
            .unwrap_or(false)
    } else {
        false
    }
}

#[cfg(test)]
mod idle_media_notification_tests {
    use super::*;
    use crate::api::system_handler::{
        scan_idle_media, update_setting, IdleMediaScanQuery, UpdateSettingRequest,
    };
    use axum::extract::{Path, Query, State};
    use axum::Json;
    use serde_json::json;

    #[tokio::test]
    async fn saved_idle_directory_notifies_clients_and_refreshes_only_idle_rooms() {
        let temp = tempfile::tempdir().unwrap();
        for name in ["old", "new"] {
            std::fs::create_dir(temp.path().join(name)).unwrap();
            std::fs::write(temp.path().join(name).join("1001.mp4"), b"test").unwrap();
        }
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::db::run_migrations(&db).await.unwrap();
        sqlx::query("INSERT INTO terminals (id, name, terminalIp) VALUES ('idle-terminal', 'Idle', '192.0.2.10'), ('active-terminal', 'Active', '192.0.2.11')")
            .execute(&db).await.unwrap();
        sqlx::query("INSERT INTO rooms (id, name, terminalId, playState) VALUES ('idle-room', 'Idle', 'idle-terminal', 2), ('active-room', 'Active', 'active-terminal', 2)")
            .execute(&db).await.unwrap();
        sqlx::query("INSERT INTO room_queue (id, roomId, songId, status) VALUES ('active-row', 'active-room', 'song-1', 1)")
            .execute(&db).await.unwrap();
        // A cached room record must not leak its last requested song into idle state.
        sqlx::query("UPDATE rooms SET currentSongId = 'old-song' WHERE id = 'idle-room'")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('media_root', ?)")
            .bind(temp.path().to_string_lossy().as_ref())
            .execute(&db)
            .await
            .unwrap();
        let config = serde_json::from_value(json!({
            "server": {"host": "192.0.2.1", "port": 9898, "workers": 1},
            "database": {"url": "sqlite::memory:", "max_connections": 1},
            "song_db": {"url": "sqlite::memory:", "max_connections": 1},
            "cloud": {"api_base_url": "", "api_key": "", "download_dir": ""},
            "scanner": {"interval_secs": 30},
            "jwt": {"secret": "test-only", "expire_hours": 1},
            "storage": {"songs_dir": "", "mv_dir": "", "media_root": ""}
        }))
        .unwrap();
        let ws = Arc::new(WsManager::new());
        let mut rx = ws.broadcast_tx.subscribe();
        let state = crate::AppState {
            db: db.clone(),
            song_db: db.clone(),
            config: Arc::new(config),
            ws,
            scan_service: crate::services::song_path_matcher_service::SongPathMatcherService::new(),
            singer_image_match_service:
                crate::services::singer_image_match_service::SingerImageMatchService::new(),
            iptv_service: crate::services::iptv_service::IptvService::new(),
            room_cache: Arc::new(dashmap::DashMap::new()),
            room_cache_sync: Arc::new(tokio::sync::Mutex::new(())),
            log_tx: broadcast::channel(10).0,
            server_bind_ip: "192.0.2.1".parse().unwrap(),
            discovery_broadcast_ip: "192.0.2.255".parse().unwrap(),
            config_path: Arc::new(temp.path().join("config.toml")),
            license: crate::license::LicenseManager::new(temp.path().join("license.json")),
        };

        for directory in ["old", "new", "new"] {
            let saved_response = update_setting(
                State(state.clone()),
                Path("idle_song_path".into()),
                Json(UpdateSettingRequest {
                    value: directory.into(),
                }),
            )
            .await
            .unwrap();
            assert_eq!(saved_response.0.data.unwrap().value, directory);
            let notice = rx
                .try_recv()
                .expect("saved settings must notify all clients");
            assert!(notice.targetRoomId.is_none());
            assert_eq!(notice.payload["type"], "roomStateChanged");
            assert_eq!(notice.payload["path"], "/api/v1/idle-media/scan");
            assert!(notice.payload.get("data").is_none());
            let saved: String = sqlx::query_scalar(
                "SELECT value FROM system_settings WHERE key = 'idle_song_path'",
            )
            .fetch_one(&db)
            .await
            .unwrap();
            assert_eq!(saved, directory);
            let scan = scan_idle_media(
                State(state.clone()),
                Query(IdleMediaScanQuery {
                    media_root: None,
                    idle_song_path: None,
                }),
            )
            .await
            .unwrap()
            .0
            .data
            .unwrap();
            assert_eq!(scan.idle_song_path, directory);
            assert_eq!(scan.files, vec!["1001.mp4"]);
            let room = rx
                .try_recv()
                .expect("idle room must receive the new media path");
            assert_eq!(room.targetRoomId.as_deref(), Some("idle-room"));
            assert_eq!(room.payload["roomId"], "192.0.2.10");
            assert_eq!(room.payload["data"]["roomId"], "192.0.2.10");
            assert_eq!(room.payload["data"]["currentSongId"], "IDLE");
            assert_eq!(room.payload["data"]["currentSongTitle"], "空闲播放");
            assert_eq!(room.payload["data"]["playingNow"]["songId"], "IDLE");
            assert_eq!(room.payload["data"]["playingNow"]["songName"], "空闲播放");
            assert!(room.payload["data"]["playingNow"]
                .get("queueItemId")
                .is_none());
            assert_eq!(
                room.payload["data"]["playingNow"]["songPath"],
                format!("/media/{directory}/1001.mp4")
            );
            assert_eq!(room.payload["data"]["playState"], 2);
            assert!(
                rx.try_recv().is_err(),
                "active queued song must not be restarted"
            );
        }
        assert!(update_setting(
            State(state.clone()),
            Path("idle_song_path".into()),
            Json(UpdateSettingRequest {
                value: "missing".into()
            })
        )
        .await
        .is_err());
        assert!(
            rx.try_recv().is_err(),
            "invalid settings must not notify clients"
        );
        let _ = update_setting(
            State(state.clone()),
            Path("unrelated_setting".into()),
            Json(UpdateSettingRequest {
                value: "value".into(),
            }),
        )
        .await
        .unwrap();
        assert!(
            rx.try_recv().is_err(),
            "unrelated settings must not notify clients"
        );
        let _ = update_setting(
            State(state.clone()),
            Path("media_root".into()),
            Json(UpdateSettingRequest {
                value: temp.path().to_string_lossy().into_owned(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(
            rx.try_recv().unwrap().payload["path"],
            "/api/v1/idle-media/scan"
        );
        assert_eq!(
            rx.try_recv().unwrap().targetRoomId.as_deref(),
            Some("idle-room")
        );
        let active: (i32, i32) = sqlx::query_as("SELECT r.playState, q.status FROM rooms r JOIN room_queue q ON q.roomId = r.id WHERE r.id = 'active-room'")
            .fetch_one(&db).await.unwrap();
        assert_eq!(active, (2, 1));
    }
}
