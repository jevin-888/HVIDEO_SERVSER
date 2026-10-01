/**
 * 智能资源预加载管理器
 * 根据用户行为和使用频率智能预加载资源，而非一次性加载所有资源
 */
import logService from '../../shared/services/LogService.js';
import TimerManager from '../utils/TimerManager.js';

class PreloadManager {
  constructor() {
    this.preloadQueue = new Map(); // 预加载队列
    this.loadedModules = new Map(); // 已加载的模块缓存
    this.loadingModules = new Set(); // 正在加载的模块集合
    this.preloadPriorities = new Map(); // 预加载优先级配置
    this.userBehavior = {
      moduleUsage: new Map(), // 模块使用频率统计
      lastUsed: new Map() // 模块最后使用时间
    };
    this._timeouts = new Set(); // 存储所有定时器ID，以便清理
    this._idleCallbacks = new Set(); // 存储所有 idle callback ID，以便清理
    this._checkIntervals = new Map(); // 存储检查间隔定时器
    this._maxCacheSize = 30; // 最大缓存模块数量
    this._maxUsageHistory = 100; // 最大使用历史记录数量
    
    // 初始化优先级配置
    this.initPriorities();
  }

  /**
   * 初始化模块优先级配置
   * 根据模块的重要性和使用频率设置优先级
   */
  initPriorities() {
    // 高优先级：首页必需的核心模块
    this.preloadPriorities.set('bottomNavUI', { priority: 1, preload: false });
    this.preloadPriorities.set('langService', { priority: 1, preload: false });
    
    // 中高优先级：常用功能模块（在空闲时预加载）
    this.preloadPriorities.set('songTopUI', { priority: 2, preload: true, delay: 1000 });
    this.preloadPriorities.set('songService', { priority: 2, preload: true, delay: 1500 });
    this.preloadPriorities.set('selectedUI', { priority: 2, preload: true, delay: 2000 });
    
    // 中优先级：次常用模块
    this.preloadPriorities.set('partyUI', { priority: 3, preload: true, delay: 3000 });
    
    // 中低优先级：控制类模块（延迟预加载，确保快速打开）
    this.preloadPriorities.set('smartlUI', { priority: 3, preload: true, delay: 4000 });
    this.preloadPriorities.set('displayUI', { priority: 3, preload: true, delay: 4500 });
    this.preloadPriorities.set('navMaterialUI', { priority: 3, preload: true, delay: 5000 });
    
    // 低优先级：较少使用的模块（按需加载）
    this.preloadPriorities.set('cashierUI', { priority: 4, preload: false });
  }

  /**
   * 记录模块使用情况
   */
  recordModuleUsage(moduleName) {
    const now = Date.now();
    const count = (this.userBehavior.moduleUsage.get(moduleName) || 0) + 1;
    this.userBehavior.moduleUsage.set(moduleName, count);
    this.userBehavior.lastUsed.set(moduleName, now);
    
    // 限制使用历史记录大小
    if (this.userBehavior.moduleUsage.size > this._maxUsageHistory) {
      // 删除最旧的使用记录（按最后使用时间排序）
      const sortedEntries = Array.from(this.userBehavior.lastUsed.entries())
        .sort((a, b) => a[1] - b[1]);
      const entriesToDelete = this.userBehavior.moduleUsage.size - this._maxUsageHistory;
      for (let i = 0; i < entriesToDelete && i < sortedEntries.length; i++) {
        const [key] = sortedEntries[i];
        this.userBehavior.moduleUsage.delete(key);
        this.userBehavior.lastUsed.delete(key);
      }
    }
    
    // 如果某个模块使用频繁，提高其预加载优先级
    if (count > 5 && this.preloadPriorities.has(moduleName)) {
      const config = this.preloadPriorities.get(moduleName);
      if (config.priority > 2) {
        config.priority = 2;
        config.preload = true;
        logService.info(`[PreloadManager] 模块 ${moduleName} 使用频繁，提升预加载优先级`);
      }
    }
  }

