// 延迟导入，避免循环依赖
import DomUtils from '../../utils/DomUtils.js';
import { BottomPanelPositionManager } from '../../utils/BottomPanelPositionManager.js';
import { logInfo, logWarn, logError } from '../../utils/Logger.js';
let smartlUI;
let displayUI;
let selectedUI;
let langService;

/**
 * 导航已选歌曲业务逻辑
 */
class BottomNavUI {
  constructor() {
    // 在需要时动态导入服务
    this.currentOpenPanel = null;
    // WebSocket取消订阅函数
    this.wsUnsubscribe = null;
    // 键盘状态
    this._keyboardOpen = false;
    this._keyboardListenersBound = false;
    // 键盘监听器引用（用于清理）
    this._keyboardListeners = {
      onViewportChange: null,
      onWindowResize: null,
      onFocusIn: null,
      onFocusOut: null
    };
    this._pendingVolume = null;
    this._volumeRaf = null;
    this._volumeButtonTimeouts = new Map(); // 存储每个音量按钮的动画定时器引用
    this._volumeStateUnbind = null;
    this._initialVolumeSyncPromise = null;
    this.PANEL_SELECTOR = '.premium-panel-base';
    
    // 监听面板关闭事件（由各 UI 模块触发）
    document.addEventListener('closePanel', (e) => {
      this.closePanel(e.detail.panelId);
    });
  }
  
  /**
   * 初始化服务
   */
  async initServices() {
    // 防止重复初始化
    if (this._initServicesPromise) {
      return this._initServicesPromise;
    }
    
    this._initServicesPromise = (async () => {
      // 优先从全局获取已预加载的模块（最快，无阻塞）
      if (typeof window !== 'undefined') {
        if (!smartlUI && window.smartlUI) {
          smartlUI = window.smartlUI;
        }
        if (!displayUI && window.displayUI) {
          displayUI = window.displayUI;
        }
        if (!selectedUI && window.selectedUI) {
          selectedUI = window.selectedUI;
        }
        if (!langService && window.langService) {
          langService = window.langService;
        }
      }
      
      // 如果全局没有，从 moduleLoader 缓存获取（应该已预加载）
      const moduleLoader = (typeof window !== 'undefined' && window.moduleLoader) 
        ? window.moduleLoader 
        : null;
      
      if (moduleLoader) {
        // 直接从缓存获取（应该已预加载，无需等待）
        if (!smartlUI && moduleLoader._modules.has('smartlUI')) {
          smartlUI = moduleLoader._modules.get('smartlUI');
        }
        if (!displayUI && moduleLoader._modules.has('displayUI')) {
          displayUI = moduleLoader._modules.get('displayUI');
        }
        if (!selectedUI && moduleLoader._modules.has('navSelectedUI')) {
          selectedUI = moduleLoader._modules.get('navSelectedUI');
        }
        
        // 如果缓存中没有，尝试加载（降级方案）
        if (!smartlUI) {
          try {
            smartlUI = await moduleLoader.load('smartlUI');
            if (smartlUI && typeof window !== 'undefined') {
              window.smartlUI = smartlUI;
            }
          } catch (e) {
            logWarn('BottomNavUI', '加载 smartlUI 失败:', e);
          }
        }
      }

      // 确保子模块内部的服务也初始化完成（打通初始化链路）
      if (smartlUI && typeof smartlUI.initServices === 'function') {
        try {
          await smartlUI.initServices();
        } catch (e) {
          logWarn('BottomNavUI', '智能控制服务初始化失败:', e);
        }
      }
      
      // langService 是同步加载的，优先从 window 获取
      if (!langService && typeof window !== 'undefined' && window.langService) {
        langService = window.langService;
      }
      
      // 如果全局变量不存在，且模块加载器可用，尝试获取（降级方案）
      if (!langService && moduleLoader && typeof moduleLoader.load === 'function') {
        try {
          // 注意：避免在这里 import index.js，以防循环依赖导致死锁
          const services = typeof window !== 'undefined' ? window : {};
          if (services.langService) {
            langService = services.langService;
          }
        } catch (e) {}
      }
      
      this.langService = langService;
    })();
    
    return this._initServicesPromise;
  }

