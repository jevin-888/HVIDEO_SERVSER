use axum::{extract::Query, http::StatusCode, Json};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use dashmap::DashMap;
use flate2::read::ZlibDecoder;
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering,
    io::Read,
    sync::{Arc, OnceLock},
};

const AMLL_SEARCH_URL: &str = "https://amlldb.bikonoo.com/api/search-lyrics";
const AMLL_RAW_BASE_URL: &str = "https://amlldb.bikonoo.com/raw-lyrics/";
const KUGOU_SONG_SEARCH_URL: &str = "https://songsearch.kugou.com/song_search_v2";
const KUGOU_SEARCH_URL: &str = "https://lyrics.kugou.com/search";
const KUGOU_DOWNLOAD_URL: &str = "https://lyrics.kugou.com/download";
const KRC_XOR_KEY: [u8; 16] = [
    0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
];

static LYRIC_CACHE: OnceLock<DashMap<String, Arc<TimedLyricsResponse>>> = OnceLock::new();
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedLyricsQuery {
    title: String,
    #[serde(default)]
    artist: String,
    #[serde(default)]
    duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedLyricWord {
    text: String,
    start_ms: i64,
    end_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedLyricLine {
    text: String,
    start_ms: i64,
    end_ms: i64,
    words: Vec<TimedLyricWord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedLyricsSong {
    title: String,
    artist: String,
    duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedLyricsResponse {
    source: &'static str,
    source_id: String,
    song: TimedLyricsSong,
    lines: Vec<TimedLyricLine>,
}

#[derive(Debug, Serialize)]
pub struct ApiError {
    error: String,
}

#[derive(Debug, Deserialize)]
struct AmllSearchItem {
    #[serde(default)]
    title: String,
    #[serde(default)]
    artist: String,
    file: String,
    #[serde(default)]
    score: i64,
}

#[derive(Debug, Deserialize)]
struct KugouSongSearchResponse {
    data: Option<KugouSongSearchData>,
}

#[derive(Debug, Deserialize)]
struct KugouSongSearchData {
    #[serde(default)]
    lists: Vec<KugouSongCandidate>,
}

#[derive(Debug, Clone, Deserialize)]
struct KugouSongCandidate {
    #[serde(rename = "SongName", default)]
    song_name: String,
    #[serde(rename = "SingerName", default)]
    singer_name: String,
    #[serde(rename = "Duration", default)]
    duration_seconds: i64,
    #[serde(rename = "FileHash", default)]
    file_hash: String,
}

#[derive(Debug, Deserialize)]
struct KugouSearchResponse {
    #[serde(default)]
    candidates: Vec<KugouCandidate>,
}

#[derive(Debug, Clone, Deserialize)]
struct KugouCandidate {
    #[serde(default)]
    id: String,
    #[serde(default)]
    accesskey: String,
    #[serde(default)]
    singer: String,
    #[serde(default)]
    song: String,
    #[serde(default)]
    duration: i64,
    #[serde(default)]
    score: i64,
    #[serde(default)]
    content_format: i64,
}

#[derive(Debug, Deserialize)]
struct KugouDownloadResponse {
    #[serde(default)]
    status: i64,
    #[serde(default)]
    content: String,
}

#[derive(Debug, Serialize)]
struct AmllSearchRequest<'a> {
    query: &'a str,
    #[serde(rename = "type")]
    search_type: &'static str,
}

struct LineBuilder {
    text: String,
    start_ms: i64,
    end_ms: i64,
    words: Vec<TimedLyricWord>,
}

struct SpanFrame {
    text: String,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    skip: bool,
}

type HandlerError = (StatusCode, Json<ApiError>);

pub async fn get_timed_lyrics(
    Query(query): Query<TimedLyricsQuery>,
) -> Result<Json<TimedLyricsResponse>, HandlerError> {
    let title = query.title.trim();
    let artist = query.artist.trim();
    if title.is_empty() {
        return Err(api_error(StatusCode::BAD_REQUEST, "title cannot be empty"));
    }

    let title_candidates = title_search_candidates(title);
    let cache_key = lyric_cache_key(title, artist, query.duration_ms);
    let cache = LYRIC_CACHE.get_or_init(DashMap::new);
    if let Some(cached) = cache.get(&cache_key) {
        return Ok(Json((**cached).clone()));
    }

    let client = HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(3))
            .timeout(std::time::Duration::from_secs(8))
            .user_agent("HVideo-TimedLyrics/1.1")
            .build()
            .expect("timed lyrics HTTP client")
    });

    let mut provider_errors = Vec::new();
    let response =
        match fetch_amll_lyrics(client, &title_candidates, artist, query.duration_ms).await {
            Ok(Some(response)) => Some(response),
            Ok(None) => None,
            Err(error) => {
                provider_errors.push(format!("AMLL: {error}"));
                None
            }
        };
    let response = match response {
        Some(response) => response,
        None => {
            match fetch_kugou_lyrics(client, &title_candidates, artist, query.duration_ms).await {
                Ok(Some(response)) => response,
                Ok(None) => {
                    return Err(api_error(
                        StatusCode::NOT_FOUND,
                        "no matching word-timed lyrics",
                    ));
                }
                Err(error) => {
                    provider_errors.push(format!("Kugou: {error}"));
                    return Err(api_error(
                        StatusCode::BAD_GATEWAY,
                        provider_errors.join("; "),
                    ));
                }
            }
        }
    };

    cache.insert(cache_key, Arc::new(response.clone()));
    Ok(Json(response))
}

