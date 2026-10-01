use serde::Deserialize;
use std::path::Path;

static CONFIG_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 服务器全局配置
#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub song_db: SongDbConfig,
    pub cloud: CloudConfig,
    pub scanner: ScannerConfig,
    pub jwt: JwtConfig,
    pub storage: StorageConfig,
    /// UDP 发现服务配置（可选，缺省时使用默认值）
    #[serde(default)]
    pub discover: DiscoverConfig,
}

/// UDP 发现协议配置（协议版本 1.0，端口 18080）
#[derive(Debug, Clone, Deserialize)]
pub struct DiscoverConfig {
    /// 发现服务 UDP 端口
    #[serde(default = "default_discover_port")]
    pub udp_port: u16,
    /// 设备对外显示名称（缺省时使用主机名）
    pub device_name: Option<String>,
    /// 各服务端口（缺省时 http 使用 server.port，其余使用默认值）
    #[serde(default)]
    pub ports: DiscoverPorts,
}

fn default_discover_port() -> u16 {
    18080
}

impl Default for DiscoverConfig {
    fn default() -> Self {
        Self {
            udp_port: 18080,
            device_name: None,
            ports: DiscoverPorts::default(),
        }
    }
}

/// 发现协议中广播的端口表
#[derive(Debug, Clone, Deserialize, Default)]
pub struct DiscoverPorts {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mobile: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vod: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ws: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tcp: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub udp: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SongDbConfig {
    /// 歌曲库数据库路径
    pub url: String,
    /// 最大连接数
    pub max_connections: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    /// 监听地址
    pub host: String,
    /// 监听端口
    pub port: u16,
    /// 工作线程数
    pub workers: usize,
}

impl ServerConfig {
    /// Network recovery must not depend on unrelated credentials being valid.
    pub fn load<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        #[derive(Deserialize)]
        struct NetworkConfig {
            server: ServerConfig,
        }
        Ok(toml::from_str::<NetworkConfig>(&std::fs::read_to_string(path)?)?.server)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    /// SQLite 数据库文件路径
    pub url: String,
    /// 最大连接数
    pub max_connections: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CloudUpdateMode {
    #[default]
    Manual,
    Auto,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CloudConfig {
    /// 云端 API 基础地址
    pub api_base_url: String,
    /// API 密钥
    pub api_key: String,
    /// 下载临时目录
    pub download_dir: String,
    #[serde(default)]
    pub update_mode: CloudUpdateMode,
    /// Runtime-only signed proof; never persisted or returned to the browser.
    #[serde(skip)]
    pub license_proof: String,
    #[serde(skip)]
    pub cloud_update_expires_at: Option<i64>,
    #[serde(skip)]
    pub config_path: Option<std::path::PathBuf>,
}

impl CloudConfig {
    /// Reload only cloud settings so edits apply to new requests without restarting.
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        #[derive(Deserialize)]
        struct CloudSection {
            cloud: CloudConfig,
        }
        let mut config = toml::from_str::<CloudSection>(&std::fs::read_to_string(path)?)?.cloud;
        config.config_path = Some(path.to_path_buf());
        Ok(config)
    }
}

pub fn save_cloud_config(
    path: &Path,
    api_base_url: &str,
    download_dir: &str,
    api_key: Option<&str>,
    update_mode: Option<CloudUpdateMode>,
) -> anyhow::Result<CloudConfig> {
    let _guard = CONFIG_WRITE_LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("config write lock poisoned"))?;
    let mut value: toml::Value = std::fs::read_to_string(path)?.parse()?;
    let cloud = value
        .get_mut("cloud")
        .and_then(toml::Value::as_table_mut)
        .ok_or_else(|| anyhow::anyhow!("缺少云端配置"))?;
    cloud.insert(
        "api_base_url".into(),
        toml::Value::String(api_base_url.trim().trim_end_matches('/').into()),
    );
    cloud.insert(
        "download_dir".into(),
        toml::Value::String(download_dir.trim().into()),
    );
    if let Some(key) = api_key {
        cloud.insert("api_key".into(), toml::Value::String(key.trim().into()));
    }
    if let Some(mode) = update_mode {
        cloud.insert("update_mode".into(), toml::Value::try_from(mode)?);
    }
    let config: CloudConfig = value["cloud"].clone().try_into()?;
    crate::services::cloud_service::CloudService::validate_config(&config)?;
    write_config_atomically(path, toml::to_string_pretty(&value)?.as_bytes())?;
    Ok(config)
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScannerConfig {
    /// Player handshake scan interval in seconds.
    pub interval_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JwtConfig {
    /// JWT 密钥
    pub secret: String,
    /// Token 过期时间（小时）
    pub expire_hours: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StorageConfig {
    /// 歌曲文件存储根目录
    pub songs_dir: String,
    /// MV 文件存储根目录
    pub mv_dir: String,
    /// 歌曲媒体文件磁盘根目录（终端通过 HTTP 流式请求视频文件）
    /// 终端请求 /YN-song/xxx.mp4 时，实际读取 media_root/YN-song/xxx.mp4
    #[serde(default)]
    pub media_root: String,
}

impl AppConfig {
    /// 从 TOML 配置文件加载配置
    pub fn load<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: AppConfig = toml::from_str(&content)?;
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> anyhow::Result<()> {
        if needs_jwt_initialization(&self.jwt.secret) {
            anyhow::bail!("jwt.secret must be a non-placeholder secret of at least 32 characters");
        }
        if self
            .cloud
            .api_key
            .trim()
            .eq_ignore_ascii_case("your-cloud-api-key-here")
        {
            anyhow::bail!("cloud.api_key is still a placeholder; set a real key or leave it empty");
        }
        Ok(())
    }

    /// Upgrade legacy template credentials once, before any listeners or tasks start.
    /// Existing valid secrets stay byte-for-byte unchanged across subsequent launches.
    pub fn load_for_startup<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        use ring::rand::SecureRandom;
        let _guard = CONFIG_WRITE_LOCK
            .lock()
            .map_err(|_| anyhow::anyhow!("config write lock poisoned"))?;
        let path = path.as_ref();
        let content = std::fs::read_to_string(path)?;
        let mut config: AppConfig = toml::from_str(&content)?;
        let mut value: toml::Value = toml::from_str(&content)?;
        let initialize_jwt = needs_jwt_initialization(&config.jwt.secret);
        let clear_cloud_placeholder = config
            .cloud
            .api_key
            .trim()
            .eq_ignore_ascii_case("your-cloud-api-key-here");
        if initialize_jwt {
            let mut bytes = [0_u8; 32];
            ring::rand::SystemRandom::new()
                .fill(&mut bytes)
                .map_err(|_| anyhow::anyhow!("无法生成登录安全密钥，请重试启动"))?;
            config.jwt.secret = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
            value["jwt"]["secret"] = toml::Value::String(config.jwt.secret.clone());
        }
        if clear_cloud_placeholder {
            config.cloud.api_key.clear();
            value["cloud"]["api_key"] = toml::Value::String(String::new());
        }
        config.validate()?;
        if initialize_jwt || clear_cloud_placeholder {
            write_config_atomically(path, toml::to_string_pretty(&value)?.as_bytes()).map_err(
                |error| {
                    anyhow::anyhow!(
                        "无法保存初始化后的安全配置 {}：{}，请检查目录写入权限",
                        path.display(),
                        error
                    )
                },
            )?;
            tracing::info!(
                "启动配置初始化完成：登录密钥初始化={}，清除云端示例密钥={}",
                initialize_jwt,
                clear_cloud_placeholder
            );
        }
        Ok(config)
    }
}

fn needs_jwt_initialization(secret: &str) -> bool {
    secret.trim().len() < 32
        || secret
            .trim()
            .eq_ignore_ascii_case("change-this-to-a-secure-random-string")
}

/// Persist the selected server IPv4 interface and port without changing other settings.
pub fn save_server_network<P: AsRef<Path>>(
    path: P,
    host: std::net::Ipv4Addr,
    port: u16,
) -> anyhow::Result<()> {
    let _guard = CONFIG_WRITE_LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("config write lock poisoned"))?;
    if port == 0 {
        anyhow::bail!("server port must be between 1 and 65535");
    }
    let path = path.as_ref();
    let content = std::fs::read_to_string(path)?;
    let updated = update_server_network_toml(&content, host, port)?;
    write_config_atomically(path, updated.as_bytes())?;
    Ok(())
}

pub(crate) fn update_server_network_toml(
    content: &str,
    host: std::net::Ipv4Addr,
    port: u16,
) -> anyhow::Result<String> {
    let mut value = content.parse::<toml::Value>()?;
    let server = value
        .get_mut("server")
        .and_then(toml::Value::as_table_mut)
        .ok_or_else(|| anyhow::anyhow!("config.toml is missing the [server] section"))?;
    server.insert("host".to_string(), toml::Value::String(host.to_string()));
    server.insert("port".to_string(), toml::Value::Integer(i64::from(port)));
    Ok(toml::to_string_pretty(&value)?)
}

fn write_config_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;

    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.toml");
    let temp_path = parent.join(format!(".{}.{}.tmp", file_name, std::process::id()));

    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&temp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        replace_file(&temp_path, path)
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    result
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::rename(source, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_config() -> String {
        r#"[server]
host = "192.168.1.145"
port = 9898
workers = 4
[database]
url = "sqlite:./data/test.db"
max_connections = 2
[song_db]
url = "sqlite:./song_db/song.db"
max_connections = 2
[cloud]
api_base_url = "https://example.invalid"
api_key = "your-cloud-api-key-here"
download_dir = "./downloads"
[scanner]
interval_secs = 30
[jwt]
secret = "change-this-to-a-secure-random-string"
expire_hours = 24
[storage]
songs_dir = "./songs"
mv_dir = "./mv"
media_root = "D:/media"
[custom]
keep = "unchanged"
"#
        .to_string()
    }

    #[test]
    fn network_options_ignore_invalid_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let content = legacy_config();
        std::fs::write(&path, &content).unwrap();
        assert!(AppConfig::load(&path).is_err());
        let network = ServerConfig::load(&path).unwrap();
        assert_eq!(network.host, "192.168.1.145");
        assert_eq!(network.port, 9898);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
    }

