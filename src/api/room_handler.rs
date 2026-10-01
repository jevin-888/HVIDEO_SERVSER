use crate::services::auth_service::Claims;
use axum::{
    extract::{ConnectInfo, Extension, Path, Query, State},
    Json,
};
use serde_json::json;
use std::{collections::HashMap, net::SocketAddr};

use crate::utils::{idle_media, media_path};
use crate::{
    errors::{AppError, AppResult},
    models::{
        common::ApiResponse,
        room::{
            ACControlRequest, AddToQueueRequest, AmbianceRequest, ControlButtonRequest,
            ControlVoiceRequest, CreateRoomRequest, EffectControlRequest, LightControlRequest,
            PrioritizeRequest, Room, RoomCommand, RoomQueueItem, RoomWithTerminalInfo,
            ServiceCallRequest, UpdateRoomRequest,
        },
    },
    services::{activity_service::ActivityService, room_service::RoomService},
    AppState,
};

const ROOM_VOD_TARGET_LAYER_KEY_PREFIX: &str = "room_vod_target_layer:";

const ROOM_SYNC_STATE_LENGTH: usize = 9;
const DISPLAY_MODE_SYNC_INDEX: usize = 5;
const SCENE_LOCK_SYNC_INDEX: usize = 8;

fn default_room_sync_state() -> Vec<serde_json::Value> {
    let mut sync_state = vec![serde_json::Value::Null; ROOM_SYNC_STATE_LENGTH];
    sync_state[DISPLAY_MODE_SYNC_INDEX] = json!(0);
    sync_state[SCENE_LOCK_SYNC_INDEX] = json!(0);
    sync_state
}

fn normalize_room_sync_values(values: &[serde_json::Value]) -> Vec<serde_json::Value> {
    let mut normalized = default_room_sync_state();
    for (index, value) in values.iter().take(ROOM_SYNC_STATE_LENGTH).enumerate() {
        normalized[index] = value.clone();
    }
    if normalized[DISPLAY_MODE_SYNC_INDEX].is_null() {
        normalized[DISPLAY_MODE_SYNC_INDEX] = json!(0);
    }
    if normalized[SCENE_LOCK_SYNC_INDEX].is_null() {
        normalized[SCENE_LOCK_SYNC_INDEX] = json!(0);
    }
    normalized
}

fn normalize_room_sync_state(value: Option<&str>) -> Vec<serde_json::Value> {
    let Some(raw) = value else {
        return default_room_sync_state();
    };
    let Ok(serde_json::Value::Array(values)) = serde_json::from_str(raw) else {
        return default_room_sync_state();
    };
    normalize_room_sync_values(&values)
}

async fn load_room_sync_state(db: &sqlx::SqlitePool, room_id: &str) -> Vec<serde_json::Value> {
    let raw =
        sqlx::query_scalar::<_, String>("SELECT syncState FROM room_sync_states WHERE roomId = ?")
            .bind(room_id)
            .fetch_optional(db)
            .await
            .ok()
            .flatten();
    normalize_room_sync_state(raw.as_deref())
}

async fn save_room_sync_state(
    db: &sqlx::SqlitePool,
    room_id: &str,
    sync_state: &[serde_json::Value],
) -> AppResult<()> {
    let normalized = normalize_room_sync_values(sync_state);
    let serialized = serde_json::to_string(&normalized).map_err(|error| {
        AppError::Internal(anyhow::anyhow!("serialize room sync state: {error}"))
    })?;
    sqlx::query(
        "INSERT INTO room_sync_states (roomId, syncState, updatedAt)
         VALUES (?, ?, datetime('now','localtime'))
         ON CONFLICT(roomId) DO UPDATE SET
             syncState = excluded.syncState,
             updatedAt = excluded.updatedAt",
    )
    .bind(room_id)
    .bind(serialized)
    .execute(db)
    .await?;
    Ok(())
}

fn idle_media_play_state(room_play_state: i32) -> i32 {
    if room_play_state == 2 {
        2
    } else {
        1
    }
}

/// 真正的自然排序键：把文件名中的连续数字补零到 20 位，其余保持原样
async fn public_media_path(db: &sqlx::SqlitePool, raw_path: String) -> String {
    let media_roots = sqlx::query_scalar::<_, String>(
        "SELECT value FROM system_settings WHERE key = 'media_root'",
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .unwrap_or_default();
    media_path::public_media_url(&raw_path, &media_roots)
}

/// 空闲视频文件列表 TTL 缓存（60 秒）。当前选中项按房间保存，
/// 普通状态同步只返回当前项，只有明确的 next/skip 操作才推进到下一项。
struct IdleCache {
    files: Vec<String>,
    refreshed_at: std::time::Instant,
    media_root: String,
    idle_song_path: String,
    selected_by_room: HashMap<String, String>,
}

#[derive(Clone, Copy)]
enum IdleSelection {
    Current,
    Advance,
}

impl IdleCache {
    fn select_file(&mut self, room_id: &str, selection: IdleSelection) -> Option<String> {
        if self.files.is_empty() {
            self.selected_by_room.remove(room_id);
            return None;
        }

        let current_index = self
            .selected_by_room
            .get(room_id)
            .and_then(|selected| self.files.iter().position(|file| file == selected));
        let selected_index = match (selection, current_index) {
            (IdleSelection::Current, Some(index)) => index,
            (IdleSelection::Advance, Some(index)) => (index + 1) % self.files.len(),
            (_, None) => 0,
        };
        let file = self.files[selected_index].clone();
        self.selected_by_room
            .insert(room_id.to_string(), file.clone());
        Some(file)
    }
}

static IDLE_CACHE: tokio::sync::Mutex<Option<IdleCache>> = tokio::sync::Mutex::const_new(None);

pub async fn broadcast_idle_media_changed(state: &AppState) -> AppResult<()> {
    *IDLE_CACHE.lock().await = None;
    state.ws.broadcast(crate::ws::idle_media_changed_message());
    tracing::info!("[idle] media settings saved; broadcast idle-media list refresh");

    // Refresh idle playback as well as the list, including players stopped on a stale URL.
    let room_ids = sqlx::query_scalar::<_, String>(
        "SELECT r.id FROM rooms r WHERE NOT EXISTS (
            SELECT 1 FROM room_queue q WHERE q.roomId = r.id AND q.status = 1
        )",
    )
    .fetch_all(&state.db)
    .await?;
    for room_id in room_ids {
        if let Err(error) = broadcast_room_state_sync(state, &room_id).await {
            tracing::warn!(
                "[idle] room state refresh failed: room_id={}, error={:?}",
                room_id,
                error
            );
        }
    }
    Ok(())
}

