pub mod cashier;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;
use tokio::net::UdpSocket;
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::models::terminal::{RegisterTerminalRequest, TerminalNetworkReport};
use crate::services::room_service::RoomService;
use crate::services::terminal_service::{TerminalRegistration, TerminalService};

const DISCOVERY_PROTOCOL_VERSION: &str = "2.0";
const PLAYER_DEVICE_ROLE: &str = "player";
const PLAYER_APP_ID: &str = "com.hsvj.engine";

pub(crate) fn is_supported_player_model(model: Option<&str>) -> bool {
    let Some(model) = model.map(str::trim).filter(|model| !model.is_empty()) else {
        return false;
    };

    let normalized = model.to_ascii_uppercase();
    normalized == "H6" || normalized.starts_with("H6_") || normalized.starts_with("H6-")
}

/// Send an active player discovery request with a random challenge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoverPayload {
    pub ip: String,
    pub device_name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub protocol_version: String,
    #[serde(default)]
    pub device_role: String,
    #[serde(default)]
    pub app_id: String,
    pub mac: Option<String>,
    pub serial: Option<String>,
    #[serde(default)]
    pub network: Option<TerminalNetworkReport>,
    pub model: Option<String>,
    #[serde(default)]
    pub ports: DiscoverPorts,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiscoverPorts {
    #[serde(default)]
    pub http: u16,
    #[serde(default)]
    pub mobile: u16,
    #[serde(default)]
    pub vod: u16,
    #[serde(default)]
    pub ws: u16,
    #[serde(default)]
    pub tcp: u16,
    #[serde(default)]
    pub udp: u16,
    #[serde(default)]
    pub sync: u16,
}

#[derive(Debug, Deserialize)]
struct DiscoverResponse {
    #[serde(rename = "type")]
    msg_type: Option<String>,
    protocol: Option<String>,
    protocol_version: Option<String>,
    device_role: Option<String>,
    app_id: Option<String>,
    challenge: Option<String>,
    #[serde(rename = "ip")]
    _ip: Option<String>,
    device_name: Option<String>,
    #[serde(default)]
    version: String,
    mac: Option<String>,
    serial: Option<String>,
    #[serde(default)]
    network: Option<TerminalNetworkReport>,
    model: Option<String>,
    #[serde(default)]
    ports: DiscoverPorts,
}

impl DiscoverResponse {
    fn is_player(&self) -> bool {
        self.msg_type.as_deref() == Some("hvideo")
            && self.protocol.as_deref() == Some("discover")
            && self.protocol_version.as_deref() == Some(DISCOVERY_PROTOCOL_VERSION)
            && self.device_role.as_deref() == Some(PLAYER_DEVICE_ROLE)
            && self.app_id.as_deref() == Some(PLAYER_APP_ID)
            && self.ports.http > 0
    }

    fn into_payload(self, source_ip: String) -> Option<DiscoverPayload> {
        if !self.is_player() {
            return None;
        }

        Some(DiscoverPayload {
            ip: source_ip,
            device_name: self
                .device_name
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| "HVideo Player".to_string()),
            version: self.version,
            protocol_version: self.protocol_version.unwrap_or_default(),
            device_role: self.device_role.unwrap_or_default(),
            app_id: self.app_id.unwrap_or_default(),
            mac: self.mac.filter(|value| !value.trim().is_empty()),
            serial: self.serial.filter(|value| !value.trim().is_empty()),
            network: self.network,
            model: self.model.filter(|value| !value.trim().is_empty()),
            ports: self.ports,
        })
    }
}

