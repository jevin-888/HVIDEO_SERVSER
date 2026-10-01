import apiService from '../../core/ApiService.js';
import cacheService from '../../services/CacheService.js';
import { normalizeSongsList, normalizePlayList } from '../../utils/NormalizeUtils.js';
import { handleError } from '../../utils/ErrorHandler.js';
import { parseSongListResponse } from '../../utils/ResponseParser.js';
import DomUtils from '../../utils/DomUtils.js';
import { createDebounced } from '../../utils/PerformanceUtils.js';
import { isApiOk, getApiErrorMessage } from '../../utils/ApiResponseUtils.js';
import songSearchService from './SongSearchService.js';

/**
 * 歌曲业务逻辑
 */
class SongService {
  constructor() {
    this.apiService = apiService;
    this._logService = null;
    // 已点播歌曲跟踪 - 存储已点播歌曲的ID
    this.requestedSongs = new Set();
    this._requestingSongIds = new Set();
    // 已选列表详细信息
    this.selectedSongs = [];
    // 优化：使用Map建立songId到索引和信息的映射，实现O(1)查找
    this._songIdToIndexMap = new Map();
    this._songIdToInfoMap = new Map();
    this._catalogSongMap = new Map();
    // 防抖定时器（使用统一的防抖函数）
    this._syncDebounced = null;
    // 并发同步防护：避免多个 force 同步同时发起导致竞态
    this._syncPromise = null;
    this._pendingSyncRequested = false;
    // 同步完成的时间戳
    this._lastSyncTime = 0;
    this._queueStateVersion = 0;
    this._pendingSkippedHeadIds = new Set();
    this._pendingRemovedSongIds = new Set();
    this._resyncGeneration = 0;
    this._postMutationResyncTimers = [];
    this._authoritativeResyncDelays = [150, 350, 700];
    /** 为 true 时 SongSyncManager 不因 WS 触发 HTTP 拉队列（点歌页打开刷新窗口内） */
    this._blockWsPlaylistApply = false;
  }

  /**
   * 点歌页打开刷新时调用：阻断期间忽略 WS 队列推送，仅信 HTTP 拉取结果
   * @param {boolean} blocked
   */
  setBlockWsPlaylistApply(blocked) {
    this._blockWsPlaylistApply = !!blocked;
  }

  /**
   * 获取日志服务实例
   * @private
   */
  _getLogService() {
    if (!this._logService) {
      if (typeof window !== 'undefined' && window.logService) {
        this._logService = window.logService;
      } else {
        // 降级到 console
        this._logService = {
          info: (...args) => console.log('[SongService]', ...args),
          error: (...args) => console.error('[SongService]', ...args),
          warn: (...args) => console.warn('[SongService]', ...args),
          debug: (...args) => console.debug('[SongService]', ...args)
        };
      }
    }
    return this._logService;
  }

  /**
   * 重建索引映射（列表结构变更后）
   * @private
   */
  _rebuildIndexMaps() {
    this._songIdToIndexMap.clear();
    this._songIdToInfoMap.clear();
    // 过滤掉 undefined 和 null 元素，避免错误
    const validSongs = this.selectedSongs.filter(song => song != null);
    validSongs.forEach((song, index) => {
      const songId = song.songNo;
      if (songId) {
        const idStr = String(songId);
        this._songIdToIndexMap.set(idStr, index);
        this._songIdToInfoMap.set(idStr, song);
      }
    });
    // 如果过滤后有变化，更新 selectedSongs
    if (validSongs.length !== this.selectedSongs.length) {
      this.selectedSongs = validSongs;
    }
  }

  _extractSongsFromPlayListResponse(response) {
    return normalizePlayList(response);
  }