async fn fetch_amll_lyrics(
    client: &reqwest::Client,
    titles: &[String],
    artist: &str,
    duration_ms: Option<i64>,
) -> Result<Option<TimedLyricsResponse>, String> {
    for title in titles {
        let search_response = client
            .post(AMLL_SEARCH_URL)
            .json(&AmllSearchRequest {
                query: title,
                search_type: "title",
            })
            .send()
            .await
            .map_err(|error| format!("search request failed: {error}"))?;
        if !search_response.status().is_success() {
            return Err(format!("search returned {}", search_response.status()));
        }
        let search_bytes = search_response
            .bytes()
            .await
            .map_err(|error| format!("search response read failed: {error}"))?;
        let candidates: Vec<AmllSearchItem> = serde_json::from_slice(&search_bytes)
            .map_err(|error| format!("search JSON invalid: {error}"))?;
        let Some(selected) = select_candidate(&candidates, title, artist) else {
            continue;
        };

        let raw_url = format!("{AMLL_RAW_BASE_URL}{}", selected.file);
        let ttml_response = client
            .get(raw_url)
            .send()
            .await
            .map_err(|error| format!("TTML download failed: {error}"))?;
        if !ttml_response.status().is_success() {
            return Err(format!("TTML returned {}", ttml_response.status()));
        }
        let ttml_bytes = ttml_response
            .bytes()
            .await
            .map_err(|error| format!("TTML response read failed: {error}"))?;
        let ttml = String::from_utf8(ttml_bytes.to_vec())
            .map_err(|error| format!("TTML is not UTF-8: {error}"))?;
        let lines = parse_ttml(&ttml).map_err(|error| format!("TTML parse failed: {error}"))?;
        if lines.is_empty() || !timeline_fits_requested_duration(&lines, duration_ms) {
            continue;
        }

        return Ok(Some(TimedLyricsResponse {
            source: "amll-ttml-db",
            source_id: selected.file.clone(),
            song: TimedLyricsSong {
                title: selected.title.clone(),
                artist: selected.artist.clone(),
                duration_ms,
            },
            lines,
        }));
    }

    Ok(None)
}

