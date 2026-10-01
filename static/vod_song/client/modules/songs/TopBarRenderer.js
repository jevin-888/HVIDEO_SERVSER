// 顶部栏渲染模块：提供筛选标签与歌星筛选的基础渲染
import sharedModalManager, { UNIFIED_CONTAINER_ID } from '../common/SharedModalManager.js';

/**
 * 渲染筛选标签区域
 * @param {object} ui - SongTopUI 实例
 */
export function renderFilterTags(ui) {
  try {
    // 使用共享模态框获取筛选标签容器
    const modal = sharedModalManager.getOrCreateModal();
    const container = modal?.querySelector('#filter-tags-container');
    if (!container) return;
    container.innerHTML = '';

    // 默认提示：根据当前模式显示简洁提示
    const prompt = document.createElement('div');
    prompt.className = 'w-full text-center font-semibold text-gray-800 dark:text-gray-100 filter-tags-prompt';

    // 检查是否是印尼歌曲模式（复用函数）
    const isIndonesianSongs = isIndonesianSongsMode(ui);

    // 统一的标签获取函数（合并重复实现）
    const getLabel = (type, options, code) => {
      if (!code) return '';
      if (typeof ui.getFilterLabel === 'function') {
        return ui.getFilterLabel(type, code, options) || '';
      }
      const option = Array.isArray(options) ? options.find(item => String(item.code ?? item.dictCode ?? item.dictValue ?? '') === String(code)) : null;
      return option ? (option.name ?? option.dictLabel ?? option.dictValue ?? '') : '';
    };

    const selectedLangName = ui.selectedLanguageCode ? getLabel('language', ui._languages, ui.selectedLanguageCode) : '';
    const selectedClsName = ui.selectedCategoryCode ? getLabel('category', ui._classifies, ui.selectedCategoryCode) : '';

    const langService = window.langService;
    const idT = langService?.translations['id_id'] || {};
    const enT = langService?.translations['en_us'] || {};
    const viT = langService?.translations['vi_vn'] || {};

    const multiLangSpan = (zh, id, en, vi) => {
      return `<span class="zh-label">${zh}</span>` +
             `<span class="indonesian-translation">${id}</span>` +
             `<span class="en-translation">${en}</span>` +
             `<span class="vi-translation">${vi}</span>`;
    };

    if (isIndonesianSongs) {
      prompt.innerHTML = multiLangSpan('搜索印尼歌曲', 'Cari Lagu Indonesia', 'Search Indonesian Songs', 'Tìm bài hát Indonesia');
    } else if (ui.currentMode === 'language') {
      if (selectedLangName) {
        prompt.innerHTML = `<span class="zh-label">搜索语种：${selectedLangName}</span>` +
                           `<span class="indonesian-translation">Cari Bahasa: ${selectedLangName}</span>` +
                           `<span class="en-translation">Search Language: ${selectedLangName}</span>` +
                           `<span class="vi-translation">Tìm ngôn ngữ: ${selectedLangName}</span>`;
      } else {
        prompt.innerHTML = multiLangSpan('按语种筛选', 'Filter Bahasa', 'Filter by Language', 'Lọc theo ngôn ngữ');
      }
    } else if (ui.currentMode === 'category') {
      if (selectedClsName) {
        prompt.innerHTML = `<span class="zh-label">搜索分类：${selectedClsName}</span>` +
                           `<span class="indonesian-translation">Cari Kategori: ${selectedClsName}</span>` +
                           `<span class="en-translation">Search Category: ${selectedClsName}</span>` +
                           `<span class="vi-translation">Tìm thể loại: ${selectedClsName}</span>`;
      } else {
        prompt.innerHTML = multiLangSpan('按分类筛选', 'Filter Kategori', 'Filter by Category', 'Lọc theo thể loại');
      }
    } else if (ui.currentMode === 'singer') {
      if (ui.selectedSingerName) {
        prompt.innerHTML = `<span class="zh-label">搜索"${ui.selectedSingerName}"的歌曲</span>` +
                           `<span class="indonesian-translation">Cari lagu "${ui.selectedSingerName}"</span>` +
                           `<span class="en-translation">Search songs of "${ui.selectedSingerName}"</span>` +
                           `<span class="vi-translation">Tìm bài hát của "${ui.selectedSingerName}"</span>`;
      } else if (ui.isShowingSingersList && !ui.filterParams?.primarySingerNo) {
        const parts = [];
        const sexName = getLabel('sex', ui._sexOptions || [], ui.singerFilters?.sex);
        const regionName = getLabel('region', ui._regionOptions || [], ui.singerFilters?.region);
        if (sexName) parts.push(sexName);
        if (regionName) parts.push(regionName);
        if (parts.length > 0) {
          const joined = parts.join(' / ');
          prompt.innerHTML = `<span class="zh-label">歌星筛选：${joined}</span>` +
                             `<span class="indonesian-translation">Filter Penyanyi: ${joined}</span>` +
                             `<span class="en-translation">Singer Filter: ${joined}</span>` +
                             `<span class="vi-translation">Lọc ca sĩ: ${joined}</span>`;
        } else {
          prompt.innerHTML = multiLangSpan('热门歌星', idT['hotSingers'] || 'Penyanyi Populer', enT['hotSingers'] || 'Hot Singers', viT['hotSingers'] || 'Ca sĩ hot');
        }
      } else {
        prompt.innerHTML = multiLangSpan('热门歌星', idT['hotSingers'] || 'Penyanyi Populer', enT['hotSingers'] || 'Hot Singers', viT['hotSingers'] || 'Ca sĩ hot');
      }
    } else if (ui.currentMode === 'search') {
      prompt.innerHTML = multiLangSpan('搜索歌曲', 'Cari Lagu', 'Search Songs', 'Tìm kiếm bài hát');
    } else {
      prompt.innerHTML = multiLangSpan('搜索歌曲', 'Cari Lagu', 'Search Songs', 'Tìm kiếm bài hát');
    }
    container.appendChild(prompt);

    // 不再显示选中标签的胶囊元素，仅保留提示文案

    container.classList.remove('hidden');
  } catch (e) {
    console.warn('[TopBarRenderer] 渲染筛选标签失败:', e);
  }
}

