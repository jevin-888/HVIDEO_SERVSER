use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{DateTime, Datelike, Local, NaiveDateTime, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::api::room_handler::broadcast_room_sync;
use crate::errors::{AppError, AppResult};
use crate::models::common::ApiResponse;
use crate::services::auth_service::{AuthService, Claims};
use crate::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BillingSession {
    pub id: String,
    pub roomId: String,
    pub room_type_id: Option<i32>,
    pub status: String,
    pub billingMode: String,
    pub rateId: Option<String>,
    pub buyoutPackageId: Option<String>,
    pub startTime: String,
    pub endTime: Option<String>,
    pub actual_minutes: i64,
    pub billed_minutes: i64,
    pub roomAmount: f64,
    pub beverageAmount: f64,
    pub original_amount: f64,
    pub discountAmount: f64,
    pub rounding_amount: f64,
    pub payableAmount: f64,
    pub paidAmount: f64,
    pub paymentMethod: Option<String>,
    pub paymentTime: Option<String>,
    pub voucherNo: Option<String>,
    pub discount_reason: Option<String>,
    pub free_reason: Option<String>,
    pub credit_customer_name: Option<String>,
    pub credit_customer_contact: Option<String>,
    pub credit_reason: Option<String>,
    pub operatorEmployeeId: Option<String>,
    pub shiftName: Option<String>,
    pub payTiming: Option<String>,
    pub prepayAmount: f64,
    pub timerMinutes: Option<i64>,
    pub timerReminderEnabled: i32,
    pub billingRuleLabel: Option<String>,
    #[sqlx(skip)]
    pub order_items: Vec<BillingOrderItem>,
    pub createdAt: String,
    pub updatedAt: String,
}

#[derive(Debug, Serialize, sqlx::FromRow, Default)]
pub struct BillingOrderItem {
    pub orderId: String,
    pub productId: String,
    pub productName: String,
    pub order_time: Option<String>,
    pub quantity: i64,
    pub unit: Option<String>,
    pub price: f64,
    pub amount: f64,
}

#[derive(Debug, Deserialize)]
pub struct OpenSessionRequest {
    pub roomId: String,
    pub billingMode: Option<String>,
    pub buyoutPackageId: Option<String>,
    pub employee_id: Option<String>,
    pub shiftName: Option<String>,
    pub payTiming: Option<String>,
    pub prepayAmount: Option<f64>,
    pub timerMinutes: Option<i64>,
    pub timerReminderEnabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct RoomBillQuery {
    pub roomId: String,
}

#[derive(Debug, Deserialize)]
pub struct TransferSessionRequest {
    pub targetRoomId: String,
}

#[derive(Debug, Deserialize)]
pub struct BillingPricePreviewQuery {
    pub roomId: String,
    pub billingMode: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BillingPricePreview {
    pub roomId: String,
    pub room_type_id: Option<i32>,
    pub billingMode: String,
    pub billed_minutes: i64,
    pub roomAmount: f64,
    pub hourly_price: f64,
    pub rule_label: String,
    pub description: String,
}

#[derive(Debug, Deserialize)]
pub struct ApplyDiscountRequest {
    pub employee_id: Option<String>,
    pub discount_percent: Option<f64>,
    pub discountAmount: Option<f64>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct FreeBillRequest {
    pub employee_id: Option<String>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct RoundingRequest {
    pub employee_id: Option<String>,
    pub amount: f64,
}

#[derive(Debug, Deserialize)]
pub struct CreditRequest {
    pub employee_id: Option<String>,
    pub customer_name: String,
    pub customer_contact: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct PayRequest {
    pub employee_id: Option<String>,
    pub paymentMethod: String,
    pub paidAmount: Option<f64>,
    pub shiftName: Option<String>,
    pub member_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EmployeeLoginRequest {
    pub employeeNo: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct ChangeEmployeePasswordRequest {
    pub employeeNo: String,
    pub old_password: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateEmployeeRequest {
    #[serde(default)]
    pub employeeNo: String,
    pub name: String,
    pub password: String,
    pub roleId: String,
    #[serde(default)]
    pub modulePermissions: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEmployeeRequest {
    pub name: String,
    pub roleId: String,
    #[serde(default)]
    pub password: Option<String>,
    pub modulePermissions: Vec<String>,
}

const EMPLOYEE_MODULES: &[&str] = &["cashier", "reservation", "member", "warehouse", "finance", "base-settings", "system"];

fn validate_employee_password(password: &str) -> AppResult<()> {
    if !(4..=8).contains(&password.len()) || !password.bytes().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::BadRequest("密码必须为 4–8 位数字或字母".into()));
    }
    Ok(())
}

async fn validate_employee_fields(pool: &sqlx::SqlitePool, name: &str, role: &str, modules: &[String]) -> AppResult<()> {
    if name.trim().is_empty() { return Err(AppError::BadRequest("员工名称不能为空".into())); }
    if modules.iter().any(|m| !EMPLOYEE_MODULES.contains(&m.as_str())) {
        return Err(AppError::BadRequest("无效的模块权限".into()));
    }
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM employee_roles WHERE id=?)")
        .bind(role).fetch_one(pool).await?;
    if !exists { return Err(AppError::BadRequest("请选择有效角色".into())); }
    Ok(())
}

async fn authorize_employee_management(pool: &sqlx::SqlitePool, claims: &Claims) -> AppResult<bool> {
    let actor: Option<(String, i32, String)> = sqlx::query_as("SELECT roleId, enabled, extraPermissions FROM employees WHERE id=?")
        .bind(&claims.sub).fetch_optional(pool).await?;
    if let Some((role, enabled, extra)) = actor {
        if enabled == 1 && (role == "admin" || permissions_from_json(&extra).iter().any(|p| p == "system")) {
            return Ok(role == "admin");
        }
    } else if claims.permissions.iter().any(|p| p == "admin") {
        // Authenticated server-management clients use the existing admin permission.
        return Ok(true);
    }
    Err(AppError::Forbidden("没有人员管理权限".into()))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EmployeeInfo {
    pub id: String,
    pub employeeNo: String,
    pub name: String,
    pub roleId: String,
    pub enabled: i32,
    pub extraPermissions: String,
    pub createdAt: String,
    pub updatedAt: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EmployeeRole {
    pub id: String,
    pub name: String,
    pub permissions: String,
}

#[derive(Debug, Serialize)]
pub struct EmployeeLoginResponse {
    pub token: String,
    pub employee: EmployeeInfo,
    pub permissions: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct FinanceQuery {
    pub start: Option<String>,
    pub end: Option<String>,
    pub roomId: Option<String>,
    pub income_type: Option<String>,
    pub shiftName: Option<String>,
    pub unreported: Option<bool>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FinanceRecord {
    pub sessionId: String,
    pub voucherNo: Option<String>,
    pub roomId: String,
    pub roomName: Option<String>,
    pub startTime: String,
    pub endTime: Option<String>,
    pub checkoutTime: Option<String>,
    pub roomAmount: f64,
    pub beverageAmount: f64,
    pub payableAmount: f64,
    pub prepayAmount: f64,
    pub paidAmount: f64,
    pub paymentMethod: Option<String>,
    pub status: String,
    pub shiftName: Option<String>,
    pub cashier_name: Option<String>,
    pub waiter_name: Option<String>,
    pub sales_manager_name: Option<String>,
    pub orderCount: i64,
}

#[derive(Debug, Serialize)]
pub struct FinanceReport {
    pub records: Vec<FinanceRecord>,
    pub room_income: f64,
    pub beverage_income: f64,
    pub total_income: f64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FinanceOrderDetail {
    pub orderId: String,
    pub order_time: String,
    pub productName: String,
    pub quantity: i64,
    pub unit: String,
    pub price: f64,
    pub amount: f64,
    pub remark: String,
    pub operatorName: String,
}

#[derive(Debug, Deserialize)]
pub struct ShiftReportRequest {
    pub shift_date: String,
    pub startTime: String,
    pub endTime: String,
    pub employee_id: Option<String>,
    pub shiftName: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PrinterConfigRequest {
    pub name: String,
    pub printerType: String,
    pub address: String,
    pub enabled: Option<i32>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PrinterConfig {
    pub id: String,
    pub name: String,
    pub printerType: String,
    pub address: String,
    pub enabled: i32,
    pub createdAt: String,
}

#[derive(Debug, sqlx::FromRow)]
struct RateRow {
    rate_per_hour: f64,
    rate_per_minute: f64,
}

#[derive(Debug, sqlx::FromRow)]
struct BuyoutPackageRow {
    duration_minutes: i64,
    price: f64,
    overtime_rate_per_minute: f64,
}

#[derive(Debug, sqlx::FromRow)]
struct EmployeeAuthRow {
    id: String,
    employeeNo: String,
    name: String,
    passwordHash: String,
    roleId: String,
    enabled: i32,
    extraPermissions: String,
    rolePermissions: String,
    createdAt: String,
    updatedAt: String,
}

fn parse_time(value: &str) -> AppResult<DateTime<Local>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(value) {
        return Ok(dt.with_timezone(&Local));
    }
    let dt = NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .map_err(|_| AppError::BadRequest(format!("时间格式无效: {}", value)))?;
    Local
        .from_local_datetime(&dt)
        .single()
        .ok_or_else(|| AppError::BadRequest(format!("时间格式无效: {}", value)))
}

fn permissions_from_json(value: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value).unwrap_or_default()
}

async fn require_permission(
    state: &AppState,
    employee_id: &Option<String>,
    permission: &str,
) -> AppResult<()> {
    let Some(employee_id) = employee_id else {
        return Err(AppError::Forbidden("缺少员工信息".to_string()));
    };

    let row = sqlx::query_as::<_, EmployeeAuthRow>(
        "SELECT e.id, e.employeeNo, e.name, e.passwordHash, e.roleId, e.enabled, e.extraPermissions, \
                r.permissions AS rolePermissions, e.createdAt, e.updatedAt \
         FROM employees e LEFT JOIN employee_roles r ON e.roleId = r.id WHERE e.id = ?"
    )
    .bind(employee_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Forbidden("员工不存在".to_string()))?;

    if row.enabled != 1 {
        return Err(AppError::Forbidden("员工已禁用".to_string()));
    }

    let mut permissions = permissions_from_json(&row.rolePermissions);
    permissions.extend(permissions_from_json(&row.extraPermissions));
    if permissions.iter().any(|item| item == permission) {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!("缺少权限: {}", permission)))
    }
}

async fn audit(
    state: &AppState,
    action: &str,
    employee_id: &Option<String>,
    targetId: &str,
    detail: serde_json::Value,
) -> AppResult<()> {
    sqlx::query("INSERT INTO cashier_audit_logs (id, action, employee_id, targetId, detail) VALUES (?, ?, ?, ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(action)
        .bind(employee_id)
        .bind(targetId)
        .bind(detail.to_string())
        .execute(&state.db)
        .await?;
    Ok(())
}

async fn get_billing_setting_value(state: &AppState, key: &str) -> AppResult<Value> {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT value FROM billing_base_settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&state.db)
            .await?;
    Ok(raw
        .and_then(|value| serde_json::from_str::<Value>(&value).ok())
        .unwrap_or(Value::Null))
}

fn value_f64(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(|item| item.as_f64())
}

fn value_i64(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(|item| item.as_i64())
}

fn matches_room_type(value: &Value, room_type_id: Option<i32>) -> bool {
    let Some(room_type_id) = room_type_id else {
        return false;
    };
    value_i64(value, "room_type_id")
        .map(|id| id as i32 == room_type_id)
        .unwrap_or(false)
}

fn price_for_mode(rate: &Value, mode: &str) -> Option<f64> {
    match mode {
        "member" => value_f64(rate, "member_price").or_else(|| value_f64(rate, "price")),
        "holiday" => value_f64(rate, "holiday_price").or_else(|| value_f64(rate, "normal_price")),
        _ => value_f64(rate, "normal_price").or_else(|| value_f64(rate, "price")),
    }
}

fn parse_minutes_of_day(value: Option<&str>, fallback: u32) -> u32 {
    let Some(value) = value else {
        return fallback;
    };
    let mut parts = value.split(':');
    let hour = parts
        .next()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(fallback / 60)
        .min(23);
    let minute = parts
        .next()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(fallback % 60)
        .min(59);
    hour * 60 + minute
}

fn matches_weekday_and_time(rate: &Value) -> bool {
    let now = Local::now();
    let weekday = now.weekday().number_from_monday() as i64;
    let weekday_matches = rate
        .get("weekdays")
        .or_else(|| rate.get("week_days"))
        .or_else(|| rate.get("days_of_week"))
        .and_then(|v| v.as_array())
        .map(|days| days.is_empty() || days.iter().any(|day| day.as_i64() == Some(weekday)))
        .unwrap_or(true);
    if !weekday_matches {
        return false;
    }

    let start = parse_minutes_of_day(rate.get("startTime").and_then(|v| v.as_str()), 0);
    let end = parse_minutes_of_day(rate.get("endTime").and_then(|v| v.as_str()), 1439);
    let current = now.hour() * 60 + now.minute();
    if start <= end {
        current >= start && current <= end
    } else {
        current >= start || current <= end
    }
}

fn matched_room_type_rate<'a>(rates: &'a Value, room_type_id: Option<i32>) -> Option<&'a Value> {
    rates.as_array().and_then(|items| {
        items
            .iter()
            .find(|item| matches_room_type(item, room_type_id) && matches_weekday_and_time(item))
    })
}

fn value_string<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(|item| item.as_str())
}

async fn billing_preview_description(
    state: &AppState,
    session: &BillingSession,
    billed_minutes: i64,
    roomAmount: f64,
    price_mode: &str,
) -> AppResult<String> {
    if session.billingMode == "buyout" {
        let periods = get_billing_setting_value(state, "buyout_periods").await?;
        if let Some(period) = periods.as_array().and_then(|items| {
            items.iter().find(|item| {
                item.get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true)
                    && (matches_room_type(item, session.room_type_id)
                        || item.get("room_type_id").is_none())
            })
        }) {
            let name = value_string(period, "name").unwrap_or("买断规则");
            let duration = value_i64(period, "duration_minutes").unwrap_or(billed_minutes);
            let price = value_f64(period, "price").unwrap_or(roomAmount);
            let overtime = value_f64(period, "overtime_rate_per_minute").unwrap_or(0.0);
            return Ok(format!(
                "{name}：买断 {} 分钟 ¥{:.2}，超时 ¥{:.2}/分钟",
                duration, price, overtime
            ));
        }
        return Ok("未匹配到买断时段设置".to_string());
    }

    if session.billingMode == "activity" {
        let rules = get_billing_setting_value(state, "activity_rules").await?;
        if let Some(rule) = rules.as_array().and_then(|items| {
            items.iter().find(|item| {
                item.get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true)
                    && (matches_room_type(item, session.room_type_id)
                        || item.get("room_type_id").is_none())
            })
        }) {
            let name = value_string(rule, "name").unwrap_or("活动规则");
            if let Some(fixed_price) =
                value_f64(rule, "fixed_price").or_else(|| value_f64(rule, "price"))
            {
                return Ok(format!("{name}：活动固定价 ¥{:.2}", fixed_price));
            }
            if let Some(discount) = value_f64(rule, "discount") {
                return Ok(format!(
                    "{name}：活动折扣 {:.0} 折，金额 ¥{:.2}",
                    discount * 10.0,
                    roomAmount
                ));
            }
        }
        return Ok("未匹配到活动设置".to_string());
    }

    let rates = get_billing_setting_value(state, "room_type_rates").await?;
    if let Some(rate) = matched_room_type_rate(&rates, session.room_type_id) {
        let start = value_string(rate, "startTime").unwrap_or("00:00");
        let end = value_string(rate, "endTime").unwrap_or("23:59");
        let mode_name = match price_mode {
            "member" => "会员价",
            "holiday" => "节假日价",
            _ => "正常价",
        };
        let price = price_for_mode(rate, price_mode).unwrap_or(0.0);
        return Ok(format!(
            "{mode_name}：{}-{} ¥{:.2}/小时，最低计费 {} 分钟，金额 ¥{:.2}",
            start, end, price, billed_minutes, roomAmount
        ));
    }
    Ok("未匹配到房型价格设置".to_string())
}

async fn is_holiday_billing_day(state: &AppState) -> AppResult<bool> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let holidays = get_billing_setting_value(state, "holiday_dates").await?;
    let configured = holidays
        .as_array()
        .map(|items| {
            items.iter().any(|item| {
                item.as_str().map(|date| date == today).unwrap_or(false)
                    || item
                        .get("date")
                        .and_then(|date| date.as_str())
                        .map(|date| date == today)
                        .unwrap_or(false)
            })
        })
        .unwrap_or(false);
    Ok(configured || Local::now().weekday().number_from_monday() >= 6)
}

async fn calculate_configured_room_amount(
    state: &AppState,
    session: &BillingSession,
    actual_minutes: i64,
) -> AppResult<Option<(i64, f64)>> {
    let trial = get_billing_setting_value(state, "trial_singing").await?;
    let trial_enabled = trial
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let trial_minutes = trial.get("minutes").and_then(|v| v.as_i64()).unwrap_or(0);
    if trial_enabled && trial_minutes > 0 && actual_minutes <= trial_minutes {
        return Ok(Some((0, 0.0)));
    }

    if session.billingMode == "buyout" {
        let periods = get_billing_setting_value(state, "buyout_periods").await?;
        if let Some(period) = periods.as_array().and_then(|items| {
            items.iter().find(|item| {
                item.get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true)
                    && (matches_room_type(item, session.room_type_id)
                        || item.get("room_type_id").is_none())
            })
        }) {
            let duration = value_i64(period, "duration_minutes").unwrap_or(actual_minutes.max(60));
            let base_price = value_f64(period, "price").unwrap_or(0.0);
            let overtime_rate = value_f64(period, "overtime_rate_per_minute").unwrap_or(0.0);
            let overtime = (actual_minutes - duration).max(0);
            return Ok(Some((
                actual_minutes,
                base_price + overtime as f64 * overtime_rate,
            )));
        }
    }

    if session.billingMode == "activity" {
        let rules = get_billing_setting_value(state, "activity_rules").await?;
        if let Some(rule) = rules.as_array().and_then(|items| {
            items.iter().find(|item| {
                item.get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true)
                    && (matches_room_type(item, session.room_type_id)
                        || item.get("room_type_id").is_none())
            })
        }) {
            if let Some(fixed_price) =
                value_f64(rule, "fixed_price").or_else(|| value_f64(rule, "price"))
            {
                return Ok(Some((actual_minutes.max(60), fixed_price)));
            }
            if let Some(discount) = value_f64(rule, "discount") {
                let base = calculate_configured_room_amount_for_rate(
                    state,
                    session,
                    actual_minutes,
                    "normal",
                )
                .await?;
                if let Some((minutes, amount)) = base {
                    return Ok(Some((minutes, amount * discount)));
                }
            }
        }
    }

    let price_mode = if session.billingMode == "member" {
        "member"
    } else if is_holiday_billing_day(state).await? {
        "holiday"
    } else {
        "normal"
    };
    calculate_configured_room_amount_for_rate(state, session, actual_minutes, price_mode).await
}

async fn calculate_configured_room_amount_for_rate(
    state: &AppState,
    session: &BillingSession,
    actual_minutes: i64,
    price_mode: &str,
) -> AppResult<Option<(i64, f64)>> {
    let rates = get_billing_setting_value(state, "room_type_rates").await?;
    if let Some(rate) = rates.as_array().and_then(|items| {
        items.iter().find(|item| {
            matches_room_type(item, session.room_type_id) && matches_weekday_and_time(item)
        })
    }) {
        if let Some(hour_price) = price_for_mode(rate, price_mode) {
            let billed = actual_minutes.max(value_i64(rate, "min_minutes").unwrap_or(60));
            return Ok(Some((billed, billed as f64 * (hour_price / 60.0))));
        }
        if let Some(minute_price) = value_f64(rate, "rate_per_minute") {
            let billed = actual_minutes.max(value_i64(rate, "min_minutes").unwrap_or(60));
            return Ok(Some((billed, billed as f64 * minute_price)));
        }
    }
    Ok(None)
}

fn preview_session(
    roomId: String,
    room_type_id: Option<i32>,
    billingMode: String,
) -> BillingSession {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    BillingSession {
        id: "preview".to_string(),
        roomId,
        room_type_id,
        status: "preview".to_string(),
        billingMode,
        rateId: None,
        buyoutPackageId: None,
        startTime: now.clone(),
        endTime: None,
        actual_minutes: 0,
        billed_minutes: 0,
        roomAmount: 0.0,
        beverageAmount: 0.0,
        original_amount: 0.0,
        discountAmount: 0.0,
        rounding_amount: 0.0,
        payableAmount: 0.0,
        paidAmount: 0.0,
        paymentMethod: None,
        paymentTime: None,
        voucherNo: None,
        discount_reason: None,
        free_reason: None,
        credit_customer_name: None,
        credit_customer_contact: None,
        credit_reason: None,
        operatorEmployeeId: None,
        shiftName: None,
        payTiming: None,
        prepayAmount: 0.0,
        timerMinutes: None,
        timerReminderEnabled: 0,
        billingRuleLabel: None,
        order_items: Vec::new(),
        createdAt: now.clone(),
        updatedAt: now,
    }
}

pub async fn preview_billing_price(
    State(state): State<AppState>,
    Query(query): Query<BillingPricePreviewQuery>,
) -> AppResult<Json<ApiResponse<BillingPricePreview>>> {
    let room_type_id: Option<i32> = sqlx::query_scalar("SELECT typeId FROM rooms WHERE id = ?")
        .bind(&query.roomId)
        .fetch_optional(&state.db)
        .await?
        .flatten();
    let billingMode = query.billingMode.unwrap_or_else(|| "minute".to_string());
    let session = preview_session(query.roomId.clone(), room_type_id, billingMode.clone());
    let actual_minutes = 60;
    let (billed_minutes, roomAmount) =
        calculate_configured_room_amount(&state, &session, actual_minutes)
            .await?
            .unwrap_or((60, 0.0));
    let rule_label = billingRuleLabel(&state, &session, actual_minutes).await?;
    let hourly_price = if billed_minutes > 0 {
        roomAmount / billed_minutes as f64 * 60.0
    } else {
        0.0
    };
    let price_mode = if billingMode == "member" {
        "member"
    } else if is_holiday_billing_day(&state).await? {
        "holiday"
    } else {
        "normal"
    };
    let description =
        billing_preview_description(&state, &session, billed_minutes, roomAmount, price_mode)
            .await?;
    Ok(Json(ApiResponse::success(BillingPricePreview {
        roomId: query.roomId,
        room_type_id,
        billingMode,
        billed_minutes,
        roomAmount,
        hourly_price,
        rule_label,
        description,
    })))
}

async fn billingRuleLabel(
    state: &AppState,
    session: &BillingSession,
    actual_minutes: i64,
) -> AppResult<String> {
    let trial = get_billing_setting_value(state, "trial_singing").await?;
    let trial_enabled = trial
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let trial_minutes = trial.get("minutes").and_then(|v| v.as_i64()).unwrap_or(0);
    if trial_enabled && trial_minutes > 0 && actual_minutes <= trial_minutes {
        return Ok(format!("试唱免费 {} 分钟内", trial_minutes));
    }
    match session.billingMode.as_str() {
        "buyout" => Ok("买断计费".to_string()),
        "activity" => Ok("活动计费".to_string()),
        "member" => Ok("会员价格".to_string()),
        _ if is_holiday_billing_day(state).await? => Ok("节假日价格".to_string()),
        _ => Ok("正常计时价格".to_string()),
    }
}

async fn calculate_session(
    state: &AppState,
    session: &BillingSession,
    close_time: Option<&str>,
) -> AppResult<(i64, i64, f64, f64, f64)> {
    let start = parse_time(&session.startTime)?;
    let end = if let Some(value) = close_time {
        parse_time(value)?
    } else {
        Local::now()
    };
    let actual_minutes = ((end - start).num_minutes()).max(0);
    let charge_minutes = if close_time.is_none() {
        session
            .timerMinutes
            .filter(|minutes| *minutes > 0)
            .unwrap_or(actual_minutes)
    } else {
        actual_minutes
    };
    let order_end_time = close_time
        .map(|value| value.to_string())
        .unwrap_or_else(|| end.to_rfc3339());
    let beverageAmount: f64 = sqlx::query_scalar(
        "SELECT CAST(COALESCE(SUM(totalAmount), 0) AS REAL) FROM cashier_orders \
         WHERE roomId = ? AND createdAt >= ? AND createdAt <= ? AND status IN ('pending','confirmed','completed','delivered')"
    )
    .bind(&session.roomId)
    .bind(&session.startTime)
    .bind(&order_end_time)
    .fetch_one(&state.db)
    .await?;

    let (billed_minutes, roomAmount) = if let Some(configured) =
        calculate_configured_room_amount(state, session, charge_minutes).await?
    {
        configured
    } else if session.billingMode == "buyout" {
        if let Some(package_id) = &session.buyoutPackageId {
            let package = sqlx::query_as::<_, BuyoutPackageRow>(
                "SELECT duration_minutes, price, overtime_rate_per_minute FROM buyout_packages WHERE id = ?"
            )
            .bind(package_id)
            .fetch_optional(&state.db)
            .await?;
            if let Some(package) = package {
                let overtime = (charge_minutes - package.duration_minutes).max(0);
                (
                    charge_minutes,
                    package.price + overtime as f64 * package.overtime_rate_per_minute,
                )
            } else {
                (charge_minutes.max(60), charge_minutes.max(60) as f64)
            }
        } else {
            (charge_minutes.max(60), charge_minutes.max(60) as f64)
        }
    } else {
        let rate = sqlx::query_as::<_, RateRow>(
            "SELECT rate_per_hour, rate_per_minute FROM billing_rates WHERE enabled = 1 ORDER BY room_type_id IS NOT NULL DESC LIMIT 1"
        )
        .fetch_one(&state.db)
        .await?;
        let billed = charge_minutes.max(60);
        let per_minute = if rate.rate_per_minute > 0.0 {
            rate.rate_per_minute
        } else {
            rate.rate_per_hour / 60.0
        };
        (billed, billed as f64 * per_minute)
    };

    let original_amount = roomAmount + beverageAmount;
    Ok((
        actual_minutes,
        billed_minutes,
        roomAmount,
        beverageAmount,
        original_amount,
    ))
}

async fn refresh_session_amounts(
    state: &AppState,
    sessionId: &str,
    close_time: Option<&str>,
) -> AppResult<BillingSession> {
    let session = get_session_by_id(state, sessionId).await?;
    let (actual_minutes, billed_minutes, roomAmount, beverageAmount, original_amount) =
        calculate_session(state, &session, close_time).await?;
    let rule_label = billingRuleLabel(state, &session, actual_minutes).await?;
    let payableAmount =
        (original_amount - session.discountAmount - session.rounding_amount - session.prepayAmount)
            .max(0.0);
    sqlx::query(
        "UPDATE billing_sessions SET actual_minutes = ?, billed_minutes = ?, roomAmount = ?, beverageAmount = ?, \
         original_amount = ?, payableAmount = ?, billingRuleLabel = ?, updatedAt = datetime('now','localtime') WHERE id = ?"
    )
    .bind(actual_minutes)
    .bind(billed_minutes)
    .bind(roomAmount)
    .bind(beverageAmount)
    .bind(original_amount)
    .bind(payableAmount)
    .bind(rule_label)
    .bind(sessionId)
    .execute(&state.db)
    .await?;
    get_session_by_id(state, sessionId).await
}

async fn get_session_by_id(state: &AppState, sessionId: &str) -> AppResult<BillingSession> {
    let mut session =
        sqlx::query_as::<_, BillingSession>("SELECT * FROM billing_sessions WHERE id = ?")
            .bind(sessionId)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("计费会话不存在: {}", sessionId)))?;
    session.order_items = get_billing_order_items(state, &session).await?;
    Ok(session)
}

