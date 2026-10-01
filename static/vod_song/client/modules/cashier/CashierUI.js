/**
 * 收银模块UI逻辑
 */
import apiService from '../../../shared/core/ApiService.js';

class CashierUI {
  constructor() {
    this._cashierService = null;
    this._serviceModalEl = null;
    this._langService = null;
    this._langToggleHandler = null;
    this._lastTypes = null; // 缓存上次加载的服务类型
  }

  _getLangService() {
    if (!this._langService) {
      this._langService = window.langService || null;
    }
    return this._langService;
  }

  // 获取当前副语言对应的langService语言code
  _getCurrentLangCode() {
    const key = localStorage.getItem('subtitleLang') || 'none';
    const map = { id: 'id_id', en: 'en_us', vi: 'vi_vn' };
    return map[key] || 'zh_cn';
  }

  _t(key, params = {}) {
    const ls = this._getLangService();
    if (!ls) return key;
    const langCode = this._getCurrentLangCode();
    const dict = ls.translations[langCode] || ls.translations['zh_cn'] || {};
    let text = dict[key] || key;
    // 替换 {name} 等占位符
    Object.keys(params).forEach(k => {
      text = text.replace(`{${k}}`, params[k]);
    });
    return text;
  }

  // 获取服务类型的本地化名称（优先用翻译key，否则用服务器返回的name）
  _getServiceName(type) {
    const ls = this._getLangService();
    if (!ls) return type.name;
    const langCode = this._getCurrentLangCode();
    const dict = ls.translations[langCode] || ls.translations['zh_cn'] || {};
    return dict[type.id] || type.name;
  }

  async getCashierService() {
    if (!this._cashierService) {
      try {
        const modules = await import('../../index.js');
        this._cashierService = modules.cashierService;
      } catch (error) {
        throw error;
      }
    }
    return this._cashierService;
  }

  get cashierService() {
    return this._cashierService || null;
  }

  // ==================== 服务弹窗 ====================

  /**
   * 获取服务选择弹窗实例
   * @returns {{ show, close }}
   */
  getServiceModal() {
    return {
      show: () => this._showServiceModal(),
      close: () => this._closeServiceModal(),
    };
  }

  _ensureModalEl() {
    if (this._serviceModalEl) return this._serviceModalEl;

    const el = document.createElement('div');
    el.id = 'service-modal-overlay';
    el.style.cssText = `
      display:none; position:fixed; inset:0; z-index:9999;
      background:rgba(0,0,0,0.75); backdrop-filter:blur(4px);
      align-items:center; justify-content:center;
    `;
    el.innerHTML = `
      <div id="service-modal-box" style="
        background:#1a2233; border:1px solid rgba(16,185,129,0.35);
        border-radius:16px; padding:28px 24px; width:90%; max-width:480px;
        box-shadow:0 0 40px rgba(16,185,129,0.2);
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h2 style="color:#fff;font-size:18px;font-weight:600;margin:0;">
            <i class="fas fa-concierge-bell" style="color:#10b981;margin-right:8px;"></i><span id="service-modal-title">${this._t('selectService')}</span>
          </h2>
          <button id="service-modal-close" style="
            background:transparent;border:none;color:#6b7280;font-size:20px;cursor:pointer;padding:4px;
          "><i class="fas fa-times"></i></button>
        </div>
        <div id="service-modal-grid" style="
          display:grid; grid-template-columns:repeat(3,1fr); gap:12px;
        ">
          <div style="grid-column:1/-1;text-align:center;color:#6b7280;padding:20px;">${this._t('serviceLoading')}</div>
        </div>
        <p id="service-modal-tip" style="
          color:#10b981;font-size:13px;text-align:center;margin-top:16px;min-height:20px;
        "></p>
      </div>
    `;

    el.addEventListener('click', (e) => {
      if (e.target === el) this._closeServiceModal();
    });
    el.querySelector('#service-modal-close')
      .addEventListener('click', () => this._closeServiceModal());

    document.body.appendChild(el);
    this._serviceModalEl = el;

    // 监听语言切换，刷新弹窗文字
    this._langToggleHandler = () => {
      this._refreshModalStaticText();
      if (this._lastTypes && el.style.display !== 'none') {
        this._renderServiceGrid(this._lastTypes);
      }
    };
    window.addEventListener('languageToggled', this._langToggleHandler);

    return el;
  }

  _refreshModalStaticText() {
    const el = this._serviceModalEl;
    if (!el) return;
    const titleEl = el.querySelector('#service-modal-title');
    if (titleEl) titleEl.textContent = this._t('selectService');
  }

  // 默认服务类型（API 不可用时的兜底）
  static get DEFAULT_TYPES() {
    return [
      { id: 'svc-call',  name: '呼叫', icon: 'fa-bell' },
      { id: 'svc-cup',   name: '杯子', icon: 'fa-glass-cheers' },
      { id: 'svc-clean', name: '清洁', icon: 'fa-broom' },
      { id: 'svc-bill',  name: '买单', icon: 'fa-file-invoice-dollar' },
      { id: 'svc-ice',   name: '冰块', icon: 'fa-snowflake' },
    ];
  }

