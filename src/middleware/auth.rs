use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
    Json,
};
use serde_json::json;

use crate::services::auth_service::AuthService;
use crate::AppState;

/// JWT 认证中间件 — 通过 State 获取配置
pub async fn auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    // PAD needs to obtain the server-managed terminal list before a user has
    // selected a device or established an authenticated admin session.
    if request.uri().path() == "/api/v1/terminals/pad-list" {
        return Ok(next.run(request).await);
    }
    // 尝试从 Authorization Header 获取 Token
    let auth_header = request
        .headers()
        .get("Authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));

    // 如果 Header 没找到，尝试从 Query 参数解析（EventSource/SSE 场景）
    // 正确解析 query string：按 '&' 分割后再按 '=' 分割，避免 trim_start_matches 的字符集陷阱
    let query_token_owned: Option<String> = if auth_header.is_none() {
        request.uri().query().and_then(|q| {
            q.split('&').find_map(|pair| {
                let mut parts = pair.splitn(2, '=');
                let key = parts.next().unwrap_or("");
                let val = parts.next().unwrap_or("");
                if key == "token" && !val.is_empty() {
                    Some(val.to_owned())
                } else {
                    None
                }
            })
        })
    } else {
        None
    };

    let token: Option<&str> = auth_header.or(query_token_owned.as_deref());

    let token = match token {
        Some(t) => t,
        None => {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(json!({ "code": 401, "message": "缺少认证Token" })),
            ))
        }
    };

    match AuthService::verify_token(&state.config.jwt, token) {
        Ok(claims) => {
            let mut request = request;
            request.extensions_mut().insert(claims);
            Ok(next.run(request).await)
        }
        Err(_) => Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "code": 401, "message": "Token无效或已过期" })),
        )),
    }
}
