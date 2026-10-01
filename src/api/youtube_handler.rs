use crate::api::room_handler::broadcast_room_sync;
use crate::errors::{AppError, AppResult};
use crate::models::common::ApiResponse;
use crate::models::room::RoomQueueItem;
use crate::models::youtube::{
    YouTubeSearchResult, YoutubeParseParams, YoutubeQueueRequest, YoutubeSearchParams,
};
use crate::services::room_service::RoomService;
use crate::services::youtube_media_service::{
    content_range_start, resumable_upstream_body, stream_proxy_path, validate_video_id,
    YoutubeMediaService,
};
use crate::services::youtube_search_service::YoutubeSearchService;
use crate::AppState;
use axum::extract::Request;
use axum::extract::{ConnectInfo, Json, Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use std::net::SocketAddr;

const HOT_QUERY: &str = "热门华语经典流行歌曲 原版MV KTV伴奏";
const HOT_SEARCH_LIMIT: usize = 30;
const HOT_RESULT_LIMIT: usize = 12;

fn is_accompaniment_video(item: &YouTubeSearchResult) -> bool {
    let searchable = format!(
        "{} {}",
        item.title,
        item.channel.as_deref().unwrap_or_default()
    )
    .to_lowercase();
    [
        "karaoke",
        "instrumental",
        "backing track",
        "minus one",
        "no vocal",
        "\u{4f34}\u{594f}",
        "\u{5361}\u{62c9}ok",
        "ktv",
    ]
    .iter()
    .any(|keyword| searchable.contains(keyword))
}

fn duration_seconds(value: Option<&str>) -> Option<u64> {
    let mut total = 0_u64;
    let mut multiplier = 1_u64;
    let mut found = false;
    for part in value?.trim().split(':').rev() {
        let number = part.parse::<u64>().ok()?;
        total = total.checked_add(number.checked_mul(multiplier)?)?;
        multiplier = multiplier.checked_mul(60)?;
        found = true;
    }
    found.then_some(total)
}

fn is_single_song_duration(item: &YouTubeSearchResult) -> bool {
    duration_seconds(item.duration.as_deref())
        .is_some_and(|seconds| (90..=10 * 60).contains(&seconds))
}

fn select_hot_accompaniment_results(
    items: Vec<YouTubeSearchResult>,
    limit: usize,
) -> Vec<YouTubeSearchResult> {
    let mut seen = std::collections::HashSet::new();
    items
        .into_iter()
        .filter(is_accompaniment_video)
        .filter(is_single_song_duration)
        .filter(|item| seen.insert(item.id.clone()))
        .take(limit)
        .collect()
}

/// GET /api/v1/youtube/search - search YouTube videos
pub async fn search_video(
    State(_state): State<AppState>,
    Query(params): Query<YoutubeSearchParams>,
) -> AppResult<Json<ApiResponse<Vec<YouTubeSearchResult>>>> {
    let query = params.q.trim();
    if query.is_empty() {
        return Ok(Json(ApiResponse::success(Vec::new())));
    }

    let results = YoutubeSearchService::shared()
        .await?
        .search(query, 15)
        .await?;
    Ok(Json(ApiResponse::success(results)))
}

/// GET /api/v1/youtube/hot - uses the shared HTTP search cache.
pub async fn hot_videos(
    State(_state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<YouTubeSearchResult>>>> {
    let results = YoutubeSearchService::shared()
        .await?
        .search(HOT_QUERY, HOT_SEARCH_LIMIT)
        .await?;
    let items = select_hot_accompaniment_results(results, HOT_RESULT_LIMIT);
    if items.is_empty() {
        return Err(AppError::BadRequest(
            "no YouTube hot videos available".into(),
        ));
    }
    Ok(Json(ApiResponse::success(items)))
}

/// GET /api/v1/youtube/parse - resolve a preview URL without changing the queue
pub async fn parse_video(
    State(_state): State<AppState>,
    Query(params): Query<YoutubeParseParams>,
) -> AppResult<Json<ApiResponse<String>>> {
    let video_id = params.videoId;
    if video_id.is_empty() {
        return Err(AppError::BadRequest("missing YouTube video ID".to_string()));
    }
    tracing::info!("YouTube preview parse: videoId={}", video_id);
    let stream_url = YoutubeMediaService::shared()
        .await?
        .stream_url(&video_id)
        .await?;
    Ok(Json(ApiResponse::success(stream_url)))
}

/// POST /api/v1/rooms/:id/youtube/queue - persist immediately; warm the expiring address asynchronously
pub async fn queue_video(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(request): Json<YoutubeQueueRequest>,
) -> AppResult<Json<ApiResponse<RoomQueueItem>>> {
    let room_id = RoomService::resolve_room_id(&state.db, &id, &addr.ip().to_string()).await?;
    let video_id = request.videoId;
    if video_id.is_empty() {
        return Err(AppError::BadRequest("missing YouTube video ID".to_string()));
    }

    tracing::info!(
        "YouTube queue request: roomId={}, videoId={}",
        room_id,
        video_id
    );
    validate_video_id(&video_id)?;
    let stream_proxy_path = stream_proxy_path(&video_id)?;
    let media = YoutubeMediaService::shared().await?;
    RoomService::get_by_id(&state.db, &room_id).await?;

    let item = RoomService::add_youtube_to_queue(
        &state.db,
        &room_id,
        &video_id,
        request.title.as_deref().unwrap_or("YouTube video"),
        request.channel.as_deref().unwrap_or("YouTube"),
        &stream_proxy_path,
        request.isPriority.unwrap_or(false),
    )
    .await?;

    let response_item = RoomService::finalize_queue_enqueue(&state.db, &room_id, &item.id).await?;

    // Broadcast authoritative queue and room state for PAD, phones, and reconnecting clients.
    broadcast_room_sync(&state, &room_id).await?;
    media.prepare_address(video_id);
    tracing::info!(
        "YouTube queue complete: roomId={}, songId={}, status={}",
        room_id,
        response_item.songId,
        response_item.status
    );
    Ok(Json(ApiResponse::success(response_item)))
}

/// GET /api/v1/youtube/stream?videoId=... - proxy the resolved media on demand without saving video files.
/// Range headers and media response headers are passed through so native players can seek.
pub async fn proxy_stream(Query(params): Query<YoutubeParseParams>, request: Request) -> Response {
    let video_id = params.videoId;
    if let Err(error) = validate_video_id(&video_id) {
        return error.into_response();
    }
    let media = match YoutubeMediaService::shared().await {
        Ok(media) => media,
        Err(error) => return error.into_response(),
    };
    let request_headers = request.headers();
    let client = media.client();
    let (upstream_url, upstream) = match media
        .open_stream(&video_id, request.method().clone(), request_headers)
        .await
    {
        Ok(response) => response,
        Err(error) => return error.into_response(),
    };

    let status = upstream.status();
    let upstream_headers = upstream.headers().clone();
    let expected_len = upstream.content_length();
    let initial_offset = content_range_start(&upstream_headers).unwrap_or(0);
    let if_range = request_headers.get(header::IF_RANGE).cloned();
    let body = if request.method() == axum::http::Method::HEAD {
        axum::body::Body::empty()
    } else if status == StatusCode::OK || status == StatusCode::PARTIAL_CONTENT {
        resumable_upstream_body(
            client,
            upstream_url,
            upstream,
            initial_offset,
            expected_len,
            if_range,
        )
    } else {
        axum::body::Body::from_stream(upstream.bytes_stream())
    };
    let mut response = Response::builder().status(status);
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::ETAG,
        header::LAST_MODIFIED,
    ] {
        if let Some(value) = upstream_headers.get(&name) {
            response = response.header(name, value);
        }
    }
    response = response
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");

    response.body(body).unwrap_or_else(|error| {
        tracing::error!("failed to build YouTube stream proxy response: {}", error);
        StatusCode::INTERNAL_SERVER_ERROR.into_response()
    })
}

/// GET /api/v1/proxy/image?url=... - proxy an image request
pub async fn proxy_image(
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl axum::response::IntoResponse {
    let url = params.get("url").cloned().unwrap_or_default();
    if url.is_empty() {
        return (axum::http::StatusCode::BAD_REQUEST, "Missing url parameter").into_response();
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_default();

    match client.get(&url).send().await {
        Ok(resp) => {
            let status = resp.status();
            let content_type = resp.headers().get("content-type").cloned();
            let body = resp.bytes().await.unwrap_or_default();
            let mut builder = axum::response::Response::builder().status(status);
            if let Some(ct) = content_type {
                builder = builder.header("content-type", ct);
            } else {
                builder = builder.header("content-type", "image/jpeg");
            }
            builder = builder.header("access-control-allow-origin", "*");
            builder
                .body(axum::body::Body::from(body))
                .unwrap_or_else(|_| {
                    (
                        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to build response",
                    )
                        .into_response()
                })
        }
        Err(error) => {
            tracing::error!("image proxy failed: {}, error: {}", url, error);
            (
                axum::http::StatusCode::BAD_GATEWAY,
                format!("Proxy error: {}", error),
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{content_range_start, duration_seconds, select_hot_accompaniment_results};
    use crate::models::youtube::YouTubeSearchResult;
    use crate::services::youtube_media_service::{
        is_allowed_googlevideo_url, validate_googlevideo_url,
    };
    use axum::http::{header, HeaderMap};

    #[test]
    fn hot_results_only_keep_unique_accompaniment_videos() {
        let item = |id: &str, title: &str, channel: &str| YouTubeSearchResult {
            id: id.to_string(),
            title: title.to_string(),
            thumbnail: None,
            duration: Some("3:30".to_string()),
            channel: Some(channel.to_string()),
        };
        let mut long_compilation = item("5", "经典 KTV 伴奏合集", "Karaoke Channel");
        long_compilation.duration = Some("1:20:00".to_string());
        let mut missing_duration = item("6", "经典 KTV 伴奏", "Karaoke Channel");
        missing_duration.duration = None;
        let selected = select_hot_accompaniment_results(
            vec![
                item("1", "Popular (Karaoke Version)", "Sing King"),
                item("2", "Original Music Video", "Official Artist"),
                item("3", "Song Name", "Karaoke Channel"),
                item("1", "Popular (Karaoke Version)", "Duplicate"),
                item(
                    "4",
                    "\u{70ed}\u{95e8}\u{6b4c}\u{66f2}\u{4f34}\u{594f}",
                    "Music",
                ),
                long_compilation,
                missing_duration,
            ],
            12,
        );

        assert_eq!(selected.len(), 3);
        assert_eq!(selected[0].id, "1");
        assert_eq!(selected[1].id, "3");
        assert_eq!(selected[2].id, "4");
    }

    #[test]
    fn only_allows_googlevideo_http_hosts() {
        for value in [
            "https://googlevideo.com/videoplayback?id=1",
            "https://rr1---sn.example.googlevideo.com/videoplayback?id=1",
            "http://rr1---sn.example.googlevideo.com/videoplayback?id=1",
        ] {
            let url = reqwest::Url::parse(value).unwrap();
            assert!(
                is_allowed_googlevideo_url(&url),
                "expected allowed: {value}"
            );
            assert!(validate_googlevideo_url(value).is_ok());
        }

        for value in [
            "https://example.com/videoplayback",
            "https://googlevideo.com.example.com/videoplayback",
            "http://127.0.0.1/videoplayback",
            "http://localhost/videoplayback",
            "ftp://rr1.googlevideo.com/videoplayback",
        ] {
            let url = reqwest::Url::parse(value).unwrap();
            assert!(
                !is_allowed_googlevideo_url(&url),
                "expected rejected: {value}"
            );
            assert!(validate_googlevideo_url(value).is_err());
        }
    }

    #[test]
    fn parses_content_range_start_for_resume_validation() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_RANGE,
            axum::http::HeaderValue::from_static("bytes 6493544-10305834/10305835"),
        );
        assert_eq!(content_range_start(&headers), Some(6_493_544));

        headers.insert(
            header::CONTENT_RANGE,
            axum::http::HeaderValue::from_static("bytes */10305835"),
        );
        assert_eq!(content_range_start(&headers), None);
    }

    #[test]
    fn parses_song_durations_for_hot_result_filtering() {
        assert_eq!(duration_seconds(Some("3:20")), Some(200));
        assert_eq!(duration_seconds(Some("1:02:03")), Some(3_723));
        assert_eq!(duration_seconds(Some("NA")), None);
        assert_eq!(duration_seconds(None), None);
    }
}