async fn active_session_by_room(state: &AppState, roomId: &str) -> AppResult<BillingSession> {
    let mut session = sqlx::query_as::<_, BillingSession>("SELECT * FROM billing_sessions WHERE roomId = ? AND status = 'active' ORDER BY startTime DESC LIMIT 1")
        .bind(roomId)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("房间没有活动计费会话: {}", roomId)))?;
    session.order_items = get_billing_order_items(state, &session).await?;
    Ok(session)
}

async fn get_billing_order_items(
    state: &AppState,
    session: &BillingSession,
) -> AppResult<Vec<BillingOrderItem>> {
    let active_end_time = Local::now().to_rfc3339();
    let endTime = session
        .endTime
        .as_deref()
        .or(session.paymentTime.as_deref())
        .unwrap_or(&active_end_time);
    let items = sqlx::query_as::<_, BillingOrderItem>(
        "SELECT co.id AS orderId, coi.productId, coi.productName, co.createdAt AS order_time, coi.quantity, '份' AS unit, coi.price, coi.amount \
         FROM cashier_order_items coi \
         JOIN cashier_orders co ON co.id = coi.orderId \
         WHERE co.roomId = ? AND co.createdAt >= ? AND co.createdAt <= ? AND co.status IN ('pending','confirmed','completed','delivered') \
         ORDER BY co.createdAt, coi.id"
    )
    .bind(&session.roomId)
    .bind(&session.startTime)
    .bind(endTime)
    .fetch_all(&state.db)
    .await?;
    Ok(items)
}

