// 无限滚动工具：为容器绑定滚动监听，在接近底部或内容不足时触发回调

/**
 * 使用 requestAnimationFrame 节流的滚动处理函数
 * 性能优化：减少滚动事件的执行频率，避免阻塞主线程
 */
function createThrottledScrollHandler(onNeedMore, container, threshold, insufficientThreshold) {
  let rafId = null;
  let lastTriggeredScrollTop = -1;
  let lastCheckTime = 0;
  
  const handler = () => {
    // 取消之前的动画帧请求
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    
    // 使用 requestAnimationFrame 节流
    rafId = requestAnimationFrame(() => {
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      const now = Date.now();
      
      // 计算距离底部的距离
      const distanceToBottom = scrollHeight - (scrollTop + clientHeight);
      
      // 内容不足产生滚动条时也尝试加载
      if (scrollHeight <= clientHeight + insufficientThreshold) {
        onNeedMore('insufficient');
        rafId = null;
        return;
      }

      // 接近底部时触发加载
      // 优化：在距离底部 threshold 范围内就触发，而不是等到最后
      // 同时避免频繁触发：如果已经在阈值范围内且距离上次触发位置很近，则跳过
      if (distanceToBottom <= threshold) {
        // 检查是否需要触发：如果滚动位置距离上次触发位置足够远，或者距离底部足够近，则触发
        const scrollDelta = Math.abs(scrollTop - lastTriggeredScrollTop);
        const timeDelta = now - lastCheckTime;
        
        // 如果距离底部很近（小于 threshold/2），或者滚动距离较大，或者距离上次检查时间较长，则触发
        if (distanceToBottom <= threshold / 2 || scrollDelta > 50 || timeDelta > 200) {
          lastTriggeredScrollTop = scrollTop;
          lastCheckTime = now;
          onNeedMore('threshold');
        }
      } else {
        // 不在阈值范围内时，重置触发位置
        lastTriggeredScrollTop = -1;
      }
      
      rafId = null;
    });
  };
  
  // 返回处理器和清理函数
  handler.cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
  
  return handler;
}

/**
 * 绑定无限滚动（优化版本，使用节流减少性能开销）
 * @param {HTMLElement} container - 可滚动容器
 * @param {{threshold?: number, insufficientThreshold?: number}} options - 配置项
 * @param {Function} onNeedMore - 需要加载更多时触发的回调
 * @returns {Function} detach - 解绑函数
 */
export function attachInfiniteScroll(container, options = {}, onNeedMore) {
  if (!container || typeof onNeedMore !== 'function') {
    return () => {};
  }
  
  const threshold = typeof options.threshold === 'number' ? options.threshold : 50;
  const insufficientThreshold = typeof options.insufficientThreshold === 'number' ? options.insufficientThreshold : 10;

  // 性能优化：使用节流处理滚动事件
  const handler = createThrottledScrollHandler(onNeedMore, container, threshold, insufficientThreshold);
  let initialTimeoutId = null;

  // 监听滚动事件（使用 passive: true 提升滚动性能）
  container.addEventListener('scroll', handler, { passive: true });

  // 初次检查一次（延迟执行，避免阻塞初始化）
  initialTimeoutId = setTimeout(() => {
    handler();
    initialTimeoutId = null;
  }, 32);
  
  return () => {
    try {
      // 取消待执行的 requestAnimationFrame
      if (handler.cancel) {
        handler.cancel();
      }
      // 清理初始检查定时器
      if (initialTimeoutId !== null) {
        clearTimeout(initialTimeoutId);
        initialTimeoutId = null;
      }
      // 移除事件监听器
      container.removeEventListener('scroll', handler);
    } catch (_) {}
  };
}

/**
 * 显示加载指示器
 * @param {HTMLElement} container - 容器元素
 * @param {HTMLElement} grid - 网格元素（可选，用于插入位置）
 */