async fn fetch_kugou_lyrics(
    client: &reqwest::Client,
    titles: &[String],
    artist: &str,
    duration_ms: Option<i64>,
) -> Result<Option<TimedLyricsResponse>, String> {
    let Some(song) = fetch_kugou_song_candidate(client, titles, artist, duration_ms).await? else {
        return Ok(None);
    };
    let expected_duration_ms = duration_ms
        .filter(|duration| *duration > 0)
        .or_else(|| (song.duration_seconds > 0).then_some(song.duration_seconds * 1_000));
    tracing::info!(
        "[TimedLyrics] Kugou song matched title={} artist={} durationMs={} hash={}",
        song.song_name,
        song.singer_name,
        expected_duration_ms.unwrap_or_default(),
        song.file_hash
    );
    let keyword = if song.singer_name.trim().is_empty() {
        song.song_name.clone()
    } else {
        format!("{}-{}", song.singer_name.trim(), song.song_name.trim())
    };
    let duration_query = expected_duration_ms.unwrap_or_default().to_string();
    let search_response = client
        .get(KUGOU_SEARCH_URL)
        .query(&[
            ("ver", "1"),
            ("man", "yes"),
            ("client", "pc"),
            ("keyword", keyword.as_str()),
            ("duration", duration_query.as_str()),
            ("hash", song.file_hash.as_str()),
        ])
        .send()
        .await
        .map_err(|error| format!("search request failed: {error}"))?;
    if !search_response.status().is_success() {
        return Err(format!("search returned {}", search_response.status()));
    }
    let search_bytes = search_response
        .bytes()
        .await
        .map_err(|error| format!("search response read failed: {error}"))?;
    let search: KugouSearchResponse = serde_json::from_slice(&search_bytes)
        .map_err(|error| format!("search JSON invalid: {error}"))?;
    let candidates = rank_kugou_candidates(
        &search.candidates,
        &song.song_name,
        &song.singer_name,
        expected_duration_ms,
    );
    if candidates.is_empty() {
        return Ok(None);
    }

    for selected in candidates {
        let download_response = match client
            .get(KUGOU_DOWNLOAD_URL)
            .query(&[
                ("ver", "1"),
                ("client", "pc"),
                ("id", selected.id.as_str()),
                ("accesskey", selected.accesskey.as_str()),
                ("fmt", "krc"),
                ("charset", "utf8"),
            ])
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(
                    "[TimedLyrics] Kugou KRC candidate skipped lyricId={} reason=download_failed error={}",
                    selected.id,
                    error
                );
                continue;
            }
        };
        if !download_response.status().is_success() {
            tracing::warn!(
                "[TimedLyrics] Kugou KRC candidate skipped lyricId={} reason=http_status status={}",
                selected.id,
                download_response.status()
            );
            continue;
        }
        let download_bytes = match download_response.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => {
                tracing::warn!(
                    "[TimedLyrics] Kugou KRC candidate skipped lyricId={} reason=response_read_failed error={}",
                    selected.id,
                    error
                );
                continue;
            }
        };
        let download: KugouDownloadResponse = match serde_json::from_slice(&download_bytes) {
            Ok(download) => download,
            Err(error) => {
                tracing::warn!(
                    "[TimedLyrics] Kugou KRC candidate skipped lyricId={} reason=json_invalid error={}",
                    selected.id,
                    error
                );
                continue;
            }
        };
        if download.status != 200 || download.content.is_empty() {
            tracing::warn!(
                "[TimedLyrics] Kugou KRC candidate skipped lyricId={} reason=empty_content providerStatus={}",
                selected.id,
                download.status
            );
            continue;
        }
        let krc = match decode_krc(&download.content) {
            Ok(krc) => krc,
            Err(error) => {
                tracing::warn!(
                    "[TimedLyrics] Kugou KRC candidate skipped lyricId={} reason=decode_failed error={}",
                    selected.id,
                    error
                );
                continue;
            }
        };
        let lines = match parse_krc(&krc) {
            Ok(lines) => lines,
            Err(error) => {
                tracing::warn!(
                    "[TimedLyrics] Kugou KRC candidate skipped lyricId={} reason=parse_failed error={}",
                    selected.id,
                    error
                );
                continue;
            }
        };
        let last_lyric_end_ms = lines
            .iter()
            .map(|line| line.end_ms)
            .max()
            .unwrap_or_default();
        if lines.is_empty() || !timeline_fits_requested_duration(&lines, expected_duration_ms) {
            tracing::warn!(
                "[TimedLyrics] Kugou KRC candidate skipped lyricId={} reason=timeline_mismatch candidateDurationMs={} lastLyricEndMs={} requestedDurationMs={}",
                selected.id,
                selected.duration,
                last_lyric_end_ms,
                expected_duration_ms.unwrap_or_default()
            );
            continue;
        }
        tracing::info!(
            "[TimedLyrics] Kugou KRC matched lyricId={} durationMs={} lines={}",
            selected.id,
            selected.duration,
            lines.len()
        );

        return Ok(Some(TimedLyricsResponse {
            source: "kugou-krc",
            source_id: selected.id,
            song: TimedLyricsSong {
                title: song.song_name,
                artist: song.singer_name,
                duration_ms: Some(selected.duration)
                    .filter(|duration| *duration > 0)
                    .or(expected_duration_ms),
            },
            lines,
        }));
    }

    Ok(None)
}

async fn fetch_kugou_song_candidate(
    client: &reqwest::Client,
    titles: &[String],
    artist: &str,
    duration_ms: Option<i64>,
) -> Result<Option<KugouSongCandidate>, String> {
    for requested_title in titles {
        for title in kugou_title_search_candidates(requested_title) {
            for keyword in kugou_search_keywords(&title, artist) {
                let response = client
                    .get(KUGOU_SONG_SEARCH_URL)
                    .query(&[
                        ("keyword", keyword.as_str()),
                        ("page", "1"),
                        ("pagesize", "30"),
                    ])
                    .send()
                    .await
                    .map_err(|error| format!("song search request failed: {error}"))?;
                if !response.status().is_success() {
                    return Err(format!("song search returned {}", response.status()));
                }
                let bytes = response
                    .bytes()
                    .await
                    .map_err(|error| format!("song search response read failed: {error}"))?;
                let search: KugouSongSearchResponse = serde_json::from_slice(&bytes)
                    .map_err(|error| format!("song search JSON invalid: {error}"))?;
                let Some(data) = search.data else {
                    continue;
                };
                if let Some(candidate) =
                    select_kugou_song_candidate(&data.lists, &title, artist, duration_ms)
                {
                    return Ok(Some(candidate.clone()));
                }
            }
        }
    }
    Ok(None)
}

