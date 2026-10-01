import { normalizeSingersList } from '../../utils/NormalizeUtils.js';
import { logWarn, logError } from '../../utils/Logger.js';
import { attachInfiniteScroll, showLoadingIndicator, hideLoadingIndicator, showNoMoreDataIndicator, hideNoMoreDataIndicator } from '../../utils/InfiniteScroll.js';
import { ScrollPositionManager } from './ScrollPositionManager.js';
import { bindSearchInput, bindSearchCloseBtn } from '../common/SearchInputHandler.js';
import { searchSongs, clearSearch } from '../common/SearchLogic.js';
import sharedModalManager, { UNIFIED_SEARCH_INPUT_ID, UNIFIED_CONTAINER_ID } from '../common/SharedModalManager.js';
import { updateSongCardUIById as updateSongCardUI } from './SongTopRenderer.js';
import { bindPlayEvent, handleAddBtnClick } from '../common/PlayEventHandler.js';
import {
  hideAllButtons,
  showAllButtons,
  setHardwareAcceleration,
  clearHardwareAcceleration,
  resetModalClasses,
  MODAL_ANIMATION_CLASSES
} from '../common/ModalUtils.js';
import DomUtils from '../../utils/DomUtils.js';
import { BaseSongUI } from '../common/BaseSongUI.js';
import TimerManager from '../../utils/TimerManager.js';
import { SongTopDataLoader } from './SongTopDataLoader.js';
import { SongTopFilters } from './SongTopFilters.js';
import { SongTopCardUpdater } from './SongTopCardUpdater.js';
import { StateManager } from '../common/StateManager.js';

class SongTopUI extends BaseSongUI {
  constructor() {
    super('SongTopUI');

    // 统一状态管理器 - 管理所有UI状态
    this.state = new StateManager({
      // 模式相关
      currentMode: 'top',
      lastMode: 'top',

      // 过滤参数
      filterParams: {},
      selectedSingerName: null,
      selectedLanguageCode: null,
      selectedCategoryCode: null,

      // 歌星列表相关
      isShowingSingersList: false,
      singersPage: 1,
      singersSize: 30,
      singerFilters: { sex: '', region: '', keyword: '' },

      // 搜索相关
      preSearchState: null,

      // 预取相关
      prefetchedSongs: null,
      prefetching: false,
      skipNextPrefetch: false,

      // 会话相关
      sessionId: 0,
      prefetchingSessionId: 0,
      prefetchedSessionId: 0,

      // UI状态相关（按钮背景、卡片背景等）
      buttonBackgroundStates: {
        // 筛选按钮状态：{ buttonId: { selected: boolean, className: string } }
        filterButtons: {},
        // 歌曲卡片背景状态：{ songId: 'current' | 'next' | 'queued' | null }
        songCardBackgrounds: {},
        // 歌曲卡片按钮背景状态：{ songId: 'playing' | 'next' | 'priority' | 'default' | null }
        songCardButtonBackgrounds: {}
      }
    });

    // 移除自动更新UI的监听器，避免重复更新

    // 服务引用（不属于状态，属于依赖）
    this.apiService = null;
    this.singerService = null;
    this.langService = null;

    // UI相关缓存（不属于状态，属于缓存）
    this._autoScrollToSelected = false;
    this._lastWindowWidth = null;
    this._lastWindowHeight = null;
    this._languages = null;
    this._classifies = null;
    this._sexOptions = null;
    this._regionOptions = null;
    this._lastSelector = 'language';

    // 定时器管理
    this._timerManager = new TimerManager();

    // 事件监听器跟踪（简单数组，用于清理）
    this._eventListeners = [];

    // 数据加载模块
    this.dataLoader = new SongTopDataLoader(this);

    // 筛选器模块
    this.filters = new SongTopFilters(this);

    // 卡片更新模块
    this.cardUpdater = new SongTopCardUpdater(this);

    // 保留旧引用以便清理
    this._resizeHandler = null;
    this._keydownHandler = null;
    this._wheelHandler = null;
    this._touchHandlers = null;
    this._scrollHandler = null;
    this._scrollStopHandler = null;
    this._updateCardsTimer = null;

    // 为了向后兼容，添加getter/setter代理
    this._setupStateProxies();
  }

  /**
   * 设置状态代理，保持向后兼容
   * @private
   */
  _setupStateProxies() {
    const stateProps = [
      { prop: 'currentMode', stateKey: 'currentMode' },
      { prop: 'lastMode', stateKey: 'lastMode' },
      { prop: 'filterParams', stateKey: 'filterParams' },
      { prop: 'selectedSingerName', stateKey: 'selectedSingerName' },
      { prop: 'selectedLanguageCode', stateKey: 'selectedLanguageCode' },
      { prop: 'selectedCategoryCode', stateKey: 'selectedCategoryCode' },
      { prop: 'isShowingSingersList', stateKey: 'isShowingSingersList' },
      { prop: 'singersPage', stateKey: 'singersPage' },
      { prop: 'singersSize', stateKey: 'singersSize' },
      { prop: 'singerFilters', stateKey: 'singerFilters' },
      { prop: '_preSearchState', stateKey: 'preSearchState' },
      { prop: '_prefetchedSongs', stateKey: 'prefetchedSongs' },
      { prop: '_prefetching', stateKey: 'prefetching' },
      { prop: '_skipNextPrefetch', stateKey: 'skipNextPrefetch' },
      { prop: '_sessionId', stateKey: 'sessionId' },
      { prop: '_prefetchingSessionId', stateKey: 'prefetchingSessionId' },
      { prop: '_prefetchedSessionId', stateKey: 'prefetchedSessionId' }
    ];

    stateProps.forEach(({ prop, stateKey }) => {
      Object.defineProperty(this, prop, {
        get() {
          return this.state.get(stateKey);
        },
        set(value) {
          this.state.set(stateKey, value);
        },
        enumerable: true,
        configurable: true
      });
    });
  }

  // 简单的添加事件监听器并跟踪
  _addEventListener(element, event, handler, options = false) {
    if (!element || !event || !handler) return;
    element.addEventListener(event, handler, options);
    this._eventListeners.push({ element, event, handler, options });
  }

  // 继承自 BaseSongUI 的方法：
  // - _getSearchKeyword()
  // - initServices()
  // - _log()
  // - _showNoMoreData()

  /**
   * 构建请求过滤参数（覆盖基类方法，添加模式检查）
   * @param {Object} additional - 额外的参数
   * @returns {Object} 请求参数
   */
  _buildRequestFilterParams(additional = {}) {
    const filterParams = this.state.get('filterParams', {});
    const currentMode = this.state.get('currentMode', 'top');
    const baseParams = { ...filterParams, ...(additional || {}) };

    // songTopUI 特殊逻辑：只在 category 和 language 模式下处理搜索关键词
    if (['category', 'language'].includes(currentMode)) {
      const keyword = this._getSearchKeyword();
      if (keyword) {
        baseParams.keyword = keyword;
      } else if (baseParams.keyword) {
        delete baseParams.keyword;
      }
    }
    return baseParams;
  }

  /**
   * 开始新会话
   * @returns {number} 会话ID
   */
  _beginSession() {
    const newSessionId = this.state.get('sessionId', 0) + 1;
    this.state.update({
      sessionId: newSessionId
    });
    this._resetPrefetchState();
    this.loading = false;
    this.page = 1;
    return newSessionId;
  }

  /**
   * 检查会话是否活跃
   * @param {number} sessionId - 会话ID
   * @returns {boolean} 是否活跃
   */
  _isSessionActive(sessionId) {
    return sessionId === this.state.get('sessionId', 0);
  }

  /**
   * 重置预取状态
   */
  _resetPrefetchState() {
    this.state.update({
      prefetchedSongs: null,
      prefetchedSessionId: 0,
      prefetching: false,
      prefetchingSessionId: 0
    });
  }

