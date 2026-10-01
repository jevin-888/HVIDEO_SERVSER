/**
 * 歌曲数据加载模块
 * 负责所有数据加载相关逻辑
 */
import { normalizeSingersList } from '../../utils/NormalizeUtils.js';
import { showLoadingIndicator, hideLoadingIndicator, hideNoMoreDataIndicator } from '../../utils/InfiniteScroll.js';
import { ScrollPositionManager } from './ScrollPositionManager.js';
import DomUtils from '../../utils/DomUtils.js';

export class SongTopDataLoader {
  constructor(ui) {
    this.ui = ui;
  }

  async loadData(container, page = 1) {
    const shouldLoadSingers =
      this.ui.currentMode === 'singer' &&
      (this.ui.isShowingSingersList || !this.ui.filterParams?.primarySingerNo);

    if (shouldLoadSingers) {
      await this.loadSingers(container, page);
    } else {
      await this.loadSongs(container, page);
    }
  }

  async loadSongs(container, page = 1) {
    const sessionId = this.ui._sessionId;
    if (!container) return Promise.resolve();
    if (this.ui.loading && this.ui._isSessionActive(sessionId)) {
      this.ui._log('debug', '[SongTopUI] loadSongs 跳过，仍在加载中');
      return Promise.resolve();
    }

    container.classList.remove('unified-scroll-hidden');

    if (page === 1) {
      container.scrollTop = 0;
      delete container.dataset._restoringScroll;
      delete container.dataset._updatingHeight;
      delete container.dataset.autoFillRunning;
      this.ui._resetPrefetchState();
    }

    this.ui._setLoadingState(container, true);

    try {
      // 确保服务已初始化
      await this.ui.initServices();
      if (!this.ui._isSessionActive(sessionId)) return;

      // 简单检查：如果还没有，从全局获取（应该已经在预加载阶段准备好）
      if (!this.ui.songService && typeof window !== 'undefined' && window.songService) {
        this.ui.songService = window.songService;
      }
      
      if (!this.ui.songService) {
        throw new Error('songService 未初始化');
      }

      const requestFilters = this.ui._buildRequestFilterParams();
      let actualMode = this.ui.currentMode;
      let actualFilters = requestFilters;
      if ((this.ui.currentMode === 'language' || this.ui.currentMode === 'category') && 
          Object.keys(requestFilters).length === 0) {
        actualMode = 'top';
        actualFilters = {};
      }
      
      // 性能优化：SongService.loadSongsByMode 内部已实现缓存优先策略
      // 打开点歌页时可设 _skipSongCacheOnce，首屏强制走接口并写回缓存
      const pageSize = (typeof this.ui.getPageSize === 'function') ? this.ui.getPageSize(page) : (page === 1 ? 10 : this.ui.size);
      const loadOpts = {};
      if (this.ui._skipSongCacheOnce && page === 1) {
        loadOpts.skipCache = true;
        this.ui._skipSongCacheOnce = false;
      }
      const result = await this.ui.songService.loadSongsByMode(actualMode, actualFilters, page, pageSize, loadOpts);

      if (!this.ui._isSessionActive(sessionId)) return;

      const songs = this.ui.songService.normalizeSongs(result.list || []);
      const isIndonesianSongs = this.ui.currentMode === 'language' && this.ui.filterParams?.languageCode &&
        ['id', '6', '10'].includes(String(this.ui.filterParams.languageCode));
      const noMoreMessage = isIndonesianSongs ? '没有更多印尼歌曲了' : '没有更多歌曲了';

      // 性能优化：批量清除错误提示元素
      if (page === 1) {
        const errorElements = container.querySelectorAll('.text-center.text-red-500');
        if (errorElements.length > 0) {
          const errorTexts = ['加载失败', '请稍后重试'];
          const toRemove = Array.from(errorElements).filter(el => {
            const text = el.textContent;
            return errorTexts.some(errText => text.includes(errText));
          });
          toRemove.forEach(el => el.remove());
        }
      }

      if (this.ui.renderer?.renderSongs) {
        await this.ui.renderer.renderSongs(this.ui, songs, container, page);
      } else {
        const isFirstPage = page === 1;
        if (isFirstPage) {
          this.ui._clearContainer(container);
        }
        let targetGrid = container.querySelector('.grid');
        if (!targetGrid) {
          targetGrid = document.createElement('div');
          targetGrid.className = 'grid grid-cols-1 gap-2 virtual-grid';
          container.appendChild(targetGrid);
        }
        if (!Array.isArray(songs) || songs.length === 0) {
          if (page === 1) {
            this.ui._showNoMoreData(container, noMoreMessage);
          }
          container.dataset.done = 'true';
          return;
        }
        // 性能优化：批量创建卡片，减少DOM操作
        const frag = document.createDocumentFragment();
        // 预分配数组大小，减少内存重新分配
        const cards = new Array(songs.length);
        for (let i = 0; i < songs.length; i++) {
          const card = this.ui.createSongCard(songs[i]);
          if (card) {
            cards[i] = card;
            frag.appendChild(card);
          }
        }
        if (frag.childNodes.length > 0) {
          targetGrid.appendChild(frag);
        }
        if (targetGrid.parentNode !== container) {
          container.appendChild(targetGrid);
        }
      }

      if (!this.ui._isSessionActive(sessionId)) return;

      this.ui.page = page;
      if (page === 1 && (!songs || songs.length === 0)) {
        container.dataset.done = 'true';
        this.ui._showNoMoreData(container, noMoreMessage);
      } else if (!songs || songs.length < pageSize) {
        container.dataset.done = 'true';
        this.ui._showNoMoreData(container, noMoreMessage);
      } else {
        container.dataset.done = 'false';
        hideNoMoreDataIndicator(container);
      }

      this.ui.ensureScrollContainerStyles(container);

      if (page === 1) {
        requestAnimationFrame(() => {
          if (this.ui._isSessionActive(sessionId)) {
            this.ui.updateAllSongCardsUI?.(true);
          }
        });
      }
    } catch (e) {
      if (this.ui._isSessionActive(sessionId)) {
        console.error('[SongTopUI] 加载歌曲失败:', e);
        if (page === 1) {
          const errorEl = document.createElement('div');
          errorEl.className = 'text-center text-red-500 py-10';
          errorEl.textContent = '加载失败，请稍后重试';
          container.appendChild(errorEl);
          this.ui._timerManager.addTimeout(() => errorEl.remove(), 3000);
        }
      }
    } finally {
      hideLoadingIndicator(container);
      const isActive = this.ui._isSessionActive(sessionId);
      if (isActive || container) {
        this.ui._setLoadingState(container, false);
        if (isActive) {
          const shouldPrefetch =
            page === 1 &&
            !this.ui._skipNextPrefetch &&
            this._shouldPrefetchAfterInitialLoad(container);
          if (shouldPrefetch) {
            requestAnimationFrame(() => this._prefetchNextPage(container, sessionId));
          }
        }
      }
      this.ui._skipNextPrefetch = false;
    }
  }

