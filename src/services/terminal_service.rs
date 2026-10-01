use sqlx::SqlitePool;

use crate::errors::{AppError, AppResult};
use crate::models::terminal::*;

pub struct TerminalService;

/// Internal registration outcome; only `terminal` is exposed by the HTTP API.
#[derive(Debug)]
pub struct TerminalRegistration {
    pub terminal: Terminal,
    pub status_changed: bool,
    pub displaced_terminals: Vec<Terminal>,
}

impl TerminalService {
    pub(crate) fn usable_serial(value: &str) -> Option<String> {
        let value = value.trim().to_ascii_uppercase();
        let identity: String = value.chars().filter(char::is_ascii_alphanumeric).collect();
        if !(4..=128).contains(&value.len())
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
            || matches!(
                value.as_str(),
                "UNKNOWN" | "NULL" | "NONE" | "DEFAULT" | "SERIAL" | "0123456789ABCDEF"
            )
            || identity.is_empty()
            || identity.bytes().all(|b| b == b'0')
            || identity.bytes().all(|b| b == b'F')
        {
            None
        } else {
            Some(value)
        }
    }

    fn usable_mac(value: Option<&str>) -> Option<String> {
        let value = value.map(str::trim).filter(|value| !value.is_empty())?;
        let hex = value
            .bytes()
            .filter(|byte| !matches!(byte, b':' | b'-' | b'.'))
            .map(|byte| byte.to_ascii_uppercase())
            .collect::<Vec<_>>();
        if hex.len() != 12
            || !hex.iter().all(u8::is_ascii_hexdigit)
            || hex.iter().all(|byte| *byte == b'0')
            || hex == b"020000000000"
            || matches!(
                hex[1],
                b'1' | b'3' | b'5' | b'7' | b'9' | b'B' | b'D' | b'F'
            )
        {
            None
        } else {
            Some(
                hex.chunks_exact(2)
                    .map(|pair| String::from_utf8_lossy(pair).to_string())
                    .collect::<Vec<_>>()
                    .join(":"),
            )
        }
    }

