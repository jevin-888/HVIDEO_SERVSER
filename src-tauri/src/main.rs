// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tauri::scope::ipc::RemoteDomainAccessScope;
use tauri::{CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu};
use tokio::sync::{oneshot, Mutex};
mod native_picker;
mod admin_language;
use native_picker::select_directories;

fn copy_dir_contents(
    src: &std::path::Path,
    dst: &std::path::Path,
    overwrite_files: bool,
) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_contents(&src_path, &dst_path, overwrite_files)?;
        } else if overwrite_files || !dst_path.exists() {
            if let Some(parent) = dst_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn prepare_installed_runtime_dir(resource_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let runtime_base = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(std::path::PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .map(|home| home.join("Library").join("Application Support"))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(std::path::PathBuf::from)
                    .map(|home| home.join(".local").join("share"))
            })
    }?;
    let runtime_dir = runtime_base.join("HVideo Admin");
    let _ = std::fs::create_dir_all(&runtime_dir);

    for name in ["config.toml", "config.json"] {
        let src = resource_dir.join(name);
        let dst = runtime_dir.join(name);
        if src.exists() && !dst.exists() {
            let _ = std::fs::copy(src, dst);
        }
    }

    // Windows packages carry yt-dlp.exe; Linux/macOS use the system command.
    #[cfg(windows)]
    {
        let src = resource_dir.join("yt-dlp.exe");
        let dst = runtime_dir.join("yt-dlp.exe");
        if src.exists() && !dst.exists() {
            let _ = std::fs::copy(src, dst);
        }
    }

    for name in ["static", "migrations", "nginx"] {
        let src = resource_dir.join(name);
        let dst = runtime_dir.join(name);
        if src.exists() {
            let _ = copy_dir_contents(&src, &dst, true);
        }
    }

    for name in ["data", "song_db"] {
        let src = resource_dir.join(name);
        let dst = runtime_dir.join(name);
        if src.exists() {
            let _ = copy_dir_contents(&src, &dst, false);
        }
    }

    Some(runtime_dir)
}

fn append_server_log(message: impl AsRef<str>) {
    let timestamp = chrono_like_timestamp();
    let line = format!("[{}] {}\n", timestamp, message.as_ref());
    let _ = std::fs::create_dir_all("logs");
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("logs/server.log")
        .and_then(|mut file| {
            use std::io::Write;
            file.write_all(line.as_bytes())
        });
}

fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", secs)
}

fn configured_server_bind() -> Result<(std::net::Ipv4Addr, u16), String> {
    let config = hvideo_server::config::ServerConfig::load("config.toml")
        .map_err(|error| format!("failed to load config.toml: {}", error))?;
    let host = hvideo_server::net_utils::resolve_configured_server_ipv4(
        &config.host,
        cfg!(debug_assertions),
    )
    .map_err(|error| error.to_string())?;
    Ok((host, config.port))
}

