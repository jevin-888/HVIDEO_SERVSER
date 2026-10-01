use axum::{
    extract::{Json, Path, Query, State},
    // response::IntoResponse,
};
use bcrypt::verify;
use serde::Deserialize;
use serde_json::{/*json,*/ Value};

use crate::errors::{AppError, AppResult};
use crate::models::common::ApiResponse;
use crate::services::auth_service::AuthService;
use crate::AppState;

// ==================== 服务类型（可配置）====================

#[derive(Debug, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ServiceType {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub sortOrder: i32,
    pub enabled: i32,
    pub createdAt: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateServiceTypeReq {
    pub id: Option<String>,
    pub name: String,
    pub icon: Option<String>,
    pub sortOrder: Option<i32>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateServiceTypeReq {
    pub name: Option<String>,
    pub icon: Option<String>,
    pub sortOrder: Option<i32>,
    pub enabled: Option<i32>,
}

/// GET /api/v1/service-types  公开，供客户端拉取启用的服务类型
pub async fn list_service_types_public(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<ServiceType>>>> {
    let items = sqlx::query_as::<_, ServiceType>(
        "SELECT id, name, icon, sortOrder, enabled, createdAt \
         FROM service_types WHERE enabled = 1 ORDER BY sortOrder ASC",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(items)))
}

/// GET /api/v1/admin/service-types  管理端列出所有（含禁用）
pub async fn list_service_types(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<ServiceType>>>> {
    let items = sqlx::query_as::<_, ServiceType>(
        "SELECT id, name, icon, sortOrder, enabled, createdAt \
         FROM service_types ORDER BY sortOrder ASC",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(items)))
}

/// POST /api/v1/admin/service-types
pub async fn create_service_type(
    State(state): State<AppState>,
    Json(req): Json<CreateServiceTypeReq>,
) -> AppResult<Json<ApiResponse<ServiceType>>> {
    let id = req.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let icon = req.icon.unwrap_or_else(|| "fa-concierge-bell".to_string());
    let sortOrder = req.sortOrder.unwrap_or(99);
    sqlx::query("INSERT INTO service_types (id, name, icon, sortOrder) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(&req.name)
        .bind(&icon)
        .bind(sortOrder)
        .execute(&state.db)
        .await?;
    let item = sqlx::query_as::<_, ServiceType>(
        "SELECT id, name, icon, sortOrder, enabled, createdAt FROM service_types WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(item)))
}

/// PUT /api/v1/admin/service-types/:id
pub async fn update_service_type(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateServiceTypeReq>,
) -> AppResult<Json<ApiResponse<ServiceType>>> {
    if let Some(name) = &req.name {
        sqlx::query("UPDATE service_types SET name = ? WHERE id = ?")
            .bind(name)
            .bind(&id)
            .execute(&state.db)
            .await?;
    }
    if let Some(icon) = &req.icon {
        sqlx::query("UPDATE service_types SET icon = ? WHERE id = ?")
            .bind(icon)
            .bind(&id)
            .execute(&state.db)
            .await?;
    }
    if let Some(sortOrder) = req.sortOrder {
        sqlx::query("UPDATE service_types SET sortOrder = ? WHERE id = ?")
            .bind(sortOrder)
            .bind(&id)
            .execute(&state.db)
            .await?;
    }
    if let Some(enabled) = req.enabled {
        sqlx::query("UPDATE service_types SET enabled = ? WHERE id = ?")
            .bind(enabled)
            .bind(&id)
            .execute(&state.db)
            .await?;
    }
    let item = sqlx::query_as::<_, ServiceType>(
        "SELECT id, name, icon, sortOrder, enabled, createdAt FROM service_types WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(item)))
}

/// DELETE /api/v1/admin/service-types/:id
pub async fn delete_service_type(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<()>>> {
    sqlx::query("DELETE FROM service_types WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    Ok(Json(ApiResponse::success(())))
}

// ==========================================
// 1. Products & Cashier (收银/商品)
// ==========================================

#[derive(Debug, serde::Serialize)]
pub struct MockCategory {
    pub id: i32,
    pub name: String,
    #[serde(rename = "type")]
    pub category_type: String,
}

#[derive(Debug, serde::Serialize)]
pub struct MockCombo {
    pub id: i32,
    pub name: String,
    pub price: f64,
    pub image: String,
}

#[derive(Debug, serde::Serialize)]
pub struct MockComboItem {
    pub name: String,
    pub quantity: i32,
    pub unit: String,
}

#[derive(Debug, serde::Serialize)]
pub struct MockTaste {
    pub id: i32,
    pub name: String,
}

/// GET /api/v1/products/categories/free - 获取免费/赠送分类
pub async fn list_free_categories() -> AppResult<Json<ApiResponse<Vec<MockCategory>>>> {
    let categories = vec![
        MockCategory {
            id: 901,
            name: "赠送酒水".to_string(),
            category_type: "free".to_string(),
        },
        MockCategory {
            id: 902,
            name: "员工福利".to_string(),
            category_type: "staff".to_string(),
        },
    ];
    Ok(Json(ApiResponse::success(categories)))
}

/// GET /api/v1/products/combos - 获取套餐列表
pub async fn list_combos() -> AppResult<Json<ApiResponse<Vec<MockCombo>>>> {
    let combos = vec![
        MockCombo {
            id: 1001,
            name: "豪华洋酒套餐".to_string(),
            price: 1288.0,
            image: "".to_string(),
        },
        MockCombo {
            id: 1002,
            name: "啤酒畅饮套餐".to_string(),
            price: 588.0,
            image: "".to_string(),
        },
    ];
    Ok(Json(ApiResponse::success(combos)))
}

/// GET /api/v1/products/combos/:id/items - 获取套餐明细
pub async fn get_combo_items(
    Path(_id): Path<String>,
) -> AppResult<Json<ApiResponse<Vec<MockComboItem>>>> {
    let items = vec![
        MockComboItem {
            name: "芝华士12年".to_string(),
            quantity: 2,
            unit: "瓶".to_string(),
        },
        MockComboItem {
            name: "绿茶".to_string(),
            quantity: 8,
            unit: "瓶".to_string(),
        },
        MockComboItem {
            name: "果盘".to_string(),
            quantity: 1,
            unit: "份".to_string(),
        },
    ];
    Ok(Json(ApiResponse::success(items)))
}

/// GET /api/v1/products/tastes - 获取口味/做法列表
pub async fn list_tastes() -> AppResult<Json<ApiResponse<Vec<MockTaste>>>> {
    let tastes = vec![
        MockTaste {
            id: 1,
            name: "加冰".to_string(),
        },
        MockTaste {
            id: 2,
            name: "加热".to_string(),
        },
        MockTaste {
            id: 3,
            name: "少糖".to_string(),
        },
        MockTaste {
            id: 4,
            name: "切片".to_string(),
        },
    ];
    Ok(Json(ApiResponse::success(tastes)))
}

// ==========================================
// 2. Orders & Bill (订单/账单)
// ==========================================

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockBill {
    pub totalAmount: f64,
    pub discountAmount: f64,
    pub payAmount: f64,
    pub status: String,
    pub itemsCount: i32,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillQuery {
    pub roomId: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockOrderDetail {
    pub orderId: String,
    pub createdAt: String,
    pub items: Vec<MockOrderItem>,
}

#[derive(Debug, serde::Serialize)]
pub struct MockOrderItem {
    pub name: String,
    pub price: f64,
    pub quantity: i32,
}

#[derive(Debug, sqlx::FromRow)]
struct BillSummaryRow {
    totalAmount: Option<f64>,
    itemsCount: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct OrderRow {
    orderId: String,
    createdAt: String,
}

#[derive(Debug, sqlx::FromRow)]
struct OrderItemRow {
    name: String,
    price: f64,
    quantity: i32,
}

#[derive(Debug, serde::Serialize)]
pub struct MockQRCode {
    pub url: String,
    pub image: String,
}

/// GET /api/v1/orders/bill - 获取账单概要
pub async fn get_bill(
    State(state): State<AppState>,
    Query(query): Query<BillQuery>,
) -> AppResult<Json<ApiResponse<MockBill>>> {
    let room = query.roomId;
    let row = if let Some(roomId) = room {
        sqlx::query_as::<_, BillSummaryRow>(
            "SELECT CAST(COALESCE(SUM(totalAmount), 0) AS REAL) AS totalAmount, COUNT(*) AS itemsCount \
             FROM cashier_orders WHERE roomId = ? AND status != 'cancelled'",
        )
        .bind(roomId)
        .fetch_one(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, BillSummaryRow>(
            "SELECT CAST(COALESCE(SUM(totalAmount), 0) AS REAL) AS totalAmount, COUNT(*) AS itemsCount \
             FROM cashier_orders WHERE status != 'cancelled'",
        )
        .fetch_one(&state.db)
        .await?
    };

    let totalAmount = row.totalAmount.unwrap_or(0.0);
    let bill = MockBill {
        totalAmount,
        discountAmount: 0.0,
        payAmount: totalAmount,
        status: "unpaid".to_string(),
        itemsCount: row.itemsCount as i32,
    };
    Ok(Json(ApiResponse::success(bill)))
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomOrderedItem {
    pub productId: String,
    pub productName: String,
    pub quantity: i32,
    pub price: f64,
    pub amount: f64,
    pub lastOrderedAt: String,
}

#[derive(Debug, sqlx::FromRow)]
struct RoomOrderedItemRow {
    productId: String,
    productName: String,
    quantity: i64,
    price: f64,
    amount: f64,
    lastOrderedAt: String,
}

/// GET /api/v1/orders/items - 房间已点商品列表（按商品聚合，未结算订单）
pub async fn list_room_ordered_items(
    State(state): State<AppState>,
    Query(query): Query<BillQuery>,
) -> AppResult<Json<ApiResponse<Vec<RoomOrderedItem>>>> {
    let room = query.roomId;
    let Some(roomId) = room else {
        return Ok(Json(ApiResponse::success(Vec::new())));
    };
    let rows = sqlx::query_as::<_, RoomOrderedItemRow>(
        "SELECT coi.productId AS productId, \
                coi.productName AS productName, \
                CAST(COALESCE(SUM(coi.quantity), 0) AS INTEGER) AS quantity, \
                CAST(COALESCE(MAX(coi.price), 0) AS REAL) AS price, \
                CAST(COALESCE(SUM(coi.amount), 0) AS REAL) AS amount, \
                COALESCE(MAX(co.createdAt), '') AS lastOrderedAt \
         FROM cashier_order_items coi \
         JOIN cashier_orders co ON co.id = coi.orderId \
         WHERE co.roomId = ? AND co.status IN ('pending','confirmed','completed','delivered') \
         GROUP BY coi.productId, coi.productName \
         ORDER BY lastOrderedAt DESC, coi.productName",
    )
    .bind(&roomId)
    .fetch_all(&state.db)
    .await?;

    let items = rows
        .into_iter()
        .map(|r| RoomOrderedItem {
            productId: r.productId,
            productName: r.productName,
            quantity: r.quantity as i32,
            price: r.price,
            amount: r.amount,
            lastOrderedAt: r.lastOrderedAt,
        })
        .collect();
    Ok(Json(ApiResponse::success(items)))
}

/// GET /api/v1/orders/:id/detail - 获取订单明细
pub async fn get_order_detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<MockOrderDetail>>> {
    let order = sqlx::query_as::<_, OrderRow>(
        "SELECT id AS orderId, createdAt FROM cashier_orders WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;

    let items = sqlx::query_as::<_, OrderItemRow>(
        "SELECT productName AS name, price, quantity FROM cashier_order_items WHERE orderId = ?",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|item| MockOrderItem {
        name: item.name,
        price: item.price,
        quantity: item.quantity,
    })
    .collect();

    let detail = MockOrderDetail {
        orderId: order.orderId,
        createdAt: order.createdAt,
        items,
    };
    Ok(Json(ApiResponse::success(detail)))
}

/// GET /api/v1/orders/qrcode - 获取手机点单二维码
pub async fn get_qrcode() -> AppResult<Json<ApiResponse<MockQRCode>>> {
    let qrcode = MockQRCode {
        url: "https://example.com/order?room=888".to_string(),
        image: "data:image/png;base64,...".to_string(),
    };
    Ok(Json(ApiResponse::success(qrcode)))
}

// ==========================================
// 3. Auth (服务员)
// ==========================================

#[derive(Debug, serde::Serialize)]
pub struct WaiterAuthResponse {
    pub token: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct WaiterLoginRequest {
    pub employeeNo: String,
    pub password: String,
}

#[derive(Debug, sqlx::FromRow)]
struct WaiterAuthRow {
    id: String,
    employeeNo: String,
    name: String,
    passwordHash: String,
    enabled: i32,
    extraPermissions: String,
    rolePermissions: String,
}

fn permissions_from_json(value: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value).unwrap_or_default()
}

pub async fn waiter_login(
    State(state): State<AppState>,
    Json(payload): Json<WaiterLoginRequest>,
) -> AppResult<Json<ApiResponse<WaiterAuthResponse>>> {
    let row = sqlx::query_as::<_, WaiterAuthRow>(
        "SELECT e.id, e.employeeNo, e.name, e.passwordHash, e.enabled, e.extraPermissions, \
                r.permissions AS rolePermissions \
         FROM employees e LEFT JOIN employee_roles r ON e.roleId = r.id WHERE e.employeeNo = ?",
    )
    .bind(&payload.employeeNo)
    .fetch_optional(&state.db)
    .await?;

    let Some(row) = row else {
        return Err(AppError::Unauthorized("工号或密码错误".to_string()));
    };
    if row.enabled != 1 || !verify(&payload.password, &row.passwordHash).unwrap_or(false) {
        return Err(AppError::Unauthorized("工号或密码错误".to_string()));
    }

    let mut permissions = permissions_from_json(&row.rolePermissions);
    permissions.extend(permissions_from_json(&row.extraPermissions));
    if !permissions.iter().any(|p| p == "waiter") {
        permissions.push("waiter".to_string());
    }
    let (token, _) =
        AuthService::generate_token(&state.config.jwt, &row.id, &row.employeeNo, permissions)?;
    Ok(Json(ApiResponse::success(WaiterAuthResponse {
        token,
        name: row.name,
    })))
}

// ==========================================
// 4. Marketing (推广)
// ==========================================

#[derive(Debug, serde::Serialize)]
pub struct MockAd {
    pub id: i32,
    pub title: String,
    pub image: String,
}

pub async fn list_ads() -> AppResult<Json<ApiResponse<Vec<MockAd>>>> {
    let ads = vec![
        MockAd {
            id: 1,
            title: "新品推荐".to_string(),
            image: "/ads/1.jpg".to_string(),
        },
        MockAd {
            id: 2,
            title: "会员活动".to_string(),
            image: "/ads/2.jpg".to_string(),
        },
    ];
    Ok(Json(ApiResponse::success(ads)))
}

// ==========================================
// 5. Room Service (房务/服务铃)
// ==========================================

pub async fn call_service(
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> AppResult<Json<ApiResponse<()>>> {
    tracing::info!("Room {} call service: {:?}", id, payload);
    Ok(Json(ApiResponse::success(())))
}

pub async fn response_service(Path(id): Path<String>) -> AppResult<Json<ApiResponse<()>>> {
    tracing::info!("Room {} service response", id);
    Ok(Json(ApiResponse::success(())))
}

pub async fn cancel_service(Path(id): Path<String>) -> AppResult<Json<ApiResponse<()>>> {
    tracing::info!("Room {} cancel service", id);
    Ok(Json(ApiResponse::success(())))
}

pub async fn send_message(
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> AppResult<Json<ApiResponse<()>>> {
    tracing::info!("Send message to room {}: {:?}", id, payload);
    Ok(Json(ApiResponse::success(())))
}

pub async fn control_room(
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> AppResult<Json<ApiResponse<()>>> {
    tracing::info!("Control room {}: {:?}", id, payload);
    Ok(Json(ApiResponse::success(())))
}

// ==========================================
// 6. PR / Hostess (公关)
// ==========================================

#[derive(Debug, serde::Serialize)]
pub struct MockPRStaff {
    pub id: i32,
    pub name: String,
    pub status: String,
    pub image: String,
}

#[derive(Debug, serde::Serialize)]
pub struct MockPRGroupStats {
    pub group_id: i32,
    pub name: String,
    pub count: i32,
    pub available: i32,
}

#[derive(Debug, serde::Serialize)]
pub struct MockPRGroup {
    pub id: i32,
    pub name: String,
}

#[derive(Debug, serde::Serialize)]
pub struct MockPRFlower {
    pub id: i32,
    pub name: String,
    pub price: f64,
}

pub async fn list_pr_staff() -> AppResult<Json<ApiResponse<Vec<MockPRStaff>>>> {
    let staff = vec![
        MockPRStaff {
            id: 101,
            name: "Lisa".to_string(),
            status: "available".to_string(),
            image: "".to_string(),
        },
        MockPRStaff {
            id: 102,
            name: "Anna".to_string(),
            status: "busy".to_string(),
            image: "".to_string(),
        },
    ];
    Ok(Json(ApiResponse::success(staff)))
}

pub async fn get_pr_group_stats() -> AppResult<Json<ApiResponse<Vec<MockPRGroupStats>>>> {
    let stats = vec![
        MockPRGroupStats {
            group_id: 1,
            name: "A组".to_string(),
            count: 10,
            available: 5,
        },
        MockPRGroupStats {
            group_id: 2,
            name: "B组".to_string(),
            count: 8,
            available: 2,
        },
    ];
    Ok(Json(ApiResponse::success(stats)))
}

pub async fn list_pr_groups() -> AppResult<Json<ApiResponse<Vec<MockPRGroup>>>> {
    let groups = vec![
        MockPRGroup {
            id: 1,
            name: "模特组".to_string(),
        },
        MockPRGroup {
            id: 2,
            name: "气氛组".to_string(),
        },
    ];
    Ok(Json(ApiResponse::success(groups)))
}

pub async fn list_pr_records() -> AppResult<Json<ApiResponse<Vec<Value>>>> {
    Ok(Json(ApiResponse::success(vec![])))
}

pub async fn list_pr_flowers() -> AppResult<Json<ApiResponse<Vec<MockPRFlower>>>> {
    let flowers = vec![
        MockPRFlower {
            id: 1,
            name: "玫瑰".to_string(),
            price: 99.0,
        },
        MockPRFlower {
            id: 2,
            name: "皇冠".to_string(),
            price: 520.0,
        },
    ];
    Ok(Json(ApiResponse::success(flowers)))
}

pub async fn pr_service_action(Json(payload): Json<Value>) -> AppResult<Json<ApiResponse<()>>> {
    tracing::info!("PR Action: {:?}", payload);
    Ok(Json(ApiResponse::success(())))
}

pub async fn create_pr_order(Json(payload): Json<Value>) -> AppResult<Json<ApiResponse<()>>> {
    tracing::info!("PR Order: {:?}", payload);
    Ok(Json(ApiResponse::success(())))
}