    #[test]
    fn startup_initializes_legacy_credentials_once_without_changing_settings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let original = legacy_config();
        std::fs::write(&path, &original).unwrap();
        let config = AppConfig::load_for_startup(&path).unwrap();
        assert_eq!(config.jwt.secret.len(), 64);
        assert!(config
            .jwt
            .secret
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit()));
        assert!(config.cloud.api_key.is_empty());
        let saved = std::fs::read_to_string(&path).unwrap();
        let mut expected: toml::Value = toml::from_str(&original).unwrap();
        expected["jwt"]["secret"] = toml::Value::String(config.jwt.secret.clone());
        expected["cloud"]["api_key"] = toml::Value::String(String::new());
        assert_eq!(toml::from_str::<toml::Value>(&saved).unwrap(), expected);
        assert_eq!(
            AppConfig::load_for_startup(&path).unwrap().jwt.secret,
            config.jwt.secret
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), saved);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        let second = dir.path().join("second.toml");
        std::fs::write(&second, original).unwrap();
        assert_ne!(
            AppConfig::load_for_startup(second).unwrap().jwt.secret,
            config.jwt.secret
        );
    }

    #[test]
    fn startup_replaces_short_secret_but_preserves_valid_secret_and_cloud_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let original = legacy_config()
            .replace("change-this-to-a-secure-random-string", "short")
            .replace("your-cloud-api-key-here", "real-cloud-key");
        std::fs::write(&path, original).unwrap();
        let config = AppConfig::load_for_startup(&path).unwrap();
        assert_eq!(config.jwt.secret.len(), 64);
        assert_eq!(config.cloud.api_key, "real-cloud-key");
        let saved = std::fs::read_to_string(&path).unwrap();
        AppConfig::load_for_startup(&path).unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), saved);
    }

    #[test]
    fn malformed_config_is_not_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let original = "[server\nhost = broken";
        std::fs::write(&path, original).unwrap();
        assert!(AppConfig::load_for_startup(&path).is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), original);
    }

    #[test]
    fn cloud_settings_persist_without_exposing_or_overwriting_other_settings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, legacy_config()).unwrap();
        let original = AppConfig::load_for_startup(&path).unwrap();
        save_cloud_config(
            &path,
            "http://60.205.127.117:8080/",
            "D:/MV/cloud",
            Some("test-key"),
            Some(CloudUpdateMode::Auto),
        )
        .unwrap();
        save_cloud_config(&path, "http://127.0.0.1:8080", "D:/MV/new", None, None).unwrap();
        let saved = AppConfig::load(&path).unwrap();
        assert_eq!(saved.jwt.secret, original.jwt.secret);
        assert_eq!(saved.server.host, original.server.host);
        assert_eq!(saved.database.url, original.database.url);
        assert_eq!(saved.cloud.api_key, "test-key");
        assert_eq!(original.cloud.update_mode, CloudUpdateMode::Manual);
        assert_eq!(saved.cloud.update_mode, CloudUpdateMode::Auto);
        assert_eq!(CloudConfig::load(&path).unwrap().download_dir, "D:/MV/new");
        save_cloud_config(&path, "http://127.0.0.1:8080", "./downloads", Some(""), None).unwrap();
        assert!(CloudConfig::load(&path).unwrap().api_key.is_empty());
        save_cloud_config(&path, "http://localhost", "./downloads", None, Some(CloudUpdateMode::Manual)).unwrap();
        assert_eq!(CloudConfig::load(&path).unwrap().update_mode, CloudUpdateMode::Manual);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn invalid_cloud_settings_leave_saved_config_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, legacy_config()).unwrap();
        AppConfig::load_for_startup(&path).unwrap();
        let before = std::fs::read(&path).unwrap();
        for base in [
            "file:///etc",
            "https://cloud.example.com",
            "http://user:password@localhost",
            "http://localhost?token=secret",
        ] {
            assert!(save_cloud_config(&path, base, "./downloads", None, None).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), before);
        }
        assert!(save_cloud_config(&path, "http://localhost", " ", None, None).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn concurrent_initialization_and_network_save_preserve_both_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, legacy_config()).unwrap();
        std::thread::scope(|scope| {
            let first = scope.spawn(|| AppConfig::load_for_startup(&path).unwrap().jwt.secret);
            let second = scope.spawn(|| AppConfig::load_for_startup(&path).unwrap().jwt.secret);
            let network = scope.spawn(|| {
                save_server_network(&path, "192.168.1.146".parse().unwrap(), 9999).unwrap()
            });
            assert_eq!(first.join().unwrap(), second.join().unwrap());
            network.join().unwrap();
        });
        let config = AppConfig::load(&path).unwrap();
        assert_eq!(config.server.host, "192.168.1.146");
        assert_eq!(config.server.port, 9999);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
