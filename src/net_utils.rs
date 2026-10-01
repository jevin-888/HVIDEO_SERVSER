use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr};

/// Reserve every fixed service port before database initialization or background work.
/// On failure, already-bound sockets are dropped, so retry needs no system reboot.
pub(crate) struct ServerSockets {
    pub http: tokio::net::TcpListener,
    pub player: tokio::net::UdpSocket,
    pub cashier_receiver: tokio::net::UdpSocket,
    pub cashier_sender: tokio::net::UdpSocket,
}

impl ServerSockets {
    pub async fn bind(ip: Ipv4Addr, http: u16, player: u16, cashier: u16) -> anyhow::Result<Self> {
        let http = bind_exclusive_tcp(ip, http)
            .map_err(|error| bind_error("HTTP/TCP", ip, http, error))?;
        let player = bind_exclusive_udp(ip, player)
            .map_err(|error| bind_error("播放器发现/UDP", ip, player, error))?;
        let cashier_receiver = bind_exclusive_udp(Ipv4Addr::UNSPECIFIED, cashier)
            .map_err(|error| bind_error("收银发现/UDP", Ipv4Addr::UNSPECIFIED, cashier, error))?;
        let cashier_sender = tokio::net::UdpSocket::bind((ip, 0))
            .await
            .map_err(|error| bind_error("收银回复/UDP", ip, 0, error))?;
        Ok(Self {
            http,
            player,
            cashier_receiver,
            cashier_sender,
        })
    }
}

fn exclusive_ipv4_socket(
    kind: socket2::Type,
    protocol: socket2::Protocol,
) -> std::io::Result<socket2::Socket> {
    let socket = socket2::Socket::new(socket2::Domain::IPV4, kind, Some(protocol))?;
    // Windows otherwise permits wildcard/specific UDP bindings to overlap under
    // the same account. Set exclusivity before bind, not after the port is taken.
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawSocket;
        #[link(name = "ws2_32")]
        extern "system" {
            fn setsockopt(
                socket: usize,
                level: i32,
                option: i32,
                value: *const u8,
                length: i32,
            ) -> i32;
            fn WSAGetLastError() -> i32;
        }
        const SOL_SOCKET: i32 = 0xffff;
        const SO_EXCLUSIVEADDRUSE: i32 = !0x0004;
        let enabled = 1_i32;
        if unsafe {
            setsockopt(
                socket.as_raw_socket() as usize,
                SOL_SOCKET,
                SO_EXCLUSIVEADDRUSE,
                (&enabled as *const i32).cast(),
                std::mem::size_of_val(&enabled) as i32,
            )
        } != 0
        {
            return Err(std::io::Error::from_raw_os_error(unsafe {
                WSAGetLastError()
            }));
        }
    }
    socket.set_nonblocking(true)?;
    Ok(socket)
}

fn bind_exclusive_tcp(ip: Ipv4Addr, port: u16) -> std::io::Result<tokio::net::TcpListener> {
    check_windows_port_available(ip, port, socket2::Type::STREAM, socket2::Protocol::TCP)?;
    let socket = exclusive_ipv4_socket(socket2::Type::STREAM, socket2::Protocol::TCP)?;
    #[cfg(not(windows))]
    socket.set_reuse_address(true)?;
    socket.bind(&std::net::SocketAddr::from((ip, port)).into())?;
    socket.listen(1024)?;
    tokio::net::TcpListener::from_std(socket.into())
}

fn bind_exclusive_udp(ip: Ipv4Addr, port: u16) -> std::io::Result<tokio::net::UdpSocket> {
    check_windows_port_available(ip, port, socket2::Type::DGRAM, socket2::Protocol::UDP)?;
    let socket = exclusive_ipv4_socket(socket2::Type::DGRAM, socket2::Protocol::UDP)?;
    socket.bind(&std::net::SocketAddr::from((ip, port)).into())?;
    tokio::net::UdpSocket::from_std(socket.into())
}