  async loadSingers(container, page = 1) {
    const sessionId = this.ui._sessionId;
    try {
      if (!container) return;
      container.classList.remove('unified-scroll-hidden');
      await this.ui.initServices();
      if (!this.ui._isSessionActive(sessionId)) return;
      
      if (!this.ui.singerService) {
        throw new Error('[SongTopUI] singerService 未正确初始化');
      }
      
      this.ui._setLoadingState(container, true);
      this.ui.singersPage = page;
      
      let singers = [];
      let receivedCount = 0;
      const hasFilters = !!(this.ui.singerFilters?.sex || this.ui.singerFilters?.region || this.ui.singerFilters?.keyword);
      if (page === 1 && !hasFilters) {
        try {
          const cacheService = DomUtils.getCacheService();
          if (cacheService) {
            singers = cacheService.getPreloadedTopSingers();
            receivedCount = Array.isArray(singers) ? singers.length : 0;
          }
        } catch (cacheError) {
          console.warn('[SongTopUI] 获取缓存歌星数据失败:', cacheError);
        }
      }
      
      if ((!singers || singers.length === 0) || page > 1 || hasFilters) {
        let resp;
        if (hasFilters) {
          if (this.ui.singerFilters.keyword) {
            const searchParams = {
              page,
              pageSize: this.ui.singersSize,
              keyword: this.ui.singerFilters.keyword.trim()
            };
            if (this.ui.singerFilters.sex) searchParams.sexCode = this.ui.singerFilters.sex;
            if (this.ui.singerFilters.region) searchParams.regionCode = this.ui.singerFilters.region;
            resp = await this.ui.singerService.getSingerList(searchParams);
            singers = normalizeSingersList(resp);
          } else {
            resp = await this.ui.singerService.getSingersByFilters(this.ui.singerFilters, page, this.ui.singersSize);
            singers = normalizeSingersList(resp.list || resp);
          }
        } else {
          resp = await this.ui.singerService.getTopSingers({ page, pageSize: this.ui.singersSize });
          singers = normalizeSingersList(resp);
        }
        receivedCount = Array.isArray(singers) ? singers.length : 0;
      }
      
      if (!this.ui._isSessionActive(sessionId)) return;
      
      // 性能优化：使用for循环替代filter，减少函数调用开销
      const filteredSingers = [];
      for (let i = 0; i < singers.length; i++) {
        const item = singers[i];
        const hasSingerField = item.singerNo || item.singerName;
        const hasSongField = item.songNo || item.songName;
        if (hasSingerField && !hasSongField) {
          filteredSingers.push(item);
        }
      }
      singers = filteredSingers;
      
      // 性能优化：批量清除错误提示元素
      if (page === 1) {
        const errorElements = container.querySelectorAll('.text-center.text-red-500');
        if (errorElements.length > 0) {
          const errorTexts = ['加载失败', '请稍后重试'];
          const toRemove = Array.from(errorElements).filter(el => {
            const text = el.textContent;
            return errorTexts.some(errText => text.includes(errText));
          });
          toRemove.forEach(el => el.remove());
        }
      }
      
      if (this.ui.renderer?.renderSingers) {
        this.ui.renderer.renderSingers(this.ui, singers, container, page);
      }
      
      if (page === 1 && (!singers || singers.length === 0)) {
        container.dataset.done = 'true';
      } else if (receivedCount < this.ui.singersSize) {
        container.dataset.done = 'true';
      } else {
        container.dataset.done = 'false';
      }
      
      container.classList.remove('unified-scroll-hidden');
      this.ui.renderFilterTags();
    } catch (err) {
      console.error('[SongTopUI] 加载歌星列表失败:', err);
      container.classList.remove('unified-scroll-hidden');
      if (page === 1) {
        const errorEl = document.createElement('div');
        errorEl.className = 'text-center text-red-500 py-10';
        errorEl.textContent = '加载歌星列表失败，请稍后重试';
        const grid = container.querySelector('.grid');
        if (grid) {
          this.ui._clearContainer(grid);
          grid.appendChild(errorEl);
        } else {
          container.appendChild(errorEl);
        }
      }
    } finally {
      this.ui._setLoadingState(container, false);
    }
  }

