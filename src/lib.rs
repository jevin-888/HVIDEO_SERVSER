// 库入口文件 - 暴露给 Tauri 应用使用
#![allow(non_snake_case)]

pub mod api;
pub mod config;
pub mod db;
pub mod discover;
pub mod errors;
pub mod license;
pub mod middleware;
pub mod models;
pub mod net_utils;
pub mod player_license;
pub mod process_guard;
pub mod scanner;
pub mod services;
pub mod utils;
pub mod ws;

use axum::http::{HeaderValue, Method};
use std::sync::{Arc, OnceLock};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use config::AppConfig;
use scanner::LanScanner;
use serde_json::json;
use services::iptv_service::IptvService;
use services::singer_image_match_service::SingerImageMatchService;
use services::song_path_matcher_service::SongPathMatcherService;
use ws::WsManager;

/// 全局应用状态
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub song_db: sqlx::SqlitePool,
    pub config: Arc<AppConfig>,
    pub ws: Arc<WsManager>,
    pub scan_service: SongPathMatcherService,
    pub singer_image_match_service: SingerImageMatchService,
    pub iptv_service: IptvService,
    pub room_cache: Arc<dashmap::DashMap<String, crate::models::room::RoomWithTerminalInfo>>,
    pub room_cache_sync: Arc<tokio::sync::Mutex<()>>,
    pub log_tx: tokio::sync::broadcast::Sender<String>,
    pub server_bind_ip: std::net::Ipv4Addr,
    pub discovery_broadcast_ip: std::net::Ipv4Addr,
    pub config_path: Arc<std::path::PathBuf>,
    pub license: crate::license::LicenseManager,
}

impl AppState {
    pub async fn sync_terminal_registration(
        &self,
        registration: &crate::services::terminal_service::TerminalRegistration,
    ) {
        let terminal_ids = registration
            .displaced_terminals
            .iter()
            .chain(std::iter::once(&registration.terminal))
            .map(|terminal| terminal.id.as_str())
            .collect::<Vec<_>>();
        self.sync_terminal_cache(&terminal_ids).await;
        if registration.status_changed {
            self.ws.broadcast(json!({"type": "terminals_updated"}));
        }
    }

    pub async fn sync_terminal_cache(&self, terminal_ids: &[&str]) {
        if terminal_ids.is_empty() {
            return;
        }
        // Registration and offline sweeps may finish their post-commit work in
        // a different order. Serialize refreshes and read the current database
        // state once, so an older event cannot restore its stale IP snapshot.
        let _guard = self.room_cache_sync.lock().await;
        let mut query = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            "SELECT id, terminalIp, onlineStatus FROM terminals WHERE id IN (",
        );
        {
            let mut ids = query.separated(", ");
            for id in terminal_ids {
                ids.push_bind(*id);
            }
        }
        query.push(")");
        let terminals = match query
            .build_query_as::<(String, String, i32)>()
            .fetch_all(&self.db)
            .await
        {
            Ok(terminals) => terminals,
            Err(error) => {
                // The registration has already committed. Cache failures must
                // not turn a successful admission into an API rejection.
                tracing::error!("终端缓存同步失败: {:?}", error);
                return;
            }
        };
        for mut room in self.room_cache.iter_mut() {
            if let Some((_, ip, online)) =
                terminals.iter().find(|(id, _, _)| *id == room.terminalId)
            {
                room.terminalOnline = Some(*online);
                room.roomIp = Some(ip.clone());
            }
        }
    }

    /// Room channels use stable room IDs, independently of the active interface.
    pub fn send_room_push(&self, roomId: &str, msg: serde_json::Value) {
        let targetId = roomId.to_string();
        let roomName = self
            .room_cache
            .get(roomId)
            .map(|room| room.name.clone())
            .unwrap_or_else(|| "未知".to_string());

        let msg_type = msg
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let ws_event = match msg_type.as_str() {
            "playListChanged" => "ws-playListChanged",
            "roomStateChanged" => "ws-roomStateChanged",
            "command" => "ws-command",
            "commandResult" => "ws-commandResult",
            _ => "ws-message",
        };

        // 规范化日志显示
        if msg_type == "command" {
            let action_val = msg.get("action");
            let action_name = if let Some(v) = action_val {
                if v.is_string() {
                    v.as_str().unwrap_or("未知")
                } else if v.is_object() {
                    v.get("action")
                        .and_then(|a| a.as_str())
                        .unwrap_or("复合指令")
                } else {
                    "未知格式"
                }
            } else {
                "缺失动作"
            };
            tracing::info!(
                "ws-push:{} room={} target_room={} action={}",
                ws_event,
                roomName,
                targetId,
                action_name
            );
        } else if msg_type == "commandResult" {
            let action_name = msg.get("action").and_then(|v| v.as_str()).unwrap_or("未知");
            let ok = msg.get("ok").and_then(|v| v.as_i64()).unwrap_or(1);
            let message = msg.get("message").and_then(|v| v.as_str()).unwrap_or("");
            tracing::info!(
                "ws-push:{} room={} target_room={} action={} ok={} message={}",
                ws_event,
                roomName,
                targetId,
                action_name,
                ok,
                message
            );
        } else {
            tracing::info!(
                "ws-push:{} room={} target_room={}",
                ws_event,
                roomName,
                targetId
            );
        }

        self.ws.send_to_room(&targetId, msg);
    }

    pub fn broadcast_cashier_room_changed(
        &self,
        roomId: &str,
        status: serde_json::Value,
        action: &str,
    ) {
        self.ws.broadcast(json!({
            "type": "cashier_room_changed",
            "roomId": roomId,
            "status": status,
            "action": action,
            "timestamp": chrono::Utc::now().timestamp_millis()
        }));
    }
}

