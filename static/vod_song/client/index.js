// 导入核心服务（API 与配置统一走 shared）
import apiService from '../shared/core/ApiService.js';
import langService from '../shared/services/LangService/LangService.js';
import logService from '../shared/services/LogService.js';
import cacheService from '../shared/services/CacheService.js';
import imageCacheService from './services/ImageCacheService.js';
import toastService from '../shared/services/ToastService.js';

// 导入关键服务和UI
import songService from '../shared/modules/songs/SongService.js';
import songSyncManager from '../shared/modules/songs/SongSyncManager.js';
import singerService from '../shared/modules/songs/SingerService.js';
import bottomNavUI from './navigation/bottomNav/BottomNavUI.js?v=20260317b';

// 导入工具类
import TimerManager from '../shared/utils/TimerManager.js';
import loadingManager from '../shared/utils/LoadingManager.js';
import { isNonEmptyArray } from '../shared/utils/index.js';

// 导入路由
import router from './router/server.js';

if (typeof window !== 'undefined') {
  if (window.__indexJsInitializing) {
    console.warn('[App] index.js 正在初始化或已完成（可能是由于版本号不同的二次导入），已跳过重复执行。');
    // 注意：如果是 ESM 导入，这里 return 只会结束本模块实例，不影响已运行的实例。
  } else {
    window.__indexJsInitializing = true;
  }
}

if (typeof window !== 'undefined') {
  if (!window.flowMetrics) {
    window.flowMetrics = {
      events: [],
      mark(name, extra) {
        try {
          const t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const payload = extra && typeof extra === 'object' ? extra : {};
          this.events.push(Object.assign({ name, t }, payload));
        } catch (_) { }
      },
      flush() {
        const e = this.events.slice();
        this.events.length = 0;
        return e;
      }
    };
  }
}

const ASSET_VERSION = '20260325-v22';

// 模块路径映射
const MODULE_PATHS = {
  'songTopUI': './modules/songs/songTopUI.js',
  'songService': '../shared/modules/songs/SongService.js',
  'songSearchService': '../shared/modules/songs/SongSearchService.js',
  'songSyncManager': '../shared/modules/songs/SongSyncManager.js',
  'cashierUI': './modules/cashier/CashierUI.js',
  'cashierService': './modules/ordeModal/cashierService.js',
  'orderModal': './modules/ordeModal/orderModal.js',
  'partyUI': './modules/party/partyUI.js',
  'youtubeUI': './modules/youtube/YouTubeUI.js',
  'sharedModalManager': './modules/common/SharedModalManager.js',
  'bottomNavService': '../shared/navigation/bottomNav/BottomNavService.js',
  'displayUI': './navigation/display/DisplayUI.js',
  'navMaterialUI': './navigation/materials/MaterialUI.js',
  'navMaterialService': '../shared/navigation/materials/MaterialService.js',
  'navSelectedUI': './navigation/selected/SelectedUI.js?v=20260317d',
  'navSelectedService': '../shared/navigation/selected/SelectedService.js?v=20260318',
  'smartlUI': './navigation/smartl/SmartlUI.js?v=20260317',
  'smartlService': '../shared/navigation/smartl/SmartlService.js?v=20260317',
  'settingsUI': './navigation/settings/SettingsUI.js?v=20260314-1',
  'singerService': '../shared/modules/songs/SingerService.js',
  'hideAllButtonsUtil': './modules/common/ModalUtils.js'
};

// 需要暴露到全局的模块映射
const GLOBAL_MODULE_MAP = {
  'songTopUI': 'songTopUI',
  'navSelectedUI': 'selectedUI',
  'partyUI': 'partyUI',
  'youtubeUI': 'youtubeUI',
  'orderModal': 'orderModal',
  'cashierUI': 'cashierUI',
  'settingsUI': 'settingsUI',
  'smartlUI': 'smartlUI',
  'displayUI': 'displayUI',
  'sharedModalManager': 'sharedModalManager'
};

// 需要特殊处理的模块
const SPECIAL_MODULES = new Set(['songSyncManager', 'hideAllButtonsUtil']);

const moduleLoader = {
  _modules: new Map(),
  _maxCacheSize: 50, // 最大缓存模块数量

  _resolvePath(name) {
    const path = MODULE_PATHS[name];
    if (!path) throw new Error(`未知模块路径: ${name}`);
    return path;
  },

  _appendVersion(path) {
    return `${path}${path.includes('?') ? '&' : '?'}v=${ASSET_VERSION}`;
  },

  /**
   * 清理最旧的缓存项（当缓存超过最大大小时）
   */
  _trimCache() {
    if (this._modules.size <= this._maxCacheSize) {
      return;
    }

    // 如果超过最大大小，删除最旧的项（Map 保持插入顺序）
    const entriesToDelete = this._modules.size - this._maxCacheSize;
    let deleted = 0;
    for (const [key] of this._modules) {
      if (deleted >= entriesToDelete) break;
      // 不删除关键模块
      if (!SPECIAL_MODULES.has(key) && !GLOBAL_MODULE_MAP.hasOwnProperty(key)) {
        this._modules.delete(key);
        deleted++;
      }
    }

    if (deleted > 0 && logService) {
      logService.debug(`[ModuleLoader] 清理了 ${deleted} 个缓存模块，当前缓存大小: ${this._modules.size}`);
    }
  },

  async load(moduleName) {
    // 检查缓存
    if (this._modules.has(moduleName)) {
      return this._modules.get(moduleName);
    }

    // 与入口静态导入共用同一实例，避免 ?v= 动态导入产生第二份 SongSyncManager、漏绑 WebSocket
    if (moduleName === 'songSyncManager' && typeof window !== 'undefined' && window.songSyncManager) {
      this._modules.set(moduleName, window.songSyncManager);
      return window.songSyncManager;
    }

    // 获取模块路径
    const modulePath = this._resolvePath(moduleName);
    if (!modulePath) {
      throw new Error(`未知模块: ${moduleName}`);
    }

    // 动态导入模块（统一附加版本号，强制刷新懒加载缓存）
    const module = await import(this._appendVersion(modulePath));

    // 处理特殊模块
    let moduleExport;
    if (SPECIAL_MODULES.has(moduleName)) {
      if (moduleName === 'songSyncManager') {
        moduleExport = module.default;
        // 暴露到全局，供清理函数使用
        if (moduleExport && typeof window !== 'undefined') {
          window.songSyncManager = moduleExport;
        }
      } else if (moduleName === 'hideAllButtonsUtil') {
        moduleExport = module.hideAllButtons;
      }
    } else {
      moduleExport = module.default;
    }

    // 缓存模块
    this._modules.set(moduleName, moduleExport);

    // 检查并清理缓存
    this._trimCache();

    return moduleExport;
  },

  // 预加载所有常用模块
  async preloadCommon() {
    const allModules = [
      'songTopUI',
      'songSearchService',
      'sharedModalManager',
      'navSelectedUI',
      'navSelectedService',
      'partyUI',
      'orderModal',
      'cashierUI',
      'cashierService',
      'settingsUI',
      'smartlUI',
      'smartlService',
      'displayUI'
    ];

    const deviceMemory = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : 4;
    const hardwareConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
    const isAndroid = (typeof navigator !== 'undefined') && /Android/i.test(navigator.userAgent || '');
    const isLowEnd = isAndroid && (deviceMemory <= 2 || hardwareConcurrency <= 4);
    const useConservativeAndroidPreload = isAndroid;

    logService.info(`[ModuleLoader] 预加载策略: ${useConservativeAndroidPreload ? '安卓设备分层预加载' : '正常设备并行预加载'}`);

    // 安卓设备：优先保证首屏和首次交互，其他模块延迟到空闲期
    if (useConservativeAndroidPreload) {
      const essential = isLowEnd ? [
        'sharedModalManager',
        'songTopUI',
        'songSearchService',
        'navSelectedUI'
      ] : [
        'sharedModalManager',
        'songTopUI',
        'songSearchService',
        'navSelectedUI',
        'navSelectedService',
        'settingsUI'
      ];

      for (const name of essential) {
        try {
          await this.load(name);
        } catch (err) {
          logService.warn(`[ModuleLoader] 关键模块加载失败: ${name}`, err);
        }
      }

      // 其余模块通过智能预加载管理器按优先级串行加载
      try {
        const rest = allModules.filter(n => !essential.includes(n));
        const tasks = rest.map((name, idx) => {
          const rawPath = this._resolvePath(name);
          // 路径适配：index.js 在 /client/，PreloadManager 在 /client/services/
          // 需要将 ./ 变为 ../，将 ../ 变为 ../../
          const adjustedPath = rawPath.startsWith('./') ? 
            '../' + rawPath.substring(2) : 
            '../' + rawPath;
            
          return {
            path: adjustedPath,
            name,
            delay: (isLowEnd ? 1200 : 800) + idx * (isLowEnd ? 450 : 300)
          };
        });
        if (typeof preloadManager?.preloadModules === 'function') {
          // 使用空闲回调避免与首屏渲染竞争
          const schedule = () => preloadManager.preloadModules(tasks);
          if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
            window.requestIdleCallback(schedule, { timeout: isLowEnd ? 5000 : 3500 });
          } else {
            setTimeout(schedule, isLowEnd ? 3000 : 1800);
          }
        }
      } catch (e) {
        logService.warn('[ModuleLoader] 智能预加载调度失败', e);
      }
    } else {
      // 正常设备：保持并行预加载
      const promises = allModules.map(name =>
        this.load(name).catch(err => {
          logService.warn(`[ModuleLoader] 预加载模块失败: ${name}`, err);
          return null;
        })
      );
      await Promise.allSettled(promises);
    }

    // 暴露部分模块到全局，确保可用
    await this._exposeModules();
    logService.info('[ModuleLoader] 常用模块已准备，全局可用');
  },

  // 暴露模块到全局
  async _exposeModules() {
    // 暴露普通模块
    for (const [moduleName, globalName] of Object.entries(GLOBAL_MODULE_MAP)) {
      try {
        const module = await this.load(moduleName);
        if (module && typeof window !== 'undefined') {
          window[globalName] = module;
        }
      } catch (e) {
        logService.warn(`[ModuleLoader] 暴露模块到全局失败: ${moduleName}`, e);
      }
    }

    // 暴露服务到全局
    try {
      const navSelectedService = await this.load('navSelectedService');
      if (navSelectedService && typeof window !== 'undefined') {
        window.navSelectedService = navSelectedService;
      }
    } catch (e) {
      logService.warn('[ModuleLoader] 暴露navSelectedService到全局失败', e);
    }

    // 暴露smartlService到全局
    try {
      const smartlService = await this.load('smartlService');
      if (smartlService && typeof window !== 'undefined') {
        window.smartlService = smartlService;
      }
    } catch (e) {
      logService.warn('[ModuleLoader] 暴露smartlService到全局失败', e);
    }
  }
};

