use crate::{
    errors::{AppError, AppResult},
    models::common::ApiResponse,
    services::auth_service::Claims,
    AppState,
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{SqliteConnection, SqlitePool};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Member {
    pub id: String,
    pub card_no: String,
    pub name: String,
    pub phone: String,
    pub level: String,
    pub birthday: String,
    pub balance: f64,
    pub points: i64,
    pub remark: String,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}
const MEMBER_COLUMNS: &str = "id, card_no, name, phone, level, birthday, balance_cents / 100.0 AS balance, points, remark, version, created_at, updated_at";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemberInput {
    pub id: String,
    pub card_no: String,
    pub name: String,
    pub phone: String,
    pub level: String,
    pub birthday: String,
    pub balance: f64,
    pub points: i64,
    pub remark: String,
    pub version: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BalanceInput {
    pub request_id: String,
    pub balance_delta: f64,
    pub points_delta: i64,
}

fn invalid(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}
fn conflict() -> AppError {
    AppError::Conflict("记录已变更、重复或状态不允许，请刷新后重试".into())
}
fn database_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .is_some_and(|e| e.is_unique_violation())
    {
        AppError::Conflict("会员卡号、手机号、记录编号重复，或该房间已有有效预定".into())
    } else {
        error.into()
    }
}
pub(crate) fn cents(value: f64) -> AppResult<i64> {
    if !value.is_finite()
        || value.abs() > 100_000_000.0
        || (value * 100.0 - (value * 100.0).round()).abs() > 0.00001
    {
        return Err(invalid("金额必须在合理范围内，且最多两位小数"));
    }
    Ok((value * 100.0).round() as i64)
}
fn validate_id(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 100
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
    {
        return Err(invalid("记录编号格式不正确"));
    }
    Ok(())
}
fn validate_member(req: &MemberInput) -> AppResult<()> {
    validate_id(&req.id)?;
    validate_id(&req.card_no)?;
    if !(3..=32).contains(&req.card_no.len())
        || req.name.trim().is_empty()
        || req.phone.len() != 11
        || !req.phone.bytes().all(|c| c.is_ascii_digit())
        || req.points < 0
        || req.points > 1_000_000_000
        || cents(req.balance)? < 0
    {
        return Err(invalid("请检查卡号、姓名、11位手机号、余额和积分"));
    }
    if !["普通会员", "银卡会员", "金卡会员", "VIP会员"].contains(&req.level.as_str())
    {
        return Err(invalid("会员等级不正确"));
    }
    if !req.birthday.is_empty()
        && chrono::NaiveDate::parse_from_str(&req.birthday, "%Y-%m-%d").is_err()
    {
        return Err(invalid("生日格式不正确"));
    }
    Ok(())
}
pub async fn list_members(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<Member>>>> {
    let rows = sqlx::query_as::<_, Member>(&format!(
        "SELECT {MEMBER_COLUMNS} FROM cashier_members WHERE deleted=0 ORDER BY created_at DESC, id"
    ))
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(rows)))
}
async fn member(pool: &SqlitePool, id: &str) -> AppResult<Member> {
    sqlx::query_as::<_, Member>(&format!(
        "SELECT {MEMBER_COLUMNS} FROM cashier_members WHERE id=? AND deleted=0"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("会员不存在".into()))
}
async fn save_member(pool: &SqlitePool, req: &MemberInput, create: bool) -> AppResult<Member> {
    validate_member(req)?;
    if create {
        sqlx::query("INSERT INTO cashier_members(id,card_no,name,phone,level,birthday,balance_cents,points,remark) VALUES(?,?,?,?,?,?,?,?,?)")
            .bind(&req.id).bind(req.card_no.trim()).bind(req.name.trim()).bind(&req.phone).bind(&req.level)
            .bind(&req.birthday).bind(cents(req.balance)?).bind(req.points).bind(&req.remark)
            .execute(pool).await.map_err(database_error)?;
    } else {
        let result = sqlx::query("UPDATE cashier_members SET card_no=?,name=?,phone=?,level=?,birthday=?,remark=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=? AND deleted=0 AND balance_cents=? AND points=?")
            .bind(req.card_no.trim()).bind(req.name.trim()).bind(&req.phone).bind(&req.level).bind(&req.birthday).bind(&req.remark)
            .bind(&req.id).bind(req.version).bind(cents(req.balance)?).bind(req.points).execute(pool).await.map_err(database_error)?;
        if result.rows_affected() != 1 {
            return Err(conflict());
        }
    }
    member(pool, &req.id).await
}
pub async fn create_member(
    State(state): State<AppState>,
    Json(req): Json<MemberInput>,
) -> AppResult<Json<ApiResponse<Member>>> {
    let row = save_member(&state.db, &req, true).await?;
    state
        .ws
        .broadcast(serde_json::json!({"type":"cashier_customers_changed"}));
    Ok(Json(ApiResponse::success(row)))
}
pub async fn update_member(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<MemberInput>,
) -> AppResult<Json<ApiResponse<Member>>> {
    if id != req.id {
        return Err(invalid("会员编号不一致"));
    }
    let row = save_member(&state.db, &req, false).await?;
    state
        .ws
        .broadcast(serde_json::json!({"type":"cashier_customers_changed"}));
    Ok(Json(ApiResponse::success(row)))
}
pub async fn delete_member(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    let result = sqlx::query("UPDATE cashier_members SET deleted=1,version=version+1 WHERE id=? AND deleted=0 AND balance_cents=0 AND NOT EXISTS(SELECT 1 FROM cashier_reservations WHERE member_id=? AND status='reserved')")
        .bind(&id).bind(&id).execute(&state.db).await?;
    if result.rows_affected() != 1 {
        return Err(invalid("会员不存在、仍有余额或关联有效预定，不能删除"));
    }
    state
        .ws
        .broadcast(serde_json::json!({"type":"cashier_customers_changed"}));
    Ok(Json(ApiResponse::success(())))
}
pub(crate) async fn change_balance(
    connection: &mut SqliteConnection,
    id: &str,
    req: &BalanceInput,
    operator: &str,
) -> AppResult<()> {
    validate_id(&req.request_id)?;
    let delta = cents(req.balance_delta)?;
    if req.points_delta.unsigned_abs() > 1_000_000_000 {
        return Err(invalid("积分超出范围"));
    }
    let inserted = sqlx::query("INSERT INTO cashier_member_transactions(request_id,member_id,balance_delta_cents,points_delta,operator_id) VALUES(?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING")
        .bind(&req.request_id).bind(id).bind(delta).bind(req.points_delta).bind(operator).execute(&mut *connection).await?;
    if inserted.rows_affected() == 0 {
        let matches: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cashier_member_transactions WHERE request_id=? AND member_id=? AND balance_delta_cents=? AND points_delta=?")
            .bind(&req.request_id).bind(id).bind(delta).bind(req.points_delta).fetch_one(&mut *connection).await?;
        return if matches == 1 {
            Ok(())
        } else {
            Err(conflict())
        };
    }
    let result = sqlx::query("UPDATE cashier_members SET balance_cents=balance_cents+?,points=points+?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND deleted=0 AND balance_cents+? BETWEEN 0 AND 10000000000 AND points+? BETWEEN 0 AND 1000000000")
        .bind(delta).bind(req.points_delta).bind(id).bind(delta).bind(req.points_delta).execute(&mut *connection).await?;
    if result.rows_affected() != 1 {
        return Err(invalid("会员不存在、余额或积分不足、或超出范围"));
    }
    Ok(())
}
pub async fn member_balance(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<BalanceInput>,
) -> AppResult<Json<ApiResponse<Member>>> {
    let mut tx = state.db.begin().await?;
    change_balance(&mut tx, &id, &req, &claims.sub).await?;
    tx.commit().await?;
    state
        .ws
        .broadcast(serde_json::json!({"type":"cashier_customers_changed"}));
    Ok(Json(ApiResponse::success(member(&state.db, &id).await?)))
}

#[derive(Debug, Deserialize, Serialize, sqlx::FromRow)]
#[serde(deny_unknown_fields)]
pub struct Reservation {
    pub id: String,
    pub room_id: String,
    pub room_name: String,
    pub room_ip: String,
    pub reservation_time: String,
    pub member_id: String,
    pub member_no: String,
    pub marketer_id: String,
    pub marketer_name: String,
    pub customer_name: String,
    pub phone: String,
    pub people: i64,
    pub prepay: f64,
    pub remark: String,
    pub status: String,
    pub version: i64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}
pub async fn list_reservations(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<Reservation>>>> {
    let rows = sqlx::query_as::<_, Reservation>(
        "SELECT * FROM cashier_reservations ORDER BY reservation_time DESC,id",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(rows)))
}
async fn save_reservation(
    pool: &SqlitePool,
    req: &Reservation,
    create: bool,
) -> AppResult<Reservation> {
    validate_id(&req.id)?;
    if !["reserved", "opened", "cancelled"].contains(&req.status.as_str())
        || (!create && req.status != "reserved")
        || req.customer_name.trim().is_empty()
        || !(1..=1000).contains(&req.people)
        || cents(req.prepay)? < 0
        || chrono::NaiveDateTime::parse_from_str(&req.reservation_time, "%Y-%m-%dT%H:%M").is_err()
    {
        return Err(invalid("请检查预定人、时间、人数和预付金额"));
    }
    if !req.phone.is_empty()
        && (req.phone.len() != 11 || !req.phone.bytes().all(|c| c.is_ascii_digit()))
    {
        return Err(invalid("手机号必须为11位数字"));
    }
    // Acquire the write lock before validating related records.
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE cashier_reservations SET version=version WHERE id=?")
        .bind(&req.id)
        .execute(&mut *tx)
        .await?;
    let room: Option<(String, i64)> = sqlx::query_as("SELECT name,status FROM rooms WHERE id=?")
        .bind(&req.room_id)
        .fetch_optional(&mut *tx)
        .await?;
    let (room_name, status) = room.ok_or_else(|| invalid("房间不存在"))?;
    if status != 0 && req.status == "reserved" {
        return Err(conflict());
    }
    let member_no: String = if req.member_id.is_empty() {
        String::new()
    } else {
        sqlx::query_scalar("SELECT card_no FROM cashier_members WHERE id=? AND deleted=0")
            .bind(&req.member_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| invalid("会员不存在"))?
    };
    let marketer_name: String = if req.marketer_id.is_empty() {
        String::new()
    } else {
        sqlx::query_scalar("SELECT name FROM employees WHERE id=? AND enabled=1")
            .bind(&req.marketer_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| invalid("营销人员不存在或已禁用"))?
    };
    if create {
        sqlx::query("INSERT INTO cashier_reservations(id,room_id,room_name,room_ip,reservation_time,member_id,member_no,marketer_id,marketer_name,customer_name,phone,people,prepay,remark,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(&req.id).bind(&req.room_id).bind(&room_name).bind(&req.room_ip).bind(&req.reservation_time)
            .bind(&req.member_id).bind(&member_no).bind(&req.marketer_id).bind(&marketer_name)
            .bind(req.customer_name.trim()).bind(&req.phone).bind(req.people).bind(req.prepay).bind(&req.remark).bind(&req.status)
            .execute(&mut *tx).await.map_err(database_error)?;
    } else {
        let result = sqlx::query("UPDATE cashier_reservations SET reservation_time=?,member_id=?,member_no=?,marketer_id=?,marketer_name=?,customer_name=?,phone=?,people=?,prepay=?,remark=?,room_name=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND room_id=? AND version=? AND status='reserved'")
            .bind(&req.reservation_time).bind(&req.member_id).bind(member_no).bind(&req.marketer_id).bind(marketer_name)
            .bind(req.customer_name.trim()).bind(&req.phone).bind(req.people).bind(req.prepay).bind(&req.remark).bind(room_name)
            .bind(&req.id).bind(&req.room_id).bind(req.version).execute(&mut *tx).await?;
        if result.rows_affected() != 1 {
            return Err(conflict());
        }
    }
    let result = sqlx::query_as::<_, Reservation>("SELECT * FROM cashier_reservations WHERE id=?")
        .bind(&req.id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn create_reservation(
    State(state): State<AppState>,
    Json(req): Json<Reservation>,
) -> AppResult<Json<ApiResponse<Reservation>>> {
    let row = save_reservation(&state.db, &req, true).await?;
    state
        .ws
        .broadcast(serde_json::json!({"type":"cashier_customers_changed"}));
    Ok(Json(ApiResponse::success(row)))
}
pub async fn update_reservation(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<Reservation>,
) -> AppResult<Json<ApiResponse<Reservation>>> {
    if id != req.id {
        return Err(invalid("预定编号不一致"));
    }
    let row = save_reservation(&state.db, &req, false).await?;
    state
        .ws
        .broadcast(serde_json::json!({"type":"cashier_customers_changed"}));
    Ok(Json(ApiResponse::success(row)))
}
pub async fn cancel_reservation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    let result = sqlx::query("UPDATE cashier_reservations SET status='cancelled',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='reserved'")
        .bind(&id).execute(&state.db).await?;
    if result.rows_affected() != 1 {
        return Err(conflict());
    }
    state
        .ws
        .broadcast(serde_json::json!({"type":"cashier_customers_changed"}));
    Ok(Json(ApiResponse::success(())))
}
pub async fn open_reservation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    let result = sqlx::query("UPDATE cashier_reservations SET status='opened',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='reserved' AND EXISTS(SELECT 1 FROM rooms WHERE rooms.id=cashier_reservations.room_id AND rooms.status=1)")
        .bind(&id).execute(&state.db).await?;
    if result.rows_affected() != 1 {
        return Err(conflict());
    }
    state
        .ws
        .broadcast(serde_json::json!({"type":"cashier_customers_changed"}));
    Ok(Json(ApiResponse::success(())))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn db() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/038_cashier_members_reservations.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql("CREATE TABLE rooms(id TEXT PRIMARY KEY,name TEXT,status INTEGER); INSERT INTO rooms VALUES('room-1','VIP888',0); CREATE TABLE employees(id TEXT,name TEXT,enabled INTEGER);")
            .execute(&pool).await.unwrap();
        pool
    }
    fn input() -> MemberInput {
        MemberInput {
            id: "mem-1".into(),
            card_no: "VIP001".into(),
            name: "顾客".into(),
            phone: "13800138000".into(),
            level: "普通会员".into(),
            birthday: "".into(),
            balance: 100.0,
            points: 0,
            remark: "".into(),
            version: 0,
        }
    }
    fn reservation() -> Reservation {
        Reservation {
            id: "res-1".into(),
            room_id: "room-1".into(),
            room_name: "untrusted".into(),
            room_ip: "".into(),
            reservation_time: "2026-09-20T18:00".into(),
            member_id: "mem-1".into(),
            member_no: "wrong".into(),
            marketer_id: "".into(),
            marketer_name: "".into(),
            customer_name: "顾客".into(),
            phone: "13800138000".into(),
            people: 2,
            prepay: 0.0,
            remark: "".into(),
            status: "reserved".into(),
            version: 0,
            created_at: "".into(),
            updated_at: "".into(),
        }
    }

    #[tokio::test]
    async fn customer_profiles_reject_duplicates_and_stale_updates() {
        let pool = db().await;
        let mut req = input();
        let row = save_member(&pool, &req, true).await.unwrap();
        assert_eq!(row.balance, 100.0);
        req.id = "mem-2".into();
        assert!(matches!(
            save_member(&pool, &req, true).await,
            Err(AppError::Conflict(_))
        ));
        req.id = "mem-1".into();
        req.version = 1;
        req.name = "新名称".into();
        save_member(&pool, &req, false).await.unwrap();
        assert!(matches!(
            save_member(&pool, &req, false).await,
            Err(AppError::Conflict(_))
        ));
        assert_eq!(member(&pool, "mem-1").await.unwrap().name, "新名称");
    }

    #[tokio::test]
    async fn customer_balance_is_idempotent_and_insufficient_funds_roll_back() {
        let pool = db().await;
        save_member(&pool, &input(), true).await.unwrap();
        let req = BalanceInput {
            request_id: "request-1".into(),
            balance_delta: -30.25,
            points_delta: 3,
        };
        for _ in 0..2 {
            let mut tx = pool.begin().await.unwrap();
            change_balance(&mut tx, "mem-1", &req, "operator")
                .await
                .unwrap();
            tx.commit().await.unwrap();
        }
        assert_eq!(member(&pool, "mem-1").await.unwrap().balance, 69.75);
        assert_eq!(member(&pool, "mem-1").await.unwrap().points, 3);
        let mut tx = pool.begin().await.unwrap();
        let bad = BalanceInput {
            request_id: "request-2".into(),
            balance_delta: -100.0,
            points_delta: 0,
        };
        assert!(change_balance(&mut tx, "mem-1", &bad, "operator")
            .await
            .is_err());
        tx.rollback().await.unwrap();
        assert_eq!(member(&pool, "mem-1").await.unwrap().balance, 69.75);
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cashier_member_transactions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 1);
        assert!(cents(0.001).is_err());
        assert!(cents(f64::NAN).is_err());
    }

    #[tokio::test]
    async fn customer_reservations_validate_references_and_conflicts() {
        let pool = db().await;
        save_member(&pool, &input(), true).await.unwrap();
        let mut req = reservation();
        let row = save_reservation(&pool, &req, true).await.unwrap();
        assert_eq!(row.room_name, "VIP888");
        assert_eq!(row.member_no, "VIP001");
        req.id = "res-2".into();
        assert!(matches!(
            save_reservation(&pool, &req, true).await,
            Err(AppError::Conflict(_))
        ));
        req.id = "res-1".into();
        assert!(save_reservation(&pool, &req, false).await.is_err());
        req.version = 1;
        req.member_id = "missing".into();
        assert!(save_reservation(&pool, &req, false).await.is_err());
        req.member_id = "mem-1".into();
        save_reservation(&pool, &req, false).await.unwrap();
        sqlx::query("UPDATE rooms SET status=1")
            .execute(&pool)
            .await
            .unwrap();
        req.version = 2;
        assert!(save_reservation(&pool, &req, false).await.is_err());
    }
}