/// 自定义日志层，将日志发送到广播通道
struct BroadcastLayer {
    tx: tokio::sync::broadcast::Sender<String>,
}

static LOG_BROADCAST_TX: OnceLock<tokio::sync::broadcast::Sender<String>> = OnceLock::new();
static TRACING_INITIALIZED: OnceLock<()> = OnceLock::new();

fn shared_log_sender() -> tokio::sync::broadcast::Sender<String> {
    LOG_BROADCAST_TX
        .get_or_init(|| {
            let (tx, _) = tokio::sync::broadcast::channel::<String>(1000);
            tx
        })
        .clone()
}

impl<S> tracing_subscriber::Layer<S> for BroadcastLayer
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let mut visitor = LogVisitor::default();
        event.record(&mut visitor);

        let level = event.metadata().level();
        let target = event.metadata().target();
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");

        // 简单的日志格式化
        let log_msg = format!("{} {:5} [{}] {}", timestamp, level, target, visitor.message);
        let _ = self.tx.send(log_msg);
    }
}

#[derive(Default)]
struct LogVisitor {
    message: String,
}

impl tracing::field::Visit for LogVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{:?}", value);
        }
    }
}

/// 启动 HVideo 服务器（供独立二进制使用，无优雅关闭）
pub async fn start_server(config_path: Option<&str>) -> anyhow::Result<()> {
    start_server_impl(config_path, std::future::pending::<()>(), None).await
}

/// 启动 HVideo 服务器并支持优雅关闭（供 Tauri 等需要可重启的场景使用）
pub async fn start_server_with_shutdown<F>(
    config_path: Option<&str>,
    shutdown: F,
) -> anyhow::Result<()>
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    start_server_impl(config_path, shutdown, None).await
}

/// Readiness belongs to this server generation, never to another process on its port.
pub async fn start_server_with_readiness<F>(
    config_path: Option<&str>,
    shutdown: F,
    ready: tokio::sync::oneshot::Sender<()>,
) -> anyhow::Result<()>
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    start_server_impl(config_path, shutdown, Some(ready)).await
}

