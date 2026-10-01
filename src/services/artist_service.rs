use sqlx::SqlitePool;
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::models::artist::*;
use crate::models::common::{PagedResponse, Pagination};

pub struct ArtistService;

impl ArtistService {
    /// 创建歌星
    pub async fn create(pool: &SqlitePool, req: CreateArtistRequest) -> AppResult<Artist> {
        let id = Uuid::new_v4().to_string();
        let pinyin = req.pinyin.unwrap_or_default();
        let initial = pinyin
            .chars()
            .next()
            .map(|c| c.to_uppercase().to_string())
            .unwrap_or_default();

        sqlx::query(
            "INSERT INTO artists (id, name, pinyin, initial, gender, region, avatar_url)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&req.name)
        .bind(&pinyin)
        .bind(&initial)
        .bind(req.gender.unwrap_or(0))
        .bind(req.region.as_deref().unwrap_or(""))
        .bind(req.avatar_url.as_deref().unwrap_or(""))
        .execute(pool)
        .await?;

        Self::get_by_id(pool, &id).await
    }

    /// 根据ID获取歌星
    pub async fn get_by_id(pool: &SqlitePool, id: &str) -> AppResult<Artist> {
        sqlx::query_as::<_, Artist>("SELECT * FROM artists WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("歌星不存在: {}", id)))
    }

    /// 更新歌星
    pub async fn update(
        pool: &SqlitePool,
        id: &str,
        req: UpdateArtistRequest,
    ) -> AppResult<Artist> {
        let existing = Self::get_by_id(pool, id).await?;

        let name = req.name.unwrap_or(existing.name);
        let pinyin = req.pinyin.unwrap_or(existing.pinyin);
        let initial = pinyin
            .chars()
            .next()
            .map(|c| c.to_uppercase().to_string())
            .unwrap_or(existing.initial);
        let gender = req.gender.unwrap_or(existing.gender);
        let region = req.region.unwrap_or(existing.region);
        let avatar_url = req.avatar_url.unwrap_or(existing.avatar_url);
        let status = req.status.unwrap_or(existing.status);

        sqlx::query(
            "UPDATE artists SET name=?, pinyin=?, initial=?, gender=?, region=?, avatar_url=?, status=?,
             updatedAt=datetime('now','localtime') WHERE id=?"
        )
        .bind(&name)
        .bind(&pinyin)
        .bind(&initial)
        .bind(gender)
        .bind(&region)
        .bind(&avatar_url)
        .bind(status)
        .bind(id)
        .execute(pool)
        .await?;

        Self::get_by_id(pool, id).await
    }

    /// 删除歌星
    pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
        let result = sqlx::query("DELETE FROM artists WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("歌星不存在: {}", id)));
        }
        Ok(())
    }

    /// 查询歌星列表（支持分页、搜索）
    pub async fn list(pool: &SqlitePool, query: ArtistQuery) -> AppResult<PagedResponse<Artist>> {
        let mut where_clauses = vec!["status = 1".to_string()];
        let mut bind_values: Vec<String> = Vec::new();

        if let Some(ref keyword) = query.keyword {
            where_clauses.push("(name LIKE ? OR pinyin LIKE ?)".to_string());
            bind_values.push(format!("%{}%", keyword));
            bind_values.push(format!("%{}%", keyword));
        }

        if let Some(ref initial) = query.initial {
            where_clauses.push("initial = ?".to_string());
            bind_values.push(initial.clone());
        }

        if let Some(gender) = query.gender {
            where_clauses.push("gender = ?".to_string());
            bind_values.push(gender.to_string());
        }

        if let Some(ref region) = query.region {
            where_clauses.push("region = ?".to_string());
            bind_values.push(region.clone());
        }

        let where_sql = where_clauses.join(" AND ");

        crate::db::utils::Paginator::fetch_paged(
            pool,
            "artists",
            &where_sql,
            "pinyin ASC",
            &Pagination {
                page: query.page,
                page_size: query.page_size,
            },
            bind_values,
        )
        .await
    }
}
