use std::collections::HashSet;

use sqlx::{Sqlite, SqliteConnection, SqlitePool, Transaction};

use crate::errors::{AppError, AppResult};
use crate::models::song_db_models::{DictEntry, DictImportResult, UpsertDictRequest};

pub struct DictionaryService;

pub const MAX_DICT_ROWS: usize = 10_000;
pub const SONG_ENTRY_PAGE_GROUP: &str = "songEntryPage";
const SELECT_DICT: &str = "SELECT dictGroup, dictCode, dictName, visible, sortOrder FROM dicts";

fn default_visibility(group: &str, code: &str, name: &str) -> i32 {
    let hidden = group == "classify" && (
        matches!(code, "0"|"2"|"3"|"4"|"5"|"6"|"7"|"13"|"17"|"72"|"73"|"74"|"75"|"76"|"77"|"78")
        || matches!(name, "其他"|"其它"|"戏曲"|"黃梅戲"|"黄梅戏"|"京剧"|"京劇"|"沪剧"|"滬劇"|"越剧"|"越劇"|"川剧"|"川劇"|"豫剧"|"豫劇"|"潮剧"|"潮劇"|"歌剧"|"歌劇"|"琼剧"|"瓊劇"|"淮剧"|"淮劇"|"粤剧"|"粵劇"|"花鼓戏"|"花鼓戲"|"秦腔"|"粤曲"|"粵曲"));
    i32::from(!hidden)
}

#[derive(Debug)]
pub struct DictImportRow {
    pub row_number: usize,
    pub group: String,
    pub request: UpsertDictRequest,
}

pub fn validate_group(group: &str) -> AppResult<()> {
    if group.is_empty()
        || group.len() > 64
        || !group.as_bytes()[0].is_ascii_alphabetic()
        || !group
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_')
    {
        return Err(AppError::BadRequest(
            "字典分组须以英文字母开头，仅含字母、数字、下划线，最多64位".into(),
        ));
    }
    Ok(())
}

fn clean_text(value: &str, label: &str, max: usize) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        return Err(AppError::BadRequest(format!(
            "{label}不能为空，最多{max}个字符且不能含控制字符"
        )));
    }
    Ok(value.to_owned())
}

fn validate_request(group: &str, req: &mut UpsertDictRequest) -> AppResult<()> {
    validate_group(group)?;
    req.dict_code = clean_text(&req.dict_code, "字典编码", 128)?;
    req.dict_name = clean_text(&req.dict_name, "字典名称", 256)?;
    if req.visible.is_some_and(|v| v != 0 && v != 1) {
        return Err(AppError::BadRequest("visible 只能为0或1".into()));
    }
    if req.sortOrder.is_some_and(|v| v < 0) {
        return Err(AppError::BadRequest("sortOrder 必须为非负整数".into()));
    }
    if group == SONG_ENTRY_PAGE_GROUP {
        let name = match req.dict_code.as_str() {
            "song" => "歌名",
            "singer" => "歌星",
            "indonesian" => "印尼歌曲",
            _ => {
                return Err(AppError::BadRequest(
                    "点歌默认页仅支持 song（歌名）、singer（歌星）、indonesian（印尼歌曲）".into(),
                ));
            }
        };
        if req.dict_name != name {
            return Err(AppError::BadRequest(format!(
                "点歌默认页 {} 的字典名称必须为“{name}”",
                req.dict_code
            )));
        }
        if req.visible.is_some_and(|v| v != 1) {
            return Err(AppError::BadRequest("点歌默认页 visible 必须为1".into()));
        }
        if req.sortOrder.is_some_and(|v| v != 0) {
            return Err(AppError::BadRequest("点歌默认页 sortOrder 必须为0".into()));
        }
        req.visible = Some(1);
        req.sortOrder = Some(0);
    }
    Ok(())
}

