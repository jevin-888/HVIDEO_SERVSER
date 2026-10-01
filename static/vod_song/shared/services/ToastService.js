/**
 * 全局提示框服务：同一时刻只显示一条，新提示在同一坐标交替显示（不列队堆叠）
 */
class ToastService {
  constructor() {
    this.toastContainer = null;
    this.currentToast = null;
    this._hideTimer = null;
    this.init();
  }

  init() {
    if (typeof document === 'undefined' || !document.body) return;
    this._ensureContainer();
  }

  _ensureContainer() {
    if (this.toastContainer && document.body.contains(this.toastContainer)) return;
    this.toastContainer = document.createElement('div');
    this.toastContainer.id = 'global-toast-container';
    document.body.appendChild(this.toastContainer);
    this._injectBaseStyles();
  }

  _injectBaseStyles() {
    if (document.getElementById('toast-styles')) return;
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
      #global-toast-container { position: fixed; top: 80px; left: 50%; transform: translateX(-50%); z-index: 999999; pointer-events: none; }
      .global-toast { padding: 10px 22px; border-radius: 16px; color: #fff; font-weight: 600; font-size: 1.2rem; text-align: center; max-width: 90vw; box-shadow: 0 10px 30px rgba(0,0,0,0.2); opacity: 0; transform: translateY(-20px); pointer-events: auto; }
      .global-toast.success { background-color: #22c55e; }
      .global-toast.error { background-color: #ef4444; }
      .global-toast.warning { background-color: #f59e0b; }
      .global-toast.info { background-color: #3b82f6; }
      @keyframes toastSlideIn { to { opacity: 1; transform: translateY(0); } }
      @keyframes toastSlideOut { to { opacity: 0; transform: translateY(-10px); } }
      .global-toast { animation: toastSlideIn 0.35s forwards; }
      .global-toast.global-toast-slide-out { animation: toastSlideOut 0.3s forwards; }
    `;
    document.head.appendChild(style);
  }

  _clearHideTimer() {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
  }

  /**
   * 显示提示信息。同一时刻只显示一条，新提示在同一位置替换当前内容并重置计时
   * @param {string} message - 消息内容
   * @param {string} type - 提示类型 (info/success/warning/error)
   * @param {number} duration - 显示时长(毫秒)，默认800ms
   */
  showToast(message, type = 'info', duration = 800) {
    if (typeof document === 'undefined' || !document.body) return null;
    this._ensureContainer();
    if (!this.toastContainer) return null;

    this._clearHideTimer();
    if (this.currentToast && this.currentToast.parentNode) {
      this.currentToast.textContent = message;
      this.currentToast.className = `global-toast ${type}`;
      this.currentToast.classList.remove('global-toast-slide-out');
      this.currentToast.style.animation = 'toastSlideIn 0.35s forwards';
    } else {
      const toast = document.createElement('div');
      toast.className = `global-toast ${type}`;
      toast.textContent = message;
      this.toastContainer.appendChild(toast);
      this.currentToast = toast;
    }

    if (duration > 0) {
      this._hideTimer = setTimeout(() => {
        this._hideTimer = null;
        this.hideToast(this.currentToast);
      }, duration);
    }
    return this.currentToast;
  }

  /**
   * 隐藏并移除当前提示框
   * @param {HTMLElement} [toast] - 指定元素，缺省为当前 toast
   */
  hideToast(toast) {
    const el = toast || this.currentToast;
    if (!el || !el.parentNode) return;
    this._clearHideTimer();
    el.classList.add('global-toast-slide-out');
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (this.currentToast === el) this.currentToast = null;
    }, 300);
  }

  /**
   * 显示成功提示
   * @param {string} message - 消息内容
   * @param {number} duration - 显示时长(毫秒)
   */
  showSuccess(message, duration) {
    return this.showToast(message, 'success', duration);
  }

  /**
   * 显示警告提示
   * @param {string} message - 消息内容
   * @param {number} duration - 显示时长(毫秒)
   */
  showWarning(message, duration) {
    return this.showToast(message, 'warning', duration);
  }

  /**
   * 显示错误提示
   * @param {string} message - 消息内容
   * @param {number} duration - 显示时长(毫秒)
   */
  showError(message, duration) {
    return this.showToast(message, 'error', duration);
  }

  /**
   * 显示信息提示
   * @param {string} message - 消息内容
   * @param {number} duration - 显示时长(毫秒)
   */
  showInfo(message, duration) {
    return this.showToast(message, 'info', duration);
  }
}

// 创建并导出全局实例
const toastService = new ToastService();
export default toastService;
