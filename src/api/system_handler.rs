use crate::errors::AppResult;
use crate::models::common::ApiResponse;
use crate::models::system::{DiskInfo, LoadAvg, SystemStatus};
use crate::utils::idle_media;
use crate::AppState;
use axum::body::Body;
use axum::extract::Path as AxumPath;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{
    sse::{Event, Sse},
    Response,
};
use axum::{
    extract::{Query, State},
    Json,
};
use futures::stream::Stream;
use std::convert::Infallible;
use sysinfo::{Disks, System};

/// GET /api/v1/system/logs (SSE)
pub async fn log_stream(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = state.log_tx.subscribe();

    let stream = async_stream::stream! {
        // This describes this SSE connection, not a new server startup or restart.
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        yield Ok(Event::default().data(format!(
            "{} INFO [hvideo_server] 实时日志连接已建立",
            timestamp
        )));

        loop {
            match rx.recv().await {
                Ok(msg) => {
                    yield Ok(Event::default().data(msg));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    yield Ok(Event::default().data(format!("<SYSTEM: Skipped {} logs due to connection lag>", skipped)));
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    };

    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}

/// GET /api/v1/system/status
pub async fn system_status(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<SystemStatus>>> {
    let mut sys = System::new_all();
    sys.refresh_all();
    tokio::time::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL).await;
    sys.refresh_cpu_usage();

    let cpu_usage = sys.global_cpu_usage();
    let total_mem = sys.total_memory();
    let used_mem = sys.used_memory();
    let mem_percent = if total_mem > 0 {
        (used_mem as f32 / total_mem as f32) * 100.0
    } else {
        0.0
    };

    let mut disks = Vec::new();
    for disk in Disks::new_with_refreshed_list().list() {
        let mount_point = disk.mount_point().to_string_lossy().to_string();

        // 排除系统盘（Windows 下以 C: 开头，Linux 下为 /）
        if mount_point.to_lowercase().starts_with("c:") || mount_point == "/" {
            continue;
        }

        let total = disk.total_space();
        let available = disk.available_space();
        let used = total.saturating_sub(available);
        disks.push(DiskInfo {
            name: disk.name().to_string_lossy().into_owned(),
            mount_point,
            total_space_gb: total as f64 / 1024.0 / 1024.0 / 1024.0,
            used_space_gb: used as f64 / 1024.0 / 1024.0 / 1024.0,
            available_space_gb: available as f64 / 1024.0 / 1024.0 / 1024.0,
            usage_percent: if total > 0 {
                (used as f32 / total as f32) * 100.0
            } else {
                0.0
            },
        });
    }

    let mut load = System::load_average();

    // Windows 下 sysinfo 的 load_average 总是 0，我们可以通过 CPU 使用率和核心数模拟一个近似值
    if cfg!(windows) && load.one == 0.0 && load.five == 0.0 && load.fifteen == 0.0 {
        let cpu_count = sys.cpus().len() as f64;
        let pseudo_load = (cpu_usage as f64 / 100.0) * cpu_count;
        load.one = pseudo_load;
        load.five = pseudo_load;
        load.fifteen = pseudo_load;
    }

    // 获取实时 WebSocket 连接数
    let ws_count = state.ws.connection_count().await;

    Ok(Json(ApiResponse::success(SystemStatus {
        cpu_usage,
        memory_used_mb: used_mem / 1024 / 1024,
        memory_total_mb: total_mem / 1024 / 1024,
        memory_usage_percent: mem_percent,
        disks,
        load_average: Some(LoadAvg {
            one: load.one,
            five: load.five,
            fifteen: load.fifteen,
        }),
        ws_count,
    })))
}

#[derive(serde::Serialize)]
pub struct NetworkInterface {
    pub name: String,
    pub ip: String,
    pub mac: Option<String>,
}

#[derive(serde::Serialize)]
pub struct ServerInfo {
    pub host: String,
    pub port: u16,
    pub ws_port: u16,
    pub interfaces: Vec<NetworkInterface>,
}

/// GET /api/v1/system/server-info
pub async fn server_info(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<ServerInfo>>> {
    let port = state.config.server.port;
    let ws_port = port;
    let local_interfaces = crate::net_utils::get_local_interfaces(false);
    let interfaces: Vec<NetworkInterface> = local_interfaces
        .into_iter()
        .map(|i| NetworkInterface {
            name: i.name,
            ip: i.ip,
            mac: i.mac,
        })
        .collect();
    Ok(Json(ApiResponse::success(ServerInfo {
        host: state.server_bind_ip.to_string(),
        port,
        ws_port,
        interfaces,
    })))
}

#[derive(serde::Deserialize)]
pub struct UpdateServerNetworkRequest {
    pub host: String,
    pub port: u16,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateServerNetworkResult {
    pub host: String,
    pub port: u16,
    pub restart_required: bool,
}

/// PUT /api/v1/system/server-network
/// Persist the one configured interface used by every server network service.
pub async fn update_server_network(
    State(state): State<AppState>,
    Json(req): Json<UpdateServerNetworkRequest>,
) -> AppResult<Json<ApiResponse<UpdateServerNetworkResult>>> {
    if req.port == 0 {
        return Err(crate::errors::AppError::BadRequest(
            "server port must be between 1 and 65535".to_string(),
        ));
    }

    let host = crate::net_utils::validate_configured_server_ipv4(&req.host)
        .map_err(|error| crate::errors::AppError::BadRequest(error.to_string()))?;
    crate::net_utils::configured_broadcast_ipv4(host)
        .map_err(|error| crate::errors::AppError::BadRequest(error.to_string()))?;

    let config_path = state.config_path.as_ref();
    crate::config::save_server_network(config_path, host, req.port)
        .map_err(|error| crate::errors::AppError::Internal(error))?;

    let restart_required = host != state.server_bind_ip || req.port != state.config.server.port;
    tracing::info!(
        "server network configuration saved: {}:{}; restart required: {}",
        host,
        req.port,
        restart_required
    );
    Ok(Json(ApiResponse::success(UpdateServerNetworkResult {
        host: host.to_string(),
        port: req.port,
        restart_required,
    })))
}

/// GET /api/v1/system/dicts
pub async fn get_dicts(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<crate::models::song_db_models::DictEntry>>>> {
    use crate::services::dictionary_service::DictionaryService;
    const DICT_GROUPS: &[&str] = &["language", "sex", "region", "classify", "track", "ac"];
    let items = DictionaryService::get_groups(&state.song_db, DICT_GROUPS).await?;
    Ok(Json(ApiResponse::success(items)))
}

/// GET /api/v1/system/available-disks - 列出可用的媒体存储盘符（自动排除 C 盘）
pub async fn list_available_disks() -> AppResult<Json<ApiResponse<Vec<DiskInfo>>>> {
    let mut disks = Vec::new();
    for disk in Disks::new_with_refreshed_list().list() {
        let mount_point = disk.mount_point().to_string_lossy().to_string();

        // 排除系统盘（Windows 下以 C: 开头，Linux 下为 /）
        if mount_point.to_lowercase().starts_with("c:") || mount_point == "/" {
            continue;
        }

        let total = disk.total_space();
        let available = disk.available_space();
        let used = total.saturating_sub(available);

        disks.push(DiskInfo {
            name: disk.name().to_string_lossy().into_owned(),
            mount_point,
            total_space_gb: total as f64 / 1024.0 / 1024.0 / 1024.0,
            used_space_gb: used as f64 / 1024.0 / 1024.0 / 1024.0,
            available_space_gb: available as f64 / 1024.0 / 1024.0 / 1024.0,
            usage_percent: if total > 0 {
                (used as f32 / total as f32) * 100.0
            } else {
                0.0
            },
        });
    }
    Ok(Json(ApiResponse::success(disks)))
}

#[derive(serde::Serialize)]
pub struct IdleMediaScanResult {
    pub media_root: String,
    pub idle_song_path: String,
    pub scanned_dirs: Vec<String>,
    pub found_count: usize,
    pub files: Vec<String>,
}

#[derive(serde::Deserialize)]
pub struct IdleMediaScanQuery {
    pub media_root: Option<String>,
    pub idle_song_path: Option<String>,
}

/// GET /api/v1/idle-media/scan - 检测空闲视频实际扫描目录和文件
pub async fn scan_idle_media(
    State(state): State<AppState>,
    Query(query): Query<IdleMediaScanQuery>,
) -> AppResult<Json<ApiResponse<IdleMediaScanResult>>> {
    let saved_media_root = sqlx::query_scalar::<_, String>(
        "SELECT value FROM system_settings WHERE key = 'media_root'",
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_default();
    let saved_idle_song_path = sqlx::query_scalar::<_, String>(
        "SELECT value FROM system_settings WHERE key = 'idle_song_path'",
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_default();
    let media_root = query.media_root.unwrap_or(saved_media_root);
    let idle_song_path = query.idle_song_path.unwrap_or(saved_idle_song_path);
    let idle_song_path = idle_media::validate_idle_song_path(&idle_song_path, &media_root)
        .map_err(crate::errors::AppError::BadRequest)?;

    tracing::info!(
        "[idle-scan] request: media_root={}, idle_song_path={}",
        media_root,
        idle_song_path
    );

    let scan = idle_media::scan_idle_media(&media_root, &idle_song_path).await;
    tracing::info!(
        "[idle-scan] completed: scanned_dirs={:?}, found_count={}",
        scan.scanned_dirs,
        scan.files.len()
    );
    Ok(Json(ApiResponse::success(IdleMediaScanResult {
        media_root,
        idle_song_path,
        scanned_dirs: scan.scanned_dirs,
        found_count: scan.files.len(),
        files: scan.files,
    })))
}

// ===== 系统配置 =====

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SystemSetting {
    pub key: String,
    pub value: String,
}

#[derive(serde::Deserialize)]
pub struct UpdateSettingRequest {
    pub value: String,
}

/// GET /api/v1/system/settings/:key
pub async fn get_setting(
    State(state): State<AppState>,
    AxumPath(key): AxumPath<String>,
) -> AppResult<Json<ApiResponse<SystemSetting>>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM system_settings WHERE key = ?")
        .bind(&key)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| crate::errors::AppError::Internal(anyhow::anyhow!(e)))?;
    let value = row.map(|r| r.0).unwrap_or_default();
    Ok(Json(ApiResponse::success(SystemSetting { key, value })))
}

/// PUT /api/v1/system/settings/:key
pub async fn update_setting(
    State(state): State<AppState>,
    AxumPath(key): AxumPath<String>,
    Json(req): Json<UpdateSettingRequest>,
) -> AppResult<Json<ApiResponse<SystemSetting>>> {
    let value = if key == "idle_song_path" {
        let media_root = sqlx::query_scalar::<_, String>(
            "SELECT value FROM system_settings WHERE key = 'media_root'",
        )
        .fetch_optional(&state.db)
        .await
        .map_err(|e| crate::errors::AppError::Internal(anyhow::anyhow!(e)))?
        .unwrap_or_default();
        if media_root.trim().is_empty() {
            return Err(crate::errors::AppError::BadRequest(
                "请先配置媒体根目录，再保存空闲歌曲路径".to_string(),
            ));
        }
        let normalized = idle_media::validate_idle_song_path(&req.value, &media_root)
            .map_err(crate::errors::AppError::BadRequest)?;
        let scan = idle_media::scan_idle_media(&media_root, &normalized).await;
        if scan.files.is_empty() {
            return Err(crate::errors::AppError::BadRequest(format!(
                "空闲歌曲目录不存在或没有可播放视频：{}",
                scan.scanned_dirs.join("; ")
            )));
        }
        normalized
    } else {
        req.value.trim().to_string()
    };

    sqlx::query(
        "INSERT INTO system_settings (key, value, updatedAt) VALUES (?, ?, datetime('now','localtime'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt"
    )
    .bind(&key)
    .bind(&value)
    .execute(&state.db)
    .await
    .map_err(|e| crate::errors::AppError::Internal(anyhow::anyhow!(e)))?;
    if key == "idle_song_path" || key == "media_root" {
        // Notify only after the new value is committed and visible to scan requests.
        if let Err(error) = super::room_handler::broadcast_idle_media_changed(&state).await {
            tracing::warn!("[idle] settings saved but room refresh failed: {:?}", error);
        }
    }
    Ok(Json(ApiResponse::success(SystemSetting { key, value })))
}

// ===== 媒体文件动态服务 =====
// 作为 router fallback，终端请求 /YN-song/xxx.mp4 时从 media_root 提供文件
// media_root 从数据库读取，页面可配置，无需重启

fn extract_request_ip(addr: &std::net::SocketAddr, headers: &HeaderMap) -> String {
    // Forwarded headers are trusted only from a local reverse proxy. A LAN client
    // can otherwise spoof another room's IP and poison room/source association.
    if addr.ip().is_loopback() {
        return headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .map(|v| v.trim().to_string())
            .or_else(|| {
                headers
                    .get("x-real-ip")
                    .and_then(|v| v.to_str().ok())
                    .map(|v| v.trim().to_string())
            })
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| addr.ip().to_string());
    }
    addr.ip().to_string()
}

fn extract_room_ip_from_query(uri: &axum::http::Uri) -> Option<String> {
    let query = uri.query()?;
    let params = query.split('&').collect::<Vec<_>>();

    for part in &params {
        if part.contains('=') {
            let mut kv = part.splitn(2, '=');
            let key = kv.next().unwrap_or("");
            let value = kv.next().unwrap_or("");
            if key == "roomId" && !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }

    None
}

async fn track_room_client_http_source(state: &AppState, uri: &axum::http::Uri, clientIp: &str) {
    let raw_path = uri.path();
    let clientType = if raw_path.contains("/vod_song/client") {
        "pc"
    } else if raw_path.contains("/vod_song/mobile") {
        "phone"
    } else {
        return;
    };

    let roomIp = match extract_room_ip_from_query(uri) {
        Some(value) if !value.is_empty() => value,
        _ => return,
    };

    let roomId = match crate::services::room_service::RoomService::resolve_room_id(
        &state.db, &roomIp, &clientIp,
    )
    .await
    {
        Ok(id) => id,
        Err(_) => roomIp.clone(),
    };

    if let Err(err) = crate::services::room_service::RoomService::upsert_room_client_http_source(
        &state.db, &roomId, &roomIp, &clientIp, clientType,
    )
    .await
    {
        tracing::warn!(
            "记录客户端 HTTP 来源失败 [{} -> {}]: {:?}",
            clientIp,
            roomIp,
            err
        );
    }
}

pub async fn serve_media_file(
    State(state): State<AppState>,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response<Body> {
    let clientIp = extract_request_ip(&addr, &headers);
    track_room_client_http_source(&state, &uri, &clientIp).await;

    let raw_path = uri.path();
    // 兼容多种路径前缀：/api/v1/, /media/, 或直接路径
    let filePath = if let Some(p) = raw_path.strip_prefix("/api/v1/") {
        p.to_string()
    } else if let Some(p) = raw_path.strip_prefix("/media/") {
        p.to_string()
    } else {
        raw_path.trim_start_matches('/').to_string()
    };

    // Decode once before validating or resolving a filesystem path.
    let decoded_path = match percent_encoding::percent_decode_str(&filePath).decode_utf8() {
        Ok(path) => path,
        Err(_) => return status_response(StatusCode::BAD_REQUEST, "invalid UTF-8 path"),
    };
    let clean_path = decoded_path.replace('\\', "/");
    if clean_path.contains('\0') {
        return status_response(StatusCode::BAD_REQUEST, "invalid path");
    }
    if clean_path.contains("..") || clean_path.starts_with('/') {
        return status_response(StatusCode::FORBIDDEN, "forbidden");
    }
    // Absolute media paths are checked against media roots below, never static.
    let is_static_relative = std::path::Path::new(&clean_path).components().all(|part| {
        matches!(
            part,
            std::path::Component::Normal(_) | std::path::Component::CurDir
        )
    });

    // 从数据库读取 media_root
    let media_root: Option<(String,)> =
        sqlx::query_as("SELECT value FROM system_settings WHERE key = 'media_root'")
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

    let ext = std::path::Path::new(&clean_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    // 网页资源后缀名列表
    const WEB_EXTS: &[&str] = &[
        "html", "js", "css", "png", "jpg", "jpeg", "gif", "svg", "woff", "woff2", "ico", "json",
    ];
    // 视频媒体后缀名列表
    const MEDIA_EXTS: &[&str] = &[
        "hvideo", "mp4", "mkv", "avi", "mov", "flv", "wmv", "m4v", "mpg", "mpeg", "vob", "dat", "ts",
    ];

    let is_web_resource = WEB_EXTS.contains(&ext.as_str());
    let is_media_resource = MEDIA_EXTS.contains(&ext.as_str());

    // 智能分流：网页资源优先查 static 目录，媒体资源优先查 media_root

    // ----- 策略 A: 尝试本地 static 目录 (如果是网页资源则优先执行) -----
    if is_static_relative && (is_web_resource || !is_media_resource) {
        let relative = clean_path.strip_prefix("static/").unwrap_or(&clean_path);
        let static_path = std::path::Path::new("static").join(relative);

        if tokio::fs::metadata(&static_path)
            .await
            .map(|m| m.is_file())
            .unwrap_or(false)
        {
            return stream_file(
                &static_path,
                static_path.to_str().unwrap_or(relative),
                &headers,
            )
            .await;
        }

        // 处理目录 index.html
        if tokio::fs::metadata(&static_path)
            .await
            .map(|m| m.is_dir())
            .unwrap_or(false)
        {
            if !raw_path.ends_with('/') {
                let redirect_url = if let Some(q) = uri.query() {
                    format!("{}/?{}", raw_path, q)
                } else {
                    format!("{}/", raw_path)
                };
                return Response::builder()
                    .status(StatusCode::MOVED_PERMANENTLY)
                    .header(header::LOCATION, redirect_url)
                    .body(Body::empty())
                    .unwrap();
            }
            let index_file = static_path.join("index.html");
            if tokio::fs::metadata(&index_file)
                .await
                .map(|m| m.is_file())
                .unwrap_or(false)
            {
                return stream_file(
                    &index_file,
                    index_file.to_str().unwrap_or(relative),
                    &headers,
                )
                .await;
            }
        }
    }

    // ----- 策略 B: 尝试配置的多个硬盘 (media_root) -----

    if let Some((roots_raw,)) = media_root.filter(|(v,)| !v.is_empty()) {
        let roots: Vec<std::path::PathBuf> = roots_raw
            .split(';')
            .filter(|s| !s.trim().is_empty())
            .map(std::path::PathBuf::from)
            .collect();

        for root in &roots {
            let full_path = root.join(&clean_path);
            let canonical_root = match tokio::fs::canonicalize(root).await {
                Ok(path) => path,
                Err(_) => continue,
            };
            let canonical_path = match tokio::fs::canonicalize(&full_path).await {
                Ok(path) => path,
                Err(_) => continue,
            };
            if !canonical_path.starts_with(&canonical_root) {
                continue;
            }
            let meta = tokio::fs::metadata(&full_path).await;

            if let Ok(m) = meta {
                if m.is_file() {
                    tracing::trace!(
                        "[media] 成功找到文件: {} -> {}",
                        raw_path,
                        full_path.display()
                    );
                    return stream_file(&full_path, &clean_path, &headers).await;
                } else if m.is_dir() {
                    // 【新增】如果请求的是文件夹，且该路径存在于 media_root 中，则返回该文件夹的文件列表
                    tracing::info!(
                        "[media] 识别到文件夹请求: {} -> {}",
                        raw_path,
                        full_path.display()
                    );

                    // 构建基础 URL 供文件访问
                    let base_url = format!(
                        "http://{}:{}",
                        state.server_bind_ip, state.config.server.port
                    );

                    if let Ok(files) =
                        internal_list_media_files(&full_path, &clean_path, &base_url).await
                    {
                        let json =
                            serde_json::to_string(&ApiResponse::success(files)).unwrap_or_default();
                        return Response::builder()
                            .header(header::CONTENT_TYPE, "application/json")
                            .body(Body::from(json))
                            .unwrap();
                    }
                }
            }
        }
    }

    // A completed song scan authorizes the exact indexed media file, even when
    // its disk is not one of the separately configured idle/media roots.
    // Never turn an absolute URL into access to its directory or adjacent files.
    #[cfg(windows)]
    if raw_path.starts_with("/media/")
        && is_media_resource
        && crate::utils::media_path::is_windows_absolute_path(&clean_path)
        && !clean_path[2..].contains(':')
    {
        // The scanner stores absolutePath with normalized forward slashes.
        // An exact indexed lookup also rejects aliases and unscanned paths.
        let indexed_path = sqlx::query_scalar::<_, String>(
            "SELECT absolutePath FROM local_available_songs WHERE absolutePath = ? LIMIT 1",
        )
        .bind(&clean_path)
        .fetch_optional(&state.song_db)
        .await
        .ok()
        .flatten();

        if let Some(indexed_path) = indexed_path {
            if let Ok(path) = tokio::fs::canonicalize(&indexed_path).await {
                if tokio::fs::metadata(&path)
                    .await
                    .map(|meta| meta.is_file())
                    .unwrap_or(false)
                {
                    return stream_file(&path, &clean_path, &headers).await;
                }
            }
        }
    }

    // ----- 策略 C: 最终兜底 (如果前面策略都没找着，再尝试一次本地 static 作为最后防线) -----
    if is_static_relative && !is_web_resource {
        let relative = clean_path.strip_prefix("static/").unwrap_or(&clean_path);
        let static_path = std::path::Path::new("static").join(relative);
        if tokio::fs::metadata(&static_path)
            .await
            .map(|m| m.is_file())
            .unwrap_or(false)
        {
            return stream_file(
                &static_path,
                static_path.to_str().unwrap_or(relative),
                &headers,
            )
            .await;
        }
    }

    tracing::warn!("[media] 404 - 无法找到请求的文件: {}", raw_path);
    status_response(StatusCode::NOT_FOUND, "Not Found")
}

/// 流式提供文件，支持 Range 请求（断点续传/跳进度）
async fn stream_file(
    path: &std::path::Path,
    path_str: &str,
    headers: &HeaderMap,
) -> Response<Body> {
    let fileSize = match tokio::fs::metadata(path).await {
        Ok(m) => m.len(),
        Err(_) => return status_response(StatusCode::NOT_FOUND, "not found"),
    };

    let content_type = guess_mime(path_str);
    let range_header = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let trace_mpeg = is_mpeg_timing_sensitive(path_str);

    if let Some(range_str) = range_header {
        if let Some((start, end)) = parse_range(range_str, fileSize) {
            let length = end - start + 1;
            if trace_mpeg {
                tracing::info!(
                    "[media-range] 206 path={} range='{}' bytes={}-{} len={} total={}",
                    path_str,
                    range_str,
                    start,
                    end,
                    length,
                    fileSize
                );
            }

            // Range 请求：seek 到起始位置后流式传输指定长度
            let file = match tokio::fs::File::open(path).await {
                Ok(f) => f,
                Err(_) => return status_response(StatusCode::INTERNAL_SERVER_ERROR, "io error"),
            };

            use tokio::io::AsyncSeekExt;
            use tokio_util::io::ReaderStream;
            let mut file = file;
            if file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
                return status_response(StatusCode::INTERNAL_SERVER_ERROR, "seek error");
            }
            // 用 Take 限制读取长度，保持流式不占内存
            let limited = tokio::io::AsyncReadExt::take(file, length);
            let stream = ReaderStream::new(limited);

            return Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, content_type)
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {}-{}/{}", start, end, fileSize),
                )
                .header(header::CONTENT_LENGTH, length)
                .header(header::ACCEPT_RANGES, "bytes")
                .body(Body::from_stream(stream))
                .unwrap();
        } else {
            if trace_mpeg {
                tracing::warn!(
                    "[media-range] 416 path={} invalid_range='{}' total={}",
                    path_str,
                    range_str,
                    fileSize
                );
            }
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{}", fileSize))
                .header(header::ACCEPT_RANGES, "bytes")
                .body(Body::empty())
                .unwrap();
        }
    }

    // 普通请求：流式返回整个文件
    if trace_mpeg {
        tracing::info!(
            "[media-range] 200 path={} no_range total={}",
            path_str,
            fileSize
        );
    }
    let file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(_) => return status_response(StatusCode::INTERNAL_SERVER_ERROR, "io error"),
    };

    use tokio_util::io::ReaderStream;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, fileSize)
        .header(header::ACCEPT_RANGES, "bytes")
        .body(Body::from_stream(ReaderStream::new(file)))
        .unwrap()
}

fn is_mpeg_timing_sensitive(path: &str) -> bool {
    let p = path.to_lowercase();
    p.ends_with(".mpg")
        || p.ends_with(".mpeg")
        || p.ends_with(".vob")
        || p.ends_with(".dat")
        || p.ends_with(".ts")
}

fn parse_range(range_str: &str, fileSize: u64) -> Option<(u64, u64)> {
    if fileSize == 0 {
        return None;
    }
    let s = range_str.strip_prefix("bytes=")?;
    let s = s.split(',').next()?.trim();
    let mut parts = s.splitn(2, '-');
    let start_part = parts.next()?.trim();
    let end_part = parts.next().unwrap_or("").trim();
    let (start, end) = if start_part.is_empty() {
        let suffix_len: u64 = end_part.parse().ok()?;
        if suffix_len == 0 {
            return None;
        }
        let len = suffix_len.min(fileSize);
        (fileSize - len, fileSize - 1)
    } else {
        let start: u64 = start_part.parse().ok()?;
        if start >= fileSize {
            return None;
        }
        let end: u64 = if end_part.is_empty() {
            fileSize - 1
        } else {
            end_part.parse().ok()?
        };
        (start, end.min(fileSize - 1))
    };
    if start > end {
        return None;
    }
    Some((start, end))
}

fn guess_mime(path: &str) -> &'static str {
    let p = path.to_lowercase();
    if p.ends_with(".mp4") || p.ends_with(".hvideo") {
        "video/mp4"
    } else if p.ends_with(".mkv") {
        "video/x-matroska"
    } else if p.ends_with(".avi") {
        "video/x-msvideo"
    } else if p.ends_with(".mpg")
        || p.ends_with(".mpeg")
        || p.ends_with(".vob")
        || p.ends_with(".dat")
    {
        "video/mpeg"
    } else if p.ends_with(".ts") {
        "video/mp2t"
    } else if p.ends_with(".mov") {
        "video/quicktime"
    } else if p.ends_with(".flv") {
        "video/x-flv"
    } else if p.ends_with(".mp3") {
        "audio/mpeg"
    } else if p.ends_with(".flac") {
        "audio/flac"
    } else if p.ends_with(".js") {
        "application/javascript"
    } else if p.ends_with(".css") {
        "text/css"
    } else if p.ends_with(".html") {
        "text/html"
    } else if p.ends_with(".json") {
        "application/json"
    } else if p.ends_with(".png") {
        "image/png"
    } else if p.ends_with(".jpg") || p.ends_with(".jpeg") {
        "image/jpeg"
    } else {
        "application/octet-stream"
    }
}

fn status_response(status: StatusCode, msg: &'static str) -> Response<Body> {
    Response::builder()
        .status(status)
        .body(Body::from(msg))
        .unwrap()
}

// ===== 媒体文件列表 =====

#[derive(serde::Serialize)]
pub struct MediaFileEntry {
    pub name: String,
    pub url: String,
    pub size: u64,
}

#[derive(serde::Serialize)]
pub struct MediaDirectoryEntry {
    pub name: String,
    pub path: String,
}

#[derive(serde::Deserialize)]
pub struct MediaFilesQuery {
    pub path: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct MediaDirectoriesQuery {
    pub path: Option<String>,
    pub root: Option<usize>,
}

/// GET /api/v1/media/directories?path=YN-song&root=0
/// 列出 media_root 下指定子目录的文件夹
pub async fn list_media_directories(
    State(state): State<AppState>,
    axum::extract::Query(q): axum::extract::Query<MediaDirectoriesQuery>,
) -> AppResult<Json<ApiResponse<Vec<MediaDirectoryEntry>>>> {
    let media_root: Option<(String,)> =
        sqlx::query_as("SELECT value FROM system_settings WHERE key = 'media_root'")
            .fetch_optional(&state.db)
            .await
            .map_err(|e| crate::errors::AppError::Internal(anyhow::anyhow!(e)))?;

    let roots_raw = match media_root.filter(|(v,)| !v.is_empty()) {
        Some((r,)) => r,
        None => {
            return Err(crate::errors::AppError::BadRequest(
                "media_root 未配置".to_string(),
            ))
        }
    };
    let roots: Vec<&str> = roots_raw
        .split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if roots.is_empty() {
        return Err(crate::errors::AppError::BadRequest(
            "media_root 未配置".to_string(),
        ));
    }

    let root_index = q.root.unwrap_or(0);
    let root = roots
        .get(root_index)
        .copied()
        .ok_or_else(|| crate::errors::AppError::BadRequest("非法媒体根目录序号".to_string()))?;

    let sub = q
        .path
        .unwrap_or_default()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    if sub.contains("..") {
        return Err(crate::errors::AppError::BadRequest("非法路径".to_string()));
    }

    let scan_dir = std::path::Path::new(root).join(&sub);
    if !scan_dir.exists() || !scan_dir.is_dir() {
        return Err(crate::errors::AppError::NotFound(format!(
            "目录不存在: {}",
            scan_dir.display()
        )));
    }

    let mut dirs = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&scan_dir)
        .await
        .map_err(|e| crate::errors::AppError::Internal(anyhow::anyhow!(e)))?;
    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| crate::errors::AppError::Internal(anyhow::anyhow!(e)))?
    {
        let meta = entry
            .metadata()
            .await
            .map_err(|e| crate::errors::AppError::Internal(anyhow::anyhow!(e)))?;
        if !meta.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = if sub.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", sub, name)
        };
        dirs.push(MediaDirectoryEntry { name, path });
    }
    dirs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(ApiResponse::success(dirs)))
}