/// Send an active player discovery request with a random challenge.
/// Only HSVJ Player devices that echo the challenge are accepted.
pub async fn discover_devices(
    udp_port: u16,
    timeout_secs: u64,
    bind_ip: Ipv4Addr,
    broadcast_ip: Ipv4Addr,
) -> Vec<DiscoverPayload> {
    let bind_addr = SocketAddr::from((bind_ip, 0));
    let socket = match UdpSocket::bind(&bind_addr).await {
        Ok(socket) => socket,
        Err(error) => {
            tracing::error!("[Discover] Failed to bind UDP socket: {:?}", error);
            return Vec::new();
        }
    };

    if let Err(error) = socket.set_broadcast(true) {
        tracing::warn!("[Discover] Failed to enable UDP broadcast: {:?}", error);
        return Vec::new();
    }

    let challenge = Uuid::new_v4().to_string();
    let query = serde_json::json!({
        "type": "discover",
        "query": "hvideo_player",
        "protocol_version": DISCOVERY_PROTOCOL_VERSION,
        "challenge": challenge,
    });
    let query_bytes = match serde_json::to_vec(&query) {
        Ok(bytes) => bytes,
        Err(error) => {
            tracing::error!(
                "[Discover] Failed to build player discovery request: {:?}",
                error
            );
            return Vec::new();
        }
    };

    let broadcast_addr = SocketAddr::from((broadcast_ip, udp_port));
    if let Err(error) = socket.send_to(&query_bytes, broadcast_addr).await {
        tracing::warn!(
            "[Discover] Failed to send player discovery request: {:?}",
            error
        );
        return Vec::new();
    }

    let local_ips = crate::net_utils::get_all_local_ips();
    let mut discovered_ips = HashSet::new();
    let mut results = Vec::new();
    let mut buf = [0u8; 4096];
    let deadline = tokio::time::sleep(Duration::from_secs(timeout_secs));
    tokio::pin!(deadline);

    loop {
        tokio::select! {
            _ = &mut deadline => break,
            recv = socket.recv_from(&mut buf) => {
                let Ok((len, source)) = recv else {
                    continue;
                };
                let source_ip = source.ip().to_string();
                if local_ips.contains(&source_ip) || discovered_ips.contains(&source_ip) {
                    continue;
                }

                let Ok(response) = serde_json::from_slice::<DiscoverResponse>(&buf[..len]) else {
                    continue;
                };
                if response.challenge.as_deref() != Some(challenge.as_str()) {
                    continue;
                }

                let Some(payload) = response.into_payload(source_ip.clone()) else {
                    tracing::debug!("[Discover] Ignored response without valid player identity: {}", source_ip);
                    continue;
                };

                discovered_ips.insert(source_ip);
                tracing::info!(
                    "[Discover] Player handshake succeeded: {} ({})",
                    payload.device_name,
                    payload.ip
                );
                results.push(payload);
            }
        }
    }

    results
}

/// Verify a manually entered IP with the same UDP challenge-response used by scanning.
pub async fn verify_player(
    ip: &str,
    udp_port: u16,
    bind_ip: Ipv4Addr,
) -> AppResult<DiscoverPayload> {
    let parsed_ip = ip
        .parse::<std::net::Ipv4Addr>()
        .map_err(|_| AppError::BadRequest(format!("Invalid terminal IPv4 address: {}", ip)))?;
    if crate::net_utils::is_local_ip(ip) {
        return Err(AppError::BadRequest(format!(
            "The server local IP ({}) cannot be registered as a player terminal",
            ip
        )));
    }

    let socket = UdpSocket::bind(SocketAddr::from((bind_ip, 0)))
        .await
        .map_err(|error| {
            AppError::Internal(anyhow::anyhow!(
                "failed to bind player verification socket: {}",
                error
            ))
        })?;
    let challenge = Uuid::new_v4().to_string();
    let query = serde_json::json!({
        "type": "discover",
        "query": "hvideo_player",
        "protocol_version": DISCOVERY_PROTOCOL_VERSION,
        "challenge": challenge,
    });
    let query_bytes =
        serde_json::to_vec(&query).map_err(|error| AppError::Internal(error.into()))?;
    let target = SocketAddr::from((parsed_ip, udp_port));
    socket
        .send_to(&query_bytes, target)
        .await
        .map_err(|error| {
            AppError::BadRequest(format!(
                "Failed to contact HSVJ Player at {}: {}",
                ip, error
            ))
        })?;

    let mut buf = [0u8; 4096];
    let receive = tokio::time::timeout(Duration::from_secs(3), socket.recv_from(&mut buf))
        .await
        .map_err(|_| {
            AppError::BadRequest(format!(
                "{} did not answer the HSVJ Player identity challenge",
                ip
            ))
        })?
        .map_err(|error| {
            AppError::BadRequest(format!(
                "Failed to receive player response from {}: {}",
                ip, error
            ))
        })?;
    let (len, source) = receive;
    if source.ip() != std::net::IpAddr::V4(parsed_ip) {
        return Err(AppError::BadRequest(format!(
            "Player identity response came from an unexpected IP: {}",
            source.ip()
        )));
    }

    let response = serde_json::from_slice::<DiscoverResponse>(&buf[..len])
        .map_err(|_| AppError::BadRequest(format!("{} returned an invalid player protocol", ip)))?;
    if response.challenge.as_deref() != Some(challenge.as_str()) {
        return Err(AppError::BadRequest(format!(
            "{} returned a mismatched player challenge",
            ip
        )));
    }

    response.into_payload(ip.to_string()).ok_or_else(|| {
        AppError::BadRequest(format!("{} failed HSVJ Player identity verification", ip))
    })
}

