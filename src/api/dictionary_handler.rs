use axum::{
    extract::{
        multipart::MultipartRejection,
        rejection::{JsonRejection, QueryRejection},
        Extension, FromRef, Multipart, Path, Query, State,
    },
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::{
    errors::{AppError, AppResult},
    models::{
        common::ApiResponse,
        song_db_models::{DictEntry, DictImportResult, UpsertDictRequest},
    },
    services::{auth_service::Claims, dictionary_service::DictionaryService, dictionary_xlsx},
    AppState,
};

#[derive(Clone)]
pub struct DictionaryDb(pub SqlitePool);

impl FromRef<AppState> for DictionaryDb {
    fn from_ref(state: &AppState) -> Self {
        Self(state.song_db.clone())
    }
}

fn authorize(claims: &Claims) -> AppResult<()> {
    if claims.permissions.iter().any(|p| p == "admin") {
        Ok(())
    } else {
        Err(AppError::Forbidden("字典维护仅限管理员操作".into()))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DictExportQuery {
    pub dict_group: Option<String>,
}

/// Terminal readers retain the existing public group endpoint and response fields.
pub async fn get_group(
    State(db): State<DictionaryDb>,
    Path(group): Path<String>,
) -> AppResult<Json<ApiResponse<Vec<DictEntry>>>> {
    Ok(Json(ApiResponse::success(
        DictionaryService::list(&db.0, Some(&group)).await?,
    )))
}

pub async fn list(
    State(db): State<DictionaryDb>,
    Extension(claims): Extension<Claims>,
) -> AppResult<Json<ApiResponse<Vec<DictEntry>>>> {
    authorize(&claims)?;
    Ok(Json(ApiResponse::success(
        DictionaryService::list(&db.0, None).await?,
    )))
}

pub async fn upsert(
    State(db): State<DictionaryDb>,
    Extension(claims): Extension<Claims>,
    Path(group): Path<String>,
    payload: Result<Json<UpsertDictRequest>, JsonRejection>,
) -> AppResult<Json<ApiResponse<DictEntry>>> {
    authorize(&claims)?;
    let Json(req) = payload.map_err(|error| AppError::BadRequest(error.body_text()))?;
    Ok(Json(ApiResponse::success(
        DictionaryService::upsert(&db.0, &group, req).await?,
    )))
}

pub async fn delete(
    State(db): State<DictionaryDb>,
    Extension(claims): Extension<Claims>,
    Path((group, code)): Path<(String, String)>,
) -> AppResult<Json<ApiResponse<()>>> {
    authorize(&claims)?;
    DictionaryService::delete(&db.0, &group, &code).await?;
    Ok(Json(ApiResponse::success(())))
}

pub async fn export(
    State(db): State<DictionaryDb>,
    Extension(claims): Extension<Claims>,
    query: Result<Query<DictExportQuery>, QueryRejection>,
) -> AppResult<Response> {
    authorize(&claims)?;
    let Query(query) = query.map_err(|error| AppError::BadRequest(error.body_text()))?;
    let items = DictionaryService::list(&db.0, query.dict_group.as_deref()).await?;
    let bytes = tokio::task::spawn_blocking(move || dictionary_xlsx::export_xlsx(&items))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))??;
    Ok(([
        (header::CONTENT_TYPE,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        (header::CONTENT_DISPOSITION,"attachment; filename=\"song-dictionaries.xlsx\"; filename*=UTF-8''%E6%AD%8C%E6%9B%B2%E5%AD%97%E5%85%B8.xlsx"),
        (header::CACHE_CONTROL,"no-store"),
    ],bytes).into_response())
}

pub async fn import(
    State(db): State<DictionaryDb>,
    Extension(claims): Extension<Claims>,
    multipart: Result<Multipart, MultipartRejection>,
) -> AppResult<Json<ApiResponse<DictImportResult>>> {
    authorize(&claims)?;
    let mut multipart = multipart.map_err(|error| AppError::BadRequest(error.body_text()))?;
    let mut uploaded = None;
    while let Some(mut field) = multipart.next_field().await? {
        if field.name() != Some("file") || uploaded.is_some() {
            return Err(AppError::BadRequest(
                "只允许一个multipart文件字段file".into(),
            ));
        }
        if !field
            .file_name()
            .unwrap_or("")
            .to_ascii_lowercase()
            .ends_with(".xlsx")
        {
            return Err(AppError::BadRequest("请选择.xlsx字典表".into()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = field.chunk().await? {
            if bytes.len().saturating_add(chunk.len()) > dictionary_xlsx::MAX_XLSX_SIZE {
                return Err(AppError::BadRequest("XLSX文件不能超过5MB".into()));
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.is_empty() {
            return Err(AppError::BadRequest("上传文件为空".into()));
        }
        uploaded = Some(bytes);
    }
    let bytes = uploaded.ok_or_else(|| AppError::BadRequest("缺少字典文件file".into()))?;
    let rows = tokio::task::spawn_blocking(move || dictionary_xlsx::import_xlsx(&bytes))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))??;
    Ok(Json(ApiResponse::success(
        DictionaryService::import(&db.0, rows).await?,
    )))
}
