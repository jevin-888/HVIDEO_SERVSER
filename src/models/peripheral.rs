use serde::{Deserialize, Serialize};

/// 外设品类预设（灯光 / 音效 / 空调）
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PeripheralPreset {
    pub id: String,
    /// 'light' | 'effect' | 'ac'
    pub presetType: String,
    pub name: String,
    /// JSON 字符串：灯光 {ctrlType,code}；音效 {mode}；空调 {power,temp,mode}
    pub settings: String,
    pub sortOrder: i32,
    pub createdAt: String,
    pub updatedAt: String,
}

/// 创建品类预设
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePresetRequest {
    pub presetType: String,
    pub name: String,
    pub settings: serde_json::Value,
    pub sortOrder: Option<i32>,
}

/// 更新品类预设
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePresetRequest {
    pub name: Option<String>,
    pub settings: Option<serde_json::Value>,
    pub sortOrder: Option<i32>,
}
