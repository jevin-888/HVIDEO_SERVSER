use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::path::Path;

pub mod utils;

/// 初始化数据库连接池
pub async fn init_pool(database_url: &str, max_connections: u32) -> anyhow::Result<SqlitePool> {
    // 确保数据目录存在
    if let Some(db_path) = database_url.strip_prefix("sqlite://") {
        let db_path = db_path.split('?').next().unwrap_or(db_path);
        if let Some(parent) = Path::new(db_path).parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await?;

    // 启用 WAL 模式提升并发性能
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(&pool)
        .await?;

    // 启用外键约束
    sqlx::query("PRAGMA foreign_keys=ON").execute(&pool).await?;

    tracing::info!(
        "【业务数据库】连接池初始化完成 (并发处理限制: {})",
        max_connections
    );
    Ok(pool)
}

/// 确保迁移追踪表存在
async fn ensure_migration_table(pool: &SqlitePool) -> anyhow::Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name TEXT PRIMARY KEY,
            executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// 运行受追踪的迁移
async fn run_migration_tracked(pool: &SqlitePool, name: &str, sql: &str) -> anyhow::Result<bool> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _migrations WHERE name = ?")
        .bind(name)
        .fetch_one(pool)
        .await?;

    if count == 0 {
        let mut transaction = pool.begin().await?;
        if sql.contains("CREATE TRIGGER") {
            // Let SQLite parse trigger bodies; splitting on semicolons breaks BEGIN/END.
            sqlx::raw_sql(sql).execute(&mut *transaction).await?;
        } else {
            run_sql_batch(&mut transaction, sql).await?;
        }
        sqlx::query("INSERT INTO _migrations (name) VALUES (?)")
            .bind(name)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        tracing::info!("【数据库迁移】{} 执行完成", name);
        return Ok(true);
    }
    Ok(false)
}

async fn normalize_room_client_connections(pool: &SqlitePool) -> anyhow::Result<()> {
    let has_table: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='room_client_connections'",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if has_table == 0 {
        return Ok(());
    }

    let has_status: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('room_client_connections') WHERE name = 'status'",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if has_status == 0 {
        return Ok(());
    }

    let rows = sqlx::query(
        "SELECT rowid, roomId, clientType, clientIp
         FROM room_client_connections
         ORDER BY datetime(updatedAt) DESC, datetime(connectedAt) DESC, rowid DESC",
    )
    .fetch_all(pool)
    .await?;

    let mut seen = std::collections::HashSet::new();
    for row in rows {
        let rowid: i64 = row.get("rowid");
        let roomId: String = row.get("roomId");
        let clientType: String = row.get("clientType");
        let clientIp: String = row.get("clientIp");
        let stable_id = format!("{}|{}|{}", roomId, clientType, clientIp);

        if seen.insert(stable_id.clone()) {
            sqlx::query(
                "UPDATE room_client_connections
                 SET connection_id = ?
                 WHERE rowid = ?",
            )
            .bind(&stable_id)
            .bind(rowid)
            .execute(pool)
            .await?;
        } else {
            sqlx::query("DELETE FROM room_client_connections WHERE rowid = ?")
                .bind(rowid)
                .execute(pool)
                .await?;
        }
    }

    Ok(())
}