  /**
   * 重置所有状态到初始值
   */
  resetState() {
    this.state.reset({
      currentMode: 'top',
      lastMode: 'top',
      filterParams: {},
      selectedSingerName: null,
      selectedLanguageCode: null,
      selectedCategoryCode: null,
      isShowingSingersList: false,
      singersPage: 1,
      singersSize: 30,
      singerFilters: { sex: '', region: '', keyword: '' },
      preSearchState: null,
      prefetchedSongs: null,
      prefetching: false,
      skipNextPrefetch: false,
      sessionId: 0,
      prefetchingSessionId: 0,
      prefetchedSessionId: 0
    });
    this.loading = false;
    this.page = 1;
  }

  /**
   * 获取所有选择器按钮（带缓存，避免重复查询）
   * @returns {Object} 包含所有选择器按钮的对象
   */
  _getSelectorButtons() {
    const middleContentEl = sharedModalManager.getMiddleContentElement();
    if (!middleContentEl) return null;

    // 使用缓存避免重复查询
    if (this._selectorButtonsCache && this._selectorButtonsCache.timestamp > Date.now() - 1000) {
      return this._selectorButtonsCache.buttons;
    }

    const buttons = {
      langSelector: middleContentEl.querySelector('#language-selector'),
      clsSelector: middleContentEl.querySelector('#category-selector'),
      singersBtn: middleContentEl.querySelector('#top-singers-more-btn'),
      songnameBtn: middleContentEl.querySelector('#songname-selector'),
      indonesianSongsBtn: middleContentEl.querySelector('#indonesian-songs-btn'),
      middleContentEl
    };

    // 缓存结果（1秒有效期）
    this._selectorButtonsCache = {
      buttons,
      timestamp: Date.now()
    };

    return buttons;
  }

  /**
   * 清除选择器按钮缓存
   */
  _clearSelectorButtonsCache() {
    this._selectorButtonsCache = null;
  }

  /**
   * 检查是否是印尼歌曲模式
   * @returns {boolean} 是否是印尼歌曲模式
   */
  _isIndonesianSongsMode() {
    const currentMode = this.state.get('currentMode', 'top');
    const filterParams = this.state.get('filterParams', {});
    return currentMode === 'language' &&
      filterParams?.languageCode &&
      ['id', '6', '10'].includes(String(filterParams.languageCode));
  }

  /**
   * 更新副语言翻译元素的颜色
   * @param {HTMLElement} btn - 按钮元素
   * @param {boolean} selected - 是否选中状态
   */
  _updateSubLangSpans(btn, selected) {
    if (!btn) return;
    const spans = btn.querySelectorAll('.indonesian-translation, .en-translation, .vi-translation');
    spans.forEach(span => {
      if (selected) {
        span.classList.remove('text-gray-500', 'dark:text-gray-400');
        span.classList.add('text-white', 'text-opacity-90', 'tracking-tighter', 'indonesian-letter-tight');
      } else {
        span.classList.remove('text-white', 'text-opacity-90');
        span.classList.add('text-gray-500', 'dark:text-gray-400', 'tracking-tighter', 'indonesian-letter-tight');
      }
    });
  }

  /**
   * 更新按钮选中状态
   * @param {HTMLElement} button - 按钮元素
   * @param {boolean} selected - 是否选中
   */
  _updateButtonState(button, selected) {
    if (!button) return;

    const SELECTED = ['bg-blue-500', 'text-white'];
    const UNSELECTED = ['text-gray-700', 'dark:text-gray-200', 'bg-white', 'dark:bg-gray-800'];

    // 更新按钮样式
    if (selected) {
      button.classList.remove(...UNSELECTED);
      button.classList.add(...SELECTED);
    } else {
      button.classList.remove(...SELECTED);
      button.classList.add(...UNSELECTED);
    }

    // 更新状态管理器中的按钮背景状态
    const buttonId = button.id;
    if (buttonId) {
      const buttonStates = this.state.get('buttonBackgroundStates', {});
      const filterButtons = buttonStates.filterButtons || {};
      filterButtons[buttonId] = {
        selected,
        className: selected ? 'bg-blue-500' : 'bg-white dark:bg-gray-800'
      };
      this.state.update({
        buttonBackgroundStates: {
          ...buttonStates,
          filterButtons
        }
      });
    }

    // 更新副语言翻译颜色
    this._updateSubLangSpans(button, selected);
  }

  /**
   * 更新歌曲卡片背景状态
   * @param {string} songId - 歌曲ID
   * @param {string|null} backgroundState - 背景状态：'current' | 'next' | 'queued' | null
   */
  updateSongCardBackground(songId, backgroundState) {
    if (!songId) return;

    const buttonStates = this.state.get('buttonBackgroundStates', {});
    const songCardBackgrounds = buttonStates.songCardBackgrounds || {};

    if (backgroundState) {
      songCardBackgrounds[songId] = backgroundState;
    } else {
      delete songCardBackgrounds[songId];
    }

    this.state.update({
      buttonBackgroundStates: {
        ...buttonStates,
        songCardBackgrounds
      }
    });
  }

  /**
   * 更新歌曲卡片按钮背景状态（仅更新状态，不更新DOM，DOM由渲染器负责）
   * @param {string} songId - 歌曲ID
   * @param {string|null} buttonState - 按钮状态：'playing' | 'next' | 'priority' | 'default' | null
   */
  updateSongCardButtonBackground(songId, buttonState) {
    if (!songId) return;

    const buttonStates = this.state.get('buttonBackgroundStates', {});
    const songCardButtonBackgrounds = buttonStates.songCardButtonBackgrounds || {};

    if (buttonState) {
      songCardButtonBackgrounds[songId] = buttonState;
    } else {
      delete songCardButtonBackgrounds[songId];
    }

    this.state.update({
      buttonBackgroundStates: {
        ...buttonStates,
        songCardButtonBackgrounds
      }
    });
  }

  /**
   * 批量更新歌曲卡片背景状态
   * @param {Object} backgrounds - 背景状态对象 {songId: 'current' | 'next' | 'queued' | null}
   */
  updateSongCardBackgrounds(backgrounds) {
    const buttonStates = this.state.get('buttonBackgroundStates', {});
    const songCardBackgrounds = { ...(buttonStates.songCardBackgrounds || {}) };

    Object.entries(backgrounds).forEach(([songId, backgroundState]) => {
      if (backgroundState) {
        songCardBackgrounds[songId] = backgroundState;
      } else {
        delete songCardBackgrounds[songId];
      }
    });

    this.state.update({
      buttonBackgroundStates: {
        ...buttonStates,
        songCardBackgrounds
      }
    });
  }

  /**
   * 获取按钮背景状态
   * @param {string} buttonId - 按钮ID
   * @returns {Object|null} 按钮状态 {selected: boolean, className: string} 或 null
   */
  getButtonBackgroundState(buttonId) {
    if (!buttonId) return null;
    const buttonStates = this.state.get('buttonBackgroundStates', {});
    return buttonStates.filterButtons?.[buttonId] || null;
  }

  /**
   * 获取歌曲卡片背景状态
   * @param {string} songId - 歌曲ID
   * @returns {string|null} 背景状态：'current' | 'next' | 'queued' | null
   */
  getSongCardBackground(songId) {
    if (!songId) return null;
    const buttonStates = this.state.get('buttonBackgroundStates', {});
    return buttonStates.songCardBackgrounds?.[songId] || null;
  }

  /**
   * 获取歌曲卡片按钮背景状态
   * @param {string} songId - 歌曲ID
   * @returns {string|null} 按钮状态：'playing' | 'next' | 'priority' | 'default' | null
   */
  getSongCardButtonBackground(songId) {
    if (!songId) return null;
    const buttonStates = this.state.get('buttonBackgroundStates', {});
    return buttonStates.songCardButtonBackgrounds?.[songId] || null;
  }

