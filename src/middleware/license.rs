use axum::{
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::Response,
    Json,
};
use serde_json::json;

use crate::AppState;

pub async fn license_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let path = request.uri().path();
    if request.method() == Method::OPTIONS || is_license_bootstrap_path(path) {
        return Ok(next.run(request).await);
    }

    let status = state.license.status();
    if status.valid {
        Ok(next.run(request).await)
    } else {
        Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "code": 40301,
                "message": status.message,
                "data": status,
            })),
        ))
    }
}

fn is_license_bootstrap_path(path: &str) -> bool {
    matches!(
        path,
        "/" | "/health"
            | "/api/v1/health"
            | "/api/v1/license/status"
            | "/api/v1/license/import"
            | "/api/v1/terminals/admission"
    ) || path.starts_with("/static/admin/")
        || path.starts_with("/static/assets/")
        || path.starts_with("/static/libs/")
        || path.starts_with("/assets/")
        || path.starts_with("/libs/")
}

#[cfg(test)]
mod tests {
    use super::is_license_bootstrap_path;

    #[test]
    fn only_license_bootstrap_resources_are_public() {
        assert!(is_license_bootstrap_path("/api/v1/license/status"));
        assert!(is_license_bootstrap_path("/api/v1/terminals/admission"));
        assert!(is_license_bootstrap_path("/static/admin/index.html"));
        assert!(!is_license_bootstrap_path("/api/v1/songs"));
        assert!(!is_license_bootstrap_path("/ws/terminal"));
        assert!(!is_license_bootstrap_path("/YN-song/demo.mp4"));
    }
}