  /**
   * 渲染底部导航栏
   * @param {Array} items - 导航项列表
   */
  async renderBottomNav(items) {
    // 确保语言服务已初始化，便于初始渲染即使用翻译
    try {
      if (!this.langService) {
        await this.initServices();
        // 确保语言服务已初始化
        if (this.langService && !this.langService.translations['zh_cn']) {
          await this.langService.init();
        }
      }
      // 加载副语言翻译文件
      const langCodes = ['id_id', 'en_us', 'vi_vn'];
      await Promise.all(langCodes.map(code =>
        (this.langService && !this.langService.translations[code])
          ? this.langService.loadLanguageFile(code).catch(() => {})
          : Promise.resolve()
      ));
    } catch (e) {
      logWarn('BottomNavUI', '初始化服务失败:', e);
    }
    
    // 创建底部导航栏元素
    const navElement = document.createElement('footer');
    navElement.id = 'bottom-nav';
    navElement.className = 'fixed bottom-0 left-0 right-0 z-[10005] premium-nav-base';
    // 默认导航项
    const defaultItems = [
      { id: 'smart', icon: 'fa-magic', text: '控制', langKey: 'smartControl' },
      { id: 'scene', icon: 'fa-image', text: '场景', langKey: 'scene' }
    ];
    
    // 使用传入的items或默认items
    const navItems = items || defaultItems;
    
    const muteCnText = this.langService && typeof this.langService.t === 'function'
      ? (this.langService.t('mute') || '静音')
      : '静音';
    const idT = this.langService?.translations['id_id'] || {};
    const enT = this.langService?.translations['en_us'] || {};
    const viT = this.langService?.translations['vi_vn'] || {};
    const muteIdText = idT['mute'] || 'Bisukan';
    const muteEnText = enT['mute'] || 'Mute';
    const muteViText = viT['mute'] || 'Tắt tiếng';
    
    // 构建导航栏HTML - 新布局：左侧30% | 中间40% | 右侧30%
    let navHTML = '<div class="bottom-nav-grid w-full relative">';
    
    // === 左侧区域：30% - 控制、画面、重唱 ===
    navHTML += `<div class="flex items-end justify-start left-button-area">`;
    navItems.forEach(item => {
      const labelText = this.langService ? this.langService.t(item.langKey) : item.text;
      navHTML += `
        <button data-panel="${item.id}" class="control-btn smart-strip-btn">
          <div class="rounded-full">
            <i class="fa ${item.icon}"></i>
          </div>
          <span class="zh-label" data-lang-key="${item.langKey}">${labelText}</span>
          <span class="indonesian-translation">${idT[item.langKey] || ''}</span>
          <span class="en-translation">${enT[item.langKey] || ''}</span>
          <span class="vi-translation">${viT[item.langKey] || ''}</span>
        </button>`;
    });
    // 重唱按钮
    navHTML += `
      <button data-command="repeat" aria-label="重唱" class="control-btn smart-strip-btn">
        <div class="rounded-full">
          <i class="fa fa-repeat"></i>
        </div>
        <span class="zh-label">重唱</span>
        <span class="indonesian-translation">${idT['repeat'] || 'Ulang'}</span>
        <span class="en-translation">${enT['repeat'] || 'Repeat'}</span>
        <span class="vi-translation">${viT['repeat'] || 'Hát lại'}</span>
      </button>`;
    navHTML += '</div>';
    
    // === 中间区域：40% - 音量进度图片铺满，音量-靠左，音量+靠右 ===
    navHTML += `<div id="volume-center-area">`;
    
    // 音量控制统一容器 - 包含所有音量相关元素
    navHTML += `
      <div id="volume-control-container">
        
        <!-- 音量背景图片容器 - 背景层 -->
        <div id="volume-background-container">
          <img decoding="async" src="./assets/images/bg-vol.png" alt="音量背景" class="volume-bg-img">
          <img decoding="async" src="./assets/images/vol.png" alt="音量图标" class="volume-fg-img">
        </div>
        
        <!-- 音量减按钮 - 前景层 -->
        <button data-volume="music-down" aria-label="音乐音量减" class="volume-btn volume-down-btn">
          <img decoding="async" src="./assets/images/bg-vol-.png" alt="音量减">
        </button>
        
        <!-- 静音按钮 - 前景层 -->
        <button data-command="mute" aria-label="静音/非静音" class="volume-btn mute-btn"
          data-label-cn="${muteCnText}"
          data-label-id="${muteIdText}">
          <i class="fa fa-volume-up"></i>
          <span class="mute-volume-value">0</span>
          <span class="zh-label">${muteCnText}</span>
          <span class="indonesian-translation">${muteIdText}</span>
          <span class="en-translation">${muteEnText}</span>
          <span class="vi-translation">${muteViText}</span>
        </button>
        
        <!-- 音量加按钮 - 前景层 -->
        <button data-volume="music-up" aria-label="音乐音量加" class="volume-btn volume-up-btn">
          <img decoding="async" src="./assets/images/bg-vol+.png" alt="音量加">
        </button>
        
      </div>`;
    
    navHTML += '</div>';
    
    // === 右侧区域：30% - 伴唱、播放、切歌 ===
    navHTML += `<div class="flex items-end justify-end right-button-area">`;
    // 伴唱按钮
    navHTML += `
      <button data-command="vocal" aria-label="原唱/伴唱" class="control-btn smart-strip-btn">
        <div class="rounded-full">
          <i class="fa fa-microphone"></i>
        </div>
        <span class="zh-label">伴唱</span>
        <span class="indonesian-translation">${idT['vocal'] || 'Vokal'}</span>
        <span class="en-translation">${enT['vocal'] || 'Vocal'}</span>
        <span class="vi-translation">${viT['vocal'] || 'Hát cùng'}</span>
      </button>`;
    // 播放按钮
    navHTML += `
      <button data-command="pause" aria-label="播放/暂停" class="control-btn smart-strip-btn">
        <div class="rounded-full">
          <i class="fa fa-pause"></i>
        </div>
        <span class="zh-label">暂停</span>
        <span class="indonesian-translation">${idT['pause'] || 'Jeda'}</span>
        <span class="en-translation">${enT['pause'] || 'Pause'}</span>
        <span class="vi-translation">${viT['pause'] || 'Tạm dừng'}</span>
      </button>`;
    // 切歌按钮
    navHTML += `
      <button data-command="next" aria-label="切歌" class="control-btn smart-strip-btn">
        <div class="rounded-full">
          <i class="fa fa-forward"></i>
        </div>
        <span class="zh-label">切歌</span>
        <span class="indonesian-translation">${idT['next'] || 'Lanjut'}</span>
        <span class="en-translation">${enT['next'] || 'Next'}</span>
        <span class="vi-translation">${viT['next'] || 'Bài tiếp'}</span>
      </button>`;
    navHTML += '</div>';
    
    // 关闭父容器
    navHTML += '</div>';
     
     navElement.innerHTML = navHTML;
     
     // 添加到页面
     document.body.appendChild(navElement);
     
     // 绑定事件
     this.bindNavEvents();

     // 绑定智控快捷控制条事件
     this.bindSmartControlStripEvents();
     
     // 静音按钮单独绑定直接监听器（按钮突出导航栏上方，事件委托无法捕获）
     this._bindMuteButtonDirect();

    // 初始化智控状态同步（即使未打开智控面板也能更新按钮文案/图标）
    try {
       await this.initServices();
       if (smartlUI && typeof smartlUI.initWebSocketSync === 'function') {
         smartlUI.initWebSocketSync();
       }
    } catch (e) {
       logWarn('BottomNavUI', '初始化智控状态同步失败:', e);
    }
    
    // 首次渲染后，等待所有资源加载完成和CSS计算稳定后，更新底部导航栏高度缓存
    // 确保在统一时机计算，保证不同分辨率下的一致性和准确性
     DomUtils.waitForNavResourcesReady(navElement).then(() => {
        // 更新导航栏高度缓存（直接使用 offsetHeight，简单准确）
        BottomPanelPositionManager.updateNavHeightCache(navElement);
        // 首次渲染后，尝试调整所有面板的底部避让高度
        try { this.adjustAllPanelsBottom(); } catch(_) {}
      }).catch(e => {
      logWarn('BottomNavUI', '等待导航栏资源加载失败:', e);
      // 即使失败也尝试更新高度缓存
      BottomPanelPositionManager.updateNavHeightCache(navElement);
    });
     
    // 监听语言变化并更新导航标签（防止重复绑定）
    if (this.langService) {
      // 如果已绑定，先清理旧的监听器
      if (this.languageObserver) {
        this.langService.removeObserver?.(this.languageObserver);
      }
      if (this.globalLanguageListener) {
        document.removeEventListener('languageChanged', this.globalLanguageListener);
      }
      
      // 使用箭头函数保存this上下文
      this.languageObserver = (lang) => {
        this.updateNavLabels();
      };
      
      this.langService.addObserver(this.languageObserver);
      
      // 监听全局语言变化事件
      this.globalLanguageListener = (event) => {
        this.updateNavLabels();
      };
      
      document.addEventListener('languageChanged', this.globalLanguageListener);
    }

    // 监听面板关闭事件（防止重复绑定）
    if (!this._closePanelHandler) {
      this._closePanelHandler = (e) => {
        this.closePanel(e.detail.panelId);
      };
      document.addEventListener('closePanel', this._closePanelHandler);
    }
     
    // 初始化音量状态同步（避免直接订阅旧 WebSocket 事件）
    this.bindVolumeStateListener();
    this.syncInitialVolumeFromApi();
 
    // 初始化音量显示
    this.initVolumeDisplay();
    Promise.resolve().then(() => this.preloadVolumeImages());

  }