fn start_desktop_loopback_proxy() -> Result<String, String> {
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("failed to bind desktop loopback proxy: {}", error))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("failed to configure desktop loopback proxy: {}", error))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("failed to read desktop loopback proxy address: {}", error))?
        .port();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .thread_name("hvideo-desktop-proxy-worker")
        .enable_all()
        .build()
        .map_err(|error| format!("failed to create desktop loopback proxy runtime: {}", error))?;

    std::thread::Builder::new()
        .name("hvideo-desktop-proxy".to_string())
        .spawn(move || {
            runtime.block_on(async move {
                let listener = match tokio::net::TcpListener::from_std(listener) {
                    Ok(listener) => listener,
                    Err(error) => {
                        append_server_log(format!(
                            "Desktop loopback proxy listener initialization failed: {}",
                            error
                        ));
                        return;
                    }
                };

                loop {
                    let (mut client, _) = match listener.accept().await {
                        Ok(connection) => connection,
                        Err(error) => {
                            append_server_log(format!(
                                "Desktop loopback proxy accept failed: {}",
                                error
                            ));
                            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                            continue;
                        }
                    };

                    tokio::spawn(async move {
                        let (host, port) = match configured_server_bind() {
                            Ok(target) => target,
                            Err(error) => {
                                append_server_log(format!(
                                    "Desktop loopback proxy target resolution failed: {}",
                                    error
                                ));
                                return;
                            }
                        };

                        let mut backend = match tokio::net::TcpStream::connect((host, port)).await {
                            Ok(stream) => stream,
                            Err(error) => {
                                append_server_log(format!(
                                    "Desktop loopback proxy could not connect to {}:{}: {}",
                                    host, port, error
                                ));
                                return;
                            }
                        };

                        if let Err(error) =
                            tokio::io::copy_bidirectional(&mut client, &mut backend).await
                        {
                            append_server_log(format!(
                                "Desktop loopback proxy connection ended with an error: {}",
                                error
                            ));
                        }
                    });
                }
            });
        })
        .map_err(|error| format!("failed to start desktop loopback proxy thread: {}", error))?;

    Ok(format!("http://localhost:{}", port))
}

/// 服务器状态
#[derive(Clone)]
struct ServerState {
    running: Arc<Mutex<bool>>,
    start_time: Arc<Mutex<Option<std::time::Instant>>>,
    /// 后端线程 JoinHandle，用于重启时等待退出
    server_handle: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
    /// 优雅关闭发送端，发送后后端会停止
    shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    last_error: Arc<Mutex<Option<String>>>,
    restart_lock: Arc<Mutex<()>>,
    desktop_server_url: Arc<String>,
}

/// 获取服务器运行状态
#[tauri::command]
async fn get_server_status(
    state: tauri::State<'_, ServerState>,
) -> Result<serde_json::Value, String> {
    let running = *state.running.lock().await;
    let uptime = if let Some(start) = *state.start_time.lock().await {
        Some(start.elapsed().as_secs())
    } else {
        None
    };

    Ok(serde_json::json!({
        "running": running,
        "uptime_seconds": uptime,
        "version": env!("CARGO_PKG_VERSION"),
        "app_name": env!("CARGO_PKG_NAME"),
        "last_error": state.last_error.lock().await.clone(),
        "server_url": state.desktop_server_url.as_ref(),
    }))
}

/// 终端网页只在独立 WebView 中运行，不授予本地 IPC 权限。
#[tauri::command]
async fn open_terminal_settings(app: tauri::AppHandle, terminal_ip: String) -> Result<(), String> {
    let ip: std::net::Ipv4Addr = terminal_ip
        .trim()
        .parse()
        .map_err(|_| "终端 IP 地址无效".to_string())?;
    let label = format!("terminal-settings-{}", ip.to_string().replace('.', "-"));
    if let Some(window) = app.get_window(&label) {
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    let url = format!("http://{ip}/login.html?terminalAutoLogin=1")
        .parse()
        .map_err(|error| format!("终端地址无效：{error}"))?;
    tauri::WindowBuilder::new(&app, label, tauri::WindowUrl::External(url))
        .title(format!("终端设置 - {ip}"))
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|error| format!("打开终端设置失败：{error}"))?;
    Ok(())
}

/// 获取应用版本信息
#[tauri::command]
fn get_app_version() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "name": env!("CARGO_PKG_NAME"),
        "description": env!("CARGO_PKG_DESCRIPTION"),
    })
}

/// 获取服务器地址（从 config.toml 读取 server.host 与 server.port）
#[tauri::command]
fn get_server_url() -> Result<String, String> {
    let (host, port) = configured_server_bind()?;
    Ok(format!("http://{}:{}", host, port))
}

/// 打开日志目录

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerNetworkOptions {
    configured_host: String,
    configured_port: u16,
    configured_available: bool,
    interfaces: Vec<hvideo_server::net_utils::LocalInterface>,
}

