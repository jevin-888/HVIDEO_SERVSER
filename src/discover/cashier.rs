use std::net::SocketAddr;
use tokio::net::UdpSocket;

pub const DISCOVERY_PORT: u16 = 18081;

/// Only returns a public endpoint hint. No database, license admission or player
/// registration occurs here. The cashier validates HTTP before allowing login.
fn reply(data: &[u8], http_port: u16) -> Option<Vec<u8>> {
    if data.len() > 1024 || http_port == 0 {
        return None;
    }
    let query: serde_json::Value = serde_json::from_slice(data).ok()?;
    if query["type"] != "hvideo_cashier"
        || query["protocol"] != "discover"
        || query["protocol_version"] != "1.0"
    {
        return None;
    }
    let request_id = query["requestId"].as_str()?;
    if request_id.len() != 32 || !request_id.bytes().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    serde_json::to_vec(&serde_json::json!({
        "type": "hvideo_server",
        "protocol": "cashier_discover",
        "protocol_version": "1.0",
        "device_role": "server",
        "app_id": "com.hvideo.server",
        "requestId": request_id,
        "serverPort": http_port,
    }))
    .ok()
}

async fn serve(receiver: UdpSocket, sender: UdpSocket, http_port: u16) {
    let mut buffer = [0u8; 4096];
    loop {
        let (length, source) = match receiver.recv_from(&mut buffer).await {
            Ok(packet) => packet,
            Err(error) => {
                tracing::warn!("[CashierDiscover] Receive failed: {}", error);
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                continue;
            }
        };
        let SocketAddr::V4(source_v4) = source else {
            continue;
        };
        if source_v4.port() == 0
            || source_v4.ip().is_unspecified()
            || source_v4.ip().is_multicast()
            || source_v4.ip().is_broadcast()
        {
            continue;
        }
        if let Some(response) = reply(&buffer[..length], http_port) {
            // Reply from the selected HTTP interface, never a virtual/default
            // interface. The client trusts the UDP source IP, not a JSON host.
            if let Err(error) = sender.send_to(&response, source).await {
                tracing::debug!("[CashierDiscover] Reply failed: {}", error);
            }
        }
    }
}

pub(crate) fn run(receiver: UdpSocket, sender: UdpSocket, http_port: u16) {
    tokio::spawn(async move {
        tracing::info!(
            "[CashierDiscover] Listening on {:?}, replies from {:?}, HTTP port {}",
            receiver.local_addr(),
            sender.local_addr(),
            http_port
        );
        serve(receiver, sender, http_port).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;
    fn query() -> serde_json::Value {
        serde_json::json!({"type":"hvideo_cashier", "protocol":"discover",
            "protocol_version":"1.0", "requestId":"0123456789abcdef0123456789abcdef"})
    }

    #[test]
    fn strict_cashier_contract_returns_actual_port_without_host_or_player_command() {
        let response = reply(&serde_json::to_vec(&query()).unwrap(), 9988).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&response).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"type":"hvideo_server",
            "protocol":"cashier_discover", "protocol_version":"1.0",
            "device_role":"server", "app_id":"com.hvideo.server",
            "requestId":"0123456789abcdef0123456789abcdef", "serverPort":9988})
        );
        let player: super::super::DiscoverResponse = serde_json::from_value(value).unwrap();
        assert!(!player.is_player());
    }

    #[test]
    fn rejects_invalid_queries_and_zero_port() {
        for (field, value) in [
            ("type", serde_json::json!("discover")),
            ("protocol", serde_json::json!("online_vod")),
            ("protocol_version", serde_json::json!("2.0")),
            ("requestId", serde_json::Value::Null),
            ("requestId", serde_json::json!("")),
            ("requestId", serde_json::json!("x".repeat(32))),
            ("requestId", serde_json::json!("a".repeat(129))),
        ] {
            let mut invalid = query();
            invalid[field] = value;
            assert!(reply(&serde_json::to_vec(&invalid).unwrap(), 9898).is_none());
        }
        assert!(reply(b"not json", 9898).is_none());
        assert!(reply(&[b'a'; 1025], 9898).is_none());
        assert!(reply(&serde_json::to_vec(&query()).unwrap(), 0).is_none());
    }

    #[tokio::test]
    async fn udp_request_reply_uses_sender_ip_and_client_ephemeral_port() {
        let receiver = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let endpoint = receiver.local_addr().unwrap();
        let sender = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let source = sender.local_addr().unwrap();
        let worker = tokio::spawn(serve(receiver, sender, 9988));
        let client = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        client
            .send_to(&serde_json::to_vec(&query()).unwrap(), endpoint)
            .await
            .unwrap();
        let mut buffer = [0u8; 4096];
        let (length, from) = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            client.recv_from(&mut buffer),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(from, source);
        let value: serde_json::Value = serde_json::from_slice(&buffer[..length]).unwrap();
        assert_eq!(value["requestId"], query()["requestId"]);
        assert_eq!(value["serverPort"], 9988);
        worker.abort();
        let _ = worker.await;
    }
}
