use super::{apk_manifest, app_update_service::MAX_APK_SIZE};
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::SystemTime,
};

#[derive(Clone, Debug)]
pub struct Release {
    pub path: PathBuf,
    pub manifest: apk_manifest::ApkManifest,
    pub sha256: String,
    pub size: u64,
}
type Cache = HashMap<PathBuf, (SystemTime, u64, Option<Release>)>;
static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckRequest {
    pub current_version_code: i32,
    pub package_name: String,
    pub hardware: String,
}

#[derive(Serialize, Debug)]
pub struct CheckResponse {
    pub has_update: bool,
    pub version_code: i32,
    pub version_name: String,
    pub package_name: String,
    pub hardware: String,
    pub download_url: String,
    pub sha256: String,
    pub file_size: u64,
    pub force_update: bool,
    pub release_notes: String,
}

pub fn directory(config_path: &Path) -> PathBuf {
    std::env::var_os("HVIDEO_PLAYER_APP_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| config_path.parent().unwrap_or(Path::new(".")).join("app"))
}

fn inspect(path: &Path, size: u64) -> Result<Release> {
    ensure!(
        size > 0 && size <= MAX_APK_SIZE as u64,
        "APK size out of bounds"
    );
    let manifest = apk_manifest::read(path)?;
    let mut file = std::fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(Release {
        path: path.to_owned(),
        manifest,
        sha256: format!("{:x}", hash.finalize()),
        size,
    })
}

pub fn scan(dir: &Path) -> Result<Vec<Release>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let dir = dir.canonicalize()?;
    let mut cache = CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| anyhow::anyhow!("release cache poisoned"))?;
    let mut seen = Vec::new();
    let mut releases = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if !entry.file_type()?.is_file()
            || !path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("apk"))
        {
            continue;
        }
        // Do not expose links/junctions outside the publication directory.
        if path.canonicalize()?.parent() != Some(dir.as_path()) {
            continue;
        }
        let meta = entry.metadata()?;
        let modified = meta.modified()?;
        let size = meta.len();
        seen.push(path.clone());
        if !cache
            .get(&path)
            .is_some_and(|(m, s, _)| *m == modified && *s == size)
        {
            let release = match inspect(&path, size) {
                Ok(release) => Some(release),
                Err(error) => {
                    tracing::warn!("忽略播放器升级包 {}: {error}", path.display());
                    None
                }
            };
            let after = entry.metadata()?;
            if after.len() != size || after.modified()? != modified {
                continue;
            }
            cache.insert(path.clone(), (modified, size, release));
        }
        if let Some((_, _, Some(release))) = cache.get(&path) {
            releases.push(release.clone());
        }
    }
    cache.retain(|path, _| path.parent() != Some(dir.as_path()) || seen.contains(path));
    releases.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(releases)
}

pub fn select(releases: &[Release], request: &CheckRequest) -> CheckResponse {
    let latest = releases
        .iter()
        .filter(|r| {
            r.manifest.package == request.package_name && r.manifest.hardware == request.hardware
        })
        .max_by_key(|r| r.manifest.version_code);
    let mut response = CheckResponse {
        has_update: false,
        version_code: 0,
        version_name: String::new(),
        package_name: request.package_name.clone(),
        hardware: request.hardware.clone(),
        download_url: String::new(),
        sha256: String::new(),
        file_size: 0,
        force_update: false,
        release_notes: String::new(),
    };
    if let Some(release) = latest {
        response.version_code = release.manifest.version_code;
        response.version_name = release.manifest.version_name.clone();
        if response.version_code > request.current_version_code {
            response.has_update = true;
            response.force_update = true;
            response.download_url = format!("/api/v1/player-updates/files/{}", release.sha256);
            response.sha256 = release.sha256.clone();
            response.file_size = release.size;
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selects_newer_matching_hardware_never_equal_or_downgrade() {
        let make = |hardware: &str, version_code| Release {
            path: PathBuf::new(),
            manifest: apk_manifest::ApkManifest {
                package: "com.hsvj.engine".into(),
                hardware: hardware.into(),
                version_code,
                version_name: "1.0".into(),
            },
            sha256: "a".repeat(64),
            size: 123,
        };
        let releases = vec![make("hw81", 10), make("hw82", 30), make("hw81", 20)];
        let mut request = CheckRequest {
            package_name: "com.hsvj.engine".into(),
            hardware: "hw81".into(),
            current_version_code: 19,
        };
        assert_eq!(select(&releases, &request).version_code, 20);
        assert!(select(&releases, &request).has_update);
        for current in [20, 21] {
            request.current_version_code = current;
            assert!(!select(&releases, &request).has_update);
        }
        request.package_name = "wrong.package".into();
        assert!(!select(&releases, &request).has_update);
        assert!(!select(&[], &request).has_update);
    }
    #[test]
    fn invalid_apks_and_missing_directory_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("broken.apk"), b"not an apk").unwrap();
        assert!(scan(dir.path()).unwrap().is_empty());
        assert!(scan(&dir.path().join("missing")).unwrap().is_empty());
    }
}
