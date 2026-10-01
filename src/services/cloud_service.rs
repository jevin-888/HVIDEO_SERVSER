use futures::StreamExt;
use reqwest::{header, redirect, Client, StatusCode, Url};
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::time::Instant;
use uuid::Uuid;

use crate::config::CloudConfig;
use crate::errors::{AppError, AppResult};
use crate::models::sync_task::*;

pub struct CloudService;

impl CloudService {
    pub(crate) fn validate_config(config: &CloudConfig) -> AppResult<Url> {
        let base = config.api_base_url.trim();
        if base.is_empty() || base.contains("example.com") {
            return Err(AppError::BadRequest(
                "云端服务尚未配置，请点击云端配置，填写服务器地址并保存".to_string(),
            ));
        }
        if config.download_dir.trim().is_empty() {
            return Err(AppError::BadRequest(
                "云端下载目录 download_dir 不能为空".to_string(),
            ));
        }
        if Self::is_placeholder_api_key(&config.api_key) {
            return Err(AppError::BadRequest(
                "云端 API Key 仍是占位值，请配置真实 api_key；无需鉴权时请留空".to_string(),
            ));
        }

        let url = Url::parse(base)
            .map_err(|e| AppError::BadRequest(format!("云端 API 地址无效: {e}")))?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(AppError::BadRequest(
                "云端地址必须是 HTTP 或 HTTPS 地址，不能包含账号、查询参数或片段".to_string(),
            ));
        }
        Ok(url)
    }

    fn is_placeholder_api_key(api_key: &str) -> bool {
        matches!(
            api_key.trim().to_ascii_lowercase().as_str(),
            "your-cloud-api-key-here" | "changeme" | "change-me" | "placeholder"
        )
    }

    fn same_origin(left: &Url, right: &Url) -> bool {
        left.scheme() == right.scheme()
            && left.host_str() == right.host_str()
            && left.port_or_known_default() == right.port_or_known_default()
    }

    pub(crate) fn http_client() -> anyhow::Result<Client> {
        let redirect_policy = redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("云端重定向次数过多");
            }
            let Some(initial) = attempt.previous().first() else {
                return attempt.stop();
            };
            if CloudService::same_origin(initial, attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("云端重定向到不同来源，已拒绝")
            }
        });
        Ok(Client::builder()
            // Do not inherit ambient HTTP proxy settings for local/LAN service traffic.
            // They break loopback integration tests and can redirect private downloads.
            .no_proxy()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(30 * 60))
            .redirect(redirect_policy)
            .build()?)
    }

    fn authorized_get(client: &Client, url: Url, api_key: &str) -> reqwest::RequestBuilder {
        let request = client.get(url);
        if api_key.trim().is_empty() {
            request
        } else {
            request.bearer_auth(api_key.trim())
        }
    }

    pub async fn check_status(config: &CloudConfig) -> CloudStatus {
        let api_base_url = config.api_base_url.trim().to_string();
        let download_dir = config.download_dir.trim().to_string();
        let api_key_configured =
            !config.api_key.trim().is_empty() && !Self::is_placeholder_api_key(&config.api_key);

        let base_url = match Self::validate_config(config) {
            Ok(url) => url,
            Err(err) => {
                return CloudStatus {
                    configured: false,
                    reachable: false,
                    api_base_url,
                    download_dir,
                    api_key_configured,
                    importable_song_count: 0,
                    message: err.to_string(),
                }
            }
        };

        let client = match Self::http_client() {
            Ok(client) => client,
            Err(err) => {
                return CloudStatus {
                    configured: true,
                    reachable: false,
                    api_base_url,
                    download_dir,
                    api_key_configured,
                    importable_song_count: 0,
                    message: format!("创建云端 HTTP 客户端失败: {err}"),
                }
            }
        };

        // The deployed license/VOD service exposes its probe at /health.
        let probe_url = if base_url.path() == "/" {
            base_url.join("health").expect("validated HTTP base URL")
        } else {
            base_url
        };
        match Self::authorized_get(&client, probe_url, &config.api_key)
            .timeout(Duration::from_secs(10))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => CloudStatus {
                configured: true,
                reachable: true,
                api_base_url,
                download_dir,
                api_key_configured,
                importable_song_count: 0,
                message: format!("云端服务器可连接（HTTP {}）", response.status()),
            },
            Ok(response) => CloudStatus {
                configured: true,
                reachable: false,
                api_base_url,
                download_dir,
                api_key_configured,
                importable_song_count: 0,
                message: format!("云端服务器返回不可用状态 {}", response.status()),
            },
            Err(err) => CloudStatus {
                configured: true,
                reachable: false,
                api_base_url,
                download_dir,
                api_key_configured,
                importable_song_count: 0,
                message: format!("无法连接云端服务器: {err}"),
            },
        }
    }

    pub async fn count_importable_songs(pool: &SqlitePool) -> AppResult<u64> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM songs WHERE TRIM(COALESCE(cloudFileId, '')) <> ''",
        )
        .fetch_one(pool)
        .await?;
        Ok(count.max(0) as u64)
    }

    pub async fn recover_interrupted_tasks(pool: &SqlitePool) -> AppResult<u64> {
        let result = sqlx::query(
            "UPDATE sync_tasks
             SET status = ?, errorMessage = CASE WHEN targetType = 'vodPackage' THEN '服务器重启导致下载中断，等待自动续传' ELSE '服务器重启导致下载中断，可点击重试继续下载' END,
                 updatedAt = datetime('now','localtime')
             WHERE status = ? OR (targetType = 'vodPackage' AND status = 0)",
        )
        .bind(SYNC_STATUS_FAILED)
        .bind(SYNC_STATUS_RUNNING)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn create_download_task(
        pool: &SqlitePool,
        target_type: &str,
        target_id: &str,
        cloud_url: &str,
    ) -> AppResult<SyncTask> {
        let id = Uuid::new_v4().to_string();
        let inserted = sqlx::query(
            "INSERT OR IGNORE INTO sync_tasks
             (id, taskType, targetType, targetId, cloud_url, status)
             VALUES (?, 'download', ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(target_type)
        .bind(target_id)
        .bind(cloud_url)
        .bind(SYNC_STATUS_PENDING)
        .execute(pool)
        .await?;

        if inserted.rows_affected() == 1 {
            return Self::get_task(pool, &id).await;
        }

        sqlx::query_as::<_, SyncTask>(
            "SELECT * FROM sync_tasks
             WHERE taskType = 'download' AND targetType = ? AND targetId = ? AND cloud_url = ?
               AND status IN (?, ?)
             ORDER BY createdAt DESC LIMIT 1",
        )
        .bind(target_type)
        .bind(target_id)
        .bind(cloud_url)
        .bind(SYNC_STATUS_PENDING)
        .bind(SYNC_STATUS_RUNNING)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Conflict("相同歌曲的云端下载任务已存在".to_string()))
    }

    pub async fn get_task(pool: &SqlitePool, task_id: &str) -> AppResult<SyncTask> {
        sqlx::query_as::<_, SyncTask>("SELECT * FROM sync_tasks WHERE id = ?")
            .bind(task_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("同步任务不存在".to_string()))
    }

    /// 原子领取任务，防止按钮连点或并发请求重复下载同一个任务。
    pub async fn claim_download_task(
        pool: &SqlitePool,
        config: &CloudConfig,
        task_id: &str,
    ) -> AppResult<SyncTask> {
        Self::validate_config(config)?;
        let current = Self::get_task(pool, task_id).await?;
        if current.task_type != "download" {
            return Err(AppError::BadRequest("该任务不是下载任务".to_string()));
        }

        let result = sqlx::query(
            "UPDATE sync_tasks
             SET status = ?, errorMessage = '', updatedAt = datetime('now','localtime')
             WHERE id = ? AND status IN (?, ?)",
        )
        .bind(SYNC_STATUS_RUNNING)
        .bind(task_id)
        .bind(SYNC_STATUS_PENDING)
        .bind(SYNC_STATUS_FAILED)
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return match current.status {
                SYNC_STATUS_RUNNING => Err(AppError::Conflict("下载任务正在执行中".to_string())),
                SYNC_STATUS_COMPLETED => Err(AppError::Conflict("下载任务已经完成".to_string())),
                _ => Err(AppError::Conflict("下载任务当前状态不可执行".to_string())),
            };
        }

        Self::get_task(pool, task_id).await
    }

    pub async fn execute_claimed_download(
        pool: &SqlitePool,
        config: &CloudConfig,
        task: SyncTask,
    ) -> AppResult<()> {
        let result = Self::download_and_commit(pool, config, &task).await;
        if let Err(err) = result {
            let message = err.to_string();
            if let Err(update_err) = sqlx::query(
                "UPDATE sync_tasks
                 SET status = ?, errorMessage = ?, retry_count = retry_count + 1,
                     updatedAt = datetime('now','localtime')
                 WHERE id = ?",
            )
            .bind(SYNC_STATUS_FAILED)
            .bind(&message)
            .bind(&task.id)
            .execute(pool)
            .await
            {
                tracing::error!(
                    "记录云端下载失败状态失败 taskId={}: {}",
                    task.id,
                    update_err
                );
            }
            return Err(AppError::Internal(err));
        }
        Ok(())
    }

    async fn download_and_commit(
        pool: &SqlitePool,
        config: &CloudConfig,
        task: &SyncTask,
    ) -> anyhow::Result<()> {
        let download_url = Self::resolve_download_url(config, &task.cloud_url)?;
        let download_dir = PathBuf::from(config.download_dir.trim());
        tokio::fs::create_dir_all(&download_dir).await?;

        let extension = Path::new(download_url.path())
            .extension()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty() && value.len() <= 12)
            .map(|value| format!(".{value}"))
            .unwrap_or_default();
        let safe_target = Self::safe_file_component(&task.target_id);
        let short_task_id = task.id.get(..8).unwrap_or(&task.id);
        let final_path = download_dir.join(format!("{safe_target}_{short_task_id}{extension}"));
        let part_path = final_path.with_extension(format!(
            "{}part",
            final_path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| format!("{value}."))
                .unwrap_or_default()
        ));

        let file_size =
            Self::download_file(pool, &task.id, download_url, &part_path, &config.api_key).await?;

        if tokio::fs::try_exists(&final_path).await? {
            tokio::fs::remove_file(&final_path).await?;
        }
        tokio::fs::rename(&part_path, &final_path).await?;

        let final_path_text = final_path.to_string_lossy().to_string();
        let mut tx = pool.begin().await?;
        if task.target_type == "song" {
            let updated = sqlx::query(
                "UPDATE songs SET filePath = ?, fileSize = ?, status = 1,
                 updatedAt = datetime('now','localtime') WHERE id = ?",
            )
            .bind(&final_path_text)
            .bind(file_size)
            .bind(&task.target_id)
            .execute(&mut *tx)
            .await?;
            if updated.rows_affected() != 1 {
                anyhow::bail!("下载完成但目标歌曲不存在: {}", task.target_id);
            }
        }

        sqlx::query(
            "UPDATE sync_tasks
             SET status = ?, localPath = ?, fileSize = ?, downloaded_size = ?, errorMessage = '',
                 updatedAt = datetime('now','localtime') WHERE id = ?",
        )
        .bind(SYNC_STATUS_COMPLETED)
        .bind(&final_path_text)
        .bind(file_size)
        .bind(file_size)
        .bind(&task.id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        tracing::info!(
            "云端下载完成 taskId={} targetId={} bytes={} path={}",
            task.id,
            task.target_id,
            file_size,
            final_path_text
        );
        Ok(())
    }

    fn resolve_download_url(config: &CloudConfig, cloud_file_id: &str) -> anyhow::Result<Url> {
        let mut base = Self::validate_config(config).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let value = cloud_file_id.trim();
        if value.is_empty() {
            anyhow::bail!("歌曲没有云端文件 ID");
        }

        if value.starts_with("http://") || value.starts_with("https://") {
            let url = Url::parse(value)?;
            let same_origin = url.scheme() == base.scheme()
                && url.host_str() == base.host_str()
                && url.port_or_known_default() == base.port_or_known_default();
            if !same_origin {
                anyhow::bail!("云端文件地址与配置的云端服务器不是同一来源");
            }
            return Ok(url);
        }

        if !base.path().ends_with('/') {
            let path = format!("{}/", base.path());
            base.set_path(&path);
        }
        {
            let mut segments = base
                .path_segments_mut()
                .map_err(|_| anyhow::anyhow!("云端 API 地址不能作为下载基础地址"))?;
            segments.pop_if_empty();
            segments.push("files");
            segments.push(value);
        }
        Ok(base)
    }

    fn safe_file_component(value: &str) -> String {
        let cleaned: String = value
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                    ch
                } else {
                    '_'
                }
            })
            .take(80)
            .collect();
        if cleaned.is_empty() {
            "cloud_file".to_string()
        } else {
            cleaned
        }
    }

    async fn download_file(
        pool: &SqlitePool,
        task_id: &str,
        url: Url,
        part_path: &Path,
        api_key: &str,
    ) -> anyhow::Result<i64> {
        let client = Self::http_client()?;
        let mut downloaded = if tokio::fs::try_exists(part_path).await? {
            tokio::fs::metadata(part_path).await?.len()
        } else {
            0
        };

        for attempt in 0..2 {
            let mut request = Self::authorized_get(&client, url.clone(), api_key);
            if downloaded > 0 {
                request = request.header(header::RANGE, format!("bytes={downloaded}-"));
            }

            let response = request.send().await?;
            let status = response.status();
            if status == StatusCode::RANGE_NOT_SATISFIABLE && downloaded > 0 && attempt == 0 {
                tokio::fs::remove_file(part_path).await?;
                downloaded = 0;
                continue;
            }
            if status != StatusCode::OK && status != StatusCode::PARTIAL_CONTENT {
                anyhow::bail!("下载失败，HTTP 状态码: {status}");
            }

            let mut append = downloaded > 0 && status == StatusCode::PARTIAL_CONTENT;
            if append {
                let range_start = Self::content_range_start(
                    response
                        .headers()
                        .get(header::CONTENT_RANGE)
                        .and_then(|value| value.to_str().ok()),
                )?;
                if range_start != downloaded {
                    anyhow::bail!(
                        "云端断点响应起始位置错误，期望 {downloaded}，实际 {range_start}"
                    );
                }
            } else if downloaded > 0 {
                // 服务器忽略 Range 并返回 200 时必须覆盖，不能把完整文件追加到旧分片。
                downloaded = 0;
                append = false;
            }

            let expected_total = if status == StatusCode::PARTIAL_CONTENT {
                Self::content_range_total(
                    response
                        .headers()
                        .get(header::CONTENT_RANGE)
                        .and_then(|value| value.to_str().ok()),
                )?
            } else {
                response.content_length()
            };

            let mut options = tokio::fs::OpenOptions::new();
            options.create(true).write(true);
            if append {
                options.append(true);
            } else {
                options.truncate(true);
            }
            let mut file = options.open(part_path).await?;
            let mut current = downloaded;
            let mut last_reported = current;
            let mut last_report_at = Instant::now();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk?;
                file.write_all(&chunk).await?;
                current = current.saturating_add(chunk.len() as u64);
                if current.saturating_sub(last_reported) >= 1024 * 1024
                    || last_report_at.elapsed() >= Duration::from_secs(1)
                {
                    Self::update_progress(pool, task_id, current, expected_total).await;
                    last_reported = current;
                    last_report_at = Instant::now();
                }
            }
            file.flush().await?;
            file.sync_all().await?;

            if let Some(expected) = expected_total {
                if current != expected {
                    anyhow::bail!(
                        "下载文件大小校验失败，期望 {expected} 字节，实际 {current} 字节"
                    );
                }
            }
            Self::update_progress(pool, task_id, current, expected_total).await;
            return i64::try_from(current).map_err(|_| anyhow::anyhow!("下载文件过大"));
        }

        anyhow::bail!("断点下载恢复失败")
    }

    fn content_range_start(value: Option<&str>) -> anyhow::Result<u64> {
        let value = value.ok_or_else(|| anyhow::anyhow!("云端 206 响应缺少 Content-Range"))?;
        let range = value
            .strip_prefix("bytes ")
            .and_then(|value| value.split('/').next())
            .ok_or_else(|| anyhow::anyhow!("无效的 Content-Range: {value}"))?;
        range
            .split('-')
            .next()
            .ok_or_else(|| anyhow::anyhow!("无效的 Content-Range: {value}"))?
            .parse::<u64>()
            .map_err(|_| anyhow::anyhow!("无效的 Content-Range: {value}"))
    }

    fn content_range_total(value: Option<&str>) -> anyhow::Result<Option<u64>> {
        let value = value.ok_or_else(|| anyhow::anyhow!("云端 206 响应缺少 Content-Range"))?;
        let total = value
            .split('/')
            .nth(1)
            .ok_or_else(|| anyhow::anyhow!("无效的 Content-Range: {value}"))?;
        if total == "*" {
            Ok(None)
        } else {
            Ok(Some(total.parse::<u64>().map_err(|_| {
                anyhow::anyhow!("无效的 Content-Range: {value}")
            })?))
        }
    }

    async fn update_progress(
        pool: &SqlitePool,
        task_id: &str,
        downloaded: u64,
        expected_total: Option<u64>,
    ) {
        let result = sqlx::query(
            "UPDATE sync_tasks
             SET downloaded_size = ?, fileSize = CASE WHEN ? > 0 THEN ? ELSE fileSize END,
                 updatedAt = datetime('now','localtime')
             WHERE id = ? AND status = ?",
        )
        .bind(i64::try_from(downloaded).unwrap_or(i64::MAX))
        .bind(expected_total.unwrap_or(0) as i64)
        .bind(expected_total.unwrap_or(0) as i64)
        .bind(task_id)
        .bind(SYNC_STATUS_RUNNING)
        .execute(pool)
        .await;
        if let Err(err) = result {
            tracing::warn!("更新云端下载进度失败 taskId={task_id}: {err}");
        }
    }

    pub async fn batch_import(
        pool: &SqlitePool,
        config: &CloudConfig,
        song_ids: Vec<String>,
    ) -> AppResult<Vec<SyncTask>> {
        Self::validate_config(config)?;
        let mut seen = HashSet::new();
        let song_ids: Vec<String> = song_ids
            .into_iter()
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty() && seen.insert(id.clone()))
            .collect();

        if song_ids.is_empty() {
            return Err(AppError::BadRequest("至少需要一个歌曲 ID".to_string()));
        }
        if song_ids.len() > 100 {
            return Err(AppError::BadRequest(
                "单次最多创建 100 个云端下载任务".to_string(),
            ));
        }

        let mut cloud_files = Vec::with_capacity(song_ids.len());
        let mut invalid = Vec::new();
        for song_id in &song_ids {
            let song = sqlx::query_as::<_, (String,)>("SELECT cloudFileId FROM songs WHERE id = ?")
                .bind(song_id)
                .fetch_optional(pool)
                .await?;
            match song {
                Some((cloud_file_id,)) if !cloud_file_id.trim().is_empty() => {
                    cloud_files.push((song_id.clone(), cloud_file_id));
                }
                _ => invalid.push(song_id.clone()),
            }
        }

        if !invalid.is_empty() {
            let shown = invalid
                .iter()
                .take(10)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ");
            let suffix = if invalid.len() > 10 { " 等" } else { "" };
            return Err(AppError::BadRequest(format!(
                "以下歌曲不存在或没有 cloudFileId: {shown}{suffix}"
            )));
        }

        let mut tasks = Vec::with_capacity(cloud_files.len());
        for (song_id, cloud_file_id) in cloud_files {
            tasks.push(Self::create_download_task(pool, "song", &song_id, &cloud_file_id).await?);
        }

        let pool_clone = pool.clone();
        let config_clone = config.clone();
        let task_ids: Vec<String> = tasks
            .iter()
            .filter(|task| task.status == SYNC_STATUS_PENDING)
            .map(|task| task.id.clone())
            .collect();
        tokio::spawn(async move {
            for task_id in task_ids {
                match Self::claim_download_task(&pool_clone, &config_clone, &task_id).await {
                    Ok(task) => {
                        if let Err(err) =
                            Self::execute_claimed_download(&pool_clone, &config_clone, task).await
                        {
                            tracing::error!("云端下载任务执行失败 taskId={task_id}: {err:?}");
                        }
                    }
                    Err(err) => {
                        tracing::warn!("云端下载任务未领取 taskId={task_id}: {err}");
                    }
                }
            }
        });

        Ok(tasks)
    }

    pub async fn list_tasks(pool: &SqlitePool, query: SyncTaskQuery) -> AppResult<SyncTaskList> {
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(20).clamp(1, 100);
        let offset = i64::from(page.saturating_sub(1)) * i64::from(page_size);

        if let Some(task_type) = query.task_type.as_deref() {
            if !matches!(task_type, "download" | "upload") {
                return Err(AppError::BadRequest("taskType 参数无效".to_string()));
            }
        }
        if let Some(status) = query.status {
            if !(SYNC_STATUS_PENDING..=SYNC_STATUS_FAILED).contains(&status) {
                return Err(AppError::BadRequest("status 参数无效".to_string()));
            }
        }

        let items = sqlx::query_as::<_, SyncTask>(
            "SELECT * FROM sync_tasks
             WHERE (? IS NULL OR taskType = ?)
               AND (? IS NULL OR status = ?)
             ORDER BY datetime(createdAt) DESC, id DESC
             LIMIT ? OFFSET ?",
        )
        .bind(query.task_type.as_deref())
        .bind(query.task_type.as_deref())
        .bind(query.status)
        .bind(query.status)
        .bind(page_size)
        .bind(offset)
        .fetch_all(pool)
        .await?;

        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_tasks
             WHERE (? IS NULL OR taskType = ?)
               AND (? IS NULL OR status = ?)",
        )
        .bind(query.task_type.as_deref())
        .bind(query.task_type.as_deref())
        .bind(query.status)
        .bind(query.status)
        .fetch_one(pool)
        .await?;

        let (pending, running, completed, failed) = sqlx::query_as::<_, (i64, i64, i64, i64)>(
            "SELECT
                COALESCE(SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END), 0)
             FROM sync_tasks",
        )
        .fetch_one(pool)
        .await?;

        Ok(SyncTaskList {
            items,
            total: total.max(0) as u64,
            page,
            page_size,
            pending: pending.max(0) as u64,
            running: running.max(0) as u64,
            completed: completed.max(0) as u64,
            failed: failed.max(0) as u64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::State,
        http::{header as axum_header, HeaderMap, HeaderValue},
        response::{IntoResponse, Redirect},
        routing::get,
        Router,
    };
    use sqlx::sqlite::SqlitePoolOptions;
    use std::sync::Arc;
    use tempfile::TempDir;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE songs (
                id TEXT PRIMARY KEY,
                cloudFileId TEXT NOT NULL DEFAULT '',
                filePath TEXT NOT NULL DEFAULT '',
                fileSize INTEGER NOT NULL DEFAULT 0,
                status INTEGER NOT NULL DEFAULT 1,
                updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );
            CREATE TABLE sync_tasks (
                id TEXT PRIMARY KEY,
                taskType TEXT NOT NULL,
                targetType TEXT NOT NULL,
                targetId TEXT NOT NULL,
                cloud_url TEXT NOT NULL DEFAULT '',
                localPath TEXT NOT NULL DEFAULT '',
                fileSize INTEGER NOT NULL DEFAULT 0,
                downloaded_size INTEGER NOT NULL DEFAULT 0,
                status INTEGER NOT NULL DEFAULT 0,
                retry_count INTEGER NOT NULL DEFAULT 0,
                errorMessage TEXT NOT NULL DEFAULT '',
                createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );
            CREATE UNIQUE INDEX idx_sync_tasks_active_target
            ON sync_tasks(taskType, targetType, targetId, cloud_url)
            WHERE status IN (0, 1);",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn spawn_mock_cloud(data: Vec<u8>) -> (String, tokio::task::JoinHandle<()>) {
        async fn root() -> &'static str {
            "ok"
        }
        async fn file(State(data): State<Arc<Vec<u8>>>) -> Vec<u8> {
            // 故意忽略 Range 并始终返回 200，验证客户端不会把完整文件追加到旧分片。
            data.as_ref().clone()
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .route("/api/v1", get(root))
            .route("/api/v1/files/asset.mp4", get(file))
            .with_state(Arc::new(data));
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}/api/v1"), handle)
    }

    #[tokio::test]
    async fn deployed_vod_server_root_uses_health_and_same_origin_file_urls() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route("/health", get(|| async { "OK" }));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let config = CloudConfig { update_mode: Default::default(), license_proof: String::new(), cloud_update_expires_at: None, config_path: None, 
            api_base_url: format!("http://{address}"),
            api_key: String::new(),
            download_dir: "./downloads".into(),
        };
        assert!(CloudService::check_status(&config).await.reachable);
        let url = format!("http://{address}/vod-updates/uuid/song.mp4");
        assert_eq!(
            CloudService::resolve_download_url(&config, &url)
                .unwrap()
                .as_str(),
            url
        );
        assert!(
            CloudService::resolve_download_url(&config, "https://other.example/video.mp4").is_err()
        );
        server.abort();
    }

    async fn spawn_range_cloud(data: Vec<u8>) -> (String, tokio::task::JoinHandle<()>) {
        async fn root() -> &'static str {
            "ok"
        }
        async fn file(
            State(data): State<Arc<Vec<u8>>>,
            headers: HeaderMap,
        ) -> axum::response::Response {
            let Some(range) = headers
                .get(axum_header::RANGE)
                .and_then(|value| value.to_str().ok())
            else {
                return StatusCode::BAD_REQUEST.into_response();
            };
            let start = range
                .strip_prefix("bytes=")
                .and_then(|value| value.strip_suffix('-'))
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap();
            assert!(start < data.len());

            let body = data[start..].to_vec();
            let mut response_headers = HeaderMap::new();
            response_headers.insert(
                axum_header::CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes {start}-{}/{}", data.len() - 1, data.len()))
                    .unwrap(),
            );
            response_headers.insert(
                axum_header::CONTENT_LENGTH,
                HeaderValue::from_str(&body.len().to_string()).unwrap(),
            );
            (StatusCode::PARTIAL_CONTENT, response_headers, body).into_response()
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .route("/api/v1", get(root))
            .route("/api/v1/files/asset.mp4", get(file))
            .with_state(Arc::new(data));
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}/api/v1"), handle)
    }

    fn config(base_url: String, dir: &TempDir) -> CloudConfig {
        CloudConfig { update_mode: Default::default(), license_proof: String::new(), cloud_update_expires_at: None, config_path: None, 
            api_base_url: base_url,
            api_key: "test-key".to_string(),
            download_dir: dir.path().to_string_lossy().to_string(),
        }
    }

    #[tokio::test]
    async fn placeholder_cloud_config_is_reported_as_unconfigured() {
        let dir = TempDir::new().unwrap();
        let status = CloudService::check_status(&CloudConfig { update_mode: Default::default(), license_proof: String::new(), cloud_update_expires_at: None, config_path: None, 
            api_base_url: "https://cloud.example.com/api/v1".to_string(),
            api_key: String::new(),
            download_dir: dir.path().to_string_lossy().to_string(),
        })
        .await;
        assert!(!status.configured);
        assert!(!status.reachable);
    }

    #[tokio::test]
    async fn placeholder_api_key_is_reported_as_unconfigured() {
        let dir = TempDir::new().unwrap();
        let status = CloudService::check_status(&CloudConfig { update_mode: Default::default(), license_proof: String::new(), cloud_update_expires_at: None, config_path: None, 
            api_base_url: "http://127.0.0.1:9/api/v1".to_string(),
            api_key: "your-cloud-api-key-here".to_string(),
            download_dir: dir.path().to_string_lossy().to_string(),
        })
        .await;
        assert!(!status.configured);
        assert!(!status.api_key_configured);
        assert!(status.message.contains("API Key"));
    }

    #[tokio::test]
    async fn importable_song_count_only_includes_cloud_mapped_rows() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO songs (id, cloudFileId) VALUES ('local-only', ''), ('cloud-song', 'asset.mp4')",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            CloudService::count_importable_songs(&pool).await.unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn redirect_policy_allows_same_origin_and_rejects_cross_origin() {
        async fn same_origin_redirect() -> Redirect {
            Redirect::temporary("/ok")
        }
        async fn cross_origin_redirect() -> Redirect {
            Redirect::temporary("http://127.0.0.1:9/blocked")
        }
        async fn ok() -> &'static str {
            "ok"
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .route("/same", get(same_origin_redirect))
            .route("/cross", get(cross_origin_redirect))
            .route("/ok", get(ok));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = CloudService::http_client().unwrap();
        let same = client
            .get(format!("http://{address}/same"))
            .send()
            .await
            .unwrap();
        assert_eq!(same.status(), StatusCode::OK);
        assert!(client
            .get(format!("http://{address}/cross"))
            .send()
            .await
            .is_err());
        server.abort();
    }

    #[tokio::test]
    async fn batch_import_rejects_unknown_song_instead_of_returning_false_success() {
        let pool = test_pool().await;
        let dir = TempDir::new().unwrap();
        let (base_url, server) = spawn_mock_cloud(b"content".to_vec()).await;
        let result = CloudService::batch_import(
            &pool,
            &config(base_url, &dir),
            vec!["missing-song".to_string()],
        )
        .await;
        assert!(matches!(result, Err(AppError::BadRequest(_))));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_tasks")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        server.abort();
    }

    #[tokio::test]
    async fn duplicate_active_task_is_reused() {
        let pool = test_pool().await;
        let first = CloudService::create_download_task(&pool, "song", "song-1", "asset.mp4")
            .await
            .unwrap();
        let second = CloudService::create_download_task(&pool, "song", "song-1", "asset.mp4")
            .await
            .unwrap();
        assert_eq!(first.id, second.id);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_tasks")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn ignored_range_response_overwrites_part_and_commits_atomically() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO songs (id, cloudFileId) VALUES ('song-1', 'asset.mp4')")
            .execute(&pool)
            .await
            .unwrap();
        let content = b"complete-cloud-file-content".to_vec();
        let dir = TempDir::new().unwrap();
        let (base_url, server) = spawn_mock_cloud(content.clone()).await;
        let cfg = config(base_url, &dir);
        let task = CloudService::create_download_task(&pool, "song", "song-1", "asset.mp4")
            .await
            .unwrap();
        let short_id = task.id.get(..8).unwrap();
        let part_path = dir.path().join(format!("song-1_{short_id}.mp4.part"));
        tokio::fs::write(&part_path, &content[..5]).await.unwrap();

        let claimed = CloudService::claim_download_task(&pool, &cfg, &task.id)
            .await
            .unwrap();
        CloudService::execute_claimed_download(&pool, &cfg, claimed)
            .await
            .unwrap();

        let completed = CloudService::get_task(&pool, &task.id).await.unwrap();
        assert_eq!(completed.status, SYNC_STATUS_COMPLETED);
        assert_eq!(completed.downloaded_size, content.len() as i64);
        assert_eq!(
            tokio::fs::read(&completed.local_path).await.unwrap(),
            content
        );
        assert!(!tokio::fs::try_exists(part_path).await.unwrap());
        let song_path: String =
            sqlx::query_scalar("SELECT filePath FROM songs WHERE id = 'song-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(song_path, completed.local_path);
        server.abort();
    }

    #[tokio::test]
    async fn valid_range_response_resumes_existing_part() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO songs (id, cloudFileId) VALUES ('song-1', 'asset.mp4')")
            .execute(&pool)
            .await
            .unwrap();
        let content = b"complete-cloud-file-content".to_vec();
        let dir = TempDir::new().unwrap();
        let (base_url, server) = spawn_range_cloud(content.clone()).await;
        let cfg = config(base_url, &dir);
        let task = CloudService::create_download_task(&pool, "song", "song-1", "asset.mp4")
            .await
            .unwrap();
        let short_id = task.id.get(..8).unwrap();
        let part_path = dir.path().join(format!("song-1_{short_id}.mp4.part"));
        tokio::fs::write(&part_path, &content[..5]).await.unwrap();

        let claimed = CloudService::claim_download_task(&pool, &cfg, &task.id)
            .await
            .unwrap();
        CloudService::execute_claimed_download(&pool, &cfg, claimed)
            .await
            .unwrap();

        let completed = CloudService::get_task(&pool, &task.id).await.unwrap();
        assert_eq!(completed.status, SYNC_STATUS_COMPLETED);
        assert_eq!(completed.downloaded_size, content.len() as i64);
        assert_eq!(
            tokio::fs::read(&completed.local_path).await.unwrap(),
            content
        );
        assert!(!tokio::fs::try_exists(part_path).await.unwrap());
        server.abort();
    }

    #[tokio::test]
    async fn task_list_returns_filtered_pagination_and_global_counts() {
        let pool = test_pool().await;
        for (id, status) in [("a", 0), ("b", 1), ("c", 2), ("d", 3)] {
            sqlx::query(
                "INSERT INTO sync_tasks (id, taskType, targetType, targetId, cloud_url, status)
                 VALUES (?, 'download', 'song', ?, ?, ?)",
            )
            .bind(id)
            .bind(id)
            .bind(format!("{id}.mp4"))
            .bind(status)
            .execute(&pool)
            .await
            .unwrap();
        }
        let list = CloudService::list_tasks(
            &pool,
            SyncTaskQuery {
                task_type: None,
                status: Some(SYNC_STATUS_FAILED),
                page: Some(1),
                page_size: Some(2),
            },
        )
        .await
        .unwrap();
        assert_eq!(list.total, 1);
        assert_eq!(list.items.len(), 1);
        assert_eq!(
            (list.pending, list.running, list.completed, list.failed),
            (1, 1, 1, 1)
        );

        let last_page = CloudService::list_tasks(
            &pool,
            SyncTaskQuery {
                task_type: None,
                status: None,
                page: Some(u32::MAX),
                page_size: Some(100),
            },
        )
        .await
        .unwrap();
        assert_eq!(last_page.page, u32::MAX);
        assert!(last_page.items.is_empty());
        assert_eq!(last_page.total, 4);
    }
}
