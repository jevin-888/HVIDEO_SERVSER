use crate::{
    errors::{AppError, AppResult},
    models::common::ApiResponse,
    services::rom_release_service as releases,
    AppState,
};
use axum::{
    body::Body,
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

fn authorize(claims: &crate::services::auth_service::Claims) -> AppResult<()> {
    if claims.permissions.iter().any(|p| p == "admin") {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "ROM publication requires administrator permission".into(),
        ))
    }
}

pub async fn list(
    State(state): State<AppState>,
    axum::extract::Extension(claims): axum::extract::Extension<
        crate::services::auth_service::Claims,
    >,
) -> AppResult<Response> {
    authorize(&claims)?;
    let root = releases::directory(&state.config_path);
    let result_root = state
        .config_path
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("data/rom-results");
    let data = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
        let mut items = Vec::new();
        if root.exists() {
            for entry in std::fs::read_dir(&root)? {
                let entry = entry?; let id = entry.file_name().to_string_lossy().into_owned();
                if !entry.file_type()?.is_dir() || !releases::valid_id(&id) { continue; }
                let item = match releases::inspect_candidate(&root, &id) {
                    Ok(m) => serde_json::json!({"release_id":id,"version_code":m.version_code,"hardware":m.hardware,"image_size":m.image_size,"published":root.join(&id).join("PUBLISHED").is_file(),"error":""}),
                    Err(e) => serde_json::json!({"release_id":id,"version_code":0,"hardware":"","image_size":0,"published":root.join(&id).join("PUBLISHED").is_file(),"error":e.to_string()}),
                }; items.push(item);
            }
        }
        items.sort_by_key(|v| std::cmp::Reverse(v["version_code"].as_i64().unwrap_or(0)));
        let mut results = Vec::new();
        if result_root.exists() {
            for entry in std::fs::read_dir(result_root)? {
                let entry = entry?;
                if entry.file_type()?.is_file() && entry.metadata()?.len() < 16384 {
                    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&std::fs::read(entry.path())?) { results.push(value); }
                }
            }
        }
        Ok(serde_json::json!({"releases":items,"results":results}))
    }).await.map_err(|e| AppError::Internal(e.into()))??;
    Ok(Json(ApiResponse::success(data)).into_response())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Publication {
    published: bool,
}
static PUBLICATION_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rom_publication_requires_admin_and_exact_fields() {
        let mut claims = crate::services::auth_service::Claims {
            sub: "test".into(),
            clientKey: "test".into(),
            permissions: vec!["read".into(), "write".into()],
            exp: 0,
            iat: 0,
        };
        assert!(matches!(authorize(&claims), Err(AppError::Forbidden(_))));
        claims.permissions.push("admin".into());
        assert!(authorize(&claims).is_ok());
        assert!(serde_json::from_value::<Publication>(
            serde_json::json!({"published":true,"force":true})
        )
        .is_err());
        assert!(serde_json::from_value::<Report>(serde_json::json!({"device_id":"test","release_id":"a".repeat(64),"version_code":32,"phase":"succeeded","message":"ok","target_fingerprint":"extra"})).is_err());
    }
}

pub async fn publish(
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::extract::Extension(claims): axum::extract::Extension<
        crate::services::auth_service::Claims,
    >,
    Json(request): Json<Publication>,
) -> AppResult<Response> {
    authorize(&claims)?;
    if !releases::valid_id(&id) {
        return Err(AppError::BadRequest("Invalid ROM release ID".into()));
    }
    let _guard = PUBLICATION_LOCK.lock().await;
    let root = releases::directory(&state.config_path);
    tokio::task::spawn_blocking(move || releases::publication(&root, &id, request.published))
        .await
        .map_err(|e| AppError::Internal(e.into()))?
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(ApiResponse::success(
        serde_json::json!({"published":request.published}),
    ))
    .into_response())
}

pub async fn check(
    State(state): State<AppState>,
    Json(request): Json<releases::CheckRequest>,
) -> AppResult<Response> {
    if request.protocol != 1
        || request.product != "H6_POR"
        || request.hardware != "hw81"
        || request.current_version_code <= 0
    {
        return Err(AppError::BadRequest(
            "Unsupported ROM update target/version".into(),
        ));
    }
    let dir = releases::directory(&state.config_path);
    let selected = tokio::task::spawn_blocking(move || releases::select(&dir, &request))
        .await
        .map_err(|e| AppError::Internal(e.into()))??;
    let data = match selected {
        Some((id, manifest)) => {
            serde_json::json!({"has_update":true,"release_id":id,"version_code":manifest.version_code})
        }
        None => serde_json::json!({"has_update":false,"release_id":"","version_code":0}),
    };
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(ApiResponse::success(data)),
    )
        .into_response())
}

pub async fn download(
    State(state): State<AppState>,
    Path((id, resource)): Path<(String, String)>,
) -> AppResult<Response> {
    if !releases::valid_id(&id)
        || !matches!(
            resource.as_str(),
            "manifest.json" | "manifest.sig" | "update.img"
        )
    {
        return Err(AppError::BadRequest("Invalid ROM resource".into()));
    }
    let dir = releases::directory(&state.config_path);
    let release_dir = dir.join(&id);
    tokio::task::spawn_blocking(move || releases::inspect(&dir, &id))
        .await
        .map_err(|e| AppError::Internal(e.into()))?
        .map_err(|_| AppError::NotFound("ROM unavailable or withdrawn".into()))?;
    let file = tokio::fs::File::open(release_dir.join(resource)).await?;
    let size = file.metadata().await?.len();
    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_owned()),
            (header::CONTENT_LENGTH, size.to_string()),
            (header::CACHE_CONTROL, "no-store".to_owned()),
        ],
        Body::from_stream(tokio_util::io::ReaderStream::new(file)),
    )
        .into_response())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Report {
    device_id: String,
    release_id: String,
    version_code: i32,
    phase: String,
    message: String,
}

pub async fn report(
    State(state): State<AppState>,
    Json(report): Json<Report>,
) -> AppResult<Response> {
    if report.device_id.is_empty()
        || report.device_id.len() > 128
        || !report
            .device_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || !releases::valid_id(&report.release_id)
        || report.version_code <= 0
        || report.message.len() > 1024
        || !matches!(report.phase.as_str(), "succeeded" | "failed")
    {
        return Err(AppError::BadRequest("Invalid ROM result".into()));
    }
    // Device reports are observations, not authority to publish or arm another ROM.
    tracing::info!(device = %report.device_id, release = %report.release_id, version = report.version_code, phase = %report.phase, message = %report.message, "ROM update result");
    let root = state
        .config_path
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("data/rom-results");
    tokio::fs::create_dir_all(&root).await?;
    let data = serde_json::json!({"device_id":report.device_id,"release_id":report.release_id,"version_code":report.version_code,"phase":report.phase,"message":report.message,"received_at":chrono::Utc::now().to_rfc3339()});
    tokio::fs::write(
        root.join(format!("{}.json", report.device_id)),
        serde_json::to_vec(&data).map_err(|e| AppError::Internal(e.into()))?,
    )
    .await?;
    Ok(Json(ApiResponse::success(serde_json::json!({"accepted":true}))).into_response())
}