async fn idle_file(
    db: &sqlx::SqlitePool,
    room_id: &str,
    selection: IdleSelection,
) -> Option<String> {
    let mut guard = IDLE_CACHE.lock().await;
    let media_root = sqlx::query_scalar::<_, String>(
        "SELECT value FROM system_settings WHERE key = 'media_root'",
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .unwrap_or_default();
    let idle_song_path = sqlx::query_scalar::<_, String>(
        "SELECT value FROM system_settings WHERE key = 'idle_song_path'",
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .unwrap_or_default();
    let idle_song_path = idle_media::normalize_idle_song_path(&idle_song_path);

    let needs_refresh = match *guard {
        None => true,
        Some(ref cache) => {
            cache.media_root != media_root
                || cache.idle_song_path != idle_song_path
                || cache.refreshed_at.elapsed().as_secs() >= 60
        }
    };

    if needs_refresh {
        tracing::info!(
            "[idle] refreshing idle media cache: media_root={}, idle_song_path={}",
            media_root,
            idle_song_path
        );
        let scan = idle_media::scan_idle_media(&media_root, &idle_song_path).await;
        let files = scan.files;
        tracing::info!(
            "[idle] idle media scan completed: scanned_dirs={:?}, found_count={}",
            scan.scanned_dirs,
            files.len()
        );

        let same_source = guard.as_ref().is_some_and(|cache| {
            cache.media_root == media_root && cache.idle_song_path == idle_song_path
        });
        let mut selected_by_room = if same_source {
            guard
                .as_ref()
                .map(|cache| cache.selected_by_room.clone())
                .unwrap_or_default()
        } else {
            HashMap::new()
        };
        selected_by_room.retain(|_, selected| files.contains(selected));
        let found_count = files.len();
        *guard = Some(IdleCache {
            files,
            refreshed_at: std::time::Instant::now(),
            media_root,
            idle_song_path,
            selected_by_room,
        });
        tracing::info!(
            "[idle] idle media cache refreshed: found_count={}",
            found_count
        );
    }

    match *guard {
        Some(ref mut cache) => {
            let file = cache.select_file(room_id, selection);
            if let Some(ref selected) = file {
                let selected_index = cache
                    .files
                    .iter()
                    .position(|item| item == selected)
                    .unwrap_or(0);
                let idle_public_dir =
                    idle_media::idle_song_public_path(&cache.media_root, &cache.idle_song_path)?;
                let relative_path = if idle_public_dir.is_empty() {
                    selected.clone()
                } else {
                    format!("{}/{}", idle_public_dir, selected)
                };
                let public_path = media_path::public_media_url_from_relative(&relative_path);
                tracing::info!(
                    "[idle] selected idle media: room_id={}, index={}/{}, song_path={}",
                    room_id,
                    selected_index + 1,
                    cache.files.len(),
                    public_path
                );
                Some(public_path)
            } else {
                tracing::warn!(
                    "[idle] no idle media files found: media_root={}, idle_song_path={}",
                    cache.media_root,
                    cache.idle_song_path
                );
                None
            }
        }
        None => None,
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct SetVolumeRequest {
    pub volume: i32,
}
#[derive(Debug, serde::Deserialize)]
pub struct SetMicRequest {
    pub enabled: bool,
}
#[derive(Debug, serde::Deserialize)]
pub struct CreateAreaRequest {
    pub name: String,
}
#[derive(Debug, serde::Deserialize)]
pub struct CreateTypeRequest {
    pub name: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct ListRoomsByTerminalQuery {
    pub terminalIp: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchTrackRequest {
    pub trackId: i32,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlayerSkipRequest {
    pub queue_item_id: String,
}

pub async fn get_full_room_state_json(
    state: &AppState,
    room: &RoomWithTerminalInfo,
) -> AppResult<serde_json::Value> {
    let musicVolume = room.musicVolume.unwrap_or(room.volume);
    let micVolume = room.micVolume.unwrap_or(50);
    let sync_state = load_room_sync_state(&state.db, &room.id).await;
    let public_room_id = room
        .roomIp
        .as_deref()
        .map(str::trim)
        .filter(|value| value.parse::<std::net::IpAddr>().is_ok())
        .ok_or_else(|| AppError::BadRequest("room must be bound to a terminal IP".into()))?;
    let mut state_data = json!({
        "roomId": public_room_id,
        "roomName": room.name,
        "status": room.status,
        "playState": room.playState,
        "volume": room.volume,
        "musicVolume": musicVolume,
        "micVolume": micVolume,
        "micStatus": room.micStatus,
        "mute": room.muteStatus == 1,
        "ac": serde_json::from_str::<serde_json::Value>(&room.acState).unwrap_or_default(),
        "light": serde_json::from_str::<serde_json::Value>(&room.lightState).unwrap_or_default(),
        "effect": serde_json::from_str::<serde_json::Value>(&room.effectState).unwrap_or_default(),
        "syncState": sync_state,
    });

    let queue = RoomService::get_queue(&state.db, &room.id).await?;
    let playing = queue.iter().find(|item| item.status == 1);
    if playing.is_none() && !queue.is_empty() {
        tracing::warn!(
            "[room-state] queue contains waiting items but no active item: roomId={}, waitingCount={}",
            room.id,
            queue.iter().filter(|item| item.status == 0).count()
        );
    }

    if let Some(item) = playing {
        let final_path = public_queue_item_path(state, item).await?;
        let source_type = if item.video_file_type.eq_ignore_ascii_case("youtube") {
            "youtube"
        } else {
            "local"
        };
        state_data["playingNow"] = json!({
            "queueItemId": item.id,
            "songId": item.songId,
            "songName": item.songName,
            "songPath": final_path,
            "track": item.track,
            "lightCode": item.light_code,
            "categoryCode": item.categoryCode,
            "sourceType": source_type,
        });
    } else {
        let idle_file = idle_file(&state.db, &room.id, IdleSelection::Current).await;
        state_data["playingNow"] = json!({
            "songId": "IDLE",
            "songName": if idle_file.is_some() { "空闲播放" } else { "暂无空闲歌曲" },
            "songPath": idle_file.unwrap_or_default(),
        });
        state_data["playState"] = json!(idle_media_play_state(room.playState));
    }
    // Summary fields describe the same playback, never an older rooms row.
    state_data["currentSongId"] = state_data["playingNow"]["songId"].clone();
    state_data["currentSongTitle"] = state_data["playingNow"]["songName"].clone();

    Ok(state_data)
}

pub async fn broadcast_room_state_sync(state: &AppState, roomId: &str) -> AppResult<()> {
    // Keep snapshot construction and publication ordered. Releasing the cache
    // lock after only the room read allowed an older, slower snapshot to be
    // published after a newer pause/queue transition.
    let _guard = state.room_cache_sync.lock().await;
    let room = RoomService::get_by_id_with_song_title(&state.db, roomId).await?;
    state.room_cache.insert(roomId.to_string(), room.clone());

    // IP reclamation keeps the offline room available for management. There is
    // no player address to publish until its terminal connects again.
    if room.roomIp.as_deref().is_none_or(|ip| ip.trim().is_empty()) {
        return Ok(());
    }

    let full_state = get_full_room_state_json(state, &room).await?;
    let playing_song_id = full_state
        .pointer("/playingNow/songId")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let playing_song_path = full_state
        .pointer("/playingNow/songPath")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    tracing::info!(
        "[room-state] broadcasting: roomId={}, songId={}, songPath={}",
        roomId,
        playing_song_id,
        playing_song_path
    );

    state.send_room_push(
        roomId,
        json!({
            "type": "roomStateChanged",
            "roomId": full_state["roomId"].clone(),
            "data": full_state,
            "timestamp": chrono::Utc::now().timestamp_millis()
        }),
    );
    Ok(())
}

async fn public_queue_item_path(state: &AppState, item: &RoomQueueItem) -> AppResult<String> {
    if item.video_file_type.eq_ignore_ascii_case("youtube") {
        // Stable identifiers survive address expiry and server restarts.
        let video_id = item
            .songNo
            .strip_prefix("youtube:")
            .ok_or_else(|| AppError::BadRequest("invalid YouTube queue songNo".into()))?;
        return crate::services::youtube_media_service::stream_proxy_path(video_id);
    }

    let raw_path = media_path::join_path_and_file(&item.relativePath, &item.fileName);
    Ok(public_media_path(&state.db, raw_path).await)
}

async fn sync_room_cache(state: &AppState, roomId: &str) -> AppResult<RoomWithTerminalInfo> {
    let _guard = state.room_cache_sync.lock().await;
    let room = RoomService::get_by_id_with_song_title(&state.db, roomId).await?;
    state.room_cache.insert(roomId.to_string(), room.clone());
    Ok(room)
}

/// 查询当前播放歌曲的物理轨道
async fn get_current_track(db: &sqlx::SqlitePool, roomId: &str) -> Option<i32> {
    sqlx::query_scalar::<_, i32>(
        "SELECT track FROM room_queue WHERE roomId = ? AND status = 1 ORDER BY position ASC LIMIT 1",
    )
    .bind(roomId)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
}

fn map_track_intent(intent: i32, physical_track: Option<i32>) -> i32 {
    let pt = physical_track.unwrap_or(2);
    match pt {
        2 => {
            if intent == 1 {
                2
            } else {
                1
            }
        }
        3 => {
            if intent == 1 {
                1
            } else {
                2
            }
        }
        4 => {
            if intent == 1 {
                2
            } else {
                1
            }
        }
        5 => {
            if intent == 1 {
                1
            } else {
                2
            }
        }
        _ => intent + 1,
    }
}

/// 仅广播播放列表变更信号
pub async fn broadcast_playlist_sync(state: &AppState, roomId: &str) -> AppResult<()> {
    state.send_room_push(roomId, json!({ "type": "playListChanged" }));
    Ok(())
}

/// 完整广播同步（列表 + 状态）
pub async fn broadcast_room_sync(state: &AppState, roomId: &str) -> AppResult<()> {
    // 🆕 调换顺序：先推送状态，再推送列表变更信号。
    // 这样可以让大屏及时更新当前播放，减少由于 playListChanged 触发的冗余拉取。
    broadcast_room_state_sync(state, roomId).await?;
    broadcast_playlist_sync(state, roomId).await?;
    Ok(())
}

// --- Handler Implementations ---

pub async fn list_rooms_by_terminal(
    State(state): State<AppState>,
    Query(q): Query<ListRoomsByTerminalQuery>,
) -> AppResult<Json<ApiResponse<Vec<RoomWithTerminalInfo>>>> {
    let ip = q.terminalIp.as_deref().unwrap_or("").trim();
    if ip.is_empty() {
        return Err(AppError::BadRequest("缺少 terminalIp".into()));
    }
    Ok(Json(ApiResponse::success(
        RoomService::list_by_terminal_ip(&state.db, ip).await?,
    )))
}

pub async fn list_rooms(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<RoomWithTerminalInfo>>>> {
    Ok(Json(ApiResponse::success(
        RoomService::list_all_with_terminal_info(&state.db).await?,
    )))
}

pub async fn create_room(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateRoomRequest>,
) -> AppResult<Json<ApiResponse<Room>>> {
    let room = RoomService::create(&state.db, req).await?;
    state.ws.broadcast(json!({"type": "terminals_updated"}));
    ActivityService::record(
        &state.db,
        &claims.sub,
        "create_room",
        "room",
        &room.id,
        &format!("创建房间 {}", room.name),
        "",
    )
    .await?;
    Ok(Json(ApiResponse::success(room)))
}

pub async fn get_room(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<Room>>> {
    Ok(Json(ApiResponse::success(
        RoomService::get_by_id(&state.db, &id).await?,
    )))
}

pub async fn get_room_state(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    let room = sync_room_cache(&state, &rid).await?;
    Ok(Json(ApiResponse::success(
        get_full_room_state_json(&state, &room).await?,
    )))
}

pub async fn update_room(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<UpdateRoomRequest>,
) -> AppResult<Json<ApiResponse<Room>>> {
    let updates_name = req.name.is_some();
    let room = RoomService::update(&state.db, &id, req).await?;
    if updates_name {
        state.ws.broadcast(json!({"type": "terminals_updated"}));
    }
    ActivityService::record(
        &state.db,
        &claims.sub,
        "update_room",
        "room",
        &id,
        &format!("更新房间 {}", room.name),
        "",
    )
    .await?;
    state.broadcast_cashier_room_changed(&id, json!(room.status), "update_room");
    broadcast_room_sync(&state, &id).await?;
    Ok(Json(ApiResponse::success(room)))
}

pub async fn delete_room(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    let room = RoomService::get_by_id(&state.db, &id).await.ok();
    RoomService::delete(&state.db, &id).await?;
    ActivityService::record(
        &state.db,
        &claims.sub,
        "delete_room",
        "room",
        &id,
        &format!(
            "删除房间 {}",
            room.as_ref().map(|r| r.name.as_str()).unwrap_or(&id)
        ),
        "",
    )
    .await?;
    Ok(Json(ApiResponse::success(())))
}

pub async fn get_queue(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<Vec<RoomQueueItem>>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    let mut queue = RoomService::get_queue(&state.db, &rid).await?;
    for item in &mut queue {
        item.relativePath = public_queue_item_path(&state, item).await?;
        item.fileName.clear();
    }
    Ok(Json(ApiResponse::success(queue)))
}

pub async fn get_played_queue(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<Vec<RoomQueueItem>>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    Ok(Json(ApiResponse::success(
        RoomService::get_played_queue(&state.db, &rid).await?,
    )))
}

pub async fn add_to_queue(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<AddToQueueRequest>,
) -> AppResult<Json<ApiResponse<RoomQueueItem>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;

    let inserted = RoomService::add_to_queue(&state.db, &state.song_db, &rid, req).await?;
    let item = RoomService::finalize_queue_enqueue(&state.db, &rid, &inserted.id).await?;

    // Queue insertion is the request's critical path. Full room-state
    // broadcasting performs additional database and media-path work, so send
    // it after the response is ready instead of making the PAD wait for it.
    let broadcast_state = state.clone();
    let broadcast_room_id = rid.clone();
    tokio::spawn(async move {
        let result = if item.status == 1 {
            broadcast_room_sync(&broadcast_state, &broadcast_room_id).await
        } else {
            broadcast_playlist_sync(&broadcast_state, &broadcast_room_id).await
        };
        if let Err(error) = result {
            tracing::warn!(
                room_id = %broadcast_room_id,
                ?error,
                "queue broadcast failed after enqueue"
            );
        }
    });
    Ok(Json(ApiResponse::success(item)))
}

// --- 切歌逻辑 ---

pub async fn next_song(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let clientIp = addr.ip().to_string();
    tracing::info!(
        "[HTTP] manual next request: source={}, roomPath={}",
        clientIp,
        id
    );

    let rid = RoomService::resolve_room_id(&state.db, &id, &clientIp).await?;
    let result = RoomService::next_song(&state.db, &rid, 3).await?;
    if !result.advanced {
        // 空闲媒体没有活动队列行；手动切歌仍需轮换文件并广播房态。
        if idle_file(&state.db, &rid, IdleSelection::Advance)
            .await
            .is_none()
        {
            return Ok(Json(ApiResponse::success(json!({ "advanced": false }))));
        }
    } else if result.next.is_none() {
        idle_file(&state.db, &rid, IdleSelection::Advance).await;
    }

    broadcast_room_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(json!({ "advanced": true }))))
}

pub async fn prioritize_song(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<PrioritizeRequest>,
) -> AppResult<Json<ApiResponse<()>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    RoomService::prioritize_song(&state.db, &rid, &req.songId).await?;
    broadcast_playlist_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(())))
}

pub async fn clear_queue(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    RoomService::clear_queue(&state.db, &rid).await?;
    broadcast_playlist_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(())))
}

pub async fn delete_from_queue(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path((id, songId)): Path<(String, String)>,
) -> AppResult<Json<ApiResponse<()>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    RoomService::delete_from_queue(&state.db, &rid, &songId).await?;
    // Deleting may target the active row, so publish authoritative state and queue.
    broadcast_room_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(())))
}

