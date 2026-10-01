use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// 全局错误类型
#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum AppError {
    #[error("未找到: {0}")]
    NotFound(String),

    #[error("参数错误: {0}")]
    BadRequest(String),

    #[error("认证失败: {0}")]
    Unauthorized(String),

    #[error("权限不足: {0}")]
    Forbidden(String),

    #[error("资源冲突: {0}")]
    Conflict(String),

    #[error("数据库错误: {0}")]
    Database(#[from] sqlx::Error),

    #[error("内部错误: {0}")]
    Internal(#[from] anyhow::Error),

    #[error("IO错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("请求解析错误: {0}")]
    Multipart(#[from] axum::extract::multipart::MultipartError),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, 404, msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, 400, msg.clone()),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, 401, msg.clone()),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, 403, msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, 409, msg.clone()),
            AppError::Database(e) => {
                tracing::error!("数据库错误: {:?}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    500,
                    format!("数据库操作失败: {}", e),
                )
            }
            AppError::Internal(e) => {
                tracing::error!("内部错误: {:?}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    500,
                    "内部服务器错误".to_string(),
                )
            }
            AppError::Io(e) => {
                tracing::error!("IO错误: {:?}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    500,
                    "文件操作失败".to_string(),
                )
            }
            AppError::Multipart(e) => {
                tracing::error!("请求解析错误: {:?}", e);
                (StatusCode::BAD_REQUEST, 400, "请求格式错误".to_string())
            }
        };

        let body = Json(json!({
            "code": code,
            "message": message,
        }));

        (status, body).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
