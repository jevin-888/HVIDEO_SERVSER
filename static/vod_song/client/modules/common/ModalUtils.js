/**
 * 模态框工具函数
 * 用于共享 hideAllButtons 等通用函数
 * 性能优化：缓存DOM元素查询结果
 */

// 模态框动画相关常量（性能优化：提取为常量，避免重复定义）
export const MODAL_ANIMATION_CLASSES = {
  TO_REMOVE: ['transform', 'transition-transform', 'duration-300', 'unified-modal-closing', 'unified-modal-closing-active', 'unified-modal-slide-transition', 'unified-modal-no-transition'],
  CONTAINER: 'unified-modal-container',
  SLIDE_TRANSITION: 'unified-modal-slide-transition',
  CLOSING: 'unified-modal-closing',
  CLOSING_ACTIVE: 'unified-modal-closing-active',
  VISIBLE: 'song-modal-visible'
};

// 缓存频繁查询的DOM元素，避免重复查询
let _cachedElements = {
  topButtonsSection: null,
  bottomButtonsSection: null,
  homeBtn: null,
  bottomNav: null,
  lastCacheTime: 0
};

// 缓存有效期：5秒，避免DOM结构变化后使用过期缓存
const CACHE_TTL = 5000;

/**
 * 获取缓存的DOM元素，如果缓存过期则重新查询
 * @private
 */
function _getCachedElement(key, queryFn) {
  const now = Date.now();
  // 如果缓存过期或元素不存在，重新查询
  if (now - _cachedElements.lastCacheTime > CACHE_TTL || !_cachedElements[key]) {
    _cachedElements[key] = queryFn();
    _cachedElements.lastCacheTime = now;
  }
  return _cachedElements[key];
}

/**
 * 清除DOM元素缓存（当DOM结构发生变化时调用）
 */
export function clearElementCache() {
  if (typeof window !== 'undefined' && window.logService?.info) {
    window.logService.info('[按钮] clearElementCache: 清空 DOM 缓存，确保下次 hide/show 使用最新节点');
  }
  _cachedElements = {
    topButtonsSection: null,
    bottomButtonsSection: null,
    homeBtn: null,
    bottomNav: null,
    lastCacheTime: 0
  };
}

function _getSectionElements() {
  return {
    topButtonsSection: document.getElementById('top-buttons-section'),
    homeCta: document.getElementById('home-cta-section')
  };
}

// 隐藏所有按钮（打开模态框时调用）
export function hideAllButtons() {
  if (typeof window !== 'undefined' && window.logService?.info) {
    window.logService.info('[按钮] hideAllButtons: 隐藏 顶部栏+派对/点歌/点单 三按钮，显示 首页按钮');
  }
  let { topButtonsSection, homeCta } = _getSectionElements();
  if (!topButtonsSection || !homeCta) {
    if (typeof window !== 'undefined' && window.logService?.warn) {
      window.logService.warn('[按钮] hideAllButtons: 首次未取到 section 节点，清缓存后重试', { top: !!topButtonsSection, homeCta: !!homeCta });
    }
    clearElementCache();
    const retry = _getSectionElements();
    topButtonsSection = retry.topButtonsSection;
    homeCta = retry.homeCta;
    if (typeof window !== 'undefined' && window.logService && (!topButtonsSection || !homeCta)) {
      window.logService.error('[按钮] hideAllButtons: 重试后仍未找到 #top-buttons-section 或 #home-cta-section，三按钮可能无法隐藏，请确认 index.html 已包含对应 id');
    }
  }
  const homeBtn = document.getElementById('home-btn');

  if (topButtonsSection) {
    topButtonsSection.classList.remove('home-buttons-visible');
    topButtonsSection.classList.add('home-buttons-hidden');
  }
  if (homeCta) {
    homeCta.classList.remove('home-buttons-visible');
    homeCta.classList.add('home-buttons-hidden');
  }
  if (homeBtn) {
    homeBtn.classList.remove('hidden');
    homeBtn.classList.add('force-show'); // 强制显示，覆盖 CSS media query
  }
  if (typeof window !== 'undefined' && window.logService?.info) {
    window.logService.info('[按钮] hideAllButtons: 已对 #top-buttons-section、#home-cta-section 加 hidden，已显示 #home-btn');
  }
}