  _applySelectedSongs(songs = [], options = {}) {
    const {
      source = 'api',
      emitEvent = true,
      ttl = 5 * 60 * 1000,
      localMutation = false
    } = options;

    if (!Array.isArray(songs)) {
      throw new TypeError('Selected song items must be an array');
    }
    if (localMutation) {
      this._queueStateVersion += 1;
    }

    const seen = new Set();
    const safeSongs = songs.filter(song => {
      const id = String(song?.songNo ?? '').trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    this.requestedSongs.clear();
    this.selectedSongs = safeSongs;
    this._songIdToIndexMap.clear();
    this._songIdToInfoMap.clear();

    const processedIds = new Set();
    safeSongs.forEach((song, index) => {
      const songId = song?.songNo;
      if (!songId) return;
      const idStr = String(songId);
      if (processedIds.has(idStr)) return;
      processedIds.add(idStr);
      this.requestedSongs.add(idStr);
      this._songIdToIndexMap.set(idStr, index);
      this._songIdToInfoMap.set(idStr, song);
    });

    try {
      cacheService?.updateSelectedListCache?.(safeSongs, ttl, { source });
    } catch (error) {
      this._getLogService().warn('Failed to persist selected-song cache', 'SongService', error);
    }

    if (emitEvent) {
      this._getLogService().debug?.('Selected-song state updated', 'SongService', {
        selectedSongsCount: this.selectedSongs.length,
        requestedSongsCount: this.requestedSongs.size,
        source
      });
    }
    return safeSongs;
  }

  _applyLocalQueue(songs, source) {
    return this._applySelectedSongs(songs, { source, localMutation: true });
  }

  _rememberCatalogSongs(songs) {
    if (!Array.isArray(songs)) return [];
    songs.forEach(song => {
      const songNo = String(song?.songNo ?? '').trim();
      if (songNo) this._catalogSongMap.set(songNo, song);
    });
    return songs;
  }

  _parseCatalogResponse(response) {
    const parsed = parseSongListResponse(response);
    const list = this._rememberCatalogSongs(normalizeSongsList(parsed.list));
    return { ...parsed, list };
  }

  _findCatalogSong(songNo, candidate = null) {
    const id = String(songNo ?? '').trim();
    if (!id) return null;
    if (candidate && String(candidate.songNo ?? '').trim() === id) {
      const normalized = normalizeSongsList([candidate])[0] ?? null;
      if (normalized) this._catalogSongMap.set(id, normalized);
      return normalized;
    }
    return this._catalogSongMap.get(id) ?? null;
  }

  applyRequestAccepted(songNo, song = null) {
    const id = String(songNo ?? '').trim();
    if (!id) return this.selectedSongs;
    this._pendingRemovedSongIds.delete(id);

    const exists = this.selectedSongs.some(item => String(item?.songNo ?? '') === id);
    const catalogSong = this._findCatalogSong(id, song) || { songNo: id };
    const queue = exists || !catalogSong
      ? this.selectedSongs.slice()
      : [...this.selectedSongs, catalogSong];
    const result = this._applyLocalQueue(queue, 'requestSong');
    this._scheduleAuthoritativeResync('requestSong');
    return result;
  }

  _isStaleMutationSnapshot(songs) {
    if (songs.length > 0 && this._pendingSkippedHeadIds.has(String(songs[0]?.songNo ?? ''))) {
      return true;
    }
    const ids = new Set(songs.map(song => String(song?.songNo ?? '')).filter(Boolean));
    return Array.from(this._pendingRemovedSongIds).some(id => ids.has(id));
  }

  _clearResolvedMutationGuards() {
    this._pendingSkippedHeadIds.clear();
    this._pendingRemovedSongIds.clear();
  }

  processPlayListResponse(response, options = {}) {
    const songs = this._extractSongsFromPlayListResponse(response);
    return this._applySelectedSongs(songs, options);
  }

  applyPlayListSnapshot(snapshot, options = {}) {
    if (Array.isArray(snapshot)) {
      return this._applySelectedSongs(snapshot, { source: 'snapshot', ...options });
    }
    return this.processPlayListResponse(snapshot, { source: 'snapshot', ...options });
  }

  applyRoomPlaybackIdle(isIdle = true) {
    if (!isIdle) return this.selectedSongs;
    this._clearResolvedMutationGuards();
    return this._applyLocalQueue([], 'roomPlaybackIdle');
  }

  applyDeleteAccepted(songId) {
    const id = String(songId ?? '').trim();
    if (!id) return this.selectedSongs;
    this._pendingRemovedSongIds.add(id);
    const queue = this.selectedSongs.filter(song => String(song?.songNo ?? '') !== id);
    const result = this._applyLocalQueue(queue, 'deleteSong');
    this._scheduleAuthoritativeResync('deleteSong');
    return result;
  }

  applyClearAccepted() {
    const waitingIds = this.selectedSongs.slice(1)
      .map(song => String(song?.songNo ?? ''))
      .filter(Boolean);
    waitingIds.forEach(id => this._pendingRemovedSongIds.add(id));
    const queue = this.selectedSongs.length > 0 ? [this.selectedSongs[0]] : [];
    const result = this._applyLocalQueue(queue, 'clearPlayList');
    this._scheduleAuthoritativeResync('clearPlayList');
    return result;
  }

  applyPrioritizeAccepted(songId) {
    const id = String(songId ?? '').trim();
    if (!id) return this.selectedSongs;
    const queue = this.selectedSongs.slice();
    const index = queue.findIndex(song => String(song?.songNo ?? '') === id);
    if (index > 1) {
      const [promoted] = queue.splice(index, 1);
      queue.splice(1, 0, promoted);
    }
    const result = this._applyLocalQueue(queue, 'prioritizeSong');
    this._scheduleAuthoritativeResync('prioritizeSong');
    return result;
  }

  applyNextAccepted(expectedPreviousHeadId, promotedSongId = null) {
    const previousId = String(expectedPreviousHeadId ?? '').trim();
    const promotedId = String(promotedSongId ?? '').trim();
    if (previousId) this._pendingSkippedHeadIds.add(previousId);

    const queue = this.selectedSongs.slice();
    if (previousId && queue.length > 0 && String(queue[0]?.songNo ?? '') === previousId) {
      queue.shift();
      if (promotedId) {
        const index = queue.findIndex(song => String(song?.songNo ?? '') === promotedId);
        if (index > 0) {
          const [promoted] = queue.splice(index, 1);
          queue.unshift(promoted);
        }
      }
    }
    const result = this._applyLocalQueue(queue, 'playNext');
    this._scheduleAuthoritativeResync('playNext');
    return result;
  }

  markQueueMutationAccepted(source = 'mutation') {
    const result = this._applyLocalQueue(this.selectedSongs.slice(), source);
    this._scheduleAuthoritativeResync(source);
    return result;
  }

  async getSongList(params = {}) {
    try {
      const response = await this.apiService.getSongList(params);
      return this._parseCatalogResponse(response).list;
    } catch (error) {
      handleError('SongService', error, 'Failed to get song catalog');
    }
  }

  async searchSongsAndSingers(keyword) {
    try {
      const response = await songSearchService.searchSongsAndSingers(keyword, { page: 1, pageSize: 9999 });
      return response;
    } catch (error) {
      handleError('SongService', error, '同时搜索歌曲和歌星失败');
    }
  }

  async syncRequestedSongsFromServer(options = {}) {
    const { immediate = false, force = false } = options;

    if (!this._syncDebounced) {
      this._syncDebounced = createDebounced(() => this._runQueueSync(), 500);
    }

    if (immediate || force) {
      this._syncDebounced.cancel();
      return await this._runQueueSync();
    }
    return await this._syncDebounced();
  }

  async _runQueueSync() {
    if (this._syncPromise) {
      this._pendingSyncRequested = true;
      return await this._syncPromise;
    }

    this._syncPromise = (async () => {
      let result = this.selectedSongs;
      do {
        this._pendingSyncRequested = false;
        result = await this._doSyncRequestedSongsFromServer();
      } while (this._pendingSyncRequested);
      return result;
    })();

    try {
      return await this._syncPromise;
    } finally {
      this._syncPromise = null;
    }
  }

  async _doSyncRequestedSongsFromServer() {
    const requestVersion = this._queueStateVersion;
    try {
      const response = await this.apiService.getPlayList();
      if (!isApiOk(response)) {
        throw new Error(getApiErrorMessage(response, 'Queue request failed'));
      }
      const songs = this._extractSongsFromPlayListResponse(response);

      // A response started before a local accepted mutation cannot restore old queue data.
      if (requestVersion !== this._queueStateVersion) {
        this._getLogService().warn('Discarded queue response from before local mutation', 'SongService');
        return this.selectedSongs;
      }
      // The server can briefly return the previous snapshot after an accepted mutation.
      if (this._isStaleMutationSnapshot(songs)) {
        this._getLogService().warn('Discarded queue snapshot that does not include accepted mutation', 'SongService');
        return this.selectedSongs;
      }

      this._clearResolvedMutationGuards();
      const result = this._applySelectedSongs(songs, { source: 'api' });
      this._lastSyncTime = Date.now();
      return result;
    } catch (error) {
      this._getLogService().error('Queue synchronization failed', 'SongService', error);
      throw error;
    }
  }

  getSelectedSongInfo(songId) {
    // 优化：减少if判断，直接返回Map查找结果
    if (!songId || !this._songIdToInfoMap) return null;
    return this._songIdToInfoMap.get(String(songId)) || null;
  }

  getSelectedSongIndex(songId) {
    if (!songId) return -1;
    const idStr = String(songId);
    const index = this._songIdToIndexMap?.get(idStr);
    return index !== undefined ? index : -1;
  }

  getQueueState(songId) {
    const index = this.getSelectedSongIndex(songId);
    if (index < 0) return 'normal';
    if (index === 0) return 'playing';
    if (index === 1) return 'next';
    return 'queued';
  }

  _scheduleAuthoritativeResync(source = 'mutation') {
    this._resyncGeneration += 1;
    const generation = this._resyncGeneration;
    this._postMutationResyncTimers.forEach(timer => clearTimeout(timer));
    this._postMutationResyncTimers = [];

    this._authoritativeResyncDelays.forEach((delay, index) => {
      const timer = setTimeout(() => {
        if (generation !== this._resyncGeneration) return;
        if (index > 0 && this._pendingSkippedHeadIds.size === 0 && this._pendingRemovedSongIds.size === 0) {
          return;
        }
        this.syncRequestedSongsFromServer({ force: true, immediate: true })
          .catch(error => this._getLogService().warn(`${source} authoritative resync failed`, 'SongService', error));
      }, delay);
      this._postMutationResyncTimers.push(timer);
    });
  }

  async handleSongByIndex(songId) {
    try {
      const queueState = this.getQueueState(songId);
      if (queueState === 'playing' || queueState === 'next') {
        return await this.playNextSong();
      }
      if (queueState === 'queued') {
        return await this.prioritizeSong(songId);
      }
      return await this.requestSong(songId);
    } catch (error) {
      this._getLogService().error('根据索引处理歌曲失败:', 'SongService', error);
      throw error;
    }
  }

  async prioritizeSong(songId) {
    const songIdStr = String(songId ?? '').trim();
    if (!songIdStr) throw new Error('Invalid song number');

    const info = this.getSelectedSongInfo(songIdStr) ||
      this.selectedSongs.find(song => String(song?.songNo ?? '') === songIdStr);
    const targetSongId = info?.songNo || songIdStr;

    try {
      const response = await this.apiService.upWord({ songNo: targetSongId });
      if (!isApiOk(response)) {
        throw new Error(getApiErrorMessage(response, 'Failed to prioritize song'));
      }
      this.applyPrioritizeAccepted(targetSongId);
      return { action: 'prioritize', response };
    } catch (error) {
      this._getLogService().error('Failed to prioritize song:', 'SongService', error);
      throw error;
    }
  }

  async playNextSong() {
    try {
      const previousHeadId = this.selectedSongs[0]?.songNo ?? null;
      const response = await this.apiService.playNext();
      if (!isApiOk(response)) {
        throw new Error(getApiErrorMessage(response, 'Failed to play next song'));
      }
      this.applyNextAccepted(previousHeadId);
      return { action: 'playNext', response };
    } catch (error) {
      this._getLogService().error('Failed to play next song:', 'SongService', error);
      throw error;
    }
  }

  async getTopSongs(params = {}) {
    const defaultParams = { page: 1, pageSize: 20 };
    const finalParams = { ...defaultParams, ...params };
    const response = await this.apiService.getSongList(finalParams);
    return this._parseCatalogResponse(response).list;
  }

  /**
   * 检查歌曲是否已被点播
   * @param {string} songId - 歌曲ID
   * @returns {boolean} 是否已被点播
   */
  isSongRequested(songId) {
    if (!songId) return false;
    const id = String(songId).trim();
    return this.requestedSongs.has(id) || this._requestingSongIds.has(id);
  }

  /**
   * 点歌：仅在后端确认成功后通过 getPlayList 同步本地队列与「已选」态
   * @param {string} songId - 歌曲ID
   * @returns {Promise<Object>} 点歌结果
   */
  async requestSong(songId, song = null, options = {}) {
    const songNo = String(songId ?? '').trim();
    if (!songNo) throw new Error('Invalid song number');

    if (this.isSongRequested(songNo)) throw new Error('该歌曲已在已选列表中，请勿重复点播');
    this._requestingSongIds.add(songNo);
    try {
      const payload = { songNo };
      if (options.isPriority === true) payload.isPriority = true;
      const response = await this.apiService.selectSong(payload);
      if (!isApiOk(response)) {
        throw new Error(getApiErrorMessage(response, 'Failed to request song'));
      }

      // Match Flutter PAD: apply the accepted request locally, then reconcile from the authoritative queue.
      this.applyRequestAccepted(songNo, response.data?.songNo ? response.data : song);
      return { action: 'requestSong', response };
    } catch (error) {
      this._getLogService().error('Failed to request song:', 'SongService', error);
      throw error;
    } finally {
      this._requestingSongIds.delete(songNo);
    }
  }

  normalizeSongs(items) {
    return normalizeSongsList(items);
  }

  /**
   * 根据模式加载歌曲数据（统一返回格式，KTV/VOD 共用）
   * @param {string} mode - 模式: top | search | singer | language | category
   * @param {Object} filterParams - 过滤参数
   * @param {number} page - 页码
   * @param {number} size - 每页大小
   * @returns {Promise<{list: Array, totalSize: number}>}
   */
  async loadSongsByMode(mode, filterParams, page, size, loadOptions = {}) {
    const { skipCache = false } = loadOptions;
    this._getLogService().info(`loadSongsByMode 调用 - 模式: ${mode}, 页码: ${page}, 参数:`, 'SongService', filterParams);

    const toResult = (arr, totalSize) => {
      const list = Array.isArray(arr) ? arr : [];
      return { list, totalSize: totalSize != null ? totalSize : list.length };
    };
    let data;
    let totalSizeFromApi;

    // 缓存优先策略：先检查缓存（点歌页打开等场景可传 skipCache 强制拉接口）
    const cacheService = DomUtils.getCacheService();

    const isNewSongs = mode === 'category' && String(filterParams?.categoryCode) === '1';
    if (cacheService && page === 1 && !skipCache && !isNewSongs) {
      // 检查是否是印尼歌曲模式
      const isIndonesianSongs = mode === 'language' && filterParams?.languageCode &&
        (filterParams.languageCode === 'id' || filterParams.languageCode === '6' ||
          filterParams.languageCode === '10');

      if (isIndonesianSongs) {
        // 印尼歌曲模式：检查预加载的缓存
        const preloadedIndonesianSongs = cacheService.getPreloadedIndonesianSongs();
        if (Array.isArray(preloadedIndonesianSongs) && preloadedIndonesianSongs.length > 0) {
          this._getLogService().info(`使用预加载的印尼歌曲数据，数量: ${preloadedIndonesianSongs.length}`, 'SongService');
          // 后台更新数据（不缓存，但更新预加载缓存）
          setTimeout(async () => {
            try {
              const response = await this.apiService.getSongList({
                page: 1,
                pageSize: size,
                languageCode: filterParams.languageCode
              });
              const freshData = this._parseCatalogResponse(response).list;
              if (freshData.length > 0) {
                cacheService.set('preload.indonesianSongs', freshData, 10 * 60 * 1000);
              }
            } catch (e) {
              this._getLogService().warn('后台更新印尼歌曲数据失败:', 'SongService', e);
            }
          }, 100);
          return toResult(preloadedIndonesianSongs);
        }
      } else {
        // 非印尼歌曲模式：使用常规缓存逻辑
        // 优先检查预加载缓存（用于特定场景，如分类11）

        if (mode === 'category' && filterParams?.categoryCode === '11') {
          const preloadedPartySongs = cacheService.getPreloadedPartySongs('11');
          if (Array.isArray(preloadedPartySongs) && preloadedPartySongs.length > 0) {
            this._getLogService().info(`使用预加载的派对分类歌曲数据（DISCO），数量: ${preloadedPartySongs.length}`, 'SongService');
            return toResult(preloadedPartySongs);
          }
        }

        // 歌名列表（top）始终走接口，保证与数据库/接口返回一致，不使用预加载缓存
        // if (mode === 'top') { ... getPreloadedTopSongs() ... } 已移除

        // 构建缓存参数（包含所有过滤参数，搜索模式也支持过滤条件）
        const cacheParams = {
          mode,
          page,
          pageSize: size,
          ...filterParams
        };

        // 尝试从常规缓存获取数据
        const cachedData = cacheService.getCachedData('songs', cacheParams);
        if (cachedData) {
          this._getLogService().info(`使用缓存数据，模式: ${mode}, 数量: ${cachedData.length}`, 'SongService');
          if (mode !== 'search' && !(mode === 'category' && filterParams?.categoryCode === '11')) {
            this._updateCacheInBackground(mode, filterParams, page, size, cacheService);
          }
          return toResult(cachedData);
        }
      }
    }

    // 缓存未命中，继续执行原有逻辑请求服务器
    // 后端真实分页使用 1-based，前端统一沿用同一语义
    const apiPage = Math.max(1, parseInt(page, 10) || 1);

    try {
      switch (mode) {
        case 'top': {
          this._getLogService().info('加载默认歌曲列表', 'SongService');
          const topParams = { page: apiPage, pageSize: size };
          const topRes = await this.apiService.getSongList(topParams);
          const topParsed = parseSongListResponse(topRes);
          data = this._rememberCatalogSongs(normalizeSongsList(topParsed.list));
          totalSizeFromApi = topParsed.totalSize;
          break;
        }

        case 'search': {
          const { buildSearchParams } = await import('../../utils/SearchParamsBuilder.js');
          const keyword = (filterParams.keyword || '').trim();
          const searchParams = buildSearchParams({
            keyword,
            baseFilterParams: filterParams,
            page: apiPage,
            pageSize: size,
            searchMode: filterParams.searchMode
          });

          if (!keyword && Object.keys(searchParams).length === 2) {
            this._getLogService().info('搜索参数为空，跳过请求', 'SongService');
            data = [];
            break;
          }

          this._getLogService().info('搜索参数:', 'SongService', searchParams);
          const searchRes = await this.apiService.getSongList(searchParams);
          const searchParsed = parseSongListResponse(searchRes);
          data = this._rememberCatalogSongs(normalizeSongsList(searchParsed.list));
          totalSizeFromApi = searchParsed.totalSize;
          break;
        }

        case 'singer': {
          const { primarySingerNo } = filterParams;
          this._getLogService().info(`加载歌手歌曲 - 歌手编号: ${primarySingerNo}`, 'SongService');
          const singerParams = { page: apiPage, pageSize: size };
          if (primarySingerNo) singerParams.primarySingerNo = primarySingerNo;
          const singerRes = await this.apiService.getSongList(singerParams);
          const singerParsed = parseSongListResponse(singerRes);
          data = this._rememberCatalogSongs(normalizeSongsList(singerParsed.list));
          totalSizeFromApi = singerParsed.totalSize;
          break;
        }

        case 'language': {
          const { languageCode } = filterParams;
          this._getLogService().info(`加载语种歌曲 - 语种编码: ${languageCode}`, 'SongService');
          const langParams = { page: apiPage, pageSize: size };
          if (languageCode) langParams.languageCode = languageCode;
          if (filterParams.keyword) langParams.keyword = filterParams.keyword;
          if (filterParams.searchMode) langParams.searchMode = filterParams.searchMode;
          const langRes = await this.apiService.getSongList(langParams);
          const langParsed = parseSongListResponse(langRes);
          data = this._rememberCatalogSongs(normalizeSongsList(langParsed.list));
          totalSizeFromApi = langParsed.totalSize;
          break;
        }

        case 'category': {
          const { categoryCode } = filterParams;
          const categoryParams = { page: apiPage, pageSize: size };
          if (categoryCode) categoryParams.categoryCode = categoryCode;
          if (filterParams.keyword) categoryParams.keyword = filterParams.keyword;
          if (filterParams.searchMode) categoryParams.searchMode = filterParams.searchMode;
          this._getLogService().info(`[分类查询] 请求参数: categoryCode=${categoryCode}, page=${apiPage}, size=${size}`, 'SongService');
          const categoryRes = await this.apiService.getSongList(categoryParams);
          const categoryParsed = parseSongListResponse(categoryRes);
          data = this._rememberCatalogSongs(normalizeSongsList(categoryParsed.list));
          totalSizeFromApi = categoryParsed.totalSize;
          const listLen = Array.isArray(data) ? data.length : 0;
          const firstCode = listLen > 0 && data[0] ? (data[0].categoryCode ?? '无') : '无';
          this._getLogService().info(`[分类查询] 接口返回: list=${listLen}, totalSize=${totalSizeFromApi}, 首条categoryCode=${firstCode}`, 'SongService');
          break;
        }

        default:
          this._getLogService().info('未知模式，返回空数据', 'SongService');
          data = [];
      }
    } catch (error) {
      // 记录错误并重新抛出，让调用方处理
      this._getLogService().error(`加载歌曲失败 - 模式: ${mode}, 页码: ${page}`, 'SongService', error);
      // 如果是网络错误，提供更友好的错误信息
      if (error.message && (error.message.includes('fetch') || error.message.includes('Failed to fetch') || error.message.includes('网络'))) {
        const networkError = new Error(`网络请求失败: ${error.message}`);
        networkError.originalError = error;
        throw networkError;
      }
      throw error;
    }

    if (!Array.isArray(data)) {
      this._getLogService().warn('API返回非数组，置空', 'SongService');
      data = [];
    }

    if (cacheService && page === 1 && data.length > 0) {
      const cacheParams = { mode, page, pageSize: size, ...filterParams };
      const isIndonesianSongs = mode === 'language' && filterParams?.languageCode &&
        (filterParams.languageCode === 'id' || filterParams.languageCode === '6' ||
          filterParams.languageCode === '10');
      if (!isIndonesianSongs) {
        cacheService.setCachedData('songs', cacheParams, data);
        this._getLogService().info(`数据已缓存，模式: ${mode}, 数量: ${data.length}`, 'SongService');
      }
    }

    return toResult(data, totalSizeFromApi);
  }

  /**
   * 后台更新缓存（不阻塞主流程）
   * @private
   */
  async _updateCacheInBackground(mode, filterParams, page, size, cacheService) {
    const apiPage = Math.max(1, parseInt(page, 10) || 1);
    try {
      // 延迟执行，不阻塞当前返回
      setTimeout(async () => {
        try {
          let freshData;
          switch (mode) {
            case 'top':
              freshData = await this.getTopSongs({ page: apiPage, pageSize: size });
              break;
            case 'search': {
              const { buildSearchParams } = await import('../../utils/SearchParamsBuilder.js');
              const searchParams = buildSearchParams({
                keyword: filterParams.keyword,
                baseFilterParams: filterParams,
                page: apiPage,
                pageSize: size,
                searchMode: filterParams.searchMode
              });
              freshData = this._parseCatalogResponse(await this.apiService.getSongList(searchParams)).list;
              break;
            }
            case 'singer':
              const { primarySingerNo: bgPrimarySingerNo } = filterParams;
              const singerParams = { page: apiPage, pageSize: size };
              if (bgPrimarySingerNo) singerParams.primarySingerNo = bgPrimarySingerNo;
              freshData = this._parseCatalogResponse(await this.apiService.getSongList(singerParams)).list;
              break;
            case 'language':
              const { languageCode: bgLanguageCode } = filterParams;
              const langParams = { page: apiPage, pageSize: size };
              if (bgLanguageCode) langParams.languageCode = bgLanguageCode;
              if (filterParams.keyword) langParams.keyword = filterParams.keyword;
              if (filterParams.searchMode) langParams.searchMode = filterParams.searchMode;
              freshData = this._parseCatalogResponse(await this.apiService.getSongList(langParams)).list;
              break;
            case 'category':
              const { categoryCode: bgCategoryCode } = filterParams;
              const categoryParams = { page: apiPage, pageSize: size };
              if (bgCategoryCode) categoryParams.categoryCode = bgCategoryCode;
              if (filterParams.keyword) categoryParams.keyword = filterParams.keyword;
              if (filterParams.searchMode) categoryParams.searchMode = filterParams.searchMode;
              freshData = this._parseCatalogResponse(await this.apiService.getSongList(categoryParams)).list;
              break;
            default:
              return;
          }

          if (Array.isArray(freshData) && freshData.length > 0) {
            const cacheParams = { mode, page, pageSize: size, ...filterParams };
            cacheService.setCachedData('songs', cacheParams, freshData);
            this._getLogService().info(`后台缓存更新完成，模式: ${mode}`, 'SongService');
          }
        } catch (error) {
          this._getLogService().warn('后台缓存更新失败:', 'SongService', error);
        }
      }, 100);
    } catch (error) {
      this._getLogService().warn('后台缓存更新启动失败:', 'SongService', error);
    }
  }

  /**
   * 获取印尼语编码
   * @returns {Promise<string>} 印尼语编码
   */
  async getIndonesianLanguageCode() {
    try {
      // 直接使用全局的cacheService
      const cacheService = DomUtils.getCacheService();
      if (!cacheService) {
        throw new Error('无法获取缓存服务');
      }

      const languages = await cacheService.getDict('language') || [];
      this._getLogService().info('获取到的语言数据:', 'SongService', languages);

      // 查找印尼语的编码
      let indonesianCode = null;
      for (const lang of languages) {
        if (lang.name && (lang.name.includes('印尼') || lang.name.includes('印度尼西亚') ||
          lang.name.toLowerCase().includes('indonesia') || lang.name.toLowerCase().includes('indonesian'))) {
          indonesianCode = lang.code;
          this._getLogService().info(`找到印尼语编码: ${indonesianCode}, 名称: ${lang.name}`, 'SongService');
          break;
        }
      }

      // 如果没有找到印尼语，使用默认值'id'或'6'
      if (!indonesianCode) {
        indonesianCode = 'id';
        const existingLang = languages.find(lang => lang.code === indonesianCode);
        if (!existingLang) {
          indonesianCode = '6';
        }
        this._getLogService().info(`未找到印尼语，使用默认编码: ${indonesianCode}`, 'SongService');
      }

      this._getLogService().info(`印尼语编码: ${indonesianCode}`, 'SongService');
      return indonesianCode;
    } catch (error) {
      this._getLogService().error('获取印尼语编码失败:', 'SongService', error);
      // 返回默认编码
      return 'id';
    }
  }
}

const songService = new SongService();
export default songService;