async fn apply_room_type_gifts(state: &AppState, session: &BillingSession) -> AppResult<()> {
    let gifts = get_billing_setting_value(state, "room_type_gifts").await?;
    let Some(rule) = gifts.as_array().and_then(|items| {
        items
            .iter()
            .find(|item| matches_room_type(item, session.room_type_id))
    }) else {
        return Ok(());
    };
    let gift_items = rule
        .get("gifts")
        .and_then(|items| items.as_array())
        .cloned()
        .unwrap_or_default();
    if gift_items.is_empty() {
        return Ok(());
    }

    let orderId = uuid::Uuid::new_v4().to_string();
    let now = Local::now().to_rfc3339();
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO cashier_orders (id, roomId, totalAmount, status, createdAt, updatedAt) VALUES (?, ?, 0, 'confirmed', ?, ?)"
    )
    .bind(&orderId)
    .bind(&session.roomId)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    for gift in gift_items {
        let Some(productId) = gift.get("productId").and_then(|value| value.as_str()) else {
            continue;
        };
        let quantity = gift
            .get("quantity")
            .and_then(|value| value.as_i64())
            .unwrap_or(1)
            .max(1) as i32;
        let productName: Option<String> =
            sqlx::query_scalar("SELECT name FROM products WHERE id = ? AND enabled = 1")
                .bind(productId)
                .fetch_optional(&mut *tx)
                .await?;
        let Some(productName) = productName else {
            continue;
        };
        sqlx::query(
            "INSERT INTO cashier_order_items (id, orderId, productId, productName, quantity, price, amount) VALUES (?, ?, ?, ?, ?, 0, 0)"
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&orderId)
        .bind(productId)
        .bind(productName)
        .bind(quantity)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE products SET stock = CASE WHEN stock >= ? THEN stock - ? ELSE stock END, updatedAt = datetime('now','localtime') WHERE id = ?")
            .bind(quantity)
            .bind(quantity)
            .bind(productId)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn open_session(
    State(state): State<AppState>,
    Json(req): Json<OpenSessionRequest>,
) -> AppResult<Json<ApiResponse<BillingSession>>> {
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM billing_sessions WHERE roomId = ? AND status = 'active'",
    )
    .bind(&req.roomId)
    .fetch_one(&state.db)
    .await?;
    if exists > 0 {
        return Err(AppError::Conflict("该房间已有活动计费会话".to_string()));
    }

    let room_type_id: Option<i32> = sqlx::query_scalar("SELECT typeId FROM rooms WHERE id = ?")
        .bind(&req.roomId)
        .fetch_optional(&state.db)
        .await?
        .flatten();
    let rateId: Option<String> = sqlx::query_scalar("SELECT id FROM billing_rates WHERE enabled = 1 ORDER BY room_type_id IS NOT NULL DESC LIMIT 1")
        .fetch_optional(&state.db)
        .await?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = Local::now().to_rfc3339();
    let billingMode = req.billingMode.unwrap_or_else(|| {
        if req.buyoutPackageId.is_some() {
            "buyout".to_string()
        } else {
            "minute".to_string()
        }
    });

    sqlx::query(
        "INSERT INTO billing_sessions (id, roomId, room_type_id, status, billingMode, rateId, buyoutPackageId, startTime, operatorEmployeeId, shiftName, payTiming, prepayAmount, timerMinutes, timerReminderEnabled) \
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&req.roomId)
    .bind(room_type_id)
    .bind(&billingMode)
    .bind(rateId)
    .bind(&req.buyoutPackageId)
    .bind(now)
    .bind(&req.employee_id)
    .bind(req.shiftName.as_deref().unwrap_or("白班"))
    .bind(req.payTiming.as_deref().unwrap_or("postpaid"))
    .bind(req.prepayAmount.unwrap_or(0.0))
    .bind(if billingMode == "minute" { req.timerMinutes.filter(|v| *v > 0) } else { None })
    .bind(if req.timerReminderEnabled.unwrap_or(false) { 1 } else { 0 })
    .execute(&state.db)
    .await?;

    sqlx::query(
        "UPDATE rooms SET status = 1, updatedAt = datetime('now','localtime') WHERE id = ?",
    )
    .bind(&req.roomId)
    .execute(&state.db)
    .await?;

    let session = get_session_by_id(&state, &id).await?;
    apply_room_type_gifts(&state, &session).await?;
    let session = get_session_by_id(&state, &id).await?;
    state.ws.broadcast(
        json!({"type":"billing_session_opened","roomId":session.roomId,"sessionId":session.id}),
    );
    state.broadcast_cashier_room_changed(&session.roomId, json!(1), "open_room");
    broadcast_room_sync(&state, &session.roomId).await?;
    Ok(Json(ApiResponse::success(session)))
}

pub async fn get_room_bill(
    State(state): State<AppState>,
    Query(query): Query<RoomBillQuery>,
) -> AppResult<Json<ApiResponse<BillingSession>>> {
    let session = active_session_by_room(&state, &query.roomId).await?;
    let session = refresh_session_amounts(&state, &session.id, None).await?;
    Ok(Json(ApiResponse::success(session)))
}

pub async fn transfer_session(
    State(state): State<AppState>,
    Path(sessionId): Path<String>,
    Json(req): Json<TransferSessionRequest>,
) -> AppResult<Json<ApiResponse<BillingSession>>> {
    let mut tx = state.db.begin().await?;
    let source: Option<(String, String)> = sqlx::query_as(
        "SELECT roomId, startTime FROM billing_sessions WHERE id = ? AND status = 'active'",
    )
    .bind(&sessionId)
    .fetch_optional(&mut *tx)
    .await?;
    let (sourceRoomId, startTime) =
        source.ok_or_else(|| AppError::NotFound("未找到活动计费会话".to_string()))?;
    if sourceRoomId == req.targetRoomId {
        return Err(AppError::BadRequest(
            "目标房间不能与当前房间相同".to_string(),
        ));
    }
    let target_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms WHERE id = ?")
        .bind(&req.targetRoomId)
        .fetch_one(&mut *tx)
        .await?;
    if target_exists == 0 {
        return Err(AppError::NotFound("目标房间不存在".to_string()));
    }
    let target_active: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM billing_sessions WHERE roomId = ? AND status = 'active'",
    )
    .bind(&req.targetRoomId)
    .fetch_one(&mut *tx)
    .await?;
    if target_active > 0 {
        return Err(AppError::Conflict("目标房间正在使用中".to_string()));
    }
    sqlx::query("UPDATE billing_sessions SET roomId = ?, updatedAt = datetime('now','localtime') WHERE id = ?")
        .bind(&req.targetRoomId)
        .bind(&sessionId)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE cashier_orders SET roomId = ?, updatedAt = datetime('now','localtime') WHERE roomId = ? AND createdAt >= ? AND status IN ('pending','confirmed','completed','delivered')")
        .bind(&req.targetRoomId)
        .bind(&sourceRoomId)
        .bind(&startTime)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE rooms SET status = 0, updatedAt = datetime('now','localtime') WHERE id = ?",
    )
    .bind(&sourceRoomId)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE rooms SET status = 1, updatedAt = datetime('now','localtime') WHERE id = ?",
    )
    .bind(&req.targetRoomId)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let session = refresh_session_amounts(&state, &sessionId, None).await?;
    state.ws.broadcast(json!({"type":"billing_session_transferred","fromRoomId":sourceRoomId,"roomId":session.roomId,"sessionId":session.id}));
    state.broadcast_cashier_room_changed(&sourceRoomId, json!(0), "transfer_room");
    state.broadcast_cashier_room_changed(&session.roomId, json!(1), "transfer_room");
    broadcast_room_sync(&state, &sourceRoomId).await?;
    broadcast_room_sync(&state, &session.roomId).await?;
    Ok(Json(ApiResponse::success(session)))
}