// 延迟加载统一卡片工厂（非关键）
Promise.resolve().then(() => import('./utils/SongCardFactory.js'));

// 导入预加载管理器
import preloadManager from './services/PreloadManager.js';

// 日志级别控制说明
// 日志级别统一由设置界面（SettingsUI）控制
// - 初始化时：LogService 构造函数已从 localStorage 读取并应用日志级别
// - 运行时：设置界面打开时会同步日志级别（确保一致性）
// - 其他代码不应修改日志级别
// - 如需修改日志级别，请通过设置界面操作

// 控制台补丁配置（用于调试，不影响日志级别）
// 为了确保日志级别控制对所有 console.* 调用生效，始终启用控制台补丁
const __isLocalHost = (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname));
const __homeDebugEnabled = __isLocalHost || (typeof window !== 'undefined' && (
  new URLSearchParams(window.location.search).get('homeDebug') === '1' ||
  localStorage.getItem('ktv:debug:home') === '1'
));

logService.setOptions({ showSource: false, foldDuplicates: true, foldWindowMs: 10000 }); // 10秒窗口，更好地折叠重复日志

// 始终启用控制台补丁，确保日志级别控制对所有 console.* 调用生效
// 这样用户在设置中修改日志级别后，所有日志都会受到控制
logService.patchConsole();
logService.info('[App] Console patching enabled (日志级别控制已启用)');

// 确保日志级别与 localStorage 同步（在应用初始化时）
// 在生产环境（APK/Capacitor）中，默认使用 error 级别以减少日志输出
try {
  if (typeof localStorage !== 'undefined') {
    const lsLevel = localStorage.getItem('ktv:log:level');
    const allowed = ['debug', 'info', 'warn', 'error'];
    const isCapacitor = (typeof window !== 'undefined' && window.Capacitor);
    
    // 转换为小写进行比较，确保大小写不敏感
    const normalizedLevel = lsLevel ? lsLevel.toLowerCase() : '';
    
    // 在 Capacitor 环境中，如果没有设置日志级别，强制使用 error
    if (isCapacitor && !normalizedLevel) {
      localStorage.setItem('ktv:log:level', 'error');
      logService.setLogLevel('error');
      logService.error('[App] 生产环境：日志级别已设置为 error（仅显示错误）');
    } else if (normalizedLevel && allowed.includes(normalizedLevel)) {
      logService.setLogLevel(normalizedLevel);
      logService.info('[App] 初始化时应用日志级别:', normalizedLevel);
    } else if (!normalizedLevel) {
      // 非 Capacitor 环境且未设置，使用默认 error
      localStorage.setItem('ktv:log:level', 'error');
      logService.setLogLevel('error');
    }
  }
} catch (e) {
  // 出错时静默处理，避免产生更多日志
}

// 日志级别在设置界面打开时会从 localStorage 同步
// 如需修改日志级别，请通过设置界面（SettingsUI）操作

// 导出所有服务和UI实例，供其他模块使用
export {
  // 核心服务
  apiService,

  // 关键服务
  songService,
  songSyncManager,
  singerService,

  // 导航UI和服务
  bottomNavUI,

  // 公共服务
  langService,
  logService,
  cacheService,
  toastService,
  imageCacheService,

  // 路由
  router,

  // 模块加载器
  moduleLoader
};

// 将缓存和服务挂载到全局，供其他模块使用
if (typeof window !== 'undefined') {
  window.apiService = apiService;
  window.cacheService = cacheService;
  window.logService = logService;
  window.toastService = toastService;
  window.imageCacheService = imageCacheService;
  window.songService = songService;
  window.songSyncManager = songSyncManager;
  window.singerService = singerService;
  window.langService = langService;
  window.moduleLoader = moduleLoader;
  window.bottomNavUI = bottomNavUI;

  // 统一检查房间状态的函数 (1:开房, 2:维修)
  window.checkRoomOperationAllowed = async function () {
    try {
      const roomState = await apiService.getRoomState();
      const status = roomState && typeof roomState.status !== 'undefined' ? Number(roomState.status) : -1;

      const ls = window.langService || langService;
      logService?.info?.(`[房态检查] 房间: ${roomState.roomName || '未知'}, 状态代码: ${status}, 语言: ${ls.getCurrentLanguage?.()}`);

      // 状态 1: 使用中, 2: 维护中（都允许操作）
      if (status === 1 || status === 2) {
        return true;
      }

      // 状态 0: 空闲（未开房）
      if (status === 0) {
        const roomNotInUseText = ls.t('roomNotInUse') || '房间未开房，请联系前台开房！';
        toastService.showWarning(roomNotInUseText);
        logService?.warn?.(`[房态检查] 房间 ${roomState.roomName || '未知'} 未开房 (status=0)`);
        return false;
      }

      // 其他异常状态
      logService?.error?.(`[房态检查] 房间状态异常: ${status}`);
      toastService.showError('房间状态异常，请联系管理员');
      return false;
    } catch (error) {
      logService?.error?.('[房态检查] 请求失败:', error);

      const ls = window.langService || langService;

      // 区分404和其他错误
      if (error.status === 404 || (error.response && error.response.status === 404)) {
        logService?.error?.('[房态检查] 房间未配置 (404错误)');
        toastService.showError('房间未配置，请联系管理员设置终端绑定');
      } else if (error.message && (error.message.includes('网络') || error.message.includes('network') || error.message.includes('Failed to fetch'))) {
        logService?.error?.('[房态检查] 网络连接失败');
        toastService.showError('网络连接失败，请检查网络设置');
      } else {
        // 其他错误，使用通用提示
        const errorMsg = ls.t('roomNotInUse') || '房间未开房，请联系前台开房！';
        toastService.showWarning(errorMsg);
      }
      return false;
    }
  };
}

// 应用初始化函数
let isAppInitializing = false;
let isAppInitialized = false;

// 定时器管理：统一生命周期，避免内存泄漏
const timerManager = new TimerManager();

// 存储事件监听器引用，以便清理
const selectedBadgeHandlers = {
  syncCleanup: null,
  getPlayListDebounceId: null,
  handlePreloadSelectedList: null
};

// 存储全局事件监听器引用，以便清理
const globalEventHandlers = {
  documentClick: null,
  topLeftClick: null,
  topLeftTouchEnd: null,
  navigateToHome: null,
  modalClosed: null,
  orderModalOpened: null,
  unhandledRejection: null,
  websocketClientReady: null
};

// 存储观察者引用，以便清理
const observers = {
  selectedPanelObserver: null
};

/**
 * 初始化已选徽章
 */
function initSelectedBadge() {
  if (typeof window === 'undefined') {
    return;
  }

  const badge = document.getElementById('selected-badge');
  if (!badge) {
    logService?.warn?.('[SelectedBadge] 未找到徽标元素');
    return;
  }

  const updateDisplay = (count = 0) => {
    const normalized = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    const text = normalized > 99 ? '99+' : String(normalized);
    badge.textContent = text;
    badge.setAttribute('aria-label', `已选歌曲数量 ${text}`);
    badge.classList.remove('hidden');
  };

  const refreshFromSongService = () => {
    try {
      if (songService?.requestedSongs instanceof Set && songService.requestedSongs.size > 0) {
        updateDisplay(songService.requestedSongs.size);
        return;
      }
      if (isNonEmptyArray(songService?.selectedSongs)) {
        updateDisplay(songService.selectedSongs.length);
        return;
      }
    } catch (error) {
      logService?.warn?.('[SelectedBadge] 读取数量失败', error);
    }
    updateDisplay(0);
  };

  if (selectedBadgeHandlers.syncCleanup) {
    selectedBadgeHandlers.syncCleanup();
    selectedBadgeHandlers.syncCleanup = null;
  }

  const bindSyncManager = async () => {
    try {
      const songSyncManager = (window.songSyncManager) || (await window.moduleLoader?.load('songSyncManager'));
      if (songSyncManager?.addSyncListener) {
        selectedBadgeHandlers.syncCleanup = songSyncManager.addSyncListener(() => {
          requestAnimationFrame(() => refreshFromSongService());
        });
      }
    } catch (e) {
      logService?.warn?.('[SelectedBadge] 绑定同步监听失败', e);
    }
  };

  bindSyncManager();

  refreshFromSongService();

  // 提供全局刷新函数
  window.refreshSelectedBadge = updateDisplay;
}

