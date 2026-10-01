// 渲染器模块：集中处理热门歌曲与歌星的渲染与交互 UI
import { showNoMoreDataIndicator, hideNoMoreDataIndicator } from '../../utils/InfiniteScroll.js';

function getGridTailIndicator(grid) {
  if (!grid) return null;
  return grid.querySelector('.infinite-loading-indicator, .infinite-no-more-indicator');
}

function appendToGridBeforeIndicator(grid, node) {
  if (!grid || !node) return;
  const indicator = getGridTailIndicator(grid);
  if (indicator) {
    grid.insertBefore(node, indicator);
  } else {
    grid.appendChild(node);
  }
}

export async function renderSongs(ui, songs, container, page) {
  let targetGrid = container.querySelector('.grid');
  if (!targetGrid) {
    targetGrid = document.createElement('div');
    targetGrid.className = 'grid grid-cols-1 gap-2 virtual-grid';
    container.appendChild(targetGrid);
  }
  // 首页每次必须清空网格：派对/点歌共模态时若仅复用旧 .song-card 节点，不会重跑 createSongCard，
  // 按钮仍保留上一次的「已选」外观，造成「没点歌却显示已选」。
  if (page === 1) {
    targetGrid.innerHTML = '';
    delete targetGrid.dataset.virtualized;
  }
  targetGrid.dataset.contentType = 'song';
  
  // 切换筛选或重新加载时，先移除"没有更多歌曲"提示
  if (typeof hideNoMoreDataIndicator === 'function') {
    hideNoMoreDataIndicator(container);
  }
  
  if (!Array.isArray(songs) || songs.length === 0) {
    if (page === 1) {
      targetGrid.innerHTML = '';
      if (typeof showNoMoreDataIndicator === 'function') {
        showNoMoreDataIndicator(container, targetGrid, '没有更多歌曲了');
      }
    }
    return;
  }

  const normalizeSongId = (song, index) => {
    const id = song?.songNo;
    return id != null ? String(id) : `__idx_${page}_${index}`;
  };

  if (page > 1) {
    const fragment = document.createDocumentFragment();
    // 性能优化：一次性查询所有现有卡片，避免在循环中重复查询
    const existingCardsMap = new Map();
    Array.from(targetGrid.children).forEach(card => {
      const id = card.dataset.songId;
      if (id) {
        existingCardsMap.set(id, card);
      }
    });
    
    songs.forEach((song, index) => {
      const songId = normalizeSongId(song, index);
      // 使用Map查找，避免重复DOM查询
      if (existingCardsMap.has(songId)) {
        return;
      }
      const card = ui.createSongCard(song);
      if (card) {
        card.dataset.songId = songId;
        card.dataset.songHash = JSON.stringify(song || {});
        fragment.appendChild(card);
      }
    });
    if (fragment.childNodes.length > 0) {
      appendToGridBeforeIndicator(targetGrid, fragment);
    }
    enableVirtualization(ui, container, targetGrid);
    return;
  }
  
  const deviceMemory = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : 4;
  const hardwareConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
  const isAndroid = (typeof navigator !== 'undefined') && /Android/i.test(navigator.userAgent || '');
  const isLowEnd = isAndroid && (deviceMemory <= 2 || hardwareConcurrency <= 4);
  const INITIAL_RENDER_COUNT = isLowEnd ? 8 : 15;
  const BATCH_SIZE = isLowEnd ? 8 : 10;
  
  // 性能优化：使用for循环替代forEach和Array.from，减少转换开销
  const existingCards = targetGrid.children;
  const existingMap = new Map();
  const existingCardsLength = existingCards.length;
  for (let i = 0; i < existingCardsLength; i++) {
    const card = existingCards[i];
    const songId = card.dataset.songId;
    if (songId) {
      existingMap.set(songId, card);
    }
  }

  const desiredOrder = [];

  // 性能优化：使用for循环替代forEach，减少函数调用开销
  for (let index = 0; index < songs.length; index++) {
    const song = songs[index];
    const songId = normalizeSongId(song, index);
    const hash = JSON.stringify(song || {});
    const existing = existingMap.get(songId);

    if (existing) {
      existingMap.delete(songId);
      existing.dataset.songId = songId;
      existing.dataset.songHash = existing.dataset.songHash || hash;
      if (existing.dataset.songHash !== hash) {
        const newCard = ui.createSongCard(song);
        if (newCard) {
          newCard.dataset.songId = songId;
          newCard.dataset.songHash = hash;
          existing.replaceWith(newCard);
          desiredOrder.push(newCard);
        } else {
          existing.dataset.songHash = hash;
          desiredOrder.push(existing);
        }
      } else {
        existing.dataset.songHash = hash;
        desiredOrder.push(existing);
      }
    } else {
      const newCard = ui.createSongCard(song);
      if (newCard) {
        newCard.dataset.songId = songId;
        newCard.dataset.songHash = hash;
        desiredOrder.push(newCard);
      }
    }
  }

  // 性能优化：批量移除不需要的卡片，使用for...of替代forEach
  if (existingMap.size > 0) {
    // 性能优化：直接移除，不需要DocumentFragment（因为元素会被移除）
    for (const card of existingMap.values()) {
      card.remove();
    }
  }

  // 性能优化：分批渲染，初始只渲染15个节点
  const initialCards = desiredOrder.slice(0, INITIAL_RENDER_COUNT);
  const remainingCards = desiredOrder.slice(INITIAL_RENDER_COUNT);
  
  // 性能优化：使用for循环替代forEach
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < initialCards.length; i++) {
    const card = initialCards[i];
    if (!card.isConnected) {
      fragment.appendChild(card);
    } else if (card.parentElement !== targetGrid) {
      fragment.appendChild(card);
    }
  }
  
  if (fragment.childNodes.length > 0) {
    appendToGridBeforeIndicator(targetGrid, fragment);
  }
  
  // 延迟渲染剩余卡片，不阻塞UI
  if (remainingCards.length > 0) {
    // 使用 requestIdleCallback 优先，降级到 setTimeout
    const renderRemaining = (startIndex = 0) => {
      const endIndex = Math.min(startIndex + BATCH_SIZE, remainingCards.length);
      const batch = remainingCards.slice(startIndex, endIndex);
      
      // 性能优化：使用for循环替代forEach
      const batchFragment = document.createDocumentFragment();
      for (let i = 0; i < batch.length; i++) {
        const card = batch[i];
        if (!card.isConnected) {
          batchFragment.appendChild(card);
        }
      }
      
      if (batchFragment.childNodes.length > 0) {
        appendToGridBeforeIndicator(targetGrid, batchFragment);
      }
      
      // 继续渲染下一批
      if (endIndex < remainingCards.length) {
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(() => renderRemaining(endIndex), { timeout: 16 });
        } else {
          requestAnimationFrame(() => renderRemaining(endIndex));
        }
      }
    };
    
    // 延迟开始渲染剩余卡片，确保初始渲染完成
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => renderRemaining(0), { timeout: 100 });
    } else {
      setTimeout(() => renderRemaining(0), 50);
    }
  }
  
  // 对于已经在正确位置的卡片，只需要重新排序（如果需要）
  // 性能优化：批量收集需要移动的卡片，减少DOM操作
  if (desiredOrder.some(card => card.isConnected && card.parentElement === targetGrid)) {
    requestAnimationFrame(() => {
      // 性能优化：一次性获取所有子节点，避免重复查询
      const currentChildren = Array.from(targetGrid.children);
      const currentIndexMap = new Map();
      currentChildren.forEach((child, idx) => {
        currentIndexMap.set(child, idx);
      });
      
      // 批量收集需要移动的卡片
      const moves = [];
      desiredOrder.forEach((card, desiredIndex) => {
        if (card.isConnected && card.parentElement === targetGrid) {
          const currentIndex = currentIndexMap.get(card);
          if (currentIndex !== undefined && currentIndex !== desiredIndex) {
            moves.push({ card, desiredIndex, currentIndex });
          }
        }
      });
      
      // 按目标索引排序，从后往前移动，避免索引变化影响
      moves.sort((a, b) => b.desiredIndex - a.desiredIndex);
      
      // 性能优化：使用for循环执行移动操作，减少函数调用开销
      for (let i = 0; i < moves.length; i++) {
        const { card, desiredIndex } = moves[i];
        const referenceNode = desiredOrder[desiredIndex + 1];
        if (referenceNode && referenceNode.isConnected) {
          targetGrid.insertBefore(card, referenceNode);
        } else if (desiredIndex === desiredOrder.length - 1) {
          targetGrid.appendChild(card);
        }
      }
    });
  }
  
  if (page === 1 && container.scrollTop > 0) {
      container.scrollTop = 0;
  }
  enableVirtualization(ui, container, targetGrid);
}

