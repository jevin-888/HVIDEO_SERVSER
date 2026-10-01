use crate::{
    errors::{AppError, AppResult},
    models::common::ApiResponse,
    services::{
        app_update_service::{self as updates, AppUpdateTask},
        auth_service::Claims,
        terminal_service::TerminalService,
    },
    AppState,
};
use axum::{
    extract::{Extension, Multipart, Path, State},
    Json,
};
use std::collections::HashSet;
use tokio::io::AsyncWriteExt;

fn authorize(claims: &Claims) -> AppResult<()> {
    if claims.permissions.iter().any(|p| p == "admin") {
        Ok(())
    } else {
        Err(AppError::Forbidden("APP 更新仅限管理员操作".into()))
    }
}

pub async fn latest_update(
    Extension(claims): Extension<Claims>,
) -> AppResult<Json<ApiResponse<Option<AppUpdateTask>>>> {
    authorize(&claims)?;
    Ok(Json(ApiResponse::success(updates::latest().await)))
}

pub async fn get_update(
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<AppUpdateTask>>> {
    authorize(&claims)?;
    Ok(Json(ApiResponse::success(updates::get(&id).await?)))
}

pub async fn start_update(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    mut multipart: Multipart,
) -> AppResult<Json<ApiResponse<AppUpdateTask>>> {
    authorize(&claims)?;
    let permit = updates::UPDATE_SLOT
        .try_acquire()
        .map_err(|_| AppError::Conflict("已有 APP 上传或安装任务，请等待完成".into()))?;
    let mut terminal_ids: Option<Vec<String>> = None;
    let mut adb_port: Option<u16> = None;
    let mut allow_downgrade: Option<bool> = None;
    let mut apk = None;
    let mut file_name = String::new();
    while let Some(mut field) = multipart.next_field().await? {
        match field.name().unwrap_or("") {
            "terminalIds" if terminal_ids.is_none() => {
                let bytes = field.bytes().await?;
                if bytes.len() > 8192 {
                    return Err(AppError::BadRequest("设备列表过长".into()));
                }
                terminal_ids = Some(serde_json::from_slice(&bytes).map_err(|_| {
                    AppError::BadRequest("terminalIds 必须为设备 ID 字符串数组".into())
                })?);
            }
            "adbPort" if adb_port.is_none() => {
                let value = field.text().await?;
                adb_port = Some(
                    value
                        .parse::<u16>()
                        .ok()
                        .filter(|p| *p > 0)
                        .ok_or_else(|| AppError::BadRequest("ADB 端口必须为 1–65535".into()))?,
                );
            }
            "allowDowngrade" if allow_downgrade.is_none() => {
                let value = field.text().await?;
                allow_downgrade = Some(value.parse::<bool>().map_err(|_| {
                    AppError::BadRequest("allowDowngrade 必须为 true 或 false".into())
                })?);
            }
            "apk" if apk.is_none() => {
                file_name = field
                    .file_name()
                    .unwrap_or("")
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or("")
                    .to_string();
                if !file_name.to_ascii_lowercase().ends_with(".apk") {
                    return Err(AppError::BadRequest("请选择 .apk 安装包".into()));
                }
                let temp = tempfile::Builder::new()
                    .prefix("hvideo-app-update-")
                    .suffix(".apk")
                    .tempfile()?;
                let mut output = tokio::fs::File::from_std(temp.reopen()?);
                let mut size = 0usize;
                while let Some(chunk) = field.chunk().await? {
                    size += chunk.len();
                    if size > updates::MAX_APK_SIZE {
                        return Err(AppError::BadRequest("APK 不能超过 300 MB".into()));
                    }
                    output.write_all(&chunk).await?;
                }
                output.flush().await?;
                drop(output);
                if size == 0 {
                    return Err(AppError::BadRequest("APK 文件为空".into()));
                }
                apk = Some(temp.into_temp_path());
            }
            _ => return Err(AppError::BadRequest("请求含未知字段或重复字段".into())),
        }
    }
    let ids = terminal_ids.ok_or_else(|| AppError::BadRequest("请选择设备".into()))?;
    if ids.is_empty() || ids.len() > 50 || ids.iter().collect::<HashSet<_>>().len() != ids.len() {
        return Err(AppError::BadRequest(
            "请选择 1–50 台设备，设备 ID 不可重复".into(),
        ));
    }
    let mut terminals = Vec::with_capacity(ids.len());
    for id in ids {
        let terminal = TerminalService::get_by_id(&state.db, &id).await?;
        let ip = terminal.terminalIp.parse::<std::net::Ipv4Addr>().ok();
        if terminal.onlineStatus != 1
            || ip.is_none_or(|ip| {
                ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() || ip.is_broadcast()
            })
        {
            return Err(AppError::BadRequest(format!(
                "设备 {} 已离线或 IP 无效，请刷新后重试",
                terminal.name
            )));
        }
        terminals.push(terminal);
    }
    let apk = apk.ok_or_else(|| AppError::BadRequest("请选择 APK 安装包".into()))?;
    let apk = tokio::task::spawn_blocking(move || {
        updates::validate_apk(&apk)?;
        Ok::<_, String>(apk)
    })
    .await
    .map_err(|e| AppError::Internal(e.into()))?
    .map_err(AppError::BadRequest)?;
    let adb = updates::adb_path();
    updates::preflight(&adb).await?;
    let task = updates::start(
        terminals,
        file_name,
        adb_port.unwrap_or(5555),
        allow_downgrade.unwrap_or(false),
        apk,
        adb,
        permit,
        state.db.clone(),
        claims.sub,
    )
    .await;
    Ok(Json(ApiResponse::success(task)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_update_requires_admin_not_a_read_or_write_client() {
        let mut claims = Claims {
            sub: "test".into(),
            clientKey: "test".into(),
            permissions: vec!["read".into(), "write".into()],
            exp: 0,
            iat: 0,
        };
        assert!(matches!(authorize(&claims), Err(AppError::Forbidden(_))));
        claims.permissions.push("admin".into());
        assert!(authorize(&claims).is_ok());
    }
}
