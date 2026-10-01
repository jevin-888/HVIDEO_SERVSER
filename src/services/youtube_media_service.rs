use crate::errors::{AppError, AppResult};
use futures::StreamExt;
use reqwest::header::{self, HeaderMap};
use reqwest::StatusCode;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tokio::sync::{Mutex, OnceCell, Semaphore};

const MAX_URLS: usize = 128;

struct StreamAddress {
    url: String,
    expires_at: SystemTime,
}
#[derive(Default)]
struct VideoEntry {
    address: Mutex<Option<StreamAddress>>,
}

pub struct YoutubeMediaService {
    client: reqwest::Client,
    entries: Mutex<HashMap<String, (Instant, Arc<VideoEntry>)>>,
    resolvers: Semaphore,
}

impl YoutubeMediaService {
    pub async fn shared() -> AppResult<&'static Self> {
        static SERVICE: OnceCell<YoutubeMediaService> = OnceCell::const_new();
        SERVICE.get_or_try_init(|| async {
            let client = reqwest::Client::builder()
                .http1_only()
                .no_gzip()
                .connect_timeout(Duration::from_secs(8))
                .read_timeout(Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if attempt.previous().len() >= 5 || !is_allowed_googlevideo_url(attempt.url()) {
                        attempt.stop()
                    } else { attempt.follow() }
                }))
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36")
                .build().map_err(|e| AppError::Internal(e.into()))?;
            Ok(Self::new(client))
        }).await
    }

    fn new(client: reqwest::Client) -> Self {
        Self {
            client,
            entries: Mutex::new(HashMap::new()),
            resolvers: Semaphore::new(2),
        }
    }

    async fn entry(&self, id: &str) -> AppResult<Arc<VideoEntry>> {
        validate_video_id(id)?;
        let mut entries = self.entries.lock().await;
        if !entries.contains_key(id) && entries.len() >= MAX_URLS {
            let oldest = entries
                .iter()
                .filter(|(_, (_, value))| Arc::strong_count(value) == 1)
                .min_by_key(|(_, (used, _))| *used)
                .map(|(key, _)| key.clone());
            if let Some(oldest) = oldest {
                entries.remove(&oldest);
            } else {
                return Err(AppError::BadRequest("YouTube media service is busy".into()));
            }
        }
        let entry = entries
            .entry(id.to_string())
            .or_insert_with(|| (Instant::now(), Arc::new(VideoEntry::default())));
        entry.0 = Instant::now();
        Ok(entry.1.clone())
    }

    pub async fn stream_url(&self, id: &str) -> AppResult<String> {
        self.resolve_with(id, || async {
            let _permit = self
                .resolvers
                .acquire()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
            resolve_stream_url(id).await
        })
        .await
    }

    async fn resolve_with<F, Fut>(&self, id: &str, resolve: F) -> AppResult<String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = AppResult<String>>,
    {
        let entry = self.entry(id).await?;
        let mut address = entry.address.lock().await;
        if let Some(cached) = address
            .as_ref()
            .filter(|v| v.expires_at > SystemTime::now())
        {
            return Ok(cached.url.clone());
        }
        let url = resolve().await?;
        let parsed = validate_googlevideo_url(&url)?;
        let expires_at = address_expiry(&parsed, SystemTime::now());
        *address = Some(StreamAddress {
            url: url.clone(),
            expires_at,
        });
        Ok(url)
    }

    async fn invalidate_address(&self, id: &str, rejected_url: &str) -> AppResult<()> {
        let entry = self.entry(id).await?;
        let mut address = entry.address.lock().await;
        if address
            .as_ref()
            .is_some_and(|value| value.url == rejected_url)
        {
            *address = None;
        }
        Ok(())
    }

    /// Streaming uses cached addresses with expiry and one refresh after a 403.
    pub async fn open_stream(
        &self,
        id: &str,
        method: reqwest::Method,
        headers: &reqwest::header::HeaderMap,
    ) -> AppResult<(reqwest::Url, reqwest::Response)> {
        for attempt in 0..=1 {
            let url = validate_googlevideo_url(&self.stream_url(id).await?)?;
            let mut request = self
                .client
                .request(method.clone(), url.clone())
                .header(reqwest::header::ACCEPT_ENCODING, "identity");
            for name in [reqwest::header::RANGE, reqwest::header::IF_RANGE] {
                if let Some(value) = headers.get(&name) {
                    request = request.header(name, value.clone());
                }
            }
            let response = match request.send().await {
                Ok(response) => response,
                Err(error) if attempt == 0 => {
                    tracing::warn!(
                        "YouTube media connection retry: videoId={}, error={}",
                        id,
                        error.without_url()
                    );
                    continue;
                }
                Err(error) => return Err(AppError::Internal(error.without_url().into())),
            };
            if attempt == 0 && response.status() == reqwest::StatusCode::FORBIDDEN {
                self.invalidate_address(id, url.as_str()).await?;
                continue;
            }
            return Ok((url, response));
        }
        unreachable!("the final attempt returns its response")
    }

    pub fn client(&self) -> reqwest::Client {
        self.client.clone()
    }

    /// Warm only the expiring stream address. Media bytes are fetched on demand
    /// by the stream proxy and are never downloaded into a disk cache.
    pub fn prepare_address(&'static self, id: String) {
        tokio::spawn(async move {
            if let Err(error) = self.stream_url(&id).await {
                tracing::warn!(
                    "YouTube address preparation failed: videoId={}, error={}",
                    id,
                    error
                );
            }
        });
    }
}

