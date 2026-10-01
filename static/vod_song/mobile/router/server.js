// 简单的路由管理器
const router = {
  currentRoute: '/',
  routes: {},
  
  // 注册路由
  register(path, handler) {
    this.routes[path] = handler;
  },

  // 与 register 同义，供 index.js 等调用
  addRoute(path, handler) {
    this.register(path, handler);
  },

  // 初始化（如根据当前 location 设置 currentRoute）
  init() {
    if (typeof window !== 'undefined' && window.location && window.location.pathname) {
      this.currentRoute = window.location.pathname || '/';
    }
  },

  // 导航到指定路由
  navigate(path) {
    this.currentRoute = path;
    const handler = this.routes[path];
    if (handler && typeof handler === 'function') {
      handler();
    }
  },
  
  // 获取当前路由
  getCurrentRoute() {
    return this.currentRoute;
  }
};

export default router;
