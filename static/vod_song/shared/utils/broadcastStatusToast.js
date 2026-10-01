/**
 * 播控状态转展示文案（与后端 broadcast 一致：source/action/layerId/type/val）
 * 8080 命令日志、8089 Toast 共用此解析，不重复写逻辑。
 * @param {Object} d - 后端 broadcast 的 JSON
 * @returns {string|null} 文案，非 ktv 播控返回 null
 */
export function getBroadcastStatusMessage(d) {
  if (!d || d.source !== 'ktv' || !d.action) return null;
  const suffix = d.layerId != null ? ` [${d.layerId}]` : '';
  if (d.action === 'controlVoice') {
    if (d.type === 2) return '静音' + suffix;
    if (d.type === 3) return '取消静音' + suffix;
    if (d.type === 4) return '音量 ' + (d.val != null ? d.val : '') + suffix;
    return '语音控制' + suffix;
  }
  return (d.action || '') + suffix || null;
}

const BROADCAST_TOAST_DEBOUNCE_MS = 800;
let _lastBroadcastMsg = '';
let _lastBroadcastTime = 0;

/**
 * 播控状态弹 Toast（8089 用）；解析复用 getBroadcastStatusMessage。
 * 短时同文案只弹一次，避免 SSE + WebSocket 双通道重复。
 */
export function showBroadcastStatusToast(d, toastService, duration = 1200) {
  if (!toastService || typeof toastService.showToast !== 'function') return null;
  const msg = getBroadcastStatusMessage(d);
  if (!msg) return null;
  const now = Date.now();
  if (msg === _lastBroadcastMsg && now - _lastBroadcastTime < BROADCAST_TOAST_DEBOUNCE_MS) return msg;
  _lastBroadcastMsg = msg;
  _lastBroadcastTime = now;
  toastService.showToast(msg, 'success', duration);
  return msg;
}