export function showLoadingIndicator(container, grid = null) {
  if (!container) return;
  
  // 检查是否已存在加载指示器
  let loadingEl = container.querySelector('.infinite-loading-indicator');
  if (loadingEl) return;
  
  loadingEl = document.createElement('div');
  loadingEl.className = 'infinite-loading-indicator';
  loadingEl.innerHTML = `
    <div class="flex items-center justify-center py-8 w-full loading-wrapper">
      <div class="inline-flex items-center gap-4 loading-content">
        <div class="inline-block rounded-full animate-spin loading-spinner"></div>
        <span class="loading-text">加载中...</span>
      </div>
    </div>
  `;
  
  // 加载指示器应该插入到 grid 内部，作为 grid 的最后一个子元素
  // 这样它就会成为滚动内容的一部分，始终显示在所有歌曲卡片的最后
  // 用户滚动到底部时，会看到加载指示器
  const targetGrid = grid || container.querySelector('.grid');
  
  if (targetGrid) {
    // 确保 grid 在 DOM 中
    if (!targetGrid.parentNode) {
      container.appendChild(targetGrid);
    }
    // 将加载指示器插入到 grid 的最后，作为最后一个子元素
    targetGrid.appendChild(loadingEl);
  } else {
    // 如果没有找到 grid，创建一个新的 grid 并添加加载指示器
    const newGrid = document.createElement('div');
    newGrid.className = 'grid grid-cols-1 gap-2 virtual-grid';
    newGrid.appendChild(loadingEl);
    container.appendChild(newGrid);
  }
}

/**
 * 隐藏加载指示器
 * @param {HTMLElement} container - 容器元素
 */
export function hideLoadingIndicator(container) {
  if (!container) return;
  const loadingEl = container.querySelector('.infinite-loading-indicator');
  if (loadingEl) {
    loadingEl.remove();
  }
}

/**
 * 显示"没有更多数据"提示
 * @param {HTMLElement} container - 容器元素
 * @param {HTMLElement} grid - 网格元素（可选，用于插入位置）
 * @param {string} message - 自定义提示消息（可选）
 */
export function showNoMoreDataIndicator(container, grid = null, message = '没有更多数据了') {
  if (!container) return;
  
  // 检查是否已存在提示
  let noMoreEl = container.querySelector('.infinite-no-more-indicator');
  if (noMoreEl) return;
  
  // 先移除加载指示器
  hideLoadingIndicator(container);
  
  // 根据消息内容确定印尼语翻译
  let indonesianMessage = '';
  if (message.includes('没有更多歌曲了')) {
    indonesianMessage = 'Tidak ada lagu lagi';
  } else if (message.includes('没有更多印尼歌曲了')) {
    indonesianMessage = 'Tidak ada lagu Indonesia lagi';
  } else if (message.includes('没有更多歌星了')) {
    indonesianMessage = 'Tidak ada penyanyi lagi';
  } else if (message.includes('没有更多数据了')) {
    indonesianMessage = 'Tidak ada data lagi';
  } else {
    // 如果没有匹配，使用默认翻译
    indonesianMessage = 'Tidak ada data lagi';
  }
  
  noMoreEl = document.createElement('div');
  noMoreEl.className = 'infinite-no-more-indicator';
  noMoreEl.innerHTML = `
    <div class="flex flex-col items-center justify-center py-6 w-full no-more-wrapper">
      <span class="no-more-message">${message}</span>
      <span class="indonesian-translation no-more-translation">${indonesianMessage}</span>
    </div>
  `;
  
  // "没有更多数据"提示应该插入到 grid 内部，作为 grid 的最后一个子元素
  // 这样它就会成为滚动内容的一部分，始终显示在所有歌曲卡片的最后
  const targetGrid = grid || container.querySelector('.grid');
  
  if (targetGrid) {
    // 确保 grid 在 DOM 中
    if (!targetGrid.parentNode) {
      container.appendChild(targetGrid);
    }
    // 将提示插入到 grid 的最后，作为最后一个子元素
    targetGrid.appendChild(noMoreEl);
  } else {
    // 如果没有找到 grid，创建一个新的 grid 并添加提示
    const newGrid = document.createElement('div');
    newGrid.className = 'grid grid-cols-1 gap-2 virtual-grid';
    newGrid.appendChild(noMoreEl);
    container.appendChild(newGrid);
  }
}

/**
 * 隐藏"没有更多数据"提示
 * @param {HTMLElement} container - 容器元素
 */
export function hideNoMoreDataIndicator(container) {
  if (!container) return;
  const noMoreEl = container.querySelector('.infinite-no-more-indicator');
  if (noMoreEl) {
    noMoreEl.remove();
  }
}

