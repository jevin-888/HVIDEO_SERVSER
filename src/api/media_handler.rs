use axum::{
    extract::{ConnectInfo, Path, State},
    Json,
};
use std::net::SocketAddr;

use crate::errors::AppResult;
use crate::models::common::ApiResponse;
use crate::models::media::*;
use crate::models::room::RoomCommand;
use crate::AppState;
use serde_json::json;

/// GET /api/v1/materials - 获取素材列表
pub async fn list_materials(
    State(_state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<Material>>>> {
    // 模拟数据
    let materials = vec![
        Material {
            id: "m1".to_string(),
            name: "开场视频".to_string(),
            categoryId: "c1".to_string(),
            categoryName: "开场".to_string(),
            url: "/assets/materials/opening.mp4".to_string(),
            cover: None,
            duration: 30,
        },
        Material {
            id: "m2".to_string(),
            name: "生日祝福".to_string(),
            categoryId: "c2".to_string(),
            categoryName: "祝福".to_string(),
            url: "/assets/materials/birthday.mp4".to_string(),
            cover: None,
            duration: 60,
        },
    ];
    Ok(Json(ApiResponse::success(materials)))
}

/// GET /api/v1/materials/categories - 获取素材分类
pub async fn list_material_categories(
    State(_state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<MaterialCategory>>>> {
    let categories = vec![
        MaterialCategory {
            id: "c1".to_string(),
            name: "开场".to_string(),
        },
        MaterialCategory {
            id: "c2".to_string(),
            name: "祝福".to_string(),
        },
    ];
    Ok(Json(ApiResponse::success(categories)))
}

/// POST /api/v1/rooms/:id/materials/play - 播放素材
pub async fn play_material(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<PlayMediaRequest>,
) -> AppResult<Json<ApiResponse<()>>> {
    // 广播命令
    let remote_ip = addr.ip().to_string();
    let roomId =
        crate::services::room_service::RoomService::resolve_room_id(&state.db, &id, &remote_ip)
            .await?;

    let ws_message = json!({
        "type": "command",
        "action": RoomCommand::PlayMaterial { material_id: req.mediaId },
        "source": "api"
    });

    state.send_room_push(&roomId, ws_message);

    Ok(Json(ApiResponse::success(())))
}

/// GET /api/v1/streams - 获取流媒体列表
pub async fn list_streams(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<Stream>>>> {
    let streams = state.iptv_service.channels().await;
    Ok(Json(ApiResponse::success(streams)))
}

pub async fn refresh_streams(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    state.iptv_service.refresh().await;
    let status = state.iptv_service.status().await;
    Ok(Json(ApiResponse::success(serde_json::json!(status))))
}

pub async fn stream_status(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let status = state.iptv_service.status().await;
    Ok(Json(ApiResponse::success(serde_json::json!(status))))
}

/// POST /api/v1/rooms/:id/streams/play - 播放流媒体
pub async fn play_stream(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<PlayMediaRequest>,
) -> AppResult<Json<ApiResponse<()>>> {
    let remote_ip = addr.ip().to_string();
    let roomId =
        crate::services::room_service::RoomService::resolve_room_id(&state.db, &id, &remote_ip)
            .await?;

    let ws_message = json!({
        "type": "command",
        "action": RoomCommand::PlayStream { stream_id: req.mediaId },
        "source": "api"
    });

    state.send_room_push(&roomId, ws_message);

    Ok(Json(ApiResponse::success(())))
}

/// POST /api/v1/rooms/:id/streams/stop - 停止流媒体
pub async fn stop_stream(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> AppResult<Json<ApiResponse<()>>> {
    let remote_ip = addr.ip().to_string();
    let roomId =
        crate::services::room_service::RoomService::resolve_room_id(&state.db, &id, &remote_ip)
            .await?;

    let ws_message = json!({
        "type": "command",
        "action": RoomCommand::StopStream,
        "source": "api"
    });

    state.send_room_push(&roomId, ws_message);

    Ok(Json(ApiResponse::success(())))
}
