/**
 * 性能优化工具函数
 * 提供防抖、节流、批量DOM操作等性能优化功能
 */

/**
 * 创建一个带取消/立即执行控制的防抖函数
 * @param {Function} fn - 需要防抖的函数
 * @param {number|Object} delayOrOptions - 延迟毫秒数或配置对象
 * @param {Object} [options] - 额外配置（当第二个参数是数字时生效）
 * @returns {Function & {cancel:Function,flush:Function,isPending:Function}} 防抖函数
 */
export function createDebounced(fn, delayOrOptions = 300, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('createDebounced 需要传入函数类型的第一个参数');
  }

  const normalizedOptions = typeof delayOrOptions === 'number'
    ? { delay: delayOrOptions, ...options }
    : { ...delayOrOptions };

  const {
    delay = 300,
    immediate = false,
    leading = immediate,
    trailing = true,
    maxWait = null,
    context: boundContext = null
  } = normalizedOptions;

  let timerId = null;
  let lastInvokeTime = 0;
  let pendingArgs = null;
  let pendingThis = null;

  const invoke = () => {
    lastInvokeTime = Date.now();
    const result = fn.apply(boundContext ?? pendingThis, pendingArgs ?? []);
    pendingArgs = null;
    pendingThis = null;
    return result;
  };

  const startTimer = () => {
    timerId = setTimeout(() => {
      timerId = null;
      if (trailing && pendingArgs) {
        invoke();
      } else {
        pendingArgs = null;
        pendingThis = null;
      }
    }, delay);
  };

  const debounced = function(...args) {
    const now = Date.now();

    pendingArgs = args;
    pendingThis = this;

    const shouldInvokeLeading = leading && timerId === null;

    if (timerId !== null) {
      clearTimeout(timerId);
    }
    startTimer();

    if (maxWait != null && maxWait >= 0) {
      if (lastInvokeTime === 0) {
        lastInvokeTime = now;
      }
      const timeSinceLastInvoke = now - lastInvokeTime;
      if (timeSinceLastInvoke >= maxWait) {
        return invoke();
      }
    }

    if (shouldInvokeLeading) {
      return invoke();
    }

    return undefined;
  };

  debounced.cancel = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    pendingArgs = null;
    pendingThis = null;
  };

  debounced.flush = () => {
    if (timerId === null) {
      return undefined;
    }
    clearTimeout(timerId);
    timerId = null;
    if (pendingArgs && trailing) {
      return invoke();
    }
    pendingArgs = null;
    pendingThis = null;
    return undefined;
  };

  debounced.isPending = () => timerId !== null;

  return debounced;
}

/**
 * 防抖函数（向后兼容旧签名）
 * @param {Function} fn - 要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @param {boolean} immediate - 是否立即执行
 * @returns {Function} 防抖后的函数
 */
export function debounce(fn, delay = 300, immediate = false) {
  return createDebounced(fn, { delay, immediate });
}

/**
 * 节流函数
 * @param {Function} fn - 要节流的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 节流后的函数
 */
export function throttle(fn, delay = 300) {
  let lastTime = 0;
  return function(...args) {
    const context = this;
    const now = Date.now();
    
    if (now - lastTime >= delay) {
      lastTime = now;
      fn.apply(context, args);
    }
  };
}

/**
 * 使用 requestAnimationFrame 优化的节流函数
 * 适用于需要与浏览器重绘同步的场景（如滚动、resize等）
 * @param {Function} fn - 要节流的函数
 * @returns {Function} 节流后的函数
 */
export function rafThrottle(fn) {
  let rafId = null;
  return function(...args) {
    const context = this;
    
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        fn.apply(context, args);
        rafId = null;
      });
    }
  };
}

/**
 * 批量DOM操作工具
 * 使用 DocumentFragment 减少重排和重绘
 * @param {Function} operation - DOM操作函数，接收 DocumentFragment 作为参数
 * @param {HTMLElement} container - 目标容器
 */
