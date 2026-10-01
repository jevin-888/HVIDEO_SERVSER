/**
 * 全局共享模态框管理器
 * 管理点歌和派对页面共享的单一模态框实例
 */
import { ResourcePool } from '../../utils/PerformanceUtils.js';

// 统一的ID常量
export const UNIFIED_MODAL_ID = 'unified-modal';
export const UNIFIED_SEARCH_INPUT_ID = 'unified-search-input';
export const UNIFIED_CONTAINER_ID = 'unified-songs-container';
export const UNIFIED_CLOSE_BTN_ID = 'unified-close-btn';
export const UNIFIED_MIDDLE_CONTENT_ID = 'unified-middle-content';

// 创建DOM元素资源池
const elementPool = new ResourcePool(
  () => document.createElement('div'),
  (element) => {
    // 重置元素状态
    element.className = '';
    element.id = '';
    element.innerHTML = '';
    // 移除所有事件监听器
    element.replaceWith(element.cloneNode(false));
  }
);

export const SEARCH_PLACEHOLDERS = {
  none: '请输入首字母或歌名搜索歌曲',
  id: 'Masukkan huruf pertama atau nama lagu',
  en: 'Enter initials or song name to search',
  vi: 'Nhập chữ cái đầu hoặc tên bài hát',
  // YouTube 专用占位符
  youtube: {
    none: '输入歌名或歌星搜索YouTube歌曲资源',
    id: 'Masukkan nama lagu atau penyanyi untuk mencari YouTube...',
    en: 'Enter song name or singer to search YouTube...',
    vi: 'Nhập tên bài hát hoặc ca sĩ để tìm kiếm trên YouTube...'
  }
};

