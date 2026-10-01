use std::sync::Arc;
use std::time::Duration;

use tokio::sync::RwLock;

use crate::models::media::Stream;

#[derive(Debug, Clone, serde::Serialize)]
pub struct IptvStatus {
    pub channel_count: usize,
    pub updatedAt: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone)]
pub struct IptvService {
    state: Arc<RwLock<IptvCache>>,
    client: reqwest::Client,
}

#[derive(Debug, Clone, Default)]
pub struct IptvCache {
    pub channels: Vec<Stream>,
    pub updatedAt: Option<String>,
    pub last_error: Option<String>,
}

impl IptvService {
    const M3U_URL: &'static str =
        "https://raw.githubusercontent.com/zilong7728/Collect-IPTV/refs/heads/main/best_sorted.m3u";

    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            state: Arc::new(RwLock::new(IptvCache::default())),
            client,
        }
    }

    pub fn start_periodic_refresh(&self) {
        let service = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(4 * 60 * 60));
            loop {
                interval.tick().await;
                service.refresh().await;
            }
        });
    }

    pub async fn channels(&self) -> Vec<Stream> {
        self.state.read().await.channels.clone()
    }

    pub async fn status(&self) -> IptvStatus {
        let state = self.state.read().await;
        IptvStatus {
            channel_count: state.channels.len(),
            updatedAt: state.updatedAt.clone(),
            last_error: state.last_error.clone(),
        }
    }

    pub async fn refresh(&self) {
        match self.fetch_channels().await {
            Ok((channels, updatedAt)) => {
                let count = channels.len();
                let mut state = self.state.write().await;
                state.channels = channels;
                state.updatedAt = updatedAt;
                state.last_error = None;
                tracing::info!("IPTV源刷新成功: {} 个频道", count);
            }
            Err(err) => {
                let mut state = self.state.write().await;
                state.last_error = Some(err.clone());
                tracing::warn!("IPTV源刷新失败: {}", err);
            }
        }
    }

    async fn fetch_channels(&self) -> Result<(Vec<Stream>, Option<String>), String> {
        let response = self
            .client
            .get(Self::M3U_URL)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status()));
        }
        let text = response.text().await.map_err(|e| e.to_string())?;
        let updatedAt = parse_generated_time(&text);
        let channels = parse_m3u(&text);
        if channels.is_empty() {
            return Err("empty iptv channel list".to_string());
        }
        Ok((channels, updatedAt))
    }
}

fn parse_generated_time(content: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let line = line.trim();
        line.strip_prefix("# Generated-Time:")
            .map(|value| value.trim().to_string())
    })
}

fn parse_m3u(content: &str) -> Vec<Stream> {
    let mut streams = Vec::new();
    let mut pending_name = String::new();
    let mut pending_logo: Option<String> = None;
    let mut pending_category = String::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("#EXTINF") {
            pending_name = parse_attr(line, "tvg-name")
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| parse_extinf_name(line));
            pending_logo = parse_attr(line, "tvg-logo").filter(|v| !v.is_empty());
            if let Some(category) = parse_attr(line, "group-title") {
                if !category.is_empty() {
                    pending_category = category;
                }
            }
            continue;
        }
        if let Some(category) = line.strip_prefix("#EXTGRP:") {
            pending_category = category.trim().to_string();
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        if !line.starts_with("http://") && !line.starts_with("https://") {
            continue;
        }
        let name = if pending_name.is_empty() {
            format!("直播频道 {}", streams.len() + 1)
        } else {
            pending_name.clone()
        };
        streams.push(Stream {
            id: format!("iptv_{}", streams.len() + 1),
            name,
            url: line.to_string(),
            cover: pending_logo.clone(),
            category: pending_category.clone(),
        });
        pending_name.clear();
        pending_logo = None;
    }

    streams
}

fn parse_extinf_name(line: &str) -> String {
    line.rsplit_once(',')
        .map(|(_, name)| name.trim().to_string())
        .unwrap_or_default()
}

fn parse_attr(line: &str, attr: &str) -> Option<String> {
    let marker = format!("{}=\"", attr);
    let start = line.find(&marker)? + marker.len();
    let rest = &line[start..];
    let end = rest.find('"')?;
    Some(rest[..end].trim().to_string())
}