/**
 * 清理已选徽章的事件监听器
 */
function cleanupSelectedBadge() {
  if (selectedBadgeHandlers.syncCleanup) {
    selectedBadgeHandlers.syncCleanup();
    selectedBadgeHandlers.syncCleanup = null;
  }
  if (selectedBadgeHandlers.getPlayListDebounceId) {
    clearTimeout(selectedBadgeHandlers.getPlayListDebounceId);
    selectedBadgeHandlers.getPlayListDebounceId = null;
  }
  selectedBadgeHandlers.handlePreloadSelectedList = null;
}

/**
 * 初始化语言切换功能
 * 循环切换：中文 → 印尼语 → 英文 → 越南语 → 中文
 */
function initLanguageToggle() {
  if (typeof window === 'undefined') return;

  const toggleBtn = document.getElementById('languageToggle');
  if (!toggleBtn) {
    logService?.debug?.('[LanguageToggle] 未找到语言切换按钮');
    return;
  }

  // 语言顺序：none=中文, id=印尼语, en=英文, vi=越南语
  const LANG_CYCLE = [
    { key: 'none',  bodyClass: '',                label: '中文'   },
    { key: 'id',    bodyClass: 'show-indonesian',  label: 'Indonesia' },
    { key: 'en',    bodyClass: 'show-english',     label: 'English' },
    { key: 'vi',    bodyClass: 'show-vietnamese',  label: 'Tiếng Việt' },
  ];
  const ALL_BODY_CLASSES = LANG_CYCLE.filter(l => l.bodyClass).map(l => l.bodyClass);

  // 读取上次选择（兼容旧版 showIndonesian 存储）
  let savedKey = localStorage.getItem('subtitleLang') || 'none';
  if (savedKey === 'none' && localStorage.getItem('showIndonesian') === 'true') {
    savedKey = 'id';
  }
  let currentIndex = LANG_CYCLE.findIndex(l => l.key === savedKey);
  if (currentIndex < 0) currentIndex = 0;

  // 应用初始状态
  document.body.classList.remove(...ALL_BODY_CLASSES);
  if (LANG_CYCLE[currentIndex].bodyClass) {
    document.body.classList.add(LANG_CYCLE[currentIndex].bodyClass);
  }

  // 更新按钮文本
  const updateButtonText = () => {
    const langSpan = toggleBtn.querySelector('#language');
    if (langSpan) langSpan.textContent = LANG_CYCLE[currentIndex].label;
    logService?.debug?.(`[LanguageToggle] 当前副语言: ${LANG_CYCLE[currentIndex].label}`);
  };
  updateButtonText();

  // 预加载所有副语言翻译文件
  if (langService) {
    ['id_id', 'en_us', 'vi_vn'].forEach(code => {
      if (!langService.translations[code]) langService.loadLanguageFile(code).catch(() => {});
    });
  }

  // 点击循环切换
  toggleBtn.addEventListener('click', () => {
    currentIndex = (currentIndex + 1) % LANG_CYCLE.length;
    const lang = LANG_CYCLE[currentIndex];

    document.body.classList.remove(...ALL_BODY_CLASSES);
    if (lang.bodyClass) document.body.classList.add(lang.bodyClass);

    localStorage.setItem('subtitleLang', lang.key);
    updateButtonText();

    window.dispatchEvent(new CustomEvent('languageToggled', {
      detail: { lang: lang.key, showIndonesian: lang.key === 'id' }
    }));
    logService?.info?.(`[LanguageToggle] 切换至: ${lang.label}`);
  });

  // 显示语言切换按钮
  toggleBtn.classList.remove('hidden');
  logService?.info?.('[LanguageToggle] 语言切换功能已初始化');
}

/**
 * 从服务器更新已选数据（由 SongSyncManager 触发 authoritativePull）
 */
async function updateSelectedDataFromServer() {
  try {
    const songSyncManager = (typeof window !== 'undefined' && window.songSyncManager) 
      ? window.songSyncManager 
      : (await import('../shared/modules/songs/SongSyncManager.js')).default;
      
    if (songSyncManager) {
      logService.info('[App] 触发初始已选列表同步...');
      await songSyncManager.syncSongState(true);
    }
  } catch (e) {
    logService?.warn?.('[App] 初始同步失败', e);
  }
}

/**
 * 初始化应用
 */