fn select_kugou_song_candidate<'a>(
    candidates: &'a [KugouSongCandidate],
    title: &str,
    artist: &str,
    duration_ms: Option<i64>,
) -> Option<&'a KugouSongCandidate> {
    let wanted_title = normalize_match_text(title);
    let wanted_artist = normalize_match_text(artist);
    candidates
        .iter()
        .filter(|candidate| {
            !candidate.file_hash.is_empty()
                && candidate.duration_seconds > 0
                && normalize_match_text(&candidate.song_name) == wanted_title
                && artist_matches(&candidate.singer_name, &wanted_artist)
                && duration_matches(candidate.duration_seconds * 1_000, duration_ms)
        })
        .min_by_key(|candidate| {
            duration_ms
                .filter(|duration| *duration > 0)
                .map(|duration| (candidate.duration_seconds * 1_000 - duration).abs())
                .unwrap_or_default()
        })
}

fn kugou_title_search_candidates(title: &str) -> Vec<String> {
    let title = title.trim();
    let mut candidates = vec![title.to_string()];
    for (open, close) in [('(', ')'), ('\u{ff08}', '\u{ff09}')] {
        let Some(without_close) = title.strip_suffix(close) else {
            continue;
        };
        let Some(open_index) = without_close.rfind(open) else {
            continue;
        };
        let base = without_close[..open_index]
            .trim_end_matches(|ch: char| ch.is_whitespace() || ch == '-' || ch == '_')
            .trim();
        if base.chars().count() >= 2 && normalize_match_text(base) != normalize_match_text(title) {
            candidates.push(base.to_string());
        }
        break;
    }
    candidates.dedup();
    candidates
}

fn kugou_search_keywords(title: &str, artist: &str) -> Vec<String> {
    let mut keywords = Vec::new();
    if !artist.is_empty() {
        keywords.push(format!("{artist}-{title}"));
        keywords.push(format!("{title} {artist}"));
    }
    keywords.push(title.to_string());
    keywords.dedup();
    keywords
}

fn rank_kugou_candidates(
    candidates: &[KugouCandidate],
    title: &str,
    artist: &str,
    duration_ms: Option<i64>,
) -> Vec<KugouCandidate> {
    let wanted_title = normalize_match_text(title);
    let wanted_artist = normalize_match_text(artist);
    let mut ranked = candidates
        .iter()
        .filter(|candidate| {
            if candidate.id.is_empty() || candidate.accesskey.is_empty() {
                return false;
            }
            let candidate_title = normalize_match_text(&candidate.song);
            !candidate_title.is_empty()
                && candidate_title == wanted_title
                && duration_matches(candidate.duration, duration_ms)
        })
        .cloned()
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        kugou_candidate_score(right, &wanted_artist, duration_ms)
            .cmp(&kugou_candidate_score(left, &wanted_artist, duration_ms))
            .then_with(|| {
                let wanted_duration = duration_ms.unwrap_or_default();
                (left.duration - wanted_duration)
                    .abs()
                    .cmp(&(right.duration - wanted_duration).abs())
            })
            .then_with(|| left.id.cmp(&right.id))
    });
    ranked
}

fn kugou_candidate_score(
    candidate: &KugouCandidate,
    artist: &str,
    duration_ms: Option<i64>,
) -> i64 {
    let candidate_artist = normalize_match_text(&candidate.singer);
    let mut score = candidate.score * 10 + 100_000;
    if !artist.is_empty() && !candidate_artist.is_empty() {
        if candidate_artist == artist {
            score += 30_000;
        } else if candidate_artist.contains(artist) || artist.contains(&candidate_artist) {
            score += 20_000;
        } else {
            score -= 20_000;
        }
    }
    if let Some(wanted_duration) = duration_ms.filter(|duration| *duration > 0) {
        // The phone duration identifies the recording. Search-provider popularity
        // scores are only tie-breakers and must never outweigh tens of seconds of
        // duration mismatch, otherwise remixes/covers produce a drifting timeline.
        score -= (candidate.duration - wanted_duration).abs();
    } else if candidate.duration < 60_000 {
        score -= 20_000;
    } else {
        score += (candidate.duration / 1_000).min(600);
    }
    if candidate.content_format == 3 {
        score += 500;
    }
    score
}

