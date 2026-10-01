import { mapSongListParams, mapSingerListParams } from '../utils/apiParamsMapper.js';
import { isApiOk, getApiErrorMessage } from '../utils/ApiResponseUtils.js';
/**
 * ApiService - 符合 API v1 设计规范
 * 
 * 当前约束：
 * 1. 所有手机端接口统一对齐到 /api/v1
 * 2. 支持 RESTful 风格（GET/POST/PUT/DELETE）
 * 3. 房间相关 API 统一通过 :id 路径参数传递
 * 4. 统一使用 JSON 格式
 */

class ApiService {
  constructor() {
    // ApiService 构造函数启动
    this.config = window.AppConfig;
    // 优先级：1. URL参数 (?roomId=xxx) 2. 裸IP URL (?192.168.x.x) 3. localStorage (currentRoomId > clientIp) 4. 默认 'current'
    try {
        this.roomId = this._getRoomIdFromUrl() || this._getRoomIdFromStorage() || 'current';
    } catch (e) {
        if (typeof window !== 'undefined' && window.__rawConsole) window.__rawConsole.error('[ApiService] 房间ID解析失败:', e);
        this.roomId = 'current';
    }
    try {
        this._log('info', `ApiService 初始化，使用房间ID: ${this.roomId}`);
    } catch (e) {}
  }

  /**
   * 从localStorage获取房间ID
   */
  _getRoomIdFromStorage() {
    try {
      // 已解析出的真实房间ID优先级更高，避免被历史 clientIp 覆盖到错误房间
      const currentRoomId = localStorage.getItem('currentRoomId');
      if (currentRoomId && currentRoomId !== 'current') return currentRoomId;

      const clientIp = localStorage.getItem('clientIp');
      if (clientIp) return clientIp;

      return currentRoomId;
    } catch (e) {
      return null;
    }
  }