async function initApp() {
  // 防止重复初始化
  if (isAppInitializing || isAppInitialized) {
    if (logService && logService.debug) {
      logService.debug('[App] 应用已在初始化或已初始化，跳过重复初始化');
    }
    return;
  }

  isAppInitializing = true;

  // 初始化房间ID：依赖 ApiService 构造函数的优先级逻辑（URL > Storage > current）
  try {
    const currentResolvedId = apiService.getRoomId();
    logService?.info?.(`[App] 当前生效的房间ID: ${currentResolvedId}`);

    // 如果是通过 URL 传入的新房间 ID，建议同步到 clientIp 供后续默认使用
    const urlId = apiService._getRoomIdFromUrl();
    if (urlId && urlId !== localStorage.getItem('clientIp')) {
      localStorage.setItem('clientIp', urlId);
      logService?.info?.(`[App] 已将 URL 中的房间ID (${urlId}) 同步到本地配置`);
    }

    if (!currentResolvedId || currentResolvedId === 'current') {
      logService?.warn?.('[App] 房间ID未配置或未识别，可能无法正确操作，请检查 URL 或设置页面');
    }

    // 验证房间号并同步初始状态
    if (currentResolvedId && currentResolvedId !== 'current') {
      try {
        const roomState = await apiService.getRoomState();
        logService.info(`[App] 房间号验证成功: ${roomState.roomName || apiService.roomId}`);

        // 如果 smartlService 已通过 moduleLoader 加载，则立即同步状态
        if (typeof moduleLoader !== 'undefined') {
          const srv = moduleLoader._modules.get('smartlService');
          if (srv && typeof srv.syncStateFromServer === 'function') {
            logService.info('[App] 正在应用初始房间状态到已加载的 SmartlService');
            srv.syncStateFromServer(roomState);
          }
        }
      } catch (error) {
        logService.error(`[App] 房间号验证/初始状态同步失败: ${apiService.roomId}`, error);
      }
    }

    logService.info('[App] 房间ID已初始化完毕:', apiService.roomId);

    // 启动初始歌曲同步（ authoritative pull ）
    updateSelectedDataFromServer();
  } catch (e) {
    logService.error('[App] 初始化过程异常', e);
  } finally {
    isAppInitializing = false;
  }


  // 设置全局未捕获 Promise 拒绝处理器
  if (typeof window !== 'undefined') {
    globalEventHandlers.unhandledRejection = (event) => {
      const error = event.reason;
      const errorMessage = error?.message || String(error);
      const errorStack = error?.stack;

      // 记录错误日志
      if (logService && logService.error) {
        logService.error('[App] 未捕获的 Promise 拒绝', {
          message: errorMessage,
          error: error,
          stack: errorStack,
          promise: event.promise
        });
      } else {
        // 降级处理：如果logService不可用，使用原始console（仅在紧急情况下）
        if (window.__rawConsole && window.__rawConsole.error) {
          window.__rawConsole.error('[App] 未捕获的 Promise 拒绝:', errorMessage, error);
        }
      }

      // 如果是网络错误，提供更友好的提示
      if (errorMessage && (errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch') || errorMessage.includes('网络'))) {
      }

      // 阻止默认行为（在控制台显示错误），因为我们已经处理了
      // event.preventDefault();
    };
    window.addEventListener('unhandledrejection', globalEventHandlers.unhandledRejection);
  }

  // 使用日志服务记录信息而不是console.log
  logService.info('初始化火山KTV系统...');

  // 注册加载完成回调：隐藏加载动画，显示首页（派对/点歌/点单按钮可见，首页按钮隐藏）
  loadingManager.onComplete(() => {
    hideLoadingScreen();
    requestAnimationFrame(async () => {
      try {
        const { showAllButtons } = await import('./modules/common/ModalUtils.js');
        showAllButtons();
      } catch (error) {
        if (typeof window.controlButtons === 'function') {
          window.controlButtons('hideHome');
        }
      }
    });
  });

  // 设置超时保护：如果5秒后仍未完成，强制完成（从10秒减少到5秒）
  timerManager.addTimeout(() => {
    if (!loadingManager.isComplete) {
      logService.warn('[App] 加载超时，强制完成');
      loadingManager.forceComplete();
    }
  }, 5000);

  // 添加根路径路由
  router.addRoute('/', () => {
    // 使用日志服务记录信息而不是console.log
    logService.info('导航到首页');
    // 这里可以添加首页初始化逻辑
  });

  // 注册核心初始化任务
  loadingManager.registerTask('router', '路由初始化');
  loadingManager.registerTask('bottomNav', '底部导航栏');
  loadingManager.registerTask('selectedBadge', '已选徽章');
  loadingManager.registerTask('langService', '语言服务');
  loadingManager.registerTask('containers', '容器初始化');
  loadingManager.registerTask('websocket', 'WebSocket同步');
  loadingManager.registerTask('dataPreload', '数据预加载');
  loadingManager.registerTask('modulePreload', '模块预加载'); // UI模块预加载（非阻塞）

  // 初始化路由
  router.init();
  loadingManager.completeTask('router');

  // 初始化底部导航栏
  bottomNavUI.renderBottomNav();
  loadingManager.completeTask('bottomNav');

  initSelectedBadge();
  loadingManager.completeTask('selectedBadge');
  
  // 初始化语言切换
  initLanguageToggle();
  
  try {
    const tasks = [];
    tasks.push(moduleLoader.load('hideAllButtonsUtil').then(m => { window._hideAllButtonsUtil = m; }));
    tasks.push(moduleLoader.load('sharedModalManager').then(m => { window.sharedModalManager = m; }));
    tasks.push(moduleLoader.load('songTopUI').then(m => { window.songTopUI = m; }));
    tasks.push(moduleLoader.load('partyUI').then(m => { window.partyUI = m; }));
    Promise.allSettled(tasks);
  } catch (_) { }

  // 立即暴露关键模块
  window.bottomNavUI = bottomNavUI;

  // 关键服务已同步加载并暴露到全局
  // UI模块在 preloadCommon() 中会暴露到全局
  // 这里不需要额外操作

  // 优化：延迟初始化所有非关键容器，减少初始加载压力
  // 注意：模块已在预加载阶段加载完成，这里直接使用
  const initContainers = async () => {
    try {
      // 模块应该已经在预加载阶段加载完成，直接获取（不会重新加载）
      const navSelectedUI = await moduleLoader.load('navSelectedUI');
      const songTopUI = await moduleLoader.load('songTopUI');
      const partyUI = await moduleLoader.load('partyUI');

      // 初始化已选页面服务
      if (navSelectedUI && typeof navSelectedUI.initServices === 'function') {
        await navSelectedUI.initServices();
        logService.info('[App] 已选页面服务初始化完成');
      }
      // 等待首次已选列表同步完成，再渲染首页已选列表，保证与角标/歌曲卡片同一数据源
      const initialSync = typeof window !== 'undefined' ? window._initialSelectedSyncPromise : null;
      if (initialSync && typeof initialSync.then === 'function') {
        try {
          await Promise.race([initialSync, new Promise(r => setTimeout(r, 5000))]);
        } catch (_) { }
      }
      if (navSelectedUI && typeof navSelectedUI.initSelectedList === 'function') {
        await navSelectedUI.initSelectedList();
        logService.info('[App] 首页已选列表已从 SongService 同步渲染');
      }

      // 初始化点歌页面容器
      if (songTopUI && typeof songTopUI.initTopModal === 'function') {
        await songTopUI.initServices();
        songTopUI.initTopModal();
        logService.info('[App] 点歌页面容器初始化完成');
      }

      // 初始化派对页面容器
      if (partyUI && typeof partyUI.initPartyModal === 'function') {
        await partyUI.initServices();
        partyUI.initPartyModal();
        logService.info('[App] 派对页面容器初始化完成');
      }

      logService.info('[App] 所有容器初始化完成');
      loadingManager.completeTask('containers');
    } catch (e) {
      logService.warn('[App] 容器初始化出现问题，继续运行:', e);
      loadingManager.failTask('containers', e);
    }
  };

  // 延迟容器初始化，给首页渲染更多时间（减少延迟）
  timerManager.addTimeout(initContainers, 300);

  // 设置默认语言
  langService.setLanguage('zh_cn');
  try {
    await langService.init();
    loadingManager.completeTask('langService');
  } catch (e) {
    logService.warn('[App] 语言服务初始化失败:', e);
    loadingManager.failTask('langService', e);
  }

  // 注意：状态广播已通过 WebSocket 实现，不再使用 SSE
  // 如果需要系统级广播，可以通过 WebSocket 的 broadcast 功能实现

  // 延迟初始化WebSocket状态同步，减少初始加载压力
  // 注意：模块已在预加载阶段加载完成，这里直接使用
  timerManager.addTimeout(async () => {
    const initPanelWebSocketSync = async () => {
      try {
        const smartlUI = await moduleLoader.load('smartlUI');
        const displayUI = await moduleLoader.load('displayUI');
        if (smartlUI && typeof smartlUI.initWebSocketSync === 'function') {
          smartlUI.initWebSocketSync();
          logService.info('[App] 控制面板WebSocket同步已初始化');
        }
        if (displayUI && typeof displayUI.initWebSocketSync === 'function') {
          displayUI.initWebSocketSync();
          logService.info('[App] 画面面板WebSocket同步已初始化');
        }
        loadingManager.completeTask('websocket');
      } catch (e) {
        logService.warn('[App] 初始化面板WebSocket同步失败:', e);
        loadingManager.failTask('websocket', e);
      }
    };
    if (window.WebSocketClient) {
      initPanelWebSocketSync();
    } else {
      const readyHandler = () => {
        initPanelWebSocketSync();
        window.removeEventListener('websocketClientReady', readyHandler);
        if (globalEventHandlers.websocketClientReady === readyHandler) globalEventHandlers.websocketClientReady = null;
      };
      globalEventHandlers.websocketClientReady = readyHandler;
      window.addEventListener('websocketClientReady', readyHandler);
    }
  }, 1000);
  
  // 额外预加载所有模块以确保全局暴露 (异步不阻塞)
  if (moduleLoader && typeof moduleLoader.preloadCommon === 'function') {
    moduleLoader.preloadCommon().catch(e => {
        logService.warn('[App] moduleLoader.preloadCommon 预加载过程中出现非致命错误', e);
    });
  }

  // 优化：异步非阻塞数据预加载，提前关键数据加载
  const startDataPreload = async () => {
    try {
      if (cacheService && typeof cacheService.preloadAll === 'function') {
        const deviceMemory = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : 4;
        const hardwareConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
        const isAndroid = (typeof navigator !== 'undefined') && /Android/i.test(navigator.userAgent || '');
        const isLowEndAndroid = isAndroid && (deviceMemory <= 2 || hardwareConcurrency <= 4);
        const shouldUseLightPreload = isAndroid;
        const topSongsPageSize = isLowEndAndroid ? 10 : 16;

        logService.info('[App] 开始异步数据预加载任务');

        const preloadPromises = [];

        preloadPromises.push(
          cacheService.preloadTopSongs({ page: 1, pageSize: topSongsPageSize }, 30 * 60 * 1000)
            .catch(err => logService.warn('[App] 热门歌曲预加载失败:', err))
        );

        timerManager.addTimeout(() => {
          preloadPromises.push(
            cacheService.preloadPartySongs({ page: 1, pageSize: isLowEndAndroid ? 10 : 16, categoryCode: '11' }, 30 * 60 * 1000)
              .catch(err => logService.warn('[App] 派对分类歌曲预加载失败:', err))
          );
        }, shouldUseLightPreload ? 2500 : 1000);

        if (!shouldUseLightPreload) {
          timerManager.addTimeout(() => {
            preloadPromises.push(
              cacheService.preloadIndonesianSongs({ page: 1, pageSize: 20 }, 30 * 60 * 1000)
                .catch(err => logService.warn('[App] 印尼歌曲预加载失败:', err))
            );
          }, 2000);
        }

        timerManager.addTimeout(async () => {
          try {
            if (!shouldUseLightPreload) {
              await cacheService.preloadAll(30 * 60 * 1000, { songs: 20, singers: 30 });
            }
            logService.info('[App] 数据预加载任务完成');

            try {
              await Promise.race([
                Promise.all(preloadPromises),
                new Promise(resolve => timerManager.addTimeout(resolve, shouldUseLightPreload ? 1200 : 2000))
              ]);
            } catch (preloadError) {
              logService.warn('[App] 部分预加载任务失败，继续执行:', preloadError);
            }

            loadingManager.completeTask('dataPreload');
          } catch (e) {
            logService.warn('[App] 数据预加载任务出现问题：', e);
            loadingManager.failTask('dataPreload', e);
          }
        }, shouldUseLightPreload ? (isLowEndAndroid ? 5000 : 3500) : 3000);
      } else {
        logService.warn('[App] 缓存服务未正确初始化，跳过预加载');
        loadingManager.completeTask('dataPreload'); // 标记为完成，避免阻塞
      }
    } catch (e) {
      logService.warn('[App] 数据预加载启动失败：', e);
      loadingManager.failTask('dataPreload', e);
    }
  };

  // 启动数据预加载（立即开始，不延迟）
  startDataPreload();

  // 在空闲时预加载模块，完成后再标记任务完成
  const startModulePreloadIdle = () => {
    const run = async () => {
      try {
        const deviceMemory = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : 4;
        const hardwareConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
        const isAndroid = (typeof navigator !== 'undefined') && /Android/i.test(navigator.userAgent || '');
        const isLowEndAndroid = isAndroid && (deviceMemory <= 2 || hardwareConcurrency <= 4);
        await moduleLoader.preloadCommon();
        if (!isAndroid) {
          try { preloadManager.initSmartPreload(); } catch (_) { }
        } else if (!isLowEndAndroid) {
          timerManager.addTimeout(() => {
            try { preloadManager.initSmartPreload(); } catch (_) { }
          }, 4000);
        }
        logService.info('[App] 模块与智能预加载已在空闲时完成');
        loadingManager.completeTask('modulePreload');
      } catch (e) {
        logService.warn('[App] 空闲预加载失败:', e);
        loadingManager.failTask('modulePreload', e);
      }
    };
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => run(), { timeout: 5000 });
    } else {
      timerManager.addTimeout(run, 5000);
    }
  };
  startModulePreloadIdle();

  // 启动基于用户行为的智能缓存预热（减少延迟）
  timerManager.addTimeout(async () => {
    try {
      const deviceMemory = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : 4;
      const hardwareConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
      const isAndroid = (typeof navigator !== 'undefined') && /Android/i.test(navigator.userAgent || '');
      const isLowEndAndroid = isAndroid && (deviceMemory <= 2 || hardwareConcurrency <= 4);
      if (isLowEndAndroid) {
        return;
      }
      if (cacheService && typeof cacheService.smartPreloadBasedOnBehavior === 'function') {
        logService.info('[App] 启动基于用户行为的智能缓存预热');
        await cacheService.smartPreloadBasedOnBehavior();
      }
    } catch (e) {
      logService.warn('[App] 智能缓存预热失败:', e);
    }
  }, 15000);

  // 定期执行智能缓存预热（每30分钟一次，避免过于频繁）
  timerManager.addInterval(async () => {
    try {
      const deviceMemory = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : 4;
      const hardwareConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
      const isAndroid = (typeof navigator !== 'undefined') && /Android/i.test(navigator.userAgent || '');
      const isLowEndAndroid = isAndroid && (deviceMemory <= 2 || hardwareConcurrency <= 4);
      if (isLowEndAndroid) {
        return;
      }
      if (cacheService && typeof cacheService.smartPreloadBasedOnBehavior === 'function') {
        await cacheService.smartPreloadBasedOnBehavior();
      }
    } catch (e) {
      logService.warn('[App] 定期智能缓存预热失败:', e);
    }
  }, 30 * 60 * 1000); // 每30分钟执行一次，减少频率

  // 暴露缓存统计接口到全局（用于调试和监控）
  if (typeof window !== 'undefined' && cacheService) {
    window.getCacheStats = () => cacheService.getCacheStats();
    logService.info('[App] 缓存统计接口已暴露到全局: window.getCacheStats()');
  }

  // 延迟初始化WebSocket状态同步（减少延迟）
  // 注意：模块已在预加载阶段加载完成，这里直接使用
  timerManager.addTimeout(async () => {
    try {
      // 模块应该已经在预加载阶段加载完成，直接获取（不会重新加载）
      const smartlService = await moduleLoader.load('smartlService');
      // 暴露到全局，供 SmartlUI 使用
      if (smartlService && typeof window !== 'undefined') {
        window.smartlService = smartlService;
      }
      if (smartlService && typeof smartlService.initWebSocketSync === 'function') {
        // 等待WebSocket客户端准备就绪
        if (window.WebSocketClient) {
          smartlService.initWebSocketSync();
        } else {
          // 监听WebSocket客户端准备就绪事件
          const smartlReadyHandler = () => {
            smartlService.initWebSocketSync();
            window.removeEventListener('websocketClientReady', smartlReadyHandler);
            // 从全局处理器中移除引用
            if (globalEventHandlers.websocketClientReady === smartlReadyHandler) {
              globalEventHandlers.websocketClientReady = null;
            }
          };
          globalEventHandlers.websocketClientReady = smartlReadyHandler;
          window.addEventListener('websocketClientReady', smartlReadyHandler);

          // 添加超时检查，确保即使WebSocket客户端初始化失败也能继续
          timerManager.addTimeout(() => {
            if (!window.WebSocketClient && smartlService) {
              // 使用日志服务记录警告而不是console.warn
              logService.warn('[App] WebSocket客户端初始化超时，尝试直接初始化');
              try {
                smartlService.initWebSocketSync();
              } catch (error) {
                // 使用日志服务记录错误而不是console.error
                logService.error('[App] 直接初始化WebSocket同步失败:', error);
              }
            }
          }, 5000); // 5秒超时
        }
      }
    } catch (e) {
      logService.warn('[App] 加载smartlService失败:', e);
    }
  }, 1500);

  // 首次同步已在房间 ID 就绪后触发，由 SongSyncManager 广播结果

  // 使用日志服务记录信息而不是console.log
  logService.info('火山KTV系统初始化完成');
  isAppInitialized = true;
  isAppInitializing = false;

  // 在页面卸载时清理所有资源
  if (typeof window !== 'undefined') {
    const cleanupApp = () => {
      // 清理所有定时器
      timerManager.clearAll();
      logService.info('[App] 已清理所有定时器');

      // 清理已选徽章的事件监听器
      cleanupSelectedBadge();
      logService.info('[App] 已清理已选徽章事件监听器');

      // 清理全局事件监听器
      if (globalEventHandlers.documentClick) {
        document.removeEventListener('click', globalEventHandlers.documentClick, true);
        globalEventHandlers.documentClick = null;
      }
      if (globalEventHandlers.topLeftClick) {
        const topLeftClickArea = document.getElementById('top-left-click-area');
        if (topLeftClickArea) {
          topLeftClickArea.removeEventListener('click', globalEventHandlers.topLeftClick, { capture: true, passive: false });
        }
        globalEventHandlers.topLeftClick = null;
      }
      if (globalEventHandlers.topLeftTouchEnd) {
        const topLeftClickArea = document.getElementById('top-left-click-area');
        if (topLeftClickArea) {
          topLeftClickArea.removeEventListener('touchend', globalEventHandlers.topLeftTouchEnd, { capture: true, passive: false });
        }
        globalEventHandlers.topLeftTouchEnd = null;
      }
      if (globalEventHandlers.navigateToHome) {
        document.removeEventListener('navigateToHome', globalEventHandlers.navigateToHome);
        globalEventHandlers.navigateToHome = null;
      }
      if (globalEventHandlers.modalClosed) {
        document.removeEventListener('modalClosed', globalEventHandlers.modalClosed);
        globalEventHandlers.modalClosed = null;
      }
      if (globalEventHandlers.orderModalOpened) {
        document.removeEventListener('orderModalOpened', globalEventHandlers.orderModalOpened);
        globalEventHandlers.orderModalOpened = null;
      }
      if (globalEventHandlers.unhandledRejection) {
        window.removeEventListener('unhandledrejection', globalEventHandlers.unhandledRejection);
        globalEventHandlers.unhandledRejection = null;
      }
      if (globalEventHandlers.websocketClientReady) {
        window.removeEventListener('websocketClientReady', globalEventHandlers.websocketClientReady);
        globalEventHandlers.websocketClientReady = null;
      }
      logService.info('[App] 已清理全局事件监听器');

      // 清理观察者
      if (observers.selectedPanelObserver) {
        observers.selectedPanelObserver.disconnect();
        observers.selectedPanelObserver = null;
        const selectedPanel = document.getElementById('selected-panel');
        if (selectedPanel) {
          delete selectedPanel._observer;
        }
        logService.info('[App] 已清理 selectedPanel MutationObserver');
      }

      // 清理路由资源
      if (router && typeof router.cleanup === 'function') {
        router.cleanup();
        logService.info('[App] 已清理路由资源');
      }

      try {
        const selected = (typeof window !== 'undefined' && window.selectedUI) || (moduleLoader && moduleLoader._modules && moduleLoader._modules.get('navSelectedUI')) || null;
        if (selected && typeof selected.cleanup === 'function') {
          selected.cleanup();
          logService.info('[App] 已清理已选UI资源');
        }
      } catch (_) { }

      // 清理歌曲同步管理器资源（事件监听器、定时器等）
      try {
        // 从全局获取 songSyncManager（在应用初始化时已暴露）
        const songSyncManager = window.songSyncManager;
        if (songSyncManager && typeof songSyncManager.cleanup === 'function') {
          songSyncManager.cleanup();
          logService.info('[App] 已清理歌曲同步管理器资源');
        }
      } catch (error) {
        logService.warn('[App] 清理歌曲同步管理器失败:', error);
      }
    };

    window.addEventListener('beforeunload', cleanupApp);

    // 暴露清理函数到全局，供调试使用
    window.clearAppTimers = () => {
      timerManager.clearAll();
      logService.info('[App] 手动清理所有定时器');
    };

    // 暴露应用清理函数到全局
    window.cleanupApp = cleanupApp;

    // 暴露定时器管理器到全局，供其他模块使用
    window.timerManager = timerManager;

    // 暴露加载管理器到全局，供调试使用
    window.loadingManager = loadingManager;
  }
}