/// 运行数据库迁移
pub async fn run_migrations(pool: &SqlitePool) -> anyhow::Result<()> {
    // 确保迁移记录表存在
    ensure_migration_table(pool).await?;

    // 定义并按顺序运行迁移
    let mut count = 0;
    if run_migration_tracked(
        pool,
        "001_init",
        include_str!("../../migrations/001_init.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "002_add_room_attrs",
        include_str!("../../migrations/002_add_room_attrs.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "003_unify_ip_naming",
        include_str!("../../migrations/003_unify_ip_naming.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "004_add_peripheral_states",
        include_str!("../../migrations/004_add_peripheral_states.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "006_peripheral_presets",
        include_str!("../../migrations/006_peripheral_presets.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "007_service_calls",
        include_str!("../../migrations/007_service_calls.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "008_service_types",
        include_str!("../../migrations/008_service_types.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "009_add_mic_volume",
        include_str!("../../migrations/009_add_mic_volume.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "010_add_call_note",
        include_str!("../../migrations/010_add_call_note.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "011_queue_song_fields",
        include_str!("../../migrations/011_queue_song_fields.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "012_cleanup_room_type_zero",
        include_str!("../../migrations/012_cleanup_room_type_zero.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "013_system_settings",
        include_str!("../../migrations/013_system_settings.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "014_room_client_connections",
        include_str!("../../migrations/014_room_client_connections.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "015_room_client_connection_status",
        include_str!("../../migrations/015_room_client_connection_status.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "016_room_client_http_sources",
        include_str!("../../migrations/016_room_client_http_sources.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "017_cashier_products_orders",
        include_str!("../../migrations/017_cashier_products_orders.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "018_billing_permissions_finance",
        include_str!("../../migrations/018_billing_permissions_finance.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "019_warehouse_inventory",
        include_str!("../../migrations/019_warehouse_inventory.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "020_readable_admin_login",
        include_str!("../../migrations/020_readable_admin_login.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "021_billing_shift_name",
        include_str!("../../migrations/021_billing_shift_name.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "022_billing_open_options",
        include_str!("../../migrations/022_billing_open_options.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "023_billing_base_settings",
        include_str!("../../migrations/023_billing_base_settings.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "024_billing_holiday_dates",
        include_str!("../../migrations/024_billing_holiday_dates.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "025_billing_rule_label",
        include_str!("../../migrations/025_billing_rule_label.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "026_warehouse_product_locations",
        include_str!("../../migrations/026_warehouse_product_locations.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "027_billing_timer_options",
        include_str!("../../migrations/027_billing_timer_options.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "028_shift_records_shift_name",
        include_str!("../../migrations/028_shift_records_shift_name.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "029_billing_sessions_shift_report_id",
        include_str!("../../migrations/029_billing_sessions_shift_report_id.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "030_display_presets",
        include_str!("../../migrations/030_display_presets.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "031_room_sync_states",
        include_str!("../../migrations/031_room_sync_states.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "032_cloud_sync_integrity",
        include_str!("../../migrations/032_cloud_sync_integrity.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "033_pad_ordering_status",
        include_str!("../../migrations/033_pad_ordering_status.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "034_cleanup_auto_room_uuid_suffix",
        include_str!("../../migrations/034_cleanup_auto_room_uuid_suffix.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "035_terminal_network_connections",
        include_str!("../../migrations/035_terminal_network_connections.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "036_sync_room_terminal_names",
        include_str!("../../migrations/036_sync_room_terminal_names.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "037_reclaim_expired_terminal_ips",
        include_str!("../../migrations/037_reclaim_expired_terminal_ips.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "038_cashier_members_reservations",
        include_str!("../../migrations/038_cashier_members_reservations.sql"),
    ).await? {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "039_employee_roles_modules",
        include_str!("../../migrations/039_employee_roles_modules.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(pool, "040_update_history", include_str!("../../migrations/040_update_history.sql")).await? { count += 1; }
    if run_migration_tracked(pool, "041_update_history_deletions", include_str!("../../migrations/041_update_history_deletions.sql")).await? { count += 1; }
    if run_migration_tracked(pool, "042_update_history_songs", include_str!("../../migrations/042_update_history_songs.sql")).await? { count += 1; }
    if run_migration_tracked(pool, "043_cloud_history_authority", include_str!("../../migrations/043_cloud_history_authority.sql")).await? { count += 1; }
    normalize_room_client_connections(pool).await?;

    // Terminal IDs are stable identities; IP is only the latest address.
    // 创建默认的 API 客户端（如果不存在）
    let admin_key = "admin";
    let admin_secret = "admin123";
    let admin_name = "默认管理员";
    let admin_permissions = "[\"read\", \"write\", \"admin\"]";

    // 检查是否已存在
    let admin_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM api_clients WHERE clientKey = ?")
            .bind(admin_key)
            .fetch_one(pool)
            .await?;

    if admin_count == 0 {
        let id = "default_admin_id";
        let hashed_secret = bcrypt::hash(admin_secret, bcrypt::DEFAULT_COST)?;

        sqlx::query(
            "INSERT INTO api_clients (id, clientName, clientKey, clientSecret, permissions, rateLimit, status)
             VALUES (?, ?, ?, ?, ?, 1000, 1)"
        )
        .bind(id)
        .bind(admin_name)
        .bind(admin_key)
        .bind(hashed_secret)
        .bind(admin_permissions)
        .execute(pool)
        .await?;

        tracing::info!("默认 API 客户端创建完成: clientKey={}", admin_key);
    }

    let employee_admin_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM employees WHERE employeeNo = ?")
            .bind(admin_key)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    if employee_admin_count == 0 {
        let hashed_password = bcrypt::hash(admin_secret, bcrypt::DEFAULT_COST)?;
        sqlx::query(
            "INSERT INTO employees (id, employeeNo, name, passwordHash, roleId, enabled)
             VALUES (?, ?, ?, ?, 'admin', 1)",
        )
        .bind("default_employee_admin")
        .bind(admin_key)
        .bind("系统管理员")
        .bind(hashed_password)
        .execute(pool)
        .await?;

        tracing::info!("默认员工账号创建完成: employeeNo={}", admin_key);
    }

    if count > 0 {
        tracing::info!("【业务数据库】数据结构同步成功 (新增 {} 个版本)", count);
    } else {
        tracing::info!("【业务数据库】数据结构检查一致");
    }
    Ok(())
}

/// 批量运行 SQL 语句（辅助函数）
async fn run_sql_batch(conn: &mut sqlx::SqliteConnection, sql: &str) -> anyhow::Result<()> {
    for statement in sql.split(';') {
        let stmt = statement.trim();
        // 跳过空语句和纯注释行
        if stmt.is_empty() {
            continue;
        }
        // 移除开头的注释行，保留实际SQL
        let effective: Vec<&str> = stmt
            .lines()
            .filter(|line| !line.trim().starts_with("--") && !line.trim().is_empty())
            .collect();
        if effective.is_empty() {
            continue;
        }

        // 尝试执行
        if let Err(e) = sqlx::query(stmt).execute(&mut *conn).await {
            // 如果是 ALTER TABLE 添加列重复错误，则忽略
            let msg = e.to_string();
            // SQLite 错误信息通常包含 "duplicate column name"
            if (msg.contains("duplicate column name") || msg.contains("no such column"))
                && stmt.to_uppercase().contains("ALTER TABLE")
            {
                tracing::info!("跳过已存在的列迁移: {}", stmt);
            } else if msg.contains("table") && msg.contains("already exists") {
                tracing::info!("跳过已存在的表迁移: {}", stmt);
            } else {
                // 其他错误抛出
                tracing::error!("SQL执行失败: {} \n错误: {}", stmt, msg);
                return Err(e.into());
            }
        }
    }
    Ok(())
}

/// 初始化歌曲库数据库连接池（song.db）
pub async fn init_song_db_pool(
    database_url: &str,
    max_connections: u32,
) -> anyhow::Result<SqlitePool> {
    // 确保数据目录存在
    if let Some(db_path) = database_url.strip_prefix("sqlite://") {
        let db_path = db_path.split('?').next().unwrap_or(db_path);
        if let Some(parent) = Path::new(db_path).parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await?;

    // 启用 WAL 模式
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(&pool)
        .await?;

    // 运行歌曲库迁移（含字典 classify/sex/light/soundEffect）
    if let Err(e) = run_song_db_migrations(&pool).await {
        tracing::warn!("歌曲库迁移执行失败（可稍后手动执行）: {}", e);
    }

    tracing::info!(
        "【歌曲数据库】连接池初始化完成 (并发处理限制: {})",
        max_connections
    );
    Ok(pool)
}

/// 运行歌曲库数据库迁移
pub async fn run_song_db_migrations(pool: &SqlitePool) -> anyhow::Result<()> {
    ensure_migration_table(pool).await?;
    let mut count = 0;
    if run_migration_tracked(
        pool,
        "song_db_init",
        include_str!("../../migrations/song_db_init.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "song_db_002_catalog_import",
        include_str!("../../migrations/song_db_002_catalog_import.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "song_db_003_dictionary_fields",
        include_str!("../../migrations/song_db_003_dictionary_fields.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(
        pool,
        "song_db_004_search_nocase",
        include_str!("../../migrations/song_db_004_search_nocase.sql"),
    )
    .await?
    {
        count += 1;
    }
    if run_migration_tracked(pool, "song_db_005_hidden_classifications", include_str!("../../migrations/song_db_005_hidden_classifications.sql")).await? {
        count += 1;
    }
    crate::services::dictionary_service::DictionaryService::ensure_defaults(pool).await?;
    crate::services::song_data_import_service::SongDataImportService::recover_stale_tasks(pool)
        .await?;
    crate::services::singer_data_import_service::SingerDataImportService::recover_stale_tasks(pool)
        .await?;
    if count > 0 {
        tracing::info!("【歌曲数据库】数据结构同步成功 (新增 {} 个版本)", count);
    } else {
        tracing::info!("【歌曲数据库】数据结构检查一致");
    }
    Ok(())
}

/// Runs only after HTTP readiness, and is dropped with the server on shutdown.
pub async fn run_song_score_maintenance(pool: &SqlitePool) {
    loop {
        match reconcile_encrypted_song_scores(pool).await {
            Ok(_) => std::future::pending::<()>().await,
            Err(error) => {
                tracing::warn!("后台评分校验暂停，将从已保存进度重试: {}", error);
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            }
        }
    }
}

async fn reconcile_encrypted_song_scores(pool: &SqlitePool) -> anyhow::Result<bool> {
    reconcile_song_scores_with(pool, |path| async move {
        crate::utils::media_encryption::score_enabled(&path).await
    }).await
}

// Media I/O happens outside short write transactions. Each committed batch and
// its cursor are atomic, so interrupted upgrades only repeat the current batch.
async fn reconcile_song_scores_with<F, Fut>(pool: &SqlitePool, mut inspect: F) -> anyhow::Result<bool>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = i32>,
{
    const NAME: &str = "song_db_006_encrypted_scores";
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _migrations WHERE name=?").bind(NAME).fetch_one(pool).await?;
    if exists != 0 { return Ok(false); }
    sqlx::query("CREATE TABLE IF NOT EXISTS _song_score_repair (name TEXT PRIMARY KEY, last_id INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0)")
        .execute(pool).await?;
    sqlx::query("INSERT OR IGNORE INTO _song_score_repair(name) VALUES (?)").bind(NAME).execute(pool).await?;
    let (mut cursor, mut processed): (i64, i64) = sqlx::query_as("SELECT last_id, processed FROM _song_score_repair WHERE name=?")
        .bind(NAME).fetch_one(pool).await?;
    tracing::info!("后台加密评分校验开始：已处理 {} 首，继续从 songId={} 校验，不阻塞服务启动", processed, cursor);
    loop {
        let rows = sqlx::query("SELECT songId, absolutePath, fileExists, scoreEnabled, updatedTime FROM songs
            WHERE songId>? AND ((fileExists=1 AND COALESCE(absolutePath,'')<>'') OR scoreEnabled IS NOT 0)
            ORDER BY songId LIMIT 32")
            .bind(cursor).fetch_all(pool).await?;
        if rows.is_empty() { break; }
        let mut scores = Vec::with_capacity(rows.len());
        for row in &rows {
            let path: Option<String> = row.try_get("absolutePath")?;
            let local: Option<i32> = row.try_get("fileExists")?;
            let score = match path.filter(|path| !path.is_empty() && local == Some(1)) {
                Some(path) => inspect(path).await,
                None => 0,
            };
            scores.push(score);
        }
        let mut tx = pool.begin().await?;
        for (row, score) in rows.iter().zip(scores) {
            // Do not overwrite a song edited/replaced while its old media was inspected.
            sqlx::query("UPDATE songs SET scoreEnabled=? WHERE songId=? AND absolutePath IS ?
                AND fileExists IS ? AND updatedTime IS ? AND scoreEnabled IS ?")
                .bind(score).bind(row.try_get::<i64, _>("songId")?)
                .bind(row.try_get::<Option<String>, _>("absolutePath")?)
                .bind(row.try_get::<Option<i32>, _>("fileExists")?)
                .bind(row.try_get::<Option<i64>, _>("updatedTime")?)
                .bind(row.try_get::<Option<i32>, _>("scoreEnabled")?)
                .execute(&mut *tx).await?;
        }
        cursor = rows.last().unwrap().try_get("songId")?;
        processed += rows.len() as i64;
        sqlx::query("UPDATE _song_score_repair SET last_id=?, processed=? WHERE name=?")
            .bind(cursor).bind(processed).bind(NAME).execute(&mut *tx).await?;
        tx.commit().await?;
        tracing::info!("后台加密评分校验进度：已处理 {} 首，已保存至 songId={}", processed, cursor);
        tokio::task::yield_now().await;
    }
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO _migrations(name) VALUES (?)").bind(NAME).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM _song_score_repair WHERE name=?").bind(NAME).execute(&mut *tx).await?;
    tx.commit().await?;
    tracing::info!("后台评分修复完成：共处理 {} 首歌曲", processed);
    Ok(true)
}

#[cfg(test)]
mod catalog_policy_tests {
    use super::*;

    #[tokio::test]
    async fn interrupted_score_repair_resumes_and_does_not_hold_database_during_io() {
        use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
        let pool=SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        run_song_db_migrations(&pool).await.unwrap();
        for id in 1..=40 {
            sqlx::query("INSERT INTO songs(songNo,songName,absolutePath,fileExists,scoreEnabled) VALUES (?,?,?,1,0)")
                .bind(id.to_string()).bind(id.to_string()).bind(format!("{id}.mp4")).execute(&pool).await.unwrap();
        }
        let inspected=Arc::new(AtomicUsize::new(0));
        let calls=inspected.clone();
        let (started_tx, started_rx)=tokio::sync::oneshot::channel();
        let mut started_tx=Some(started_tx);
        let repair=reconcile_song_scores_with(&pool, move |_| {
            let n=calls.fetch_add(1,Ordering::SeqCst);
            let signal=if n==32 { started_tx.take() } else { None };
            async move {
                if let Some(signal)=signal {
                    let _=signal.send(());
                    std::future::pending::<()>().await;
                }
                1
            }
        });
        // Cancel while the next batch is inspecting media, after one batch commits.
        {
            tokio::pin!(repair);
            tokio::select! {
                result=&mut repair => panic!("repair unexpectedly finished: {result:?}"),
                _=started_rx => {
                    let cursor=tokio::time::timeout(std::time::Duration::from_secs(2),
                        sqlx::query_scalar::<_,i64>("SELECT last_id FROM _song_score_repair").fetch_one(&pool))
                        .await.unwrap().unwrap();
                    assert_eq!(cursor,32);
                    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM _migrations WHERE name='song_db_006_encrypted_scores'")
                        .fetch_one(&pool).await.unwrap(),0);
                }
            }
        }
        assert_eq!(inspected.load(Ordering::SeqCst),33);
        let resumed=Arc::new(AtomicUsize::new(0));
        let calls=resumed.clone();
        reconcile_song_scores_with(&pool,move |_| {
            calls.fetch_add(1,Ordering::SeqCst);
            async { 1 }
        }).await.unwrap();
        assert_eq!(resumed.load(Ordering::SeqCst),8);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM songs WHERE scoreEnabled=1")
            .fetch_one(&pool).await.unwrap(),40);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM _song_score_repair")
            .fetch_one(&pool).await.unwrap(),0);
    }

    #[tokio::test]
    async fn score_repair_preserves_edits_made_while_inspecting_media() {
        let pool=SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        run_song_db_migrations(&pool).await.unwrap();
        sqlx::query("INSERT INTO songs(songNo,songName,absolutePath,fileExists,scoreEnabled) VALUES ('edited','edited','old.mp4',1,0)")
            .execute(&pool).await.unwrap();
        reconcile_song_scores_with(&pool,|_| async {
            sqlx::query("UPDATE songs SET absolutePath='new.mp4', updatedTime=1, scoreEnabled=0 WHERE songNo='edited'")
                .execute(&pool).await.unwrap();
            1
        }).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,i32>("SELECT scoreEnabled FROM songs WHERE songNo='edited'")
            .fetch_one(&pool).await.unwrap(),0);
    }

    #[tokio::test]
    async fn upgrade_repairs_existing_scores_and_hides_classifications_once() {
        let pool=SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        let dir=tempfile::tempdir().unwrap();
        sqlx::raw_sql(include_str!("../../migrations/song_db_init.sql")).execute(&pool).await.unwrap();
        for (no,name,bytes,exists,old_score) in [
            ("encrypted","encrypted.mp4",crate::utils::media_encryption::test_video(true),1,0),
            ("plain","plain.hvideo",crate::utils::media_encryption::test_video(false),1,1),
            ("catalog","catalog.mp4",Vec::new(),0,1),
        ] {
            let path=dir.path().join(name);
            std::fs::write(&path,bytes).unwrap();
            sqlx::query("INSERT INTO songs(songNo,songName,absolutePath,fileExists,scoreEnabled) VALUES (?,?,?,?,?)")
                .bind(no).bind(no).bind(path.to_string_lossy().as_ref()).bind(exists).bind(old_score).execute(&pool).await.unwrap();
        }
        sqlx::raw_sql("INSERT INTO dicts(dictGroup,dictCode,dictName,visible) VALUES ('classify','2','黄梅戏',1),('classify','78','秦腔',1),('classify','0','其他',1),('classify','16','流行金曲',1),('language','0','其他',1);")
            .execute(&pool).await.unwrap();
        run_song_db_migrations(&pool).await.unwrap();
        // Schema setup must return before opening any media or repairing scores.
        assert_eq!(sqlx::query_scalar::<_,i32>("SELECT scoreEnabled FROM songs WHERE songNo='plain'").fetch_one(&pool).await.unwrap(),1);
        assert!(reconcile_encrypted_song_scores(&pool).await.unwrap());
        let scores:Vec<(String,i32)>=sqlx::query_as("SELECT songNo,scoreEnabled FROM songs ORDER BY songNo").fetch_all(&pool).await.unwrap();
        assert_eq!(scores,vec![("catalog".into(),0),("encrypted".into(),1),("plain".into(),0)]);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM dicts WHERE visible=0").fetch_one(&pool).await.unwrap(),3);
        sqlx::query("UPDATE dicts SET visible=1 WHERE dictGroup='classify' AND dictCode='2'").execute(&pool).await.unwrap();
        run_song_db_migrations(&pool).await.unwrap();
        assert!(!reconcile_encrypted_song_scores(&pool).await.unwrap());
        assert_eq!(sqlx::query_scalar::<_,i32>("SELECT visible FROM dicts WHERE dictGroup='classify' AND dictCode='2'").fetch_one(&pool).await.unwrap(),1);
        let req=serde_json::from_value(serde_json::json!({"dictCode":"3","dictName":"京剧"})).unwrap();
        let added=crate::services::dictionary_service::DictionaryService::upsert(&pool,"classify",req).await.unwrap();
        assert_eq!(added.visible,Some(0));
        let req=serde_json::from_value(serde_json::json!({"dictCode":"3","dictName":"京剧","visible":1})).unwrap();
        assert_eq!(crate::services::dictionary_service::DictionaryService::upsert(&pool,"classify",req).await.unwrap().visible,Some(1));
    }
}
