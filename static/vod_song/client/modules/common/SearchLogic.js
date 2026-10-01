import sharedModalManager from './SharedModalManager.js';
import { logInfo, logWarn, logError } from '../../utils/Logger.js';
import { buildSearchParams } from '../../utils/SearchParamsBuilder.js';

let searchSongsCallCount = 0;

export async function searchSongs(config) {
  const callId = ++searchSongsCallCount;
  
  const { ui, keyword, baseFilterParams = {}, onSuccess, onError } = config;

  if (!ui || !ui.songService) {
    return [];
  }

  const container = sharedModalManager.getContainer();
  if (!container) {
    return [];
  }

  try {
    await ui.initServices?.();

    const trimmedKeyword = (keyword || '').trim();

    // 构建搜索参数，使用统一的工具函数
    const searchParams = buildSearchParams({
      keyword: trimmedKeyword,
      baseFilterParams,
      page: 1,
      pageSize: ui.size || 20
    });

    if (!trimmedKeyword && Object.keys(searchParams).length === 0) {

      return [];
    }

    const previousMode = ui.currentMode;

    if (previousMode !== 'search') {
      ui.lastMode = previousMode;
    }
    ui.currentMode = 'search';
    ui.filterParams = searchParams;
    ui.page = 1;

    const requestStart = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

    // 使用 search 模式加载数据（会先检查缓存，缓存没有才请求API）
    const result = await ui.songService.loadSongsByMode('search', searchParams, 1, ui.size || 20);
    const requestEnd = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const duration = Math.round((requestEnd - requestStart) * 1000) / 1000;

    const songs = ui.songService.normalizeSongs(result.list || []);
    logInfo('SearchLogic', `searchSongs #${callId} - 数据标准化完成`, {
      songCount: songs?.length || 0,
      normalizedSample: songs?.slice?.(0, 5)
    });

    // 性能优化：批量清除错误提示元素，使用一次性查询和过滤
    if (container) {
      // 性能优化：批量清除错误提示元素
      const errorElements = container.querySelectorAll('.text-center.text-red-500');
      if (errorElements.length > 0) {
        const errorTexts = ['加载失败', '请稍后重试'];
        // 性能优化：使用for循环替代forEach和Array.from
        const errorElementsLength = errorElements.length;
        for (let i = 0; i < errorElementsLength; i++) {
          const el = errorElements[i];
          const text = el.textContent;
          // 性能优化：使用简单的字符串检查替代some
          if (text.includes('加载失败') || text.includes('请稍后重试')) {
            el.remove();
          }
        }
      }
    }
    
    // 渲染歌曲列表：优先使用 renderer.renderSongs，如果没有则使用 ui.renderSongs
    if (ui.renderer?.renderSongs) {
      await ui.renderer.renderSongs(ui, songs, container, 1);
    } else if (typeof ui.renderSongs === 'function') {
      // 派对页面等直接有 renderSongs 方法的 UI
      await ui.renderSongs(songs, container);
    } else {

    }

    if (typeof onSuccess === 'function') {
      onSuccess(songs);
    }

    return songs;

  } catch (error) {
    logError('SearchLogic', `searchSongs #${callId} - 搜索流程异常`, {
      keyword,
      error: error?.stack || error?.message || error
    });
    if (typeof onError === 'function') {
      onError(error);
    }
    return [];
  }
}

export async function clearSearch(config) {
  const { ui, onClear } = config;
  if (!ui || typeof onClear !== 'function') return;
    try {
      await onClear();
    } catch (error) {
    logError('[SearchLogic] 清空搜索失败:', error);
  }
}