    pub(crate) fn normalize_discovered_name(name: &str) -> &str {
        let trimmed = name.trim();
        let Some((base, suffix)) = trimmed.rsplit_once('-') else {
            return trimmed;
        };

        if base.eq_ignore_ascii_case("localhost")
            && suffix.len() == 8
            && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            "localhost"
        } else {
            trimmed
        }
    }

    /// 注册终端（新设备自动注册，已有设备更新信息）
    /// 按序列号更新设备的当前地址，同时同步被替换地址的旧设备缓存。
    pub async fn register(
        pool: &SqlitePool,
        req: RegisterTerminalRequest,
        terminal_limit: u32,
    ) -> AppResult<TerminalRegistration> {
        if !crate::net_utils::is_usable_server_ipv4(&req.terminalIp) {
            return Err(AppError::BadRequest(format!(
                "Invalid terminal IPv4 address: {}",
                req.terminalIp
            )));
        }
        if crate::net_utils::is_local_ip(&req.terminalIp) {
            return Err(AppError::BadRequest(format!(
                "terminal IP {} belongs to the server or a local gateway",
                req.terminalIp
            )));
        }
        if terminal_limit == 0 {
            return Err(AppError::Forbidden(
                "License terminal limit is zero; terminal admission is denied".to_string(),
            ));
        }
        let mut transaction = pool.begin().await?;
        sqlx::query("PRAGMA busy_timeout=5000")
            .execute(&mut *transaction)
            .await?;
        // Acquire the SQLite write lock before identity reads, while retaining
        // SQLx's rollback-on-drop if restart/shutdown cancels this task.
        sqlx::query("UPDATE terminals SET id=id WHERE 0")
            .execute(&mut *transaction)
            .await?;
        let result = Self::register_in_transaction(&mut transaction, req, terminal_limit).await?;
        transaction.commit().await?;
        Ok(result)
    }

    async fn register_in_transaction(
        conn: &mut sqlx::SqliteConnection,
        req: RegisterTerminalRequest,
        terminal_limit: u32,
    ) -> AppResult<TerminalRegistration> {
        let serial = Self::usable_serial(&req.serial).ok_or_else(|| {
            AppError::BadRequest(
                "a valid hardware serial is required for terminal registration".to_string(),
            )
        })?;
        let supplied_name = req
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty());
        let normalized_name = supplied_name.map(Self::normalize_discovered_name);
        let supplied_mac = Self::usable_mac(req.macAddress.as_deref());
        let supplied_mac = supplied_mac.ok_or_else(|| {
            AppError::BadRequest("terminal MAC address is required for admission".to_string())
        })?;

        // A serial identifies the device; a valid newly reported Ethernet MAC
        // refreshes that device without changing its room or license seat.
        // Unresolved historical duplicates must be reviewed, never silently merged.
        let mut serial_matches = sqlx::query_as::<_, Terminal>(
            "SELECT * FROM terminals WHERE serial = ? COLLATE NOCASE OR
             (serial = '' AND upper(trim(json_extract(
                 CASE WHEN json_valid(hardwareInfo) THEN hardwareInfo ELSE '{}' END, '$.serial'))) = ?)",
        )
        .bind(&serial)
        .bind(&serial)
        .fetch_all(&mut *conn)
        .await?;
        if serial_matches.len() > 1 {
            return Err(AppError::Conflict("multiple historical terminals have this serial; resolve the duplicate binding first".to_string()));
        }
        let mut existing = serial_matches.pop();
        let mac_matches = sqlx::query_as::<_, Terminal>(
            "SELECT * FROM terminals WHERE upper(replace(replace(replace(trim(macAddress), ':', ''), '-', ''), '.', '')) = ?",
        )
        .bind(supplied_mac.replace(':', ""))
        .fetch_all(&mut *conn)
        .await?;
        // An old record without a serial may acquire one only through its bound MAC.
        if existing.is_none() && mac_matches.len() == 1 && mac_matches[0].serial.is_empty() {
            let candidate = &mac_matches[0];
            let metadata: serde_json::Value =
                serde_json::from_str(&candidate.hardwareInfo).unwrap_or_default();
            let old_serial = metadata
                .get("serial")
                .and_then(|v| v.as_str())
                .and_then(Self::usable_serial);
            if old_serial.as_deref().is_none_or(|value| value == serial) {
                existing = Some(candidate.clone());
            }
        }
        if mac_matches
            .iter()
            .any(|owner| existing.as_ref().map(|t| &t.id) != Some(&owner.id))
        {
            return Err(AppError::Conflict(
                "Ethernet MAC is already bound to a different terminal serial".to_string(),
            ));
        }
        let device_mac_changed = existing.as_ref().is_some_and(|terminal| {
            Self::usable_mac(Some(&terminal.macAddress)).as_deref() != Some(&supplied_mac)
        });

        let (mut network_type, mut interface_name, mut connection_mac) = match &req.network {
            Some(network) => {
                let kind = network.network_type.as_str();
                let interface = network.interface_name.trim();
                let expected = if kind == "ethernet" { "eth0" } else { "wlan0" };
                if interface != expected {
                    return Err(AppError::BadRequest(format!(
                        "{} connection must report interfaceName {}",
                        kind, expected
                    )));
                }
                let mac = Self::usable_mac(Some(&network.mac_address)).ok_or_else(|| {
                    AppError::BadRequest(
                        "network.macAddress must be a valid interface MAC".to_string(),
                    )
                })?;
                if kind == "ethernet" && mac != supplied_mac {
                    return Err(AppError::Conflict(
                        "Ethernet connection MAC must match the bound device MAC".to_string(),
                    ));
                }
                (kind.to_string(), interface.to_string(), mac)
            }
            None => ("unknown".to_string(), String::new(), supplied_mac.clone()),
        };
        let connection_owners: Vec<String> = sqlx::query_scalar(
            "SELECT terminalId FROM terminal_connections WHERE macAddress = ? COLLATE NOCASE OR macAddress = ? COLLATE NOCASE
             UNION SELECT id FROM terminals WHERE upper(replace(replace(replace(trim(macAddress), ':', ''), '-', ''), '.', '')) = ?",
        )
        .bind(&connection_mac)
        .bind(&supplied_mac)
        .bind(connection_mac.replace(':', ""))
        .fetch_all(&mut *conn)
        .await?;
        if connection_owners
            .iter()
            .any(|owner| existing.as_ref().map(|t| &t.id) != Some(owner))
        {
            return Err(AppError::Conflict(
                "network MAC is already bound to another device".to_string(),
            ));
        }
        let previous_connections = if let Some(terminal) = &existing {
            Self::connections_on(conn, &terminal.id).await?
        } else {
            Vec::new()
        };
        if req.network.is_none() {
            // A legacy packet can refresh a known endpoint but cannot downgrade its type/MAC.
            if let Some(known) = previous_connections
                .iter()
                .find(|c| c.ipAddress == req.terminalIp && c.networkType != "unknown")
            {
                network_type = known.networkType.clone();
                interface_name = known.interfaceName.clone();
                connection_mac = if known.networkType == "ethernet" {
                    supplied_mac.clone()
                } else {
                    known.macAddress.clone()
                };
            }
        }

        // Identity and interface validation must finish before an IP can move.
        // All releases and registration writes share this transaction, including
        // rollback if a new device has no remaining license seat.
        let displaced_terminals = Self::reassign_ip_on(
            conn,
            &req.terminalIp,
            existing.as_ref().map(|terminal| terminal.id.as_str()),
        )
        .await?;

        let id = if let Some(terminal) = &existing {
            // Normalize generated discovery names while preserving user-defined names.
            let stored_normalized_name = Self::normalize_discovered_name(&terminal.name);
            let new_name = match (supplied_name, normalized_name) {
                (Some(supplied), Some(normalized))
                    if terminal.name.trim() == supplied
                        || (terminal.name.trim() != stored_normalized_name
                            && stored_normalized_name == normalized) =>
                {
                    normalized
                }
                _ => terminal.name.as_str(),
            };
            // A name shared with the room was explicitly saved by management,
            // even if it happens to look like an old generated localhost name.
            let new_name = if new_name != terminal.name
                && sqlx::query_scalar::<_, bool>(
                    "SELECT EXISTS(SELECT 1 FROM rooms WHERE terminalId = ? AND name = ?)",
                )
                .bind(&terminal.id)
                .bind(&terminal.name)
                .fetch_one(&mut *conn)
                .await?
            {
                terminal.name.as_str()
            } else {
                new_name
            };
            sqlx::query(
                "UPDATE terminals SET name=?, serial=?, macAddress=?, deviceType=?, onlineStatus=1,
                 lastHeartbeat=datetime('now','localtime'), softwareVer=?, hardwareInfo=?, updatedAt=datetime('now','localtime') WHERE id=?"
            )
            .bind(new_name)
            .bind(&serial)
            .bind(&supplied_mac)
            .bind(req.deviceType.as_deref().unwrap_or(&terminal.deviceType))
            .bind(req.softwareVer.as_deref().unwrap_or(&terminal.softwareVer))
            .bind(req.hardwareInfo.as_deref().unwrap_or(&terminal.hardwareInfo))
            .bind(&terminal.id)
            .execute(&mut *conn)
            .await?;
            terminal.id.clone()
        } else {
            let registered_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM terminals")
                .fetch_one(&mut *conn)
                .await?;
            if registered_count >= i64::from(terminal_limit) {
                return Err(AppError::Forbidden(format!(
                    "License terminal limit reached ({}/{}); remaining_points=0; new terminal registration is denied",
                    registered_count, terminal_limit
                )));
            }
            let id = format!("terminal-{}", uuid::Uuid::new_v4());
            sqlx::query(
                "INSERT INTO terminals (id, name, terminalIp, macAddress, serial, port, deviceType, onlineStatus, lastHeartbeat, hardwareInfo, softwareVer)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now','localtime'), ?, ?)"
            )
            .bind(&id)
            .bind(normalized_name.map(str::to_string).unwrap_or_else(|| format!("终端-{}", serial)))
            .bind(&req.terminalIp)
            .bind(&supplied_mac)
            .bind(&serial)
            .bind(req.port.unwrap_or(8080))
            .bind(req.deviceType.as_deref().unwrap_or("ktv"))
            .bind(req.hardwareInfo.as_deref().unwrap_or(""))
            .bind(req.softwareVer.as_deref().unwrap_or(""))
            .execute(&mut *conn).await?;
            id
        };

        if device_mac_changed {
            // A Wi-Fi/legacy report can announce a replacement Ethernet MAC,
            // but cannot confirm that the old Ethernet IP is still reachable.
            sqlx::query("UPDATE terminal_connections SET macAddress=?, onlineStatus=0, updatedAt=datetime('now','localtime') WHERE terminalId=? AND networkType='ethernet'")
                .bind(&supplied_mac).bind(&id).execute(&mut *conn).await?;
            sqlx::query(
                "DELETE FROM terminal_connections WHERE terminalId=? AND networkType='unknown'",
            )
            .bind(&id)
            .execute(&mut *conn)
            .await?;
        }
        if network_type != "unknown" {
            sqlx::query("DELETE FROM terminal_connections WHERE terminalId=? AND networkType='unknown' AND (ipAddress=? OR macAddress=? COLLATE NOCASE)")
                .bind(&id).bind(&req.terminalIp).bind(&connection_mac)
                .execute(&mut *conn).await?;
        }
        // DHCP may hand the same address to this player's other interface after a switch.
        sqlx::query("UPDATE terminal_connections SET onlineStatus=0 WHERE terminalId=? AND ipAddress=? AND networkType<>?")
            .bind(&id).bind(&req.terminalIp).bind(&network_type)
            .execute(&mut *conn).await?;
        sqlx::query(
            "INSERT INTO terminal_connections (terminalId, networkType, interfaceName, ipAddress, macAddress, port, onlineStatus, lastHeartbeat)
             VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now','localtime'))
             ON CONFLICT(terminalId, networkType) DO UPDATE SET
                interfaceName=excluded.interfaceName, ipAddress=excluded.ipAddress, macAddress=excluded.macAddress,
                port=excluded.port, onlineStatus=1, lastHeartbeat=excluded.lastHeartbeat, updatedAt=datetime('now','localtime')",
        )
        .bind(&id).bind(&network_type).bind(&interface_name).bind(&req.terminalIp).bind(&connection_mac)
        .bind(req.port.unwrap_or_else(|| existing.as_ref().map(|t| t.port).unwrap_or(8080)))
        .execute(&mut *conn)
        .await?;
        let _ = Self::expire_connections_on(conn, Some(&id), 60).await?;
        let terminal = Self::refresh_primary_on(conn, &id).await?;
        let changed = existing.as_ref().is_none_or(|old| {
            old.onlineStatus != terminal.onlineStatus
                || old.terminalIp != terminal.terminalIp
                || old.port != terminal.port
                || old.serial != terminal.serial
                || old.macAddress != terminal.macAddress
                || old.name != terminal.name
        }) || Self::connection_state(&previous_connections)
            != Self::connection_state(&terminal.connections);
        Ok(TerminalRegistration {
            terminal,
            status_changed: changed || !displaced_terminals.is_empty(),
            displaced_terminals,
        })
    }

    async fn reassign_ip_on(
        conn: &mut sqlx::SqliteConnection,
        ip: &str,
        registering_id: Option<&str>,
    ) -> AppResult<Vec<Terminal>> {
        let owners: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM terminals WHERE terminalIp=?1
             UNION SELECT terminalId FROM terminal_connections WHERE ipAddress=?1 AND onlineStatus=1",
        )
        .bind(ip)
        .fetch_all(&mut *conn)
        .await?;
        let mut displaced = Vec::new();
        for owner in owners {
            if Some(owner.as_str()) == registering_id {
                continue;
            }
            // Serial is the persistent identity; the verified packet's source
            // is its current address. Historical IP ownership is not a lease
            // and cannot delay an update until the old heartbeat expires.
            sqlx::query("UPDATE terminal_connections SET onlineStatus=0, updatedAt=datetime('now','localtime') WHERE terminalId=? AND ipAddress=?")
                .bind(&owner).bind(ip).execute(&mut *conn).await?;
            Self::expire_connections_on(conn, Some(&owner), 60).await?;
            // Never assign the registering player's former IP to the old owner:
            // that would invent a device address and could route to a wrong room.
            sqlx::query("UPDATE terminals SET terminalIp='', updatedAt=datetime('now','localtime') WHERE id=? AND terminalIp=?")
                .bind(&owner).bind(ip).execute(&mut *conn).await?;
            displaced.push(Self::refresh_primary_on(conn, &owner).await?);
        }
        Ok(displaced)
    }

    fn connection_state(connections: &[TerminalConnection]) -> Vec<(&str, &str, &str, i32, i32)> {
        connections
            .iter()
            .map(|c| {
                (
                    c.networkType.as_str(),
                    c.ipAddress.as_str(),
                    c.macAddress.as_str(),
                    c.port,
                    c.onlineStatus,
                )
            })
            .collect()
    }

    async fn connections_on(
        conn: &mut sqlx::SqliteConnection,
        id: &str,
    ) -> AppResult<Vec<TerminalConnection>> {
        Ok(sqlx::query_as(
            "SELECT * FROM terminal_connections WHERE terminalId=? ORDER BY networkType",
        )
        .bind(id)
        .fetch_all(conn)
        .await?)
    }

    async fn expire_connections_on(
        conn: &mut sqlx::SqliteConnection,
        id: Option<&str>,
        timeout_secs: i64,
    ) -> AppResult<Vec<String>> {
        Ok(sqlx::query_scalar("UPDATE terminal_connections SET onlineStatus=0, updatedAt=datetime('now','localtime')
            WHERE onlineStatus=1 AND (? IS NULL OR terminalId=?) AND lastHeartbeat < datetime('now','localtime', ?)
            RETURNING terminalId")
            .bind(id).bind(id).bind(format!("-{} seconds", timeout_secs.max(0)))
            .fetch_all(conn).await?)
    }

    async fn refresh_primary_on(
        conn: &mut sqlx::SqliteConnection,
        id: &str,
    ) -> AppResult<Terminal> {
        let connections = Self::connections_on(conn, id).await?;
        // Ordering is independent of packet arrival: wired first, then Wi-Fi.
        let primary = connections
            .iter()
            .filter(|c| c.onlineStatus == 1)
            .min_by_key(|c| match c.networkType.as_str() {
                "ethernet" => 0,
                "wifi" => 1,
                _ => 2,
            });
        if let Some(primary) = primary {
            sqlx::query("UPDATE terminals SET terminalIp=?, port=?, onlineStatus=1 WHERE id=?")
                .bind(&primary.ipAddress)
                .bind(primary.port)
                .bind(id)
                .execute(&mut *conn)
                .await?;
        } else {
            sqlx::query("UPDATE terminals SET onlineStatus=0 WHERE id=?")
                .bind(id)
                .execute(&mut *conn)
                .await?;
        }
        let mut terminal = sqlx::query_as::<_, Terminal>("SELECT * FROM terminals WHERE id=?")
            .bind(id)
            .fetch_one(&mut *conn)
            .await?;
        terminal.connections = connections;
        Ok(terminal)
    }

    pub async fn registered_count(pool: &SqlitePool) -> AppResult<u32> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM terminals")
            .fetch_one(pool)
            .await?;
        Ok(count.clamp(0, i64::from(u32::MAX)) as u32)
    }

    /// 根据IP获取终端
    pub async fn has_ip(pool: &SqlitePool, terminal_id: &str, ip: &str) -> AppResult<bool> {
        if ip.is_empty() {
            return Ok(false);
        }
        Ok(sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM terminals t WHERE t.id=?1 AND
             (t.terminalIp=?2 OR EXISTS (SELECT 1 FROM terminal_connections c
               WHERE c.terminalId=t.id AND c.ipAddress=?2 AND c.onlineStatus=1)))",
        )
        .bind(terminal_id)
        .bind(ip)
        .fetch_one(pool)
        .await?)
    }

    /// 根据任一当前连接的 IP 获取终端。
    pub async fn get_by_ip(pool: &SqlitePool, ip: &str) -> AppResult<Terminal> {
        if ip.is_empty() {
            return Err(AppError::NotFound("终端 IP 为空".to_string()));
        }
        let id: String = sqlx::query_scalar(
            "SELECT id FROM terminals WHERE terminalIp = ? OR id IN
             (SELECT terminalId FROM terminal_connections WHERE ipAddress=? AND onlineStatus=1)",
        )
        .bind(ip)
        .bind(ip)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("终端不存在: {}", ip)))?;
        Self::get_by_id(pool, &id).await
    }

    /// 根据ID获取终端
    pub async fn get_by_id(pool: &sqlx::SqlitePool, id: &str) -> AppResult<Terminal> {
        let mut conn = pool.acquire().await?;
        let mut terminal = sqlx::query_as::<_, Terminal>("SELECT * FROM terminals WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *conn)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("终端不存在: {}", id)))?;
        terminal.connections = Self::connections_on(&mut conn, id).await?;
        Ok(terminal)
    }

    /// 获取所有终端
    pub async fn list_all(pool: &SqlitePool) -> AppResult<Vec<Terminal>> {
        let mut transaction = pool.begin().await?;
        let mut terminals = sqlx::query_as::<_, Terminal>(
            "SELECT * FROM terminals ORDER BY onlineStatus DESC, name ASC",
        )
        .fetch_all(&mut *transaction)
        .await?;
        let connections: Vec<TerminalConnection> =
            sqlx::query_as("SELECT * FROM terminal_connections ORDER BY networkType")
                .fetch_all(&mut *transaction)
                .await?;
        let mut by_terminal: std::collections::HashMap<String, Vec<TerminalConnection>> =
            std::collections::HashMap::new();
        for connection in connections {
            by_terminal
                .entry(connection.terminalId.clone())
                .or_default()
                .push(connection);
        }
        for terminal in &mut terminals {
            terminal.connections = by_terminal.remove(&terminal.id).unwrap_or_default();
        }
        transaction.commit().await?;
        Ok(terminals)
    }

    /// 更新终端
    pub async fn update(
        pool: &SqlitePool,
        id: &str,
        req: UpdateTerminalRequest,
    ) -> AppResult<Terminal> {
        let existing = Self::get_by_id(pool, id).await?;
        let name = req.name.as_deref().map(str::trim);
        if name == Some("") {
            return Err(AppError::BadRequest("设备名称不能为空".to_string()));
        }

        let mut transaction = pool.begin().await?;
        sqlx::query(
            "UPDATE terminals SET name=COALESCE(?,name), port=?, deviceType=?, roomId=?,
             updatedAt=datetime('now','localtime') WHERE id=?",
        )
        .bind(name)
        .bind(req.port.unwrap_or(existing.port))
        .bind(req.deviceType.as_deref().unwrap_or(&existing.deviceType))
        .bind(req.roomId.as_deref().unwrap_or(&existing.roomId))
        .bind(id)
        .execute(&mut *transaction)
        .await?;

        if let Some(name) = name {
            let rooms = sqlx::query(
                "UPDATE rooms SET name = ?, updatedAt = datetime('now','localtime') WHERE terminalId = ?",
            )
            .bind(name)
            .bind(id)
            .execute(&mut *transaction)
            .await?;
            if rooms.rows_affected() > 1 {
                return Err(AppError::Conflict(
                    "终端绑定了多个房间，请先修复一对一绑定".to_string(),
                ));
            }
        }
        transaction.commit().await?;

        Self::get_by_id(pool, id).await
    }

    /// 删除终端（同时删除关联的房间）
    pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
        let mut transaction = pool.begin().await?;
        // 先删除关联房间的队列
        sqlx::query(
            "DELETE FROM room_queue WHERE roomId IN (SELECT id FROM rooms WHERE terminalId = ?)",
        )
        .bind(id)
        .execute(&mut *transaction)
        .await?;

        // 删除关联的房间
        sqlx::query("DELETE FROM rooms WHERE terminalId = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;

        sqlx::query("DELETE FROM terminal_connections WHERE terminalId=?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        // 删除终端
        let result = sqlx::query("DELETE FROM terminals WHERE id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("终端不存在: {}", id)));
        }
        transaction.commit().await?;
        Ok(())
    }

    /// 获取终端关联的房间数量
    pub async fn get_linked_room_count(pool: &SqlitePool, terminalId: &str) -> AppResult<i64> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms WHERE terminalId = ?")
            .bind(terminalId)
            .fetch_one(pool)
            .await?;
        Ok(count)
    }

    /// 各连接独立超时，并重新选择仍然在线的主连接。
    pub async fn mark_offline_timeout(
        pool: &SqlitePool,
        timeout_secs: i64,
    ) -> AppResult<Vec<Terminal>> {
        let mut transaction = pool.begin().await?;
        // Return any device whose connection status or primary endpoint changed,
        // including wired -> Wi-Fi failover while the device stays online.
        // Acquire the SQLite write lock before reading state. A deferred read
        // followed by an update can otherwise fail with SQLITE_BUSY_SNAPSHOT
        // when a new interface heartbeat commits between those operations.
        let mut target_ids =
            Self::expire_connections_on(&mut transaction, None, timeout_secs).await?;
        let legacy_ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM terminals WHERE onlineStatus=1
             AND lastHeartbeat < datetime('now','localtime', ?)",
        )
        .bind(format!("-{} seconds", timeout_secs.max(0)))
        .fetch_all(&mut *transaction)
        .await?;
        target_ids.extend(legacy_ids);
        target_ids.sort();
        target_ids.dedup();
        let mut changed = Vec::with_capacity(target_ids.len());
        for id in target_ids {
            changed.push(Self::refresh_primary_on(&mut transaction, &id).await?);
        }
        transaction.commit().await?;
        Ok(changed)
    }
}