  /**
   * 更新导航项状态
   * @param {string} itemId - 导航项ID
   * @param {Object} status - 状态信息
   */
  updateNavItemStatus(itemId, status) {
    // 实现导航项状态更新逻辑

  }

  /**
   * 绑定导航相关事件
   */
  bindNavEvents() {
    // 绑定底部导航按钮点击事件
    const navElement = document.getElementById('bottom-nav');
    if (!navElement) {
      logWarn('未找到底部导航栏元素');
      return;
    }
    
    // 避免重复绑定：检查是否已绑定
    if (navElement.dataset.navEventsBound === 'true') {
      return;
    }
    
    // 使用事件委托，避免为每个按钮单独绑定监听器，提升性能
    const clickHandler = (e) => {
      // 使用 [data-panel] 选择器匹配按钮，因为按钮类名是 control-btn smart-strip-btn
      const btn = e.target.closest('[data-panel]');
      if (!btn) return;
      
      if (e.cancelable) {
        e.preventDefault();
      }
      const panelId = btn.dataset.panel;

      // 切换面板
      this.togglePanel(panelId);
    };
    
    // 保存处理函数引用，用于后续清理
    navElement._navClickHandler = clickHandler;
    navElement.addEventListener('click', clickHandler);
    
    navElement.dataset.navEventsBound = 'true';

  }