pub async fn close_session(
    State(state): State<AppState>,
    Path(sessionId): Path<String>,
) -> AppResult<Json<ApiResponse<BillingSession>>> {
    let now = Local::now().to_rfc3339();
    refresh_session_amounts(&state, &sessionId, Some(&now)).await?;
    sqlx::query("UPDATE billing_sessions SET status = 'closed', endTime = ?, updatedAt = datetime('now','localtime') WHERE id = ?")
        .bind(now)
        .bind(&sessionId)
        .execute(&state.db)
        .await?;
    let session = get_session_by_id(&state, &sessionId).await?;
    state.ws.broadcast(
        json!({"type":"billing_session_closed","roomId":session.roomId,"sessionId":session.id}),
    );
    state.broadcast_cashier_room_changed(&session.roomId, json!("closed"), "close_session");
    Ok(Json(ApiResponse::success(session)))
}

pub async fn apply_discount(
    State(state): State<AppState>,
    Path(sessionId): Path<String>,
    Json(req): Json<ApplyDiscountRequest>,
) -> AppResult<Json<ApiResponse<BillingSession>>> {
    require_permission(&state, &req.employee_id, "discount").await?;
    let session = refresh_session_amounts(&state, &sessionId, None).await?;
    let amount = req
        .discountAmount
        .unwrap_or_else(|| session.original_amount * req.discount_percent.unwrap_or(0.0) / 100.0);
    if amount < 0.0 || amount > session.original_amount {
        return Err(AppError::BadRequest("折扣金额无效".to_string()));
    }
    let payable =
        (session.original_amount - amount - session.rounding_amount - session.prepayAmount)
            .max(0.0);
    sqlx::query("UPDATE billing_sessions SET discountAmount = ?, discount_reason = ?, payableAmount = ?, updatedAt = datetime('now','localtime') WHERE id = ?")
        .bind(amount)
        .bind(&req.reason)
        .bind(payable)
        .bind(&sessionId)
        .execute(&state.db)
        .await?;
    audit(
        &state,
        "discount",
        &req.employee_id,
        &sessionId,
        json!({"amount": amount, "reason": req.reason}),
    )
    .await?;
    Ok(Json(ApiResponse::success(
        get_session_by_id(&state, &sessionId).await?,
    )))
}

