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
use crate::models::singer_import::SingerImportTask;

// SQLite bundled configuration accepts 32,766 variables. Keep a margin so one
// singer UPSERT can write a much larger batch without exceeding that limit.
const SQLITE_SAFE_BIND_LIMIT: usize = 30_000;
const SINGER_BIND_COUNT: usize = 12;
const BATCH_SIZE: usize = SQLITE_SAFE_BIND_LIMIT / SINGER_BIND_COUNT;
const REQUIRED_HEADERS: &[&str] = &["singer_no", "singer_name"];

#[derive(Debug)]
struct SingerRow {
    singer_no: String,
    singer_name: String,
    initial_key: String,
    region_code: String,
    sex_code: String,
    hit: i64,
    source_singer_id: String,
}

struct ImportBatch {
    rows: Vec<SingerRow>,
    processed: i64,
    skipped: i64,
    failed: i64,
    current_row: i64,
    total: i64,
    warning: Option<String>,
}

pub struct SingerDataImportService;

impl SingerDataImportService {
    pub async fn create_task(
        pool: &SqlitePool,
        file_name: &str,
        temp_path: PathBuf,
    ) -> AppResult<SingerImportTask> {
        let task_id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();
        let result = sqlx::query(
            "INSERT INTO importTasks (taskId, sourceType, sourcePath, status, totalCount, importedCount,
                skippedCount, failedCount, processedCount, insertedCount, updatedCount, currentRow, startedTime, updatedTime)
             VALUES (?, 'singerXlsxCatalog', ?, 'pending', 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)",
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
                tracing::error!(task_id = %worker_task_id, "歌星数据导入失败: {}", error);
                let _ = Self::mark_failed(&worker_pool, &worker_task_id, &error.to_string()).await;
            }
            let _ = tokio::fs::remove_file(&temp_path).await;
        });
        Ok(task)
    }

    pub async fn get_task(pool: &SqlitePool, task_id: &str) -> AppResult<SingerImportTask> {
        sqlx::query_as::<_, SingerImportTask>(
            "SELECT taskId, sourcePath, status, totalCount, processedCount, importedCount,
                    insertedCount, updatedCount, skippedCount, failedCount, currentRow,
                    startedTime, finishedTime, errorMessage
             FROM importTasks WHERE taskId = ? AND sourceType = 'singerXlsxCatalog'",
        )
        .bind(task_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("歌星导入任务不存在".to_string()))
    }

    pub async fn get_active_task(pool: &SqlitePool) -> AppResult<Option<SingerImportTask>> {
        Ok(sqlx::query_as::<_, SingerImportTask>(
            "SELECT taskId, sourcePath, status, totalCount, processedCount, importedCount,
                    insertedCount, updatedCount, skippedCount, failedCount, currentRow,
                    startedTime, finishedTime, errorMessage
             FROM importTasks WHERE sourceType = 'singerXlsxCatalog' AND status IN ('pending', 'running')
             ORDER BY startedTime DESC LIMIT 1",
        )
        .fetch_optional(pool)
        .await?)
    }

    pub async fn recover_stale_tasks(pool: &SqlitePool) -> AppResult<()> {
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "UPDATE importTasks SET status='failed', finishedTime=?, updatedTime=?,
                    errorMessage='服务器重启，歌星导入任务已中断，请重新选择文件导入'
             WHERE sourceType='singerXlsxCatalog' AND status IN ('pending', 'running')",
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
             WHERE taskId=? AND sourceType='singerXlsxCatalog'",
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
        sqlx::query("UPDATE importTasks SET status='running', startedTime=?, updatedTime=? WHERE taskId=? AND sourceType='singerXlsxCatalog'")
            .bind(now).bind(now).bind(task_id).execute(pool).await?;
        let dicts = load_dicts(pool).await?;
        // Load existing numbers once. Querying the same index again for every batch made
        // large singer catalogs considerably slower than song catalog imports.
        let mut existing_singer_nos = load_existing_singer_nos(pool).await?;
        let (sender, mut receiver) = mpsc::channel::<Result<ImportBatch, String>>(4);
        let parse_path = path.to_path_buf();
        let parser = tokio::task::spawn_blocking(move || parse_xlsx(&parse_path, sender));
        let mut inserted = 0_i64;
        let mut updated = 0_i64;
        let mut last_warning = None;

        while let Some(message) = receiver.recv().await {
            let batch = message.map_err(AppError::BadRequest)?;
            let (batch_inserted, batch_updated) =
                write_batch(pool, &batch.rows, &dicts, &mut existing_singer_nos).await?;
            inserted += batch_inserted;
            updated += batch_updated;
            last_warning = batch.warning.clone().or(last_warning);
            sqlx::query(
                "UPDATE importTasks SET totalCount=?, processedCount=?, importedCount=?, insertedCount=?, updatedCount=?, skippedCount=?, failedCount=?, currentRow=?, updatedTime=? WHERE taskId=? AND sourceType='singerXlsxCatalog'",
            )
            .bind(batch.total).bind(batch.processed).bind(inserted + updated).bind(inserted).bind(updated)
            .bind(batch.skipped).bind(batch.failed).bind(batch.current_row).bind(Utc::now().timestamp_millis()).bind(task_id)
            .execute(pool).await?;
        }
        parser
            .await
            .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?
            .map_err(AppError::BadRequest)?;
        let finished = Utc::now().timestamp_millis();
        sqlx::query("UPDATE importTasks SET status='completed', finishedTime=?, updatedTime=?, errorMessage=? WHERE taskId=? AND sourceType='singerXlsxCatalog'")
            .bind(finished).bind(finished).bind(last_warning).bind(task_id).execute(pool).await?;
        Ok(())
    }
}