pub async fn shuffle_queue(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    RoomService::shuffle_queue(&state.db, &rid).await?;
    broadcast_playlist_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(())))
}

async fn set_room_mute_state(db: &sqlx::SqlitePool, room_id: &str, muted: bool) -> AppResult<i32> {
    if muted {
        sqlx::query("UPDATE rooms SET muteStatus = 1, volume = 0 WHERE id = ?")
            .bind(room_id)
            .execute(db)
            .await?;
        return Ok(0);
    }

    let restore_volume = sqlx::query_scalar::<_, i32>(
        "SELECT COALESCE(musicVolume, volume) FROM rooms WHERE id = ?",
    )
    .bind(room_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("房间不存在: {}", room_id)))?;

    sqlx::query("UPDATE rooms SET muteStatus = 0, volume = ? WHERE id = ?")
        .bind(restore_volume)
        .bind(room_id)
        .execute(db)
        .await?;
    Ok(restore_volume)
}

fn room_command_push_message(
    command: &RoomCommand,
    restored_volume: Option<i32>,
) -> serde_json::Value {
    let mut message = json!({ "type": "command", "source": "ktv" });

    if let serde_json::Value::Object(map) =
        serde_json::to_value(command).expect("RoomCommand serialization must succeed")
    {
        for (key, value) in map {
            message[key] = value;
        }
    }

    if let Some(volume) = restored_volume {
        message["volume"] = json!(volume);
    }
    message
}