export function renderSingers(ui, singers, container, page) {
  // 修复：支持分页加载更多数据
  // 不要清空容器，而是追加新数据
  if (page === 1) container.innerHTML = '';
  const grid = container.querySelector('.grid') || document.createElement('div');
  if (!grid.parentNode) {
    grid.className = 'grid grid-cols-1 gap-2';
    container.appendChild(grid);
  }
  grid.dataset.contentType = 'singer';
  if (!Array.isArray(singers) || singers.length === 0) {
    // 只在第一页且无数据时显示无结果提示
    // 使用统一的"没有更多歌星了"提示（双语显示）
    if (page === 1) {
      showNoMoreDataIndicator(container, grid, '没有更多歌星了');
    }
    return;
  }
  // 性能优化：使用for循环替代forEach，减少函数调用开销
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < singers.length; i++) {
    const card = ui.createSingerCard(singers[i]);
    if (card) {
      fragment.appendChild(card);
    }
  }
  if (fragment.childNodes.length > 0) {
    grid.appendChild(fragment);
  }
  
  // 确保网格容器正确显示
  if (grid.parentNode !== container) {
    container.appendChild(grid);
  }
}

export function createSingerCard(ui, singer) {
  // 使用统一的卡片工厂函数，确保所有卡片样式完全一致
  return window.SongCardFactory.createUnifiedSingerCard(ui, singer);
}