/**
 * 渲染歌星筛选（性别/地区），保持无交互占位
 * @param {object} ui - SongTopUI 实例
 */
export async function renderSingerFilters(ui) {
  try {
    if (typeof ui._renderSingerFilterControls === 'function') {
      await ui._renderSingerFilterControls();
      return true;
    }
  } catch (e) {
    console.warn('[TopBarRenderer] 渲染歌星筛选失败:', e);
  }
  return false;
}

/**
 * 检查是否是印尼歌曲模式
 * @param {object} ui - SongTopUI 实例
 * @returns {boolean}
 */
function isIndonesianSongsMode(ui) {
  return ui.currentMode === 'language' && ui.filterParams?.languageCode &&
    ['id', '6', '10'].includes(String(ui.filterParams.languageCode));
}

/**
 * 处理印尼歌曲按钮点击
 * @param {object} ui - SongTopUI 实例
 */
async function handleIndonesianSongsClick(ui) {
  if (isIndonesianSongsMode(ui)) return;

  try {
    await ui.initServices?.();
    const code = await ui.songService?.getIndonesianLanguageCode?.();

    const container = sharedModalManager.getContainer();
    if (container) {
      const { showLoadingIndicator } = await import('../../utils/InfiniteScroll.js');
      showLoadingIndicator(container);
    }

    ui.setMode?.('language', { languageCode: code }, true);

    if (container) {
      await ui.loadSongs?.(container, 1);
      const { hideLoadingIndicator } = await import('../../utils/InfiniteScroll.js');
      hideLoadingIndicator(container);
    }
  } catch (error) {
    console.error('[TopBarRenderer] 设置印尼歌曲模式失败，使用默认值:', error);

    const container = sharedModalManager.getContainer();
    if (container) {
      const { showLoadingIndicator } = await import('../../utils/InfiniteScroll.js');
      showLoadingIndicator(container);
    }

    ui.setMode?.('language', { languageCode: '10' }, true);

    if (container) {
      await ui.loadSongs?.(container, 1);
      const { hideLoadingIndicator } = await import('../../utils/InfiniteScroll.js');
      hideLoadingIndicator(container);
    }
  }
}

/**
 * 处理筛选按钮点击（语种/分类）
 * @param {object} ui - SongTopUI 实例
 * @param {string} type - 'language' 或 'category'
 */
function handleFilterButtonClick(ui, type) {
  if (typeof ui?.activateQuickFilter === 'function') {
    ui.activateQuickFilter(type);
    return;
  }
  if (typeof ui.openFilterDialog === 'function') {
    ui.openFilterDialog(type);
  } else {
    if (ui.currentMode === type) return;
    ui.setMode?.(type, {});
  }
}