const YOUTUBE_STREAM_RESUME_ATTEMPTS: usize = 8;

pub(crate) fn content_range_start(headers: &HeaderMap) -> Option<u64> {
    let value = headers.get(header::CONTENT_RANGE)?.to_str().ok()?;
    let range = value.strip_prefix("bytes ")?.split_once('/')?.0;
    range.split_once('-')?.0.parse().ok()
}

pub(crate) fn resumable_upstream_body(
    client: reqwest::Client,
    upstream_url: reqwest::Url,
    initial_response: reqwest::Response,
    initial_offset: u64,
    expected_len: Option<u64>,
    if_range: Option<axum::http::HeaderValue>,
) -> axum::body::Body {
    let stream: std::pin::Pin<
        Box<dyn futures::Stream<Item = Result<axum::body::Bytes, std::io::Error>> + Send>,
    > = Box::pin(async_stream::try_stream! {
        let mut response = initial_response;
        let mut delivered = 0_u64;
        let mut resume_attempts = 0_usize;
        let expected_end = expected_len
            .and_then(|length| initial_offset.checked_add(length))
            .and_then(|exclusive_end| exclusive_end.checked_sub(1));

        loop {
            let mut body = response.bytes_stream();
            let mut failure = None;
            while let Some(item) = body.next().await {
                match item {
                    Ok(chunk) => {
                        delivered = delivered.saturating_add(chunk.len() as u64);
                        yield chunk;
                    }
                    Err(error) => {
                        failure = Some(error.without_url().to_string());
                        break;
                    }
                }
            }

            if expected_len.is_some_and(|length| delivered >= length) {
                break;
            }
            if expected_len.is_none() && failure.is_none() {
                break;
            }
            if resume_attempts >= YOUTUBE_STREAM_RESUME_ATTEMPTS {
                let reason = failure.as_deref().unwrap_or("upstream ended before Content-Length");
                Err::<(), std::io::Error>(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    format!(
                        "YouTube upstream remained incomplete after {} resume attempts: delivered={}, expected={:?}, reason={}",
                        resume_attempts, delivered, expected_len, reason
                    ),
                ))?;
            }

            let resume_offset = initial_offset.checked_add(delivered).ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidData, "YouTube stream offset overflow")
            })?;
            resume_attempts += 1;
            let reason = failure.as_deref().unwrap_or("upstream ended before Content-Length");
            tracing::warn!(
                "YouTube stream proxy resuming: host={:?}, offset={}, delivered={}, expected={:?}, attempt={}/{}, reason={}",
                upstream_url.host_str(),
                resume_offset,
                delivered,
                expected_len,
                resume_attempts,
                YOUTUBE_STREAM_RESUME_ATTEMPTS,
                reason
            );

            tokio::time::sleep(Duration::from_millis((resume_attempts as u64) * 100)).await;
            let range = match expected_end {
                Some(end) => format!("bytes={resume_offset}-{end}"),
                None => format!("bytes={resume_offset}-"),
            };
            let mut request = client
                .get(upstream_url.clone())
                .header(header::ACCEPT_ENCODING, "identity")
                .header(header::RANGE, range);
            if let Some(value) = if_range.as_ref() {
                request = request.header(header::IF_RANGE, value.clone());
            }
            let resumed = request.send().await.map_err(|error| {
                std::io::Error::new(
                    std::io::ErrorKind::ConnectionAborted,
                    format!("YouTube stream resume request failed: {}", error.without_url()),
                )
            })?;
            if resumed.status() != StatusCode::PARTIAL_CONTENT {
                Err::<(), std::io::Error>(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("YouTube stream resume returned HTTP {} instead of 206", resumed.status()),
                ))?;
            }
            let actual_offset = content_range_start(resumed.headers()).ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "YouTube stream resume response has no valid Content-Range",
                )
            })?;
            if actual_offset != resume_offset {
                Err::<(), std::io::Error>(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!(
                        "YouTube stream resume offset mismatch: requested={}, received={}",
                        resume_offset, actual_offset
                    ),
                ))?;
            }
            response = resumed;
        }
    });
    axum::body::Body::from_stream(stream)
}

