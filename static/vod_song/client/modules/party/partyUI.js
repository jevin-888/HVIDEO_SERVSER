import { attachInfiniteScroll, showLoadingIndicator, hideLoadingIndicator, showNoMoreDataIndicator, hideNoMoreDataIndicator } from '../../utils/InfiniteScroll.js';
import { ScrollPositionManager } from '../songs/ScrollPositionManager.js';
import { bindSearchInput, bindSearchCloseBtn } from '../common/SearchInputHandler.js';
import { searchSongs, clearSearch } from '../common/SearchLogic.js';
import sharedModalManager, { UNIFIED_CONTAINER_ID } from '../common/SharedModalManager.js';
import { updateSongCardUIById as updateSongCardUI } from '../songs/SongTopRenderer.js';
import { bindPlayEvent, handleAddBtnClick } from '../common/PlayEventHandler.js';
import { renderSongs as renderSongsCommon } from '../songs/SongTopRenderer.js';
import {
  hideAllButtons,
  showAllButtons,
  getHomeBtn,
  setHardwareAcceleration,
  clearHardwareAcceleration,
  resetModalClasses,
  MODAL_ANIMATION_CLASSES
} from '../common/ModalUtils.js';
import { BaseSongUI } from '../common/BaseSongUI.js';

// 常量定义
const DEFAULT_CATEGORY_ID = '11'; // 默认DISCO分类
const SCROLL_THRESHOLD = 300; // 无限滚动触发阈值（px）
const CONTAINER_FILL_THRESHOLD = 400; // 容器填充触发阈值（px）
const INITIAL_RENDER_COUNT = 15; // 初始渲染数量
const BATCH_RENDER_SIZE = 10; // 分批渲染批次大小
const DEBOUNCE_DELAY = 300; // 搜索防抖延迟（ms）
const CARD_UPDATE_DEBOUNCE = 30; // 卡片更新防抖延迟（ms）

const PARTY_CATEGORY_STYLE_MAP = {
  '11': { icon: 'fa-record-vinyl', className: 'party-category-btn--disco', dataCategory: 'disco' },
  '27': { icon: 'fa-headphones', className: 'party-category-btn--dj', dataCategory: 'dj' },
  '56': { icon: 'fa-headphones-alt', className: 'party-category-btn--relax', dataCategory: 'relax' },
  '59': { icon: 'fa-microphone', className: 'party-category-btn--rap', dataCategory: 'rap' },
  '60': { icon: 'fa-crown', className: 'party-category-btn--top-dj', dataCategory: 'top-dj' },
  '61': { icon: 'fa-glass-martini-alt', className: 'party-category-btn--bar', dataCategory: 'bar' },
  '69': { icon: 'fa-video', className: 'party-category-btn--live', dataCategory: 'live' },
  '70': { icon: 'fa-heart', className: 'party-category-btn--theme', dataCategory: 'theme' },
  default: { icon: 'fa-music', className: 'party-category-btn--default', dataCategory: 'default' }
};

/**
 * 派对页面UI（完全独立实现）
 * 复刻点歌页面UI结构，但使用独立的数据和逻辑
 */
class PartyUI extends BaseSongUI {
  constructor() {
    super('PartyUI');
    this.currentMode = 'category'; // 派对页面默认为分类模式
    this.filterParams = { categoryCode: DEFAULT_CATEGORY_ID }; // 默认DISCO分类
    this.selectedCategoryId = DEFAULT_CATEGORY_ID; // 记录当前选中的分类ID，用于搜索清空后恢复
    this.partyCategories = [
      { id: '11', name: 'DISCO' },
      { id: '27', name: 'DJSong' },
      { id: '56', name: 'DISCO-畅听' },
      { id: '59', name: '说唱' },
      { id: '60', name: '世界百大DJ' },
      { id: '61', name: '酒吧音乐' },
      { id: '69', name: 'DJ现场' },
      { id: '70', name: '主题派对' }
    ];
    this._isClosing = false; // 初始化关闭状态
    this._scrollDetach = null; // 无限滚动解绑函数
    this._eventsBound = false; // 标记事件是否已绑定
    this._prefetchedSongs = null;
    this._prefetching = false;
    this._prefetchToken = 0;
    this._skipNextPrefetch = false;
    this._isOpening = false; // 标记是否正在打开
    this._songSyncCleanup = null;
  }

  // 继承自 BaseSongUI 的方法：
  // - _getSearchKeyword()
  // - _buildRequestFilterParams()
  // - initServices()
  // - _log()
  // - _showNoMoreData()

  /**
   * 重置预取状态
   * 作用：清除预取数据、重置预取标志、递增预取令牌（用于取消过期请求）
   * 调用时机：切换分类时、关闭模态框时、清理资源时
   */
  _resetPrefetchState() {
    this._prefetchedSongs = null;
    this._prefetching = false;
    this._prefetchToken += 1;
  }

  /**
   * 归一化歌曲数据
   * 作用：将API返回的原始数据转换为统一的歌曲对象格式
   * @param {any} response - API响应数据
   * @returns {Array} 归一化后的歌曲数组
   * 调用时机：每次从API获取数据后，在渲染前调用
   */
  _normalizeSongs(response) {
    return this.songService.normalizeSongs(response);
  }