  /**
   * 批量更新按钮状态
   * @param {Object} buttonStates - 按钮状态对象 {buttonId: selected}
   */
  _updateButtonsState(buttonStates) {
    const buttons = this._getSelectorButtons();
    if (!buttons) return;

    const buttonMap = {
      langSelector: buttons.langSelector,
      clsSelector: buttons.clsSelector,
      singersBtn: buttons.singersBtn,
      songnameBtn: buttons.songnameBtn,
      indonesianSongsBtn: buttons.indonesianSongsBtn
    };

    Object.entries(buttonStates).forEach(([key, selected]) => {
      const button = buttonMap[key];
      if (button) {
        this._updateButtonState(button, selected);
      }
    });
  }

  /**
   * 重置所有按钮为未选中状态
   */
  _resetAllButtonsState() {
    this._updateButtonsState({
      langSelector: false,
      clsSelector: false,
      singersBtn: false,
      songnameBtn: false,
      indonesianSongsBtn: false
    });
  }

  /**
   * 清空容器内容（性能优化：使用 removeChild 而不是 innerHTML）
   * @param {HTMLElement} container - 容器元素（可以是任何容器，包括网格）
   */
  _clearContainer(container) {
    if (!container) return;
    // 性能优化：使用 removeChild 而不是 innerHTML
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  /**
   * 设置加载状态
   * @param {HTMLElement} container - 容器元素
   * @param {boolean} isLoading - 是否正在加载
   */
  _setLoadingState(container, isLoading) {
    if (!container) return;
    this.loading = isLoading;
    container.dataset.loading = String(isLoading);
  }

  /**
   * 清理加载状态并隐藏加载指示器
   * @param {HTMLElement} container - 容器元素
   */
  _cleanupLoadingState(container) {
    if (!container) return;
    hideLoadingIndicator(container);
    this._setLoadingState(container, false);
  }

  _isModalActive() {
    const modalActive = this.modal && !this.modal.classList.contains('hidden');
    const managerMode = sharedModalManager.getCurrentMode?.();
    const managerUI = sharedModalManager.getCurrentUI?.();
    return modalActive && managerMode === 'song' && managerUI === this;
  }

  /**
   * 统一日志方法，优先使用logService，降级到console
   */
  // _log() 继承自 BaseSongUI

  async initServices() {
    // 防止重复初始化：如果正在初始化，等待完成
    if (this._initServicesPromise) {
      return this._initServicesPromise;
    }

    // 创建初始化 Promise 并缓存
    this._initServicesPromise = (async () => {
      try {
        // 先调用基类方法初始化基础服务（基类也有防重复机制）
        await super.initServices();

        // 性能优化：并行加载所有需要的服务和模块
        const loadPromises = [];

        // singerService 是同步加载的，从 index.js 导入
        if (!this.singerService) {
          loadPromises.push(
            import('../../index.js').then(services => {
              this.singerService = services.singerService;
            })
          );
        }

        // apiService 和 langService 是同步加载的，从 index.js 导入
        if (!this.apiService || !this.langService || !this.logService) {
          loadPromises.push(
            import('../../index.js').then(services => {
              this.apiService = services.apiService;
              this.langService = services.langService;
              this.logService = services.logService;
            })
          );
        }

        // 初始化语言服务并加载印尼语翻译（异步，不阻塞）
        if (this.langService) {
          loadPromises.push(
            (async () => {
              try {
                if (!this.langService.translations['zh_cn']) {
                  await this.langService.init();
                }
                // 印尼语翻译延迟加载，不阻塞打开
                if (!this.langService.translations['id_id']) {
                  // 使用 requestIdleCallback 或延迟加载
                  if ('requestIdleCallback' in window) {
                    requestIdleCallback(() => {
                      this.langService.loadLanguageFile('id_id').catch(() => { });
                    }, { timeout: 2000 });
                  } else {
                    this._timerManager.addTimeout(() => {
                      this.langService.loadLanguageFile('id_id').catch(() => { });
                    }, 1000);
                  }
                }
              } catch (e) {

              }
            })()
          );
        }

        // 并行加载渲染模块
        if (!this.renderer) {
          loadPromises.push(
            import('./SongTopRenderer.js').then(module => {
              this.renderer = module;
            }).catch(e => {

            })
          );
        }

        if (!this.topBarRenderer) {
          loadPromises.push(
            import('./TopBarRenderer.js').then(module => {
              this.topBarRenderer = module;
            }).catch(e => {
              logError('SongTopUI', '顶部栏渲染模块加载失败', e);
            })
          );
        }

        // 等待所有关键服务加载完成（语言翻译不阻塞）
        await Promise.all(loadPromises.filter(p => p));
      } catch (error) {
        // 初始化失败时清除 Promise 缓存，允许重试
        this._initServicesPromise = null;
        throw error;
      }
    })();

    return this._initServicesPromise;
  }

  initTopModal() {

    // 生成筛选按钮区域HTML（点歌模态框特有的中间内容）
    // 使用全局函数名，确保事件能触发
    const middleContent = `
      <div class="pt-3 pb-3 space-y-3">
        <div id="quick-categories" class="space-y-1">
          <div class="bg-transparent rounded-lg py-1">
            <div class="flex gap-2 mb-2">
              <button id="songname-selector" class="rounded-full flex-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 shadow-sm song-top-filter-btn song-top-filter-btn--primary flex flex-col items-center justify-center" data-action="songname">
                <span class="zh-label leading-tight font-semibold">歌名</span>
                <span class="indonesian-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Nama Lagu</span>
                <span class="en-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Song</span>
                <span class="vi-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Tên bài</span>
              </button>
              <button id="top-singers-more-btn" class="rounded-full flex-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 shadow-sm song-top-filter-btn song-top-filter-btn--primary flex flex-col items-center justify-center" data-action="singers">
                <span class="zh-label leading-tight font-semibold">歌星</span>
                <span class="indonesian-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Penyanyi</span>
                <span class="en-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Singer</span>
                <span class="vi-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Ca sĩ</span>
              </button>
              <button id="language-selector" class="rounded-full flex-1 bg-transparent border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 shadow-sm song-top-filter-btn song-top-filter-btn--primary flex flex-col items-center justify-center" data-action="language">
                <span class="zh-label leading-tight font-semibold">语种</span>
                <span class="indonesian-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Bahasa</span>
                <span class="en-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Language</span>
                <span class="vi-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Ngôn ngữ</span>
              </button>
              <button id="category-selector" class="rounded-full flex-1 bg-transparent border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 shadow-sm song-top-filter-btn song-top-filter-btn--primary flex flex-col items-center justify-center" data-action="category">
                <span class="zh-label leading-tight font-semibold">分类</span>
                <span class="indonesian-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Kategori</span>
                <span class="en-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Category</span>
                <span class="vi-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Thể loại</span>
              </button>
              <button id="indonesian-songs-btn" class="rounded-full flex-1 bg-transparent border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 shadow-sm song-top-filter-btn song-top-filter-btn--primary flex flex-col items-center justify-center" data-action="indonesian">
                <span class="zh-label leading-tight font-semibold">印尼歌曲</span>
                <span class="indonesian-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Lagu Indonesia</span>
                <span class="en-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Indonesian</span>
                <span class="vi-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Bài Indonesia</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // 直接使用 SharedModalManager，不再需要 BaseModal
    const modal = sharedModalManager.getOrCreateModal();
    if (!modal) return;

    if (this.modal === modal) return;

    this.modal = modal;
    this.modal._songTopUIInstance = this;

    // 设置搜索图标类型
    sharedModalManager.setSearchIconType('fontawesome');

    // 设置中间内容
    sharedModalManager.setMiddleContent(middleContent);

    // 确保在渲染快速分类后再绑定顶部栏交互
    this.renderQuickCategories().then(async () => {
      // 初始化语言服务
      try {
        await this.initServices();
      } catch (e) {

      }

      // 绑定事件（事件委托机制，不依赖按钮的创建时机）
      try {
        this.topBarRenderer?.bindTopBarInteractions?.(this);
      } catch (e) {
        logError('SongTopUI', '绑定顶部栏交互失败', e);
      }

      // 更新按钮标签（事件委托确保即使 innerHTML 被替换，事件仍然有效）
      try {
        this.updateSelectorLabels();
      } catch (e) {

      }
    });

    // 搜索框绑定移到 openTopModal 中，确保打开时绑定，关闭时解绑

    const container = sharedModalManager.getContainer();
    if (container) {
      this._setLoadingState(container, false);
      container.dataset.done = 'false';

      // 确保容器可以滚动
      container.setAttribute('data-scrollable', 'true');

      // 设置滚动容器样式，确保可以正常滚动（使用统一的方法）
      this.ensureScrollContainerStyles(container);

      // 使用事件管理器统一管理所有事件监听器
      // 创建wheel handler
      this._wheelHandler = (e) => {
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        const isAtTop = scrollTop <= 0;
        const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;
        const deltaY = e.deltaY || 0;

        // 只在边界且尝试继续滚动时阻止默认行为
        if ((isAtTop && deltaY < 0) || (isAtBottom && deltaY > 0)) {
          if (e.cancelable) {
            e.preventDefault();
          }
          return false;
        }
      };

      // 注册wheel事件
      this._addEventListener(container, 'wheel', this._wheelHandler, { passive: false, capture: true });

      // 创建touch handlers
      this._touchHandlers = {
        start: () => { },
        move: () => { },
        end: () => { }
      };

      // 注册touch事件
      this._addEventListener(container, 'touchstart', this._touchHandlers.start, { passive: true, capture: true });
      this._addEventListener(container, 'touchmove', this._touchHandlers.move, { passive: true, capture: true });
      this._addEventListener(container, 'touchend', this._touchHandlers.end, { passive: true, capture: true });

      this.bindInfiniteScroll(container);
    }

    // 注册键盘事件
    if (!this._keydownHandler) {
      this._keydownHandler = (e) => {
        if (e.key === 'Escape') this.closeTopModal();
      };
      this._addEventListener(this.modal, 'keydown', this._keydownHandler);
    }
  }

  resetAllSelectors() {
    // 使用统一的方法重置所有按钮状态
    this._resetAllButtonsState();
    // 清除缓存，确保下次获取最新状态
    this._clearSelectorButtonsCache();
  }

  async handleSingerButtonClick() {
    try {
      await this.initServices();
      const container = sharedModalManager.getContainer();
      if (!container) return;

      // 使用状态管理器统一更新状态
      this.state.update({
        isShowingSingersList: true,
        singersPage: 1,
        singerFilters: { sex: '', region: '', keyword: '' },
        selectedCategoryCode: null,
        selectedLanguageCode: null
      });

      const searchInput = sharedModalManager.getSearchInput();
      if (searchInput) searchInput.value = '';

      this.setMode('singer', {});
      await this.loadData(container, 1);
      this.bindInfiniteScroll(container);
    } catch (error) {
      logError('SongTopUI', '加载热门歌星失败', error);
    }
  }

  setMode(mode, params = {}, isIndonesianSongs = false) {
    const sessionId = this._beginSession();
    const lastMode = this.state.get('currentMode', 'top');

    // 更新当前模式
    this.state.set('currentMode', mode);

    // 如果不是搜索模式，更新lastMode
    if (mode !== 'search' && lastMode !== 'search') {
      this.state.set('lastMode', lastMode);
    }

    // 根据模式更新状态
    const stateUpdates = {};

    if (mode === 'singer') {
      if (params.primarySingerNo) {
        stateUpdates.filterParams = { primarySingerNo: String(params.primarySingerNo) };
        stateUpdates.isShowingSingersList = false;
      } else {
        stateUpdates.filterParams = {};
      }
      stateUpdates.selectedLanguageCode = null;
      stateUpdates.selectedCategoryCode = null;
      stateUpdates.selectedSingerName = params.singerName || this.state.get('selectedSingerName') || null;
    } else if (mode === 'language') {
      stateUpdates.filterParams = Object.keys(params).length > 0 ? params : {};
      stateUpdates.selectedLanguageCode = params.languageCode || null;
      stateUpdates.selectedCategoryCode = null;
      stateUpdates.isShowingSingersList = false;
      stateUpdates.skipNextPrefetch = true;
    } else if (mode === 'category') {
      stateUpdates.filterParams = Object.keys(params).length > 0 ? params : {};
      stateUpdates.selectedCategoryCode = params.categoryCode || null;
      stateUpdates.selectedLanguageCode = null;
      stateUpdates.isShowingSingersList = false;
      stateUpdates.skipNextPrefetch = true;
    } else if (mode === 'top') {
      stateUpdates.filterParams = {};
      stateUpdates.selectedLanguageCode = null;
      stateUpdates.selectedCategoryCode = null;
      stateUpdates.selectedSingerName = null;
      stateUpdates.isShowingSingersList = false;
    } else if (mode === 'search') {
      // 搜索模式下 filterParams 由调用方管理
    } else {
      const currentFilterParams = this.state.get('filterParams', {});
      stateUpdates.filterParams = Object.keys(params).length > 0 ? params : currentFilterParams;
    }

    // 批量更新状态
    if (Object.keys(stateUpdates).length > 0) {
      this.state.update(stateUpdates);
    }

    const container = sharedModalManager.getContainer();
    if (container) {
      this._setLoadingState(container, false);
      container.dataset.done = 'false';

      this.renderQuickCategories().then(() => {
        if (!this._isSessionActive(sessionId)) {
          return;
        }
        // 如果是印尼歌曲模式，特殊处理按钮状态
        if (mode === 'language' && isIndonesianSongs) {
          // 使用统一的方法更新按钮状态
          this._updateButtonsState({
            indonesianSongsBtn: true,
            langSelector: false,
            clsSelector: false,
            singersBtn: false,
            songnameBtn: false
          });
        } else {
          // 正常更新所有按钮状态
          this.updateSelectorsUI(this.currentMode);
        }

        this.updateSelectorLabels();
        this.renderFilterBar();
        this.renderFilterTags();
      });

      // 不在这里调用renderContent，避免重复加载数据
      // 数据加载由调用setMode的地方负责（如handleSingerButtonClick、按钮点击等）
    }
  }

  async openSingerSongs(singerNo, singerName) {
    if (!singerNo) return;
    try {
      this.setMode('singer', { primarySingerNo: String(singerNo), singerName });
      const container = sharedModalManager.getContainer();
      if (container) {
        this._setLoadingState(container, false);
        container.dataset.done = 'false';
        // 使用统一的方法清空容器
        this._clearContainer(container);
        this.ensureScrollContainerStyles(container);
        await this.loadSongs(container, 1);
        this.bindInfiniteScroll(container);
      }
    } catch (error) {

      this.toastService?.showToast?.('加载歌星歌曲失败');
    }
  }

  /**
   * 捕获搜索前的状态
   * @returns {Object} 状态快照
   */
  _capturePreSearchState() {
    const filterParams = this.state.get('filterParams', {});
    const singerFilters = this.state.get('singerFilters', {});
    const currentMode = this.state.get('currentMode', 'top');
    const selectedLanguageCode = this.state.get('selectedLanguageCode', null);

    const filterParamsClone = (filterParams && typeof filterParams === 'object')
      ? { ...filterParams }
      : {};
    const singerFiltersClone = (singerFilters && typeof singerFilters === 'object')
      ? { ...singerFilters }
      : null;
    const languageCode = filterParamsClone?.languageCode ?? selectedLanguageCode;
    const isIndonesianSongs =
      currentMode === 'language' &&
      languageCode !== undefined &&
      ['id', '6', '10'].includes(String(languageCode));

    return {
      mode: currentMode,
      filterParams: filterParamsClone,
      selectedLanguageCode: this.state.get('selectedLanguageCode', null),
      selectedCategoryCode: this.state.get('selectedCategoryCode', null),
      selectedSingerName: this.state.get('selectedSingerName', null),
      isShowingSingersList: this.state.get('isShowingSingersList', false),
      singersPage: this.state.get('singersPage', 1),
      singerFilters: singerFiltersClone,
      lastMode: this.state.get('lastMode', 'top'),
      isIndonesianSongs
    };
  }

  /**
   * 恢复搜索前的状态
   * @returns {boolean} 是否恢复成功
   */
  _restorePreSearchState() {
    const previousState = this.state.get('preSearchState', null);
    this.state.set('preSearchState', null);

    if (!previousState || !previousState.mode) {
      return false;
    }

    const {
      mode,
      filterParams,
      isIndonesianSongs,
      selectedLanguageCode,
      selectedCategoryCode,
      selectedSingerName,
      isShowingSingersList,
      singersPage,
      singerFilters,
      lastMode
    } = previousState;

    // 使用setMode恢复模式
    this.setMode(mode, filterParams || {}, isIndonesianSongs);

    // 恢复其他状态
    const stateUpdates = {};

    if (Object.prototype.hasOwnProperty.call(previousState, 'selectedLanguageCode')) {
      stateUpdates.selectedLanguageCode = selectedLanguageCode;
    }
    if (Object.prototype.hasOwnProperty.call(previousState, 'selectedCategoryCode')) {
      stateUpdates.selectedCategoryCode = selectedCategoryCode;
    }
    if (Object.prototype.hasOwnProperty.call(previousState, 'selectedSingerName')) {
      stateUpdates.selectedSingerName = selectedSingerName;
    }
    if (Object.prototype.hasOwnProperty.call(previousState, 'isShowingSingersList')) {
      stateUpdates.isShowingSingersList = isShowingSingersList;
    }
    if (Object.prototype.hasOwnProperty.call(previousState, 'singersPage') && Number.isFinite(singersPage)) {
      stateUpdates.singersPage = singersPage;
    }
    if (singerFilters) {
      stateUpdates.singerFilters = { ...singerFilters };
    }
    if (lastMode) {
      stateUpdates.lastMode = lastMode;
    } else if (mode && mode !== 'search') {
      stateUpdates.lastMode = mode;
    }

    // 批量更新状态
    if (Object.keys(stateUpdates).length > 0) {
      this.state.update(stateUpdates);
    }

    return true;
  }

  updateSelectorsUI(mode) {
    const buttons = this._getSelectorButtons();
    if (!buttons) return;

    // 先重置所有按钮状态
    this._resetAllButtonsState();

    // 检查是否是印尼歌曲模式
    const isIndonesianSongs = this._isIndonesianSongsMode();

    // 如果mode未提供，从状态中获取
    const currentMode = mode || this.state.get('currentMode', 'top');

    // 根据模式设置选中状态
    if (isIndonesianSongs) {
      // 印尼歌曲模式：只选中印尼歌曲按钮
      this._updateButtonState(buttons.indonesianSongsBtn, true);
    } else if (currentMode === 'language') {
      // 普通语种模式：选中语种按钮
      this._updateButtonState(buttons.langSelector, true);
    } else if (currentMode === 'category') {
      this._updateButtonState(buttons.clsSelector, true);
    } else if (currentMode === 'singer') {
      this._updateButtonState(buttons.singersBtn, true);
    } else if (currentMode === 'top' || currentMode === 'search') {
      this._updateButtonState(buttons.songnameBtn, true);
    }
  }

  updateSelectorLabels() {
    const buttons = this._getSelectorButtons();
    if (!buttons) return;

    const { langSelector, clsSelector, singersBtn, songnameBtn, indonesianSongsBtn } = buttons;

    // 获取中文文本（直接从中文翻译获取，确保始终是中文）
    const getChineseText = (key) => {
      // 优先从中文翻译中获取
      if (this.langService && this.langService.translations['zh_cn']) {
        const chineseText = this.langService.translations['zh_cn'][key];
        if (chineseText) return chineseText;
      }
      // 如果没有翻译，使用默认中文文本
      const defaultTexts = {
        'songName': '歌名',
        'singer': '歌星',
        'language': '语种',
        'category': '分类',
        'indonesianSongs': '印尼歌曲'
      };
      return defaultTexts[key] || '';
    };

    // 获取多语言文本
    const getTranslation = (code, key) => {
      if (this.langService && this.langService.translations[code]) {
        const text = this.langService.translations[code][key];
        if (text) return text;
      }
      const defaults = {
        'id_id': { 'songName': 'Nama Lagu', 'singer': 'Penyanyi', 'language': 'Bahasa', 'category': 'Kategori', 'indonesianSongs': 'Lagu Indonesia', 'all': 'Semua', 'sex': 'Jenis Kelamin', 'region': 'Wilayah' },
        'en_us': { 'songName': 'Song', 'singer': 'Singer', 'language': 'Language', 'category': 'Category', 'indonesianSongs': 'Indonesian', 'all': 'All', 'sex': 'Gender', 'region': 'Region' },
        'vi_vn': { 'songName': 'Tên bài', 'singer': 'Ca sĩ', 'language': 'Ngôn ngữ', 'category': 'Thể loại', 'indonesianSongs': 'Bài Indonesia', 'all': 'Tất cả', 'sex': 'Giới tính', 'region': 'Vùng miền' }
      };
      return defaults[code]?.[key] || '';
    };

    // 获取印尼语文本
    const getIndonesianText = (key) => getTranslation('id_id', key);
    // 获取英语文本
    const getEnglishText = (key) => getTranslation('en_us', key);
    // 获取越南语文本
    const getVietnameseText = (key) => getTranslation('vi_vn', key);

    // 更新按钮标签（中文、印尼语、英语、越南语）
    const updateButton = (btn, chineseKey, translationKey) => {
      if (!btn) return;
      const key = translationKey || chineseKey;
      const chineseText = getChineseText(chineseKey);
      const indonesianText = getIndonesianText(key);
      const englishText = getEnglishText(key);
      const vietnameseText = getVietnameseText(key);

      const isSelected = btn.classList.contains('bg-blue-500');

      let chineseSpan = btn.querySelector('.zh-label, span:not(.indonesian-translation):not(.en-translation):not(.vi-translation)');
      let indonesianSpan = btn.querySelector('.indonesian-translation');
      let englishSpan = btn.querySelector('.en-translation');
      let vietnameseSpan = btn.querySelector('.vi-translation');

      const subLangColorClass = isSelected
        ? 'text-white text-opacity-90'
        : 'text-gray-500 dark:text-gray-400';

      if (!chineseSpan || !indonesianSpan || !englishSpan || !vietnameseSpan) {
        const dataAction = btn.getAttribute('data-action');
        const id = btn.id;
        const classes = btn.className;
        btn.innerHTML = `
          <span class="zh-label leading-tight font-semibold">${chineseText}</span>
          <span class="indonesian-translation ${subLangColorClass} leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">${indonesianText}</span>
          <span class="en-translation ${subLangColorClass} leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">${englishText}</span>
          <span class="vi-translation ${subLangColorClass} leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">${vietnameseText}</span>
        `;
        if (dataAction) btn.setAttribute('data-action', dataAction);
        if (id) btn.id = id;
        btn.className = classes;
        chineseSpan = btn.querySelector('.zh-label, span:not(.indonesian-translation):not(.en-translation):not(.vi-translation)');
        indonesianSpan = btn.querySelector('.indonesian-translation');
        englishSpan = btn.querySelector('.en-translation');
        vietnameseSpan = btn.querySelector('.vi-translation');
      } else {
        chineseSpan.textContent = chineseText;
        chineseSpan.className = 'zh-label leading-tight font-semibold';
        
        indonesianSpan.textContent = indonesianText;
        indonesianSpan.className = `indonesian-translation ${subLangColorClass} leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap`;
        
        englishSpan.textContent = englishText;
        englishSpan.className = `en-translation ${subLangColorClass} leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap`;
        
        vietnameseSpan.textContent = vietnameseText;
        vietnameseSpan.className = `vi-translation ${subLangColorClass} leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap`;
      }

      this._applySelectorLabelTypography(chineseSpan, indonesianSpan, englishSpan, vietnameseSpan);
    };

    updateButton(songnameBtn, 'songName', 'songName');
    updateButton(singersBtn, 'singer', 'singer');
    updateButton(langSelector, 'language', 'language');
    updateButton(clsSelector, 'category', 'category');
    updateButton(indonesianSongsBtn, 'indonesianSongs', 'indonesianSongs');
  }

  renderFilterBar() {
    const middleContentEl = sharedModalManager.getMiddleContentElement();
    const langWrap = middleContentEl?.querySelector('#quick-language');
    const clsWrap = middleContentEl?.querySelector('#quick-category');
    const singerWrap = middleContentEl?.querySelector('#quick-singer');

    const hideAll = () => {
      if (langWrap) langWrap.classList.add('hidden');
      if (clsWrap) clsWrap.classList.add('hidden');
      if (singerWrap) singerWrap.classList.add('hidden');
    };

    const mode = this.state.get('currentMode', 'top');
    const filterParams = this.state.get('filterParams', {});
    hideAll();

    const isIndonesianSongs = mode === 'language' && filterParams?.languageCode &&
      ['id', '6', '10'].includes(String(filterParams.languageCode));

    if (mode === 'language') {
      if (isIndonesianSongs) {
        // 印尼歌曲模式：不展示语种/分类快速过滤
        hideAll();
      } else {
        if (langWrap) langWrap.classList.remove('hidden');
        if (clsWrap) clsWrap.classList.add('hidden');
      }
    } else if (mode === 'category') {
      if (clsWrap) clsWrap.classList.remove('hidden');
      if (langWrap) langWrap.classList.add('hidden');
    } else if (mode === 'singer') {
      const isSingerSongs = !!(filterParams && filterParams.primarySingerNo);
      const isShowingSingersList = this.state.get('isShowingSingersList', false);
      if (!isSingerSongs && isShowingSingersList) {
        if (singerWrap) singerWrap.classList.remove('hidden');
        if (typeof this.renderSingerFilters === 'function') {
          this.renderSingerFilters();
        }
        const filterTagsContainer = this.modal?.querySelector('#filter-tags-container');
        if (filterTagsContainer) filterTagsContainer.classList.remove('hidden');
      }
    } else if (mode === 'top' || mode === 'search') {
      if (langWrap) langWrap.classList.add('hidden');
      if (clsWrap) clsWrap.classList.add('hidden');
    }
  }

  /**
   * 确保滚动容器样式正确（使用统一的工具方法）
   */
  ensureScrollContainerStyles(container) {
    DomUtils.ensureScrollContainerStyles(container);
  }

  // 统一的数据加载入口：委托给数据加载模块
  async loadData(container, page = 1) {
    return this.dataLoader.loadData(container, page);
  }

  // 委托给数据加载模块
  async loadSongs(container, page = 1) {
    return this.dataLoader.loadSongs(container, page);
  }

  // 委托给数据加载模块
  async loadMoreSongs(container) {
    return this.dataLoader.loadMoreSongs(container);
  }

  _shouldPrefetchAfterInitialLoad(container) {
    return this.dataLoader._shouldPrefetchAfterInitialLoad(container);
  }

  _ensureContainerFilled(container) {
    return this.dataLoader._ensureContainerFilled(container);
  }

  async _prefetchNextPage(container, sessionId = this._sessionId) {
    return this.dataLoader._prefetchNextPage(container, sessionId);
  }

  // 委托给数据加载模块
  async loadMoreSingers(container) {
    return this.dataLoader.loadMoreSingers(container);
  }

  toggleQuickCategories(isHidden) {
    const middleContentEl = sharedModalManager.getMiddleContentElement();
    const quickCategories = middleContentEl?.querySelector('#quick-categories');
    const quickLanguage = middleContentEl?.querySelector('#quick-language');
    const quickCategory = middleContentEl?.querySelector('#quick-category');
    const method = isHidden ? 'add' : 'remove';
    if (quickCategories) quickCategories.classList[method]('hidden');
    if (quickLanguage) quickLanguage.classList[method]('hidden');
    if (quickCategory) quickCategory.classList[method]('hidden');
  }

  // 委托给数据加载模块
  async loadSingers(container, page = 1) {
    return this.dataLoader.loadSingers(container, page);
  }

  // 委托给筛选器模块
  getFilterLabel(type, code, options) {
    return this.filters.getFilterLabel(type, code, options);
  }

  renderFilterTags() {
    return this.filters.renderFilterTags();
  }

  showSingerFilterTag(type, name, options) {
    this.renderFilterTags();
  }

  async renderSingerFilters() {
    return this.filters.renderSingerFilters();
  }

  async applySingerFilter(type, code) {
    return this.filters.applySingerFilter(type, code);
  }

  async renderQuickCategories() {
    return this.filters.renderQuickCategories();
  }

  async activateQuickFilter(type) {
    return this.filters.activateQuickFilter(type);
  }

  async openFilterDialog(type) {
    return this.filters.openFilterDialog(type);
  }

  closeFilterDialog() {
    return this.filters.closeFilterDialog();
  }

  createSingerCard(singer) {
    // 统一使用卡片工厂函数，确保所有卡片样式完全一致
    return window.SongCardFactory.createUnifiedSingerCard(this, singer);
  }

  createSongCard(song) {
    // 统一使用卡片工厂函数，确保所有卡片样式完全一致
    return window.SongCardFactory.createUnifiedSongCard(this, song);
  }

  /**
   * 绑定播放事件（使用公共模块）
   */
  bindPlayEvent(songCard, song) {
    return bindPlayEvent(this, songCard, song);
  }

  /**
   * 处理添加按钮点击（使用公共模块）
   */
  async handleAddBtnClick(song, addBtn) {
    return handleAddBtnClick(this, song, addBtn);
  }

  bindInfiniteScroll(container) {
    if (!container) return;
    if (this._scrollDetach && typeof this._scrollDetach === 'function') {
      this._scrollDetach();
      this._scrollDetach = null;
    }
    // 增大 threshold 到 300px，让它在距离底部更远时就触发加载，避免慢速滚动时出现空白
    this._scrollDetach = attachInfiniteScroll(container, { threshold: 300, insufficientThreshold: 50 }, () => {
      if (!container) return;
      if (container.dataset.done === 'true') return;
      const isSingerListMode = this.currentMode === 'singer' && this.isShowingSingersList && !this.filterParams?.primarySingerNo;
      if (isSingerListMode) {
        this.loadMoreSingers(container);
        return;
      }
      this._ensureContainerFilled(container);
    });
  }

  // 委托给卡片更新模块
  updateAllSongCardsUI(immediate = false) {
    return this.cardUpdater.updateAllSongCardsUI(immediate);
  }

  updateSongCardsByIds(songIds = []) {
    return this.cardUpdater.updateSongCardsByIds(songIds);
  }

  async openTopModal() {
    if (!this.modal) this.initTopModal();
    if (!this.modal) return;

    hideAllButtons();

    if (window.partyUI && window.partyUI.modal && !window.partyUI.modal.classList.contains('hidden') && !window.partyUI._isClosing) {
      await window.partyUI.closePartyModal(true);
      hideAllButtons();
    }

    // 重置关闭状态
    this._isClosing = false;

    // 性能优化：提前并行初始化服务，不阻塞UI显示
    // 使用 Promise.race 确保即使服务初始化慢，也不会阻塞模态框显示
    const initServicesPromise = this.initServices().catch(err => {
      this._log('warn', '服务初始化失败，将在需要时重试', err);
    });

    // 点歌页面打开时，重置状态为默认值（top模式，无过滤参数）
    // 使用setMode确保完全重置状态，包括按钮UI
    this.setMode('top', {}, false);
    this.state.set('preSearchState', null);

    // 设置当前模式和使用共享模态框管理器
    sharedModalManager.setCurrentMode('song', this);

    // 确保搜索图标类型正确（与initTopModal保持一致）
    sharedModalManager.setSearchIconType('fontawesome');

    // 确保中间内容是点歌页面的按钮（从派对页面切换回来时必须重新设置）
    // 检查中间内容是否已存在且正确
    const middleContentEl = sharedModalManager.getMiddleContentElement();
    const quickCategoriesEl = middleContentEl?.querySelector('#quick-categories');

    if (!quickCategoriesEl || !quickCategoriesEl.querySelector('#songname-selector')) {
      // 重新设置中间内容（必须包含所有语言翻译）
      const middleContent = `
        <div class="pt-3 pb-3 space-y-3">
          <div id="quick-categories" class="space-y-1">
            <div class="bg-transparent rounded-lg py-1">
              <div class="flex gap-2 mb-2">
                <button id="songname-selector" class="rounded-full flex-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 shadow-sm song-top-filter-btn song-top-filter-btn--primary flex flex-col items-center justify-center" data-action="songname">
                  <span class="zh-label leading-tight font-semibold">歌名</span>
                  <span class="indonesian-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Nama Lagu</span>
                  <span class="en-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Song</span>
                  <span class="vi-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Tên bài</span>
                </button>
                <button id="top-singers-more-btn" class="rounded-full flex-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 shadow-sm song-top-filter-btn song-top-filter-btn--primary flex flex-col items-center justify-center" data-action="singers">
                  <span class="zh-label leading-tight font-semibold">歌星</span>
                  <span class="indonesian-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Penyanyi</span>
                  <span class="en-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Singer</span>
                  <span class="vi-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Ca sĩ</span>
                </button>
                <button id="language-selector" class="rounded-full flex-1 bg-transparent border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 shadow-sm song-top-filter-btn song-top-filter-btn--primary flex flex-col items-center justify-center" data-action="language">
                  <span class="zh-label leading-tight font-semibold">语种</span>
                  <span class="indonesian-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Bahasa</span>
                  <span class="en-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Language</span>
                  <span class="vi-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Ngôn ngữ</span>
                </button>
                <button id="category-selector" class="rounded-full flex-1 bg-transparent border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 shadow-sm song-top-filter-btn song-top-filter-btn--primary flex flex-col items-center justify-center" data-action="category">
                  <span class="zh-label leading-tight font-semibold">分类</span>
                  <span class="indonesian-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Kategori</span>
                  <span class="en-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Category</span>
                  <span class="vi-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Thể loại</span>
                </button>
                <button id="indonesian-songs-btn" class="rounded-full flex-1 bg-transparent border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 shadow-sm song-top-filter-btn song-top-filter-btn--primary flex flex-col items-center justify-center" data-action="indonesian">
                  <span class="zh-label leading-tight font-semibold">印尼歌曲</span>
                  <span class="indonesian-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Lagu Indonesia</span>
                  <span class="en-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Indonesian</span>
                  <span class="vi-translation text-gray-500 dark:text-gray-400 leading-tight tracking-tighter indonesian-letter-tight whitespace-nowrap">Bài Indonesia</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
      sharedModalManager.setMiddleContent(middleContent);
    }

    // 移除旧的定位相关类，使用CSS控制定位
    // 性能优化：缓存 content 元素，避免重复查询
    const content = this._cachedContent || (this._cachedContent = this.modal.firstElementChild);
    if (content) {
      // 性能优化：使用工具函数批量操作类，减少重排
      resetModalClasses(content);

      // 性能优化：使用工具函数批量设置样式，减少重排
      setHardwareAcceleration(content);
    }

    // 性能优化：立即显示模态框，减少延迟
    this.modal.classList.remove('hidden', 'opacity-0');
    this.modal.classList.add(MODAL_ANIMATION_CLASSES.VISIBLE);

    // 使用 requestAnimationFrame 确保动画在下一帧触发（性能优化）
    if (content) {
      requestAnimationFrame(() => {
        // 添加过渡类，触发打开动画
        content.classList.add(MODAL_ANIMATION_CLASSES.SLIDE_TRANSITION);
      });
    }

    const container = sharedModalManager.getContainer();
    if (container) {
      container.scrollTop = 0;
      this.ensureScrollContainerStyles?.(container);
      container.classList.remove('hidden');
      container.dataset.loading = 'false';
      container.dataset.done = 'false';
    }

    // 性能优化：使用单次 requestAnimationFrame，减少延迟累积
    requestAnimationFrame(() => {
      this._bindSearchInput();
      this._bindStateSyncEvents();
      // 更新模态框高度（在模态框显示后）
      this.updateModalHeight?.();

      // 性能优化：不等待服务初始化，立即开始加载数据
      // 服务初始化在后台并行进行，不阻塞UI显示
      const loadDataAndInit = async () => {
        try {
          // 1. 优先从全局获取服务（最快）
          if (!this.songService && typeof window !== 'undefined' && window.songService) {
            this.songService = window.songService;
          }

          // 2. 如果全局没有，尝试初始化（不阻塞）
          if (!this.songService) {
            initServicesPromise.catch(() => { }); // 后台初始化，不等待
            // 尝试从index.js导入
            try {
              const services = await import('../../index.js');
              this.songService = services.songService;
            } catch (err) {
              this._log('warn', '服务初始化失败，将在需要时重试', err);
            }
          }

          try {
            await this.initServices();
          } catch (e) {
            this._log('warn', 'initServices 未完成，继续尝试加载', e);
          }

          const svcForGate = this.songService || (typeof window !== 'undefined' ? window.songService : null);
          if (svcForGate && typeof svcForGate.setBlockWsPlaylistApply === 'function') {
            svcForGate.setBlockWsPlaylistApply(true);
          }
          try {
            // 3. 先清空本地已选再拉服务端（避免上一会话/异常解析残留的「幽灵已选」画在榜单上）
            if (this.songService && typeof this.songService.applyPlayListSnapshot === 'function') {
              try {
                this.songService.applyPlayListSnapshot([], {
                  source: 'openSongTop-reset',
                  emitEvent: true
                });
              } catch (clearErr) {
                this._log('warn', '打开点歌前清空本地已选失败', clearErr);
              }
            }

            // 4. 与服务器对齐已选列表，再渲染榜单
            if (this.songService && typeof this.songService.syncRequestedSongsFromServer === 'function') {
              try {
                await this.songService.syncRequestedSongsFromServer({
                  force: true,
                  immediate: true
                });
              } catch (syncErr) {
                this._log('warn', '打开点歌前同步已选失败，界面已按空列表处理', syncErr);
              }
            }

            // 5. 加载榜单：首屏跳过 songs 内存缓存，保证与接口一致；已选态仍来自上一步 HTTP 队列
            this._skipSongCacheOnce = true;
            // 渲染卡片（SongCardFactory 内用 isSongRequested）
            if (container && this.songService) {
              await this.loadData(container, 1);
              this.bindInfiniteScroll?.(container);
              if (typeof this.updateAllSongCardsUI === 'function') {
                this.updateAllSongCardsUI(true);
              }
            }
          } finally {
            if (svcForGate && typeof svcForGate.setBlockWsPlaylistApply === 'function') {
              svcForGate.setBlockWsPlaylistApply(false);
            }
          }

          this.topBarRenderer?.bindTopBarInteractions?.(this);
          this.updateSelectorLabels?.();
        } catch (err) {
          this._log('error', '加载数据失败', err);
        }
      };

      // 立即开始加载，不等待
      loadDataAndInit();
    });
  }