#[cfg(test)]
mod normalize_discovered_name_tests {
    use super::TerminalService;

    #[test]
    fn strips_only_player_generated_localhost_suffix() {
        assert_eq!(
            TerminalService::normalize_discovered_name("localhost-a1151c60"),
            "localhost"
        );
        assert_eq!(
            TerminalService::normalize_discovered_name("localhost"),
            "localhost"
        );
        assert_eq!(
            TerminalService::normalize_discovered_name("VIP-12345678"),
            "VIP-12345678"
        );
        assert_eq!(
            TerminalService::normalize_discovered_name("player-a1151c60"),
            "player-a1151c60"
        );
    }

    #[test]
    fn ignores_placeholder_mac_addresses() {
        for mac in [
            "00:00:00:00:00:00",
            "02:00:00:00:00:00",
            "FF:FF:FF:FF:FF:FF",
            "01:00:5E:00:00:01",
            "02:11:22:33:44:55invalid",
            "-",
        ] {
            assert!(TerminalService::usable_mac(Some(mac)).is_none(), "{mac}");
        }
        assert_eq!(
            TerminalService::usable_mac(Some("02:11:22:33:44:55")),
            Some("02:11:22:33:44:55".to_string())
        );
        assert_eq!(
            TerminalService::usable_mac(Some("d6ab.aa8a.537f")),
            Some("D6:AB:AA:8A:53:7F".to_string())
        );
    }
}