/// 内部实现：支持可选优雅关闭
async fn start_server_impl<F>(
    config_path: Option<&str>,
    shutdown: F,
    ready: Option<tokio::sync::oneshot::Sender<()>>,
) -> anyhow::Result<()>
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    // 初始化广播通道用于日志监控
    // Reuse the same sender and tracing subscriber across embedded-server restarts.
    // A fresh channel on every restart leaves the new SSE stream without a producer.
    let log_tx_for_state = shared_log_sender();

    let cwd = std::env::current_dir().unwrap_or_default();
    let log_dir = cwd.join("logs");
    let log_file_path = log_dir.join("server.log");
    TRACING_INITIALIZED.get_or_init(|| {
        use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Layer};

        let file_layer = match std::fs::create_dir_all(&log_dir).and_then(|_| {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_file_path)
        }) {
            Ok(file) => Some(
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_writer(std::sync::Mutex::new(file))
                    .with_filter(tracing_subscriber::EnvFilter::new(
                        "hvideo_server=debug,tower_http=info",
                    )),
            ),
            Err(err) => {
                eprintln!(
                    "[HVideo] cannot open log file {}: {}",
                    log_file_path.display(),
                    err
                );
                None
            }
        };
        let console_filter = tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "hvideo_server=debug,tower_http=info".into());
        let console_layer = tracing_subscriber::fmt::layer().with_filter(console_filter);
        let broadcast_layer = BroadcastLayer {
            tx: log_tx_for_state.clone(),
        }
        .with_filter(tracing_subscriber::EnvFilter::new(
            "hvideo_server=debug,tower_http=info",
        ));

        if let Err(err) = tracing_subscriber::registry()
            .with(console_layer)
            .with(file_layer)
            .with(broadcast_layer)
            .try_init()
        {
            eprintln!(
                "[HVideo] tracing subscriber initialization skipped: {}",
                err
            );
        }
    });

    tracing::info!("========== HVideo 点歌系统服务器启动 ==========");
    tracing::info!("日志文件: {}", log_file_path.display());

    // Shared by desktop startup, backend restarts and the standalone server.
    // create_dir_all is idempotent and leaves existing songs untouched.
    let freesongs_dir = cwd.join("freesongs");
    match std::fs::create_dir_all(&freesongs_dir) {
        Ok(()) => tracing::info!("启动检查：空闲歌曲目录已就绪: {}", freesongs_dir.display()),
        Err(error) => tracing::error!(
            "启动检查：无法创建空闲歌曲目录 {}: {}，请检查目录权限或同名文件",
            freesongs_dir.display(),
            error
        ),
    }

    // 加载配置
    let config_file = config_path.unwrap_or("config.toml");
    let config_display_path = std::path::Path::new(config_file)
        .canonicalize()
        .unwrap_or_else(|_| cwd.join(config_file));
    let config_display = config_display_path
        .to_string_lossy()
        .replace("\\\\?\\", "")
        .replace("//?/", "");
    tracing::info!("启动检查：开始加载系统配置");
    tracing::info!("当前工作目录: {}", cwd.display());
    tracing::info!("配置文件: {}", config_display);
    let config = AppConfig::load_for_startup(config_file)
        .map_err(|e| anyhow::anyhow!("failed to load config {}: {:?}", config_file, e))?;
    let license_path = crate::license::default_license_path(&config_display_path);
    let license_manager = crate::license::LicenseManager::new(license_path);
    license_manager.refresh_cloud(&config.cloud.api_base_url).await;
    let license_status = license_manager.status();
    tracing::info!("服务器机器码: {}", license_status.machine_code);
    if license_status.valid {
        tracing::info!("服务器授权: {}", license_status.message);
    } else {
        tracing::warn!("服务器尚未获得有效授权: {}", license_status.message);
    }

    let server_bind_ip =
        net_utils::resolve_configured_server_ipv4(&config.server.host, cfg!(debug_assertions))?;
    let discovery_broadcast_ip = net_utils::configured_broadcast_ipv4(server_bind_ip)?;
    let sockets = net_utils::ServerSockets::bind(
        server_bind_ip,
        config.server.port,
        config.discover.udp_port,
        discover::cashier::DISCOVERY_PORT,
    )
    .await?;
    tracing::info!(
        "selected server interface: {} (HTTP/WS {}:{}, discovery broadcast {})",
        server_bind_ip,
        server_bind_ip,
        config.server.port,
        discovery_broadcast_ip
    );

    // Initialize databases only after the selected server interface is validated.
    services::database_backup_service::ensure_database_ready(&config.database.url).await?;
    let pool = db::init_pool(&config.database.url, config.database.max_connections).await?;
    db::run_migrations(&pool).await?;
    let recovered_cloud_tasks =
        services::cloud_service::CloudService::recover_interrupted_tasks(&pool).await?;
    if recovered_cloud_tasks > 0 {
        tracing::warn!(
            "云端同步：已将 {} 个因服务器重启中断的任务标记为可重试",
            recovered_cloud_tasks
        );
    }
    tracing::info!("业务数据库: 已连接");
    services::database_backup_service::start_daily_backup(config.database.url.clone());
    tracing::info!("数据库每日备份: 已启动，保留最近 7 天");
    // 【深度优化】清除既往已产生的本机/虚拟网卡注册记录，从根本上解决噪音
    let local_ips = net_utils::get_all_local_ips();
    for ip in local_ips {
        if let Ok(tid) =
            sqlx::query_scalar::<_, String>("SELECT id FROM terminals WHERE terminalIp = ?")
                .bind(&ip)
                .fetch_optional(&pool)
                .await
        {
            if let Some(id) = tid {
                let _ = services::terminal_service::TerminalService::delete(&pool, &id).await;
                tracing::info!("已从数据库清理既往的本机终端记录: {} (ID: {})", ip, id);
            }
        }
    }

    // 初始化歌曲库数据库
    let song_db_pool =
        db::init_song_db_pool(&config.song_db.url, config.song_db.max_connections).await?;
    tracing::info!("歌曲库数据库: 已连接");

    // 初始化 WebSocket 管理器
    let ws_manager = Arc::new(WsManager::new());

    // 构建应用状态
    let config = Arc::new(config);
    let room_cache = Arc::new(dashmap::DashMap::new());

    // 【性能优化】启动时异步预热房间缓存
    let rooms_init = services::room_service::RoomService::list_all_with_terminal_info(&pool)
        .await
        .unwrap_or_default();
    for room in &rooms_init {
        room_cache.insert(room.id.clone(), room.clone());
    }
    let room_labels = rooms_init
        .iter()
        .map(|room| {
            let ip = room.roomIp.as_deref().unwrap_or("未绑定终端IP");
            format!("{} ({})", room.name, ip)
        })
        .collect::<Vec<_>>()
        .join(", ");
    tracing::info!(
        "房间数据库: 共 {} 个房间{}",
        room_cache.len(),
        if room_labels.is_empty() {
            String::new()
        } else {
            format!(" -> {}", room_labels)
        }
    );

    let state = AppState {
        db: pool.clone(),
        song_db: song_db_pool.clone(),
        config: config.clone(),
        ws: ws_manager,
        scan_service: SongPathMatcherService::new(),
        singer_image_match_service: SingerImageMatchService::new(),
        iptv_service: IptvService::new(),
        room_cache: room_cache.clone(),
        room_cache_sync: Arc::new(tokio::sync::Mutex::new(())),
        log_tx: log_tx_for_state,
        server_bind_ip,
        discovery_broadcast_ip,
        config_path: Arc::new(config_display_path.clone()),
        license: license_manager,
    };

    state.iptv_service.start_periodic_refresh();

    // 启动定时局域网扫描
    LanScanner::start_periodic_scan(
        config.scanner.clone(),
        config.discover.udp_port,
        server_bind_ip,
        discovery_broadcast_ip,
        state.clone(),
    );
    tracing::info!("局域网扫描: 已启动");

    // Player heartbeats and cashier discovery use separate protocol listeners.
    discover::run(sockets.player, state.clone());
    discover::cashier::run(
        sockets.cashier_receiver,
        sockets.cashier_sender,
        config.server.port,
    );
    tracing::info!("UDP 发现服务: 已启动");

    // 启动定时离线检测（60秒超时）
    let offline_pool = pool.clone();
    let ws_manager_offline = state.ws.clone();
    let state_for_offline = state.clone(); // 【所有权修复】给异步闭包搞个“分身”
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            match services::terminal_service::TerminalService::mark_offline_timeout(
                &offline_pool,
                60,
            )
            .await
            {
                Ok(changed) if !changed.is_empty() => {
                    let terminal_ids = changed
                        .iter()
                        .map(|terminal| terminal.id.as_str())
                        .collect::<Vec<_>>();
                    state_for_offline.sync_terminal_cache(&terminal_ids).await;
                    tracing::info!("更新 {} 台终端的连接状态", changed.len());
                    ws_manager_offline.broadcast(serde_json::json!({
                        "type": "terminals_updated"
                    }));
                }
                Err(e) => tracing::error!("离线检测失败: {:?}", e),
                _ => {}
            }
        }
    });

    // 构建路由
    let app = api::build_routes(state.clone())
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(HeaderValue::from_static("http://localhost"))
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers([
                    axum::http::header::AUTHORIZATION,
                    axum::http::header::CONTENT_TYPE,
                ]),
        );

    // 启动服务器（支持优雅关闭）
    let addr = std::net::SocketAddr::from((server_bind_ip, config.server.port));

    tracing::info!("HTTP / WebSocket 服务: 已启动，监听 {}", addr);

    let server = axum::serve(
        sockets.http,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    );
    if let Some(ready) = ready {
        let _ = ready.send(());
    }

    let serve_result = tokio::select! {
        _ = db::run_song_score_maintenance(&song_db_pool) => unreachable!("score maintenance follows server lifetime"),
        _ = state.license.run_cloud_refresh(&state.config_path) => unreachable!("cloud license refresh follows server lifetime"),
        _ = services::update_history::run(state.clone()) => unreachable!("history reporter follows server lifetime"),
        _ = services::cloud_update_scheduler::run(state.clone()) => unreachable!("cloud scheduler runs until server shutdown"),
        res = server => {
            if let Err(e) = &res {
                tracing::error!("服务器运行异常: {:?}", e);
            }
            res
        }
        _ = shutdown => {
            tracing::info!("收到停止信号，正在关闭服务...");
            Ok(())
        }
    };

    // 显式关闭数据库连接池（解决由于 spawn_blocking 遗留任务导致 Tokio Runtime 销毁时挂起的问题）
    tracing::info!("正在清理数据库连接...");
    pool.close().await;
    song_db_pool.close().await;

    serve_result?;
    tracing::info!("服务器已优雅关闭");
    Ok(())
}
