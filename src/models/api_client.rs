use serde::{Deserialize, Serialize};

/// API 客户端数据模型
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ApiClient {
    pub id: String,
    pub clientName: String,
    pub clientKey: String,
    #[serde(skip_serializing)]
    pub clientSecret: String,
    pub permissions: String,
    pub rateLimit: i32,
    pub status: i32,
    pub lastAccess: String,
    pub createdAt: String,
    pub updatedAt: String,
}

/// 注册 API 客户端请求
#[derive(Debug, Deserialize)]
pub struct CreateApiClientRequest {
    pub clientName: String,
    /// 登录用户名，必须指定可读名称
    pub clientKey: Option<String>,
    /// 可选：指定登录密码（与 clientKey 同时提供时生效）
    pub clientSecret: Option<String>,
    pub permissions: Option<Vec<String>>,
    pub rateLimit: Option<i32>,
}

/// API 客户端注册响应（包含密钥，仅创建时返回一次）
#[derive(Debug, Serialize)]
pub struct ApiClientCreatedResponse {
    pub id: String,
    pub clientName: String,
    pub clientKey: String,
    pub clientSecret: String,
    pub permissions: Vec<String>,
}

/// 更新 API 客户端请求
#[derive(Debug, Deserialize)]
pub struct UpdateApiClientRequest {
    pub clientName: Option<String>,
    pub permissions: Option<Vec<String>>,
    pub rateLimit: Option<i32>,
    pub status: Option<i32>,
    /// 可选：新密码（重置密码时填写）
    pub clientSecret: Option<String>,
}

/// API 认证请求
#[derive(Debug, Deserialize)]
pub struct AuthRequest {
    pub clientKey: String,
    pub clientSecret: String,
}

/// API 认证响应
#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub expireAt: String,
}
