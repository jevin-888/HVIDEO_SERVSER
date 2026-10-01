/**
 * 与后台 ApiResponse 一致：src/models/common.rs
 * { code: i32, message: String, data?: T }，成功仅当 code === 0
 */

export function isApiOk(response) {
  return (
    response != null &&
    typeof response === 'object' &&
    typeof response.code === 'number' &&
    response.code === 0
  );
}

export function getApiErrorMessage(response, fallback = '请求失败') {
  if (response == null || typeof response !== 'object') return fallback;
  if (typeof response.message === 'string' && response.message.trim()) {
    return response.message.trim();
  }
  return fallback;
}