pub fn validate_video_id(id: &str) -> AppResult<()> {
    if id.len() != 11
        || !id
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || v == b'-' || v == b'_')
    {
        return Err(AppError::BadRequest("invalid YouTube video ID".into()));
    }
    Ok(())
}

pub fn stream_proxy_path(id: &str) -> AppResult<String> {
    validate_video_id(id)?;
    Ok(format!("/api/v1/youtube/stream?videoId={id}"))
}

pub fn is_allowed_googlevideo_url(url: &reqwest::Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| {
            let host = host.trim_end_matches('.').to_ascii_lowercase();
            host == "googlevideo.com" || host.ends_with(".googlevideo.com")
        })
}

pub fn validate_googlevideo_url(raw: &str) -> AppResult<reqwest::Url> {
    let url = reqwest::Url::parse(raw)
        .map_err(|_| AppError::BadRequest("invalid YouTube stream URL".into()))?;
    if !is_allowed_googlevideo_url(&url) {
        return Err(AppError::Forbidden(
            "YouTube stream host is not allowed".into(),
        ));
    }
    Ok(url)
}

fn address_expiry(url: &reqwest::Url, now: SystemTime) -> SystemTime {
    let maximum = now + Duration::from_secs(60 * 60);
    url.query_pairs()
        .find(|(name, _)| name == "expire")
        .and_then(|(_, value)| value.parse::<u64>().ok())
        .and_then(|value| value.checked_sub(5 * 60))
        .map(|value| UNIX_EPOCH + Duration::from_secs(value))
        .map(|expiry| expiry.min(maximum))
        .unwrap_or(now)
}

