use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Local, NaiveDate};
use sqlx::SqlitePool;

pub fn start_daily_backup(database_url: String) {
    tokio::spawn(async move {
        loop {
            if let Err(error) = backup_today(&database_url).await {
                tracing::error!("数据库每日备份失败: {}", error);
            }
            tokio::time::sleep(Duration::from_secs(60 * 60)).await;
        }
    });
}

pub async fn ensure_database_ready(database_url: &str) -> anyhow::Result<()> {
    let db_path = sqlite_path_from_url(database_url)?;
    let existed_before_check = db_path.exists();
    if db_path.exists() && database_integrity_ok(database_url).await {
        tracing::info!("数据库启动前完整性检查通过: {}", db_path.display());
        return Ok(());
    }

    if db_path.exists() {
        tracing::error!("数据库启动前完整性检查失败: {}", db_path.display());
    } else {
        tracing::warn!("数据库文件不存在，尝试从备份恢复: {}", db_path.display());
    }

    let restored = restore_latest_valid_backup(&db_path).await?;
    if !restored && !existed_before_check {
        tracing::warn!("未找到数据库备份，将创建新的数据库: {}", db_path.display());
        return Ok(());
    }
    if !restored {
        anyhow::bail!(
            "数据库完整性检查失败，且没有找到可用备份: {}",
            db_path.display()
        );
    }
    if !database_integrity_ok(database_url).await {
        anyhow::bail!(
            "数据库已从备份恢复，但完整性检查仍未通过: {}",
            db_path.display()
        );
    }
    tracing::info!("数据库备份恢复后完整性检查通过: {}", db_path.display());
    Ok(())
}

async fn backup_today(database_url: &str) -> anyhow::Result<()> {
    let db_path = sqlite_path_from_url(database_url)?;
    if !db_path.exists() {
        anyhow::bail!("数据库文件不存在: {}", db_path.display());
    }

    let backup_dir = db_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("backups");
    tokio::fs::create_dir_all(&backup_dir).await?;

    let today = Local::now().date_naive();
    let backup_path = backup_dir.join(format!("hvideo_{}.db", today.format("%Y%m%d")));
    if !backup_path.exists() {
        tokio::fs::copy(&db_path, &backup_path).await?;
        tracing::info!("数据库每日备份完成: {}", backup_path.display());
    }

    cleanup_old_backups(&backup_dir, today, 7).await?;
    Ok(())
}

async fn restore_latest_valid_backup(db_path: &Path) -> anyhow::Result<bool> {
    let backup_dir = db_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("backups");
    let mut backups = list_backup_files(&backup_dir).await?;
    backups.sort_by(|a, b| b.0.cmp(&a.0));

    for (_, backup_path) in backups {
        let backup_url = sqlite_url_from_path(&backup_path);
        if !database_integrity_ok(&backup_url).await {
            tracing::error!("跳过不可用数据库备份: {}", backup_path.display());
            continue;
        }
        if db_path.exists() {
            let corrupt_path = corrupt_database_path(db_path);
            tokio::fs::rename(db_path, &corrupt_path).await?;
            tracing::error!("已保留损坏数据库: {}", corrupt_path.display());
        } else if let Some(parent) = db_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::copy(&backup_path, db_path).await?;
        tracing::info!("已从数据库备份恢复: {}", backup_path.display());
        return Ok(true);
    }

    Ok(false)
}

async fn database_integrity_ok(database_url: &str) -> bool {
    let Ok(pool) = SqlitePool::connect(database_url).await else {
        return false;
    };
    let result = sqlx::query_scalar::<_, String>("PRAGMA integrity_check")
        .fetch_one(&pool)
        .await
        .map(|value| value.eq_ignore_ascii_case("ok"))
        .unwrap_or(false);
    pool.close().await;
    result
}

async fn list_backup_files(backup_dir: &Path) -> anyhow::Result<Vec<(NaiveDate, PathBuf)>> {
    let mut files = Vec::new();
    if !backup_dir.exists() {
        return Ok(files);
    }
    let mut entries = tokio::fs::read_dir(backup_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let Some(fileName) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if let Some(date) = backup_date_from_file_name(fileName) {
            files.push((date, path));
        }
    }
    Ok(files)
}

async fn cleanup_old_backups(
    backup_dir: &Path,
    today: NaiveDate,
    keep_days: i64,
) -> anyhow::Result<()> {
    let cutoff = today - ChronoDuration::days(keep_days - 1);
    let mut entries = tokio::fs::read_dir(backup_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let Some(fileName) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(date) = backup_date_from_file_name(fileName) else {
            continue;
        };
        if date < cutoff {
            tokio::fs::remove_file(&path).await?;
            tracing::info!("已删除过期数据库备份: {}", path.display());
        }
    }
    Ok(())
}

fn sqlite_path_from_url(database_url: &str) -> anyhow::Result<PathBuf> {
    let Some(path) = database_url.strip_prefix("sqlite://") else {
        anyhow::bail!("不支持的数据库地址: {}", database_url);
    };
    let path = path.split('?').next().unwrap_or(path);
    Ok(PathBuf::from(path))
}

fn sqlite_url_from_path(path: &Path) -> String {
    format!("sqlite://{}", path.to_string_lossy().replace('\\', "/"))
}

fn corrupt_database_path(db_path: &Path) -> PathBuf {
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let stem = db_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("hvideo");
    let extension = db_path.extension().and_then(|s| s.to_str()).unwrap_or("db");
    db_path.with_file_name(format!("{}.corrupt_{}.{}", stem, timestamp, extension))
}

fn backup_date_from_file_name(fileName: &str) -> Option<NaiveDate> {
    let date_part = fileName.strip_prefix("hvideo_")?.strip_suffix(".db")?;
    NaiveDate::parse_from_str(date_part, "%Y%m%d").ok()
}
