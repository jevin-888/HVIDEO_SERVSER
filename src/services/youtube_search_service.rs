use crate::errors::{AppError, AppResult};
use crate::models::youtube::YouTubeSearchResult;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, OnceCell, Semaphore};

const SEARCH_ENDPOINT: &str = "https://www.youtube.com/youtubei/v1/search?prettyPrint=false";
const WEB_CLIENT_VERSION: &str = "2.20260907.06.00";
const CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const CACHE_CAPACITY: usize = 64;

struct CachedResults {
    loaded_at: Instant,
    items: Vec<YouTubeSearchResult>,
}

struct SearchSlot {
    used_at: Instant,
    result: Arc<Mutex<Option<CachedResults>>>,
}

/// One HTTP search transport, connection pool and cache for both hot and search.
/// A per-query lock coalesces simultaneous PAD requests without serializing
/// unrelated searches or launching a console process.
pub struct YoutubeSearchService {
    client: reqwest::Client,
    endpoint: String,
    cache: Mutex<HashMap<(String, usize), SearchSlot>>,
    requests: Semaphore,
}

impl YoutubeSearchService {
    fn new(client: reqwest::Client, endpoint: String) -> Self {
        Self {
            client,
            endpoint,
            cache: Mutex::new(HashMap::new()),
            requests: Semaphore::new(4),
        }
    }

    pub async fn shared() -> AppResult<&'static Self> {
        static SERVICE: OnceCell<YoutubeSearchService> = OnceCell::const_new();
        SERVICE
            .get_or_try_init(|| async {
                let client = reqwest::Client::builder()
                    .connect_timeout(Duration::from_secs(5))
                    .timeout(Duration::from_secs(12))
                    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36")
                    .build()
                    .map_err(|error| AppError::Internal(error.into()))?;
                Ok(Self::new(client, SEARCH_ENDPOINT.to_string()))
            })
            .await
    }

    pub async fn search(&self, query: &str, limit: usize) -> AppResult<Vec<YouTubeSearchResult>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        if query.chars().count() > 256 || !(1..=60).contains(&limit) {
            return Err(AppError::BadRequest(
                "invalid YouTube search parameters".into(),
            ));
        }
        let key = (query.to_string(), limit);
        let slot = {
            let mut cache = self.cache.lock().await;
            if !cache.contains_key(&key) && cache.len() >= CACHE_CAPACITY {
                let oldest = cache
                    .iter()
                    .filter(|(_, slot)| Arc::strong_count(&slot.result) == 1)
                    .min_by_key(|(_, slot)| slot.used_at)
                    .map(|(key, _)| key.clone());
                if let Some(oldest) = oldest {
                    cache.remove(&oldest);
                } else {
                    return Err(AppError::BadRequest(
                        "YouTube search is busy; retry shortly".into(),
                    ));
                }
            }
            let slot = cache.entry(key).or_insert_with(|| SearchSlot {
                used_at: Instant::now(),
                result: Arc::new(Mutex::new(None)),
            });
            slot.used_at = Instant::now();
            slot.result.clone()
        };
        let mut result = slot.lock().await;
        if let Some(cached) = result
            .as_ref()
            .filter(|c| c.loaded_at.elapsed() < CACHE_TTL)
        {
            return Ok(cached.items.clone());
        }
        let _permit = self
            .requests
            .acquire()
            .await
            .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;
        let started = Instant::now();
        let items = self.load(query, limit).await?;
        tracing::info!(
            "YouTube search complete: items={}, elapsedMs={}",
            items.len(),
            started.elapsed().as_millis()
        );
        *result = Some(CachedResults {
            loaded_at: Instant::now(),
            items: items.clone(),
        });
        Ok(items)
    }

    async fn load(&self, query: &str, limit: usize) -> AppResult<Vec<YouTubeSearchResult>> {
        let mut items = Vec::new();
        let mut seen = HashSet::new();
        let mut continuation: Option<String> = None;
        let mut visitor_data: Option<String> = None;
        // Search returns a page, not an arbitrary ytsearchN list. Follow the
        // provider's continuation for hot results, with a bounded page count.
        for _ in 0..3 {
            let mut body = json!({
                "context": {"client": {
                    "hl": "en", "gl": "US", "clientName": "WEB",
                    "clientVersion": WEB_CLIENT_VERSION
                }}
            });
            if let Some(visitor) = &visitor_data {
                body["context"]["client"]["visitorData"] = json!(visitor);
            }
            let is_continuation = continuation.is_some();
            if let Some(token) = &continuation {
                body["continuation"] = json!(token);
            } else {
                body["query"] = json!(query);
                body["params"] = json!("EgIQAQ=="); // videos only
            }
            let response = self
                .client
                .post(&self.endpoint)
                .json(&body)
                .send()
                .await
                .and_then(reqwest::Response::error_for_status)
                .map_err(|error| {
                    AppError::BadRequest(format!("YouTube search unavailable: {error}"))
                })?;
            let data: Value = response.json().await.map_err(|error| {
                AppError::BadRequest(format!("invalid YouTube search response: {error}"))
            })?;
            if let Some(visitor) = data
                .pointer("/responseContext/visitorData")
                .and_then(Value::as_str)
            {
                visitor_data = Some(visitor.to_string());
            }
            let page = parse_page(&data, is_continuation)?;
            items.extend(
                page.items
                    .into_iter()
                    .filter(|item| seen.insert(item.id.clone())),
            );
            continuation = page.continuation;
            if items.len() >= limit || continuation.is_none() {
                break;
            }
        }
        items.truncate(limit);
        Ok(items)
    }
}