  /**
   * 关闭点歌模态框 (极简版)
   * 直接隐藏DOM，不使用任何动画，防止卡死
   * @param {boolean} keepDomVisible - 是否保持DOM显示（用于在不同模式间切换）
   * @returns {Promise} 关闭完成的Promise
   */
  closeTopModal(keepDomVisible = false) {
    // 清理资源 (Timer, Events, Scroll, Caches)
    try {
      // 立即解绑滚动监听器
      if (this._scrollDetach && typeof this._scrollDetach === 'function') {
        this._scrollDetach();
        this._scrollDetach = null;
      }
      // 清理定时器
      if (this._updateCardsTimer) {
        this._timerManager.clearTimeout(this._updateCardsTimer);
        this._updateCardsTimer = null;
      }
      // 立即停止预取操作
      this._prefetchedSongs = null;
      this._prefetching = false;
      if (this._prefetchToken !== undefined) this._prefetchToken += 1;

      // 立即清理各种缓存和处理器
      this._clearSelectorButtonsCache();
      this._unbindStateSyncEvents();
      if (this._searchInputHandler?.cleanup) {
        this._searchInputHandler.cleanup();
        this._searchInputHandler = null;
      }
      if (this._closeBtnCleanup) {
        this._closeBtnCleanup();
        this._closeBtnCleanup = null;
      }
      this.closeFilterDialog?.();

      sharedModalManager._clearCache?.();

      // songTopUI 特定的清理逻辑
      this.state.set('preSearchState', null);

      this.cleanupEventListeners();
    } catch (error) {
      console.error('[SongTopUI] cleanup error', error);
    }

    // 3. 强制重置状态
    this._isOpening = false;
    this._isClosing = false;
    this._cachedContent = null;

    // 4. 处理 DOM 显示/隐藏
    if (!this.modal) {
      return Promise.resolve();
    }

    if (keepDomVisible) {
      // 切换模式：保持 modal 显示，不恢复底栏
      return Promise.resolve();
    }

    this.modal.classList.add('hidden');
    this.modal.classList.remove('opacity-0', MODAL_ANIMATION_CLASSES.CLOSING, MODAL_ANIMATION_CLASSES.CLOSING_ACTIVE, MODAL_ANIMATION_CLASSES.VISIBLE);

    showAllButtons();

    return Promise.resolve();
  }

