/**
 * Android输入法优化模块
 * 专门处理Android WebView中的中文输入问题
 */

/**
 * 优化搜索输入框的Android中文输入体验
 * @param {HTMLElement} inputElement - 输入框元素
 */
export function optimizeAndroidInput(inputElement) {
  if (!inputElement || !/Android/.test(navigator.userAgent) || !/WebView/.test(navigator.userAgent)) {
    return;
  }

  let isComposing = false;
  let compositionText = '';

  // 监听组合输入开始
  inputElement.addEventListener('compositionstart', (e) => {
    isComposing = true;
    compositionText = '';
  });

  // 监听组合输入更新
  inputElement.addEventListener('compositionupdate', (e) => {
    compositionText = e.data || '';
  });

  // 监听组合输入结束
  inputElement.addEventListener('compositionend', (e) => {
    isComposing = false;
    
    // 确保输入框保持焦点
    setTimeout(() => {
      if (document.activeElement !== inputElement) {
        inputElement.focus();
        // 恢复光标位置
        const value = inputElement.value;
        const cursorPos = value.length;
        inputElement.setSelectionRange(cursorPos, cursorPos);
      }
    }, 50);
  });

  // 防止输入框失去焦点
  inputElement.addEventListener('blur', (e) => {
    if (isComposing) {
      // 如果正在中文输入，阻止失去焦点
      e.preventDefault();
      setTimeout(() => {
        inputElement.focus();
      }, 10);
    }
  });

  // 处理输入事件
  inputElement.addEventListener('input', (e) => {
    if (isComposing) {
    }
  });

}

/**
 * 检查是否为Android WebView环境
 * @returns {boolean}
 */
export function isAndroidWebView() {
  return /Android/.test(navigator.userAgent) && /WebView/.test(navigator.userAgent);
}

/**
 * 修复Android WebView中的光标问题
 * @param {HTMLElement} inputElement - 输入框元素
 */
export function fixAndroidCursor(inputElement) {
  if (!isAndroidWebView() || !inputElement) {
    return;
  }

  // 监听各种可能导致光标丢失的事件
  const events = ['compositionend', 'keyup', 'input'];
  
  events.forEach(eventType => {
    inputElement.addEventListener(eventType, () => {
      setTimeout(() => {
        if (document.activeElement === inputElement) {
          const value = inputElement.value;
          const cursorPos = inputElement.selectionStart;
          
          // 如果光标位置异常，修复它
          if (cursorPos === null || cursorPos === undefined || cursorPos > value.length) {
            inputElement.setSelectionRange(value.length, value.length);
          }
        }
      }, 10);
    });
  });

}