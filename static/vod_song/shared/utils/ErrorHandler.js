/**
 * 统一错误处理工具（shared）
 */
import { logError } from './Logger.js';

export function handleError(context, error, defaultMessage = '操作失败') {
  logError(context, defaultMessage, error);
  throw error;
}

export function handleApiError(context, error) {
  const message = error.message || 'API调用失败';
  logError(context, message, error);
  throw error;
}
