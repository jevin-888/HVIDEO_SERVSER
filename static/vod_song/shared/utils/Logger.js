/**
 * 统一日志工具函数（shared）
 */

function shouldLog(level) {
  if (typeof window === 'undefined' || !window.logService) return true;
  return window.logService.shouldLog(level);
}

export function logInfo(context, message, ...args) {
  if (!shouldLog('info')) return;
  const fullMessage = `[${context}] ${message}`;
  if (typeof window !== 'undefined' && window.logService) {
    window.logService.info(fullMessage, ...args);
  } else {
    console.log(fullMessage, ...args);
  }
}

export function logError(context, message, error) {
  if (!shouldLog('error')) return;
  const fullMessage = `[${context}] ${message}`;
  if (typeof window !== 'undefined' && window.logService) {
    window.logService.error(fullMessage, error);
  } else {
    console.error(fullMessage, error);
  }
}

export function logWarn(context, message, ...args) {
  if (!shouldLog('warn')) return;
  const fullMessage = `[${context}] ${message}`;
  if (typeof window !== 'undefined' && window.logService) {
    window.logService.warn(fullMessage, ...args);
  } else {
    console.warn(fullMessage, ...args);
  }
}

export function logDebug(context, message, ...args) {
  if (!shouldLog('debug')) return;
  const fullMessage = `[${context}] ${message}`;
  if (typeof window !== 'undefined' && window.logService) {
    window.logService.debug(fullMessage, ...args);
  } else {
    console.log(`[DEBUG] ${fullMessage}`, ...args);
  }
}