fn decode_krc(encoded: &str) -> Result<String, String> {
    let raw = BASE64_STANDARD
        .decode(encoded.trim())
        .map_err(|error| format!("KRC base64 decode failed: {error}"))?;
    if raw.len() <= 4 || &raw[..4] != b"krc1" {
        return Err("KRC header is missing".to_string());
    }
    let compressed: Vec<u8> = raw[4..]
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ KRC_XOR_KEY[index % KRC_XOR_KEY.len()])
        .collect();
    let mut decoder = ZlibDecoder::new(compressed.as_slice());
    let mut text = String::new();
    decoder
        .read_to_string(&mut text)
        .map_err(|error| format!("KRC zlib decode failed: {error}"))?;
    Ok(text)
}

fn parse_krc(krc: &str) -> Result<Vec<TimedLyricLine>, String> {
    let global_offset_ms = krc
        .lines()
        .find_map(|raw_line| {
            raw_line
                .trim_end_matches('\r')
                .trim()
                .strip_prefix("[offset:")
                .and_then(|value| value.strip_suffix(']'))
                .and_then(|value| value.trim().parse::<i64>().ok())
        })
        .unwrap_or(0);
    let mut lines = Vec::new();
    for raw_line in krc.lines() {
        let line = raw_line.trim_end_matches('\r').trim();
        let Some(close_bracket) = line.find(']') else {
            continue;
        };
        if !line.starts_with('[') {
            continue;
        }
        let timing = &line[1..close_bracket];
        let Some((start, duration)) = timing.split_once(',') else {
            continue;
        };
        let Ok(start_ms) = start.parse::<i64>() else {
            continue;
        };
        let Ok(duration_ms) = duration.parse::<i64>() else {
            continue;
        };
        let adjusted_start_ms = start_ms.saturating_add(global_offset_ms);
        if adjusted_start_ms < 0 || duration_ms <= 0 {
            continue;
        }
        let words = parse_krc_words(&line[close_bracket + 1..], adjusted_start_ms);
        if words.is_empty() {
            continue;
        }
        let text = words
            .iter()
            .map(|word| word.text.as_str())
            .collect::<String>();
        if text.trim().is_empty() {
            continue;
        }
        let words_end_ms = words
            .iter()
            .map(|word| word.end_ms)
            .max()
            .unwrap_or(adjusted_start_ms);
        lines.push(TimedLyricLine {
            text,
            start_ms: adjusted_start_ms,
            end_ms: (adjusted_start_ms + duration_ms).max(words_end_ms),
            words,
        });
    }
    lines.sort_by_key(|line| line.start_ms);
    Ok(lines)
}

fn parse_krc_words(payload: &str, line_start_ms: i64) -> Vec<TimedLyricWord> {
    let mut words = Vec::new();
    let mut cursor = 0;
    while cursor < payload.len() {
        let Some(open_offset) = payload[cursor..].find('<') else {
            break;
        };
        let open = cursor + open_offset;
        let Some(close_offset) = payload[open + 1..].find('>') else {
            break;
        };
        let close = open + 1 + close_offset;
        let timing = &payload[open + 1..close];
        let mut timing_parts = timing.split(',');
        let offset_ms = timing_parts
            .next()
            .and_then(|value| value.parse::<i64>().ok());
        let duration_ms = timing_parts
            .next()
            .and_then(|value| value.parse::<i64>().ok());
        let text_start = close + 1;
        let text_end = payload[text_start..]
            .find('<')
            .map(|offset| text_start + offset)
            .unwrap_or(payload.len());
        if let (Some(offset_ms), Some(duration_ms)) = (offset_ms, duration_ms) {
            let text = payload[text_start..text_end].to_string();
            if !text.is_empty() && offset_ms >= 0 && duration_ms > 0 {
                words.push(TimedLyricWord {
                    text,
                    start_ms: line_start_ms + offset_ms,
                    end_ms: line_start_ms + offset_ms + duration_ms,
                });
            }
        }
        cursor = text_end.max(close + 1);
    }
    words
}

fn api_error(status: StatusCode, message: impl Into<String>) -> HandlerError {
    (
        status,
        Json(ApiError {
            error: message.into(),
        }),
    )
}

fn select_candidate<'a>(
    candidates: &'a [AmllSearchItem],
    title: &str,
    artist: &str,
) -> Option<&'a AmllSearchItem> {
    let wanted_title = normalize_match_text(title);
    let wanted_artist = normalize_match_text(artist);
    candidates
        .iter()
        .filter(|candidate| {
            normalize_match_text(&candidate.title) == wanted_title
                && artist_matches(&candidate.artist, &wanted_artist)
        })
        .max_by(|left, right| {
            candidate_score(left, &wanted_artist)
                .partial_cmp(&candidate_score(right, &wanted_artist))
                .unwrap_or(Ordering::Equal)
        })
}