async fn resolve_stream_url(id: &str) -> AppResult<String> {
    let executable = if Path::new("yt-dlp.exe").exists() {
        "./yt-dlp.exe"
    } else if Path::new("yt-dlp").exists() {
        "./yt-dlp"
    } else {
        "yt-dlp"
    };
    let mut command = Command::new(executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.as_std_mut().creation_flags(0x08000000);
    }
    command
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .env("PYTHONIOENCODING", "utf-8")
        .args([
            "--encoding",
            "utf-8",
            "--ignore-config",
            "--no-cache-dir",
            "--skip-download",
            "--no-playlist",
            "--socket-timeout",
            "8",
            "--retries",
            "1",
            "--extractor-retries",
            "1",
            "--extractor-args",
            "youtube:player_client=android",
            "-g",
            "-f",
            "best[ext=mp4][vcodec!=none][acodec!=none]",
        ])
        .arg(format!("https://www.youtube.com/watch?v={id}"));
    let output = tokio::time::timeout(Duration::from_secs(18), command.output())
        .await
        .map_err(|_| AppError::BadRequest("YouTube stream resolution timed out".into()))??;
    let url = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("https://") || line.starts_with("http://"))
        .map(str::to_string);
    if let Some(url) = url {
        validate_googlevideo_url(&url)?;
        return Ok(url);
    }
    tracing::warn!(
        "YouTube resolution failed: videoId={}, status={}",
        id,
        output.status
    );
    Err(AppError::BadRequest(
        "YouTube did not return a playable MP4".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn stable_media_paths_reject_paths_urls_and_invalid_ids() {
        assert_eq!(
            stream_proxy_path("abcdefghijk").unwrap(),
            "/api/v1/youtube/stream?videoId=abcdefghijk"
        );
        for id in [
            "../anything",
            "short",
            "https://googlevideo.com/x",
            "abc/defghij",
        ] {
            assert!(stream_proxy_path(id).is_err());
        }
        let now = UNIX_EPOCH + Duration::from_secs(1000);
        let url =
            reqwest::Url::parse("https://rr1.googlevideo.com/videoplayback?expire=2000").unwrap();
        assert_eq!(
            address_expiry(&url, now),
            UNIX_EPOCH + Duration::from_secs(1700)
        );
    }

    #[tokio::test]
    async fn simultaneous_resolution_is_shared_and_invalidated_urls_refresh() {
        let service = YoutubeMediaService::new(reqwest::Client::new());
        let calls = AtomicUsize::new(0);
        let expire = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 3600;
        let resolver = || async {
            calls.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            Ok(format!(
                "https://rr1.googlevideo.com/videoplayback?expire={expire}"
            ))
        };
        let (a, b) = tokio::join!(
            service.resolve_with("abcdefghijk", resolver),
            service.resolve_with("abcdefghijk", resolver)
        );
        assert_eq!(a.unwrap(), b.unwrap());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        service
            .invalidate_address(
                "abcdefghijk",
                &service.stream_url("abcdefghijk").await.unwrap(),
            )
            .await
            .unwrap();
        service.resolve_with("abcdefghijk", resolver).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn expired_addresses_refresh_and_new_addresses_are_reused() {
        let service = YoutubeMediaService::new(reqwest::Client::new());
        service
            .resolve_with("abcdefghijk", || async {
                Ok("https://rr1.googlevideo.com/videoplayback?expire=1".to_string())
            })
            .await
            .unwrap();
        let expire = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 3600;
        let fresh = format!("https://rr1.googlevideo.com/videoplayback?expire={expire}");
        assert_eq!(
            service
                .resolve_with("abcdefghijk", || async { Ok(fresh.clone()) })
                .await
                .unwrap(),
            fresh
        );
        assert_eq!(
            service
                .resolve_with("abcdefghijk", || async {
                    Err(AppError::BadRequest("unexpected repeat resolution".into()))
                })
                .await
                .unwrap(),
            fresh
        );
    }

    #[tokio::test]
    async fn a_delayed_rejection_does_not_remove_a_newer_address() {
        let service = YoutubeMediaService::new(reqwest::Client::new());
        let expire = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 3600;
        let old = format!("https://rr1.googlevideo.com/videoplayback?expire={expire}&sig=old");
        let fresh = format!("https://rr1.googlevideo.com/videoplayback?expire={expire}&sig=new");
        service
            .resolve_with("abcdefghijk", || async { Ok(old.clone()) })
            .await
            .unwrap();
        service
            .invalidate_address("abcdefghijk", &old)
            .await
            .unwrap();
        service
            .resolve_with("abcdefghijk", || async { Ok(fresh.clone()) })
            .await
            .unwrap();
        service
            .invalidate_address("abcdefghijk", &old)
            .await
            .unwrap();
        assert_eq!(
            service
                .resolve_with("abcdefghijk", || async {
                    Err(AppError::BadRequest(
                        "new address must remain cached".into(),
                    ))
                })
                .await
                .unwrap(),
            fresh
        );
    }

    #[tokio::test]
    async fn resolved_address_cache_remains_bounded() {
        let service = YoutubeMediaService::new(reqwest::Client::new());
        let expire = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 3600;
        for index in 0..MAX_URLS + 20 {
            service
                .resolve_with(&format!("{index:011}"), || async {
                    Ok(format!(
                        "https://rr1.googlevideo.com/videoplayback?expire={expire}&id={index}"
                    ))
                })
                .await
                .unwrap();
        }
        assert_eq!(service.entries.lock().await.len(), MAX_URLS);
    }

    #[test]
    fn addresses_without_expiry_are_not_reused_and_valid_lifetimes_are_capped() {
        let now = UNIX_EPOCH + Duration::from_secs(1000);
        for query in ["", "?expire=invalid"] {
            let url =
                reqwest::Url::parse(&format!("https://rr1.googlevideo.com/videoplayback{query}"))
                    .unwrap();
            assert_eq!(address_expiry(&url, now), now);
        }
        let url =
            reqwest::Url::parse("https://rr1.googlevideo.com/videoplayback?expire=100000").unwrap();
        assert_eq!(address_expiry(&url, now), now + Duration::from_secs(3600));
    }

    #[tokio::test]
    async fn interrupted_stream_resumes_at_the_received_offset() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/media", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for first in [true, false] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = vec![0; 4096];
                let length = socket.read(&mut request).await.unwrap();
                if first {
                    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: 17\r\nConnection: close\r\n\r\ncompl").await.unwrap();
                } else {
                    assert!(String::from_utf8_lossy(&request[..length])
                        .to_lowercase()
                        .contains("range: bytes=5-16"));
                    socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Type: video/mp4\r\nContent-Length: 12\r\nContent-Range: bytes 5-16/17\r\nConnection: close\r\n\r\nete mp4 body").await.unwrap();
                }
                socket.shutdown().await.unwrap();
            }
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .http1_only()
            .build()
            .unwrap();
        let response = client.get(&url).send().await.unwrap();
        let body =
            resumable_upstream_body(client, response.url().clone(), response, 0, Some(17), None);
        let bytes = tokio::time::timeout(Duration::from_secs(5), axum::body::to_bytes(body, 100))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(bytes.as_ref(), b"complete mp4 body");
        server.await.unwrap();
    }
}
