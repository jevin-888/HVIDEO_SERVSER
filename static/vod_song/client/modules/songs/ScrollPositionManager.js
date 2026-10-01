/**
 * 滚动位置管理器
 * 用于在加载新内容时保存和恢复滚动位置，避免页面跳动
 */
export class ScrollPositionManager {
  /**
   * 保存当前滚动位置和锚点卡片信息
   * @param {HTMLElement} container - 滚动容器
   * @param {string} idAttribute - 用于标识卡片的属性名（如 'songId' 或 'singerId'）
   * @returns {Object} 保存的滚动信息
   */
  static saveScrollPosition(container, idAttribute = 'songId') {
    if (!container) return null;
    
    const scrollTopBefore = container.scrollTop;
    const scrollHeightBefore = container.scrollHeight;
    
    const targetGrid = container.querySelector('.grid');
    let anchorCard = null;
    let anchorIndex = -1;
    let anchorOffsetInViewport = 0;
    
    if (targetGrid && targetGrid.children.length > 0) {
      const containerRect = container.getBoundingClientRect();
      for (let i = targetGrid.children.length - 1; i >= 0; i--) {
        const card = targetGrid.children[i];
        const cardRect = card.getBoundingClientRect();
        if (cardRect.bottom > containerRect.top && cardRect.top < containerRect.bottom) {
          anchorCard = card;
          anchorIndex = i;
          anchorOffsetInViewport = cardRect.top - containerRect.top;
          break;
        }
      }
    }
    
    return {
      scrollTopBefore,
      scrollHeightBefore,
      anchorCard,
      anchorIndex,
      anchorOffsetInViewport,
      idAttribute
    };
  }
  
  /**
   * 恢复滚动位置
   * @param {HTMLElement} container - 滚动容器
   * @param {Object} scrollInfo - 保存的滚动信息
   */
  static restoreScrollPosition(container, scrollInfo) {
    if (!container || !scrollInfo) return;
    
    const { scrollTopBefore, scrollHeightBefore, anchorCard, anchorIndex, anchorOffsetInViewport, idAttribute } = scrollInfo;
    const currentGrid = container.querySelector('.grid');
    
    if (anchorCard && anchorIndex >= 0 && anchorOffsetInViewport >= 0 && currentGrid && currentGrid.children[anchorIndex]) {
      const sameCard = currentGrid.children[anchorIndex];
      const anchorId = anchorCard.dataset[idAttribute];
      const sameId = sameCard.dataset[idAttribute];
      
      if (sameCard === anchorCard || (anchorId && anchorId === sameId)) {
        const cardOffsetTop = sameCard.offsetTop;
        const gridOffsetTop = currentGrid.offsetTop;
        container.scrollTop = gridOffsetTop + cardOffsetTop - anchorOffsetInViewport;
        return;
      }
    }
    
    // 如果找不到锚点卡片，使用高度差的方式恢复位置
    const scrollHeightAfter = container.scrollHeight;
    const heightDiff = scrollHeightAfter - scrollHeightBefore;
    container.scrollTop = scrollTopBefore + heightDiff;
  }
  
  /**
   * 准备容器以进行滚动位置恢复（临时隐藏内容）
   * @param {HTMLElement} container - 滚动容器
   * @returns {string} 原始透明度值，用于后续恢复
   */
  static prepareForRestore(container) {
    if (!container) return { hadHiddenClass: false };
    container.dataset._restoringScroll = 'true';
    container.dataset._updatingHeight = 'true';
    const hadHiddenClass = container.classList.contains('unified-scroll-hidden');
    container.classList.add('unified-scroll-hidden');
    return { hadHiddenClass };
  }
  
  /**
   * 完成滚动位置恢复（恢复可见性）
   * @param {HTMLElement} container - 滚动容器
   * @param {Object} restoreState - 由 prepareForRestore 返回的状态对象
   * @param {Function} callback - 可选的回调函数
   */
  static finishRestore(container, restoreState, callback) {
    if (!container) return;
    
    // 强制同步布局计算
    void container.offsetHeight;
    
    // 恢复可见性
    requestAnimationFrame(() => {
      if (!restoreState?.hadHiddenClass) {
        container.classList.remove('unified-scroll-hidden');
      }

      setTimeout(() => {
        delete container.dataset._restoringScroll;
        delete container.dataset._updatingHeight;
        if (callback) callback();
      }, 50);
    });
  }
}
