/**
 * InteractionService - 对接互动视频合成平台。
 * 所有方法只接受并返回当前上游 API 的明确契约。
 */

import logService from '../../services/LogService.js';

const SUCCESS_CODE = 200;
const SUCCESS_TYPE = 'success';
const VIDEO_TEMPLATE_TYPE = 'code_media_type_video';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class InteractionService {
  constructor() {
    this.config = window.AppConfig?.interactionServer || {
      baseUrl: '/api/v1/interaction/proxy',
      guestCode: '8a4d9f87a6b74cdc0e4c3ba1f48c9b83'
    };
    this.tokenKey = 'interaction_auth_token';
  }

  getToken() {
    return localStorage.getItem(this.tokenKey) || '';
  }

  _buildUrl(path, params = null) {
    const url = `${this.config.baseUrl}/${path}`;
    if (!params) return url;
    const query = new URLSearchParams(params).toString();
    return query ? `${url}?${query}` : url;
  }

  async _requestEnvelope(url, options, resourceName) {
    const response = await fetch(url, options);
    const text = await response.text();

    if (!response.ok) {
      const error = new Error(`${resourceName}失败（HTTP ${response.status}）`);
      error.status = response.status;
      throw error;
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new Error(`${resourceName}返回了无效 JSON`);
    }

    if (!isObject(payload) || payload.code !== SUCCESS_CODE || payload.type !== SUCCESS_TYPE) {
      const error = new Error(
        isObject(payload) && typeof payload.message === 'string' && payload.message.trim()
          ? payload.message.trim()
          : `${resourceName}失败`
      );
      error.code = isObject(payload) ? payload.code : undefined;
      throw error;
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'result')) {
      throw new Error(`${resourceName}响应缺少 result`);
    }
    return payload;
  }

  _authorizationHeaders(contentType = false) {
    const token = this.getToken();
    if (!token) throw new Error('互动登录令牌不存在');

    const headers = { Authorization: `Bearer ${token}` };
    if (contentType) headers['Content-Type'] = 'application/json';
    return headers;
  }

  _requirePageResult(payload, resourceName) {
    const result = payload.result;
    if (!isObject(result) || !Array.isArray(result.items)) {
      throw new Error(`${resourceName} result 必须是分页对象`);
    }
    return result;
  }

  async guestLogin(code) {
    const guestCode = typeof code === 'string' && code.trim() ? code.trim() : this.config.guestCode;
    const url = this._buildUrl('user/guestlogin', { code: guestCode });

    try {
      logService.info(`[InteractionService] 获取游客令牌: ${url}`);
      const payload = await this._requestEnvelope(
        url,
        { method: 'GET', redirect: 'follow' },
        '游客登录'
      );
      const token = payload.result?.accessToken;
      if (typeof token !== 'string' || !token.trim()) {
        throw new Error('游客登录 result.accessToken 无效');
      }
      localStorage.setItem(this.tokenKey, token);
      return token;
    } catch (error) {
      localStorage.removeItem(this.tokenKey);
      logService.error('[InteractionService] 获取游客令牌失败:', error);
      throw error;
    }
  }

  async getTemplateList(page = 1, code = '') {
    const pageNumber = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const url = this._buildUrl('uConfig/GetListV2', {
      source: 'templete',
      page: String(pageNumber),
      type: VIDEO_TEMPLATE_TYPE,
      code: typeof code === 'string' ? code : ''
    });

    try {
      logService.info(`[InteractionService] 获取模板列表: ${url}`);
      const payload = await this._requestEnvelope(
        url,
        { method: 'GET', redirect: 'follow' },
        '获取模板列表'
      );
      return this._requirePageResult(payload, '模板列表');
    } catch (error) {
      logService.error('[InteractionService] 获取模板列表失败:', error);
      throw error;
    }
  }

  async uploadTemplateImage(file) {
    if (!file || typeof file !== 'object') throw new Error('\u8bf7\u9009\u62e9\u8981\u4e0a\u4f20\u7684\u56fe\u7247');

    const formData = new FormData();
    formData.append('file', file);
    const url = this._buildUrl('uMediaTemplet/UploadTempleteImg');

    try {
      logService.info(`[InteractionService] \u4e0a\u4f20\u6a21\u677f\u56fe\u7247: ${url}`);
      const payload = await this._requestEnvelope(
        url,
        {
          method: 'POST',
          headers: this._authorizationHeaders(),
          body: formData,
          redirect: 'follow'
        },
        '\u4e0a\u4f20\u6a21\u677f\u56fe\u7247'
      );
      const imageUrl = payload.result?.url;
      if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
        throw new Error('\u4e0a\u4f20\u6a21\u677f\u56fe\u7247 result.url \u65e0\u6548');
      }
      return imageUrl;
    } catch (error) {
      logService.error('[InteractionService] \u4e0a\u4f20\u6a21\u677f\u56fe\u7247\u5931\u8d25:', error);
      throw error;
    }
  }

  async getMemberInfo() {
    const url = this._buildUrl('uWallet/GetMemberInfo');
    try {
      logService.info(`[InteractionService] 获取会员信息: ${url}`);
      const payload = await this._requestEnvelope(
        url,
        { method: 'GET', headers: this._authorizationHeaders(), redirect: 'follow' },
        '获取会员信息'
      );
      if (!isObject(payload.result)) throw new Error('会员信息 result 必须是对象');
      return payload.result;
    } catch (error) {
      logService.error('[InteractionService] 获取会员信息失败:', error);
      throw error;
    }
  }

  async addOrder(params) {
    if (!isObject(params)) throw new Error('订单参数必须是对象');

    const body = {
      JobParam: params.JobParam,
      TempleteId: params.TempleteId,
      TempleteICENo: params.TempleteICENo,
      TempleteName: params.TempleteName,
      JobName: params.JobName,
      TempleteType: params.TempleteType,
      Remark: params.Remark
    };
    const requiredStrings = [
      'JobParam',
      'TempleteId',
      'TempleteICENo',
      'TempleteName',
      'JobName',
      'TempleteType',
      'Remark'
    ];
    for (const key of requiredStrings) {
      if (typeof body[key] !== 'string') throw new Error(`订单字段 ${key} 必须是字符串`);
    }

    const url = this._buildUrl('UMediaOrder/AddOrder');
    try {
      logService.info(`[InteractionService] 提交视频合成: ${url}`);
      const payload = await this._requestEnvelope(
        url,
        {
          method: 'POST',
          headers: this._authorizationHeaders(true),
          body: JSON.stringify(body),
          redirect: 'follow'
        },
        '提交视频合成'
      );
      return payload.result;
    } catch (error) {
      logService.error('[InteractionService] 提交视频合成失败:', error);
      throw error;
    }
  }

  async getOrderList(page = 1, code = VIDEO_TEMPLATE_TYPE) {
    const pageNumber = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const url = this._buildUrl('UMediaOrder/OrderList', {
      page: String(pageNumber),
      code: typeof code === 'string' ? code : VIDEO_TEMPLATE_TYPE
    });

    try {
      logService.info(`[InteractionService] 查询订单列表: ${url}`);
      const payload = await this._requestEnvelope(
        url,
        { method: 'GET', headers: this._authorizationHeaders(), redirect: 'follow' },
        '查询订单列表'
      );
      return this._requirePageResult(payload, '订单列表');
    } catch (error) {
      logService.error('[InteractionService] 查询订单列表失败:', error);
      throw error;
    }
  }
}

export { InteractionService, VIDEO_TEMPLATE_TYPE };

const interactionService = new InteractionService();
export default interactionService;
