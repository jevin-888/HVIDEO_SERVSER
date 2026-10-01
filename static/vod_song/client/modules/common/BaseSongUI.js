/**
 * 歌曲UI基类
 * 提取 partyUI 和 songTopUI 的公共方法
 */
import sharedModalManager from './SharedModalManager.js';
import { showNoMoreDataIndicator } from '../../utils/InfiniteScroll.js';
import { ScrollPositionManager } from '../songs/ScrollPositionManager.js';

export class BaseSongUI {
  constructor(className = 'BaseSongUI') {
    this.modal = null;
    this.page = 1;
    this.size = 20;
    this.loading = false;
    this.songService = null;
    this.toastService = null;
    this.cacheService = null;
    this.filterParams = {};
    this._className = className; // 用于日志标识
  }

  getPageSize(page = 1) {
    return this.size;
  }

  /**
   * 获取搜索关键词
   * @returns {string} 搜索关键词
   */
  _getSearchKeyword() {
    const searchInput = sharedModalManager.getSearchInput?.();
    if (!searchInput) return '';
    return (searchInput.value || '').trim();
  }

  /**
   * 构建请求过滤参数
   * @param {Object} additional - 额外的参数
   * @returns {Object} 请求参数
   */
  _buildRequestFilterParams(additional = {}) {
    const baseParams = { ...(this.filterParams || {}), ...(additional || {}) };
    // 子类可以覆盖此方法以添加特殊逻辑（如 songTopUI 的模式检查）
    const keyword = this._getSearchKeyword();
    if (keyword) {
      baseParams.keyword = keyword;
    } else if (baseParams.keyword) {
      delete baseParams.keyword;
    }
    return baseParams;
  }

  /**
   * 初始化服务
   * 防止重复初始化：如果正在初始化，等待完成
   */
  async initServices() {
    // 防止重复初始化：如果正在初始化，等待完成
    if (this._initServicesPromise) {
      return this._initServicesPromise;
    }

    // 创建初始化 Promise 并缓存
    this._initServicesPromise = (async () => {
      if (!this.songService || !this.toastService || !this.cacheService) {
        // 优先从全局获取（同步加载的服务）- 最快的方式
        if (!this.songService && typeof window !== 'undefined' && window.songService) {
          this.songService = window.songService;
        }

        // 如果全局没有，从 index.js 导入（同步加载的服务）
        if (!this.songService) {
          const services = await import('../../index.js');
          this.songService = services.songService;
        }

        // toastService 和 cacheService 是同步加载的，从 index.js 导入
        if (!this.toastService || !this.cacheService || !this.logService) {
          const services = await import('../../index.js');
          this.toastService = services.toastService;
          this.cacheService = services.cacheService;
          this.logService = services.logService;
        }

        // 最后检查
        if (!this.songService) {
          throw new Error('无法加载 songService');
        }
      }
    })();

    return this._initServicesPromise;
  }

  /**
   * 统一日志方法，优先使用logService，降级到console
   * @param {string} level - 日志级别
   * @param {string} message - 日志消息
   * @param {...any} args - 附加参数
   */
  _log(level, message, ...args) {
    if (this.logService && typeof this.logService[level] === 'function') {
      // 使用 bind 绑定 this 上下文，避免方法提取后 this 丢失
      this.logService[level].bind(this.logService)(message, this._className, ...args);
    } else if (typeof console !== 'undefined' && console[level]) {
      console[level](`[${this._className}] ${message}`, ...args);
    }
  }

  /**
   * 显示没有更多数据提示
   * @param {HTMLElement} container - 容器元素
   * @param {string} message - 提示消息
   */
  _showNoMoreData(container, message = '没有更多歌曲了') {
    if (!container) return;
    const targetGrid = container.querySelector('.grid');
    if (!targetGrid) return;
    showNoMoreDataIndicator(container, targetGrid, message);
  }

