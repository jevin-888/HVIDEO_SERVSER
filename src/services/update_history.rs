//! Durable per-attempt history. Acknowledgements never clear a newer local revision.
use crate::{config::CloudConfig, AppState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use super::{cloud_service::CloudService, vod_update_service::Manifest};

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Record {
    pub id: String, pub task_id: String, pub package_id: String, pub package_name: String,
    pub package_type: String, pub version_code: i64, pub package_revision: String,
    pub video_count: Option<i64>, pub imported_count: Option<i64>, pub file_size: i64,
    pub downloaded_size: i64, pub status: i32, pub local_path: String, pub message: String,
    pub started_at: String, pub updated_at: String, pub finished_at: Option<String>, pub sequence: i64,
}
#[derive(Default, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Query { pub page: Option<u32>, pub status: Option<i32>, pub package: Option<String> }

pub async fn begin(pool: &SqlitePool, task: &str, config: &CloudConfig, m: &Manifest, revision: &str) -> anyhow::Result<()> {
    let mut tx=pool.begin().await?;
    let history_id=uuid::Uuid::new_v4().to_string();
    // End any abandoned queued attempt before reusing the legacy task row.
    sqlx::query("UPDATE update_history SET status=3,message='任务重新启动',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),sequence=sequence+1 WHERE task_id=? AND status IN(0,1)")
        .bind(task).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO update_history(id,task_id,package_id,package_name,package_type,version_code,package_revision,endpoint,video_count,file_size,status,local_path,message,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,'等待更新',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
        .bind(&history_id).bind(task).bind(&m.package.id).bind(&m.package.package_name)
        .bind(&m.package.package_type).bind(m.package.version_code).bind(revision).bind(config.api_base_url.trim_end_matches('/'))
        .bind(m.files.iter().filter(|f| f.file_role=="video").count() as i64).bind(m.files.iter().map(|f|f.file_size).sum::<i64>())
        .bind(&config.download_dir).execute(&mut *tx).await?;
    for (position,file) in m.files.iter().filter(|f|f.file_role=="video").enumerate() {
        let number=crate::scanner::id_extractor::extract_song_no_candidates(&file.file_name).into_iter().next().unwrap_or_default();
        sqlx::query("INSERT INTO update_history_songs(history_id,file_name,position,song_no) VALUES(?,?,?,?)")
            .bind(&history_id).bind(&file.file_name).bind(position as i64).bind(number).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}
pub async fn list(pool: &SqlitePool, q: Query) -> anyhow::Result<Value> {
    let page=q.page.unwrap_or(1).clamp(1,1_000_000);
    let status=q.status.unwrap_or(-1);
    anyhow::ensure!((-1..=3).contains(&status),"更新状态无效");
    let package=q.package.unwrap_or_default();
    let total: i64=sqlx::query_scalar("SELECT COUNT(*) FROM update_history WHERE (?=-1 OR status=?) AND instr(lower(package_name),lower(?))>0")
        .bind(status).bind(status).bind(&package).fetch_one(pool).await?;
    let records: Vec<Record>=sqlx::query_as("SELECT * FROM update_history WHERE (?=-1 OR status=?) AND instr(lower(package_name),lower(?))>0 ORDER BY started_at DESC,id DESC LIMIT 20 OFFSET ?")
        .bind(status).bind(status).bind(&package).bind((page as i64-1)*20).fetch_all(pool).await?;
    let mut items=Vec::new();
    for r in records {
        let ack: i64=sqlx::query_scalar("SELECT ack_sequence FROM update_history WHERE id=?").bind(&r.id).fetch_one(pool).await?;
        let mut value=serde_json::to_value(&r)?; value["cloudSynced"]=json!(ack>=r.sequence);items.push(value);
    }
    Ok(json!({"items":items,"total":total,"page":page,"pageSize":20}))
}

#[derive(Default, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SongQuery { pub page: Option<u32> }

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all="camelCase")]
struct SongDetail {
    file_name:String, song_no:String, song_name:String, singer:String, status:String, message:String,
}

pub async fn songs(pool:&SqlitePool,id:&str,q:SongQuery)->crate::errors::AppResult<Value> {
    use crate::errors::AppError;
    uuid::Uuid::parse_str(id).map_err(|_|AppError::BadRequest("记录编号无效".into()))?;
    let page=q.page.unwrap_or(1).clamp(1,1_000_000);
    let mut tx=pool.begin().await?;
    let exists: i64=sqlx::query_scalar("SELECT COUNT(*) FROM update_history WHERE id=?").bind(id).fetch_one(&mut *tx).await?;
    if exists==0 {return Err(AppError::NotFound("更新记录不存在或已被云端删除".into()));}
    let total:i64=sqlx::query_scalar("SELECT COUNT(*) FROM update_history_songs WHERE history_id=?").bind(id).fetch_one(&mut *tx).await?;
    let items:Vec<SongDetail>=sqlx::query_as("SELECT file_name,song_no,song_name,singer,status,message FROM update_history_songs WHERE history_id=? ORDER BY position LIMIT 50 OFFSET ?")
        .bind(id).bind((page as i64-1)*50).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(json!({"items":items,"total":total,"page":page,"pageSize":50}))
}

// Metadata is snapshotted for this attempt; later catalog edits never rewrite history.
pub async fn refresh_song_metadata(pool:&SqlitePool,song_db:&SqlitePool,task:&str)->anyhow::Result<()> {
    let rows:Vec<(String,String)>=sqlx::query_as("SELECT d.history_id,d.file_name FROM update_history_songs d JOIN update_history h ON h.id=d.history_id WHERE h.task_id=? AND h.status IN(0,1)")
        .bind(task).fetch_all(pool).await?;
    for (history,file) in rows {
        for candidate in crate::scanner::id_extractor::extract_song_no_candidates(&file) {
            let metadata:Option<(String,String)>=sqlx::query_as("SELECT COALESCE(songName,''),COALESCE(NULLIF(singerNames,''),primarySingerName,'') FROM songs WHERE songNo=?")
                .bind(&candidate).fetch_optional(song_db).await?;
            if let Some((name,singer))=metadata {
                sqlx::query("UPDATE update_history_songs SET song_no=?,song_name=?,singer=? WHERE history_id=? AND file_name=?")
                    .bind(candidate).bind(name).bind(singer).bind(&history).bind(&file).execute(pool).await?;
                break;
            }
        }
    }
    Ok(())
}

pub async fn song_stage(pool:&SqlitePool,task:&str,file:&str,status:&str,message:&str)->anyhow::Result<()> {
    sqlx::query("UPDATE update_history_songs SET status=?,message=? WHERE file_name=? AND history_id IN(SELECT id FROM update_history WHERE task_id=? AND status IN(0,1))")
        .bind(status).bind(message).bind(file).bind(task).execute(pool).await?;
    Ok(())
}

async fn apply_cloud_deletions(pool:&SqlitePool,endpoint:&str,ids:&[String])->anyhow::Result<()> {
    let mut tx=pool.begin().await?;
    for id in ids {
        sqlx::query("DELETE FROM update_history WHERE id=? AND endpoint=?").bind(id).bind(endpoint).execute(&mut *tx).await?;
    }
    tx.commit().await?;Ok(())
}

async fn sync_deletions(pool:&SqlitePool,config:&CloudConfig,proof:&str)->anyhow::Result<()> {
    let endpoint=config.api_base_url.trim_end_matches('/');
    let base=CloudService::validate_config(config)?;
    let client=CloudService::http_client()?;
    let mut after=String::new();
    loop {
        let records:Vec<String>=sqlx::query_scalar("SELECT id FROM update_history WHERE endpoint=? AND id>? ORDER BY id LIMIT 100")
            .bind(endpoint).bind(&after).fetch_all(pool).await?;
        let Some(last)=records.last() else {break};
        after=last.clone();
        let result:Value=client.post(base.join("/api/server-update-records/sync-deletions")?)
            .header("X-HVideo-Server-License",proof).timeout(std::time::Duration::from_secs(12))
            .json(&json!({"recordIds":records})).send().await?.error_for_status()?.json().await?;
        anyhow::ensure!(result["code"]==0 && result["data"]["recordIds"]==json!(records),"云端记录查询响应无效");
        let ids:Vec<String>=serde_json::from_value(result["data"]["deletedIds"].clone())?;
        anyhow::ensure!(ids.len()<=100 && ids.iter().all(|id|records.contains(id)),"云端删除记录格式无效");
        // Only an explicit cloud deletion removes local history. Network errors or
        // records that have not yet been reported must never count as deletions.
        apply_cloud_deletions(pool,endpoint,&ids).await?;
    }
    Ok(())
}
async fn report_pending(pool: &SqlitePool, config: &CloudConfig, proof: &str) -> anyhow::Result<()> {
    let base=CloudService::validate_config(config)?;
    let client=CloudService::http_client()?;
    let records:Vec<Record>=sqlx::query_as("SELECT * FROM update_history WHERE sequence>ack_sequence AND endpoint=? ORDER BY updated_at,id LIMIT 40")
        .bind(config.api_base_url.trim_end_matches('/')).fetch_all(pool).await?;
    for record in records {
        let response=client.post(base.join("/api/server-update-records/report")?)
            .header("X-HVideo-Server-License",proof).timeout(std::time::Duration::from_secs(12))
            .json(&record).send().await?.error_for_status()?;
        let result:Value=response.json().await?;
        anyhow::ensure!(result["code"]==0 && result["data"]["id"]==record.id && result["data"]["sequence"].as_i64().is_some_and(|s|s>=record.sequence),"云端未确认更新记录");
        if result["data"]["deleted"]==true {
            apply_cloud_deletions(pool,config.api_base_url.trim_end_matches('/'),&[record.id.clone()]).await?;
            continue;
        }
        sqlx::query("UPDATE update_history SET ack_sequence=MAX(ack_sequence,?) WHERE id=?")
            .bind(record.sequence).bind(&record.id).execute(pool).await?;
    }
    Ok(())
}
pub async fn run(state: AppState) {
    let mut timer=tokio::time::interval(std::time::Duration::from_secs(15));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        timer.tick().await;
        let Ok(config)=CloudConfig::load(&state.config_path) else {continue};
        let Ok(proof)=state.license.reporting_proof() else {continue};
        if sync_deletions(&state.db,&config,&proof).await.is_err() {
            tracing::debug!("云端更新记录状态暂不可用，保留本地记录并等待自动重试");
        }
        if report_pending(&state.db,&config,&proof).await.is_err() {
            tracing::debug!("更新记录暂未同步，已保存在本地等待自动补报");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn db()->SqlitePool {
        let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();pool
    }
    fn config(url:&str)->CloudConfig {CloudConfig{api_base_url:url.into(),download_dir:"D:/videos".into(),api_key:String::new(),license_proof:String::new(),cloud_update_expires_at:None,config_path:None,update_mode:Default::default()}}
    async fn attempt(pool:&SqlitePool,c:&CloudConfig)->String {
        let m=Manifest{package:super::super::vod_update_service::Package{id:uuid::Uuid::new_v4().to_string(),package_name:"保留更新历史".into(),package_type:"video".into(),version_code:1,song_count:0},files:vec![]};
        let task=CloudService::create_download_task(pool,"vodPackage",&m.package.id,&format!("{}#flat-v2-test",c.api_base_url)).await.unwrap();
        begin(pool,&task.id,c,&m,"test").await.unwrap();task.id
    }
    #[tokio::test]
    async fn song_details_preserve_attempt_snapshots_paginate_and_follow_cloud_deletion() {
        let pool=db().await;
        let song_db=crate::db::init_song_db_pool("sqlite::memory:",1).await.unwrap();
        sqlx::query("INSERT INTO songs(songNo,songName,primarySingerName,singerNames) VALUES('80000101','测试歌曲','歌星甲','歌星甲 / 歌星乙')").execute(&song_db).await.unwrap();
        let c=config("http://localhost:8080");let task=attempt(&pool,&c).await;
        let files=(0..51).map(|i|super::super::vod_update_service::PackageFile{id:format!("f{i}"),file_role:"video".into(),file_name:format!("{}.mp4",80000101+i),download_url:"http://localhost:8080/video".into(),file_size:10,sha256:None}).collect();
        let m=Manifest{package:super::super::vod_update_service::Package{id:uuid::Uuid::new_v4().to_string(),package_name:"逐首记录".into(),package_type:"video".into(),version_code:1,song_count:0},files};
        begin(&pool,&task,&c,&m,"r1").await.unwrap();
        refresh_song_metadata(&pool,&song_db,&task).await.unwrap();
        let id:String=sqlx::query_scalar("SELECT id FROM update_history WHERE task_id=? AND status=0").bind(&task).fetch_one(&pool).await.unwrap();
        let details=songs(&pool,&id,SongQuery::default()).await.unwrap();
        assert_eq!(details["total"],51);assert_eq!(details["items"].as_array().unwrap().len(),50);
        assert_eq!(details["items"][0]["songNo"],"80000101");assert_eq!(details["items"][0]["songName"],"测试歌曲");assert_eq!(details["items"][0]["singer"],"歌星甲 / 歌星乙");
        assert_eq!(songs(&pool,&id,SongQuery{page:Some(2)}).await.unwrap()["items"].as_array().unwrap().len(),1);
        song_stage(&pool,&task,"80000101.mp4","completed","").await.unwrap();
        song_stage(&pool,&task,"80000102.mp4","downloading","").await.unwrap();
        sqlx::query("UPDATE sync_tasks SET status=3,errorMessage='连接中断' WHERE id=?").bind(&task).execute(&pool).await.unwrap();
        let details=songs(&pool,&id,SongQuery::default()).await.unwrap();
        assert_eq!(details["items"][0]["status"],"completed");assert_eq!(details["items"][1]["status"],"failed");assert_eq!(details["items"][2]["status"],"unfinished");
        sqlx::query("UPDATE songs SET songName='改名'").execute(&song_db).await.unwrap();
        begin(&pool,&task,&c,&m,"r2").await.unwrap();
        refresh_song_metadata(&pool,&song_db,&task).await.unwrap();
        assert_eq!(songs(&pool,&id,SongQuery::default()).await.unwrap()["items"][0]["songName"],"测试歌曲");
        apply_cloud_deletions(&pool,"http://other-cloud",&[id.clone()]).await.unwrap();
        assert!(songs(&pool,&id,SongQuery::default()).await.is_ok());
        apply_cloud_deletions(&pool,&c.api_base_url,&[id.clone()]).await.unwrap();
        assert!(matches!(songs(&pool,&id,SongQuery::default()).await,Err(crate::errors::AppError::NotFound(_))));
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM update_history_songs WHERE history_id=?").bind(&id).fetch_one(&pool).await.unwrap(),0);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM update_history_songs").fetch_one(&pool).await.unwrap(),51);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM sync_tasks").fetch_one(&pool).await.unwrap(),1);
        pool.close().await;song_db.close().await;
    }

    #[tokio::test]
    async fn cloud_deletion_needs_no_ack_and_offline_or_unreported_records_are_preserved() {
        let dir=tempfile::tempdir().unwrap();let url=format!("sqlite://{}?mode=rwc",dir.path().join("history.db").display());
        let pool=SqlitePool::connect(&url).await.unwrap();crate::db::run_migrations(&pool).await.unwrap();
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let c=config(&format!("http://{}",listener.local_addr().unwrap()));
        let mut ids=Vec::new();
        for _ in 0..102 {
            let task=attempt(&pool,&c).await;
            sqlx::query("UPDATE sync_tasks SET status=2 WHERE id=?").bind(&task).execute(&pool).await.unwrap();
            ids.push(sqlx::query_scalar::<_,String>("SELECT id FROM update_history WHERE task_id=?").bind(task).fetch_one(&pool).await.unwrap());
        }
        ids.sort();let removed=ids[101].clone();
        // An HTTP failure is not a deletion decision.
        let app=axum::Router::new().route("/api/server-update-records/sync-deletions",axum::routing::post(||async {axum::http::StatusCode::SERVICE_UNAVAILABLE}));
        let server=tokio::spawn(async move{axum::serve(listener,app).await.unwrap()});
        assert!(sync_deletions(&pool,&c,"test").await.is_err());
        assert_eq!(list(&pool,Query::default()).await.unwrap()["total"],102);
        server.abort();let _=server.await;pool.close().await;
        let pool=SqlitePool::connect(&url).await.unwrap();
        let address=c.api_base_url.trim_start_matches("http://");
        let listener=tokio::net::TcpListener::bind(address).await.unwrap();
        let deleted=removed.clone();
        let calls=std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));let count=calls.clone();
        let app=axum::Router::new().route("/api/server-update-records/sync-deletions",axum::routing::post(move |axum::Json(body):axum::Json<Value>| {
            let deleted=deleted.clone();let count=count.clone();async move {
                count.fetch_add(1,std::sync::atomic::Ordering::SeqCst);
                assert_eq!(body.as_object().unwrap().len(),1); // No delete request or acknowledgement.
                let ids:Vec<String>=serde_json::from_value(body["recordIds"].clone()).unwrap();
                assert!(ids.len()<=100);
                let removed:Vec<_>=ids.iter().filter(|id|**id==deleted).cloned().collect();
                axum::Json(json!({"code":0,"data":{"recordIds":ids,"deletedIds":removed}}))
            }
        }));
        let server=tokio::spawn(async move{axum::serve(listener,app).await.unwrap()});
        sync_deletions(&pool,&c,"test").await.unwrap();
        assert_eq!(list(&pool,Query::default()).await.unwrap()["total"],101);
        assert!(songs(&pool,&removed,SongQuery::default()).await.is_err());
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst),2);
        sync_deletions(&pool,&c,"test").await.unwrap();
        assert_eq!(list(&pool,Query::default()).await.unwrap()["total"],101);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM sync_tasks").fetch_one(&pool).await.unwrap(),102);
        server.abort();pool.close().await;
    }

    #[tokio::test]
    async fn cloud_tombstone_response_removes_stale_local_report() {
        let pool=db().await;let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let c=config(&format!("http://{}",listener.local_addr().unwrap()));let task=attempt(&pool,&c).await;
        sqlx::query("UPDATE sync_tasks SET status=2 WHERE id=?").bind(&task).execute(&pool).await.unwrap();
        let app=axum::Router::new().route("/api/server-update-records/report",axum::routing::post(|axum::Json(r):axum::Json<Record>|async move {
            axum::Json(json!({"code":0,"data":{"id":r.id,"sequence":r.sequence,"deleted":true}}))
        }));
        let server=tokio::spawn(async move{axum::serve(listener,app).await.unwrap()});
        report_pending(&pool,&c,"test").await.unwrap();
        assert_eq!(list(&pool,Query::default()).await.unwrap()["total"],0);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM sync_tasks").fetch_one(&pool).await.unwrap(),1);
        server.abort();pool.close().await;
    }
    #[tokio::test]
    async fn retries_preserve_failure_and_restart_closes_queued_attempts() {
        let pool=db().await;let c=config("http://localhost:8080");let task=attempt(&pool,&c).await;
        sqlx::query("UPDATE sync_tasks SET status=3,errorMessage='磁盘已满' WHERE id=?").bind(&task).execute(&pool).await.unwrap();
        let old:Record=sqlx::query_as("SELECT * FROM update_history").fetch_one(&pool).await.unwrap();
        let m=Manifest{package:super::super::vod_update_service::Package{id:old.package_id.clone(),package_name:"重新上传后改名".into(),package_type:"video".into(),version_code:2,song_count:0},files:vec![]};
        begin(&pool,&task,&c,&m,"changed").await.unwrap();
        sqlx::query("UPDATE sync_tasks SET status=0 WHERE id=?").bind(&task).execute(&pool).await.unwrap();
        CloudService::recover_interrupted_tasks(&pool).await.unwrap();
        let history=list(&pool,Query::default()).await.unwrap();assert_eq!(history["total"],2);
        let preserved:Record=sqlx::query_as("SELECT * FROM update_history WHERE id=?").bind(&old.id).fetch_one(&pool).await.unwrap();
        assert_eq!(preserved.message,"磁盘已满");assert_eq!(preserved.package_name,"保留更新历史");assert_eq!(preserved.sequence,old.sequence);
        assert!(history["items"].as_array().unwrap().iter().all(|v|v["status"]==3 && v["finishedAt"].is_string()));
        sqlx::query("DELETE FROM sync_tasks").execute(&pool).await.unwrap();assert_eq!(list(&pool,Query::default()).await.unwrap()["total"],2);
    }
    #[tokio::test]
    async fn failed_report_is_retained_and_old_ack_does_not_erase_new_progress() {
        use std::sync::{Arc,atomic::{AtomicUsize,Ordering}};
        let pool=db().await;let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let c=config(&format!("http://{}",listener.local_addr().unwrap()));let task=attempt(&pool,&c).await;
        let calls=Arc::new(AtomicUsize::new(0));let count=calls.clone();let db=pool.clone();let task_copy=task.clone();
        let app=axum::Router::new().route("/api/server-update-records/report",axum::routing::post(move |axum::Json(r):axum::Json<Record>| {
            let count=count.clone();let db=db.clone();let task=task_copy.clone();async move {
                let n=count.fetch_add(1,Ordering::SeqCst);
                if n==0{return (axum::http::StatusCode::SERVICE_UNAVAILABLE,axum::Json(json!({"code":503})));}
                if n==1{sqlx::query("UPDATE sync_tasks SET status=2,errorMessage='完成' WHERE id=?").bind(task).execute(&db).await.unwrap();}
                (axum::http::StatusCode::OK,axum::Json(json!({"code":0,"data":{"id":r.id,"sequence":r.sequence}})))
            }
        }));
        let server=tokio::spawn(async move{axum::serve(listener,app).await.unwrap()});
        assert!(report_pending(&pool,&c,"fixture").await.is_err());
        assert_eq!(list(&pool,Query::default()).await.unwrap()["items"][0]["cloudSynced"],false);
        report_pending(&pool,&c,"fixture").await.unwrap();
        assert_eq!(list(&pool,Query::default()).await.unwrap()["items"][0]["cloudSynced"],false);
        report_pending(&pool,&c,"fixture").await.unwrap();
        assert_eq!(list(&pool,Query::default()).await.unwrap()["items"][0]["cloudSynced"],true);
        report_pending(&pool,&c,"fixture").await.unwrap();assert_eq!(calls.load(Ordering::SeqCst),3);
        server.abort();pool.close().await;
    }
    #[tokio::test]
    async fn migration_backfills_known_counts_without_fabricating_manifest() {
        let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("CREATE TABLE sync_tasks(id TEXT,taskType TEXT,targetType TEXT,targetId TEXT,cloud_url TEXT,fileSize INTEGER,downloaded_size INTEGER,status INTEGER,localPath TEXT,errorMessage TEXT,createdAt TEXT,updatedAt TEXT); INSERT INTO sync_tasks VALUES('old','download','vodPackage','package','http://localhost#flat-v2-old',100,100,2,'D:/视频','更新完成：九月包，已入库视频 12 个','2026-09-25 10:00:00','2026-09-25 10:01:00');").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/040_update_history.sql")).execute(&pool).await.unwrap();
        let r:Record=sqlx::query_as("SELECT * FROM update_history").fetch_one(&pool).await.unwrap();
        assert_eq!(r.package_name,"九月包");assert_eq!(r.imported_count,Some(12));assert_eq!(r.video_count,None);assert_eq!(r.package_type,"legacy");
    }
}
