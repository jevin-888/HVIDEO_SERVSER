use axum::{
    extract::{Multipart, Path, Query, State},
    Json,
};

use crate::errors::{AppError, AppResult};
use crate::models::common::ApiResponse;
use crate::models::singer_image_match::{
    SingerImageMatchProgress, SingerImageMatchTask, StartSingerImageMatchRequest,
};
use crate::models::singer_import::SingerImportTask;
use crate::models::song_db_models::*;
use crate::models::song_import::SongImportTask;
use crate::services::singer_data_import_service::SingerDataImportService;
use crate::services::song_data_import_service::SongDataImportService;
use crate::services::song_db_service::SongDbService;
use crate::AppState;

// ==================== 歌曲 ====================

/// GET /api/v1/songdb/warmup - 预热歌曲库搜索缓存
pub async fn warmup(State(state): State<AppState>) -> AppResult<Json<ApiResponse<()>>> {
    SongDbService::warmup(&state.song_db).await?;
    Ok(Json(ApiResponse::success(())))
}

/// GET /api/v1/songdb/songs - 搜索歌曲
pub async fn search_songs(
    State(state): State<AppState>,
    Query(query): Query<SongSearchQuery>,
) -> AppResult<Json<ApiResponse<SongSearchResult<SongEntry>>>> {
    let result = SongDbService::search_songs(&state.song_db, query).await?;
    Ok(Json(ApiResponse::success(result)))
}

/// GET /api/v1/songdb/songs/:id - 获取歌曲详情
pub async fn get_song(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(query): Query<SongDetailQuery>,
) -> AppResult<Json<ApiResponse<SongEntry>>> {
    let song =
        SongDbService::get_song(&state.song_db, id, query.available_only.unwrap_or(true)).await?;
    Ok(Json(ApiResponse::success(song)))
}

/// POST /api/v1/songdb/songs - 添加歌曲
pub async fn create_song(
    State(state): State<AppState>,
    Json(req): Json<CreateSongRequest>,
) -> AppResult<Json<ApiResponse<SongEntry>>> {
    let song = SongDbService::create_song(&state.song_db, req).await?;
    Ok(Json(ApiResponse::success(song)))
}

/// PUT /api/v1/songdb/songs/:id - 更新歌曲
pub async fn update_song(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateSongRequest>,
) -> AppResult<Json<ApiResponse<SongEntry>>> {
    let song = SongDbService::update_song(&state.song_db, id, req).await?;
    Ok(Json(ApiResponse::success(song)))
}