/// GET /api/v1/media/files?path=YN-song/freesongs
/// 列出 media_root 下指定子目录的所有媒体文件（mp4/mkv/avi/mov）
pub async fn list_media_files(
    State(state): State<AppState>,
    axum::extract::Query(q): axum::extract::Query<MediaFilesQuery>,
) -> AppResult<Json<ApiResponse<Vec<MediaFileEntry>>>> {
    // 读取 media_root
    let media_root: Option<(String,)> =
        sqlx::query_as("SELECT value FROM system_settings WHERE key = 'media_root'")
            .fetch_optional(&state.db)
            .await
            .map_err(|e| crate::errors::AppError::Internal(anyhow::anyhow!(e)))?;

    let root = match media_root.filter(|(v,)| !v.is_empty()) {
        Some((r,)) => r,
        None => {
            return Err(crate::errors::AppError::BadRequest(
                "media_root 未配置".to_string(),
            ))
        }
    };

    // 子目录路径，防止路径穿越
    let sub = q.path.unwrap_or_default();
    let sub = sub.replace('\\', "/");
    if sub.contains("..") {
        return Err(crate::errors::AppError::BadRequest("非法路径".to_string()));
    }

    let scan_dir = std::path::Path::new(&root).join(&sub);
    if !scan_dir.exists() || !scan_dir.is_dir() {
        return Err(crate::errors::AppError::NotFound(format!(
            "目录不存在: {}",
            scan_dir.display()
        )));
    }

    // 构造访问 URL 的 base（用请求来源 IP + 端口）
    // Media URLs always use the configured server interface.
    let base_url = format!(
        "http://{}:{}",
        state.server_bind_ip, state.config.server.port
    );

    let files = internal_list_media_files(&scan_dir, &sub, &base_url)
        .await
        .map_err(|e| crate::errors::AppError::Internal(anyhow::anyhow!(e)))?;

    tracing::info!(
        "[media] list_media_files: path={:?}, found {} files",
        scan_dir.display(),
        files.len()
    );
    Ok(Json(ApiResponse::success(files)))
}

