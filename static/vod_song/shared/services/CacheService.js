import apiService from '../core/ApiService.js';
import logService from './LogService.js';
import { ensureArray } from '../utils/NormalizeUtils.js';
import { parseApiArrayResponse } from '../utils/ResponseParser.js';

/**
 * 缓存服务 - 用于缓存字典数据和其他预加载数据
 */
class CacheService {
  constructor() {
    this.cache = new Map();
    this.ttlMap = new Map(); // 存储过期时间
    // 字典初始化状态
    this.dictInitialized = false;
    this.dictInitError = null;
    // 并发控制：避免并发重复请求后端字典接口
    this.dictAllPromise = null;
    // 失败冷却控制：当后端返回错误时，在短时间内避免重复请求
    this.dictFailureCooldownUntil = 0;
    this.DICT_FAILURE_COOLDOWN_MS = 10000; // 10秒冷却期，避免失败风暴

    // 缓存统计
    this.stats = {
      hits: new Map(),      // 命中统计：按类型统计
      misses: new Map(),    // 未命中统计：按类型统计
      sets: new Map(),      // 设置统计：按类型统计
      userBehavior: new Map() // 用户行为：记录访问模式
    };

    // 字典缓存配置
    this.DEFAULT_DICT_TTL = 30 * 60 * 1000; // 默认字典TTL：30分钟
    this.DEFAULT_DICT_GROUPS = ['language', 'sex', 'light', 'region', 'category', 'soundEffect'];
    this.STORAGE_KEYS = {
      payload: 'ktv:dict:payload'
    };
    this._hydratedFromStorage = false;
    this.storageEnabled = this._storageEnabled();
    if (this.storageEnabled) {
      this._hydrateDictCacheFromStorage(this.DEFAULT_DICT_TTL);
    }
  }

  /**
   * 设置缓存
   * @param {string} key - 缓存键
   * @param {any} value - 缓存值
   * @param {number} ttl - 过期时间（毫秒），可选
   */
  set(key, value, ttl) {
    this.cache.set(key, value);

    if (ttl) {
      const expireTime = Date.now() + ttl;
      this.ttlMap.set(key, expireTime);
    } else {
      this.ttlMap.delete(key);
    }

    logService.debug('设置缓存', { key, value, ttl });
  }

  /**
   * 获取缓存
   * @param {string} key - 缓存键
   * @returns {any} 缓存值
   */
  get(key) {
    // 检查是否过期
    if (this.isExpired(key)) {
      this.cache.delete(key);
      this.ttlMap.delete(key);
      logService.warn('缓存已过期', { key });
      return null;
    }

    const value = this.cache.get(key);
    logService.debug('获取缓存', { key, value });
    return value;
  }

  /**
   * 检查缓存是否存在
   * @param {string} key - 缓存键
   * @returns {boolean} 是否存在
   */
  has(key) {
    if (this.isExpired(key)) {
      this.cache.delete(key);
      this.ttlMap.delete(key);
      return false;
    }

    return this.cache.has(key);
  }

  /**
   * 删除缓存
   * @param {string} key - 缓存键
   */
  delete(key) {
    this.cache.delete(key);
    this.ttlMap.delete(key);
    logService.info('删除缓存', { key });
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.cache.clear();
    this.ttlMap.clear();
    logService.info('清空所有缓存');
    // 同步重置字典状态
    this.dictInitialized = false;
    this.dictInitError = null;
  }

  /**
   * 检查缓存是否过期
   * @param {string} key - 缓存键
   * @returns {boolean} 是否过期
   */
  isExpired(key) {
    const expireTime = this.ttlMap.get(key);
    if (!expireTime) {
      return false; // 没有过期时间，永不过期
    }

    return Date.now() > expireTime;
  }

  /**
   * 获取缓存大小
   * @returns {number} 缓存大小
   */
  size() {
    return this.cache.size;
  }

  // =====================
  // 字典缓存初始化与访问
  // =====================