  /**
   * 更新分类按钮激活状态
   * 作用：将所有分类按钮的active类移除，然后为指定分类ID的按钮添加active类
   * @param {string} activeCategoryId - 要激活的分类ID
   * 调用时机：用户点击分类按钮时、搜索清空恢复分类时
   */
  _updateCategoryButtonState(activeCategoryId) {
    const middleContentEl = sharedModalManager.getMiddleContentElement();
    if (!middleContentEl) return;

    const allButtons = middleContentEl.querySelectorAll('.party-category-btn') || [];
    allButtons.forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.categoryId === activeCategoryId) {
        btn.classList.add('active');
      }
    });
  }

  /**
   * 统一错误处理
   * 作用：记录错误日志，并根据需要显示Toast提示给用户
   * @param {string} message - 错误消息
   * @param {Error} error - 错误对象
   * @param {boolean} showToast - 是否显示Toast提示（默认true，预取失败时不显示）
   * 调用时机：所有异步操作的catch块中
   */
  _handleError(message, error, showToast = true) {
    this._log('error', message, error);
  }

  /**
   * 创建分类按钮
   * 作用：根据partyCategories数组创建所有分类按钮，并设置样式和激活状态
   * @param {HTMLElement} container - 按钮容器元素
   * @param {string} activeCategoryId - 激活的分类ID（可选，不传则默认第一个）
   * 调用时机：初始化模态框时、确保按钮存在时
   */
  _createCategoryButtons(container, activeCategoryId = null) {
    if (!container) return;

    // 清空容器
    container.innerHTML = '';

    this.partyCategories.forEach((cat, idx) => {
      const style = PARTY_CATEGORY_STYLE_MAP[cat.id] || PARTY_CATEGORY_STYLE_MAP.default;
      const btn = document.createElement('button');
      btn.className = 'party-category-btn rounded-2xl shadow-lg transition-all duration-300 hover:scale-105 active:scale-95';
      if (style?.className) {
        btn.classList.add(style.className);
      }

      // 设置激活状态：优先使用传入的activeCategoryId，否则使用第一个
      if (activeCategoryId === cat.id || (!activeCategoryId && idx === 0)) {
        btn.classList.add('active');
      }

      btn.dataset.categoryId = cat.id;
      // 添加 data-category 属性以使用新的数据属性选择器（向后兼容）
      if (style?.dataCategory) {
        btn.dataset.category = style.dataCategory;
      }

      const icon = document.createElement('i');
      icon.className = `fas ${style?.icon || PARTY_CATEGORY_STYLE_MAP.default.icon}`;

      const text = document.createElement('span');
      text.textContent = cat.name;

      btn.appendChild(icon);
      btn.appendChild(text);

      container.appendChild(btn);
    });

    this._log('debug', `已添加 ${this.partyCategories.length} 个分类按钮`);
  }

  /**
   * 确保分类按钮存在
   * 作用：检查分类按钮容器是否存在，如果不存在则创建容器和按钮
   * @param {string} activeCategoryId - 激活的分类ID（可选）
   * @returns {HTMLElement|null} 按钮容器元素
   * 调用时机：打开模态框时，确保按钮已创建
   */
  _ensureCategoryButtonsExist(activeCategoryId = null) {
    let middleContentEl = sharedModalManager.getMiddleContentElement();
    let buttonsContainer = middleContentEl?.querySelector('#party-category-buttons');

    // 如果按钮容器不存在，创建中间内容区域
    if (!buttonsContainer) {
      const middleContent = `
        <div class="py-3">
          <div id="party-category-buttons" class="grid grid-cols-4 gap-3"></div>
        </div>
      `;
      sharedModalManager.setMiddleContent(middleContent);
      middleContentEl = sharedModalManager.getMiddleContentElement();
      buttonsContainer = middleContentEl?.querySelector('#party-category-buttons');
    }

    // 如果按钮容器存在但为空，创建按钮
    if (buttonsContainer && buttonsContainer.children.length === 0) {
      this._createCategoryButtons(buttonsContainer, activeCategoryId);
    }

    return buttonsContainer;
  }

  /**
   * 初始化派对模态框
   * 作用：创建或获取共享模态框，设置搜索图标类型，创建中间内容区域和分类按钮
   * 注意：此方法只初始化DOM结构，不绑定事件（事件在showPartyModal中绑定）
   * 调用时机：showPartyModal中，如果modal不存在时调用
   */
  initPartyModal() {
    if (this.modal) return;

    this._log('debug', '初始化模态框');

    // 使用共享模态框管理器（与点歌页面保持一致）
    this.modal = sharedModalManager.getOrCreateModal();

    // 设置搜索图标类型为SVG
    sharedModalManager.setSearchIconType('svg');

    // 设置中间内容（空容器，按钮后续创建）
    const middleContent = `
      <div class="py-3">
        <div id="party-category-buttons" class="grid grid-cols-4 gap-3"></div>
      </div>
    `;
    sharedModalManager.setMiddleContent(middleContent);

    const content = this.modal.querySelector('.song-top-modal-container');
    if (content) {
      content.classList.remove('unified-modal-closing', 'unified-modal-closing-active');
    }

    const songsContainer = sharedModalManager.getContainer();
    if (songsContainer && !songsContainer.classList.contains('px-4')) {
      songsContainer.classList.add('px-4', 'sm:px-8');
    }

    // 创建分类按钮
    const buttonsContainer = sharedModalManager.getMiddleContentElement()?.querySelector('#party-category-buttons');
    if (buttonsContainer) {
      this._createCategoryButtons(buttonsContainer, this.selectedCategoryId);
    }

    // 注意：不在这里绑定事件，统一在 showPartyModal() 中绑定
  }

  /**
   * 创建搜索处理函数
   * 作用：创建搜索和清空搜索的处理函数
   * @returns {Function} 搜索处理函数
   * 调用时机：bindEvents中，绑定搜索框事件时
   */
  _createSearchHandler() {
    return async (keyword) => {
      // 检查当前模态框是否是派对页面
      const currentModalMode = sharedModalManager.getCurrentMode();
      if (currentModalMode !== 'party') {
        this._log('debug', `onSearch - 当前模态框不是派对页面 (${currentModalMode})，跳过`);
        return;
      }

      if (keyword) {
        // 使用统一的搜索函数
        await searchSongs({
          ui: this,
          keyword,
          baseFilterParams: {
            // 派对模态框：保留当前分类
            categoryCode: this.selectedCategoryId || DEFAULT_CATEGORY_ID
          },
          containerId: UNIFIED_CONTAINER_ID,
          log: this._log.bind(this)
        });
      } else {
        // 清空搜索：使用统一的清空逻辑，但自定义恢复逻辑
        await clearSearch({
          ui: this,
          onClear: async () => {
            await this._handleSearchClear();
          },
          log: this._log.bind(this)
        });
      }
    };
  }

  /**
   * 处理搜索清空
   * 作用：搜索清空后恢复到之前的分类
   * 调用时机：搜索清空时、关闭按钮清空时
   */
  async _handleSearchClear() {
    // 恢复到之前的分类（派对模态框特有的逻辑）
    this._log('debug', '搜索清空，尝试恢复分类', { currentMode: this.currentMode, selectedCategoryId: this.selectedCategoryId });
    if (this.selectedCategoryId) {
      this._log('debug', '清空搜索，恢复分类', this.selectedCategoryId);
      await this.loadCategorySongs(this.selectedCategoryId);
    } else {
      // 兜底：点击当前激活的分类按钮或加载默认分类
      await this._loadDefaultCategory();
    }
  }

  /**
   * 加载默认分类
   * 作用：加载默认分类或点击激活的分类按钮
   * 调用时机：搜索清空但没有selectedCategoryId时
   */
  async _loadDefaultCategory() {
    // 缓存DOM查询结果
    const middleContentEl = sharedModalManager.getMiddleContentElement();
    if (!middleContentEl) {
      this._log('debug', '未找到中间内容元素，加载默认分类');
      await this.loadCategorySongs(DEFAULT_CATEGORY_ID);
      return;
    }

    const activeBtn = middleContentEl.querySelector('.party-category-btn.active');

    if (activeBtn) {
      this._log('debug', '使用兜底逻辑，点击激活的分类按钮');
      activeBtn.click();
    } else {
      // 如果没有任何激活的按钮，触发默认分类
      this._log('debug', '没有激活的按钮，加载默认分类');
      await this.loadCategorySongs(DEFAULT_CATEGORY_ID);
    }
  }

  /**
   * 绑定所有事件监听器
   * 作用：绑定分类按钮点击事件（事件委托）、搜索框输入事件、关闭按钮点击事件
   * 注意：如果已绑定，会先解绑旧的事件监听器，避免重复绑定
   * 调用时机：showPartyModal中，模态框显示后
   */
  bindEvents() {
    // 如果已绑定且模态框存在，先清理旧的事件监听器
    if (this._eventsBound && this.modal) {
      this.unbindEvents();
    }

    if (!this.modal) {
      this._log('warn', '模态框不存在，无法绑定事件');
      return;
    }

    // 性能优化：使用事件委托，避免重复绑定
    const middleContentEl = sharedModalManager.getMiddleContentElement();
    if (!middleContentEl) {
      this._log('warn', '中间内容元素不存在，无法绑定分类按钮事件');
    } else {
      // 移除旧的事件监听器（如果存在）
      if (this._categoryButtonHandler) {
        middleContentEl.removeEventListener('click', this._categoryButtonHandler, true);
        this._categoryButtonHandler = null;
      }

      // 使用事件委托，只需绑定一次（捕获阶段优先，避免被其他逻辑拦截）
      this._categoryButtonHandler = async (e) => {
        const btn = e.target.closest('.party-category-btn');
        const inCategoryArea = e.target.closest && e.target.closest('#party-category-buttons');
        if (inCategoryArea) {
          this._log('info', `[派对] 点击派对分类区域 target=${e.target.tagName} id=${e.target.id || ''} class=${(e.target.className || '').slice(0, 40)}`);
        }
        if (!btn) return;

        const categoryId = btn.dataset.categoryId;
        if (!categoryId) return;

        e.preventDefault();
        e.stopPropagation();
        this._log('info', `[派对] 点击派对分类按钮: id=${categoryId}`);

        // 更新按钮状态
        this._updateCategoryButtonState(categoryId);

        // 加载分类歌曲
        await this.loadCategorySongs(categoryId);
      };

      // 绑定事件委托：使用捕获阶段，确保在其它处理之前执行
      middleContentEl.addEventListener('click', this._categoryButtonHandler, true);
      this._log('debug', '使用事件委托绑定分类按钮事件(捕获阶段)');
    }

    // 使用共享的搜索框绑定工具（使用统一ID）
    const searchInput = sharedModalManager.getSearchInput();
    const closeBtn = sharedModalManager.getCloseBtn();

    if (searchInput) {
      // 使用提取的搜索处理函数
      const onSearch = this._createSearchHandler();

      // 使用共享工具绑定搜索框事件
      this._searchInputHandler = bindSearchInput({
        searchInput,
        onSearch,
        debounceDelay: DEBOUNCE_DELAY,
        log: this._log.bind(this)
      });
    }

    // 绑定关闭按钮
    if (closeBtn) {
      this._closeBtnCleanup = bindSearchCloseBtn({
        closeBtn,
        searchInput,
        onClear: async () => {
          await this._handleSearchClear();
        },
        log: this._log.bind(this)
      });
    }

    // 标记事件已绑定
    this._eventsBound = true;
  }

  /**
   * 解绑所有事件监听器
   * 作用：清理搜索框事件、关闭按钮事件、分类按钮事件（事件委托）
   * 调用时机：cleanupEventListeners中、bindEvents中（重新绑定时）
   */
  unbindEvents() {
    if (!this.modal) return;

    // 清理搜索框事件（使用共享工具的清理函数）
    if (this._searchInputHandler?.cleanup) {
      this._searchInputHandler.cleanup();
      this._searchInputHandler = null;
    }

    // 清理关闭按钮事件
    if (this._closeBtnCleanup) {
      this._closeBtnCleanup();
      this._closeBtnCleanup = null;
    }

    // 性能优化：使用事件委托，只需移除一次监听器
    const middleContentEl = sharedModalManager.getMiddleContentElement();
    if (middleContentEl && this._categoryButtonHandler) {
      middleContentEl.removeEventListener('click', this._categoryButtonHandler, true);
      this._categoryButtonHandler = null;
    }

    // 标记事件已解绑
    this._eventsBound = false;
  }
  /**
   * 加载指定分类的歌曲（第1页）
   * 作用：重置预取状态、初始化服务、请求分类歌曲数据、渲染歌曲列表、更新按钮状态
   * @param {string} categoryId - 分类ID（如'11'表示DISCO）
   * 调用时机：用户点击分类按钮时、搜索清空恢复分类时、打开模态框时自动加载默认分类
   */
  async loadCategorySongs(categoryId) {
    let container = sharedModalManager.getContainer();
    if (!container) {
      this._log('warn', '[派对] loadCategorySongs: 容器不存在，延迟再试');
      await new Promise(r => setTimeout(r, 100));
      container = sharedModalManager.getContainer();
    }
    if (!container) {
      this._log('error', '[派对] loadCategorySongs: 无法获取歌曲列表容器，请检查 #unified-songs-container');
      if (typeof console !== 'undefined' && console.warn) console.warn('[派对] loadCategorySongs: 容器不存在');
      return;
    }
    this._log('info', `[派对] loadCategorySongs 开始: categoryId=${categoryId}`);
    if (typeof console !== 'undefined' && console.warn) console.warn('[派对] loadCategorySongs 开始 categoryId=', categoryId);

    // 重置预取状态
    this._resetPrefetchState();
    const currentToken = this._prefetchToken;
    delete container.dataset.autoFillRunning;
    this._setDoneState(false, container);
    this._setLoadingState(true, container);

    try {
      // 确保服务已初始化
      await this.initServices();

      // 简单检查：如果还没有，从全局获取
      if (!this.songService && typeof window !== 'undefined' && window.songService) {
        this.songService = window.songService;
      }

      if (!this.songService) {
        throw new Error('songService 未初始化');
      }

      // 获取分类名称
      const category = this.partyCategories.find(c => c.id === categoryId);
      const categoryName = category ? category.name : '派对音乐';

      if (this.toastService) {
        // 移除加载提示toast，避免遮挡页面内容
      }

      // 更新状态
      this.currentMode = 'category';
      this.filterParams = { categoryCode: categoryId };
      this.selectedCategoryId = categoryId; // 记录当前选中的分类ID
      this.page = 1;
      this._skipNextPrefetch = true;

      // 更新顶部标题
      this.renderFilterTags(categoryName);

      // 调用服务获取歌曲
      const requestParams = this._buildRequestFilterParams();
      const firstPageSize = (typeof this.getPageSize === 'function') ? this.getPageSize(1) : 10;
      this._log('info', 'loadCategorySongs 请求', { mode: 'category', page: 1, size: firstPageSize, params: requestParams });
      const result = await this.songService.loadSongsByMode('category', requestParams, 1, firstPageSize);
      if (currentToken !== this._prefetchToken) {
        this._log('debug', 'loadCategorySongs: 分类已切换，丢弃旧数据');
        return;
      }

      let songs = this._normalizeSongs(result.list || []);
      let count = songs?.length || 0;
      this._log('info', `[派对] loadCategorySongs 返回: ${count} 首歌曲`);
      if (typeof console !== 'undefined' && console.warn) console.warn('[派对] loadCategorySongs 返回', count, '首歌曲');

      // 兜底：分类接口返回 0 条时，用热门歌曲填充，避免页面空白
      if (count === 0) {
        this._log('warn', '[派对] 分类接口返回 0 条，兜底加载热门歌曲');
        try {
          const topResult = await this.songService.loadSongsByMode('top', {}, 1, firstPageSize);
          const fallbackList = this._normalizeSongs(topResult?.list || []);
          if (fallbackList.length > 0) {
            songs = fallbackList;
            count = songs.length;
            this._log('info', `[派对] 兜底加载热门歌曲 ${count} 首`);
            if (this.toastService && typeof this.toastService.showToast === 'function') {
              this.toastService.showToast('该分类暂无数据，已显示热门歌曲。后端支持 classify_code 后即可按分类显示。', 'info', 3000);
            }
          }
        } catch (e) {
          this._log('warn', '[派对] 兜底加载热门失败', e);
        }
      }

      // 渲染歌曲列表
      await this.renderSongs(songs, container, 1);

      // 注意：卡片状态更新在 renderSongs() 中统一处理，避免重复更新

    } catch (error) {
      this._handleError('加载分类歌曲失败', error);
    } finally {
      this._setLoadingState(false, container);
    }
  }

  /**
   * 渲染歌曲列表到容器
   * 作用：调用统一的渲染函数渲染歌曲卡片、更新模态框高度、绑定无限滚动、更新卡片状态
   * @param {Array} songs - 歌曲数组
   * @param {HTMLElement} container - 容器元素
   * @param {number} page - 页码（默认1）
   * 调用时机：loadCategorySongs后、loadMoreSongs后、使用预取数据时
   */
  async renderSongs(songs, container, page = 1) {
    if (!container) return;

    const resolvedPage = Number.isFinite(page) ? page : Number(page) || 1;
    hideNoMoreDataIndicator(container);

    await renderSongsCommon(this, songs, container, resolvedPage);
    this.updateModalHeight?.();

    if (resolvedPage === 1) {
      this.page = 1;
      this._prefetchedSongs = null;
      this._prefetching = false;
      delete container.dataset.autoFillRunning;
      if (container.scrollTop > 0) {
        container.scrollTop = 0;
      }
    } else if (resolvedPage > 1) {
      this.page = resolvedPage;
    }

    const compareSize = resolvedPage === 1 ? ((typeof this.getPageSize === 'function') ? this.getPageSize(1) : 10) : this.size;
    const hasMore = Array.isArray(songs) && songs.length >= compareSize;
    this._setDoneState(!hasMore, container);
    this._setLoadingState(false, container);

    // 缓存DOM查询结果
    const targetGrid = container.querySelector('.grid');

    if (!hasMore) {
      this._log('debug', '数据少于请求数量，设置完成状态');
      if (typeof showNoMoreDataIndicator === 'function' && targetGrid) {
        showNoMoreDataIndicator(container, targetGrid, '没有更多歌曲了');
      }
    } else {
      this._log('debug', '还有更多数据');
      if (resolvedPage === 1) {
        if (!this._skipNextPrefetch) {
          requestAnimationFrame(() => this._prefetchNextPage(container));
        }
      }
    }

    if (resolvedPage === 1) {
      requestAnimationFrame(() => {
        this.updateAllSongCardsUI?.(false);
      });
    }

    this.bindInfiniteScroll(container);
    if (resolvedPage === 1) {
      this._skipNextPrefetch = false;
    }
  }

  /**
   * 创建单个歌曲卡片DOM元素
   * 作用：调用统一的卡片工厂创建歌曲卡片
   * @param {Object} song - 歌曲对象
   * @returns {HTMLElement|null} 歌曲卡片元素
   * 调用时机：renderSongs中批量创建卡片时
   */
  createSongCard(song) {
    return window.SongCardFactory.createUnifiedSongCard(this, song);
  }

  /**
   * 绑定无限滚动监听器
   * 作用：在容器上绑定滚动监听，当接近底部时触发加载更多
   * 注意：会先解绑旧的监听器，避免重复绑定
   * @param {HTMLElement} container - 滚动容器
   * 调用时机：renderSongs后，确保滚动监听已绑定
   */
  bindInfiniteScroll(container) {
    if (!container) {
      this._log('warn', 'bindInfiniteScroll: 容器不存在');
      return;
    }

    // 先解绑旧的监听器，避免重复绑定
    if (this._scrollDetach && typeof this._scrollDetach === 'function') {
      try {
        this._scrollDetach();
      } catch (error) {
        this._log('error', '解绑旧滚动监听器失败', error);
      }
      this._scrollDetach = null;
    }

    // 使用优化实现：增大 threshold，让它在距离底部更远时就触发加载，避免慢速滚动时出现空白
    this._scrollDetach = attachInfiniteScroll(container, { threshold: SCROLL_THRESHOLD, insufficientThreshold: 50 }, () => {
      if (!container) return;
      if (container.dataset.done === 'true') return;
      this._ensureContainerFilled(container);
    });

    this._log('debug', '无限滚动监听器已绑定', { containerId: container.id || container.className });
  }

  /**
   * 加载下一页歌曲
   * 作用：保存滚动位置、请求下一页数据、分批渲染新卡片、恢复滚动位置
   * @param {HTMLElement} container - 滚动容器
   * 调用时机：用户滚动到底部时，通过_ensureContainerFilled触发
   */
  async loadMoreSongs(container) {
    if (this.loading || !container) {
      return;
    }

    const token = this._prefetchToken;
    // 保存滚动位置
    const scrollInfo = ScrollPositionManager.saveScrollPosition(container, 'songId');
    const nextPage = this.page + 1;

    try {
      this._setLoadingState(true, container);

      // 缓存DOM查询结果
      let grid = container.querySelector('.grid');
      if (!grid) {
        grid = document.createElement('div');
        grid.className = 'grid grid-cols-1 gap-2 virtual-grid';
        container.appendChild(grid);
      }

      hideNoMoreDataIndicator(container);
      showLoadingIndicator(container, grid);

      await this.initServices();
      const requestParams = this._buildRequestFilterParams();
      this._log('info', 'loadMoreSongs 请求', { mode: this.currentMode, page: nextPage, size: this.size, params: requestParams });
      const result = await this.songService.loadSongsByMode(this.currentMode, requestParams, nextPage, this.size);
      if (token !== this._prefetchToken) {
        this._log('debug', 'loadMoreSongs: 分类已切换，丢弃旧数据');
        hideLoadingIndicator(container);
        this._setLoadingState(false, container);
        return;
      }
      const songs = this._normalizeSongs(result.list || []);

      this._log('debug', `loadMoreSongs - 第${nextPage}页返回 ${songs?.length || 0} 首歌曲`);

      hideLoadingIndicator(container);

      if (!songs || songs.length === 0) {
        this._setDoneState(true, container);
        showNoMoreDataIndicator(container, grid, '没有更多歌曲了');
        this._prefetchedSongs = null;
        this._setLoadingState(false, container);
        return;
      }

      // 准备恢复滚动位置
      const restoreState = ScrollPositionManager.prepareForRestore(container);

      // 统一走公共渲染器，避免“没有更多歌曲了”提示节点残留在列表中间
      await renderSongsCommon(this, songs, container, nextPage);

      if (this.updateModalHeight) {
        requestAnimationFrame(() => {
          this.updateModalHeight();
        });
      }

      // 使用基类的公共方法恢复滚动位置
      this._restoreScrollPosition(container, scrollInfo, restoreState, () => {
        this._setLoadingState(false, container);
      });

      this.page = nextPage;

      // 确保正确设置 done 状态
      if (!songs || songs.length < this.size) {
        this._log('debug', `loadMoreSongs - 返回数量 ${songs?.length || 0} < ${this.size}，标记完成`);
        this._setDoneState(true, container);
        showNoMoreDataIndicator(container, grid, '没有更多歌曲了');
        this._prefetchedSongs = null;
      } else {
        this._setDoneState(false, container);
      }
    } catch (error) {
      this._handleError('加载更多失败', error, false);
      hideLoadingIndicator(container);
      delete container.dataset._restoringScroll;
      delete container.dataset._updatingHeight;
      this._setLoadingState(false, container);
      // 发生错误时也设置为完成状态，避免无限请求
      this._setDoneState(true, container);
    } finally {
      // 确保 loading 状态总是被重置（除非正在恢复滚动位置或更新高度）
      if (this.loading) {
        if (container.dataset._restoringScroll !== 'true' && container.dataset._updatingHeight !== 'true') {
          delete container.dataset._restoringScroll;
          delete container.dataset._updatingHeight;
          this._setLoadingState(false, container);
        }
      }
    }
  }

  /**
   * 检查容器是否需要更多数据
   * 作用：检查容器滚动状态，判断是否需要加载更多数据
   * @param {HTMLElement} container - 滚动容器
   * @returns {boolean} 是否需要加载更多
   * 调用时机：_ensureContainerFilled中
   */
  _shouldLoadMore(container) {
    if (!container || container.dataset.done === 'true') return false;

    const scrollRange = container.scrollHeight - container.clientHeight;
    if (scrollRange <= 0) return false;

    // 计算距离底部的距离
    const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
    // 放宽触发范围：距离底部阈值内就触发加载（与 InfiniteScroll 的阈值配合，留有余量）
    // 这样可以确保在慢速滚动时也能及时加载数据，避免出现空白
    return distanceToBottom <= CONTAINER_FILL_THRESHOLD;
  }

  /**
   * 使用预取的数据
   * 作用：使用已预取的歌曲数据，渲染到容器中
   * @param {HTMLElement} container - 滚动容器
   * 调用时机：_ensureContainerFilled中，有预取数据时
   */
  _usePrefetchedSongs(container) {
    const { songs, done, token } = this._prefetchedSongs;

    // 检查token是否过期
    if (token !== this._prefetchToken) {
      this._prefetchedSongs = null;
      delete container.dataset.autoFillRunning;
      return;
    }

    this._prefetchedSongs = null;

    // 缓存DOM查询结果
    const targetGrid = container.querySelector('.grid');
    hideNoMoreDataIndicator(container);

    if (!Array.isArray(songs) || songs.length === 0) {
      this._setDoneState(true, container);
      if (typeof showNoMoreDataIndicator === 'function' && targetGrid) {
        showNoMoreDataIndicator(container, targetGrid, '没有更多歌曲了');
      }
      delete container.dataset.autoFillRunning;
      return;
    }

    // 保存滚动位置
    const scrollInfo = ScrollPositionManager.saveScrollPosition(container, 'songId');
    const restoreState = ScrollPositionManager.prepareForRestore(container);

    // 渲染预取的数据
    Promise.resolve(renderSongsCommon(this, songs, container, this.page + 1))
      .then(() => {
        this.page += 1;
        this._setDoneState(done, container);
        // 使用基类的公共方法恢复滚动位置
        this._restoreScrollPosition(container, scrollInfo, restoreState, () => {
          this._setLoadingState(false, container);
        });

        if (!done) {
          // 如果还有更多数据，继续预取
          this._prefetchNextPage(container);
        } else {
          // 没有更多数据，显示提示（使用缓存的grid）
          if (typeof showNoMoreDataIndicator === 'function' && targetGrid) {
            showNoMoreDataIndicator(container, targetGrid, '没有更多歌曲了');
          }
          this._setDoneState(true, container);
          this._setLoadingState(false, container);
        }
      })
      .catch(error => {
        this._log('error', '追加预取数据失败', error);
        this._setDoneState(true, container);
        // 使用基类的公共方法恢复滚动位置
        this._restoreScrollPosition(container, null, restoreState, () => {
          this._setLoadingState(false, container);
        });
      })
      .finally(() => {
        delete container.dataset.autoFillRunning;
      });
  }

  /**
   * 确保容器填满（智能加载）
   * 作用：检查容器是否需要更多数据，如果有预取数据则使用，否则触发加载或预取
   * 注意：使用递归的requestAnimationFrame实现持续检查，直到容器填满或没有更多数据
   * @param {HTMLElement} container - 滚动容器
   * 调用时机：无限滚动触发时、预取完成后
   */
  _ensureContainerFilled(container) {
    if (!container || container.dataset.done === 'true') return;
    if (container.dataset.autoFillRunning === 'true') return;

    container.dataset.autoFillRunning = 'true';

    const checkAndLoad = () => {
      if (!this._shouldLoadMore(container)) {
        delete container.dataset.autoFillRunning;
        return;
      }

      // 如果有预取数据，使用预取数据
      if (this._prefetchedSongs) {
        this._usePrefetchedSongs(container);
        return;
      }

      // 如果正在加载或预取，等待下次检查
      if (this._prefetching || this.loading || container.dataset.loading === 'true') {
        requestAnimationFrame(checkAndLoad);
        return;
      }

      // 触发预取
      this._prefetchNextPage(container);
      requestAnimationFrame(checkAndLoad);
    };

    requestAnimationFrame(checkAndLoad);
  }

  /**
   * 预取下一页数据
   * 作用：在后台提前加载下一页数据，存储在_prefetchedSongs中，供滚动时快速使用
   * 注意：使用_prefetchToken机制防止过期请求，如果分类已切换则丢弃预取结果
   * @param {HTMLElement} container - 滚动容器
   * 调用时机：第1页渲染完成后、使用预取数据后如果还有更多数据
   */
  async _prefetchNextPage(container) {
    if (!container) return;
    if (container.dataset.done === 'true') return;
    if (this._prefetching) return;

    const token = this._prefetchToken;
    const nextPage = this.page + 1;
    this._prefetching = true;
    try {
      await this.initServices();
      const requestParams = this._buildRequestFilterParams();
      this._log('info', '_prefetchNextPage 请求', { mode: this.currentMode, page: nextPage, size: this.size, params: requestParams });
      const result = await this.songService.loadSongsByMode(this.currentMode, requestParams, nextPage, this.size);
      if (token !== this._prefetchToken) {
        this._log('debug', '_prefetchNextPage: 分类已切换，丢弃预取结果');
        return;
      }
      const songs = this._normalizeSongs(result.list || []);
      if (!songs || songs.length === 0) {
        this._setDoneState(true, container);
        this._prefetchedSongs = null;
      } else {
        const done = songs.length < this.size;
        this._prefetchedSongs = { songs, done, token };
        this._setDoneState(done, container);
      }
    } catch (error) {
      this._handleError('预取下一页失败', error, false);
      this._prefetchedSongs = null;
    } finally {
      this._prefetching = false;
    }
  }

  /**
   * 渲染顶部筛选标签
   * 作用：在模态框顶部显示当前分类名称（如"DISCO"、"说唱"等）
   * @param {string} text - 要显示的文本（默认"派对音乐"）
   * 调用时机：loadCategorySongs后，更新分类名称显示
   */
  renderFilterTags(text) {
    const filterTagsContainer = this.modal?.querySelector('#filter-tags-container');
    if (!filterTagsContainer) return;

    // 使用基类的公共方法清空容器
    this._clearContainer(filterTagsContainer);

    const prompt = document.createElement('div');
    prompt.className = 'w-full text-center font-semibold text-gray-800 dark:text-gray-100 filter-tags-prompt';
    prompt.textContent = text || '派对音乐';

    filterTagsContainer.appendChild(prompt);
    filterTagsContainer.classList.remove('hidden');
  }

  /**
   * 更新所有歌曲卡片的UI状态
   * 作用：遍历所有歌曲卡片，更新其播放状态、已选状态等UI显示
   * @param {boolean} immediate - 是否立即更新（true=立即，false=防抖延迟30ms）
   * 调用时机：歌曲列表渲染后、播放状态变化时、已选列表同步时
   */
  async updateAllSongCardsUI(immediate = false) {
    this._log('debug', '[PartyUI] updateAllSongCardsUI 被调用', { immediate });
    const container = sharedModalManager.getContainer();
    if (!container) {
      this._log('warn', '[PartyUI] updateAllSongCardsUI: 容器不存在');
      return;
    }
    if (!updateSongCardUI) {
      this._log('warn', '[PartyUI] updateAllSongCardsUI: updateSongCardUI 函数不存在');
      return;
    }

    // 确保服务已初始化
    if (!this.songService) {
      await this.initServices();
    }

    // 优化：如果immediate为true，立即更新，不使用防抖（用于点播等需要即时反馈的操作）
    if (immediate) {
      requestAnimationFrame(() => {
        this._updateCardsImmediate(container);
      });
      return;
    }

    // 性能优化：使用防抖避免频繁调用（批量更新时使用）
    if (this._updateCardsTimer) {
      clearTimeout(this._updateCardsTimer);
    }

    this._updateCardsTimer = setTimeout(() => {
      // 使用requestAnimationFrame确保在下一帧更新，避免与当前DOM操作冲突
      requestAnimationFrame(() => {
        this._updateCardsImmediate(container);
      });
    }, CARD_UPDATE_DEBOUNCE);
  }

  updateSongCardsByIds(songIds = []) {
    if (!updateSongCardUI || !Array.isArray(songIds) || songIds.length === 0) {
      return;
    }

    const container = sharedModalManager.getContainer();
    if (!container) {
      return;
    }

    const uniqueSongIds = [...new Set(songIds.map(id => String(id)).filter(Boolean))];
    uniqueSongIds.forEach(songId => {
      updateSongCardUI(this, songId, container);
    });
  }

  /**
   * 立即更新所有卡片UI（内部方法）
   * 作用：查询所有卡片，根据数量选择不同的更新策略（同步/分批），更新卡片状态
   * @param {HTMLElement} container - 容器元素
   * 调用时机：updateAllSongCardsUI中，防抖时间到或immediate=true时
   */
  _updateCardsImmediate(container) {
    if (!updateSongCardUI) {
      this._log('warn', '[PartyUI] _updateCardsImmediate: updateSongCardUI 函数不存在');
      return;
    }

    // 性能优化：一次性查询所有卡片，避免重复查询
    const cards = container.querySelectorAll('.song-card[data-song-id]');
    if (cards.length === 0) {
      this._log('debug', '[PartyUI] _updateCardsImmediate: 没有找到歌曲卡片');
      return;
    }

    this._log('debug', `[PartyUI] _updateCardsImmediate: 找到 ${cards.length} 张卡片，开始更新`);

    // 性能优化：使用 Map 存储卡片元素，减少DOM查询
    const cardsToUpdate = [];
    cards.forEach(card => {
      const songId = card.dataset.songId;
      if (songId) {
        cardsToUpdate.push(songId);
      }
    });

    // 批量更新所有卡片（性能优化：分批更新避免阻塞主线程）
    if (cardsToUpdate.length === 0) {
      return;
    }

    this._log('debug', `[PartyUI] _updateCardsImmediate: 准备更新 ${cardsToUpdate.length} 张卡片`);

    // 性能优化：根据卡片数量动态调整批次大小和更新策略
    // 少量卡片（<30）：立即同步更新
    // 中等数量（30-100）：每批20个，使用 requestAnimationFrame
    // 大量（>100）：每批15个，使用 requestIdleCallback 或 setTimeout
    const total = cardsToUpdate.length;
    let batchSize, useIdle;

    if (total < 30) {
      // 少量卡片：立即更新
      cardsToUpdate.forEach(id => {
        updateSongCardUI(this, id);
      });
      this._log('debug', `[PartyUI] _updateCardsImmediate: 所有 ${total} 张卡片更新完成`);
      return;
    } else if (total < 100) {
      batchSize = 20;
      useIdle = false;
    } else {
      batchSize = 15;
      useIdle = true; // 大量卡片时使用 requestIdleCallback
    }

    let index = 0;
    const updateBatch = () => {
      const endIndex = Math.min(index + batchSize, total);
      const batch = cardsToUpdate.slice(index, endIndex);

      // 批量更新当前批次的所有卡片
      batch.forEach(id => {
        updateSongCardUI(this, id);
      });

      index = endIndex;

      if (index < total) {
        // 继续更新下一批
        if (useIdle && 'requestIdleCallback' in window) {
          requestIdleCallback(updateBatch, { timeout: 100 });
        } else {
          requestAnimationFrame(updateBatch);
        }
      } else {
        this._log('debug', `[PartyUI] _updateCardsImmediate: 所有 ${total} 张卡片更新完成`);
      }
    };

    // 启动批量更新
    if (useIdle && 'requestIdleCallback' in window) {
      requestIdleCallback(updateBatch, { timeout: 100 });
    } else {
      requestAnimationFrame(updateBatch);
    }
  }

  /**
   * 准备模态框（关闭其他模态框、初始化）
   * 作用：关闭点歌模态框、初始化派对模态框、设置模式
   * 调用时机：showPartyModal中
   */
  async _prepareModal() {
    if (window.songTopUI && window.songTopUI.modal && !window.songTopUI.modal.classList.contains('hidden') && !window.songTopUI._isClosing) {
      try {
        await Promise.race([
          window.songTopUI.closeTopModal(true),
          new Promise((resolve) => setTimeout(resolve, 500))
        ]);
      } catch (err) {
        this._log('warn', '关闭点歌模态框时出错，继续打开派对页面', err);
      }
    }

    hideAllButtons();

    // 如果模态框不存在，先初始化
    if (!this.modal) {
      this.initPartyModal();
      if (!this.modal) {
        this._log('error', '初始化模态框失败');
        this._isOpening = false;
        throw new Error('初始化模态框失败');
      }
    }

    // 重置关闭状态
    this._isClosing = false;

    sharedModalManager.setCurrentMode('party', this);
    this.modal = sharedModalManager.getOrCreateModal();

    // 确保搜索图标类型正确
    sharedModalManager.setSearchIconType('svg');

    // 确保分类按钮存在
    const activeCategoryId = this.selectedCategoryId || this.filterParams?.categoryCode || DEFAULT_CATEGORY_ID;
    this._ensureCategoryButtonsExist(activeCategoryId);
  }

  /**
   * 显示模态框（DOM操作、样式设置）
   * 作用：设置模态框样式、显示模态框、绑定事件
   * 调用时机：showPartyModal中，准备完成后
   */
  _displayModal() {
    // 性能优化：缓存 content 元素，避免重复查询
    const content = this._cachedContent || (this._cachedContent = this.modal.firstElementChild);
    if (content) {
      // 性能优化：使用工具函数批量操作类，减少重排
      resetModalClasses(content);

      // 性能优化：使用工具函数批量设置样式，减少重排
      setHardwareAcceleration(content);
    }

    // 立即显示模态框，减少延迟
    this.modal.classList.remove('opacity-0');
    this.modal.classList.add(MODAL_ANIMATION_CLASSES.VISIBLE);

    // 性能优化：立即执行关键操作，减少requestAnimationFrame嵌套
    // 绑定所有事件（包括新创建的按钮和搜索框等）
    this.bindEvents();

    // 使用 requestAnimationFrame 确保动画在下一帧触发（性能优化）
    if (content) {
      requestAnimationFrame(() => {
        // 添加过渡类，触发打开动画
        content.classList.add(MODAL_ANIMATION_CLASSES.SLIDE_TRANSITION);
      });
    }

    this._log('debug', '派对页面已打开');
  }

  /**
   * 初始化模态框（服务初始化、事件绑定）
   * 作用：初始化服务、绑定状态同步事件、设置容器样式
   * 调用时机：showPartyModal中，显示模态框后
   */
  _initializeModal() {
    // 性能优化：异步初始化服务（不阻塞显示）
    this.initServices().catch(err => {
      this._log('warn', '初始化服务失败', err);
    });

    // 使用基类的公共方法绑定状态同步事件
    this._bindStateSyncEvents();

    // PartyUI 特定的日志（基类方法已处理事件绑定）
      this._log('debug', '[PartyUI] 歌曲同步监听器已绑定');
    this._log('info', '[PartyUI] playlistCleared 事件监听器已绑定');

    // 确保内容容器存在且可见
    const container = sharedModalManager.getContainer();
    if (container) {
      // 立即重置滚动位置到顶部
      container.scrollTop = 0;

      // 确保滚动容器样式正确（关键：必须在其他样式设置之前调用）
      this.ensureScrollContainerStyles(container);

      // 确保没有隐藏类被应用
      container.classList.remove('hidden');

      if (container.dataset.loading !== 'true') {
        this._setLoadingState(false, container);
        this._setDoneState(false, container);

        // 如果没有currentMode，设置默认模式为 'category'
        if (!this.currentMode) {
          this.currentMode = 'category';
        }
      }
    }
  }

  /**
   * 加载初始数据（触发默认分类加载）
   * 作用：触发默认分类按钮点击，加载初始歌曲列表
   * 调用时机：showPartyModal中，初始化完成后
   */
  async _loadInitialData() {
    // 性能优化：使用单次 requestAnimationFrame，减少延迟累积
    requestAnimationFrame(() => {
      // 更新高度（在模态框完全显示后）
      this.updateModalHeight?.();

      // 性能优化：不等待服务初始化，立即触发分类加载
      // 服务初始化在后台并行进行，不阻塞UI显示
      const loadCategoryData = async () => {
        try {
          // 优先从全局获取服务（最快）
          if (!this.songService && typeof window !== 'undefined' && window.songService) {
            this.songService = window.songService;
          }

          // 如果全局没有，尝试初始化（不阻塞）
          if (!this.songService) {
            this.initServices().catch(() => { }); // 后台初始化，不等待
          }

          // 根据当前筛选状态触发一次分类加载
          // 优化：缓存DOM查询结果
          const middleContentEl = sharedModalManager.getMiddleContentElement();
          if (!middleContentEl) {
            this._log('warn', '未找到中间内容元素，无法自动加载');
            this._isOpening = false;
            return;
          }

          const targetCategoryId = String(this.filterParams?.categoryCode || this.selectedCategoryId || DEFAULT_CATEGORY_ID);
          // 使用 data-category-id 属性选择器（更准确）
          let targetBtn = middleContentEl.querySelector(`.party-category-btn[data-category-id="${targetCategoryId}"]`);
          // 如果找不到指定分类，使用第一个按钮作为兜底
          if (!targetBtn) {
            targetBtn = middleContentEl.querySelector('.party-category-btn');
          }

          if (targetBtn) {
            this._log('info', `[派对] 打开时自动加载默认分类: categoryId=${targetCategoryId}`);
            if (typeof console !== 'undefined' && console.warn) console.warn('[派对] 打开时自动加载默认分类 categoryId=', targetCategoryId);

            // 1. 更新按钮视觉状态
            this._updateCategoryButtonState(targetCategoryId);

            // 2. 直接发起数据加载（绕过事件绑定不确定性）
            // 注意：loadCategorySongs内部会处理服务初始化检查
            try {
              await this.loadCategorySongs(targetCategoryId);
              this._log('info', '自动加载分类完成');
            } catch (loadErr) {
              this._log('error', '自动加载分类失败，尝试回退到点击', loadErr);
              // 3. 如果直接加载失败，才尝试模拟点击作为兜底
              try {
                targetBtn.click();
              } catch (clickErr) {
                this._log('warn', '模拟点击也失败', clickErr);
              }
            }
          } else {
            this._log('warn', '未找到分类按钮，无法自动加载');
          }

          // 标记打开完成
          this._isOpening = false;
        } catch (err) {
          this._log('error', '打开派对页面时出错', err);
          this._isOpening = false;
        }
      };

      // 立即开始加载，不等待
      loadCategoryData();
    });
  }

  /**
   * 打开派对模态框
   * 作用：关闭点歌模态框（如果打开）、初始化模态框、绑定事件、显示模态框、触发默认分类加载
   * 注意：有防重复打开机制，如果正在打开或已打开则直接返回
   * 调用时机：用户点击"派对"按钮时
   */
  async showPartyModal() {
    // 防止重复打开
    if (this._isOpening) {
      this._log('warn', '派对页面正在打开中，忽略重复请求');
      return;
    }

    // 如果已经在显示，直接返回
    if (this.modal && !this.modal.classList.contains('hidden') && !this._isClosing) {
      this._log('debug', '派对页面已经打开');
      return;
    }

    this._isOpening = true;

    try {
      await this._prepareModal();
      this._displayModal();
      this._initializeModal();
      await this._loadInitialData();
    } catch (err) {
      this._log('error', 'showPartyModal failed', err);
      this._handleError('打开派对页面失败', err);
      this._isOpening = false;
    }
  }

  /**
   * 关闭派对模态框 (极简版)
   * 直接隐藏DOM，不使用任何动画，防止卡死
   * @param {boolean} keepDomVisible - 是否保持DOM显示（用于在不同模式间切换）
   * @returns {Promise} 关闭完成的Promise
   */
  closePartyModal(keepDomVisible = false) {
    try {
      this.cleanupEventListeners();
    } catch (e) {
      this._log('warn', 'closePartyModal cleanup error', e);
    }

    // 2. 重置状态
    this._isOpening = false;
    this._isClosing = false;

    // 3. 处理 DOM 显示/隐藏
    if (!this.modal) {
      return Promise.resolve();
    }

    if (keepDomVisible) {
      // 切换模式：保持 modal 显示
      return Promise.resolve();
    }

    // 4. 关闭模态框（移除 song-modal-visible 才能触发 CSS display:none）
    this.modal.classList.add('hidden');
    this.modal.classList.remove('opacity-0', MODAL_ANIMATION_CLASSES.CLOSING, MODAL_ANIMATION_CLASSES.CLOSING_ACTIVE, MODAL_ANIMATION_CLASSES.VISIBLE);

    showAllButtons();

    return Promise.resolve();
  }

  // _clearGridAsync 方法已提取到 BaseSongUI 基类

  // updateModalHeight 方法已提取到 BaseSongUI 基类

  /**
   * 清理所有事件监听器和资源
   * 作用：解绑所有事件、清理定时器、重置预取状态、清理容器状态、重置标记
   * 调用时机：closePartyModal中、_performModalCleanup的回调中
   */
  cleanupEventListeners() {
    // 解绑所有事件监听器
    if (this.unbindEvents && typeof this.unbindEvents === 'function') {
      try {
        this.unbindEvents();
      } catch (e) {
        this._log('warn', '解绑事件失败', e);
      }
    }

    // 清理防抖定时器（如果还未清理）
    if (this._updateCardsTimer) {
      try {
        clearTimeout(this._updateCardsTimer);
      } catch (e) {
        // 忽略清理错误
      }
      this._updateCardsTimer = null;
    }

    // 清理预取相关状态（确保完全清理）
    this._prefetchedSongs = null;
    this._prefetching = false;
    if (this._prefetchToken !== undefined) {
      this._prefetchToken = 0;
    }
    this._skipNextPrefetch = false;

    // 解绑无限滚动监听器（如果还未清理）
    if (this._scrollDetach && typeof this._scrollDetach === 'function') {
      try {
        this._scrollDetach();
      } catch (error) {
        this._log('warn', '解绑无限滚动失败', error);
      }
      this._scrollDetach = null;
    }

    // 清理搜索框事件处理器（确保完全清理）
    if (this._searchInputHandler?.cleanup) {
      try {
        this._searchInputHandler.cleanup();
      } catch (e) {
        // 忽略清理错误
      }
      this._searchInputHandler = null;
    }

    // 使用基类的公共方法清理状态同步事件监听器（确保完全清理）
    this._unbindStateSyncEvents();

    // 清理容器状态
    const container = sharedModalManager.getContainer();
    if (container) {
      container.dataset.loading = 'false';
      container.dataset.done = 'false';
      delete container.dataset.autoFillRunning;
    }

    // 重置事件绑定标记
    this._eventsBound = false;
  }

  /**
   * 确保滚动容器样式正确
   * 作用：移除flex-1类，添加unified-scroll-container类，确保滚动行为正确
   * @param {HTMLElement} container - 滚动容器
   * 调用时机：showPartyModal中，显示模态框时
   */
  ensureScrollContainerStyles(container) {
    if (!container) return;
    container.classList.remove('flex-1');
    container.classList.add('unified-scroll-container');
  }

  /**
   * 绑定播放事件
   * 作用：为歌曲卡片绑定播放按钮点击事件，调用公共模块处理播放逻辑
   * @param {HTMLElement} songCard - 歌曲卡片元素
   * @param {Object} song - 歌曲对象
   * 调用时机：创建歌曲卡片时，由SongCardFactory内部调用
   */
  bindPlayEvent(songCard, song) {
    return bindPlayEvent(this, songCard, song);
  }

  /**
   * 处理添加按钮点击
   * 作用：处理歌曲添加到已选列表的逻辑，调用公共模块统一处理
   * @param {Object} song - 歌曲对象
   * @param {HTMLElement} addBtn - 添加按钮元素
   * 调用时机：用户点击歌曲卡片的添加按钮时
   */
  async handleAddBtnClick(song, addBtn) {
    return handleAddBtnClick(this, song, addBtn);
  }

}

const partyUI = new PartyUI();
window.partyUI = partyUI;
export default partyUI;

