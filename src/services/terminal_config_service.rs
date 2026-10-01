use crate::errors::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, io::Write, net::Ipv4Addr, path::Path};

pub static CONFIG_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
pub const MAX_CONFIG_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConfigMode {
    Template,
    Default,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigProfile {
    pub terminal_id: String,
    pub source_ip: Ipv4Addr,
    pub mode: ConfigMode,
    pub file_name: String,
    pub updated_at: i64,
}

#[derive(Default, Serialize, Deserialize)]
struct Store {
    profiles: Vec<ConfigProfile>,
}

fn read_store(dir: &Path) -> AppResult<Store> {
    match fs::read(dir.join("profiles.json")) {
        Ok(bytes) => {
            let mut store: Store = serde_json::from_slice(&bytes)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("配置档案损坏: {e}")))?;
            // Earlier two-option versions used "default" for IP-specific files.
            for profile in &mut store.profiles {
                if profile.mode == ConfigMode::Default {
                    profile.mode = ConfigMode::Custom;
                }
            }
            Ok(store)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
        Err(e) => Err(e.into()),
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let dir = path.parent().unwrap();
    fs::create_dir_all(dir)?;
    let mut file = tempfile::NamedTempFile::new_in(dir)?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|e| AppError::Io(e.error))?;
    Ok(())
}

pub fn validate_config(config: &Value) -> AppResult<()> {
    if !config.is_object()
        || !config.get("matrixConfig").is_some_and(Value::is_object)
        || !config.as_object().unwrap().iter().any(|(key, value)| {
            key.strip_prefix("layer")
                .is_some_and(|id| id.parse::<u32>().is_ok())
                && value.is_object()
        })
    {
        return Err(AppError::BadRequest(
            "config.json 必须包含矩阵配置和图层配置".into(),
        ));
    }
    Ok(())
}

// All reads and writes are called under CONFIG_LOCK. The index is the commit point;
// immutable snapshots keep readers on the old complete profile until it is replaced.
pub fn list(dir: &Path) -> AppResult<Vec<ConfigProfile>> {
    Ok(read_store(dir)?.profiles)
}

pub fn capture(
    dir: &Path,
    terminal_id: &str,
    ip: Ipv4Addr,
    mode: ConfigMode,
    config: Value,
) -> AppResult<ConfigProfile> {
    if mode == ConfigMode::Default {
        return Err(AppError::BadRequest(
            "默认属性跟随模板，不保存独立配置".into(),
        ));
    }
    validate_config(&config)?;
    let content = serde_json::to_vec_pretty(&config).map_err(|e| AppError::Internal(e.into()))?;
    if content.len() > MAX_CONFIG_BYTES {
        return Err(AppError::BadRequest("配置文件超过 4 MB".into()));
    }
    let mut store = read_store(dir)?;
    let old = store.profiles.clone();
    if mode == ConfigMode::Template
        && old
            .iter()
            .any(|p| p.mode == ConfigMode::Template && p.terminal_id != terminal_id)
    {
        return Err(AppError::Conflict(
            "已有模板设备，请先将原模板改为默认或自定义，再设置新的模板".into(),
        ));
    }
    let selecting_template = mode == ConfigMode::Template
        && !old
            .iter()
            .any(|p| p.terminal_id == terminal_id && p.mode == ConfigMode::Template);
    let prefix = if mode == ConfigMode::Template {
        "template"
    } else {
        "config"
    };
    let profile = ConfigProfile {
        terminal_id: terminal_id.into(),
        source_ip: ip,
        mode,
        file_name: format!("{prefix}-{ip}-{}.json", uuid::Uuid::new_v4()),
        updated_at: chrono::Utc::now().timestamp(),
    };
    store.profiles.retain(|item| {
        !selecting_template
            && item.terminal_id != terminal_id
            && !(mode == ConfigMode::Custom
                && item.mode == ConfigMode::Custom
                && item.source_ip == ip)
    });
    store.profiles.push(profile.clone());
    let index = serde_json::to_vec_pretty(&store).map_err(|e| AppError::Internal(e.into()))?;
    let snapshot = dir.join(&profile.file_name);
    atomic_write(&snapshot, &content)?;
    if let Err(error) = atomic_write(&dir.join("profiles.json"), &index) {
        let _ = fs::remove_file(snapshot);
        return Err(error);
    }
    cleanup_snapshots(dir, old, &store);
    Ok(profile)
}

