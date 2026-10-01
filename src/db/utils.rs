// use sqlx::{QueryBuilder, Sqlite};
use crate::models::common::{PagedResponse, Pagination};
use serde::Serialize;
use sqlx::{Column, Row};

pub struct Paginator<'a, T> {
    pub pool: &'a sqlx::SqlitePool,
    pub select_sql: String,
    pub count_sql: String,
    pub pagination: Pagination,
    pub _phantom: std::marker::PhantomData<T>,
}

impl<'a, T> Paginator<'a, T>
where
    for<'r> T: sqlx::FromRow<'r, sqlx::sqlite::SqliteRow> + Serialize + Send + Unpin,
{
    /// 标准强类型分页查询
    pub async fn fetch_paged(
        pool: &sqlx::SqlitePool,
        base_sql: &str,
        where_sql: &str,
        order_by: &str,
        pagination: &Pagination,
        bind_values: Vec<String>,
    ) -> crate::errors::AppResult<PagedResponse<T>> {
        let page = pagination.page.unwrap_or(1).max(1);
        let page_size = pagination.page_size();
        let offset = pagination.offset();

        // 1. 获取总数
        let count_sql = if where_sql.is_empty() || where_sql == "1=1" {
            format!("SELECT COUNT(*) FROM ({})", base_sql)
        } else {
            format!("SELECT COUNT(*) FROM ({}) WHERE {}", base_sql, where_sql)
        };

        let mut count_q = sqlx::query_scalar::<_, i64>(&count_sql);
        for v in &bind_values {
            count_q = count_q.bind(v);
        }
        let total = count_q.fetch_one(pool).await? as u64;

        // 2. 获取数据
        let data_sql = if where_sql.is_empty() || where_sql == "1=1" {
            format!("{} ORDER BY {} LIMIT ? OFFSET ?", base_sql, order_by)
        } else {
            format!(
                "SELECT * FROM ({}) WHERE {} ORDER BY {} LIMIT ? OFFSET ?",
                base_sql, where_sql, order_by
            )
        };

        let mut data_q = sqlx::query_as::<_, T>(&data_sql);
        for v in &bind_values {
            data_q = data_q.bind(v);
        }
        data_q = data_q.bind(page_size).bind(offset);
        let items = data_q.fetch_all(pool).await?;

        Ok(PagedResponse {
            items,
            total,
            page: page as u32,
            page_size: page_size as u32,
        })
    }
}

/// 原始分页查询，返回 JSON 数组（适用于字段名不确定的 legacy DB）
/// 独立于 Paginator<T>，避开 Trait 约束
pub async fn fetch_paged_raw(
    pool: &sqlx::SqlitePool,
    table_name: &str,
    where_sql: &str,
    order_by: &str,
    pagination: &Pagination,
    bind_values: Vec<String>,
) -> crate::errors::AppResult<PagedResponse<serde_json::Value>> {
    let page = pagination.page.unwrap_or(1).max(1);
    let page_size = pagination.page_size();
    let offset = (page as i64 - 1) * page_size as i64;

    // 1. 获取总数
    let count_sql = if where_sql.trim().is_empty() || where_sql == "1=1" {
        format!("SELECT COUNT(*) FROM {}", table_name)
    } else {
        format!("SELECT COUNT(*) FROM {} WHERE {}", table_name, where_sql)
    };

    let mut count_q = sqlx::query_scalar::<_, i64>(&count_sql);
    for v in &bind_values {
        count_q = count_q.bind(v);
    }
    let total = count_q.fetch_one(pool).await? as u64;

    // 2. 获取数据 (使用原始 JSON 映射)
    let data_sql = if where_sql.trim().is_empty() || where_sql == "1=1" {
        format!(
            "SELECT * FROM {} ORDER BY {} LIMIT ? OFFSET ?",
            table_name, order_by
        )
    } else {
        format!(
            "SELECT * FROM {} WHERE {} ORDER BY {} LIMIT ? OFFSET ?",
            table_name, where_sql, order_by
        )
    };

    let mut data_q = sqlx::query(&data_sql);
    for v in &bind_values {
        data_q = data_q.bind(v);
    }
    data_q = data_q.bind(page_size).bind(offset);

    let rows = data_q.fetch_all(pool).await?;
    let mut items = Vec::new();

    for row in rows {
        let mut map = serde_json::Map::new();
        for col in row.columns() {
            let name = col.name();
            // 智能类型处理
            if let Ok(val) = row.try_get::<String, _>(name) {
                map.insert(name.to_string(), serde_json::Value::String(val));
            } else if let Ok(val) = row.try_get::<i64, _>(name) {
                map.insert(name.to_string(), serde_json::Value::Number(val.into()));
            } else if let Ok(val) = row.try_get::<f64, _>(name) {
                if let Some(num) = serde_json::Number::from_f64(val) {
                    map.insert(name.to_string(), serde_json::Value::Number(num));
                }
            } else if let Ok(val) = row.try_get::<bool, _>(name) {
                map.insert(name.to_string(), serde_json::Value::Bool(val));
            } else {
                map.insert(name.to_string(), serde_json::Value::Null);
            }
        }
        items.push(serde_json::Value::Object(map));
    }

    Ok(PagedResponse {
        items,
        total,
        page: page as u32,
        page_size: page_size as u32,
    })
}