  /**
   * 从URL参数获取房间ID
   */
  _getRoomIdFromUrl() {
    try {
      const configuredRoomId = window.AppConfig?.getRoomIdFromUrl;
      if (typeof configuredRoomId === 'function') {
        return configuredRoomId() || null;
      }

      const search = window.location.search.substring(1);
      if (!search) return null;

      const params = new URLSearchParams(search);
      const rid = params.get('roomId');
      if (rid && rid.trim()) return rid.trim();

      // 兼容历史移动端链接：/mobile/?192.168.x.x
      const first = search.split('&')[0];
      if (first && first.indexOf('=') === -1) {
        const legacy = decodeURIComponent(first).trim();
        if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(legacy)) return legacy;
      }
      
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 获取当前房间ID
   */
  getRoomId() {
    return this.roomId;
  }

  _resolveSongNo(params = {}) {
    if (typeof params === 'string' || typeof params === 'number') {
      const value = String(params).trim();
      return value || '';
    }

    const value = params.songNo;
    if (value === undefined || value === null) return '';
    return String(value).trim();
  }

  /**
   * 设置当前房间ID
   */
  setRoomId(roomId) {
    this.roomId = roomId;
    try {
      localStorage.setItem('currentRoomId', roomId);
    } catch (e) {
      this._log('warn', '无法保存房间ID到localStorage', e);
    }
  }

  /**
   * 替换路径中的参数占位符
   * @param {string} path - 路径模板，如 '/rooms/:id/queue'
   * @param {Object} params - 参数对象，如 {id: '123', songNo: '456'}
   * @returns {string} 替换后的路径
   */
  _replacePathParams(path, params = {}) {
    let result = path;

    // 替换 :id 为房间ID
    if (result.includes(':id')) {
      const roomId = params.id || this.roomId;
      result = result.replace(':id', roomId);
    }

    // 替换其他参数
    Object.keys(params).forEach(key => {
      const placeholder = ':' + key;
      if (result.includes(placeholder)) {
        result = result.replace(placeholder, params[key]);
      }
    });

    return result;
  }

  /**
   * 统一拼接URL
   */
  _joinUrl(baseUrl = '', endpoint = '') {
    if (!baseUrl) return endpoint || '';
    if (!endpoint) return baseUrl || '';

    // 移除baseUrl末尾的斜杠
    const base = baseUrl.replace(/\/+$/, '');
    // 确保endpoint以斜杠开头
    const ep = endpoint.startsWith('/') ? endpoint : '/' + endpoint;

    return base + ep;
  }

  /**
   * 创建超时控制器
   */
  _createTimeoutController(timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    return { controller, timeoutId };
  }

  /**
   * 处理超时错误
   */
  _handleTimeoutError(error, timeoutId) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('请求超时');
    }
    if (error.message && (error.message.includes('fetch') || error.message.includes('Failed to fetch'))) {
      const networkError = new Error(`网络请求失败: ${error.message}`);
      networkError.originalError = error;
      networkError.name = 'NetworkError';
      throw networkError;
    }
    throw error;
  }

  /**
   * 解析响应数据
   */
  async _parseResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return text;
    }
  }

  /**
   * 获取认证头
   * 注意：KTV终端/客户端的所有业务接口无需认证
   * 仅管理后台接口需要JWT Token认证
   */
  _getAuthHeaders() {
    const headers = {};
    const auth = (typeof window !== 'undefined' && window.AppConfig && window.AppConfig.auth)
      ? window.AppConfig.auth
      : null;
    if (auth && auth._uname && auth.clientId) {
      headers._uname = auth._uname;
      headers.clientid = auth.clientId;
    }
    const token = this._getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * 获取存储的JWT Token（仅管理后台使用）
   */
  _getToken() {
    try {
      return localStorage.getItem('auth_token') || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 设置JWT Token（仅管理后台使用）
   */
  setToken(token) {
    try {
      localStorage.setItem('auth_token', token);
    } catch (e) {
      this._log('warn', '无法保存Token到localStorage', e);
    }
  }

  /**
   * 清除JWT Token（仅管理后台使用）
   */
  clearToken() {
    try {
      localStorage.removeItem('auth_token');
    } catch (e) {
      this._log('warn', '无法清除Token', e);
    }
  }

  /**
   * 管理员登录（仅管理后台使用）
   * POST /api/v1/auth/login
   */
  async login(clientKey, clientSecret) {
    const response = await this._sendJson('muc', '/auth/login', {
      clientKey: clientKey,
      clientSecret: clientSecret
    }, 'POST');
    
    if (response && response.data && response.data.token) {
      this.setToken(response.data.token);
    }
    
    return response;
  }

  /**
   * 打印请求详情
   */
  _logRequest(tag, info) {
    try {
      if (typeof window !== 'undefined' && window.logService) {
        const paramsStr = JSON.stringify(info.params || {});
        window.logService.info(`[ApiService] ${tag} - ${info.method} ${info.url}, 参数: ${paramsStr}`, 'ApiService');
      }
    } catch (e) {
      // 静默失败
    }
  }

  /**
   * 解析服务器配置
   */
  _resolveServer(serverType) {
    switch (serverType) {
      case 'song':
        return { baseUrl: this.config.songServer?.baseUrl || '/api/v1', endpoints: this.config.songServer?.endpoints || {} };
      case 'cashier':
        return { baseUrl: this.config.cashierServer?.baseUrl || '/api/v1', endpoints: this.config.cashierServer?.endpoints || {} };
      case 'muc':
      default:
        return { baseUrl: this.config.mucServer?.baseUrl || '/api/v1', endpoints: this.config.mucServer?.endpoints || {} };
    }
  }

  /**
   * 发送 GET 请求
   */
  async _sendGet(serverType, endpoint, params = {}, extraHeaders = {}) {
    const cfg = this._resolveServer(serverType);
    const headers = { ...this._getAuthHeaders(), ...extraHeaders };

    // 替换路径参数
    const processedEndpoint = this._replacePathParams(endpoint, params);

    // 构建查询字符串（排除已用于路径替换的参数）
    const queryParams = { ...params };
    const pathParamKeys = Array.from(endpoint.matchAll(/:([A-Za-z0-9_]+)/g), match => match[1]);
    pathParamKeys.forEach(key => delete queryParams[key]);
    const queryString = new URLSearchParams(queryParams).toString();
    const ep = queryString ? `${processedEndpoint}?${queryString}` : processedEndpoint;
    const url = this._joinUrl(cfg.baseUrl, ep);

    this._logRequest(`GET ${endpoint}`, { serverType, method: 'GET', url, headers, params });

    const { controller, timeoutId } = this._createTimeoutController();

    try {
      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData && errorData.message) errorMessage = errorData.message;
        } catch (e) { }
        throw new Error(errorMessage);
      }
      return await this._parseResponse(response);
    } catch (error) {
      this._handleTimeoutError(error, timeoutId);
    }
  }

  /**
   * 发送 JSON 请求
   */
  async _sendJson(serverType, endpoint, params = {}, method = 'POST', extraHeaders = {}) {
    const cfg = this._resolveServer(serverType);

    // 替换路径参数
    const processedEndpoint = this._replacePathParams(endpoint, params);
    const url = this._joinUrl(cfg.baseUrl, processedEndpoint);

    const headers = {
      ...this._getAuthHeaders(),
      'Content-Type': 'application/json',
      ...extraHeaders
    };

    const bodyParams = { ...params };
    const pathParamKeys = Array.from(endpoint.matchAll(/:([A-Za-z0-9_]+)/g), match => match[1]);
    pathParamKeys.forEach(key => delete bodyParams[key]);

    this._logRequest(`${method} ${endpoint}`, { serverType, method, url, headers, params: bodyParams });

    if (this.config.debug) {
    }

    const { controller, timeoutId } = this._createTimeoutController();
    const fetchOptions = {
      method,
      headers,
      signal: controller.signal
    };
    if (Object.keys(bodyParams).length > 0) {
      fetchOptions.body = JSON.stringify(bodyParams);
    }

    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData && errorData.message) errorMessage = errorData.message;
        } catch (e) { }
        throw new Error(errorMessage);
      }
      return await this._parseResponse(response);
    } catch (error) {
      if (this.config.debug || error.name === 'TypeError' || error.message.includes('fetch')) {
        console.error(`[ApiService] fetch error for ${method} ${url}:`, error);
      }
      this._handleTimeoutError(error, timeoutId);
    }

  }

  /**
   * 通用 GET（用于同源相对路径）
   */
  async get(path = '', params = {}) {
    const query = new URLSearchParams(params || {}).toString();
    const url = query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path;
    const headers = this._getAuthHeaders();
    this._logRequest('GET', { method: 'GET', url, params });
    const { controller, timeoutId } = this._createTimeoutController();
    try {
      const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) {
        let errorMessage = `HTTP ${res.status}: ${res.statusText}`;
        try {
          const errorData = await res.json();
          if (errorData && errorData.message) errorMessage = errorData.message;
        } catch (e) { }
        throw new Error(errorMessage);
      }
      return await this._parseResponse(res);
    } catch (e) {
      this._handleTimeoutError(e, timeoutId);
    }
  }

  /**
   * 通用 PUT
   */
  async put(path = '', body = {}) {
    const headers = { ...this._getAuthHeaders(), 'Content-Type': 'application/json' };
    this._logRequest('PUT', { method: 'PUT', url: path, headers, params: body });
    const { controller, timeoutId } = this._createTimeoutController();
    try {
      const res = await fetch(path, { method: 'PUT', headers, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) {
        let errorMessage = `HTTP ${res.status}: ${res.statusText}`;
        try {
          const errorData = await res.json();
          if (errorData && errorData.message) errorMessage = errorData.message;
        } catch (e) { }
        throw new Error(errorMessage);
      }
      return await this._parseResponse(res);
    } catch (e) {
      this._handleTimeoutError(e, timeoutId);
    }
  }

  /**
   * 通用 POST
   */
  async post(path = '', body = {}) {
    const headers = { ...this._getAuthHeaders(), 'Content-Type': 'application/json' };
    this._logRequest('POST', { method: 'POST', url: path, headers, params: body });
    const { controller, timeoutId } = this._createTimeoutController();
    try {
      const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) {
        let errorMessage = `HTTP ${res.status}: ${res.statusText}`;
        try {
          const errorData = await res.json();
          if (errorData && errorData.message) errorMessage = errorData.message;
        } catch (e) { }
        throw new Error(errorMessage);
      }
      return await this._parseResponse(res);
    } catch (e) {
      this._handleTimeoutError(e, timeoutId);
    }
  }

  /**
   * 通用 DELETE
   */
  async delete(path = '', body = {}) {
    const headers = { ...this._getAuthHeaders(), 'Content-Type': 'application/json' };
    this._logRequest('DELETE', { method: 'DELETE', url: path, headers, params: body });
    const { controller, timeoutId } = this._createTimeoutController();
    try {
      const res = await fetch(path, { method: 'DELETE', headers, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) {
        let errorMessage = `HTTP ${res.status}: ${res.statusText}`;
        try {
          const errorData = await res.json();
          if (errorData && errorData.message) errorMessage = errorData.message;
        } catch (e) { }
        throw new Error(errorMessage);
      }
      return await this._parseResponse(res);
    } catch (e) {
      this._handleTimeoutError(e, timeoutId);
    }
  }

  /* ========================
   * 歌曲数据服务器 (songServer) - API v1
   * ======================== */

  /**
   * 获取系统字典
   * GET /api/v1/system/dicts
   */
  async getDictList(params = {}) {
    const ep = this.config.songServer?.endpoints?.getDictList || '/system/dicts';
    return await this._sendGet('song', ep, params);
  }

  /**
   * GET /api/v1/songdb/singers
   */
  async getSingerList(params = {}) {
    const ep = this.config.songServer?.endpoints?.singerList || '/songdb/singers';
    return await this._sendGet('song', ep, mapSingerListParams(params));
  }

  /**
   * 获取歌星详情（统一使用后台格式）
   * GET /api/v1/songdb/singers/:id
   */
  async getSingerDetail(singerId) {
    const ep = '/songdb/singers/:id';
    const response = await this._sendGet('song', ep, { id: singerId });
    return response;
  }

  /**
   * GET /api/v1/songdb/songs
   */
  async getSongList(params = {}) {
    const ep = this.config.songServer?.endpoints?.songList || '/songdb/songs';
    return await this._sendGet('song', ep, mapSongListParams(params));
  }

  /* ========================
   * 中控/客户端服务器 (mucServer) - API v1
   * ======================== */

  /**
   * 点歌
   * POST /api/v1/rooms/:id/queue
   */
  async selectSong(params = {}) {
    const ep = this.config.mucServer?.endpoints?.requestSong || '/rooms/:id/queue';
    const songNo = this._resolveSongNo(params);
    if (!songNo) throw new Error('歌曲编号无效');
    const payload = { songNo };
    if (params.isPriority === true) payload.isPriority = true;
    return await this._sendJson('muc', ep, payload, 'POST');
  }

  /**
   * 音乐栏控制
   * POST /api/v1/rooms/:id/command
   */
  async musicBarControl(params = {}) {
    const ep = this.config.mucServer?.endpoints?.musicBarControl || '/rooms/:id/command';
    return await this._sendJson('muc', ep, params, 'POST');
  }

  /**
   * GET /api/v1/rooms/:id/state
   */
  async getRoomState(params = {}) {
    const ep = this.config.mucServer?.endpoints?.roomState || '/rooms/:id/state';
    const response = await this._sendGet('muc', ep, params);
    if (!isApiOk(response)) {
      throw new Error(getApiErrorMessage(response, 'Failed to get room state'));
    }
    if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
      throw new TypeError('Room state API data must be an object');
    }
    this.lastRoomState = response.data;
    return response.data;
  }

  /**
   * 获取播放列表
   * GET /api/v1/rooms/:id/queue
   */
  async getPlayList() {
    const ep = this.config.mucServer?.endpoints?.getPlayList || '/rooms/:id/queue';
    return await this._sendGet('muc', ep);
  }

  /**
   * YouTube 点播入队（解析、持久化、空闲房间激活由服务端一次完成）
   * POST /api/v1/rooms/:id/youtube/queue
   */
  async queueYouTube(params = {}) {
    const ep = this.config.mucServer?.endpoints?.youtubeQueue || '/rooms/:id/youtube/queue';
    return await this._sendJson('muc', ep, params, 'POST');
  }

  /**
   * 播放下一首
   * POST /api/v1/rooms/:id/next
   */
  async playNext() {
    const ep = this.config.mucServer?.endpoints?.playNext || '/rooms/:id/next';
    return await this._sendJson('muc', ep, {}, 'POST');
  }

  /**
   * 获取/设置VOD配置
   * GET/POST /api/v1/rooms/:id/config
   */
  async getVodConfig(params = {}) {
    const ep = this.config.mucServer?.endpoints?.getVodConfig || '/rooms/:id/config';
    return await this._sendGet('muc', ep, params);
  }

  async setVodTargetLayer(params = {}) {
    const ep = this.config.mucServer?.endpoints?.setTargetLayer || '/rooms/:id/config';
    return await this._sendJson('muc', ep, params, 'POST');
  }

  /**
   * 置顶歌曲
   * POST /api/v1/rooms/:id/queue/prioritize
   */
  async upWord(params = {}) {
    const ep = this.config.mucServer?.endpoints?.upWord || '/rooms/:id/queue/prioritize';
    const songNo = this._resolveSongNo(params);
    if (!songNo) throw new Error('歌曲编号无效');
    return await this._sendJson('muc', ep, { songNo }, 'POST');
  }

  /**
   * DELETE /api/v1/rooms/:id/queue/:songNo
   */
  async deleteSong(params = {}) {
    const ep = this.config.mucServer?.endpoints?.delete || '/rooms/:id/queue/:songNo';
    const songNo = this._resolveSongNo(params);
    if (!songNo) throw new Error('Invalid song number');
    return await this._sendJson('muc', ep, { songNo }, 'DELETE');
  }

  /**
   * 打乱播放列表
   * POST /api/v1/rooms/:id/queue/shuffle
   */
  async shufflePlayList() {
    const ep = this.config.mucServer?.endpoints?.shufflePlay || '/rooms/:id/queue/shuffle';
    return await this._sendJson('muc', ep, {}, 'POST');
  }

  /**
   * 清空队列
   * POST /api/v1/rooms/:id/clear
   */
  async clearPlayList() {
    const ep = '/rooms/:id/clear';
    return await this._sendJson('muc', ep, {}, 'POST');
  }

  /**
   * 点击按钮
   * POST /api/v1/rooms/:id/peripheral/button
   */
  async clickButton(buttonNameAlias, params = {}) {
    const ep = this.config.mucServer?.endpoints?.clickButton || '/rooms/:id/peripheral/button';
    const payload = { buttonNameAlias, ...params };
    return await this._sendJson('muc', ep, payload, 'POST');
  }

  /**
   * 空调控制 (现代结构化接口)
   * POST /api/v1/rooms/:id/peripheral/ac
   */
  async controlAc(params = {}) {
    return await this._sendJson('muc', '/rooms/:id/peripheral/ac', params, 'POST');
  }

  /**
   * 灯光控制 (现代结构化接口)
   * POST /api/v1/rooms/:id/peripheral/light
   */
  async controlLight(params = {}) {
    return await this._sendJson('muc', '/rooms/:id/peripheral/light', params, 'POST');
  }

  /**
   * 音效控制 (现代结构化接口)
   * POST /api/v1/rooms/:id/peripheral/effect
   */
  async controlEffect(params = {}) {
    return await this._sendJson('muc', '/rooms/:id/peripheral/effect', params, 'POST');
  }

  /**
   * 声音控制 (音量/静音)
   * POST /api/v1/rooms/:id/peripheral/voice
   */
  async controlVoice(params = {}) {
    const ep = this.config.mucServer?.endpoints?.controlVoice || '/rooms/:id/peripheral/voice';
    return await this._sendJson('muc', ep, params, 'POST');
  }

  /**
   * 独立播放控制 - 播放
   * POST /api/v1/rooms/:id/play
   */
  async play() {
    return await this._sendJson('muc', '/rooms/:id/play', {}, 'POST');
  }

  /**
   * 独立播放控制 - 暂停
   * POST /api/v1/rooms/:id/pause
   */
  async pause() {
    return await this._sendJson('muc', '/rooms/:id/pause', {}, 'POST');
  }

  /**
   * 独立播放控制 - 重播
   * POST /api/v1/rooms/:id/replay
   */
  async replay() {
    return await this._sendJson('muc', '/rooms/:id/replay', {}, 'POST');
  }

  /**
   * 独立播放控制 - 原唱/伴唱切换
   * POST /api/v1/rooms/:id/track
   */
  async switchTrack(trackId) {
    return await this._sendJson('muc', '/rooms/:id/track', { trackId }, 'POST');
  }

  /**
   * 获取房间设置
   * GET /api/v1/rooms/:id/settings
   */
  async getSetting(params = {}) {
    const ep = this.config.mucServer?.endpoints?.getSetting || '/rooms/:id/settings';
    return await this._sendGet('muc', ep, params);
  }

  /**
   * 获取服务类型列表（供弹窗展示）
   * GET /api/v1/service-types
   */
  async getServiceTypes() {
    return await this._sendGet('muc', '/service-types', {});
  }

  /**
   * 发送服务铃呼叫
   * POST /api/v1/rooms/:id/peripheral/call
   * @param {string} callType - 服务类型 id（如 'svc-call'）
   * @param {string} callName - 服务类型名称（如 '呼叫'）
   * @param {string} callNote - 附加备注（如数量 'x3'）
   */
  async sendServiceCall(callType, callName = '', callNote = '') {
    const ep = this.config.mucServer?.endpoints?.prCall || '/rooms/:id/peripheral/call';
    return await this._sendJson('muc', ep, { callType, callNote }, 'POST');
  }

  /**
   * 获取流媒体列表
   * GET /api/v1/streams
   */
  async getStreamList(params = {}) {
    const ep = this.config.mucServer?.endpoints?.getStreamList || '/streams';
    return await this._sendGet('muc', ep, params);
  }

  /**
   * 播放流媒体
   * POST /api/v1/rooms/:id/streams/play
   */
  async getPlayLive(params = {}) {
    const ep = this.config.mucServer?.endpoints?.getPlayLive || '/rooms/:id/streams/play';
    return await this._sendJson('muc', ep, params, 'POST');
  }

  /**
   * 停止流媒体
   * POST /api/v1/rooms/:id/streams/stop
   */
  async getStopLive(params = {}) {
    const ep = this.config.mucServer?.endpoints?.getStopLive || '/rooms/:id/streams/stop';
    return await this._sendJson('muc', ep, params, 'POST');
  }

  /* ========================
   * 素材服务器 - API v1
   * ======================== */

  /**
   * 获取素材分类
   * GET /api/v1/materials/categories
   */
  async getMaterialCategories(params = {}) {
    const ep = this.config.mucServer?.endpoints?.getClassifyList || '/materials/categories';
    return await this._sendGet('muc', ep, params);
  }

  /**
   * 获取素材列表
   * GET /api/v1/materials
   */
  async getMaterialList(params = {}) {
    const ep = this.config.mucServer?.endpoints?.getMaterialList || '/materials';
    return await this._sendGet('muc', ep, params);
  }

  /**
   * 播放素材
   * POST /api/v1/rooms/:id/materials/play
   */
  async playMaterial(params = {}) {
    const ep = this.config.mucServer?.endpoints?.playMaterial || '/rooms/:id/materials/play';
    return await this._sendJson('muc', ep, params, 'POST');
  }

  /* ========================
   * 收银服务器 (cashierServer) - API v1
   * ======================== */

  /**
   * 获取商品分类
   * GET /api/v1/products/categories
   */
  async getCashierDrinkCategories(params = {}) {
    const ep = this.config.cashierServer?.endpoints?.drinkCategory || '/products/categories';
    return await this._sendGet('cashier', ep, params);
  }

  /**
   * 获取商品列表
   * GET /api/v1/products
   */
  async getCashierDrinks(categoryId) {
    const ep = this.config.cashierServer?.endpoints?.getDrinks || '/products';
    return await this._sendGet('cashier', ep, { categoryId });
  }

  /**
   * 提交订单
   * POST /api/v1/orders
   */
  async submitCashierOrder(orderData = {}) {
    const ep = this.config.cashierServer?.endpoints?.submitOrder || '/orders';
    return await this._sendJson('cashier', ep, orderData, 'POST');
  }

  /**
   * 获取订单详情（统一使用后台格式）
   * GET /api/v1/orders/:id/detail
   */
  async getOrderDetail(orderId) {
    const ep = this.config.cashierServer?.endpoints?.consumptionDetail || '/orders/:id/detail';
    const response = await this._sendGet('cashier', ep, { id: orderId });
    return response;
  }

  /**
   * 日志方法
   */
  _log(level, message, data) {
    if (typeof window !== 'undefined' && window.logService) {
      const logMethod = (window.logService[level] || window.logService.info).bind(window.logService);
      logMethod(`[ApiService] ${message}`, 'ApiService', data);
    }
  }
  /**
   * 获取外设预设列表（客户端公开接口）
   * @param {string} type - 预设类型: light, effect, ac
   * @returns {Promise}
   */
  async getPeripheralPresets(type) {
    const params = type ? { type } : {};
    return await this._sendGet('muc', '/peripheral/presets', params);
  }

  /**
   * 获取已唱列表
   * GET /api/v1/rooms/:id/queue/played
   */
  async getPlayedList() {
    return await this._sendGet('muc', '/rooms/:id/queue/played');
  }

}

// 创建并导出API服务实例
const apiService = new ApiService();
export default apiService;