/// 内部扫描工具：列出指定目录下的媒体文件
async fn internal_list_media_files(
    scan_dir: &std::path::Path,
    sub_path: &str,
    base_url: &str,
) -> anyhow::Result<Vec<MediaFileEntry>> {
    const MEDIA_EXTS: &[&str] = &[
        "hvideo", "mp4", "mkv", "avi", "mov", "flv", "wmv", "m4v", "mpg", "mpeg", "vob", "dat", "ts",
    ];

    let mut files: Vec<MediaFileEntry> = Vec::new();
    let mut read_dir = tokio::fs::read_dir(scan_dir).await?;

    while let Some(entry) = read_dir.next_entry().await? {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if !MEDIA_EXTS.contains(&ext.as_str()) {
            continue;
        }

        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let size = entry.metadata().await.map(|m| m.len()).unwrap_or(0);

        // URL 路径：sub/name，统一用正斜杠
        let sub_clean = sub_path.trim_start_matches('/').trim_end_matches('/');
        let url_path = if sub_clean.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", sub_clean, name)
        };
        // 这里的 URL 供客户端直接播放，不含 /api/v1 或 /media，因为 serve_media_file 兜底路由支持直接根路径访问
        let url = format!("{}/{}", base_url, url_path);

        files.push(MediaFileEntry { name, url, size });
    }

    // 按文件名排序
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

