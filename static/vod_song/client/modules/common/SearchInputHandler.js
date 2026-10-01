/**
 * 统一的搜索框处理工具
 * 用于点歌和派对模态框，共享相同的搜索框绑定逻辑
 */

import { createDebounced, DomUtils } from '../../utils/index.js';
import { optimizeAndroidInput, fixAndroidCursor } from '../../utils/AndroidInputOptimization.js';

/**
 * 绑定搜索框事件
 * @param {Object} config - 配置对象
 * @param {HTMLElement} config.searchInput - 搜索输入框元素
 * @param {Function} config.onSearch - 搜索回调函数 (keyword: string) => Promise<void>
 * @param {Function} config.onClear - 清空回调函数 (可选)
 * @param {number} config.debounceDelay - 防抖延迟时间（毫秒），默认500
 * @param {Function} config.log - 日志函数（可选）
 * @returns {Object} 返回清理函数对象
 */
// 全局管理搜索框的事件绑定，确保只有一个监听器
let _globalSearchInputHandler = null;
let _globalSearchInput = null;

export function bindSearchInput(config) {
  const {
    searchInput,
    onSearch,
    onClear,
    debounceDelay = 500,
    log = console.log
  } = config;

  const shouldEmitVerboseLog = (() => {
    try {
      return window.localStorage?.getItem('ktv:log:level') === 'debug';
    } catch (_) {
      return false;
    }
  })();

  const emitLog = (level, message, details) => {
    if (!shouldEmitVerboseLog && (level === 'debug' || level === 'info')) {
      return;
    }
    try {
      if (typeof log === 'function') {
        if (details !== undefined) {
          log(level, message, details);
        } else {
          log(level, message);
        }
        return;
      }
    } catch (err) {
      console.error('[SearchInputHandler] 日志函数调用失败:', err);
    }
    if (details !== undefined) {
    } else {
    }
  };

  if (!searchInput) {
    emitLog('warn', '[SearchInputHandler] 搜索输入元素不存在，跳过绑定');
    return { cleanup: () => {} };
  }

  // 如果搜索框已经绑定过，先清理旧的绑定
  if (_globalSearchInput === searchInput && _globalSearchInputHandler) {
    _globalSearchInputHandler.cleanup();
    _globalSearchInputHandler = null;
  }

  let searchCallCount = 0;
  
  // 检测是否为Android WebView环境
  const isAndroidWebView = /Android/.test(navigator.userAgent) && /WebView/.test(navigator.userAgent);
  
  // 安卓 WebView 下适当放宽防抖，减少输入法组合输入和重复渲染压力
  const actualDebounceDelay = Math.min(debounceDelay, isAndroidWebView ? 280 : 220);
  emitLog('debug', '[SearchInputHandler] 绑定搜索框事件监听', {
    debounceDelay,
    actualDebounceDelay
  });
  
  const debouncedSearch = createDebounced(async (keyword) => {
    const callId = ++searchCallCount;
    emitLog('info', '[SearchInputHandler] 防抖后执行搜索回调', {
      callId,
      keyword
    });
    if (typeof onSearch === 'function') {
      try {
        await onSearch(keyword);
        emitLog('info', '[SearchInputHandler] 搜索回调完成', {
          callId,
          keyword
        });
      } catch (error) {
        emitLog('error', '[SearchInputHandler] 搜索回调抛出异常', {
          callId,
          keyword,
          error: error?.stack || error?.message || error
        });
      }
    } else {
      emitLog('warn', '[SearchInputHandler] onSearch 不是函数，跳过执行', {
        callId,
        keyword
      });
    }
  }, actualDebounceDelay);

  // 标记是否正在组合输入（中文输入法等）
  let isComposing = false;
  let compositionValue = (searchInput.value || '').trim();
  let lastSearchValue = compositionValue;
  emitLog('debug', '[SearchInputHandler] 初始化输入状态', {
    initialValue: compositionValue
  });
  let compositionFallbackTimer = null;
  
  // Android WebView中文输入优化延迟
  const androidCompositionDelay = isAndroidWebView ? 100 : 50;

  const triggerSearch = (value, source) => {
    const trimmedValue = (value || '').trim();
    const payload = {
      source,
      trimmedValue,
      previousValue: lastSearchValue,
      isComposing,
      isAndroidWebView
    };
    emitLog('info', '[SearchInputHandler] 触发搜索请求', payload);
    lastSearchValue = trimmedValue;
    compositionValue = trimmedValue;
    debouncedSearch(trimmedValue);
  };

  // 处理组合输入开始（中文输入法开始输入）
  const handleCompositionStart = (e) => {
    isComposing = true;
    if (compositionFallbackTimer) {
      clearTimeout(compositionFallbackTimer);
      compositionFallbackTimer = null;
    }
    compositionValue = (searchInput.value || '').trim();
    emitLog('debug', '[SearchInputHandler] compositionstart', {
      value: compositionValue
    });
  };
  
  // 处理组合输入更新（中文输入法输入过程中）
  const handleCompositionUpdate = (e) => {
    isComposing = true;
    compositionValue = (searchInput.value || '').trim();
    emitLog('debug', '[SearchInputHandler] compositionupdate', {
      value: compositionValue
    });
  };
  
  // 处理组合输入结束（中文输入法输入完成）
  const handleCompositionEnd = (e) => {
    isComposing = false;
    if (compositionFallbackTimer) {
      clearTimeout(compositionFallbackTimer);
      compositionFallbackTimer = null;
    }
    compositionValue = (searchInput.value || '').trim();
    emitLog('debug', '[SearchInputHandler] compositionend', {
      value: compositionValue,
      lastSearchValue
    });
    
    // 确保输入框保持焦点
    if (document.activeElement !== searchInput) {
      searchInput.focus();
      // 将光标移动到文本末尾
      const length = searchInput.value.length;
      searchInput.setSelectionRange(length, length);
    }
    
    // 延迟一小段时间后执行搜索，确保 input 事件有机会先处理
    setTimeout(() => {
      const currentValue = (searchInput.value || '').trim();
      if (currentValue !== lastSearchValue) {
        emitLog('debug', '[SearchInputHandler] compositionend 延迟触发搜索', {
          currentValue,
          lastSearchValue
        });
        // console.log(`[SearchInputHandler] [组合输入] compositionend 执行搜索: "${currentValue}"`);
        triggerSearch(currentValue, 'compositionend-delay');
      }
    }, androidCompositionDelay); // 使用Android优化的延迟时间
  };
  
  const handleInput = (e) => {
    const value = (e.target.value || '').trim();
    const eventIsComposing = e.isComposing;
    const inputType = e.inputType;
    const maybeCompositionText =
      inputType === 'insertText' ||
      inputType === 'insertCompositionText' ||
      inputType === 'insertReplacementText';
    
    // 某些 Android WebView (例如 Cordova/Hybrid APK) 不会触发 compositionend，
    // 但会在最终输入时发送一个 input 事件且 e.isComposing 为 false。
    // 这种情况下需要手动结束组合输入状态，否则搜索逻辑会被卡住。
    if (isComposing && !eventIsComposing && maybeCompositionText) {
      emitLog('warn', '[SearchInputHandler] 检测到组合输入未触发 compositionend，执行兜底恢复', {
        inputType,
        value,
        lastSearchValue
      });
      isComposing = false;
    }
    
    emitLog('debug', '[SearchInputHandler] input 事件', {
      rawValue: e.target.value,
      trimmedValue: value,
      isComposing,
      eventIsComposing,
      inputType,
      lastSearchValue
    });
    
    // 如果仍然处于组合输入阶段，跳过搜索（等待组合输入完成或兜底逻辑触发）
    if (isComposing || eventIsComposing) {
      // 但仍然更新最后输入值，确保 compositionend 时能正确比较
      compositionValue = value;
      if (isAndroidWebView) {
        if (compositionFallbackTimer) {
          clearTimeout(compositionFallbackTimer);
        }
        compositionFallbackTimer = setTimeout(() => {
          compositionFallbackTimer = null;
          if (!isComposing) {
            return;
          }
          const currentValue = (searchInput.value || '').trim();
          if (currentValue === lastSearchValue) {
            return;
          }
          emitLog('warn', '[SearchInputHandler] 组合输入兜底定时器触发搜索', {
            currentValue,
            lastSearchValue,
            inputType,
            eventIsComposing,
            isComposing
          });
          isComposing = false;
          triggerSearch(currentValue, 'composition-fallback-timer');
        }, androidCompositionDelay + 120);
      }
      return;
    }
    
    // 如果值没有变化，不执行搜索
    if (value === lastSearchValue) {
      emitLog('debug', '[SearchInputHandler] input 值未变化，跳过搜索', {
        value
      });
      return;
    }
    
    // 更新最后输入值并执行搜索
    triggerSearch(value, 'input');
  };

  // 键盘状态管理
  // 记录最大视口高度（键盘未弹出时的视口高度）
  let maxViewportHeight = window.innerHeight;
  let viewportResizeTimer = null;
  let isSearchFocused = false;
  let lastKnownHeight = window.innerHeight;

  // 更新最大视口高度（仅在视口高度增加时更新，表示键盘收起）
  const updateMaxViewportHeight = () => {
    const currentHeight = window.innerHeight;
    // 如果当前高度大于记录的最大高度，更新最大高度
    // 这表示键盘已完全收起
    if (currentHeight > maxViewportHeight) {
      maxViewportHeight = currentHeight;
      emitLog('debug', '[SearchInputHandler] 更新最大视口高度', {
        maxHeight: maxViewportHeight,
        currentHeight
      });
    }
    lastKnownHeight = currentHeight;
  };

  // 更新底部导航栏显示状态
  const updateBottomNavVisibility = () => {
    const bottomNav = document.getElementById('bottom-nav');
    if (!bottomNav) return;

    const currentHeight = window.innerHeight;
    updateMaxViewportHeight();
    
    // 计算视口高度减少量
    const heightDiff = maxViewportHeight - currentHeight;
    // 如果视口高度明显减小（减少超过150px），认为键盘已弹出
    const keyboardVisible = heightDiff > 150;
    
    // 优先根据键盘状态决定显示/隐藏
    // 如果键盘已收起（高度差小于150px），即使搜索框有焦点也显示底部导航栏
    // 如果键盘可见，则隐藏底部导航栏
    if (keyboardVisible) {
      bottomNav.classList.add('hidden-by-keyboard');
      emitLog('debug', '[SearchInputHandler] 隐藏底部导航栏（键盘可见）', {
        keyboardVisible,
        isSearchFocused,
        currentHeight,
        maxHeight: maxViewportHeight,
        heightDiff
      });
    } else {
      // 键盘已收起，显示底部导航栏
      bottomNav.classList.remove('hidden-by-keyboard');
      emitLog('debug', '[SearchInputHandler] 显示底部导航栏（键盘已收起）', {
        keyboardVisible,
        isSearchFocused,
        currentHeight,
        maxHeight: maxViewportHeight,
        heightDiff
      });
    }
  };

  // 处理搜索框焦点变化
  const handleFocus = () => {
    isSearchFocused = true;
    // 立即更新，因为焦点时键盘可能还未弹出
    updateBottomNavVisibility();
    // 延迟再次检查，确保捕获键盘弹出后的状态
    setTimeout(() => {
      updateBottomNavVisibility();
    }, 300);
  };

  const handleBlur = () => {
    isSearchFocused = false;
    // 延迟更新，等待键盘收起动画完成
    setTimeout(() => {
      updateBottomNavVisibility();
    }, 200);
  };

  // 监听视口高度变化（检测键盘显示/隐藏）
  const handleViewportResize = () => {
    // 防抖处理
    clearTimeout(viewportResizeTimer);
    viewportResizeTimer = setTimeout(() => {
      updateBottomNavVisibility();
    }, 100);
  };

  // 使用 Visual Viewport API（如果支持，更准确）
  let visualViewportHandler = null;
  if (window.visualViewport) {
    visualViewportHandler = () => {
      clearTimeout(viewportResizeTimer);
      viewportResizeTimer = setTimeout(() => {
        updateBottomNavVisibility();
      }, 100);
    };
    window.visualViewport.addEventListener('resize', visualViewportHandler);
    emitLog('debug', '[SearchInputHandler] 使用 Visual Viewport API 监听键盘');
  } else {
    // 回退到 window resize 事件
    window.addEventListener('resize', handleViewportResize);
    emitLog('debug', '[SearchInputHandler] 使用 window resize 监听键盘');
  }

  // 绑定所有事件监听器
  DomUtils.addEventListener(searchInput, 'input', handleInput);
  DomUtils.addEventListener(searchInput, 'compositionstart', handleCompositionStart);
  DomUtils.addEventListener(searchInput, 'compositionupdate', handleCompositionUpdate);
  DomUtils.addEventListener(searchInput, 'compositionend', handleCompositionEnd);
  DomUtils.addEventListener(searchInput, 'focus', handleFocus);
  DomUtils.addEventListener(searchInput, 'blur', handleBlur);
  

  // 如果是Android WebView，应用优化
  if (isAndroidWebView) {
    optimizeAndroidInput(searchInput);
    fixAndroidCursor(searchInput);
  }

  // 保存全局引用
  const handler = {
    cleanup: () => {
      DomUtils.removeEventListener(searchInput, 'input', handleInput);
      DomUtils.removeEventListener(searchInput, 'compositionstart', handleCompositionStart);
      DomUtils.removeEventListener(searchInput, 'compositionupdate', handleCompositionUpdate);
      DomUtils.removeEventListener(searchInput, 'compositionend', handleCompositionEnd);
      DomUtils.removeEventListener(searchInput, 'focus', handleFocus);
      DomUtils.removeEventListener(searchInput, 'blur', handleBlur);
      
      // 清理视口监听器
      if (visualViewportHandler && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', visualViewportHandler);
      } else {
        window.removeEventListener('resize', handleViewportResize);
      }
      
      if (viewportResizeTimer) {
        clearTimeout(viewportResizeTimer);
        viewportResizeTimer = null;
      }
      
      debouncedSearch.cancel();
      isComposing = false;
      lastSearchValue = '';
      compositionValue = '';
      isSearchFocused = false;
      
      if (compositionFallbackTimer) {
        clearTimeout(compositionFallbackTimer);
        compositionFallbackTimer = null;
      }
      
      // 清理时恢复底部导航栏显示
      const bottomNav = document.getElementById('bottom-nav');
      if (bottomNav) {
        bottomNav.classList.remove('hidden-by-keyboard');
      }
      
      if (_globalSearchInput === searchInput) {
        _globalSearchInputHandler = null;
        _globalSearchInput = null;
      }
      emitLog('debug', '[SearchInputHandler] 搜索框事件已清理');
    },
    clear: () => {
      if (searchInput) {
        searchInput.value = '';
        lastSearchValue = '';
        compositionValue = '';
        emitLog('info', '[SearchInputHandler] 清空搜索输入');
        if (typeof onClear === 'function') {
          onClear();
        } else if (typeof onSearch === 'function') {
          onSearch('');
        }
      }
    }
  };

  _globalSearchInputHandler = handler;
  _globalSearchInput = searchInput;

  return handler;

}

/**
 * 绑定搜索框关闭按钮
 * @param {Object} config - 配置对象
 * @param {HTMLElement} config.closeBtn - 关闭按钮元素
 * @param {HTMLElement} config.searchInput - 搜索输入框元素
 * @param {Function} config.onClear - 清空回调函数（可选）
 * @param {Function} config.log - 日志函数（可选）
 * @returns {Function} 返回清理函数
 */
export function bindSearchCloseBtn(config) {
  const {
    closeBtn,
    searchInput,
    onClear,
    log = console.log
  } = config;

  if (!closeBtn) {
    log?.('warn', '[SearchInputHandler] 关闭按钮元素不存在');
    return () => {};
  }

  const handleClick = () => {
    if (searchInput) {
      searchInput.value = '';
    }
    if (typeof onClear === 'function') {
      onClear();
    }
  };

  closeBtn.addEventListener('click', handleClick);
  log?.('debug', '[SearchInputHandler] 搜索框关闭按钮已绑定');

  // 返回清理函数
  return () => {
    closeBtn.removeEventListener('click', handleClick);
    log?.('debug', '[SearchInputHandler] 搜索框关闭按钮已清理');
  };
}