  /**
   * 清空容器内容（性能优化：使用 removeChild 而不是 innerHTML）
   * @param {HTMLElement} container - 容器元素
   */
  _clearContainer(container) {
    if (!container) return;
    // 性能优化：使用 removeChild 而不是 innerHTML
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  /**
   * 清空网格容器内容
   * @param {HTMLElement} grid - 网格元素
   */
  _clearGrid(grid) {
    if (!grid) return;
    // 性能优化：使用 removeChild 而不是 innerHTML
    while (grid.firstChild) {
      grid.removeChild(grid.firstChild);
    }
  }

  /**
   * 异步分批清理Grid容器内容，避免阻塞主线程
   * @param {HTMLElement} grid - 要清理的grid容器
   * @param {Function} callback - 清理完成后的回调
   */
  _clearGridAsync(grid, callback) {
    if (!grid) {
      if (callback) callback();
      return;
    }

    const children = Array.from(grid.children);
    const total = children.length;

    if (total === 0) {
      if (callback) callback();
      return;
    }

    // 如果节点数量较少，直接清理
    if (total < 50) {
      this._clearGrid(grid);
      if (callback) callback();
      return;
    }

    // 大量节点时，分批清理
    const batchSize = 30; // 每批清理30个节点
    let index = 0;

    const clearBatch = () => {
      const end = Math.min(index + batchSize, total);
      for (let i = index; i < end; i++) {
        if (children[i] && children[i].parentNode === grid) {
          grid.removeChild(children[i]);
        }
      }
      index = end;

      if (index < total) {
        // 使用 requestIdleCallback 优先，降级到 requestAnimationFrame
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(clearBatch, { timeout: 16 });
        } else {
          requestAnimationFrame(clearBatch);
        }
      } else {
        // 清理完成
        if (callback) callback();
      }
    };

    clearBatch();
  }

  /**
   * 执行模态框清理（性能优化版本）
   * @param {Function} resolve - Promise resolve函数
   * @param {Function} additionalCleanup - 额外的清理逻辑
   * @protected
   */
  _performModalCleanup(resolve, additionalCleanup) {
    // 重置状态
    this._isClosing = false;
    this.loading = false;

    // 执行额外的清理逻辑
    if (typeof additionalCleanup === 'function') {
      try {
        additionalCleanup();
      } catch (error) {
        this._log('warn', '执行额外清理逻辑时出错', error);
      }
    }

    // 开始关闭动画
    if (this.modal) {
      this.modal.classList.remove('song-modal-visible');
      // 只有在modal仍属于本实例时才添加hidden（防止闪烁）
      // 注意：这里只是移除visible类，实际隐藏在setTimeout中进行
    }

    // 延迟执行实际的DOM清理，等待CSS过渡动画完成
    return new Promise((resolve) => {
      setTimeout(() => {
        if (this.modal) {
          // 检查当前模态框是否仍属于本UI实例
          const currentUI = sharedModalManager.getCurrentUI?.();
          const isStillOwner = !currentUI || currentUI === this;

          const debugInfo = {
            currentUI: currentUI ? currentUI.constructor.name : 'null',
            thisUI: this.constructor.name,
            isStillOwner,
            modalClasses: this.modal.className
          };
          // 重置模态框类名和样式（仅清理动画相关类，不影响显隐）
          const content = this.modal.firstElementChild;
          if (content && isStillOwner) {
            content.classList.remove('translate-y-0', 'opacity-100');
            content.classList.add('translate-y-full', 'opacity-0');
            content.style.transform = '';
            content.style.opacity = '';
          }

          // 只有在modal仍属于本实例时才隐藏
          if (isStillOwner) {
            console.log(`[BaseSongUI] Hiding modal (owner matches)`);
            this.modal.classList.add('hidden');
            this.modal.classList.remove('song-modal-visible');
          } else {
            console.log(`[BaseSongUI] Skipping hide (owner changed)`);
          }
        }

        // 重置滚动位置（仅在没有其他模态框使用容器时）
        const currentUI = sharedModalManager.getCurrentUI?.();
        if (!currentUI || currentUI === this) {
          const container = sharedModalManager.getContainer?.();
          if (container) {
            container.scrollTop = 0;
            // 只有当没有UI使用时才隐藏滚动条，避免影响新打开的模态框
            if (!currentUI) {
              container.style.overflowY = 'hidden';
            }
          }
        }

        resolve();
      }, 150); // 等待关闭动画完成
    });
  }
  /**
   * 绑定状态同步事件（统一走 roomStateChanged / playListChanged 触发的 SongSyncManager）
   * 子类可以覆盖此方法以添加特定逻辑
   */
  _bindStateSyncEvents() {
    if (this._songSyncCleanup) {
      this._songSyncCleanup();
      this._songSyncCleanup = null;
    }

    const bindSyncManager = async () => {
      try {
        let songSyncManager = null;

        if (typeof window !== 'undefined' && window.songSyncManager) {
          songSyncManager = window.songSyncManager;
        } else if (typeof window !== 'undefined' && window.moduleLoader) {
          songSyncManager = await window.moduleLoader.load('songSyncManager');
        }

        if (!songSyncManager || typeof songSyncManager.addSyncListener !== 'function') {
          return;
        }

        this._songSyncCleanup = songSyncManager.addSyncListener((data) => {
          requestAnimationFrame(() => {
            if (data?.type === 'playlistUpdate') {
              if (this.updateAllSongCardsUI && typeof this.updateAllSongCardsUI === 'function') {
                this.updateAllSongCardsUI(true);
              }
              return;
            }

            if (this.updateAllSongCardsUI && typeof this.updateAllSongCardsUI === 'function') {
              this.updateAllSongCardsUI(true);
            }
          });
        });
      } catch (error) {
        this._log('warn', '绑定歌曲同步事件失败', error);
      }
    };

    bindSyncManager();
  }

