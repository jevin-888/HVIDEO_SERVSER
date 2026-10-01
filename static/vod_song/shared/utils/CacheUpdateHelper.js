/**
 * 缓存更新辅助工具
 * 统一处理后台缓存更新逻辑，避免重复代码
 */

import { isNonEmptyArray } from './NormalizeUtils.js';

/**
 * 后台更新缓存（不阻塞主流程）
 * @param {Object} config - 配置对象
 * @param {Function} config.fetchData - 获取数据的异步函数，返回 Promise
 * @param {Function} config.parseResponse - 解析响应的函数，将响应转换为数组
 * @param {Object} config.cacheService - 缓存服务实例
 * @param {string} config.cacheType - 缓存类型（'songs', 'search', 'singers' 等）
 * @param {Object} config.cacheParams - 缓存参数对象
 * @param {Function} config.logInfo - 日志信息函数
 * @param {Function} config.logError - 日志错误函数
 * @param {number} config.delay - 延迟时间（毫秒），默认100
 */
export function updateCacheInBackground({
  fetchData,
  parseResponse,
  cacheService,
  cacheType,
  cacheParams,
  logInfo,
  logError,
  delay = 100
}) {
  try {
    setTimeout(async () => {
      try {
        const response = await fetchData();
        const list = parseResponse ? parseResponse(response) : response;
        
        if (isNonEmptyArray(list)) {
          const finalCacheParams = cacheParams.type 
            ? cacheParams 
            : { type: cacheType, ...cacheParams };
          
          cacheService.setCachedData(cacheType, finalCacheParams, list);
          
          if (logInfo) {
          }
        }
      } catch (error) {
        if (logError) {
          logError(`后台${cacheType}缓存更新失败:`, error);
        }
      }
    }, delay);
  } catch (error) {
    if (logError) {
      logError(`后台${cacheType}缓存更新启动失败:`, error);
    }
  }
}

