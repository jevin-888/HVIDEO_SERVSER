/**
 * 请求工具
 */
class RequestUtils {
  /**
   * 构造请求URL
   * @param {string} baseURL - 基础URL
   * @param {string} endpoint - 端点
   * @param {Object} params - 查询参数
   * @returns {string} 完整URL
   */
  static buildURL(baseURL, endpoint, params = {}) {
    let url = baseURL + endpoint;
    
    if (Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
    
    return url;
  }

  /**
   * 解析响应数据
   * @param {Response} response - HTTP响应
   * @returns {Promise} 解析后的数据Promise
   */
  static async parseResponse(response) {
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    } else {
      return await response.text();
    }
  }

  /**
   * 检查响应状态
   * @param {Response} response - HTTP响应
   * @returns {Response} 响应对象
   * @throws {Error} 状态错误
   */
  static checkStatus(response) {
    if (response.ok) {
      return response;
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  /**
   * 添加请求头
   * @param {Object} headers - 原始请求头
   * @param {Object} additionalHeaders - 要添加的请求头
   * @returns {Object} 合并后的请求头
   */
  static mergeHeaders(headers = {}, additionalHeaders = {}) {
    return { ...headers, ...additionalHeaders };
  }

  /**
   * 重试请求
   * @param {Function} requestFn - 请求函数
   * @param {number} maxRetries - 最大重试次数
   * @param {number} delay - 重试延迟（毫秒）
   * @returns {Promise} 请求结果Promise
   */
  static async retryRequest(requestFn, maxRetries = 3, delay = 1000) {
    let lastError;
    
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;
        
        // 提取错误信息
        const errorInfo = {
          attempt: i + 1,
          maxAttempts: maxRetries + 1,
          status: error.status || error.response?.status || 'unknown',
          message: error.message || 'Unknown error',
          url: error.url || error.config?.url || 'unknown'
        };
        
        // 判断是否应该重试
        const shouldRetry = this._shouldRetry(error);
        
        if (!shouldRetry) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[RequestUtils] 请求失败，错误不可重试', errorInfo);
          }
          throw error;
        }
        
        if (i < maxRetries) {
          if (typeof console !== 'undefined' && console.debug) {
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          if (typeof console !== 'undefined' && console.error) {
            console.error('[RequestUtils] 请求失败，已达最大重试次数', errorInfo);
          }
        }
      }
    }
    
    throw lastError;
  }

  /**
   * 判断错误是否应该重试
   * @param {Error} error - 错误对象
   * @returns {boolean} 是否应该重试
   */
  static _shouldRetry(error) {
    const status = error.status || error.response?.status;
    
    // 不应该重试的状态码（客户端错误）
    const nonRetryableStatuses = [
      400, // Bad Request - 请求参数错误
      401, // Unauthorized - 未授权
      403, // Forbidden - 禁止访问
      404, // Not Found - 资源不存在
      405, // Method Not Allowed - 方法不允许
      422  // Unprocessable Entity - 无法处理的实体
    ];
    
    if (nonRetryableStatuses.includes(status)) {
      return false;
    }
    
    // 应该重试的状态码（服务器错误或临时问题）
    const retryableStatuses = [
      408, // Request Timeout - 请求超时
      429, // Too Many Requests - 请求过多
      500, // Internal Server Error - 服务器内部错误
      502, // Bad Gateway - 网关错误
      503, // Service Unavailable - 服务不可用
      504  // Gateway Timeout - 网关超时
    ];
    
    if (retryableStatuses.includes(status)) {
      return true;
    }
    
    // 网络错误（没有状态码）应该重试
    if (!status) {
      const message = error.message?.toLowerCase() || '';
      if (message.includes('fetch') || 
          message.includes('network') || 
          message.includes('timeout') ||
          message.includes('连接')) {
        return true;
      }
    }
    
    // 默认不重试未知错误
    return false;
  }
}

export default RequestUtils;