#[cfg(test)]
mod admission_tests {
    use super::{TerminalRegistration, TerminalService};
    use crate::errors::AppError;
    use crate::models::terminal::{
        RegisterTerminalRequest, TerminalNetworkReport, TerminalNetworkType,
    };
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> (tempfile::TempDir, sqlx::SqlitePool) {
        let dir = tempfile::tempdir().expect("create test directory");
        let path = dir.path().join("terminals.db");
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await
            .expect("connect test database");
        sqlx::query(
            "CREATE TABLE terminals (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                terminalIp TEXT NOT NULL,
                macAddress TEXT NOT NULL DEFAULT '',
                port INTEGER NOT NULL DEFAULT 5000,
                deviceType TEXT NOT NULL DEFAULT 'ktv',
                roomId TEXT NOT NULL DEFAULT '',
                onlineStatus INTEGER NOT NULL DEFAULT 0,
                lastHeartbeat TEXT NOT NULL DEFAULT '',
                hardwareInfo TEXT NOT NULL DEFAULT '',
                softwareVer TEXT NOT NULL DEFAULT '',
                createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
        )
        .execute(&pool)
        .await
        .expect("create terminals table");
        sqlx::raw_sql(include_str!(
            "../../migrations/035_terminal_network_connections.sql"
        ))
        .execute(&pool)
        .await
        .expect("migrate terminal identities and connections");
        sqlx::raw_sql(include_str!(
            "../../migrations/037_reclaim_expired_terminal_ips.sql"
        ))
        .execute(&pool)
        .await
        .expect("allow released primary addresses");
        (dir, pool)
    }

