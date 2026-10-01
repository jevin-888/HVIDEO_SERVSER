// 智能控制面板UI - 已删除音效面板静音按钮 v2026-03-14
// 延迟导入，避免循环依赖
import { cleanupWebSocketListeners as cleanupWSListeners } from '../../modules/common/WebSocketUtils.js';
import DomUtils from '../../utils/DomUtils.js';
import RequestUtils from '../../utils/RequestUtils.js';
import { logInfo, logWarn, logError } from '../../utils/Logger.js';
import { isEmptyArray } from '../../utils/NormalizeUtils.js';
let smartlService;

/**
 * 导航控制UI逻辑
 */
class SmartlUI {
  constructor() {
    // 在需要时动态导入服务
    this._lastClickTime = 0; // 防抖计时器
    this._processingCommand = null; // 当前正在处理的命令
    this._sendingCommands = new Set(); // 正在发送的命令集合
    this._processingVolumeAction = null; // 当前正在处理的音量操作
    this._volumeFixObserver = null; // 音量按钮修复监听器
    this._resizeHandler = null; // 窗口大小变化处理器
    this._volumeButtonObservers = []; // 音量按钮ResizeObserver列表
    this._volumeButtonTimeouts = new Map(); // 存储每个音量按钮的动画定时器引用
    
    // WebSocket监听器清理函数
    this._syncStateUnbind = null;
    this._connectedUnbind = null;
    this._wsSyncInitialized = false; // 标记是否已初始化WebSocket同步
    
    // 事件监听器管理：存储已绑定的监听器，避免重复绑定
    this._boundEventHandlers = new Map(); // 存储已绑定的事件处理器
    // DOM 缓存：避免 updateButtonStates 每次全局扫描
    this._domCache = null;
    this._updateButtonsRaf = null; // requestAnimationFrame 防抖
  }
  
  /**
   * 开发环境日志输出（只在localhost环境下输出）
   * @param {...any} args - 要输出的参数
   */
  _logDev(...args) {
    if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {

    }
  }
  
  /**
   * 检查面板是否可见
   * @returns {boolean} 是否可见
   */
  _isPanelVisible() {
    const panel = document.getElementById('smart-panel') || document.querySelector('.smartl-panel');
    return panel && !panel.classList.contains('hidden') && panel.offsetParent !== null;
  }

  /**
   * 初始化服务
   */
  async initServices() {
    // 防重复初始化
    if (this._servicesReady) return;

    // 优先从全局获取（如果已预加载）
    if (typeof window !== 'undefined' && window.smartlService) {
      this.smartlService = window.smartlService;
    } else if (typeof window !== 'undefined' && window.moduleLoader) {
      // 从 moduleLoader 获取
      this.smartlService = await window.moduleLoader.load('smartlService');
      // 缓存到全局，避免重复加载
      if (this.smartlService) {
        window.smartlService = this.smartlService;
      }
    } else if (!this.smartlService && typeof window !== 'undefined') {
      // 降级：优先尝试从全局 window 获取
      const services = window;
      if (services.moduleLoader && !this.smartlService) {
        try {
          this.smartlService = await services.moduleLoader.load('smartlService');
          services.smartlService = this.smartlService;
        } catch (e) {}
      }
    }
    const langCodes = ['id_id', 'en_us', 'vi_vn'];
    await Promise.all(langCodes.map(code =>
      (this.langService && !this.langService.translations[code])
        ? this.langService.loadLanguageFile(code).catch(() => {})
        : Promise.resolve()
    ));
    
    // 如果还是未初始化，抛出错误
    if (!this.smartlService) {
      throw new Error('smartlService 初始化失败，无法从 moduleLoader 或全局对象获取');
    }
    this._servicesReady = true;
  }

  /**
   * 渲染控制面板
   * @param {Object} controls - 控制项列表
   */
  renderSmartlPanel(controls) {
    // 实现控制面板的渲染逻辑
  }

  /**
   * 更新控制状态
   * @param {Object} status - 控制状态
   */
  updateSmartlStatus(status) {
    // 实现控制状态更新逻辑
  }

  /**
   * 绑定控制相关事件
   */
  bindSmartlEvents() {
    // 实现控制相关事件绑定逻辑
  }
  
  /**
   * 创建智控面板内容
   * @param {string} panelId - 面板ID
   */
  async createSmartlPanel(panelId) {
    // 获取面板元素
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;

    // 面板已创建过则直接复用，不重建DOM（性能优化）
    if (panel.dataset.panelReady === 'true') {
      return;
    }
    
    // 确保服务已初始化
    await this.initServices();
    
    // 获取翻译
    const zhTranslations = this.langService?.translations['zh_cn'] || {};
    const temperatureZh = zhTranslations['temperature'] || '温度';
    const musicVolumeZh = zhTranslations['musicVolume'] || '音乐';
    this.langService = window.langService;
    const idT = this.langService?.translations['id_id'] || {};
    const enT = this.langService?.translations['en_us'] || {};
    const viT = this.langService?.translations['vi_vn'] || {};

    // 辅助函数：生成四种语言的文字内容
    const multiLangText = (key, zh, id, en, vi) => {
      const tZh = zh || zhTranslations[key] || '';
      const tId = id || idT[key] || '';
      const tEn = en || enT[key] || '';
      const tVi = vi || viT[key] || '';
      return `<span class="zh-label" data-lang-key="${key}">${tZh}</span>` +
             `<span class="indonesian-translation">${tId}</span>` +
             `<span class="en-translation">${tEn}</span>` +
             `<span class="vi-translation">${tVi}</span>`;
    };

    const panelContent = `
        <div id="${panelId}-overlay" class="fixed inset-0 bg-black/50 opacity-0 transition-opacity duration-300 pointer-events-none"></div>
        <div class="premium-panel-base text-white transform translate-y-[120%] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] bg-cover bg-center" style="background-image: url('./assets/images/bg_window.png')">
          <!-- Handle -->
          <div class="w-12 h-1.5 bg-white/20 rounded-full mx-auto mt-3 mb-1"></div>

          <div class="px-6 pt-2 pb-2 relative z-10">
            <div class="flex justify-between items-center mb-4">
              <div class="song-tabs premium-tab-container flex-1 flex space-x-1 rounded-2xl bg-white/5 p-1">
                <button class="tab-btn flex-1 px-1 py-2 rounded-xl text-sm font-bold transition-all duration-300 smartl-tab-btn is-active bg-red-600 shadow-lg shadow-red-500/20 whitespace-nowrap flex items-center justify-center" data-tab="light">
                  <i class="fa fa-lightbulb mr-1.5 flex-shrink-0"></i>${multiLangText('light', '灯光', idT['light'], enT['light'], viT['light'])}
                </button>
                <button class="tab-btn flex-1 px-1 py-2 rounded-xl text-sm font-medium text-gray-400 transition-all duration-300 smartl-tab-btn whitespace-nowrap flex items-center justify-center" data-tab="ac">
                  <i class="fa fa-wind mr-1.5 flex-shrink-0"></i>${multiLangText('airConditioner', '空调', idT['airConditioner'], enT['airConditioner'], viT['airConditioner'])}
                </button>
                <button class="tab-btn flex-1 px-1 py-2 rounded-xl text-sm font-medium text-gray-400 transition-all duration-300 smartl-tab-btn whitespace-nowrap flex items-center justify-center" data-tab="audio">
                  <i class="fa fa-music mr-1.5 flex-shrink-0"></i>${multiLangText('audio', '音效', idT['audio'], enT['audio'], viT['audio'])}
                </button>
              </div>
              <button class="control-btn w-10 h-10 flex items-center justify-center bg-white/5 rounded-full text-white/60 hover:text-white transition-colors close-panel-btn">
                <i class="fa fa-times"></i>
              </button>
            </div>
          </div>
          
          <div class="panel-shell__body flex-1 overflow-hidden px-6 relative z-10">
            <!-- 灯光控制 -->
            <div class="tab-content h-full overflow-y-auto pb-20 custom-scrollbar" id="light-tab" data-scrollable="true">
              <div class="grid grid-cols-3 gap-3" id="light-buttons">
                <!-- 灯光按钮将动态生成 -->
              </div>
            </div>

            <!-- 空调控制 -->
            <div class="tab-content hidden h-full overflow-y-auto pb-20 custom-scrollbar" id="ac-tab" data-scrollable="true">
              <div class="premium-card p-4 mb-4">
                <div class="flex items-center justify-between">
                  <div class="flex flex-col">
                    <span class="text-xs uppercase text-white/40 tracking-widest font-bold">${multiLangText('temperature', temperatureZh, idT['temperature'] || 'Suhu', enT['temperature'] || 'Temp', viT['temperature'] || 'Nhiệt độ')}</span>
                    <span class="text-3xl font-black mt-1">26°C</span>
                  </div>
                  <div class="flex gap-3">
                    <button class="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-xl active:scale-90 transition-transform" data-command="consumer/clickButton/temMinusButton">
                      <i class="fa fa-minus"></i>
                    </button>
                    <button class="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-xl active:scale-90 transition-transform" data-command="consumer/clickButton/temAddButton">
                      <i class="fa fa-plus"></i>
                    </button>
                  </div>
                </div>
              </div>
              <div class="grid grid-cols-3 gap-3" id="ac-buttons">
                <!-- 空调按钮将动态生成 -->
              </div>
            </div>

            <!-- 音效控制 -->
            <div class="tab-content hidden h-full overflow-y-auto pb-20 custom-scrollbar" id="audio-tab" data-scrollable="true">
              <div id="sound-effect-buttons" class="grid grid-cols-4 gap-3 mb-6">
                <!-- 音效按钮将动态生成 -->
              </div>
              
              <div class="space-y-4">
                <!-- 音乐音量 -->
                <div class="premium-card p-4">
                  <div class="flex justify-between items-center mb-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-500">
                        <i class="fa fa-music"></i>
                      </div>
                      <div class="flex flex-col">
                        <div class="text-sm font-bold">${multiLangText('musicVolume', musicVolumeZh, idT['musicVolume'] || 'Volume Musik', enT['musicVolume'] || 'Music Vol', viT['musicVolume'] || 'Âm lượng nhạc')}</div>
                      </div>
                    </div>
                    <div class="text-2xl font-black text-red-500" id="music-volume">0</div>
                  </div>
                  <div class="flex items-center gap-4">
                    <button class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center active:scale-90 transition-transform" data-volume="music-down">
                      <i class="fa fa-minus"></i>
                    </button>
                    <div class="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div id="music-progress" class="h-full bg-red-500" style="width: 0%"></div>
                    </div>
                    <button class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center active:scale-90 transition-transform" data-volume="music-up">
                      <i class="fa fa-plus"></i>
                    </button>
                  </div>
                </div>

                <!-- 话筒音量 -->
                <div class="premium-card p-4">
                  <div class="flex justify-between items-center mb-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center text-green-500">
                        <i class="fa fa-microphone"></i>
                      </div>
                      <div class="flex flex-col">
                        <div class="text-sm font-bold">${multiLangText('microphone', '话筒', idT['microphone'] || 'Volume Mik', enT['microphone'] || 'Mic Vol', viT['microphone'] || 'Âm lượng mic')}</div>
                      </div>
                    </div>
                    <div class="text-2xl font-black text-green-500" id="mic-volume">0</div>
                  </div>
                  <div class="flex items-center gap-4">
                    <button class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center active:scale-90 transition-transform" data-volume="mic-down">
                      <i class="fa fa-minus"></i>
                    </button>
                    <div class="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div id="mic-progress" class="h-full bg-green-500" style="width: 0%"></div>
                    </div>
                    <button class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center active:scale-90 transition-transform" data-volume="mic-up">
                      <i class="fa fa-plus"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>`;
    
    // 更新面板内容
    panel.innerHTML = panelContent;
    // 标记面板已创建完成，后续打开直接复用
    panel.dataset.panelReady = 'true';
    
    // 强制修复音量按钮尺寸（针对 Android WebView）
    this.fixVolumeButtonsSize();
    
    // 绑定事件（同步，必须在面板显示前完成）
    this.bindPanelEvents(panelId);
    
    // 关闭处理函数
    const closeHandler = () => {
      document.dispatchEvent(new CustomEvent('closePanel', {
        detail: { panelId }
      }));
    };
    
    // 关闭面板按钮
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeHandler);
    
