use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouTubeSearchResult {
    pub id: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub duration: Option<String>,
    pub channel: Option<String>,
}

#[derive(Deserialize)]
pub struct YoutubeSearchParams {
    pub q: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeParseParams {
    /// Exactly one 11-character YouTube video ID, shared by parse and stream.
    pub videoId: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeQueueRequest {
    pub videoId: String,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub isPriority: Option<bool>,
}