// 显示所有按钮（恢复初始状态）
// 无论谁调用，都先隐藏 unified-modal，避免外部只调 showAllButtons 时派对/点歌页不关
export function showAllButtons() {
  const unifiedModal = document.getElementById('unified-modal');
  if (unifiedModal) {
    unifiedModal.classList.add('hidden');
    unifiedModal.classList.remove(MODAL_ANIMATION_CLASSES.VISIBLE);
  }
  if (typeof window !== 'undefined' && window.logService?.info) {
    window.logService.info('[按钮] showAllButtons: 显示 顶部栏+派对/点歌/点单 三按钮，隐藏 首页按钮');
  }
  const topButtonsSection = document.getElementById('top-buttons-section');
  const homeCta = document.getElementById('home-cta-section');

  if (topButtonsSection) {
    topButtonsSection.classList.remove('home-buttons-hidden');
    topButtonsSection.classList.add('home-buttons-visible');
  }
  if (homeCta) {
    homeCta.classList.remove('home-buttons-hidden');
    homeCta.classList.add('home-buttons-visible');
  }
  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) {
    homeBtn.classList.add('hidden');
    homeBtn.classList.remove('force-show'); // 移除强制显示
  }
  if (typeof window !== 'undefined' && window.logService?.info) {
    window.logService.info('[按钮] showAllButtons: 已对 #top-buttons-section、#home-cta-section 加 visible，已隐藏 #home-btn');
  }
}

// 仅恢复按钮显示状态，不关闭 unified-modal（已选面板关闭时使用）
// 与 showAllButtons 的区别：不操作 #unified-modal，避免误关点歌/派对页
export function showAllButtonsOnly() {
  if (typeof window !== 'undefined' && window.logService?.info) {
    window.logService.info('[按钮] showAllButtonsOnly: 仅恢复按钮，不关闭 unified-modal');
  }
  const topButtonsSection = document.getElementById('top-buttons-section');
  const homeCta = document.getElementById('home-cta-section');

  if (topButtonsSection) {
    topButtonsSection.classList.remove('home-buttons-hidden');
    topButtonsSection.classList.add('home-buttons-visible');
  }
  if (homeCta) {
    homeCta.classList.remove('home-buttons-hidden');
    homeCta.classList.add('home-buttons-visible');
  }
  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) {
    homeBtn.classList.add('hidden');
    homeBtn.classList.remove('force-show'); // 移除强制显示
  }
  if (typeof window !== 'undefined' && window.logService?.info) {
    window.logService.info('[按钮] showAllButtonsOnly: 按钮已恢复，unified-modal 未受影响');
  }
}

/**
 * 获取缓存的 homeBtn（性能优化：避免重复查询）
 */
export function getHomeBtn() {
  return _getCachedElement('homeBtn', () =>
    document.getElementById('home-btn')
  );
}

/**
 * 设置硬件加速样式（性能优化：批量设置，减少重排）
 * @param {HTMLElement} element - 要设置样式的元素
 */
export function setHardwareAcceleration(element) {
  if (!element) return;
  Object.assign(element.style, {
    willChange: 'transform, opacity',
    transform: 'translateZ(0)',
    backfaceVisibility: 'hidden'
  });
}

/**
 * 清理硬件加速样式（性能优化：批量清理，避免内存泄漏）
 * @param {HTMLElement} element - 要清理样式的元素
 */
export function clearHardwareAcceleration(element) {
  if (!element) return;
  // 批量清理所有相关样式属性
  const propsToRemove = ['willChange', 'transform', 'backfaceVisibility'];
  propsToRemove.forEach(prop => {
    element.style.removeProperty(prop);
  });
}

/**
 * 重置模态框类（性能优化：批量操作，减少重排）
 * @param {HTMLElement} content - 模态框内容元素
 */
export function resetModalClasses(content) {
  if (!content) return;
  // 批量移除所有动画相关类
  content.classList.remove(...MODAL_ANIMATION_CLASSES.TO_REMOVE);
  // 添加基础容器类
  content.classList.add(MODAL_ANIMATION_CLASSES.CONTAINER);
}