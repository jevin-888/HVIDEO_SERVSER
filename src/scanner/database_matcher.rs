/// 数据库匹配和更新模块
use sqlx::SqlitePool;
use std::{sync::Arc, time::Instant};
use tracing::{debug, error, info};

use crate::models::scan_task::{MatchRecord, ScanError, UnmatchedFile};
use crate::utils::media_path;

/// 批量查询候选文件在数据库中是否存在对应的 songNo
pub async fn find_matching_songs(
    pool: &SqlitePool,
    candidates: Vec<(String, String)>,
) -> (Vec<MatchRecord>, Vec<UnmatchedFile>, Vec<ScanError>) {
    let mut matched = Vec::new();
    let mut unmatched = Vec::new();
    let mut errors = Vec::new();

    for (songId, filePath) in candidates {
        match sqlx::query_scalar::<_, String>("SELECT songNo FROM songs WHERE songNo = ?")
            .bind(&songId)
            .fetch_optional(pool)
            .await
        {
            Ok(Some(_)) => {
                matched.push(MatchRecord { songId, filePath });
            }
            Ok(None) => {
                unmatched.push(UnmatchedFile {
                    filePath,
                    extracted_id: Some(songId.clone()),
                    reason: format!("数据库中不存在 songNo={}", songId),
                });
            }
            Err(e) => {
                error!("查询 songNo={} 失败: {}", songId, e);
                errors.push(ScanError {
                    filePath,
                    error: format!("数据库查询失败: {}", e),
                });
            }
        }
    }

    info!(
        "数据库匹配完成: 匹配={}, 未匹配={}, 错误={}",
        matched.len(),
        unmatched.len(),
        errors.len()
    );
    (matched, unmatched, errors)
}

/// 同一事务更新源曲库格式/路径、文件记录和本地可点播对照。
pub async fn batch_update_song_paths(
    pool: &SqlitePool,
    records: &[MatchRecord],
    scan_roots: &str,
    incremental: bool,
) -> Result<u64, sqlx::Error> {
    update_song_paths(pool, records, scan_roots, incremental, Arc::new(|_, _| {})).await
}

