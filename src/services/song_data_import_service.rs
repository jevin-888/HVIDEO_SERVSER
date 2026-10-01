use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use chrono::Utc;
use quick_xml::{events::Event, Reader};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use tokio::sync::mpsc;
use uuid::Uuid;
use zip::ZipArchive;

use crate::errors::{AppError, AppResult};
use crate::models::song_import::SongImportTask;

const BATCH_SIZE: usize = 500;
const REQUIRED_HEADERS: &[&str] = &[
    "song_no",
    "song_name",
    "song_name_first_char",
    "track",
    "language_code",
    "classify_code",
    "score_enabled",
    "song_version_name",
    "click_time",
    "song_local_disabled",
    "video_file_type",
    "storage_folder_pre_name",
    "singer_no",
    "singer_name",
    "singer_name_first_char",
    "sex",
    "region",
];

pub struct SongDataImportService;

#[derive(Debug)]
struct CatalogSong {
    row_number: i64,
    song_no: String,
    song_name: String,
    song_initial: String,
    track: i32,
    language_code: String,
    category_code: String,
    version_name: String,
    click_time: i64,
    video_file_type: String,
    storage_folder: String,
    singer_no: String,
    singer_name: String,
    singer_initial: String,
    singer_nos: Vec<String>,
    singer_names: Vec<String>,
    singer_initials: Vec<String>,
    sex_codes: Vec<String>,
    region_codes: Vec<String>,
}

struct ImportBatch {
    rows: Vec<CatalogSong>,
    processed: i64,
    skipped: i64,
    failed: i64,
    current_row: i64,
    total: i64,
    warning: Option<String>,
}

#[derive(Debug)]
struct CatalogSinger {
    singer_no: String,
    singer_name: String,
    initial_key: String,
    region_code: String,
    region_name: Option<String>,
    sex_code: String,
    sex_name: Option<String>,
}

#[derive(Debug)]
struct CatalogSongSinger {
    song_no: String,
    singer_no: String,
    singer_name: String,
    language_code: String,
    category_code: String,
    file_exists: i64,
    click_time: i64,
    sort_order: i32,
}

impl SongDataImportService {
    pub async fn create_task(
        pool: &SqlitePool,
        file_name: &str,
        temp_path: PathBuf,
    ) -> AppResult<SongImportTask> {
        let task_id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();
        let result = sqlx::query(
            "INSERT INTO importTasks (
                taskId, sourceType, sourcePath, status, totalCount, importedCount,
                skippedCount, failedCount, processedCount, insertedCount, updatedCount,
                currentRow, startedTime, updatedTime
             ) VALUES (?, 'xlsxCatalog', ?, 'pending', 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)",
        )
        .bind(&task_id)
        .bind(file_name)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await;

        if let Err(error) = result {
            let _ = tokio::fs::remove_file(&temp_path).await;
            if error.to_string().contains("idx_importTasks_single_active")
                || error.to_string().contains("UNIQUE constraint failed")
            {
                return Err(AppError::Conflict(
                    "已有歌曲或歌星数据导入任务正在运行".to_string(),
                ));
            }
            return Err(error.into());
        }

