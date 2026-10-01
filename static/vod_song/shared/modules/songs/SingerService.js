import apiService from '../../core/ApiService.js';
import { logInfo, logWarn } from '../../utils/Logger.js';
import { handleError } from '../../utils/ErrorHandler.js';
import { parseSingerListResponse } from '../../utils/ResponseParser.js';
import { normalizeSingersList } from '../../utils/NormalizeUtils.js';
import { updateCacheInBackground } from '../../utils/CacheUpdateHelper.js';
import DomUtils from '../../utils/DomUtils.js';

/**
 * 歌手业务逻辑
 */
class SingerService {
  constructor() {
    this.apiService = apiService;
    this._letterCache = new Map();
    this.cacheService = null;
  }

  _getCacheService() {
    if (!this.cacheService) {
      this.cacheService = DomUtils.getCacheService();
    }
    return this.cacheService;
  }

  async getSingerList(params = {}) {
    try {
      const cacheService = this._getCacheService();
      const page = params.page || 1;

      if (cacheService && page === 1) {
        const cacheParams = { type: 'singers', ...params };
        const cachedData = cacheService.getCachedData('singers', cacheParams);
        if (cachedData) {
          this._updateSingerCacheInBackground(params, cacheService);
          return cachedData;
        }
      }

      const response = await this.apiService.getSingerList(params);
      const list = normalizeSingersList(parseSingerListResponse(response).list);

      if (cacheService && page === 1 && list.length > 0) {
        const cacheParams = { type: 'singers', ...params };
        cacheService.setCachedData('singers', cacheParams, list);
      }

      return list;
    } catch (error) {
      handleError('SingerService', error, '获取歌手列表失败');
    }
  }

  _updateSingerCacheInBackground(params, cacheService) {
    updateCacheInBackground({
      fetchData: () => this.apiService.getSingerList(params),
      parseResponse: (response) => normalizeSingersList(parseSingerListResponse(response).list),
      cacheService,
      cacheType: 'singers',
      cacheParams: params,
      logInfo: (msg) => logInfo('SingerService', msg),
      logError: (msg, error) => logWarn('SingerService', msg, error)
    });
  }

  async getSingerDetail(singerId) {
    try {
      const response = await this.apiService.getSingerDetail(singerId);
      return response?.data ?? null;
    } catch (error) {
      handleError('SingerService', error, '获取歌手详情失败');
    }
  }

  async searchSingers(initial) {
    try {
      const kw = String(initial || '').trim();
      if (!kw) {
        return await this.getSingerList({ page: 1, pageSize: 30 });
      }

      if (/^[A-Za-z]+$/i.test(kw)) {
        const firstChar = kw.charAt(0).toUpperCase();
        let list = this._letterCache.get(firstChar);

        const cacheService = this._getCacheService();
        if (!list && cacheService) {
          const cacheParams = { type: 'singers', page: 1, pageSize: 9999, initial: firstChar };
          const cached = cacheService.getCachedData('singers', cacheParams);
          if (cached) {
            list = cached;
            this._letterCache.set(firstChar, list);
          }
        }

        if (!list) {
          const resp = await this.apiService.getSingerList({ page: 1, pageSize: 9999, initial: firstChar });
          list = normalizeSingersList(parseSingerListResponse(resp).list);
          this._letterCache.set(firstChar, list);

          if (cacheService && list.length > 0) {
            const cacheParams = { type: 'singers', page: 1, pageSize: 9999, initial: firstChar };
            cacheService.setCachedData('singers', cacheParams, list);
          }
        }
        const lowerKw = kw.toLowerCase();
        const pinyin = (typeof window !== 'undefined' && window.pinyinPro && window.pinyinPro.pinyin) ? window.pinyinPro.pinyin : null;
        const filtered = list.filter(item => {
          const name = item.singerName || '';
          const lowerName = String(name).toLowerCase();
          if (lowerName.includes(lowerKw)) return true;
          if (pinyin) {
            try {
              let abbr = pinyin(name, { pattern: 'first', toneType: 'none' });
              if (!abbr || typeof abbr !== 'string') {
                const full = pinyin(name, { toneType: 'none' });
                if (typeof full === 'string') {
                  abbr = full.split(/\s+/).map(s => s?.[0] || '').join('');
                }
              }
              if (abbr && typeof abbr === 'string') {
                return abbr.toLowerCase().includes(lowerKw);
              }
            } catch (_) { }
          }
          return false;
        });
        return filtered;
      }

      const resp = await this.apiService.getSingerList({ page: 1, pageSize: 30, keyword: kw });
      if (!resp) return [];
      const list = normalizeSingersList(parseSingerListResponse(resp).list);
      const lowerKw = kw.toLowerCase();
      return list.filter(item => {
        const name = item.singerName || '';
        return String(name).toLowerCase().includes(lowerKw);
      });
    } catch (error) {
      handleError('SingerService', error, '搜索歌手失败');
    }
  }

  async getTopSingers(params = {}) {
    try {
      const response = await this.apiService.getSingerList(params);
      return normalizeSingersList(parseSingerListResponse(response).list);
    } catch (error) {
      handleError('SingerService', error, '获取热门歌手失败');
    }
  }

  async getSingersByFilters(filters, page = 1, size = 20) {
    try {
      const params = { page, pageSize: size };
      if (filters.sexCode) params.sexCode = filters.sexCode;
      if (filters.regionCode) params.regionCode = filters.regionCode;

      const response = await this.apiService.getSingerList(params);
      const parsed = parseSingerListResponse(response);
      return { list: normalizeSingersList(parsed.list), total: parsed.totalSize || 0 };
    } catch (error) {
      handleError('SingerService', error, '根据筛选条件获取歌手列表失败');
      return { list: [], total: 0 };
    }
  }

  async getSingersByFirstChar(firstChar, filters, page = 1, size = 20) {
    try {
      const params = { page, pageSize: size, initial: firstChar.toUpperCase() };
      if (filters.sexCode) params.sexCode = filters.sexCode;
      if (filters.regionCode) params.regionCode = filters.regionCode;

      const response = await this.apiService.getSingerList(params);
      return normalizeSingersList(parseSingerListResponse(response).list);
    } catch (error) {
      handleError('SingerService', error, '根据首字母和筛选条件获取歌手列表失败');
    }
  }

  async getAllSingersByFirstChar(filters, firstChar) {
    try {
      const params = { page: 1, pageSize: 9999, initial: firstChar.toUpperCase() };
      if (filters.sexCode) params.sexCode = filters.sexCode;
      if (filters.regionCode) params.regionCode = filters.regionCode;

      const response = await this.apiService.getSingerList(params);
      return normalizeSingersList(parseSingerListResponse(response).list);
    } catch (error) {
      handleError('SingerService', error, '获取所有歌手失败');
    }
  }
}

const singerService = new SingerService();
export default singerService;