  /**
   * 从歌曲服务器获取完整数据字典并缓存
   */
  async fetchAndCacheDictAll(ttl = this.DEFAULT_DICT_TTL) {
    const effectiveTtl = (typeof ttl === 'number' && ttl > 0) ? ttl : this.DEFAULT_DICT_TTL;
    // 并发去重：如果已有进行中的加载，等待其完成
    if (this.dictAllPromise) {
      await this.dictAllPromise;
      return;
    }

    // 失败冷却：在冷却期内直接返回（使用已有缓存或空结果），避免重复打后端
    if (Date.now() < this.dictFailureCooldownUntil) {
      logService.warn('[CacheService] 字典请求处于失败冷却期，跳过重复请求', {
        remainingMs: this.dictFailureCooldownUntil - Date.now()
      });
      return; // 保持现有缓存，不再触发网络请求
    }

    // 启动一次加载任务
    this.dictAllPromise = (async () => {
      const requestStartedAt = Date.now();
      try {
        logService.info('[CacheService] 开始从API获取所有数据字典');
        logService.info('[CacheService] 正在请求服务器: getDictList({ groupKey: "_all" })');
        const response = await apiService.getDictList({ groupKey: '_all' });
        logService.info('[CacheService] 服务器响应:', response);
        const allDicts = parseApiArrayResponse(response, 'System dictionaries');
        logService.info('[CacheService] 提取到的字典数据总数:', allDicts.length);

        // 规范化字段
        const normalizeItem = (item) => {
          const groupKeyRaw = item?.groupKey || item?.group_key || item?.group || item?.type || item?.dictGroup || '';
          const rawGroup = String(groupKeyRaw || '').trim().toLowerCase();
          // The server's classify dictionary drives the existing category selector.
          const groupKey = rawGroup === 'classify' ? 'category' : rawGroup;
          const codeRaw = item?.code ?? item?.dictCode ?? item?.dictValue ?? '';
          const nameRaw = item?.name ?? item?.dictLabel ?? item?.dictComment ?? item?.dictName ?? '';
          const code = codeRaw === undefined || codeRaw === null ? '' : String(codeRaw);
          const name = nameRaw === undefined || nameRaw === null ? '' : String(nameRaw);
          // 保留印尼语字段（如果存在）
          const nameId = item?.nameId || item?.name_id || item?.name_id_indonesia || item?.dictLabelId || '';
          return { code, name, nameId: nameId ? String(nameId) : '', groupKey };
        };

        const normalized = ensureArray(allDicts)
          .filter(item => item?.visible == null || Number(item.visible) !== 0)
          .map(normalizeItem).filter(item => item.groupKey);
        logService.info('[CacheService] 规范化后的字典数据总数:', normalized.length);

        // 统计音效数据
        const soundEffects = normalized.filter(item => item.groupKey === 'soundeffect');
        logService.info('[CacheService] 音效数据数量:', soundEffects.length);
        if (soundEffects.length > 0) {
          logService.info('[CacheService] 音效数据详情:', soundEffects);
        }
        // 减少生产环境中的日志输出
        if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
          logService.debug('[CacheService] 所有规范化后的数据:', normalized);
        }

        // 优化：使用Map一次性分组，避免O(n*m)复杂度
        const groupedMap = new Map();
        normalized.forEach(item => {
          const groupKey = String(item.groupKey || '').toLowerCase();
          if (!groupedMap.has(groupKey)) {
            groupedMap.set(groupKey, []);
          }
          groupedMap.get(groupKey).push(item);
        });

        // 确保默认分组存在（将 groupKey 转换为小写以匹配 groupedMap 的键格式）
        this.DEFAULT_DICT_GROUPS.forEach(groupKey => {
          const normalizedKey = String(groupKey || '').toLowerCase();
          if (!groupedMap.has(normalizedKey)) {
            groupedMap.set(normalizedKey, []);
          }
        });

        const groupsForStorage = {};
        for (const [groupKey, list] of groupedMap.entries()) {
          const normalizedGroupKey = String(groupKey || '').toLowerCase();
          logService.info(`[CacheService] 分组 ${normalizedGroupKey} 的数据数量:`, list.length);
          if (normalizedGroupKey === 'soundeffect') {
            logService.info(`[CacheService] 音效分组数据:`, list);
          }
          this.set(`dict.${normalizedGroupKey}`, list, effectiveTtl);
          groupsForStorage[normalizedGroupKey] = list;
        }

        let dictCounts = {};
        this.DEFAULT_DICT_GROUPS.forEach(groupKey => {
          // 将 groupKey 转换为小写以匹配 groupsForStorage 的键格式
          const normalizedKey = String(groupKey || '').toLowerCase();
          dictCounts[groupKey] = (groupsForStorage[normalizedKey] || []).length;
        });
        let totalDictCount = Object.values(dictCounts).reduce((sum, count) => sum + count, 0);

        let finalNormalized = normalized;
        if (totalDictCount === 0) {
          logService.warn('[CacheService] 字典缓存初始化完成，但未获取到任何字典数据，必须从服务器获取', dictCounts);
        } else {
          logService.info('[CacheService] 字典缓存初始化完成', dictCounts);
        }

        // 保存原始与全部集合
        this.set('dict.all', finalNormalized, effectiveTtl);
        this.set('dict.timestamp', requestStartedAt, effectiveTtl);

        if (this.storageEnabled) {
          this._saveDictCacheToStorage(groupsForStorage, finalNormalized, effectiveTtl, requestStartedAt);
        }

        this.dictInitialized = true;
        this.dictInitError = null;
        // 成功后清除失败冷却（允许后续正常更新）
        this.dictFailureCooldownUntil = 0;
      } catch (error) {
        logService.error('[CacheService] 字典缓存初始化失败', error);
        this.dictInitialized = false;
        this.dictInitError = error;
        if (this.storageEnabled) {
          this._clearDictStorage();
        }

        // 设置失败冷却，避免短时间内重复失败请求
        this.dictFailureCooldownUntil = Date.now() + this.DICT_FAILURE_COOLDOWN_MS;

        // 即使初始化失败，也不设置默认值，所有数据必须从服务器获取
        const groups = this.DEFAULT_DICT_GROUPS;

        groups.forEach(g => {
          if (!this.get(`dict.${g}`)) {
            // 所有分组（包括语种和音效）必须从服务器获取，不设置默认值
            this.set(`dict.${g}`, [], effectiveTtl);
          }
        });

        // 设置空的字典集合
        if (!this.get('dict.all')) {
          this.set('dict.all', [], effectiveTtl);
        }
        if (!this.get('dict.timestamp')) {
          this.set('dict.timestamp', Date.now(), effectiveTtl);
        }
        if (this.storageEnabled) {
          const fallbackGroups = {};
          groups.forEach(g => {
            fallbackGroups[g] = this.get(`dict.${g}`) || [];
          });
          const fallbackAll = this.get('dict.all') || [];
          this._saveDictCacheToStorage(
            fallbackGroups,
            ensureArray(fallbackAll),
            effectiveTtl,
            Date.now()
          );
        }

        this.dictInitialized = true; // 标记为已初始化，避免重复尝试
        // 不抛出错误，而是使用默认数据
      } finally {
        // 加载任务结束，释放并发锁
        this.dictAllPromise = null;
      }
    })();