  /**
   * 按需加载模块
   * @param {string} modulePath - 模块路径
   * @param {string} moduleName - 模块名称（用于统计）
   * @returns {Promise} 返回模块实例
   */
  async loadModule(modulePath, moduleName = null) {
    const key = moduleName || modulePath;
    
    // 如果已加载，直接返回
    if (this.loadedModules.has(key)) {
      this.recordModuleUsage(key);
      return this.loadedModules.get(key);
    }

    // 如果正在加载，等待加载完成
    if (this.loadingModules.has(key)) {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.loadedModules.has(key)) {
            clearInterval(checkInterval);
            this._checkIntervals.delete(key);
            this.recordModuleUsage(key);
            resolve(this.loadedModules.get(key));
          }
        }, 50);
        this._checkIntervals.set(key, checkInterval);
      });
    }

    // 开始加载
    this.loadingModules.add(key);
    try {
      logService.debug(`[PreloadManager] 开始加载模块: ${key}`);
      const module = await import(modulePath);
      this.loadedModules.set(key, module);
      
      // 限制缓存大小
      if (this.loadedModules.size > this._maxCacheSize) {
        // 删除最旧且使用频率最低的模块
        const sortedByUsage = Array.from(this.loadedModules.keys())
          .map(key => ({
            key,
            usage: this.userBehavior.moduleUsage.get(key) || 0,
            lastUsed: this.userBehavior.lastUsed.get(key) || 0
          }))
          .sort((a, b) => {
            // 先按使用频率排序，再按最后使用时间排序
            if (a.usage !== b.usage) {
              return a.usage - b.usage;
            }
            return a.lastUsed - b.lastUsed;
          });
        
        const entriesToDelete = this.loadedModules.size - this._maxCacheSize;
        for (let i = 0; i < entriesToDelete && i < sortedByUsage.length; i++) {
          const { key: keyToDelete } = sortedByUsage[i];
          this.loadedModules.delete(keyToDelete);
        }
        
        if (entriesToDelete > 0 && logService) {
          logService.debug(`[PreloadManager] 清理了 ${entriesToDelete} 个缓存模块，当前缓存大小: ${this.loadedModules.size}`);
        }
      }
      
      this.recordModuleUsage(key);
      logService.debug(`[PreloadManager] 模块加载完成: ${key}`);
      return module;
    } catch (error) {
      logService.error(`[PreloadManager] 模块加载失败: ${key}`, error);
      throw error;
    } finally {
      this.loadingModules.delete(key);
    }
  }

  /**
   * 智能预加载模块（在空闲时）
   * @param {string} modulePath - 模块路径
   * @param {string} moduleName - 模块名称
   * @param {number} delay - 延迟时间（ms）
   */
  async preloadModule(modulePath, moduleName = null, delay = 0) {
    const key = moduleName || modulePath;
    
    // 如果已加载或正在加载，跳过
    if (this.loadedModules.has(key) || this.loadingModules.has(key)) {
      return;
    }

    // 如果已加入预加载队列，跳过
    if (this.preloadQueue.has(key)) {
      return;
    }

    // 添加到预加载队列
    this.preloadQueue.set(key, { path: modulePath, delay });

    // 使用 requestIdleCallback 在浏览器空闲时加载（如果支持）
    if ('requestIdleCallback' in window) {
      const idleCallbackId = requestIdleCallback(async () => {
        this._idleCallbacks.delete(idleCallbackId);
        await this.executePreload(key);
      }, { timeout: delay + 2000 });
      this._idleCallbacks.add(idleCallbackId);
    } else {
      // 降级方案：延迟加载
      const timeoutId = setTimeout(async () => {
        this._timeouts.delete(timeoutId);
        await this.executePreload(key);
      }, delay);
      this._timeouts.add(timeoutId);
    }
  }

  /**
   * 执行单个模块的预加载
   */
  async executePreload(key) {
    const task = this.preloadQueue.get(key);
    if (!task) return;

    try {
      if (task.delay > 0) {
        await TimerManager.delay(task.delay);
      }

      // 检查是否已被加载
      if (this.loadedModules.has(key)) {
        this.preloadQueue.delete(key);
        return;
      }

      await this.loadModule(task.path, key);
      this.preloadQueue.delete(key);
      logService.debug(`[PreloadManager] 预加载完成: ${key}`);
    } catch (error) {
      logService.warn(`[PreloadManager] 预加载失败: ${key}`, error);
      this.preloadQueue.delete(key);
    }
  }

  /**
   * 批量预加载模块（根据优先级）
   * @param {Array} modules - 模块列表 [{path, name, priority, delay}]
   */
  async preloadModules(modules) {
    // 按优先级排序
    const sortedModules = modules.sort((a, b) => {
      const priorityA = this.preloadPriorities.get(a.name)?.priority || 999;
      const priorityB = this.preloadPriorities.get(b.name)?.priority || 999;
      return priorityA - priorityB;
    });

    // 依次预加载
    for (const module of sortedModules) {
      if (module.preload !== false) {
        await this.preloadModule(module.path, module.name, module.delay || 0);
      }
    }
  }

  /**
   * 初始化智能预加载策略
   * 在应用启动后，根据配置和用户行为智能预加载常用模块
   */
  initSmartPreload() {
    // 等待页面加载完成
    const initPreload = () => {
      // 增加延迟时间，减少初始加载压力
      const timeout1 = setTimeout(() => {
        this._timeouts.delete(timeout1);
        // 预加载高优先级模块
        this.preloadModule('../navigation/bottomNav/BottomNavUI.js', 'bottomNavUI', 1000);
        this.preloadModule('../../shared/services/LangService/LangService.js', 'langService', 1500);
        
        // 延迟预加载中高优先级模块
        const timeout2 = setTimeout(() => {
          this._timeouts.delete(timeout2);
          this.preloadModule('../modules/songs/songTopUI.js', 'songTopUI', 2000);
          this.preloadModule('../../shared/modules/songs/SongService.js', 'songService', 2500);
          this.preloadModule('../navigation/selected/SelectedUI.js', 'selectedUI', 3000);
        }, 3000);
        this._timeouts.add(timeout2);
        
        // 延迟预加载中优先级模块
        const timeout3 = setTimeout(() => {
          this._timeouts.delete(timeout3);
          this.preloadModule('../modules/party/partyUI.js', 'partyUI', 4000);
          this.preloadModule('../navigation/smartl/SmartlUI.js', 'smartlUI', 4500);
          this.preloadModule('../navigation/display/DisplayUI.js', 'displayUI', 5000);
        }, 6000);
        this._timeouts.add(timeout3);
        
        // 延迟预加载低优先级模块
        const timeout4 = setTimeout(() => {
          this._timeouts.delete(timeout4);
          this.preloadModule('../navigation/materials/MaterialUI.js', 'navMaterialUI', 7000);
          this.preloadModule('../modules/cashier/CashierUI.js', 'cashierUI', 8000);
        }, 9000);
        this._timeouts.add(timeout4);
      }, 2000); // 初始延迟2秒
      this._timeouts.add(timeout1);
    };
    
    // 检查页面是否已经加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initPreload);
    } else {
      // 页面已经加载完成，直接初始化
      initPreload();
    }
    
    logService.debug('[PreloadManager] 智能预加载策略已启动');
  }

  /**
   * 根据模块名称获取模块路径
   * 这个方法需要根据实际的模块结构来实现
   * 注意：路径是相对于项目根目录的，因为PreloadManager位于services目录下，需要使用../回到根目录
   */
  getModulePath(moduleName) {
    const pathMap = {
      'songTopUI': '../modules/songs/songTopUI.js',
      'songService': '../../shared/modules/songs/SongService.js',
      'songSearchService': '../../shared/modules/songs/SongSearchService.js',
      'songSyncManager': '../../shared/modules/songs/SongSyncManager.js',
      'partyUI': '../modules/party/partyUI.js',
      'cashierUI': '../modules/cashier/CashierUI.js',
      'cashierService': '../modules/ordeModal/cashierService.js',
      'selectedUI': '../navigation/selected/SelectedUI.js',
      'smartlUI': '../navigation/smartl/SmartlUI.js',
      'displayUI': '../navigation/display/DisplayUI.js',
      'navMaterialUI': '../navigation/materials/MaterialUI.js',
      'bottomNavUI': '../navigation/bottomNav/BottomNavUI.js',
      'singerService': '../../shared/modules/songs/SingerService.js'
    };

    return pathMap[moduleName] || null;
  }

  /**
   * 预加载关键资源（CSS、字体等）
   */
  preloadResource(url, as = 'script', crossorigin = false) {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.href = url;
      link.as = as;
      if (crossorigin) {
        link.crossOrigin = 'anonymous';
      }
      link.onload = resolve;
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  /**
   * 清理缓存（可选，用于内存管理）
   */
  clearCache() {
    // 清理所有定时器
    this._timeouts.forEach(timeoutId => {
      clearTimeout(timeoutId);
    });
    this._timeouts.clear();
    
    // 清理所有 idle callbacks
    if (typeof cancelIdleCallback !== 'undefined') {
      this._idleCallbacks.forEach(idleCallbackId => {
        cancelIdleCallback(idleCallbackId);
      });
    }
    this._idleCallbacks.clear();
    
    // 清理所有检查间隔定时器
    this._checkIntervals.forEach(intervalId => {
      clearInterval(intervalId);
    });
    this._checkIntervals.clear();
    
    this.loadedModules.clear();
    this.preloadQueue.clear();
    logService.info('[PreloadManager] 缓存和定时器已清理');
  }

  /**
   * 获取预加载统计信息
   */
  getStats() {
    return {
      loaded: this.loadedModules.size,
      loading: this.loadingModules.size,
      queued: this.preloadQueue.size,
      usage: Object.fromEntries(this.userBehavior.moduleUsage),
      lastUsed: Object.fromEntries(
        Array.from(this.userBehavior.lastUsed.entries()).map(([k, v]) => [k, new Date(v)])
      )
    };
  }
}

// 创建并导出单例
const preloadManager = new PreloadManager();
export default preloadManager;
