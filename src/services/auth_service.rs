use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::config::JwtConfig;
use crate::errors::{AppError, AppResult};

/// JWT 声明
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String, // clientId
    pub clientKey: String,
    pub permissions: Vec<String>,
    pub exp: i64,
    pub iat: i64,
}

pub struct AuthService;

impl AuthService {
    /// 生成 JWT Token
    pub fn generate_token(
        config: &JwtConfig,
        clientId: &str,
        clientKey: &str,
        permissions: Vec<String>,
    ) -> AppResult<(String, String)> {
        let now = Utc::now();
        let expire = now + Duration::hours(config.expire_hours as i64);

        let claims = Claims {
            sub: clientId.to_string(),
            clientKey: clientKey.to_string(),
            permissions,
            exp: expire.timestamp(),
            iat: now.timestamp(),
        };

        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(config.secret.as_bytes()),
        )
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Token生成失败: {}", e)))?;

        Ok((token, expire.format("%Y-%m-%d %H:%M:%S").to_string()))
    }

    /// 验证 JWT Token
    pub fn verify_token(config: &JwtConfig, token: &str) -> AppResult<Claims> {
        let claims = decode::<Claims>(
            token,
            &DecodingKey::from_secret(config.secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|e| AppError::Unauthorized(format!("Token无效: {}", e)))?;

        Ok(claims.claims)
    }
}
