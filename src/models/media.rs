use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Material {
    pub id: String,
    pub name: String,
    pub categoryId: String,
    pub categoryName: String,
    pub url: String,
    pub cover: Option<String>,
    pub duration: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MaterialCategory {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Stream {
    pub id: String,
    pub name: String,
    pub url: String,
    pub cover: Option<String>,
    pub category: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayMediaRequest {
    pub mediaId: String,
    pub mediaType: String, // "material" or "stream"
}
