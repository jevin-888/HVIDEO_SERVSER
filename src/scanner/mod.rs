pub mod database_matcher;
pub mod duplicate_handler;
pub mod file_scanner;
pub mod id_extractor;
pub mod progress_reporter;

use std::net::Ipv4Addr;
use std::time::Duration;

use crate::config::ScannerConfig;
use crate::discover;
use crate::models::terminal::DiscoveredDevice;

/// Periodic player discovery; open ports are never treated as player identity.
pub struct LanScanner {
    udp_port: u16,
    bind_ip: Ipv4Addr,
    broadcast_ip: Ipv4Addr,
}

impl LanScanner {
    pub fn new(udp_port: u16, bind_ip: Ipv4Addr, broadcast_ip: Ipv4Addr) -> Self {
        Self {
            udp_port,
            bind_ip,
            broadcast_ip,
        }
    }

    pub async fn scan_and_register(&self, state: &crate::AppState) -> Vec<DiscoveredDevice> {
        let Ok(terminal_limit) = state.license.terminal_limit() else {
            return Vec::new();
        };
        let players =
            discover::discover_devices(self.udp_port, 3, self.bind_ip, self.broadcast_ip).await;
        let mut devices = Vec::with_capacity(players.len());

        for player in players {
            match discover::register_verified_player(&state.db, &player, terminal_limit).await {
                Ok(registration) => {
                    state.sync_terminal_registration(&registration).await;
                    let terminal = registration.terminal;
                    devices.push(DiscoveredDevice {
                        terminalIp: player.ip.clone(),
                        port: player.ports.http as i32,
                        isRegistered: true,
                        terminalId: Some(terminal.id),
                        deviceInfo: Some(serde_json::to_string(&player).unwrap_or_default()),
                    });
                }
                Err(error) => {
                    tracing::error!(
                        "Failed to register verified player {}: {:?}",
                        player.ip,
                        error
                    );
                }
            }
        }

        if !devices.is_empty() {
            tracing::info!("Player discovery verified {} devices", devices.len());
        }
        devices
    }

    pub fn start_periodic_scan(
        config: ScannerConfig,
        udp_port: u16,
        bind_ip: Ipv4Addr,
        broadcast_ip: Ipv4Addr,
        state: crate::AppState,
    ) {
        let interval = Duration::from_secs(config.interval_secs);
        let scanner = LanScanner::new(udp_port, bind_ip, broadcast_ip);

        tokio::spawn(async move {
            let mut interval_timer = tokio::time::interval(interval);
            loop {
                interval_timer.tick().await;
                tracing::trace!("Running periodic player handshake discovery");
                scanner.scan_and_register(&state).await;
            }
        });
    }
}