  async loadMoreSongs(container) {
    if (!this.ui._isModalActive()) return;
    await this._loadMoreItems({
      container,
      loadData: async () => {
        const nextPage = this.ui.page + 1;
        const requestFilters = this.ui._buildRequestFilterParams();
        
        // 简单检查：如果还没有，从全局获取
        if (!this.ui.songService && typeof window !== 'undefined' && window.songService) {
          this.ui.songService = window.songService;
        }
        
        if (!this.ui.songService) {
          throw new Error('songService 未初始化');
        }
        
        const result = await this.ui.songService.loadSongsByMode(this.ui.currentMode, requestFilters, nextPage, this.ui.size);
        return this.ui.songService.normalizeSongs(result.list || []);
      },
      renderItems: async (songs, container, page, targetGrid) => {
        if (this.ui.renderer?.renderSongs) {
          await this.ui.renderer.renderSongs(this.ui, songs, container, page);
        } else {
          if (!targetGrid) {
            targetGrid = document.createElement('div');
            targetGrid.className = 'grid grid-cols-1 gap-2 virtual-grid';
            container.appendChild(targetGrid);
          }
          const frag = document.createDocumentFragment();
          songs.forEach(s => {
            const card = this.ui.createSongCard(s);
            if (card) frag.appendChild(card);
          });
          targetGrid.appendChild(frag);
        }
      },
      createCard: (song) => this.ui.createSongCard(song),
      idAttribute: 'songId',
      emptyMessage: '没有更多歌曲了',
      pageSize: this.ui.size,
      getNextPage: () => this.ui.page + 1,
      updatePage: (page) => { this.ui.page = page; },
      sessionId: this.ui._sessionId
    });
  }