/// Enumerate local IPv4 interfaces even when the HTTP backend cannot start.
#[tauri::command]
fn get_server_network_options() -> Result<ServerNetworkOptions, String> {
    let config = hvideo_server::config::ServerConfig::load("config.toml")
        .map_err(|error| format!("Failed to read config.toml: {}", error))?;
    let mut interfaces: Vec<_> = hvideo_server::net_utils::get_local_interfaces(false)
        .into_iter()
        .filter(|interface| hvideo_server::net_utils::is_usable_server_ipv4(&interface.ip))
        .collect();
    interfaces.sort_by_key(|interface| {
        let private = interface
            .ip
            .parse::<std::net::Ipv4Addr>()
            .map(|ip| ip.is_private())
            .unwrap_or(false);
        (!private, interface.name.clone(), interface.ip.clone())
    });
    let configured_available = interfaces
        .iter()
        .any(|interface| interface.ip == config.host.trim());
    Ok(ServerNetworkOptions {
        configured_host: config.host,
        configured_port: config.port,
        configured_available,
        interfaces,
    })
}

#[tauri::command]
fn open_logs_dir() -> Result<String, String> {
    let log_dir = std::env::current_dir()
        .map_err(|e| format!("获取当前目录失败: {}", e))?
        .join("logs");

    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir).map_err(|e| format!("创建日志目录失败: {}", e))?;
    }

    // 在不同平台上打开文件管理器
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(log_dir.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(log_dir.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(log_dir.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    Ok(log_dir.to_string_lossy().to_string())
}

/// 打开数据目录
#[tauri::command]
fn open_data_dir() -> Result<String, String> {
    let data_dir = std::env::current_dir().map_err(|e| format!("获取当前目录失败: {}", e))?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(data_dir.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(data_dir.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(data_dir.to_str().unwrap_or("."))
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    Ok(data_dir.to_string_lossy().to_string())
}

/// 重启桌面应用（优雅关闭内嵌后端后退出当前进程并重新启动）
#[tauri::command]
async fn relaunch_app(state: tauri::State<'_, ServerState>) -> Result<(), String> {
    let _guard = state.restart_lock.lock().await;
    stop_backend(state.inner()).await?;
    append_server_log("Application relaunch requested");
    std::process::exit(hvideo_server::process_guard::RELAUNCH_EXIT_CODE);
}
/// 重启服务器：优雅关闭当前后端再重新启动
#[derive(Clone, serde::Serialize)]
struct ServerRestartEvent {
    phase: String,
    message: String,
    timestamp: u64,
}

fn event_timestamp_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn publish_restart_event(app: &tauri::AppHandle, phase: &str, message: &str) {
    let _ = app.emit_all(
        "server-restart-status",
        ServerRestartEvent {
            phase: phase.to_string(),
            message: message.to_string(),
            timestamp: event_timestamp_millis(),
        },
    );
}

fn set_tray_server_status(app: &tauri::AppHandle, title: &str) {
    let _ = app.tray_handle().get_item("server_status").set_title(title);
}

async fn report_restart_failure(
    app: &tauri::AppHandle,
    state: &ServerState,
    message: String,
) -> String {
    *state.running.lock().await = false;
    *state.start_time.lock().await = None;
    *state.last_error.lock().await = Some(message.clone());
    append_server_log(format!("Tray restart failed: {}", message));
    publish_restart_event(app, "failed", &message);
    set_tray_server_status(app, "服务器状态：重启失败");
    message
}

async fn wait_for_backend_ready(state: &ServerState) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(20);

    loop {
        if let Some(error) = state.last_error.lock().await.clone() {
            return Err(error);
        }
        if *state.running.lock().await {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("服务器启动超时，请查看日志后点击重试".to_string());
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    }
}

/// Only SKIP_BACKEND development mode may attach to an external listener.
async fn wait_for_external_backend_ready() -> Result<(), String> {
    let (host, port) = configured_server_bind()?;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        if matches!(
            tokio::time::timeout(
                std::time::Duration::from_secs(1),
                tokio::net::TcpStream::connect((host, port))
            )
            .await,
            Ok(Ok(_))
        ) {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(format!("外部开发服务器启动超时：{host}:{port}"));
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

/// Keep ownership until the thread has actually stopped, including on timeout.
/// Otherwise a second restart can create another backend while the old one exits.
async fn stop_backend(state: &ServerState) -> Result<(), String> {
    *state.running.lock().await = false;
    *state.start_time.lock().await = None;
    if let Some(tx) = state.shutdown_tx.lock().await.take() {
        let _ = tx.send(());
    }
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(20);
    loop {
        let mut slot = state.server_handle.lock().await;
        if slot.as_ref().map_or(true, |handle| handle.is_finished()) {
            if let Some(handle) = slot.take() {
                if handle.join().is_err() {
                    append_server_log("Backend thread panicked; finished thread reclaimed");
                }
            }
            return Ok(());
        }
        drop(slot);
        if tokio::time::Instant::now() >= deadline {
            return Err("停止后台服务器超时，保留原线程句柄以避免重复启动".to_string());
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
}

async fn restart_backend(app: &tauri::AppHandle, state: &ServerState) -> Result<String, String> {
    let _restart_guard = state
        .restart_lock
        .try_lock()
        .map_err(|_| "服务器正在重启，请勿重复操作".to_string())?;

    restart_backend_locked(app, state).await
}

async fn restart_backend_locked(
    app: &tauri::AppHandle,
    state: &ServerState,
) -> Result<String, String> {
    set_tray_server_status(app, "服务器状态：正在重启");
    append_server_log("Tray restart: stopping backend server");
    publish_restart_event(app, "stopping", "正在停止后台服务器");

    if let Err(error) = stop_backend(state).await {
        return Err(report_restart_failure(app, state, error).await);
    }

    *state.last_error.lock().await = None;
    append_server_log("Tray restart: starting backend server");
    publish_restart_event(app, "starting", "正在启动后台服务器");

    let (handle, tx) = start_backend_server(
        state.running.clone(),
        state.start_time.clone(),
        state.last_error.clone(),
    );
    *state.server_handle.lock().await = Some(handle);
    *state.shutdown_tx.lock().await = Some(tx);

    if let Err(error) = wait_for_backend_ready(state).await {
        return Err(report_restart_failure(app, state, error).await);
    }

    append_server_log("Tray restart: backend server is ready");
    publish_restart_event(app, "ready", "后台服务器已重启并恢复监听");
    set_tray_server_status(app, "服务器状态：运行中");
    Ok("服务器已重启".to_string())
}

async fn monitor_backend(app: tauri::AppHandle) {
    let state = app.state::<ServerState>();
    let mut failures: u32 = 0;
    let mut next_attempt = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        // Share the manual restart lock; only a finished thread can be replaced.
        let Ok(_guard) = state.restart_lock.try_lock() else {
            continue;
        };
        let finished = state
            .server_handle
            .lock()
            .await
            .as_ref()
            .is_some_and(|h| h.is_finished());
        if !finished {
            if state
                .start_time
                .lock()
                .await
                .is_some_and(|start| start.elapsed().as_secs() >= 60)
            {
                failures = 0;
            }
            next_attempt = tokio::time::Instant::now()
                + hvideo_server::process_guard::retry_delay(failures.saturating_add(1));
            continue;
        }
        *state.running.lock().await = false;
        *state.start_time.lock().await = None;
        if tokio::time::Instant::now() < next_attempt {
            continue;
        }
        failures = failures.saturating_add(1);
        append_server_log(format!(
            "Backend watchdog: recovering finished backend (attempt {})",
            failures
        ));
        let _ = restart_backend_locked(&app, state.inner()).await;
        next_attempt = tokio::time::Instant::now()
            + hvideo_server::process_guard::retry_delay(failures.saturating_add(1));
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerRestartResult {
    message: String,
    server_url: String,
}

/// Save the selected local interface and restart the embedded backend in one operation.
#[tauri::command]
async fn select_server_network(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServerState>,
    host: String,
    port: u16,
) -> Result<ServerRestartResult, String> {
    let _guard = state
        .restart_lock
        .try_lock()
        .map_err(|_| "服务器正在重启，请勿重复操作".to_string())?;
    let host = hvideo_server::net_utils::validate_configured_server_ipv4(&host)
        .map_err(|error| error.to_string())?;
    hvideo_server::net_utils::configured_broadcast_ipv4(host).map_err(|error| error.to_string())?;
    hvideo_server::config::save_server_network("config.toml", host, port)
        .map_err(|error| format!("Failed to save server network configuration: {}", error))?;
    append_server_log(format!(
        "Selected server interface from login page: {}:{}",
        host, port
    ));
    let message = restart_backend_locked(&app, state.inner()).await?;
    Ok(ServerRestartResult {
        message,
        server_url: state.desktop_server_url.as_ref().clone(),
    })
}

#[tauri::command]
async fn restart_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServerState>,
) -> Result<ServerRestartResult, String> {
    let message = restart_backend(&app, state.inner()).await?;
    let server_url = state.desktop_server_url.as_ref().clone();
    Ok(ServerRestartResult {
        message,
        server_url,
    })
}

/// 在独立线程中启动后端，并返回 handle 和 shutdown_tx
fn start_backend_server(
    running: Arc<Mutex<bool>>,
    start_time: Arc<Mutex<Option<std::time::Instant>>>,
    last_error: Arc<Mutex<Option<String>>>,
) -> (std::thread::JoinHandle<()>, oneshot::Sender<()>) {
    let (tx, rx) = oneshot::channel();
    append_server_log("Preparing embedded backend server");
    let handle = std::thread::spawn(move || {
        let runtime_running = running.clone();
        let runtime_start_time = start_time.clone();
        let runtime_last_error = last_error.clone();
        let runtime = match tokio::runtime::Runtime::new() {
            Ok(runtime) => runtime,
            Err(error) => {
                let message = format!("Tokio Runtime creation failed: {}", error);
                append_server_log(&message);
                *runtime_running.blocking_lock() = false;
                *runtime_start_time.blocking_lock() = None;
                *runtime_last_error.blocking_lock() = Some(message);
                return;
            }
        };

        runtime.block_on(async move {
            *running.lock().await = false;
            *start_time.lock().await = None;
            *last_error.lock().await = None;

            let (ready_tx, ready_rx) = oneshot::channel();
            let server = hvideo_server::start_server_with_readiness(
                None,
                async move {
                    let _ = rx.await;
                },
                ready_tx,
            );
            tokio::pin!(server);
            let result = tokio::select! {
                result = &mut server => result,
                ready = ready_rx => {
                    if ready.is_ok() {
                        *last_error.lock().await = None;
                        *running.lock().await = true;
                        *start_time.lock().await = Some(std::time::Instant::now());
                    }
                    server.await
                }
            };

            *running.lock().await = false;
            *start_time.lock().await = None;
            match result {
                Ok(()) => append_server_log("Embedded backend server stopped"),
                Err(error) => {
                    let message = format!("Backend server failed: {:?}", error);
                    append_server_log(&message);
                    *last_error.lock().await = Some(message);
                }
            }
        });
    });
    (handle, tx)
}

fn main() {
    // Release/installed builds run beside their packaged resources. During `cargo run`,
    // keep the project root as the working directory so stale installed configs cannot
    // override the development configuration.
    if !cfg!(debug_assertions) {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let resource_dir = exe_dir.join("_up_");
                if resource_dir.join("config.toml").exists() {
                    if let Some(runtime_dir) = prepare_installed_runtime_dir(&resource_dir) {
                        let _ = std::env::set_current_dir(runtime_dir);
                    } else {
                        let _ = std::env::set_current_dir(resource_dir);
                    }
                } else {
                    let _ = std::env::set_current_dir(exe_dir);
                }
            }
        }
    }

    if cfg!(debug_assertions) {
        let project_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(|| std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        let _ = std::env::set_current_dir(project_root);
    }

    hvideo_server::process_guard::install_panic_log();
    hvideo_server::process_guard::install_native_crash_handler();
    match hvideo_server::process_guard::enter() {
        Ok(true) => {}
        Ok(false) => return,
        Err(error) => {
            hvideo_server::process_guard::append_diagnostic(
                "crash.log",
                format!("Cannot start process supervisor: {error}"),
            );
            std::process::exit(1);
        }
    }

    let desktop_server_url =
        start_desktop_loopback_proxy().expect("failed to start desktop loopback proxy");
    append_server_log(format!(
        "Desktop loopback proxy is listening at {}",
        desktop_server_url
    ));

    let server_state = ServerState {
        running: Arc::new(Mutex::new(false)),
        start_time: Arc::new(Mutex::new(None)),
        server_handle: Arc::new(Mutex::new(None)),
        shutdown_tx: Arc::new(Mutex::new(None)),
        last_error: Arc::new(Mutex::new(None)),
        restart_lock: Arc::new(Mutex::new(())),
        desktop_server_url: Arc::new(desktop_server_url),
    };

    // 开发模式下若由 npm 脚本已单独启动后端（SKIP_BACKEND=1），则不再内嵌启动，避免重复占用端口
    let skip_backend = std::env::var("SKIP_BACKEND")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if !skip_backend {
        println!("🚀 正在启动 HVideo 后端服务器...");
        append_server_log("Tauri 启动：准备启动内嵌后端");
        let (handle, tx) = start_backend_server(
            server_state.running.clone(),
            server_state.start_time.clone(),
            server_state.last_error.clone(),
        );
        *server_state.server_handle.blocking_lock() = Some(handle);
        *server_state.shutdown_tx.blocking_lock() = Some(tx);
        std::thread::sleep(std::time::Duration::from_secs(2));
    } else {
        println!("📡 开发模式：使用已启动的后端（SKIP_BACKEND=1）");
        append_server_log("Tauri 启动：SKIP_BACKEND=1，跳过内嵌后端启动");
    }

    // 系统托盘
    let server_status =
        CustomMenuItem::new("server_status".to_string(), "服务器状态：启动中").disabled();
    let show = CustomMenuItem::new("show".to_string(), "显示主窗口");
    let restart = CustomMenuItem::new("restart".to_string(), "重启服务器");
    let quit = CustomMenuItem::new("quit".to_string(), "退出");
    let tray_menu = SystemTrayMenu::new()
        .add_item(server_status)
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(show)
        .add_item(restart)
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(quit);
    let system_tray = SystemTray::new().with_menu(tray_menu);

    // 启动 Tauri 应用
    tauri::Builder::default()
        .manage(server_state)
        .system_tray(system_tray)
        .setup(move |app| {
            app.ipc_scope().configure_remote_access(
                RemoteDomainAccessScope::new("localhost")
                    .allow_on_scheme("http")
                    .add_window("main")
                    .enable_tauri_api(),
            );

            if !skip_backend {
                tauri::async_runtime::spawn(monitor_backend(app.handle()));
            }
            let app_handle = app.handle();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<ServerState>();
                let startup_result = if skip_backend {
                    wait_for_external_backend_ready().await
                } else {
                    wait_for_backend_ready(state.inner()).await
                };
                match startup_result {
                    Ok(()) => {
                        let _ = app_handle
                            .tray_handle()
                            .get_item("server_status")
                            .set_title("Server status: running");
                        if let Some(win) = app_handle.get_window("main") {
                            let server_url = app_handle
                                .state::<ServerState>()
                                .desktop_server_url
                                .as_ref()
                                .clone();
                            let script = format!(
                                "window.location.replace({});",
                                serde_json::to_string(&server_url).unwrap_or_default()
                            );
                            let _ = win.eval(&script);
                        }
                    }
                    Err(error) => {
                        *state.last_error.lock().await = Some(error.clone());
                        let _ = app_handle
                            .tray_handle()
                            .get_item("server_status")
                            .set_title("Server status: startup failed");
                        append_server_log(format!("Shell startup failure: {}", error));
                        if let Some(win) = app_handle.get_window("main") {
                            let _ = win.set_title("HVideo Admin - Server startup failed");
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                }
            });
            Ok(())
        })
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } | SystemTrayEvent::DoubleClick { .. } => {
                if let Some(win) = app.get_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "show" => {
                    if let Some(win) = app.get_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                "restart" => {
                    let app_handle = app.clone();
                    let state = app.state::<ServerState>().inner().clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = restart_backend(&app_handle, &state).await;
                    });
                }
                "quit" => {
                    let state = app.state::<ServerState>().inner().clone();
                    tauri::async_runtime::spawn(async move {
                        let _guard = state.restart_lock.lock().await;
                        append_server_log("User requested application exit");
                        if let Err(error) =
                            hvideo_server::process_guard::request_user_exit("tray quit")
                        {
                            append_server_log(format!(
                                "Could not notify watchdog of user exit: {error}"
                            ));
                            return;
                        }
                        if let Err(error) = stop_backend(&state).await {
                            append_server_log(error);
                        }
                        std::process::exit(0);
                    });
                }
                _ => {}
            },
            _ => {}
        })
        .on_window_event(|event| {
            if event.window().label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                event.window().hide().ok();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            select_directories,
            admin_language::get_admin_language,
            admin_language::set_admin_language,
            get_server_status,
            open_terminal_settings,
            get_app_version,
            get_server_url,
            get_server_network_options,
            select_server_network,
            open_logs_dir,
            open_data_dir,
            restart_server,
            relaunch_app,
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时出错");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn readiness_does_not_accept_an_unrelated_listener() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let state = ServerState {
            running: Arc::new(Mutex::new(false)),
            start_time: Arc::new(Mutex::new(None)),
            server_handle: Arc::new(Mutex::new(None)),
            shutdown_tx: Arc::new(Mutex::new(None)),
            last_error: Arc::new(Mutex::new(None)),
            restart_lock: Arc::new(Mutex::new(())),
            desktop_server_url: Arc::new(format!("http://{}", listener.local_addr().unwrap())),
        };
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(30),
            wait_for_backend_ready(&state)
        )
        .await
        .is_err());
        *state.last_error.lock().await = Some("HTTP/TCP 9898 端口已被占用".to_string());
        assert!(wait_for_backend_ready(&state)
            .await
            .unwrap_err()
            .contains("端口已被占用"));
        *state.last_error.lock().await = None;
        *state.running.lock().await = true;
        assert!(wait_for_backend_ready(&state).await.is_ok());
    }

    #[tokio::test]
    async fn interrupted_stop_keeps_thread_until_it_really_exits() {
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let handle = std::thread::spawn(move || {
            let _ = wait.recv();
        });
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let state = ServerState {
            running: Arc::new(Mutex::new(true)),
            start_time: Arc::new(Mutex::new(Some(std::time::Instant::now()))),
            server_handle: Arc::new(Mutex::new(Some(handle))),
            shutdown_tx: Arc::new(Mutex::new(Some(shutdown_tx))),
            last_error: Arc::new(Mutex::new(None)),
            restart_lock: Arc::new(Mutex::new(())),
            desktop_server_url: Arc::new(String::new()),
        };
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), stop_backend(&state))
                .await
                .is_err()
        );
        assert!(shutdown_rx.await.is_ok());
        assert!(state.server_handle.lock().await.is_some());
        assert!(!*state.running.lock().await);
        assert!(state.start_time.lock().await.is_none());
        release.send(()).unwrap();
        stop_backend(&state).await.unwrap();
        assert!(state.server_handle.lock().await.is_none());
    }
}