/**
 * 隐藏启动加载动画，显示首页
 */
function hideLoadingScreen() {
  const loadingScreen = document.getElementById('app-loading-screen');
  const mainContent = document.querySelector('main');

  if (mainContent) {
    mainContent.classList.add('loaded');
    logService.info('[App] 首页内容已显示');
  }

  if (loadingScreen) {
    loadingScreen.classList.add('hidden');
    logService.info('[App] 启动加载动画已隐藏');
  }

  // 确保body可见
  if (document.body) {
    document.body.classList.add('loaded');
  }
}

// 首页早绑定：在任意 await 之前安装，确保点击 #home-btn 一定能被捕获
function installHomeBtnEarlyCapture() {
  if (typeof logService !== 'undefined' && __homeDebugEnabled) {
    logService.info('[页面] 安装首页早绑定（document 捕获）');
  }
  document.addEventListener('click', function homeBtnCapture(e) {
    const target = e.target;
    const btn = target && target.closest && target.closest('#home-btn');
    const bar = target && target.closest && target.closest('.home-selected-buttons-bar');
    const isSelected = target && target.closest && (target.closest('#selected-open') || target.closest('#selected-badge'));
    const isCtaButton = target && target.closest && (target.closest('#music-btn') || target.closest('#party-call-btn') || target.closest('#order-open-btn'));
    const unifiedModal = document.getElementById('unified-modal');
    const modalOpen = unifiedModal && !unifiedModal.classList.contains('hidden');

    // 情况1：直接点到 #home-btn
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (typeof logService !== 'undefined' && __homeDebugEnabled) {
        logService.info('[页面] 首页按钮 早绑定捕获到点击，调用 __goHome');
      }
      if (typeof window.__goHome === 'function') {
        window.__goHome();
      } else if (typeof logService !== 'undefined' && __homeDebugEnabled) {
        logService.warn('[页面] __goHome 尚未就绪，请稍后再点首页');
      }
      return;
    }

  }, true);
}