pub async fn update_song_paths(
    pool: &SqlitePool,
    records: &[MatchRecord],
    scan_roots: &str,
    incremental: bool,
    progress: Arc<dyn Fn(usize, usize) + Send + Sync>,
) -> Result<u64, sqlx::Error> {
    let started = Instant::now();
    progress(0, records.len());
    let mut tx = pool.begin().await?;
    let mut updated = 0u64;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS local_available_songs (
            songNo TEXT PRIMARY KEY,
            absolutePath TEXT NOT NULL,
            fileName TEXT,
            fileSize INTEGER DEFAULT 0,
            modifiedTime INTEGER DEFAULT 0,
            updatedAt INTEGER DEFAULT 0
        )",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_local_available_songs_path ON local_available_songs(absolutePath)")
        .execute(&mut *tx)
        .await?;
    if !incremental {
        // 全量对照的所选扫描路径是完整来源，先在同一事务中清除旧索引。
        sqlx::query("DELETE FROM local_available_songs")
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE songs SET absolutePath = NULL, relativePath = NULL, fileName = NULL, fileExists = 0, scoreEnabled = 0 WHERE absolutePath IS NOT NULL OR relativePath IS NOT NULL OR fileName IS NOT NULL OR fileExists IS NOT 0 OR scoreEnabled IS NOT 0")
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE songSearch SET fileExists = 0 WHERE fileExists IS NOT 0")
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE songSingers SET fileExists = 0 WHERE fileExists IS NOT 0")
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE songFiles SET fileExists = 0 WHERE fileExists IS NOT 0")
            .execute(&mut *tx)
            .await?;
    }

    // Use the directories selected for this scan. System media settings live
    // in a different database and do not define the song comparison scope.
    for (index, record) in records.iter().enumerate() {
        let path_parts = media_path::build_parts(&record.filePath, scan_roots);
        let video_file_type = std::path::Path::new(&path_parts.fileName)
            .extension()
            .and_then(|extension| extension.to_str())
            .filter(|extension| media_path::is_supported_media_extension(extension))
            .ok_or_else(|| sqlx::Error::Protocol(format!("Unsupported matched media path: {}", record.filePath)))?
            .to_ascii_lowercase();
        // Point-order uses songs.videoFileType with local_available_songs.absolutePath.
        // Keep that canonical pair in this transaction; no duplicate format column.
        match sqlx::query("UPDATE songs SET absolutePath = ?, relativePath = ?, fileName = ?, videoFileType = ?, scoreEnabled = ?, fileExists = 1, updatedTime = strftime('%s','now') * 1000 WHERE songNo = ?")
            .bind(&path_parts.absolutePath)
            .bind(&path_parts.relativePath)
            .bind(&path_parts.fileName)
            .bind(&video_file_type)
            // Scoring follows the HVIDEO suffix; never open media during path writes.
            .bind(i32::from(video_file_type == "hvideo"))
            .bind(&record.songId)
            .execute(&mut *tx)
            .await
        {
            Ok(r) => {
                if r.rows_affected() == 0 {
                    continue;
                }
                updated += r.rows_affected();
                sqlx::query("UPDATE songSearch SET fileExists = 1 WHERE songNo = ? AND fileExists IS NOT 1")
                    .bind(&record.songId)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query("UPDATE songSingers SET fileExists = 1 WHERE songNo = ? AND fileExists IS NOT 1")
                    .bind(&record.songId)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query(
                    "INSERT INTO songFiles (songNo, absolutePath, relativePath, fileName, fileExists, lastCheckedTime)
                     VALUES (?, ?, ?, ?, 1, strftime('%s','now') * 1000)
                     ON CONFLICT(songNo) DO UPDATE SET absolutePath = excluded.absolutePath, relativePath = excluded.relativePath, fileName = excluded.fileName, fileExists = 1, lastCheckedTime = excluded.lastCheckedTime, lastError = NULL"
                )
                .bind(&record.songId)
                .bind(&path_parts.absolutePath)
                .bind(&path_parts.relativePath)
                .bind(&path_parts.fileName)
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    "INSERT OR REPLACE INTO local_available_songs (songNo, absolutePath, fileName, updatedAt)
                     VALUES (?, ?, ?, strftime('%s','now') * 1000)"
                )
                .bind(&record.songId)
                .bind(&path_parts.absolutePath)
                .bind(&path_parts.fileName)
                .execute(&mut *tx)
                .await?;
                debug!("更新 songNo={} → {}", record.songId, path_parts.absolutePath);
            }
            Err(e) => {
                error!("更新 songNo={} 失败，回滚事务: {}", record.songId, e);
                tx.rollback().await.ok();
                return Err(e);
            }
        }
        if (index + 1) % 100 == 0 || index + 1 == records.len() {
            progress(index + 1, records.len());
        }
    }

    tx.commit().await?;
    info!("批量更新完成，共更新 {} 条 songs 路径记录，耗时={:.3}s", updated, started.elapsed().as_secs_f64());
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn scan_score_uses_only_case_insensitive_suffix_and_full_scan_clears_it() {
        let pool=create_test_pool().await;
        let dir=tempfile::tempdir().unwrap();
        for (name, expected) in [("100.hvideo",1),("100.mp4",0),("100.HVIDEO",1),("100.mkv",0)] {
            // No media file exists: the writer must only inspect the selected suffix.
            let path=dir.path().join(name);
            let record=MatchRecord {songId:"100".into(),filePath:path.to_string_lossy().into_owned()};
            batch_update_song_paths(&pool,&[record],dir.path().to_str().unwrap(),true).await.unwrap();
            assert_eq!(sqlx::query_scalar::<_,i32>("SELECT scoreEnabled FROM songs WHERE songNo='100'").fetch_one(&pool).await.unwrap(),expected);
        }
        batch_update_song_paths(&pool,&[],dir.path().to_str().unwrap(),false).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,i32>("SELECT scoreEnabled FROM songs WHERE songNo='100'").fetch_one(&pool).await.unwrap(),0);
    }

    #[tokio::test]
    #[ignore = "Read-only snapshot benchmark; set HVIDEO_BENCH_CATALOG to an existing song.db"]
    async fn benchmark_catalog_path_writes() {
        let source_path = std::env::var("HVIDEO_BENCH_CATALOG").expect("HVIDEO_BENCH_CATALOG");
        let source = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(&source_path).read_only(true)).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let snapshot = dir.path().join("benchmark.db");
        sqlx::query("VACUUM INTO ?").bind(snapshot.to_string_lossy().as_ref()).execute(&source).await.unwrap();
        source.close().await;
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(&snapshot)
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)).await.unwrap();
        let records: Vec<MatchRecord> = sqlx::query_as::<_, (String, String)>("SELECT songNo, absolutePath FROM local_available_songs ORDER BY songNo")
            .fetch_all(&pool).await.unwrap().into_iter().map(|(songId, filePath)| MatchRecord { songId, filePath }).collect();
        assert!(!records.is_empty());
        for incremental in [false, true] {
            let started = Instant::now();
            let updated = batch_update_song_paths(&pool, &records, "D:/;E:/", incremental).await.unwrap();
            assert_eq!(updated as usize, records.len());
            let wrong: i64 = sqlx::query_scalar("SELECT count(*) FROM songs WHERE fileExists=1 AND scoreEnabled != CASE WHEN lower(videoFileType)='hvideo' THEN 1 ELSE 0 END")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(wrong, 0);
            println!("BENCH mode={} records={} elapsed={:.3}s", if incremental {"incremental"} else {"full"}, updated, started.elapsed().as_secs_f64());
        }
        assert_eq!(sqlx::query_scalar::<_, String>("PRAGMA quick_check").fetch_one(&pool).await.unwrap(), "ok");
        pool.close().await;
        dir.close().unwrap();
    }

    async fn create_test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE songs (songNo TEXT PRIMARY KEY, absolutePath TEXT, relativePath TEXT, fileName TEXT, videoFileType TEXT, scoreEnabled INTEGER DEFAULT 0, fileExists INTEGER, updatedTime INTEGER)")
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO songs (songNo, fileExists, absolutePath) VALUES ('100', 0, NULL), ('YN200', 0, NULL), ('300', 1, '/old/300.mp4')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE songSearch (songNo TEXT PRIMARY KEY, fileExists INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO songSearch (songNo, fileExists) VALUES ('100', 0), ('YN200', 0), ('300', 1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE songSingers (songNo TEXT, fileExists INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO songSingers (songNo, fileExists) VALUES ('100', 0), ('YN200', 0), ('300', 1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE songFiles (songNo TEXT PRIMARY KEY, absolutePath TEXT, relativePath TEXT, fileName TEXT, fileExists INTEGER, lastCheckedTime INTEGER, lastError TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn test_numeric_id_matched() {
        let pool = create_test_pool().await;
        let candidates = vec![("100".to_string(), "/music/100.mp4".to_string())];
        let (matched, unmatched, errors) = find_matching_songs(&pool, candidates).await;
        assert_eq!(matched.len(), 1);
        assert_eq!(unmatched.len(), 0);
        assert_eq!(errors.len(), 0);
        assert_eq!(matched[0].songId, "100");
    }

    #[tokio::test]
    async fn test_alpha_prefix_id_matched() {
        let pool = create_test_pool().await;
        let candidates = vec![("YN200".to_string(), "/music/YN200.mp4".to_string())];
        let (matched, unmatched, errors) = find_matching_songs(&pool, candidates).await;
        assert_eq!(matched.len(), 1);
        assert_eq!(unmatched.len(), 0);
        assert_eq!(errors.len(), 0);
    }

    #[tokio::test]
    async fn test_unmatched() {
        let pool = create_test_pool().await;
        let candidates = vec![("999".to_string(), "/music/999.mp4".to_string())];
        let (matched, unmatched, errors) = find_matching_songs(&pool, candidates).await;
        assert_eq!(matched.len(), 0);
        assert_eq!(unmatched.len(), 1);
        assert_eq!(errors.len(), 0);
    }

    #[tokio::test]
    async fn test_batch_update() {
        let pool = create_test_pool().await;
        let records = vec![
            MatchRecord {
                songId: "100".to_string(),
                filePath: "D:/songs/100.mp4".to_string(),
            },
            MatchRecord {
                songId: "YN200".to_string(),
                filePath: "E:/songs/YN200.mp4".to_string(),
            },
        ];
        let updated = batch_update_song_paths(&pool, &records, "D:/songs;E:/songs", false)
            .await
            .unwrap();
        assert_eq!(updated, 2);

        let path: Option<String> =
            sqlx::query_scalar("SELECT absolutePath FROM songs WHERE songNo = 'YN200'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(path.unwrap(), "E:/songs/YN200.mp4");
        let paths: Vec<(String, String)> = sqlx::query_as(
            "SELECT songNo, relativePath FROM songs WHERE fileExists = 1 ORDER BY songNo",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            paths,
            vec![
                ("100".to_string(), "100.mp4".to_string()),
                ("YN200".to_string(), "YN200.mp4".to_string()),
            ]
        );

        let stale_song: (i64, Option<String>) =
            sqlx::query_as("SELECT fileExists, absolutePath FROM songs WHERE songNo = '300'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stale_song, (0, None));
        let stale_search: i64 =
            sqlx::query_scalar("SELECT fileExists FROM songSearch WHERE songNo = '300'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stale_search, 0);
        let matched_singer: i64 =
            sqlx::query_scalar("SELECT fileExists FROM songSingers WHERE songNo = 'YN200'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(matched_singer, 1);
    }

    #[tokio::test]
    async fn matched_format_and_all_paths_commit_together_or_roll_back() {
        let pool = create_test_pool().await;
        let record = |path: &str| MatchRecord { songId: "100".into(), filePath: path.into() };
        batch_update_song_paths(&pool, &[record("D:/songs/old/100.mp4")], "D:/songs", false).await.unwrap();
        batch_update_song_paths(&pool, &[record(r"E:\media\new\100.HVIDEO")], "E:/media", false).await.unwrap();
        let catalog: (String, String, String, String) = sqlx::query_as(
            "SELECT videoFileType, absolutePath, relativePath, fileName FROM songs WHERE songNo='100'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(catalog, ("hvideo".into(), "E:/media/new/100.HVIDEO".into(), "new/100.HVIDEO".into(), "100.HVIDEO".into()));
        let file: (String, String, String) = sqlx::query_as(
            "SELECT absolutePath, relativePath, fileName FROM songFiles WHERE songNo='100'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(file, (catalog.1.clone(), catalog.2.clone(), catalog.3.clone()));
        let playable: (String, String) = sqlx::query_as(
            "SELECT s.videoFileType, l.absolutePath FROM songs s JOIN local_available_songs l USING(songNo) WHERE songNo='100'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(playable, (catalog.0.clone(), catalog.1.clone()));

        sqlx::query("CREATE TRIGGER fail_playable_insert BEFORE INSERT ON local_available_songs BEGIN SELECT RAISE(ABORT, 'test write failure'); END")
            .execute(&pool).await.unwrap();
        assert!(batch_update_song_paths(&pool, &[record("F:/other/100.mkv")], "F:/other", false).await.is_err());
        let restored: (String, String, String, String) = sqlx::query_as(
            "SELECT videoFileType, absolutePath, relativePath, fileName FROM songs WHERE songNo='100'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(restored, catalog);
        let restored_file: (String, String, String) = sqlx::query_as(
            "SELECT absolutePath, relativePath, fileName FROM songFiles WHERE songNo='100'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(restored_file, file);
        let restored_playable: (String, String) = sqlx::query_as(
            "SELECT s.videoFileType, l.absolutePath FROM songs s JOIN local_available_songs l USING(songNo) WHERE songNo='100'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(restored_playable, playable);
    }
}