  async loadMoreSingers(container) {
    await this._loadMoreItems({
      container,
      loadData: async () => {
        const nextPage = this.ui.singersPage + 1;
        if (!this.ui.singerService) {
          throw new Error('[SongTopUI] singerService 未正确初始化');
        }
        
        let resp;
        const hasFilters = !!(this.ui.singerFilters?.sex || this.ui.singerFilters?.region || this.ui.singerFilters?.keyword);
        let singers;
        let receivedCount = 0;
        if (hasFilters) {
          if (this.ui.singerFilters.keyword) {
            const allResults = await this.ui.singerService.searchSingers(this.ui.singerFilters.keyword);
            if (Array.isArray(allResults)) {
              const startIndex = (nextPage - 1) * this.ui.singersSize;
              const endIndex = startIndex + this.ui.singersSize;
              singers = allResults.slice(startIndex, endIndex);
              receivedCount = singers.length;
            } else {
              singers = normalizeSingersList(allResults);
              receivedCount = Array.isArray(singers) ? singers.length : 0;
            }
          } else {
            resp = await this.ui.singerService.getSingersByFilters(this.ui.singerFilters, nextPage, this.ui.singersSize);
            singers = normalizeSingersList(resp.list || resp);
            receivedCount = Array.isArray(resp?.list) ? resp.list.length : (Array.isArray(singers) ? singers.length : 0);
          }
        } else {
          resp = await this.ui.singerService.getTopSingers({ page: nextPage, pageSize: this.ui.singersSize });
          singers = normalizeSingersList(resp);
          receivedCount = Array.isArray(resp) ? resp.length : (Array.isArray(singers) ? singers.length : 0);
        }
        
        // 性能优化：使用for循环替代filter，减少函数调用开销
        const filteredSingers = [];
        for (let i = 0; i < singers.length; i++) {
          const item = singers[i];
          const hasSingerField = item.singerNo || item.singerName;
          const hasSongField = item.songNo || item.songName;
          const isSinger = hasSingerField && !hasSongField;
          if (!isSinger) continue;
          const singerName = item.singerName || '';
          if (!/^\s*DJ\s*$/i.test(singerName)) {
            filteredSingers.push(item);
          }
        }
        singers = filteredSingers;
        
        return {
          items: singers,
          receivedCount
        };
      },
      renderItems: (singers, container, page, targetGrid) => {
        if (this.ui.renderer?.renderSingers) {
          this.ui.renderer.renderSingers(this.ui, singers, container, page);
        } else {
          if (!targetGrid) {
            targetGrid = document.createElement('div');
            targetGrid.className = 'grid grid-cols-1 gap-2';
            container.appendChild(targetGrid);
          }
          // 性能优化：批量创建卡片
          const frag = document.createDocumentFragment();
          for (let i = 0; i < singers.length; i++) {
            const card = this.ui.createSingerCard(singers[i]);
            if (card) frag.appendChild(card);
          }
          if (frag.childNodes.length > 0) {
            targetGrid.appendChild(frag);
          }
        }
      },
      createCard: (singer) => this.ui.createSingerCard(singer),
      idAttribute: 'singerId',
      emptyMessage: '没有更多歌星了',
      pageSize: this.ui.singersSize,
      getNextPage: () => this.ui.singersPage + 1,
      updatePage: (page) => { this.ui.singersPage = page; },
      shouldMarkDone: ({ receivedCount, items, pageSize }) => {
        const count = typeof receivedCount === 'number' ? receivedCount : (Array.isArray(items) ? items.length : 0);
        return count < pageSize;
      }
    });
  }

