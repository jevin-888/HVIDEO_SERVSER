/**
 * KTV 使用 shared 统一工具函数（re-export）
 */
export {
  idleCallback as requestIdleCallback,
  cancelIdleCallback,
  observeElementVisibility
} from '../../shared/utils/PerformanceUtils.js';
export { 
  createDebounced,
  debounce,
  throttle,
  rafThrottle,
  ResourcePool,
  BatchDOMOptimizer,
  performBatchDOMOperation
} from '../../shared/utils/PerformanceUtils.js';
export { default as DomUtils } from '../../shared/utils/DomUtils.js';
export { logInfo, logWarn, logError } from '../../shared/utils/Logger.js';

export {
  normalizeSongsList,
  normalizeSingersList,
  normalizePlayList,
  normalizeSongsList as normalizeTopSongs,
  ensureArray,
  isNonEmptyArray,
  isEmptyArray
} from '../../shared/utils/NormalizeUtils.js';
export { default as RequestUtils } from '../../shared/utils/RequestUtils.js';
export { default as TimerManager } from '../../shared/utils/TimerManager.js';
export { handleError, handleApiError } from '../../shared/utils/ErrorHandler.js';
