use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    pub name: String,
    pub price: f64,
    pub categoryId: String,
    pub imageUrl: Option<String>,
    pub description: Option<String>,
    pub stock: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProductCategory {
    pub id: String,
    pub name: String,
    pub sortOrder: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub id: String,
    pub roomId: String,
    pub items: Vec<OrderItem>,
    pub totalAmount: f64,
    pub status: String, // "pending", "confirmed", "completed"
    pub createdAt: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrderItem {
    pub productId: String,
    pub productName: String,
    pub quantity: i32,
    pub price: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderRequest {
    pub roomId: String,
    #[serde(default)]
    pub items: Vec<CreateOrderItemRequest>,
    #[serde(default)]
    pub packages: Vec<CreateOrderPackageRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderItemRequest {
    pub productId: String,
    pub quantity: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderPackageRequest {
    pub packageName: String,
    pub packagePrice: f64,
    #[serde(default)]
    pub items: Vec<CreateOrderItemRequest>,
}