struct SearchPage {
    items: Vec<YouTubeSearchResult>,
    continuation: Option<String>,
}

fn renderer_text(value: &Value) -> Option<String> {
    let text = if let Some(simple) = value.get("simpleText").and_then(Value::as_str) {
        simple.to_string()
    } else {
        value
            .get("runs")?
            .as_array()?
            .iter()
            .filter_map(|run| run.get("text").and_then(Value::as_str))
            .collect::<String>()
    };
    (!text.trim().is_empty()).then(|| text.trim().to_string())
}

fn parse_page(data: &Value, is_continuation: bool) -> AppResult<SearchPage> {
    let sections = if is_continuation {
        data.get("onResponseReceivedCommands")
            .and_then(Value::as_array)
            .and_then(|commands| {
                commands.iter().find_map(|command| {
                    command
                        .pointer("/appendContinuationItemsAction/continuationItems")
                        .and_then(Value::as_array)
                })
            })
    } else {
        data.pointer(
            "/contents/twoColumnSearchResultsRenderer/primaryContents/sectionListRenderer/contents",
        )
        .and_then(Value::as_array)
    }
    .ok_or_else(|| AppError::BadRequest("YouTube search response is missing results".into()))?;
    let mut page = SearchPage {
        items: Vec::new(),
        continuation: None,
    };
    for section in sections {
        if let Some(token) = section
            .pointer("/continuationItemRenderer/continuationEndpoint/continuationCommand/token")
            .and_then(Value::as_str)
        {
            page.continuation = Some(token.to_string());
        }
        if let Some(results) = section
            .pointer("/itemSectionRenderer/contents")
            .and_then(Value::as_array)
        {
            for result in results {
                let Some(video) = result.get("videoRenderer") else {
                    continue;
                };
                let Some(id) = video
                    .get("videoId")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                else {
                    continue;
                };
                let Some(title) = renderer_text(&video["title"]) else {
                    continue;
                };
                page.items.push(YouTubeSearchResult {
                    id: id.to_string(),
                    title,
                    thumbnail: Some(format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")),
                    duration: renderer_text(&video["lengthText"]),
                    channel: renderer_text(&video["longBylineText"]),
                });
            }
        }
    }
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn first_page() -> Value {
        json!({"contents":{"twoColumnSearchResultsRenderer":{"primaryContents":{"sectionListRenderer":{"contents":[
            {"itemSectionRenderer":{"contents":[
                {"videoRenderer":{"videoId":"abc123", "title":{"runs":[{"text":"Song "},{"text":"Live"}]},"lengthText":{"simpleText":"3:20"},"longBylineText":{"runs":[{"text":"Singer"}]}}},
                {"channelRenderer":{"channelId":"not-a-video"}},
                {"videoRenderer":{"title":{"simpleText":"missing id"}}}
            ]}},
            {"continuationItemRenderer":{"continuationEndpoint":{"continuationCommand":{"token":"page2"}}}}
        ]}}}}})
    }

    #[test]
    fn parses_only_video_results_and_rejects_broken_envelopes() {
        let page = parse_page(&first_page(), false).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].title, "Song Live");
        assert_eq!(page.items[0].channel.as_deref(), Some("Singer"));
        assert_eq!(page.items[0].duration.as_deref(), Some("3:20"));
        assert_eq!(page.continuation.as_deref(), Some("page2"));
        assert!(parse_page(&json!({"error":{"code":429}}), false).is_err());
    }

    #[tokio::test]
    async fn concurrent_queries_share_one_request_and_continuations_are_real() {
        use axum::{routing::post, Json, Router};
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = calls.clone();
        let router = Router::new().route("/search", post(move |Json(body): Json<Value>| {
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                if body["continuation"] == "page2" {
                    Json(json!({"onResponseReceivedCommands":[{"appendContinuationItemsAction":{"continuationItems":[
                        {"itemSectionRenderer":{"contents":[{"videoRenderer":{"videoId":"second", "title":{"simpleText":"Second"}}}]}}
                    ]}}]}))
                } else {
                    assert_eq!(body["query"], "Adele");
                    assert_eq!(body["params"], "EgIQAQ==");
                    Json(first_page())
                }
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/search", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let service = YoutubeSearchService::new(
            reqwest::Client::builder().no_proxy().build().unwrap(),
            endpoint,
        );
        let (first, duplicate) =
            tokio::join!(service.search(" Adele ", 2), service.search("Adele", 2));
        assert_eq!(first.unwrap().len(), 2);
        assert_eq!(duplicate.unwrap()[1].id, "second");
        assert_eq!(calls.load(Ordering::SeqCst), 2); // one initial + one continuation
        assert_eq!(service.search("Adele", 2).await.unwrap().len(), 2);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        server.abort();
    }
}
