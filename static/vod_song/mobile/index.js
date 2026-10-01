/**
 * 应用入口文件（配置由 index.html 加载 ../shared/config/apiConfig.js）
 */

// 立即输出日志，确认文件被加载
logService.info('[index.js] 当前时间:', new Date().toISOString());

// 导入核心服务
import apiService from '../shared/core/ApiService.js';

// 导入模块UI和服务
import songTopUI from './modules/songs/songTopUI.js?v=20260925-idtab1';
import songService from '../shared/modules/songs/SongService.js';
import songSearchService from '../shared/modules/songs/SongSearchService.js';
import songSyncManager from '../shared/modules/songs/SongSyncManager.js';
import singerUI from './modules/singers/SingerUI.js?v=20260925-filters1';
import singerService from '../shared/modules/songs/SingerService.js';
import singerSongsUI from './modules/singers/SingerSongsUI.js?v=20260925-idtab1';

import cashierUI from './modules/cashier/CashierUI.js?v=20260730-order7';
import cashierService from './modules/cashier/CashierService.js?v=20260730-order';
import homeSelectedUI from './modules/selected/HomeSelectedUI.js?v=20260925-idtab1';

// 导入派对模块
import partyUI from './modules/party/partyUI.js';

// 导入互动模块
import interactionUI from './modules/interaction/InteractionUI.js?v=20260925-light1';
import interactionService from '../shared/modules/interaction/InteractionService.js?v=20260903-interaction-submit';

// 导入导航UI和服务
import bottomNavUI from './navigation/bottomNav/BottomNavUI.js?v=20260925-fast-start1';
import bottomNavService from '../shared/navigation/bottomNav/BottomNavService.js';
import displayUI from './navigation/display/DisplayUI.js?v=20260925-light1';
import navMaterialUI from './navigation/materials/MaterialUI.js';
import navMaterialService from '../shared/navigation/materials/MaterialService.js';
import navSelectedUI from './navigation/selected/SelectedUI.js?v=20260925-light2';
import navSelectedService from '../shared/navigation/selected/SelectedService.js';
import smartlUI from './navigation/smartl/SmartlUI.js?v=20260925-compact1';
import smartlService from '../shared/navigation/smartl/SmartlService.js';

// 导入公共服务
import langService from '../shared/services/LangService/LangService.js';
import logService from '../shared/services/LogService.js';
import cacheService from '../shared/services/CacheService.js';
import toastService from '../shared/services/ToastService.js';

// 立即将语言服务暴露到全局，以便 index.html 可以使用
window.langService = langService;

// 在入口处按环境配置日志；默认不补丁 console、仅输出 warn+
const __isLocalHost = (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname));
const __enablePatch = __isLocalHost || (typeof window !== 'undefined' && (new URLSearchParams(window.location.search).get('logPatch') === '1' || localStorage.getItem('ktv:log:patch') === '1'));

// 确保日志服务有默认配置
if (!logService.logLevel) {
  logService.logLevel = 'info';
}

logService.setOptions({ showSource: false, foldDuplicates: true, foldWindowMs: 3000 });

// 调试时才捕获控制台，避免手机启动时格式化大量日志和调用栈。
if (__enablePatch) {
  logService.patchConsole();
  // 使用日志服务记录信息而不是 console.log
  logService.info('[App] Console patching enabled');
} else {
  // 使用日志服务记录信息而不是 console.log
  logService.info('[App] Console patching disabled');
}

const __levelParam = (typeof window !== 'undefined') ? new URLSearchParams(window.location.search).get('log') : null;
const __levelStore = (typeof window !== 'undefined') ? localStorage.getItem('ktv:log:level') : null;
const logLevel = __levelParam || __levelStore || (__isLocalHost ? 'info' : 'warn');
logService.setLogLevel(logLevel);

// 使用日志服务记录信息而不是 console.log
logService.info('[App] Log level set to: ' + logLevel);

// 导入工具
import RequestUtils from '../shared/utils/RequestUtils.js';
import DomUtils from '../shared/utils/DomUtils.js';

// 导入路由
import router from './router/server.js';

// 导出所有服务和UI实例，供其他模块使用
export {
  // 核心服务
  apiService,

  // 模块UI和服务
  songTopUI,
  songService,
  songSearchService,
  songSyncManager,
  singerUI,
  singerService,
  singerSongsUI,
  cashierUI,
  cashierService,
  homeSelectedUI,
  partyUI,
  interactionUI,
  interactionService,

  // 导航UI和服务
  bottomNavUI,
  bottomNavService,
  displayUI,
  navMaterialUI,
  navMaterialService,
  navSelectedUI,
  navSelectedService,
  smartlUI,
  smartlService,

  // 公共服务
  langService,
  logService,
  cacheService,
  toastService,

  // 工具
  RequestUtils,
  DomUtils,

  // 路由
  router
};

