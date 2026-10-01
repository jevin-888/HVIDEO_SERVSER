use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

const PRODUCT: &str = "hvideo-server";
const PUBLIC_KEY_BASE64: &str = "OW/EBFolccAAyW09ajnzqqZPc450/2a6n/N26UoyiZk=";
const MACHINE_CODE_PREFIX: &str = "HVIDEO-SERVER-V1";
const PERMANENT_LICENSE_SECONDS: i64 = 10 * 365 * 24 * 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloudUpdateLicense {
    pub enabled: bool,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudUpdateStatus {
    pub enabled: bool,
    pub valid: bool,
    pub expires_at: Option<i64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VenueLicenseInfo {
    pub name: String,
    pub contact: String,
    pub phone: String,
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerLicensePayload {
    pub version: u32,
    pub product: String,
    pub license_id: String,
    pub machine_code: String,
    pub issued_at: i64,
    pub expires_at: i64,
    pub venue: VenueLicenseInfo,
    pub terminal_limit: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<crate::player_license::PlayerLicense>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloud_update: Option<CloudUpdateLicense>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignedServerLicense {
    #[serde(flatten)]
    payload: ServerLicensePayload,
    signature: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub source: String,
    pub cloud_connected: Option<bool>,
    pub cloud_checked_at: Option<i64>,
    pub cloud_message: String,
    pub status: String,
    pub valid: bool,
    pub message: String,
    pub machine_code: String,
    pub license_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<ServerLicensePayload>,
}

#[derive(Debug, Clone)]
struct LoadedLicense {
    content: Option<String>,
    payload: Option<ServerLicensePayload>,
    status: String,
    message: String,
}

impl LoadedLicense {
    fn missing() -> Self {
        Self {
            content: None,
            payload: None,
            status: "missing".to_string(),
            message: "未找到服务器授权文件，请复制机器码并导入授权".to_string(),
        }
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self {
            content: None,
            payload: None,
            status: "invalid".to_string(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Default)]
struct CloudLicenseState {
    loaded: Option<LoadedLicense>,
    connected: Option<bool>,
    checked_at: Option<i64>,
    message: String,
}

#[derive(Clone)]
pub struct LicenseManager {
    machine_code: Arc<String>,
    path: Arc<PathBuf>,
    loaded: Arc<RwLock<LoadedLicense>>,
    cloud: Arc<RwLock<CloudLicenseState>>,
}

impl LicenseManager {
    pub fn new(path: PathBuf) -> Self {
        Self::for_machine(path, machine_code())
    }

    fn for_machine(path: PathBuf, machine_code: String) -> Self {
        let loaded = load_license_file(&path, &machine_code);
        let cached = load_license_file(&path.with_file_name("server-cloud.lic"), &machine_code);
        let cloud = CloudLicenseState {
            loaded: cached.payload.is_some().then_some(cached),
            ..Default::default()
        };
        Self {
            cloud: Arc::new(RwLock::new(cloud)),
            machine_code: Arc::new(machine_code),
            path: Arc::new(path),
            loaded: Arc::new(RwLock::new(loaded)),
        }
    }

    pub fn machine_code(&self) -> &str {
        self.machine_code.as_str()
    }

    pub fn status(&self) -> LicenseStatus {
        self.status_at(Utc::now().timestamp())
    }

    fn status_at(&self, now: i64) -> LicenseStatus {
        let cloud = self
            .cloud
            .read()
            .expect("cloud license state poisoned")
            .clone();
        let loaded = cloud
            .loaded
            .clone()
            .unwrap_or_else(|| self.loaded.read().expect("license state poisoned").clone());
        let source = if cloud.loaded.is_some() {
            if cloud.connected == Some(true) {
                "cloud"
            } else {
                "cloud_cache"
            }
        } else {
            "local"
        };
        let (status, valid, message) = match loaded.payload.as_ref() {
            Some(payload) if payload.machine_code != *self.machine_code => (
                "machine_mismatch".to_string(),
                false,
                "授权文件与本机机器码不匹配".to_string(),
            ),
            Some(payload) if payload.issued_at > now + 300 => (
                "not_yet_valid".to_string(),
                false,
                "授权尚未到生效时间，请检查服务器时间".to_string(),
            ),
            Some(payload) if !is_permanent_license(payload) && payload.expires_at < now => {
                ("expired".to_string(), false, "服务器授权已过期".to_string())
            }
            Some(payload) if is_permanent_license(payload) => {
                ("active".to_string(), true, "服务器永久授权有效".to_string())
            }
            Some(_) => ("active".to_string(), true, "服务器授权有效".to_string()),
            None => (loaded.status, false, loaded.message),
        };

        LicenseStatus {
            source: source.into(),
            cloud_connected: cloud.connected,
            cloud_checked_at: cloud.checked_at,
            cloud_message: cloud.message,
            status,
            valid,
            message,
            machine_code: self.machine_code.as_ref().clone(),
            license_path: if source == "local" {
                self.path.as_ref().clone()
            } else {
                self.path.with_file_name("server-cloud.lic")
            }
            .to_string_lossy()
            .to_string(),
            license: loaded.payload,
        }
    }

    pub fn ensure_valid(&self) -> Result<ServerLicensePayload, String> {
        let status = self.status();
        if status.valid {
            status.license.ok_or_else(|| "服务器授权有效".to_string())
        } else {
            Err(status.message)
        }
    }

    pub fn cloud_update_status(&self) -> CloudUpdateStatus {
        let status = self.status();
        let grant = status
            .license
            .as_ref()
            .and_then(|p| p.cloud_update.as_ref());
        let enabled = grant.is_some_and(|g| g.enabled);
        let expires_at = grant.map(|g| g.expires_at);
        let valid =
            status.valid && enabled && expires_at.is_some_and(|t| t >= Utc::now().timestamp());
        let message = if !status.valid {
            status.message
        } else if !enabled {
            "未授权云端更新，请重新签发服务器授权".into()
        } else if !valid {
            "云端更新授权已到期，请续期".into()
        } else {
            "云端更新授权有效".into()
        };
        CloudUpdateStatus {
            enabled,
            valid,
            expires_at,
            message,
        }
    }

    pub fn cloud_update_proof(&self) -> Result<String, String> {
        let status = self.cloud_update_status();
        if !status.valid {
            return Err(status.message);
        }
        let cloud = self
            .cloud
            .read()
            .expect("cloud license state poisoned")
            .clone();
        let loaded = cloud
            .loaded
            .unwrap_or_else(|| self.loaded.read().expect("license state poisoned").clone());
        let content = loaded
            .content
            .ok_or_else(|| "读取云端更新授权失败".to_string())?;
        let payload = verify_license(&content, self.machine_code())?;
        validate_active_period(&payload, Utc::now().timestamp())?;
        validate_cloud_period(&payload, Utc::now().timestamp())?;
        Ok(content.trim().to_string())
    }

    /// Signed machine identity only: delayed reports may be sent after entitlement expiry.
    /// This method MUST NOT be used to authorize downloads.
    pub fn reporting_proof(&self) -> Result<String, String> {
        let cloud = self.cloud.read().expect("cloud license state poisoned").clone();
        let loaded = cloud.loaded.unwrap_or_else(|| self.loaded.read().expect("license state poisoned").clone());
        let content = loaded.content.ok_or_else(|| "无服务器授权".to_string())?;
        verify_license(&content, self.machine_code())?;
        Ok(content.trim().to_string())
    }

    pub fn terminal_limit(&self) -> Result<u32, String> {
        self.ensure_valid().map(|license| license.terminal_limit)
    }

    pub fn import(&self, content: &str) -> Result<LicenseStatus, String> {
        let payload = verify_license(content, self.machine_code())?;
        validate_active_period(&payload, Utc::now().timestamp())?;
        write_license_atomically(self.path.as_ref(), content.trim())?;
        *self.loaded.write().expect("license state poisoned") = LoadedLicense {
            content: Some(content.trim().to_string()),
            payload: Some(payload),
            status: "active".to_string(),
            message: "服务器授权有效".to_string(),
        };
        Ok(self.status())
    }
}

fn write_license_atomically(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建授权目录失败：{e}"))?;
    }
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temp, content).map_err(|e| format!("写入授权缓存失败：{e}"))?;
    if let Err(e) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(format!("保存授权缓存失败：{e}"));
    }
    Ok(())
}

impl LicenseManager {
    fn accept_cloud(&self, response: Value, nonce: &str) -> Result<(), String> {
        let content = verify_cloud_response(response, self.machine_code(), nonce)?;
        self.accept_verified_cloud_content(content)
    }
    fn accept_verified_cloud_content(&self, content: Option<String>) -> Result<(), String> {
        let mut cache_error = None;
        let loaded = if let Some(content) = content {
            // Verify signature and binding even for an expired grant. An explicit expiry
            // stays authoritative offline; an older local file cannot extend it.
            let payload = verify_license(&content, self.machine_code())?;
            cache_error =
                write_license_atomically(&self.path.with_file_name("server-cloud.lic"), &content)
                    .err();
            Some(LoadedLicense {
                content: Some(content),
                payload: Some(payload),
                status: "active".into(),
                message: "服务器授权有效".into(),
            })
        } else {
            let path = self.path.with_file_name("server-cloud.lic");
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => cache_error = Some(format!("清理旧云端授权缓存失败：{e}")),
            }
            None
        };
        *self.cloud.write().expect("cloud license state poisoned") = CloudLicenseState {
            message: cache_error.unwrap_or_else(|| {
                if loaded.is_some() {
                    "已获取云端授权".into()
                } else {
                    "云端暂无授权，使用本地授权".into()
                }
            }),
            loaded,
            connected: Some(true),
            checked_at: Some(Utc::now().timestamp()),
        };
        Ok(())
    }
    pub async fn refresh_cloud(&self, base_url: &str) {
        self.refresh_cloud_with_storage(base_url,None).await;
    }
    async fn refresh_cloud_with_storage(&self, base_url:&str, storage:Option<Value>) {
        let result = async {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(4))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| "无法创建授权连接".to_string())?;
            let nonce = uuid::Uuid::new_v4().to_string();
            let mut request=serde_json::json!({"machineCode":self.machine_code(),"nonce":nonce});
            if let Some(storage)=storage {request["storage"]=storage;}
            let mut response = client
                .post(format!(
                    "{}/api/server-license/resolve",
                    base_url.trim_end_matches('/')
                ))
                .json(&request)
                .send()
                .await
                .map_err(|_| "无法连接云端授权服务".to_string())?;
            if !response.status().is_success() {
                return Err(format!(
                    "云端授权服务暂不可用（{}）",
                    response.status().as_u16()
                ));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "读取云端授权失败".to_string())?
            {
                if bytes.len() + chunk.len() > 64 * 1024 {
                    return Err("云端授权响应过大".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            let mut envelope: Value =
                serde_json::from_slice(&bytes).map_err(|_| "云端授权响应格式错误".to_string())?;
            if envelope["code"] != 0 {
                return Err("云端授权查询失败".into());
            }
            self.accept_cloud(envelope["data"].take(), &nonce)
        }
        .await;
        if let Err(error) = result {
            let mut state = self.cloud.write().expect("cloud license state poisoned");
            state.connected = Some(false);
            state.checked_at = Some(Utc::now().timestamp());
            state.message = error;
        }
    }
    pub async fn run_cloud_refresh(&self, config_path: &Path) {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut pending:Option<tokio::task::JoinHandle<Value>>=None;
        loop {
            interval.tick().await;
            if let Ok(config) = crate::config::CloudConfig::load(config_path) {
                // Enumeration runs after HTTP startup, with one bounded background worker.
                // A slow/unavailable drive must not block authorization or spawn workers repeatedly.
                if pending.is_none() {
                    let directory=config.download_dir.clone();
                    pending=Some(tokio::task::spawn_blocking(move ||crate::services::cloud_storage::storage_report(&directory)));
                }
                let storage=match tokio::time::timeout(std::time::Duration::from_secs(2),pending.as_mut().unwrap()).await {
                    Ok(result)=>{pending=None;result.ok()},
                    Err(_)=>None,
                };
                self.refresh_cloud_with_storage(&config.api_base_url,storage).await;
            }
        }
    }
}

fn verify_cloud_response(
    value: Value,
    machine: &str,
    nonce: &str,
) -> Result<Option<String>, String> {
    verify_cloud_response_with_key(
        value,
        machine,
        nonce,
        Utc::now().timestamp(),
        PUBLIC_KEY_BASE64,
    )
}
fn verify_cloud_response_with_key(
    mut value: Value,
    machine: &str,
    nonce: &str,
    now: i64,
    public_key: &str,
) -> Result<Option<String>, String> {
    let signature = value
        .as_object_mut()
        .and_then(|m| m.remove("signature"))
        .and_then(|v| v.as_str().map(str::to_owned))
        .ok_or("缺少云端响应签名")?;
    let bytes: [u8; 32] = BASE64
        .decode(public_key)
        .map_err(|_| "无效公钥")?
        .try_into()
        .map_err(|_| "无效公钥")?;
    let sig = Signature::from_slice(&BASE64.decode(signature).map_err(|_| "无效云端响应签名")?)
        .map_err(|_| "无效云端响应签名")?;
    VerifyingKey::from_bytes(&bytes)
        .map_err(|_| "无效公钥")?
        .verify(canonical_json_string(&value).as_bytes(), &sig)
        .map_err(|_| "云端响应签名校验失败")?;
    if value["product"] != "hvideo-server-cloud-response"
        || value["machineCode"] != machine
        || value["nonce"] != nonce
    {
        return Err("云端响应与本次机器请求不匹配".into());
    }
    let server_time = value["serverTime"].as_i64().ok_or("缺少云端时间")?;
    if server_time.abs_diff(now) > 300 {
        return Err("云端与本机时间相差超过 5 分钟，请校准时间".into());
    }
    match value.get("content") {
        Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if !s.is_empty() => Ok(Some(s.clone())),
        _ => Err("云端授权内容无效".into()),
    }
}

pub fn default_license_path(config_path: &Path) -> PathBuf {
    config_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("license")
        .join("server.lic")
}

fn load_license_file(path: &Path, machine_code: &str) -> LoadedLicense {
    if !path.is_file() {
        return LoadedLicense::missing();
    }
    match fs::read_to_string(path) {
        Ok(content) => match verify_license(&content, machine_code) {
            Ok(payload) => LoadedLicense {
                content: Some(content.trim().to_string()),
                payload: Some(payload),
                status: "active".to_string(),
                message: "服务器授权有效".to_string(),
            },
            Err(error) => LoadedLicense::invalid(error),
        },
        Err(error) => LoadedLicense::invalid(format!("读取授权文件失败: {error}")),
    }
}

fn verify_license(
    content: &str,
    expected_machine_code: &str,
) -> Result<ServerLicensePayload, String> {
    let decoded = BASE64
        .decode(content.trim())
        .map_err(|_| "授权文件不是有效的 Base64 内容".to_string())?;
    let signed: SignedServerLicense =
        serde_json::from_slice(&decoded).map_err(|_| "授权文件内容格式不正确".to_string())?;
    if ![1, 2].contains(&signed.payload.version) || signed.payload.product != PRODUCT {
        return Err("授权版本或产品类型不匹配".to_string());
    }
    if signed.payload.machine_code != expected_machine_code {
        return Err("授权机器码与本机不一致".to_string());
    }
    if signed.payload.terminal_limit == 0 {
        return Err("授权终端点数不能为 0".to_string());
    }
    if signed.payload.expires_at <= signed.payload.issued_at {
        return Err("授权到期时间无效".to_string());
    }
    if signed.payload.venue.name.trim().is_empty() {
        return Err("授权场所名称不能为空".to_string());
    }
    match &signed.payload.license {
        Some(license) => license.validate()?,
        None if signed.payload.version >= 2 => return Err("授权缺少播放器模块和图层".to_string()),
        None => {} // Legacy files still license the server, but cannot grant player rights.
    }

    let canonical = canonical_json_string(
        &serde_json::to_value(&signed.payload).map_err(|error| error.to_string())?,
    );
    let public_bytes = BASE64
        .decode(PUBLIC_KEY_BASE64)
        .map_err(|_| "内置授权公钥格式错误".to_string())?;
    let public_array: [u8; 32] = public_bytes
        .try_into()
        .map_err(|_| "内置授权公钥长度错误".to_string())?;
    let public_key =
        VerifyingKey::from_bytes(&public_array).map_err(|_| "内置授权公钥无效".to_string())?;
    let signature_bytes = BASE64
        .decode(&signed.signature)
        .map_err(|_| "授权签名格式错误".to_string())?;
    let signature =
        Signature::from_slice(&signature_bytes).map_err(|_| "授权签名长度错误".to_string())?;
    public_key
        .verify(canonical.as_bytes(), &signature)
        .map_err(|_| "授权签名校验失败，文件可能已被篡改".to_string())?;
    Ok(signed.payload)
}

fn validate_cloud_period(payload: &ServerLicensePayload, now: i64) -> Result<(), String> {
    match &payload.cloud_update {
        Some(grant)
            if grant.enabled && grant.expires_at >= now && grant.expires_at > payload.issued_at =>
        {
            Ok(())
        }
        Some(grant) if grant.enabled => Err("云端更新授权已到期，请续期".into()),
        _ => Err("未授权云端更新，请重新签发服务器授权".into()),
    }
}

pub fn is_permanent_license(payload: &ServerLicensePayload) -> bool {
    payload.expires_at.saturating_sub(payload.issued_at) >= PERMANENT_LICENSE_SECONDS
}

fn validate_active_period(payload: &ServerLicensePayload, now: i64) -> Result<(), String> {
    if payload.issued_at > now + 300 {
        return Err("授权尚未到生效时间，请检查服务器时间".to_string());
    }
    if !is_permanent_license(payload) && payload.expires_at < now {
        return Err("服务器授权已过期".to_string());
    }
    Ok(())
}

fn canonical_json_string(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let sorted: BTreeMap<_, _> = map.iter().collect();
            let parts = sorted
                .iter()
                .map(|(key, value)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(key).expect("serialize key"),
                        canonical_json_string(value)
                    )
                })
                .collect::<Vec<_>>();
            format!("{{{}}}", parts.join(","))
        }
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json_string)
                .collect::<Vec<_>>()
                .join(",")
        ),
        _ => serde_json::to_string(value).expect("serialize json value"),
    }
}