async fn load_dicts(pool: &SqlitePool) -> AppResult<HashMap<String, HashMap<String, String>>> {
    let rows = sqlx::query("SELECT dictGroup, dictCode, dictName FROM dicts")
        .fetch_all(pool)
        .await?;
    let mut dicts = HashMap::new();
    for row in rows {
        dicts
            .entry(row.get::<String, _>("dictGroup"))
            .or_insert_with(HashMap::new)
            .insert(row.get("dictCode"), row.get("dictName"));
    }
    Ok(dicts)
}

async fn load_existing_singer_nos(pool: &SqlitePool) -> AppResult<HashSet<String>> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT singerNo FROM singers")
            .fetch_all(pool)
            .await?
            .into_iter()
            .collect(),
    )
}

async fn write_batch(
    pool: &SqlitePool,
    rows: &[SingerRow],
    dicts: &HashMap<String, HashMap<String, String>>,
    existing_singer_nos: &mut HashSet<String>,
) -> AppResult<(i64, i64)> {
    if rows.is_empty() {
        return Ok((0, 0));
    }
    if rows.len() > BATCH_SIZE {
        return Err(AppError::Internal(anyhow::anyhow!(
            "歌星写入批次超过 SQLite 参数上限"
        )));
    }
    let updated = rows
        .iter()
        .filter(|row| existing_singer_nos.contains(&row.singer_no))
        .count() as i64;
    let now = Utc::now().timestamp_millis();
    let mut tx = pool.begin().await?;
    let mut builder = QueryBuilder::<Sqlite>::new(
        "INSERT INTO singers (singerNo, singerName, initialKey, regionCode, regionName, sexCode, sexName, hit, sourceType, sourceSingerId, createdTime, updatedTime) ",
    );
    builder.push_values(rows, |mut values, singer| {
        let region_name = dicts.get("region").and_then(|v| v.get(&singer.region_code));
        let sex_name = dicts.get("sex").and_then(|v| v.get(&singer.sex_code));
        values
            .push_bind(&singer.singer_no)
            .push_bind(&singer.singer_name)
            .push_bind(&singer.initial_key)
            .push_bind(&singer.region_code)
            .push_bind(region_name)
            .push_bind(&singer.sex_code)
            .push_bind(sex_name)
            .push_bind(singer.hit)
            .push_bind("singerXlsxCatalog")
            .push_bind(&singer.source_singer_id)
            .push_bind(now)
            .push_bind(now);
    });
    // Do not rewrite unchanged singers. Rewriting an existing catalog needlessly
    // maintained three secondary indexes for every row and was the main slow path.
    builder.push(
        " ON CONFLICT(singerNo) DO UPDATE SET singerName=excluded.singerName, initialKey=excluded.initialKey, regionCode=excluded.regionCode, regionName=excluded.regionName, sexCode=excluded.sexCode, sexName=excluded.sexName, hit=excluded.hit, sourceType=excluded.sourceType, sourceSingerId=excluded.sourceSingerId, updatedTime=excluded.updatedTime \
         WHERE singers.singerName IS NOT excluded.singerName OR singers.initialKey IS NOT excluded.initialKey OR singers.regionCode IS NOT excluded.regionCode OR singers.regionName IS NOT excluded.regionName OR singers.sexCode IS NOT excluded.sexCode OR singers.sexName IS NOT excluded.sexName OR singers.hit IS NOT excluded.hit OR singers.sourceType IS NOT excluded.sourceType OR singers.sourceSingerId IS NOT excluded.sourceSingerId",
    );
    builder.build().execute(&mut *tx).await?;
    tx.commit().await?;

    existing_singer_nos.extend(rows.iter().map(|row| row.singer_no.clone()));
    Ok((rows.len() as i64 - updated, updated))
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
        .find(|name| name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml"))
        .ok_or_else(|| "Excel 中没有工作表".to_string())?;
    let sheet = archive.by_name(&sheet_name).map_err(|e| e.to_string())?;
    let mut reader = Reader::from_reader(BufReader::with_capacity(1024 * 1024, sheet));
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut headers = HashMap::<String, usize>::new();
    let mut cells = vec![String::new(); 15];
    let mut col = 0usize;
    let mut cell_type = String::new();
    let mut cell_value = String::new();
    let mut in_value = false;
    let mut row_num = 0_i64;
    let mut total = 0_i64;
    let mut processed = 0_i64;
    let mut skipped = 0_i64;
    let mut failed = 0_i64;
    let mut seen = HashSet::new();
    let mut rows = Vec::with_capacity(BATCH_SIZE);
    let mut warnings = Vec::new();
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
                    cells.fill(String::new());
                    row_num = attr(&event, b"r")?
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(row_num + 1);
                }
                b"c" => {
                    col = attr(&event, b"r")?
                        .and_then(|v| column_index(&v))
                        .unwrap_or(0);
                    cell_type = attr(&event, b"t")?.unwrap_or_default();
                    cell_value.clear();
                }
                b"v" | b"t" => {
                    in_value = true;
                    cell_value.clear();
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
                cell_value.push_str(&event.decode().map_err(|e| e.to_string())?)
            }
            Ok(Event::End(event)) => match event.local_name().as_ref() {
                b"v" | b"t" => in_value = false,
                b"c" => {
                    let value = if cell_type == "s" {
                        cell_value
                            .parse::<usize>()
                            .ok()
                            .and_then(|i| shared.get(i))
                            .cloned()
                            .unwrap_or_default()
                    } else {
                        cell_value.clone()
                    };
                    if col >= cells.len() {
                        cells.resize(col + 1, String::new());
                    }
                    cells[col] = value;
                }
                b"row" => {
                    if row_num == 1 {
                        headers = cells
                            .iter()
                            .enumerate()
                            .filter(|(_, value)| !value.is_empty())
                            .map(|(index, value)| {
                                (
                                    value.trim().trim_start_matches('\u{feff}').to_lowercase(),
                                    index,
                                )
                            })
                            .collect();
                        let missing: Vec<_> = REQUIRED_HEADERS
                            .iter()
                            .filter(|header| !headers.contains_key(**header))
                            .copied()
                            .collect();
                        if !missing.is_empty() {
                            return Err(format!("Excel 缺少必要字段: {}", missing.join(", ")));
                        }
                    } else if row_num > 1 {
                        processed += 1;
                        let get = |name: &str| {
                            headers
                                .get(name)
                                .and_then(|i| cells.get(*i))
                                .map(|v| v.trim())
                                .unwrap_or("")
                        };
                        let singer_no = get("singer_no").to_string();
                        let singer_name = get("singer_name").to_string();
                        let blocked = get("singer_block_list");
                        if singer_no.is_empty() || singer_name.is_empty() {
                            failed += 1;
                            if warnings.len() < 5 {
                                warnings.push(format!("第 {row_num} 行缺少歌星编号或歌星名称"));
                            }
                        } else if !seen.insert(singer_no.clone()) {
                            skipped += 1;
                        } else if !blocked.is_empty() && !all_zero(blocked) {
                            skipped += 1;
                        } else {
                            rows.push(SingerRow {
                                singer_no: singer_no.clone(),
                                singer_name,
                                initial_key: first_value(get("singer_name_first_char"))
                                    .or_else(|| first_value(get("initial_key")))
                                    .unwrap_or_default(),
                                region_code: first_value(
                                    get("region").if_empty(get("region_code")),
                                )
                                .unwrap_or_default(),
                                sex_code: first_value(get("sex").if_empty(get("sex_code")))
                                    .unwrap_or_default(),
                                hit: get("hit").parse().unwrap_or_default(),
                                source_singer_id: first_value(get("source_singer_id"))
                                    .or_else(|| first_value(get("singer_id")))
                                    .unwrap_or(singer_no),
                            });
                        }
                        if processed % BATCH_SIZE as i64 == 0 {
                            sender
                                .blocking_send(Ok(ImportBatch {
                                    rows: std::mem::take(&mut rows),
                                    processed,
                                    skipped,
                                    failed,
                                    current_row: row_num,
                                    total,
                                    warning: (!warnings.is_empty()).then(|| warnings.join("；")),
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
        sender
            .blocking_send(Ok(ImportBatch {
                rows,
                processed,
                skipped,
                failed,
                current_row: row_num,
                total: total.max(processed),
                warning: (!warnings.is_empty()).then(|| warnings.join("；")),
            }))
            .map_err(|_| "导入任务已停止".to_string())?;
    }
    Ok(())
}

fn first_value(value: &str) -> Option<String> {
    value
        .split(',')
        .map(str::trim)
        .find(|v| !v.is_empty())
        .map(ToOwned::to_owned)
}
trait EmptyFallback {
    fn if_empty<'a>(&'a self, fallback: &'a str) -> &'a str;
}
impl EmptyFallback for str {
    fn if_empty<'a>(&'a self, fallback: &'a str) -> &'a str {
        if self.is_empty() {
            fallback
        } else {
            self
        }
    }
}
fn all_zero(value: &str) -> bool {
    let values = value
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>();
    !values.is_empty() && values.iter().all(|v| *v == "0")
}
fn attr(event: &quick_xml::events::BytesStart<'_>, name: &[u8]) -> Result<Option<String>, String> {
    for attribute in event.attributes().with_checks(false) {
        let attribute = attribute.map_err(|error| error.to_string())?;
        if attribute.key.local_name().as_ref() == name {
            return attribute
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .map(|value| Some(value.into_owned()))
                .map_err(|error| error.to_string());
        }
    }
    Ok(None)
}
fn column_index(value: &str) -> Option<usize> {
    let letters = value.bytes().take_while(|b| b.is_ascii_alphabetic());
    let mut index = 0usize;
    for byte in letters {
        index = index * 26 + (byte.to_ascii_uppercase() - b'A' + 1) as usize;
    }
    index.checked_sub(1)
}
fn row_number(value: &str) -> Option<i64> {
    value
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()
}
fn load_shared_strings<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<Vec<String>, String> {
    let Ok(file) = archive.by_name("xl/sharedStrings.xml") else {
        return Ok(Vec::new());
    };
    let mut reader = Reader::from_reader(BufReader::with_capacity(1024 * 1024, file));
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut strings = Vec::new();
    let mut current = String::new();
    let mut in_si = false;
    let mut in_t = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) if e.local_name().as_ref() == b"si" => {
                in_si = true;
                current.clear();
            }
            Ok(Event::Start(e)) if e.local_name().as_ref() == b"t" && in_si => in_t = true,
            Ok(Event::Text(e)) if in_t => current.push_str(&e.decode().map_err(|e| e.to_string())?),
            Ok(Event::End(e)) if e.local_name().as_ref() == b"t" => in_t = false,
            Ok(Event::End(e)) if e.local_name().as_ref() == b"si" => {
                strings.push(current.clone());
                in_si = false;
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("共享字符串解析失败: {e}")),
        };
        buf.clear();
    }
    Ok(strings)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use sqlx::sqlite::SqlitePoolOptions;
    use tempfile::TempDir;
    use zip::{write::SimpleFileOptions, ZipWriter};

    use super::*;

    fn write_shared_string_fixture(path: &Path) {
        let file = File::create(path).unwrap();
        let mut archive = ZipWriter::new(file);
        archive
            .start_file("xl/sharedStrings.xml", SimpleFileOptions::default())
            .unwrap();
        write!(
            archive,
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="10" uniqueCount="10"><si><t>singer_id</t></si><si><t>singer_no</t></si><si><t>singer_name</t></si><si><t>singer_name_first_char</t></si><si><t>region</t></si><si><t>sex</t></si><si><t>101</t></si><si><t>S1001</t></si><si><t>Test Singer</t></si><si><t>TS</t></si></sst>"#
        )
        .unwrap();
        archive
            .start_file("xl/worksheets/sheet1.xml", SimpleFileOptions::default())
            .unwrap();
        write!(
            archive,
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:G2"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c><c r="G1" t="inlineStr"><is><t>hit</t></is></c></row><row r="2"><c r="A2" t="s"><v>6</v></c><c r="B2" t="s"><v>7</v></c><c r="C2" t="s"><v>8</v></c><c r="D2" t="s"><v>9</v></c><c r="E2"><v>16</v></c><c r="F2"><v>2</v></c><c r="G2"><v>88</v></c></row></sheetData></worksheet>"#
        )
        .unwrap();
        archive.finish().unwrap();
    }

    #[test]
    fn parses_shared_string_headers_and_source_singer_id() {
        let temp_dir = TempDir::new().unwrap();
        let xlsx_path = temp_dir.path().join("singers.xlsx");
        write_shared_string_fixture(&xlsx_path);
        let (sender, mut receiver) = mpsc::channel(4);

        parse_xlsx(&xlsx_path, sender).unwrap();
        let batch = receiver.try_recv().unwrap().unwrap();

        assert_eq!(batch.processed, 1);
        assert_eq!(batch.rows.len(), 1);
        assert_eq!(batch.rows[0].singer_no, "S1001");
        assert_eq!(batch.rows[0].singer_name, "Test Singer");
        assert_eq!(batch.rows[0].initial_key, "TS");
        assert_eq!(batch.rows[0].hit, 88);
        assert_eq!(batch.rows[0].source_singer_id, "101");
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
    async fn batch_upsert_reports_inserted_and_updated_rows() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO dicts (dictGroup, dictCode, dictName) VALUES
             ('region', '1', 'China'), ('sex', '2', 'Female')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO singers (singerNo, singerName, createdTime, updatedTime)
             VALUES ('S1', 'Old Name', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let rows = vec![
            SingerRow {
                singer_no: "S1".to_string(),
                singer_name: "Updated Name".to_string(),
                initial_key: "UN".to_string(),
                region_code: "1".to_string(),
                sex_code: "2".to_string(),
                hit: 11,
                source_singer_id: "SRC1".to_string(),
            },
            SingerRow {
                singer_no: "S2".to_string(),
                singer_name: "New Singer".to_string(),
                initial_key: "NS".to_string(),
                region_code: "1".to_string(),
                sex_code: "2".to_string(),
                hit: 22,
                source_singer_id: "SRC2".to_string(),
            },
        ];

        let dicts = load_dicts(&pool).await.unwrap();
        let mut existing_singer_nos = load_existing_singer_nos(&pool).await.unwrap();
        let counts = write_batch(&pool, &rows, &dicts, &mut existing_singer_nos)
            .await
            .unwrap();

        assert_eq!(counts, (1, 1));
        let updated = sqlx::query(
            "SELECT singerName, regionName, sexName, hit, sourceType, sourceSingerId
             FROM singers WHERE singerNo='S1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(updated.get::<String, _>("singerName"), "Updated Name");
        assert_eq!(updated.get::<String, _>("regionName"), "China");
        assert_eq!(updated.get::<String, _>("sexName"), "Female");
        assert_eq!(updated.get::<i64, _>("hit"), 11);
        assert_eq!(updated.get::<String, _>("sourceType"), "singerXlsxCatalog");
        assert_eq!(updated.get::<String, _>("sourceSingerId"), "SRC1");
    }

    #[tokio::test]
    async fn large_batch_respects_sqlite_bind_limit_and_updates_existing_set() {
        assert_eq!(BATCH_SIZE * SINGER_BIND_COUNT, SQLITE_SAFE_BIND_LIMIT);

        let pool = test_pool().await;
        let rows = (0..BATCH_SIZE)
            .map(|index| SingerRow {
                singer_no: format!("S{index}"),
                singer_name: format!("Singer {index}"),
                initial_key: "S".to_string(),
                region_code: String::new(),
                sex_code: String::new(),
                hit: index as i64,
                source_singer_id: index.to_string(),
            })
            .collect::<Vec<_>>();
        let dicts = load_dicts(&pool).await.unwrap();
        let mut existing_singer_nos = HashSet::new();

        let counts = write_batch(&pool, &rows, &dicts, &mut existing_singer_nos)
            .await
            .unwrap();

        assert_eq!(counts, (BATCH_SIZE as i64, 0));
        assert_eq!(existing_singer_nos.len(), BATCH_SIZE);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM singers")
                .fetch_one(&pool)
                .await
                .unwrap(),
            BATCH_SIZE as i64
        );
    }

    #[tokio::test]
    async fn singer_task_queries_do_not_return_song_tasks() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO importTasks (taskId, sourceType, sourcePath, status, startedTime, updatedTime)
             VALUES ('song-task', 'xlsxCatalog', 'songs.xlsx', 'pending', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert!(SingerDataImportService::get_task(&pool, "song-task")
            .await
            .is_err());
        assert!(SingerDataImportService::get_active_task(&pool)
            .await
            .unwrap()
            .is_none());
    }
}
