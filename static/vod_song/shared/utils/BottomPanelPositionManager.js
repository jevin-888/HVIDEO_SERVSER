/**
 * 底部面板位置管理器
 * 动态计算面板位置，确保显示在底部导航按钮上方
 * 使用 CSS 变量方案，避免频繁触发重排，优化性能
 */
export class BottomPanelPositionManager {
  /**
   * 获取底部导航实际可见操作区高度
   * 优先使用按钮/可交互元素的最高顶边，避免容器留白影响面板定位
   * @param {HTMLElement} nav
   * @returns {number}
   */
  static getEffectiveNavHeight(nav) {
    if (!nav) return 0;
    // 直接用 offsetHeight，避免遍历所有按钮触发大量 getBoundingClientRect
    const navGrid = nav.querySelector('.bottom-nav-grid');
    if (navGrid) {
      return navGrid.offsetHeight || nav.offsetHeight || 0;
    }
    return nav.offsetHeight || 0;
  }

  /**
   * 更新底部导航栏高度缓存
   * 在导航栏渲染完成后调用，存储实际高度
   * @param {HTMLElement} bottomNav - 底部导航栏元素（可选，如果不传会自动查找）
   */
  static updateNavHeightCache(bottomNav = null) {
    const nav = bottomNav || document.getElementById('bottom-nav');
    if (!nav) return;
    const navHeight = this.getEffectiveNavHeight(nav);
    if (navHeight > 0) {
      nav.dataset.height = navHeight.toString();
    }
  }

  /**
   * 计算并设置底部面板的位置
   * 直接使用存储的导航栏高度，简单准确
   * @param {HTMLElement} panelContent - 面板内容元素（如 .panel-content-container, #selectedProductsModalContent）
   * @param {number} spacing - 面板与底部导航栏的间距（默认4px）
   * @param {boolean} forceRecalculate - 是否强制重新计算（默认false）
   */
  static updatePanelPosition(panelContent, spacing = 4, forceRecalculate = false) {
    if (!panelContent) return;
    
    panelContent.style.removeProperty('top');
    
    const bottomNav = document.getElementById('bottom-nav');
    if (!bottomNav) {
      panelContent.style.setProperty('--panel-bottom', `${80 + spacing}px`);
      panelContent.style.setProperty('bottom', `${80 + spacing}px`);
      return;
    }
    
    if (forceRecalculate || !bottomNav.dataset.height) {
      this.updateNavHeightCache(bottomNav);
    }
    
    let navHeight = parseInt(bottomNav.dataset.height, 10) || 80;
    const panelBottom = navHeight + spacing + 80;
    const TOP_OFFSET = 0; // 距顶部间距
    
    // 用 top+bottom 定位，让面板高度自动撑满，不手动设置 height
    panelContent.style.removeProperty('height');
    panelContent.style.removeProperty('max-height');
    panelContent.style.setProperty('top', `${TOP_OFFSET}px`);
    panelContent.style.setProperty('bottom', `${panelBottom}px`);
    panelContent.style.position = 'fixed';
    panelContent.style.left = '0';
    panelContent.style.right = '0';
  }
  
  /**
   * 更新所有已打开的面板位置
   * 在窗口大小变化或导航栏位置变化时调用
   * @param {number} spacing - 面板与底部导航栏的间距（默认4px）
   */
  static updateAllPanelsPosition(spacing = 4) {
    // 更新底部导航栏高度缓存（强制重新计算）
    const bottomNav = document.getElementById('bottom-nav');
    if (bottomNav) {
      this.updateNavHeightCache(bottomNav);
    }
    
    // 更新所有已打开的面板（统一使用 .panel-content-container 选择器）
    const panelIds = ['smart-panel', 'display-panel', 'selected-panel'];
    panelIds.forEach(panelId => {
      const panelElement = document.getElementById(panelId);
      if (!panelElement || panelElement.classList.contains('hidden')) return;
      
      const panelContent = panelElement.querySelector('.panel-content-container');
      if (panelContent) {
        // 使用缓存的高度值，不需要强制重新计算（已在上面更新）
        this.updatePanelPosition(panelContent, spacing, false);
      }
    });
    
    // 更新已选商品模态框位置（如果已打开）
    const selectedProductsModal = document.getElementById('selectedProductsModal');
    if (selectedProductsModal && !selectedProductsModal.classList.contains('hidden')) {
      const modalContent = selectedProductsModal.querySelector('#selectedProductsModalContent');
      if (modalContent) {
        // 使用缓存的高度值，不需要强制重新计算（已在上面更新）
        this.updatePanelPosition(modalContent, spacing, false);
      }
    }
  }
}