pub async fn free_bill(
    State(state): State<AppState>,
    Path(sessionId): Path<String>,
    Json(req): Json<FreeBillRequest>,
) -> AppResult<Json<ApiResponse<BillingSession>>> {
    require_permission(&state, &req.employee_id, "free_bill").await?;
    let session = refresh_session_amounts(&state, &sessionId, None).await?;
    sqlx::query("UPDATE billing_sessions SET discountAmount = ?, payableAmount = 0, free_reason = ?, updatedAt = datetime('now','localtime') WHERE id = ?")
        .bind(session.original_amount)
        .bind(&req.reason)
        .bind(&sessionId)
        .execute(&state.db)
        .await?;
    audit(
        &state,
        "free_bill",
        &req.employee_id,
        &sessionId,
        json!({"reason": req.reason}),
    )
    .await?;
    Ok(Json(ApiResponse::success(
        get_session_by_id(&state, &sessionId).await?,
    )))
}

pub async fn apply_rounding(
    State(state): State<AppState>,
    Path(sessionId): Path<String>,
    Json(req): Json<RoundingRequest>,
) -> AppResult<Json<ApiResponse<BillingSession>>> {
    require_permission(&state, &req.employee_id, "rounding").await?;
    let session = refresh_session_amounts(&state, &sessionId, None).await?;
    let limit = (session.original_amount * 0.05).min(10.0);
    if req.amount < 0.0 || req.amount > limit {
        return Err(AppError::BadRequest(format!(
            "抹零金额不能超过 {:.2}",
            limit
        )));
    }
    let payable =
        (session.original_amount - session.discountAmount - req.amount - session.prepayAmount)
            .max(0.0);
    sqlx::query("UPDATE billing_sessions SET rounding_amount = ?, payableAmount = ?, updatedAt = datetime('now','localtime') WHERE id = ?")
        .bind(req.amount)
        .bind(payable)
        .bind(&sessionId)
        .execute(&state.db)
        .await?;
    audit(
        &state,
        "rounding",
        &req.employee_id,
        &sessionId,
        json!({"amount": req.amount}),
    )
    .await?;
    Ok(Json(ApiResponse::success(
        get_session_by_id(&state, &sessionId).await?,
    )))
}

pub async fn credit_bill(
    State(state): State<AppState>,
    Path(sessionId): Path<String>,
    Json(req): Json<CreditRequest>,
) -> AppResult<Json<ApiResponse<BillingSession>>> {
    require_permission(&state, &req.employee_id, "credit").await?;
    let session = refresh_session_amounts(&state, &sessionId, None).await?;
    sqlx::query("UPDATE billing_sessions SET status = 'credited', endTime = COALESCE(endTime, ?), credit_customer_name = ?, credit_customer_contact = ?, credit_reason = ?, updatedAt = datetime('now','localtime') WHERE id = ?")
        .bind(Local::now().to_rfc3339())
        .bind(&req.customer_name)
        .bind(&req.customer_contact)
        .bind(&req.reason)
        .bind(&sessionId)
        .execute(&state.db)
        .await?;
    sqlx::query(
        "UPDATE rooms SET status = 0, updatedAt = datetime('now','localtime') WHERE id = ?",
    )
    .bind(&session.roomId)
    .execute(&state.db)
    .await?;
    audit(
        &state,
        "credit",
        &req.employee_id,
        &sessionId,
        json!({"customer_name": req.customer_name, "reason": req.reason}),
    )
    .await?;
    state.broadcast_cashier_room_changed(&session.roomId, json!(0), "credit_bill");
    broadcast_room_sync(&state, &session.roomId).await?;
    Ok(Json(ApiResponse::success(
        get_session_by_id(&state, &sessionId).await?,
    )))
}

pub async fn pay_session(
    State(state): State<AppState>,
    Path(sessionId): Path<String>,
    Json(req): Json<PayRequest>,
) -> AppResult<Json<ApiResponse<BillingSession>>> {
    let existing = get_session_by_id(&state, &sessionId).await?;
    if existing.status == "paid" {
        return Ok(Json(ApiResponse::success(existing)));
    }
    let now = Local::now().to_rfc3339();
    let session = refresh_session_amounts(&state, &sessionId, Some(&now)).await?;
    let paidAmount = req.paidAmount.unwrap_or(session.payableAmount);
    if !paidAmount.is_finite() || paidAmount < 0.0 {
        return Err(AppError::BadRequest("付款金额不正确".into()));
    }
    if req.paymentMethod == "member" && req.member_id.as_deref().unwrap_or("").is_empty() {
        return Err(AppError::BadRequest("请选择付款会员".into()));
    }
    let today = Local::now().format("%Y%m%d").to_string();
    let today_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM billing_sessions WHERE voucherNo LIKE ?")
            .bind(format!("{}%", today))
            .fetch_one(&state.db)
            .await?;
    let voucherNo = format!("{}{:04}", today, today_count + 1);
    let mut tx = state.db.begin().await?;
    let updated = sqlx::query(
        "UPDATE billing_sessions SET status = 'paid', endTime = COALESCE(endTime, ?), paidAmount = ?, paymentMethod = ?, paymentTime = ?, voucherNo = ?, shiftName = COALESCE(?, shiftName), updatedAt = datetime('now','localtime') WHERE id = ? AND status != 'paid'"
    )
    .bind(&now)
    .bind(paidAmount)
    .bind(&req.paymentMethod)
    .bind(&now)
    .bind(&voucherNo)
    .bind(&req.shiftName)
    .bind(&sessionId)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(AppError::Conflict("账单已结账，请刷新".into()));
    }
    if let Some(member_id) = req.member_id.as_deref().filter(|id| !id.is_empty()) {
        super::customer_handler::change_balance(&mut tx, member_id,
            &super::customer_handler::BalanceInput {
                request_id: format!("checkout-{}", sessionId),
                balance_delta: if req.paymentMethod == "member" { -paidAmount } else { 0.0 },
                points_delta: paidAmount.floor() as i64,
            }, req.employee_id.as_deref().unwrap_or("")).await?;
    }
    sqlx::query(
        "UPDATE rooms SET status = 0, updatedAt = datetime('now','localtime') WHERE id = ?",
    )
    .bind(&session.roomId)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    state.ws.broadcast(json!({"type":"cashier_customers_changed"}));
    audit(
        &state,
        "payment",
        &req.employee_id,
        &sessionId,
        json!({"method": req.paymentMethod, "paidAmount": paidAmount, "voucherNo": voucherNo}),
    )
    .await?;
    let session = get_session_by_id(&state, &sessionId).await?;
    state.ws.broadcast(json!({"type":"billing_session_paid","roomId":session.roomId,"sessionId":session.id,"voucherNo":session.voucherNo}));
    state.broadcast_cashier_room_changed(&session.roomId, json!(0), "pay_session");
    broadcast_room_sync(&state, &session.roomId).await?;
    Ok(Json(ApiResponse::success(session)))
}

pub async fn list_employees(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<EmployeeInfo>>>> {
    let employees = sqlx::query_as::<_, EmployeeInfo>(
        "SELECT id, employeeNo, name, roleId, enabled, extraPermissions, createdAt, updatedAt FROM employees ORDER BY createdAt DESC"
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(employees)))
}