/// Persist a player that already passed the discovery protocol check.
pub async fn register_verified_player(
    pool: &SqlitePool,
    payload: &DiscoverPayload,
    terminal_limit: u32,
) -> AppResult<TerminalRegistration> {
    if !is_supported_player_model(payload.model.as_deref()) {
        return Err(AppError::BadRequest(format!(
            "Unsupported terminal model: {}",
            payload.model.as_deref().unwrap_or("unknown")
        )));
    }

    let hardware_info =
        serde_json::to_string(payload).map_err(|error| AppError::Internal(error.into()))?;
    let registration = TerminalService::register(
        pool,
        RegisterTerminalRequest {
            name: Some(payload.device_name.clone()),
            terminalIp: payload.ip.clone(),
            macAddress: payload.mac.clone(),
            serial: payload.serial.clone().unwrap_or_default(),
            network: payload.network.clone(),
            port: Some(payload.ports.http as i32),
            deviceType: Some("ktv".to_string()),
            hardwareInfo: Some(hardware_info),
            softwareVer: Some(payload.version.clone()),
        },
        terminal_limit,
    )
    .await?;

    RoomService::auto_create_for_terminal(
        pool,
        &registration.terminal.id,
        &registration.terminal.name,
    )
    .await?;
    Ok(registration)
}

/// Receive player beacons as online heartbeats.
/// The server no longer broadcasts device beacons, so servers cannot be mistaken for players.
pub(crate) fn run(socket: UdpSocket, state: crate::AppState) {
    tokio::spawn(async move {
        tracing::info!(
            "[Discover] Player heartbeat listener started on {:?}",
            socket.local_addr()
        );

        let local_ips = crate::net_utils::get_all_local_ips();
        let mut buf = [0u8; 4096];
        loop {
            let Ok((len, source)) = socket.recv_from(&mut buf).await else {
                continue;
            };
            if let Some(reply) = handle_player_beacon(&buf[..len], source, &state, &local_ips).await
            {
                if let Err(error) = socket.send_to(&reply, source).await {
                    tracing::debug!("[Discover] Server offer reply failed: {}", error);
                }
            }
        }
    });
}

async fn handle_player_beacon(
    data: &[u8],
    source: SocketAddr,
    state: &crate::AppState,
    local_ips: &HashSet<String>,
) -> Option<Vec<u8>> {
    let source_ip = source.ip().to_string();
    if local_ips.contains(&source_ip) {
        return None;
    }

    let Ok(response) = serde_json::from_slice::<DiscoverResponse>(data) else {
        return None;
    };
    let Some(payload) = response.into_payload(source_ip.clone()) else {
        return None;
    };

    let Ok(terminal_limit) = state.license.terminal_limit() else {
        return None;
    };

    match register_verified_player(&state.db, &payload, terminal_limit).await {
        Ok(registration) => {
            state.sync_terminal_registration(&registration).await;
            Some(server_online_offer(
                &registration.terminal.serial,
                state.config.server.port,
            ))
        }
        Err(error) => {
            tracing::error!(
                "[Discover] Failed to register verified player {}: {:?}",
                source_ip,
                error
            );
            None
        }
    }
}