    // 等待加载完成
    await this.dictAllPromise;
  }

  /**
   * 获取某一分组的字典（自动初始化）
   * @param {string} groupKey - 分组键，如 language、sex、light、region、classify、soundEffect
   * @param {number} ttl - 若需初始化的TTL（毫秒）
   * @returns {Promise<Array>} 字典数组
   */
  async getDict(groupKey, ttl = this.DEFAULT_DICT_TTL) {
    // 将 groupKey 转换为小写，以匹配存储时使用的键名格式
    const normalizedGroupKey = String(groupKey || '').toLowerCase();
    const key = `dict.${normalizedGroupKey}`;
    const cached = this.get(key);
    logService.info(`[CacheService] getDict - 尝试获取分组 ${groupKey} (规范化: ${normalizedGroupKey}) 的缓存数据:`, cached ? `找到 ${cached.length} 条` : '未找到');

    // 如果缓存中有数据且不为空，直接返回
    if (Array.isArray(cached) && cached.length > 0) {
      logService.info(`[CacheService] getDict - 缓存中找到分组 ${groupKey} 的数据，长度: ${cached.length}`);
      return cached;
    }

    logService.info(`[CacheService] getDict - 缓存中未找到分组 ${groupKey} 的数据或数据为空，执行初始化`);
    logService.info(`[CacheService] getDict - 字典初始化状态: ${this.dictInitialized ? '已初始化' : '未初始化'}`);

    // 若未初始化，执行初始化
    // 如果已初始化但数据为空，也尝试重新初始化（可能是服务器数据更新了）
    if (!this.dictInitialized) {
      logService.info(`[CacheService] getDict - 字典未初始化，开始从服务器请求所有字典数据（仅此一次）...`);
      await this.fetchAndCacheDictAll(ttl);
      logService.info(`[CacheService] getDict - 字典数据请求完成，初始化状态: ${this.dictInitialized ? '已初始化' : '未初始化'}`);
    } else {
      // 已初始化但数据为空，尝试重新获取（可能是初始化时服务器没有返回该分组的数据）
      logService.info(`[CacheService] getDict - 字典已初始化但分组 ${groupKey} 数据为空，尝试重新从服务器获取...`);
      // 注意：这里不重置 dictInitialized，避免重复初始化所有数据
      // 如果确实需要重新初始化，可以调用 fetchAndCacheDictAll，但需要小心避免无限循环
      const result = this.get(key) || [];
      if (Array.isArray(result) && result.length > 0) {
        logService.info(`[CacheService] getDict - 重新获取后找到数据，长度: ${result.length}`);
        return result;
      }
    }

    const result = this.get(key) || [];
    logService.info(`[CacheService] getDict - 获取分组 ${groupKey} 的数据:`, result ? `找到 ${result.length} 条` : '空数组');

    // 所有字典数据（包括语种和音效）必须从服务器获取，不提供硬编码默认值
    // 如果服务器返回空数据，则返回空数组
    if (!Array.isArray(result) || result.length === 0) {
      logService.warn(`[CacheService] getDict - 初始化后分组 ${groupKey} 数据仍为空，必须从服务器获取`);
      // 输出调试信息，帮助排查问题
      logService.info(`[CacheService] getDict - 调试信息: 所有缓存键:`, Array.from(this.cache.keys()).filter(k => k.startsWith('dict.')));
      return [];
    }
    return result;
  }

  /**
   * 从缓存直接获取字典（不触发初始化）
   */
  getDictFromCache(groupKey) {
    // 将 groupKey 转换为小写，以匹配存储时使用的键名格式
    const normalizedGroupKey = String(groupKey || '').toLowerCase();
    return this.get(`dict.${normalizedGroupKey}`) || null;
  }

  /**
   * 清除字典缓存并重新初始化（用于调试和强制刷新）
   * @param {number} ttl - 新的TTL（毫秒）
   */
  async clearDictCacheAndRefresh(ttl = this.DEFAULT_DICT_TTL) {
    logService.info('[CacheService] 清除字典缓存并重新初始化...');

    // 清除所有字典相关的缓存
    const dictKeys = Array.from(this.cache.keys()).filter(k => k.startsWith('dict.'));
    dictKeys.forEach(key => {
      this.cache.delete(key);
      logService.info(`[CacheService] 已清除缓存键: ${key}`);
    });

    // 清除存储的字典数据
    if (this.storageEnabled) {
      this._clearDictStorage();
    }

    // 重置初始化状态
    this.dictInitialized = false;
    this.dictInitError = null;
    this.dictAllPromise = null;

    logService.info('[CacheService] 字典缓存已清除，开始重新初始化...');

    // 重新初始化
    await this.fetchAndCacheDictAll(ttl);

    logService.info('[CacheService] 字典缓存重新初始化完成');
  }

  /**
   * 获取全部缓存的字典分组（不触发初始化）
   */
  getAllDictsFromCache() {
    const groups = this.DEFAULT_DICT_GROUPS;
    const result = {};
    groups.forEach(g => {
      // 将 groupKey 转换为小写，以匹配存储时使用的键名格式
      const normalizedGroupKey = String(g || '').toLowerCase();
      result[g] = this.get(`dict.${normalizedGroupKey}`) || [];
    });
    return result;
  }

  _storageEnabled() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }
    try {
      const testKey = '__ktv_cache_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      logService.debug('[CacheService] 本地存储不可用，跳过持久化', error);
      return false;
    }
  }

  _hydrateDictCacheFromStorage(ttl = this.DEFAULT_DICT_TTL) {
    if (!this.storageEnabled) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(this.STORAGE_KEYS.payload);
      if (!raw) {
        return;
      }
      const payload = JSON.parse(raw);
      if (payload?.version !== 2) { this._clearDictStorage(); return; }
      const storedTimestamp = Number(payload?.timestamp) || 0;
      const storedTtl = Number(payload?.ttl) || ttl;
      if (!storedTimestamp || storedTtl <= 0) {
        this._clearDictStorage();
        return;
      }
      const expiresAt = storedTimestamp + storedTtl;
      if (Date.now() >= expiresAt) {
        this._clearDictStorage();
        return;
      }
      const remainingTtl = Math.max(1000, expiresAt - Date.now());
      const groups = payload?.groups || {};
      const allList = ensureArray(payload?.all);

      Object.entries(groups).forEach(([groupKey, list]) => {
        if (Array.isArray(list)) {
          this.set(`dict.${groupKey}`, list, remainingTtl);
        }
      });

      if (allList.length > 0) {
        this.set('dict.all', allList, remainingTtl);
      }
      if (storedTimestamp) {
        this.set('dict.timestamp', storedTimestamp, remainingTtl);
      }

      this.dictInitialized = true;
      this.dictInitError = null;
      this._hydratedFromStorage = true;
      logService.info('[CacheService] 已从本地缓存恢复字典数据', {
        groups: Object.keys(groups).length,
        remainingMs: remainingTtl
      });
    } catch (error) {
      logService.warn('[CacheService] 恢复本地字典缓存失败', error);
      this._clearDictStorage();
    }
  }

  _saveDictCacheToStorage(groups = {}, allList = [], ttl = this.DEFAULT_DICT_TTL, timestamp = Date.now()) {
    if (!this.storageEnabled) {
      return;
    }
    try {
      const payload = {
        version: 2,
        timestamp,
        ttl,
        groups,
        all: allList
      };
      window.localStorage.setItem(this.STORAGE_KEYS.payload, JSON.stringify(payload));
      logService.debug('[CacheService] 字典数据已写入本地缓存', { groupCount: Object.keys(groups).length });
    } catch (error) {
      logService.warn('[CacheService] 写入本地字典缓存失败', error);
    }
  }

  _clearDictStorage() {
    if (!this.storageEnabled) {
      return;
    }
    try {
      window.localStorage.removeItem(this.STORAGE_KEYS.payload);
    } catch (error) {
      logService.debug('[CacheService] 清理本地字典缓存失败', error);
    }
  }

  // =====================
  // 其他预加载功能
  // =====================

  async preloadTopSongs(params = { page: 1, pageSize: 20 }, ttl = 10 * 60 * 1000) {
    try {
      logService.info('[CacheService] 开始预加载热门歌曲...');
      // 动态导入 songService，避免循环依赖问题
      const { default: songService } = await import('../modules/songs/SongService.js');
      const resp = await songService.getTopSongs(params);
      // 移除开发环境限制，使日志在所有环境中都能输出
      logService.info('[CacheService] 预加载热门歌曲响应数据:', resp);
      let list = [];
      if (Array.isArray(resp)) {
        list = resp;
      } else if (resp && typeof resp === 'object') {
        if (Array.isArray(resp)) {
          list = resp;
        } else if (Array.isArray(resp.data)) {
          list = resp.data;
        } else if (resp.data && Array.isArray(resp.data.data)) {
          list = resp.data.data;
        } else if (Array.isArray(resp.records)) {
          list = resp.records;
        } else if (resp.records && Array.isArray(resp.records.data)) {
          list = resp.records.data;
        } else if (resp.list && Array.isArray(resp.list)) {
          list = resp.list;
        }
      }
      // 移除开发环境限制，使日志在所有环境中都能输出
      logService.info('[CacheService] 预加载热门歌曲处理后的数据:', list);
      this.set('preload.topSongs', list, ttl);
      logService.info('[CacheService] 热门歌曲预加载完成', { count: list.length });
      return list;
    } catch (error) {
      logService.error('[CacheService] 热门歌曲预加载失败', error);
      // 即使预加载失败，也返回空数组而不是抛出错误
      this.set('preload.topSongs', [], 10 * 60 * 1000);
      return [];
    }
  }

  async preloadIndonesianSongs(params = { page: 1, pageSize: 20 }, ttl = 10 * 60 * 1000) {
    try {
      logService.info('[CacheService] 开始预加载印尼歌曲...');
      // 动态导入 songService，避免循环依赖问题
      const { default: songService } = await import('../modules/songs/SongService.js');

      // 获取印尼语编码
      const languageCode = await songService.getIndonesianLanguageCode();

      // 加载印尼歌曲数据
      const resp = await songService.loadSongsByMode('language', { languageCode }, params.page, params.pageSize);

      let list = [];
      if (Array.isArray(resp)) {
        list = resp;
      } else if (resp && typeof resp === 'object') {
        if (Array.isArray(resp.data)) {
          list = resp.data;
        } else if (resp.data && Array.isArray(resp.data.data)) {
          list = resp.data.data;
        } else if (Array.isArray(resp.records)) {
          list = resp.records;
        } else if (resp.records && Array.isArray(resp.records.data)) {
          list = resp.records.data;
        } else if (resp.list && Array.isArray(resp.list)) {
          list = resp.list;
        }
      }

      // 缓存印尼歌曲数据（使用特殊键名）
      this.set('preload.indonesianSongs', list, ttl);
      logService.info('[CacheService] 印尼歌曲预加载完成', { count: list.length, languageCode });
      return list;
    } catch (error) {
      logService.error('[CacheService] 印尼歌曲预加载失败', error);
      // 即使预加载失败，也返回空数组而不是抛出错误
      this.set('preload.indonesianSongs', [], 10 * 60 * 1000);
      return [];
    }
  }

  async preloadTopSingers(params = { page: 1, pageSize: 30 }, ttl = 10 * 60 * 1000) {
    try {
      logService.info('[CacheService] 开始预加载热门歌星...');
      // singerService 是同步加载的，从全局或 index.js 获取
      let singerService = (typeof window !== 'undefined' && window.singerService)
        ? window.singerService
        : null;

      if (!singerService) {
        const { default: singer } = await import('../modules/songs/SingerService.js');
        singerService = singer;
      }

      if (!singerService) {
        throw new Error('无法获取 singerService');
      }

      const resp = await singerService.getTopSingers(params);
      // 移除开发环境限制，使日志在所有环境中都能输出
      logService.info('[CacheService] 预加载热门歌星响应数据:', resp);
      let list = [];
      if (Array.isArray(resp)) {
        list = resp;
      } else if (resp && typeof resp === 'object') {
        if (Array.isArray(resp)) {
          list = resp;
        } else if (Array.isArray(resp.data)) {
          list = resp.data;
        } else if (resp.data && Array.isArray(resp.data.data)) {
          list = resp.data.data;
        } else if (Array.isArray(resp.records)) {
          list = resp.records;
        } else if (resp.records && Array.isArray(resp.records.data)) {
          list = resp.records.data;
        } else if (resp.list && Array.isArray(resp.list)) {
          list = resp.list;
        }
      }
      // 使用统一的日志服务
      logService.debug('[CacheService] 预加载热门歌星处理后的数据:', list);
      this.set('preload.topSingers', list, ttl);
      logService.info('[CacheService] 热门歌星预加载完成', { count: list.length });
      return list;
    } catch (error) {
      logService.error('[CacheService] 热门歌星预加载失败', error);
      // 即使预加载失败，也返回空数组而不是抛出错误
      this.set('preload.topSingers', [], 10 * 60 * 1000);
      return [];
    }
  }

  getPreloadedTopSongs() {
    return this.get('preload.topSongs') || [];
  }

  getPreloadedTopSingers() {
    return this.get('preload.topSingers') || [];
  }

  getPreloadedIndonesianSongs() {
    return this.get('preload.indonesianSongs') || [];
  }

  getPreloadedSelectedList() {
    return this.get('preload.selectedList') || [];
  }

  getSelectedListMeta() {
    return this.get('preload.selectedList.meta') || null;
  }

  getSelectedListCountFromCache() {
    const meta = this.getSelectedListMeta();
    if (meta && typeof meta.count === 'number') {
      return meta.count;
    }
    const list = this.getPreloadedSelectedList();
    return Array.isArray(list) ? list.length : 0;
  }

  isSelectedListFresh(maxAgeMs = 2000) {
    const meta = this.getSelectedListMeta();
    if (!meta || !meta.updatedAt) {
      return false;
    }
    return (Date.now() - meta.updatedAt) <= maxAgeMs;
  }

  updateSelectedListCache(list = [], ttl = 5 * 60 * 1000, extraMeta = {}) {
    const safeList = ensureArray(list);
    const snapshot = {
      updatedAt: Date.now(),
      count: safeList.length,
      source: extraMeta.source || 'unknown',
      ...extraMeta
    };
    this.set('preload.selectedList', safeList, ttl);
    this.set('preload.selectedList.meta', snapshot, ttl);
    if (typeof window !== 'undefined') {
      window.appDataCache = window.appDataCache || {};
      window.appDataCache.selectedList = safeList;
      window.appDataCache.selectedListMeta = snapshot;
      try {
        window.dispatchEvent(new CustomEvent('cache:preload:selectedList', {
          detail: {
            list: safeList,
            meta: snapshot
          }
        }));
      } catch (eventError) {
        logService?.warn?.('[CacheService] 派发 cache:preload:selectedList 事件失败', eventError);
      }
    }
    return snapshot;
  }

  async preloadPartySongs(params = { page: 1, pageSize: 20, categoryCode: '11' }, ttl = 10 * 60 * 1000) {
    try {
      logService.info('[CacheService] 开始预加载派对分类歌曲...', params);
      // 动态导入 songService，避免循环依赖问题
      const { default: songService } = await import('../modules/songs/SongService.js');
      const resp = await songService.loadSongsByMode('category', { categoryCode: params.categoryCode || '11' }, params.page || 1, params.pageSize || 20);
      logService.info('[CacheService] 预加载派对分类歌曲响应数据:', resp);
      let list = [];
      if (Array.isArray(resp)) {
        list = resp;
      } else if (resp && typeof resp === 'object') {
        if (Array.isArray(resp)) {
          list = resp;
        } else if (Array.isArray(resp.data)) {
          list = resp.data;
        } else if (resp.data && Array.isArray(resp.data.data)) {
          list = resp.data.data;
        } else if (Array.isArray(resp.records)) {
          list = resp.records;
        } else if (resp.records && Array.isArray(resp.records.data)) {
          list = resp.records.data;
        } else if (resp.list && Array.isArray(resp.list)) {
          list = resp.list;
        }
      }
      logService.info('[CacheService] 预加载派对分类歌曲处理后的数据:', list);
      const categoryCode = params.categoryCode || '11';
      const cacheKey = `preload.partySongs.${categoryCode}`;
      this.set(cacheKey, list, ttl);
      // 同时缓存到通用缓存中，供 SongService 使用
      const cacheParams = {
        mode: 'category',
        page: params.page || 1,
        pageSize: params.pageSize || 20,
        categoryCode
      };
      this.setCachedData('songs', cacheParams, list, ttl);
      logService.info('[CacheService] 派对分类歌曲预加载完成', { categoryCode, count: list.length });
      return list;
    } catch (error) {
      logService.error('[CacheService] 派对分类歌曲预加载失败', error);
      const categoryCode = params.categoryCode || '11';
      const cacheKey = `preload.partySongs.${categoryCode}`;
      this.set(cacheKey, [], 10 * 60 * 1000);
      return [];
    }
  }

  getPreloadedPartySongs(categoryCode = '11') {
    const cacheKey = `preload.partySongs.${categoryCode}`;
    return this.get(cacheKey) || [];
  }

  /**
   * 预加载素材分类数据
   * @param {Object} params - 请求参数，默认 { getAll: 0, filter: 1 }
   * @param {number} ttl - 过期时间（毫秒），默认10分钟
   * @returns {Promise<Array>} 分类列表
   */
  async preloadMaterialCategories(params = { getAll: 0, filter: 1 }, ttl = 10 * 60 * 1000) {
    try {
      logService.info('[CacheService] 开始预加载素材分类...', params);
      // 动态导入 materialService，避免循环依赖问题
      const { default: materialService } = await import('../navigation/materials/MaterialService.js');
      const response = await materialService.getMaterialCategories(params);
      let categories = ensureArray(response);

      // 缓存素材分类数据
      this.set('material.categories', categories, ttl);
      logService.info('[CacheService] 素材分类预加载完成', { count: categories.length });
      return categories;
    } catch (error) {
      logService.error('[CacheService] 素材分类预加载失败', error);
      // 即使预加载失败，也设置空数组缓存，避免重复请求
      this.set('material.categories', [], 5 * 60 * 1000);
      return [];
    }
  }

  /**
   * 获取预加载的素材分类
   * @returns {Array} 分类列表
   */
  getPreloadedMaterialCategories() {
    return this.get('material.categories') || [];
  }

  /**
   * 生成缓存key（根据请求参数）
   * @param {string} type - 数据类型：songs, singers, search等
   * @param {Object} params - 请求参数
   * @returns {string} 缓存key
   */
  generateCacheKey(type, params = {}) {
    // 按参数排序，确保相同参数生成相同的key
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}:${params[key]}`)
      .join('|');
    return `cache.${type}.${sortedParams}`;
  }

  /**
   * 设置缓存的数据（通用方法）
   * @param {string} type - 数据类型
   * @param {Object} params - 请求参数
   * @param {Array} data - 要缓存的数据
   * @param {number} ttl - 过期时间（毫秒），默认10分钟
   */
  setCachedData(type, params = {}, data = [], ttl = 10 * 60 * 1000) {
    const key = this.generateCacheKey(type, params);
    if (Array.isArray(data) && data.length > 0) {
      this.set(key, data, ttl);
      logService.debug('[CacheService] 数据已缓存', { type, key, count: data.length, ttl });
      // 记录缓存统计
      this._recordCacheStats(type, 'set');
    }
  }

  // =====================
  // 缓存统计功能
  // =====================

  /**
   * 记录缓存统计
   * @private
   */
  _recordCacheStats(type, action) {
    if (action === 'hit') {
      const count = this.stats.hits.get(type) || 0;
      this.stats.hits.set(type, count + 1);
    } else if (action === 'miss') {
      const count = this.stats.misses.get(type) || 0;
      this.stats.misses.set(type, count + 1);
    } else if (action === 'set') {
      const count = this.stats.sets.get(type) || 0;
      this.stats.sets.set(type, count + 1);
    }
  }

  /**
   * 记录用户行为
   * @param {string} type - 数据类型
   * @param {Object} params - 请求参数
   */
  recordUserBehavior(type, params = {}) {
    const behaviorKey = `${type}:${JSON.stringify(params)}`;
    const count = this.stats.userBehavior.get(behaviorKey) || 0;
    this.stats.userBehavior.set(behaviorKey, count + 1);

    // 限制行为记录数量，避免内存溢出
    if (this.stats.userBehavior.size > 1000) {
      // 移除使用频率最低的50%
      const entries = Array.from(this.stats.userBehavior.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, 500);
      entries.forEach(([key]) => this.stats.userBehavior.delete(key));
    }
  }

  /**
   * 获取缓存统计信息
   * @returns {Object} 统计信息
   */
  getCacheStats() {
    const stats = {
      hits: Object.fromEntries(this.stats.hits),
      misses: Object.fromEntries(this.stats.misses),
      sets: Object.fromEntries(this.stats.sets),
      hitRate: {},
      topBehaviors: []
    };

    // 计算命中率
    for (const type of new Set([...this.stats.hits.keys(), ...this.stats.misses.keys()])) {
      const hits = this.stats.hits.get(type) || 0;
      const misses = this.stats.misses.get(type) || 0;
      const total = hits + misses;
      stats.hitRate[type] = total > 0 ? ((hits / total) * 100).toFixed(2) + '%' : '0%';
    }

    // 获取热门行为（使用频率最高的前10个）
    const behaviors = Array.from(this.stats.userBehavior.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => ({ key, count }));
    stats.topBehaviors = behaviors;

    return stats;
  }

  /**
   * 获取缓存的数据（通用方法）
   * @param {string} type - 数据类型
   * @param {Object} params - 请求参数
   * @returns {Array|null} 缓存的数据，不存在返回null
   */
  getCachedData(type, params = {}) {
    const key = this.generateCacheKey(type, params);
    const cached = this.get(key);
    if (Array.isArray(cached) && cached.length > 0) {
      logService.debug('[CacheService] 缓存命中', { type, key, count: cached.length });
      this._recordCacheStats(type, 'hit');
      this.recordUserBehavior(type, params);
      return cached;
    }
    logService.debug('[CacheService] 缓存未命中', { type, key });
    this._recordCacheStats(type, 'miss');
    this.recordUserBehavior(type, params);
    return null;
  }

  async preloadSelectedList(ttl = 5 * 60 * 1000) {
    try {
      logService.info('[CacheService] 开始预加载已选列表...');
      const { default: selectedService } = await import('../navigation/selected/SelectedService.js');
      const resp = await selectedService.getPlayList();
      let list = [];
      if (Array.isArray(resp)) {
        list = resp;
      } else if (resp && typeof resp === 'object') {
        if (Array.isArray(resp.data)) {
          list = resp.data;
        } else if (resp.data && Array.isArray(resp.data.data)) {
          list = resp.data.data;
        } else if (resp.data && Array.isArray(resp.data.list)) {
          list = resp.data.list;
        } else if (resp.data && resp.data.records && Array.isArray(resp.data.records)) {
          list = resp.data.records;
        }
      }
      this.updateSelectedListCache(list, ttl, { source: 'preload' });
      logService.info('[CacheService] 已选列表预加载完成', { count: list.length });
      return list;
    } catch (error) {
      logService.error('[CacheService] 已选列表预加载失败', error);
      this.updateSelectedListCache([], 2 * 60 * 1000, { source: 'preload', error: error?.message || error });
      return [];
    }
  }

  /**
   * 根据用户行为预加载常用数据（智能预热）
   * @param {number} ttl - 过期时间（毫秒）
   */
  async smartPreloadBasedOnBehavior(ttl = 10 * 60 * 1000) {
    try {
      logService.debug('[CacheService] 开始基于用户行为的智能预加载...');

      // 获取热门行为
      const topBehaviors = Array.from(this.stats.userBehavior.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5); // 预加载前5个最常用的

      if (topBehaviors.length === 0) {
        logService.debug('[CacheService] 暂无用户行为数据，跳过智能预加载');
        return;
      }

      logService.debug('[CacheService] 发现热门行为', topBehaviors);

      const preloadTasks = [];

      for (const [behaviorKey, count] of topBehaviors) {
        try {
          // 使用 indexOf 只拆分第一个冒号，避免 JSON 内的冒号被拆分
          const colonIdx = behaviorKey.indexOf(':');
          const type = colonIdx > 0 ? behaviorKey.slice(0, colonIdx) : behaviorKey;
          const paramsStr = colonIdx > 0 ? behaviorKey.slice(colonIdx + 1) : '{}';
          const params = JSON.parse(paramsStr || '{}');

          // 只预加载第一页数据
          if (params.current) {
            params.page = 1;
            delete params.current;
          } else if (!params.page) {
            params.page = 1;
          }

          // 检查缓存是否已存在
          if (this.getCachedData(type, params)) {
            logService.debug('[CacheService] 热门数据已缓存，跳过预加载', { type, params });
            continue;
          }

          // 根据类型执行不同的预加载逻辑
          if (type === 'songs') {
            preloadTasks.push(this._preloadSongsByParams(params, ttl));
          } else if (type === 'singers') {
            preloadTasks.push(this._preloadSingersByParams(params, ttl));
          } else if (type === 'search') {
            preloadTasks.push(this._preloadSearchByParams(params, ttl));
          }
        } catch (error) {
          logService.warn('[CacheService] 预加载行为数据失败', { behaviorKey, error });
        }
      }

      await Promise.allSettled(preloadTasks);
      logService.debug('[CacheService] 基于用户行为的智能预加载完成');
    } catch (error) {
      logService.error('[CacheService] 智能预加载失败', error);
    }
  }

  /**
   * 预加载歌曲数据（内部方法）
   * @private
   */
  async _preloadSongsByParams(params, ttl) {
    try {
      const { default: songService } = await import('../modules/songs/SongService.js');
      const data = await songService.loadSongsByMode(
        params.mode || 'top',
        params,
        params.page || 1,
        params.pageSize || 20
      );
      const list = data?.list || [];
      if (list.length > 0) {
        this.setCachedData('songs', params, list, ttl);
      }
    } catch (error) {
      logService.warn('[CacheService] 预加载歌曲失败', { params, error });
    }
  }

  /**
   * 预加载歌手数据（内部方法）
   * @private
   */
  async _preloadSingersByParams(params, ttl) {
    try {
      // singerService 是同步加载的，从全局或 index.js 获取
      let singerService = (typeof window !== 'undefined' && window.singerService)
        ? window.singerService
        : null;

      if (!singerService) {
        const { default: singer } = await import('../modules/songs/SingerService.js');
        singerService = singer;
      }

      if (singerService) {
        const data = await singerService.getSingerList(params);
        const list = Array.isArray(data) ? data : [];
        if (list.length > 0) {
          this.setCachedData('singers', params, list, ttl);
        }
      } else {
        logService.warn('[CacheService] 无法获取 singerService，跳过预加载歌手');
      }
    } catch (error) {
      logService.warn('[CacheService] 预加载歌手失败', { params, error });
    }
  }

  /**
   * 预加载搜索数据（内部方法）
   * @private
   */
  async _preloadSearchByParams(params, ttl) {
    try {
      const { default: songSearchService } = await import('../modules/songs/SongSearchService.js');
      const data = await songSearchService.searchByKeyword(
        params.keyword || '',
        params
      );
      if (Array.isArray(data) && data.length > 0) {
        this.setCachedData('search', params, data, ttl);
      }
    } catch (error) {
      logService.warn('[CacheService] 预加载搜索失败', { params, error });
    }
  }

  async preloadAll(ttl = 30 * 60 * 1000, options = { songs: 20, singers: 30 }) {
    try {
      logService.info('[CacheService] 开始执行所有预加载任务...');
      logService.info('[CacheService] 注意：热门歌曲和派对歌曲已在应用启动时预加载，此处跳过以避免重复');

      // 使用Promise.allSettled确保所有任务都能执行，即使其中一些失败
      // 注意：热门歌曲和派对分类歌曲已在应用启动时立即预加载，此处不重复预加载
      const results = await Promise.allSettled([
        this.fetchAndCacheDictAll(ttl).catch(error => {
          logService.error('[CacheService] 字典缓存初始化失败', error);
          // 返回默认值而不是抛出错误
          return { success: false, error };
        }),
        // 热门歌曲已在启动时预加载，跳过
        // this.preloadTopSongs({ page: 1, pageSize: options.songs }, ttl),
        this.preloadTopSingers({ page: 1, pageSize: options.singers || 30 }, ttl).catch(error => {
          logService.error('[CacheService] 热门歌星预加载失败', error);
          return { success: false, error };
        }),
        // 派对分类歌曲已在启动时预加载，跳过
        // this.preloadPartySongs({ page: 1, pageSize: options.songs || 20, categoryCode: '11' }, ttl),
        // 已选列表使用较短的TTL（5分钟），因为变化频繁
        this.preloadSelectedList(5 * 60 * 1000).catch(error => {
          logService.error('[CacheService] 已选列表预加载失败', error);
          return { success: false, error };
        }),
        // 素材分类预加载已禁用 - KTV点歌台不需要此功能,且后端未实现该API
        // this.preloadMaterialCategories({ getAll: 0, filter: 1 }, 10 * 60 * 1000).catch(error => {
        //   logService.error('[CacheService] 素材分类预加载失败', error);
        //   return { success: false, error };
        // })
      ]);

      // 检查每个任务的结果
      // 注意：热门歌曲和派对歌曲结果不在数组中（已跳过）
      const [dictsResult, singersResult, selectedResult] = results;

      let singers = [];
      let selected = [];

      // 处理字典结果
      if (dictsResult.status === 'rejected') {
        logService.warn('[CacheService] 字典缓存初始化被拒绝:', dictsResult.reason);
      } else if (dictsResult.value && dictsResult.value.success === false) {
        logService.warn('[CacheService] 字典缓存初始化失败:', dictsResult.value.error);
      }

      // 处理歌星结果
      if (singersResult.status === 'fulfilled' && singersResult.value && !singersResult.value.error) {
        singers = Array.isArray(singersResult.value) ? singersResult.value : (singersResult.value.data || []);
        this.set('preload.topSingers', singers, ttl);
        logService.info('[CacheService] 热门歌星预加载完成', { count: singers.length });
      } else {
        logService.warn('[CacheService] 热门歌星预加载失败或被拒绝');
        singers = [];
      }

      // 处理已选列表结果（使用5分钟TTL，因为变化频繁）
      if (selectedResult && selectedResult.status === 'fulfilled' && selectedResult.value && !selectedResult.value.error) {
        selected = Array.isArray(selectedResult.value) ? selectedResult.value : (selectedResult.value.data || []);
        this.set('preload.selectedList', selected, 5 * 60 * 1000); // 使用5分钟TTL
        logService.info('[CacheService] 已选列表预加载完成', { count: selected.length });
      } else {
        logService.warn('[CacheService] 已选列表预加载失败或被拒绝');
        selected = [];
      }

      window.appDataCache = window.appDataCache || {};
      window.appDataCache.topSingers = singers;
      window.appDataCache.selectedList = selected;

      logService.info('[CacheService] 所有预加载任务完成', {
        singers: singers.length,
        selected: selected.length,
        dictsInitialized: this.dictInitialized,
        note: '热门歌曲和派对歌曲已在应用启动时预加载'
      });
    } catch (error) {
      logService.error('[CacheService] 预加载任务过程中发生未预期错误', error);
      // 不中断应用，但记录错误
    }
  }
}

// 创建并导出缓存服务实例
const cacheService = new CacheService();
export default cacheService;
