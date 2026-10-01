use axum::{
    extract::{
        rejection::{JsonRejection, QueryRejection},
        Path, Query, State,
    },
    Extension, Json,
};

use crate::config::{save_cloud_config, CloudConfig, CloudUpdateMode};
use crate::errors::{AppError, AppResult};
use crate::models::common::ApiResponse;
use crate::models::sync_task::*;
use crate::services::auth_service::Claims;
use crate::services::cloud_service::CloudService;
use crate::services::vod_update_service::{PackageView, VodUpdateService};
use crate::AppState;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSettings {
    download_dir: String,
    update_mode: CloudUpdateMode,
}

impl From<CloudConfig> for CloudSettings {
    fn from(config: CloudConfig) -> Self {
        Self {
            download_dir: config.download_dir,
            update_mode: config.update_mode,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveCloudSettings {
    download_dir: String,
    update_mode: CloudUpdateMode,
}

fn require_admin(claims: &Claims) -> AppResult<()> {
    if claims.permissions.iter().any(|p| p == "admin") {
        Ok(())
    } else {
        Err(AppError::Forbidden("仅管理员可配置云端服务".into()))
    }
}

#[cfg(test)]
mod config_tests {
    use super::*;
    #[test]
    fn cloud_config_requires_admin_and_never_returns_key() {
        let mut claims = Claims {
            sub: "test".into(),
            clientKey: "test".into(),
            permissions: vec![],
            exp: 1,
            iat: 0,
        };
        assert!(require_admin(&claims).is_err());
        claims.permissions.push("admin".into());
        assert!(require_admin(&claims).is_ok());
        let view = CloudSettings::from(CloudConfig { update_mode: Default::default(), license_proof: String::new(), cloud_update_expires_at: None, config_path: None, 
            api_base_url: "http://localhost".into(),
            download_dir: "./downloads".into(),
            api_key: "private-test-key".into(),
        });
        let value = serde_json::to_value(view).unwrap();
        assert_eq!(value["updateMode"], "manual");
        assert!(serde_json::from_value::<SaveCloudSettings>(serde_json::json!({"downloadDir":"D:/video","updateMode":"unknown"})).is_err());
        assert!(value.get("apiBaseUrl").is_none());
        assert!(value.get("apiKey").is_none());
        assert!(!value.to_string().contains("private-test-key"));
        assert!(serde_json::from_value::<SaveCloudSettings>(serde_json::json!({"downloadDir":"D:/video","updateMode":"auto"})).is_ok());
        assert!(serde_json::from_value::<SaveCloudSettings>(serde_json::json!({"downloadDir":"D:/video","apiBaseUrl":"http://other"})).is_err());
    }
}

fn current_config(state: &AppState) -> AppResult<CloudConfig> {
    CloudConfig::load(&state.config_path).map_err(AppError::Internal)
}

fn authorized_config(state: &AppState) -> AppResult<CloudConfig> {
    crate::services::cloud_update_scheduler::authorize(current_config(state)?, &state.license)
}

pub async fn get_config(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> AppResult<Json<ApiResponse<CloudSettings>>> {
    require_admin(&claims)?;
    Ok(Json(ApiResponse::success(current_config(&state)?.into())))
}

pub async fn update_config(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<SaveCloudSettings>,
) -> AppResult<Json<ApiResponse<CloudSettings>>> {
    require_admin(&claims)?;
    let _guard = VodUpdateService::lock_settings()?;
    let current = current_config(&state)?;
    let config = save_cloud_config(
        &state.config_path,
        &current.api_base_url,
        &req.download_dir,
        None,
        Some(req.update_mode),
    )
    .map_err(|e| AppError::BadRequest(format!("保存云端配置失败: {e}")))?;
    Ok(Json(ApiResponse::success(config.into())))
}

/// GET /api/v1/cloud/status - 检查云端配置和连接状态。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    #[serde(flatten)]
    connection: CloudStatus,
    packages: Vec<PackageView>,
    update_error: Option<String>,
    updating: bool,
    update_mode: CloudUpdateMode,
    authorization: crate::license::CloudUpdateStatus,
}
pub async fn get_status(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<UpdateStatus>>> {
    let config = current_config(&state)?;
    let status = CloudService::check_status(&config).await;
    let authorization = state.license.cloud_update_status();
    let (packages, update_error) = if status.reachable && authorization.valid {
        let config = authorized_config(&state)?;
        match VodUpdateService::views(&state.db, &state.song_db, &config).await {
            Ok(v) => (v, None),
            Err(e) => (vec![], Some(e.to_string())),
        }
    } else { (vec![], None) };
    Ok(Json(ApiResponse::success(UpdateStatus { update_mode: config.update_mode, connection: status, packages, update_error, authorization, updating: VodUpdateService::is_updating() })))
}

/// POST /api/v1/cloud/updates - Apply every missed published package in order.
pub async fn start_updates(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> AppResult<Json<ApiResponse<Vec<SyncTask>>>> {
    require_admin(&claims)?;
    let config = authorized_config(&state)?;
    Ok(Json(ApiResponse::success(VodUpdateService::start(state.db, state.song_db, config).await?)))
}

/// POST /api/v1/cloud/import - 批量创建并启动云端歌曲下载任务。
pub async fn batch_import(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    payload: Result<Json<BatchImportRequest>, JsonRejection>,
) -> AppResult<Json<ApiResponse<Vec<SyncTask>>>> {
    require_admin(&claims)?;
    authorized_config(&state)?;
    let _ = payload.map_err(|e| AppError::BadRequest(e.body_text()))?;
    Err(AppError::BadRequest("请使用云端更新包更新曲库，旧版单曲导入已停用".into()))
}

/// GET /api/v1/cloud/tasks - 分页查询同步任务。
pub async fn list_tasks(
    State(state): State<AppState>,
    query: Result<Query<SyncTaskQuery>, QueryRejection>,
) -> AppResult<Json<ApiResponse<SyncTaskList>>> {
    let Query(query) = query
        .map_err(|err| AppError::BadRequest(format!("查询参数格式错误: {}", err.body_text())))?;
    let tasks = CloudService::list_tasks(&state.db, query).await?;
    Ok(Json(ApiResponse::success(tasks)))
}

/// POST /api/v1/cloud/download/:id - 重试一个待处理或失败的下载任务。
pub async fn trigger_download(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(claims): Extension<Claims>,
) -> AppResult<Json<ApiResponse<DownloadTriggerResponse>>> {
    require_admin(&claims)?;
    let config = authorized_config(&state)?;
    let existing = CloudService::get_task(&state.db, &id).await?;
    if existing.target_type == "vodPackage" {
        require_admin(&claims)?;
        if !matches!(existing.status, SYNC_STATUS_PENDING | SYNC_STATUS_FAILED) {
            return Err(AppError::Conflict("仅待处理或失败的更新包可重试".into()));
        }
        let tasks = VodUpdateService::start(state.db, state.song_db, config).await?;
        let task = tasks.first().ok_or_else(|| AppError::Conflict("没有待更新的已发布包，请刷新状态".into()))?;
        return Ok(Json(ApiResponse::success(DownloadTriggerResponse { task_id:task.id.clone(), status:task.status })));
    }
    Err(AppError::BadRequest("旧版单曲任务已停用，请使用云端更新包".into()))
}

/// GET /api/v1/cloud/update-history - Durable package attempts, including previous failures.
pub async fn update_history(
    State(state): State<AppState>, Extension(claims): Extension<Claims>,
    Query(query): Query<crate::services::update_history::Query>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    require_admin(&claims)?;
    let data=crate::services::update_history::list(&state.db,query).await.map_err(AppError::Internal)?;
    Ok(Json(ApiResponse::success(data)))
}

/// GET /api/v1/cloud/update-history/:id/songs - Read-only per-song attempt details.
pub async fn update_history_songs(
    State(state): State<AppState>, Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Query(query): Query<crate::services::update_history::SongQuery>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    require_admin(&claims)?;
    let data=crate::services::update_history::songs(&state.db,&id,query).await?;
    Ok(Json(ApiResponse::success(data)))
}