export function addInteractionEffects(element) {
}

// 创建公共的播放动画HTML函数
export function createPlayingAnimation() {
  // 完全使用CSS类，移除所有内联样式
  // 动画延迟通过CSS选择器控制（.playing-bar.animate-bar:nth-of-type）
  return `
    <div class="playing-indicator">
      <div class="playing-indicator-inner">
        <div class="playing-bar animate-bar"></div>
        <div class="playing-bar animate-bar"></div>
        <div class="playing-bar animate-bar"></div>
      </div>
    </div>
  `;
}

import sharedModalManager from '../common/SharedModalManager.js';

/** selectedUI 等模块未挂 songService，必须回退到 window.songService，否则同步后无法刷新点歌卡片 */
function resolveSongService(ui) {
  if (ui && ui.songService) return ui.songService;
  if (typeof window !== 'undefined' && window.songService) return window.songService;
  return null;
}

function resolveUiForCardUpdate(ui) {
  const svc = resolveSongService(ui);
  if (typeof window !== 'undefined' && window.songTopUI && window.songTopUI.songService === svc) {
    return window.songTopUI;
  }
  if (typeof window !== 'undefined' && window.partyUI && window.partyUI.songService === svc) {
    return window.partyUI;
  }
  return ui && svc ? { ...ui, songService: svc } : ui;
}

