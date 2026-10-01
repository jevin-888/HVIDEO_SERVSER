//! 活动日志服务 - 记录与查询系统操作活动

use crate::errors::AppResult;
use sqlx::{Row, SqlitePool};

/// 记录活动
#[allow(dead_code)]
pub struct ActivityService;

impl ActivityService {
    /// 记录一条活动
    pub async fn record(
        pool: &SqlitePool,
        clientId: &str,
        action: &str,
        targetType: &str,
        targetId: &str,
        detail: &str,
        ipAddress: &str,
    ) -> AppResult<()> {
        let timestamp = chrono::Local::now().format("%Y%m%d%H%M%S%.3f");
        let id = format!("{}-{}", action, timestamp);
        sqlx::query(
            "INSERT INTO operation_logs (id, clientId, action, targetType, targetId, detail, ipAddress)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(clientId)
        .bind(action)
        .bind(targetType)
        .bind(targetId)
        .bind(detail)
        .bind(ipAddress)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// 获取最近活动列表（含操作者名称）
    pub async fn list_recent(pool: &SqlitePool, limit: u32) -> AppResult<Vec<ActivityItem>> {
        let limit = limit.min(100).max(1);
        let rows = sqlx::query(
            r#"
            SELECT l.id, l.clientId, l.action, l.targetType, l.targetId, l.detail, l.ipAddress, l.createdAt,
                   c.clientName, c.clientKey
            FROM operation_logs l
            LEFT JOIN api_clients c ON l.clientId = c.id
            ORDER BY l.createdAt DESC
            LIMIT ?
            "#,
        )
        .bind(limit as i64)
        .fetch_all(pool)
        .await?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let clientId: Option<String> = row.try_get("clientId").ok();
            let clientName: Option<String> = row.try_get("clientName").ok();
            let clientKey: Option<String> = row.try_get("clientKey").ok();
            let actor_type = if clientId.as_deref().unwrap_or("").is_empty() {
                "系统"
            } else {
                "管理员"
            };
            let actor_name = clientName
                .filter(|s| !s.is_empty())
                .or(clientKey)
                .unwrap_or_else(|| "未知".to_string());

            let action: String = row.get("action");
            items.push(ActivityItem {
                id: row.get("id"),
                created_at: row.get("createdAt"),
                action: action.clone(),
                action_label: action_to_label(&action),
                target_type: row.get("targetType"),
                target_id: row.get("targetId"),
                detail: row.get("detail"),
                actor_type: actor_type.to_string(),
                actor_name,
            });
        }
        Ok(items)
    }
}

/// 活动项（API 响应用）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
    pub id: String,
    pub created_at: String,
    pub action: String,
    pub action_label: String,
    pub target_type: String,
    pub target_id: String,
    pub detail: String,
    pub actor_type: String,
    pub actor_name: String,
}

fn action_to_label(action: &str) -> String {
    let s = match action {
        "login" => "用户登录",
        "create_room" => "房间创建",
        "update_room" => "房间更新",
        "delete_room" => "房间删除",
        "terminalOnline" => "终端上线",
        "terminal_register" => "终端注册",
        "terminal_scan" => "终端扫描",
        "terminal_discover" => "终端发现",
        "terminal_app_update" => "APP 更新",
        _ => "其他",
    };
    s.to_string()
}