fn artist_matches(candidate_artist: &str, wanted_artist: &str) -> bool {
    let wanted_artist = normalize_match_text(wanted_artist);
    if wanted_artist.is_empty() {
        return true;
    }
    let candidate_artist = normalize_match_text(candidate_artist);
    !candidate_artist.is_empty()
        && (candidate_artist == wanted_artist
            || candidate_artist.contains(&wanted_artist)
            || wanted_artist.contains(&candidate_artist))
}

fn duration_matches(candidate_duration_ms: i64, requested_duration_ms: Option<i64>) -> bool {
    let Some(requested_duration_ms) = requested_duration_ms.filter(|duration| *duration > 0) else {
        return true;
    };
    if candidate_duration_ms <= 0 {
        return false;
    }
    let tolerance_ms = 12_000.max(requested_duration_ms / 20);
    (candidate_duration_ms - requested_duration_ms).abs() <= tolerance_ms
}

fn timeline_fits_requested_duration(
    lines: &[TimedLyricLine],
    requested_duration_ms: Option<i64>,
) -> bool {
    let Some(requested_duration_ms) = requested_duration_ms.filter(|duration| *duration > 0) else {
        return true;
    };
    let last_lyric_end_ms = lines
        .iter()
        .map(|line| line.end_ms)
        .max()
        .unwrap_or_default();
    // Provider files can carry a short trailing credit, but a lyric timeline tens of
    // seconds longer than the phone track is a different recording/remix.
    last_lyric_end_ms <= requested_duration_ms + 8_000
}

fn candidate_score(candidate: &AmllSearchItem, artist: &str) -> f64 {
    let candidate_artist = normalize_match_text(&candidate.artist);
    let mut score = candidate.score as f64 + 10_000.0;
    if !artist.is_empty() {
        if candidate_artist == artist {
            score += 8_000.0;
        } else if candidate_artist.contains(artist) || artist.contains(&candidate_artist) {
            score += 1_500.0;
        } else {
            score -= 4_000.0;
        }
    }
    score
}

fn lyric_cache_key(title: &str, artist: &str, duration_ms: Option<i64>) -> String {
    format!(
        "{}\n{}\n{}",
        normalize_match_text(title),
        normalize_match_text(artist),
        duration_ms
            .filter(|duration| *duration > 0)
            .unwrap_or_default()
    )
}

fn title_search_candidates(title: &str) -> Vec<String> {
    let title = title.trim();
    let mut candidates = vec![title.to_string()];
    let stripped = strip_trailing_version_suffix(title);
    if !stripped.is_empty() && normalize_match_text(&stripped) != normalize_match_text(title) {
        candidates.push(stripped);
    }
    candidates
}

fn strip_trailing_version_suffix(value: &str) -> String {
    let mut result = value.trim().to_string();
    loop {
        let current = result.trim_end();
        let mut stripped = None;
        for (open, close) in [
            ('(', ')'),
            ('\u{ff08}', '\u{ff09}'),
            ('[', ']'),
            ('\u{3010}', '\u{3011}'),
        ] {
            let Some(without_close) = current.strip_suffix(close) else {
                continue;
            };
            let Some(open_index) = without_close.rfind(open) else {
                continue;
            };
            let qualifier = without_close[open_index + open.len_utf8()..].trim();
            if is_version_qualifier(qualifier) {
                stripped = Some(
                    without_close[..open_index]
                        .trim_end_matches(|ch: char| ch.is_whitespace() || ch == '-' || ch == '_')
                        .to_string(),
                );
            }
            break;
        }
        let Some(next) = stripped else {
            break;
        };
        if next.is_empty() || next == result {
            break;
        }
        result = next;
    }
    result
}

fn is_version_qualifier(value: &str) -> bool {
    if value.is_empty() || value.chars().count() > 24 {
        return false;
    }
    let normalized = normalize_match_text(value);
    normalized.ends_with('\u{7248}')
        || [
            "live",
            "remix",
            "cover",
            "acoustic",
            "slowed",
            "spedup",
            "karaoke",
            "instrumental",
        ]
        .iter()
        .any(|marker| normalized.contains(marker))
}

