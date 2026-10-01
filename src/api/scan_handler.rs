/// 歌曲路径自动匹配 API 处理器
///
/// GET  /api/v1/songdb/scan/fs          - 列出驱动器或目录内容
/// POST /api/v1/songdb/scan/start       - 启动扫描任务
/// GET  /api/v1/songdb/scan/progress/{task_id}
/// GET  /api/v1/songdb/scan/result/{task_id}
/// POST /api/v1/songdb/scan/cancel/{task_id}
use std::collections::HashMap;
use std::path::Path as FsPath;

use axum::{
    extract::{Path, Query, State},
    Json,
};

use crate::errors::{AppError, AppResult};
use crate::models::common::ApiResponse;
use crate::models::scan_task::{ScanProgress, ScanTask, StartScanRequest};
use crate::AppState;

/// GET /api/v1/songdb/scan/fs?path= - 浏览服务器文件系统
///
/// - path 为空：返回所有根驱动器（Windows: C:\, D:\... / Linux/Mac: /）
/// - path 非空：返回该路径下的子目录列表
pub async fn list_fs(
    Query(params): Query<HashMap<String, String>>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let req_path = params
        .get("path")
        .map(|s| s.trim())
        .unwrap_or("")
        .to_string();

    if req_path.is_empty() {
        // 返回根目录列表
        let roots = list_root_dirs();
        return Ok(Json(ApiResponse::success(serde_json::json!({
            "path": "",
            "parent": null,
            "entries": roots
        }))));
    }

    let dir = FsPath::new(&req_path);
    if !dir.is_dir() {
        return Err(AppError::BadRequest(format!(
            "路径不存在或不是目录: {}",
            req_path
        )));
    }

    let mut entries: Vec<serde_json::Value> = Vec::new();
    match std::fs::read_dir(dir) {
        Ok(iter) => {
            for entry in iter.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !name.starts_with('.') {
                        entries.push(serde_json::json!({
                            "name": name,
                            "path": path.to_string_lossy()
                        }));
                    }
                }
            }
            entries.sort_by(|a, b| {
                a["name"]
                    .as_str()
                    .unwrap_or("")
                    .cmp(b["name"].as_str().unwrap_or(""))
            });
        }
        Err(e) => {
            return Err(AppError::BadRequest(format!("无法读取目录: {}", e)));
        }
    }

    // 计算父路径
    let parent = dir.parent().map(|p| p.to_string_lossy().to_string());

    Ok(Json(ApiResponse::success(serde_json::json!({
        "path": req_path,
        "parent": parent,
        "entries": entries
    }))))
}

/// 获取系统根目录列表
fn list_root_dirs() -> Vec<serde_json::Value> {
    #[cfg(target_os = "windows")]
    {
        // 系统盘符（通常是 C:\，取环境变量 SYSTEMDRIVE 兜底）
        let sys_drive = std::env::var("SYSTEMDRIVE")
            .unwrap_or_else(|_| "C:".to_string())
            .to_uppercase();
        ('A'..='Z')
            .filter_map(|c| {
                let root = format!("{}:\\", c);
                let letter = format!("{}:", c);
                if FsPath::new(&root).is_dir() && letter != sys_drive {
                    Some(serde_json::json!({ "name": root.clone(), "path": root }))
                } else {
                    None
                }
            })
            .collect()
    }
    #[cfg(not(target_os = "windows"))]
    {
        // 系统路径前缀，跳过这些挂载点
        const SYS_PREFIXES: &[&str] = &["/proc", "/sys", "/dev", "/run", "/snap", "/boot", "/tmp"];
        // 读取 /proc/mounts 获取所有已挂载分区
        let mut seen = std::collections::HashSet::new();
        let mut roots: Vec<serde_json::Value> = Vec::new();

        if let Ok(content) = std::fs::read_to_string("/proc/mounts") {
            for line in content.lines() {
                let mut cols = line.split_whitespace();
                let _device = cols.next().unwrap_or("");
                let mount_point = cols.next().unwrap_or("");
                let fs_type = cols.next().unwrap_or("");

                // 跳过虚拟文件系统和系统路径
                if matches!(
                    fs_type,
                    "proc"
                        | "sysfs"
                        | "devtmpfs"
                        | "devpts"
                        | "tmpfs"
                        | "cgroup"
                        | "cgroup2"
                        | "pstore"
                        | "efivarfs"
                        | "hugetlbfs"
                        | "mqueue"
                        | "debugfs"
                        | "tracefs"
                        | "securityfs"
                        | "fusectl"
                        | "bpf"
                        | "autofs"
                        | "squashfs"
                ) {
                    continue;
                }
                if SYS_PREFIXES.iter().any(|p| mount_point.starts_with(p)) {
                    continue;
                }
                if mount_point == "/" || !FsPath::new(mount_point).is_dir() {
                    continue;
                }
                if seen.insert(mount_point.to_string()) {
                    roots.push(serde_json::json!({
                        "name": mount_point,
                        "path": mount_point
                    }));
                }
            }
        }

        // 若未读到任何有效挂载点，回退到常见目录
        if roots.is_empty() {
            for dir in &["/mnt", "/media", "/Volumes", "/data", "/storage"] {
                if FsPath::new(dir).is_dir() {
                    roots.push(serde_json::json!({ "name": dir, "path": dir }));
                }
            }
        }

        roots
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartScanResponse {
    pub task_id: String,
}

/// POST /api/v1/songdb/scan/start - 启动扫描任务
pub async fn start_scan(
    State(state): State<AppState>,
    Json(req): Json<StartScanRequest>,
) -> AppResult<Json<ApiResponse<StartScanResponse>>> {
    let task_id = state
        .scan_service
        .start_scan(state.song_db.clone(), req)
        .await
        .map_err(AppError::BadRequest)?;

    Ok(Json(ApiResponse::success(StartScanResponse { task_id })))
}

/// GET /api/v1/songdb/scan/progress/{task_id} - 查询任务进度
pub async fn get_progress(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> AppResult<Json<ApiResponse<ScanProgress>>> {
    let progress = state
        .scan_service
        .get_progress(&task_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("任务不存在: {}", task_id)))?;

    Ok(Json(ApiResponse::success(progress)))
}

/// GET /api/v1/songdb/scan/result/{task_id} - 获取任务结果
pub async fn get_result(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> AppResult<Json<ApiResponse<ScanTask>>> {
    let task = state
        .scan_service
        .get_task(&task_id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("任务不存在: {}", task_id)))?;

    Ok(Json(ApiResponse::success(task)))
}

/// POST /api/v1/songdb/scan/cancel/{task_id} - 取消任务
pub async fn cancel_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    state
        .scan_service
        .cancel_task(&task_id)
        .await
        .map_err(|e| AppError::BadRequest(e))?;

    Ok(Json(ApiResponse::success(())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_scan_response_uses_canonical_task_id_field() {
        let response = ApiResponse::success(StartScanResponse {
            task_id: "scan-task-1".to_string(),
        });
        let value = serde_json::to_value(response).unwrap();

        assert_eq!(value["data"]["taskId"], "scan-task-1");
        assert!(value["data"].get("task_id").is_none());
    }
}