impl DictionaryService {
    /// Run on startup so existing installations gain the setting without changing a selection.
    pub async fn ensure_defaults(pool: &SqlitePool) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO dicts (dictGroup, dictCode, dictName, sortOrder, visible)
             SELECT ?, 'song', '歌名', 0, 1
             WHERE NOT EXISTS (SELECT 1 FROM dicts WHERE dictGroup = ?)",
        )
        .bind(SONG_ENTRY_PAGE_GROUP)
        .bind(SONG_ENTRY_PAGE_GROUP)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn list(pool: &SqlitePool, group: Option<&str>) -> AppResult<Vec<DictEntry>> {
        if let Some(group) = group {
            validate_group(group)?;
            Ok(sqlx::query_as::<_, DictEntry>(&format!(
                "{SELECT_DICT} WHERE dictGroup = ? ORDER BY sortOrder, id"
            ))
            .bind(group)
            .fetch_all(pool)
            .await?)
        } else {
            Ok(sqlx::query_as::<_, DictEntry>(&format!(
                "{SELECT_DICT} ORDER BY dictGroup, sortOrder, id"
            ))
            .fetch_all(pool)
            .await?)
        }
    }

    pub async fn get_groups(pool: &SqlitePool, groups: &[&str]) -> AppResult<Vec<DictEntry>> {
        let mut items = Vec::new();
        for group in groups {
            items.extend(Self::list(pool, Some(group)).await?);
        }
        Ok(items)
    }

    async fn write_transaction(pool: &SqlitePool) -> AppResult<Transaction<'_, Sqlite>> {
        let mut tx = pool.begin().await?;
        // Acquire SQLite's write lock before comparing existing rows. No rows are changed.
        sqlx::query("UPDATE dicts SET id = id WHERE 0")
            .execute(&mut *tx)
            .await?;
        let active: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM importTasks WHERE status IN ('pending', 'running'))",
        )
        .fetch_one(&mut *tx)
        .await?;
        if active {
            return Err(AppError::Conflict(
                "歌曲或歌星正在导入，请完成后再维护字典".into(),
            ));
        }
        Ok(tx)
    }

    async fn write_item(
        conn: &mut SqliteConnection,
        group: &str,
        req: UpsertDictRequest,
    ) -> AppResult<(DictEntry, u8)> {
        if group == SONG_ENTRY_PAGE_GROUP {
            return Self::write_song_entry_page(conn, req).await;
        }
        let existing = sqlx::query_as::<_, DictEntry>(&format!(
            "{SELECT_DICT} WHERE dictGroup = ? AND dictCode = ?"
        ))
        .bind(group)
        .bind(&req.dict_code)
        .fetch_optional(&mut *conn)
        .await?;
        let visible = req
            .visible
            .or_else(|| existing.as_ref().and_then(|e| e.visible))
            .unwrap_or_else(|| default_visibility(group, &req.dict_code, &req.dict_name));
        let sort = req
            .sortOrder
            .or_else(|| existing.as_ref().and_then(|e| e.sortOrder))
            .unwrap_or(0);
        let changed = existing.as_ref().is_none_or(|e| {
            e.dict_name.as_deref() != Some(&req.dict_name)
                || e.visible != Some(visible)
                || e.sortOrder != Some(sort)
        });
        if !changed {
            return Ok((existing.unwrap(), 0));
        }
        let name_changed = existing
            .as_ref()
            .is_none_or(|e| e.dict_name.as_deref() != Some(&req.dict_name));
        sqlx::query("INSERT INTO dicts (dictGroup, dictCode, dictName, sortOrder, visible) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(dictGroup, dictCode) DO UPDATE SET dictName=excluded.dictName, sortOrder=excluded.sortOrder,
                visible=excluded.visible")
            .bind(group).bind(&req.dict_code).bind(&req.dict_name).bind(sort).bind(visible)
            .execute(&mut *conn).await?;
        if name_changed {
            // These names are denormalized in the catalogue; update them in the same transaction.
            let reference = match group {
                "language" => Some(("songs", "languageCode", "languageName")),
                "classify" => Some(("songs", "categoryCode", "categoryName")),
                "region" => Some(("singers", "regionCode", "regionName")),
                "sex" => Some(("singers", "sexCode", "sexName")),
                _ => None,
            };
            if let Some((table, code, name)) = reference {
                sqlx::query(&format!("UPDATE {table} SET {name} = ?, updatedTime = ? WHERE {code} = ? AND {name} IS NOT ?"))
                    .bind(&req.dict_name).bind(chrono::Utc::now().timestamp_millis())
                    .bind(&req.dict_code).bind(&req.dict_name).execute(&mut *conn).await?;
            }
        }
        let item = sqlx::query_as::<_, DictEntry>(&format!(
            "{SELECT_DICT} WHERE dictGroup = ? AND dictCode = ?"
        ))
        .bind(group)
        .bind(&req.dict_code)
        .fetch_one(&mut *conn)
        .await?;
        Ok((item, if existing.is_some() { 2 } else { 1 }))
    }

    async fn write_song_entry_page(
        conn: &mut SqliteConnection,
        req: UpsertDictRequest,
    ) -> AppResult<(DictEntry, u8)> {
        let existing =
            sqlx::query_as::<_, DictEntry>(&format!("{SELECT_DICT} WHERE dictGroup = ?"))
                .bind(SONG_ENTRY_PAGE_GROUP)
                .fetch_all(&mut *conn)
                .await?;
        if existing.len() == 1
            && existing[0].dict_code.as_deref() == Some(&req.dict_code)
            && existing[0].dict_name.as_deref() == Some(&req.dict_name)
            && existing[0].visible == Some(1)
            && existing[0].sortOrder == Some(0)
        {
            return Ok((existing.into_iter().next().unwrap(), 0));
        }
        // The caller owns the write transaction: switching pages cannot expose an empty
        // group or leave two choices behind, including when an XLSX import later fails.
        sqlx::query("DELETE FROM dicts WHERE dictGroup = ?")
            .bind(SONG_ENTRY_PAGE_GROUP)
            .execute(&mut *conn)
            .await?;
        sqlx::query(
            "INSERT INTO dicts (dictGroup, dictCode, dictName, sortOrder, visible)
             VALUES (?, ?, ?, 0, 1)",
        )
        .bind(SONG_ENTRY_PAGE_GROUP)
        .bind(&req.dict_code)
        .bind(&req.dict_name)
        .execute(&mut *conn)
        .await?;
        Ok((
            DictEntry {
                dict_group: Some(SONG_ENTRY_PAGE_GROUP.to_owned()),
                dict_code: Some(req.dict_code),
                dict_name: Some(req.dict_name),
                visible: Some(1),
                sortOrder: Some(0),
            },
            if existing.is_empty() { 1 } else { 2 },
        ))
    }

    pub async fn upsert(
        pool: &SqlitePool,
        group: &str,
        mut req: UpsertDictRequest,
    ) -> AppResult<DictEntry> {
        validate_request(group, &mut req)?;
        let mut tx = Self::write_transaction(pool).await?;
        let (item, _) = Self::write_item(&mut tx, group, req).await?;
        tx.commit().await?;
        Ok(item)
    }

    pub async fn import(
        pool: &SqlitePool,
        mut rows: Vec<DictImportRow>,
    ) -> AppResult<DictImportResult> {
        if rows.is_empty() || rows.len() > MAX_DICT_ROWS {
            return Err(AppError::BadRequest(format!(
                "请导入1至{MAX_DICT_ROWS}条字典数据"
            )));
        }
        let mut keys = HashSet::new();
        let mut has_song_entry_page = false;
        for row in &mut rows {
            validate_request(&row.group, &mut row.request)
                .map_err(|e| AppError::BadRequest(format!("第{}行：{e}", row.row_number)))?;
            if row.group == SONG_ENTRY_PAGE_GROUP {
                if has_song_entry_page {
                    return Err(AppError::BadRequest(format!(
                        "第{}行：一次导入只能包含一条点歌默认页配置",
                        row.row_number
                    )));
                }
                has_song_entry_page = true;
            }
            if !keys.insert((row.group.clone(), row.request.dict_code.clone())) {
                return Err(AppError::BadRequest(format!(
                    "第{}行的分组和编码重复：{}/{}",
                    row.row_number, row.group, row.request.dict_code
                )));
            }
        }
        let mut result = DictImportResult {
            total_count: rows.len(),
            ..Default::default()
        };
        let mut tx = Self::write_transaction(pool).await?;
        for row in rows {
            match Self::write_item(&mut tx, &row.group, row.request).await?.1 {
                1 => result.inserted_count += 1,
                2 => result.updated_count += 1,
                _ => result.unchanged_count += 1,
            }
        }
        tx.commit().await?;
        Ok(result)
    }

    pub async fn delete(pool: &SqlitePool, group: &str, code: &str) -> AppResult<()> {
        validate_group(group)?;
        if group == SONG_ENTRY_PAGE_GROUP {
            return Err(AppError::Conflict(
                "点歌默认页不能删除，请通过切换默认页修改".into(),
            ));
        }
        let code = clean_text(code, "字典编码", 128)?;
        let mut tx = Self::write_transaction(pool).await?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM dicts WHERE dictGroup=? AND dictCode=?)",
        )
        .bind(group)
        .bind(&code)
        .fetch_one(&mut *tx)
        .await?;
        if !exists {
            return Err(AppError::NotFound(format!("字典不存在：{group}/{code}")));
        }
        let references: &[(&str, &str)] = match group {
            "classify" => &[
                ("songs", "categoryCode"),
                ("songSearch", "categoryCode"),
                ("songSingers", "categoryCode"),
            ],
            "language" => &[
                ("songs", "languageCode"),
                ("songSearch", "languageCode"),
                ("songSingers", "languageCode"),
            ],
            "region" => &[("singers", "regionCode")],
            "sex" => &[("singers", "sexCode")],
            "track" => &[("songs", "track")],
            _ => &[],
        };
        for (table, column) in references {
            let used: bool = sqlx::query_scalar(&format!(
                "SELECT EXISTS(SELECT 1 FROM {table} WHERE {column} = ?)"
            ))
            .bind(&code)
            .fetch_one(&mut *tx)
            .await?;
            if used {
                return Err(AppError::Conflict(
                    "该字典项已被歌曲或歌星引用，请先调整关联数据；暂时不显示可改为隐藏".into(),
                ));
            }
        }
        let settings: &[&str] = match group {
            "classify" => &["publicSongClassify"],
            "light" => &["publicSongLight"],
            _ => &[],
        };
        for setting in settings {
            let used: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM dicts WHERE dictGroup=? AND dictCode=?)",
            )
            .bind(setting)
            .bind(&code)
            .fetch_one(&mut *tx)
            .await?;
            if used {
                return Err(AppError::Conflict(
                    "该字典项被公播配置引用，请先调整公播配置".into(),
                ));
            }
        }
        sqlx::query("DELETE FROM dicts WHERE dictGroup=? AND dictCode=?")
            .bind(group)
            .bind(code)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }
}
