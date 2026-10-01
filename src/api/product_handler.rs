use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;

use crate::errors::{AppError, AppResult};
use crate::models::common::ApiResponse;
use crate::models::product::{CreateOrderRequest, Order, OrderItem, Product, ProductCategory};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct ProductQuery {
    #[serde(rename = "categoryId")]
    pub categoryId: Option<String>,
}

/// GET /api/v1/products - 获取商品列表
pub async fn list_products(
    State(state): State<AppState>,
    Query(query): Query<ProductQuery>,
) -> AppResult<Json<ApiResponse<Vec<Product>>>> {
    let categoryId = query.categoryId.as_deref().map(str::trim).unwrap_or("");
    let products = if categoryId.is_empty() || categoryId == "all" {
        sqlx::query_as::<_, Product>(
            "SELECT id, name, price, categoryId, imageUrl, description, stock \
             FROM products WHERE enabled = 1 ORDER BY categoryId ASC, createdAt ASC",
        )
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, Product>(
            "SELECT id, name, price, categoryId, imageUrl, description, stock \
             FROM products WHERE enabled = 1 AND categoryId = ? ORDER BY categoryId ASC, createdAt ASC"
        )
        .bind(categoryId)
        .fetch_all(&state.db)
        .await?
    };
    Ok(Json(ApiResponse::success(products)))
}

/// GET /api/v1/products/categories - 获取商品分类
pub async fn list_categories(
    State(state): State<AppState>,
) -> AppResult<Json<ApiResponse<Vec<ProductCategory>>>> {
    let categories = sqlx::query_as::<_, ProductCategory>(
        "SELECT id, name, sortOrder FROM product_categories ORDER BY sortOrder ASC",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ApiResponse::success(categories)))
}

/// POST /api/v1/orders - 创建订单
pub async fn create_order(
    State(state): State<AppState>,
    Json(req): Json<CreateOrderRequest>,
) -> AppResult<Json<ApiResponse<Order>>> {
    let CreateOrderRequest {
        roomId,
        items,
        packages,
    } = req;

    let room = resolve_order_room_id(&state.db, roomId).await?;

    if items.is_empty() && packages.is_empty() {
        return Err(AppError::BadRequest("订单不能为空".to_string()));
    }

    if items.iter().any(|item| item.quantity <= 0)
        || packages
            .iter()
            .any(|package| package.items.iter().any(|item| item.quantity <= 0))
    {
        return Err(AppError::BadRequest("商品数量必须大于 0".to_string()));
    }

    let mut tx = state.db.begin().await?;
    let mut order_items = Vec::new();
    let mut totalAmount = 0.0;

    for req_item in items {
        let product = sqlx::query_as::<_, Product>(
            "SELECT id, name, price, categoryId, imageUrl, description, stock \
             FROM products WHERE id = ? AND enabled = 1",
        )
        .bind(&req_item.productId)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            AppError::BadRequest(format!("商品不存在或已下架: {}", req_item.productId))
        })?;

        if product.stock < req_item.quantity {
            return Err(AppError::BadRequest(format!("{} 库存不足", product.name)));
        }

        let amount = product.price * req_item.quantity as f64;
        totalAmount += amount;
        order_items.push(OrderItem {
            productId: product.id,
            productName: product.name,
            quantity: req_item.quantity,
            price: product.price,
        });
    }

    for package in &packages {
        if package.packageName.trim().is_empty() {
            return Err(AppError::BadRequest("套餐名称不能为空".to_string()));
        }
        if package.packagePrice < 0.0 {
            return Err(AppError::BadRequest("套餐价格不能小于 0".to_string()));
        }
        if package.items.is_empty() {
            return Err(AppError::BadRequest(format!(
                "套餐 {} 未配置配送商品",
                package.packageName
            )));
        }
        totalAmount += package.packagePrice;
        for (index, req_item) in package.items.iter().enumerate() {
            let product = sqlx::query_as::<_, Product>(
                "SELECT id, name, price, categoryId, imageUrl, description, stock \
                 FROM products WHERE id = ? AND enabled = 1",
            )
            .bind(&req_item.productId)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| {
                AppError::BadRequest(format!("商品不存在或已下架: {}", req_item.productId))
            })?;

            if product.stock < req_item.quantity {
                return Err(AppError::BadRequest(format!("{} 库存不足", product.name)));
            }

            order_items.push(OrderItem {
                productId: product.id,
                productName: if index == 0 {
                    package.packageName.clone()
                } else {
                    product.name
                },
                quantity: req_item.quantity,
                price: if index == 0 {
                    package.packagePrice
                } else {
                    0.0
                },
            });
        }
    }

    let order = Order {
        id: uuid::Uuid::new_v4().to_string(),
        roomId: room,
        items: order_items,
        totalAmount,
        status: "pending".to_string(),
        createdAt: chrono::Local::now().to_rfc3339(),
    };

    sqlx::query(
        "INSERT INTO cashier_orders (id, roomId, totalAmount, status, createdAt, updatedAt) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&order.id)
    .bind(&order.roomId)
    .bind(order.totalAmount)
    .bind(&order.status)
    .bind(&order.createdAt)
    .bind(&order.createdAt)
    .execute(&mut *tx)
    .await?;

    for item in &order.items {
        sqlx::query(
            "INSERT INTO cashier_order_items \
             (id, orderId, productId, productName, quantity, price, amount) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&order.id)
        .bind(&item.productId)
        .bind(&item.productName)
        .bind(item.quantity)
        .bind(item.price)
        .bind(item.price * item.quantity as f64)
        .execute(&mut *tx)
        .await?;

        if !item.productId.starts_with("package:") {
            sqlx::query("UPDATE products SET stock = stock - ?, updatedAt = datetime('now','localtime') WHERE id = ?")
                .bind(item.quantity)
                .bind(&item.productId)
                .execute(&mut *tx)
                .await?;
        }
    }

    tx.commit().await?;

    state.ws.broadcast(serde_json::json!({
        "type": "cashierOrderCreated",
        "orderId": order.id,
        "roomId": order.roomId,
        "totalAmount": order.totalAmount,
        "status": order.status
    }));

    Ok(Json(ApiResponse::success(order)))
}

async fn resolve_order_room_id(pool: &sqlx::SqlitePool, roomId: String) -> AppResult<String> {
    let trimmed = roomId.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("请先选择房间".to_string()));
    }
    if let Some(resolved_id) =
        sqlx::query_scalar::<_, String>("SELECT id FROM rooms WHERE id = ? LIMIT 1")
            .bind(trimmed)
            .fetch_optional(pool)
            .await?
    {
        return Ok(resolved_id);
    }
    Err(AppError::BadRequest(format!("房间不存在: {}", trimmed)))
}