export function updateSongCardUIById(ui, songId, optionalContainer = null) {
  // 性能优化：立即执行，不使用任何延迟
  const container = optionalContainer || sharedModalManager.getContainer() || document;
  if (!container || !songId) return;
  
  // 确保songId是字符串类型，与data-song-id属性匹配
  const songIdStr = String(songId);
  const card = container.querySelector(`.song-card[data-song-id="${songIdStr}"]`);
  if (!card) {
    // 如果在指定容器找不到，尝试在全局找（如果是点击反馈等需要跨容器更新）
    if (container !== document) {
      const globalCard = document.querySelector(`.song-card[data-song-id="${songIdStr}"]`);
      if (globalCard) {
        // 更新全局卡片
        return updateSongCardUIById(ui, songId, document);
      }
    }
    return;
  }

  const addBtn = card.querySelector('.add-btn');
  const titleEl = card.querySelector('h3');

  // 完全使用CSS类控制样式，不设置任何内联样式
  // 调整图标尺寸 - 完全使用CSS类，移除所有内联字体大小样式，避免与CSS冲突
  let iconHtml = '<i class="fa fa-plus song-card-add-icon"></i>';
  let isDisabled = false;
  let isRequested = false;
  let songIndex = -1;

  const cardUi = resolveUiForCardUpdate(ui);
  const songSvc = resolveSongService(ui);
  if (!songSvc) {
    // 如果 songService 不存在，使用默认状态（红色加号）
    if (addBtn) {
      addBtn.innerHTML = iconHtml;
      addBtn.disabled = false;
      addBtn.classList.remove('is-disabled', 'has-playing-indicator', 'play-pause-btn', 'next-btn', 'remove-btn', 'priority-btn');
    }
    titleEl?.classList.remove('song-card-title--requested');
    return;
  }

    try {
    // 检查歌曲是否已点播
      isRequested = songSvc.isSongRequested(songIdStr);

    if (!isRequested) {
      // 未点播：显示红色加号图标
      titleEl?.classList.remove('song-card-title--requested');
      iconHtml = '<i class="fa fa-plus song-card-add-icon"></i>';
      isDisabled = false;
    } else {
      songIndex = songSvc.getSelectedSongIndex(songIdStr);

      if (songIndex < 0) {
        iconHtml = '<i class="fa fa-arrow-up song-card-priority-icon"></i>';
        isDisabled = false;
      } else if (songIndex === 0) {
        iconHtml = createPlayingAnimation();
        isDisabled = true;
      } else if (songIndex === 1) {
        iconHtml = '<i class="fa fa-step-forward song-card-step-icon"></i>';
        isDisabled = false;
      } else {
        iconHtml = '<i class="fa fa-arrow-up song-card-priority-icon"></i>';
        isDisabled = false;
      }
    }
    } catch (error) {
      console.error('[SongTopRenderer] 更新歌曲卡片UI时出错:', error);
      titleEl?.classList.remove('song-card-title--requested');
      iconHtml = '<i class="fa fa-plus song-card-add-icon"></i>';
      isDisabled = false;
  }

  // 更新标题颜色（点播歌曲只改变文字颜色，不改变背景色）
  // 只在状态真正变化时才更新，避免不必要的DOM操作导致闪烁
  if (titleEl) {
    // 核心修复：如果歌曲已点播，无论索引是否有效，都应该显示红色标题
    // 这样可以避免在服务器同步时短暂显示黑色标题
    const shouldBeRed = isRequested;
    const isCurrentlyRed = titleEl.classList.contains('song-card-title--requested');
    
    // 只在状态变化时才更新，避免重复操作
    if (shouldBeRed && !isCurrentlyRed) {
      titleEl.classList.add('song-card-title--requested');
    } else if (!shouldBeRed && isCurrentlyRed) {
      titleEl.classList.remove('song-card-title--requested');
    }
  }
  
  // 移除选中状态类（点播歌曲不应该改变背景色）
  card.classList.remove('song-card-selected');

  if (addBtn) {
    // 确保 iconHtml 不为空（防止空内容导致按钮显示异常）
    const trimmedIconHtml = iconHtml.trim();
    if (!trimmedIconHtml) {
      iconHtml = '<i class="fa fa-plus song-card-add-icon"></i>';
    }

    // 性能优化：只在需要时才查询和更新DOM
    const newContent = iconHtml.trim();
    const currentContent = addBtn.innerHTML.trim();
    const currentDisabled = addBtn.disabled;
    const needsContentUpdate = currentContent !== newContent;
    const needsDisabledUpdate = currentDisabled !== isDisabled;

    // 判断按钮应该是什么状态
    const shouldBePriority = iconHtml.includes('song-card-priority-icon');
    const shouldBeNext = iconHtml.includes('song-card-step-icon');
    const shouldBePlaying = iconHtml.includes('playing-indicator');
    const shouldBeRemove = iconHtml.includes('song-card-arrow-icon');
    const shouldBeDefault = !shouldBePriority && !shouldBeNext && !shouldBePlaying && !shouldBeRemove;
    
    // 检查当前类名是否正确
    const hasPriority = addBtn.classList.contains('priority-btn');
    const hasSongCardAdd = addBtn.classList.contains('song-card-add-btn');
    const needsClassUpdate = (shouldBePriority && (!hasPriority || hasSongCardAdd)) ||
                             (!shouldBePriority && hasPriority) ||
                             (shouldBeDefault && !hasSongCardAdd);

    // 性能优化：只在内容、状态或类名变化时才更新DOM
    if (needsContentUpdate || needsDisabledUpdate || needsClassUpdate) {
      if (needsContentUpdate) {
        addBtn.innerHTML = iconHtml;
      }
      
      if (needsDisabledUpdate) {
        addBtn.disabled = Boolean(isDisabled);
      }
      
      // 批量更新类名 - 确保先移除所有状态类，再添加基础类，最后添加状态类
      // 这样可以确保CSS选择器优先级正确
      addBtn.classList.remove('play-pause-btn', 'next-btn', 'remove-btn', 'has-playing-indicator', 'is-disabled', 'priority-btn', 'song-card-add-btn');
      addBtn.classList.toggle('is-disabled', Boolean(isDisabled));

      // 根据状态添加对应的类
      // 重要：先添加基础类 song-card-add-btn，再添加状态类，确保CSS选择器正确匹配
      let buttonState = 'default';
      if (shouldBePlaying) {
        // 播放状态：先添加基础类，再添加状态类
        addBtn.classList.add('song-card-add-btn', 'play-pause-btn', 'has-playing-indicator');
        buttonState = 'playing';
      } else if (shouldBeNext) {
        // 下一首状态：先添加基础类，再添加状态类
        addBtn.classList.add('song-card-add-btn', 'next-btn');
        buttonState = 'next';
      } else if (shouldBePriority) {
        // 优先状态：使用 priority-btn（它有自己的完整样式）
        addBtn.classList.add('priority-btn');
        buttonState = 'priority';
      } else if (shouldBeRemove) {
        // 移除状态：使用默认样式
        addBtn.classList.add('song-card-add-btn', 'remove-btn');
        buttonState = 'default';
      } else {
        // 默认状态：只添加基础类
        addBtn.classList.add('song-card-add-btn');
        buttonState = 'default';
      }
      
      // 同步更新状态管理器中的按钮背景状态
      if (cardUi && cardUi.updateSongCardButtonBackground && typeof cardUi.updateSongCardButtonBackground === 'function') {
        cardUi.updateSongCardButtonBackground(songIdStr, buttonState);
      }
    }
  }

  // 同步卡片状态配色
  card.classList.remove('song-card--current', 'song-card--next', 'song-card--queued');
  if (isRequested) {
    if (songIndex === 0) {
      card.classList.add('song-card--current');
    } else if (songIndex === 1) {
      card.classList.add('song-card--next');
    } else {
      card.classList.add('song-card--queued');
    }
  }
}

