/**
 * DOM操作工具
 */
class DomUtils {
  /**
   * 创建元素
   * @param {string} tagName - 标签名
   * @param {Object} attributes - 属性对象
   * @param {string} textContent - 文本内容
   * @returns {Element} 创建的元素
   */
  static createElement(tagName, attributes = {}, textContent = '') {
    const element = document.createElement(tagName);
    
    // 设置属性
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, value);
    }
    
    // 设置文本内容
    if (textContent) {
      element.textContent = textContent;
    }
    
    return element;
  }

  /**
   * 添加CSS类
   * @param {Element} element - 元素
   * @param {string|string[]} classNames - CSS类名（可以是字符串或数组）
   */
  static addClass(element, classNames) {
    if (typeof classNames === 'string') {
      element.classList.add(classNames);
    } else if (Array.isArray(classNames)) {
      element.classList.add(...classNames);
    }
  }

  /**
   * 移除CSS类
   * @param {Element} element - 元素
   * @param {string|string[]} classNames - CSS类名（可以是字符串或数组）
   */
  static removeClass(element, classNames) {
    if (typeof classNames === 'string') {
      element.classList.remove(classNames);
    } else if (Array.isArray(classNames)) {
      element.classList.remove(...classNames);
    }
  }

  /**
   * 切换CSS类
   * @param {Element} element - 元素
   * @param {string} className - CSS类名
   */
  static toggleClass(element, className) {
    element.classList.toggle(className);
  }

  /**
   * 检查元素是否包含指定CSS类
   * @param {Element} element - 元素
   * @param {string} className - CSS类名
   * @returns {boolean} 是否包含
   */
  static hasClass(element, className) {
    return element.classList.contains(className);
  }

  /**
   * 查找元素
   * @param {string} selector - 选择器
   * @param {Element|Document} context - 查找上下文
   * @returns {Element|null} 找到的元素
   */
  static findElement(selector, context = document) {
    return context.querySelector(selector);
  }

  /**
   * 查找所有元素
   * @param {string} selector - 选择器
   * @param {Element|Document} context - 查找上下文
   * @returns {NodeList} 找到的元素列表
   */
  static findAllElements(selector, context = document) {
    return context.querySelectorAll(selector);
  }

  /**
   * 添加事件监听器
   * @param {Element} element - 元素
   * @param {string} eventType - 事件类型
   * @param {Function} handler - 事件处理函数
   * @param {Object} options - 事件监听器选项
   */
  static addEventListener(element, eventType, handler, options = {}) {
    element.addEventListener(eventType, handler, options);
  }

  /**
   * 移除事件监听器
   * @param {Element} element - 元素
   * @param {string} eventType - 事件类型
   * @param {Function} handler - 事件处理函数
   */
  static removeEventListener(element, eventType, handler) {
    element.removeEventListener(eventType, handler);
  }

  /**
   * 确保滚动容器样式正确（用于模态框等滚动容器）
   * @param {HTMLElement} container - 滚动容器元素
   */
  static ensureScrollContainerStyles(container) {
    if (!container) return;
    
    // 关键：移除 flex-1 类，因为它会覆盖固定高度
    container.classList.remove('flex-1');
    
    // 使用 CSS 类替代 !important
    container.classList.add('container-scrollable-optimized');
    
    // 移除 flex 相关样式，使用固定高度
    container.style.removeProperty('flex');
    container.style.removeProperty('flex-grow');
    container.style.removeProperty('flex-shrink');
    container.style.removeProperty('flex-basis');
    
    // 启用硬件加速
    container.style.willChange = 'scroll-position';
    container.style.transform = 'translateZ(0)';
  }

  /**
   * 确保所有资源（图片等）加载完成后再计算位置
   * @param {HTMLElement} nav - 导航栏元素
   * @returns {Promise<void>}
   */
  static async waitForNavResourcesReady(nav) {
    // 等待所有图片加载完成
    const images = nav.querySelectorAll('img');
    if (images.length > 0) {
      await Promise.all(
        Array.from(images).map(img => {
          if (img.complete) {
            return Promise.resolve();
          }
          return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true }); // 即使加载失败也继续
          });
        })
      );
    }
    
    // 等待一帧，确保所有CSS（包括clamp()）计算完成
    await new Promise(resolve => requestAnimationFrame(resolve));
    // 再等一帧，确保布局稳定
    await new Promise(resolve => requestAnimationFrame(resolve));
  }



  /**
   * 设置内容区域变换
   * @param {HTMLElement} content - 内容元素
   * @param {string} transform - transform值（如 'translateY(0)', 'translateY(100%)'）
   */
  static setContentTransform(content, transform) {
    if (!content) return;
    // 确保元素有过渡效果
    content.style.transition = 'transform 0.15s ease-out';
    content.style.transform = transform;
  }

  /**
   * 设置进度条宽度
   * @param {HTMLElement} progressBar - 进度条元素
   * @param {number} percentage - 百分比值（0-100）
   */
  static setProgressWidth(progressBar, percentage) {
    if (!progressBar) return;
    // 使用 CSS 变量替代内联样式
    progressBar.classList.add('progress-bar');
    progressBar.style.setProperty('--progress-width', `${percentage}%`);
  }

  /**
   * 创建带错误处理的图片元素
   * @param {string} src - 图片URL
   * @param {string} alt - 图片alt文本
   * @param {string} fallbackIcon - 错误时显示的图标HTML
   * @returns {string} 图片HTML字符串
   */
  static createImageWithFallback(src, alt, fallbackIcon = '<i class="fas fa-image text-gray-400"></i>') {
    return `<img src="${src}" alt="${alt}" onerror="this.parentElement.innerHTML='${fallbackIcon.replace(/'/g, "\\'")}'">`;
  }

  /**
   * 获取缓存服务实例（统一方法，避免重复代码）
   * @returns {Object|null} 缓存服务实例，如果不存在则返回 null
   */
  static getCacheService() {
    return (typeof window !== 'undefined' && window.cacheService) ? window.cacheService : null;
  }
}

export default DomUtils;