  async _showServiceModal() {
    const el = this._ensureModalEl();
    el.style.display = 'flex';
    this._refreshModalStaticText();
    document.dispatchEvent(new CustomEvent('modalOpened'));

    const grid = el.querySelector('#service-modal-grid');
    const tip  = el.querySelector('#service-modal-tip');
    tip.textContent = '';
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#6b7280;padding:20px;">${this._t('serviceLoading')}</div>`;

    // 先尝试从服务器获取类型，失败则用内置默认值
    let types = CashierUI.DEFAULT_TYPES;
    try {
      const res = await apiService.getServiceTypes();
      const remote = (res && res.data) || [];
      if (remote.length) types = remote;
    } catch (_) {
      // 使用默认类型，不提示错误
    }

    this._lastTypes = types;
    this._renderServiceGrid(types);
  }

  _renderServiceGrid(types) {
    const el = this._serviceModalEl;
    if (!el) return;
    const grid = el.querySelector('#service-modal-grid');
    const tip  = el.querySelector('#service-modal-tip');
    if (!grid) return;

    grid.innerHTML = types.map(t => `
      <button data-id="${t.id}" data-name="${t.name}" style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:10px;padding:18px 10px;
        background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);
        border-radius:12px;color:#10b981;cursor:pointer;
        font-size:15px;font-weight:500;
        transition:background 0.15s,transform 0.1s;
      "
      onmousedown="this.style.transform='scale(0.95)'"
      onmouseup="this.style.transform=''"
      ontouchstart="this.style.background='rgba(16,185,129,0.25)'"
      ontouchend="this.style.background='rgba(16,185,129,0.08)'">
        <i class="fas ${t.icon || 'fa-concierge-bell'}" style="font-size:26px;"></i>
        <span>${this._getServiceName(t)}</span>
      </button>
    `).join('');

    grid.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', () => this._onServiceSelect(btn.dataset.id, btn.dataset.name, tip));
    });
  }

  async _onServiceSelect(callType, callName, tipEl) {
    if (callType === 'svc-cup') {
      this._showQtyPicker(callType, callName, tipEl);
      return;
    }
    await this._sendServiceCall(callType, callName, '', tipEl);
  }

  _showQtyPicker(callType, callName, tipEl) {
    const grid = this._serviceModalEl.querySelector('#service-modal-grid');
    const localName = this._getServiceName({ id: callType, name: callName });

    let qty = 1;
    const render = () => `
      <div id="qty-picker" style="display:flex;flex-direction:column;align-items:center;gap:20px;padding:8px 0;">
        <p style="color:#d1d5db;font-size:15px;margin:0;">${this._t('selectQty', { name: localName })}</p>
        <div style="display:flex;align-items:center;gap:24px;">
          <button id="qty-minus" style="
            width:48px;height:48px;border-radius:50%;border:1px solid rgba(16,185,129,0.5);
            background:rgba(16,185,129,0.1);color:#10b981;font-size:24px;cursor:pointer;
          ">−</button>
          <span id="qty-val" style="color:#fff;font-size:32px;font-weight:700;min-width:40px;text-align:center;">${qty}</span>
          <button id="qty-plus" style="
            width:48px;height:48px;border-radius:50%;border:1px solid rgba(16,185,129,0.5);
            background:rgba(16,185,129,0.1);color:#10b981;font-size:24px;cursor:pointer;
          ">+</button>
        </div>
        <div style="display:flex;gap:12px;width:100%;">
          <button id="qty-back" style="
            flex:1;padding:12px;border-radius:10px;border:1px solid rgba(107,114,128,0.4);
            background:rgba(107,114,128,0.1);color:#9ca3af;font-size:15px;cursor:pointer;
          ">${this._t('back')}</button>
          <button id="qty-confirm" style="
            flex:2;padding:12px;border-radius:10px;border:none;
            background:rgba(16,185,129,0.85);color:#fff;font-size:15px;font-weight:600;cursor:pointer;
          ">${this._t('confirmCall')}</button>
        </div>
      </div>
    `;

    grid.innerHTML = render();
    if (tipEl) tipEl.textContent = '';

    const updateQty = (val) => {
      qty = Math.max(1, Math.min(20, val));
      grid.querySelector('#qty-val').textContent = qty;
    };

    grid.querySelector('#qty-minus').addEventListener('click', () => updateQty(qty - 1));
    grid.querySelector('#qty-plus').addEventListener('click', () => updateQty(qty + 1));
    grid.querySelector('#qty-back').addEventListener('click', () => this._showServiceModal());
    grid.querySelector('#qty-confirm').addEventListener('click', async () => {
      const note = qty > 1 ? `x${qty}` : '';
      await this._sendServiceCall(callType, callName, note, tipEl);
    });
  }

  async _sendServiceCall(callType, callName, note, tipEl) {
    const localName = this._getServiceName({ id: callType, name: callName });
    const displayName = note ? `${localName} ${note}` : localName;
    if (tipEl) tipEl.textContent = this._t('sendingRequest', { name: displayName });
    try {
      await apiService.sendServiceCall(callType, callName, note);
      if (tipEl) tipEl.textContent = this._t('requestSent', { name: displayName });
      setTimeout(() => this._closeServiceModal(), 1800);
    } catch (e) {
      if (tipEl) tipEl.textContent = this._t('sendFailed');
    }
  }

  _closeServiceModal() {
    if (this._serviceModalEl) {
      this._serviceModalEl.style.display = 'none';
    }
    document.dispatchEvent(new CustomEvent('modalClosed'));
  }

  // ==================== 其他占位方法 ====================

  renderDrinkCategories(categories) {}
  renderDrinks(drinks) {}
  updateOrderDisplay(order) {}
  bindCashierEvents() {}
  closeServiceModal() { this._closeServiceModal(); }
}

const cashierUI = new CashierUI();

export function getServiceModal() {
  return cashierUI.getServiceModal();
}

export default cashierUI;