  async _loadMoreItems({
    container,
    loadData,
    renderItems,
    createCard,
    idAttribute,
    emptyMessage,
    pageSize,
    getNextPage,
    updatePage,
    sessionId = this.ui._sessionId,
    shouldMarkDone = null
  }) {
    if (this.ui.loading || !container) return Promise.resolve();
    if (!this.ui._isModalActive()) return Promise.resolve();
    if (!this.ui._isSessionActive(sessionId)) return Promise.resolve();
    
    const scrollInfo = ScrollPositionManager.saveScrollPosition(container, idAttribute);
    const nextPage = getNextPage();
    
    try {
      this.ui._setLoadingState(container, true);
      const targetGrid = container.querySelector('.grid');
      showLoadingIndicator(container, targetGrid);
      
      await this.ui.initServices();
      if (!this.ui._isSessionActive(sessionId)) {
        this.ui._cleanupLoadingState(container);
        return;
      }
      const loadResult = await loadData();
      const items = Array.isArray(loadResult) ? loadResult : loadResult?.items;
      const receivedCount = Array.isArray(loadResult) ? loadResult.length : loadResult?.receivedCount;
      if (!this.ui._isModalActive() || !this.ui._isSessionActive(sessionId)) {
        this.ui._cleanupLoadingState(container);
        return;
      }
      
      hideLoadingIndicator(container);
      
      if (!items || items.length === 0) {
        container.dataset.done = 'true';
        this.ui._showNoMoreData(container, emptyMessage);
        this.ui._setLoadingState(container, false);
        return;
      }
      
      const restoreState = ScrollPositionManager.prepareForRestore(container);
      
      if (renderItems) {
        await renderItems(items, container, nextPage, targetGrid);
      } else {
        let grid = targetGrid || container.querySelector('.grid');
        if (!grid) {
          grid = document.createElement('div');
          grid.className = 'grid grid-cols-1 gap-2';
          container.appendChild(grid);
        }
        // 性能优化：批量创建卡片
        const frag = document.createDocumentFragment();
        for (let i = 0; i < items.length; i++) {
          const card = createCard(items[i]);
          if (card) frag.appendChild(card);
        }
        if (frag.childNodes.length > 0) {
          grid.appendChild(frag);
        }
      }
      
      void container.offsetHeight;
      
      if (this.ui.updateModalHeight) {
        this.ui.updateModalHeight();
      }
      
      this.ui._restoreScrollPosition(container, scrollInfo, restoreState, () => {
        if (this.ui._isSessionActive(sessionId)) {
          this.ui._setLoadingState(container, false);
        }
      });
      if (!this.ui._isModalActive() || !this.ui._isSessionActive(sessionId)) {
        this.ui._setLoadingState(container, false);
        if (!this.ui._isModalActive()) container.dataset.done = 'true';
        return;
      }

      updatePage(nextPage);
      
      const doneByCount = typeof shouldMarkDone === 'function'
        ? shouldMarkDone({ items, receivedCount, pageSize, loadResult })
        : (!items || items.length < pageSize);

      if (doneByCount) {
        container.dataset.done = 'true';
        this.ui._showNoMoreData(container, emptyMessage);
      } else {
        container.dataset.done = 'false';
        hideNoMoreDataIndicator(container);
      }
      
      this.ui.renderFilterTags();
    } catch (error) {
      if (this.ui._isSessionActive(sessionId)) {
        console.error('[SongTopUI] 加载更多项目失败:', error);
        this.ui._setLoadingState(container, false);
        container.dataset.done = 'true';
      }
      hideLoadingIndicator(container);
      delete container.dataset._restoringScroll;
      delete container.dataset._updatingHeight;
    } finally {
      if (container.dataset._restoringScroll !== 'true' && container.dataset._updatingHeight !== 'true') {
        delete container.dataset._restoringScroll;
        delete container.dataset._updatingHeight;
      }
      if (this.ui._isSessionActive(sessionId) && this.ui.loading) {
        this.ui._setLoadingState(container, false);
      }
    }
  }