pub async fn send_command(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(payload): Json<serde_json::Value>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    tracing::info!(
        "[HTTP] room command received: source={}, path={}, payload={}",
        addr.ip(),
        id,
        payload
    );
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    let command: RoomCommand = serde_json::from_value(payload)
        .map_err(|error| AppError::BadRequest(format!("invalid room command: {error}")))?;

    let mut should_sync_state = false;
    let message = match &command {
        RoomCommand::Play => {
            RoomService::update_play_state(&state.db, &rid, 1).await?;
            should_sync_state = true;
            Some(room_command_push_message(&command, None))
        }
        RoomCommand::Pause => {
            RoomService::update_play_state(&state.db, &rid, 2).await?;
            should_sync_state = true;
            Some(room_command_push_message(&command, None))
        }
        RoomCommand::Replay => Some(room_command_push_message(&command, None)),
        RoomCommand::Mute => {
            set_room_mute_state(&state.db, &rid, true).await?;
            should_sync_state = true;
            Some(room_command_push_message(&command, None))
        }
        RoomCommand::Unmute => {
            let restored_volume = set_room_mute_state(&state.db, &rid, false).await?;
            should_sync_state = true;
            Some(room_command_push_message(&command, Some(restored_volume)))
        }
        RoomCommand::SetVolume { volume } => {
            if !(0..=100).contains(volume) {
                return Err(AppError::BadRequest(
                    "volume must be in the range 0..100".to_string(),
                ));
            }
            sqlx::query(
                "UPDATE rooms
                 SET volume = ?, musicVolume = ?, muteStatus = 0,
                     updatedAt = datetime('now','localtime')
                 WHERE id = ?",
            )
            .bind(volume)
            .bind(volume)
            .bind(&rid)
            .execute(&state.db)
            .await?;
            should_sync_state = true;
            Some(room_command_push_message(&command, None))
        }
        RoomCommand::SetMic { enabled } => {
            let mic_status = i32::from(*enabled);
            sqlx::query(
                "UPDATE rooms SET micStatus = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
            )
            .bind(mic_status)
            .bind(&rid)
            .execute(&state.db)
            .await?;
            should_sync_state = true;
            None
        }
        RoomCommand::MicOn | RoomCommand::MicOff => {
            let mic_status = i32::from(matches!(&command, RoomCommand::MicOn));
            sqlx::query(
                "UPDATE rooms SET micStatus = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
            )
            .bind(mic_status)
            .bind(&rid)
            .execute(&state.db)
            .await?;
            should_sync_state = true;
            None
        }
        RoomCommand::SwitchTrack { trackId } => {
            let mic_status = match *trackId {
                0 | 2 | 4 => 0,
                1 | 3 | 5 => 1,
                _ => {
                    return Err(AppError::BadRequest(
                        "trackId must be one of 0, 1, 2, 3, 4, 5".to_string(),
                    ));
                }
            };
            sqlx::query(
                "UPDATE rooms SET micStatus = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
            )
            .bind(mic_status)
            .bind(&rid)
            .execute(&state.db)
            .await?;
            let physical_track = if *trackId <= 1 {
                map_track_intent(mic_status, get_current_track(&state.db, &rid).await)
            } else {
                *trackId
            };
            should_sync_state = true;
            Some(json!({
                "type": "command",
                "action": "SwitchTrack",
                "trackId": physical_track,
                "micStatus": mic_status,
                "source": "ktv"
            }))
        }
        RoomCommand::NextSong | RoomCommand::SkipSong => {
            return Err(AppError::BadRequest(
                "queue advancement must use the dedicated /next or /skip API".to_string(),
            ));
        }
        RoomCommand::AddSong { .. } => {
            return Err(AppError::BadRequest(
                "song selection must use the dedicated /queue API".to_string(),
            ));
        }
        RoomCommand::ClearQueue => {
            return Err(AppError::BadRequest(
                "queue clearing must use the dedicated /clear API".to_string(),
            ));
        }
        RoomCommand::SetAC { .. } => {
            return Err(AppError::BadRequest(
                "AC control must use the dedicated /peripheral/ac API".to_string(),
            ));
        }
        RoomCommand::SetLight { .. } => {
            return Err(AppError::BadRequest(
                "light control must use the dedicated /peripheral/light API".to_string(),
            ));
        }
        RoomCommand::SetEffect { .. } => {
            return Err(AppError::BadRequest(
                "effect control must use the dedicated /peripheral/effect API".to_string(),
            ));
        }
        RoomCommand::PlayAmbiance { .. } => {
            return Err(AppError::BadRequest(
                "ambiance playback must use the dedicated /ambiance API".to_string(),
            ));
        }
        RoomCommand::ServiceCall { .. } => {
            return Err(AppError::BadRequest(
                "service calls must use the dedicated /service-call API".to_string(),
            ));
        }
        RoomCommand::PlayMaterial { .. }
        | RoomCommand::PlayStream { .. }
        | RoomCommand::PlayUrl { .. }
        | RoomCommand::StopStream => {
            return Err(AppError::BadRequest(
                "media playback must use the dedicated media API".to_string(),
            ));
        }
        RoomCommand::None => {
            return Err(AppError::BadRequest(
                "None is not an executable command".to_string(),
            ));
        }
    };

    if let Some(message) = message {
        state.send_room_push(&rid, message);
    }
    if should_sync_state {
        broadcast_room_state_sync(&state, &rid).await?;
    }
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn play(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    RoomService::update_play_state(&state.db, &rid, 1).await?;
    let room = sync_room_cache(&state, &rid).await?;
    let pt = get_current_track(&state.db, &rid).await;
    state.send_room_push(&rid, json!({ "type": "command", "action": "Play", "trackId": map_track_intent(room.micStatus, pt), "source": "ktv" }));
    broadcast_room_state_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn pause(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    RoomService::update_play_state(&state.db, &rid, 2).await?;
    state.send_room_push(
        &rid,
        json!({ "type": "command", "action": "Pause", "source": "ktv" }),
    );
    broadcast_room_state_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn replay(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    let room = sync_room_cache(&state, &rid).await?;
    let pt = get_current_track(&state.db, &rid).await;
    state.send_room_push(&rid, json!({ "type": "command", "action": "Replay", "trackId": map_track_intent(room.micStatus, pt), "source": "ktv" }));
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn skip(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<PlayerSkipRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let clientIp = addr.ip().to_string();
    tracing::info!(
        "[HTTP] player completion received (skip): source={}, roomPath={}, queueItemId={}",
        clientIp,
        id,
        req.queue_item_id
    );

    let rid = RoomService::resolve_room_id(&state.db, &id, &clientIp).await?;

    // The player must identify the exact queue row that reached EOF. A delayed
    // or duplicate completion for an older row is an idempotent no-op.
    let result = RoomService::next_song_if_current(&state.db, &rid, 2, &req.queue_item_id).await?;
    if !result.advanced {
        tracing::warn!(
            "[HTTP] ignored stale or non-playing player skip: roomId={}, queueItemId={}",
            rid,
            req.queue_item_id
        );
        return Ok(Json(ApiResponse::success(json!({ "advanced": false }))));
    }
    if result.next.is_none() {
        idle_file(&state.db, &rid, IdleSelection::Advance).await;
    }

    broadcast_room_sync(&state, &rid).await?;

    Ok(Json(ApiResponse::success(json!({ "advanced": true }))))
}

pub async fn set_volume(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<SetVolumeRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    if req.volume < 0 || req.volume > 100 {
        return Err(AppError::BadRequest("音量必须在 0-100".into()));
    }
    let room = RoomService::get_by_id(&state.db, &rid).await?;
    if room.volume == req.volume && room.musicVolume == Some(req.volume) && room.muteStatus == 0 {
        return Ok(Json(ApiResponse::success(json!({}))));
    }

    sqlx::query("UPDATE rooms SET volume = ?, musicVolume = ?, muteStatus = 0, updatedAt = datetime('now','localtime') WHERE id = ?")
        .bind(req.volume)
        .bind(req.volume)
        .bind(&rid)
        .execute(&state.db)
        .await?;

    // 播控操作仅发送 command 指令
    state.send_room_push(
        &rid,
        json!({ "type": "command", "action": "SetVolume", "volume": req.volume, "source": "ktv" }),
    );
    broadcast_room_state_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn set_mic(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<SetMicRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    let s = if req.enabled { 1 } else { 0 };
    sqlx::query(
        "UPDATE rooms SET micStatus = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
    )
    .bind(s)
    .bind(&rid)
    .execute(&state.db)
    .await?;
    // micStatus is authoritative track intent; the full room state drives every player
    // through the same track-selection path on live updates and reconnects.
    broadcast_room_state_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn switch_track(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<SwitchTrackRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    tracing::info!(
        "🚀 [TRACK_REQUEST] Received switch track request: id={}, trackId={}",
        id,
        req.trackId
    );
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;

    // 1. 尝试从字典中识别该 trackId 的含义
    let dicts =
        crate::services::dictionary_service::DictionaryService::list(&state.song_db, Some("track"))
            .await
            .unwrap_or_default();
    tracing::debug!("Found {} dictionary entries for group 'track'", dicts.len());

    let mut intent: Option<i32> = None;
    let mut matched_physical_track_id: Option<i32> = None;

    // 优先遍历字典，找到匹配的物理轨道 ID 和意图
    for d in &dicts {
        if d.dict_code.as_deref() == Some(&req.trackId.to_string()) {
            let comment = d.dict_name.as_deref().unwrap_or("");
            tracing::info!(
                "🔍 [TRACK_MATCH] Matched dictionary: code={:?}, name={}",
                d.dict_code,
                comment
            );
            // 保存这个匹配的字典码（物理轨道 ID）
            matched_physical_track_id = Some(req.trackId);
            if comment.contains("主原")
                || comment.contains("左原")
                || (comment.contains("原") && !comment.contains("伴"))
            {
                intent = Some(1);
            } else if comment.contains("主伴")
                || comment.contains("左伴")
                || (comment.contains("伴") && !comment.contains("原"))
            {
                intent = Some(0);
            } else if comment.contains("原") && comment.find("原") < comment.find("伴") {
                intent = Some(1);
            } else if comment.contains("伴") {
                intent = Some(0);
            }
            break;
        }
    }

    // 如果字典中没找到，再用硬编码逻辑（兼容旧版）
    if intent.is_none() {
        intent = if req.trackId == 1 {
            Some(1)
        } else if req.trackId == 0 {
            Some(0)
        } else {
            None
        };
    }

    if let Some(i) = intent {
        sqlx::query(
            "UPDATE rooms SET micStatus = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
        )
        .bind(i)
        .bind(&rid)
        .execute(&state.db)
        .await?;
    }

    // 3. 决定发送给大屏的最终物理轨道
    let final_track_id: i32;
    if let Some(matched) = matched_physical_track_id {
        // 已经在字典中匹配到了，直接用
        final_track_id = matched;
    } else if let Some(target_intent) = intent {
        // 从字典中找对应意图的物理轨道
        let mut found_physical_id: Option<i32> = None;
        for d in &dicts {
            let comment = d.dict_name.as_deref().unwrap_or("");
            let is_original = comment.contains("主原")
                || comment.contains("左原")
                || (comment.contains("原") && !comment.contains("伴"))
                || (comment.contains("原") && comment.find("原") < comment.find("伴"));
            let is_vocal = comment.contains("主伴")
                || comment.contains("左伴")
                || (comment.contains("伴") && !comment.contains("原"))
                || comment.contains("伴");

            if (target_intent == 1 && is_original) || (target_intent == 0 && is_vocal) {
                if let Ok(code) = d.dict_code.as_deref().unwrap_or("").parse::<i32>() {
                    found_physical_id = Some(code);
                    break;
                }
            }
        }
        if let Some(pid) = found_physical_id {
            final_track_id = pid;
        } else {
            final_track_id = req.trackId;
        }
    } else {
        final_track_id = req.trackId;
    }

    // 【优化】：直接在 command 中携带 micStatus 意图
    state.send_room_push(
        &rid,
        json!({
            "type": "command",
            "action": "SwitchTrack",
            "trackId": final_track_id,
            "micStatus": intent.unwrap_or(req.trackId),
            "source": "ktv"
        }),
    );
    broadcast_room_state_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn control_ac(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<ACControlRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    let room = RoomService::get_by_id(&state.db, &rid).await?;
    let mut ac_state =
        serde_json::from_str::<serde_json::Value>(&room.acState).unwrap_or_else(|_| json!({}));
    if !ac_state.is_object() {
        ac_state = json!({});
    }
    ac_state["power"] = json!(req.power);
    if let Some(temp) = req.temp {
        ac_state["temp"] = json!(temp);
    }
    if let Some(mode) = req.mode.as_ref() {
        ac_state["mode"] = json!(mode);
    }
    if let Some(wind) = req.wind.as_ref() {
        ac_state["wind"] = json!(wind);
    }
    if ac_state
        .get("temp")
        .and_then(|value| value.as_i64())
        .is_none()
    {
        ac_state["temp"] = json!(26);
    }
    if ac_state
        .get("mode")
        .and_then(|value| value.as_str())
        .is_none()
    {
        ac_state["mode"] = json!("auto");
    }
    if ac_state
        .get("wind")
        .and_then(|value| value.as_str())
        .is_none()
    {
        ac_state["wind"] = json!("low");
    }
    RoomService::update_ac_state(&state.db, &rid, &ac_state.to_string()).await?;
    state.send_room_push(
        &rid,
        json!({
            "type": "command",
            "action": "SetAC",
            "power": ac_state["power"].clone(),
            "temp": ac_state["temp"].clone(),
            "mode": ac_state["mode"].clone(),
            "wind": ac_state["wind"].clone(),
            "source": "ktv"
        }),
    );
    broadcast_room_state_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn control_light(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<LightControlRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    RoomService::update_light_state(&state.db, &rid, &json!({"scene": req.scene}).to_string())
        .await?;
    state.send_room_push(
        &rid,
        json!({
            "type": "command",
            "action": "SetLight",
            "scene": req.scene,
            "source": "ktv"
        }),
    );
    broadcast_room_state_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn control_effect(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<EffectControlRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    RoomService::update_effect_state(&state.db, &rid, &json!({"mode": req.mode}).to_string())
        .await?;
    state.send_room_push(
        &rid,
        json!({
            "type": "command",
            "action": "SetEffect",
            "mode": req.mode,
            "source": "ktv"
        }),
    );
    broadcast_room_state_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn play_ambiance(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<AmbianceRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    let mut msg = json!({ "type": "command", "source": "ktv" });
    if let serde_json::Value::Object(map) =
        serde_json::to_value(&RoomCommand::PlayAmbiance { effect: req.effect }).unwrap_or_default()
    {
        for (k, v) in map {
            msg[k] = v;
        }
    }
    state.send_room_push(&rid, msg);
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn service_call(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<ServiceCallRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    let room = RoomService::get_by_id(&state.db, &rid).await?;
    let call_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO service_calls (id, roomId, roomName, callType, callNote, status)
         VALUES (?, ?, ?, ?, ?, 0)",
    )
    .bind(&call_id)
    .bind(&rid)
    .bind(&room.name)
    .bind(&req.callType)
    .bind(&req.callNote)
    .execute(&state.db)
    .await?;

    let service_call = json!({
        "id": call_id.clone(),
        "roomId": rid.clone(),
        "roomName": room.name.clone(),
        "callType": req.callType.clone(),
        "callNote": req.callNote.clone(),
        "status": 0,
        "createdAt": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
    });
    state.ws.broadcast(json!({
        "type": "service_call_new",
        "data": service_call.clone()
    }));
    let mut msg = json!({ "type": "command", "source": "ktv" });
    if let serde_json::Value::Object(map) = serde_json::to_value(&RoomCommand::ServiceCall {
        callType: service_call["callType"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    })
    .unwrap_or_default()
    {
        for (k, v) in map {
            msg[k] = v;
        }
    }
    state.send_room_push(&rid, msg);
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn control_voice(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<ControlVoiceRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    if !(0..=100).contains(&req.volume) {
        return Err(AppError::BadRequest(
            "volume must be in the range 0..100".to_string(),
        ));
    }
    if req
        .micVolume
        .is_some_and(|volume| !(0..=100).contains(&volume))
    {
        return Err(AppError::BadRequest(
            "micVolume must be in the range 0..100".to_string(),
        ));
    }

    // Keep volume and musicVolume aligned so unmute restores the last requested value.
    sqlx::query(
        "UPDATE rooms
         SET volume = ?, musicVolume = ?, muteStatus = 0,
             updatedAt = datetime('now','localtime')
         WHERE id = ?",
    )
    .bind(req.volume)
    .bind(req.volume)
    .bind(&rid)
    .execute(&state.db)
    .await?;
    if let Some(mic_volume) = req.micVolume {
        sqlx::query(
            "UPDATE rooms SET micVolume = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
        )
        .bind(mic_volume)
        .bind(&rid)
        .execute(&state.db)
        .await?;
    }

    let mut message =
        json!({ "type": "command", "source": "ktv", "action": "SetVolume", "volume": req.volume });
    if let Some(mic_volume) = req.micVolume {
        message["micVolume"] = json!(mic_volume);
    }
    state.send_room_push(&rid, message);
    broadcast_room_state_sync(&state, &rid).await?;
    Ok(Json(ApiResponse::success(json!({}))))
}

pub async fn control_button(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(req): Json<ControlButtonRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let rid = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    let button_alias = req.buttonNameAlias.trim().to_string();
    if button_alias.is_empty() {
        return Err(AppError::BadRequest(
            "buttonNameAlias must not be empty".to_string(),
        ));
    }

    if let Some(lock_state) = match button_alias.as_str() {
        "sceneLockButton" => Some(1),
        "sceneUnLockButton" => Some(0),
        _ => None,
    } {
        let mut sync_state = load_room_sync_state(&state.db, &rid).await;
        sync_state[SCENE_LOCK_SYNC_INDEX] = json!(lock_state);
        save_room_sync_state(&state.db, &rid, &sync_state).await?;
        broadcast_room_state_sync(&state, &rid).await?;
        return Ok(Json(ApiResponse::success(json!({
            "handled": true,
            "kind": "sceneLock",
            "buttonNameAlias": button_alias,
            "syncState": sync_state
        }))));
    }

    let display_presets = sqlx::query_as::<_, (String, String)>(
        "SELECT id, settings FROM peripheral_presets WHERE presetType = 'display'",
    )
    .fetch_all(&state.db)
    .await?;
    for (preset_id, settings) in display_presets {
        let display_state: serde_json::Value =
            serde_json::from_str(&settings).map_err(|error| {
                AppError::BadRequest(format!(
                    "invalid display preset settings for {preset_id}: {error}"
                ))
            })?;
        let configured_alias = display_state
            .get("buttonNameAlias")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if preset_id != button_alias && configured_alias != button_alias {
            continue;
        }

        let view_mode = display_state
            .get("viewMode")
            .and_then(|value| value.as_i64())
            .ok_or_else(|| {
                AppError::BadRequest(format!(
                    "display preset {preset_id} is missing integer viewMode"
                ))
            })?;
        let terminal_alias = if configured_alias.is_empty() {
            button_alias.clone()
        } else {
            configured_alias.to_string()
        };

        let mut sync_state = load_room_sync_state(&state.db, &rid).await;
        sync_state[DISPLAY_MODE_SYNC_INDEX] = json!(view_mode);
        save_room_sync_state(&state.db, &rid, &sync_state).await?;
        state.send_room_push(
            &rid,
            json!({
                "type": "command",
                "action": "ControlButton",
                "buttonNameAlias": terminal_alias,
                "viewMode": view_mode,
                "source": "ktv"
            }),
        );
        broadcast_room_state_sync(&state, &rid).await?;
        return Ok(Json(ApiResponse::success(json!({
            "handled": true,
            "kind": "display",
            "buttonNameAlias": button_alias,
            "viewMode": view_mode,
            "syncState": sync_state
        }))));
    }

    if let Some(settings) = sqlx::query_scalar::<_, String>(
        "SELECT settings FROM peripheral_presets WHERE presetType = 'ac' AND id = ? LIMIT 1",
    )
    .bind(&button_alias)
    .fetch_optional(&state.db)
    .await?
    {
        let ac_state: serde_json::Value = serde_json::from_str(&settings).map_err(|error| {
            AppError::BadRequest(format!(
                "invalid AC preset settings for {button_alias}: {error}"
            ))
        })?;
        let normalized_ac_state = json!({
            "power": ac_state.get("power").and_then(|value| value.as_bool()).unwrap_or(false),
            "temp": ac_state.get("temp").and_then(|value| value.as_i64()).unwrap_or(26),
            "mode": ac_state.get("mode").and_then(|value| value.as_str()).unwrap_or("auto"),
            "wind": ac_state.get("wind").and_then(|value| value.as_str()).unwrap_or("low")
        });
        RoomService::update_ac_state(&state.db, &rid, &normalized_ac_state.to_string()).await?;
        state.send_room_push(
            &rid,
            json!({
                "type": "command",
                "action": "SetAC",
                "power": normalized_ac_state["power"].clone(),
                "temp": normalized_ac_state["temp"].clone(),
                "mode": normalized_ac_state["mode"].clone(),
                "wind": normalized_ac_state["wind"].clone(),
                "source": "ktv"
            }),
        );
        broadcast_room_state_sync(&state, &rid).await?;
        return Ok(Json(ApiResponse::success(json!({
            "handled": true,
            "kind": "ac",
            "buttonNameAlias": button_alias,
            "ac": normalized_ac_state
        }))));
    }

    Err(AppError::BadRequest(format!(
        "unsupported buttonNameAlias: {button_alias}"
    )))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomVodConfigRequest {
    pub target_layer_id: i32,
}

pub async fn get_room_config(
    State(state): State<AppState>,
    ConnectInfo(_addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let room = RoomService::get_by_id(&state.db, &id).await?;
    let setting_key = format!("{}{}", ROOM_VOD_TARGET_LAYER_KEY_PREFIX, room.id);
    let target_layer_id =
        sqlx::query_scalar::<_, String>("SELECT value FROM system_settings WHERE key = ?")
            .bind(&setting_key)
            .fetch_optional(&state.db)
            .await?
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(1);
    Ok(Json(ApiResponse::success(json!({
        "roomId": room.id,
        "roomName": room.name,
        "targetLayerId": target_layer_id
    }))))
}

pub async fn set_room_config(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<RoomVodConfigRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let room = RoomService::get_by_id(&state.db, &id).await?;
    if !(1..=99).contains(&req.target_layer_id) {
        return Err(AppError::BadRequest(
            "targetLayerId 必须在 1..99 范围内".to_string(),
        ));
    }
    let setting_key = format!("{}{}", ROOM_VOD_TARGET_LAYER_KEY_PREFIX, room.id);
    sqlx::query(
        "INSERT INTO system_settings (key, value, updatedAt) VALUES (?, ?, datetime('now','localtime'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt"
    )
    .bind(&setting_key)
    .bind(req.target_layer_id.to_string())
    .execute(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(json!({
        "roomId": room.id,
        "roomName": room.name,
        "targetLayerId": req.target_layer_id
    }))))
}

pub async fn get_room_settings(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let room = RoomService::get_by_id(&state.db, &id).await?;
    Ok(Json(ApiResponse::success(json!(room))))
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ServiceCallRecord {
    pub id: String,
    pub roomId: String,
    pub roomName: String,
    pub callType: String,
    pub callNote: String,
    pub status: i32,
    pub createdAt: String,
}

pub async fn list_service_calls(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<ServiceCallRecord>>>> {
    Ok(Json(ApiResponse::success(sqlx::query_as::<_, ServiceCallRecord>("SELECT s.*, r.name as roomName FROM service_calls s JOIN rooms r ON s.roomId = r.id WHERE s.status = 0 ORDER BY s.createdAt DESC").fetch_all(&state.db).await?)))
}

pub async fn complete_service_call(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    sqlx::query("UPDATE service_calls SET status = 1, completed_at = datetime('now','localtime') WHERE id = ?").bind(&id).execute(&state.db).await?;
    state.ws.broadcast(json!({
        "type": "service_call_completed",
        "data": { "id": id }
    }));
    Ok(Json(ApiResponse::success(())))
}

pub async fn list_areas(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<crate::models::room::RoomArea>>>> {
    Ok(Json(ApiResponse::success(
        sqlx::query_as::<_, crate::models::room::RoomArea>("SELECT * FROM room_areas")
            .fetch_all(&state.db)
            .await?,
    )))
}

pub async fn create_area(
    State(state): State<AppState>,
    Json(req): Json<CreateAreaRequest>,
) -> AppResult<Json<ApiResponse<crate::models::room::RoomArea>>> {
    let id: i32 = sqlx::query_scalar("INSERT INTO room_areas (name) VALUES (?) RETURNING id")
        .bind(&req.name)
        .fetch_one(&state.db)
        .await?;
    Ok(Json(ApiResponse::success(crate::models::room::RoomArea {
        id,
        name: req.name,
    })))
}

pub async fn delete_area(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> AppResult<Json<ApiResponse<()>>> {
    sqlx::query("DELETE FROM room_areas WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(Json(ApiResponse::success(())))
}

pub async fn list_types(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<crate::models::room::RoomType>>>> {
    Ok(Json(ApiResponse::success(
        sqlx::query_as::<_, crate::models::room::RoomType>("SELECT * FROM room_types")
            .fetch_all(&state.db)
            .await?,
    )))
}

pub async fn create_type(
    State(state): State<AppState>,
    Json(req): Json<CreateTypeRequest>,
) -> AppResult<Json<ApiResponse<crate::models::room::RoomType>>> {
    let id: i32 = sqlx::query_scalar("INSERT INTO room_types (name) VALUES (?) RETURNING id")
        .bind(&req.name)
        .fetch_one(&state.db)
        .await?;
    Ok(Json(ApiResponse::success(crate::models::room::RoomType {
        id,
        name: req.name,
    })))
}

pub async fn delete_type(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> AppResult<Json<ApiResponse<()>>> {
    sqlx::query("DELETE FROM room_types WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(Json(ApiResponse::success(())))
}

#[cfg(test)]
mod mute_command_tests {
    use super::{room_command_push_message, set_room_mute_state};
    use crate::models::room::RoomCommand;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn mute_then_unmute_restores_saved_music_volume() {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create test database");
        sqlx::query(
            "CREATE TABLE rooms (
                id TEXT PRIMARY KEY,
                volume INTEGER NOT NULL,
                musicVolume INTEGER,
                muteStatus INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(&db)
        .await
        .expect("create rooms table");
        sqlx::query(
            "INSERT INTO rooms (id, volume, musicVolume, muteStatus) VALUES (?, 19, 19, 0)",
        )
        .bind("room-a")
        .execute(&db)
        .await
        .expect("insert room");

        assert_eq!(
            set_room_mute_state(&db, "room-a", true)
                .await
                .expect("mute room"),
            0
        );
        let muted: (i32, i32, i32) =
            sqlx::query_as("SELECT volume, musicVolume, muteStatus FROM rooms WHERE id = ?")
                .bind("room-a")
                .fetch_one(&db)
                .await
                .expect("read muted state");
        assert_eq!(muted, (0, 19, 1));

        let restored = set_room_mute_state(&db, "room-a", false)
            .await
            .expect("unmute room");
        assert_eq!(restored, 19);
        let unmuted: (i32, i32, i32) =
            sqlx::query_as("SELECT volume, musicVolume, muteStatus FROM rooms WHERE id = ?")
                .bind("room-a")
                .fetch_one(&db)
                .await
                .expect("read unmuted state");
        assert_eq!(unmuted, (19, 19, 0));

        let push = room_command_push_message(&RoomCommand::Unmute, Some(restored));
        assert_eq!(push["type"], "command");
        assert_eq!(push["action"], "Unmute");
        assert_eq!(push["volume"], 19);
        assert_eq!(push["source"], "ktv");
    }
}

#[cfg(test)]
mod room_sync_state_tests {
    use super::{
        load_room_sync_state, save_room_sync_state, DISPLAY_MODE_SYNC_INDEX, SCENE_LOCK_SYNC_INDEX,
    };
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn display_state_is_persistent_and_isolated_per_room() {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create test database");
        sqlx::query(
            "CREATE TABLE room_sync_states (
                roomId TEXT PRIMARY KEY,
                syncState TEXT NOT NULL,
                updatedAt TEXT NOT NULL DEFAULT ''
            )",
        )
        .execute(&db)
        .await
        .expect("create room sync table");

        let mut room_a = load_room_sync_state(&db, "room-a").await;
        assert_eq!(room_a[DISPLAY_MODE_SYNC_INDEX], json!(0));
        assert_eq!(room_a[SCENE_LOCK_SYNC_INDEX], json!(0));

        room_a[DISPLAY_MODE_SYNC_INDEX] = json!(2);
        room_a[SCENE_LOCK_SYNC_INDEX] = json!(1);
        save_room_sync_state(&db, "room-a", &room_a)
            .await
            .expect("save room-a sync state");

        let restored = load_room_sync_state(&db, "room-a").await;
        assert_eq!(restored[DISPLAY_MODE_SYNC_INDEX], json!(2));
        assert_eq!(restored[SCENE_LOCK_SYNC_INDEX], json!(1));

        let room_b = load_room_sync_state(&db, "room-b").await;
        assert_eq!(room_b[DISPLAY_MODE_SYNC_INDEX], json!(0));
        assert_eq!(room_b[SCENE_LOCK_SYNC_INDEX], json!(0));
    }
}

#[cfg(test)]
mod idle_cache_tests {
    use super::{idle_media_play_state, IdleCache, IdleSelection};
    use std::{collections::HashMap, time::Instant};

    #[test]
    fn idle_media_reports_real_play_pause_state() {
        assert_eq!(idle_media_play_state(0), 1);
        assert_eq!(idle_media_play_state(1), 1);
        assert_eq!(idle_media_play_state(2), 2);
    }

    fn cache() -> IdleCache {
        IdleCache {
            files: vec!["001.mp4".into(), "002.mp4".into(), "003.mp4".into()],
            refreshed_at: Instant::now(),
            media_root: "D:/media".into(),
            idle_song_path: "idle".into(),
            selected_by_room: HashMap::new(),
        }
    }

    #[test]
    fn room_state_reads_do_not_advance_idle_media() {
        let mut cache = cache();

        assert_eq!(
            cache.select_file("room-a", IdleSelection::Current),
            Some("001.mp4".into())
        );
        assert_eq!(
            cache.select_file("room-a", IdleSelection::Current),
            Some("001.mp4".into())
        );
        assert_eq!(
            cache.select_file("room-a", IdleSelection::Advance),
            Some("002.mp4".into())
        );
        assert_eq!(
            cache.select_file("room-a", IdleSelection::Current),
            Some("002.mp4".into())
        );
    }

    #[test]
    fn idle_media_selection_is_independent_per_room() {
        let mut cache = cache();

        assert_eq!(
            cache.select_file("room-a", IdleSelection::Advance),
            Some("001.mp4".into())
        );
        assert_eq!(
            cache.select_file("room-a", IdleSelection::Advance),
            Some("002.mp4".into())
        );
        assert_eq!(
            cache.select_file("room-b", IdleSelection::Current),
            Some("001.mp4".into())
        );
    }
}
