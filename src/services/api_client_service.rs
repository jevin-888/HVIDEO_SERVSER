use sqlx::SqlitePool;

use crate::errors::{AppError, AppResult};
use crate::models::api_client::*;

pub struct ApiClientService;

impl ApiClientService {
    /// 注册新的 API 客户端（必须指定可读登录名和密码）
    pub async fn create(
        pool: &SqlitePool,
        req: CreateApiClientRequest,
    ) -> AppResult<ApiClientCreatedResponse> {
        let clientKey = req
            .clientKey
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_string();
        let raw_secret = req.clientSecret.as_deref().unwrap_or_default().to_string();
        if clientKey.len() < 2 {
            return Err(AppError::BadRequest("登录名至少 2 个字符".to_string()));
        }
        if raw_secret.is_empty() {
            return Err(AppError::BadRequest("密码不能为空".to_string()));
        }
        let id = clientKey.clone();
        let name_trim = req.clientName.trim();
        let exists: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM api_clients WHERE clientKey = ? OR id = ?")
                .bind(&clientKey)
                .bind(&id)
                .fetch_one(pool)
                .await?;
        if exists > 0 {
            return Err(AppError::BadRequest("该用户名已存在".to_string()));
        }

        let hashed_secret = bcrypt::hash(&raw_secret, bcrypt::DEFAULT_COST)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("密码加密失败: {}", e)))?;

        let permissions = req.permissions.unwrap_or_else(|| vec!["read".to_string()]);
        let permissions_json = serde_json::to_string(&permissions)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;
        let clientName = if name_trim.is_empty() {
            clientKey.clone()
        } else {
            req.clientName.clone()
        };

        sqlx::query(
            "INSERT INTO api_clients (id, clientName, clientKey, clientSecret, permissions, rateLimit, status)
             VALUES (?, ?, ?, ?, ?, ?, 1)"
        )
        .bind(&id)
        .bind(&clientName)
        .bind(&clientKey)
        .bind(&hashed_secret)
        .bind(&permissions_json)
        .bind(req.rateLimit.unwrap_or(100))
        .execute(pool)
        .await?;

        Ok(ApiClientCreatedResponse {
            id,
            clientName,
            clientKey: clientKey.clone(),
            clientSecret: raw_secret,
            permissions,
        })
    }

    /// 验证 API 客户端凭据
    pub async fn verify(pool: &SqlitePool, key: &str, secret: &str) -> AppResult<ApiClient> {
        let client = sqlx::query_as::<_, ApiClient>(
            "SELECT * FROM api_clients WHERE clientKey = ? AND status = 1",
        )
        .bind(key)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Unauthorized("用户名或密码错误".to_string()))?;

        let valid = bcrypt::verify(secret, &client.clientSecret)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("验证失败: {}", e)))?;

        if !valid {
            return Err(AppError::Unauthorized("用户名或密码错误".to_string()));
        }

        // 更新最后访问时间
        sqlx::query("UPDATE api_clients SET lastAccess = datetime('now','localtime') WHERE id = ?")
            .bind(&client.id)
            .execute(pool)
            .await?;

        Ok(client)
    }

    /// 获取所有 API 客户端
    pub async fn list_all(pool: &SqlitePool) -> AppResult<Vec<ApiClient>> {
        let clients =
            sqlx::query_as::<_, ApiClient>("SELECT * FROM api_clients ORDER BY createdAt DESC")
                .fetch_all(pool)
                .await?;
        Ok(clients)
    }

    /// 更新 API 客户端（支持重置密码；禁止修改 admin 账户）
    pub async fn update(
        pool: &SqlitePool,
        id: &str,
        req: UpdateApiClientRequest,
    ) -> AppResult<ApiClient> {
        let existing = sqlx::query_as::<_, ApiClient>("SELECT * FROM api_clients WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("API客户端不存在: {}", id)))?;

        if existing.clientKey == "admin" {
            return Err(AppError::Forbidden("默认 admin 账户不可修改".to_string()));
        }

        let permissions_json = if let Some(ref perms) = req.permissions {
            serde_json::to_string(perms).unwrap_or(existing.permissions.clone())
        } else {
            existing.permissions.clone()
        };

        let name = req.clientName.as_deref().unwrap_or(&existing.clientName);
        let rateLimit = req.rateLimit.unwrap_or(existing.rateLimit);
        let status = req.status.unwrap_or(existing.status);

        if let Some(ref new_secret) = req.clientSecret {
            if !new_secret.is_empty() {
                let hashed = bcrypt::hash(new_secret, bcrypt::DEFAULT_COST)
                    .map_err(|e| AppError::Internal(anyhow::anyhow!("密码加密失败: {}", e)))?;
                sqlx::query(
                    "UPDATE api_clients SET clientName=?, permissions=?, rateLimit=?, status=?, clientSecret=?, updatedAt=datetime('now','localtime') WHERE id=?"
                )
                .bind(name)
                .bind(&permissions_json)
                .bind(rateLimit)
                .bind(status)
                .bind(&hashed)
                .bind(id)
                .execute(pool)
                .await?;
                return sqlx::query_as::<_, ApiClient>("SELECT * FROM api_clients WHERE id = ?")
                    .bind(id)
                    .fetch_one(pool)
                    .await
                    .map_err(|e| e.into());
            }
        }

        sqlx::query(
            "UPDATE api_clients SET clientName=?, permissions=?, rateLimit=?, status=?, updatedAt=datetime('now','localtime') WHERE id=?"
        )
        .bind(name)
        .bind(&permissions_json)
        .bind(rateLimit)
        .bind(status)
        .bind(id)
        .execute(pool)
        .await?;

        sqlx::query_as::<_, ApiClient>("SELECT * FROM api_clients WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(|e| e.into())
    }

    /// 删除 API 客户端（禁止删除 admin 账户）
    pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
        let client = sqlx::query_as::<_, ApiClient>("SELECT * FROM api_clients WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("API客户端不存在: {}", id)))?;

        if client.clientKey == "admin" {
            return Err(AppError::Forbidden("默认 admin 账户不可删除".to_string()));
        }

        sqlx::query("DELETE FROM api_clients WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }
}
