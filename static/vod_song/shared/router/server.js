/**
 * 路由配置
 */
class Router {
  constructor() {
    this.routes = new Map();
    this.currentRoute = '';
    this._popstateHandler = null;
    this._logService = null;
  }

  _getLogService() {
    if (this._logService) {
      return this._logService;
    }
    if (typeof window !== 'undefined' && window.logService) {
      this._logService = window.logService;
      return this._logService;
    }
    return null;
  }

  _log(level, message) {
    const logService = this._getLogService();
    if (logService && typeof logService[level] === 'function') {
      logService[level].bind(logService)(`[Router] ${message}`, 'Router');
    } else {
      import('../utils/Logger.js').then(({ logInfo, logWarn, logError }) => {
        if (level === 'error') {
          logError('Router', message, new Error(message));
        } else if (level === 'warn') {
        } else {
        }
      }).catch(() => {});
    }
  }

  addRoute(path, handler) {
    this.routes.set(path, handler);
    this._log('info', `添加路由: ${path}`);
  }

  navigateTo(path) {
    const handler = this.routes.get(path);
    if (handler) {
      try {
        this.currentRoute = path;
        handler();
        this._log('info', `导航到: ${path}`);
      } catch (error) {
        this._log('error', `路由处理函数执行失败: ${path}`);
        if (typeof window !== 'undefined' && window.logService) {
          window.logService.error('[Router] 路由处理函数执行失败', 'Router', error);
        } else {
          import('../utils/Logger.js').then(({ logError }) => {
            logError('Router', '路由处理函数执行失败', error);
          }).catch(() => {});
        }
      }
    } else {
      this._log('warn', `未找到路由: ${path}`);
    }
  }

  getCurrentRoute() {
    return this.currentRoute;
  }

  init() {
    this._popstateHandler = () => {
      const path = window.location.pathname;
      this.navigateTo(path);
    };
    window.addEventListener('popstate', this._popstateHandler);
    const initialPath = window.location.pathname;
    this.navigateTo(initialPath);
  }

  cleanup() {
    if (this._popstateHandler) {
      window.removeEventListener('popstate', this._popstateHandler);
      this._popstateHandler = null;
      this._log('info', '已清理路由事件监听器');
    }
  }

  pushState(path, state = {}) {
    window.history.pushState(state, '', path);
    this.navigateTo(path);
  }

  replaceState(path, state = {}) {
    window.history.replaceState(state, '', path);
    this.navigateTo(path);
  }
}

const router = new Router();
export default router;