class SharedModalManager {
  constructor() {
    this.modal = null;
    this.currentMode = null; // 'song' | 'party' | null
    this.currentUI = null; // 当前使用的UI实例
    this._searchIconType = 'fontawesome'; // 'fontawesome' | 'svg'
    // 性能优化：缓存DOM查询结果
    this._cachedElements = {
      middleContent: null,
      searchInput: null,
      closeBtn: null,
      container: null
    };

    this._langToggleHandler = (e) => {
      const lang = e?.detail?.lang || 'none';
      const input = this.getSearchInput();
      if (input) {
        if (this.currentMode === 'youtube') {
          input.placeholder = SEARCH_PLACEHOLDERS.youtube[lang] || SEARCH_PLACEHOLDERS.youtube.none;
        } else {
          input.placeholder = SEARCH_PLACEHOLDERS[lang] || SEARCH_PLACEHOLDERS.none;
        }
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('languageToggled', this._langToggleHandler);
    }
  }

  _getCurrentPlaceholder() {
    const lang = (typeof localStorage !== 'undefined' && localStorage.getItem('subtitleLang')) || 'none';
    return SEARCH_PLACEHOLDERS[lang] || SEARCH_PLACEHOLDERS.none;
  }

  /**
   * 获取或创建共享模态框
   */
  getOrCreateModal() {
    // 如果模态框已存在，确保它仍然在DOM中
    if (this.modal) {
      if (!document.body.contains(this.modal)) {
        document.body.appendChild(this.modal);
      }
      return this.modal;
    }

    // 检查DOM中是否已存在
    let existingModal = document.getElementById(UNIFIED_MODAL_ID);
    if (existingModal) {
      this.modal = existingModal;
      return this.modal;
    }

    // 从资源池获取元素或创建新元素
    this.modal = elementPool.acquire() || document.createElement('div');
    this.modal.id = UNIFIED_MODAL_ID;
    // 移除原来的fixed定位类，使用CSS控制定位
    this.modal.className = 'hidden opacity-0 transition-opacity duration-300 unified-modal';
    this.modal.innerHTML = this.generateModalHTML();
    
    document.body.appendChild(this.modal);
    
    return this.modal;
  }

  /**
   * 重置模态框引用（在外部手动从DOM移除后调用）
   */
  resetModal() {
    if (this.modal) {
      // 将元素返回到资源池
      elementPool.release(this.modal);
    }
    this.modal = null;
    // 清除缓存
    this._clearCache();
  }

  /**
   * 生成统一的模态框HTML结构
   */
  generateModalHTML() {
    // 搜索图标：默认使用FontAwesome，可通过setSearchIconType切换
    // 样式已移到CSS中，不再使用内联样式
    const searchIcon = this._searchIconType === 'svg'
      ? `<svg id="unified-search-icon" class="unified-search-icon w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
        </svg>`
      : `<i class="fas fa-search unified-search-icon"></i>`;
    
    // 关闭按钮图标
    const closeButtonIcon = this._searchIconType === 'svg'
      ? `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
        </svg>`
      : `<i class="fas fa-times text-lg"></i>`;
    
    return `
      <div class="relative w-full rounded-lg shadow-xl flex flex-col song-top-modal-container unified-modal-container">
        <style>
          .hide-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .hide-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
        </style>
        <div class="w-full mx-auto px-4 sm:px-8">
          <div class="py-2">
            <div id="filter-tags-container" class="hidden flex justify-center items-center gap-2 mb-2"></div>
            <div class="relative">
              <div class="flex items-center gap-4">
                <div class="relative flex-1 min-w-0">
                  ${searchIcon}
                  <input id="${UNIFIED_SEARCH_INPUT_ID}" type="text" placeholder="${this._getCurrentPlaceholder()}" autocomplete="off" class="block w-full rounded-xl border border-gray-300 dark:border-gray-700 shadow-sm focus:outline-none focus:border-blue-500 unified-search-input" />
                  <button id="${UNIFIED_CLOSE_BTN_ID}" class="close-btn absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400" title="清空" aria-label="清空搜索">
                    ${closeButtonIcon}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div id="${UNIFIED_MIDDLE_CONTENT_ID}"></div>
        </div>
        <div id="${UNIFIED_CONTAINER_ID}" class="pt-0 overflow-y-auto flex-1 px-4 sm:px-8" data-scrollable="true"></div>
      </div>
    `;
  }

  /**
   * 设置搜索图标类型
   */
  setSearchIconType(type) {
    this._searchIconType = type;
    // 如果模态框已创建，需要更新图标
    if (this.modal) {
      const searchIconContainer = this.modal.querySelector('#unified-search-icon')?.parentElement || 
                                  this.modal.querySelector('.fa-search')?.parentElement;
      if (searchIconContainer) {
        const searchIcon = type === 'svg'
          ? `<svg id="unified-search-icon" class="unified-search-icon w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>`
          : `<i class="fas fa-search unified-search-icon"></i>`;
        
        const oldIcon = this.modal.querySelector('#unified-search-icon') || this.modal.querySelector('.fa-search');
        if (oldIcon) {
          oldIcon.outerHTML = searchIcon;
        }
      }

      // 更新关闭按钮图标
      const closeBtn = this.modal.querySelector(`#${UNIFIED_CLOSE_BTN_ID}`);
      if (closeBtn) {
        closeBtn.innerHTML = type === 'svg'
          ? `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
            </svg>`
          : `<i class="fas fa-times text-lg"></i>`;
      }
    }
  }

  /**
   * 切换中间内容区域
   * @param {string} html - 中间内容的HTML
   */
  setMiddleContent(html) {
    const middleContentEl = this.getMiddleContentElement();
    if (middleContentEl) {
      middleContentEl.innerHTML = html || '';
    }
  }

  /**
   * 获取中间内容元素
   */
  getMiddleContentElement() {
    if (!this.modal) return null;
    // 验证缓存有效性
    this._validateCache();
    if (!this._cachedElements.middleContent) {
      this._cachedElements.middleContent = this.modal.querySelector(`#${UNIFIED_MIDDLE_CONTENT_ID}`);
    }
    return this._cachedElements.middleContent;
  }

  /**
   * 获取搜索框元素
   */
  getSearchInput() {
    if (!this.modal) return null;
    // 验证缓存有效性
    this._validateCache();
    if (!this._cachedElements.searchInput) {
      this._cachedElements.searchInput = this.modal.querySelector(`#${UNIFIED_SEARCH_INPUT_ID}`);
    }
    return this._cachedElements.searchInput;
  }

  /**
   * 获取关闭按钮元素
   */
  getCloseBtn() {
    if (!this.modal) return null;
    // 验证缓存有效性
    this._validateCache();
    if (!this._cachedElements.closeBtn) {
      this._cachedElements.closeBtn = this.modal.querySelector(`#${UNIFIED_CLOSE_BTN_ID}`);
    }
    return this._cachedElements.closeBtn;
  }

  /**
   * 获取容器元素
   */
  getContainer() {
    if (!this.modal) return null;
    // 验证缓存有效性
    this._validateCache();
    if (!this._cachedElements.container) {
      this._cachedElements.container = this.modal.querySelector(`#${UNIFIED_CONTAINER_ID}`);
    }
    return this._cachedElements.container;
  }

  /**
   * 设置当前模式和使用者
   */
  setCurrentMode(mode, ui) {
    this.currentMode = mode;
    this.currentUI = ui;
    // 切换模式时清除缓存，因为DOM可能已改变
    this._clearCache();
  }

  /**
   * 清除当前模式
   */
  clearCurrentMode() {
    this.currentMode = null;
    this.currentUI = null;
  }

  /**
   * 获取当前模式
   */
  getCurrentMode() {
    return this.currentMode;
  }

  /**
   * 获取当前UI实例
   */
  getCurrentUI() {
    return this.currentUI;
  }

  /**
   * 清理模态框内容（切换模式时使用）
   */
  clearContent() {
    const container = this.getContainer();
    if (container) {
      container.innerHTML = '';
      container.scrollTop = 0;
      // 清除容器缓存，因为内容已清空
      this._cachedElements.container = null;
    }
    const middleContent = this.getMiddleContentElement();
    if (middleContent) {
      middleContent.innerHTML = '';
      // 清除中间内容缓存
      this._cachedElements.middleContent = null;
    }
    const searchInput = this.getSearchInput();
    if (searchInput) {
      searchInput.value = '';
      // 清除搜索输入缓存
      this._cachedElements.searchInput = null;
    }
    // 强制隐藏和清空共享的顶部过滤标签，防止派对页面残留 "DISCO" 等标题
    if (this.modal) {
      const filterTagsContainer = this.modal.querySelector('#filter-tags-container');
      if (filterTagsContainer) {
        filterTagsContainer.innerHTML = '';
        filterTagsContainer.classList.add('hidden');
      }
    }
    // 清除关闭按钮缓存
    this._cachedElements.closeBtn = null;
  }
  
  /**
   * 验证并清理无效的 DOM 引用缓存
   * 检查缓存的元素是否仍在 DOM 中，如果不在则清除缓存
   */
  _validateCache() {
    // 检查缓存的元素是否仍然有效
    if (this._cachedElements.middleContent && !document.contains(this._cachedElements.middleContent)) {
      this._cachedElements.middleContent = null;
    }
    if (this._cachedElements.searchInput && !document.contains(this._cachedElements.searchInput)) {
      this._cachedElements.searchInput = null;
    }
    if (this._cachedElements.closeBtn && !document.contains(this._cachedElements.closeBtn)) {
      this._cachedElements.closeBtn = null;
    }
    if (this._cachedElements.container && !document.contains(this._cachedElements.container)) {
      this._cachedElements.container = null;
    }
  }
  
  /**
   * 清除所有缓存
   */
  _clearCache() {
    this._cachedElements = {
      middleContent: null,
      searchInput: null,
      closeBtn: null,
      container: null
    };
  }
}

// 创建并导出全局单例，确保在各种版本的动态导入中共享同一个实例
let sharedModalManagerInstance;
if (typeof window !== 'undefined' && window.sharedModalManager) {
  sharedModalManagerInstance = window.sharedModalManager;
} else {
  sharedModalManagerInstance = new SharedModalManager();
  if (typeof window !== 'undefined') {
    window.sharedModalManager = sharedModalManagerInstance;
  }
}
export default sharedModalManagerInstance;