pub async fn list_employee_roles(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<EmployeeRole>>>> {
    let roles = sqlx::query_as::<_, EmployeeRole>(
        "SELECT id, name, permissions FROM employee_roles ORDER BY createdAt ASC",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(roles)))
}

pub async fn create_employee(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateEmployeeRequest>,
) -> AppResult<Json<ApiResponse<EmployeeInfo>>> {
    if !req.employeeNo.trim().is_empty() && req.employeeNo.trim().len() < 2 {
        return Err(AppError::BadRequest("登录账号至少 2 个字符".to_string()));
    }
    let admin = authorize_employee_management(&state.db, &claims).await?;
    if req.roleId == "admin" && !admin { return Err(AppError::Forbidden("只有管理员可以创建管理员账号".into())); }
    validate_employee_fields(&state.db, &req.name, &req.roleId, &req.modulePermissions).await?;
    validate_employee_password(&req.password)?;
    let passwordHash =
        hash(&req.password, DEFAULT_COST).map_err(|e| AppError::Internal(e.into()))?;
    let employee = insert_employee(&state.db, &req, &passwordHash).await?;
    Ok(Json(ApiResponse::success(employee)))
}

// Used both by the preview endpoint and inside the atomic INSERT. Only all-digit
// employee numbers participate; disabled employees still reserve their numbers.
const NEXT_EMPLOYEE_NUMBER_SQL: &str = "SELECT CASE WHEN max_no < 9223372036854775807 THEN CAST(max_no + 1 AS TEXT) END FROM (SELECT MAX(1000, COALESCE(MAX(CAST(employeeNo AS INTEGER)), 1000)) AS max_no FROM employees WHERE employeeNo <> '' AND employeeNo NOT GLOB '*[^0-9]*')";

pub async fn update_employee(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Json(req): Json<UpdateEmployeeRequest>,
) -> AppResult<Json<ApiResponse<EmployeeInfo>>> {
    let admin = authorize_employee_management(&state.db, &claims).await?;
    Ok(Json(ApiResponse::success(update_employee_record(&state.db, &id, &req, admin).await?)))
}

async fn update_employee_record(pool: &sqlx::SqlitePool, id: &str, req: &UpdateEmployeeRequest, admin: bool) -> AppResult<EmployeeInfo> {
    validate_employee_fields(pool, &req.name, &req.roleId, &req.modulePermissions).await?;
    let existing: EmployeeInfo = sqlx::query_as("SELECT id, employeeNo, name, roleId, enabled, extraPermissions, createdAt, updatedAt FROM employees WHERE id=?")
        .bind(id).fetch_optional(pool).await?.ok_or_else(|| AppError::NotFound("员工不存在".into()))?;
    if !admin && (existing.roleId == "admin" || req.roleId == "admin") {
        return Err(AppError::Forbidden("只有管理员可以维护管理员账号".into()));
    }
    if existing.roleId == "admin" && req.roleId != "admin" {
        return Err(AppError::Forbidden("管理员账号不能更改为其他角色".into()));
    }
    let password_hash = match req.password.as_deref().filter(|p| !p.is_empty()) {
        Some(password) => { validate_employee_password(password)?; Some(hash(password, DEFAULT_COST).map_err(|e| AppError::Internal(e.into()))?) },
        None => None,
    };
    // Module edits must not discard unrelated legacy operation permissions.
    let mut permissions = permissions_from_json(&existing.extraPermissions);
    permissions.retain(|p| !EMPLOYEE_MODULES.contains(&p.as_str()));
    permissions.extend(req.modulePermissions.clone());
    permissions.sort(); permissions.dedup();
    sqlx::query_as::<_, EmployeeInfo>("UPDATE employees SET name=?, roleId=?, extraPermissions=?, passwordHash=COALESCE(?, passwordHash), updatedAt=datetime('now','localtime') WHERE id=? AND (roleId <> 'admin' OR ? = 'admin') AND (? OR roleId <> 'admin') RETURNING id, employeeNo, name, roleId, enabled, extraPermissions, createdAt, updatedAt")
        .bind(req.name.trim()).bind(&req.roleId).bind(serde_json::to_string(&permissions).unwrap())
        .bind(password_hash).bind(id).bind(&req.roleId).bind(admin)
        .fetch_optional(pool).await?.ok_or_else(|| AppError::Forbidden("账号状态已变化，请刷新后重试".into()))
}

pub async fn delete_employee(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<Value>>> {
    authorize_employee_management(&state.db, &claims).await?;
    delete_employee_record(&state.db, &id).await?;
    Ok(Json(ApiResponse::success(json!({"deleted": true}))))
}

async fn delete_employee_record(pool: &sqlx::SqlitePool, id: &str) -> AppResult<()> {
    let removed = sqlx::query("DELETE FROM employees WHERE id=? AND roleId <> 'admin'")
        .bind(id).execute(pool).await?.rows_affected();
    if removed == 0 {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM employees WHERE id=?)")
            .bind(id).fetch_one(pool).await?;
        return Err(if exists { AppError::Forbidden("管理员账号不能删除".into()) }
            else { AppError::NotFound("员工不存在".into()) });
    }
    Ok(())
}

pub async fn next_employee_number(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Value>>> {
    let number: Option<String> = sqlx::query_scalar(NEXT_EMPLOYEE_NUMBER_SQL)
        .fetch_one(&state.db).await?;
    let number = number.ok_or_else(|| AppError::BadRequest("工号已达到编号上限".to_string()))?;
    Ok(Json(ApiResponse::success(json!({"employeeNo": number}))))
}

async fn insert_employee(
    pool: &sqlx::SqlitePool, req: &CreateEmployeeRequest, password_hash: &str,
) -> AppResult<EmployeeInfo> {
    let id = uuid::Uuid::new_v4().to_string();
    let query = format!("INSERT INTO employees (id, employeeNo, name, passwordHash, roleId, extraPermissions) VALUES (?, COALESCE(NULLIF(?, ''), ({NEXT_EMPLOYEE_NUMBER_SQL})), ?, ?, ?, ?) RETURNING id, employeeNo, name, roleId, enabled, extraPermissions, createdAt, updatedAt");
    sqlx::query_as::<_, EmployeeInfo>(&query)
    .bind(&id)
    .bind(req.employeeNo.trim())
    .bind(req.name.trim())
    .bind(password_hash)
    .bind(&req.roleId)
    .bind(serde_json::to_string(&req.modulePermissions).unwrap_or_else(|_| "[]".to_string()))
    .fetch_one(pool)
    .await.map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_unique_violation() => AppError::BadRequest("工号已存在，请刷新后重试".to_string()),
        sqlx::Error::Database(db) if db.kind() == sqlx::error::ErrorKind::NotNullViolation => AppError::BadRequest("工号已达到编号上限".to_string()),
        _ => error.into(),
    })
}