fn normalize_match_text(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn parse_ttml(xml: &str) -> Result<Vec<TimedLyricLine>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut lines = Vec::new();
    let mut current_line: Option<LineBuilder> = None;
    let mut span_stack: Vec<SpanFrame> = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let name = event.local_name();
                if name.as_ref() == b"p" {
                    let start_ms = attr_time_ms(&event, b"begin")?.unwrap_or(0);
                    let end_ms = attr_time_ms(&event, b"end")?.unwrap_or(start_ms);
                    current_line = Some(LineBuilder {
                        text: String::new(),
                        start_ms,
                        end_ms,
                        words: Vec::new(),
                    });
                    span_stack.clear();
                } else if name.as_ref() == b"span" && current_line.is_some() {
                    let role = attr_string(&event, b"role")?.unwrap_or_default();
                    let inherited_skip = span_stack.last().map(|span| span.skip).unwrap_or(false);
                    let skip = inherited_skip
                        || role.contains("translation")
                        || role.contains("roman")
                        || role.contains("x-bg");
                    span_stack.push(SpanFrame {
                        text: String::new(),
                        start_ms: attr_time_ms(&event, b"begin")?,
                        end_ms: attr_time_ms(&event, b"end")?,
                        skip,
                    });
                }
            }
            Ok(Event::Text(event)) => {
                if let Some(line) = current_line.as_mut() {
                    let decoded = event
                        .decode()
                        .map_err(|error| error.to_string())?
                        .into_owned();
                    if let Some(span) = span_stack.last_mut() {
                        if !span.skip {
                            span.text.push_str(&decoded);
                            line.text.push_str(&decoded);
                        }
                    } else {
                        line.text.push_str(&decoded);
                    }
                }
            }
            Ok(Event::End(event)) => {
                let name = event.local_name();
                if name.as_ref() == b"span" {
                    if let Some(span) = span_stack.pop() {
                        if !span.skip {
                            if let Some(parent) = span_stack.last_mut() {
                                if !parent.skip {
                                    parent.text.push_str(&span.text);
                                }
                            }
                            if let (Some(start_ms), Some(end_ms), Some(line)) =
                                (span.start_ms, span.end_ms, current_line.as_mut())
                            {
                                let text = span.text;
                                if !text.is_empty() && end_ms > start_ms {
                                    line.words.push(TimedLyricWord {
                                        text,
                                        start_ms,
                                        end_ms,
                                    });
                                }
                            }
                        }
                    }
                } else if name.as_ref() == b"p" {
                    if let Some(mut line) = current_line.take() {
                        line.text = line.text.trim().to_string();
                        if line.text.is_empty() {
                            line.text = line.words.iter().map(|word| word.text.as_str()).collect();
                        }
                        line.words.sort_by_key(|word| word.start_ms);
                        if !line.text.is_empty()
                            && !line.words.is_empty()
                            && line.end_ms > line.start_ms
                        {
                            lines.push(TimedLyricLine {
                                text: line.text,
                                start_ms: line.start_ms,
                                end_ms: line.end_ms,
                                words: line.words,
                            });
                        }
                    }
                    span_stack.clear();
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    lines.sort_by_key(|line| line.start_ms);
    Ok(lines)
}

fn attr_string(
    event: &quick_xml::events::BytesStart<'_>,
    local_name: &[u8],
) -> Result<Option<String>, String> {
    for attribute in event.attributes().with_checks(false) {
        let attribute = attribute.map_err(|error| error.to_string())?;
        if attribute.key.local_name().as_ref() == local_name {
            return attribute
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .map(|value| Some(value.into_owned()))
                .map_err(|error| error.to_string());
        }
    }
    Ok(None)
}

fn attr_time_ms(
    event: &quick_xml::events::BytesStart<'_>,
    local_name: &[u8],
) -> Result<Option<i64>, String> {
    attr_string(event, local_name)?
        .map(|value| parse_time_ms(&value))
        .transpose()
}

fn parse_time_ms(value: &str) -> Result<i64, String> {
    let value = value.trim();
    if let Some(milliseconds) = value.strip_suffix("ms") {
        return milliseconds
            .parse::<f64>()
            .map(|number| number.round() as i64)
            .map_err(|error| error.to_string());
    }
    if let Some(seconds) = value.strip_suffix('s') {
        return seconds
            .parse::<f64>()
            .map(|number| (number * 1000.0).round() as i64)
            .map_err(|error| error.to_string());
    }

    let parts: Vec<&str> = value.split(':').collect();
    let seconds = match parts.as_slice() {
        [hours, minutes, seconds] => {
            hours.parse::<f64>().map_err(|error| error.to_string())? * 3600.0
                + minutes.parse::<f64>().map_err(|error| error.to_string())? * 60.0
                + seconds.parse::<f64>().map_err(|error| error.to_string())?
        }
        [minutes, seconds] => {
            minutes.parse::<f64>().map_err(|error| error.to_string())? * 60.0
                + seconds.parse::<f64>().map_err(|error| error.to_string())?
        }
        [seconds] => seconds.parse::<f64>().map_err(|error| error.to_string())?,
        _ => return Err(format!("不支持的时间格式: {value}")),
    };
    Ok((seconds * 1000.0).round() as i64)
}

#[cfg(test)]
mod tests {
    use super::{
        artist_matches, duration_matches, kugou_candidate_score, kugou_title_search_candidates,
        lyric_cache_key, parse_krc, parse_time_ms, parse_ttml, select_kugou_song_candidate,
        timeline_fits_requested_duration, title_search_candidates, KugouCandidate,
        KugouSongCandidate,
    };

    #[test]
    fn parses_clock_time() {
        assert_eq!(parse_time_ms("00:22.402").unwrap(), 22_402);
        assert_eq!(parse_time_ms("1:02.500").unwrap(), 62_500);
    }

    #[test]
    fn parses_word_timing() {
        let xml = r#"<tt><body><div><p begin="00:01.000" end="00:03.000"><span begin="00:01.000" end="00:02.000">你</span> <span begin="00:02.000" end="00:03.000">好</span></p></div></body></tt>"#;
        let lines = parse_ttml(xml).unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "你 好");
        assert_eq!(lines[0].words.len(), 2);
        assert_eq!(lines[0].words[1].start_ms, 2_000);
    }

    #[test]
    fn parses_krc_word_timing() {
        let krc = "[1000,1200]<0,300,0>?<300,400,0>?<700,500,0>?";
        let lines = parse_krc(krc).unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "???");
        assert_eq!(lines[0].words[1].start_ms, 1_300);
        assert_eq!(lines[0].words[2].end_ms, 2_200);
    }

    #[test]
    fn applies_krc_global_offset_to_line_and_words() {
        let krc = "[offset:250]\n[1000,600]<0,300,0>?<300,300,0>?";
        let lines = parse_krc(krc).unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].start_ms, 1_250);
        assert_eq!(lines[0].end_ms, 1_850);
        assert_eq!(lines[0].words[0].start_ms, 1_250);
        assert_eq!(lines[0].words[1].end_ms, 1_850);
    }
    #[test]
    fn strips_only_trailing_version_qualifier() {
        let candidates = title_search_candidates("song (deep version\u{7248})");
        assert_eq!(candidates, vec!["song (deep version\u{7248})", "song"]);
        assert_eq!(
            title_search_candidates("song (chapter 1)"),
            vec!["song (chapter 1)"]
        );
    }

    #[test]
    fn kugou_fallback_strips_provider_subtitle_after_exact_title() {
        assert_eq!(
            kugou_title_search_candidates("song (alternate lyrics)"),
            vec!["song (alternate lyrics)", "song"]
        );
    }

    #[test]
    fn cache_key_separates_different_recording_durations() {
        assert_ne!(
            lyric_cache_key("song", "artist", Some(165_000)),
            lyric_cache_key("song", "artist", Some(189_000))
        );
    }

    #[test]
    fn rejects_different_recording_artist() {
        assert!(artist_matches("artist-a", "artist-a"));
        assert!(!artist_matches("artist-b", "artist-a"));
    }

    #[test]
    fn rejects_large_recording_duration_mismatch() {
        assert!(duration_matches(234_000, Some(234_166)));
        assert!(!duration_matches(284_668, Some(234_166)));
    }

    #[test]
    fn rejects_timeline_running_past_phone_track() {
        let xml = r#"<tt><body><div><p begin="00:01.000" end="04:44.668"><span begin="00:01.000" end="04:44.668">A</span></p></div></body></tt>"#;
        let lines = parse_ttml(xml).unwrap();
        assert!(!timeline_fits_requested_duration(&lines, Some(234_166)));
    }

    #[test]
    fn kugou_song_search_selects_exact_recording_hash() {
        let candidates = vec![
            KugouSongCandidate {
                song_name: "song (live)".to_string(),
                singer_name: "artist".to_string(),
                duration_seconds: 270,
                file_hash: "live".to_string(),
            },
            KugouSongCandidate {
                song_name: "song".to_string(),
                singer_name: "artist".to_string(),
                duration_seconds: 259,
                file_hash: "original".to_string(),
            },
            KugouSongCandidate {
                song_name: "song".to_string(),
                singer_name: "artist".to_string(),
                duration_seconds: 255,
                file_hash: "alternate".to_string(),
            },
        ];
        let selected =
            select_kugou_song_candidate(&candidates, "song", "artist", Some(259_132)).unwrap();
        assert_eq!(selected.file_hash, "original");
    }

    #[test]
    fn kugou_score_prefers_matching_duration_for_same_song() {
        let candidate = |duration: i64| KugouCandidate {
            id: duration.to_string(),
            accesskey: "key".to_string(),
            singer: "artist".to_string(),
            song: "song".to_string(),
            duration,
            score: 10,
            content_format: 1,
        };
        assert!(
            kugou_candidate_score(&candidate(189_466), "artist", Some(189_470))
                > kugou_candidate_score(&candidate(165_000), "artist", Some(189_470))
        );
    }
}
