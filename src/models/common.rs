use serde::{Deserialize, Serialize};

/// 分页请求参数
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct Pagination {
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

#[allow(dead_code)]
impl Pagination {
    pub fn offset(&self) -> u32 {
        let page = self.page.unwrap_or(1).max(1);
        let size = self.page_size();
        (page - 1) * size
    }

    pub fn page_size(&self) -> u32 {
        self.page_size.unwrap_or(20).min(100)
    }
}

/// 分页响应
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagedResponse<T: Serialize> {
    pub items: Vec<T>,
    pub total: u64,
    pub page: u32,
    pub page_size: u32,
}

/// 通用 API 响应
#[derive(Debug, Serialize)]
pub struct ApiResponse<T: Serialize> {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            code: 0,
            message: "success".to_string(),
            data: Some(data),
        }
    }

    #[allow(dead_code)]
    pub fn error(code: i32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }
}

/// 排序方向
#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum SortOrder {
    Asc,
    Desc,
}
