use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Partition {
    pub name: String,
    pub offset: u64,
    pub size: u64,
    pub expanded_size: u64,
    pub sha256: String,
    pub expanded_sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub protocol: i32,
    pub product: String,
    pub hardware: String,
    pub version_code: i32,
    pub target_fingerprint: String,
    pub image_size: u64,
    pub image_sha256: String,
    pub partitions: Vec<Partition>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckRequest {
    pub protocol: i32,
    pub product: String,
    pub hardware: String,
    pub current_version_code: i32,
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn directory(config: &Path) -> PathBuf {
    config.parent().unwrap_or(Path::new(".")).join("rom")
}

// Publication is explicit: the signed bundle is invisible until PUBLISHED exists.
pub fn inspect(root: &Path, id: &str) -> Result<Manifest> {
    let marker = root.join(id).join("PUBLISHED");
    ensure!(valid_id(id), "invalid release ID");
    let meta = std::fs::symlink_metadata(&marker)?;
    ensure!(
        meta.is_file() && meta.len() <= 128,
        "release is not published"
    );
    inspect_candidate(root, id)
}

pub fn inspect_candidate(root: &Path, id: &str) -> Result<Manifest> {
    ensure!(valid_id(id), "invalid release ID");
    let dir = root.join(id);
    ensure!(
        dir.canonicalize()?.parent() == Some(root.canonicalize()?.as_path()),
        "release outside ROM directory"
    );
    for (name, limit) in [
        ("manifest.json", 65536),
        ("manifest.sig", 1024),
        ("update.img", 4 * 1024 * 1024 * 1024u64),
    ] {
        let path = dir.join(name);
        let meta = std::fs::symlink_metadata(&path)?;
        ensure!(
            meta.is_file()
                && meta.len() <= limit
                && path.canonicalize()?.parent() == Some(dir.canonicalize()?.as_path()),
            "invalid release resource"
        );
    }
    let bytes = std::fs::read(dir.join("manifest.json"))?;
    ensure!(
        format!("{:x}", Sha256::digest(&bytes)) == id,
        "manifest hash mismatch"
    );
    let signature = std::fs::read(dir.join("manifest.sig"))?;
    ring::signature::UnparsedPublicKey::new(
        &ring::signature::RSA_PKCS1_2048_8192_SHA256,
        include_bytes!("../../resources/rom-public-key.der"),
    )
    .verify(&bytes, &signature)
    .map_err(|_| anyhow::anyhow!("ROM signature rejected"))?;
    let m: Manifest = serde_json::from_slice(&bytes)?;
    ensure!(
        m.protocol == 1 && m.product == "H6_POR" && m.hardware == "hw81" && m.version_code > 0,
        "unsupported ROM"
    );
    ensure!(
        m.target_fingerprint
            .starts_with("CHUANGWEI/H6_POR/H6_POR:11/")
            && m.target_fingerprint.len() < 256,
        "invalid fingerprint"
    );
    ensure!(
        valid_id(&m.image_sha256)
            && m.image_size > 1024
            && m.image_size == std::fs::metadata(dir.join("update.img"))?.len(),
        "invalid image size/hash"
    );
    let expected = [
        "trust", "uboot", "dtbo", "vbmeta", "super", "userdata", "boot", "recovery",
    ];
    ensure!(
        m.partitions.len() == expected.len(),
        "invalid partition count"
    );
    for name in expected {
        let entries: Vec<_> = m.partitions.iter().filter(|p| p.name == name).collect();
        ensure!(entries.len() == 1, "missing/duplicate partition");
        let p = entries[0];
        ensure!(
            p.size > 0
                && p.expanded_size > 0
                && p.offset <= m.image_size
                && p.size <= m.image_size - p.offset
                && valid_id(&p.sha256)
                && valid_id(&p.expanded_sha256),
            "invalid partition bounds/hash"
        );
    }
    Ok(m)
}

pub fn publication(root: &Path, id: &str, published: bool) -> Result<()> {
    use std::io::{Read, Write};
    ensure!(valid_id(id), "invalid release ID");
    let marker = root.join(id).join("PUBLISHED");
    if !published {
        // Withdrawal must also work when a bundle has become invalid.
        ensure!(
            root.join(id).canonicalize()?.parent() == Some(root.canonicalize()?.as_path()),
            "release outside ROM directory"
        );
        if marker.exists() {
            std::fs::remove_file(marker)?;
        }
        return Ok(());
    }
    let m = inspect_candidate(root, id)?;
    for entry in std::fs::read_dir(root)? {
        let other = entry?.file_name().to_string_lossy().into_owned();
        if other != id && valid_id(&other) {
            if let Ok(existing) = inspect(root, &other) {
                ensure!(
                    existing.version_code != m.version_code,
                    "another bundle with this version is already published"
                );
            }
        }
    }
    let mut file = std::fs::File::open(root.join(id).join("update.img"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 1024 * 64];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    ensure!(
        format!("{:x}", hash.finalize()) == m.image_sha256,
        "ROM image SHA256 mismatch"
    );
    // The marker is the only publication switch. A failed validation never creates it.
    let mut ready = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker)?;
    ready.write_all(b"protocol=1\n")?;
    ready.sync_all()?;
    Ok(())
}

pub fn select(root: &Path, request: &CheckRequest) -> Result<Option<(String, Manifest)>> {
    if !root.exists() {
        return Ok(None);
    }
    let mut candidates = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if !entry.file_type()?.is_dir() || !valid_id(&id) {
            continue;
        }
        match inspect(root, &id) {
            Ok(m)
                if m.protocol == request.protocol
                    && m.product == request.product
                    && m.hardware == request.hardware
                    && m.version_code > request.current_version_code =>
            {
                candidates.push((id, m))
            }
            Ok(_) => (),
            Err(error) => tracing::warn!("Ignoring ROM {id}: {error}"),
        }
    }
    candidates.sort_by(|a, b| a.1.version_code.cmp(&b.1.version_code).then(a.0.cmp(&b.0)));
    // Ambiguous versions are operator errors; never choose a different ROM arbitrarily.
    if candidates.len() >= 2 {
        let n = candidates.len();
        ensure!(
            candidates[n - 1].1.version_code != candidates[n - 2].1.version_code,
            "multiple ROMs published with the same version"
        );
    }
    Ok(candidates.pop())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pinned_platform_signature_and_tampering() {
        // This non-JSON fixture cannot authorize a firmware installation.
        let key = ring::signature::UnparsedPublicKey::new(
            &ring::signature::RSA_PKCS1_2048_8192_SHA256,
            include_bytes!("../../resources/rom-public-key.der"),
        );
        let signature = include_bytes!("../../resources/rom-signature-selftest.sig");
        let data = include_bytes!("../../resources/rom-signature-selftest.txt");
        assert!(key.verify(data, signature).is_ok());
        let mut tampered = data.to_vec(); tampered[0] ^= 1;
        assert!(key.verify(&tampered, signature).is_err());
    }
    #[test]
    #[ignore = "Set HSVJ_TEST_ROM_BUNDLE to the freshly signed, unpublished bundle"]
    fn real_bundle_publication_selection_withdrawal_and_corruption() {
        let source = PathBuf::from(std::env::var_os("HSVJ_TEST_ROM_BUNDLE").expect("bundle path"));
        let id = source.file_name().unwrap().to_str().unwrap();
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join(id);
        std::fs::create_dir(&dir).unwrap();
        for name in ["manifest.json", "manifest.sig", "update.img"] {
            std::fs::copy(source.join(name), dir.join(name)).unwrap();
        }
        let m = inspect_candidate(root.path(), id).unwrap();
        let mut request = CheckRequest {
            protocol: 1,
            product: m.product,
            hardware: m.hardware,
            current_version_code: m.version_code - 1,
        };
        assert!(select(root.path(), &request).unwrap().is_none());
        publication(root.path(), id, true).unwrap();
        assert_eq!(select(root.path(), &request).unwrap().unwrap().0, id);
        for version in [m.version_code, m.version_code + 1] {
            request.current_version_code = version;
            assert!(select(root.path(), &request).unwrap().is_none());
        }
        publication(root.path(), id, false).unwrap();
        assert!(inspect(root.path(), id).is_err());
        use std::io::Write;
        std::fs::OpenOptions::new()
            .write(true)
            .open(dir.join("update.img"))
            .unwrap()
            .write_all(b"BAD!")
            .unwrap();
        assert!(publication(root.path(), id, true)
            .unwrap_err()
            .to_string()
            .contains("SHA256"));
        assert!(!dir.join("PUBLISHED").exists());
    }
    #[test]
    fn strict_contract_and_unpublished_or_forged_release() {
        let root = tempfile::tempdir().unwrap();
        let request: CheckRequest = serde_json::from_value(serde_json::json!({"protocol":1,"product":"H6_POR","hardware":"hw81","current_version_code":32})).unwrap();
        assert!(select(root.path(), &request).unwrap().is_none());
        for id in ["../escape", "a", &"A".repeat(64)] {
            assert!(!valid_id(id));
        }
        let bytes = b"{}";
        let id = format!("{:x}", Sha256::digest(bytes));
        let dir = root.path().join(&id);
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("manifest.json"), bytes).unwrap();
        assert!(inspect(root.path(), &id).is_err());
        std::fs::write(dir.join("PUBLISHED"), b"1").unwrap();
        std::fs::write(dir.join("manifest.sig"), [0u8; 256]).unwrap();
        std::fs::write(dir.join("update.img"), [0u8; 2048]).unwrap();
        assert!(inspect(root.path(), &id)
            .unwrap_err()
            .to_string()
            .contains("signature"));
        assert!(select(root.path(), &request).unwrap().is_none());
        assert!(serde_json::from_value::<CheckRequest>(serde_json::json!({"protocol":1,"product":"H6_POR","hardware":"hw81","current_version_code":32,"versionCode":33})).is_err());
    }
}