  _shouldPrefetchAfterInitialLoad(container) {
    if (!container) return false;
    if (container.dataset && container.dataset.done === 'true') return false;
    return true;
  }

  _ensureContainerFilled(container) {
    if (!container) return;
    if (!this.ui._isModalActive()) return;
    if (container.dataset.done === 'true') return;
    if (container.dataset.autoFillRunning === 'true') return;

    const sessionId = this.ui._sessionId;
    const cleanup = () => {
      delete container.dataset.autoFillRunning;
    };

    const checkAndLoad = () => {
      if (!container || !this.ui._isSessionActive(sessionId) || !this.ui._isModalActive()) {
        cleanup();
        return;
      }
      if (container.dataset.done === 'true') {
        cleanup();
        return;
      }

      const scrollRange = container.scrollHeight - container.clientHeight;
      if (scrollRange <= 0) {
        cleanup();
        return;
      }

      const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
      const needsMore = distanceToBottom <= 400;
      if (!needsMore) {
        cleanup();
        return;
      }

      if (this.ui._prefetchedSongs && this.ui._prefetchedSongs.sessionId !== sessionId) {
        this.ui._prefetchedSongs = null;
        this.ui._prefetchedSessionId = 0;
      }

      if (this.ui._prefetchedSongs && this.ui._prefetchedSongs.sessionId === sessionId) {
        const { songs, done, page: nextPage } = this.ui._prefetchedSongs;
        this.ui._prefetchedSongs = null;
        this.ui._prefetchedSessionId = 0;

        if (Array.isArray(songs) && songs.length > 0) {
          hideNoMoreDataIndicator(container);
          if (!this.ui.renderer?.renderSongs) {
            let targetGrid = container.querySelector('.grid');
            if (!targetGrid) {
              targetGrid = document.createElement('div');
              targetGrid.className = 'grid grid-cols-1 gap-2 virtual-grid';
              container.appendChild(targetGrid);
            }
            // 性能优化：批量创建卡片
            const frag = document.createDocumentFragment();
            for (let i = 0; i < songs.length; i++) {
              const card = this.ui.createSongCard(songs[i]);
              if (card) frag.appendChild(card);
            }
            if (frag.childNodes.length > 0) {
              targetGrid.appendChild(frag);
            }
            this.ui.page = nextPage;
            container.dataset.done = done ? 'true' : 'false';
            if (!done) {
              this._prefetchNextPage(container, sessionId);
            }
            cleanup();
            return;
          }

          const scrollInfo = ScrollPositionManager.saveScrollPosition(container, 'songId');
          const restoreState = ScrollPositionManager.prepareForRestore(container);
          Promise.resolve(this.ui.renderer?.renderSongs?.(this.ui, songs, container, nextPage))
            .then(() => {
              if (!this.ui._isSessionActive(sessionId)) return;
              this.ui.page = nextPage;
              container.dataset.done = done ? 'true' : 'false';
              this.ui._restoreScrollPosition(container, scrollInfo, restoreState, () => {
                container.dataset.loading = 'false';
              });
              if (!done) {
                this._prefetchNextPage(container, sessionId);
              }
            })
            .catch(error => {
              console.error('[SongTopUI] 追加预取歌曲失败:', error);
              container.dataset.done = 'true';
              this.ui._restoreScrollPosition(container, null, restoreState, () => {
                container.dataset.loading = 'false';
              });
            })
            .finally(() => {
              cleanup();
            });
          return;
        }

        container.dataset.done = 'true';
        this.ui._showNoMoreData(container, '没有更多歌曲了');
        cleanup();
        return;
      }

      if ((this.ui._prefetching && this.ui._prefetchingSessionId === sessionId) || this.ui.loading || container.dataset.loading === 'true') {
        requestAnimationFrame(checkAndLoad);
        return;
      }

      Promise.resolve(this._prefetchNextPage(container, sessionId))
        .finally(() => {
          if (this.ui._isSessionActive(sessionId) && container.dataset.autoFillRunning === 'true') {
            requestAnimationFrame(checkAndLoad);
          } else {
            cleanup();
          }
        });
    };

    container.dataset.autoFillRunning = 'true';
    requestAnimationFrame(checkAndLoad);
  }