  /**
   * 清理状态同步事件监听器
   */
  _unbindStateSyncEvents() {
    if (this._songSyncCleanup) {
      this._songSyncCleanup();
      this._songSyncCleanup = null;
    }
  }

  /**
   * 恢复滚动位置（公共方法）
   * @param {HTMLElement} container - 容器元素
   * @param {Object} scrollInfo - 滚动信息
   * @param {Object} restoreState - 恢复状态
   * @param {Function} onComplete - 完成回调
   */
  _restoreScrollPosition(container, scrollInfo, restoreState, onComplete) {
    if (!container) return;

    // 恢复滚动位置
    if (scrollInfo) {
      ScrollPositionManager.restoreScrollPosition(container, scrollInfo);
    }

    // 完成恢复
    if (restoreState) {
      ScrollPositionManager.finishRestore(container, restoreState, onComplete);
    } else if (onComplete) {
      onComplete();
    }
  }

  /**
   * 设置加载状态
   * @param {boolean} isLoading - 是否正在加载
   * @param {HTMLElement} container - 容器元素
   */
  _setLoadingState(isLoading, container) {
    if (!container) return;
    this.loading = isLoading;
    container.dataset.loading = String(isLoading);
  }

  /**
   * 设置完成状态
   * @param {boolean} done - 是否已完成
   * @param {HTMLElement} container - 容器元素
   */
  _setDoneState(done, container) {
    if (!container) return;
    container.dataset.done = done ? 'true' : 'false';
  }

  /**
   * 更新模态框高度（统一方法）
   * 高度完全由CSS统一控制，不设置任何内联样式
   * CSS使用响应式单位（vh）和CSS变量自动计算高度
   * 作用：清理可能存在的内联样式，确保CSS样式生效
   * 调用时机：歌曲列表渲染后、加载更多后、窗口大小改变时
   */
  updateModalHeight() {
    if (!this.modal) return;
    const content = this.modal.firstElementChild;
    const songsContainer = sharedModalManager.getContainer();
    if (!content) return;

    // 高度完全由CSS控制，不设置任何内联样式
    // CSS使用响应式单位（vh）和CSS变量（--modal-height）自动计算高度
    // 所有高度相关的修改都应该在CSS文件中进行

    // 清理可能存在的内联样式，确保CSS样式生效
    if (songsContainer) {
      requestAnimationFrame(() => {
        if (!songsContainer) return;
        songsContainer.style.removeProperty('height');
        songsContainer.style.removeProperty('max-height');
        void songsContainer.offsetHeight;
      });
    }
  }
}

