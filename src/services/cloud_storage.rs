//! Space protection for cloud package staging and automatic volume selection.
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

pub const RESERVE_BYTES: u64 = 10 * 1024 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
#[error("更新目录空间不足，必须预留 10GB 可用空间")]
pub struct InsufficientSpace;

fn check_capacity(free: u64, pending: u64) -> Result<()> {
    if free.saturating_sub(RESERVE_BYTES) < pending || free < RESERVE_BYTES {
        return Err(InsufficientSpace.into());
    }
    Ok(())
}

fn existing_directory(path: &Path) -> Result<PathBuf> {
    let absolute = std::path::absolute(path)?;
    let ancestor = absolute.ancestors().find(|p| p.is_dir()).context("无法找到更新磁盘")?;
    Ok(std::fs::canonicalize(ancestor)?)
}

#[cfg(windows)]
pub fn available_bytes(path: &Path) -> Result<u64> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(path: *const u16, available: *mut u64, total: *mut u64, free: *mut u64) -> i32;
    }
    let path = existing_directory(path)?;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0;
    // The API returns free bytes available to this user, respecting filesystem quotas.
    let result = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) };
    anyhow::ensure!(result != 0, "无法读取磁盘空间：{}", std::io::Error::last_os_error());
    Ok(available)
}

#[cfg(not(windows))]
pub fn available_bytes(path: &Path) -> Result<u64> {
    let path = existing_directory(path)?;
    sysinfo::Disks::new_with_refreshed_list().list().iter()
        .filter(|disk| path.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().components().count())
        .map(|disk| disk.available_space()).context("无法读取磁盘空间")
}

pub fn ensure_space(path: &Path, pending: u64) -> Result<()> {
    check_capacity(available_bytes(path)?, pending)
}

fn writable(path: &Path, pending: u64) -> Result<()> {
    ensure_space(path, pending)?;
    std::fs::create_dir_all(path)?;
    // Resolve mount points/junctions again after creating the actual directory.
    ensure_space(path, pending)?;
    let _probe = tempfile::Builder::new().prefix(".hvideo-space-check-").tempfile_in(path)?;
    Ok(())
}

fn order_candidates(candidates: &mut Vec<(u64, PathBuf)>, pending: u64) {
    candidates.retain(|(free,_)| check_capacity(*free,pending).is_ok());
    candidates.sort_by(|a,b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
}

pub fn select_directory(preferred: &Path, pending: u64, force_largest: bool) -> Result<PathBuf> {
    let preferred = std::path::absolute(preferred)?;
    if !force_largest && writable(&preferred, pending).is_ok() { return Ok(preferred); }
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut candidates: Vec<_> = disks.list().iter().filter(|disk| !disk.is_read_only())
        .filter_map(|disk| { let path=disk.mount_point().join("HVideoCloudUpdates"); available_bytes(&path).ok().map(|free|(free,path)) })
        .collect();
    order_candidates(&mut candidates, pending);
    for (_, path) in candidates {
        if writable(&path, pending).is_ok() { return Ok(path); }
    }
    anyhow::bail!("所有可写磁盘空间均不足：本包需要 {:.2}GB，并必须额外预留 10GB", pending as f64 / 1073741824.0)
}

/// Read-only telemetry. Never creates folders, writes probes or scans media files.
pub fn storage_report(update_directory:&str)->serde_json::Value {
    let disks=sysinfo::Disks::new_with_refreshed_list();
    let mut entries:Vec<_>=disks.list().iter().filter(|d|d.total_space()>0).map(|d|{
        serde_json::json!({"mountPoint":d.mount_point().to_string_lossy().replace('\\',"/"),
            "totalBytes":d.total_space(),"availableBytes":d.available_space().min(d.total_space())})
    }).collect();
    entries.sort_by(|a,b|a["mountPoint"].as_str().cmp(&b["mountPoint"].as_str()));
    entries.dedup_by(|a,b|a["mountPoint"]==b["mountPoint"]);
    entries.truncate(64);
    let directory=if update_directory.trim().is_empty(){String::new()}else{
        std::path::absolute(update_directory).unwrap_or_else(|_|PathBuf::from(update_directory)).to_string_lossy().replace('\\',"/")
    };
    let available=if directory.is_empty(){None}else{available_bytes(Path::new(&directory)).ok()};
    serde_json::json!({"disks":entries,"updateDirectory":directory,"updateAvailableBytes":available})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn telemetry_reads_capacity_without_creating_update_directory() {
        let temp=tempfile::tempdir().unwrap();let directory=temp.path().join("uncreated-updates");
        let report=storage_report(directory.to_str().unwrap());
        assert!(!directory.exists());
        assert!(report["updateAvailableBytes"].as_u64().unwrap()>0);
        let disks=report["disks"].as_array().unwrap();assert!(!disks.is_empty());
        for disk in disks {assert!(disk["availableBytes"].as_u64().unwrap()<=disk["totalBytes"].as_u64().unwrap());}
        let unset=storage_report("");assert_eq!(unset["updateDirectory"],"");assert!(unset["updateAvailableBytes"].is_null());
    }
    #[test]
    fn reserve_boundary_and_overflow_are_protected() {
        assert!(check_capacity(RESERVE_BYTES + 20,20).is_ok());
        assert!(check_capacity(RESERVE_BYTES + 19,20).is_err());
        assert!(check_capacity(RESERVE_BYTES - 1,0).is_err());
        assert!(check_capacity(u64::MAX,u64::MAX).is_err());
        assert!(check_capacity(RESERVE_BYTES,0).is_ok());
    }
    #[test]
    fn fallback_uses_largest_available_eligible_disk() {
        let mut candidates=vec![(RESERVE_BYTES+9,"small".into()),(RESERVE_BYTES+20,"medium".into()),(RESERVE_BYTES+100,"large".into())];
        order_candidates(&mut candidates,10);
        assert_eq!(candidates.iter().map(|(_,p)|p.to_str().unwrap()).collect::<Vec<_>>(),vec!["large","medium"]);
        order_candidates(&mut candidates,101);
        assert!(candidates.is_empty());
    }
    #[test]
    fn free_space_can_be_read_for_new_directory() {
        let temp=tempfile::tempdir().unwrap();
        assert!(available_bytes(&temp.path().join("not-created")).unwrap()>0);
    }
}
