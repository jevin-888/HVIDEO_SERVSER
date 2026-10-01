/**
 * 卡片更新模块
 * 负责所有卡片UI更新相关逻辑
 */
import sharedModalManager from '../common/SharedModalManager.js';
import { updateSongCardUIById as updateSongCardUI } from './SongTopRenderer.js';

export class SongTopCardUpdater {
  constructor(ui) {
    this.ui = ui;
  }

  updateSongCardsByIds(songIds = [], optionalContainer = null) {
    if (!updateSongCardUI || !Array.isArray(songIds) || songIds.length === 0) {
      return;
    }

    const container = optionalContainer || sharedModalManager.getContainer();
    if (!container) {
      return;
    }

    const uniqueSongIds = [...new Set(songIds.map(id => String(id)).filter(Boolean))];
    uniqueSongIds.forEach(songId => {
      updateSongCardUI(this.ui, songId, container);
    });
  }

  updateAllSongCardsUI(immediate = false) {
    this.ui._log('debug', '[SongTopUI] updateAllSongCardsUI 被调用', { immediate });
    const container = sharedModalManager.getContainer();
    if (!container) {
      this.ui._log('warn', '[SongTopUI] updateAllSongCardsUI: 容器不存在');
      return;
    }
    if (!updateSongCardUI) {
      this.ui._log('warn', '[SongTopUI] updateAllSongCardsUI: updateSongCardUI 函数不存在');
      return;
    }
    
    const searchInput = sharedModalManager.getSearchInput();
    const isSearchFocused = searchInput && document.activeElement === searchInput;
    
    if (isSearchFocused && !immediate) {
      if (this.ui._updateCardsTimer) {
        this.ui._timerManager.clearTimeout(this.ui._updateCardsTimer);
      }
      this.ui._updateCardsTimer = this.ui._timerManager.addTimeout(() => {
        const stillFocused = searchInput && document.activeElement === searchInput;
        if (!stillFocused) {
          this._updateCardsImmediate(container);
        } else {
          this.ui._timerManager.addTimeout(() => {
            this._updateCardsImmediate(container);
          }, 300);
        }
      }, 500);
      return;
    }
    
    if (immediate) {
      this._updateCardsImmediate(container);
      return;
    }
    
    if (this.ui._updateCardsTimer) {
      this.ui._timerManager.clearTimeout(this.ui._updateCardsTimer);
    }
    
    this.ui._updateCardsTimer = this.ui._timerManager.addTimeout(() => {
      requestAnimationFrame(() => {
        this._updateCardsImmediate(container);
      });
    }, 16);
  }
  
  _updateCardsImmediate(container) {
    if (!updateSongCardUI) {
      this.ui._log('warn', '[SongTopUI] _updateCardsImmediate: updateSongCardUI 函数不存在');
      return;
    }
    
    // 性能优化：优先从grid容器查询，减少查询范围
    const grid = container.querySelector('.grid');
    const searchContainer = grid || container;
    const cards = searchContainer.querySelectorAll('.song-card[data-song-id]');
    if (cards.length === 0) {
      this.ui._log('debug', '[SongTopUI] _updateCardsImmediate: 没有找到歌曲卡片');
      return;
    }
    
    this.ui._log('debug', `[SongTopUI] _updateCardsImmediate: 找到 ${cards.length} 张卡片，开始更新`);
    
    // 性能优化：使用Array.from一次性转换，避免多次迭代
    const cardsToUpdate = [];
    const cardMap = new Map();
    Array.from(cards).forEach(card => {
      const songId = card.dataset.songId;
      if (songId) {
        cardsToUpdate.push(songId);
        cardMap.set(songId, card);
      }
    });
    
    if (cardsToUpdate.length === 0) {
      return;
    }
    
    this.ui._log('debug', `[SongTopUI] _updateCardsImmediate: 准备更新 ${cardsToUpdate.length} 张卡片`);
    
    const total = cardsToUpdate.length;
    let batchSize, useIdle, prioritizeVisible;
    
    if (total < 50) {
      cardsToUpdate.forEach(id => {
        updateSongCardUI(this.ui, id);
      });
      this.ui._log('debug', `[SongTopUI] _updateCardsImmediate: 所有 ${total} 张卡片更新完成`);
      return;
    } else if (total < 150) {
      batchSize = 25;
      useIdle = false;
      prioritizeVisible = false;
    } else {
      batchSize = 20;
      useIdle = true;
      prioritizeVisible = true;
    }
    
    let cardsToUpdateOrdered = cardsToUpdate;
    if (prioritizeVisible && container) {
      const visibleCards = [];
      const hiddenCards = [];
      const containerRect = container.getBoundingClientRect();
      
      cardsToUpdate.forEach(id => {
        const card = cardMap.get(id);
        if (card) {
          const cardRect = card.getBoundingClientRect();
          const isVisible = cardRect.top < containerRect.bottom + 200 && 
                           cardRect.bottom > containerRect.top - 200;
          if (isVisible) {
            visibleCards.push(id);
          } else {
            hiddenCards.push(id);
          }
        } else {
          hiddenCards.push(id);
        }
      });
      
      cardsToUpdateOrdered = [...visibleCards, ...hiddenCards];
    }
    
    let index = 0;
    const updateBatch = () => {
      const endIndex = Math.min(index + batchSize, total);
      const batch = cardsToUpdateOrdered.slice(index, endIndex);
      
      batch.forEach(id => {
        updateSongCardUI(this.ui, id);
      });
      
      index = endIndex;
      
      if (index < total) {
        if (useIdle && 'requestIdleCallback' in window) {
          requestIdleCallback(updateBatch, { timeout: 50 });
        } else {
          requestAnimationFrame(updateBatch);
        }
      } else {
        this.ui._log('debug', `[SongTopUI] _updateCardsImmediate: 所有 ${total} 张卡片更新完成`);
      }
    };
    
    if (useIdle && 'requestIdleCallback' in window) {
      requestIdleCallback(updateBatch, { timeout: 50 });
    } else {
      requestAnimationFrame(updateBatch);
    }
  }
}