export function batchDOMOperation(operation, container) {
  if (!container) return;
  
  const fragment = document.createDocumentFragment();
  operation(fragment);
  container.appendChild(fragment);
}

/**
 * 批量更新DOM样式，减少重排
 * @param {HTMLElement} element - 要更新的元素
 * @param {Object} styles - 样式对象
 */
export function batchUpdateStyles(element, styles) {
  if (!element || !styles) return;
  
  requestAnimationFrame(() => {
    Object.entries(styles).forEach(([prop, value]) => {
      element.style[prop] = value;
    });
  });
}

/**
 * 延迟执行函数，使用 requestIdleCallback 优化
 * @param {Function} fn - 要执行的函数
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {number} 任务ID，可用于取消
 */
export function idleCallback(fn, timeout = 5000) {
  if ('requestIdleCallback' in window) {
    return requestIdleCallback(fn, { timeout });
  } else {
    // 降级到 setTimeout
    return setTimeout(fn, 0);
  }
}

/**
 * 取消 idleCallback
 * @param {number} id - 任务ID
 */
export function cancelIdleCallback(id) {
  if ('cancelIdleCallback' in window) {
    window.cancelIdleCallback(id);
  } else {
    clearTimeout(id);
  }
}

/**
 * 使用 IntersectionObserver 优化元素可见性检测
 * @param {HTMLElement} element - 要观察的元素
 * @param {Function} callback - 回调函数
 * @param {Object} options - 观察选项
 * @returns {IntersectionObserver} 观察器实例
 */
export function observeElementVisibility(element, callback, options = {}) {
  if (!('IntersectionObserver' in window)) {
    // 降级：直接执行回调
    callback(true);
    return null;
  }
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      callback(entry.isIntersecting);
    });
  }, {
    root: null,
    rootMargin: '0px',
    threshold: 0.1,
    ...options
  });
  
  observer.observe(element);
  return observer;
}

/**
 * 资源池管理类
 * 用于复用频繁创建和销毁的对象，减少GC压力
 */
export class ResourcePool {
  constructor(createFn, resetFn) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.pool = [];
  }
  
  /**
   * 获取资源实例
   * @returns {*} 资源实例
   */
  acquire() {
    return this.pool.pop() || this.createFn();
  }
  
  /**
   * 释放资源实例
   * @param {*} resource 要释放的资源实例
   */
  release(resource) {
    if (this.resetFn && resource) {
      this.resetFn(resource);
    }
    this.pool.push(resource);
  }
  
  /**
   * 清空资源池
   */
  clear() {
    this.pool = [];
  }
}

/**
 * 批量DOM操作优化工具
 * 使用DocumentFragment减少重排重绘
 */
export class BatchDOMOptimizer {
  constructor() {
    this.fragment = null;
    this.container = null;
  }
  
  /**
   * 开始批量操作
   * @param {HTMLElement} container 目标容器
   */
  begin(container) {
    this.fragment = document.createDocumentFragment();
    this.container = container;
  }
  
  /**
   * 添加元素到批量操作中
   * @param {HTMLElement} element 要添加的元素
   */
  append(element) {
    if (this.fragment) {
      this.fragment.appendChild(element);
    }
  }
  
  /**
   * 完成批量操作并应用到DOM
   */
  commit() {
    if (this.fragment && this.container) {
      this.container.appendChild(this.fragment);
      this.fragment = null;
      this.container = null;
    }
  }
}

// 预创建常用的工具实例
const batchOptimizerPool = new ResourcePool(
  () => new BatchDOMOptimizer(),
  (optimizer) => {
    optimizer.fragment = null;
    optimizer.container = null;
  }
);

/**
 * 执行批量DOM操作
 * @param {HTMLElement} container 目标容器
 * @param {Function} operation 操作函数
 */
export function performBatchDOMOperation(container, operation) {
  const optimizer = batchOptimizerPool.acquire();
  try {
    optimizer.begin(container);
    operation(optimizer);
    optimizer.commit();
  } finally {
    batchOptimizerPool.release(optimizer);
  }
}
