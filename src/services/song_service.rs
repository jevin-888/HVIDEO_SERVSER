use sqlx::SqlitePool;

use crate::errors::{AppError, AppResult};
use crate::models::common::{PagedResponse, Pagination};
use crate::models::song::*;

pub struct SongService;

impl SongService {
    /// 创建歌曲
    pub async fn create(pool: &SqlitePool, req: CreateSongRequest) -> AppResult<Song> {
        let songNo = req.songNo.as_deref().unwrap_or("").trim().to_string();
        if songNo.is_empty() {
            return Err(AppError::BadRequest("songNo 不能为空".to_string()));
        }
        sqlx::query(
            "INSERT INTO songs (songNo, songName, initialKey, primarySingerNo, primarySingerName, singerNames, languageCode, categoryCode, relativePath, fileName, absolutePath)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&songNo)
        .bind(&req.songName)
        .bind(req.initialKey.as_deref().unwrap_or(""))
        .bind(req.primarySingerNo.as_deref().unwrap_or(""))
        .bind(req.primarySingerName.as_deref().unwrap_or(""))
        .bind(req.singerNames.as_deref().unwrap_or(""))
        .bind(req.languageCode.as_deref().unwrap_or(""))
        .bind(req.categoryCode.as_deref().unwrap_or(""))
        .bind(req.relativePath.as_deref().unwrap_or(""))
        .bind(req.fileName.as_deref().unwrap_or(""))
        .bind(req.absolutePath.as_deref().unwrap_or(""))
        .execute(pool)
        .await?;

        Self::get_by_id(pool, &songNo).await
    }

    /// 根据ID获取歌曲
    pub async fn get_by_id(pool: &SqlitePool, id: &str) -> AppResult<Song> {
        let row = sqlx::query_as::<_, (i64, String, String, String, String, String, String, String, String, i64, String, String, String, i64, i64, i64)>(
            "SELECT songId, songNo, songName, COALESCE(initialKey, ''), COALESCE(primarySingerNo, ''), COALESCE(primarySingerName, ''), COALESCE(singerNames, ''), COALESCE(languageCode, ''), COALESCE(categoryCode, ''), COALESCE(durationMs, 0), COALESCE(relativePath, ''), COALESCE(fileName, ''), COALESCE(absolutePath, ''), COALESCE(fileSize, 0), COALESCE(clickTime, 0), COALESCE(fileExists, 0) FROM songs WHERE songNo = ? OR CAST(songId AS TEXT) = ? LIMIT 1"
        )
        .bind(id)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("歌曲不存在: {}", id)))?;
        Ok(Self::row_to_song(row))
    }

    /// 更新歌曲
    pub async fn update(pool: &SqlitePool, id: &str, req: UpdateSongRequest) -> AppResult<Song> {
        let existing = Self::get_by_id(pool, id).await?;
        sqlx::query(
            "UPDATE songs SET songName = ?, initialKey = ?, primarySingerNo = ?, primarySingerName = ?, singerNames = ?, languageCode = ?, categoryCode = ?, relativePath = ?, fileName = ?, absolutePath = ? WHERE songNo = ? OR CAST(songId AS TEXT) = ?"
        )
        .bind(req.songName.as_deref().unwrap_or(&existing.songName))
        .bind(req.initialKey.as_deref().unwrap_or(&existing.initialKey))
        .bind(req.primarySingerNo.as_deref().unwrap_or(&existing.primarySingerNo))
        .bind(req.primarySingerName.as_deref().unwrap_or(&existing.primarySingerName))
        .bind(req.singerNames.as_deref().unwrap_or(&existing.singerNames))
        .bind(req.languageCode.as_deref().unwrap_or(&existing.languageCode))
        .bind(req.categoryCode.as_deref().unwrap_or(&existing.categoryCode))
        .bind(req.relativePath.as_deref().unwrap_or(&existing.relativePath))
        .bind(req.fileName.as_deref().unwrap_or(&existing.fileName))
        .bind(req.absolutePath.as_deref().unwrap_or(&existing.absolutePath))
        .bind(id)
        .bind(id)
        .execute(pool)
        .await?;
        Self::get_by_id(pool, id).await
    }

    /// 删除歌曲
    pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
        let song = Self::get_by_id(pool, id).await?;
        let result = sqlx::query("DELETE FROM songs WHERE songNo = ?")
            .bind(&song.songNo)
            .execute(pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("歌曲不存在: {}", id)));
        }

        Ok(())
    }

    fn row_to_song(
        row: (
            i64,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            i64,
            String,
            String,
            String,
            i64,
            i64,
            i64,
        ),
    ) -> Song {
        let (
            songId,
            songNo,
            songName,
            initialKey,
            primarySingerNo,
            primarySingerName,
            singerNames,
            languageCode,
            categoryCode,
            durationMs,
            relativePath,
            fileName,
            absolutePath,
            fileSize,
            clickTime,
            fileExists,
        ) = row;
        Song {
            songId,
            songNo,
            songName,
            initialKey,
            primarySingerNo,
            primarySingerName,
            singerNames,
            languageCode,
            categoryCode,
            durationMs,
            relativePath,
            fileName,
            absolutePath,
            fileSize,
            clickTime,
            fileExists,
        }
    }

    pub async fn list(pool: &SqlitePool, query: SongQuery) -> AppResult<PagedResponse<Song>> {
        let mut where_clauses = vec!["1=1".to_string()];
        let mut bind_values: Vec<String> = Vec::new();

        if let Some(ref keyword) = query.keyword {
            let kw = keyword.trim();
            if !kw.is_empty() {
                where_clauses.push("(songName LIKE ? OR singerNames LIKE ? OR songNo LIKE ? OR relativePath LIKE ? OR fileName LIKE ?)".to_string());
                let like_val = format!("%{}%", kw);
                bind_values.push(like_val.clone());
                bind_values.push(like_val.clone());
                bind_values.push(like_val.clone());
                bind_values.push(like_val.clone());
                bind_values.push(like_val);
            }
        }

        if let Some(ref initial) = query.initial {
            if !initial.trim().is_empty() {
                where_clauses.push("songName LIKE ?".to_string());
                bind_values.push(format!("{}%", initial.trim()));
            }
        }

        if let Some(ref language) = query.languageCode {
            if !language.trim().is_empty() {
                where_clauses.push("languageCode = ?".to_string());
                bind_values.push(language.trim().to_string());
            }
        }

        if let Some(ref artist_id) = query.primarySingerNo {
            if !artist_id.trim().is_empty() {
                where_clauses.push("primarySingerNo = ?".to_string());
                bind_values.push(artist_id.trim().to_string());
            }
        }
        if let Some(ref categoryCode) = query.categoryCode {
            if !categoryCode.trim().is_empty() {
                where_clauses.push("categoryCode = ?".to_string());
                bind_values.push(categoryCode.trim().to_string());
            }
        }

        let where_sql = where_clauses.join(" AND ");
        let pagination = Pagination {
            page: query.page,
            page_size: query.page_size,
        };
        let page = pagination.page.unwrap_or(1).max(1);
        let page_size = pagination.page_size();
        let offset = pagination.offset();

        let count_sql = format!("SELECT COUNT(*) FROM songs WHERE {}", where_sql);
        let mut count_q = sqlx::query_scalar::<_, i64>(&count_sql);
        for v in &bind_values {
            count_q = count_q.bind(v);
        }
        let total = count_q.fetch_one(pool).await? as u64;

        let data_sql = format!(
            "SELECT songId, songNo, songName, COALESCE(initialKey, ''), COALESCE(primarySingerNo, ''), COALESCE(primarySingerName, ''), COALESCE(singerNames, ''), COALESCE(languageCode, ''), COALESCE(categoryCode, ''), COALESCE(durationMs, 0), COALESCE(relativePath, ''), COALESCE(fileName, ''), COALESCE(absolutePath, ''), COALESCE(fileSize, 0), COALESCE(clickTime, 0), COALESCE(fileExists, 0) FROM songs WHERE {} ORDER BY clickTime DESC, songId DESC LIMIT ? OFFSET ?",
            where_sql
        );
        let mut data_q = sqlx::query_as::<
            _,
            (
                i64,
                String,
                String,
                String,
                String,
                String,
                String,
                String,
                String,
                i64,
                String,
                String,
                String,
                i64,
                i64,
                i64,
            ),
        >(&data_sql);
        for v in &bind_values {
            data_q = data_q.bind(v);
        }
        let rows = data_q.bind(page_size).bind(offset).fetch_all(pool).await?;

        let items = rows.into_iter().map(Self::row_to_song).collect();

        Ok(PagedResponse {
            items,
            total,
            page,
            page_size,
        })
    }

    /// 增加播放次数
    #[allow(dead_code)]
    pub async fn increment_play_count(_pool: &SqlitePool, _id: &str) -> AppResult<()> {
        Ok(())
    }
}
