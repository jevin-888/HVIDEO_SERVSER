use axum::{
    extract::{ConnectInfo, State},
    Json,
};
use serde::Deserialize;
use std::net::IpAddr;

use crate::{
    errors::{AppError, AppResult},
    models::common::ApiResponse,
    AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportLicenseRequest {
    pub content: String,
}

/// GET /api/v1/license/status - Return machine code and current server license state.
pub async fn get_status(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<crate::license::LicenseStatus>>> {
    Ok(Json(ApiResponse::success(state.license.status())))
}

/// POST /api/v1/license/import - Import a signed license from the server machine only.
pub async fn import_license(
    State(state): State<AppState>,
    ConnectInfo(remote): ConnectInfo<std::net::SocketAddr>,
    Json(request): Json<ImportLicenseRequest>,
) -> AppResult<Json<ApiResponse<crate::license::LicenseStatus>>> {
    if !is_license_import_source_allowed(remote.ip()) {
        return Err(AppError::Forbidden(
            "授权文件只能在服务器本机导入".to_string(),
        ));
    }
    if request.content.trim().is_empty() {
        return Err(AppError::BadRequest("授权文件内容不能为空".to_string()));
    }
    let status = state
        .license
        .import(&request.content)
        .map_err(AppError::BadRequest)?;
    tracing::info!(
        "服务器授权已导入: machine_code={}, status={}",
        status.machine_code,
        status.status
    );
    Ok(Json(ApiResponse::success(status)))
}

fn is_license_import_source_allowed(ip: IpAddr) -> bool {
    ip.is_loopback() || crate::net_utils::is_local_ip(&ip.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_license_import_source_allowed;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn license_import_allows_ipv4_loopback() {
        assert!(is_license_import_source_allowed(IpAddr::V4(
            Ipv4Addr::LOCALHOST,
        )));
    }

    #[test]
    fn license_import_allows_ipv6_loopback() {
        assert!(is_license_import_source_allowed(IpAddr::V6(
            Ipv6Addr::LOCALHOST,
        )));
    }

    #[test]
    fn license_import_rejects_non_local_address() {
        assert!(!is_license_import_source_allowed(IpAddr::V6(
            "2001:db8::1".parse().expect("valid documentation address"),
        )));
    }
}
