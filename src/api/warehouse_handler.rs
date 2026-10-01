use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::errors::{AppError, AppResult};
use crate::models::common::ApiResponse;
use crate::services::auth_service::Claims;
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct InventoryProduct {
    pub id: String,
    pub productCode: Option<String>,
    pub name: String,
    pub categoryId: String,
    pub categoryName: String,
    pub price: f64,
    pub imageUrl: Option<String>,
    pub stock: i32,
    pub enabled: i32,
    pub inboundTime: Option<String>,
    pub expiryDate: Option<String>,
    pub updatedAt: String,
    pub location_stocks: Option<Vec<WarehouseLocationStock>>,
}

#[derive(Debug, sqlx::FromRow)]
struct InventoryProductRow {
    pub id: String,
    pub productCode: Option<String>,
    pub name: String,
    pub categoryId: String,
    pub categoryName: String,
    pub price: f64,
    pub imageUrl: Option<String>,
    pub stock: i32,
    pub enabled: i32,
    pub inboundTime: Option<String>,
    pub expiryDate: Option<String>,
    pub updatedAt: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WarehouseLocation {
    pub id: String,
    pub name: String,
    pub isDefault: i32,
    pub sortOrder: i32,
}

#[derive(Debug, Serialize)]
pub struct WarehouseLocationStock {
    pub locationId: String,
    pub locationName: String,
    pub stock: i32,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct InventoryTransaction {
    pub id: String,
    pub productId: String,
    pub productName: String,
    pub transactionType: String,
    pub quantity: i32,
    pub beforeStock: i32,
    pub afterStock: i32,
    pub referenceNo: Option<String>,
    pub targetLocationId: Option<String>,
    pub targetLocationName: Option<String>,
    pub inboundTime: Option<String>,
    pub expiryDate: Option<String>,
    pub operatorId: Option<String>,
    pub operatorName: Option<String>,
    pub remark: Option<String>,
    pub createdAt: String,
}

#[derive(Debug, Deserialize)]
pub struct InventoryQuery {
    pub keyword: Option<String>,
    pub categoryId: Option<String>,
    pub low_stock: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct TransactionQuery {
    pub productId: Option<String>,
    pub transactionType: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct StockChangeRequest {
    pub quantity: i32,
    pub productCode: Option<String>,
    pub referenceNo: Option<String>,
    pub targetLocationId: Option<String>,
    pub inboundTime: Option<String>,
    pub expiryDate: Option<String>,
    pub outbound_time: Option<String>,
    pub operatorId: Option<String>,
    pub remark: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SaveCategoryRequest {
    pub name: String,
    pub sortOrder: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct SaveLocationRequest {
    pub name: String,
    pub sortOrder: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CreateWarehouseProductRequest {
    pub productCode: Option<String>,
    pub name: String,
    pub categoryId: String,
    pub price: f64,
    pub imageUrl: Option<String>,
    pub initial_stock: Option<i32>,
    pub operatorId: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StockAdjustRequest {
    pub stock: i32,
    pub referenceNo: Option<String>,
    pub operatorId: Option<String>,
    pub remark: Option<String>,
}

pub async fn list_inventory(
    State(state): State<AppState>,
    Query(query): Query<InventoryQuery>,
) -> AppResult<Json<ApiResponse<Vec<InventoryProduct>>>> {
    let keyword = format!("%{}%", query.keyword.unwrap_or_default());
    let categoryId = query.categoryId.unwrap_or_default();
    let low_stock = query.low_stock.unwrap_or(-1);
    let product_rows = sqlx::query_as::<_, InventoryProductRow>(
        "SELECT p.id, p.productCode, p.name, p.categoryId, c.name AS categoryName, p.price, p.imageUrl, p.stock, p.enabled, p.inboundTime, p.expiryDate, p.updatedAt \
         FROM products p LEFT JOIN product_categories c ON c.id = p.categoryId \
         WHERE (? = '%%' OR p.name LIKE ?) \
           AND (? = '' OR p.categoryId = ?) \
           AND (? < 0 OR p.stock <= ?) \
         ORDER BY p.categoryId ASC, p.name ASC"
    )
    .bind(&keyword)
    .bind(&keyword)
    .bind(&categoryId)
    .bind(&categoryId)
    .bind(low_stock)
    .bind(low_stock)
    .fetch_all(&state.db)
    .await?;
    let mut products: Vec<InventoryProduct> = product_rows
        .into_iter()
        .map(|row| InventoryProduct {
            id: row.id,
            productCode: row.productCode,
            name: row.name,
            categoryId: row.categoryId,
            categoryName: row.categoryName,
            price: row.price,
            imageUrl: row.imageUrl,
            stock: row.stock,
            enabled: row.enabled,
            inboundTime: row.inboundTime,
            expiryDate: row.expiryDate,
            updatedAt: row.updatedAt,
            location_stocks: Some(Vec::new()),
        })
        .collect();
    let stocks = sqlx::query_as::<_, (String, String, String, i32)>(
        "SELECT s.productId, s.locationId, l.name, s.stock \
         FROM warehouse_location_stocks s LEFT JOIN warehouse_locations l ON l.id = s.locationId",
    )
    .fetch_all(&state.db)
    .await?;
    let mut stock_map: HashMap<String, Vec<WarehouseLocationStock>> = HashMap::new();
    for (productId, locationId, locationName, stock) in stocks {
        stock_map
            .entry(productId)
            .or_default()
            .push(WarehouseLocationStock {
                locationId,
                locationName,
                stock,
            });
    }
    for product in &mut products {
        product.location_stocks = Some(stock_map.remove(&product.id).unwrap_or_default());
    }
    Ok(Json(ApiResponse::success(products)))
}

pub async fn stock_in(
    State(state): State<AppState>,
    Path(productId): Path<String>,
    Json(req): Json<StockChangeRequest>,
) -> AppResult<Json<ApiResponse<InventoryTransaction>>> {
    change_stock(
        state,
        productId,
        "in",
        req.quantity,
        req.referenceNo,
        req.targetLocationId,
        req.inboundTime,
        req.expiryDate,
        req.operatorId,
        req.remark,
    )
    .await
}

pub async fn stock_out(
    State(state): State<AppState>,
    Path(productId): Path<String>,
    Json(req): Json<StockChangeRequest>,
) -> AppResult<Json<ApiResponse<InventoryTransaction>>> {
    change_stock(
        state,
        productId,
        "out",
        -req.quantity,
        req.referenceNo,
        req.targetLocationId,
        req.outbound_time,
        req.expiryDate,
        req.operatorId,
        req.remark,
    )
    .await
}

pub async fn list_warehouse_categories(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<crate::models::product::ProductCategory>>>> {
    let rows = sqlx::query_as::<_, crate::models::product::ProductCategory>(
        "SELECT id, name, sortOrder FROM product_categories ORDER BY sortOrder ASC, name ASC",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(rows)))
}

pub async fn create_warehouse_category(
    State(state): State<AppState>,
    Json(req): Json<SaveCategoryRequest>,
) -> AppResult<Json<ApiResponse<crate::models::product::ProductCategory>>> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("类别名称不能为空".to_string()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO product_categories (id, name, sortOrder) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(name)
        .bind(req.sortOrder.unwrap_or(0))
        .execute(&state.db)
        .await?;
    let row = sqlx::query_as::<_, crate::models::product::ProductCategory>(
        "SELECT id, name, sortOrder FROM product_categories WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(row)))
}

pub async fn delete_warehouse_category(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<String>>> {
    let used_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE categoryId = ?")
        .bind(&id)
        .fetch_one(&state.db)
        .await?;
    if used_count > 0 {
        return Err(AppError::BadRequest(
            "该类别已有商品使用，不能删除".to_string(),
        ));
    }
    let result = sqlx::query("DELETE FROM product_categories WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("类别不存在".to_string()));
    }
    Ok(Json(ApiResponse::success("删除成功".to_string())))
}

pub async fn list_warehouse_locations(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<WarehouseLocation>>>> {
    let rows = sqlx::query_as::<_, WarehouseLocation>("SELECT id, name, isDefault, sortOrder FROM warehouse_locations ORDER BY isDefault DESC, sortOrder ASC, name ASC")
        .fetch_all(&state.db)
        .await?;
    Ok(Json(ApiResponse::success(rows)))
}

pub async fn create_warehouse_location(
    State(state): State<AppState>,
    Json(req): Json<SaveLocationRequest>,
) -> AppResult<Json<ApiResponse<WarehouseLocation>>> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("库房名称不能为空".to_string()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO warehouse_locations (id, name, isDefault, sortOrder) VALUES (?, ?, 0, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(req.sortOrder.unwrap_or(0))
    .execute(&state.db)
    .await?;
    let row = sqlx::query_as::<_, WarehouseLocation>(
        "SELECT id, name, isDefault, sortOrder FROM warehouse_locations WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(row)))
}

pub async fn delete_warehouse_location(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<String>>> {
    let row = sqlx::query_as::<_, WarehouseLocation>(
        "SELECT id, name, isDefault, sortOrder FROM warehouse_locations WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("库房不存在".to_string()))?;
    if row.isDefault != 0 {
        return Err(AppError::BadRequest("默认库房不能删除".to_string()));
    }
    let stock_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM warehouse_location_stocks WHERE locationId = ? AND stock > 0",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;
    if stock_count > 0 {
        return Err(AppError::BadRequest("该库房仍有库存，不能删除".to_string()));
    }
    sqlx::query("DELETE FROM warehouse_location_stocks WHERE locationId = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    sqlx::query("DELETE FROM warehouse_locations WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    Ok(Json(ApiResponse::success("删除成功".to_string())))
}

pub async fn create_warehouse_product(
    State(state): State<AppState>,
    Json(req): Json<CreateWarehouseProductRequest>,
) -> AppResult<Json<ApiResponse<InventoryProduct>>> {
    let name = req.name.trim();
    let categoryId = req.categoryId.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("商品名称不能为空".to_string()));
    }
    if categoryId.is_empty() {
        return Err(AppError::BadRequest("请选择商品类别".to_string()));
    }
    if req.price < 0.0 {
        return Err(AppError::BadRequest("商品价格不能小于 0".to_string()));
    }
    let initial_stock = req.initial_stock.unwrap_or(0);
    if initial_stock < 0 {
        return Err(AppError::BadRequest("期初数量不能小于 0".to_string()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let productCode = req.productCode.unwrap_or_else(|| id.clone());
    let imageUrl = req
        .imageUrl
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    sqlx::query(
        "INSERT INTO products (id, productCode, name, price, categoryId, imageUrl, stock, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
    )
    .bind(&id)
    .bind(productCode.trim())
    .bind(name)
    .bind(req.price)
    .bind(categoryId)
    .bind(imageUrl)
    .bind(initial_stock)
    .execute(&state.db)
    .await?;
    if initial_stock > 0 {
        sqlx::query(
            "INSERT INTO inventory_transactions (id, productId, transactionType, quantity, beforeStock, afterStock, referenceNo, operatorId, remark) \
             VALUES (?, ?, 'initial', ?, 0, ?, ?, ?, '新增商品期初数量')"
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&id)
        .bind(initial_stock)
        .bind(initial_stock)
        .bind(productCode.trim())
        .bind(&req.operatorId)
        .execute(&state.db)
        .await?;
    }
    let row = sqlx::query_as::<_, InventoryProductRow>(
        "SELECT p.id, p.productCode, p.name, p.categoryId, c.name AS categoryName, p.price, p.imageUrl, p.stock, p.enabled, p.inboundTime, p.expiryDate, p.updatedAt \
         FROM products p LEFT JOIN product_categories c ON c.id = p.categoryId WHERE p.id = ?"
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(InventoryProduct {
        id: row.id,
        productCode: row.productCode,
        name: row.name,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        price: row.price,
        imageUrl: row.imageUrl,
        stock: row.stock,
        enabled: row.enabled,
        inboundTime: row.inboundTime,
        expiryDate: row.expiryDate,
        updatedAt: row.updatedAt,
        location_stocks: Some(Vec::new()),
    })))
}

pub async fn delete_warehouse_product(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> AppResult<Json<ApiResponse<String>>> {
    let roleId: Option<String> =
        sqlx::query_scalar("SELECT roleId FROM employees WHERE id = ? AND enabled = 1")
            .bind(&claims.sub)
            .fetch_optional(&state.db)
            .await?;
    if roleId.as_deref() != Some("admin") {
        return Err(AppError::Forbidden(
            "只有管理员可以删除库存商品".to_string(),
        ));
    }
    let stock: Option<i32> = sqlx::query_scalar("SELECT stock FROM products WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db)
        .await?;
    let stock = stock.ok_or_else(|| AppError::NotFound("商品不存在".to_string()))?;
    if stock != 0 {
        return Err(AppError::BadRequest(
            "商品仍有总库库存，不能删除".to_string(),
        ));
    }
    let location_stock: Option<i32> = sqlx::query_scalar(
        "SELECT COALESCE(SUM(stock), 0) FROM warehouse_location_stocks WHERE productId = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;
    if location_stock.unwrap_or(0) != 0 {
        return Err(AppError::BadRequest(
            "商品仍有二级库房库存，不能删除".to_string(),
        ));
    }
    let transaction_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM inventory_transactions WHERE productId = ?")
            .bind(&id)
            .fetch_one(&state.db)
            .await?;
    if transaction_count > 0 {
        return Err(AppError::BadRequest(
            "商品已有库存流水，不能删除".to_string(),
        ));
    }
    let result = sqlx::query("DELETE FROM products WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("商品不存在".to_string()));
    }
    Ok(Json(ApiResponse::success("删除成功".to_string())))
}

pub async fn adjust_stock(
    State(state): State<AppState>,
    Path(productId): Path<String>,
    Json(req): Json<StockAdjustRequest>,
) -> AppResult<Json<ApiResponse<InventoryTransaction>>> {
    if req.stock < 0 {
        return Err(AppError::BadRequest("库存不能小于 0".to_string()));
    }
    let mut tx = state.db.begin().await?;
    let beforeStock: i32 = sqlx::query_scalar("SELECT stock FROM products WHERE id = ?")
        .bind(&productId)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("商品不存在".to_string()))?;
    let quantity = req.stock - beforeStock;
    sqlx::query(
        "UPDATE products SET stock = ?, updatedAt = datetime('now','localtime') WHERE id = ?",
    )
    .bind(req.stock)
    .bind(&productId)
    .execute(&mut *tx)
    .await?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO inventory_transactions (id, productId, transactionType, quantity, beforeStock, afterStock, referenceNo, operatorId, remark) \
         VALUES (?, ?, 'adjust', ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&productId)
    .bind(quantity)
    .bind(beforeStock)
    .bind(req.stock)
    .bind(&req.referenceNo)
    .bind(&req.operatorId)
    .bind(&req.remark)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let row = get_transaction(&state, &id).await?;
    state.ws.broadcast(serde_json::json!({"type":"inventory_changed","productId":productId,"stock":row.afterStock}));
    Ok(Json(ApiResponse::success(row)))
}

pub async fn list_transactions(
    State(state): State<AppState>,
    Query(query): Query<TransactionQuery>,
) -> AppResult<Json<ApiResponse<Vec<InventoryTransaction>>>> {
    let productId = query.productId.unwrap_or_default();
    let transactionType = query.transactionType.unwrap_or_default();
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let rows = sqlx::query_as::<_, InventoryTransaction>(
        "SELECT t.id, t.productId, p.name AS productName, t.transactionType, t.quantity, t.beforeStock, t.afterStock, \
                t.referenceNo, t.targetLocationId, wl.name AS targetLocationName, t.inboundTime, t.expiryDate, t.operatorId, e.name AS operatorName, t.remark, t.createdAt \
         FROM inventory_transactions t \
         LEFT JOIN products p ON p.id = t.productId \
         LEFT JOIN warehouse_locations wl ON wl.id = t.targetLocationId \
         LEFT JOIN employees e ON e.id = t.operatorId \
         WHERE (? = '' OR t.productId = ?) AND (? = '' OR t.transactionType = ?) \
         ORDER BY t.createdAt DESC LIMIT ?"
    )
    .bind(&productId)
    .bind(&productId)
    .bind(&transactionType)
    .bind(&transactionType)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(rows)))
}

async fn change_stock(
    state: AppState,
    productId: String,
    transactionType: &str,
    quantity_delta: i32,
    referenceNo: Option<String>,
    targetLocationId: Option<String>,
    inboundTime: Option<String>,
    expiryDate: Option<String>,
    operatorId: Option<String>,
    remark: Option<String>,
) -> AppResult<Json<ApiResponse<InventoryTransaction>>> {
    if quantity_delta == 0 {
        return Err(AppError::BadRequest("数量不能为 0".to_string()));
    }
    let mut tx = state.db.begin().await?;
    let beforeStock: i32 = sqlx::query_scalar("SELECT stock FROM products WHERE id = ?")
        .bind(&productId)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("商品不存在".to_string()))?;
    let afterStock = beforeStock + quantity_delta;
    if afterStock < 0 {
        return Err(AppError::BadRequest("库存不足".to_string()));
    }
    sqlx::query("UPDATE products SET stock = ?, inboundTime = COALESCE(?, inboundTime), expiryDate = COALESCE(?, expiryDate), updatedAt = datetime('now','localtime') WHERE id = ?")
        .bind(afterStock)
        .bind(if transactionType == "in" { inboundTime.as_deref() } else { None })
        .bind(if transactionType == "in" { expiryDate.as_deref() } else { None })
        .bind(&productId)
        .execute(&mut *tx)
        .await?;
    if transactionType == "out" {
        if let Some(locationId) = targetLocationId
            .as_deref()
            .filter(|value| !value.is_empty() && *value != "main")
        {
            sqlx::query(
                "INSERT INTO warehouse_location_stocks (locationId, productId, stock) VALUES (?, ?, ?) \
                 ON CONFLICT(locationId, productId) DO UPDATE SET stock = stock + excluded.stock, updatedAt = datetime('now','localtime')"
            )
            .bind(locationId)
            .bind(&productId)
            .bind(quantity_delta.abs())
            .execute(&mut *tx)
            .await?;
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO inventory_transactions (id, productId, transactionType, quantity, beforeStock, afterStock, referenceNo, targetLocationId, inboundTime, expiryDate, operatorId, remark) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&productId)
    .bind(transactionType)
    .bind(quantity_delta.abs())
    .bind(beforeStock)
    .bind(afterStock)
    .bind(&referenceNo)
    .bind(&targetLocationId)
    .bind(&inboundTime)
    .bind(&expiryDate)
    .bind(&operatorId)
    .bind(&remark)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let row = get_transaction(&state, &id).await?;
    state.ws.broadcast(serde_json::json!({"type":"inventory_changed","productId":productId,"stock":row.afterStock}));
    Ok(Json(ApiResponse::success(row)))
}

async fn get_transaction(state: &AppState, id: &str) -> AppResult<InventoryTransaction> {
    let row = sqlx::query_as::<_, InventoryTransaction>(
        "SELECT t.id, t.productId, p.name AS productName, t.transactionType, t.quantity, t.beforeStock, t.afterStock, \
                t.referenceNo, t.targetLocationId, wl.name AS targetLocationName, t.inboundTime, t.expiryDate, t.operatorId, e.name AS operatorName, t.remark, t.createdAt \
         FROM inventory_transactions t \
         LEFT JOIN products p ON p.id = t.productId \
         LEFT JOIN warehouse_locations wl ON wl.id = t.targetLocationId \
         LEFT JOIN employees e ON e.id = t.operatorId \
         WHERE t.id = ?"
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    Ok(row)
}
