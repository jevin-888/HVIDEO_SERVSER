/**
 * KTV 使用 shared 统一 PerformanceUtils（re-export）
 */
export {
  idleCallback as requestIdleCallback,
  cancelIdleCallback,
  observeElementVisibility,
  BatchDOMOptimizer,
  performBatchDOMOperation,
  ResourcePool
} from '../../shared/utils/PerformanceUtils.js';