// 将缓存服务挂载到全局，供 SmartlService/SmartlUI 访问字典
if (typeof window !== 'undefined') {
  window.cacheService = cacheService;
  // 将日志服务挂载到全局，供 ApiService 等模块使用
  window.logService = logService;
  // Toast 服务挂载到全局，供 SmartlUI 等播控室时提示
  window.toastService = toastService;
}

// 应用初始化函数
async function initApp() {
  // 使用日志服务记录信息而不是 console.log
  logService.info('初始化火山KTV系统...');

  // 添加根路径路由
  router.addRoute('/', () => {
    // 使用日志服务记录信息而不是 console.log
    logService.info('导航到首页');
    // 这里可以添加首页初始化逻辑
  });

  // 初始化路由
  router.init();

   // 统一暴露模块到全局
  const exposeToGlobal = (key, value) => {
    window[key] = value;
  };
  // 先暴露服务
  exposeToGlobal('apiService', apiService);
  exposeToGlobal('songService', songService);
  exposeToGlobal('songSearchService', songSearchService);
  exposeToGlobal('songSyncManager', songSyncManager);
  exposeToGlobal('bottomNavService', bottomNavService);
  exposeToGlobal('navMaterialService', navMaterialService);
  exposeToGlobal('navSelectedService', navSelectedService);
  exposeToGlobal('smartlService', smartlService);
  exposeToGlobal('langService', langService);
  exposeToGlobal('cacheService', cacheService);
  exposeToGlobal('toastService', toastService);
  exposeToGlobal('singerService', singerService);
  exposeToGlobal('cashierService', cashierService);
  exposeToGlobal('interactionService', interactionService);
  
  // 再暴露UI组件
  exposeToGlobal('bottomNavUI', bottomNavUI);
  exposeToGlobal('songTopUI', songTopUI);
  exposeToGlobal('smartlUI', smartlUI);
  exposeToGlobal('displayUI', displayUI);
  exposeToGlobal('navMaterialUI', navMaterialUI);
  exposeToGlobal('selectedUI', navSelectedUI);
  exposeToGlobal('partyUI', partyUI);
  exposeToGlobal('interactionUI', interactionUI);
  exposeToGlobal('cashierUI', cashierUI);
  exposeToGlobal('homeSelectedUI', homeSelectedUI);
  exposeToGlobal('singerUI', singerUI);
  exposeToGlobal('singerSongsUI', singerSongsUI);
  // 首屏按钮和热门歌曲不等待语言、字典、歌星或播放队列请求。
  initMainPageEvents();
  homeSelectedUI.initHomeSelectedList().then(() => {
    homeSelectedUI.bindHomeSelectedEvents();
  }).catch(error => logService.error('初始化首页热门歌曲失败', error));
  // 确保所有模块都暴露到全局后再初始化底部导航栏
  try {
    await bottomNavUI.renderBottomNav();
  } catch (error) {
    logService.error('[App] 底部导航栏初始化失败:', error);
    // 尝试备用初始化
    setTimeout(() => {
      try {
        bottomNavUI.renderBottomNav();
      } catch (retryError) {
        logService.error('[App] 底部导航栏备用初始化也失败:', retryError);
      }
    }, 1000);
  }

  // 异步恢复已保存语言，保持首屏和点歌加载不被语言请求阻塞。
  langService.init().then(() => updateMainPageLanguage())
    .catch(error => logService.warn('[App] 恢复语言失败:', error));

  const resolveRoomBinding = async () => {
    // 依赖 ApiService 的优先级逻辑（URL > Storage > current）
    const rId = apiService.getRoomId();
    
    // 如果是通过 URL 传入的新房间 ID，建议同步到 clientIp 供后续默认使用
    const urlId = apiService._getRoomIdFromUrl();
    if (urlId && urlId !== localStorage.getItem('clientIp')) {
      localStorage.setItem('clientIp', urlId);
      logService?.info?.(`[App/Mobile] 已将 URL 中的房间ID (${urlId}) 同步到本地配置`);
    }

    if (rId && rId !== 'current') {
      logService.info(`[App/Mobile] 使用自动解析的房间ID: ${rId}`);
      return rId;
    }
    logService.warn('[App/Mobile] 房间ID未配置或未解析，请在设置页面配置或通过 URL 传递');
    return '';
  };

  await resolveRoomBinding();

  // 手机端首页、点歌、互动不依赖房间状态；避免未绑定房间时启动即请求 /rooms/:id/state 产生 404。
  logService.info('[App] 已跳过启动阶段房间状态同步');

  // 后台预热，不阻塞首屏和控制按钮；各模块仍通过原服务按需读取。
  try {
    // 确保缓存服务已初始化
    if (cacheService && typeof cacheService.preloadAll === 'function') {
      logService.info('[App] 开始执行预加载任务');
      cacheService.preloadAll(30 * 60 * 1000, { songs: 20, singers: 30 })
        .catch(error => logService.warn('[App] 后台预加载失败', error));
    } else {
      logService.warn('[App] 缓存服务未正确初始化，跳过预加载');
    }
  } catch (e) {
    // 不中断应用
    // 使用日志服务记录警告而不是 console.warn
    logService.warn('[App] 预加载任务出现问题时', e);
  }

  // 注意：状态广播已通过 WebSocket 实现，不再使用 SSE
  // 旧的 SSE 实现已移除，避免不必要的 404 请求

  // SmartlService 状态同步由控制面板按需初始化，避免首页加载阶段打 /rooms/:id/state。

  // 队列继续后台同步，角标复用同一响应，避免再次请求整份队列。
  songService.syncRequestedSongsFromServer({ force: true, immediate: true })
    .then(() => bottomNavUI.updateSelectedBadge(songService.selectedSongs?.length || 0))
    .catch(error => logService.warn('[App] 后台队列同步失败:', error));

  // 使用日志服务记录信息而不是 console.log
  logService.info('火山KTV系统初始化完成');

}