pub async fn employee_login(
    State(state): State<AppState>,
    Json(req): Json<EmployeeLoginRequest>,
) -> AppResult<Json<ApiResponse<EmployeeLoginResponse>>> {
    let row = sqlx::query_as::<_, EmployeeAuthRow>(
        "SELECT e.id, e.employeeNo, e.name, e.passwordHash, e.roleId, e.enabled, e.extraPermissions, \
                r.permissions AS rolePermissions, e.createdAt, e.updatedAt \
         FROM employees e LEFT JOIN employee_roles r ON e.roleId = r.id WHERE e.employeeNo = ?"
    )
    .bind(&req.employeeNo)
    .fetch_optional(&state.db)
    .await?;

    let Some(row) = row else {
        sqlx::query("INSERT INTO employee_login_logs (id, employeeNo, success, message) VALUES (?, ?, 0, '员工不存在')")
            .bind(uuid::Uuid::new_v4().to_string()).bind(&req.employeeNo).execute(&state.db).await?;
        return Err(AppError::Unauthorized("工号或密码错误".to_string()));
    };

    let ok = row.enabled == 1 && verify(&req.password, &row.passwordHash).unwrap_or(false);
    sqlx::query(
        "INSERT INTO employee_login_logs (id, employeeNo, success, message) VALUES (?, ?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&req.employeeNo)
    .bind(if ok { 1 } else { 0 })
    .bind(if ok {
        "登录成功"
    } else {
        "密码错误或账号禁用"
    })
    .execute(&state.db)
    .await?;
    if !ok {
        return Err(AppError::Unauthorized("工号或密码错误".to_string()));
    }

    let mut permissions = permissions_from_json(&row.rolePermissions);
    permissions.extend(permissions_from_json(&row.extraPermissions));
    let employee = EmployeeInfo {
        id: row.id.clone(),
        employeeNo: row.employeeNo.clone(),
        name: row.name,
        roleId: row.roleId,
        enabled: row.enabled,
        extraPermissions: row.extraPermissions,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
    let (token, _) = AuthService::generate_token(
        &state.config.jwt,
        &row.id,
        &row.employeeNo,
        permissions.clone(),
    )?;
    Ok(Json(ApiResponse::success(EmployeeLoginResponse {
        token,
        employee,
        permissions,
    })))
}

pub async fn change_employee_password(
    State(state): State<AppState>,
    Json(req): Json<ChangeEmployeePasswordRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    validate_employee_password(&req.new_password)?;
    let row = sqlx::query_as::<_, EmployeeAuthRow>(
        "SELECT e.id, e.employeeNo, e.name, e.passwordHash, e.roleId, e.enabled, e.extraPermissions, \
                r.permissions AS rolePermissions, e.createdAt, e.updatedAt \
         FROM employees e LEFT JOIN employee_roles r ON e.roleId = r.id WHERE e.employeeNo = ?"
    )
    .bind(&req.employeeNo)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Unauthorized("工号或旧密码错误".to_string()))?;
    if row.enabled != 1 || !verify(&req.old_password, &row.passwordHash).unwrap_or(false) {
        return Err(AppError::Unauthorized("工号或旧密码错误".to_string()));
    }
    let passwordHash =
        hash(req.new_password, DEFAULT_COST).map_err(|e| AppError::Internal(e.into()))?;
    sqlx::query("UPDATE employees SET passwordHash = ?, updatedAt = datetime('now','localtime') WHERE id = ?")
        .bind(passwordHash)
        .bind(&row.id)
        .execute(&state.db)
        .await?;
    Ok(Json(ApiResponse::success(json!({"changed": true}))))
}

pub async fn finance_report(
    State(state): State<AppState>,
    Query(query): Query<FinanceQuery>,
) -> AppResult<Json<ApiResponse<FinanceReport>>> {
    let start = query
        .start
        .unwrap_or_else(|| "1970-01-01T00:00:00+08:00".to_string());
    let end = query.end.unwrap_or_else(|| Local::now().to_rfc3339());
    let sql = "SELECT bs.id AS sessionId, bs.voucherNo, bs.roomId, r.name AS roomName, bs.startTime, bs.endTime, bs.paymentTime AS checkoutTime, \
        bs.roomAmount, bs.beverageAmount, bs.payableAmount, bs.prepayAmount, bs.paidAmount, bs.paymentMethod, bs.status, bs.shiftName, \
        e.name AS cashier_name, NULL AS waiter_name, NULL AS sales_manager_name, \
        (SELECT COUNT(*) FROM cashier_orders co WHERE co.roomId = bs.roomId AND co.createdAt >= bs.startTime AND co.createdAt <= COALESCE(bs.endTime, bs.paymentTime, bs.updatedAt)) AS orderCount \
        FROM billing_sessions bs LEFT JOIN employees e ON e.id = bs.operatorEmployeeId LEFT JOIN rooms r ON r.id = bs.roomId \
        WHERE COALESCE(bs.paymentTime, bs.endTime) >= ? AND COALESCE(bs.paymentTime, bs.endTime) <= ? AND bs.status IN ('paid','credited')";
    let mut sql = sql.to_string();
    if query.roomId.is_some() {
        sql.push_str(" AND bs.roomId = ?");
    }
    if query.shiftName.is_some() {
        sql.push_str(" AND (bs.shiftName = ? OR bs.shiftName IS NULL OR bs.shiftName = '')");
    }
    if query.unreported.unwrap_or(false) {
        sql.push_str(" AND (bs.shiftReportId IS NULL OR bs.shiftReportId = '')");
    }
    sql.push_str(" ORDER BY COALESCE(bs.paymentTime, bs.endTime, bs.startTime) DESC");
    let mut query_builder = sqlx::query_as::<_, FinanceRecord>(&sql)
        .bind(start)
        .bind(end);
    if let Some(roomId) = query.roomId {
        query_builder = query_builder.bind(roomId);
    }
    if let Some(shiftName) = query.shiftName {
        query_builder = query_builder.bind(shiftName);
    }
    let records = query_builder.fetch_all(&state.db).await?;

    let mut room_income = 0.0;
    let mut beverage_income = 0.0;
    for record in &records {
        let original = record.roomAmount + record.beverageAmount;
        let received = (record.prepayAmount
            + if record.paidAmount > 0.0 {
                record.paidAmount
            } else {
                record.payableAmount
            })
        .min(original);
        let ratio = if original > 0.0 {
            (received / original).clamp(0.0, 1.0)
        } else {
            0.0
        };
        if query.income_type.as_deref() != Some("beverage") {
            room_income += record.roomAmount * ratio;
        }
        if query.income_type.as_deref() != Some("room") {
            beverage_income += record.beverageAmount * ratio;
        }
    }
    Ok(Json(ApiResponse::success(FinanceReport {
        records,
        room_income,
        beverage_income,
        total_income: room_income + beverage_income,
    })))
}

pub async fn finance_session_details(
    State(state): State<AppState>,
    Path(sessionId): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let session = get_session_by_id(&state, &sessionId).await?;
    let cashier_name: Option<String> = if let Some(employee_id) = &session.operatorEmployeeId {
        sqlx::query_scalar("SELECT name FROM employees WHERE id = ?")
            .bind(employee_id)
            .fetch_optional(&state.db)
            .await?
    } else {
        None
    };
    let roomName: Option<String> = sqlx::query_scalar("SELECT name FROM rooms WHERE id = ?")
        .bind(&session.roomId)
        .fetch_optional(&state.db)
        .await?;
    let endTime = session
        .endTime
        .as_deref()
        .or(session.paymentTime.as_deref())
        .unwrap_or(&session.updatedAt)
        .to_string();
    let details = sqlx::query_as::<_, FinanceOrderDetail>(
        "SELECT co.id AS orderId, co.createdAt AS order_time, coi.productName, coi.quantity, '份' AS unit, coi.price, coi.amount, \
         CASE WHEN coi.amount = 0 THEN '赠送' ELSE '-' END AS remark, \
         CASE WHEN coi.amount = 0 THEN '系统' ELSE COALESCE(e.name, e.employeeNo, '-') END AS operatorName \
         FROM cashier_orders co JOIN cashier_order_items coi ON coi.orderId = co.id \
         LEFT JOIN billing_sessions bs ON bs.roomId = co.roomId AND co.createdAt >= bs.startTime AND co.createdAt <= COALESCE(bs.endTime, bs.paymentTime, bs.updatedAt) \
         LEFT JOIN employees e ON e.id = bs.operatorEmployeeId \
         WHERE co.roomId = ? AND co.createdAt >= ? AND co.createdAt <= ? AND co.status IN ('pending','confirmed','completed','delivered') \
         ORDER BY co.createdAt ASC, coi.createdAt ASC"
    )
    .bind(&session.roomId)
    .bind(&session.startTime)
    .bind(endTime)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(json!({
        "session": session,
        "roomName": roomName,
        "cashier_name": cashier_name,
        "items": details
    }))))
}

pub async fn create_shift_report(
    State(state): State<AppState>,
    Json(req): Json<ShiftReportRequest>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    let records = sqlx::query_as::<_, FinanceRecord>(
        "SELECT bs.id AS sessionId, bs.voucherNo, bs.roomId, bs.startTime, bs.endTime, bs.paymentTime AS checkoutTime, \
         r.name AS roomName, bs.roomAmount, bs.beverageAmount, bs.payableAmount, bs.prepayAmount, bs.paidAmount, bs.paymentMethod, bs.status, bs.shiftName, \
         e.name AS cashier_name, NULL AS waiter_name, NULL AS sales_manager_name, \
         (SELECT COUNT(*) FROM cashier_orders co WHERE co.roomId = bs.roomId AND co.createdAt >= bs.startTime AND co.createdAt <= COALESCE(bs.endTime, bs.paymentTime, bs.updatedAt)) AS orderCount \
         FROM billing_sessions bs LEFT JOIN employees e ON e.id = bs.operatorEmployeeId LEFT JOIN rooms r ON r.id = bs.roomId \
         WHERE COALESCE(bs.paymentTime, bs.endTime) >= ? AND COALESCE(bs.paymentTime, bs.endTime) <= ? AND bs.status IN ('paid','credited') AND (? IS NULL OR bs.shiftName = ?) AND (bs.shiftReportId IS NULL OR bs.shiftReportId = '') ORDER BY COALESCE(bs.paymentTime, bs.endTime, bs.startTime) DESC"
    )
    .bind(&req.startTime)
    .bind(&req.endTime)
    .bind(&req.shiftName)
    .bind(&req.shiftName)
    .fetch_all(&state.db)
    .await?;
    let room_income: f64 = records
        .iter()
        .map(|r| {
            let original = r.roomAmount + r.beverageAmount;
            let received = (r.prepayAmount
                + if r.paidAmount > 0.0 {
                    r.paidAmount
                } else {
                    r.payableAmount
                })
            .min(original);
            let ratio = if original > 0.0 {
                (received / original).clamp(0.0, 1.0)
            } else {
                0.0
            };
            r.roomAmount * ratio
        })
        .sum();
    let beverage_income: f64 = records
        .iter()
        .map(|r| {
            let original = r.roomAmount + r.beverageAmount;
            let received = (r.prepayAmount
                + if r.paidAmount > 0.0 {
                    r.paidAmount
                } else {
                    r.payableAmount
                })
            .min(original);
            let ratio = if original > 0.0 {
                (received / original).clamp(0.0, 1.0)
            } else {
                0.0
            };
            r.beverageAmount * ratio
        })
        .sum();
    let total_income = room_income + beverage_income;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO shift_records (id, shift_date, startTime, endTime, employee_id, shiftName, room_income, beverage_income, total_income) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(&req.shift_date)
        .bind(&req.startTime)
        .bind(&req.endTime)
        .bind(&req.employee_id)
        .bind(&req.shiftName)
        .bind(room_income)
        .bind(beverage_income)
        .bind(total_income)
        .execute(&state.db)
        .await?;
    let session_ids: Vec<String> = records
        .iter()
        .map(|record| record.sessionId.clone())
        .collect();
    for sessionId in &session_ids {
        sqlx::query("UPDATE billing_sessions SET shiftReportId = ? WHERE id = ?")
            .bind(&id)
            .bind(sessionId)
            .execute(&state.db)
            .await?;
    }
    Ok(Json(ApiResponse::success(
        json!({"id": id, "room_income": room_income, "beverage_income": beverage_income, "total_income": total_income, "records": records}),
    )))
}