pub fn machine_code() -> String {
    let source = machine_identity_source();
    let digest = Sha256::digest(format!("{MACHINE_CODE_PREFIX}|{source}").as_bytes());
    let hex = hex_upper(&digest[..16]);
    format!(
        "{}-{}-{}-{}-{}-{}-{}-{}",
        &hex[0..4],
        &hex[4..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..24],
        &hex[24..28],
        &hex[28..32]
    )
}

fn hex_upper(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02X}")).collect()
}

#[cfg(windows)]
fn machine_identity_source() -> String {
    use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography")
        .and_then(|key| key.get_value::<String, _>("MachineGuid"))
        .map(|value| value.trim().to_ascii_uppercase())
        .unwrap_or_else(|_| fallback_machine_identity())
}

#[cfg(not(windows))]
fn machine_identity_source() -> String {
    ["/etc/machine-id", "/var/lib/dbus/machine-id"]
        .iter()
        .find_map(|path| fs::read_to_string(path).ok())
        .map(|value| value.trim().to_ascii_uppercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(fallback_machine_identity)
}

fn fallback_machine_identity() -> String {
    format!(
        "{}|{}|{}",
        sysinfo::System::host_name().unwrap_or_else(|| "UNKNOWN-HOST".to_string()),
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_response_signature_binds_machine_nonce_time_and_content() {
        use ed25519_dalek::{Signer, SigningKey};
        let key = SigningKey::from_bytes(&[42; 32]);
        let public = BASE64.encode(key.verifying_key().to_bytes());
        let mut response = serde_json::json!({"product":"hvideo-server-cloud-response","machineCode":"machine","nonce":"nonce","serverTime":1700000000,"content":"signed-file"});
        response["signature"] = Value::String(
            BASE64.encode(
                key.sign(canonical_json_string(&response).as_bytes())
                    .to_bytes(),
            ),
        );
        assert_eq!(
            verify_cloud_response_with_key(
                response.clone(),
                "machine",
                "nonce",
                1700000000,
                &public
            )
            .unwrap(),
            Some("signed-file".into())
        );
        assert!(verify_cloud_response_with_key(
            response.clone(),
            "other",
            "nonce",
            1700000000,
            &public
        )
        .is_err());
        assert!(verify_cloud_response_with_key(
            response.clone(),
            "machine",
            "old-nonce",
            1700000000,
            &public
        )
        .is_err());
        assert!(verify_cloud_response_with_key(
            response.clone(),
            "machine",
            "nonce",
            1700000301,
            &public
        )
        .is_err());
        response["content"] = Value::Null;
        assert!(
            verify_cloud_response_with_key(response, "machine", "nonce", 1700000000, &public)
                .is_err()
        );
    }
    #[test]
    fn verified_cache_survives_restart_and_cloud_expiry_does_not_restore_older_local_rights() {
        let dir = tempfile::tempdir().unwrap();
        let local = dir.path().join("server.lic");
        let fixture = include_str!("../tests/fixtures/cloud-update-expired.lic");
        let machine = "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222";
        write_license_atomically(&local, fixture).unwrap();
        let manager = LicenseManager::for_machine(local.clone(), machine.into());
        assert_eq!(manager.status_at(1700000000).source, "local");
        assert!(manager.status_at(1700000000).valid);
        let cache = dir.path().join("server-cloud.lic");
        write_license_atomically(&cache, fixture).unwrap();
        // Existing destinations can be replaced atomically on Windows as well.
        write_license_atomically(&cache, fixture).unwrap();
        let restarted = LicenseManager::for_machine(local.clone(), machine.into());
        assert_eq!(restarted.status_at(1700000000).source, "cloud_cache");
        let expiry = restarted.status().license.unwrap().expires_at;
        assert_eq!(restarted.status_at(expiry + 1).status, "expired");
        restarted
            .loaded
            .write()
            .unwrap()
            .payload
            .as_mut()
            .unwrap()
            .expires_at = i64::MAX;
        assert!(!restarted.status_at(expiry + 1).valid);
        restarted.cloud.write().unwrap().connected = Some(true);
        assert_eq!(restarted.status_at(1700000000).source, "cloud");
        fs::write(&cache, "tampered").unwrap();
        assert_eq!(
            LicenseManager::for_machine(local.clone(), machine.into())
                .status_at(1700000000)
                .source,
            "local"
        );
        assert_eq!(fs::read_to_string(local).unwrap(), fixture.trim());
    }
    #[test]
    fn cloud_receipt_verifies_binding_and_remains_authoritative_when_cache_write_fails() {
        let dir = tempfile::tempdir().unwrap();
        let local = dir.path().join("server.lic");
        let fixture = include_str!("../tests/fixtures/cloud-update-expired.lic")
            .trim()
            .to_string();
        write_license_atomically(&local, &fixture).unwrap();
        let manager = LicenseManager::for_machine(
            local.clone(),
            "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222".into(),
        );
        manager
            .accept_verified_cloud_content(Some(fixture.clone()))
            .unwrap();
        assert_eq!(manager.status_at(1700000000).source, "cloud");
        assert_eq!(
            fs::read_to_string(dir.path().join("server-cloud.lic")).unwrap(),
            fixture
        );
        let before = manager.status_at(1700000000).license.unwrap();
        assert!(manager
            .accept_verified_cloud_content(Some("tampered".into()))
            .is_err());
        assert_eq!(manager.status_at(1700000000).license.unwrap(), before);
        manager.accept_verified_cloud_content(None).unwrap();
        assert_eq!(manager.status_at(1700000000).source, "local");
        // A directory at the cache path simulates replacement failure on both OS families.
        fs::create_dir(dir.path().join("server-cloud.lic")).unwrap();
        manager
            .accept_verified_cloud_content(Some(fixture.clone()))
            .unwrap();
        assert_eq!(manager.status_at(1700000000).source, "cloud");
        assert!(manager.status().cloud_message.contains("缓存"));
        assert_eq!(fs::read_to_string(local).unwrap(), fixture);
        let wrong = LicenseManager::for_machine(
            dir.path().join("wrong.lic"),
            "0000-0000-0000-0000-0000-0000-0000-0000".into(),
        );
        assert!(wrong.accept_verified_cloud_content(Some(fixture)).is_err());
    }
    #[tokio::test]
    async fn storage_telemetry_uses_resolve_without_changing_license_permissions() {
        let dir=tempfile::tempdir().unwrap();let manager=LicenseManager::new(dir.path().join("server.lic"));
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let url=format!("http://{}",listener.local_addr().unwrap());
        let storage=crate::services::cloud_storage::storage_report(dir.path().to_str().unwrap());
        let received=std::sync::Arc::new(tokio::sync::Mutex::new(Vec::<Value>::new()));let captured=received.clone();
        let app=axum::Router::new().route("/api/server-license/resolve",axum::routing::post(move |axum::Json(body):axum::Json<Value>| {
            let captured=captured.clone();async move {captured.lock().await.push(body);axum::Json(serde_json::json!({"code":0,"data":{}}))}
        }));
        let server=tokio::spawn(async move{axum::serve(listener,app).await.unwrap()});
        manager.refresh_cloud_with_storage(&url,Some(storage.clone())).await;
        manager.refresh_cloud(&url).await;
        let bodies=received.lock().await;assert_eq!(bodies.len(),2);
        assert_eq!(bodies[0]["machineCode"],manager.machine_code());assert_eq!(bodies[0]["storage"],storage);
        assert!(uuid::Uuid::parse_str(bodies[0]["nonce"].as_str().unwrap()).is_ok());
        assert!(bodies[1].get("storage").is_none());assert!(!manager.status().valid);
        server.abort();
    }

    #[tokio::test]
    async fn unavailable_cloud_keeps_verified_local_license() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("server.lic");
        write_license_atomically(
            &path,
            include_str!("../tests/fixtures/cloud-update-expired.lic"),
        )
        .unwrap();
        let manager =
            LicenseManager::for_machine(path, "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222".into());
        manager.refresh_cloud("invalid://unavailable").await;
        let status = manager.status_at(1700000000);
        assert!(status.valid);
        assert_eq!(status.source, "local");
        assert_eq!(status.cloud_connected, Some(false));
    }
    #[test]
    fn machine_code_has_stable_display_shape() {
        let code = machine_code();
        assert_eq!(code.len(), 39);
        assert_eq!(code.split('-').count(), 8);
    }

    #[test]
    fn verifies_license_generated_by_signing_tool_contract() {
        const LICENSE_CONTENT: &str = "eyJ2ZXJzaW9uIjoxLCJwcm9kdWN0IjoiaHZpZGVvLXNlcnZlciIsImxpY2Vuc2VJZCI6ImNyb3NzLXRvb2wtdGVzdC1saWNlbnNlIiwibWFjaGluZUNvZGUiOiJBQUFBLUJCQkItQ0NDQy1ERERELUVFRUUtRkZGRi0xMTExLTIyMjIiLCJpc3N1ZWRBdCI6MTcwMDAwMDAwMCwiZXhwaXJlc0F0IjoxOTAwMDAwMDAwLCJ2ZW51ZSI6eyJuYW1lIjoiVGVzdCBWZW51ZSIsImNvbnRhY3QiOiJBbGljZSIsInBob25lIjoiMTM4MDAwMDAwMDAiLCJhZGRyZXNzIjoiVGVzdCBBZGRyZXNzIn0sInRlcm1pbmFsTGltaXQiOjIwLCJzaWduYXR1cmUiOiJVaVdDNDkrYkNrOEhjTnFub1JpMi9SdWhRcmlZUkNJY1hSdkp6aGdMdXU1QUxTUTMyZEhBeUZCK1JISXd2b21JblBvdkVkMDIyQXVpaCtueStKM09Edz09In0=";
        let payload = verify_license(LICENSE_CONTENT, "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222")
            .expect("tool-generated license must verify");
        assert_eq!(payload.license_id, "cross-tool-test-license");
        assert_eq!(payload.terminal_limit, 20);
        assert_eq!(payload.venue.name, "Test Venue");
    }

    #[test]
    fn rejects_tool_license_for_another_machine() {
        const LICENSE_CONTENT: &str = "eyJ2ZXJzaW9uIjoxLCJwcm9kdWN0IjoiaHZpZGVvLXNlcnZlciIsImxpY2Vuc2VJZCI6ImNyb3NzLXRvb2wtdGVzdC1saWNlbnNlIiwibWFjaGluZUNvZGUiOiJBQUFBLUJCQkItQ0NDQy1ERERELUVFRUUtRkZGRi0xMTExLTIyMjIiLCJpc3N1ZWRBdCI6MTcwMDAwMDAwMCwiZXhwaXJlc0F0IjoxOTAwMDAwMDAwLCJ2ZW51ZSI6eyJuYW1lIjoiVGVzdCBWZW51ZSIsImNvbnRhY3QiOiJBbGljZSIsInBob25lIjoiMTM4MDAwMDAwMDAiLCJhZGRyZXNzIjoiVGVzdCBBZGRyZXNzIn0sInRlcm1pbmFsTGltaXQiOjIwLCJzaWduYXR1cmUiOiJVaVdDNDkrYkNrOEhjTnFub1JpMi9SdWhRcmlZUkNJY1hSdkp6aGdMdXU1QUxTUTMyZEhBeUZCK1JISXd2b21JblBvdkVkMDIyQXVpaCtueStKM09Edz09In0=";
        let error = verify_license(LICENSE_CONTENT, "FFFF-EEEE-DDDD-CCCC-BBBB-AAAA-2222-1111")
            .expect_err("machine mismatch must fail");
        assert!(error.contains("machine") || error.contains("机器码"));
    }

    #[test]
    fn import_period_requires_currently_active_license() {
        let payload = ServerLicensePayload {
            version: 1,
            product: PRODUCT.to_string(),
            license_id: "period-test".to_string(),
            machine_code: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222".to_string(),
            issued_at: 1_000,
            expires_at: 2_000,
            venue: VenueLicenseInfo {
                name: "Test Venue".to_string(),
                contact: "Alice".to_string(),
                phone: "13800000000".to_string(),
                address: "Test Address".to_string(),
            },
            terminal_limit: 20,
            license: None,
            cloud_update: None,
        };

        assert!(validate_active_period(&payload, 1_500).is_ok());
        assert!(validate_active_period(&payload, 699).is_err());
        assert!(validate_active_period(&payload, 2_001).is_err());
    }

    #[test]
    fn ten_year_license_is_permanent_and_does_not_expire() {
        let payload = ServerLicensePayload {
            version: 1,
            product: PRODUCT.to_string(),
            license_id: "permanent-period-test".to_string(),
            machine_code: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222".to_string(),
            issued_at: 1_000,
            expires_at: 1_000 + PERMANENT_LICENSE_SECONDS,
            venue: VenueLicenseInfo {
                name: "Test Venue".to_string(),
                contact: "Alice".to_string(),
                phone: "13800000000".to_string(),
                address: "Test Address".to_string(),
            },
            terminal_limit: 20,
            license: None,
            cloud_update: None,
        };

        assert!(is_permanent_license(&payload));
        assert!(validate_active_period(&payload, payload.expires_at + 1).is_ok());
    }

    #[test]
    fn license_shorter_than_ten_years_still_expires() {
        let payload = ServerLicensePayload {
            version: 1,
            product: PRODUCT.to_string(),
            license_id: "finite-period-test".to_string(),
            machine_code: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222".to_string(),
            issued_at: 1_000,
            expires_at: 1_000 + PERMANENT_LICENSE_SECONDS - 1,
            venue: VenueLicenseInfo {
                name: "Test Venue".to_string(),
                contact: "Alice".to_string(),
                phone: "13800000000".to_string(),
                address: "Test Address".to_string(),
            },
            terminal_limit: 20,
            license: None,
            cloud_update: None,
        };

        assert!(!is_permanent_license(&payload));
        assert!(validate_active_period(&payload, payload.expires_at + 1).is_err());
    }

    #[test]
    fn canonical_json_sorts_object_keys() {
        let value = serde_json::json!({"z": 1, "a": {"b": true, "a": "value"}});
        assert_eq!(
            canonical_json_string(&value),
            r#"{"a":{"a":"value","b":true},"z":1}"#
        );
    }

    #[test]
    fn verifies_v2_tool_contract_and_rejects_entitlement_tampering() {
        // Fixture produced by server_license-tool v2, including non-default rights.
        let content = "eyJ2ZXJzaW9uIjoyLCJwcm9kdWN0IjoiaHZpZGVvLXNlcnZlciIsImxpY2Vuc2VJZCI6IjM5YjlhZDkzLTQ5ZTMtNDdkOC05YWM3LWM0NTYwMzU3MzZlMiIsIm1hY2hpbmVDb2RlIjoiQUFBQS1CQkJCLUNDQ0MtRERERC1FRUVFLUZGRkYtMTExMS0yMjIyIiwiaXNzdWVkQXQiOjE3MDAwMDAwMDAsImV4cGlyZXNBdCI6MTgwMDAwMDAwMCwidmVudWUiOnsibmFtZSI6Iua1i+ivleWcuuaJgCIsImNvbnRhY3QiOiLlvKDkuIkiLCJwaG9uZSI6IjEzODAwMDAwMDAwIiwiYWRkcmVzcyI6Iua1i+ivleWcsOWdgCJ9LCJ0ZXJtaW5hbExpbWl0IjoyMCwibGljZW5zZSI6eyJtb2R1bGVzIjpbIlRWIiwiZnVzaW9uIl0sImVuYWJsZWRfbGF5ZXJzIjpbMiwxMCwzMV0sImlucHV0X2NoYW5uZWxfY291bnQiOjIsInVzYWdlX21vZGUiOiJyZW50In0sInNpZ25hdHVyZSI6IlJZNHVqS2NiaDd4dFhqblJWdmoyNDE0amdvSDExejBtQ1lBZXV4M0pObVFDeEswYm0zaHMrVmQ2MzRxMzIxeUJ5eUlXYzRsMWpydEc3Y2ZKeFBLVUFRPT0ifQ==";
        let machine = "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222";
        let payload = verify_license(&content, machine).unwrap();
        assert_eq!(payload.version, 2);
        let rights = payload.license.unwrap();
        assert_eq!(rights.enabled_layers, vec![2, 10, 31]);
        assert_eq!(rights.modules, vec!["TV", "fusion"]);
        assert_eq!(rights.input_channel_count, 2);
        assert_eq!(rights.usage_mode, "rent");
        let decoded = BASE64.decode(&content).unwrap();
        let original: Value = serde_json::from_slice(&decoded).unwrap();
        for (field, value) in [
            ("enabled_layers", serde_json::json!([1, 4, 60])),
            ("modules", serde_json::json!(["effects"])),
            ("input_channel_count", serde_json::json!(999)),
            ("usage_mode", serde_json::json!("buyout")),
        ] {
            let mut modified = original.clone();
            modified["license"][field] = value;
            let encoded = BASE64.encode(serde_json::to_vec(&modified).unwrap());
            assert!(verify_license(&encoded, machine)
                .unwrap_err()
                .contains("签名"));
        }
        let mut missing = original;
        missing.as_object_mut().unwrap().remove("license");
        assert!(verify_license(
            &BASE64.encode(serde_json::to_vec(&missing).unwrap()),
            machine
        )
        .is_err());
    }
    #[test]
    fn issuer_cloud_fixture_preserves_rights_and_rejects_tampering() {
        let content = include_str!("../tests/fixtures/cloud-update-expired.lic");
        let machine = "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222";
        let payload = verify_license(content, machine).unwrap();
        assert_eq!(payload.terminal_limit, 20);
        assert_eq!(
            payload.license.as_ref().unwrap().enabled_layers,
            vec![2, 10, 31]
        );
        assert!(validate_cloud_period(&payload, 1_710_000_000).is_ok());
        assert!(validate_cloud_period(&payload, 1_710_000_001).is_err());
        let mut old = payload.clone();
        old.cloud_update = None;
        assert!(validate_cloud_period(&old, 1_700_000_001).is_err());
        old.cloud_update = Some(CloudUpdateLicense {
            enabled: false,
            expires_at: 1_710_000_000,
        });
        assert!(validate_cloud_period(&old, 1_700_000_001).is_err());
        for field in ["expiresAt", "enabled"] {
            let mut value: Value =
                serde_json::from_slice(&BASE64.decode(content.trim()).unwrap()).unwrap();
            value["cloudUpdate"][field] = if field == "enabled" {
                Value::Bool(false)
            } else {
                Value::from(1_990_000_000)
            };
            let changed = BASE64.encode(serde_json::to_vec(&value).unwrap());
            assert!(verify_license(&changed, machine)
                .unwrap_err()
                .contains("签名"));
        }
    }
}