        let task = Self::get_task(pool, &task_id).await?;
        let worker_pool = pool.clone();
        let worker_task_id = task_id.clone();
        tokio::spawn(async move {
            if let Err(error) = Self::run_import(&worker_pool, &worker_task_id, &temp_path).await {
                tracing::error!(task_id = %worker_task_id, "歌曲数据导入失败: {}", error);
                let _ = Self::mark_failed(&worker_pool, &worker_task_id, &error.to_string()).await;
            }
            let _ = tokio::fs::remove_file(&temp_path).await;
        });
        Ok(task)
    }

    pub async fn get_task(pool: &SqlitePool, task_id: &str) -> AppResult<SongImportTask> {
        sqlx::query_as::<_, SongImportTask>(
            "SELECT taskId, sourcePath, status, totalCount,
                    COALESCE(processedCount, 0) AS processedCount,
                    importedCount, COALESCE(insertedCount, 0) AS insertedCount,
                    COALESCE(updatedCount, 0) AS updatedCount, skippedCount, failedCount,
                    COALESCE(currentRow, 0) AS currentRow, startedTime, finishedTime, errorMessage
             FROM importTasks WHERE taskId = ? AND sourceType = 'xlsxCatalog'",
        )
        .bind(task_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("导入任务不存在".to_string()))
    }

    pub async fn get_active_task(pool: &SqlitePool) -> AppResult<Option<SongImportTask>> {
        Ok(sqlx::query_as::<_, SongImportTask>(
            "SELECT taskId, sourcePath, status, totalCount,
                    COALESCE(processedCount, 0) AS processedCount,
                    importedCount, COALESCE(insertedCount, 0) AS insertedCount,
                    COALESCE(updatedCount, 0) AS updatedCount, skippedCount, failedCount,
                    COALESCE(currentRow, 0) AS currentRow, startedTime, finishedTime, errorMessage
             FROM importTasks WHERE sourceType = 'xlsxCatalog' AND status IN ('pending', 'running')
             ORDER BY startedTime DESC LIMIT 1",
        )
        .fetch_optional(pool)
        .await?)
    }

    pub async fn recover_stale_tasks(pool: &SqlitePool) -> AppResult<()> {
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "UPDATE importTasks SET status='failed', finishedTime=?, updatedTime=?,
                    errorMessage='服务器重启，导入任务已中断，请重新选择文件导入'
             WHERE sourceType='xlsxCatalog' AND status IN ('pending', 'running')",
        )
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;
        Ok(())
    }

    async fn mark_failed(pool: &SqlitePool, task_id: &str, message: &str) -> AppResult<()> {
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "UPDATE importTasks SET status='failed', errorMessage=?, finishedTime=?, updatedTime=?
             WHERE taskId=? AND sourceType='xlsxCatalog'",
        )
        .bind(message.chars().take(1000).collect::<String>())
        .bind(now)
        .bind(now)
        .bind(task_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    async fn run_import(pool: &SqlitePool, task_id: &str, path: &Path) -> AppResult<()> {
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "UPDATE importTasks SET status='running', startedTime=?, updatedTime=? WHERE taskId=? AND sourceType='xlsxCatalog'",
        )
        .bind(now)
        .bind(now)
        .bind(task_id)
        .execute(pool)
        .await?;

        let dicts = Self::load_dicts(pool).await?;
        let (sender, mut receiver) = mpsc::channel::<Result<ImportBatch, String>>(4);
        let parse_path = path.to_path_buf();
        let parser = tokio::task::spawn_blocking(move || parse_xlsx(&parse_path, sender));
        let mut inserted = 0_i64;
        let mut updated = 0_i64;
        let mut last_warning = None;

        while let Some(message) = receiver.recv().await {
            let batch = message.map_err(|message| AppError::BadRequest(message))?;
            let (batch_inserted, batch_updated) =
                Self::write_batch(pool, task_id, &batch.rows, &dicts).await?;
            inserted += batch_inserted;
            updated += batch_updated;
            if batch.warning.is_some() {
                last_warning = batch.warning.clone();
            }
            sqlx::query(
                "UPDATE importTasks SET totalCount=?, processedCount=?, importedCount=?,
                        insertedCount=?, updatedCount=?, skippedCount=?, failedCount=?, currentRow=?, updatedTime=?
                 WHERE taskId=? AND sourceType='xlsxCatalog'",
            )
            .bind(batch.total).bind(batch.processed).bind(inserted + updated)
            .bind(inserted).bind(updated).bind(batch.skipped).bind(batch.failed)
            .bind(batch.current_row).bind(Utc::now().timestamp_millis()).bind(task_id)
            .execute(pool).await?;
        }
        parser
            .await
            .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
            .map_err(AppError::BadRequest)?;

        let finished = Utc::now().timestamp_millis();
        let task = Self::get_task(pool, task_id).await?;
        let batch_name = format!("Excel导入 {}", task.file_name);
        let mut tx = pool.begin().await?;
        sqlx::query("UPDATE songBatches SET isNewBatch=0")
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO songBatches (batchId, batchName, batchType, isNewBatch, songCount, createdTime)
             VALUES (?, ?, 'xlsxCatalog', 1, ?, ?)
             ON CONFLICT(batchId) DO UPDATE SET batchName=excluded.batchName, songCount=excluded.songCount",
        ).bind(task_id).bind(batch_name).bind(inserted).bind(finished).execute(&mut *tx).await?;
        sqlx::query(
            "UPDATE singers SET songCount=(SELECT COUNT(*) FROM songSingers ss WHERE ss.singerNo=singers.singerNo), updatedTime=?",
        ).bind(finished).execute(&mut *tx).await?;
        sqlx::query(
            "UPDATE importTasks SET status='completed', finishedTime=?, updatedTime=?, errorMessage=? WHERE taskId=? AND sourceType='xlsxCatalog'",
        ).bind(finished).bind(finished).bind(last_warning).bind(task_id).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }

    async fn load_dicts(pool: &SqlitePool) -> AppResult<HashMap<String, HashMap<String, String>>> {
        let rows = sqlx::query("SELECT dictGroup, dictCode, dictName FROM dicts")
            .fetch_all(pool)
            .await?;
        let mut groups: HashMap<String, HashMap<String, String>> = HashMap::new();
        for row in rows {
            groups
                .entry(row.get::<String, _>("dictGroup"))
                .or_default()
                .insert(row.get("dictCode"), row.get("dictName"));
        }
        Ok(groups)
    }

    async fn write_batch(
        pool: &SqlitePool,
        task_id: &str,
        rows: &[CatalogSong],
        dicts: &HashMap<String, HashMap<String, String>>,
    ) -> AppResult<(i64, i64)> {
        if rows.is_empty() {
            return Ok((0, 0));
        }

        // 仅查询当前批次中的歌曲，避免每批都扫描整张歌曲表。
        // 每批最多 500 行，绑定参数数量保持在 SQLite 限制内。
        let mut existing_builder =
            QueryBuilder::<Sqlite>::new("SELECT songNo, fileExists FROM songs WHERE songNo IN (");
        let mut separated = existing_builder.separated(",");
        for row in rows {
            separated.push_bind(&row.song_no);
        }
        separated.push_unseparated(")");
        let existing: HashMap<String, i64> = existing_builder
            .build()
            .fetch_all(pool)
            .await?
            .into_iter()
            .map(|row| {
                (
                    row.get::<String, _>("songNo"),
                    row.get::<i64, _>("fileExists"),
                )
            })
            .collect();

        let now = Utc::now().timestamp_millis();
        let mut tx = pool.begin().await?;

        let mut songs_builder = QueryBuilder::<Sqlite>::new(
            r#"INSERT INTO songs (
                songNo, songName, primarySingerNo, primarySingerName, singerNames,
                initialKey, languageCode, languageName, categoryCode, categoryName, versionName,
                track, scoreEnabled, videoFileType, relativePath, fileName, fileExists, addedTime,
                addedBatchId, clickTime, sourceType, sourceSongId, createdTime, updatedTime
            ) "#,
        );
        songs_builder.push_values(rows, |mut values, song| {
            let language_name = dicts
                .get("language")
                .and_then(|items| items.get(&song.language_code))
                .cloned();
            let category_name = dicts
                .get("classify")
                .and_then(|items| items.get(&song.category_code))
                .cloned();
            let relative_path = if song.storage_folder.is_empty() {
                None
            } else {
                Some(format!(
                    "V10/{}/",
                    song.storage_folder.trim_matches('/').replace('\\', "/")
                ))
            };
            let file_name = format!(
                "{}.{}",
                song.song_no,
                song.video_file_type.trim_start_matches('.')
            );
            let initial_key = format!("{} {}", song.song_initial, song.singer_initial)
                .trim()
                .to_string();

            values
                .push_bind(&song.song_no)
                .push_bind(&song.song_name)
                .push_bind(&song.singer_no)
                .push_bind(&song.singer_name)
                .push_bind(&song.singer_name)
                .push_bind(initial_key)
                .push_bind(&song.language_code)
                .push_bind(language_name)
                .push_bind(&song.category_code)
                .push_bind(category_name)
                .push_bind(&song.version_name)
                .push_bind(song.track)
                .push_bind(0_i32)
                .push_bind(&song.video_file_type)
                .push_bind(relative_path)
                .push_bind(file_name)
                .push_bind(0_i64)
                .push_bind(now)
                .push_bind(task_id)
                .push_bind(song.click_time)
                .push_bind("xlsxCatalog")
                .push_bind(song.row_number.to_string())
                .push_bind(now)
                .push_bind(now);
        });
        songs_builder.push(
            r#" ON CONFLICT(songNo) DO UPDATE SET
                songName=excluded.songName,
                primarySingerNo=excluded.primarySingerNo,
                primarySingerName=excluded.primarySingerName,
                singerNames=excluded.singerNames,
                initialKey=excluded.initialKey,
                languageCode=excluded.languageCode,
                languageName=excluded.languageName,
                categoryCode=excluded.categoryCode,
                categoryName=excluded.categoryName,
                versionName=excluded.versionName,
                track=excluded.track,
                scoreEnabled=CASE WHEN songs.fileExists=1 THEN songs.scoreEnabled ELSE 0 END,
                videoFileType=CASE WHEN songs.fileExists=1 THEN songs.videoFileType ELSE excluded.videoFileType END,
                relativePath=CASE WHEN songs.fileExists=1 THEN songs.relativePath ELSE excluded.relativePath END,
                fileName=CASE WHEN songs.fileExists=1 THEN songs.fileName ELSE excluded.fileName END,
                clickTime=excluded.clickTime,
                updatedTime=excluded.updatedTime"#,
        );
        songs_builder.build().execute(&mut *tx).await?;

        let mut singers = HashMap::<String, CatalogSinger>::new();
        let mut relations = Vec::<CatalogSongSinger>::new();
        for song in rows {
            let mut linked_singers = HashSet::new();
            let mut sort_order = 0_i32;
            for (index, singer_no) in song.singer_nos.iter().enumerate() {
                if !linked_singers.insert(singer_no.as_str()) {
                    continue;
                }
                let singer_name = song
                    .singer_names
                    .get(index)
                    .cloned()
                    .unwrap_or_else(|| song.singer_name.clone());
                let initial_key = song.singer_initials.get(index).cloned().unwrap_or_default();
                let sex_code = aligned_value(&song.sex_codes, index);
                let region_code = aligned_value(&song.region_codes, index);
                let sex_name = dicts
                    .get("sex")
                    .and_then(|items| items.get(&sex_code))
                    .cloned();
                let region_name = dicts
                    .get("region")
                    .and_then(|items| items.get(&region_code))
                    .cloned();

                singers.insert(
                    singer_no.clone(),
                    CatalogSinger {
                        singer_no: singer_no.clone(),
                        singer_name: singer_name.clone(),
                        initial_key,
                        region_code,
                        region_name,
                        sex_code,
                        sex_name,
                    },
                );
                relations.push(CatalogSongSinger {
                    song_no: song.song_no.clone(),
                    singer_no: singer_no.clone(),
                    singer_name,
                    language_code: song.language_code.clone(),
                    category_code: song.category_code.clone(),
                    file_exists: existing.get(&song.song_no).copied().unwrap_or(0),
                    click_time: song.click_time,
                    sort_order,
                });
                sort_order += 1;
            }
        }

        let singers = singers.into_values().collect::<Vec<_>>();
        const SQLITE_SAFE_BIND_LIMIT: usize = 30_000;
        const SINGER_BIND_COUNT: usize = 11;
        for chunk in singers.chunks(SQLITE_SAFE_BIND_LIMIT / SINGER_BIND_COUNT) {
            let mut builder = QueryBuilder::<Sqlite>::new(
                r#"INSERT INTO singers (
                    singerNo, singerName, initialKey, regionCode, regionName, sexCode, sexName,
                    sourceType, sourceSingerId, createdTime, updatedTime
                ) "#,
            );
            builder.push_values(chunk, |mut values, singer| {
                values
                    .push_bind(&singer.singer_no)
                    .push_bind(&singer.singer_name)
                    .push_bind(&singer.initial_key)
                    .push_bind(&singer.region_code)
                    .push_bind(&singer.region_name)
                    .push_bind(&singer.sex_code)
                    .push_bind(&singer.sex_name)
                    .push_bind("xlsxCatalog")
                    .push_bind(&singer.singer_no)
                    .push_bind(now)
                    .push_bind(now);
            });
            builder.push(
                r#" ON CONFLICT(singerNo) DO UPDATE SET
                    singerName=excluded.singerName,
                    initialKey=excluded.initialKey,
                    regionCode=excluded.regionCode,
                    regionName=excluded.regionName,
                    sexCode=excluded.sexCode,
                    sexName=excluded.sexName,
                    updatedTime=excluded.updatedTime"#,
            );
            builder.build().execute(&mut *tx).await?;
        }

        let mut delete_relations =
            QueryBuilder::<Sqlite>::new("DELETE FROM songSingers WHERE songNo IN (");
        let mut separated = delete_relations.separated(",");
        for song in rows {
            separated.push_bind(&song.song_no);
        }
        separated.push_unseparated(")");
        delete_relations.build().execute(&mut *tx).await?;

        const RELATION_BIND_COUNT: usize = 8;
        for chunk in relations.chunks(SQLITE_SAFE_BIND_LIMIT / RELATION_BIND_COUNT) {
            let mut builder = QueryBuilder::<Sqlite>::new(
                r#"INSERT INTO songSingers (
                    songNo, singerNo, singerName, languageCode, categoryCode,
                    fileExists, clickTime, sortOrder
                ) "#,
            );
            builder.push_values(chunk, |mut values, relation| {
                values
                    .push_bind(&relation.song_no)
                    .push_bind(&relation.singer_no)
                    .push_bind(&relation.singer_name)
                    .push_bind(&relation.language_code)
                    .push_bind(&relation.category_code)
                    .push_bind(relation.file_exists)
                    .push_bind(relation.click_time)
                    .push_bind(relation.sort_order);
            });
            builder.build().execute(&mut *tx).await?;
        }

        let mut search_builder = QueryBuilder::<Sqlite>::new(
            r#"INSERT INTO songSearch (
                songNo, songName, singerNames, nameKey, initialKey, languageCode,
                categoryCode, primarySingerNo, fileExists, addedTime, addedBatchId, clickTime
            )
            SELECT songNo, songName, COALESCE(singerNames,''),
                TRIM(songName || ' ' || COALESCE(singerNames,'')), COALESCE(initialKey,''),
                languageCode, categoryCode, primarySingerNo, fileExists, addedTime, addedBatchId, clickTime
            FROM songs WHERE songNo IN ("#,
        );
        let mut separated = search_builder.separated(",");
        for song in rows {
            separated.push_bind(&song.song_no);
        }
        separated.push_unseparated(")");
        search_builder.push(
            r#" ON CONFLICT(songNo) DO UPDATE SET
                songName=excluded.songName,
                singerNames=excluded.singerNames,
                nameKey=excluded.nameKey,
                initialKey=excluded.initialKey,
                languageCode=excluded.languageCode,
                categoryCode=excluded.categoryCode,
                primarySingerNo=excluded.primarySingerNo,
                fileExists=excluded.fileExists,
                clickTime=excluded.clickTime"#,
        );
        search_builder.build().execute(&mut *tx).await?;

        tx.commit().await?;
        let updated = rows
            .iter()
            .filter(|row| existing.contains_key(&row.song_no))
            .count() as i64;
        Ok((rows.len() as i64 - updated, updated))
    }
}

