use serde::{Deserialize, Serialize};

/// Terminal database model.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Terminal {
    pub id: String,
    pub name: String,
    /// Empty when this device's expired primary IP was reassigned to another player.
    pub terminalIp: String,
    pub macAddress: String,
    #[sqlx(default)]
    pub serial: String,
    #[sqlx(skip)]
    #[serde(default)]
    pub connections: Vec<TerminalConnection>,
    pub port: i32,
    pub deviceType: String,
    pub roomId: String,
    pub onlineStatus: i32,
    pub lastHeartbeat: String,
    pub hardwareInfo: String,
    pub softwareVer: String,
    pub createdAt: String,
    pub updatedAt: String,
}

/// One observed network connection of a physical player. IP comes from the peer.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TerminalConnection {
    pub terminalId: String,
    pub networkType: String,
    pub interfaceName: String,
    pub ipAddress: String,
    pub macAddress: String,
    pub port: i32,
    pub onlineStatus: i32,
    pub lastHeartbeat: String,
    pub createdAt: String,
    pub updatedAt: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalNetworkType {
    Ethernet,
    Wifi,
}

impl TerminalNetworkType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ethernet => "ethernet",
            Self::Wifi => "wifi",
        }
    }
}

/// This object has the same camelCase fields in HTTP admission and UDP discovery.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalNetworkReport {
    pub network_type: TerminalNetworkType,
    pub interface_name: String,
    pub mac_address: String,
}

/// Manual registration verifies the claimed serial against the player handshake.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterPlayerTerminalRequest {
    pub terminalIp: String,
    pub serial: String,
}

/// Internal registration request for an already verified player.
#[derive(Debug, Clone, Deserialize)]
pub struct RegisterTerminalRequest {
    pub name: Option<String>,
    pub terminalIp: String,
    pub macAddress: Option<String>,
    pub serial: String,
    pub network: Option<TerminalNetworkReport>,
    pub port: Option<i32>,
    pub deviceType: Option<String>,
    pub hardwareInfo: Option<String>,
    pub softwareVer: Option<String>,
}

/// Online VOD player admission request. The peer IP is taken from ConnectInfo,
/// so the client cannot claim a different terminal address in the payload.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalAdmissionRequest {
    pub protocol_version: String,
    pub device_role: String,
    pub app_id: String,
    #[serde(default)]
    pub device_name: Option<String>,
    pub mac_address: String,
    pub serial: String,
    /// Older v2 players omit this field. Their connection remains unclassified.
    #[serde(default)]
    pub network: Option<TerminalNetworkReport>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub software_version: Option<String>,
    #[serde(default)]
    pub http_port: Option<u16>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAdmission {
    pub authorized: bool,
    /// Explicit mode instruction; discovery alone never grants playback rights.
    pub switch_to_online_vod: bool,
    pub terminal_id: String,
    pub terminal_limit: u32,
    pub registered_terminals: u32,
    pub remaining_points: u32,
    pub expires_at: i64,
    pub server_time: i64,
    pub contract_version: u32,
    pub issued_at: i64,
    pub permanent: bool,
    pub customer_name: String,
    /// Exact signed license object; field names match local license.dat.
    pub license: crate::player_license::PlayerLicense,
}

/// Terminal update request.
#[derive(Debug, Deserialize)]
pub struct UpdateTerminalRequest {
    pub name: Option<String>,
    pub port: Option<i32>,
    pub deviceType: Option<String>,
    pub roomId: Option<String>,
}

/// Device returned by the verified player discovery API.
#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredDevice {
    pub terminalIp: String,
    pub port: i32,
    pub isRegistered: bool,
    pub terminalId: Option<String>,
    pub deviceInfo: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{RegisterPlayerTerminalRequest, TerminalAdmissionRequest, TerminalNetworkReport};

    #[test]
    fn admission_requires_serial_and_uses_one_network_shape() {
        let mut value = serde_json::json!({
            "protocolVersion":"2.0", "deviceRole":"player", "appId":"com.hsvj.engine",
            "macAddress":"D6:AB:AA:8A:53:7F", "serial":"279F4F6D53F8FEBE", "model":"H6_POR"
        });
        assert!(serde_json::from_value::<TerminalAdmissionRequest>(value.clone()).is_ok());
        value.as_object_mut().unwrap().remove("serial");
        assert!(serde_json::from_value::<TerminalAdmissionRequest>(value).is_err());
        let network = serde_json::json!({"networkType":"wifi", "interfaceName":"wlan0", "macAddress":"84:93:EC:D5:73:A5"});
        let report: TerminalNetworkReport = serde_json::from_value(network.clone()).unwrap();
        assert_eq!(serde_json::to_value(report).unwrap(), network);
        let mut unknown = network;
        unknown["ip"] = "192.0.2.10".into();
        assert!(serde_json::from_value::<TerminalNetworkReport>(unknown).is_err());
    }

    #[test]
    fn player_registration_requires_ip_and_serial() {
        let request: RegisterPlayerTerminalRequest =
            serde_json::from_str(r#"{"terminalIp":"192.168.1.100","serial":"279f4f6d53f8febe"}"#)
                .unwrap();
        assert_eq!(request.terminalIp, "192.168.1.100");

        assert!(serde_json::from_str::<RegisterPlayerTerminalRequest>(
            r#"{"terminalIp":"192.168.1.100","serial":"279f4f6d53f8febe","name":"spoofed"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<RegisterPlayerTerminalRequest>(
            r#"{"terminalIp":"192.168.1.100"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<RegisterPlayerTerminalRequest>(
            r#"{"terminal_ip":"192.168.1.100"}"#
        )
        .is_err());
    }
}