// 调试模式下才保留全局点击诊断，避免安卓 WebView 每次点击都产生额外开销
  

const handleGoHomeMessage = (e) => {
  if (!(e.data && e.data.type === 'goHome')) {
    return;
  }
  if (__homeDebugEnabled) {
    logService.info('[页面] 收到 postMessage goHome');
  }
  if (typeof window.__goHome === 'function') {
    window.__goHome();
  } else if (typeof window.performGoHome === 'function') {
    window.performGoHome();
  } else if (typeof window.goHomeAndRestoreButtons === 'function') {
    window.goHomeAndRestoreButtons();
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('message', handleGoHomeMessage);
}

// DOM加载完成后初始化应用和绑定事件
document.addEventListener('DOMContentLoaded', async function () {
  installHomeBtnEarlyCapture();

  // 初始化应用
  await initApp();

  // 确保首页按钮在DOM加载完成后显示
  requestAnimationFrame(async () => {
    const bottomButtonsSection = document.getElementById('home-cta-section');
    if (bottomButtonsSection) {
      bottomButtonsSection.classList.remove('home-buttons-hidden');
      bottomButtonsSection.classList.add('home-buttons-visible');
    }
  });
  try {
    const imgs = [
      'assets/images/party.png',
      'assets/images/song.png',
      'assets/images/selected.png',
      'assets/images/bg-vol.png',
      'assets/images/bg-vol-.png',
      'assets/images/bg-vol+.png',
      'assets/images/vol.png'
    ];
    if (imageCacheService && typeof imageCacheService.loadAndCache === 'function') {
      imgs.forEach(src => imageCacheService.loadAndCache(src).catch(() => { }));
    } else {
      imgs.forEach(src => { const i = new Image(); i.src = src; });
    }
  } catch (_) { }

  // 首页按钮与面板事件统一绑定（从 index.html 迁入）
  const topButtonsSection = document.getElementById('top-buttons-section');
  const bottomButtonsSection = document.getElementById('home-cta-section');

  const partyBtn = document.getElementById('party-call-btn');
  const musicBtn = document.getElementById('music-btn');
  const orderBtn = document.getElementById('order-open-btn');
  const serviceBtn = document.getElementById('service-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const homeBtn = document.getElementById('home-btn');
  const selectedOpen = document.getElementById('selected-open');
  const topLeftClickArea = document.getElementById('top-left-click-area');

  // CTA按钮动画配置
  const CTA_ANIMATION_CLASS = 'home-cta__btn--animating';
  const CTA_ANIMATION_DURATION = 260;

  // 简化的动画处理函数
  const playHomeCtaAnimation = (button) => new Promise((resolve) => {
    if (!button) {
      resolve();
      return;
    }

    // 如果动画已在进行中，直接返回
    if (button.dataset.ctaAnimating === 'true') {
      resolve();
      return;
    }

    button.dataset.ctaAnimating = 'true';
    button.classList.remove(CTA_ANIMATION_CLASS);
    void button.offsetWidth; // 强制重排
    button.classList.add(CTA_ANIMATION_CLASS);

    // 设置超时清理
    const timeoutId = timerManager.addTimeout(() => {
      button.classList.remove(CTA_ANIMATION_CLASS);
      delete button.dataset.ctaAnimating;
      resolve();
    }, CTA_ANIMATION_DURATION + 120);

    // 动画结束处理
    const handleAnimationEnd = (event) => {
      if (event?.target !== button) return;

      // 清理定时器
      timerManager.clearTimeout(timeoutId);

      // 清理状态
      button.classList.remove(CTA_ANIMATION_CLASS);
      delete button.dataset.ctaAnimating;

      // 移除事件监听器
      button.removeEventListener('animationend', handleAnimationEnd);

      resolve();
    };

    button.addEventListener('animationend', handleAnimationEnd, { once: true });
  });

  // 左上角点击计数器（用于显示设置按钮）
  let topLeftClickCount = 0;
  let topLeftClickTimer = null;
  const REQUIRED_CLICKS = 5; // 需要点击5次
  const CLICK_RESET_TIME = 3000; // 3秒内未点击则重置计数

  // 左上角点击监听（同时支持触摸和点击）
  if (topLeftClickArea) {
    // 处理点击/触摸的逻辑函数
    const handleTopLeftClick = function (e) {
      // 阻止事件传播，确保不被其他处理器拦截
      preventEvent(e);

      // 清除之前的计时器
      if (topLeftClickTimer) {
        timerManager.clearTimeout(topLeftClickTimer);
      }

      // 增加点击计数
      topLeftClickCount++;

      // 输出日志以便调试
      logService?.info?.(`[App] 左上角点击计数: ${topLeftClickCount}/${REQUIRED_CLICKS}`);

      // 如果达到5次，显示设置按钮
      if (topLeftClickCount >= REQUIRED_CLICKS) {
        settingsBtn?.classList?.remove('hidden');
        logService?.info?.('[App] 设置按钮已显示（左上角点击5次）');
        // 显示后重置计数
        topLeftClickCount = 0;
      } else {
        // 设置重置计时器（3秒内未继续点击则重置）
        topLeftClickTimer = timerManager.addTimeout(() => {
          topLeftClickCount = 0;
          logService?.debug?.('[App] 左上角点击计数已重置');
        }, CLICK_RESET_TIME);
      }

      return false;
    };

    // 同时监听点击和触摸事件
    globalEventHandlers.topLeftClick = handleTopLeftClick;
    globalEventHandlers.topLeftTouchEnd = handleTopLeftClick;
    topLeftClickArea.addEventListener('click', handleTopLeftClick, { capture: true, passive: false });
    topLeftClickArea.addEventListener('touchend', handleTopLeftClick, { capture: true, passive: false });
  }

  // 首页按钮显示控制 - 显示所有功能按钮
  // 显示主页按钮
  // 隐藏主页按钮
  // 显示所有按钮（功能按钮+主页按钮）

  // 统一控制按钮显示状态
  // action: 'showAll' - 显示所有按钮(功能按钮，隐藏主页按钮), 'hideHome' - 隐藏主页按钮并显示功能按钮
  const controlButtons = (action) => {
    if (action === 'showAll' || action === 'hideHome') {
      if (_showAllButtonsCached) {
        _showAllButtonsCached();
        return;
      }
      const topSection = document.getElementById('top-buttons-section');
      const bottomSection = document.getElementById('home-cta-section');
      const homeButton = document.getElementById('home-btn');
      if (topSection) {
        topSection.classList.remove('home-buttons-hidden');
        topSection.classList.add('home-buttons-visible');
      }
      if (bottomSection) {
        bottomSection.classList.remove('home-buttons-hidden');
        bottomSection.classList.add('home-buttons-visible');
      }
      if (homeButton) homeButton.classList.add('hidden');
    }
  };

  /** 恢复首页状态：显示派对/点歌/点单按钮，隐藏首页按钮（去重：所有恢复逻辑统一调用）。
   * 先关闭所有弹层再恢复按钮，这样外部/父页只调用 restoreHomeButtons 时也能关掉派对/点歌页。
   * 注意：closeAllModals 通过 _isClosingAllModals 防止 modalClosed 循环。
   */
  let _showAllButtonsCached = null;
  import('./modules/common/ModalUtils.js').then(m => { _showAllButtonsCached = m.showAllButtons; }).catch(() => {});

  const restoreHomeButtons = async () => {
    logService.info('[页面] restoreHomeButtons: 开始恢复首页三按钮显示');
    try {
      if (_showAllButtonsCached) {
        _showAllButtonsCached();
      } else {
        const { showAllButtons } = await import('./modules/common/ModalUtils.js');
        _showAllButtonsCached = showAllButtons;
        showAllButtons();
      }
      logService.info('[页面] restoreHomeButtons: showAllButtons 执行完成');
    } catch (error) {
      logService.warn('[页面] restoreHomeButtons: showAllButtons 失败，走 controlButtons 兜底', error);
      controlButtons('hideHome');
    }
  };
  if (typeof window !== 'undefined') {
    window.restoreHomeButtons = restoreHomeButtons;
    window.controlButtons = controlButtons;
  }

  const hideAllButtons = () => {
    if (window._hideAllButtonsUtil) {
      window._hideAllButtonsUtil();
      return;
    }
    const topSection = document.getElementById('top-buttons-section');
    const bottomSection = document.getElementById('home-cta-section');
    const homeButton = document.getElementById('home-btn');
    if (topSection) {
      topSection.classList.remove('home-buttons-visible');
      topSection.classList.add('home-buttons-hidden');
    }
    if (bottomSection) {
      bottomSection.classList.remove('home-buttons-visible');
      bottomSection.classList.add('home-buttons-hidden');
    }
    if (homeButton) {
      homeButton.classList.remove('hidden');
      homeButton.classList.add('force-show');
    }
  };

  // 通用事件阻止函数
  const preventEvent = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  };

  const bindHomeCtaButton = (button, handler) => {
    if (!button || typeof handler !== 'function') {
      return;
    }

    button.addEventListener('click', async (event) => {
      const btnId = button.id || 'unknown';
      logService?.info?.(`[页面] 触发 CTA 按钮点击: ${btnId}`);
      
      if (button.dataset.ctaBusy === 'true') {
        logService?.warn?.(`[页面] 按钮 ${btnId} 正忙 (ctaBusy), 忽略点击`);
        preventEvent(event);
        return;
      }

      button.dataset.ctaBusy = 'true';
      preventEvent(event);

      try {
        logService?.info?.(`[页面] 开始执行按钮 ${btnId} 的 handler`);
        playHomeCtaAnimation(button);
        await handler();
        logService?.info?.(`[页面] 按钮 ${btnId} 的 handler 执行完毕`);
      } catch (error) {
        logService?.warn?.(`[页面] 按钮 ${btnId} 的 handler 执行失败`, error);
        await restoreHomeButtons();
      } finally {
        delete button.dataset.ctaBusy;
        logService?.info?.(`[页面] 按钮 ${btnId} 状态已重置 (ctaBusy removed)`);
      }
    }, { passive: false });
  };

  // 性能测量工具函数
  const measureOpen = async (name, fn) => {
    const t0 = performance?.now?.() || Date.now();
    await fn();
    const t1 = performance?.now?.() || Date.now();
    const ms = Math.round(t1 - t0);

    // 统一的日志记录方式
    const logMessage = `[Perf] ${name}打开耗时${ms}ms`;
    if (logService?.info) {
      logService.info(logMessage);
    } else if (window.__rawConsole?.info) {
      try {
        window.__rawConsole.info(logMessage);
      } catch (_) { }
    }
  };

  /** 防止 closeAllModals → closeSelectedModal → modalClosed → restoreHomeButtons → closeAllModals 循环 */
  let _isClosingAllModals = false;

  /**
   * 关闭所有弹层，用于「点击首页」返回主屏。
   * 规则：点击派对/点歌/点单进入的页面后，点击首页按钮只关闭当前打开的那一页（派对页/点歌页/点单页），
   * 并恢复「派对、点歌、点单」三按钮、隐藏首页按钮；不得关闭错误对象或误关其他页。
   * 当前实现：按固定顺序调用各 UI 的 close，未打开的面板 no-op；最后按 ID 兜底隐藏 unified-modal。
   */
  const closeAllModals = () => {
    if (_isClosingAllModals) return;
    _isClosingAllModals = true;
    try {
      logService.info('[页面] closeAllModals: 开始依次关闭 点歌→派对→已选→点单→收银台');
      const modalClosers = [
        ['点歌', () => window.songTopUI?.closeTopModal?.()],
        ['YouTube', () => window.youtubeUI?.closeYouTubeModal?.()],
        ['派对', () => window.partyUI?.closePartyModal?.()],
        ['已选', () => window.selectedUI?.closeSelectedModal?.()],
        ['点单', () => window.orderModal?.hide?.()],
        ['收银台', () => {
          const sm = window.cashierUI?.getServiceModal?.();
          sm?.close?.();
        }]
      ];
      modalClosers.forEach(([name, closer]) => {
        try {
          closer();
          logService.info(`[页面] closeAllModals: 已调用 ${name} 的 close`);
        } catch (e) {
          logService.warn(`[页面] closeAllModals: 调用 ${name} close 异常`, e);
        }
      });
      const unifiedModal = document.getElementById('unified-modal');
      if (unifiedModal) {
        unifiedModal.classList.add('hidden');
        unifiedModal.classList.remove('song-modal-visible');
        logService.info('[页面] closeAllModals 兜底: 已按 ID 隐藏 #unified-modal');
      }
      
      // 关键修复：显式清除管理器中的当前模式，否则第二次打开相同页面时会因为 currentMode === targetMode 而直接 return
      if (window.sharedModalManager && typeof window.sharedModalManager.clearCurrentMode === 'function') {
        window.sharedModalManager.clearCurrentMode();
        logService.info('[页面] closeAllModals: 已清除 SharedModalManager 的当前状态');
      }
      
      logService.info('[页面] closeAllModals: 全部执行完毕');
    } finally {
      _isClosingAllModals = false;
    }
  };

  const performGoHome = () => {
    const stack = new Error().stack;
    logService.info('[页面] performGoHome 已调用', { stack: stack });
    const currentMode = window.sharedModalManager?.getCurrentMode?.();
    const modeName = currentMode === 'party' ? '派对' : currentMode === 'song' ? '点歌' : currentMode || '（无/点单等）';
    logService.info(`[页面] 点击首页 → 关闭当前页面「${modeName}」，隐藏首页按钮，显示 派对/点歌/点单 三按钮`);
    closeAllModals();
    requestAnimationFrame(async () => {
      await restoreHomeButtons();
      logService.info('[页面] 已回到首页（三按钮已显示）');
      window.flowMetrics?.mark('home.go.buttons');
    });
  };

  // 暴露给全局，供紧急修复方案使用；早绑定监听会调用 __goHome
  window.performGoHome = performGoHome;
  window.__goHome = performGoHome;
  // 供嵌入场景使用：父页「首页」点击未进本页时，父页可调用此方法或 postMessage({ type: 'goHome' })
  window.goHomeAndRestoreButtons = function () {
    logService.info('[页面] goHomeAndRestoreButtons 被调用（可能来自父页/嵌入）');
    closeAllModals();
    restoreHomeButtons();
  };

  // 监听键盘事件（遥控器支持）
  const openSelectedPanel = () => {
    measureOpen('已选', async () => {
      try {
        if (window.bottomNavUI?.togglePanel) {
          await window.bottomNavUI.togglePanel('selected');
          return;
        }
        if (window.selectedUI?.createSelectedPanel) {
          await window.selectedUI.createSelectedPanel('selected');
          const panel = document.getElementById('selected-panel');
          panel?.classList?.remove('hidden');
        }
      } catch (_) { }
    });
  };

  // 通用模态框关闭函数
  const closeModal = async (ui, mode) => {
    const closeMethods = [
      () => ui?.closeTopModal?.(),
      () => ui?.closePartyModal?.(),
      () => ui?.closeModal?.(),
      () => ui?.hide?.(),
      () => ui?.cleanupEventListeners?.()
    ];

    for (const method of closeMethods) {
      try {
        const result = method();
        if (result instanceof Promise) {
          await result;
        }
        return; // 成功关闭一个就返回
      } catch (error) {
        logService.warn(`[App] 关闭${mode}模态框失败`, error);
      }
    }
  };

  const closeActiveModalBeforeSwitch = async (targetMode) => {
    if (!window.sharedModalManager) {
      window.sharedModalManager = await moduleLoader.load('sharedModalManager');
    }
    if (!window.sharedModalManager?.getCurrentMode) return;
    const currentMode = window.sharedModalManager.getCurrentMode();
    const currentUI = window.sharedModalManager.getCurrentUI?.();
    if (!currentMode || currentMode === targetMode) {
      if (!currentMode) logService.info('[页面] closeActiveModalBeforeSwitch: 当前无打开页面，无需关闭');
      else logService.info(`[页面] closeActiveModalBeforeSwitch: 当前已是目标页「${targetMode}」，无需关闭`);
      return;
    }
    const currentName = currentMode === 'party' ? '派对' : currentMode === 'song' ? '点歌' : currentMode;
    const targetName = targetMode === 'party' ? '派对' : targetMode === 'song' ? '点歌' : targetMode;
    logService.info(`[页面] closeActiveModalBeforeSwitch: 切换前关闭当前弹层 当前=「${currentName}」 目标=「${targetName}」`);
    try {
      if (currentMode === 'song' && targetMode === 'party' && currentUI?.closeTopModal) {
        await currentUI.closeTopModal(true);
        logService.info('[页面] closeActiveModalBeforeSwitch: 已关闭点歌，可打开派对');
        return;
      }
      if (currentMode === 'party' && targetMode === 'song' && currentUI?.closePartyModal) {
        await currentUI.closePartyModal(true);
        logService.info('[页面] closeActiveModalBeforeSwitch: 已关闭派对，可打开点歌');
        return;
      }
      await closeModal(currentUI, currentMode);
      logService.info(`[页面] closeActiveModalBeforeSwitch: 已通过 closeModal 关闭「${currentName}」`);
    } catch (error) {
      logService.warn('[App] 切换模式时关闭旧模态框失败', error);
    }
  };

  const openMode = async (mode, moduleName, openMethod) => {
    const pageName = mode === 'party' ? '派对' : mode === 'song' ? '点歌' : mode;
    logService.info(`[页面] openMode 开始: 「${pageName}」 (module=${moduleName}, method=${openMethod})`);
    
    try {
      logService.info(`[页面] openMode: 准备调用 closeActiveModalBeforeSwitch(${mode})`);
      await closeActiveModalBeforeSwitch(mode);
      
      logService.info(`[页面] openMode: 切换按钮可见性 (hideAllButtons)`);
      if (window._hideAllButtonsUtil) {
        window._hideAllButtonsUtil();
      } else {
        hideAllButtons();
      }
      
      logService.info(`[页面] openMode: 准备加载/获取模块 ${moduleName}`);
      if (!window[moduleName]) {
        logService.info(`[页面] openMode: 模块 ${moduleName} 未在 window, 调用 moduleLoader.load`);
        window[moduleName] = await moduleLoader.load(moduleName);
      }
      
      logService.info(`[页面] openMode: 准备调用页面显示方法 ${openMethod}`);
      if (window[moduleName]?.[openMethod]) {
        await window[moduleName][openMethod]();
        logService.info(`[页面] openMode: 已成功打开「${pageName}」页面`);
      } else {
        logService.error(`[页面] openMode: 模块 ${moduleName} 缺少方法 ${openMethod}`);
      }
    } catch (err) {
      logService.error(`[页面] openMode 执行失败: ${err.message}`, err);
    }
  };

  const openSongMode = () => openMode('song', 'songTopUI', 'openTopModal');
  const openPartyMode = () => {
    if (__homeDebugEnabled) {
      logService.info('[页面] 点击派对 → 打开派对页');
    }
    openMode('party', 'partyUI', 'showPartyModal');
  };

  // 首页CTA按钮：确保动画播放完成后再进入对应页面
  bindHomeCtaButton(musicBtn, async () => {
    const [allowed] = await Promise.all([
      window.checkRoomOperationAllowed(),
      window.songTopUI ? Promise.resolve() : moduleLoader.load('songTopUI').then(m => { window.songTopUI = m; }).catch(() => {})
    ]);
    if (!allowed) return;
    return measureOpen('点歌', openSongMode);
  });
  bindHomeCtaButton(partyBtn, async () => {
    const [allowed] = await Promise.all([
      window.checkRoomOperationAllowed(),
      window.partyUI ? Promise.resolve() : moduleLoader.load('partyUI').then(m => { window.partyUI = m; }).catch(() => {})
    ]);
    if (!allowed) return;
    return measureOpen('派对', openPartyMode);
  });

  // YouTube 触发逻辑：打开专用搜索并解析点播页面
  const youtubeTrigger = document.getElementById('youtube-trigger-btn');
  if (youtubeTrigger) {
    logService.info('[页面] 发现独立 YouTube 按钮，开始绑定事件');
    youtubeTrigger.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      logService.info('[页面] 点击 YouTube 按钮');
      
      // 动画效果
      if (typeof playHomeCtaAnimation === 'function') {
        playHomeCtaAnimation(youtubeTrigger);
      }

      try {
        const allowed = await window.checkRoomOperationAllowed();
        if (!allowed) {
          logService.warn('[页面] 房间操作不允许，中止打开 YouTube');
          return;
        }

        // 动态加载 YouTubeUI 模块（如果尚未加载）
        if (!window.youtubeUI) {
          logService.info('[页面] 正在加载 YouTubeUI 模块...');
          const m = await moduleLoader.load('youtubeUI');
          window.youtubeUI = m;
        }
        
        if (window.youtubeUI) {
          logService.info('[页面] 正在调用 showYouTubeModal');
          await window.youtubeUI.showYouTubeModal();
        } else {
          logService.error('[页面] 无法加载 YouTubeUI 模块');
        }
      } catch (err) {
        logService.error('[页面] 打开 YouTube 页面出错:', err);
      }
    });
  }
  

  if (homeBtn) {
    logService.info('[页面] 首页按钮 #home-btn 已找到，绑定 click/keydown');
    homeBtn.addEventListener('click', (event) => {
      logService.info('[页面] 首页按钮 直接点击触发 performGoHome');
      preventEvent(event);
      performGoHome();
    }, { passive: false });
    homeBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        logService.info('[页面] 首页按钮 键盘触发 performGoHome');
        preventEvent(e);
        performGoHome();
      }
    });
  } else {
    logService.warn('[页面] 首页按钮 #home-btn 未找到，将仅依赖 document 委托');
  }

  

  const handleOrderModal = async (action) => {
    logService.info('[页面] 点击点单 → 隐藏三按钮、显示首页，打开点单页面');
    if (window._hideAllButtonsUtil) {
      window._hideAllButtonsUtil();
    } else {
      hideAllButtons();
    }
    if (!window.orderModal) {
      window.orderModal = await moduleLoader.load('orderModal');
    }
    const modalInstance = window.orderModal;
    if (!modalInstance || typeof modalInstance[action] !== 'function') {
      await restoreHomeButtons();
      return;
    }
    if (action === 'show') {
      const handleOrderClose = () => {
        logService.info('[页面] 点单已关闭 → 显示三按钮、隐藏首页');
        timerManager.addTimeout(() => restoreHomeButtons(), 320);
      };
      document.addEventListener('orderModalClosed', handleOrderClose, { once: true });
      try {
        modalInstance.show();
        logService.info('[页面] 已打开点单页面');
        if (!modalInstance.isOpen) {
          document.removeEventListener('orderModalClosed', handleOrderClose);
          await restoreHomeButtons();
        }
      } catch (error) {
        document.removeEventListener('orderModalClosed', handleOrderClose);
        await restoreHomeButtons();
        throw error;
      }
    }
  };

  bindHomeCtaButton(orderBtn, async () => {
    const [allowed] = await Promise.all([
      window.checkRoomOperationAllowed(),
      window.orderModal ? Promise.resolve() : moduleLoader.load('orderModal').then(m => { window.orderModal = m; }).catch(() => {})
    ]);
    if (!allowed) return;
    return handleOrderModal('show');
  });

  globalEventHandlers.orderModalOpened = async () => {
    // 按钮状态已在 handleOrderModal 中处理，这里不需要额外操作
  };
  document.addEventListener('orderModalOpened', globalEventHandlers.orderModalOpened);

  if (serviceBtn) {
    serviceBtn.addEventListener('click', async () => {
      try {
        if (!window.cashierUI) {
          window.cashierUI = await moduleLoader.load('cashierUI');
        }
        const sm = window.cashierUI?.getServiceModal?.();
        sm?.show?.();
      } catch (_) { }
    });
  }

  // 设置按钮交互：打开设置弹窗
  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      try {
        if (!window.settingsUI) {
          window.settingsUI = await moduleLoader.load('settingsUI');
        }
        await window.settingsUI?.showModal?.();
      } catch (e) {
        logService.warn('[App] 打开设置失败:', e);
      }
    });
  }

  // 辅助函数：检查点击是否在按钮的实际显示区域内
  function isClickWithinButton(button, clientX, clientY) {
    if (!button || button.classList.contains('hidden')) return false;
    const rect = button.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right &&
           clientY >= rect.top && clientY <= rect.bottom;
  }

  // 辅助函数：判断面板是否开启
  const isPanelOpen = (panelId) => {
    const el = document.getElementById(panelId);
    return el && !el.classList.contains('hidden');
  };

  // 首页按钮监听已合并至 installHomeBtnEarlyCapture

  if (homeBtn) {
    homeBtn.classList.add('pointer-events-auto');
  }

  if (selectedOpen) {
    selectedOpen.classList.add('pointer-events-auto');
    selectedOpen.addEventListener('click', function (e) {
      // 双重检查：确保点击在按钮区域内
      if (isClickWithinButton(selectedOpen, e.clientX, e.clientY)) {
        preventEvent(e);
        openSelectedPanel();
      }
    });
    selectedOpen.addEventListener('keydown', function (e) {
      // 检查已选模态框是否打开，如果打开则阻止按钮点击
      const isSelectedPanelOpen = isPanelOpen('selected-panel');
      if (isSelectedPanelOpen) {
        preventEvent(e);
        return false;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        preventEvent(e);
        openSelectedPanel();
      }
    });
  }

  globalEventHandlers.navigateToHome = performGoHome;
  document.addEventListener('navigateToHome', globalEventHandlers.navigateToHome);

  globalEventHandlers.modalClosed = () => {
    if (_isClosingAllModals) return;
    restoreHomeButtons();
  };
  document.addEventListener('modalClosed', globalEventHandlers.modalClosed);

  /** 仅关闭已选面板时：只恢复三按钮，不关闭点歌/派对/点单 */
  let _showAllButtonsOnlyCached = null;
  import('./modules/common/ModalUtils.js').then(m => { _showAllButtonsOnlyCached = m.showAllButtonsOnly; }).catch(() => {});

  const onSelectedPanelClosed = () => {
    if (_isClosingAllModals) return;
    const unifiedModal = document.getElementById('unified-modal');
    const isModalOpen = unifiedModal && !unifiedModal.classList.contains('hidden');
    if (isModalOpen) {
      logService?.info?.('[页面] selectedPanelClosed: unified-modal 仍打开，跳过按钮恢复');
      return;
    }
    if (_showAllButtonsOnlyCached) {
      _showAllButtonsOnlyCached();
    } else {
      controlButtons('hideHome');
    }
  };
  document.addEventListener('selectedPanelClosed', onSelectedPanelClosed);

  try {
    const selectedPanel = document.getElementById('selected-panel');
    if (selectedPanel && !selectedPanel._observer) {
      const mo = new MutationObserver(async () => {
        const hidden = selectedPanel.classList.contains('hidden');
        if (hidden) {
          window.flowMetrics?.mark('selected.close.observer');
          onSelectedPanelClosed();
        }
      });
      mo.observe(selectedPanel, { attributes: true, attributeFilter: ['class'] });
      selectedPanel._observer = mo;
      observers.selectedPanelObserver = mo; // 保存引用以便清理
    }
  } catch (_) { }
});
