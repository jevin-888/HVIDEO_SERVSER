use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use crate::errors::{AppError, AppResult};
use crate::models::room::*;
use crate::utils::media_path;

pub struct RoomService;

#[derive(Debug)]
pub struct SongAdvanceResult {
    pub advanced: bool,
    pub next: Option<RoomQueueItem>,
}
/// 从 sqlx 查询行构建 RoomWithTerminalInfo（消除各 list 函数中的重复代码）
fn room_with_terminal_info_from_row(row: &sqlx::sqlite::SqliteRow) -> RoomWithTerminalInfo {
    RoomWithTerminalInfo {
        id: row.get("id"),
        name: row.get("name"),
        terminalId: row.get("terminalId"),
        typeId: row.get("typeId"),
        areaId: row.get("areaId"),
        status: row.get("status"),
        currentSongId: row.get("currentSongId"),
        currentSongTitle: row.try_get("currentSongTitle").ok(),
        volume: row.get("volume"),
        musicVolume: row.try_get("musicVolume").ok(),
        micVolume: row.try_get("micVolume").ok(),
        micStatus: row.get("micStatus"),
        acState: row.get("acState"),
        lightState: row.get("lightState"),
        effectState: row.get("effectState"),
        muteStatus: row.get("muteStatus"),
        playState: row.get("playState"),
        createdAt: row.get("createdAt"),
        updatedAt: row.get("updatedAt"),
        roomIp: row.try_get("roomIp").ok(),
        terminalName: row.try_get("terminalName").ok(),
        terminalOnline: row.try_get("terminalOnline").ok(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RoomClientConnection {
    pub connection_id: String,
    pub roomId: String,
    pub roomName: String,
    pub roomIp: String,
    pub terminalId: String,
    pub terminalName: String,
    pub clientType: String,
    pub clientIp: String,
    pub currentConnectionId: String,
    pub status: i32,
    pub connectedAt: String,
    pub updatedAt: String,
    pub disconnectedAt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RoomClientHttpSource {
    pub source_id: String,
    pub roomId: String,
    pub roomIp: String,
    pub clientIp: String,
    pub clientType: String,
    pub createdAt: String,
    pub updatedAt: String,
}

impl RoomService {
    async fn table_columns(pool: &SqlitePool, table: &str) -> AppResult<HashSet<String>> {
        let sql = format!("PRAGMA table_info({})", table);
        let rows = sqlx::query(&sql).fetch_all(pool).await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| row.try_get::<String, _>("name").ok())
            .collect())
    }

    fn text_expr(cols: &HashSet<String>, name: &str, alias: &str) -> String {
        if cols.contains(name) {
            return format!("COALESCE({}, '') AS {}", name, alias);
        }
        format!("'' AS {}", alias)
    }

    fn int_expr(cols: &HashSet<String>, name: &str, alias: &str) -> String {
        if cols.contains(name) {
            return format!("COALESCE({}, 0) AS {}", name, alias);
        }
        format!("0 AS {}", alias)
    }

    fn queue_select_sql() -> &'static str {
        "SELECT
            id,
            roomId,
            songId,
            COALESCE(songTitle, '') AS songName,
            COALESCE(artistName, '') AS singerNames,
            position,
            status,
            isPriority,
            addedAt,
            COALESCE(songNo, songId, '') AS songNo,
            COALESCE(languageCode, '') AS languageCode,
            COALESCE(classify_code, '') AS categoryCode,
            COALESCE(light_code, '') AS light_code,
            COALESCE(songPath, '') AS relativePath,
            '' AS fileName,
            COALESCE(video_file_type, '') AS video_file_type,
            track,
            score_enabled,
            COALESCE(singer_no, '') AS primarySingerNo
         FROM room_queue"
    }

    fn normalize_optional_fk(value: Option<i32>) -> Option<i32> {
        value.filter(|id| *id > 0)
    }

    /// 创建房间
    pub async fn create(pool: &SqlitePool, req: CreateRoomRequest) -> AppResult<Room> {
        let name = req.name.trim();
        let terminal_id = req.terminalId.trim();
        if name.is_empty() {
            return Err(AppError::BadRequest("房间名称不能为空".to_string()));
        }
        if terminal_id.is_empty() {
            return Err(AppError::BadRequest("terminalId 不能为空".to_string()));
        }
        let mut transaction = pool.begin().await?;
        let terminal = sqlx::query(
            "UPDATE terminals SET name = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
        )
        .bind(name)
        .bind(terminal_id)
        .execute(&mut *transaction)
        .await?;
        if terminal.rows_affected() == 0 {
            return Err(AppError::BadRequest(format!("终端不存在: {}", terminal_id)));
        }
        let normalized_type_id = Self::normalize_optional_fk(req.typeId);
        let normalized_area_id = Self::normalize_optional_fk(req.areaId);

        sqlx::query(
            "INSERT INTO rooms (id, name, terminalId, typeId, areaId, room_type)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(terminal_id)
        .bind(name)
        .bind(terminal_id)
        .bind(normalized_type_id)
        .bind(normalized_area_id)
        .bind(normalized_type_id.unwrap_or(0))
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;

        Self::get_by_id(pool, terminal_id).await
    }

    /// 根据ID获取房间
    pub async fn get_by_id(pool: &SqlitePool, id: &str) -> AppResult<Room> {
        sqlx::query_as::<_, Room>("SELECT * FROM rooms WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("房间不存在: {}", id)))
    }

    /// 解析房间 ID。
    ///
    /// `current` 通过请求端 IP 查找当前终端绑定的房间；普通参数只
    /// 允许真实房间 ID、终端 ID 或已绑定终端 IP。解析不到时立即返回
    /// NotFound，调用方不能继续使用一个不存在的房间 ID 执行后续操作。
    pub async fn resolve_room_id(
        pool: &SqlitePool,
        id: &str,
        remote_ip: &str,
    ) -> AppResult<String> {
        if id.is_empty() || (id == "current" && remote_ip.is_empty()) {
            return Err(AppError::NotFound("房间地址为空".to_string()));
        }
        if id == "current" {
            // Resolve the caller's current room through the terminal's latest IP.
            // This keeps /rooms/current working after the terminal IP changes.
            if let Some(room_id) = sqlx::query_scalar::<_, String>(
                "SELECT r.id FROM rooms r
                 JOIN terminals t ON r.terminalId = t.id
                 WHERE (t.terminalIp = ?1 OR EXISTS (
                     SELECT 1 FROM terminal_connections c WHERE c.terminalId=t.id AND c.ipAddress=?1 AND c.onlineStatus=1))
                 ORDER BY t.onlineStatus DESC, t.updatedAt DESC
                 LIMIT 1",
            )
            .bind(remote_ip)
            .fetch_optional(pool)
            .await?
            {
                return Ok(room_id);
            }
            return Err(AppError::NotFound(format!("房间不存在: {}", id)));
        }

        // Accept a room ID, terminal ID, or legacy terminal IP alias.
        if sqlx::query_scalar::<_, String>("SELECT id FROM rooms WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .is_some()
        {
            return Ok(id.to_string());
        }
        if let Some(room_id) = sqlx::query_scalar::<_, String>(
            "SELECT r.id FROM rooms r WHERE r.terminalId = ? LIMIT 1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        {
            return Ok(room_id);
        }
        if let Some(room_id) = sqlx::query_scalar::<_, String>(
            "SELECT r.id FROM rooms r
             JOIN terminals t ON r.terminalId = t.id
             WHERE (t.terminalIp = ?1 OR EXISTS (
                 SELECT 1 FROM terminal_connections c WHERE c.terminalId=t.id AND c.ipAddress=?1 AND c.onlineStatus=1)) LIMIT 1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        {
            return Ok(room_id);
        }

        Err(AppError::NotFound(format!("房间不存在: {}", id)))
    }

    /// 根据ID获取房间（包含歌曲标题）
    pub async fn get_by_id_with_song_title(
        pool: &SqlitePool,
        id: &str,
    ) -> AppResult<RoomWithTerminalInfo> {
        let row = sqlx::query(
            "SELECT
                r.*,
                t.terminalIp as roomIp,
                t.name as terminalName,
                t.onlineStatus as terminalOnline,
                q.songTitle as currentSongTitle
            FROM rooms r
            LEFT JOIN terminals t ON r.terminalId = t.id
            LEFT JOIN (
                SELECT roomId,
                       songTitle,
                       ROW_NUMBER() OVER (
                           PARTITION BY roomId
                           ORDER BY CASE WHEN status = 1 THEN 0 ELSE 1 END,
                                    isPriority DESC, position ASC
                       ) AS rn
                FROM room_queue
                WHERE status IN (0, 1)
            ) q ON q.roomId = r.id AND q.rn = 1
            WHERE r.id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("房间不存在: {}", id)))?;

        let mut room_info = RoomWithTerminalInfo {
            id: row.get("id"),
            name: row.get("name"),
            terminalId: row.get("terminalId"),
            typeId: row.get("typeId"),
            areaId: row.get("areaId"),
            status: row.get("status"),
            currentSongId: row.get("currentSongId"),
            currentSongTitle: row.try_get("currentSongTitle").ok(),
            volume: row.get("volume"),
            musicVolume: row.try_get("musicVolume").ok(),
            micVolume: row.try_get("micVolume").ok(),
            micStatus: row.get("micStatus"),
            acState: row.get("acState"),
            lightState: row.get("lightState"),
            effectState: row.get("effectState"),
            muteStatus: row.get("muteStatus"),
            playState: row.get("playState"),
            createdAt: row.get("createdAt"),
            updatedAt: row.get("updatedAt"),
            roomIp: row.try_get("roomIp").ok(),
            terminalName: row.try_get("terminalName").ok(),
            terminalOnline: row.try_get("terminalOnline").ok(),
        };

        // 【优化】歌名补全：如果 currentSongTitle 为空，尝试从队列中查找对应记录的歌名
        if room_info.currentSongTitle.is_none() || room_info.currentSongTitle.as_deref() == Some("")
        {
            let title: Option<String> = sqlx::query_scalar(
                "SELECT songTitle FROM room_queue WHERE roomId = ? AND status = 1 LIMIT 1",
            )
            .bind(id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
            room_info.currentSongTitle = title;
        }

        Ok(room_info)
    }

    /// 获取所有房间
    pub async fn list_all(pool: &SqlitePool) -> AppResult<Vec<Room>> {
        let rooms = sqlx::query_as::<_, Room>("SELECT * FROM rooms ORDER BY name ASC")
            .fetch_all(pool)
            .await?;
        Ok(rooms)
    }

    /// 获取所有房间（包含终端IP等扩展信息）
    pub async fn list_all_with_terminal_info(
        pool: &SqlitePool,
    ) -> AppResult<Vec<RoomWithTerminalInfo>> {
        let rows = sqlx::query(
            "SELECT
                r.id, r.name, r.terminalId, r.typeId, r.areaId, r.status,
                r.currentSongId, r.volume, r.micStatus,
                COALESCE(r.acState, '{\"power\":false,\"temp\":26,\"mode\":\"auto\"}') as acState,
                COALESCE(r.lightState, '{\"scene\":\"auto\"}') as lightState,
                COALESCE(r.effectState, '{\"mode\":\"standard\"}') as effectState,
                COALESCE(r.muteStatus, 0) as muteStatus,
                COALESCE(r.playState, 0) as playState,
                r.musicVolume,
                r.micVolume,
                r.createdAt, r.updatedAt,
                t.terminalIp as roomIp,
                t.name as terminalName,
                t.onlineStatus as terminalOnline,
                q.songTitle as currentSongTitle
            FROM rooms r
            LEFT JOIN terminals t ON r.terminalId = t.id
            LEFT JOIN (
                SELECT roomId,
                       songTitle,
                       ROW_NUMBER() OVER (
                           PARTITION BY roomId
                           ORDER BY CASE WHEN status = 1 THEN 0 ELSE 1 END,
                                    isPriority DESC, position ASC
                       ) AS rn
                FROM room_queue
                WHERE status IN (0, 1)
            ) q ON q.roomId = r.id AND q.rn = 1
            ORDER BY r.name ASC",
        )
        .fetch_all(pool)
        .await?;

        let result: Vec<RoomWithTerminalInfo> =
            rows.iter().map(room_with_terminal_info_from_row).collect();

        Ok(result)
    }

    /// 根据终端 IP 获取房间列表（用于触摸屏按 IP 识别房间，公开接口）
    pub async fn list_by_terminal_ip(
        pool: &SqlitePool,
        terminalIp: &str,
    ) -> AppResult<Vec<RoomWithTerminalInfo>> {
        if terminalIp.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query(
            "SELECT
                r.id, r.name, r.terminalId, r.typeId, r.areaId, r.status,
                r.currentSongId, r.volume, r.micStatus,
                COALESCE(r.acState, '{\"power\":false,\"temp\":26,\"mode\":\"auto\"}') as acState,
                COALESCE(r.lightState, '{\"scene\":\"auto\"}') as lightState,
                COALESCE(r.effectState, '{\"mode\":\"standard\"}') as effectState,
                COALESCE(r.muteStatus, 0) as muteStatus,
                COALESCE(r.playState, 0) as playState,
                r.musicVolume, r.micVolume,
                r.createdAt, r.updatedAt,
                t.terminalIp as roomIp,
                t.name as terminalName,
                t.onlineStatus as terminalOnline,
                q.songTitle as currentSongTitle
            FROM rooms r
            JOIN terminals t ON r.terminalId = t.id
            LEFT JOIN (
                SELECT roomId,
                       songTitle,
                       ROW_NUMBER() OVER (
                           PARTITION BY roomId
                           ORDER BY CASE WHEN status = 1 THEN 0 ELSE 1 END,
                                    isPriority DESC, position ASC
                       ) AS rn
                FROM room_queue
                WHERE status IN (0, 1)
            ) q ON q.roomId = r.id AND q.rn = 1
            WHERE (t.terminalIp = ?1 OR EXISTS (
                SELECT 1 FROM terminal_connections c WHERE c.terminalId=t.id AND c.ipAddress=?1 AND c.onlineStatus=1))
            ORDER BY r.name ASC",
        )
        .bind(terminalIp)
        .fetch_all(pool)
        .await?;

        let result: Vec<RoomWithTerminalInfo> =
            rows.iter().map(room_with_terminal_info_from_row).collect();
        Ok(result)
    }

    pub async fn upsert_room_client_http_source(
        pool: &SqlitePool,
        roomId: &str,
        roomIp: &str,
        clientIp: &str,
        clientType: &str,
    ) -> AppResult<()> {
        let source_id = format!("{}|{}", roomId, clientIp);

        sqlx::query(
            "INSERT INTO room_client_http_sources (
                source_id, roomId, roomIp, clientIp, clientType, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
            ON CONFLICT(source_id) DO UPDATE SET
                roomId = excluded.roomId,
                roomIp = excluded.roomIp,
                clientIp = excluded.clientIp,
                clientType = excluded.clientType,
                updatedAt = datetime('now','localtime')",
        )
        .bind(&source_id)
        .bind(roomId)
        .bind(roomIp)
        .bind(clientIp)
        .bind(clientType)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn get_room_client_http_source(
        pool: &SqlitePool,
        roomId: &str,
        clientIp: &str,
    ) -> AppResult<Option<RoomClientHttpSource>> {
        let row = sqlx::query_as::<_, RoomClientHttpSource>(
            "SELECT * FROM room_client_http_sources
             WHERE roomId = ? AND clientIp = ?
             ORDER BY datetime(updatedAt) DESC
             LIMIT 1",
        )
        .bind(roomId)
        .bind(clientIp)
        .fetch_optional(pool)
        .await?;
        Ok(row)
    }

    pub async fn upsert_room_client_connection(
        pool: &SqlitePool,
        connection_id: &str,
        roomId: &str,
        roomName: &str,
        roomIp: &str,
        terminalId: &str,
        terminalName: &str,
        clientType: &str,
        clientIp: &str,
    ) -> AppResult<()> {
        let record_id = format!("{}|{}|{}", roomId, clientType, clientIp);

        // 同一房间、同一客户端 IP 只保留一条在线记录，避免类型切换后出现 display/pc 双记录
        sqlx::query(
            "UPDATE room_client_connections
             SET status = 0,
                 updatedAt = datetime('now','localtime'),
                 disconnectedAt = datetime('now','localtime'),
                 currentConnectionId = ''
             WHERE roomId = ? AND clientIp = ? AND currentConnectionId != ? AND status = 1",
        )
        .bind(roomId)
        .bind(clientIp)
        .bind(connection_id)
        .execute(pool)
        .await?;

        sqlx::query(
            "INSERT INTO room_client_connections (
                connection_id, roomId, roomName, roomIp, terminalId, terminalName, clientType, clientIp,
                currentConnectionId, status, connectedAt, updatedAt, disconnectedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now','localtime'), datetime('now','localtime'), '')
            ON CONFLICT(connection_id) DO UPDATE SET
                roomId = excluded.roomId,
                roomName = excluded.roomName,
                roomIp = excluded.roomIp,
                terminalId = excluded.terminalId,
                terminalName = excluded.terminalName,
                clientType = excluded.clientType,
                clientIp = excluded.clientIp,
                currentConnectionId = excluded.currentConnectionId,
                status = 1,
                updatedAt = datetime('now','localtime'),
                disconnectedAt = ''"
        )
        .bind(&record_id)
        .bind(roomId)
        .bind(roomName)
        .bind(roomIp)
        .bind(terminalId)
        .bind(terminalName)
        .bind(clientType)
        .bind(clientIp)
        .bind(connection_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn mark_room_client_connection_disconnected(
        pool: &SqlitePool,
        connection_id: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE room_client_connections
             SET status = 0,
                 updatedAt = datetime('now','localtime'),
                 disconnectedAt = datetime('now','localtime'),
                 currentConnectionId = ''
             WHERE currentConnectionId = ?",
        )
        .bind(connection_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    async fn clear_room_client_connections(
        conn: &mut sqlx::SqliteConnection,
        roomId: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE room_client_connections
             SET status = 0,
                 updatedAt = datetime('now','localtime'),
                 disconnectedAt = datetime('now','localtime'),
                 currentConnectionId = ''
             WHERE roomId = ?",
        )
        .bind(roomId)
        .execute(conn)
        .await?;
        Ok(())
    }

    /// 更新房间
    pub async fn update(pool: &SqlitePool, id: &str, req: UpdateRoomRequest) -> AppResult<Room> {
        let existing = Self::get_by_id(pool, id).await?;
        let name = req.name.as_deref().map(str::trim).unwrap_or(&existing.name);
        if name.is_empty() {
            return Err(AppError::BadRequest("房间名称不能为空".to_string()));
        }
        if let Some(terminal_id) = req.terminalId.as_deref() {
            let terminal_id = terminal_id.trim();
            if terminal_id.is_empty() {
                return Err(AppError::BadRequest("terminalId 不能为空".to_string()));
            }
            if terminal_id != existing.terminalId {
                return Err(AppError::BadRequest(
                    "房间 ID 与终端 ID 一一对应，不能在编辑时更换终端".to_string(),
                ));
            }
        }
        let normalized_type_id = match req.typeId {
            Some(value) => Self::normalize_optional_fk(value),
            None => existing.typeId.filter(|value| *value > 0),
        };
        let normalized_area_id = match req.areaId {
            Some(value) => Self::normalize_optional_fk(value),
            None => existing.areaId.filter(|value| *value > 0),
        };

        let mut transaction = pool.begin().await?;
        sqlx::query(
            "UPDATE rooms SET name=COALESCE(?,name), terminalId=?, typeId=?, areaId=?, status=?, volume=?, musicVolume=?, micVolume=?, micStatus=?,
             acState=?, lightState=?, effectState=?, muteStatus=?, playState=?,
             updatedAt=datetime('now','localtime')
             WHERE id = ?"
        )
        .bind(req.name.as_deref().map(str::trim))
        .bind(&existing.terminalId)
        .bind(normalized_type_id)
        .bind(normalized_area_id)
        .bind(req.status.unwrap_or(existing.status))
        .bind(req.volume.unwrap_or(existing.volume))
        .bind(req.musicVolume.or(existing.musicVolume).or(Some(existing.volume)))
        .bind(req.micVolume.or(existing.micVolume).or(Some(50)))
        .bind(req.micStatus.unwrap_or(existing.micStatus))
        .bind(req.acState.as_deref().unwrap_or(&existing.acState))
        .bind(req.lightState.as_deref().unwrap_or(&existing.lightState))
        .bind(req.effectState.as_deref().unwrap_or(&existing.effectState))
        .bind(req.muteStatus.unwrap_or(existing.muteStatus))
        .bind(req.playState.unwrap_or(existing.playState))
        .bind(id)
        .execute(&mut *transaction)
        .await?;

        // An explicit room name is also the bound device's management name.
        // Commit both together so a failed save cannot leave different names.
        if req.name.is_some() {
            let terminal = sqlx::query(
                "UPDATE terminals SET name = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
            )
            .bind(name)
            .bind(&existing.terminalId)
            .execute(&mut *transaction)
            .await?;
            if terminal.rows_affected() == 0 {
                return Err(AppError::BadRequest(format!(
                    "终端不存在: {}",
                    existing.terminalId
                )));
            }
        }

        // 🆕 关房结算逻辑：如果状态变更为 0 (空闲) 或 2 (维修)，则彻底清理并初始化该房间的所有状态
        if let Some(status) = req.status {
            if status == 0 || status == 2 {
                // 1. 删除所有已点和已唱记录
                sqlx::query("DELETE FROM room_queue WHERE roomId = ?")
                    .bind(id)
                    .execute(&mut *transaction)
                    .await?;

                // 1.1 清理该房间已登记的在线客户端记录
                Self::clear_room_client_connections(&mut transaction, id).await?;

                // 2. 复位所有物理和外设状态到系统默认值
                sqlx::query(
                    "UPDATE rooms SET
                        currentSongId = '',
                        playState = 0,
                        volume = 50,
                        musicVolume = 50,
                        micVolume = 50,
                        micStatus = 1,
                        muteStatus = 0,
                        acState = '{\"power\":false,\"temp\":26,\"mode\":\"auto\"}',
                        lightState = '{\"scene\":\"auto\"}',
                        effectState = '{\"mode\":\"standard\"}',
                        updatedAt = datetime('now','localtime')
                     WHERE id = ?",
                )
                .bind(id)
                .execute(&mut *transaction)
                .await?;

                let r_name = sqlx::query_scalar::<_, String>("SELECT name FROM rooms WHERE id = ?")
                    .bind(id)
                    .fetch_optional(&mut *transaction)
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| id.to_string());
                tracing::info!(
                    "[结算] 房间 {} ({}) 状态已深度重置 (状态={})",
                    r_name,
                    if id.len() > 8 { &id[..8] } else { id },
                    status
                );
            }
        }

        transaction.commit().await?;
        Self::get_by_id(pool, id).await
    }

    // ==================== 配置管理 (类型/区域) ====================

    pub async fn list_types(pool: &SqlitePool) -> AppResult<Vec<RoomType>> {
        let list = sqlx::query_as::<_, RoomType>(
            "SELECT * FROM room_types WHERE id > 0 AND TRIM(name) != '' ORDER BY id ASC",
        )
        .fetch_all(pool)
        .await?;
        Ok(list)
    }

    pub async fn create_type(pool: &SqlitePool, name: &str) -> AppResult<RoomType> {
        let id: i64 = sqlx::query("INSERT INTO room_types (name) VALUES (?)")
            .bind(name)
            .execute(pool)
            .await?
            .last_insert_rowid();

        Ok(RoomType {
            id: id as i32,
            name: name.to_string(),
        })
    }

    pub async fn delete_type(pool: &SqlitePool, id: i32) -> AppResult<()> {
        sqlx::query("DELETE FROM room_types WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn list_areas(pool: &SqlitePool) -> AppResult<Vec<RoomArea>> {
        let list = sqlx::query_as::<_, RoomArea>("SELECT * FROM room_areas ORDER BY id ASC")
            .fetch_all(pool)
            .await?;
        Ok(list)
    }

    pub async fn create_area(pool: &SqlitePool, name: &str) -> AppResult<RoomArea> {
        let id: i64 = sqlx::query("INSERT INTO room_areas (name) VALUES (?)")
            .bind(name)
            .execute(pool)
            .await?
            .last_insert_rowid();

        Ok(RoomArea {
            id: id as i32,
            name: name.to_string(),
        })
    }

    pub async fn delete_area(pool: &SqlitePool, id: i32) -> AppResult<()> {
        sqlx::query("DELETE FROM room_areas WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// 删除房间
    pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
        // 先清空队列
        sqlx::query("DELETE FROM room_queue WHERE roomId = ?")
            .bind(id)
            .execute(pool)
            .await?;

        let result = sqlx::query("DELETE FROM rooms WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("房间不存在: {}", id)));
        }
        Ok(())
    }

    fn automatic_room_name(_terminalId: &str, terminalName: &str) -> String {
        let terminal_name = terminalName.trim();
        if terminal_name.is_empty() {
            return "房间".to_string();
        }

        // Keep the complete terminal name so automatically created rooms stay one-to-one.
        format!("房间-{}", terminal_name)
    }

    fn has_generated_terminal_suffix(roomName: &str, automaticName: &str) -> bool {
        roomName
            .strip_prefix(automaticName)
            .and_then(|suffix| suffix.strip_prefix('-'))
            .is_some_and(|suffix| {
                suffix.len() == 8 && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
    }

    /// Automatically create a room while preserving the complete terminal name.
    pub async fn auto_create_for_terminal(
        pool: &SqlitePool,
        terminalId: &str,
        terminalName: &str,
    ) -> AppResult<Room> {
        let automatic_name = Self::automatic_room_name(terminalId, terminalName);

        let existing = sqlx::query_as::<_, Room>("SELECT * FROM rooms WHERE terminalId = ?")
            .bind(terminalId)
            .fetch_optional(pool)
            .await?;

        if let Some(room) = existing {
            // Remove the generated player suffix only from the exact automatic format.
            // User-defined room names remain untouched.
            if Self::has_generated_terminal_suffix(&room.name, &automatic_name) {
                sqlx::query(
                    "UPDATE rooms SET name = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
                )
                .bind(&automatic_name)
                .bind(&room.id)
                .execute(pool)
                .await?;

                return Self::get_by_id(pool, &room.id).await;
            }

            return Ok(room);
        }

        // Concurrent admissions from two interfaces must create exactly one room.
        sqlx::query(
            "INSERT INTO rooms (id, name, terminalId, room_type) VALUES (?, ?, ?, 0)
                     ON CONFLICT(id) DO NOTHING",
        )
        .bind(terminalId)
        .bind(&automatic_name)
        .bind(terminalId)
        .execute(pool)
        .await?;
        let room = Self::get_by_id(pool, terminalId).await?;

        tracing::info!("[Discover] 新房间已创建: {} ({})", room.name, terminalId);
        Ok(room)
    }

    // ==================== 点歌队列操作 ====================

    /// 获取房间歌曲队列
    pub async fn get_queue(pool: &SqlitePool, roomId: &str) -> AppResult<Vec<RoomQueueItem>> {
        let sql = format!(
            "{} WHERE roomId = ? AND status IN (0, 1)
             ORDER BY
                CASE WHEN status = 1 THEN 0 ELSE 1 END,
                isPriority DESC,
                position ASC",
            Self::queue_select_sql()
        );
        let items = sqlx::query_as::<_, RoomQueueItem>(&sql)
            .bind(roomId)
            .fetch_all(pool)
            .await?;
        Ok(items)
    }

    /// Atomically promote the first waiting item only when the room has no active item.
    /// Unlike next_song, this never finishes or replaces a playing/paused song.
    async fn activate_next_if_idle(
        pool: &SqlitePool,
        room_id: &str,
    ) -> AppResult<Option<RoomQueueItem>> {
        let mut tx = pool.begin().await?;
        // This is intentionally the first statement in the transaction. SQLite obtains the
        // write lock before evaluating the subqueries, so simultaneous PAD/phone requests
        // cannot both observe an idle room and replace each other.
        let activated: Option<(String, String)> = sqlx::query_as(
            "UPDATE room_queue
             SET status = 1
             WHERE id = (
                 SELECT id FROM room_queue
                 WHERE roomId = ? AND status = 0
                 ORDER BY isPriority DESC, position ASC
                 LIMIT 1
             )
               AND NOT EXISTS (
                   SELECT 1 FROM room_queue
                   WHERE roomId = ? AND status = 1
               )
             RETURNING id, songId",
        )
        .bind(room_id)
        .bind(room_id)
        .fetch_optional(&mut *tx)
        .await?;

        let Some((queue_id, song_id)) = activated else {
            tx.commit().await?;
            return Ok(None);
        };

        sqlx::query(
            "UPDATE rooms
             SET currentSongId = ?, playState = 1,
                 updatedAt = datetime('now','localtime')
             WHERE id = ?",
        )
        .bind(&song_id)
        .bind(room_id)
        .execute(&mut *tx)
        .await?;

        let sql = format!("{} WHERE id = ?", Self::queue_select_sql());
        let item = sqlx::query_as::<_, RoomQueueItem>(&sql)
            .bind(&queue_id)
            .fetch_optional(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(item)
    }

    /// Finish a queue insertion through the single authoritative activation path and
    /// return the inserted row after its final waiting/active status is known.
    pub async fn finalize_queue_enqueue(
        pool: &SqlitePool,
        room_id: &str,
        queue_item_id: &str,
    ) -> AppResult<RoomQueueItem> {
        Self::activate_next_if_idle(pool, room_id).await?;

        let sql = format!("{} WHERE id = ? AND roomId = ?", Self::queue_select_sql());
        sqlx::query_as::<_, RoomQueueItem>(&sql)
            .bind(queue_item_id)
            .bind(room_id)
            .fetch_one(pool)
            .await
            .map_err(Into::into)
    }

    /// Persist an external YouTube media item in the room queue.
    /// video_file_type=youtube distinguishes it from local media; songPath stores the stable stream proxy path.
    /// songId stores the stable video identifier so reconnects can restore the queue record.
    pub async fn add_youtube_to_queue(
        pool: &SqlitePool,
        room_id: &str,
        video_id: &str,
        title: &str,
        channel: &str,
        stream_url: &str,
        is_priority: bool,
    ) -> AppResult<RoomQueueItem> {
        let video_id = video_id.trim();
        let stream_url = stream_url.trim();
        if video_id.is_empty() || stream_url.is_empty() {
            return Err(AppError::BadRequest(
                "YouTube video ID or stream URL is empty".to_string(),
            ));
        }

        let current_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM room_queue WHERE roomId = ? AND status IN (0, 1)",
        )
        .bind(room_id)
        .fetch_one(pool)
        .await?;
        if current_count >= 100 {
            return Err(AppError::BadRequest(
                "queue is full (maximum 100 items)".to_string(),
            ));
        }

        let max_position: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(position), 0) FROM room_queue WHERE roomId = ? AND status IN (0, 1)",
        )
        .bind(room_id)
        .fetch_one(pool)
        .await?;

        let id = format!("{}-youtube-{}-{}", room_id, video_id, uuid::Uuid::new_v4());
        let song_id = format!("youtube:{}", video_id);

        sqlx::query(
            "INSERT INTO room_queue (
                id, roomId, songId, songTitle, artistName, position, isPriority,
                songNo, singer_no, languageCode, classify_code, light_code,
                songPath, video_file_type, track, score_enabled
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(room_id)
        .bind(&song_id)
        .bind(if title.trim().is_empty() {
            "YouTube video"
        } else {
            title.trim()
        })
        .bind(channel.trim())
        .bind(max_position + 1)
        .bind(is_priority as i32)
        .bind(&song_id)
        .bind("")
        .bind("")
        .bind("")
        .bind("")
        .bind(stream_url)
        .bind("youtube")
        .bind(0_i32)
        .bind(0_i32)
        .execute(pool)
        .await?;

        let sql = format!("{} WHERE id = ?", Self::queue_select_sql());
        sqlx::query_as::<_, RoomQueueItem>(&sql)
            .bind(&id)
            .fetch_one(pool)
            .await
            .map_err(Into::into)
    }

    fn validated_local_song_path(
        song_no: &str,
        local_absolute_path: Option<String>,
    ) -> AppResult<String> {
        let path =
            media_path::normalize_slashes(local_absolute_path.as_deref().unwrap_or_default());
        if path.is_empty() || !media_path::is_media_file_path(&path) {
            return Err(AppError::BadRequest(format!(
                "歌曲文件不可用，请重新扫描曲库: {}",
                song_no
            )));
        }
        Ok(path)
    }

    pub async fn add_to_queue(
        pool: &SqlitePool,
        song_db: &SqlitePool,
        roomId: &str,
        req: AddToQueueRequest,
    ) -> AppResult<RoomQueueItem> {
        // Queue rows need an identity that remains unique under concurrent requests.
        let id = format!("{}-{}", roomId, uuid::Uuid::new_v4());

        #[derive(sqlx::FromRow)]
        struct SongInfo {
            songName: String,
            singerNames: String,
            songNo: String,
            primarySingerNo: String,
            languageCode: String,
            categoryCode: String,
            light_code: String,
            video_file_type: String,
            track: i32,
            score_enabled: i32,
            local_absolute_path: Option<String>,
        }

        let song_cols = Self::table_columns(song_db, "songs").await?;
        let song_info_sql = format!(
            "SELECT {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, (SELECT absolutePath FROM local_available_songs WHERE songNo = songs.songNo LIMIT 1) AS local_absolute_path FROM songs WHERE songNo = ?",
            Self::text_expr(&song_cols, "songName", "songName"),
            Self::text_expr(&song_cols, "singerNames", "singerNames"),
            Self::text_expr(&song_cols, "songNo", "songNo"),
            Self::text_expr(&song_cols, "primarySingerNo", "primarySingerNo"),
            Self::text_expr(&song_cols, "languageCode", "languageCode"),
            Self::text_expr(&song_cols, "categoryCode", "categoryCode"),
            Self::text_expr(&song_cols, "lightCode", "light_code"),
            Self::text_expr(&song_cols, "videoFileType", "video_file_type"),
            Self::int_expr(&song_cols, "track", "track"),
            Self::int_expr(&song_cols, "scoreEnabled", "score_enabled")
        );
        let song_info = sqlx::query_as::<_, SongInfo>(&song_info_sql)
            .bind(&req.songId)
            .fetch_optional(song_db)
            .await?
            .ok_or_else(|| AppError::NotFound("歌曲不存在".to_string()))?;

        // 🆕 限制点播列表上限为 100 首
        let current_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM room_queue WHERE roomId = ? AND status IN (0, 1)",
        )
        .bind(roomId)
        .fetch_one(pool)
        .await?;

        if current_count >= 100 {
            return Err(AppError::BadRequest(
                "点播列表已满 (上限 100 首)".to_string(),
            ));
        }

        // 获取当前最大位置
        let max_pos: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(position), 0) FROM room_queue WHERE roomId = ? AND status IN (0, 1)"
        )
        .bind(roomId)
        .fetch_one(pool)
        .await?;

        let isPriority = req.isPriority.unwrap_or(false) as i32;

        // local_available_songs is the single source of truth for point-order availability.
        // Catalog metadata may still contain an old absolutePath after a disk is removed, so it
        // must never be used as a fallback here.
        // Read format and matched path in one SQLite snapshot: a scan may commit
        // while the separate room database is being queried above.
        let songPath = Self::validated_local_song_path(&song_info.songNo, song_info.local_absolute_path)?;

        let inserted = sqlx::query(
            "INSERT INTO room_queue (
                id, roomId, songId, songTitle, artistName, position, isPriority,
                songNo, singer_no, languageCode, classify_code, light_code,
                songPath, video_file_type, track, score_enabled
             ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE NOT EXISTS (
                 SELECT 1 FROM room_queue WHERE roomId = ? AND songId = ? AND status IN (0, 1)
             )",
        )
        .bind(&id)
        .bind(roomId)
        .bind(&req.songId)
        .bind(&song_info.songName)
        .bind(&song_info.singerNames)
        .bind(max_pos + 1)
        .bind(isPriority)
        .bind(&song_info.songNo)
        .bind(&song_info.primarySingerNo)
        .bind(&song_info.languageCode)
        .bind(&song_info.categoryCode)
        .bind(&song_info.light_code)
        .bind(songPath)
        .bind(&song_info.video_file_type)
        .bind(song_info.track)
        .bind(song_info.score_enabled)
        .bind(roomId)
        .bind(&req.songId)
        .execute(pool)
        .await?;

        if inserted.rows_affected() == 0 {
            return Err(AppError::BadRequest("该歌曲已在已选列表中，请勿重复点播".into()));
        }

        let sql = format!("{} WHERE id = ?", Self::queue_select_sql());
        sqlx::query_as::<_, RoomQueueItem>(&sql)
            .bind(&id)
            .fetch_one(pool)
            .await
            .map_err(|e| e.into())
    }

    /// Prioritize a waiting song into the next-song position.
    pub async fn prioritize_song(pool: &SqlitePool, roomId: &str, targetId: &str) -> AppResult<()> {
        let short_rid = if roomId.len() > 8 {
            &roomId[..8]
        } else {
            roomId
        };
        let short_target = if targetId.len() > 8 {
            &targetId[..8]
        } else {
            targetId
        };
        tracing::debug!(
            "[RoomService] prioritize song in room {}: {}",
            short_rid,
            short_target
        );

        let mut tx = pool.begin().await?;

        // targetId may be a queue-row UUID or the song number used by song-list pages.
        let item_id = sqlx::query_scalar::<_, String>(
            "SELECT id FROM room_queue
             WHERE roomId = ? AND (id = ? OR songId = ?) AND status = 0
             ORDER BY position ASC
             LIMIT 1",
        )
        .bind(roomId)
        .bind(targetId)
        .bind(targetId)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            tracing::warn!(
                "[RoomService] prioritize failed; waiting queue item not found: {}",
                targetId
            );
            AppError::NotFound(format!("queue item not found: {}", targetId))
        })?;

        // The production room_queue schema has no updatedAt column. Only update
        // the unique priority flag and queue positions required by this API.
        sqlx::query("UPDATE room_queue SET isPriority = 0 WHERE roomId = ? AND status = 0")
            .bind(roomId)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE room_queue SET isPriority = 1 WHERE id = ?")
            .bind(&item_id)
            .execute(&mut *tx)
            .await?;

        // Keep the active item first, the selected priority item second, and all
        // remaining waiting items in their previous relative order.
        let item_ids = sqlx::query_scalar::<_, String>(
            "SELECT id FROM room_queue
             WHERE roomId = ? AND status IN (0, 1)
             ORDER BY
                CASE WHEN status = 1 THEN 0 ELSE 1 END,
                isPriority DESC,
                position ASC",
        )
        .bind(roomId)
        .fetch_all(&mut *tx)
        .await?;

        for (index, id) in item_ids.iter().enumerate() {
            sqlx::query("UPDATE room_queue SET position = ? WHERE id = ?")
                .bind((index + 1) as i32)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// 获取已唱/已跳过的歌曲列表（status IN (2, 3)），按时间倒序
    pub async fn get_played_queue(
        pool: &SqlitePool,
        roomId: &str,
    ) -> AppResult<Vec<RoomQueueItem>> {
        let sql = format!(
            "{} WHERE roomId = ? AND status IN (2, 3) ORDER BY addedAt DESC",
            Self::queue_select_sql()
        );
        let items = sqlx::query_as::<_, RoomQueueItem>(&sql)
            .bind(roomId)
            .fetch_all(pool)
            .await?;
        Ok(items)
    }

    /// 切歌（跳过当前歌曲，播放下一首）
    pub async fn next_song(
        pool: &SqlitePool,
        roomId: &str,
        finished_status: i32,
    ) -> AppResult<SongAdvanceResult> {
        Self::advance_song(pool, roomId, finished_status, None).await
    }

    /// Complete the exact queue row reported by the player.
    /// A stale or duplicate completion is a successful no-op and can never
    /// finish a newer active row.
    pub async fn next_song_if_current(
        pool: &SqlitePool,
        roomId: &str,
        finished_status: i32,
        expected_queue_id: &str,
    ) -> AppResult<SongAdvanceResult> {
        let expected_queue_id = expected_queue_id.trim();
        if expected_queue_id.is_empty() {
            return Err(AppError::BadRequest(
                "queueItemId must not be empty".to_string(),
            ));
        }
        Self::advance_song(pool, roomId, finished_status, Some(expected_queue_id)).await
    }

    async fn advance_song(
        pool: &SqlitePool,
        roomId: &str,
        finished_status: i32,
        expected_queue_id: Option<&str>,
    ) -> AppResult<SongAdvanceResult> {
        let mut tx = pool.begin().await?;

        // The first statement is a write so SQLite serializes competing room
        // transitions before any active/waiting state is observed. Player EOF
        // requests additionally match the exact queue row that actually ended.
        let current: Option<(String, String)> = if let Some(queue_id) = expected_queue_id {
            sqlx::query_as(
                "UPDATE room_queue
                 SET status = ?
                 WHERE id = ? AND roomId = ? AND status = 1
                   AND EXISTS (
                       SELECT 1 FROM rooms
                       WHERE rooms.id = room_queue.roomId AND rooms.playState = 1
                   )
                 RETURNING id, songId",
            )
            .bind(finished_status)
            .bind(queue_id)
            .bind(roomId)
            .fetch_optional(&mut *tx)
            .await?
        } else {
            sqlx::query_as(
                "UPDATE room_queue
                 SET status = ?
                 WHERE id = (
                     SELECT id FROM room_queue
                     WHERE roomId = ? AND status = 1
                     ORDER BY position ASC
                     LIMIT 1
                 )
                 RETURNING id, songId",
            )
            .bind(finished_status)
            .bind(roomId)
            .fetch_optional(&mut *tx)
            .await?
        };

        if current.is_none() {
            tx.commit().await?;
            return Ok(SongAdvanceResult {
                advanced: false,
                next: None,
            });
        }

        let next: Option<(String, String)> = sqlx::query_as(
            "SELECT id, songId
             FROM room_queue
             WHERE roomId = ? AND status = 0
             ORDER BY isPriority DESC, position ASC
             LIMIT 1",
        )
        .bind(roomId)
        .fetch_optional(&mut *tx)
        .await?;

        let result = if let Some((queue_id, song_id)) = next {
            sqlx::query("UPDATE room_queue SET status = 1 WHERE id = ? AND status = 0")
                .bind(&queue_id)
                .execute(&mut *tx)
                .await?;

            sqlx::query(
                "UPDATE rooms
                 SET currentSongId = ?, playState = 1,
                     updatedAt = datetime('now','localtime')
                 WHERE id = ?",
            )
            .bind(&song_id)
            .bind(roomId)
            .execute(&mut *tx)
            .await?;

            let sql = format!("{} WHERE id = ?", Self::queue_select_sql());
            sqlx::query_as::<_, RoomQueueItem>(&sql)
                .bind(&queue_id)
                .fetch_optional(&mut *tx)
                .await?
        } else {
            sqlx::query(
                "UPDATE rooms
                 SET currentSongId = '', playState = 0,
                     updatedAt = datetime('now','localtime')
                 WHERE id = ?",
            )
            .bind(roomId)
            .execute(&mut *tx)
            .await?;
            None
        };

        tx.commit().await?;

        // Statistics are best-effort and deliberately outside the queue-state
        // transaction: a missing legacy songs table must never roll back or
        // delay the authoritative playingNow transition.
        if let Some((_, song_id)) = current {
            if !song_id.is_empty() {
                let _ = sqlx::query("UPDATE songs SET play_count = play_count + 1 WHERE id = ?")
                    .bind(song_id)
                    .execute(pool)
                    .await;
            }
        }

        Ok(SongAdvanceResult {
            advanced: true,
            next: result,
        })
    }

    /// 清空队列（保留正在播放的歌曲）
    pub async fn clear_queue(pool: &SqlitePool, roomId: &str) -> AppResult<()> {
        // 只删除等待播放的歌曲（status = 0），保留正在播放的（status = 1）
        sqlx::query("DELETE FROM room_queue WHERE roomId = ? AND status = 0")
            .bind(roomId)
            .execute(pool)
            .await?;

        // 不清空 currentSongId，因为还在播放
        Ok(())
    }

    /// Delete an exact active queue row, or all active occurrences of a song number.
    /// Historical played/skipped rows are never deletion targets.
    /// When the active row is removed, promote the next row and update rooms atomically.
    pub async fn delete_from_queue(
        pool: &SqlitePool,
        roomId: &str,
        targetId: &str,
    ) -> AppResult<()> {
        #[derive(sqlx::FromRow)]
        struct DeleteTarget {
            id: String,
            status: i32,
        }

        #[derive(sqlx::FromRow)]
        struct NextTarget {
            id: String,
            songId: String,
        }

        let mut tx = pool.begin().await?;
        let target = sqlx::query_as::<_, DeleteTarget>(
            "SELECT id, status
             FROM room_queue
             WHERE roomId = ? AND status IN (0, 1) AND (id = ? OR songId = ?)
             ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END,
                      CASE WHEN status = 1 THEN 0 ELSE 1 END,
                      isPriority DESC,
                      position ASC
             LIMIT 1",
        )
        .bind(roomId)
        .bind(targetId)
        .bind(targetId)
        .bind(targetId)
        .fetch_optional(&mut *tx)
        .await?;

        let Some(target) = target else {
            tx.commit().await?;
            return Ok(());
        };

        // A song-number operation removes legacy duplicates together; row-ID callers stay exact.
        sqlx::query("DELETE FROM room_queue WHERE roomId = ? AND status IN (0, 1) AND (id = ? OR (? = 0 AND songId = ?))")
            .bind(roomId)
            .bind(&target.id)
            .bind(target.id == targetId)
            .bind(targetId)
            .execute(&mut *tx)
            .await?;

        if target.status == 1 {
            let next = sqlx::query_as::<_, NextTarget>(
                "SELECT id, songId
                 FROM room_queue
                 WHERE roomId = ? AND status = 0
                 ORDER BY isPriority DESC, position ASC
                 LIMIT 1",
            )
            .bind(roomId)
            .fetch_optional(&mut *tx)
            .await?;

            if let Some(next) = next {
                sqlx::query("UPDATE room_queue SET status = 1 WHERE id = ?")
                    .bind(&next.id)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query(
                    "UPDATE rooms
                     SET currentSongId = ?, playState = 1,
                         updatedAt = datetime('now','localtime')
                     WHERE id = ?",
                )
                .bind(&next.songId)
                .bind(roomId)
                .execute(&mut *tx)
                .await?;
            } else {
                sqlx::query(
                    "UPDATE rooms
                     SET currentSongId = '', playState = 0,
                         updatedAt = datetime('now','localtime')
                     WHERE id = ?",
                )
                .bind(roomId)
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;
        Ok(())
    }

    /// 打乱队列（排除正在播放的第一首）
    pub async fn shuffle_queue(pool: &SqlitePool, roomId: &str) -> AppResult<()> {
        // 获取正在播放歌曲的最大position
        let start_position: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(position), 0) FROM room_queue WHERE roomId = ? AND status = 1",
        )
        .bind(roomId)
        .fetch_one(pool)
        .await?;

        // 使用SQL的RANDOM()函数打乱等待播放的歌曲
        // 先获取所有等待播放的歌曲ID
        #[derive(sqlx::FromRow)]
        struct QueueItem {
            id: String,
        }

        let items = sqlx::query_as::<_, QueueItem>(
            "SELECT id FROM room_queue WHERE roomId = ? AND status = 0 ORDER BY RANDOM()",
        )
        .bind(roomId)
        .fetch_all(pool)
        .await?;

        // 批量更新position
        for (index, item) in items.iter().enumerate() {
            sqlx::query("UPDATE room_queue SET position = ? WHERE id = ?")
                .bind(start_position + (index as i32) + 1)
                .bind(&item.id)
                .execute(pool)
                .await?;
        }

        Ok(())
    }

    // ==================== 外设状态更新 ====================

    /// 更新空调状态
    pub async fn update_ac_state(pool: &SqlitePool, roomId: &str, acState: &str) -> AppResult<()> {
        sqlx::query(
            "UPDATE rooms SET acState = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
        )
        .bind(acState)
        .bind(roomId)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// 更新灯光状态
    pub async fn update_light_state(
        pool: &SqlitePool,
        roomId: &str,
        lightState: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE rooms SET lightState = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
        )
        .bind(lightState)
        .bind(roomId)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// 更新音效状态
    pub async fn update_effect_state(
        pool: &SqlitePool,
        roomId: &str,
        effectState: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE rooms SET effectState = ?, updatedAt = datetime('now','localtime') WHERE id = ?"
        )
        .bind(effectState)
        .bind(roomId)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// 更新播放状态
    pub async fn update_play_state(
        pool: &SqlitePool,
        roomId: &str,
        playState: i32,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE rooms SET playState = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
        )
        .bind(playState)
        .bind(roomId)
        .execute(pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod song_advance_tests {
    use super::RoomService;
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

    async fn test_db() -> SqlitePool {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create test database");
        sqlx::query(
            "CREATE TABLE rooms (
                id TEXT PRIMARY KEY,
                currentSongId TEXT NOT NULL DEFAULT '',
                playState INTEGER NOT NULL DEFAULT 0,
                updatedAt TEXT NOT NULL DEFAULT ''
            )",
        )
        .execute(&db)
        .await
        .expect("create rooms table");
        sqlx::query(
            "CREATE TABLE room_queue (
                id TEXT PRIMARY KEY,
                roomId TEXT NOT NULL,
                songId TEXT NOT NULL,
                songTitle TEXT NOT NULL DEFAULT '',
                artistName TEXT NOT NULL DEFAULT '',
                position INTEGER NOT NULL DEFAULT 0,
                status INTEGER NOT NULL DEFAULT 0,
                isPriority INTEGER NOT NULL DEFAULT 0,
                addedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                songNo TEXT DEFAULT '',
                languageCode TEXT DEFAULT '',
                classify_code TEXT DEFAULT '',
                light_code TEXT DEFAULT '',
                songPath TEXT DEFAULT '',
                video_file_type TEXT DEFAULT '',
                track INTEGER DEFAULT 0,
                score_enabled INTEGER DEFAULT 0,
                singer_no TEXT DEFAULT ''
            )",
        )
        .execute(&db)
        .await
        .expect("create queue table");
        sqlx::query(
            "INSERT INTO rooms (id, currentSongId, playState)
             VALUES ('room-a', 'song-a', 1)",
        )
        .execute(&db)
        .await
        .expect("insert room");
        db
    }

    async fn add_row(db: &SqlitePool, id: &str, song_id: &str, position: i32, status: i32) {
        sqlx::query(
            "INSERT INTO room_queue (id, roomId, songId, songTitle, position, status)
             VALUES (?, 'room-a', ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(song_id)
        .bind(song_id)
        .bind(position)
        .bind(status)
        .execute(db)
        .await
        .expect("insert queue row");
    }

    async fn queue_status(db: &SqlitePool, id: &str) -> i32 {
        sqlx::query_scalar("SELECT status FROM room_queue WHERE id = ?")
            .bind(id)
            .fetch_one(db)
            .await
            .expect("read queue status")
    }

    async fn room_state(db: &SqlitePool) -> (String, i32) {
        sqlx::query_as("SELECT currentSongId, playState FROM rooms WHERE id = 'room-a'")
            .fetch_one(db)
            .await
            .expect("read room state")
    }

    #[tokio::test]
    async fn exact_active_completion_promotes_next_waiting_row() {
        let db = test_db().await;
        add_row(&db, "row-a", "song-a", 1, 1).await;
        add_row(&db, "row-b", "song-b", 2, 0).await;

        let result = RoomService::next_song_if_current(&db, "room-a", 2, "row-a")
            .await
            .expect("advance exact active row");

        assert!(result.advanced);
        assert_eq!(
            result.next.as_ref().map(|item| item.id.as_str()),
            Some("row-b")
        );
        assert_eq!(queue_status(&db, "row-a").await, 2);
        assert_eq!(queue_status(&db, "row-b").await, 1);
        assert_eq!(room_state(&db).await, ("song-b".into(), 1));
    }

    #[tokio::test]
    async fn stale_completion_does_not_touch_current_active_row() {
        let db = test_db().await;
        add_row(&db, "row-b", "song-b", 2, 1).await;
        sqlx::query("UPDATE rooms SET currentSongId = 'song-b' WHERE id = 'room-a'")
            .execute(&db)
            .await
            .expect("set current song");

        let result = RoomService::next_song_if_current(&db, "room-a", 2, "row-a")
            .await
            .expect("ignore stale completion");

        assert!(!result.advanced);
        assert!(result.next.is_none());
        assert_eq!(queue_status(&db, "row-b").await, 1);
        assert_eq!(room_state(&db).await, ("song-b".into(), 1));
    }

    #[tokio::test]
    async fn duplicate_completion_is_an_idempotent_no_op() {
        let db = test_db().await;
        add_row(&db, "row-a", "song-a", 1, 1).await;
        add_row(&db, "row-b", "song-b", 2, 0).await;

        let first = RoomService::next_song_if_current(&db, "room-a", 2, "row-a")
            .await
            .expect("first completion");
        let duplicate = RoomService::next_song_if_current(&db, "room-a", 2, "row-a")
            .await
            .expect("duplicate completion");

        assert!(first.advanced);
        assert!(!duplicate.advanced);
        assert_eq!(queue_status(&db, "row-a").await, 2);
        assert_eq!(queue_status(&db, "row-b").await, 1);
        assert_eq!(room_state(&db).await, ("song-b".into(), 1));
    }

    #[tokio::test]
    async fn completion_cannot_advance_paused_or_stopped_room() {
        for play_state in [0, 2] {
            let db = test_db().await;
            add_row(&db, "row-a", "song-a", 1, 1).await;
            add_row(&db, "row-b", "song-b", 2, 0).await;
            RoomService::update_play_state(&db, "room-a", play_state)
                .await
                .unwrap();
            for _ in 0..2 {
                let result = RoomService::next_song_if_current(&db, "room-a", 2, "row-a")
                    .await
                    .unwrap();
                assert!(!result.advanced);
                assert_eq!(queue_status(&db, "row-a").await, 1);
                assert_eq!(queue_status(&db, "row-b").await, 0);
                assert_eq!(room_state(&db).await, ("song-a".into(), play_state));
            }
            RoomService::update_play_state(&db, "room-a", 1)
                .await
                .unwrap();
            assert!(
                RoomService::next_song_if_current(&db, "room-a", 2, "row-a")
                    .await
                    .unwrap()
                    .advanced
            );
            assert_eq!(room_state(&db).await, ("song-b".into(), 1));
        }
    }

    #[tokio::test]
    async fn manual_next_still_advances_a_paused_room() {
        let db = test_db().await;
        add_row(&db, "row-a", "song-a", 1, 1).await;
        add_row(&db, "row-b", "song-b", 2, 0).await;
        RoomService::update_play_state(&db, "room-a", 2)
            .await
            .unwrap();
        assert!(
            RoomService::next_song(&db, "room-a", 3)
                .await
                .unwrap()
                .advanced
        );
        assert_eq!(queue_status(&db, "row-a").await, 3);
        assert_eq!(room_state(&db).await, ("song-b".into(), 1));
    }

    #[tokio::test]
    async fn manual_next_without_active_row_does_not_promote_waiting_row() {
        let db = test_db().await;
        add_row(&db, "row-waiting", "song-waiting", 1, 0).await;

        let result = RoomService::next_song(&db, "room-a", 3)
            .await
            .expect("manual next must be an idle no-op");

        assert!(!result.advanced);
        assert!(result.next.is_none());
        assert_eq!(queue_status(&db, "row-waiting").await, 0);
        assert_eq!(room_state(&db).await, ("song-a".into(), 1));
    }

    #[tokio::test]
    async fn failed_room_update_rolls_back_queue_transition() {
        let db = test_db().await;
        add_row(&db, "row-a", "song-a", 1, 1).await;
        add_row(&db, "row-b", "song-b", 2, 0).await;
        sqlx::query(
            "CREATE TRIGGER reject_room_advance
             BEFORE UPDATE ON rooms
             BEGIN
                 SELECT RAISE(ABORT, 'test room update failure');
             END",
        )
        .execute(&db)
        .await
        .expect("create failure trigger");

        RoomService::next_song_if_current(&db, "room-a", 2, "row-a")
            .await
            .expect_err("room update must fail");

        assert_eq!(queue_status(&db, "row-a").await, 1);
        assert_eq!(queue_status(&db, "row-b").await, 0);
        assert_eq!(room_state(&db).await, ("song-a".into(), 1));
    }
}

#[cfg(test)]
mod delete_queue_tests {
    use super::RoomService;
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

    async fn test_db() -> SqlitePool {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create test database");
        sqlx::query(
            "CREATE TABLE rooms (
                id TEXT PRIMARY KEY,
                currentSongId TEXT NOT NULL DEFAULT '',
                playState INTEGER NOT NULL DEFAULT 0,
                updatedAt TEXT NOT NULL DEFAULT ''
            )",
        )
        .execute(&db)
        .await
        .expect("create rooms table");
        sqlx::query(
            "CREATE TABLE room_queue (
                id TEXT PRIMARY KEY,
                roomId TEXT NOT NULL,
                songId TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                status INTEGER NOT NULL DEFAULT 0,
                isPriority INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(&db)
        .await
        .expect("create queue table");
        sqlx::query(
            "INSERT INTO rooms (id, currentSongId, playState) VALUES ('room-a', 'song-a', 1)",
        )
        .execute(&db)
        .await
        .expect("insert room");
        db
    }

    async fn add_row(db: &SqlitePool, id: &str, song_id: &str, position: i32, status: i32) {
        sqlx::query(
            "INSERT INTO room_queue (id, roomId, songId, position, status, isPriority)
             VALUES (?, 'room-a', ?, ?, ?, 0)",
        )
        .bind(id)
        .bind(song_id)
        .bind(position)
        .bind(status)
        .execute(db)
        .await
        .expect("insert queue row");
    }

    #[tokio::test]
    async fn song_id_delete_removes_all_active_duplicates() {
        let db = test_db().await;
        add_row(&db, "row-active", "song-a", 1, 1).await;
        add_row(&db, "row-waiting", "song-a", 2, 0).await;
        add_row(&db, "row-next", "song-b", 3, 0).await;

        RoomService::delete_from_queue(&db, "room-a", "song-a")
            .await
            .expect("delete active duplicates");

        let remaining: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM room_queue WHERE roomId = 'room-a' AND songId = 'song-a'",
        )
        .fetch_one(&db)
        .await
        .expect("count duplicates");
        assert_eq!(remaining, 0);
        let room: (String, i32) =
            sqlx::query_as("SELECT currentSongId, playState FROM rooms WHERE id = 'room-a'")
                .fetch_one(&db)
                .await
                .expect("read room state");
        assert_eq!(room, ("song-b".into(), 1));
    }

    #[tokio::test]
    async fn song_number_delete_preserves_history_and_removes_waiting_song() {
        let db = test_db().await;
        add_row(&db, "row-active", "song-a", 1, 1).await;
        add_row(&db, "row-history", "song-b", 1, 2).await;
        add_row(&db, "row-waiting", "song-b", 3, 0).await;
        RoomService::delete_from_queue(&db, "room-a", "song-b").await.unwrap();
        let rows: Vec<(String, i32)> = sqlx::query_as("SELECT id, status FROM room_queue ORDER BY id")
            .fetch_all(&db).await.unwrap();
        assert_eq!(rows, vec![("row-active".into(), 1), ("row-history".into(), 2)]);
    }

    #[tokio::test]
    async fn exact_waiting_row_delete_keeps_active_state() {
        let db = test_db().await;
        add_row(&db, "row-active", "song-a", 1, 1).await;
        add_row(&db, "row-waiting", "song-b", 2, 0).await;

        RoomService::delete_from_queue(&db, "room-a", "row-waiting")
            .await
            .expect("delete waiting row");

        let room: (String, i32) =
            sqlx::query_as("SELECT currentSongId, playState FROM rooms WHERE id = 'room-a'")
                .fetch_one(&db)
                .await
                .expect("read room state");
        assert_eq!(room, ("song-a".into(), 1));
    }

    #[tokio::test]
    async fn deleting_active_row_promotes_next_row() {
        let db = test_db().await;
        add_row(&db, "row-active", "song-a", 1, 1).await;
        add_row(&db, "row-next", "song-b", 2, 0).await;

        RoomService::delete_from_queue(&db, "room-a", "row-active")
            .await
            .expect("delete active row");

        let promoted: i32 =
            sqlx::query_scalar("SELECT status FROM room_queue WHERE id = 'row-next'")
                .fetch_one(&db)
                .await
                .expect("read promoted row");
        assert_eq!(promoted, 1);
        let room: (String, i32) =
            sqlx::query_as("SELECT currentSongId, playState FROM rooms WHERE id = 'room-a'")
                .fetch_one(&db)
                .await
                .expect("read room state");
        assert_eq!(room, ("song-b".into(), 1));
    }

    #[tokio::test]
    async fn deleting_last_active_row_enters_idle_state() {
        let db = test_db().await;
        add_row(&db, "row-active", "song-a", 1, 1).await;

        RoomService::delete_from_queue(&db, "room-a", "row-active")
            .await
            .expect("delete last active row");

        let room: (String, i32) =
            sqlx::query_as("SELECT currentSongId, playState FROM rooms WHERE id = 'room-a'")
                .fetch_one(&db)
                .await
                .expect("read idle state");
        assert_eq!(room, (String::new(), 0));
    }

    #[tokio::test]
    async fn prioritize_moves_target_after_current_without_updated_at_column() {
        let db = test_db().await;
        add_row(&db, "row-active", "song-a", 7, 1).await;
        add_row(&db, "row-next", "song-b", 8, 0).await;
        add_row(&db, "row-target", "song-c", 9, 0).await;

        RoomService::prioritize_song(&db, "room-a", "song-c")
            .await
            .expect("prioritize waiting song");

        let rows: Vec<(String, i32, i32)> = sqlx::query_as(
            "SELECT id, position, isPriority FROM room_queue
             WHERE roomId = 'room-a' ORDER BY position",
        )
        .fetch_all(&db)
        .await
        .expect("load reordered queue");
        assert_eq!(
            rows,
            vec![
                ("row-active".into(), 1, 0),
                ("row-target".into(), 2, 1),
                ("row-next".into(), 3, 0),
            ]
        );
    }

    #[tokio::test]
    async fn prioritize_by_queue_id_replaces_previous_priority() {
        let db = test_db().await;
        add_row(&db, "row-active", "song-a", 1, 1).await;
        add_row(&db, "row-old-priority", "song-b", 2, 0).await;
        add_row(&db, "row-target", "song-c", 3, 0).await;
        sqlx::query("UPDATE room_queue SET isPriority = 1 WHERE id = 'row-old-priority'")
            .execute(&db)
            .await
            .expect("seed old priority");

        RoomService::prioritize_song(&db, "room-a", "row-target")
            .await
            .expect("prioritize exact queue row");

        let rows: Vec<(String, i32)> = sqlx::query_as(
            "SELECT id, isPriority FROM room_queue
             WHERE roomId = 'room-a' AND status = 0 ORDER BY position",
        )
        .fetch_all(&db)
        .await
        .expect("load waiting queue");
        assert_eq!(
            rows,
            vec![("row-target".into(), 1), ("row-old-priority".into(), 0)]
        );
    }
}

#[cfg(test)]
mod youtube_queue_tests {
    use super::RoomService;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_db() -> sqlx::SqlitePool {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create test database");
        sqlx::query(
            "CREATE TABLE rooms (
                id TEXT PRIMARY KEY,
                currentSongId TEXT NOT NULL DEFAULT '',
                playState INTEGER NOT NULL DEFAULT 0,
                updatedAt TEXT NOT NULL DEFAULT ''
            )",
        )
        .execute(&db)
        .await
        .expect("create rooms table");
        sqlx::query(
            "CREATE TABLE room_queue (
                id TEXT PRIMARY KEY,
                roomId TEXT NOT NULL,
                songId TEXT NOT NULL,
                songTitle TEXT NOT NULL DEFAULT '',
                artistName TEXT NOT NULL DEFAULT '',
                position INTEGER NOT NULL DEFAULT 0,
                status INTEGER NOT NULL DEFAULT 0,
                isPriority INTEGER NOT NULL DEFAULT 0,
                addedAt TEXT NOT NULL DEFAULT '',
                songNo TEXT NOT NULL DEFAULT '',
                languageCode TEXT NOT NULL DEFAULT '',
                classify_code TEXT NOT NULL DEFAULT '',
                light_code TEXT NOT NULL DEFAULT '',
                songPath TEXT NOT NULL DEFAULT '',
                video_file_type TEXT NOT NULL DEFAULT '',
                track INTEGER NOT NULL DEFAULT 0,
                score_enabled INTEGER NOT NULL DEFAULT 0,
                singer_no TEXT NOT NULL DEFAULT ''
            )",
        )
        .execute(&db)
        .await
        .expect("create queue table");
        sqlx::query(
            "INSERT INTO rooms (id, currentSongId, playState) VALUES
             ('room-a', '', 0), ('room-b', '', 0)",
        )
        .execute(&db)
        .await
        .expect("insert rooms");
        db
    }

    #[tokio::test]
    async fn youtube_item_is_persisted_isolated_and_can_become_active() {
        let db = test_db().await;
        let stream_url = "https://media.example/video.mp4?token=abc";
        let inserted = RoomService::add_youtube_to_queue(
            &db,
            "room-a",
            "video-123",
            "Video title",
            "Channel name",
            stream_url,
            false,
        )
        .await
        .expect("insert youtube queue item");

        assert_eq!(inserted.songId, "youtube:video-123");
        assert_eq!(inserted.songNo, "youtube:video-123");
        assert_eq!(inserted.relativePath, stream_url);
        assert_eq!(inserted.video_file_type, "youtube");
        assert!(RoomService::get_queue(&db, "room-b")
            .await
            .expect("load isolated room")
            .is_empty());

        let active = RoomService::finalize_queue_enqueue(&db, "room-a", &inserted.id)
            .await
            .expect("finalize idle queue insertion");
        assert_eq!(active.status, 1);
        assert_eq!(active.relativePath, stream_url);

        let room: (String, i32) =
            sqlx::query_as("SELECT currentSongId, playState FROM rooms WHERE id = 'room-a'")
                .fetch_one(&db)
                .await
                .expect("load room state");
        assert_eq!(room, ("youtube:video-123".to_string(), 1));
    }

    #[tokio::test]
    async fn idle_activation_does_not_replace_a_paused_active_item() {
        let db = test_db().await;
        RoomService::add_youtube_to_queue(
            &db,
            "room-a",
            "video-current",
            "Current video",
            "Channel",
            "https://media.example/current.mp4",
            false,
        )
        .await
        .expect("insert current item");
        RoomService::activate_next_if_idle(&db, "room-a")
            .await
            .expect("activate current item")
            .expect("current item");
        sqlx::query("UPDATE rooms SET playState = 0 WHERE id = 'room-a'")
            .execute(&db)
            .await
            .expect("pause room");

        RoomService::add_youtube_to_queue(
            &db,
            "room-a",
            "video-waiting",
            "Waiting video",
            "Channel",
            "https://media.example/waiting.mp4",
            false,
        )
        .await
        .expect("insert waiting item");

        let promoted = RoomService::activate_next_if_idle(&db, "room-a")
            .await
            .expect("check idle activation");
        assert!(promoted.is_none());

        let queue = RoomService::get_queue(&db, "room-a")
            .await
            .expect("load queue");
        assert_eq!(queue.len(), 2);
        assert_eq!(queue[0].songId, "youtube:video-current");
        assert_eq!(queue[0].status, 1);
        assert_eq!(queue[1].songId, "youtube:video-waiting");
        assert_eq!(queue[1].status, 0);
    }
}

#[cfg(test)]
mod queue_song_availability_tests {
    use super::{AddToQueueRequest, AppError, RoomService};
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

    async fn main_db() -> SqlitePool {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create main database");
        sqlx::query(
            "CREATE TABLE room_queue (
                id TEXT PRIMARY KEY,
                roomId TEXT NOT NULL,
                songId TEXT NOT NULL,
                songTitle TEXT NOT NULL DEFAULT '',
                artistName TEXT NOT NULL DEFAULT '',
                position INTEGER NOT NULL DEFAULT 0,
                status INTEGER NOT NULL DEFAULT 0,
                isPriority INTEGER NOT NULL DEFAULT 0,
                addedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                songNo TEXT DEFAULT '',
                languageCode TEXT DEFAULT '',
                classify_code TEXT DEFAULT '',
                light_code TEXT DEFAULT '',
                songPath TEXT DEFAULT '',
                video_file_type TEXT DEFAULT '',
                track INTEGER DEFAULT 0,
                score_enabled INTEGER DEFAULT 0,
                singer_no TEXT DEFAULT ''
            )",
        )
        .execute(&db)
        .await
        .expect("create queue table");
        db
    }

    async fn song_db() -> SqlitePool {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create song database");
        sqlx::query(
            "CREATE TABLE songs (
                songNo TEXT PRIMARY KEY,
                songName TEXT NOT NULL,
                singerNames TEXT DEFAULT '',
                primarySingerNo TEXT DEFAULT '',
                languageCode TEXT DEFAULT '',
                categoryCode TEXT DEFAULT '',
                lightCode TEXT DEFAULT '',
                videoFileType TEXT DEFAULT 'mp4',
                track INTEGER DEFAULT 3,
                scoreEnabled INTEGER DEFAULT 1
            )",
        )
        .execute(&db)
        .await
        .expect("create songs table");
        sqlx::query(
            "CREATE TABLE local_available_songs (
                songNo TEXT PRIMARY KEY,
                absolutePath TEXT NOT NULL
            )",
        )
        .execute(&db)
        .await
        .expect("create availability table");
        sqlx::query("INSERT INTO songs (songNo, songName) VALUES ('60000166', 'test song')")
            .execute(&db)
            .await
            .expect("insert song");
        db
    }

    #[tokio::test]
    async fn unavailable_song_is_rejected_without_queue_insert() {
        let main = main_db().await;
        let songs = song_db().await;

        let error = RoomService::add_to_queue(
            &main,
            &songs,
            "room-a",
            AddToQueueRequest {
                songId: "60000166".to_string(),
                isPriority: None,
            },
        )
        .await
        .expect_err("unavailable song must be rejected");

        match error {
            AppError::BadRequest(message) => {
                assert!(message.contains("60000166"));
            }
            other => panic!("unexpected error: {other:?}"),
        }
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM room_queue")
            .fetch_one(&main)
            .await
            .expect("count queue rows");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn available_song_uses_authoritative_normalized_local_path() {
        let main = main_db().await;
        let songs = song_db().await;
        sqlx::query("INSERT INTO local_available_songs (songNo, absolutePath) VALUES (?, ?)")
            .bind("60000166")
            .bind(r"F:\videos\60000166.mp4")
            .execute(&songs)
            .await
            .expect("mark song available");

        let item = RoomService::add_to_queue(
            &main,
            &songs,
            "room-a",
            AddToQueueRequest {
                songId: "60000166".to_string(),
                isPriority: None,
            },
        )
        .await
        .expect("available song should be queued");

        assert_eq!(item.relativePath, "F:/videos/60000166.mp4");
    }

    #[tokio::test]
    async fn concurrent_duplicate_requests_are_rejected_but_other_rooms_and_replays_work() {
        let main = main_db().await;
        let songs = song_db().await;
        sqlx::query("INSERT INTO local_available_songs VALUES ('60000166', 'F:/60000166.mp4')")
            .execute(&songs).await.unwrap();
        let request = || AddToQueueRequest { songId: "60000166".into(), isPriority: None };
        let (first, second) = tokio::join!(
            RoomService::add_to_queue(&main, &songs, "room-a", request()),
            RoomService::add_to_queue(&main, &songs, "room-a", request())
        );
        assert_ne!(first.is_ok(), second.is_ok());
        let error = first.err().or(second.err()).unwrap();
        assert!(matches!(error, AppError::BadRequest(message) if message.contains("重复点播")));
        assert_eq!(RoomService::get_queue(&main, "room-a").await.unwrap().len(), 1);
        RoomService::add_to_queue(&main, &songs, "room-b", request()).await.unwrap();
        sqlx::query("UPDATE room_queue SET status = 1 WHERE roomId = 'room-a'")
            .execute(&main).await.unwrap();
        assert!(RoomService::add_to_queue(&main, &songs, "room-a", request()).await.is_err());
        sqlx::query("UPDATE room_queue SET status = 2 WHERE roomId = 'room-a'")
            .execute(&main).await.unwrap();
        RoomService::add_to_queue(&main, &songs, "room-a", request()).await.unwrap();
        RoomService::delete_from_queue(&main, "room-a", "60000166").await.unwrap();
        assert!(RoomService::get_queue(&main, "room-a").await.unwrap().is_empty());
        RoomService::add_to_queue(&main, &songs, "room-a", request()).await.unwrap();
        assert_eq!(RoomService::get_queue(&main, "room-a").await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn successful_comparison_updates_catalog_and_new_point_orders() {
        use crate::models::scan_task::{StartScanRequest, TaskStatus};
        use crate::services::song_path_matcher_service::SongPathMatcherService;
        let main = main_db().await;
        let songs = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/song_db_init.sql")).execute(&songs).await.unwrap();
        sqlx::query("INSERT INTO songs(songNo, songName, videoFileType, absolutePath) VALUES ('60000166', 'test', 'mp4', 'D:/old/60000166.mp4')")
            .execute(&songs).await.unwrap();
        let folder = tempfile::tempdir().unwrap();
        let service = SongPathMatcherService::new();
        for extension in ["HVIDEO", "mkv"] {
            let video = folder.path().join(format!("60000166.{extension}"));
            std::fs::write(&video, b"test media placeholder").unwrap();
            let task_id = service.start_scan(songs.clone(), StartScanRequest {
                directory: folder.path().to_string_lossy().into_owned(), delete_duplicates: false, incremental: false,
            }).await.unwrap();
            let task = tokio::time::timeout(std::time::Duration::from_secs(5), async {
                loop {
                    let task = service.get_task(&task_id).await.unwrap();
                    if task.status != TaskStatus::Running { break task; }
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
            }).await.unwrap();
            assert_eq!(task.status, TaskStatus::Completed);
            let expected_path = video.to_string_lossy().replace('\\', "/");
            let expected_type = extension.to_ascii_lowercase();
            let catalog: (String, String) = sqlx::query_as("SELECT videoFileType, absolutePath FROM songs WHERE songNo='60000166'")
                .fetch_one(&songs).await.unwrap();
            assert_eq!(catalog, (expected_type.clone(), expected_path.clone()));
            let item = RoomService::add_to_queue(&main, &songs, "room-a", AddToQueueRequest {
                songId: "60000166".into(), isPriority: None,
            }).await.unwrap();
            assert_eq!(item.relativePath, expected_path);
            assert_eq!(item.video_file_type, expected_type);
            let persisted: (String, String) = sqlx::query_as("SELECT video_file_type, songPath FROM room_queue WHERE id=?")
                .bind(&item.id).fetch_one(&main).await.unwrap();
            assert_eq!(persisted, catalog);
            RoomService::delete_from_queue(&main, "room-a", &item.id).await.unwrap();
            std::fs::remove_file(&video).unwrap();
        }
    }
}

#[cfg(test)]
mod automatic_room_name_tests {
    use super::RoomService;
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

    async fn room_db(room_name: &str) -> SqlitePool {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create room database");

        sqlx::query(
            "CREATE TABLE rooms (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                terminalId TEXT NOT NULL,
                typeId INTEGER,
                areaId INTEGER,
                status INTEGER NOT NULL DEFAULT 0,
                currentSongId TEXT NOT NULL DEFAULT '',
                volume INTEGER NOT NULL DEFAULT 50,
                musicVolume INTEGER,
                micVolume INTEGER,
                micStatus INTEGER NOT NULL DEFAULT 1,
                acState TEXT NOT NULL DEFAULT '{}',
                lightState TEXT NOT NULL DEFAULT '{}',
                effectState TEXT NOT NULL DEFAULT '{}',
                muteStatus INTEGER NOT NULL DEFAULT 0,
                playState INTEGER NOT NULL DEFAULT 0,
                createdAt TEXT NOT NULL DEFAULT '',
                updatedAt TEXT NOT NULL DEFAULT ''
            )",
        )
        .execute(&db)
        .await
        .expect("create rooms table");

        sqlx::query("INSERT INTO rooms (id, name, terminalId) VALUES (?, ?, ?)")
            .bind("192.168.1.211")
            .bind(room_name)
            .bind("192.168.1.211")
            .execute(&db)
            .await
            .expect("insert room");

        db
    }

    #[test]
    fn automatic_room_name_matches_normalized_terminal_name() {
        assert_eq!(
            RoomService::automatic_room_name("192.168.1.211", "localhost"),
            "房间-localhost"
        );
    }

    #[test]
    fn ordinary_terminal_name_is_preserved() {
        assert_eq!(
            RoomService::automatic_room_name("192.168.1.212", "VIP-A01"),
            "房间-VIP-A01"
        );
    }

    #[test]
    fn empty_terminal_name_does_not_expose_terminal_id() {
        assert_eq!(
            RoomService::automatic_room_name("a1151c60-0000-0000-0000-000000000000", ""),
            "房间"
        );
    }

    #[test]
    fn generated_room_suffix_detection_is_exact() {
        assert!(RoomService::has_generated_terminal_suffix(
            "房间-localhost-a1151c60",
            "房间-localhost"
        ));
        assert!(!RoomService::has_generated_terminal_suffix(
            "房间-localhost",
            "房间-localhost"
        ));
        assert!(!RoomService::has_generated_terminal_suffix(
            "VIP 888",
            "房间-localhost"
        ));
    }

    #[tokio::test]
    async fn previous_generated_room_name_is_migrated() {
        let db = room_db("房间-localhost-a1151c60").await;

        let room = RoomService::auto_create_for_terminal(&db, "192.168.1.211", "localhost")
            .await
            .expect("remove generated suffix from automatic room name");

        assert_eq!(room.name, "房间-localhost");
    }

    #[tokio::test]
    async fn user_defined_room_name_is_not_overwritten() {
        let db = room_db("VIP 888").await;

        let room = RoomService::auto_create_for_terminal(&db, "192.168.1.211", "localhost")
            .await
            .expect("keep user-defined room name");

        assert_eq!(room.name, "VIP 888");
    }
}