    // 遮罩点击关闭
    const overlay = panel.querySelector(`#${panelId}-overlay`);
    if (overlay) overlay.addEventListener('click', closeHandler);
    
    // 以下全部异步非阻塞，不影响面板显示速度
    // 生成动态灯光、空调按钮、音效按钮、状态同步
    setTimeout(() => {
      this.generateLightButtons().catch(e => logError('SmartlUI', '生成灯光按钮失败:', e));
      this.generateAcButtons().catch(e => logError('SmartlUI', '生成空调按钮失败:', e));
      this.optimizeForTablet();
      this.fixVolumeButtonsSize();
      this.initVolumeButtonFixObserver();
      this.renderSoundEffectButtons().catch(error => {
        logError('SmartlUI', 'renderSoundEffectButtons 执行出错:', error);
      });
    }, 50);
    
    // 先注册WS监听（用缓存做初始填充），再用HTTP实时数据覆盖
    this.initWebSocketSync();
    this.syncInitialState().then(() => this.updateAllUI()).catch(() => {});
  }
  
  /**
   * 强制修复音量按钮尺寸（针对 Android WebView CSS 兼容性问题）
   */
  fixVolumeButtonsSize() {
    const volumeButtons = document.querySelectorAll('.smartl-panel .volume-btn-control');
    if (volumeButtons.length === 0) return;
    
    // 缓存 isHighRes，避免每次重复计算（窗口 resize 时由 initVolumeButtonFixObserver 清除缓存）
    if (this._isHighResCache === undefined) {
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      this._isHighResCache = vw >= 1000 || vh >= 1800 || dpr >= 2;
    }
    const isHighRes = this._isHighResCache;
    const buttonSize = isHighRes ? '64' : '44';
    const gapSize = isHighRes ? '0.8rem' : '0.45rem';
    const isDark = document.documentElement.classList.contains('dark');
    
    volumeButtons.forEach(btn => {
      const classesToRemove = ['control-btn', 'rounded-full', 'flex', 'items-center', 'justify-center', 
                               'text-lg', 'leading-none', 'w-8', 'h-8', 'w-10', 'h-10', 'w-12', 'h-12', 
                               'p-4', 'px-4', 'py-4', 'bg-white/5', 
                               'text-white/60', 'transition-transform', 
                               'duration-150', 'ease-out', 'active:scale-95'];
      classesToRemove.forEach(cls => btn.classList.remove(cls));
      
      btn.classList.add('volume-btn-control-fixed');
      btn.style.setProperty('--volume-btn-size', `${buttonSize}px`);
      btn.style.setProperty('--volume-icon-size', isHighRes ? '1.4rem' : '1rem');
      btn.style.removeProperty('transform');
      btn.style.removeProperty('scale');
      
      const parent = btn.parentElement;
      if (parent && parent.classList.contains('volume-control-row')) {
        parent.classList.add('volume-control-row-fixed');
        parent.style.setProperty('--volume-control-gap', gapSize);
      }
      
      btn.style.removeProperty('background-color');
      btn.style.removeProperty('color');
      btn.classList.toggle('is-dark-theme', isDark);
      
      const icon = btn.querySelector('i');
      if (icon) icon.style.removeProperty('color');
    });
  }
  
  /**
   * 初始化音量按钮修复监听器（监听面板显示 + 窗口 resize）
   */
  initVolumeButtonFixObserver() {
    // 防重复初始化
    if (this._volumeFixObserver) return;
    
    const panel = document.querySelector('.smartl-panel');
    if (!panel) return;
    
    // 监听面板 class 变化（面板显示时修复按钮）
    this._volumeFixObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'class' && !m.target.classList.contains('translate-y-full')) {
          setTimeout(() => this.fixVolumeButtonsSize(), 50);
          break;
        }
      }
    });
    this._volumeFixObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });
    
    // 窗口 resize 时清除缓存并重新修复
    let resizeTimer;
    this._resizeHandler = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this._isHighResCache = undefined; // 清除缓存
        this.fixVolumeButtonsSize();
      }, 150);
    };
    window.addEventListener('resize', this._resizeHandler);
  }
  
  /**
   * @deprecated 已简化，保留空实现避免调用报错
   */
  setupVolumeButtonResizeObserver() {}
  
  /**
   * 优化平板设备显示（保留空实现以兼容调用方，样式由 CSS 控制）
   */
  optimizeForTablet() {
  }
  
  /**
   * 生成灯光按钮
   */
  /**
     * 生成灯光按钮
     */
    async generateLightButtons() {
      try {
        // 确保服务已初始化
        await this.initServices();

        // 从 settings 中获取 code 和 ctrlType
        const response = await window.apiService.getPeripheralPresets('light');
        let lightPresets = response?.data || [];

        // 如果获取失败，显示错误
        if (!Array.isArray(lightPresets) || lightPresets.length === 0) {
          logError('[SmartlUI] 无法获取灯光预设数据');
          const lightButtonsContainer = document.getElementById('light-buttons');
          if (lightButtonsContainer) {
            lightButtonsContainer.innerHTML = '<div class="text-center text-gray-500 py-8">无法加载灯光控制</div>';
          }
          return;
        }

        // 按 sortOrder 排序
        lightPresets.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

        // 获取灯光按钮容器
        const lightButtonsContainer = document.getElementById('light-buttons');
        if (!lightButtonsContainer) {
          logError('[SmartlUI] 未找到灯光按钮容器');
          return;
        }

        // 生成灯光按钮HTML
        let lightButtonsHTML = '';

        lightPresets.forEach((preset, index) => {
          // 从 settings 中获取 code 和 ctrlType
          const code = preset.settings?.code || preset.id;
          const ctrlType = preset.settings?.ctrlType || 2; // 默认为场景模式
          const name = preset.name || '未知';
          const nameId = this.getLightModeTranslation(name);
          const nameEn = this.getLightModeTranslationForLang(name, 'en_us');
          const nameVi = this.getLightModeTranslationForLang(name, 'vi_vn');
          const icon = this.getLightIcon(code);
          const command = ctrlType === 3 ? 'light/auto' : `light/${code}`;
          const subtitleCls = 'page-subtitle text-gray-600 dark:text-gray-400 leading-tight mt-0.5 tracking-tighter indonesian-translation-tighter';

          lightButtonsHTML += `
            <button class="h-24 rounded-2xl bg-white/5 flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform" data-command="${command}" data-ctrl-type="${ctrlType}" data-code="${code}">
              <i class="fa ${icon} text-xl text-white/60"></i>
              <span class="text-xs font-bold">${name}</span>
            </button>`;
        });

        // 更新灯光按钮容器
        lightButtonsContainer.innerHTML = lightButtonsHTML;

        // 灯光按钮生成后，立即根据当前状态刷新一次UI
        try {
          const state = this.smartlService?.getState?.() || {};
          // 状态会通过 roomStateChanged 事件自动同步

          this.updateAutoLightButtonUI();
          this.updateLightModeButtonsUI();
        } catch (uiError) {
          logWarn('[SmartlUI] 刷新灯光按钮状态时出现问题:', uiError);
        }
      } catch (error) {
        logError('[SmartlUI] 生成灯光按钮失败:', error);
        const lightButtonsContainer = document.getElementById('light-buttons');
        if (lightButtonsContainer) {
          lightButtonsContainer.innerHTML = '<div class="text-center text-gray-500 py-8">加载失败，请刷新页面</div>';
        }
      }
    }
  
  /**
   * 获取灯光模式的印尼语翻译
   * @param {string} name - 灯光模式中文名称
   * @returns {string} 印尼语翻译
   */
  // 灯光模式名称到翻译键的映射（多语言共用）
  _lightNameToKeyMap = {
    '自动': 'auto', '柔和': 'soft', '明亮': 'bright', '动感': 'dynamic',
    '抒情': 'lyrical', '商务': 'business', '选秀': 'talentShow',
    '摇滚': 'rock', '浪漫': 'romantic', '全开': 'allOn', '全关': 'allOff'
  };

  getLightModeTranslation(name) {
    return this.getLightModeTranslationForLang(name, 'id_id');
  }

  getLightModeTranslationForLang(name, langCode) {
    const dict = this.langService?.translations[langCode];
    if (!dict) return this.getLightModeTranslationFallback(name);
    const key = this._lightNameToKeyMap[name];
    return (key && dict[key]) ? dict[key] : this.getLightModeTranslationFallback(name);
  }
  
  /**
   * 获取灯光模式的印尼语翻译（fallback映射表）
   * @param {string} name - 灯光模式中文名称
   * @returns {string} 印尼语翻译
   */
  getLightModeTranslationFallback(name) {
    const translationMap = {
      '自动': 'Otomatis',
      '柔和': 'Lembut',
      '明亮': 'Terang',
      '动感': 'Dinamis',
      '抒情': 'Liris',
      '商务': 'Bisnis',
      '选秀': 'Pameran Bakat',
      '摇滚': 'Rock',
      '浪漫': 'Romantis',
      '全开': 'Semua Menyala',
      '全关': 'Semua Mati',
      '未知': 'Tidak Dikenal'
    };
    
    return translationMap[name] || name;
  }
  
  /**
   * 根据灯光类型获取图标
   * @param {string} type - 灯光类型
   * @returns {string} 图标类名
   */
  getLightIcon(type) {
    const typeStr = String(type);
    const iconMap = {
      auto: 'fa-magic',
      '1': 'fa-lightbulb',   // 柔和
      '2': 'fa-sun',         // 明亮
      '3': 'fa-bolt',        // 动感
      '4': 'fa-music',       // 抒情
      '5': 'fa-briefcase',   // 商务
      '6': 'fa-microphone',  // 选秀
      '7': 'fa-guitar',      // 摇滚
      '8': 'fa-heart',       // 浪漫
      '98': 'fa-toggle-on',  // 全开
      '99': 'fa-toggle-off'  // 全关
    };
    const icon = iconMap[typeStr] || 'fa-lightbulb';
    return icon;
  }

  /**
   * 生成空调按钮
   */
  async generateAcButtons() {
    try {
      await this.initServices();
      let acDicts = null;
      if (this.smartlService && typeof this.smartlService.getDictFromCache === 'function') {
        acDicts = this.smartlService.getDictFromCache('ac');
      }
      
      if (isEmptyArray(acDicts)) {
        if (this.smartlService && typeof this.smartlService.getDict === 'function') {
          acDicts = await this.smartlService.getDict('ac');
        }
      }

      // 如果后端没配置，使用标准默认值作为兜底
      if (isEmptyArray(acDicts)) {
        logWarn('[SmartlUI] 未获取到空调字典，使用标准默认值');
        acDicts = [
          { code: 'windLowerButton', name: '低风速' },
          { code: 'windMidButton', name: '中风速' },
          { code: 'windHighButton', name: '高风速' },
          { code: 'coolButton', name: '制冷' },
          { code: 'hotButton', name: '制热' },
          { code: 'ktOpenButton', name: '开机' }
        ];
      }

      const container = document.getElementById('ac-buttons');
      if (!container) return;

      let html = '';
      acDicts.forEach(dict => {
        const code = dict.code || dict.dictValue;
        const name = dict.name || dict.dictLabel || '未知';
        const icon = this.getAcIcon(code);

        html += `
          <button class="h-24 rounded-2xl bg-white/5 flex flex-col items-center justify-center gap-2 hover:bg-white/10 active:scale-95 transition-transform"
                  data-command="consumer/clickButton/${code}">
            <i class="fa ${icon} text-xl text-white/60"></i>
            <span class="text-xs font-bold">${name}</span>
          </button>`;
      });

      container.innerHTML = html;
    } catch (error) {
      logError('[SmartlUI] 生成空调按钮失败:', error);
    }
  }

  /**
   * 获取空调图标
   */
  getAcIcon(code) {
    const map = {
      'windLowerButton': 'fa-wind',
      'windMidButton': 'fa-wind',
      'windHighButton': 'fa-wind',
      'coolButton': 'fa-snowflake',
      'hotButton': 'fa-fire',
      'ktOpenButton': 'fa-power-off'
    };
    return map[code] || 'fa-cog';
  }

  /**
   * 获取空调图标特有颜色
   */
  getAcIconColor(code) {
    // 图标颜色统一由 _updateAcUI 根据后台状态动态控制，生成时一律用默认色
    return 'text-white/60';
  }

  /**
   * 获取空调模式翻译
   */
  getAcModeTranslation(name) {
    return this.getAcModeTranslationForLang(name, 'id_id');
  }

  getAcModeTranslationForLang(name, langCode) {
    const dict = this.langService?.translations[langCode];
    if (!dict) return '';
    if (name.includes('低')) return dict['lowWindSpeed'] || '';
    if (name.includes('中')) return dict['midWindSpeed'] || '';
    if (name.includes('高')) return dict['highWindSpeed'] || '';
    if (name.includes('制冷')) return dict['cool'] || '';
    if (name.includes('制热')) return dict['heat'] || '';
    if (name.includes('电') || name.includes('开')) return dict['onOff'] || '';
    return '';
  }

  /**
   * 获取音效模式图标
   */
  getSoundEffectIcon(mode, name = '') {
    const modeKey = String(mode || '').toLowerCase();
    const nameText = String(name || '');
    const iconMap = {
      standard: 'fa-sliders-h',
      ktv: 'fa-microphone',
      pop: 'fa-headphones',
      rock: 'fa-guitar',
      concert: 'fa-music',
      theater: 'fa-film'
    };
    if (iconMap[modeKey]) return iconMap[modeKey];
    if (nameText.includes('标准')) return 'fa-sliders-h';
    if (nameText.includes('KTV')) return 'fa-microphone';
    if (nameText.includes('流行')) return 'fa-headphones';
    if (nameText.includes('摇滚')) return 'fa-guitar';
    if (nameText.includes('音乐厅')) return 'fa-music';
    if (nameText.includes('影院')) return 'fa-film';
    return 'fa-sliders-h';
  }

  /**
   * 获取音效副语言翻译
   */
  getSoundEffectTranslation(mode, name, langCode) {
    const dict = this.langService?.translations[langCode] || {};
    const modeKey = String(mode || '').toLowerCase();
    const modeMap = {
      standard: { id_id: 'Standar', en_us: 'Standard', vi_vn: 'Tiêu chuẩn' },
      ktv: { id_id: 'KTV', en_us: 'KTV', vi_vn: 'KTV' },
      pop: { id_id: 'Pop', en_us: 'Pop', vi_vn: 'Nhạc Pop' },
      rock: { id_id: 'Rock', en_us: 'Rock', vi_vn: 'Rock' },
      concert: { id_id: 'Konser', en_us: 'Concert', vi_vn: 'Hòa nhạc' },
      theater: { id_id: 'Teater', en_us: 'Theater', vi_vn: 'Rạp hát' }
    };
    if (modeMap[modeKey]?.[langCode]) {
      return modeMap[modeKey][langCode];
    }

    const nameMap = [
      { match: '标准', values: { id_id: 'Standar', en_us: 'Standard', vi_vn: 'Tiêu chuẩn' } },
      { match: 'KTV', values: { id_id: 'KTV', en_us: 'KTV', vi_vn: 'KTV' } },
      { match: '流行', values: { id_id: 'Pop', en_us: 'Pop', vi_vn: 'Nhạc Pop' } },
      { match: '摇滚', values: { id_id: 'Rock', en_us: 'Rock', vi_vn: 'Rock' } },
      { match: '音乐厅', values: { id_id: 'Konser', en_us: 'Concert', vi_vn: 'Hòa nhạc' } },
      { match: '影院', values: { id_id: 'Teater', en_us: 'Theater', vi_vn: 'Rạp hát' } }
    ];
    const matched = nameMap.find(item => String(name || '').includes(item.match));
    if (matched) return matched.values[langCode] || '';

    return dict[name] || '';
  }

  /**
   * 绑定面板事件
   * @param {string} panelId - 面板ID
   */
  bindPanelEvents(panelId) {
    
    // 尝试两个可能的面板ID（兼容性处理）
    const panel = document.getElementById(`${panelId}-panel`) || document.getElementById('smart-panel');
    if (!panel) {
      logWarn('[SmartlUI] 未找到面板元素, panelId:', panelId);
      return;
    }
    
    
    // 清理旧的监听器，避免重复绑定
    const oldHandler = this._boundEventHandlers.get(`${panelId}_panelClick`);
    if (oldHandler) {
      panel.removeEventListener('click', oldHandler);
      panel.removeEventListener('touchstart', oldHandler);
      this._boundEventHandlers.delete(`${panelId}_panelClick`);
    }
    
    
    // 绑定标签切换事件
    const tabButtons = panel.querySelectorAll('.tab-btn');
    const tabContents = panel.querySelectorAll('.tab-content');
    
    // 为每个按钮添加唯一的点击处理器（避免重复绑定）
    tabButtons.forEach((button, index) => {
      const handlerKey = `${panelId}_tabButton_${index}`;
      const oldTabHandler = this._boundEventHandlers.get(handlerKey);
      if (oldTabHandler) {
        button.removeEventListener('click', oldTabHandler);
        this._boundEventHandlers.delete(handlerKey);
      }
      
      const tabHandler = () => {
        const tabId = button.dataset.tab;
        
        // 更新按钮状态
        tabButtons.forEach(btn => {
          btn.classList.remove('bg-red-600', 'shadow-lg', 'shadow-red-500/20', 'text-white', 'is-active');
          btn.classList.add('text-gray-400');
          btn.setAttribute('aria-selected', 'false');
        });
        
        // 为当前按钮添加激活样式
        button.classList.remove('text-gray-400');
        button.classList.add('bg-red-600', 'shadow-lg', 'shadow-red-500/20', 'text-white', 'is-active');
        button.setAttribute('aria-selected', 'true');
        
        // 显示对应的内容
        tabContents.forEach(content => {
          if (content.id === `${tabId}-tab`) {
            content.classList.remove('hidden');
            // 如果是灯光面板，确保灯光按钮已生成
            if (tabId === 'light') {
              setTimeout(() => {
                const lightButtonsContainer = document.getElementById('light-buttons');
                if (lightButtonsContainer && lightButtonsContainer.children.length === 0) {
                  this.generateLightButtons();
                } else {
                }
              }, 100);
            }
            // 如果是音效面板，确保音效按钮已生成
            if (tabId === 'audio') {
              setTimeout(() => {
                const soundEffectButtonsContainer = document.getElementById('sound-effect-buttons');
                if (soundEffectButtonsContainer) {
                  if (soundEffectButtonsContainer.children.length === 0) {
                    this.renderSoundEffectButtons().catch(error => {
                      logError('[SmartlUI] renderSoundEffectButtons 执行出错:', error);
                    });
                  } else {
                    // 即使已生成，也更新一下状态
                    this.updateSoundEffectButtonsState();
                  }
                } else {
                  logError('[SmartlUI] 未找到音效按钮容器 #sound-effect-buttons');
                  // 尝试查找整个音效面板
                  const audioTab = document.getElementById('audio-tab');
                  if (audioTab) {
                  }
                }
              }, 100);
            }
          } else {
            content.classList.add('hidden');
          }
        });
      };
      
      // 绑定并保存处理器引用
      button.addEventListener('click', tabHandler);
      this._boundEventHandlers.set(handlerKey, tabHandler);
    });
    
    // 绑定命令按钮点击事件
    const handlePanelClick = async (e) => {
      // 防止事件重复处理和冲突
      if (e.__smartControlProcessed) {
        // 只有在事件可以被取消时才调用 preventDefault
        if (e.cancelable) {
          e.preventDefault();
        }
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      e.__smartControlProcessed = true;
      
      const commandBtn = e.target.closest('[data-command]');
      if (commandBtn) {
        // 阻止事件冒泡，避免与其他事件监听器冲突
        // 只有在事件可以被取消时才调用 preventDefault
        if (e.cancelable) {
          e.preventDefault();
        }
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const command = commandBtn.dataset.command;
        
        // 添加按钮点击动画效果
        if (commandBtn.classList.contains('control-btn')) {
          commandBtn.classList.add('clicked');
          setTimeout(() => {
            commandBtn.classList.remove('clicked');
          }, 300);
        }
        
        // 添加防抖处理，避免快速点击造成的闪烁
        const now = Date.now();
        if (this._lastClickTime && now - this._lastClickTime < 150) {
          // 清除事件标记
          setTimeout(() => {
            delete e.__smartControlProcessed;
          }, 0);
          return;
        }
        this._lastClickTime = now;
        
        // 检查是否是温度控制命令
        if (command === 'consumer/clickButton/temAddButton' || command === 'consumer/clickButton/temMinusButton') {
          // 处理温度变化命令
          const action = command === 'consumer/clickButton/temAddButton' ? 'temp-up' : 'temp-down';
          await this.handleTemperatureChange(action);
        } else {
          // 自动灯光按钮：切换开关状态（独立状态，不影响场景选择）
          if (command === 'light/auto') {
            if (this.smartlService) {
              const currentState = this.smartlService.getState();
              const newAutoState = !currentState.isAutoLightOn;
              
              // 乐观更新UI（不清除场景选择）
              this.smartlService.updateState({ 
                isAutoLightOn: newAutoState
              });
              this.updateAutoLightButtonUI();
              
              // 无论开启还是关闭，都发送命令到后端
              // 开启时发送 "auto"，关闭时发送 "manual" 表示手动模式
              const sceneValue = newAutoState ? 'auto' : 'manual';
              const lightCommand = newAutoState ? command : 'light/manual';
              await this.handleCommand(lightCommand);
            }
          }
          // 灯光场景按钮点击：本地乐观更新选中态并立即高亮，随后发送命令（不影响自动按钮状态）
          else if (command && command.startsWith('light/') && command !== 'light/auto') {
            if (this.smartlService) {
              this.smartlService.updateState({ 
                selectedLightMode: command
                // 不修改 isAutoLightOn，保持自动按钮的独立状态
              });
            }
            this.updateLightModeButtonsUI();
            // 不需要更新自动按钮UI，因为它的状态没有改变
            await this.handleCommand(command);
          }
          // 其他命令
          else {
            await this.handleCommand(command);
          }
        }
      }
      
      // 音量控制
      const volumeBtn = e.target.closest('[data-volume]');
      if (volumeBtn) {
        if (e.cancelable) {
          e.preventDefault();
        }
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // 立即添加按钮点击动画效果（确保所有音量按钮都有动画）
        if (volumeBtn.classList.contains('volume-btn-control')) {
          // 清除之前的动画定时器，避免快速点击导致状态混乱
          const existingTimeout = this._volumeButtonTimeouts.get(volumeBtn);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
            this._volumeButtonTimeouts.delete(volumeBtn);
          }
          
          // 确保按钮处于正常状态（移除可能残留的 clicked 类）
          volumeBtn.classList.remove('clicked');
          
          // 使用 requestAnimationFrame 确保 DOM 更新后再添加动画
          requestAnimationFrame(() => {
            volumeBtn.classList.add('clicked');
            const timeoutId = setTimeout(() => {
              volumeBtn.classList.remove('clicked');
              this._volumeButtonTimeouts.delete(volumeBtn);
            }, 300);
            this._volumeButtonTimeouts.set(volumeBtn, timeoutId);
          });
        }
        
        await this.handleVolumeChange(volumeBtn.dataset.volume);
      }
      
      // 清除事件标记
      setTimeout(() => {
        delete e.__smartControlProcessed;
      }, 0);
    };
    
    // 添加跨平台事件监听（iOS/Android/PC兼容）
    panel.addEventListener('click', handlePanelClick, { passive: false });
    // 触摸支持：改为在 touchend 处理，避免 touchstart 阻塞滚动
    panel.addEventListener('touchend', handlePanelClick, { passive: false });
    // 保存处理器引用，以便下次清理
    this._boundEventHandlers.set(`${panelId}_panelClick`, handlePanelClick);
    
    // 绑定关闭按钮事件
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) {
      const closeBtnHandler = () => {
        // 触发面板关闭事件
        document.dispatchEvent(new CustomEvent('closePanel', {
          detail: { panelId }
        }));
      };
      closeBtn.addEventListener('click', closeBtnHandler);
      this._boundEventHandlers.set(`${panelId}_closeBtn`, closeBtnHandler);
    }
  }
  
  /**
   * 处理命令
   * @param {string} command - 命令
   */
  async handleCommand(command) {
    if (this._processingCommand) return;
    this._processingCommand = command;
    const lockTimeout = setTimeout(() => { this._processingCommand = null; }, 5000);

    const commandBtn = document.querySelector(`[data-command="${command}"]`);

    try {
      await this.initServices();

      if (commandBtn) {
        commandBtn.classList.add('clicked');
        setTimeout(() => commandBtn.classList.remove('clicked'), 300);
      }

      // 空调按钮：直接调 controlAc API，用返回值更新 UI
      if (command.startsWith('consumer/clickButton/')) {
        const s = this.smartlService?.state ?? {};
        let power = s.power ?? true;
        let temp  = s.temp  ?? 26;
        let mode  = s.mode  ?? 'cool';
        let wind  = s.wind  ?? 'low';

        switch (command.replace('consumer/clickButton/', '')) {
          case 'ktOpenButton':    power = !s.power;  break;  // toggle 开关
          case 'ktCloseButton':   power = false;     break;
          case 'coolButton':      mode  = 'cool'; break;
          case 'hotButton':       mode  = 'heat'; break;
          case 'windLowerButton': wind  = 'low';  break;
          case 'windMidButton':   wind  = 'mid';  break;
          case 'windHighButton':  wind  = 'high'; break;
        }

        const res = await window.apiService.controlAc({ power, temp, mode, wind });
        if (res?.code === 0 && res.data?.ac) {
          const ac = res.data.ac;
          if (this.smartlService) {
            this.smartlService.state.power = ac.power ?? power;
            this.smartlService.state.temp  = ac.temp  ?? temp;
            this.smartlService.state.mode  = ac.mode  ?? mode;
            this.smartlService.state.wind  = ac.wind  ?? wind;
          }
          this._updateAcUI(this.smartlService?.state ?? { power, temp, mode, wind });
        }
        return;
      }

      if (!this.smartlService) throw new Error('smartlService 未初始化');

      const api = window.apiService;
      let result;
      switch (command) {
        case 'repeat':
          result = await api.replay();
          break;
        case 'pause':
          result = await api.pause();
          break;
        case 'play':
        case 'resume':
          result = await api.play();
          break;
        case 'next':
          result = await api.playNext();
          break;
        case 'original':
          result = await api.switchTrack(1);
          break;
        case 'vocal':
          result = await api.switchTrack(0);
          break;
        case 'mute':
        case 'unmute':
          result = await this.smartlService.handleAudioControlCommand(command);
          break;
        case 'audio/effect/cycle':
          result = await this.smartlService.handleSoundEffectCommand(command);
          this.updateSoundEffectButtonsState();
          break;
        default:
          if (command.startsWith('light/')) {
            result = await this.smartlService.lightingService.handleLightCommand(command);
          } else if (command.startsWith('effect/')) {
            const mode = command.split('/')[1];
            result = await api.controlEffect({ mode });
            if (this.smartlService) this.smartlService.state.soundEffectMode = mode;
            this.updateSoundEffectButtonsState();
          } else {
            logWarn('SmartlUI', `未知命令: ${command}`);
          }
      }
      if (result?.data) this.smartlService.syncStateFromServer(result.data);
      if (typeof this.updateButtonStates === 'function') this.updateButtonStates();

    } catch (error) {
      logError('SmartlUI', `命令 ${command} 执行失败:`, error);
      const raw = error?.message || '';
      const msg = (error?.name === 'NetworkError' || raw.includes('fetch') || raw.includes('网络请求失败'))
        ? '网络异常或服务未就绪，请稍后重试'
        : (raw || '播控操作失败');
      window.toastService?.showToast?.(msg, 'error', 2000);
    } finally {
      clearTimeout(lockTimeout);
      this._processingCommand = null;
    }
  }

  /** 根据空调状态更新 UI */
  _updateAcUI(ac) {
    const tempEl = document.querySelector('#ac-tab .text-3xl.font-black')
      || document.querySelector('#ac-tab .page-subtitle.font-bold');
    if (tempEl) tempEl.textContent = `${ac.temp}°C`;

    const acTab = document.getElementById('ac-tab');
    if (!acTab) return;

    const powerBtn = acTab.querySelector('[data-command="consumer/clickButton/ktOpenButton"], [data-command="consumer/clickButton/ktCloseButton"]');
    if (powerBtn) {
      const icon = powerBtn.querySelector('i');
      if (icon) icon.style.color = ac.power ? '#4ade80' : '';
    }

    const coolBtn = acTab.querySelector('[data-command="consumer/clickButton/coolButton"]');
    const hotBtn  = acTab.querySelector('[data-command="consumer/clickButton/hotButton"]');
    if (coolBtn) { const i = coolBtn.querySelector('i'); if (i) i.style.color = ac.mode === 'cool' ? '#60a5fa' : ''; }
    if (hotBtn)  { const i = hotBtn.querySelector('i');  if (i) i.style.color = ac.mode === 'heat' ? '#fb923c' : ''; }

    const windMap = { low: 'windLowerButton', mid: 'windMidButton', high: 'windHighButton' };
    Object.entries(windMap).forEach(([w, cmd]) => {
      const btn = acTab.querySelector(`[data-command="consumer/clickButton/${cmd}"]`);
      if (btn) {
        const icon = btn.querySelector('i');
        if (icon) icon.style.color = ac.wind === w ? '#60a5fa' : '';
      }
    });
  }
  async handleVolumeChange(action) {
    try {
      
      // 确保服务已初始化
      await this.initServices();
      
      // 确保服务已初始化且可用
      if (!this.smartlService) {
        throw new Error('smartlService 未初始化，无法处理音量变化');
      }
      
      // 注意：按钮点击动画效果已在 bindPanelEvents 中处理，这里不再重复添加
      
      // 处理音量变化
      const result = await this.smartlService.handleVolumeChange(action);
      
      // API 返回后立即刷新 UI（WS 也会触发二次刷新，但不应依赖 WS 作为唯一更新路径）
      this.updateAllUI();
    } catch (error) {
      logError('SmartlUI', `音量操作 ${action} 执行失败:`, error);
      const raw = (error && error.message) ? error.message : '';
      const msg = (error && error.name === 'NetworkError') || (raw && (raw.includes('fetch') || raw.includes('网络请求失败')))
        ? '网络异常或服务未就绪，请稍后重试'
        : (raw || '音量操作失败');
      if (typeof window !== 'undefined' && window.toastService && typeof window.toastService.showToast === 'function') {
        window.toastService.showToast(msg, 'error', 2000);
      }
    }
  }

  /**
   * 处理温度变化
   * @param {string} action - 温度操作
   */
  async handleTemperatureChange(action) {
    try {
      await this.initServices();

      const currentTemp = (this.smartlService?.state?.temp) ?? 26;
      const newTemp = action === 'temp-up'
        ? Math.min(32, currentTemp + 1)
        : Math.max(16, currentTemp - 1);

      const res = await window.apiService.controlAc({
        temp: newTemp,
        power: this.smartlService?.state?.power ?? true,
        mode: this.smartlService?.state?.mode ?? 'cool',
        wind: this.smartlService?.state?.wind ?? 'low',
      });

      const actualTemp = res?.data?.ac?.temp ?? newTemp;
      if (this.smartlService) this.smartlService.state.temp = actualTemp;

      const tempDisplay = document.querySelector('#ac-tab .page-subtitle.font-bold.text-gray-800')
        || document.querySelector('#ac-tab .text-3xl.font-black');
      if (tempDisplay) tempDisplay.textContent = `${actualTemp}°C`;

    } catch (error) {
      logError(`温度操作 ${action} 失败:`, error);
    }
  }
  
  /**
   * 更新温度显示
   */
  updateTemperatureDisplay() {
    // 确保服务已初始化
    if (!this.smartlService) return;
    
    // 获取当前状态
    const state = this.smartlService.getState();
    
    // 更新温度显示
    const tempDisplay = document.querySelector('#ac-tab .page-subtitle.font-bold.text-gray-800');
    if (tempDisplay) {
      tempDisplay.textContent = `${state.temp}°C`;
    } else {
      logWarn('[SmartlUI] 未找到温度显示元素');
    }
  }
  
  /**
   * 更新音量显示
   * @param {string} action - 音量操作
   */
  updateVolumeDisplay(action) {
    // 确保服务已初始化
    if (!this.smartlService) return;
    
    // 获取当前状态
    const state = this.smartlService.getState();
    
    // 更新音乐音量显示
    const musicVolume = document.getElementById('music-volume');
    const musicProgress = document.getElementById('music-progress');
    if (musicVolume) {
      musicVolume.textContent = state.volume;
    }
    if (musicProgress) {
      DomUtils.setProgressWidth(musicProgress, state.volume);
    } else if (this._isPanelVisible()) {
      logWarn('[SmartlUI] 未找到音乐进度条元素 #music-progress');
    }
    
    // 更新麦克风音量显示
    const micVolume = document.getElementById('mic-volume');
    const micProgress = document.getElementById('mic-progress');
    if (micVolume) {
      micVolume.textContent = state.micVolume;
    }
    if (micProgress) {
      DomUtils.setProgressWidth(micProgress, state.micVolume);
    } else if (this._isPanelVisible()) {
      logWarn('[SmartlUI] 未找到麦克风进度条元素 #mic-progress');
    }
    
    // 更新底部音量进度条（调用BottomNavUI的方法）
    if (window.bottomNavUI && typeof window.bottomNavUI.updateVolumeDisplay === 'function') {
      window.bottomNavUI.updateVolumeDisplay(state.volume);
    }
    
    // 更新按钮状态
    this.updateButtonStates();
  }
  
  /**
   * 同步初始状态（从后端获取最新状态）
   */
  async syncInitialState() {
    try {
      
      // 确保服务已初始化
      await this.initServices();
      
      if (!this.smartlService) {
        logWarn('[SmartlUI] smartlService 未初始化，无法同步状态');
        return;
      }
      
      if (!window.apiService) {
        logWarn('[SmartlUI] apiService 未初始化，无法同步状态');
        return;
      }
      
      // 直接从 API 获取最新状态（不依赖 WebSocket 缓存）
      const roomId = window.apiService.roomId || 'current';

      try {
        const response = await window.apiService.get(`/api/v1/rooms/${roomId}/state`);
        
        if (response && response.data) {

          // 同步到 SmartlService
          this.smartlService.syncStateFromServer(response.data);
          
          const currentState = this.smartlService.getState();

        } else {
          logWarn('[SmartlUI] API 未返回数据');
        }
      } catch (apiError) {
        logError('[SmartlUI] API 请求失败:', apiError);
        
        // API 失败时，尝试使用 WebSocket 缓存
        if (window.WebSocketClient) {
          const cachedState = window.WebSocketClient.getInitialState?.();
          if (cachedState) {

            this.smartlService.syncStateFromServer(cachedState);
          }
        }
      }
    } catch (error) {
      logError('[SmartlUI] 同步初始状态失败:', error);
    }
  }
  
  /**
   * 初始化WebSocket状态同步
   */
  initWebSocketSync() {
    // 如果已经初始化，先清理
    if (this._wsSyncInitialized) {
      this.cleanupWebSocketListeners();
    }
    
    const setupListeners = () => {
      if (!window.WebSocketClient) return;
      
      // 存储所有取消订阅函数以便清理
      this._wsUnbinds = [];
      
      // 1. 监听服务状态变更事件 (由 SmartlService 解析 WS 消息后触发)
      // 这确保了 UI 刷新时使用的是已经同步到 service 的最新状态，避免了竞态条件
      if (this.smartlService && typeof this.smartlService.on === 'function') {
        const stateChangeHandler = () => {
          this.updateAllUI();
        };
        this.smartlService.on('stateChange', stateChangeHandler);
        this._wsUnbinds.push(() => {
          if (this.smartlService && typeof this.smartlService.off === 'function') {
            this.smartlService.off('stateChange', stateChangeHandler);
          }
        });
      }
      
      // 2. 监听重连成功事件
      const connectedUnbind = window.WebSocketClient.on('connected', () => {
        // 重连后可能需要重新同步
        if (this.smartlService && typeof this.smartlService.syncInitialState === 'function') {
           this.smartlService.syncInitialState().catch(() => {});
        }
      });
      this._wsUnbinds.push(connectedUnbind);
      
      this._wsSyncInitialized = true;
    };
    
    if (window.WebSocketClient) {
      setupListeners();
    } else {
      window.addEventListener('websocketClientReady', setupListeners, { once: true });
    }
  }

  /**
   * 清理WebSocket监听器
   */
  cleanupWebSocketListeners() {
    if (Array.isArray(this._wsUnbinds)) {
      this._wsUnbinds.forEach(unbind => {
        if (typeof unbind === 'function') unbind();
      });
      this._wsUnbinds = [];
    }
    this._wsSyncInitialized = false;

  }
  
  
  /**
   * 获取并缓存面板内的 DOM 元素，避免每次 updateButtonStates 重复查询
   */
  _getDomCache() {
    const panel = document.getElementById('smart-panel') || document.querySelector('.smartl-panel');
    // 面板不存在或已更换时重建缓存
    if (!panel || this._domCache?._panel !== panel) {
      if (!panel) return null;
      this._domCache = {
        _panel: panel,
        playButtons: document.querySelectorAll('[data-command="pause"], [data-command="resume"]'),
        vocalButtons: document.querySelectorAll('[data-command="original"], [data-command="vocal"]'),
        windLow: panel.querySelector('[data-command="consumer/clickButton/windLowerButton"]'),
        windMid: panel.querySelector('[data-command="consumer/clickButton/windMidButton"]'),
        windHigh: panel.querySelector('[data-command="consumer/clickButton/windHighButton"]'),
        coolBtn: panel.querySelector('[data-command="consumer/clickButton/coolButton"]'),
        heatBtn: panel.querySelector('[data-command="consumer/clickButton/hotButton"]'),
        powerBtn: panel.querySelector('[data-command="consumer/clickButton/ktOpenButton"], [data-command="consumer/clickButton/ktCloseButton"]'),
      };
    }
    // 播放/原唱按钮 data-command 会动态变化，每次重新查
    this._domCache.playButtons = document.querySelectorAll('[data-command="pause"], [data-command="resume"]');
    this._domCache.vocalButtons = document.querySelectorAll('[data-command="original"], [data-command="vocal"]');
    this._domCache.powerBtn = panel.querySelector('[data-command="consumer/clickButton/ktOpenButton"], [data-command="consumer/clickButton/ktCloseButton"]');
    return this._domCache;
  }

  /**
   * 更新所有UI显示（RAF防抖，同一帧内多次调用只执行一次）
   */
  updateAllUI() {
    if (this._updateButtonsRaf) return;
    this._updateButtonsRaf = requestAnimationFrame(() => {
      this._updateButtonsRaf = null;
      this._doUpdateAllUI();
    });
  }

  _doUpdateAllUI() {

    // 更新音量显示

    this.updateVolumeDisplay('music');

    this.updateVolumeDisplay('mic');
    
    // 更新温度显示

    const tempDisplay = document.querySelector('#ac-tab .page-subtitle.font-bold.text-gray-800');
    if (tempDisplay) {
      const state = this.smartlService.getState();
      tempDisplay.textContent = `${state.temp}°C`;

    } else if (this._isPanelVisible()) {
      logWarn('[SmartlUI] 未找到温度显示元素');
    }

    // 更新按钮状态（除了灯光相关按钮）
    this.updateButtonStates();
    
    // 更新自动灯光按钮UI

    this.updateAutoLightButtonUI();
    
    // 更新灯光模式按钮UI

    this.updateLightModeButtonsUI();
    
    // 更新音效按钮UI

    this.updateSoundEffectUI();
    
    // 渲染音效按钮网格（延迟执行，确保面板已渲染）
    // 注意：updateAllUI 可能在面板创建之前被调用，所以这里不直接渲染
    // 音效按钮会在面板创建完成或切换到音频标签时渲染
  }

  /**
   * 更新按钮状态（使用缓存的 DOM 引用，减少全局扫描）
   */
  updateButtonStates() {
    // 确保服务已初始化
    if (!this.smartlService) return;
    
    const state = this.smartlService.getState();
    const cache = this._getDomCache();

    // 更新播放/暂停按钮（可能存在于底部导航栏和智控面板中）
    const playButtons = cache
      ? cache.playButtons
      : document.querySelectorAll('[data-command="pause"], [data-command="resume"]');
    if (playButtons.length > 0) {
      const isPlaying = state.isPlaying === true;
      const targetCommand = isPlaying ? 'pause' : 'resume';
      
      playButtons.forEach(playBtn => {
        playBtn.dataset.command = targetCommand;
        const icon = playBtn.querySelector('i');
        // 只选择非印尼语翻译的span元素
        const text = playBtn.querySelector('span:not(.indonesian-translation)');
        const idText = playBtn.querySelector('span.indonesian-translation');
        if (icon) {
          // 检查按钮是否在底部导航栏中，底部导航栏的图标应该保持白色
          const isInBottomNav = playBtn.closest('#bottom-nav');
          if (isInBottomNav) {
            // 底部导航栏：只更新图标类型，保持白色（从父元素继承）
            icon.className = `fa ${isPlaying ? 'fa-pause' : 'fa-play'}`;
          } else {
            // 智控面板：使用原来的样式
            icon.className = `page-button-icon fa ${isPlaying ? 'fa-pause' : 'fa-play'} mb-1 text-white/60 leading-tight`;
          }
        }
        if (text) {
          text.textContent = isPlaying ? '暂停' : '播放';
        }
        // 更新印尼语翻译
        if (idText && this.langService && this.langService.translations['id_id']) {
          idText.textContent = isPlaying ? this.langService.translations['id_id']['pause'] : this.langService.translations['id_id']['play'];
        }
      });
    }
    
    // 更新原唱/伴唱按钮（可能存在于底部导航栏和智控面板中）
    const vocalButtons = cache
      ? cache.vocalButtons
      : document.querySelectorAll('[data-command="original"], [data-command="vocal"]');
    if (vocalButtons.length > 0) {
      const isOriginal = state.isOriginal === true;
      const targetCommand = isOriginal ? 'vocal' : 'original';
      
      vocalButtons.forEach(vocalBtn => {
        vocalBtn.dataset.command = targetCommand;
        const icon = vocalBtn.querySelector('i');
        // 只选择非印尼语翻译的span元素
        const text = vocalBtn.querySelector('span:not(.indonesian-translation)');
        const idText = vocalBtn.querySelector('span.indonesian-translation');
        if (icon) {
          // 检查按钮是否在底部导航栏中，底部导航栏的图标应该保持白色
          const isInBottomNav = vocalBtn.closest('#bottom-nav');
          if (isInBottomNav) {
            // 底部导航栏：只更新图标类型，保持白色（从父元素继承）
            icon.className = `fa ${isOriginal ? 'fa-microphone' : 'fa-music'}`;
          } else {
            // 智控面板：使用原来的样式
            icon.className = `page-button-icon fa ${isOriginal ? 'fa-microphone' : 'fa-music'} mb-1 text-white/60 leading-tight`;
          }
        }
        if (text) {
          text.textContent = isOriginal ? '伴唱' : '原唱';
        }
        // 更新印尼语翻译
        if (idText && this.langService && this.langService.translations['id_id']) {
          idText.textContent = isOriginal ? this.langService.translations['id_id']['vocal'] : this.langService.translations['id_id']['origin'];
        }
      });
    }
    
    // 更新风速按钮
    // 空调按钮高亮：只改图标颜色，背景和文字不变，委托给 _updateAcUI
    this._updateAcUI(state);
    
    // 更新静音按钮（底部导航栏 + 面板内）
    const muteButtons = document.querySelectorAll('[data-command="mute"], [data-command="unmute"]');
    if (muteButtons.length > 0) {
      const isMuted = state.isMuted === true;
      const langService = window.langService;
      const getLangText = (lang, key) => langService?.translations?.[lang]?.[key] || null;
      const muteKey = isMuted ? 'unmute' : 'mute';
      const zhText = getLangText('zh_cn', muteKey) || (isMuted ? '取消静音' : '静音');
      const idText = getLangText('id_id', muteKey) || (isMuted ? 'Buka bisukan' : 'Bisukan');
      const enText = getLangText('en_us', muteKey) || (isMuted ? 'Unmute' : 'Mute');
      const viText = getLangText('vi_vn', muteKey) || (isMuted ? 'Bật tiếng' : 'Tắt tiếng');

      muteButtons.forEach(btn => {
        btn.dataset.command = isMuted ? 'unmute' : 'mute';
        btn.classList.toggle('muted', isMuted);
        const icon = btn.querySelector('i');
        if (icon) {
          const isInBottomNav = btn.closest('#bottom-nav');
          if (isInBottomNav) {
            icon.className = `fa ${isMuted ? 'fa-volume-off' : 'fa-volume-up'}`;
          } else {
            icon.className = `page-button-icon fa ${isMuted ? 'fa-volume-off' : 'fa-volume-up'} mb-1 text-white/60 leading-tight`;
          }
        }
        const zhSpan = btn.querySelector('.zh-label');
        const idSpan = btn.querySelector('.indonesian-translation');
        const enSpan = btn.querySelector('.en-translation');
        const viSpan = btn.querySelector('.vi-translation');
        if (zhSpan) zhSpan.textContent = zhText;
        if (idSpan) idSpan.textContent = idText;
        if (enSpan) enSpan.textContent = enText;
        if (viSpan) viSpan.textContent = viText;
      });
    }

    // 不在此处调用灯光或音效的UI更新，保持按需更新
  }
  
  /**
   * 更新空调开关按钮UI
   */
  updatePowerButtonUI(state) {
    const powerBtn = document.querySelector('[data-command="consumer/clickButton/ktOpenButton"], [data-command="consumer/clickButton/ktCloseButton"]');
    if (!powerBtn) return;
    
    const targetCommand = state.power ? 'consumer/clickButton/ktCloseButton' : 'consumer/clickButton/ktOpenButton';
    powerBtn.dataset.command = targetCommand;
    
    const icon = powerBtn.querySelector('i');
    const text = powerBtn.querySelector('span');
    if (icon) {
      // 修复颜色逻辑：开机状态显示灰色，关机状态显示绿色
      icon.className = `page-button-icon fa fa-power-off mb-2 ${state.power ? 'text-white/60' : 'text-green-500 dark:text-green-400'}`;
    }
    if (text) {
      text.textContent = state.power ? '关机' : '开机';
      // 根据开关状态改变文字颜色，保持背景色不变
      if (state.power) {
        text.classList.remove('text-green-500', 'dark:text-green-400');
        text.classList.add('text-white/60');
      } else {
        text.classList.remove('text-white/60');
        text.classList.add('text-green-500', 'dark:text-green-400');
      }
    }
  }
  
  /**
   * 更新温度按钮UI
   */
  updateTempButtonUI(state) {
    const tempBtn = document.querySelector('[data-command^="consumer/clickButton/ktTempButton"]');
    if (!tempBtn) return;
    
    const targetCommand = `consumer/clickButton/ktTempButton/${state.temp}`;
    tempBtn.dataset.command = targetCommand;
    
    const icon = tempBtn.querySelector('i');
    const text = tempBtn.querySelector('span');
    if (icon) {
      icon.className = `page-button-icon fa fa-thermometer-half mb-2 ${state.power ? 'text-green-500 dark:text-green-400' : 'text-white/60'}`;
    }
    if (text) {
      text.textContent = `${state.temp}°C`;
      // 根据开关状态改变文字颜色，保持背景色不变
      if (state.power) {
        text.classList.remove('text-white/60');
        text.classList.add('text-green-500', 'dark:text-green-400');
      } else {
        text.classList.remove('text-green-500', 'dark:text-green-400');
        text.classList.add('text-white/60');
      }
    }
  }
  
  /**
   * 更新风扇按钮UI
   */
  updateFanButtonUI(state) {
    const fanBtn = document.querySelector('[data-command^="consumer/clickButton/ktFanButton"]');
    if (!fanBtn) return;
    
    const targetCommand = `consumer/clickButton/ktFanButton/${state.fan}`;
    fanBtn.dataset.command = targetCommand;
    
    const icon = fanBtn.querySelector('i');
    const text = fanBtn.querySelector('span');
    if (icon) {
      icon.className = `page-button-icon fa fa-fan mb-2 ${state.power ? 'text-green-500 dark:text-green-400' : 'text-white/60'}`;
    }
    if (text) {
      text.textContent = state.fan;
      // 根据开关状态改变文字颜色，保持背景色不变
      if (state.power) {
        text.classList.remove('text-white/60');
        text.classList.add('text-green-500', 'dark:text-green-400');
      } else {
        text.classList.remove('text-green-500', 'dark:text-green-400');
        text.classList.add('text-white/60');
      }
    }
  }
  
  /**
   * 更新模式按钮UI
   */
  updateModeButtonUI(state) {
    const modeBtn = document.querySelector('[data-command^="consumer/clickButton/ktModeButton"]');
    if (!modeBtn) return;
    
    const targetCommand = `consumer/clickButton/ktModeButton/${state.mode}`;
    modeBtn.dataset.command = targetCommand;
    
    const icon = modeBtn.querySelector('i');
    const text = modeBtn.querySelector('span');
    if (icon) {
      icon.className = `page-button-icon fa fa-sun mb-2 ${state.power ? 'text-green-500 dark:text-green-400' : 'text-white/60'}`;
    }
    if (text) {
      text.textContent = state.mode;
      // 根据开关状态改变文字颜色，保持背景色不变
      if (state.power) {
        text.classList.remove('text-white/60');
        text.classList.add('text-green-500', 'dark:text-green-400');
      } else {
        text.classList.remove('text-green-500', 'dark:text-green-400');
        text.classList.add('text-white/60');
      }
    }
  }
  
  /**
   * 更新摆风按钮UI
   */
  updateSwingButtonUI(state) {
    const swingBtn = document.querySelector('[data-command^="consumer/clickButton/ktSwingButton"]');
    if (!swingBtn) return;
    
    const targetCommand = `consumer/clickButton/ktSwingButton/${state.swing}`;
    swingBtn.dataset.command = targetCommand;
    
    const icon = swingBtn.querySelector('i');
    const text = swingBtn.querySelector('span');
    if (icon) {
      icon.className = `page-button-icon fa fa-arrows-alt-v mb-2 ${state.power ? 'text-green-500 dark:text-green-400' : 'text-white/60'}`;
    }
    if (text) {
      text.textContent = state.swing;
      // 根据开关状态改变文字颜色，保持背景色不变
      if (state.power) {
        text.classList.remove('text-white/60');
        text.classList.add('text-green-500', 'dark:text-green-400');
      } else {
        text.classList.remove('text-green-500', 'dark:text-green-400');
        text.classList.add('text-white/60');
      }
    }
  }
  
  /**
   * 更新UI
   */
  updateUI(state) {
    this.updateAutoLightButtonUI();
    this.updatePowerButtonUI(state);
    this.updateTempButtonUI(state);
    this.updateFanButtonUI(state);
    this.updateModeButtonUI(state);
    this.updateSwingButtonUI(state);
  }
  
  /**
   * 初始化UI
   */
  initUI() {
    // 注意：自动按钮的点击事件已在 bindPanelEvents 中统一处理，这里不再重复绑定
    // const autoBtn = document.querySelector('#light-buttons button[data-command="light/auto"]');
    
    const powerBtn = document.querySelector('[data-command="consumer/clickButton/ktOpenButton"], [data-command="consumer/clickButton/ktCloseButton"]');
    const tempBtn = document.querySelector('[data-command^="consumer/clickButton/ktTempButton"]');
    const fanBtn = document.querySelector('[data-command^="consumer/clickButton/ktFanButton"]');
    const modeBtn = document.querySelector('[data-command^="consumer/clickButton/ktModeButton"]');
    const swingBtn = document.querySelector('[data-command^="consumer/clickButton/ktSwingButton"]');
    
    // 自动按钮已在 bindPanelEvents 中处理，不需要单独绑定
    // if (autoBtn) {
    //   autoBtn.addEventListener('click', () => {
    //     const isAutoLightOn = !autoBtn.classList.contains('bg-red-500');
    //     this.updateAutoLightButtonUI({ isAutoLightOn });
    //     // 发送命令的逻辑应该在这里添加
    //   });
    // }
    
    if (powerBtn) {
      powerBtn.addEventListener('click', () => {
        const power = !powerBtn.classList.contains('bg-green-500');
        this.updatePowerButtonUI({ power });
        // 发送命令的逻辑应该在这里添加
      });
    }
    
    if (tempBtn) {
      tempBtn.addEventListener('click', () => {
        const currentTemp = parseInt(tempBtn.querySelector('span').textContent, 10);
        const newTemp = (currentTemp === 30) ? 16 : currentTemp + 1;
        this.updateTempButtonUI({ power: true, temp: newTemp });
        // 发送命令的逻辑应该在这里添加
      });
    }
    
    if (fanBtn) {
      fanBtn.addEventListener('click', () => {
        const currentFan = fanBtn.querySelector('span').textContent;
        const newFan = (currentFan === '3') ? '1' : (parseInt(currentFan, 10) + 1).toString();
        this.updateFanButtonUI({ power: true, fan: newFan });
        // 发送命令的逻辑应该在这里添加
      });
    }
    
    if (modeBtn) {
      modeBtn.addEventListener('click', () => {
        const currentMode = modeBtn.querySelector('span').textContent;
        const modes = ['制冷', '制热', '除湿', '送风'];
        const currentModeIndex = modes.indexOf(currentMode);
        const newMode = modes[(currentModeIndex + 1) % modes.length];
        this.updateModeButtonUI({ power: true, mode: newMode });
        // 发送命令的逻辑应该在这里添加
      });
    }
    
    if (swingBtn) {
      swingBtn.addEventListener('click', () => {
        const currentSwing = swingBtn.querySelector('span').textContent;
        const swings = ['上下', '停止'];
        const currentSwingIndex = swings.indexOf(currentSwing);
        const newSwing = swings[(currentSwingIndex + 1) % swings.length];
        this.updateSwingButtonUI({ power: true, swing: newSwing });
        // 发送命令的逻辑应该在这里添加
      });
    }
  }
  
  /**
   * 更新灯光模式按钮UI
   */
  updateLightModeButtonsUI() {
    // 确保服务已初始化
    if (!this.smartlService) return;
    
    const state = this.smartlService.getState();
    // 减少不必要的详细日志输出，只在开发环境中输出详细信息
    this._logDev('[SmartlUI] 更新灯光模式按钮UI，当前状态', state);
    this._logDev('[SmartlUI] 当前选中的灯光模式', state.selectedLightMode);
    
    // 获取所有灯光按钮（除了自动按钮）
    const lightButtons = document.querySelectorAll('#light-buttons button[data-command^="light/"]:not([data-command="light/auto"])');
    // 减少不必要的详细日志输出，只在开发环境中输出详细信息
    this._logDev('[SmartlUI] 找到灯光按钮数量:', lightButtons.length);
    
    lightButtons.forEach((btn, index) => {
      const command = btn.dataset.command;
      const isSelected = state.selectedLightMode === command;
      
      // 减少不必要的详细日志输出，只在开发环境中输出详细信息
      this._logDev(`[SmartlUI] 检查按钮 ${index}: command=${command}, isSelected=${isSelected}`);
      
      const icon = btn.querySelector('i');
      const textSpan = btn.querySelector('span:not(.indonesian-translation)');
      const idText = btn.querySelector('span.indonesian-translation');
      
      // 重置按钮到默认状态（未选中保持灰色背景和 hover 灰色）
      btn.classList.remove('bg-red-500', 'text-white');
      btn.classList.add('bg-white/5');
      // 确保未选中态保持 hover 灰色效果
      btn.classList.add('hover:bg-white/10');
      
      if (icon) {
        icon.classList.remove('text-white');
        icon.classList.add('text-white/60');
      }
      if (textSpan) {
        textSpan.classList.remove('text-white');
        textSpan.classList.add('text-white/60');
      }
      // 更新印尼语翻译文本颜色
      if (idText) {
        idText.classList.remove('text-white');
        idText.classList.add('text-gray-600', 'dark:text-gray-400');
        // 清除内联样式，恢复默认颜色
        idText.style.removeProperty('color');
      }
      
      if (isSelected) {
        // 选中的按钮：去掉灰色背景和 hover 灰色，改为红底白字（hover 也保持红色）
        this._logDev(`[SmartlUI] 激活按钮: ${command}`);
        btn.classList.remove('bg-white/5');
        btn.classList.add('bg-red-500', 'text-white');
        // 移除会覆盖激活背景的 hover 灰色类
        btn.classList.remove('hover:bg-white/10');
        // 可选：为激活态添加 hover 红色，确保悬停仍为红色
        btn.classList.add('hover:bg-red-500', 'dark:hover:bg-red-500');
        
        if (icon) {
          icon.classList.remove('text-white/60');
          icon.classList.add('text-white');
        }
        if (textSpan) {
          textSpan.classList.remove('text-white/60');
          textSpan.classList.add('text-white');
        }
        // 选中时，印尼语翻译文本颜色也改为白色，确保在红色背景上清晰可见
        if (idText) {
          idText.classList.remove('text-gray-600', 'dark:text-gray-400');
          idText.classList.add('text-white', 'text-white-important');
        }
      }
    });
  }
  
  /**
   * 更新自动灯光按钮UI
   */
  updateAutoLightButtonUI() {
    // 确保服务已初始化
    if (!this.smartlService) return;
    
    const state = this.smartlService.getState();

    // 减少不必要的详细日志输出，只在开发环境中输出详细信息
    this._logDev('[SmartlUI] 更新自动灯光按钮UI，当前状态', state);
    
    // 查找自动灯光按钮
    const autoBtn = document.querySelector('#light-buttons button[data-command="light/auto"]');
    if (!autoBtn) {
      if (this._isPanelVisible()) {
        logWarn('[SmartlUI] 未找到自动灯光按钮');
      }
      return;
    }
    
    // 先移除已有的红点
    autoBtn.querySelectorAll('.auto-dot').forEach(dot => dot.remove());
    
    const icon = autoBtn.querySelector('i');
    // 只选择中文文字的span，不包括印尼语翻译
    const textSpan = autoBtn.querySelector('span.page-button');
    
    // 确保状态字段存在
    const isAutoLightOn = state.isAutoLightOn === true || state.autoLightState === 1;

    // 重置按钮到默认状态
    autoBtn.classList.remove('bg-red-500', 'text-red-500', 'dark:text-red-400');
    autoBtn.classList.add('bg-white/5');
    
    if (icon) {
      icon.classList.remove('text-red-500', 'dark:text-red-400', 'text-white');
      icon.classList.add('text-white/60');
      // 清除可能的内联颜色，恢复默认
      icon.style.color = '';
    }
    if (textSpan) {
      textSpan.classList.remove('text-red-500', 'dark:text-red-400', 'text-white');
      textSpan.classList.add('text-white/60');
      // 清除可能的内联颜色，恢复默认
      textSpan.style.color = '';
    }
    
    if (isAutoLightOn) {
      // 开启自动灯光时：保持灰色背景，只有图标变红色，文字保持灰色
      // 不改变背景色，以区分场景按钮（场景按钮是红色背景）      
      // 添加红点
      const dot = document.createElement('span');
      dot.className = 'auto-dot absolute top-2 left-2 w-1.5 h-1.5 bg-red-500 rounded-full z-1000';
      autoBtn.style.position = 'relative';
      autoBtn.appendChild(dot);
      
      // 只改变图标颜色为红色
      if (icon) {
        icon.classList.remove('text-white/60');
        icon.classList.add('text-red-500', 'dark:text-red-400');
      }
      // 文字保持灰色，不改变

    } else {

    }
    // 根据状态切换选中态高亮环
    autoBtn.classList.toggle('active', isAutoLightOn);
    // 同步专用类以便CSS覆盖颜色
    autoBtn.classList.toggle('auto-on', isAutoLightOn);
    
    // 减少不必要的详细日志输出，只在开发环境中输出详细信息
    this._logDev('[SmartlUI] 自动灯光按钮UI更新完成，状态', isAutoLightOn);
  }
  
  /**
   * 更新音效按钮UI
   */
  async updateSoundEffectUI() {
    if (!this.smartlService) return;
    
    const state = this.smartlService.getState();
    const effectBtn = document.querySelector('#audio-buttons button[data-command="audio/effect/cycle"]');
    if (!effectBtn) return;
    
    try {
      const effectName = await this.getSoundEffectName(state.soundEffectMode);

      const textSpans = effectBtn.querySelectorAll('span');
      if (textSpans.length > 0 && effectName) {
        textSpans[0].textContent = effectName;
      }
      
      effectBtn.querySelectorAll('.sound-effect-dot').forEach(dot => dot.remove());
      
      if (state.soundEffectMode) {
        const dot = document.createElement('span');
        dot.className = 'sound-effect-dot absolute top-2 left-2 w-1.5 h-1.5 bg-red-500 rounded-full z-1000';
        effectBtn.style.position = 'relative';
        effectBtn.appendChild(dot);
      }
      
      this.updateSoundEffectButtonsState();
    } catch (error) {
      logError('[SmartlUI] 更新音效按钮UI失败:', error);
    }
  }
  
  /**
   * 获取音效名称
   * @param {string} mode - 音效模式字符串 (standard/ktv/concert/theater)
   * @returns {Promise<string>} 音效名称
   */
  async getSoundEffectName(mode) {
    try {
      await this.initServices();
      const soundEffects = await this.smartlService.getDict('soundEffect');
      if (Array.isArray(soundEffects) && soundEffects.length > 0) {
        const effect = soundEffects.find(item => item.code === mode || item.mode === mode);
        if (effect && effect.name) return effect.name;
      }
      return '';
    } catch (error) {
      logError('[SmartlUI] 获取音效名称失败:', error);
      return '';
    }
  }

  /**
   * 渲染音效按钮网格（4个按钮）
   */
  /**
     * 渲染音效按钮网格（4个按钮）
     */
    async renderSoundEffectButtons() {

      try {

        // 确保服务已初始化
        await this.initServices();

        // 获取音效按钮容器
        let container = document.getElementById('sound-effect-buttons');
        if (!container) {
          await new Promise(resolve => setTimeout(resolve, 50));
          container = document.getElementById('sound-effect-buttons');
        }

        if (!container) {
          logError('[SmartlUI] 未找到音效按钮容器 #sound-effect-buttons');
          return;
        }

        // 从后端获取音效预设（使用新的 peripheral_presets API）
        const response = await window.apiService.getPeripheralPresets('effect');
        const soundEffects = response?.data || [];

        // 清空容器
        container.innerHTML = '';

        // 如果数据为空，显示提示
        if (!Array.isArray(soundEffects) || soundEffects.length === 0) {
          logWarn('[SmartlUI] 音效数据为空');
          container.innerHTML = '<div class="col-span-4 text-center text-gray-500 dark:text-gray-400 page-label py-2">暂无音效数据</div>';
          return;
        }

        // 按 sortOrder 排序
        const sortedEffects = soundEffects
          .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
          .slice(0, 8); // 最多显示8个
        // 确保副语言翻译已加载
        const langCodes = ['id_id', 'en_us', 'vi_vn'];
        await Promise.all(langCodes.map(code =>
          (this.langService && !this.langService.translations[code])
            ? this.langService.loadLanguageFile(code).catch(() => {})
            : Promise.resolve()
        ));
        // 渲染按钮
        sortedEffects.forEach((preset, index) => {
          const effectMode = preset.settings?.mode || '';
          const effectCode = effectMode || preset.id;
          const effectName = preset.name || '未知';
          const effectIcon = this.getSoundEffectIcon(effectMode, effectName);

          const button = document.createElement('button');
          button.className = 'h-24 rounded-2xl bg-white/5 flex flex-col items-center justify-center gap-2 hover:bg-white/10 active:scale-95 transition-transform sound-effect-btn';
          button.setAttribute('data-sound-effect', effectCode);
          button.setAttribute('data-command', `effect/${effectCode}`);
          button.setAttribute('data-label-cn', effectName);

          button.innerHTML = `
            <i class="fa ${effectIcon} text-xl text-white/60"></i>
            <span class="text-xs font-bold">${effectName}</span>
          `;

          container.appendChild(button);
        });

      } catch (error) {
        logError('[SmartlUI] 渲染音效按钮失败:', error);
        const container = document.getElementById('sound-effect-buttons');
        if (container) {
          container.innerHTML = '<div class="col-span-4 text-center text-gray-500 dark:text-gray-400 page-label py-2">加载失败</div>';
        }
      }
    }

  /**
   * 更新音效按钮的激活状态
   */
  updateSoundEffectButtonsState() {
    const buttons = document.querySelectorAll('.sound-effect-btn');
    const state = this.smartlService ? this.smartlService.getState() : null;
    const currentMode = String(state?.soundEffectMode || '').toLowerCase();

    buttons.forEach(button => {
      const effectCode = String(button.getAttribute('data-sound-effect') || '').toLowerCase();
      const isActive = effectCode === currentMode;

      const icon = button.querySelector('i');
      const textSpan = button.querySelector('span:not(.indonesian-translation)');
      const translationSpans = button.querySelectorAll('span.indonesian-translation, span.en-translation, span.vi-translation');
      
      // 重置按钮到默认状态 - 移除所有可能的激活样式
      button.classList.remove('bg-red-500', 'bg-red-50', 'dark:bg-red-900', 'text-white', 'ring-2', 'ring-red-500');
      button.classList.add('bg-white/5');
      button.classList.add('hover:bg-white/10');
      
      if (icon) {
        icon.classList.remove('text-white');
        icon.classList.add('text-white/60');
      }
      if (textSpan) {
        textSpan.classList.remove('text-white');
        textSpan.classList.add('text-white/60');
      }
      translationSpans.forEach(span => {
        span.classList.remove('text-white');
        span.classList.add('text-gray-600', 'dark:text-gray-400');
      });
      
      // 添加激活样式 - 与灯光和空调按钮保持一致
      if (isActive) {

        button.classList.remove('bg-white/5');
        button.classList.add('bg-red-500', 'text-white');
        button.classList.remove('hover:bg-white/10');
        button.classList.add('hover:bg-red-500', 'dark:hover:bg-red-500');
        
        if (icon) {
          icon.classList.remove('text-white/60');
          icon.classList.add('text-white');
        }
        if (textSpan) {
          textSpan.classList.remove('text-white/60');
          textSpan.classList.add('text-white');
        }
        translationSpans.forEach(span => {
          span.classList.remove('text-gray-600', 'dark:text-gray-400');
          span.classList.add('text-white');
        });
      }
    });
  }
}

// 创建并导出导航控制UI实例
const smartlUI = new SmartlUI();
export default smartlUI;