pub async fn create_printer(
    State(state): State<AppState>,
    Json(req): Json<PrinterConfigRequest>,
) -> AppResult<Json<ApiResponse<PrinterConfig>>> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO printer_configs (id, name, printerType, address) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(&req.name)
        .bind(&req.printerType)
        .bind(&req.address)
        .execute(&state.db)
        .await?;
    let item = sqlx::query_as::<_, PrinterConfig>("SELECT id, name, printerType, address, enabled, createdAt FROM printer_configs WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.db)
        .await?;
    Ok(Json(ApiResponse::success(item)))
}

pub async fn list_printers(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<PrinterConfig>>>> {
    let items = sqlx::query_as::<_, PrinterConfig>("SELECT id, name, printerType, address, enabled, createdAt FROM printer_configs ORDER BY createdAt DESC")
        .fetch_all(&state.db)
        .await?;
    Ok(Json(ApiResponse::success(items)))
}

pub async fn update_printer(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<PrinterConfigRequest>,
) -> AppResult<Json<ApiResponse<PrinterConfig>>> {
    sqlx::query("UPDATE printer_configs SET name = ?, printerType = ?, address = ?, enabled = ? WHERE id = ?")
        .bind(&req.name)
        .bind(&req.printerType)
        .bind(&req.address)
        .bind(req.enabled.unwrap_or(1))
        .bind(&id)
        .execute(&state.db)
        .await?;
    let item = sqlx::query_as::<_, PrinterConfig>("SELECT id, name, printerType, address, enabled, createdAt FROM printer_configs WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.db)
        .await?;
    Ok(Json(ApiResponse::success(item)))
}

pub async fn delete_printer(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    sqlx::query("DELETE FROM printer_configs WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    Ok(Json(ApiResponse::success(json!({"deleted": true}))))
}

pub async fn print_order(
    Path(orderId): Path<String>,
) -> AppResult<Json<ApiResponse<serde_json::Value>>> {
    Ok(Json(ApiResponse::success(
        json!({"orderId": orderId, "printed": false, "message": "打印任务已记录，需配置本地打印适配器后发送到设备"}),
    )))
}

#[cfg(test)]
mod employee_tests {
    use super::*;

    async fn database() -> sqlx::SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/018_billing_permissions_finance.sql"))
            .execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/039_employee_roles_modules.sql"))
            .execute(&pool).await.unwrap();
        pool
    }

    fn request(number: &str) -> CreateEmployeeRequest {
        CreateEmployeeRequest { employeeNo: number.into(), name: "测试".into(),
            password: "test-only-password".into(), roleId: "cashier".into(),
            modulePermissions: vec!["cashier".into()] }
    }

    #[tokio::test]
    async fn employee_edit_replaces_modules_preserves_number_and_optional_password() {
        let pool = database().await;
        let employee = insert_employee(&pool, &request(""), "old-hash").await.unwrap();
        sqlx::query("UPDATE employees SET extraPermissions='[\"cashier\",\"discount\"]' WHERE id=?")
            .bind(&employee.id).execute(&pool).await.unwrap();
        let mut edit = UpdateEmployeeRequest { name: "新姓名".into(), roleId: "marketer".into(),
            password: None, modulePermissions: vec!["member".into()] };
        let updated = update_employee_record(&pool, &employee.id, &edit, true).await.unwrap();
        assert_eq!(updated.employeeNo, employee.employeeNo);
        assert_eq!(updated.name, "新姓名");
        assert_eq!(updated.roleId, "marketer");
        assert_eq!(permissions_from_json(&updated.extraPermissions), ["discount", "member"]);
        let before: String = sqlx::query_scalar("SELECT passwordHash FROM employees WHERE id=?")
            .bind(&employee.id).fetch_one(&pool).await.unwrap();
        assert_eq!(before, "old-hash");
        edit.password = Some("Ab12Cd34".into());
        edit.modulePermissions.clear();
        let updated = update_employee_record(&pool, &employee.id, &edit, true).await.unwrap();
        assert_eq!(permissions_from_json(&updated.extraPermissions), ["discount"]);
        let after: String = sqlx::query_scalar("SELECT passwordHash FROM employees WHERE id=?")
            .bind(&employee.id).fetch_one(&pool).await.unwrap();
        assert!(verify("Ab12Cd34", &after).unwrap());
        delete_employee_record(&pool, &employee.id).await.unwrap();
        assert!(matches!(delete_employee_record(&pool, &employee.id).await, Err(AppError::NotFound(_))));
    }

    #[tokio::test]
    async fn employee_admin_is_protected_and_invalid_passwords_are_rejected() {
        let pool = database().await;
        for password in ["", "123", "123456789", "abcdefghi", "12 3", "ab_1", "１２３４", "中文密码"] {
            assert!(validate_employee_password(password).is_err(), "{password}");
        }
        for password in ["0001", "12345678", "abcd", "AbCdEfGh", "12ab", "Ab12Cd34"] {
            assert!(validate_employee_password(password).is_ok(), "{password}");
        }
        let admin_id: String = sqlx::query_scalar("SELECT id FROM employees WHERE roleId='admin' LIMIT 1")
            .fetch_one(&pool).await.unwrap();
        assert!(matches!(delete_employee_record(&pool, &admin_id).await, Err(AppError::Forbidden(_))));
        let edit = UpdateEmployeeRequest { name: "管理员".into(), roleId: "cashier".into(), password: None, modulePermissions: vec![] };
        assert!(matches!(update_employee_record(&pool, &admin_id, &edit, true).await, Err(AppError::Forbidden(_))));
        let mut edit = edit; edit.roleId = "admin".into();
        assert!(matches!(update_employee_record(&pool, &admin_id, &edit, false).await, Err(AppError::Forbidden(_))));
        assert!(validate_employee_fields(&pool, "test", "cashier", &["admin".into()]).await.is_err());
        edit.password = Some("123".into());
        assert!(matches!(update_employee_record(&pool, &admin_id, &edit, true).await, Err(AppError::BadRequest(_))));
    }

    #[tokio::test]
    async fn employee_management_authorization_uses_current_database_permissions() {
        let pool = database().await;
        let employee = insert_employee(&pool, &request(""), "unused").await.unwrap();
        let claims = Claims { sub: employee.id.clone(), clientKey: employee.employeeNo, permissions: vec!["system".into()], exp: 0, iat: 0 };
        assert!(authorize_employee_management(&pool, &claims).await.is_err());
        let edit = UpdateEmployeeRequest { name: "测试".into(), roleId: "cashier".into(), password: Some("".into()), modulePermissions: vec!["system".into()] };
        update_employee_record(&pool, &employee.id, &edit, true).await.unwrap();
        assert!(!authorize_employee_management(&pool, &claims).await.unwrap());
        delete_employee_record(&pool, &employee.id).await.unwrap();
        assert!(authorize_employee_management(&pool, &claims).await.is_err());
    }

    #[tokio::test]
    async fn roles_are_added_without_changing_existing_accounts() {
        let pool = database().await;
        sqlx::raw_sql(include_str!("../../migrations/039_employee_roles_modules.sql"))
            .execute(&pool).await.unwrap();
        for (id, name) in [("admin", "管理员"), ("cashier", "收银员"), ("marketer", "营销"),
            ("warehouse", "库管"), ("finance", "财务"), ("consultant", "咨客"), ("production", "出品")] {
            let stored: String = sqlx::query_scalar("SELECT name FROM employee_roles WHERE id=?")
                .bind(id).fetch_one(&pool).await.unwrap();
            assert_eq!(stored, name);
        }
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM employees WHERE employeeNo='1000' AND roleId='admin'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(count, 1);
        let legacy: String = sqlx::query_scalar("SELECT name FROM employee_roles WHERE id='waiter'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(legacy, "服务员");
    }

    #[tokio::test]
    async fn numbers_start_at_1001_and_ignore_non_numeric_accounts() {
        let pool = database().await;
        sqlx::query("DELETE FROM employees").execute(&pool).await.unwrap();
        let first = insert_employee(&pool, &request(""), "unused").await.unwrap();
        assert_eq!(first.employeeNo, "1001");
        for number in ["admin", "99999staff", "cashier90000", "002500"] {
            insert_employee(&pool, &request(number), "unused").await.unwrap();
        }
        sqlx::query("UPDATE employees SET enabled=0 WHERE employeeNo='002500'")
            .execute(&pool).await.unwrap();
        let preview: String = sqlx::query_scalar(NEXT_EMPLOYEE_NUMBER_SQL).fetch_one(&pool).await.unwrap();
        assert_eq!(preview, "2501");
        let request_a = request("");
        let request_b = request("");
        let (a, b) = tokio::join!(insert_employee(&pool, &request_a, "unused"), insert_employee(&pool, &request_b, "unused"));
        let mut allocated = vec![a.unwrap().employeeNo, b.unwrap().employeeNo];
        allocated.sort();
        assert_eq!(allocated, ["2501", "2502"]);
        assert!(matches!(insert_employee(&pool, &request("2501"), "unused").await, Err(AppError::BadRequest(_))));
    }
}