fn cleanup_snapshots(dir: &Path, old: Vec<ConfigProfile>, store: &Store) {
    for item in old {
        if !store.profiles.iter().any(|p| p.file_name == item.file_name) {
            if let Err(error) = fs::remove_file(dir.join(&item.file_name)) {
                tracing::warn!("清理旧终端配置失败: {}: {}", item.file_name, error);
            }
        }
    }
}

pub fn follow_template(dir: &Path, terminal_id: &str) -> AppResult<()> {
    let mut store = read_store(dir)?;
    let old = store.profiles.clone();
    store.profiles.retain(|p| p.terminal_id != terminal_id);
    let index = serde_json::to_vec_pretty(&store).map_err(|e| AppError::Internal(e.into()))?;
    atomic_write(&dir.join("profiles.json"), &index)?;
    cleanup_snapshots(dir, old, &store);
    Ok(())
}

pub fn startup(dir: &Path, ip: Ipv4Addr) -> AppResult<Option<(ConfigProfile, Value)>> {
    let store = read_store(dir)?;
    let selected = store
        .profiles
        .iter()
        .find(|p| p.mode == ConfigMode::Custom && p.source_ip == ip)
        .or_else(|| {
            store
                .profiles
                .iter()
                .find(|p| p.mode == ConfigMode::Template)
        });
    let Some(profile) = selected else {
        return Ok(None);
    };
    let config: Value = serde_json::from_slice(&fs::read(dir.join(&profile.file_name))?)
        .map_err(|e| AppError::Internal(e.into()))?;
    validate_config(&config)?;
    Ok(Some((profile.clone(), config)))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config(width: u32) -> Value {
        serde_json::json!({"matrixConfig":{"canvasInWidth":width},"layer1":{"visible":true}})
    }
    #[test]
    fn template_custom_default_precedence_and_replacement() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path();
        let a = "192.168.2.101".parse().unwrap();
        let b = "192.168.2.102".parse().unwrap();
        assert!(startup(dir, a).unwrap().is_none());
        capture(dir, "a", a, ConfigMode::Template, config(100)).unwrap();
        assert_eq!(startup(dir, b).unwrap().unwrap().1, config(100));
        capture(dir, "b", b, ConfigMode::Custom, config(200)).unwrap();
        assert_eq!(startup(dir, b).unwrap().unwrap().1, config(200));
        capture(dir, "a", a, ConfigMode::Template, config(300)).unwrap();
        assert_eq!(startup(dir, a).unwrap().unwrap().1, config(300));
        assert_eq!(startup(dir, b).unwrap().unwrap().1, config(200));
        assert!(capture(dir, "a", a, ConfigMode::Template, serde_json::json!({})).is_err());
        assert_eq!(startup(dir, a).unwrap().unwrap().1, config(300));
        let saved_index = fs::read(dir.join("profiles.json")).unwrap();
        assert!(matches!(
            capture(dir, "b", b, ConfigMode::Template, config(400)),
            Err(AppError::Conflict(_))
        ));
        assert_eq!(fs::read(dir.join("profiles.json")).unwrap(), saved_index);
        assert_eq!(
            fs::read_dir(dir).unwrap().count(),
            3,
            "rejected template creates no snapshot"
        );
        assert_eq!(startup(dir, b).unwrap().unwrap().1, config(200));
        follow_template(dir, "a").unwrap();
        capture(dir, "b", b, ConfigMode::Template, config(400)).unwrap();
        assert_eq!(list(dir).unwrap().len(), 1);
        assert_eq!(startup(dir, a).unwrap().unwrap().1, config(400));
        capture(dir, "b", b, ConfigMode::Custom, config(500)).unwrap();
        assert!(startup(dir, a).unwrap().is_none());
        assert_eq!(startup(dir, b).unwrap().unwrap().1, config(500));
        capture(dir, "a", a, ConfigMode::Template, config(600)).unwrap();
        assert_eq!(
            list(dir).unwrap().len(),
            1,
            "choosing a new template resets other terminals to default"
        );
        assert_eq!(startup(dir, b).unwrap().unwrap().1, config(600));
        capture(dir, "b", b, ConfigMode::Custom, config(700)).unwrap();
        follow_template(dir, "b").unwrap();
        assert_eq!(startup(dir, b).unwrap().unwrap().1, config(600));
        assert_eq!(
            fs::read_dir(dir).unwrap().count(),
            2,
            "only index and active snapshot remain"
        );
        follow_template(dir, "a").unwrap();
        assert!(startup(dir, b).unwrap().is_none());
        assert_eq!(fs::read_dir(dir).unwrap().count(), 1);
    }
}