/**
 * 更新页面上所有可见的歌曲卡片状态
 * @param {Object} ui - UI实例
 */
export function updateAllVisibleSongCards(ui) {
  if (!resolveSongService(ui)) return;
  
  // 查找所有带有 data-song-id 的歌曲卡片
  const cards = document.querySelectorAll('.song-card[data-song-id]');
  if (cards.length === 0) return;
  
  // 批量更新
  cards.forEach(card => {
    const songId = card.dataset.songId;
    if (songId) {
      updateSongCardUIById(ui, songId, document);
    }
  });
}

// 注册全局事件监听，确保当播放列表变化时，所有的歌曲卡片（热门、搜索结果等）都能实时更新状态
if (typeof window !== 'undefined') {
  window.addEventListener('songListSynced', (event) => {
    // 延迟一帧，确保 SongService 的状态已经完全更新
    requestAnimationFrame(() => {
      // 优先使用带 songService 的页面实例；点歌页必须用 songTopUI，否则 selectedUI 无 songService 时无法刷新卡片
      const ui = window.songTopUI || window.partyUI || window.selectedUI || window.songUI;
      if (ui) {
        const songId = event?.detail?.songId;
        if (songId) {
          updateSongCardUIById(ui, songId, document);
        } else {
          updateAllVisibleSongCards(ui);
        }
      }
    });
  });
}