    fn request(ip: &str, mac: &str) -> RegisterTerminalRequest {
        RegisterTerminalRequest {
            name: Some(format!("Player-{ip}")),
            terminalIp: ip.to_string(),
            macAddress: Some(mac.to_string()),
            serial: format!("SN-{}", mac.replace(':', "")),
            network: None,
            port: Some(8080),
            deviceType: Some("ktv".to_string()),
            hardwareInfo: Some("{}".to_string()),
            softwareVer: Some("1.0".to_string()),
        }
    }

    fn network_request(ip: &str, kind: TerminalNetworkType) -> RegisterTerminalRequest {
        let mut req = request(ip, "D6:AB:AA:8A:53:7F");
        req.serial = "279f4f6d53f8febe".to_string();
        req.network = Some(TerminalNetworkReport {
            network_type: kind,
            interface_name: if matches!(kind, TerminalNetworkType::Ethernet) {
                "eth0"
            } else {
                "wlan0"
            }
            .to_string(),
            mac_address: if matches!(kind, TerminalNetworkType::Ethernet) {
                "D6:AB:AA:8A:53:7F"
            } else {
                "84:93:EC:D5:73:A5"
            }
            .to_string(),
        });
        req
    }

    #[tokio::test]
    async fn serial_is_required_and_placeholders_never_create_devices() {
        let (_dir, pool) = test_pool().await;
        for serial in [
            "",
            "  ",
            "unknown",
            "null",
            "----",
            "00000000",
            "ffffffff",
            "0123456789ABCDEF",
            "SN\n1234",
            "序列号",
        ] {
            let mut req = request("192.0.2.10", "02:00:00:00:00:10");
            req.serial = serial.to_string();
            assert!(
                matches!(
                    TerminalService::register(&pool, req, 10).await,
                    Err(AppError::BadRequest(_))
                ),
                "{serial:?}"
            );
        }
        assert_eq!(TerminalService::registered_count(&pool).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn two_interfaces_share_identity_room_and_one_license_seat() {
        let (_dir, pool) = test_pool().await;
        // Exercise real migrations and room creation, including concurrent callers.
        crate::db::run_migrations(&pool).await.unwrap();
        let a = pool.clone();
        let b = pool.clone();
        let register_room = |db: sqlx::SqlitePool, ip: &'static str, kind| async move {
            let TerminalRegistration { terminal, .. } =
                TerminalService::register(&db, network_request(ip, kind), 1)
                    .await
                    .unwrap();
            let room = crate::services::room_service::RoomService::auto_create_for_terminal(
                &db,
                &terminal.id,
                &terminal.name,
            )
            .await
            .unwrap();
            (terminal.id, room.id)
        };
        let (wired, wifi) = tokio::join!(
            register_room(a, "192.0.2.10", TerminalNetworkType::Ethernet),
            register_room(b, "192.0.2.11", TerminalNetworkType::Wifi)
        );
        assert_eq!(wired, wifi);
        let devices = TerminalService::list_all(&pool).await.unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].serial, "279F4F6D53F8FEBE");
        assert_eq!(devices[0].connections.len(), 2);
        assert_eq!(devices[0].terminalIp, "192.0.2.10");
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rooms")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        for ip in ["192.0.2.10", "192.0.2.11"] {
            assert_eq!(
                TerminalService::get_by_ip(&pool, ip).await.unwrap().id,
                wired.0
            );
            assert_eq!(
                crate::services::room_service::RoomService::resolve_room_id(&pool, "current", ip)
                    .await
                    .unwrap(),
                wired.1
            );
            assert_eq!(
                crate::services::room_service::RoomService::resolve_room_id(
                    &pool,
                    ip,
                    "192.0.2.99"
                )
                .await
                .unwrap(),
                wired.1
            );
            assert_eq!(
                crate::services::room_service::RoomService::list_by_terminal_ip(&pool, ip)
                    .await
                    .unwrap()
                    .len(),
                1
            );
        }
        // Packet ordering and casing must not move the primary IP or allocate a seat.
        for _ in 0..3 {
            let mut req = network_request("192.0.2.11", TerminalNetworkType::Wifi);
            req.serial = "  279F4F6D53F8FEBE ".to_string();
            let TerminalRegistration {
                terminal,
                status_changed: changed,
                ..
            } = TerminalService::register(&pool, req, 1).await.unwrap();
            assert_eq!(terminal.terminalIp, "192.0.2.10");
            assert!(!changed);
        }
    }

    #[tokio::test]
    async fn wired_timeout_fails_over_to_wifi_without_offlining_device() {
        let (_dir, pool) = test_pool().await;
        let TerminalRegistration {
            terminal: wired, ..
        } = TerminalService::register(
            &pool,
            network_request("192.0.2.10", TerminalNetworkType::Ethernet),
            1,
        )
        .await
        .unwrap();
        TerminalService::register(
            &pool,
            network_request("192.0.2.11", TerminalNetworkType::Wifi),
            1,
        )
        .await
        .unwrap();
        sqlx::query("UPDATE terminal_connections SET lastHeartbeat=datetime('now','localtime','-120 seconds') WHERE networkType='ethernet'")
            .execute(&pool).await.unwrap();
        let changed = TerminalService::mark_offline_timeout(&pool, 60)
            .await
            .unwrap();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].onlineStatus, 1);
        assert_eq!(changed[0].terminalIp, "192.0.2.11");
        assert_eq!(
            changed[0]
                .connections
                .iter()
                .find(|c| c.networkType == "ethernet")
                .unwrap()
                .onlineStatus,
            0
        );
        let TerminalRegistration {
            terminal: restored, ..
        } = TerminalService::register(
            &pool,
            network_request("192.0.2.10", TerminalNetworkType::Ethernet),
            1,
        )
        .await
        .unwrap();
        assert_eq!(restored.id, wired.id);
        assert_eq!(restored.terminalIp, "192.0.2.10");
        sqlx::query("UPDATE terminal_connections SET lastHeartbeat=datetime('now','localtime','-120 seconds')")
            .execute(&pool).await.unwrap();
        let changed = TerminalService::mark_offline_timeout(&pool, 60)
            .await
            .unwrap();
        assert_eq!(changed[0].onlineStatus, 0);
        assert_eq!(changed[0].terminalIp, "192.0.2.10");
        assert!(changed[0].connections.iter().all(|c| c.onlineStatus == 0));
    }

    #[tokio::test]
    async fn ethernet_mac_owned_by_another_serial_is_rejected() {
        let (_dir, pool) = test_pool().await;
        let TerminalRegistration {
            terminal: first, ..
        } = TerminalService::register(
            &pool,
            network_request("192.0.2.10", TerminalNetworkType::Ethernet),
            5,
        )
        .await
        .unwrap();
        let owner = TerminalService::register(&pool, request("192.0.2.12", "02:00:00:00:00:12"), 5)
            .await
            .unwrap()
            .terminal;
        let mut other = network_request("192.0.2.11", TerminalNetworkType::Wifi);
        other.macAddress = Some(owner.macAddress);
        assert!(matches!(
            TerminalService::register(&pool, other, 5).await,
            Err(AppError::Conflict(_))
        ));
        let mut changed_serial = network_request("192.0.2.11", TerminalNetworkType::Wifi);
        changed_serial.serial = "ANOTHER-SERIAL".to_string();
        assert!(matches!(
            TerminalService::register(&pool, changed_serial, 5).await,
            Err(AppError::Conflict(_))
        ));
        assert_eq!(
            TerminalService::get_by_id(&pool, &first.id)
                .await
                .unwrap()
                .connections
                .len(),
            1
        );
        assert_eq!(TerminalService::registered_count(&pool).await.unwrap(), 2);
        assert_eq!(
            TerminalService::get_by_id(&pool, &first.id)
                .await
                .unwrap()
                .macAddress,
            first.macAddress
        );
    }

    #[tokio::test]
    async fn same_serial_refreshes_mac_without_replacing_room_or_using_a_seat() {
        let (_dir, pool) = test_pool().await;
        crate::db::run_migrations(&pool).await.unwrap();
        let first = TerminalService::register(
            &pool,
            network_request("192.0.2.10", TerminalNetworkType::Ethernet),
            1,
        )
        .await
        .unwrap()
        .terminal;
        let room = crate::services::room_service::RoomService::auto_create_for_terminal(
            &pool,
            &first.id,
            &first.name,
        )
        .await
        .unwrap();
        let mut req = network_request("192.0.2.11", TerminalNetworkType::Ethernet);
        req.macAddress = Some("fe:e5:63:08:ff:f0".to_string());
        req.network.as_mut().unwrap().mac_address = "FE:E5:63:08:FF:F0".to_string();
        let updated = TerminalService::register(&pool, req.clone(), 1)
            .await
            .unwrap();
        assert!(updated.status_changed);
        assert_eq!(updated.terminal.id, first.id);
        assert_eq!(updated.terminal.macAddress, "FE:E5:63:08:FF:F0");
        assert_eq!(updated.terminal.terminalIp, "192.0.2.11");
        assert_eq!(updated.terminal.connections.len(), 1);
        assert_eq!(
            updated.terminal.connections[0].macAddress,
            updated.terminal.macAddress
        );
        assert_eq!(
            crate::services::room_service::RoomService::resolve_room_id(
                &pool,
                "current",
                "192.0.2.11"
            )
            .await
            .unwrap(),
            room.id
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rooms")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(updated.terminal.name, first.name);
        assert_eq!(TerminalService::registered_count(&pool).await.unwrap(), 1);
        assert!(
            !TerminalService::register(&pool, req, 1)
                .await
                .unwrap()
                .status_changed
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM terminal_connections WHERE macAddress=?"
            )
            .bind(&first.macAddress)
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn wifi_report_refreshes_device_mac_and_retires_stale_ethernet_endpoint() {
        let (_dir, pool) = test_pool().await;
        let first = TerminalService::register(
            &pool,
            network_request("192.0.2.10", TerminalNetworkType::Ethernet),
            1,
        )
        .await
        .unwrap()
        .terminal;
        let mut req = network_request("192.0.2.11", TerminalNetworkType::Wifi);
        req.macAddress = Some("FE:E5:63:08:FF:F0".to_string());
        let updated = TerminalService::register(&pool, req, 1).await.unwrap();
        assert_eq!(updated.terminal.id, first.id);
        assert_eq!(updated.terminal.terminalIp, "192.0.2.11");
        assert_eq!(updated.terminal.macAddress, "FE:E5:63:08:FF:F0");
        let wired = updated
            .terminal
            .connections
            .iter()
            .find(|c| c.networkType == "ethernet")
            .unwrap();
        assert_eq!(wired.onlineStatus, 0);
        assert_eq!(wired.macAddress, updated.terminal.macAddress);
        assert!(!TerminalService::has_ip(&pool, &first.id, "192.0.2.10")
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn legacy_report_refreshes_known_ethernet_mac_and_invalid_update_rolls_back() {
        let (_dir, pool) = test_pool().await;
        let first = TerminalService::register(
            &pool,
            network_request("192.0.2.10", TerminalNetworkType::Ethernet),
            1,
        )
        .await
        .unwrap()
        .terminal;
        let mut req = network_request("192.0.2.10", TerminalNetworkType::Ethernet);
        req.macAddress = Some("FE:E5:63:08:FF:F0".to_string());
        // Mismatched Ethernet fields must not partially change identity.
        assert!(matches!(
            TerminalService::register(&pool, req.clone(), 1).await,
            Err(AppError::Conflict(_))
        ));
        assert_eq!(
            TerminalService::get_by_id(&pool, &first.id)
                .await
                .unwrap()
                .macAddress,
            first.macAddress
        );
        req.network = None;
        let updated = TerminalService::register(&pool, req, 1)
            .await
            .unwrap()
            .terminal;
        assert_eq!(updated.connections.len(), 1);
        assert_eq!(updated.connections[0].networkType, "ethernet");
        assert_eq!(updated.connections[0].macAddress, "FE:E5:63:08:FF:F0");
        assert_eq!(updated.connections[0].onlineStatus, 1);
    }

    #[tokio::test]
    async fn timeout_and_new_heartbeat_serialize_without_losing_online_state() {
        let (_dir, pool) = test_pool().await;
        sqlx::query("PRAGMA journal_mode=WAL")
            .execute(&pool)
            .await
            .unwrap();
        TerminalService::register(
            &pool,
            network_request("192.0.2.10", TerminalNetworkType::Ethernet),
            1,
        )
        .await
        .unwrap();
        let TerminalRegistration {
            terminal: device, ..
        } = TerminalService::register(
            &pool,
            network_request("192.0.2.11", TerminalNetworkType::Wifi),
            1,
        )
        .await
        .unwrap();
        for _ in 0..16 {
            sqlx::query("UPDATE terminal_connections SET lastHeartbeat=datetime('now','localtime','-120 seconds')")
                .execute(&pool).await.unwrap();
            let (heartbeat, timeout) = tokio::join!(
                TerminalService::register(
                    &pool,
                    network_request("192.0.2.11", TerminalNetworkType::Wifi),
                    1
                ),
                TerminalService::mark_offline_timeout(&pool, 60)
            );
            heartbeat.unwrap();
            timeout.unwrap();
            let current = TerminalService::get_by_id(&pool, &device.id).await.unwrap();
            assert_eq!(current.onlineStatus, 1);
            assert_eq!(current.terminalIp, "192.0.2.11");
            assert_eq!(
                current
                    .connections
                    .iter()
                    .filter(|c| c.onlineStatus == 1)
                    .count(),
                1
            );
        }
        assert_eq!(TerminalService::registered_count(&pool).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn legacy_connection_is_classified_without_duplicate_or_downgrade() {
        let (_dir, pool) = test_pool().await;
        let mut legacy = network_request("192.0.2.10", TerminalNetworkType::Ethernet);
        legacy.network = None;
        let TerminalRegistration {
            terminal: first, ..
        } = TerminalService::register(&pool, legacy, 1).await.unwrap();
        assert_eq!(first.connections[0].networkType, "unknown");
        let TerminalRegistration {
            terminal: classified,
            ..
        } = TerminalService::register(
            &pool,
            network_request("192.0.2.10", TerminalNetworkType::Ethernet),
            1,
        )
        .await
        .unwrap();
        assert_eq!(classified.connections.len(), 1);
        assert_eq!(classified.connections[0].networkType, "ethernet");
        let mut legacy = network_request("192.0.2.10", TerminalNetworkType::Ethernet);
        legacy.network = None;
        let TerminalRegistration {
            terminal: refreshed,
            status_changed: changed,
            ..
        } = TerminalService::register(&pool, legacy, 1).await.unwrap();
        assert_eq!(refreshed.id, first.id);
        assert_eq!(refreshed.connections[0].networkType, "ethernet");
        assert!(!changed);
    }

    #[tokio::test]
    async fn interface_mismatch_is_rejected_and_secondary_ips_follow_the_reporting_serial() {
        let (_dir, pool) = test_pool().await;
        let mut invalid = network_request("192.0.2.10", TerminalNetworkType::Wifi);
        invalid.network.as_mut().unwrap().interface_name = "eth0".to_string();
        assert!(matches!(
            TerminalService::register(&pool, invalid, 5).await,
            Err(AppError::BadRequest(_))
        ));
        TerminalService::register(
            &pool,
            network_request("192.0.2.10", TerminalNetworkType::Ethernet),
            5,
        )
        .await
        .unwrap();
        TerminalService::register(
            &pool,
            network_request("192.0.2.11", TerminalNetworkType::Wifi),
            5,
        )
        .await
        .unwrap();
        let other = request("192.0.2.11", "02:00:00:00:00:12");
        let result = TerminalService::register(&pool, other, 5).await.unwrap();
        assert_eq!(result.terminal.terminalIp, "192.0.2.11");
        assert_eq!(result.displaced_terminals.len(), 1);
        let previous = &result.displaced_terminals[0];
        assert_eq!(previous.serial, "279F4F6D53F8FEBE");
        assert_eq!(previous.terminalIp, "192.0.2.10");
        assert_eq!(previous.onlineStatus, 1);
        assert!(previous.connections.iter().all(|connection| {
            connection.onlineStatus == i32::from(connection.networkType == "ethernet")
        }));
        assert_eq!(TerminalService::registered_count(&pool).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn network_switch_can_reuse_same_ip_and_wifi_mac_can_change() {
        let (_dir, pool) = test_pool().await;
        TerminalService::register(
            &pool,
            network_request("192.0.2.10", TerminalNetworkType::Ethernet),
            1,
        )
        .await
        .unwrap();
        let TerminalRegistration { terminal: wifi, .. } = TerminalService::register(
            &pool,
            network_request("192.0.2.10", TerminalNetworkType::Wifi),
            1,
        )
        .await
        .unwrap();
        assert_eq!(
            wifi.connections
                .iter()
                .filter(|c| c.onlineStatus == 1)
                .count(),
            1
        );
        let mut req = network_request("192.0.2.11", TerminalNetworkType::Wifi);
        req.network.as_mut().unwrap().mac_address = "02:22:33:44:55:66".to_string();
        let TerminalRegistration {
            terminal: updated, ..
        } = TerminalService::register(&pool, req, 1).await.unwrap();
        assert_eq!(updated.id, wifi.id);
        assert_eq!(updated.macAddress, "D6:AB:AA:8A:53:7F");
        assert_eq!(updated.terminalIp, "192.0.2.11");
    }

    #[tokio::test]
    async fn invalid_terminal_addresses_are_rejected_without_creating_records() {
        let (_dir, pool) = test_pool().await;
        for ip in [
            "offline:terminal-stale",
            "",
            "localhost",
            "192.0.2.999",
            "0.0.0.0",
            "127.0.0.1",
            "224.0.0.1",
            "255.255.255.255",
        ] {
            let result =
                TerminalService::register(&pool, request(ip, "02:00:00:00:00:10"), 10).await;
            assert!(matches!(result, Err(AppError::BadRequest(_))), "{ip}");
        }
        assert_eq!(TerminalService::registered_count(&pool).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn concurrent_registration_cannot_exceed_limit() {
        let (_dir, pool) = test_pool().await;
        let first_pool = pool.clone();
        let second_pool = pool.clone();
        let first = tokio::spawn(async move {
            TerminalService::register(&first_pool, request("192.0.2.10", "02:00:00:00:00:10"), 1)
                .await
        });
        let second = tokio::spawn(async move {
            TerminalService::register(&second_pool, request("192.0.2.11", "02:00:00:00:00:11"), 1)
                .await
        });
        let results = [first.await.unwrap(), second.await.unwrap()];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(TerminalService::registered_count(&pool).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn existing_terminal_does_not_consume_another_point() {
        let (_dir, pool) = test_pool().await;
        let TerminalRegistration {
            terminal: first, ..
        } = TerminalService::register(&pool, request("192.0.2.10", "02:00:00:00:00:10"), 1)
            .await
            .unwrap();
        let TerminalRegistration { terminal, .. } =
            TerminalService::register(&pool, request("192.0.2.20", "02:00:00:00:00:10"), 1)
                .await
                .unwrap();
        assert_eq!(terminal.id, first.id);
        assert_eq!(terminal.terminalIp, "192.0.2.20");
        assert_eq!(TerminalService::registered_count(&pool).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn new_mac_is_denied_when_all_points_are_used() {
        let (_dir, pool) = test_pool().await;
        TerminalService::register(&pool, request("192.0.2.10", "02:00:00:00:00:10"), 1)
            .await
            .unwrap();
        let denied =
            TerminalService::register(&pool, request("192.0.2.11", "02:00:00:00:00:11"), 1).await;
        assert!(
            matches!(denied, Err(AppError::Forbidden(message)) if message.contains("remaining_points=0"))
        );
    }

    #[tokio::test]
    async fn reduced_limit_rejects_terminals_outside_seat_range() {
        let (_dir, pool) = test_pool().await;
        TerminalService::register(&pool, request("192.0.2.10", "02:00:00:00:00:10"), 2)
            .await
            .unwrap();
        TerminalService::register(&pool, request("192.0.2.11", "02:00:00:00:00:11"), 2)
            .await
            .unwrap();

        let denied =
            TerminalService::register(&pool, request("192.0.2.12", "02:00:00:00:00:12"), 1).await;
        assert!(matches!(denied, Err(AppError::Forbidden(_))));
        assert!(
            TerminalService::register(&pool, request("192.0.2.10", "02:00:00:00:00:10"), 1,)
                .await
                .is_ok()
        );
    }
}