  /**
   * 绑定搜索框事件（点歌页面专用）
   * @private
   */
  _bindSearchInput() {
    const searchInput = sharedModalManager.getSearchInput();
    const closeBtn = sharedModalManager.getCloseBtn();

    if (this._searchInputHandler?.cleanup) {
      this._searchInputHandler.cleanup();
      this._searchInputHandler = null;
    }

    if (!searchInput) {
      return;
    }

    const onSearch = async (keyword = '') => {
      const trimmedKeyword = (keyword || '').trim();
      const container = sharedModalManager.getContainer();
      if (!container) return;

      try {
        const currentMode = this.state.get('currentMode', 'top');
        const preSearchState = this.state.get('preSearchState', null);
        const filterParams = this.state.get('filterParams', {});
        const singerFilters = this.state.get('singerFilters', {});

        if (trimmedKeyword) {
          if (!preSearchState && currentMode !== 'search') {
            this.state.set('preSearchState', this._capturePreSearchState());
          }

          if (currentMode === 'singer') {
            this.state.update({
              singerFilters: { ...singerFilters, keyword: trimmedKeyword },
              singersPage: 1
            });
            await this.loadSingers(container, 1);
          } else {
            const filters = {};
            if (currentMode === 'category' && filterParams?.categoryCode) {
              filters.categoryCode = filterParams.categoryCode;
            }
            if (currentMode === 'language' && filterParams?.languageCode) {
              filters.languageCode = filterParams.languageCode;
            }

            await searchSongs({
              ui: this,
              keyword: trimmedKeyword,
              baseFilterParams: filters
            });
          }
        } else {
          if (currentMode === 'search') {
            const restored = this._restorePreSearchState();
            if (!restored) {
              this.setMode('top', {});
            }
          } else if (currentMode === 'singer') {
            if (singerFilters && typeof singerFilters === 'object') {
              this.state.update({
                singerFilters: { ...singerFilters, keyword: '' },
                singersPage: 1
              });
            }
          }
          await this.loadData(container, 1);
        }
      } catch (err) {
        logError('SongTopUI', '处理搜索输入失败', err);
      }
    };

    this._searchInputHandler = bindSearchInput({
      searchInput,
      onSearch,
      debounceDelay: 200
    });

    if (closeBtn) {
      this._closeBtnCleanup = bindSearchCloseBtn({
        closeBtn,
        searchInput,
        onClear: () => {
          if (this._searchInputHandler && typeof this._searchInputHandler.clear === 'function') {
            this._searchInputHandler.clear();
          }
        },
        log: console.log
      });
    }
  }