/// Unicast to the actual beacon sender; players use the UDP source address.
/// This is a discovery hint. HTTP admission still validates the server license.
fn server_online_offer(serial: &str, port: u16) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "type": "hvideo_server",
        "protocol": "online_vod",
        "protocol_version": DISCOVERY_PROTOCOL_VERSION,
        "device_role": "server",
        "app_id": "com.hvideo.server",
        "terminalSerial": serial,
        "serverPort": port,
        "switchToOnlineVod": true,
    }))
    .expect("static server offer is serializable")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn online_offer_identifies_server_and_target_without_spoofable_host() {
        let value: serde_json::Value =
            serde_json::from_slice(&server_online_offer("SN-001", 9898)).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "type":"hvideo_server", "protocol":"online_vod", "protocol_version":"2.0",
                "device_role":"server", "app_id":"com.hvideo.server",
                "terminalSerial":"SN-001", "serverPort":9898, "switchToOnlineVod":true
            })
        );
        let response: DiscoverResponse = serde_json::from_value(value).unwrap();
        assert!(!response.is_player());
    }

    fn valid_response() -> DiscoverResponse {
        DiscoverResponse {
            msg_type: Some("hvideo".to_string()),
            protocol: Some("discover".to_string()),
            protocol_version: Some(DISCOVERY_PROTOCOL_VERSION.to_string()),
            device_role: Some(PLAYER_DEVICE_ROLE.to_string()),
            app_id: Some(PLAYER_APP_ID.to_string()),
            challenge: Some("challenge".to_string()),
            _ip: Some("192.168.1.20".to_string()),
            device_name: Some("player".to_string()),
            version: "1.0".to_string(),
            mac: Some("00:11:22:33:44:55".to_string()),
            serial: Some("serial".to_string()),
            network: None,
            model: Some("H6_POR".to_string()),
            ports: DiscoverPorts {
                http: 8080,
                mobile: 8081,
                vod: 9898,
                ws: 9898,
                tcp: 9000,
                udp: 8000,
                sync: 4322,
            },
        }
    }

    #[test]
    fn accepts_exact_player_identity() {
        assert!(valid_response().is_player());
    }

    #[test]
    fn accepts_h6_series_models_only() {
        assert!(is_supported_player_model(Some("H6_POR")));
        assert!(is_supported_player_model(Some("H6-PLUS")));
        assert!(is_supported_player_model(Some("h6_custom")));
        assert!(!is_supported_player_model(Some("H66_POR")));
        assert!(!is_supported_player_model(Some("rk3566_r")));
        assert!(!is_supported_player_model(Some("H5_POR")));
        assert!(!is_supported_player_model(Some("AH6_POR")));
        assert!(!is_supported_player_model(Some("")));
        assert!(!is_supported_player_model(None));
    }

    #[tokio::test]
    async fn rejects_non_h6_model_before_database_registration() {
        let db = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create test database");
        let mut response = valid_response();
        response.model = Some("rk3566_r".to_string());
        let payload = response
            .into_payload("192.168.1.107".to_string())
            .expect("valid discovery protocol");

        let result = register_verified_player(&db, &payload, 10).await;
        assert!(matches!(
            result,
            Err(AppError::BadRequest(message)) if message.contains("rk3566_r")
        ));
    }

    #[test]
    fn rejects_server_beacon_without_player_identity() {
        let mut response = valid_response();
        response.device_role = None;
        response.app_id = None;
        response.protocol_version = None;
        assert!(!response.is_player());
    }

    #[test]
    fn source_ip_overrides_untrusted_payload_ip() {
        let payload = valid_response()
            .into_payload("192.168.1.99".to_string())
            .expect("valid player");
        assert_eq!(payload.ip, "192.168.1.99");
    }
}
