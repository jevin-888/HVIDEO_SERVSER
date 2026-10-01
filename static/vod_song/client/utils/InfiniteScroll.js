/**
 * KTV 使用 shared 统一 InfiniteScroll（re-export）
 */
export {
  attachInfiniteScroll,
  showLoadingIndicator,
  hideLoadingIndicator,
  showNoMoreDataIndicator,
  hideNoMoreDataIndicator
} from '../../shared/utils/InfiniteScroll.js';

// initInfiniteScroll 别名，实际使用 attachInfiniteScroll
export { attachInfiniteScroll as initInfiniteScroll } from '../../shared/utils/InfiniteScroll.js';