  // _bindStateSyncEvents 方法已提取到 BaseSongUI 基类

  cleanupEventListeners() {
    // 清理所有定时器
    if (this._timerManager) {
      this._timerManager.clearAll();
    }
    this._updateCardsTimer = null;

    // 清理所有事件监听器
    if (this._eventListeners && Array.isArray(this._eventListeners)) {
      this._eventListeners.forEach(({ element, event, handler, options }) => {
        try {
          if (element && typeof element.removeEventListener === 'function') {
            element.removeEventListener(event, handler, options);
          }
        } catch (e) {
          // 忽略清理错误
        }
      });
      this._eventListeners = [];
    }

    // 清理搜索框事件
    if (this._searchInputHandler?.cleanup) {
      try {
        this._searchInputHandler.cleanup();
      } catch (e) {
        // 忽略清理错误
      }
      this._searchInputHandler = null;
    }

    // 清理关闭按钮事件
    if (this._closeBtnCleanup) {
      try {
        this._closeBtnCleanup();
      } catch (e) {
        // 忽略清理错误
      }
      this._closeBtnCleanup = null;
    }

    // 使用基类的公共方法清理状态同步事件监听器
    this._unbindStateSyncEvents();

    // 清理状态管理器
    if (this.state && typeof this.state.cleanup === 'function') {
      try {
        this.state.cleanup();
      } catch (e) {
        // 忽略清理错误
      }
    }

    // 清理选择器按钮缓存
    this._clearSelectorButtonsCache();

    // 清理滚动监听器
    const container = sharedModalManager.getContainer();
    if (container) {
      if (this._scrollDetach) {
        try {
          this._scrollDetach();
        } catch (e) {
          // 忽略清理错误
        }
        this._scrollDetach = null;
      }
      container.dataset.loading = 'false';
      container.dataset.done = 'false';
    }

    // 清理预取相关状态（确保完全清理）
    this._prefetchedSongs = null;
    if (this._prefetching !== undefined) {
      this._prefetching = false;
    }
    if (this._prefetchToken !== undefined) {
      this._prefetchToken = 0;
    }

    // 重置所有handler引用
    this._resizeHandler = null;
    this._keydownHandler = null;
    this._wheelHandler = null;
    this._touchHandlers = null;
    this._scrollHandler = null;
    this._scrollStopHandler = null;
  }

  /**
   * 统一顶部筛选按钮和快速筛选按钮的文字样式，避免受其他CSS覆盖
   */
  _applyQuickButtonTypography(button) {
    if (!button) return;
    button.style.removeProperty('font-size');
    button.style.removeProperty('line-height');
    button.style.removeProperty('font-weight');
    button.style.removeProperty('padding');
  }

  /**
   * 统一顶部筛选中文/印尼语标签文字样式
   */
  _applySelectorLabelTypography(...spans) {
    // 移除内联样式，使用CSS类控制样式
    spans.forEach(span => {
      if (span) {
        span.style.removeProperty('font-size');
        span.style.removeProperty('line-height');
        span.style.removeProperty('font-weight');
      }
    });
  }
}

const songTopUI = new SongTopUI();
export default songTopUI;