#[cfg(test)]
pub(crate) mod media_file_tests {
    use super::*;
    use axum::{body::to_bytes, extract::ConnectInfo, http::Request, Extension, Router};
    use std::sync::Arc;
    use tower::ServiceExt;

    async fn media_app(root: &std::path::Path) -> Router {
        media_app_with_indexed_songs(root, &[]).await
    }

    async fn media_app_with_indexed_songs(
        root: &std::path::Path,
        indexed_paths: &[String],
    ) -> Router {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT)")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO system_settings (key, value) VALUES ('media_root', ?)")
            .bind(root.to_string_lossy().as_ref())
            .execute(&db)
            .await
            .unwrap();
        let song_db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE local_available_songs (absolutePath TEXT NOT NULL)")
            .execute(&song_db)
            .await
            .unwrap();
        for path in indexed_paths {
            sqlx::query("INSERT INTO local_available_songs (absolutePath) VALUES (?)")
                .bind(path)
                .execute(&song_db)
                .await
                .unwrap();
        }
        media_app_with_pools(root, db, song_db).await
    }

    pub(crate) async fn media_app_with_pools(root: &std::path::Path, db: sqlx::SqlitePool, song_db: sqlx::SqlitePool) -> Router {
        let config = serde_json::from_value(serde_json::json!({
            "server": {"host": "192.0.2.1", "port": 9898, "workers": 1},
            "database": {"url": "sqlite::memory:", "max_connections": 1},
            "song_db": {"url": "sqlite::memory:", "max_connections": 1},
            "cloud": {"api_base_url": "", "api_key": "", "download_dir": ""},
            "scanner": {"interval_secs": 30},
            "jwt": {"secret": "test-only", "expire_hours": 1},
            "storage": {"songs_dir": "", "mv_dir": "", "media_root": ""}
        }))
        .unwrap();
        let state = AppState {
            db,
            song_db,
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
            .route("/api/v1/songdb/songs", axum::routing::get(crate::api::song_db_handler::search_songs))
            .fallback(serve_media_file)
            .with_state(state)
            .layer(Extension(ConnectInfo(
                "192.0.2.10:1234".parse::<std::net::SocketAddr>().unwrap(),
            )))
    }

    #[tokio::test]
    async fn encoded_media_urls_serve_original_bytes_and_ranges() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join("MV")).unwrap();
        let content = b"0123456789";
        let cases = [
            ("60000114.hvideo", "60000114.hvideo"),
            ("60000115.HVIDEO", "60000115.HVIDEO"),
            ("71526DHD.mp4", "%371526DHD.mp4"),
            ("Lovelyz\u{ff08}Lovelyz\u{ff09}-\u{90a3}\u{5929}\u{7684}\u{4f60}[ 4K ].mp4",
             "Lovelyz%EF%BC%88Lovelyz%EF%BC%89-%E9%82%A3%E5%A4%A9%E7%9A%84%E4%BD%A0%5B%204K%20%5D.mp4"),
            ("a+b #100%.mp4", "a+b%20%23100%25.mp4"),
            ("literal%20.mp4", "literal%2520.mp4"),
        ];
        let app = media_app(temp.path()).await;
        for (name, encoded) in cases {
            std::fs::write(temp.path().join("MV").join(name), content).unwrap();
            for prefix in ["/media/", "/api/v1/", "/"] {
                let uri = format!("{prefix}MV/{encoded}");
                let response = app
                    .clone()
                    .oneshot(Request::builder().uri(&uri).body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK, "{uri}");
                assert_eq!(response.headers()[header::CONTENT_TYPE], "video/mp4");
                assert_eq!(response.headers()[header::CONTENT_LENGTH], "10");
                assert_eq!(
                    to_bytes(response.into_body(), 100).await.unwrap().as_ref(),
                    content
                );
                let response = app
                    .clone()
                    .oneshot(
                        Request::builder()
                            .uri(&uri)
                            .header(header::RANGE, "bytes=2-5")
                            .body(Body::empty())
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT, "{uri}");
                assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 2-5/10");
                assert_eq!(
                    to_bytes(response.into_body(), 100).await.unwrap().as_ref(),
                    b"2345"
                );
            }
        }
    }

    #[tokio::test]
    async fn decoded_media_paths_cannot_escape_roots_or_use_invalid_utf8() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("media");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(temp.path().join("outside.json"), b"outside root").unwrap();
        let app = media_app(&root).await;
        for (uri, expected) in [
            ("/media/%2e%2e/outside.json", StatusCode::FORBIDDEN),
            ("/media/MV%5c..%5c..%5coutside.json", StatusCode::FORBIDDEN),
            ("/media/%2foutside.json", StatusCode::FORBIDDEN),
            ("/media/%5coutside.json", StatusCode::FORBIDDEN),
            ("/media/%FF.mp4", StatusCode::BAD_REQUEST),
            ("/media/file%00.mp4", StatusCode::BAD_REQUEST),
            ("/media/missing.mp4", StatusCode::NOT_FOUND),
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), expected, "{uri}");
        }
        #[cfg(windows)]
        {
            let outside = temp
                .path()
                .join("outside.json")
                .to_string_lossy()
                .replace('\\', "/");
            let encoded =
                percent_encoding::utf8_percent_encode(&outside, percent_encoding::NON_ALPHANUMERIC);
            let response = app
                .oneshot(
                    Request::builder()
                        .uri(format!("/media/{encoded}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn indexed_absolute_media_outside_roots_serve_original_bytes_and_ranges() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("media");
        let scanned = temp.path().join("scanned");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&scanned).unwrap();
        let content = b"0123456789";
        let file = scanned.join("60000104 #100%.mp4");
        std::fs::write(&file, content).unwrap();
        let absolute = crate::utils::media_path::normalize_slashes(&file.to_string_lossy());
        let uri = format!(
            "/media/{}",
            percent_encoding::utf8_percent_encode(&absolute, percent_encoding::NON_ALPHANUMERIC)
        );
        let app = media_app_with_indexed_songs(&root, &[absolute]).await;

        let response = app
            .clone()
            .oneshot(Request::builder().uri(&uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "video/mp4");
        assert_eq!(response.headers()[header::CONTENT_LENGTH], "10");
        assert_eq!(
            to_bytes(response.into_body(), 100).await.unwrap().as_ref(),
            content
        );

        let response = app
            .oneshot(
                Request::builder()
                    .uri(&uri)
                    .header(header::RANGE, "bytes=2-5")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 2-5/10");
        assert_eq!(
            to_bytes(response.into_body(), 100).await.unwrap().as_ref(),
            b"2345"
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn indexed_media_access_does_not_authorize_adjacent_files_or_nonmedia() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("media");
        let scanned = temp.path().join("scanned");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&scanned).unwrap();
        let indexed = scanned.join("60000104.mp4");
        let adjacent = scanned.join("60000105.mp4");
        let nonmedia = scanned.join("settings.json");
        for path in [&indexed, &adjacent, &nonmedia] {
            std::fs::write(path, b"content").unwrap();
        }
        let normalized = |path: &std::path::Path| {
            crate::utils::media_path::normalize_slashes(&path.to_string_lossy())
        };
        let indexed_path = normalized(&indexed);
        let nonmedia_path = normalized(&nonmedia);
        let app = media_app_with_indexed_songs(
            &root,
            &[
                indexed_path.clone(),
                nonmedia_path.clone(),
                normalized(&scanned),
            ],
        )
        .await;
        let traversal = format!("{}/../scanned/60000104.mp4", normalized(&scanned));
        for (path, expected) in [
            (normalized(&adjacent), StatusCode::NOT_FOUND),
            (nonmedia_path, StatusCode::NOT_FOUND),
            (normalized(&scanned), StatusCode::NOT_FOUND),
            (traversal, StatusCode::FORBIDDEN),
            (indexed_path.replacen(":/", ":", 1), StatusCode::NOT_FOUND),
            (format!("//?/{}", indexed_path), StatusCode::FORBIDDEN),
            (
                format!("{}:stream.mp4", indexed_path),
                StatusCode::NOT_FOUND,
            ),
        ] {
            let encoded =
                percent_encoding::utf8_percent_encode(&path, percent_encoding::NON_ALPHANUMERIC);
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/media/{encoded}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected, "{path}");
        }
    }
}

#[cfg(test)]
mod server_network_tests {
    use crate::config::update_server_network_toml;
    use std::net::Ipv4Addr;

    #[test]
    fn server_network_update_changes_only_server_address_fields() {
        let source = r#"[server]
host = "192.168.1.10"
port = 9898
workers = 4

[scanner]
interval_secs = 30
"#;
        let updated =
            update_server_network_toml(source, Ipv4Addr::new(192, 168, 1, 254), 9988).unwrap();
        let value: toml::Value = updated.parse().unwrap();
        assert_eq!(value["server"]["host"].as_str(), Some("192.168.1.254"));
        assert_eq!(value["server"]["port"].as_integer(), Some(9988));
        assert_eq!(value["server"]["workers"].as_integer(), Some(4));
        assert_eq!(value["scanner"]["interval_secs"].as_integer(), Some(30));
    }
}