function enableVirtualization(ui, container, grid) {
  if (!container || !grid) return;
  if (grid.dataset.virtualized === 'true') return;
  const threshold = 120;
  const childrenCount = grid.children.length;
  if (childrenCount < threshold) return;
  grid.dataset.virtualized = 'true';
  let running = false;
  const check = () => {
    running = false;
    const ch = container.clientHeight || 0;
    const top = container.scrollTop || 0;
    const buffer = ch * 2;
    const min = top - buffer;
    const max = top + ch + buffer;
    // 性能优化：直接使用grid.children，避免Array.from转换
    const nodes = grid.children;
    const nodesLength = nodes.length;
    for (let i = 0; i < nodesLength; i++) {
      const el = nodes[i];
      if (!(el instanceof HTMLElement)) continue;
      const isPlaceholder = el.classList.contains('song-card-placeholder');
      const isCard = el.classList.contains('song-card');
      if (!isPlaceholder && !isCard) continue;
      const h = el.offsetHeight || parseInt(el.style.height || '0') || 160;
      const offTop = el.offsetTop || 0;
      const bottom = offTop + h;
      const outOfView = bottom < min || offTop > max;
      if (isCard && outOfView) {
        const ph = document.createElement('div');
        ph.className = 'song-card-placeholder';
        ph.style.height = h + 'px';
        ph.dataset.songId = el.dataset.songId || '';
        ph.dataset.songHash = el.dataset.songHash || '';
        grid.replaceChild(ph, el);
      } else if (isPlaceholder && !outOfView) {
        let data = null;
        try { data = el.dataset.songHash ? JSON.parse(el.dataset.songHash) : null; } catch (_) {}
        const card = ui.createSongCard(data);
        if (card) {
          const id = el.dataset.songId || '';
          const hash = el.dataset.songHash || '';
          if (id) card.dataset.songId = id;
          if (hash) card.dataset.songHash = hash;
          grid.replaceChild(card, el);
          try { updateSongCardUIById(ui, id); } catch (_) {}
        }
      }
    }
  };
  // 性能优化：使用节流处理滚动事件，避免频繁触发
  let scrollRafId = null;
  const handleScroll = () => {
    if (!running) {
      running = true;
      if (scrollRafId !== null) {
        cancelAnimationFrame(scrollRafId);
      }
      scrollRafId = requestAnimationFrame(() => {
        check();
        scrollRafId = null;
      });
    }
  };
  
  container.addEventListener('scroll', handleScroll, { passive: true });
  // 初始检查
  check();
  
  // 返回清理函数（如果需要）
  return () => {
    container.removeEventListener('scroll', handleScroll);
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
  };
}
