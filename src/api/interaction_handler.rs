use crate::AppState;
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::IntoResponse,
};
use reqwest::Client;
use std::collections::HashMap;

/// 代理请求到互动平台 (CORS 转发)
pub async fn proxy_request(
    State(_state): State<AppState>,
    method: Method,
    Path(path): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    // 建议在生产环境将 client 存入 State 中复用
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .danger_accept_invalid_certs(true) // 提高内网/测试环境兼容性
        .build()
        .unwrap_or_else(|_| Client::new());

    let target_url = format!("https://app.eu14.cn/api/{}", path);

    // 构造转发请求
    let mut req_builder = client.request(method, &target_url).query(&params);

    // 转发关键业务头
    if let Some(auth) = headers.get("Authorization") {
        req_builder = req_builder.header("Authorization", auth);
    }
    if let Some(ct) = headers.get("Content-Type") {
        req_builder = req_builder.header("Content-Type", ct);
    }

    // 注入云端防盗链/安全头
    req_builder = req_builder
        .header("Host", "app.eu14.cn")
        .header("Origin", "https://app.eu14.cn")
        .header("Referer", "https://app.eu14.cn/");

    // 原样透传请求体，确保 JSON 与 multipart/form-data 的边界和内容一对一。
    if !body.is_empty() {
        req_builder = req_builder.body(body);
    }

    // 执行请求
    match req_builder.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
            let mut res_headers = HeaderMap::new();

            // 简单添加跨域头
            res_headers.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
            res_headers.insert(
                "Access-Control-Allow-Headers",
                HeaderValue::from_static("*"),
            );

            // 解析体
            match resp.text().await {
                Ok(text) => (status, res_headers, text).into_response(),
                Err(e) => {
                    tracing::error!("读取上游响应体失败: {:?}", e);
                    (StatusCode::BAD_GATEWAY, "Failed to read upstream body").into_response()
                }
            }
        }
        Err(e) => {
            tracing::error!("互动云代理失败 [{}]: {:?}", target_url, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Proxy error: {}", e),
            )
                .into_response()
        }
    }
}