fn aligned_value(values: &[String], index: usize) -> String {
    values
        .get(index)
        .or_else(|| values.first())
        .cloned()
        .unwrap_or_default()
}

fn split_values(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn parse_i32(value: &str) -> i32 {
    value.trim().parse().unwrap_or(0)
}
fn parse_i64(value: &str) -> i64 {
    value.trim().parse().unwrap_or(0)
}
fn parse_xlsx(
    path: &Path,
    sender: mpsc::Sender<Result<ImportBatch, String>>,
) -> Result<(), String> {
    let file = File::open(path).map_err(|e| format!("无法打开 Excel 文件: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("不是有效的 XLSX 文件: {e}"))?;
    let shared = load_shared_strings(&mut archive)?;
    let sheet_name = (0..archive.len())
        .filter_map(|i| archive.name_for_index(i).map(str::to_string))
        .filter(|name| name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml"))
        .min()
        .ok_or_else(|| "Excel 中没有工作表".to_string())?;
    let sheet = archive.by_name(&sheet_name).map_err(|e| e.to_string())?;
    let mut reader = Reader::from_reader(BufReader::new(sheet));
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut headers: HashMap<String, usize> = HashMap::new();
    let mut current_cells: HashMap<usize, String> = HashMap::new();
    let mut current_col = 0usize;
    let mut current_type = String::new();
    let mut current_value = String::new();
    let mut in_value = false;
    let mut current_row = 0_i64;
    let mut total = 0_i64;
    let mut rows = Vec::with_capacity(BATCH_SIZE);
    let mut processed = 0_i64;
    let mut skipped = 0_i64;
    let mut failed = 0_i64;
    let mut warnings = Vec::new();
    let mut seen = HashSet::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => match event.local_name().as_ref() {
                b"dimension" => {
                    if let Some(value) = attr(&event, b"ref")? {
                        total = value
                            .rsplit_once(':')
                            .and_then(|(_, end)| row_number(end))
                            .unwrap_or(1)
                            .saturating_sub(1);
                    }
                }
                b"row" => {
                    current_cells.clear();
                    current_row = attr(&event, b"r")?
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(current_row + 1);
                }
                b"c" => {
                    current_col = attr(&event, b"r")?
                        .and_then(|v| column_index(&v))
                        .unwrap_or(0);
                    current_type = attr(&event, b"t")?.unwrap_or_default();
                    current_value.clear();
                }
                b"v" | b"t" => {
                    in_value = true;
                    current_value.clear();
                }
                _ => {}
            },
            Ok(Event::Empty(event)) if event.local_name().as_ref() == b"dimension" => {
                if let Some(value) = attr(&event, b"ref")? {
                    total = value
                        .rsplit_once(':')
                        .and_then(|(_, end)| row_number(end))
                        .unwrap_or(1)
                        .saturating_sub(1);
                }
            }
            Ok(Event::Text(event)) if in_value => {
                current_value.push_str(&event.decode().map_err(|e| e.to_string())?)
            }
            Ok(Event::End(event)) => match event.local_name().as_ref() {
                b"v" | b"t" => in_value = false,
                b"c" => {
                    let value = if current_type == "s" && !current_value.is_empty() {
                        current_value
                            .parse::<usize>()
                            .ok()
                            .and_then(|i| shared.get(i))
                            .cloned()
                            .unwrap_or_default()
                    } else {
                        current_value.clone()
                    };
                    current_cells.insert(current_col, value);
                }
                b"row" => {
                    if current_row == 1 {
                        headers = current_cells
                            .iter()
                            .map(|(k, v)| (v.trim().to_string(), *k))
                            .collect();
                        let missing: Vec<_> = REQUIRED_HEADERS
                            .iter()
                            .filter(|h| !headers.contains_key(**h))
                            .copied()
                            .collect();
                        if !missing.is_empty() {
                            return Err(format!("Excel 缺少必要字段: {}", missing.join(", ")));
                        }
                    } else if current_row > 1 {
                        processed += 1;
                        let get = |name: &str| {
                            headers
                                .get(name)
                                .and_then(|i| current_cells.get(i))
                                .map(|v| v.trim())
                                .unwrap_or("")
                        };
                        let song_no = get("song_no").to_string();
                        let song_name = get("song_name").to_string();
                        if song_no.is_empty()
                            || song_name.is_empty()
                            || get("singer_no").is_empty()
                            || get("singer_name").is_empty()
                            || get("video_file_type").is_empty()
                        {
                            failed += 1;
                            if warnings.len() < 5 {
                                warnings.push(format!(
                                    "第 {current_row} 行缺少歌曲编号、歌名、歌手或视频格式"
                                ));
                            }
                        } else if !seen.insert(song_no.clone()) {
                            skipped += 1;
                            if warnings.len() < 5 {
                                warnings
                                    .push(format!("第 {current_row} 行歌曲编号重复: {song_no}"));
                            }
                        // Import the complete catalog: upstream song/singer block flags must not
                        // remove a song that may have a valid local media file.
                        } else if get("song_local_disabled") != "0" {
                            skipped += 1;
                        } else {
                            let singer_nos = split_values(get("singer_no"));
                            let singer_names = (1..=12)
                                .map(|i| get(&format!("singer_name{i}")).to_string())
                                .filter(|v| !v.is_empty())
                                .collect::<Vec<_>>();
                            let singer_initials = (1..=12)
                                .map(|i| get(&format!("singer_name_first_char{i}")).to_string())
                                .filter(|v| !v.is_empty())
                                .collect::<Vec<_>>();
                            rows.push(CatalogSong {
                                row_number: current_row - 1,
                                song_no,
                                song_name,
                                song_initial: get("song_name_first_char").to_string(),
                                track: parse_i32(get("track")),
                                language_code: get("language_code").to_string(),
                                category_code: get("classify_code").to_string(),
                                version_name: get("song_version_name").to_string(),
                                click_time: parse_i64(get("click_time")),
                                video_file_type: get("video_file_type").to_string(),
                                storage_folder: get("storage_folder_pre_name").to_string(),
                                singer_no: get("singer_no").to_string(),
                                singer_name: get("singer_name").to_string(),
                                singer_initial: get("singer_name_first_char").to_string(),
                                singer_nos,
                                singer_names,
                                singer_initials,
                                sex_codes: split_values(get("sex")),
                                region_codes: split_values(get("region")),
                            });
                        }
                        if processed % BATCH_SIZE as i64 == 0 {
                            let warning = if warnings.is_empty() {
                                None
                            } else {
                                Some(warnings.join("；"))
                            };
                            sender
                                .blocking_send(Ok(ImportBatch {
                                    rows: std::mem::take(&mut rows),
                                    processed,
                                    skipped,
                                    failed,
                                    current_row,
                                    total,
                                    warning,
                                }))
                                .map_err(|_| "导入任务已停止".to_string())?;
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(format!("Excel XML 解析失败: {error}")),
        }
        buf.clear();
    }
    if !rows.is_empty() || processed % BATCH_SIZE as i64 != 0 {
        let warning = if warnings.is_empty() {
            None
        } else {
            Some(warnings.join("；"))
        };
        sender
            .blocking_send(Ok(ImportBatch {
                rows,
                processed,
                skipped,
                failed,
                current_row,
                total: total.max(processed),
                warning,
            }))
            .map_err(|_| "导入任务已停止".to_string())?;
    }
    Ok(())
}

fn load_shared_strings<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<Vec<String>, String> {
    let Ok(file) = archive.by_name("xl/sharedStrings.xml") else {
        return Ok(Vec::new());
    };
    let mut reader = Reader::from_reader(BufReader::new(file));
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut strings = Vec::new();
    let mut value = String::new();
    let mut in_si = false;
    let mut in_t = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) if event.local_name().as_ref() == b"si" => {
                in_si = true;
                value.clear();
            }
            Ok(Event::Start(event)) if event.local_name().as_ref() == b"t" => in_t = true,
            Ok(Event::Text(event)) if in_si && in_t => {
                value.push_str(&event.decode().map_err(|e| e.to_string())?)
            }
            Ok(Event::End(event)) if event.local_name().as_ref() == b"t" => in_t = false,
            Ok(Event::End(event)) if event.local_name().as_ref() == b"si" => {
                strings.push(std::mem::take(&mut value));
                in_si = false;
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(format!("共享字符串解析失败: {error}")),
        }
        buf.clear();
    }
    Ok(strings)
}

fn attr(event: &quick_xml::events::BytesStart<'_>, name: &[u8]) -> Result<Option<String>, String> {
    for attribute in event.attributes().with_checks(false) {
        let attribute = attribute.map_err(|e| e.to_string())?;
        if attribute.key.local_name().as_ref() == name {
            return attribute
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .map(|v| Some(v.into_owned()))
                .map_err(|e| e.to_string());
        }
    }
    Ok(None)
}

fn column_index(reference: &str) -> Option<usize> {
    let mut index = 0usize;
    let mut found = false;
    for byte in reference.bytes().take_while(|b| b.is_ascii_alphabetic()) {
        found = true;
        index = index
            .checked_mul(26)?
            .checked_add((byte.to_ascii_uppercase() - b'A' + 1) as usize)?;
    }
    found.then_some(index - 1)
}

fn row_number(reference: &str) -> Option<i64> {
    reference
        .chars()
        .skip_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .parse()
        .ok()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::io::Write;

    use sqlx::sqlite::SqlitePoolOptions;
    use tempfile::TempDir;
    use zip::{write::SimpleFileOptions, ZipWriter};

    use super::*;

    fn xml_escape(value: &str) -> String {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }

    fn column_name(mut index: usize) -> String {
        let mut result = String::new();
        index += 1;
        while index > 0 {
            let remainder = (index - 1) % 26;
            result.insert(0, (b'A' + remainder as u8) as char);
            index = (index - 1) / 26;
        }
        result
    }

    fn write_fixture(path: &Path, headers: &[String], rows: &[Vec<String>]) {
        let file = File::create(path).unwrap();
        let mut archive = ZipWriter::new(file);
        archive
            .start_file("xl/worksheets/sheet1.xml", SimpleFileOptions::default())
            .unwrap();
        let last_column = column_name(headers.len() - 1);
        write!(
            archive,
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:{}{}"/><sheetData>"#,
            last_column,
            rows.len() + 1
        )
        .unwrap();
        let mut all_rows = Vec::with_capacity(rows.len() + 1);
        all_rows.push(headers.to_vec());
        all_rows.extend_from_slice(rows);
        for (row_index, row) in all_rows.iter().enumerate() {
            write!(archive, "<row r=\"{}\">", row_index + 1).unwrap();
            for (column_index, value) in row.iter().enumerate() {
                write!(
                    archive,
                    "<c r=\"{}{}\" t=\"inlineStr\"><is><t>{}</t></is></c>",
                    column_name(column_index),
                    row_index + 1,
                    xml_escape(value)
                )
                .unwrap();
            }
            write!(archive, "</row>").unwrap();
        }
        write!(archive, "</sheetData></worksheet>").unwrap();
        archive.finish().unwrap();
    }

    fn catalog_row(headers: &[String], overrides: &[(&str, &str)]) -> Vec<String> {
        let mut values = HashMap::from([
            ("song_no", "100"),
            ("song_name", "Song"),
            ("song_name_first_char", "S"),
            ("track", "1"),
            ("language_code", "1"),
            ("classify_code", "10"),
            ("score_enabled", "1"),
            ("song_version_name", "Original"),
            ("click_time", "100"),
            ("song_local_disabled", "0"),
            ("video_file_type", "mp4"),
            ("storage_folder_pre_name", "new_folder"),
            ("singer_no", "S1"),
            ("singer_name", "Singer One"),
            ("singer_name_first_char", "SO"),
            ("sex", "1"),
            ("region", "1"),
            ("singer_block_list", "0"),
            ("song_block", "0"),
            ("singer_name1", "Singer One"),
            ("singer_name2", ""),
            ("singer_name_first_char1", "SO"),
            ("singer_name_first_char2", ""),
        ]);
        for (key, value) in overrides {
            values.insert(key, value);
        }
        headers
            .iter()
            .map(|header| {
                values
                    .get(header.as_str())
                    .copied()
                    .unwrap_or("")
                    .to_string()
            })
            .collect()
    }

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../../migrations/song_db_init.sql"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/song_db_002_catalog_import.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn imports_catalog_and_preserves_existing_local_paths() {
        let pool = test_pool().await;
        for (group, code, name) in [
            ("language", "1", "Mandarin"),
            ("classify", "10", "Pop"),
            ("sex", "1", "Male"),
            ("sex", "2", "Female"),
            ("region", "1", "CN"),
            ("region", "2", "US"),
        ] {
            sqlx::query("INSERT INTO dicts (dictGroup, dictCode, dictName) VALUES (?, ?, ?)")
                .bind(group)
                .bind(code)
                .bind(name)
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query(
            "INSERT INTO songs (songNo, songName, primarySingerNo, primarySingerName, singerNames,
                initialKey, languageCode, categoryCode, videoFileType, relativePath, fileName,
                absolutePath, fileExists, addedTime, addedBatchId, createdTime, updatedTime)
             VALUES ('100', 'Old Song', 'OLD', 'Old Singer', 'Old Singer', 'OS', '1', '10',
                'mp4', 'Actual/', 'actual.mp4', 'D:/music/actual.mp4', 1, 11, 'old-batch', 11, 11)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO songSearch (songNo, songName, singerNames, nameKey, fileExists)
             VALUES ('100', 'Old Song', 'Old Singer', 'Old Song Old Singer', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO singers (singerNo, singerName, createdTime, updatedTime)
             VALUES ('OLD', 'Old Singer', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO songSingers (songNo, singerNo, singerName, fileExists)
             VALUES ('100', 'OLD', 'Old Singer', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let headers = REQUIRED_HEADERS
            .iter()
            .map(|value| value.to_string())
            .chain(
                [
                    "singer_name1",
                    "singer_name2",
                    "singer_name_first_char1",
                    "singer_name_first_char2",
                    "singer_block_list",
                    "song_block",
                ]
                .into_iter()
                .map(str::to_string),
            )
            .collect::<Vec<_>>();
        let rows = vec![
            catalog_row(
                &headers,
                &[
                    ("song_no", "100"),
                    ("song_name", "Existing Updated"),
                    ("singer_no", "S1,S2"),
                    ("singer_name", "Singer One,Singer Two"),
                    ("singer_name_first_char", "SO,ST"),
                    ("singer_name1", "Singer One"),
                    ("singer_name2", "Singer Two"),
                    ("singer_name_first_char1", "SO"),
                    ("singer_name_first_char2", "ST"),
                    ("sex", "1,2"),
                    ("region", "1,2"),
                ],
            ),
            catalog_row(
                &headers,
                &[
                    ("song_no", "200"),
                    ("song_name", "New Song"),
                    ("singer_no", "S3,S3"),
                    ("singer_name", "Singer Three,Singer Three"),
                    ("singer_name1", "Singer Three"),
                ],
            ),
            catalog_row(
                &headers,
                &[
                    ("song_no", "300"),
                    ("song_name", "Blocked"),
                    ("song_block", "1"),
                ],
            ),
            catalog_row(&headers, &[("song_no", "400"), ("song_name", "")]),
            catalog_row(
                &headers,
                &[
                    ("song_no", "500"),
                    ("song_name", "Locally Disabled"),
                    ("song_local_disabled", "1"),
                ],
            ),
            catalog_row(&headers, &[("song_no", "200"), ("song_name", "Duplicate")]),
        ];
        let temp_dir = TempDir::new().unwrap();
        let xlsx_path = temp_dir.path().join("catalog.xlsx");
        write_fixture(&xlsx_path, &headers, &rows);
        sqlx::query(
            "INSERT INTO importTasks (taskId, sourceType, sourcePath, status, startedTime, updatedTime)
             VALUES ('test-import', 'xlsxCatalog', 'catalog.xlsx', 'pending', 0, 0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        SongDataImportService::run_import(&pool, "test-import", &xlsx_path)
            .await
            .unwrap();
        // Spreadsheet score_enabled=1 cannot enable scoring without encrypted media.
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM songs WHERE scoreEnabled<>0").fetch_one(&pool).await.unwrap(),0);

        let task = SongDataImportService::get_task(&pool, "test-import")
            .await
            .unwrap();
        assert_eq!(task.status, "completed");
        assert_eq!(task.total_count, 6);
        assert_eq!(task.processed_count, 6);
        assert_eq!(task.imported_count, 3);
        assert_eq!(task.inserted_count, 2);
        assert_eq!(task.updated_count, 1);
        assert_eq!(task.skipped_count, 2);
        assert_eq!(task.failed_count, 1);

        let existing = sqlx::query(
            "SELECT songName, primarySingerNo, relativePath, fileName, absolutePath, fileExists
             FROM songs WHERE songNo='100'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(existing.get::<String, _>("songName"), "Existing Updated");
        assert_eq!(existing.get::<String, _>("primarySingerNo"), "S1,S2");
        assert_eq!(existing.get::<String, _>("relativePath"), "Actual/");
        assert_eq!(existing.get::<String, _>("fileName"), "actual.mp4");
        assert_eq!(
            existing.get::<String, _>("absolutePath"),
            "D:/music/actual.mp4"
        );
        assert_eq!(existing.get::<i64, _>("fileExists"), 1);

        let new_song =
            sqlx::query("SELECT relativePath, fileName, fileExists FROM songs WHERE songNo='200'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(new_song.get::<String, _>("relativePath"), "V10/new_folder/");
        assert_eq!(new_song.get::<String, _>("fileName"), "200.mp4");
        assert_eq!(new_song.get::<i64, _>("fileExists"), 0);
        let new_relation_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM songSingers WHERE songNo='200'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(new_relation_count, 1);

        let relations = sqlx::query(
            "SELECT singerNo, singerName, fileExists FROM songSingers WHERE songNo='100' ORDER BY sortOrder",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(relations.len(), 2);
        assert_eq!(relations[0].get::<String, _>("singerNo"), "S1");
        assert_eq!(relations[0].get::<String, _>("singerName"), "Singer One");
        assert_eq!(relations[0].get::<i64, _>("fileExists"), 1);
        assert_eq!(relations[1].get::<String, _>("singerNo"), "S2");
        assert_eq!(relations[1].get::<String, _>("singerName"), "Singer Two");
        assert_eq!(relations[1].get::<i64, _>("fileExists"), 1);

        let search_exists: i64 =
            sqlx::query_scalar("SELECT fileExists FROM songSearch WHERE songNo='100'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(search_exists, 1);
        let upstream_blocked_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM songs WHERE songNo='300'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(upstream_blocked_count, 1);
        let excluded_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM songs WHERE songNo IN ('400','500')")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(excluded_count, 0);
        let batch_song_count: i64 =
            sqlx::query_scalar("SELECT songCount FROM songBatches WHERE batchId='test-import'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(batch_song_count, 2);
        // Verified local flags and format survive a subsequent catalog import.
        sqlx::query("UPDATE songs SET scoreEnabled=1,videoFileType='hvideo' WHERE songNo='100'").execute(&pool).await.unwrap();
        SongDataImportService::run_import(&pool,"test-import",&xlsx_path).await.unwrap();
        let verified:(i32,String)=sqlx::query_as("SELECT scoreEnabled,videoFileType FROM songs WHERE songNo='100'").fetch_one(&pool).await.unwrap();
        assert_eq!(verified,(1,"hvideo".into()));
    }

    #[tokio::test]
    async fn imports_multiple_full_batches() {
        let pool = test_pool().await;
        let headers = REQUIRED_HEADERS
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        let song_no_column = headers.iter().position(|value| value == "song_no").unwrap();
        let song_name_column = headers
            .iter()
            .position(|value| value == "song_name")
            .unwrap();
        let singer_no_column = headers
            .iter()
            .position(|value| value == "singer_no")
            .unwrap();
        let singer_name_column = headers
            .iter()
            .position(|value| value == "singer_name")
            .unwrap();
        let mut rows = Vec::with_capacity(BATCH_SIZE * 2);
        for index in 0..BATCH_SIZE * 2 {
            let mut row = catalog_row(&headers, &[]);
            row[song_no_column] = format!("B{index:06}");
            row[song_name_column] = format!("Batch Song {index}");
            row[singer_no_column] = format!("BS{:03}", index % 50);
            row[singer_name_column] = format!("Batch Singer {}", index % 50);
            rows.push(row);
        }

        let temp_dir = TempDir::new().unwrap();
        let xlsx_path = temp_dir.path().join("bulk-catalog.xlsx");
        write_fixture(&xlsx_path, &headers, &rows);
        sqlx::query(
            "INSERT INTO importTasks (taskId, sourceType, sourcePath, status, startedTime, updatedTime)
             VALUES ('bulk-import', 'xlsxCatalog', 'bulk-catalog.xlsx', 'pending', 0, 0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        SongDataImportService::run_import(&pool, "bulk-import", &xlsx_path)
            .await
            .unwrap();

        let task = SongDataImportService::get_task(&pool, "bulk-import")
            .await
            .unwrap();
        assert_eq!(task.status, "completed");
        assert_eq!(task.inserted_count, (BATCH_SIZE * 2) as i64);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs")
                .fetch_one(&pool)
                .await
                .unwrap(),
            (BATCH_SIZE * 2) as i64
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM singers")
                .fetch_one(&pool)
                .await
                .unwrap(),
            50
        );
    }

    #[tokio::test]
    async fn song_task_queries_do_not_return_singer_tasks() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO importTasks (taskId, sourceType, sourcePath, status, startedTime, updatedTime)
             VALUES ('singer-task', 'singerXlsxCatalog', 'singers.xlsx', 'pending', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert!(SongDataImportService::get_task(&pool, "singer-task")
            .await
            .is_err());
        assert!(SongDataImportService::get_active_task(&pool)
            .await
            .unwrap()
            .is_none());
    }
}
