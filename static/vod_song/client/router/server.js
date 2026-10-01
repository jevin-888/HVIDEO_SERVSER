// 简单的路由管理器
const router = {
  currentRoute: '/',
  routes: {},
  initialized: false,
  
  // 初始化路由
  init() {
    if (this.initialized) return;
    this.initialized = true;
    // 可以在这里添加初始化逻辑
  },
  
  // 注册路由（兼容addRoute方法名）
  addRoute(path, handler) {
    this.routes[path] = handler;
  },
  
  // 注册路由（原方法名）
  register(path, handler) {
    this.routes[path] = handler;
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