/**
 * 初始化首页主要按钮事件（派对、互动、点歌、语言切换）
 */
function initMainPageEvents() {
  const partyBtn = document.getElementById('party-call-btn') || document.getElementById('party-btn');
  const musicBtn = document.getElementById('music-btn');
  const interactionBtn = document.getElementById('interaction-btn');
  const langBtn = document.getElementById('languageToggle') || document.getElementById('language-toggle-btn');

  // 派对按钮
  if (partyBtn) {
    partyBtn.addEventListener('click', async () => {
      logService.info('[App] 点击派对按钮');
      if (typeof window.checkRoomOperationAllowed === 'function' && !await window.checkRoomOperationAllowed()) return;
      if (window.partyUI && typeof window.partyUI.showPartyModal === 'function') {
        window.partyUI.showPartyModal();
      }
    });
  }

  // 点歌按钮
  if (musicBtn) {
    musicBtn.addEventListener('click', async () => {
      logService.info('[App] 点击点歌按钮');
      // 打开曲库不依赖房间状态；真正点歌入队时再走 /rooms/:id/queue。
      if (window.songTopUI && typeof window.songTopUI.openTopModal === 'function') {
        window.songTopUI.openTopModal();
      }
    });
  }

  // 互动按钮
  if (interactionBtn) {
    interactionBtn.addEventListener('click', async () => {
      logService.info('[App] 点击互动按钮');
      // 互动功能使用独立 interaction/proxy 接口，入口不依赖房间状态接口。
      if (window.interactionUI && typeof window.interactionUI.show === 'function') {
        window.interactionUI.show();
      }
    });
  }

  // 语言切换
  if (langBtn) {
    langBtn.addEventListener('click', async () => {
      logService.info('[App] 点击语言切换按钮');
      const current = langService.getCurrentLanguage();
      const next = current === 'zh_cn' ? 'en_us' : current === 'en_us' ? 'id_id' : 'zh_cn';
      
      langBtn.disabled = true;
      try {
        const result = await langService.switchLanguage(next);
        if (!result.success) throw new Error(result.error);
        updateMainPageLanguage();
      } catch (error) {
        logService.error('[App] 切换语言失败:', error);
      } finally {
        langBtn.disabled = false;
      }
    });
  }
}

function updateMainPageLanguage() {
  const language = langService.getCurrentLanguage();
  // 更新 body 语言类（控制多语言 span 显示/隐藏）
  document.body.classList.remove('show-indonesian', 'show-english', 'show-vietnamese');
  if (language === 'id_id') document.body.classList.add('show-indonesian');
  else if (language === 'en_us') document.body.classList.add('show-english');
  else if (language === 'vi_vn') document.body.classList.add('show-vietnamese');

  // 更新按钮文字
  const langText = document.getElementById('languageText');
  if (langText) {
    const langNames = { 'zh_cn': '中文', 'en_us': 'EN', 'id_id': 'ID' };
    langText.textContent = langNames[language] || '中文';
  }

  // 手动触发布局更新事件
  document.dispatchEvent(new CustomEvent('languageChanged', { detail: { language } }));
  
  // 更新所有带 data-lang-key 的元素文本
  document.querySelectorAll('[data-lang-key]').forEach(el => {
    const key = el.getAttribute('data-lang-key');
    const text = langService.t(key);
    if (text) el.textContent = text;
  });
  
  // 更新已选列表标题（首页）
  const selectedListTitle = document.getElementById('selectedListTitle');
  if (selectedListTitle) {
    selectedListTitle.textContent = langService.t('hotSongs') || '热门歌曲';
  }
  
}

function runWhenDomReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

// DOM 加载完成后初始化应用。mobile/index.html 通过 dynamic import 加载本文件，
// import 可能晚于 DOMContentLoaded，必须在 DOM 已就绪时立即执行。
runWhenDomReady(async function initAll() {
  await initApp();

  // 为所有带 control-btn 类的按钮添加点击动效（事件委托）
  document.addEventListener('click', function (e) {
    const controlBtn = e.target.closest('.control-btn');
    if (controlBtn) {
      controlBtn.classList.add('clicked');
      setTimeout(() => controlBtn.classList.remove('clicked'), 300);
    }
  });
});

