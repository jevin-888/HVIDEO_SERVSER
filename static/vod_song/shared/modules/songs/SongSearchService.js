import apiService from '../../core/ApiService.js';
import { logInfo, logError } from '../../utils/Logger.js';
import { handleError } from '../../utils/ErrorHandler.js';
import { parseSongListResponse, parseSingerListResponse } from '../../utils/ResponseParser.js';
import { normalizeSongsList, normalizeSingersList } from '../../utils/NormalizeUtils.js';
import { buildSearchParams } from '../../utils/SearchParamsBuilder.js';
import { updateCacheInBackground } from '../../utils/CacheUpdateHelper.js';
import DomUtils from '../../utils/DomUtils.js';

/**
 * 歌曲搜索业务逻辑
 */
class SongSearchService {
  constructor() {
    this.apiService = apiService;
  }

  async searchByKeyword(keyword, params = {}) {
    try {
      const requestParams = buildSearchParams({
        keyword,
        baseFilterParams: params,
        page: params.page || 1,
        pageSize: params.pageSize || 50,
        searchMode: params.searchMode
      });

      const cacheService = DomUtils.getCacheService();
      if (cacheService && requestParams.page === 1) {
        const cacheParams = { type: 'search', ...requestParams };
        const cachedData = cacheService.getCachedData('search', cacheParams);
        if (cachedData) {
          this._updateSearchCacheInBackground(requestParams, cacheService);
          return cachedData;
        }
      }
      const resp = await this.apiService.getSongList(requestParams);
      const list = normalizeSongsList(parseSongListResponse(resp).list);

      if (cacheService && requestParams.page === 1 && list.length > 0) {
        const cacheParams = { type: 'search', ...requestParams };
        cacheService.setCachedData('search', cacheParams, list);
      }
      return list;
    } catch (error) {
      handleError('SongSearchService', error, '搜索歌曲失败');
    }
  }

  _updateSearchCacheInBackground(requestParams, cacheService) {
    updateCacheInBackground({
      fetchData: () => this.apiService.getSongList(requestParams),
      parseResponse: (response) => normalizeSongsList(parseSongListResponse(response).list),
      cacheService,
      cacheType: 'search',
      cacheParams: requestParams,
      logInfo: (msg) => logInfo('SongSearchService', msg),
      logError: (msg, error) => logError('SongSearchService', msg, error)
    });
  }

  async searchBySinger(singer, params = {}) {
    try {
      const searchParams = {
        page: params.page || 1,
        pageSize: params.pageSize || 20,
        keyword: singer,
        ...params
      };
      const response = await this.apiService.getSongList(searchParams);
      return normalizeSongsList(parseSongListResponse(response).list);
    } catch (error) {
      handleError('SongSearchService', error, '根据歌手搜索歌曲失败');
    }
  }

  async searchByCategory(category, params = {}) {
    try {
      const searchParams = {
        page: params.page || 1,
        pageSize: params.pageSize || 20,
        categoryCode: category,
        ...params
      };
      const response = await this.apiService.getSongList(searchParams);
      return normalizeSongsList(parseSongListResponse(response).list);
    } catch (error) {
      handleError('SongSearchService', error, '根据分类搜索歌曲失败');
    }
  }

  async searchSongsAndSingers(keyword, params = {}) {
    try {
      const page = params.page || 1;
      const pageSize = params.pageSize || 20;
      const k = (keyword || '').trim();

      const mergedSongParams = { page, pageSize, ...params };
      if (k) {
        mergedSongParams.keyword = k;
      }

      const mergedSingerParams = { page, pageSize, ...params };
      if (k) {
        mergedSingerParams.keyword = k;
      }

      const [songsResponse, singersResponse] = await Promise.allSettled([
        this.apiService.getSongList(mergedSongParams),
        this.apiService.getSingerList(mergedSingerParams)
      ]);

      let songs = [];
      if (songsResponse.status === 'fulfilled') {
        songs = normalizeSongsList(parseSongListResponse(songsResponse.value).list);
      }

      let singers = [];
      if (singersResponse.status === 'fulfilled') {
        singers = normalizeSingersList(parseSingerListResponse(singersResponse.value).list);
      }

      return { songs, singers };
    } catch (error) {
      handleError('SongSearchService', error, '同时搜索歌曲和歌星失败');
    }
  }
}

const songSearchService = new SongSearchService();
export default songSearchService;