  /**
   * 静音按钮全局监听（通过坐标命中检测，绕过所有上层元素的 pointer-events 拦截）
   */
  _bindMuteButtonDirect() {
    const getMuteBtn = () => document.querySelector('#bottom-nav .mute-btn');

    const isHit = (x, y) => {
      const btn = getMuteBtn();
      if (!btn) return false;
      const rect = btn.getBoundingClientRect();
      // 进一步收窄点击判定范围：左右各内缩 5px，上下内缩 2px，只保留中间最窄区域
      const paddingX = 5;
      const paddingY = 2;
      return (
        x >= rect.left + paddingX && 
        x <= rect.right - paddingX && 
        y >= rect.top + paddingY && 
        y <= rect.bottom - paddingY
      );
    };

    // 根据API返回的房间状态直接更新静音按钮UI
    const applyMuteState = (isMuted) => {
      const btn = getMuteBtn();
      if (!btn) return;
      // 切换命令（下次点击用）
      btn.dataset.command = isMuted ? 'unmute' : 'mute';
      // 切换 muted 类名（驱动红色样式）
      btn.classList.toggle('muted', isMuted);
      // 切换图标
      const icon = btn.querySelector('i');
      if (icon) icon.className = `fa ${isMuted ? 'fa-volume-off' : 'fa-volume-up'}`;
      // 切换文字（多语言）
      const ls = window.langService;
      const key = isMuted ? 'unmute' : 'mute';
      const zh = ls?.translations?.zh_cn?.[key] || (isMuted ? '取消静音' : '静音');
      const id = ls?.translations?.id_id?.[key] || (isMuted ? 'Buka bisukan' : 'Bisukan');
      const en = ls?.translations?.en_us?.[key] || (isMuted ? 'Unmute' : 'Mute');
      const vi = ls?.translations?.vi_vn?.[key] || (isMuted ? 'Bật tiếng' : 'Tắt tiếng');
      const zhSpan = btn.querySelector('.zh-label');
      const idSpan = btn.querySelector('.indonesian-translation');
      const enSpan = btn.querySelector('.en-translation');
      const viSpan = btn.querySelector('.vi-translation');
      if (zhSpan) zhSpan.textContent = zh;
      if (idSpan) idSpan.textContent = id;
      if (enSpan) enSpan.textContent = en;
      if (viSpan) viSpan.textContent = vi;
    };

    const fireMute = async () => {
      const now = Date.now();
      if (this._lastMuteTime && (now - this._lastMuteTime < 600)) return;
      this._lastMuteTime = now;

      await this.initServices();
      // 在 PC 端，smartlService 依附在 smartlUI 对象上
      const service = smartlUI?.smartlService;
      if (!service) {
        logWarn('BottomNavUI', 'smartlService 未就绪，无法通过按钮操作静效');
        return;
      }

      const btn = getMuteBtn();
      const command = btn?.dataset.command || 'mute';

      try {
        // 统一使用 shared 层的业务逻辑，确保 _volumeBeforeMute 状态全系统同步
        const res = await service.handleAudioControlCommand(command);
        if (res && res.code === 0 && res.data) {
          applyMuteState(res.data.mute === true);
        }
      } catch (err) {
        // silent
      }
    };

    // pointerup 在所有平台可靠触发
    document.addEventListener('pointerup', (e) => {
      if (isHit(e.clientX, e.clientY)) {
        e.stopImmediatePropagation();
        fireMute();
      }
    }, { capture: true });

    // touchend 作为真实触摸设备备用
    document.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (t && isHit(t.clientX, t.clientY)) {
        e.stopImmediatePropagation();
        if (e.cancelable) e.preventDefault();
        fireMute();
      }
    }, { capture: true, passive: false });
  }

  /**
   * 绑定智控快捷控制条事件
   */
  bindSmartControlStripEvents() {
    const navElement = document.getElementById('bottom-nav');
    if (!navElement) return;

    const handler = async (e) => {
      // 防止事件重复处理和冲突 (click 和 touchend 穿透)
      // 使用实例属性记录最后处理时间，防止 300ms 内的重复触发
      const now = Date.now();
      if (this._lastNavActionTime && (now - this._lastNavActionTime < 300)) {
        return;
      }
      
      const cmdBtn = e.target.closest('[data-command]');
      const volBtn = e.target.closest('[data-volume]');

      // 过滤掉静音按钮：它由 _bindMuteButtonDirect 独立处理，避免双重触发冲突
      if (cmdBtn && cmdBtn.classList.contains('mute-btn')) return;

      if (!cmdBtn && !volBtn) return;
      
      this._lastNavActionTime = now;
      // 只有在事件可以被取消时才调用 preventDefault
      if (e.cancelable) {
        e.preventDefault();
      }
      e.stopPropagation();
      
      // 添加图标闪烁效果（针对重唱、伴唱、原唱、暂停、播放、切歌按钮）
      const flashColor = '#00f6c5';
      const targetBtn = cmdBtn || volBtn;
      if (cmdBtn) {
        const command = cmdBtn.getAttribute('data-command');
        const flashCommands = [
          'repeat', 'vocal', 'original', 'pause', 'resume', 'next'
        ];
        
        if (flashCommands.includes(command)) {
          const icon = cmdBtn.querySelector('i');
          if (icon) {
            // 使用 CSS 类替代内联样式
            icon.classList.add('icon-flash-color');
            // 300ms后恢复
            setTimeout(() => {
              icon.classList.remove('icon-flash-color');
            }, 300);
          }
        }
      }
      
      try {
        await this.initServices();
        
        // 确保 smartlUI 已加载（如果 initServices 没有加载，尝试手动加载）
        let smartlUI = window.smartlUI;
        if (!smartlUI) {
          if (typeof window !== 'undefined' && window.moduleLoader) {
            smartlUI = await window.moduleLoader.load('smartlUI');
            if (smartlUI && typeof window !== 'undefined') {
              window.smartlUI = smartlUI;
            }
          }
        }
        
        if (cmdBtn && smartlUI && typeof smartlUI.handleCommand === 'function') {
          const command = cmdBtn.getAttribute('data-command');
          await smartlUI.handleCommand(command);
        } else if (cmdBtn && !smartlUI) {
          logError('BottomNavUI', 'smartlUI 未初始化，无法执行命令');
          if (typeof window !== 'undefined' && window.toastService && typeof window.toastService.showToast === 'function') {
            window.toastService.showToast('控制未就绪，请稍后再试', 'warning', 2000);
          }
        }
        
        if (volBtn && smartlUI && typeof smartlUI.handleVolumeChange === 'function') {
          const action = volBtn.getAttribute('data-volume');
          await smartlUI.handleVolumeChange(action);
          
          // 如果是音量控制按钮，尝试更新音量显示
          if (smartlUI && smartlUI.smartlService) {
            // 使用smartlService获取当前音量
            const state = smartlUI.smartlService.getState();
            const currentVolume = state.volume || 0;
            this.updateVolumeDisplay(currentVolume);
          }
        } else if (volBtn && !smartlUI) {
          logError('BottomNavUI', 'smartlUI 未初始化，无法处理音量变化');
          if (typeof window !== 'undefined' && window.toastService && typeof window.toastService.showToast === 'function') {
            window.toastService.showToast('控制未就绪，请稍后再试', 'warning', 2000);
          }
        }
        // 点击动画
        const src = cmdBtn || volBtn;
        
        // 如果是音量按钮，添加特殊点击效果
        if (volBtn) {
          const volumeImg = volBtn.querySelector('img');
          if (volumeImg) {
            // 清除之前的动画定时器，避免快速点击导致状态混乱
            const existingTimeout = this._volumeButtonTimeouts.get(volBtn);
            if (existingTimeout) {
              clearTimeout(existingTimeout);
              this._volumeButtonTimeouts.delete(volBtn);
            }
            
            const action = volBtn.getAttribute('data-volume');
            // 原始图片路径（带 bg- 前缀）
            const originalSrc = action === 'music-down'
              ? './assets/images/bg-vol-.png'
              : './assets/images/bg-vol+.png';
            // 效果图片路径（不带 bg- 前缀）
            const effectSrc = action === 'music-down'
              ? './assets/images/vol-.png'
              : './assets/images/vol+.png';
            
            // 使用 requestAnimationFrame 确保 DOM 更新后再改变图片
            requestAnimationFrame(() => {
              volumeImg.src = effectSrc;
              const timeoutId = setTimeout(() => {
                // 恢复原始图片源（确保总是恢复到原始图片，而不是可能的效果图）
                volumeImg.src = originalSrc;
                this._volumeButtonTimeouts.delete(volBtn);
              }, 200);
              this._volumeButtonTimeouts.set(volBtn, timeoutId);
            });
          }
        }
        
        // 普通按钮点击动画
        const animBtn = src && src.classList && src.classList.contains('control-btn') ? src : src?.querySelector?.('.control-btn');
        if (animBtn) {
          animBtn.classList.add('clicked');
          setTimeout(() => animBtn.classList.remove('clicked'), 200);
        }
        // 操作后尝试更新底部按钮UI（依赖SmartlUI的状态）
        if (smartlUI && typeof smartlUI.updateButtonStates === 'function') {
          smartlUI.updateButtonStates();
        }
      } catch (err) {
        logWarn('BottomNavUI', '智控快捷控制条事件处理失败:', err);
      }
    };

    navElement.addEventListener('click', handler, { passive: false });
    // 触摸支持：统一使用 touchend 或 click 处理，避免 touchstart 阻塞滚动
    navElement.addEventListener('touchend', handler, { passive: false });
  }
  
  /**
   * 切换面板显示状态
   * @param {string} panelId - 面板ID
   */
  async togglePanel(panelId) {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    
    let panel = document.getElementById(`${panelId}-panel`);
    
    // 如果目标面板已经打开，则关闭它
    if (panel && !panel.classList.contains('hidden')) {
      await this.closePanel(panelId);
      return;
    }
    
    // 若当前有其他面板处于打开状态，先关闭它
    if (this.currentOpenPanel && this.currentOpenPanel !== panelId) {
      this.closePanel(this.currentOpenPanel);
    }
    
    // 若面板尚未创建，或已选面板存在但尚未填充内容（HTML 预置空壳），则创建/填充
    const needsCreate = !panel || (panelId === 'selected' && panel && !panel.querySelector(this.PANEL_SELECTOR));
    if (needsCreate) {
      // 并行初始化服务和创建面板
      await this.initServices();
      await this.createPanel(panelId);
      panel = document.getElementById(`${panelId}-panel`);
    }
    
    if (!panel) {
      logWarn(`[BottomNavUI] 面板 ${panelId} 创建失败，无法显示`);
      return;
    }
    
    // 先显示面板，再异步刷新数据（不阻塞UI）
    await this.showPanel(panelId, panel);
    
    // 如果是已选面板且已创建，显示后再异步同步服务器数据
    if (panelId === 'selected') {
      if (!this._initServicesPromise) this.initServices();
      if (selectedUI && typeof selectedUI.refreshSelectedList === 'function') {
        selectedUI.refreshSelectedList('selected').catch(() => {});
      }
    }
    
    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const ms = Math.round(t1 - t0);
    try {
      const ls = (typeof window !== 'undefined' && window.logService) ? window.logService : null;
      if (ls && typeof ls.info === 'function') ls.info(`[Perf] ${panelId}面板打开耗时${ms}ms`);
      else logInfo(`[Perf] ${panelId}面板打开耗时${ms}ms`);
    } catch(_) {}
    }
  
  /**
   * 面板内容选择器常量
   */
  PANEL_SELECTOR = '.premium-panel-base';
  
  /**
   * 生成面板HTML内容
   * @param {string} title - 面板标题
   * @param {string} content - 面板内容
   * @returns {string} 面板HTML字符串
   */
  generatePanelHTML(title, content) {
    return `
      <div id="${title}-overlay" class="fixed inset-0 bg-black/50 opacity-0 transition-opacity duration-300"></div>
      <div class="premium-panel-base panel-content-container panel-hidden fixed left-0 right-0 h-[70vh] overflow-hidden text-white">
        <div class="w-12 h-1.5 bg-white/20 rounded-full mx-auto mt-3 mb-1"></div>
        <div class="flex justify-between items-center mb-4 px-6 pt-2">
          <h3 class="text-xl font-bold">${title}</h3>
          <button class="control-btn w-10 h-10 flex items-center justify-center bg-white/5 rounded-full text-white/60 hover:text-white transition-colors close-panel-btn">
            <i class="fa fa-times"></i>
          </button>
        </div>
        <div class="px-6 py-4">
          ${content}
        </div>
      </div>`;
  }
  
  /**
   * 安全调整面板底部位置
   * @param {string} panelId - 面板ID
   */
  safeAdjustPanelBottom(panelId) {
    try { 
      this.adjustPanelBottom(panelId, true); 
    } catch(_) {}
  }
  
  /**
   * 创建面板
   * @param {string} panelId - 面板ID
   */
  async createPanel(panelId) {
    // 确保服务已初始化
    await this.initServices();
    
    // 检查面板是否已存在（已选面板在HTML中已存在）
    let panel = document.getElementById(`${panelId}-panel`);
    
    if (!panel) {
      // 创建面板元素
      panel = document.createElement('div');
      panel.id = `${panelId}-panel`;
      panel.className = 'fixed inset-0 z-[10004] hidden';
      
      // 添加基础面板结构（不包含遮罩层）
      const basePanelContent = this.generatePanelHTML('加载中...', '<p class="text-gray-500 dark:text-gray-400">正在加载内容...</p>');
      
      panel.innerHTML = basePanelContent;
      document.body.appendChild(panel);
    } else {
      // 如果面板已存在，确保它有正确的类名
      panel.className = 'fixed inset-0 z-[10004] hidden';
    }
    
    // 创建后按当前导航高度调整底部避让
    this.safeAdjustPanelBottom(panelId);
    
    // 绑定基础关闭事件
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closePanel(panelId);
      });
    }
    
    // 根据面板类型调用对应的模块来创建内容
    try {
      // 确保模块已加载
      const moduleLoader = (typeof window !== 'undefined' && window.moduleLoader) 
        ? window.moduleLoader 
        : null;
      
      switch (panelId) {
        case 'smart':
          // 优先从全局获取（已预加载）
          if (!smartlUI && typeof window !== 'undefined' && window.smartlUI) {
            smartlUI = window.smartlUI;
          }
          // 从缓存获取（应该已预加载）
          if (!smartlUI && moduleLoader && moduleLoader._modules.has('smartlUI')) {
            smartlUI = moduleLoader._modules.get('smartlUI');
          }
          // 最后尝试加载（不应该到这里）
          if (!smartlUI && moduleLoader) {
            smartlUI = await moduleLoader.load('smartlUI');
          }
          if (smartlUI && typeof smartlUI.createSmartlPanel === 'function') {
            await smartlUI.createSmartlPanel(panelId);
          } else {
            throw new Error('smartlUI未加载或createSmartlPanel方法不存在');
          }
          break;
        case 'scene':
          // 优先从全局获取（已预加载）
          if (!displayUI && typeof window !== 'undefined' && window.displayUI) {
            displayUI = window.displayUI;
          }
          // 从缓存获取（应该已预加载）
          if (!displayUI && moduleLoader && moduleLoader._modules.has('displayUI')) {
            displayUI = moduleLoader._modules.get('displayUI');
          }
          // 最后尝试加载（不应该到这里）
          if (!displayUI && moduleLoader) {
            displayUI = await moduleLoader.load('displayUI');
          }
          if (displayUI && typeof displayUI.createDisplayPanel === 'function') {
            await displayUI.createDisplayPanel(panelId);
          } else {
            throw new Error('displayUI未加载或createDisplayPanel方法不存在');
          }
          break;
        case 'selected':
          // 优先从全局获取（已预加载）
          if (!selectedUI && typeof window !== 'undefined' && window.selectedUI) {
            selectedUI = window.selectedUI;
          }
          // 从缓存获取（应该已预加载）
          if (!selectedUI && moduleLoader && moduleLoader._modules.has('navSelectedUI')) {
            selectedUI = moduleLoader._modules.get('navSelectedUI');
          }
          // 最后尝试加载（不应该到这里）
          if (!selectedUI && moduleLoader) {
            selectedUI = await moduleLoader.load('navSelectedUI');
          }
          if (selectedUI && typeof selectedUI.createSelectedPanel === 'function') {
            await selectedUI.createSelectedPanel('selected');
          } else {
            throw new Error('selectedUI未加载或createSelectedPanel方法不存在');
          }
          break;
        default:
          // 使用默认面板内容
          this.setupDefaultPanel(panelId, panel);
      }
    } catch (error) {
      logError(`创建面板 ${panelId} 失败:`, error);
      this.setupErrorPanel(panelId, panel, error.message);
    }

  }
  
  /**
   * 设置默认面板内容
   * @param {string} panelId - 面板ID
   * @param {HTMLElement} panel - 面板元素
   */
  setupDefaultPanel(panelId, panel) {
    const panelContent = this.generatePanelHTML(`${panelId}面板`, `<p class="text-gray-500 dark:text-gray-400">${panelId}内容区域</p>`);
    
    panel.innerHTML = panelContent;
    // 设置后按当前导航高度调整底部避让
    this.safeAdjustPanelBottom(panelId);
    
    // 重新绑定关闭事件
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closePanel(panelId);
      });
    }
  }
  
  /**
   * 设置错误面板内容
   * @param {string} panelId - 面板ID
   * @param {HTMLElement} panel - 面板元素
   * @param {string} errorMessage - 错误信息
   */
  setupErrorPanel(panelId, panel, errorMessage) {
    const panelContent = this.generatePanelHTML(`${panelId}面板`, `<p class="text-red-500 dark:text-red-400">加载失败: ${errorMessage}</p>`);
    
    panel.innerHTML = panelContent;
    // 设置后按当前导航高度调整底部避让
    this.safeAdjustPanelBottom(panelId);
    
    // 重新绑定关闭事件
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closePanel(panelId);
      });
    }
  }
  
  /**
   * 显示面板
   * @param {string} panelId - 面板ID
   * @param {HTMLElement} panel - 面板元素
   */
  async showPanel(panelId, panel) {
    // 检查面板元素是否存在
    if (!panel) {
      panel = document.getElementById(`${panelId}-panel`);
      if (!panel) {
        logError(`面板 ${panelId} 不存在`);
        return;
      }
    }
    
    // 如果已有其他面板打开，先关闭
    if (this.currentOpenPanel && this.currentOpenPanel !== panelId) {
      await this.closePanel(this.currentOpenPanel);
    }
    
    // 显示面板（先显示，确保 DOM 已渲染）
    panel.classList.remove('hidden');
    
    // 触发动画
    const overlay = panel.querySelector(`#${panelId}-overlay`) || panel.querySelector('[id$="-overlay"]');
    const content = panel.querySelector(this.PANEL_SELECTOR);
    
    // 强制重绘
    if (content) void content.offsetWidth;
    
    if (overlay) {
      overlay.classList.remove('opacity-0', 'pointer-events-none');
      overlay.classList.add('opacity-100');
    }
    
    if (content) {
      content.style.transform = 'translateY(0)';
      content.classList.remove('panel-hidden');
      content.classList.add('panel-visible');
    }
    
    // 每次显示面板时重新设置位置（确保left/right正确）
    this.safeAdjustPanelBottom(panelId);
    // 控制/画面面板居中显示，已选面板铺满
    if (content) {
      if (panelId === 'smart' || panelId === 'scene') {
        // 固定高度，上下居中
        const vh = window.innerHeight;
        const panelH = Math.round(vh * 0.55);
        content.style.removeProperty('top');
        content.style.removeProperty('bottom');
        content.style.height = `${panelH}px`;
        content.style.top = `${Math.round((vh - panelH) / 2)}px`;
        content.style.left = '3vw';
        content.style.right = '3vw';
        content.style.position = 'fixed';
        content.style.borderRadius = '1rem 1rem 0.75rem 0.75rem';
      } else {
        content.style.left = '0';
        content.style.right = '0';
      }
    }
    
    // 设置按钮激活状态
    this.setButtonActiveState(panelId);
    
    // 记录当前打开的面板
    this.currentOpenPanel = panelId;
    
    // 已选面板不再支持点击空白处关闭（移除遮罩相关交互）
    
    // 延迟执行非关键操作，先让面板显示出来
    // 使用setTimeout延迟执行，不阻塞面板显示
    setTimeout(async () => {
      // 如果打开的是控制或画面面板，触发状态同步
      if (panelId === 'smart') {
        await this.syncSmartPanelState();
      } else if (panelId === 'scene') {
        await this.syncScenePanelState();
      }
      // 注意：已选面板的同步已在 togglePanel 中处理，这里不再重复调用
      // 避免重复刷新导致闪烁
    }, 50); // 延迟50ms执行，让面板先显示

  }
  
  /**
   * 同步控制面板状态
   */
  async syncSmartPanelState() {
    try {
      // 确保服务已初始化
      await this.initServices();
      
      if (smartlUI) {
        // 每次打开面板时，重新从后端同步状态（非阻塞，不影响面板显示速度）
        if (typeof smartlUI.syncInitialState === 'function') {
          smartlUI.syncInitialState().catch(() => {});
        }
        
        // 更新所有 UI
        if (typeof smartlUI.updateAllUI === 'function') {
          smartlUI.updateAllUI();
        }
        
        // 确保WebSocket同步已初始化
        if (typeof smartlUI.initWebSocketSync === 'function') {
          smartlUI.initWebSocketSync();
        }

      } else {
        logWarn('BottomNavUI', 'smartlUI未初始化，无法同步控制面板状态');
      }
    } catch (error) {
      logError('[BottomNavUI] 同步控制面板状态失败:', error);
    }
  }
  
  /**
   * 同步画面面板状态
   */
  async syncScenePanelState() {
    try {
      // 确保服务已初始化
      await this.initServices();
      
      if (displayUI) {
        // 确保WebSocket同步已初始化
        if (typeof displayUI.initWebSocketSync === 'function') {
          displayUI.initWebSocketSync();
        }
        // 请求当前状态
        if (typeof displayUI._requestCurrentState === 'function') {
          displayUI._requestCurrentState();
        }

      } else {
        logWarn('BottomNavUI', 'displayUI未初始化，无法同步画面面板状态');
      }
    } catch (error) {
      logWarn('BottomNavUI', '同步画面面板状态失败:', error);
    }
  }

  /**
   * 获取底部导航实际高度
   */
  getNavHeight() {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return 80; // 回退默认高度
    return nav.offsetHeight || 80;
  }

  /**
   * 按当前导航高度调整指定面板的底部避让距离
   * 直接使用存储的导航栏高度，简单准确
   */
  adjustPanelBottom(panelId, forceRecalculate = false) {
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;
    
    // 使用统一的选择器查找面板内容元素（所有面板都使用 rounded-t-2xl 类名）
    const panelContent = panel.querySelector(this.PANEL_SELECTOR);
    
    if (panelContent) {
      // 使用动态位置管理器计算位置（直接使用存储的高度值）
      // 每次显示面板时允许强制重算，避免吃到旧缓存高度
      // 间距改为0，让面板底部直接对齐导航栏顶部
      BottomPanelPositionManager.updatePanelPosition(panelContent, 0, forceRecalculate);
    }
  }

  /**
   * 调整所有已存在面板的底部避让距离
   */
  adjustAllPanelsBottom() {
    ['smart','scene','selected'].forEach(id => {
      try {
        this.safeAdjustPanelBottom(id);
      } catch (e) {
        logWarn('BottomNavUI', `调整面板 ${id} 位置失败:`, e);
      }
    });
  }
  
  /**
   * 关闭面板
   * @param {string} panelId - 面板ID
   */
  closePanel(panelId) {
    return new Promise((resolve) => {
      const panel = document.getElementById(`${panelId}-panel`);
      if (!panel) { resolve(); return; }

      const overlay = panel.querySelector(`#${panelId}-overlay`) || panel.querySelector('[id$="-overlay"]');
      const content = panel.querySelector(this.PANEL_SELECTOR);

      if (overlay) {
        overlay.classList.remove('opacity-100');
        overlay.classList.add('opacity-0', 'pointer-events-none');
      }

      const finishClose = () => {
        panel.classList.add('hidden');
        if (content) {
          content.style.transition = '';
          content.classList.remove('panel-visible');
          content.classList.add('panel-hidden');
        }
        const activeBtn = document.querySelector(`[data-panel="${panelId}"]`);
        if (activeBtn) activeBtn.classList.remove('active');

        if (panelId === 'selected') {
          const selectedOpenBtn = document.getElementById('selected-open');
          if (selectedOpenBtn) {
            selectedOpenBtn.classList.remove('pointer-events-none');
            selectedOpenBtn.classList.add('pointer-events-auto');
          }
        }

        if (this.currentOpenPanel === panelId) this.currentOpenPanel = null;
        resolve();
      };

      if (content) {
        content.style.transition = 'transform 0.25s cubic-bezier(0.4,0,1,1), opacity 0.2s ease-out';
        content.style.transform = 'translateY(120%)';

        const onEnd = () => {
          content.removeEventListener('transitionend', onEnd);
          finishClose();
        };
        content.addEventListener('transitionend', onEnd, { once: true });
        // 安全兜底：即使 transitionend 未触发也确保面板关闭
        setTimeout(finishClose, 300);
      } else {
        finishClose();
      }
    });
  }

  /**
   * 初始化旧 WebSocket 监听器（已停用）
   * 音量/静音状态统一通过 smartlService + API 初始同步处理
   */
  initWebSocketListener() {
    // 已停用，避免直接订阅旧 WebSocket initialState 导致初始化时序报错
  }
  
  /**
   * 清理WebSocket监听器
   */
  cleanupWebSocketListener() {
    if (this.wsUnsubscribe) {
      this.wsUnsubscribe();
      this.wsUnsubscribe = null;

    }
  }

  /**
   * 绑定 smartlService 音量事件，避免依赖面板打开时才同步
   */
  bindVolumeStateListener() {
    if (this._volumeStateUnbind) {
      this._volumeStateUnbind();
      this._volumeStateUnbind = null;
    }

    // 优先使用全局强行挂载的权威真相源
    const svc = (typeof window !== 'undefined' && window.smartlService_authoritative)
      ? window.smartlService_authoritative
      : ((typeof smartlUI !== 'undefined' && smartlUI?.smartlService) ? smartlUI.smartlService : (window.smartlService || null));
      
    if (!svc || typeof svc.on !== 'function') {
      // 如果服务暂未就绪，500ms后重试，确保建立监听
      setTimeout(() => this.bindVolumeStateListener(), 500);
      return;
    }

    const volumeHandler = (volume) => {
      if (volume != null) {
        console.log(`[BottomNavUI] 收到音量变更信号: ${volume}`);
        this.updateVolumeDisplay(volume);
      }
    };
    const stateHandler = (state) => {
      console.log('[BottomNavUI] 收到状态同步信号:', state);
      if (state && state.volume != null) {
        this.updateVolumeDisplay(state.volume);
      }
      // 添加同步静音状态逻辑
      if (state && state.isMuted !== undefined) {
        const btn = document.querySelector('#bottom-nav .mute-btn');
        if (btn) {
          const isMuted = state.isMuted === true;
          btn.dataset.command = isMuted ? 'unmute' : 'mute';
          btn.classList.toggle('muted', isMuted);
          const icon = btn.querySelector('i');
          if (icon) icon.className = `fa ${isMuted ? 'fa-volume-off' : 'fa-volume-up'}`;
          
          // 更新文字
          const ls = window.langService;
          const key = isMuted ? 'unmute' : 'mute';
          const zh = ls?.translations?.zh_cn?.[key] || (isMuted ? '取消静音' : '静音');
          const id = ls?.translations?.id_id?.[key] || (isMuted ? 'Buka bisukan' : 'Bisukan');
          const zhSpan = btn.querySelector('.zh-label');
          const idSpan = btn.querySelector('.indonesian-translation');
          if (zhSpan) {
            zhSpan.textContent = zh;
          }
          if (idSpan) {
            idSpan.textContent = id;
          }
        }
      }
    };

    svc.on('volumeChange', volumeHandler);
    svc.on('stateChange', stateHandler);
    this._volumeStateUnbind = () => {
      if (typeof svc.off === 'function') {
        svc.off('volumeChange', volumeHandler);
        svc.off('stateChange', stateHandler);
      }
    };
  }

  /**
   * 启动时主动拉一次房间状态，修复 APK 首屏音量不回填
   */
  async syncInitialVolumeFromApi() {
    if (this._initialVolumeSyncPromise) {
      return this._initialVolumeSyncPromise;
    }

    this._initialVolumeSyncPromise = (async () => {
      try {
        const api = window.apiService || null;
        if (!api || typeof api.getRoomState !== 'function') {
          return;
        }

        const roomState = await api.getRoomState();
        if (roomState && roomState.volume != null) {
          this.updateVolumeDisplay(roomState.volume);
          logInfo('BottomNavUI', `[音量初始化] API 同步成功: ${roomState.volume}`);
        }
        // 同步初始静音状态
        if (roomState && roomState.mute !== undefined) {
          const btn = document.querySelector('#bottom-nav .mute-btn');
          if (btn) {
            const isMuted = roomState.mute === true;
            btn.dataset.command = isMuted ? 'unmute' : 'mute';
            btn.classList.toggle('muted', isMuted);
            const icon = btn.querySelector('i');
            if (icon) icon.className = `fa ${isMuted ? 'fa-volume-off' : 'fa-volume-up'}`;
          }
        }
      } catch (e) {
        logWarn('BottomNavUI', '启动音量 API 同步失败:', e);
      } finally {
        this._initialVolumeSyncPromise = null;
      }
    })();

    return this._initialVolumeSyncPromise;
  }

  /**
   * 初始化音量显示
   */
  initVolumeDisplay() {
    // 获取音量背景容器
    const volumeContainer = document.getElementById('volume-background-container');
    
    // 确保DOM完全加载后再进行调整
    setTimeout(() => {
      // 根据屏幕尺寸调整容器位置和大小
      if (volumeContainer) {
        this.adjustVolumeContainerForScreenSize(volumeContainer);
      }
      
      // 按钮大小已通过 CSS 统一管理，不需要 JS 动态调整
      
      // 监听窗口大小变化（用于音量容器调整和面板位置更新）
      window.addEventListener('resize', () => {
        // 使用防抖动优化性能
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => {
          if (volumeContainer) {
            this.adjustVolumeContainerForScreenSize(volumeContainer);
          }
          // 窗口大小变化时，更新导航栏高度缓存并更新面板位置
          const navElement = document.getElementById('bottom-nav');
          if (navElement) {
            // 更新导航栏高度缓存（直接使用 offsetHeight，简单准确）
            BottomPanelPositionManager.updateNavHeightCache(navElement);
            // 更新所有已打开的面板位置（直接使用存储的高度值）
            // 间距改为0，让面板底部直接对齐导航栏顶部
            BottomPanelPositionManager.updateAllPanelsPosition(0);
          }
        }, 150); // 增加防抖延迟到150ms，优化性能
      });

      // 从 smartlService 获取初始音量（优先 smartlUI，其次 window.smartlService）
      const svc = (typeof smartlUI !== 'undefined' && smartlUI.smartlService)
        ? smartlUI.smartlService
        : (window.smartlService || null);
      if (svc) {
        const vol = svc.getState().volume;
        if (vol != null) this.updateVolumeDisplay(vol);
      }
      this.bindVolumeStateListener();

      // WebSocket/Service 状态还没到时，直接用 HTTP 房间状态兜底一次
      this.syncInitialVolumeFromApi();
    }, 100); // 延迟100ms确保DOM完全渲染
  }

  /**
   * 根据屏幕尺寸调整按钮大小
   * 注意：按钮尺寸已统一在 style.css 中通过媒体查询管理，此函数仅保留用于特殊情况
   */
  adjustButtonSizesForScreen() {
    // 所有按钮尺寸已经通过 CSS 媒体查询统一管理
    // 不需要 JS 动态调整，避免与 CSS 冲突
  }

  /**
   * 根据屏幕尺寸调整音量容器
   * @param {HTMLElement} container - 音量背景容器
   */
  adjustVolumeContainerForScreenSize(container) {
    // 所有样式已经通过CSS管理，不需要JS动态调整
    // 这个函数保留但不再修改样式，避免破坏CSS配置
  }

  /**
   * 更新音量显示
   * @param {number} volume - 音量值 (0-100)
   */
  updateVolumeDisplay(volume) {
    const clamped = Math.max(0, Math.min(100, Number(volume) || 0));
    this._pendingVolume = clamped;
    if (!this._volumeRaf) {
      this._volumeRaf = requestAnimationFrame(() => {
        const container = document.getElementById('volume-background-container');
        if (container && this._pendingVolume != null) {
          container.style.setProperty('--volume-progress', `${this._pendingVolume}%`);
        }
        
        // 同时更新静音按钮上的音量数值文字
        const muteValueElems = document.querySelectorAll('.mute-volume-value');
        muteValueElems.forEach(el => {
            if (this._pendingVolume != null) {
                el.textContent = this._pendingVolume;
            }
        });
        
        this._volumeRaf = null;
      });
    }
  }

  async preloadVolumeImages() {
    try {
      const service = (typeof window !== 'undefined' && window.imageCacheService) ? window.imageCacheService : null;
      if (!service) return;
      const urls = [
        './assets/images/bg-vol.png',
        './assets/images/vol.png',
        './assets/images/bg-vol-.png',
        './assets/images/bg-vol+.png'
      ];
      try {
        for (const u of urls) {
          await service.delete(u).catch(() => {});
        }
      } catch (_) {}
      const results = await Promise.all(urls.map(u => service.loadAndCache(u).catch(() => u)));
      const bg = document.querySelector('#volume-background-container .volume-bg-img');
      const fg = document.querySelector('#volume-background-container .volume-fg-img');
      const down = document.querySelector('.volume-down-btn img');
      const up = document.querySelector('.volume-up-btn img');
      if (bg && results[0]) bg.src = results[0];
      if (fg && results[1]) fg.src = results[1];
      if (down && results[2]) down.src = results[2];
      if (up && results[3]) up.src = results[3];
    } catch (_) {}
  }

  /**
   * 清除所有按钮的激活状态
   */
  clearAllButtonActiveStates() {
    document.querySelectorAll('[data-panel]').forEach(btn => {
      btn.classList.remove('active');
    });
  }
  
  /**
   * 设置按钮激活状态
   * @param {string} panelId - 面板ID
   */
  setButtonActiveState(panelId) {
    this.clearAllButtonActiveStates();
    const activeBtn = document.querySelector(`[data-panel="${panelId}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
    }
  }
}

// 创建并导出底部导航UI实例
const bottomNavUI = new BottomNavUI();
export default bottomNavUI;

/**
 * 更新底部导航标签文本
 */
BottomNavUI.prototype.updateNavLabels = function() {
  const navElement = document.getElementById('bottom-nav');
  if (!navElement || !this.langService) return;
  
  // 更新导航标签文本
  navElement.querySelectorAll('span[data-lang-key]').forEach(span => {
    const key = span.getAttribute('data-lang-key');
    const text = this.langService.t(key) || span.textContent;
    span.textContent = text;
  });

  // 通知静音按钮刷新标签（依赖 SmartlUI 当前状态）
  if (typeof smartlUI?.updateButtonStates === 'function') {
    smartlUI.updateButtonStates();
  }
  
    // 标签更新后，更新导航栏高度缓存（语言变化可能导致按钮高度变化，这是必要的更新）
    // 注意：只在确实需要时更新，避免浪费资源
    // 使用 requestAnimationFrame 确保 DOM 更新完成后再计算高度
    requestAnimationFrame(() => {
      // 更新导航栏高度缓存（直接使用 offsetHeight，简单准确）
      BottomPanelPositionManager.updateNavHeightCache(navElement);
      // 导航栏位置更新后，同步更新所有已打开的面板位置
      // 间距改为0，让面板底部直接对齐导航栏顶部
      BottomPanelPositionManager.updateAllPanelsPosition(0);
    });
};

// 键盘感知隐藏/显示底部导航
BottomNavUI.prototype.attachKeyboardAwareBehavior = function() {
};

// 清理键盘监听器（用于应用卸载时清理）
BottomNavUI.prototype.detachKeyboardAwareBehavior = function() {
};