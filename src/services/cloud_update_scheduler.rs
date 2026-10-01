//! Automatic downloads run with the backend, independently of any admin page.
use std::time::Duration;
use tokio::time::Instant;
use crate::{config::{CloudConfig, CloudUpdateMode}, errors::{AppError, AppResult}, license::LicenseManager, AppState};
use super::vod_update_service::VodUpdateService;

const CHECK_INTERVAL: Duration = Duration::from_secs(300);

pub(crate) fn authorize(mut config: CloudConfig, license: &LicenseManager) -> AppResult<CloudConfig> {
    config.license_proof = license.cloud_update_proof().map_err(AppError::Forbidden)?;
    let payload = license.ensure_valid().map_err(AppError::Forbidden)?;
    let cloud_expiry = payload.cloud_update.as_ref().filter(|g| g.enabled).ok_or_else(|| AppError::Forbidden("云端授权已变更，请重新检查".into()))?.expires_at;
    config.cloud_update_expires_at = Some(if crate::license::is_permanent_license(&payload) { cloud_expiry } else { cloud_expiry.min(payload.expires_at) });
    Ok(config)
}

pub(crate) fn automatic_config(path: &std::path::Path, license: &LicenseManager) -> AppResult<Option<CloudConfig>> {
    let config = CloudConfig::load(path).map_err(AppError::Internal)?;
    if config.update_mode != CloudUpdateMode::Auto { return Ok(None); }
    authorize(config, license).map(Some)
}

#[derive(Default)]
struct Schedule { last_attempt: Option<Instant> }
impl Schedule {
    fn ready(&self, mode: CloudUpdateMode, authorized: bool, running: bool, now: Instant) -> bool {
        mode == CloudUpdateMode::Auto && authorized && !running
            && self.last_attempt.is_none_or(|last| now.duration_since(last) >= CHECK_INTERVAL)
    }
}

// Polling for settings/authorization every 30 seconds also picks up a newly imported license.
// This future is owned by the HTTP service lifetime: stopping/restarting it cancels the scheduler.
pub async fn run(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut schedule = Schedule::default();
    loop {
        interval.tick().await;
        let config = match CloudConfig::load(&state.config_path) {
            Ok(config) => config,
            Err(e) => { tracing::warn!("自动更新读取配置失败：{e}"); continue; }
        };
        let interrupted=sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM sync_tasks WHERE targetType='vodPackage' AND status=3 AND errorMessage LIKE '服务器重启导致下载中断%'")
            .fetch_one(&state.db).await.unwrap_or(0)>0;
        let scheduling_mode=if interrupted {CloudUpdateMode::Auto}else{config.update_mode};
        if !schedule.ready(scheduling_mode, state.license.cloud_update_status().valid, VodUpdateService::is_updating(), Instant::now()) { continue; }
        // Failed requests and failed packages share the same retry cooldown.
        schedule.last_attempt = Some(Instant::now());
        let result=if interrupted && config.update_mode==CloudUpdateMode::Manual {
            match authorize(config,&state.license) {
                Ok(config)=>VodUpdateService::resume_interrupted(state.db.clone(),state.song_db.clone(),config).await,
                Err(e)=>Err(e),
            }
        }else{VodUpdateService::start_automatic(state.db.clone(), state.song_db.clone(), &state.config_path, &state.license).await};
        match result {
            Ok(tasks) if !tasks.is_empty() => tracing::info!("自动云端更新已启动 {} 个更新包", tasks.len()),
            Ok(_) => {},
            Err(e) => tracing::warn!("自动云端更新失败，5 分钟后重试：{e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_mode_and_missing_license_gate_automatic_downloads() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let license = LicenseManager::new(dir.path().join("missing.lic"));
        let legacy = "[cloud]\napi_base_url='http://localhost:8080'\napi_key=''\ndownload_dir='downloads'\n";
        std::fs::write(&path, legacy).unwrap();
        assert!(automatic_config(&path, &license).unwrap().is_none());
        std::fs::write(&path, format!("{legacy}update_mode='auto'\n")).unwrap();
        assert!(matches!(automatic_config(&path, &license), Err(AppError::Forbidden(_))));
        std::fs::write(&path, format!("{legacy}update_mode='manual'\n")).unwrap();
        assert!(automatic_config(&path, &license).unwrap().is_none());
    }
    #[test]
    fn startup_authorization_and_retry_cooldown() {
        let now = Instant::now();
        let mut schedule = Schedule::default();
        assert!(!schedule.ready(CloudUpdateMode::Manual, true, false, now));
        assert!(!schedule.ready(CloudUpdateMode::Auto, false, false, now));
        assert!(!schedule.ready(CloudUpdateMode::Auto, true, true, now));
        assert!(schedule.ready(CloudUpdateMode::Auto, true, false, now));
        schedule.last_attempt = Some(now);
        assert!(!schedule.ready(CloudUpdateMode::Auto, true, false, now + Duration::from_secs(299)));
        assert!(schedule.ready(CloudUpdateMode::Auto, true, false, now + CHECK_INTERVAL));
        assert!(!schedule.ready(CloudUpdateMode::Manual, true, false, now + CHECK_INTERVAL));
        assert!(!schedule.ready(CloudUpdateMode::Auto, false, false, now + CHECK_INTERVAL));
    }
}