/// DELETE /api/v1/songdb/songs/:id - 删除歌曲
pub async fn delete_song(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<Json<ApiResponse<()>>> {
    SongDbService::delete_song(&state.song_db, id).await?;
    Ok(Json(ApiResponse::success(())))
}

// ==================== 歌星 ====================

/// GET /api/v1/songdb/singers - 搜索歌星
pub async fn search_singers(
    State(state): State<AppState>,
    Query(query): Query<SingerSearchQuery>,
) -> AppResult<Json<ApiResponse<SingerSearchResult<SingerEntry>>>> {
    let result = SongDbService::search_singers(&state.song_db, query).await?;
    Ok(Json(ApiResponse::success(result)))
}

/// GET /api/v1/songdb/singers/:id - 获取歌星详情
pub async fn get_singer(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<Json<ApiResponse<SingerEntry>>> {
    let singer = SongDbService::get_singer(&state.song_db, id).await?;
    Ok(Json(ApiResponse::success(singer)))
}

/// POST /api/v1/songdb/singers - 添加歌星
pub async fn create_singer(
    State(state): State<AppState>,
    Json(req): Json<CreateSingerRequest>,
) -> AppResult<Json<ApiResponse<SingerEntry>>> {
    let singer = SongDbService::create_singer(&state.song_db, req).await?;
    Ok(Json(ApiResponse::success(singer)))
}

/// PUT /api/v1/songdb/singers/:id - 更新歌星
pub async fn update_singer(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateSingerRequest>,
) -> AppResult<Json<ApiResponse<SingerEntry>>> {
    let singer = SongDbService::update_singer(&state.song_db, id, req).await?;
    Ok(Json(ApiResponse::success(singer)))
}

/// DELETE /api/v1/songdb/singers/:id - 删除歌星
pub async fn delete_singer(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<Json<ApiResponse<()>>> {
    SongDbService::delete_singer(&state.song_db, id).await?;
    Ok(Json(ApiResponse::success(())))
}

/// POST /api/v1/songdb/singers/:id/image - 上传歌星图片
pub async fn upload_singer_image(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    mut multipart: Multipart,
) -> AppResult<Json<ApiResponse<()>>> {
    let singer = SongDbService::get_singer(&state.song_db, id).await.ok();
    let identifier = singer
        .and_then(|s| s.singer_no)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| id.to_string());

    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        if let Some(fileName) = field.file_name() {
            let _ext = std::path::Path::new(fileName)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("jpg");
            let data = field.bytes().await.unwrap_or_default();

            // 直接保存为 {identifier}.jpg
            let save_path = format!("static/singer-all/{}.jpg", identifier);

            // 确保目录存在
            let _ = tokio::fs::create_dir_all("static/singer-all").await;

            if let Err(e) = tokio::fs::write(&save_path, data).await {
                tracing::error!("保存歌手图片失败: {}", e);
                return Err(crate::errors::AppError::Io(e));
            }
            break;
        }
    }

    Ok(Json(ApiResponse::success(())))
}

/// GET /api/v1/songdb/singers/:id/songs - 歌星的歌曲列表
pub async fn get_singer_songs(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(query): Query<SongSearchQuery>,
) -> AppResult<Json<ApiResponse<SongSearchResult<SongEntry>>>> {
    // 先获取歌星信息得到 singerNo
    let singer = SongDbService::get_singer(&state.song_db, id).await?;
    let singer_no = singer.singer_no.unwrap_or_default();
    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.unwrap_or(20);
    let result =
        SongDbService::get_singer_songs(&state.song_db, &singer_no, page, page_size).await?;
    Ok(Json(ApiResponse::success(result)))
}

// ==================== 统计 ====================

/// GET /api/v1/songdb/stats - 获取统计
pub async fn get_stats(State(state): State<AppState>) -> AppResult<Json<ApiResponse<SongDbStats>>> {
    let stats = SongDbService::get_stats(&state.song_db).await?;
    Ok(Json(ApiResponse::success(stats)))
}

// ==================== 歌曲/歌星批量导入与歌星图片对照 ====================

/// POST /api/v1/songdb/import - 上传整理好的 XLSX 并启动后台歌曲导入任务。
pub async fn import_song_catalog(
    State(state): State<AppState>,
    multipart: Multipart,
) -> AppResult<Json<ApiResponse<SongImportTask>>> {
    let (file_name, temp_path) =
        save_xlsx_upload(multipart, "hvideo-song-imports", "songs.xlsx", "歌曲").await?;
    let task = SongDataImportService::create_task(&state.song_db, &file_name, temp_path).await?;
    Ok(Json(ApiResponse::success(task)))
}

/// GET /api/v1/songdb/import/tasks/:taskId - 查询歌曲导入进度。
pub async fn get_song_import_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> AppResult<Json<ApiResponse<SongImportTask>>> {
    let task = SongDataImportService::get_task(&state.song_db, &task_id).await?;
    Ok(Json(ApiResponse::success(task)))
}

/// GET /api/v1/songdb/import/active - 查询当前活动歌曲导入任务。
pub async fn get_active_song_import(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Option<SongImportTask>>>> {
    let task = SongDataImportService::get_active_task(&state.song_db).await?;
    Ok(Json(ApiResponse::success(task)))
}

/// POST /api/v1/songdb/singers/import - 上传歌星 XLSX 并启动后台导入任务。
pub async fn import_singer_catalog(
    State(state): State<AppState>,
    multipart: Multipart,
) -> AppResult<Json<ApiResponse<SingerImportTask>>> {
    let (file_name, temp_path) =
        save_xlsx_upload(multipart, "hvideo-singer-imports", "singers.xlsx", "歌星").await?;
    let task = SingerDataImportService::create_task(&state.song_db, &file_name, temp_path).await?;
    Ok(Json(ApiResponse::success(task)))
}

/// GET /api/v1/songdb/singers/import/tasks/:taskId - 查询歌星导入进度。
pub async fn get_singer_import_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> AppResult<Json<ApiResponse<SingerImportTask>>> {
    let task = SingerDataImportService::get_task(&state.song_db, &task_id).await?;
    Ok(Json(ApiResponse::success(task)))
}

/// GET /api/v1/songdb/singers/import/active - 查询当前活动歌星导入任务。
pub async fn get_active_singer_import(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Option<SingerImportTask>>>> {
    let task = SingerDataImportService::get_active_task(&state.song_db).await?;
    Ok(Json(ApiResponse::success(task)))
}

/// POST /api/v1/songdb/singers/image-match/start - 启动歌星图片对照。
pub async fn start_singer_image_match(
    State(state): State<AppState>,
    Json(req): Json<StartSingerImageMatchRequest>,
) -> AppResult<Json<ApiResponse<SingerImageMatchTask>>> {
    let task = state
        .singer_image_match_service
        .start_match(state.song_db.clone(), req)
        .await?;
    Ok(Json(ApiResponse::success(task)))
}

/// GET /api/v1/songdb/singers/image-match/progress/:taskId - 查询歌星图片对照进度。
pub async fn get_singer_image_match_progress(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> AppResult<Json<ApiResponse<SingerImageMatchProgress>>> {
    let task = state.singer_image_match_service.get_task(&task_id)?;
    Ok(Json(ApiResponse::success(task.progress)))
}

/// GET /api/v1/songdb/singers/image-match/result/:taskId - 查询歌星图片对照结果。
pub async fn get_singer_image_match_result(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> AppResult<Json<ApiResponse<SingerImageMatchTask>>> {
    let task = state.singer_image_match_service.get_task(&task_id)?;
    Ok(Json(ApiResponse::success(task)))
}

/// POST /api/v1/songdb/singers/image-match/cancel/:taskId - 取消歌星图片对照。
pub async fn cancel_singer_image_match(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> AppResult<Json<ApiResponse<SingerImageMatchTask>>> {
    let task = state.singer_image_match_service.cancel(&task_id)?;
    Ok(Json(ApiResponse::success(task)))
}

async fn save_xlsx_upload(
    mut multipart: Multipart,
    temp_dir_name: &str,
    default_file_name: &str,
    data_label: &str,
) -> AppResult<(String, std::path::PathBuf)> {
    let temp_dir = std::env::temp_dir().join(temp_dir_name);
    tokio::fs::create_dir_all(&temp_dir).await?;
    let mut uploaded: Option<(String, std::path::PathBuf)> = None;

    while let Some(mut field) = multipart.next_field().await? {
        if field.name() != Some("file") {
            return Err(AppError::BadRequest(
                "只允许 multipart 字段 file".to_string(),
            ));
        }
        if uploaded.is_some() {
            return Err(AppError::BadRequest(
                "一次只能导入一个 XLSX 文件".to_string(),
            ));
        }
        let file_name = field.file_name().unwrap_or(default_file_name).to_string();
        if !file_name.to_ascii_lowercase().ends_with(".xlsx") {
            return Err(AppError::BadRequest(format!(
                "仅支持 .xlsx {data_label}数据文件"
            )));
        }
        let temp_path = temp_dir.join(format!("{}.xlsx", uuid::Uuid::new_v4()));
        let mut output = tokio::fs::File::create(&temp_path).await?;
        use tokio::io::AsyncWriteExt;
        let mut size = 0_u64;
        while let Some(chunk) = field.chunk().await? {
            size = size.saturating_add(chunk.len() as u64);
            if size > 512 * 1024 * 1024 {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err(AppError::BadRequest("XLSX 文件不能超过 512MB".to_string()));
            }
            output.write_all(&chunk).await?;
        }
        output.flush().await?;
        if size == 0 {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(AppError::BadRequest("上传文件为空".to_string()));
        }
        uploaded = Some((file_name, temp_path));
    }

    uploaded.ok_or_else(|| AppError::BadRequest("缺少 multipart 字段 file".to_string()))
}
