//! Published cloud packages feed song.db, the same catalog used by playback.
use std::{collections::HashSet, path::{Path, PathBuf}, sync::Arc, time::Duration};
use anyhow::{bail, ensure, Context};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, sync::{Mutex, OwnedMutexGuard}};
use crate::{config::CloudConfig, errors::{AppError, AppResult}, models::{scan_task::MatchRecord, sync_task::SyncTask}};
use super::cloud_storage;
use super::{cloud_service::CloudService, song_data_import_service::SongDataImportService};

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
struct TransientDownload(&'static str);

static UPDATE_LOCK: std::sync::OnceLock<Arc<Mutex<()>>> = std::sync::OnceLock::new();
fn update_lock() -> Arc<Mutex<()>> { UPDATE_LOCK.get_or_init(|| Arc::new(Mutex::new(()))).clone() }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Package {
    pub id: String,
    pub package_name: String,
    pub package_type: String,
    pub version_code: i64,
    pub song_count: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PackageFile {
    pub id: String,
    pub file_role: String,
    pub file_name: String,
    pub download_url: String,
    pub file_size: i64,
    pub sha256: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Manifest { pub package: Package, pub files: Vec<PackageFile> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageView {
    pub id: String, pub name: String, pub version_code: i64, pub song_count: i64,
    pub video_count: usize, pub total_size: i64, pub installed: bool,
}
#[derive(Deserialize)]
struct Catalog { code: i32, data: Vec<Manifest> }

fn safe_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 220 && !name.starts_with('.') && !name.ends_with(['.', ' '])
        && !name.chars().any(|c| c.is_control() || "\\/:*?\"<>|;".contains(c))
        && !matches!(name.split('.').next().unwrap_or("").to_ascii_uppercase().as_str(),
            "CON"|"PRN"|"AUX"|"NUL"|"COM1"|"COM2"|"COM3"|"COM4"|"COM5"|"COM6"|"COM7"|"COM8"|"COM9"|"LPT1"|"LPT2"|"LPT3"|"LPT4"|"LPT5"|"LPT6"|"LPT7"|"LPT8"|"LPT9")
}

/// Never delete the destination first: a denied replacement must preserve both files.
/// Run synchronously inside spawn_blocking so cancellation cannot interrupt restoration.
fn replace_video_file(staged: &Path, destination: &Path) -> anyhow::Result<()> {
    let error = match std::fs::rename(staged, destination) {
        Ok(()) => return Ok(()),
        Err(error) => error,
    };
    #[cfg(windows)]
    if error.raw_os_error() == Some(5) {
        use std::os::windows::fs::MetadataExt;
        let metadata = std::fs::symlink_metadata(destination)
            .with_context(|| format!("替换被拒绝且无法读取目标属性：{}；原错误：{error}", destination.display()))?;
        let attributes = metadata.file_attributes();
        // FILE_ATTRIBUTE_REPARSE_POINT: do not alter a symlink/junction's target.
        ensure!(metadata.is_file() && attributes & 0x400 == 0,
            "目标不是普通视频文件：{}（Windows 属性 0x{attributes:X}）", destination.display());
        if metadata.permissions().readonly() {
            let original = metadata.permissions();
            let mut writable = original.clone();
            writable.set_readonly(false);
            std::fs::set_permissions(destination, writable)
                .with_context(|| format!("无法解除视频只读属性：{}，请检查该文件的修改权限", destination.display()))?;
            if let Err(retry_error) = std::fs::rename(staged, destination) {
                std::fs::set_permissions(destination, original)
                    .with_context(|| format!("替换失败：{retry_error}；恢复旧视频只读属性也失败：{}", destination.display()))?;
                return Err(retry_error).context("已恢复旧视频只读属性；请检查文件占用或删除/修改权限");
            }
            tracing::info!("已解除旧视频只读属性并完成替换：{}", destination.display());
            return Ok(());
        }
        return Err(error).with_context(|| format!("目标视频非只读（Windows 属性 0x{attributes:X}）；请检查目标文件及目录的删除/修改权限或文件占用"));
    }
    Err(error.into())
}
impl Manifest {
    /// Stable across retries/restarts and appended package files. Partial files are hash-keyed.
    fn staging(&self, config: &CloudConfig) -> PathBuf {
        let key = format!("{}\n{}", config.api_base_url.trim_end_matches('/'), self.package.id);
        self.folder(config).join(format!(".hvideo-update-{:x}", Sha256::digest(key.as_bytes())))
    }
    fn validate(&self, config: &CloudConfig) -> anyhow::Result<()> {
        uuid::Uuid::parse_str(&self.package.id).context("更新包 ID 无效")?;
        ensure!(!self.files.is_empty(), "更新包没有文件");
        let base = CloudService::validate_config(config)?;
        let mut names = HashSet::new();
        for f in &self.files {
            ensure!(safe_name(&f.file_name) && names.insert(f.file_name.to_lowercase()), "更新包存在非法或重复文件名");
            ensure!(matches!(f.file_role.as_str(), "source"|"video"), "未知文件类型");
            if f.file_role == "source" { ensure!(f.file_name.to_lowercase().ends_with(".xlsx"), "曲库文件需使用标准 XLSX 格式：{}", f.file_name); }
            ensure!(f.file_size > 0, "空文件：{}", f.file_name);
            let hash = f.sha256.as_deref().unwrap_or("");
            ensure!(hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit()), "文件缺少 SHA256：{}", f.file_name);
            let url = reqwest::Url::parse(&f.download_url)?;
            ensure!(url.origin() == base.origin() && url.username().is_empty() && url.password().is_none(), "下载地址必须与云端服务器同源");
        }
        self.files.iter().try_fold(0i64, |n, f| n.checked_add(f.file_size).context("更新包过大"))?;
        Ok(())
    }
    fn revision(&self) -> String {
        let mut files = self.files.clone();
        files.sort_by(|a,b| a.file_name.cmp(&b.file_name));
        format!("{:x}", Sha256::digest(serde_json::to_vec(&(self.package.version_code, files)).expect("manifest serialization")))
    }
    fn folder(&self, config: &CloudConfig) -> PathBuf {
        std::path::absolute(Path::new(&config.download_dir)).expect("validated directory")
    }
    fn key(&self, config: &CloudConfig) -> String {
        format!("{}#flat-v2-{}", config.api_base_url.trim_end_matches('/'), self.revision())
    }
}

pub struct VodUpdateService;
impl VodUpdateService {
    pub(crate) fn lock_settings() -> AppResult<OwnedMutexGuard<()>> {
        update_lock().try_lock_owned().map_err(|_| AppError::Conflict("更新进行中，请完成后再修改更新设置".into()))
    }
    pub fn is_updating() -> bool { update_lock().try_lock_owned().is_err() }
    fn ensure_authorized(config: &CloudConfig) -> anyhow::Result<()> {
        #[cfg(test)]
        if config.license_proof.is_empty() && config.cloud_update_expires_at.is_none() && config.config_path.is_none() { return Ok(()); }
        ensure!(!config.license_proof.is_empty(), "缺少云端更新授权，请重新签发服务器授权");
        ensure!(config.cloud_update_expires_at.is_some_and(|t| t >= chrono::Utc::now().timestamp()), "云端更新授权已到期，请续期");
        Ok(())
    }
    pub async fn catalog(config: &CloudConfig) -> anyhow::Result<Vec<Manifest>> {
        Self::ensure_authorized(config)?;
        let base = CloudService::validate_config(config)?;
        let url = base.join("/api/vod-updates/catalog")?;
        let mut request = CloudService::http_client()?.get(url).timeout(Duration::from_secs(12));
        if !config.license_proof.is_empty() { request = request.header("X-HVideo-Server-License", &config.license_proof); }
        let response = request.send().await?.error_for_status()?;
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            ensure!(bytes.len() + chunk.len() <= 16 * 1024 * 1024, "更新目录超过大小限制");
            bytes.extend_from_slice(&chunk);
        }
        let mut catalog: Catalog = serde_json::from_slice(&bytes).context("云端未返回有效的更新包目录")?;
        ensure!(catalog.code == 0, "云端更新包目录请求失败");
        let mut ids = HashSet::new();
        for manifest in &catalog.data {
            manifest.validate(config)?;
            ensure!(ids.insert(&manifest.package.id), "更新目录有重复包");
        }
        catalog.data.sort_by(|a,b| (a.package.version_code, &a.package.id).cmp(&(b.package.version_code, &b.package.id)));
        Ok(catalog.data)
    }
    async fn installed(pool: &SqlitePool, song_db: &SqlitePool, config: &CloudConfig, m: &Manifest) -> AppResult<bool> {
        let folders: Vec<String> = sqlx::query_scalar("SELECT localPath FROM sync_tasks WHERE targetType='vodPackage' AND targetId=? AND cloud_url=? AND status=2 ORDER BY updatedAt DESC")
            .bind(&m.package.id).bind(m.key(config)).fetch_all(pool).await?;
        for folder in folders {
            if folder.trim().is_empty() { continue; }
            let mut actual = config.clone();
            actual.download_dir = folder;
            let folder = m.folder(&actual);
            let mut intact = true;
            for file in m.files.iter().filter(|f| f.file_role == "video") {
                if tokio::fs::metadata(folder.join(&file.file_name)).await.map(|v| v.len()).ok() != Some(file.file_size as u64) { intact=false; break; }
            }
            if !intact { continue; }
            if let Ok(records) = Self::video_records(song_db, &actual, m).await {
                if Self::check_registered(song_db, &records).await.is_ok() { return Ok(true); }
            }
        }
        Ok(false)
    }

    pub async fn views(pool: &SqlitePool, song_db: &SqlitePool, config: &CloudConfig) -> AppResult<Vec<PackageView>> {
        let catalog = Self::catalog(config).await.map_err(|e| AppError::BadRequest(format!("读取更新包失败：{e:#}")))?;
        let mut views = Vec::new();
        for m in catalog {
            views.push(PackageView { installed: Self::installed(pool, song_db, config, &m).await?, id: m.package.id.clone(),
                name: m.package.package_name.clone(), version_code: m.package.version_code, song_count: m.package.song_count,
                video_count: m.files.iter().filter(|f| f.file_role == "video").count(), total_size: m.files.iter().map(|f| f.file_size).sum() });
        }
        Ok(views)
    }
    /// Apply all missed packages in order. A single guard covers creation and execution.
    pub async fn start(pool: SqlitePool, song_db: SqlitePool, config: CloudConfig) -> AppResult<Vec<SyncTask>> {
        let guard = update_lock().try_lock_owned().map_err(|_| AppError::Conflict("云端更新正在执行".into()))?;
        Self::start_locked(pool, song_db, config, guard, None).await
    }
    pub(crate) async fn start_automatic(pool: SqlitePool, song_db: SqlitePool, path: &Path, license: &crate::license::LicenseManager) -> AppResult<Vec<SyncTask>> {
        let guard = update_lock().try_lock_owned().map_err(|_| AppError::Conflict("云端更新正在执行".into()))?;
        // Read again under the settings/update lock so switching to manual cannot race a tick.
        let Some(config) = super::cloud_update_scheduler::automatic_config(path, license)? else { return Ok(vec![]); };
        Self::start_locked(pool, song_db, config, guard, None).await
    }
    /// A manual-mode user already requested these packages before the process stopped.
    pub(crate) async fn resume_interrupted(pool: SqlitePool, song_db: SqlitePool, config: CloudConfig) -> AppResult<Vec<SyncTask>> {
        let guard=update_lock().try_lock_owned().map_err(|_| AppError::Conflict("云端更新正在执行".into()))?;
        let ids:Vec<String>=sqlx::query_scalar("SELECT DISTINCT targetId FROM sync_tasks WHERE targetType='vodPackage' AND status=3 AND errorMessage LIKE '服务器重启导致下载中断%'")
            .fetch_all(&pool).await?;
        if ids.is_empty(){return Ok(vec![]);}
        Self::start_locked(pool,song_db,config,guard,Some(ids.into_iter().collect())).await
    }
    async fn start_locked(pool: SqlitePool, song_db: SqlitePool, config: CloudConfig, guard: OwnedMutexGuard<()>, only: Option<HashSet<String>>) -> AppResult<Vec<SyncTask>> {
        let catalog = Self::catalog(&config).await.map_err(|e| AppError::BadRequest(format!("读取更新包失败：{e:#}")))?;
        let mut jobs = Vec::new();
        for m in catalog {
            if only.as_ref().is_some_and(|ids|!ids.contains(&m.package.id)){continue;}
            if Self::installed(&pool, &song_db, &config, &m).await? { continue; }
            let old: Option<SyncTask> = sqlx::query_as("SELECT * FROM sync_tasks WHERE targetType='vodPackage' AND targetId=? AND cloud_url=? AND status IN (0,3) ORDER BY createdAt DESC LIMIT 1")
                .bind(&m.package.id).bind(m.key(&config)).fetch_optional(&pool).await?;
            let task = if let Some(t) = old { t } else { CloudService::create_download_task(&pool, "vodPackage", &m.package.id, &m.key(&config)).await? };
            super::update_history::begin(&pool, &task.id, &config, &m, &m.revision()).await.map_err(AppError::Internal)?;
            super::update_history::refresh_song_metadata(&pool,&song_db,&task.id).await.map_err(AppError::Internal)?;
            let cached = Self::cached_bytes(&config, &m).await.map_err(AppError::Internal)?;
            sqlx::query("UPDATE sync_tasks SET localPath=?, fileSize=?, errorMessage=?, downloaded_size=?, status=0, updatedAt=datetime('now','localtime') WHERE id=?")
                .bind(m.folder(&config).to_string_lossy().as_ref()).bind(m.files.iter().map(|f| f.file_size).sum::<i64>())
                .bind(format!("等待更新：{}", m.package.package_name)).bind(cached).bind(&task.id).execute(&pool).await?;
            jobs.push((CloudService::get_task(&pool, &task.id).await?, m));
        }
        let tasks = jobs.iter().map(|(t,_)| t.clone()).collect();
        tokio::spawn(Self::run_jobs(pool, song_db, config, jobs, guard));
        Ok(tasks)
    }
    async fn run_jobs(pool: SqlitePool, song_db: SqlitePool, mut config: CloudConfig, jobs: Vec<(SyncTask, Manifest)>, _guard: OwnedMutexGuard<()>) {
        let mut previous_failed = false;
        for (task, m) in jobs {
            let mut moved_caches=Vec::new();
            let result = if previous_failed { Err(anyhow::anyhow!("前一个更新包失败，请重试后按顺序继续")) } else {
                async {
                    sqlx::query("UPDATE sync_tasks SET status=1 WHERE id=?").bind(&task.id).execute(&pool).await?;
                    // Recheck each package; selected drives can fill up between jobs.
                    let mut switched = false;
                    loop {
                        Self::ensure_authorized(&config)?;
                        let total = m.files.iter().map(|f| f.file_size as u64).sum::<u64>();
                        let required = total
                            .saturating_sub(Self::cached_bytes(&config, &m).await? as u64);
                        let current=Path::new(&config.download_dir);
                        let mut chosen = if !switched && cloud_storage::ensure_space(current,required).is_ok() {
                            cloud_storage::select_directory(current,required,false)?
                        }else{cloud_storage::select_directory(current,total,true)?};
                        if chosen!=m.folder(&config) {
                            // A different volume needs space for the retained prefix as well.
                            chosen=cloud_storage::select_directory(current,total,true)?;
                        }
                        let old_config=config.clone();
                        config.download_dir = chosen.to_string_lossy().into_owned();
                        if m.folder(&old_config)!=m.folder(&config){
                            Self::move_cache(&old_config,&config,&m).await?;
                            moved_caches.push(m.staging(&old_config));
                        }
                        if let Some(path) = &config.config_path {
                            crate::config::save_cloud_config(path, &config.api_base_url, &config.download_dir, None, None)?;
                        }
                        sqlx::query("UPDATE sync_tasks SET localPath=? WHERE id=?")
                            .bind(&config.download_dir).bind(&task.id).execute(&pool).await?;
                        match Self::apply(&pool, &song_db, &config, &task.id, &m).await {
                            Err(e) if e.is::<cloud_storage::InsufficientSpace>() && !switched => { switched = true; }
                            result => break result,
                        }
                    }
                }.await
            };
            let (status, message) = match result {
                Ok(()) => (2, format!("更新完成：{}，已入库视频 {} 个", m.package.package_name, m.files.iter().filter(|f| f.file_role == "video").count())),
                Err(e) => { previous_failed = true; (3, format!("{e:#}")) }
            };
            if status==2 {
                for cache in moved_caches {
                    if cache.is_dir() {
                        if let Err(error)=tokio::fs::remove_dir_all(cache).await {tracing::warn!("原磁盘续传缓存清理失败：{error}");}
                    }
                }
            }
            if let Err(e) = sqlx::query("UPDATE sync_tasks SET status=?, errorMessage=?, retry_count=retry_count+?, updatedAt=datetime('now','localtime') WHERE id=?")
                .bind(status).bind(message).bind(if status == 3 {1} else {0}).bind(&task.id).execute(&pool).await {
                tracing::error!("写入云端更新任务状态失败：{e}");
            }
        }
    }
    async fn stage(pool: &SqlitePool, id: &str, message: &str, bytes: i64) -> anyhow::Result<()> {
        sqlx::query("UPDATE sync_tasks SET errorMessage=?, downloaded_size=?, updatedAt=datetime('now','localtime') WHERE id=?")
            .bind(message).bind(bytes).bind(id).execute(pool).await?;
        Ok(())
    }
    async fn verify(path: &Path, file: &PackageFile) -> anyhow::Result<bool> {
        if tokio::fs::metadata(path).await.map(|v| v.len()).ok() != Some(file.file_size as u64) { return Ok(false); }
        let mut input = tokio::fs::File::open(path).await?;
        let mut hasher = Sha256::new(); let mut buffer = vec![0; 128 * 1024];
        loop { let n = input.read(&mut buffer).await?; if n == 0 { break; } hasher.update(&buffer[..n]); }
        Ok(format!("{:x}", hasher.finalize()).eq_ignore_ascii_case(file.sha256.as_deref().unwrap_or("")))
    }
    fn part_path(folder: &Path, file: &PackageFile) -> PathBuf {
        folder.join(format!("{}.part", file.sha256.as_deref().unwrap_or("").to_ascii_lowercase()))
    }
    async fn retained_bytes(folder: &Path, file: &PackageFile) -> anyhow::Result<i64> {
        if Self::verify(&folder.join(&file.file_name), file).await? { return Ok(file.file_size); }
        let size=tokio::fs::metadata(Self::part_path(folder,file)).await.map(|m|m.len()).unwrap_or(0);
        Ok(if size<=file.file_size as u64 {size as i64} else {0})
    }
    async fn cached_bytes(config: &CloudConfig, m: &Manifest) -> anyhow::Result<i64> {
        let mut total=0;
        for file in &m.files {
            total+=if file.file_role=="video" && Self::verify(&m.folder(config).join(&file.file_name),file).await? {
                file.file_size
            }else{Self::retained_bytes(&m.staging(config),file).await?};
        }
        Ok(total)
    }
    fn retryable(error: &anyhow::Error) -> bool {
        error.chain().any(|cause| cause.downcast_ref::<TransientDownload>().is_some()
            || cause.downcast_ref::<reqwest::Error>().is_some_and(|e| {
                e.is_timeout() || e.is_connect() || e.is_body() || e.is_request()
                    || e.status().is_some_and(|s|s.is_server_error() || matches!(s.as_u16(),408|429))
            }))
    }
    fn retry_delay(attempt: u32) -> Duration {
        Duration::from_secs(5u64.saturating_mul(1u64 << attempt.min(4)).min(60))
    }
    async fn fetch(pool: &SqlitePool, id: &str, config: &CloudConfig, file: &PackageFile, folder: &Path, offset: i64) -> anyhow::Result<PathBuf> {
        let mut attempt=0;
        loop {
            match Self::fetch_once(pool,id,config,file,folder,offset).await {
                Ok(path)=>return Ok(path),
                Err(e) if Self::retryable(&e)=>{
                    Self::ensure_authorized(config)?;
                    let delay=Self::retry_delay(attempt);attempt=attempt.saturating_add(1);
                    let bytes=Self::retained_bytes(folder,file).await?;
                    Self::stage(pool,id,&format!("网络中断，已保留进度，{} 秒后自动续传（第 {} 次）：{}",delay.as_secs(),attempt,file.file_name),offset+bytes).await?;
                    tokio::time::sleep(delay).await;
                },
                Err(e)=>return Err(e),
            }
        }
    }
    async fn fetch_once(pool: &SqlitePool, id: &str, config: &CloudConfig, file: &PackageFile, folder: &Path, offset: i64) -> anyhow::Result<PathBuf> {
        Self::ensure_authorized(config)?;
        let path=folder.join(&file.file_name);
        if Self::verify(&path,file).await? { return Ok(path); }
        let part=Self::part_path(folder,file);
        let mut size=tokio::fs::metadata(&part).await.map(|m|m.len() as i64).unwrap_or(0);
        if size==file.file_size && Self::verify(&part,file).await? {
            if tokio::fs::try_exists(&path).await? {tokio::fs::remove_file(&path).await?;}
            tokio::fs::rename(&part,&path).await?;return Ok(path);
        }
        if size>=file.file_size {tokio::fs::remove_file(&part).await?;size=0;}
        cloud_storage::ensure_space(folder,(file.file_size-size) as u64)?;
        Self::stage(pool,id,&format!("{}：{}",if size>0 {"正在断点续传"}else{"正在下载"},file.file_name),offset+size).await?;
        let mut request=CloudService::http_client()?.get(&file.download_url).header("Accept-Encoding","identity");
        if !config.license_proof.is_empty(){request=request.header("X-HVideo-Server-License",&config.license_proof);}
        if size>0{request=request.header("Range",format!("bytes={size}-"));}
        let response=tokio::time::timeout(Duration::from_secs(60),request.send()).await
            .map_err(|_|anyhow::anyhow!(TransientDownload("云端响应超时")))??.error_for_status()?;
        let status=response.status();
        if status==reqwest::StatusCode::PARTIAL_CONTENT {
            let expected=format!("bytes {}-{}/{}",size,file.file_size-1,file.file_size);
            ensure!(response.headers().get("Content-Range").and_then(|h|h.to_str().ok())==Some(expected.as_str()),"云端断点响应范围不正确，已保留原进度：{}",file.file_name);
        }else{
            ensure!(status==reqwest::StatusCode::OK,"云端返回不支持的下载状态：{status}");
            // A server that ignores Range returns the entire file. Never append that to a prefix.
            size=0;
        }
        ensure!(response.headers().get("Content-Encoding").is_none_or(|h|h=="identity"),"云端返回压缩内容，无法安全续传");
        if let Some(length)=response.content_length(){ensure!(length==(file.file_size-size) as u64,"云端下载长度与更新清单不一致：{}",file.file_name);}
        cloud_storage::ensure_space(folder,(file.file_size-size) as u64)?;
        let mut output=tokio::fs::OpenOptions::new().create(true).write(true).truncate(size==0).append(size>0).open(&part).await?;
        let mut stream=response.bytes_stream();let mut last=tokio::time::Instant::now();
        let result: anyhow::Result<()>=async {
            loop {
                let next=tokio::time::timeout(Duration::from_secs(60),stream.next()).await
                    .map_err(|_|anyhow::anyhow!(TransientDownload("下载连接超时")))?;
                let Some(chunk)=next else{break};let chunk=chunk?;
                ensure!(size+chunk.len() as i64<=file.file_size,"下载文件超过声明大小：{}",file.file_name);
                Self::ensure_authorized(config)?;cloud_storage::ensure_space(folder,chunk.len() as u64)?;
                output.write_all(&chunk).await?;size+=chunk.len() as i64;
                if last.elapsed()>Duration::from_millis(500){
                    Self::stage(pool,id,&format!("正在下载：{}",file.file_name),offset+size).await?;last=tokio::time::Instant::now();
                }
            }
            Ok(())
        }.await;
        // Flush even when the connection breaks so retry/restart can use every written byte.
        output.flush().await?;output.sync_all().await?;drop(output);
        Self::stage(pool,id,&format!("已保存下载进度：{}",file.file_name),offset+size).await?;
        result?;
        if size<file.file_size{return Err(TransientDownload("下载连接提前结束").into());}
        if !Self::verify(&part,file).await? {
            tokio::fs::remove_file(&part).await?;
            Self::stage(pool,id,"文件 SHA256 校验失败，已丢弃损坏的下载片段",offset).await?;
            bail!("文件 SHA256 校验失败：{}",file.file_name);
        }
        if tokio::fs::try_exists(&path).await?{tokio::fs::remove_file(&path).await?;}
        tokio::fs::rename(&part,&path).await?;
        Ok(path)
    }
    async fn protected_copy(config: &CloudConfig, source: &Path, target: &Path) -> anyhow::Result<()> {
        let mut input = tokio::fs::File::open(source).await?;
        let mut output = tokio::fs::File::create(target).await?;
        let mut buffer = vec![0; 1024 * 1024];
        loop {
            let size = input.read(&mut buffer).await?;
            if size == 0 { break; }
            Self::ensure_authorized(config)?;
            cloud_storage::ensure_space(target.parent().context("更新目录无效")?, size as u64)?;
            output.write_all(&buffer[..size]).await?;
        }
        output.flush().await?;
        output.sync_all().await?;
        Ok(())
    }
    async fn move_cache(old: &CloudConfig, new: &CloudConfig, m: &Manifest) -> anyhow::Result<()> {
        let target=m.staging(new);tokio::fs::create_dir_all(&target).await?;
        for file in &m.files {
            if Self::verify(&target.join(&file.file_name),file).await? {continue;}
            let staged=m.staging(old).join(&file.file_name);
            let installed=m.folder(old).join(&file.file_name);
            if Self::verify(&staged,file).await? {
                Self::protected_copy(new,&staged,&target.join(&file.file_name)).await?;
            }else if file.file_role=="video" && Self::verify(&installed,file).await? {
                Self::protected_copy(new,&installed,&target.join(&file.file_name)).await?;
            }else{
                let source=Self::part_path(&m.staging(old),file);let dest=Self::part_path(&target,file);
                let bytes=tokio::fs::metadata(&source).await.map(|m|m.len()).unwrap_or(0);
                let saved=tokio::fs::metadata(&dest).await.map(|m|m.len()).unwrap_or(0);
                if bytes>saved && bytes<=file.file_size as u64 {Self::protected_copy(new,&source,&dest).await?;}
            }
        }
        // Original cache survives until a successful retry; never remove original playable videos.
        Ok(())
    }
    async fn video_records(song_db: &SqlitePool, config: &CloudConfig, m: &Manifest) -> anyhow::Result<Vec<MatchRecord>> {
        let mut records = Vec::new();
        let mut song_nos = HashSet::new();
        for file in m.files.iter().filter(|f| f.file_role == "video") {
            let mut matched = None;
            for candidate in crate::scanner::id_extractor::extract_song_no_candidates(&file.file_name) {
                if sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM songs WHERE songNo=?")
                    .bind(&candidate).fetch_one(song_db).await? > 0 { matched=Some(candidate); break; }
            }
            let song_no = matched.with_context(|| format!("视频 {} 没有对应的歌曲资料，请上传包含该编号的曲库", file.file_name))?;
            ensure!(song_nos.insert(song_no.clone()), "多个视频对应同一歌曲编号：{song_no}");
            records.push(MatchRecord {songId:song_no, filePath:crate::utils::media_path::normalize_slashes(m.folder(config).join(&file.file_name).to_string_lossy().as_ref())});
        }
        Ok(records)
    }
    async fn check_registered(song_db: &SqlitePool, records: &[MatchRecord]) -> anyhow::Result<()> {
        for record in records {
            let count: i64=sqlx::query_scalar("SELECT COUNT(*) FROM songs s JOIN local_available_songs l ON s.songNo=l.songNo JOIN songSearch q ON q.songNo=s.songNo JOIN songFiles f ON f.songNo=s.songNo WHERE s.songNo=? AND s.fileExists=1 AND s.absolutePath=? AND l.absolutePath=? AND q.fileExists=1 AND f.fileExists=1 AND f.absolutePath=?")
                .bind(&record.songId).bind(&record.filePath).bind(&record.filePath).bind(&record.filePath).fetch_one(song_db).await?;
            ensure!(count == 1, "歌曲 {} 的曲库、可点播索引或路径未完整登记",record.songId);
            tokio::fs::File::open(&record.filePath).await.with_context(||format!("视频无法读取：{}",record.filePath))?;
        }
        Ok(())
    }
    async fn apply(pool: &SqlitePool, song_db: &SqlitePool, config: &CloudConfig, id: &str, m: &Manifest) -> anyhow::Result<()> {
        m.validate(config)?;
        Self::ensure_authorized(config)?;
        let folder = m.folder(config);
        tokio::fs::create_dir_all(&folder).await?;
        let remaining=m.files.iter().map(|f|f.file_size as u64).sum::<u64>()
            .saturating_sub(Self::cached_bytes(config,m).await? as u64);
        cloud_storage::ensure_space(&folder,remaining)?;
        // Persistent package cache survives failure and process restarts; final videos remain flat.
        let staging=m.staging(config);
        tokio::fs::create_dir_all(&staging).await?;
        let legacy = folder.join(&m.package.id).join(m.revision());
        let mut retained=Vec::new();
        for file in &m.files {
            retained.push(if file.file_role=="video" && Self::verify(&folder.join(&file.file_name),file).await? {
                file.file_size
            }else{Self::retained_bytes(&staging,file).await?});
        }
        let mut offset: i64 = retained.iter().sum();
        for (file,saved) in m.files.iter().zip(retained) {
            super::update_history::song_stage(pool,id,&file.file_name,"downloading","").await?;
            Self::stage(pool,id,&format!("校验 / 下载：{}", file.file_name),offset).await?;
            let base=offset-saved;
            let final_path = folder.join(&file.file_name);
            if file.file_role == "video" && Self::verify(&final_path,file).await? {
                // Already installed and verified: no duplicate staging copy or network transfer.
            } else if Self::verify(&staging.join(&file.file_name),file).await? {
                // Another file or the previous import failed; reuse this completed download.
            } else if Self::verify(&legacy.join(&file.file_name),file).await? {
                Self::protected_copy(config, &legacy.join(&file.file_name), &staging.as_path().join(&file.file_name)).await?;
            } else {
                Self::fetch(pool,id,config,file,staging.as_path(),base).await?;
            }
            super::update_history::song_stage(pool,id,&file.file_name,"downloaded","").await?;
            offset = base+file.file_size;
        }
        Self::ensure_authorized(config)?;
        for file in m.files.iter().filter(|f| f.file_role == "source") {
            let task = SongDataImportService::create_task(song_db,&file.file_name,staging.as_path().join(&file.file_name)).await?;
            loop {
                let task = SongDataImportService::get_task(song_db,&task.task_id).await?;
                Self::stage(pool,id,&format!("导入曲库：{}（已处理 {} 行）",file.file_name,task.processed_count),offset).await?;
                if task.status == "completed" {
                    ensure!(task.failed_count == 0 && task.imported_count > 0, "曲库导入不完整：成功 {} 行，失败 {} 行；{}",task.imported_count,task.failed_count,task.error_message.unwrap_or_default());
                    break;
                }
                if task.status == "failed" { bail!("曲库导入失败：{}",task.error_message.unwrap_or_default()); }
                tokio::time::sleep(Duration::from_millis(600)).await;
            }
        }
        super::update_history::refresh_song_metadata(pool,song_db,id).await?;
        let records = match Self::video_records(song_db,config,m).await {
            Ok(records)=>records,
            Err(error)=>{
                // Mark the files without song metadata, instead of claiming they were imported.
                sqlx::query("UPDATE update_history_songs SET status='failed',message=? WHERE song_name='' AND history_id IN(SELECT id FROM update_history WHERE task_id=? AND status IN(0,1))")
                    .bind(format!("{error:#}")).bind(id).execute(pool).await?;
                return Err(error);
            }
        };
        Self::stage(pool,id,"正在保存视频并登记可点播曲库",offset).await?;
        for file in m.files.iter().filter(|f| f.file_role == "video") {
            super::update_history::song_stage(pool,id,&file.file_name,"installing","").await?;
            let final_path=folder.join(&file.file_name);
            if !Self::verify(&final_path,file).await? {
                let staged=staging.join(&file.file_name);
                ensure!(Self::verify(&staged,file).await?, "待保存视频校验失败：{}", file.file_name);
                // Staging is on the destination volume. Replace only after full validation;
                // never delete/truncate the old playable file before the rename succeeds.
                // On failure (including a Windows sharing violation), both files survive.
                let destination=final_path.clone();
                tokio::task::spawn_blocking(move || replace_video_file(&staged,&destination)).await?
                    .with_context(||format!("保存视频失败：{}，已下载文件已保留，等待重试",file.file_name))?;
            }
            ensure!(Self::verify(&final_path,file).await?, "保存后视频校验失败：{}",file.file_name);
        }
        // Only this package's files are registered, never scan unrelated files in the chosen directory.
        crate::scanner::database_matcher::batch_update_song_paths(song_db,&records,folder.to_string_lossy().as_ref(),true).await?;
        Self::check_registered(song_db,&records).await?;
        Self::register_new_songs(song_db,m,&records).await?;
        for file in m.files.iter().filter(|f|f.file_role=="video") {
            super::update_history::song_stage(pool,id,&file.file_name,"completed","").await?;
        }
        // Legacy directories are removed only after exact-file validation and only if no queued song uses them.
        for file in &m.files {
            let old=legacy.join(&file.file_name);
            if !Self::verify(&old,file).await? { continue; }
            let old_normalized=crate::utils::media_path::normalize_slashes(old.to_string_lossy().as_ref());
            let queued:i64=sqlx::query_scalar("SELECT COUNT(*) FROM room_queue WHERE REPLACE(songPath,char(92),'/')=? AND status IN (0,1)")
                .bind(&old_normalized).fetch_one(pool).await?;
            if queued==0 { tokio::fs::remove_file(old).await?; }
        }
        if tokio::fs::try_exists(&legacy).await? {
            if let Err(e)=tokio::fs::remove_dir(&legacy).await { tracing::debug!("保留仍有文件的旧更新目录：{e}"); }
            if let Some(parent)=legacy.parent() { let _=tokio::fs::remove_dir(parent).await; }
        }
        // Delete only this package's owned cache after files and every database index are verified.
        if let Err(error)=tokio::fs::remove_dir_all(&staging).await {
            tracing::warn!("更新完成，下载缓存清理失败：{error}");
        }
        Self::stage(pool,id,&format!("已入库，可点播视频 {} 个",records.len()),offset).await?;
        Ok(())
    }

    async fn register_new_songs(song_db: &SqlitePool, m: &Manifest, records: &[MatchRecord]) -> anyhow::Result<()> {
        if records.is_empty() { return Ok(()); }
        let batch_id = format!("cloud:{}:{}", m.package.id, m.revision());
        let mut tx = song_db.begin().await?;
        // Retrying repairs must not make an old package new again.
        sqlx::query("INSERT INTO songBatches(batchId,batchName,batchType,isNewBatch,songCount,createdTime) VALUES (?,?,'cloudVod',0,?,?) ON CONFLICT(batchId) DO UPDATE SET songCount=excluded.songCount")
            .bind(&batch_id).bind(&m.package.package_name).bind(records.len() as i64).bind(chrono::Utc::now().timestamp_millis()).execute(&mut *tx).await?;
        let added_time:i64=sqlx::query_scalar("SELECT createdTime FROM songBatches WHERE batchId=?").bind(&batch_id).fetch_one(&mut *tx).await?;
        for record in records {
            for table in ["songs", "songSearch"] {
                let result=sqlx::query(&format!("UPDATE {table} SET addedBatchId=?,addedTime=? WHERE songNo=?"))
                    .bind(&batch_id).bind(added_time).bind(&record.songId).execute(&mut *tx).await?;
                ensure!(result.rows_affected()==1,"歌曲 {} 的新歌索引登记失败",record.songId);
            }
        }
        tx.commit().await?;
        Ok(())
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Router, Json};
    use sqlx::Row;

    async fn pools() -> (SqlitePool, SqlitePool) {
        let pool = crate::db::init_pool("sqlite::memory:",1).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/001_init.sql")).execute(&pool).await.unwrap();
        // Production integrity index uses the legacy task column names.
        crate::db::run_migrations(&pool).await.unwrap();
        let songs = crate::db::init_song_db_pool("sqlite::memory:",1).await.unwrap();
        (pool,songs)
    }
    fn test_config(base:String,folder:&Path)->CloudConfig {
        CloudConfig{update_mode:Default::default(),license_proof:String::new(),cloud_update_expires_at:None,config_path:None,api_base_url:base,download_dir:folder.to_string_lossy().into_owned(),api_key:String::new()}
    }
    #[tokio::test]
    async fn download_breaks_at_sixty_percent_then_automatically_resumes_and_registers() {
        use axum::{body::Body,http::{HeaderMap,Response}};
        use std::sync::atomic::{AtomicUsize,Ordering};
        let temp=tempfile::tempdir().unwrap();let (pool,songs)=pools().await;
        let calls=Arc::new(AtomicUsize::new(0));let count=calls.clone();
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config=test_config(format!("http://{}",listener.local_addr().unwrap()),temp.path());
        let m=manifest(&config.api_base_url);let task=CloudService::create_download_task(&pool,"vodPackage",&m.package.id,&m.key(&config)).await.unwrap();
        super::super::update_history::begin(&pool,&task.id,&config,&m,&m.revision()).await.unwrap();
        let server=tokio::spawn(async move{axum::serve(listener,Router::new().route("/video",get(move |headers:HeaderMap|{
            let count=count.clone();async move {
                let request_number=count.fetch_add(1,Ordering::SeqCst);
                if request_number==0 {
                    assert!(headers.get("range").is_none());
                    let chunks=futures::stream::unfold(0,|step|async move {
                        match step {
                            0=>Some((Ok::<_,std::io::Error>(b"test-v".to_vec()),1)),
                            1=>{tokio::time::sleep(Duration::from_millis(80)).await;Some((Err(std::io::Error::other("simulated disconnect at 60%")),2))},
                            _=>None,
                        }
                    });
                    Response::builder().header("content-length","10").body(Body::from_stream(chunks)).unwrap()
                }else{
                    assert_eq!(headers.get("range").unwrap(),"bytes=6-");
                    if request_number==1 {
                        Response::builder().status(503).body(Body::from("temporary unavailable")).unwrap()
                    }else{
                        Response::builder().status(206).header("content-range","bytes 6-9/10").header("content-length","4").body(Body::from("ideo")).unwrap()
                    }
                }
            }
        }))).await.unwrap()});
        sqlx::query("INSERT INTO songs(songNo,songName) VALUES('80000101','自动续传')").execute(&songs).await.unwrap();
        sqlx::query("INSERT INTO songSearch(songNo,songName,nameKey) VALUES('80000101','自动续传','自动续传')").execute(&songs).await.unwrap();
        let old_video=temp.path().join("80000101.mp4");
        tokio::fs::write(&old_video,b"old-video!").await.unwrap();
        let (db,song_db,c,manifest,tid)=(pool.clone(),songs.clone(),config.clone(),m.clone(),task.id.clone());
        let job=tokio::spawn(async move {VodUpdateService::apply(&db,&song_db,&c,&tid,&manifest).await});
        tokio::time::timeout(Duration::from_secs(3),async{
            loop {
                let t=CloudService::get_task(&pool,&task.id).await.unwrap();
                if t.error_message.contains("自动续传"){assert_eq!(t.downloaded_size,6);break;}
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT status FROM update_history_songs").fetch_one(&pool).await.unwrap(),"downloading");
        assert_eq!(tokio::fs::read(VodUpdateService::part_path(&m.staging(&config),&m.files[0])).await.unwrap(),b"test-v");
        assert_eq!(tokio::fs::read(&old_video).await.unwrap(),b"old-video!");
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM songs WHERE fileExists=1").fetch_one(&songs).await.unwrap(),0);
        tokio::time::timeout(Duration::from_secs(22),job).await.unwrap().unwrap().unwrap();
        assert_eq!(calls.load(Ordering::SeqCst),3);
        assert_eq!(tokio::fs::read(temp.path().join("80000101.mp4")).await.unwrap(),b"test-video");
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM local_available_songs").fetch_one(&songs).await.unwrap(),1);
        assert!(!m.staging(&config).exists());
        let detail:(String,String)=sqlx::query_as("SELECT song_name,status FROM update_history_songs").fetch_one(&pool).await.unwrap();
        assert_eq!(detail,("自动续传".into(),"completed".into()));
        server.abort();pool.close().await;songs.close().await;
    }
    #[tokio::test]
    async fn same_name_replacement_skips_identical_files_and_registers_the_whole_package() {
        use std::sync::atomic::{AtomicUsize,Ordering};
        let temp=tempfile::tempdir().unwrap();let (pool,songs)=pools().await;
        let calls=Arc::new(AtomicUsize::new(0));let count=calls.clone();
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config=test_config(format!("http://{}",listener.local_addr().unwrap()),temp.path());
        let mut m=manifest(&config.api_base_url);
        m.files[0].file_name="80000101.hvideo".into();
        for (number,name) in [("80000101","替换"),("80000102","复用"),("80000103","新增")] {
            sqlx::query("INSERT INTO songs(songNo,songName) VALUES(?,?)").bind(number).bind(name).execute(&songs).await.unwrap();
            sqlx::query("INSERT INTO songSearch(songNo,songName,nameKey) VALUES(?,?,?)").bind(number).bind(name).bind(name).execute(&songs).await.unwrap();
        }
        for number in ["80000102","80000103"] {
            m.files.push(PackageFile{id:number.into(),file_name:format!("{number}.hvideo"),..m.files[0].clone()});
        }
        // Same size, different SHA256 must replace; identical content must not transfer.
        tokio::fs::write(temp.path().join("80000101.hvideo"),b"old-video!").await.unwrap();
        tokio::fs::write(temp.path().join("80000102.hvideo"),b"test-video").await.unwrap();
        let server=tokio::spawn(async move{axum::serve(listener,Router::new().route("/video",get(move ||{
            count.fetch_add(1,Ordering::SeqCst);async {"test-video"}
        }))).await.unwrap()});
        let task=CloudService::create_download_task(&pool,"vodPackage",&m.package.id,&m.key(&config)).await.unwrap();
        VodUpdateService::apply(&pool,&songs,&config,&task.id,&m).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst),2);
        for file in &m.files { assert_eq!(tokio::fs::read(temp.path().join(&file.file_name)).await.unwrap(),b"test-video"); }
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM songs WHERE fileExists=1 AND scoreEnabled=1").fetch_one(&songs).await.unwrap(),3);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM local_available_songs").fetch_one(&songs).await.unwrap(),3);
        assert_eq!(CloudService::get_task(&pool,&task.id).await.unwrap().downloaded_size,30);
        assert!(!m.staging(&config).exists());
        // Reapplying the same content repairs indices without another network request.
        VodUpdateService::apply(&pool,&songs,&config,&task.id,&m).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst),2);
        server.abort();pool.close().await;songs.close().await;
    }
    #[tokio::test]
    async fn corrupt_replacement_keeps_existing_playable_file_and_index() {
        let temp=tempfile::tempdir().unwrap();let (pool,songs)=pools().await;
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config=test_config(format!("http://{}",listener.local_addr().unwrap()),temp.path());
        let m=manifest(&config.api_base_url);
        let path=temp.path().join(&m.files[0].file_name);
        tokio::fs::write(&path,b"old-video!").await.unwrap();
        sqlx::query("INSERT INTO songs(songNo,songName) VALUES('80000101','已有歌曲')").execute(&songs).await.unwrap();
        sqlx::query("INSERT INTO songSearch(songNo,songName,nameKey) VALUES('80000101','已有歌曲','已有歌曲')").execute(&songs).await.unwrap();
        let records=VodUpdateService::video_records(&songs,&config,&m).await.unwrap();
        crate::scanner::database_matcher::batch_update_song_paths(&songs,&records,temp.path().to_str().unwrap(),true).await.unwrap();
        let server=tokio::spawn(async move{axum::serve(listener,Router::new().route("/video",get(||async{"corrupted!"}))).await.unwrap()});
        let task=CloudService::create_download_task(&pool,"vodPackage",&m.package.id,&m.key(&config)).await.unwrap();
        let error=VodUpdateService::apply(&pool,&songs,&config,&task.id,&m).await.unwrap_err();
        assert!(error.to_string().contains("SHA256"));
        assert_eq!(tokio::fs::read(path).await.unwrap(),b"old-video!");
        VodUpdateService::check_registered(&songs,&records).await.unwrap();
        server.abort();pool.close().await;songs.close().await;
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn readonly_destination_reproduces_access_denied_then_replaces_cached_video_and_registers() {
        let temp=tempfile::tempdir().unwrap();let (pool,songs)=pools().await;
        // Deliberately unreachable: completed downloads must be reused without network access.
        let config=test_config("http://127.0.0.1:1".into(),temp.path());
        let mut m=manifest(&config.api_base_url);
        m.files[0].file_name="80000101.hvideo".into();
        let path=temp.path().join(&m.files[0].file_name);
        tokio::fs::write(&path,b"old-video!").await.unwrap();
        let mut permissions=std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);std::fs::set_permissions(&path,permissions).unwrap();
        tokio::fs::create_dir_all(m.staging(&config)).await.unwrap();
        let staged=m.staging(&config).join(&m.files[0].file_name);
        tokio::fs::write(&staged,b"test-video").await.unwrap();
        let old_error=std::fs::rename(&staged,&path).unwrap_err();
        assert_eq!(old_error.raw_os_error(),Some(5));
        sqlx::query("INSERT INTO songs(songNo,songName) VALUES('80000101','只读替换')").execute(&songs).await.unwrap();
        sqlx::query("INSERT INTO songSearch(songNo,songName,nameKey) VALUES('80000101','只读替换','只读替换')").execute(&songs).await.unwrap();
        let task=CloudService::create_download_task(&pool,"vodPackage",&m.package.id,&m.key(&config)).await.unwrap();
        VodUpdateService::apply(&pool,&songs,&config,&task.id,&m).await.unwrap();
        assert_eq!(tokio::fs::read(&path).await.unwrap(),b"test-video");
        assert!(!std::fs::metadata(&path).unwrap().permissions().readonly());
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM songs WHERE fileExists=1 AND scoreEnabled=1").fetch_one(&songs).await.unwrap(),1);
        let records=VodUpdateService::video_records(&songs,&config,&m).await.unwrap();
        VodUpdateService::check_registered(&songs,&records).await.unwrap();
        assert!(!m.staging(&config).exists());
        pool.close().await;songs.close().await;
    }
    #[cfg(windows)]
    #[test]
    fn readonly_replacement_failure_preserves_attributes_files_and_non_file_targets() {
        use std::os::windows::fs::OpenOptionsExt;
        let temp=tempfile::tempdir().unwrap();
        let destination=temp.path().join("old.hvideo");let staged=temp.path().join("new.hvideo");
        std::fs::write(&destination,b"old").unwrap();std::fs::write(&staged,b"new").unwrap();
        let mut permissions=std::fs::metadata(&destination).unwrap().permissions();
        permissions.set_readonly(true);std::fs::set_permissions(&destination,permissions).unwrap();
        let held=std::fs::OpenOptions::new().read(true).share_mode(1).open(&destination).unwrap();
        assert!(replace_video_file(&staged,&destination).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(),b"old");
        assert_eq!(std::fs::read(&staged).unwrap(),b"new");
        assert!(std::fs::metadata(&destination).unwrap().permissions().readonly());
        drop(held);
        replace_video_file(&staged,&destination).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(),b"new");
        let directory=temp.path().join("directory.hvideo");std::fs::create_dir(&directory).unwrap();
        std::fs::write(&staged,b"new").unwrap();
        assert!(replace_video_file(&staged,&directory).is_err());
        assert!(directory.is_dir());assert_eq!(std::fs::read(staged).unwrap(),b"new");
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn locked_destination_preserves_old_video_and_download_until_retry() {
        use std::os::windows::fs::OpenOptionsExt;
        let temp=tempfile::tempdir().unwrap();let (pool,songs)=pools().await;
        let config=test_config("http://127.0.0.1:1".into(),temp.path());
        let m=manifest(&config.api_base_url);let path=temp.path().join(&m.files[0].file_name);
        tokio::fs::write(&path,b"old-video!").await.unwrap();
        tokio::fs::create_dir_all(m.staging(&config)).await.unwrap();
        let staged=m.staging(&config).join(&m.files[0].file_name);
        tokio::fs::write(&staged,b"test-video").await.unwrap();
        sqlx::query("INSERT INTO songs(songNo,songName) VALUES('80000101','占用测试')").execute(&songs).await.unwrap();
        sqlx::query("INSERT INTO songSearch(songNo,songName,nameKey) VALUES('80000101','占用测试','占用测试')").execute(&songs).await.unwrap();
        let task=CloudService::create_download_task(&pool,"vodPackage",&m.package.id,&m.key(&config)).await.unwrap();
        let held=std::fs::OpenOptions::new().read(true).share_mode(1).open(&path).unwrap();
        let error=VodUpdateService::apply(&pool,&songs,&config,&task.id,&m).await.unwrap_err();
        assert!(error.to_string().contains("保存视频失败"));
        assert_eq!(tokio::fs::read(&path).await.unwrap(),b"old-video!");
        assert_eq!(tokio::fs::read(&staged).await.unwrap(),b"test-video");
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM songs WHERE fileExists=1").fetch_one(&songs).await.unwrap(),0);
        drop(held);
        VodUpdateService::apply(&pool,&songs,&config,&task.id,&m).await.unwrap();
        assert_eq!(tokio::fs::read(path).await.unwrap(),b"test-video");
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM local_available_songs").fetch_one(&songs).await.unwrap(),1);
        assert!(!m.staging(&config).exists());
        pool.close().await;songs.close().await;
    }
    #[tokio::test]
    async fn restart_uses_saved_prefix_and_range_validation_never_appends_wrong_bytes() {
        use axum::{body::Body,http::{HeaderMap,Response}};
        use std::sync::atomic::{AtomicUsize,Ordering};
        let temp=tempfile::tempdir().unwrap();let (pool,songs)=pools().await;
        let mode=Arc::new(AtomicUsize::new(0));let route_mode=mode.clone();
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config=test_config(format!("http://{}",listener.local_addr().unwrap()),temp.path());
        let m=manifest(&config.api_base_url);let file=&m.files[0];let staging=m.staging(&config);
        tokio::fs::create_dir_all(&staging).await.unwrap();
        let part=VodUpdateService::part_path(&staging,file);tokio::fs::write(&part,b"test-v").await.unwrap();
        let task=CloudService::create_download_task(&pool,"vodPackage",&m.package.id,&m.key(&config)).await.unwrap();
        let server=tokio::spawn(async move{axum::serve(listener,Router::new().route("/video",get(move |headers:HeaderMap|{
            let mode=route_mode.clone();async move {
                assert_eq!(headers.get("range").unwrap(),"bytes=6-");
                match mode.load(Ordering::SeqCst) {
                    0=>Response::builder().status(206).header("content-range","bytes 0-3/10").body(Body::from("test")).unwrap(),
                    1=>Response::builder().status(200).body(Body::from("test-video")).unwrap(),
                    _=>Response::builder().status(206).header("content-range","bytes 6-9/10").body(Body::from("ideo")).unwrap(),
                }
            }
        }))).await.unwrap()});
        let err=VodUpdateService::fetch_once(&pool,&task.id,&config,file,&staging,0).await.unwrap_err();
        assert!(!VodUpdateService::retryable(&err));assert_eq!(tokio::fs::read(&part).await.unwrap(),b"test-v");
        mode.store(1,Ordering::SeqCst);
        let path=VodUpdateService::fetch_once(&pool,&task.id,&config,file,&staging,0).await.unwrap();
        assert_eq!(tokio::fs::read(&path).await.unwrap(),b"test-video");
        tokio::fs::remove_file(&path).await.unwrap();tokio::fs::write(&part,b"test-v").await.unwrap();
        mode.store(2,Ordering::SeqCst);
        // Reconstruct all configuration and task identity as a process restart would.
        let restarted=test_config(config.api_base_url.clone(),temp.path());
        assert_eq!(VodUpdateService::cached_bytes(&restarted,&m).await.unwrap(),6);
        let path=VodUpdateService::fetch_once(&pool,"another-attempt",&restarted,file,&m.staging(&restarted),0).await.unwrap();
        assert_eq!(tokio::fs::read(&path).await.unwrap(),b"test-video");
        tokio::fs::remove_file(&path).await.unwrap();tokio::fs::write(&part,b"broken").await.unwrap();
        let err=VodUpdateService::fetch_once(&pool,&task.id,&config,file,&staging,0).await.unwrap_err();
        assert!(err.to_string().contains("SHA256"));assert!(!part.exists());
        server.abort();pool.close().await;songs.close().await;
    }
    #[tokio::test]
    async fn cached_files_survive_manifest_additions_and_disk_switch_but_not_content_changes() {
        let temp=tempfile::tempdir().unwrap();let old=test_config("http://localhost".into(),temp.path());
        let m=manifest(&old.api_base_url);let cache=m.staging(&old);tokio::fs::create_dir_all(&cache).await.unwrap();
        let part=VodUpdateService::part_path(&cache,&m.files[0]);tokio::fs::write(&part,b"test-v").await.unwrap();
        let mut changed=m.clone();changed.files[0].sha256=Some("0".repeat(64));
        assert_eq!(VodUpdateService::cached_bytes(&old,&changed).await.unwrap(),0);
        changed=m.clone();changed.package.version_code+=1;
        changed.files.push(PackageFile{file_name:"80000102.mp4".into(),sha256:Some("1".repeat(64)),..m.files[0].clone()});
        assert_eq!(VodUpdateService::cached_bytes(&old,&changed).await.unwrap(),6);
        let new=test_config(old.api_base_url.clone(),&temp.path().join("other-volume"));
        VodUpdateService::move_cache(&old,&new,&m).await.unwrap();
        assert_eq!(VodUpdateService::cached_bytes(&new,&m).await.unwrap(),6);
        assert_eq!(tokio::fs::read(VodUpdateService::part_path(&m.staging(&new),&m.files[0])).await.unwrap(),b"test-v");
    }
    #[test]
    fn transient_retry_backoff_is_capped_and_permanent_errors_stop() {
        assert!(VodUpdateService::retryable(&TransientDownload("offline").into()));
        assert!(!VodUpdateService::retryable(&anyhow::anyhow!("SHA256 mismatch")));
        assert!(!VodUpdateService::retryable(&anyhow::anyhow!("授权已到期")));
        assert_eq!((0..6).map(|n|VodUpdateService::retry_delay(n).as_secs()).collect::<Vec<_>>(),vec![5,10,20,40,60,60]);
    }
    fn manifest(base: &str) -> Manifest {
        Manifest { package: Package { id: "22dc5daf-6442-43c3-a90e-bff44232493a".into(), package_name:"test".into(), package_type:"incremental".into(),version_code:1,song_count:1 },
            files: vec![PackageFile { id:"f1".into(),file_role:"video".into(),file_name:"80000101.mp4".into(),download_url:format!("{base}/video"), file_size:10,sha256:Some(format!("{:x}",Sha256::digest(b"test-video"))) }] }
    }
    async fn wait_tasks(pool: &SqlitePool, tasks: &[SyncTask]) {
        tokio::time::timeout(Duration::from_secs(900),async {
            loop {
                let mut done = true;
                for task in tasks {
                    let t = CloudService::get_task(pool,&task.id).await.unwrap();
                    assert_ne!(t.status,3,"{}",t.error_message);
                    if t.status != 2 { done = false; }
                }
                if done && !VodUpdateService::is_updating() { break; }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }).await.unwrap();
    }
    #[test]
    fn runtime_config_requires_grant_and_checks_expiry() {
        let mut config = CloudConfig { update_mode: Default::default(), api_base_url:"http://localhost".into(), download_dir:"downloads".into(), api_key:String::new(), license_proof:String::new(), cloud_update_expires_at:None, config_path:Some("config.toml".into()) };
        assert!(VodUpdateService::ensure_authorized(&config).is_err());
        config.license_proof="synthetic-proof".into();
        config.cloud_update_expires_at=Some(chrono::Utc::now().timestamp()-1);
        assert!(VodUpdateService::ensure_authorized(&config).is_err());
        config.cloud_update_expires_at=Some(chrono::Utc::now().timestamp()+60);
        assert!(VodUpdateService::ensure_authorized(&config).is_ok());
    }
    #[test]
    fn vod_manifest_rejects_unsafe_files_and_detects_same_version_changes() {
        let config = CloudConfig { update_mode: Default::default(), license_proof: String::new(), cloud_update_expires_at: None, config_path: None,  api_base_url:"http://localhost:8080".into(),download_dir:"downloads".into(),api_key:String::new() };
        let good = manifest(&config.api_base_url);
        good.validate(&config).unwrap();
        for name in ["../bad.mp4","bad\\x.mp4","CON.mp4","bad:stream.mp4","bad.mp4.",".hidden.mp4"] {
            let mut bad = good.clone(); bad.files[0].file_name = name.into(); assert!(bad.validate(&config).is_err(),"{name}");
        }
        let mut bad = good.clone(); bad.files[0].download_url="http://other.example/video".into(); assert!(bad.validate(&config).is_err());
        bad = good.clone(); bad.files[0].sha256=None; assert!(bad.validate(&config).is_err());
        let mut changed = good.clone(); changed.files[0].sha256=Some("a".repeat(64)); assert_ne!(good.revision(),changed.revision());
        changed.files.push(PackageFile { id:"f2".into(),file_name:"80000102.mp4".into(),..good.files[0].clone() });
        let revision=changed.revision(); changed.files.reverse(); assert_eq!(revision,changed.revision());
    }
    #[tokio::test]
    async fn vod_download_checks_hash_before_registering_and_preserves_old_songs() {
        let temp = tempfile::tempdir().unwrap();
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base=format!("http://{}",listener.local_addr().unwrap());
        let mut m=manifest(&base);
        m.package.package_type="video".into();
        let catalog=Arc::new(tokio::sync::RwLock::new(vec![m.clone()]));
        let state=catalog.clone();
        let server=tokio::spawn(async move { axum::serve(listener,Router::new()
            .route("/video",get(|| async { "test-video" }))
            .route("/api/vod-updates/catalog",get(move || { let state=state.clone(); async move { Json(serde_json::json!({"code":0,"data":*state.read().await})) } }))).await.unwrap(); });
        let config=CloudConfig { update_mode: Default::default(), license_proof: String::new(), cloud_update_expires_at: None, config_path: None,  api_base_url:base,download_dir:temp.path().to_string_lossy().into_owned(),api_key:String::new() };
        let (pool,songs)=pools().await;
        sqlx::query("INSERT INTO songs (songNo,songName,fileExists,absolutePath) VALUES ('old','Old',1,'D:/old.mp4'),('80000101','New',0,NULL)").execute(&songs).await.unwrap();
        sqlx::query("INSERT INTO songSearch(songNo,songName,nameKey) VALUES ('80000101','New','New')").execute(&songs).await.unwrap();
        // Upgrade an existing nested download without downloading the video again.
        let legacy=temp.path().join(&m.package.id).join(m.revision());
        tokio::fs::create_dir_all(&legacy).await.unwrap();
        tokio::fs::write(legacy.join("80000101.mp4"),b"test-video").await.unwrap();
        // An unrelated video must not be scanned or published into this package's index.
        tokio::fs::write(temp.path().join("99999999.mp4"),b"unrelated").await.unwrap();
        let tasks=VodUpdateService::start(pool.clone(),songs.clone(),config.clone()).await.unwrap();
        assert_eq!(tasks.len(),1);
        assert!(VodUpdateService::start(pool.clone(),songs.clone(),config.clone()).await.is_err());
        wait_tasks(&pool,&tasks).await;
        assert!(temp.path().join("80000101.mp4").is_file());
        assert!(!legacy.exists());
        let new_query:crate::models::song_db_models::SongSearchQuery=serde_json::from_value(serde_json::json!({"categoryCode":"1","keyword":"80000101"})).unwrap();
        let new_songs=crate::services::song_db_service::SongDbService::search_songs(&songs,new_query).await.unwrap();
        assert_eq!(new_songs.total,1);
        let added_time:i64=sqlx::query_scalar("SELECT addedTime FROM songs WHERE songNo='80000101'").fetch_one(&songs).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT fileExists FROM songs WHERE songNo='80000101'").fetch_one(&songs).await.unwrap(),1);
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT absolutePath FROM songs WHERE songNo='old'").fetch_one(&songs).await.unwrap(),"D:/old.mp4");
        assert!(VodUpdateService::views(&pool,&songs,&config).await.unwrap()[0].installed);
        let mut changed_directory=config.clone();
        changed_directory.download_dir=temp.path().join("another-drive").to_string_lossy().into_owned();
        assert!(VodUpdateService::views(&pool,&songs,&changed_directory).await.unwrap()[0].installed);

        sqlx::query("DELETE FROM local_available_songs WHERE songNo='80000101'").execute(&songs).await.unwrap();
        assert!(!VodUpdateService::views(&pool,&songs,&config).await.unwrap()[0].installed);
        let repaired=VodUpdateService::start(pool.clone(),songs.clone(),config.clone()).await.unwrap();
        wait_tasks(&pool,&repaired).await;
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT addedTime FROM songs WHERE songNo='80000101'").fetch_one(&songs).await.unwrap(),added_time);
        assert!(VodUpdateService::views(&pool,&songs,&config).await.unwrap()[0].installed);
        assert!(VodUpdateService::start(pool.clone(),songs.clone(),config.clone()).await.unwrap().is_empty());
        while VodUpdateService::is_updating() { tokio::time::sleep(Duration::from_millis(10)).await; }
        // Restart recovery in manual mode resumes only previously requested packages.
        tokio::fs::remove_file(m.folder(&config).join("80000101.mp4")).await.unwrap();
        sqlx::query("UPDATE sync_tasks SET status=3,errorMessage='服务器重启导致下载中断，等待自动续传' WHERE id=?")
            .bind(&repaired[0].id).execute(&pool).await.unwrap();
        let mut unrelated=m.clone();unrelated.package.id=uuid::Uuid::new_v4().to_string();
        catalog.write().await.push(unrelated);
        let recovered=VodUpdateService::resume_interrupted(pool.clone(),songs.clone(),config.clone()).await.unwrap();
        assert_eq!(recovered.len(),1);assert_eq!(recovered[0].target_id,m.package.id);
        wait_tasks(&pool,&recovered).await;
        catalog.write().await.truncate(1);
        // Same version, added video: it must be offered again.
        let mut changed=m.clone();
        changed.files.push(PackageFile { id:"f2".into(),file_name:"80000102.mp4".into(),..m.files[0].clone() });
        catalog.write().await[0]=changed.clone();
        assert!(!VodUpdateService::views(&pool,&songs,&config).await.unwrap()[0].installed);
        // Corrupt metadata must never become a registered playable file.
        changed.files[1].sha256=Some("0".repeat(64));
        let task=CloudService::create_download_task(&pool,"vodPackage","bad","bad").await.unwrap();
        let error=VodUpdateService::apply(&pool,&songs,&config,&task.id,&changed).await.unwrap_err();
        assert!(error.to_string().contains("SHA256"));
        assert!(!changed.folder(&config).join("80000102.mp4").exists());
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM local_available_songs").fetch_one(&songs).await.unwrap(),1);
        // A video-only package resolves against existing local source data; no XLSX is required.
        changed.files[1].sha256=m.files[0].sha256.clone();
        let missing=VodUpdateService::apply(&pool,&songs,&config,&task.id,&changed).await.unwrap_err();
        assert!(missing.to_string().contains("没有对应的歌曲资料"));
        assert!(!changed.folder(&config).join("80000102.mp4").exists());
        // Missing on-disk files are offered again even when the ledger says completed.
        tokio::fs::remove_file(m.folder(&config).join("80000101.mp4")).await.unwrap();
        assert!(!VodUpdateService::installed(&pool,&songs,&config,&m).await.unwrap());
        server.abort(); pool.close().await; songs.close().await;
    }
    #[tokio::test]
    async fn cloud_encrypted_video_registration_enables_scoring() {
        let temp=tempfile::tempdir().unwrap();
        let config=CloudConfig { update_mode: Default::default(), license_proof: String::new(), cloud_update_expires_at: None, config_path: None, api_base_url:"http://localhost:8080".into(),download_dir:temp.path().to_string_lossy().into_owned(),api_key:String::new()};
        let (pool,songs)=pools().await;
        sqlx::query("INSERT INTO songs(songNo,songName,scoreEnabled) VALUES ('80000101','Encrypted',0)").execute(&songs).await.unwrap();
        sqlx::query("INSERT INTO songSearch(songNo,songName,nameKey) VALUES ('80000101','Encrypted','Encrypted')").execute(&songs).await.unwrap();
        let bytes=crate::utils::media_encryption::test_video(true);
        let mut m=manifest(&config.api_base_url);
        m.files[0].file_name="80000101.hvideo".into();
        m.files[0].file_size=bytes.len() as i64;
        m.files[0].sha256=Some(format!("{:x}",Sha256::digest(&bytes)));
        tokio::fs::write(temp.path().join(&m.files[0].file_name),bytes).await.unwrap();
        let task=CloudService::create_download_task(&pool,"vodPackage",&m.package.id,&m.key(&config)).await.unwrap();
        VodUpdateService::apply(&pool,&songs,&config,&task.id,&m).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,i32>("SELECT scoreEnabled FROM songs WHERE songNo='80000101'").fetch_one(&songs).await.unwrap(),1);
        sqlx::query("INSERT INTO rooms(id,name) VALUES ('score-room','Score test')").execute(&pool).await.unwrap();
        let queued=crate::services::room_service::RoomService::add_to_queue(&pool,&songs,"score-room",crate::models::room::AddToQueueRequest {songId:"80000101".into(),isPriority:None}).await.unwrap();
        assert_eq!(queued.score_enabled,1);
        pool.close().await; songs.close().await;
    }

    #[tokio::test]
    #[ignore = "Downloads the real published cloud package into isolated temporary databases"]
    async fn vod_real_published_package_end_to_end() {
        let temp=tempfile::Builder::new().prefix("hvideo-vod-e2e-").tempdir().unwrap();
        let config=CloudConfig { update_mode: Default::default(), license_proof: String::new(), cloud_update_expires_at: None, config_path: None,  api_base_url:"http://60.205.127.117:8080".into(),download_dir:temp.path().join("downloads").to_string_lossy().into_owned(),api_key:String::new() };
        let (pool,songs)=pools().await;
        let tasks=VodUpdateService::start(pool.clone(),songs.clone(),config.clone()).await.unwrap();
        assert!(!tasks.is_empty()); wait_tasks(&pool,&tasks).await;
        let row=sqlx::query("SELECT songName,primarySingerName,fileExists,absolutePath FROM songs WHERE songNo='80000101'").fetch_one(&songs).await.unwrap();
        assert_eq!(row.get::<String,_>("songName"),"三十岁的女人(人物)");
        assert_eq!(row.get::<String,_>("primarySingerName"),"Zhao Lei");
        assert_eq!(row.get::<i64,_>("fileExists"),1);
        let path=row.get::<String,_>("absolutePath"); assert!(Path::new(&path).is_file());
        assert_eq!(Path::new(&path).parent().unwrap(),Path::new(&config.download_dir));
        // Exercise the public query and media handlers using the actual updated databases.
        use axum::{body::{Body,to_bytes},http::{Request,StatusCode}};
        use tower::ServiceExt;
        let app=crate::api::system_handler::media_file_tests::media_app_with_pools(temp.path(),pool.clone(),songs.clone()).await;
        for query in ["songNoPrefix=80000101", "keyword=80000101", "categoryCode=1&keyword=80000101", "keyword=%E4%B8%89%E5%8D%81"] {
            let result=app.clone().oneshot(Request::builder().uri(format!("/api/v1/songdb/songs?{query}&availableOnly=true")).body(Body::empty()).unwrap()).await.unwrap();
            assert_eq!(result.status(),StatusCode::OK);
            let body:serde_json::Value=serde_json::from_slice(&to_bytes(result.into_body(),1024*1024).await.unwrap()).unwrap();
            assert_eq!(body["data"]["items"][0]["songNo"],"80000101","{query}");
        }
        sqlx::query("INSERT INTO rooms(id,name) VALUES ('vod-e2e','isolated test')").execute(&pool).await.unwrap();
        let queue=crate::services::room_service::RoomService::add_to_queue(&pool,&songs,"vod-e2e",crate::models::room::AddToQueueRequest {songId:"80000101".into(),isPriority:None}).await.unwrap();
        assert_eq!(queue.relativePath,path);
        let media_url=crate::utils::media_path::public_media_url(&queue.relativePath,"");
        let result=app.oneshot(Request::builder().uri(&media_url).header("Range","bytes=0-31").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(result.status(),StatusCode::PARTIAL_CONTENT,"{media_url}");
        assert_eq!(to_bytes(result.into_body(),32).await.unwrap().len(),32);
        let count: i64=sqlx::query_scalar("SELECT COUNT(*) FROM songs").fetch_one(&songs).await.unwrap();
        let available:i64=sqlx::query_scalar("SELECT COUNT(*) FROM local_available_songs").fetch_one(&songs).await.unwrap();
        println!("REAL CLOUD PASS: catalog songs={count}, playable videos={available}, title={}, singer={}",row.get::<String,_>("songName"),row.get::<String,_>("primarySingerName"));
        assert!(count>=1); assert!(available>=1);
        assert!(VodUpdateService::views(&pool,&songs,&config).await.unwrap().iter().all(|p|p.installed));
        pool.close().await; songs.close().await; temp.close().unwrap();
    }
}