fn check_windows_port_available(
    ip: Ipv4Addr,
    port: u16,
    kind: socket2::Type,
    protocol: socket2::Protocol,
) -> std::io::Result<()> {
    // An older/non-exclusive wildcard listener on Windows can coexist with a
    // later exclusive concrete-IP socket. Probe wildcard conflicts first, then
    // retain the real exclusive socket on the selected interface. The probe
    // never listens or receives traffic; actual bind errors remain authoritative.
    #[cfg(windows)]
    if !ip.is_unspecified() && port != 0 {
        let probe = exclusive_ipv4_socket(kind, protocol)?;
        probe.bind(&std::net::SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)).into())?;
    }
    #[cfg(not(windows))]
    let _ = (ip, port, kind, protocol);
    Ok(())
}

fn bind_error(protocol: &str, ip: Ipv4Addr, port: u16, error: std::io::Error) -> anyhow::Error {
    let hint = match error.kind() {
        std::io::ErrorKind::AddrInUse => {
            "端口已被占用，请退出已运行的服务器或占用程序后点击重试，无需重启电脑"
        }
        std::io::ErrorKind::AddrNotAvailable => {
            "网卡地址当前不可用，请连接网络后刷新网卡并重新选择"
        }
        std::io::ErrorKind::PermissionDenied => {
            "端口访问被系统拒绝，请检查端口占用、系统保留端口和安全软件"
        }
        _ => "请查看系统错误，处理后点击重试",
    };
    anyhow::anyhow!("{protocol} {ip}:{port} 监听失败：{hint}（{error}）")
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LocalInterface {
    pub name: String,
    pub ip: String,
    pub mac: Option<String>,
}

/// 获取本机所有非回环网卡的 IP 地址及接口名称
/// physical_only: 是否只显示真实物理网卡
pub fn get_local_interfaces(physical_only: bool) -> Vec<LocalInterface> {
    let mut interfaces = Vec::new();
    let mut seen_ips = HashSet::new();

    let exclude_keywords = [
        "virtual",
        "vmware",
        "virtualbox",
        "vbox",
        "hyper-v",
        "vethernet",
        "vpn",
        "tunnel",
        "tap",
        "pseudo",
        "bridge",
        "loopback",
        "bluetooth",
        "pseudo",
        "software",
    ];

    #[cfg(windows)]
    {
        if let Ok(adapters) = ipconfig::get_adapters() {
            for (idx, adapter) in adapters.into_iter().enumerate() {
                let name = adapter.friendly_name().to_string();
                let desc = adapter.description().to_string();

                if physical_only {
                    let name_lower = name.to_lowercase();
                    let desc_lower = desc.to_lowercase();
                    if exclude_keywords
                        .iter()
                        .any(|&k| name_lower.contains(k) || desc_lower.contains(k))
                    {
                        continue;
                    }
                }

                let display_name = if name.is_empty() {
                    format!("网卡 {}", idx + 1)
                } else {
                    name.clone()
                };
                let mac = adapter.physical_address().and_then(format_mac);
                for addr in adapter.ip_addresses() {
                    if addr.is_ipv4() && !addr.is_loopback() {
                        let ip = addr.to_string();
                        if physical_only && !is_usable_server_ipv4(&ip) {
                            continue;
                        }
                        if seen_ips.insert(ip.clone()) {
                            interfaces.push(LocalInterface {
                                name: display_name.clone(),
                                ip,
                                mac: mac.clone(),
                            });
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(ifas) = local_ip_address::list_afinet_netifas() {
            for (name, ip) in ifas {
                if ip.is_ipv4() && !ip.is_loopback() {
                    if physical_only {
                        let name_lower = name.to_lowercase();
                        if exclude_keywords.iter().any(|&k| name_lower.contains(k)) {
                            continue;
                        }
                        let is_physical = name_lower.starts_with("eth")
                            || name_lower.starts_with("en")
                            || name_lower.starts_with("em")
                            || name_lower.starts_with("wl");
                        if !is_physical {
                            continue;
                        }
                    }
                    let ip_str = ip.to_string();
                    if physical_only && !is_usable_server_ipv4(&ip_str) {
                        continue;
                    }
                    if seen_ips.insert(ip_str.clone()) {
                        interfaces.push(LocalInterface {
                            name,
                            ip: ip_str,
                            mac: None,
                        });
                    }
                }
            }
        }
    }

    interfaces
}

#[cfg(windows)]
fn format_mac(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    Some(
        bytes
            .iter()
            .map(|b| format!("{:02X}", b))
            .collect::<Vec<_>>()
            .join(":"),
    )
}

/// 获取本机所有非回环网卡的 IP 地址已去重集合
pub fn get_all_local_ips() -> HashSet<String> {
    let mut ips = HashSet::new();
    // 获取所有网卡（包括虚拟和无线），用于内部过滤
    for interface in get_local_interfaces(false) {
        ips.insert(interface.ip);
    }

    // 补充常用特殊地址
    ips.insert("127.0.0.1".to_string());
    ips.insert("0.0.0.0".to_string());
    ips.insert("localhost".to_string());

    ips
}

/// 判断给定的 IP 是否为本机 IP
pub fn is_local_ip(ip: &str) -> bool {
    let local_ips = get_all_local_ips();
    local_ips.contains(ip)
}

pub fn is_usable_server_ipv4(ip: &str) -> bool {
    match ip.parse::<Ipv4Addr>() {
        Ok(addr) => {
            !addr.is_loopback()
                && !addr.is_link_local()
                && !addr.is_unspecified()
                && !addr.is_multicast()
                && !addr.is_broadcast()
        }
        Err(_) => false,
    }
}

/// Validate the single IPv4 address selected for all server networking.
///
/// `server.host` identifies the exact local interface used by HTTP/WebSocket,
/// discovery, verification and heartbeat traffic. It is not a wildcard bind.
pub fn validate_configured_server_ipv4(host: &str) -> anyhow::Result<Ipv4Addr> {
    let host = host.trim();
    let ip = host
        .parse::<Ipv4Addr>()
        .map_err(|_| anyhow::anyhow!("server.host must be a valid IPv4 address: {}", host))?;

    if !is_usable_server_ipv4(host) {
        anyhow::bail!(
            "server.host must select a concrete, usable local IPv4 address; wildcard/loopback/link-local addresses are not allowed: {}",
            host
        );
    }

    if !get_local_interfaces(false)
        .iter()
        .any(|interface| interface.ip == host)
    {
        anyhow::bail!(
            "server.host {} is not assigned to any local network interface",
            host
        );
    }

    Ok(ip)
}

/// Resolve the configured server interface.
///
/// Release builds stay strict so every network-facing service uses the explicitly
/// configured interface. Development builds may opt into a physical-interface
/// fallback, allowing `cargo run` to work when the deployment IP is not assigned
/// to the developer machine. Loopback is intentionally never used because player
/// discovery and remote terminal connections require a LAN address.
pub fn resolve_configured_server_ipv4(
    host: &str,
    allow_development_fallback: bool,
) -> anyhow::Result<Ipv4Addr> {
    match validate_configured_server_ipv4(host) {
        Ok(ip) => Ok(ip),
        Err(config_error) if allow_development_fallback => {
            let fallback = choose_development_server_ipv4(&get_local_interfaces(true))
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "{}; no usable physical IPv4 interface is available for development fallback",
                        config_error
                    )
                })?;
            tracing::warn!(
                "configured server.host {} is unavailable in development; using local interface {}",
                host.trim(),
                fallback
            );
            Ok(fallback)
        }
        Err(error) => Err(error),
    }
}

fn choose_development_server_ipv4(interfaces: &[LocalInterface]) -> Option<Ipv4Addr> {
    let mut candidates: Vec<Ipv4Addr> = interfaces
        .iter()
        .filter_map(|interface| interface.ip.parse::<Ipv4Addr>().ok())
        .filter(|ip| is_usable_server_ipv4(&ip.to_string()))
        .collect();
    candidates.sort_unstable_by_key(|ip| (!ip.is_private(), u32::from(*ip)));
    candidates.into_iter().next()
}

/// Resolve the directed broadcast address for the configured local IPv4.
/// No default-interface fallback is allowed on a multi-homed server.
pub fn configured_broadcast_ipv4(host: Ipv4Addr) -> anyhow::Result<Ipv4Addr> {
    #[cfg(windows)]
    {
        let adapters = ipconfig::get_adapters()
            .map_err(|error| anyhow::anyhow!("failed to enumerate network adapters: {}", error))?;

        for adapter in adapters {
            if !adapter.ip_addresses().contains(&IpAddr::V4(host)) {
                continue;
            }

            if let Some((_, prefix_len)) = adapter.prefixes().iter().find(|(network, prefix)| {
                matches!(network, IpAddr::V4(network) if ipv4_in_prefix(host, *network, *prefix))
            }) {
                return directed_broadcast(host, *prefix_len);
            }
        }

        anyhow::bail!(
            "cannot determine IPv4 subnet prefix for configured server.host {}",
            host
        );
    }

    #[cfg(not(windows))]
    {
        #[cfg(target_os = "linux")]
        {
            use std::process::Command;

            // `ip -o -4 addr` is available on supported Linux server images and
            // exposes the prefix needed for a directed broadcast without adding
            // a libc/ioctl dependency to the cross-platform backend.
            let output = Command::new("ip")
                .args(["-o", "-4", "addr", "show"])
                .output()
                .map_err(|error| anyhow::anyhow!("failed to enumerate Linux interfaces: {}", error))?;
            if !output.status.success() {
                anyhow::bail!("Linux ip command failed with status {}", output.status);
            }
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let fields: Vec<_> = line.split_whitespace().collect();
                let Some(index) = fields.iter().position(|field| *field == "inet") else {
                    continue;
                };
                let Some(address) = fields.get(index + 1) else {
                    continue;
                };
                let Some((address, prefix)) = address.split_once('/') else {
                    continue;
                };
                if address.parse::<Ipv4Addr>().ok() == Some(host) {
                    let prefix_len = prefix.parse::<u32>().map_err(|_| {
                        anyhow::anyhow!("invalid IPv4 prefix for configured server.host {}", host)
                    })?;
                    return directed_broadcast(host, prefix_len);
                }
            }
            anyhow::bail!(
                "cannot determine IPv4 subnet prefix for configured server.host {}",
                host
            );
        }

        #[cfg(not(target_os = "linux"))]
        anyhow::bail!(
            "cannot determine directed broadcast for configured server.host {} on this platform",
            host
        );
    }
}

fn ipv4_mask(prefix_len: u32) -> anyhow::Result<u32> {
    if prefix_len > 32 {
        anyhow::bail!("invalid IPv4 prefix length: {}", prefix_len);
    }
    Ok(if prefix_len == 0 {
        0
    } else {
        u32::MAX << (32 - prefix_len)
    })
}

fn ipv4_in_prefix(ip: Ipv4Addr, network: Ipv4Addr, prefix_len: u32) -> bool {
    ipv4_mask(prefix_len)
        .map(|mask| (u32::from(ip) & mask) == (u32::from(network) & mask))
        .unwrap_or(false)
}

fn directed_broadcast(ip: Ipv4Addr, prefix_len: u32) -> anyhow::Result<Ipv4Addr> {
    let mask = ipv4_mask(prefix_len)?;
    Ok(Ipv4Addr::from((u32::from(ip) & mask) | !mask))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn occupied_tcp_port_fails_and_retry_releases_every_socket() {
        let ip = Ipv4Addr::LOCALHOST;
        let occupied = tokio::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
            .await
            .unwrap();
        let port = occupied.local_addr().unwrap().port();
        let error = ServerSockets::bind(ip, port, 0, 0)
            .await
            .err()
            .unwrap()
            .to_string();
        assert!(error.contains("HTTP/TCP") && error.contains(&port.to_string()));
        assert!(error.contains("端口"));
        drop(occupied);
        let sockets = ServerSockets::bind(ip, port, 0, 0).await.unwrap();
        let player = sockets.player.local_addr().unwrap().port();
        let cashier = sockets.cashier_receiver.local_addr().unwrap().port();
        let client = tokio::net::TcpStream::connect((ip, port)).await.unwrap();
        let (connection, _) = sockets.http.accept().await.unwrap();
        drop(connection);
        drop(client);
        assert!(tokio::net::TcpListener::bind((ip, port)).await.is_err());
        assert!(tokio::net::UdpSocket::bind((ip, player)).await.is_err());
        assert!(tokio::net::UdpSocket::bind((ip, cashier)).await.is_err());
        drop(sockets);
        for _ in 0..3 {
            let sockets = ServerSockets::bind(ip, port, player, cashier)
                .await
                .unwrap();
            drop(sockets);
        }
    }

    #[tokio::test]
    async fn occupied_udp_ports_fail_startup_and_release_earlier_reservations() {
        let ip = Ipv4Addr::LOCALHOST;
        let http = tokio::net::TcpListener::bind((ip, 0)).await.unwrap();
        let port = http.local_addr().unwrap().port();
        drop(http);
        let occupied = tokio::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
            .await
            .unwrap();
        let udp = occupied.local_addr().unwrap().port();
        for (player, cashier, label) in [(udp, 0, "播放器发现/UDP"), (0, udp, "收银发现/UDP")]
        {
            let error = ServerSockets::bind(ip, port, player, cashier)
                .await
                .err()
                .unwrap()
                .to_string();
            assert!(error.contains(label) && error.contains(&udp.to_string()));
            // A partial startup failure must not strand its already-reserved HTTP port.
            let released = tokio::net::TcpListener::bind((ip, port)).await.unwrap();
            drop(released);
        }
        drop(occupied);
        assert!(ServerSockets::bind(ip, port, udp, 0).await.is_ok());
    }

    #[test]
    fn wildcard_is_not_a_usable_server_interface() {
        assert!(!is_usable_server_ipv4("0.0.0.0"));
    }

    #[test]
    fn directed_broadcast_uses_selected_interface_prefix() {
        assert_eq!(
            directed_broadcast(Ipv4Addr::new(192, 168, 1, 254), 24).unwrap(),
            Ipv4Addr::new(192, 168, 1, 255)
        );
        assert_eq!(
            directed_broadcast(Ipv4Addr::new(10, 20, 31, 7), 20).unwrap(),
            Ipv4Addr::new(10, 20, 31, 255)
        );
    }

    #[test]
    fn configured_host_must_be_assigned_locally() {
        let error = validate_configured_server_ipv4("198.51.100.77").unwrap_err();
        assert!(error.to_string().contains("not assigned"));
    }

    #[test]
    fn development_fallback_prefers_private_physical_ipv4() {
        let interfaces = vec![
            LocalInterface {
                name: "public".to_string(),
                ip: "203.0.113.7".to_string(),
                mac: None,
            },
            LocalInterface {
                name: "lan".to_string(),
                ip: "192.168.1.106".to_string(),
                mac: None,
            },
        ];

        assert_eq!(
            choose_development_server_ipv4(&interfaces),
            Some(Ipv4Addr::new(192, 168, 1, 106))
        );
    }

    #[test]
    fn development_fallback_never_uses_loopback_or_link_local() {
        let interfaces = vec![
            LocalInterface {
                name: "loopback".to_string(),
                ip: "127.0.0.1".to_string(),
                mac: None,
            },
            LocalInterface {
                name: "link-local".to_string(),
                ip: "169.254.10.20".to_string(),
                mac: None,
            },
        ];

        assert_eq!(choose_development_server_ipv4(&interfaces), None);
    }
}