/**
 * 按钮操作映射表
 * 使用 action 或 id 作为键，映射到对应的处理函数
 */
const BUTTON_ACTIONS = {
  // 使用 data-action 作为键
  'singers': (ui) => {
    if (ui.currentMode === 'singer' && ui.isShowingSingersList) return;
    ui.handleSingerButtonClick?.();
  },
  'songname': (ui) => {
    if (ui.currentMode === 'top') return;
    const container = sharedModalManager.getContainer();
    if (container) {
      container.scrollTop = 0;
      delete container.dataset._restoringScroll;
      delete container.dataset._updatingHeight;
      container.innerHTML = '';
    }
    ui.setMode?.('top', {});
    if (container) {
      ui.loadSongs?.(container, 1);
    }
  },
  'language': (ui) => handleFilterButtonClick(ui, 'language'),
  'category': (ui) => handleFilterButtonClick(ui, 'category'),
  'indonesian': (ui) => handleIndonesianSongsClick(ui),
  // 使用 id 作为键（作为备用）
  'top-singers-more-btn': (ui) => {
    if (ui.currentMode === 'singer' && ui.isShowingSingersList) return;
    ui.handleSingerButtonClick?.();
  },
  'songname-selector': (ui) => {
    if (ui.currentMode === 'top') return;
    const container = sharedModalManager.getContainer();
    if (container) {
      container.scrollTop = 0;
      delete container.dataset._restoringScroll;
      delete container.dataset._updatingHeight;
      container.innerHTML = '';
    }
    ui.setMode?.('top', {});
    if (container) {
      ui.loadSongs?.(container, 1);
    }
  },
  'language-selector': (ui) => handleFilterButtonClick(ui, 'language'),
  'category-selector': (ui) => handleFilterButtonClick(ui, 'category'),
  'indonesian-songs-btn': (ui) => handleIndonesianSongsClick(ui),
};

/**
 * 处理按钮点击的核心逻辑
 * @param {object} ui - SongTopUI 实例
 * @param {string} action - 按钮的 action 类型
 * @param {string} id - 按钮的 id
 */
function handleButtonAction(ui, action, id) {
  // 优先使用 action，如果不存在则使用 id
  const handler = BUTTON_ACTIONS[action] || BUTTON_ACTIONS[id];

  if (handler) {
    handler(ui);
  } else {
    console.warn('[TopBarRenderer] 未知的按钮操作:', { action, id });
  }
}

/**
 * 绑定顶部筛选与按钮交互（歌星/歌名/语种/分类/印尼歌曲）
 * 使用事件委托机制，确保即使按钮被动态替换，事件仍然有效
 * 
 * @param {object} ui - SongTopUI 实例
 */
export function bindTopBarInteractions(ui) {
  // 参数验证
  if (!ui?.modal) {
    console.warn('[TopBarRenderer] ui.modal 不存在，无法绑定事件');
    return;
  }

  // 获取中间内容区域
  const middleContentEl = sharedModalManager.getMiddleContentElement();
  if (!middleContentEl) {
    console.warn('[TopBarRenderer] 无法找到中间内容区域');
    return;
  }

  // 获取按钮容器（事件委托的目标元素）
  const quickCategories = middleContentEl.querySelector('#quick-categories');
  if (!quickCategories) {
    console.warn('[TopBarRenderer] 无法找到 quick-categories 容器');
    return;
  }

  // 移除旧的事件监听器（如果存在）
  if (quickCategories._delegatedClickHandler) {
    quickCategories.removeEventListener('click', quickCategories._delegatedClickHandler, true);
  }

  // 创建事件委托处理函数
  const delegatedClickHandler = (e) => {
    // 找到实际点击的按钮元素
    const button = e.target.closest('button.song-top-filter-btn') ||
      e.target.closest('button[data-action]');

    if (!button) {
      return; // 点击的不是按钮，忽略
    }

    // 获取按钮标识（优先使用 data-action，其次使用 id）
    const action = button.dataset.action || button.id;
    if (!action) {
      return; // 按钮没有标识，忽略
    }

    // 阻止事件冒泡和默认行为
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // 执行对应的操作
    const id = button.id || action;
    handleButtonAction(ui, action, id);
  };

  // 保存引用并绑定事件（同时支持点击和触摸）
  quickCategories._delegatedClickHandler = delegatedClickHandler;
  quickCategories.addEventListener('click', delegatedClickHandler, { capture: true, passive: false });
}
