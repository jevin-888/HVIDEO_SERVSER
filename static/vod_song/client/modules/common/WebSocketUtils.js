/**
 * WebSocket 工具类
 * 提取 DisplayUI 和 SmartlUI 的公共 WebSocket 方法
 */

/**
 * 清理 WebSocket 监听器
 * @param {Object} context - UI 实例上下文
 * @param {string} className - 类名（用于日志）
 */
export function cleanupWebSocketListeners(context, className = 'UI') {
  if (context._syncStateUnbind) {
    context._syncStateUnbind();
    context._syncStateUnbind = null;
  }
  if (context._connectedUnbind) {
    context._connectedUnbind();
    context._connectedUnbind = null;
  }
  context._wsSyncInitialized = false;
}

/**
 * 检查 WebSocket 客户端是否可用
 * @returns {boolean} 是否可用
 */
function isWebSocketClientAvailable() {
  return !!(window.WebSocketClient && typeof window.WebSocketClient.on === 'function');
}

/**
 * 获取 WebSocket 客户端
 * @returns {Object|null} WebSocket 客户端实例
 */
function getWebSocketClient() {
  return window.WebSocketClient || null;
}

