/**
 * shared/utils 统一导出
 */
export { createDebounced, debounce, throttle, rafThrottle, batchDOMOperation, batchUpdateStyles, idleCallback, cancelIdleCallback, observeElementVisibility } from './PerformanceUtils.js';
export { default as DomUtils } from './DomUtils.js';
export { logInfo, logWarn, logError } from './Logger.js';
export { normalizeSongsList, normalizeSingersList, normalizePlayList, isSafeArray, ensureArray, isNonEmptyArray, isEmptyArray } from './NormalizeUtils.js';
export { default as RequestUtils } from './RequestUtils.js';
export { default as TimerManager } from './TimerManager.js';
export { handleError, handleApiError } from './ErrorHandler.js';