  async _prefetchNextPage(container, sessionId = this.ui._sessionId) {
    if (!container) return;
    if (!this.ui._isModalActive()) return;
    if (!this.ui._isSessionActive(sessionId)) return;
    if (container.dataset.done === 'true') return;
    if (this.ui._prefetching && this.ui._prefetchingSessionId === sessionId) return;

    const nextPage = this.ui.page + 1;
    this.ui._prefetching = true;
    this.ui._prefetchingSessionId = sessionId;
    try {
      // 确保服务已初始化
      await this.ui.initServices();
      if (!this.ui._isSessionActive(sessionId)) return;
      
      // 简单检查：如果还没有，从全局获取
      if (!this.ui.songService && typeof window !== 'undefined' && window.songService) {
        this.ui.songService = window.songService;
      }
      
      if (!this.ui.songService) {
        throw new Error('songService 未初始化');
      }
      
      const requestFilters = this.ui._buildRequestFilterParams();
      const result = await this.ui.songService.loadSongsByMode(this.ui.currentMode, requestFilters, nextPage, this.ui.size);
      if (!this.ui._isSessionActive(sessionId)) return;

      const songs = this.ui.songService.normalizeSongs(result.list || []);
      if (!this.ui._isSessionActive(sessionId)) return;
      
      if (!songs || songs.length === 0) {
        this.ui._prefetchedSongs = null;
        this.ui._prefetchedSessionId = sessionId;
        container.dataset.done = 'true';
        this.ui._showNoMoreData(container, '没有更多歌曲了');
      } else {
        const done = songs.length < this.ui.size;
        this.ui._prefetchedSongs = { sessionId, page: nextPage, songs, done };
        this.ui._prefetchedSessionId = sessionId;
        container.dataset.done = done ? 'true' : 'false';
        if (done) {
          this.ui._showNoMoreData(container, '没有更多歌曲了');
        } else {
          hideNoMoreDataIndicator(container);
        }
      }
    } catch (error) {
      if (this.ui._isSessionActive(sessionId)) {
        console.error('[SongTopUI] 预取下一页歌曲失败:', error);
      }
      this.ui._prefetchedSongs = null;
    } finally {
      if (this.ui._prefetchingSessionId === sessionId) {
        this.ui._prefetching = false;
        this.ui._prefetchingSessionId = 0;
      }
    }
  }
}

