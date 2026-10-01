use crate::{
    errors::{AppError, AppResult},
    models::common::ApiResponse,
    services::player_release_service as releases,
    AppState,
};
use axum::{
    body::Body,
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};

pub async fn check(
    State(state): State<AppState>,
    Json(request): Json<releases::CheckRequest>,
) -> AppResult<Response> {
    if request.current_version_code < 0
        || request.package_name != "com.hsvj.engine"
        || !matches!(request.hardware.as_str(), "hw81" | "hw82")
    {
        return Err(AppError::BadRequest(
            "播放器包名、硬件型号或版本号无效".into(),
        ));
    }
    let dir = releases::directory(&state.config_path);
    let response = tokio::task::spawn_blocking(move || {
        releases::scan(&dir).map(|items| releases::select(&items, &request))
    })
    .await
    .map_err(|e| AppError::Internal(e.into()))??;
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(ApiResponse::success(response)),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::to_bytes,
        http::{Request, StatusCode},
        routing::{get, post},
        Router,
    };
    use sha2::{Digest, Sha256};
    use std::sync::Arc;
    use tower::ServiceExt;

    async fn app(root: &std::path::Path) -> Router {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .connect_lazy("sqlite::memory:")
            .unwrap();
        let config = serde_json::from_value(serde_json::json!({
            "server": {"host": "192.0.2.1", "port": 9898, "workers": 1},
            "database": {"url": "sqlite::memory:", "max_connections": 1},
            "song_db": {"url": "sqlite::memory:", "max_connections": 1},
            "cloud": {"api_base_url": "", "api_key": "", "download_dir": ""},
            "scanner": {"interval_secs": 30}, "jwt": {"secret": "test-only", "expire_hours": 1},
            "storage": {"songs_dir": "", "mv_dir": "", "media_root": ""}
        }))
        .unwrap();
        let state = AppState {
            db: db.clone(),
            song_db: db,
            config: Arc::new(config),
            ws: Arc::new(crate::ws::WsManager::new()),
            scan_service: crate::services::song_path_matcher_service::SongPathMatcherService::new(),
            singer_image_match_service:
                crate::services::singer_image_match_service::SingerImageMatchService::new(),
            iptv_service: crate::services::iptv_service::IptvService::new(),
            room_cache: Arc::new(dashmap::DashMap::new()),
            room_cache_sync: Arc::new(tokio::sync::Mutex::new(())),
            log_tx: tokio::sync::broadcast::channel(10).0,
            server_bind_ip: "192.0.2.1".parse().unwrap(),
            discovery_broadcast_ip: "192.0.2.255".parse().unwrap(),
            config_path: Arc::new(root.join("config.toml")),
            license: crate::license::LicenseManager::new(root.join("license.json")),
        };
        Router::new()
            .route("/api/v1/player-updates/check", post(check))
            .route("/api/v1/player-updates/files/:hash", get(download))
            .with_state(state)
    }

    async fn check_request(app: &Router, body: serde_json::Value) -> Response {
        app.clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/player-updates/check")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn player_update_empty_directory_and_strict_contract() {
        let root = tempfile::tempdir().unwrap();
        let app = app(root.path()).await;
        let request = serde_json::json!({"current_version_code":1,"package_name":"com.hsvj.engine","hardware":"hw81"});
        let response = check_request(&app, request.clone()).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let json: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        assert_eq!(json["code"], 0);
        assert_eq!(json["data"]["has_update"], false);
        assert_eq!(json["data"].as_object().unwrap().len(), 10);
        for (field, value) in [
            ("hardware", serde_json::json!("hw99")),
            ("package_name", serde_json::json!("other")),
            ("current_version_code", serde_json::json!(-1)),
        ] {
            let mut invalid = request.clone();
            invalid[field] = value;
            assert_eq!(
                check_request(&app, invalid).await.status(),
                StatusCode::BAD_REQUEST
            );
        }
        let mut unknown = request;
        unknown["versionCode"] = serde_json::json!(1);
        assert_eq!(
            check_request(&app, unknown).await.status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        for (hash, status) in [
            ("invalid".to_owned(), StatusCode::BAD_REQUEST),
            ("a".repeat(64), StatusCode::NOT_FOUND),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/api/v1/player-updates/files/{hash}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), status);
        }
    }

    #[tokio::test]
    #[ignore = "Set HVIDEO_TEST_PLAYER_APK to a freshly built signed player APK"]
    async fn player_update_real_apk_check_download_and_removal() {
        let source =
            std::path::PathBuf::from(std::env::var_os("HVIDEO_TEST_PLAYER_APK").expect("APK path"));
        let manifest = crate::services::apk_manifest::read(&source).unwrap();
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("app")).unwrap();
        let published = root.path().join("app/renamed-release.apk");
        std::fs::copy(&source, &published).unwrap();
        std::fs::write(root.path().join("app/broken.apk"), b"broken").unwrap();
        let app = app(root.path()).await;
        let mut request = serde_json::json!({"current_version_code":manifest.version_code - 1,"package_name":manifest.package,"hardware":manifest.hardware});
        let response = check_request(&app, request.clone()).await;
        assert_eq!(response.status(), StatusCode::OK);
        let json: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        assert_eq!(json["code"], 0);
        assert_eq!(json["data"]["has_update"], true);
        assert_eq!(json["data"]["version_code"], manifest.version_code);
        assert_eq!(json["data"]["version_name"], manifest.version_name);
        let url = json["data"]["download_url"].as_str().unwrap();
        let response = app
            .clone()
            .oneshot(Request::builder().uri(url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "application/vnd.android.package-archive"
        );
        let bytes = to_bytes(response.into_body(), 300 * 1024 * 1024)
            .await
            .unwrap();
        assert_eq!(
            bytes.len() as u64,
            json["data"]["file_size"].as_u64().unwrap()
        );
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            json["data"]["sha256"].as_str().unwrap()
        );
        for version in [manifest.version_code, manifest.version_code + 1] {
            request["current_version_code"] = serde_json::json!(version);
            let response = check_request(&app, request.clone()).await;
            let body: serde_json::Value =
                serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap())
                    .unwrap();
            assert_eq!(body["data"]["has_update"], false);
        }
        std::fs::remove_file(published).unwrap();
        let response = app
            .oneshot(Request::builder().uri(url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        println!(
            "verified {} {} ({}) metadata, download SHA-256, equal/older and removed APK",
            manifest.hardware, manifest.version_name, manifest.version_code
        );
    }
}

pub async fn download(
    State(state): State<AppState>,
    Path(hash): Path<String>,
) -> AppResult<Response> {
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(AppError::BadRequest("升级包标识无效".into()));
    }
    let dir = releases::directory(&state.config_path);
    let release = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
        Ok(releases::scan(&dir)?.into_iter().find(|r| r.sha256 == hash))
    })
    .await
    .map_err(|e| AppError::Internal(e.into()))??
    .ok_or_else(|| AppError::NotFound("升级包已移除，请重新检查更新".into()))?;
    let file = tokio::fs::File::open(&release.path).await?;
    Ok((
        [
            (
                header::CONTENT_TYPE,
                "application/vnd.android.package-archive".to_owned(),
            ),
            (header::CONTENT_LENGTH, release.size.to_string()),
            (header::CACHE_CONTROL, "no-store".to_owned()),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=player.apk".to_owned(),
            ),
        ],
        Body::from_stream(tokio_util::io::ReaderStream::new(file)),
    )
        .into_response())
}

