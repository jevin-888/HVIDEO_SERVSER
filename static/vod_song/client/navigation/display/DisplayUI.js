// 延迟导入，避免循环依赖
import { cleanupWebSocketListeners as cleanupWSListeners } from '../../modules/common/WebSocketUtils.js';
import { logInfo, logWarn, logError } from '../../utils/Logger.js';
import DomUtils from '../../utils/DomUtils.js';
let displayService;

/**
 * 画面管理UI逻辑
 */
class DisplayUI {
  constructor() {
    // 在需要时动态导入服务
    this._currentMode = null;
    this._isLocked = false;
    // WebSocket监听器清理函数
    this._syncStateUnbind = null;
    this._connectedUnbind = null;
    this._wsSyncInitialized = false; // 标记是否已初始化WebSocket同步
  }
  
  /**
   * 初始化服务
   */
  async initServices() {
    // 防止重复初始化
    if (this._servicesReady) return;
    // 优先尝试从全局 window 获取服务
    let services = typeof window !== 'undefined' ? window : {};
    
    // 如果没有全局变量，尝试加载 moduleLoader 并加载服务
    if (!services.apiService && services.moduleLoader) {
      // 这里的逻辑可以根据需要扩展
    }

    if (!displayService) {
      displayService = services.displayService;
    }
    this.displayService = displayService;
    this.apiService = services.apiService;
    this.toastService = services.toastService;
    this.langService = services.langService;
    
    // 如果还是缺少关键服务且 moduleLoader 可用，尝试通过 moduleLoader 加载
    if ((!this.apiService || !this.langService) && services.moduleLoader) {
      // displayService 通常在 index.js 中定义
    }

    // 语言文件只加载一次
    if (this.langService && !this.langService.translations['zh_cn']) {
      await this.langService.init();
    }
    const langCodes = ['id_id', 'en_us', 'vi_vn'];
    await Promise.all(langCodes.map(code =>
      (this.langService && !this.langService.translations[code])
        ? this.langService.loadLanguageFile(code).catch(() => {})
        : Promise.resolve()
    ));

    // navMaterialUI/navMaterialService 按需懒加载，不阻塞主流程
    if (services.moduleLoader) {
      if (!this.navMaterialService) {
        services.moduleLoader.load('navMaterialService').then(m => { this.navMaterialService = m; }).catch(() => {});
      }
      if (!this.navMaterialUI) {
        services.moduleLoader.load('navMaterialUI').then(m => { this.navMaterialUI = m; }).catch(() => {});
      }
    }
    this._servicesReady = true;
  }

  /**
   * 渲染画面布局
   * @param {Object} layout - 画面布局配置
   */
  renderDisplayLayout(layout) {
    // 实现画面布局的渲染逻辑

  }

  /**
   * 更新画面状态
   * @param {Object} status - 画面状态
   */
  updateDisplayStatus(status) {
    // 实现画面状态更新逻辑

  }

  /**
   * 绑定画面相关事件
   */
  bindDisplayEvents() {
    // 实现画面相关事件绑定逻辑

  }

  /**
   * 初始化WebSocket状态同步（视图模式、场景锁定）
   */
  initWebSocketSync() {
    // 防止重复绑定监听器，如果已初始化则先清理
    if (this._wsSyncInitialized) {
      this.cleanupWebSocketListeners();
    }

    const applySyncState = (syncState) => {
      if (!Array.isArray(syncState)) return;
      if (syncState[5] !== undefined) {
        this._updateSceneModeUI(syncState[5]);
      }
      if (syncState[8] !== undefined) {
        const s8 = syncState[8];
        const isLocked = (s8 === 1 || s8 === '1' || s8 === true);
        this._updateLockButtonUI(isLocked);
      }
    };
    
    const applyInitial = () => {
      try {
        const client = window.WebSocketClient;
        if (!client || typeof client.getGlobalState !== 'function') return;
        const { syncState } = client.getGlobalState();

        applySyncState(syncState);
      } catch (e) {
        logWarn('DisplayUI', '初始化同步状态失败:', e);
      }
    };

    const setupListeners = () => {
      const client = window.WebSocketClient;
      if (!client || typeof client.on !== 'function') return;
      
      // 标记已初始化
      this._wsSyncInitialized = true;

      this._syncStateUnbind = client.on('syncState', (data) => {
        if (!data || typeof data !== 'object') return;
        const { opKey, state } = data;
        if (opKey === 5 && state !== undefined) {
          this._updateSceneModeUI(state);
        }
        if (opKey === 8 && state !== undefined) {
          const isLocked = state === 1 || state === true || state === '1';
          this._updateLockButtonUI(isLocked);
        }
      });

      // 应用当前全局状态
      applyInitial();
      
      // 添加连接成功事件监听，确保连接建立后能获取状态
      this._connectedUnbind = client.on('connected', () => {
        this._requestCurrentState();
        setTimeout(() => {
          applyInitial();
        }, 1000);
      });

      // 初始请求状态
      this._requestCurrentState();
    };

    if (window.WebSocketClient) {
      setupListeners();
    } else {
      window.addEventListener('websocketClientReady', () => setupListeners(), { once: true });
    }
  }
  
  /**
   * 清理WebSocket监听器
   */
  cleanupWebSocketListeners() {
    cleanupWSListeners(this, 'DisplayUI');
  }
  
  /**
   * 主动请求当前状态
   * 注意：客户端只接收不发送，此方法已禁用发送功能，仅保留方法签名以避免调用错误
   */
  _requestCurrentState() {
    // 客户端只接收不发送，不主动请求状态
    // 状态会通过服务器主动推送的 roomStateChanged 消息获取

  }

  /**
   * 根据模式更新场景按钮UI
   * @param {number} mode - 0全屏,1画中画,2壁画
   */
  _updateSceneModeUI(mode) {
    const panel = document.getElementById('scene-panel') || document.querySelector('.display-panel');
    if (!panel) return;
    const commands = ['consumer/clickButton0', 'consumer/clickButton1', 'consumer/clickButton2'];
    const inactiveClasses = ['bg-white/5', 'text-white/60'];
    const activeClasses = ['bg-red-600', 'text-white', 'shadow-lg', 'shadow-red-500/20'];
    
    commands.forEach((cmd, key) => {
      const btn = panel.querySelector(`[data-command="${cmd}"]`);
      if (!btn) return;
      const isActive = key === Number(mode);
      btn.classList.toggle('active', isActive);
      
      if (isActive) {
        inactiveClasses.forEach(c => btn.classList.remove(c));
        activeClasses.forEach(c => btn.classList.add(c));
        const icon = btn.querySelector('i');
        if (icon) icon.classList.replace('text-white/60', 'text-white');
      } else {
        activeClasses.forEach(c => btn.classList.remove(c));
        inactiveClasses.forEach(c => btn.classList.add(c));
        const icon = btn.querySelector('i');
        if (icon) icon.classList.replace('text-white', 'text-white/60');
      }
    });
    this._currentMode = Number(mode);
    this._updateMoreMaterialsVisibility();
  }

  /**
   * 更新锁定按钮UI
   * @param {boolean} isLocked
   */
  _updateLockButtonUI(isLocked) {
    const panel = document.querySelector('.display-panel');
    const lockBtn = (panel || document).querySelector('#newLockBtn');
    if (!lockBtn) return;
    // 记录当前锁定状态以便点击时使用
    lockBtn.dataset.locked = isLocked ? 'true' : 'false';

    // 定义锁定/未锁定两组样式
    const inactiveLockClasses = ['bg-white/5', 'text-white/60'];
    const activeLockClasses = ['bg-red-600', 'text-white', 'shadow-lg', 'shadow-red-500/20'];

    if (isLocked) {
      inactiveLockClasses.forEach(c => lockBtn.classList.remove(c));
      activeLockClasses.forEach(c => lockBtn.classList.add(c));
    } else {
      activeLockClasses.forEach(c => lockBtn.classList.remove(c));
      inactiveLockClasses.forEach(c => lockBtn.classList.add(c));
    }

    // 切换锁定样式类（保留钩子）
    lockBtn.classList.toggle('locked', !!isLocked);

    const icon = lockBtn.querySelector('i');
    const text = lockBtn.querySelector('span');
    if (icon) {
      icon.classList.toggle('fa-lock', !!isLocked);
      icon.classList.toggle('fa-lock-open', !isLocked);
    }
    if (text) {
      const zhTranslations = this.langService?.translations['zh_cn'] || {};
      const unlockScene = zhTranslations['unlockScene'] || '解锁场景';
      const lockScene = zhTranslations['lockScene'] || '锁定场景';
      text.textContent = isLocked ? unlockScene : lockScene;
    }

    // 锁定时禁用场景切换按钮
    const sceneOptions = (panel || document).querySelectorAll('#material-scene-buttons button.control-btn');
    sceneOptions.forEach(opt => {
      if (isLocked) {
        opt.classList.add('opacity-50', 'cursor-not-allowed');
        opt.dataset.locked = 'true';
      } else {
        opt.classList.remove('opacity-50', 'cursor-not-allowed');
        delete opt.dataset.locked;
      }
    });
    // 记录锁定状态并更新“更多素材”可见性
    this._isLocked = !!isLocked;
    this._updateMoreMaterialsVisibility();
  }

  // 根据当前模式与锁定状态更新"更多素材"按钮显示
  _updateMoreMaterialsVisibility() {
    const panel = document.querySelector('.display-panel');
    const moreBtn = (panel || document).querySelector('#moreMaterialsBtn');
    if (!moreBtn) return;
    const shouldShow = !this._isLocked && (this._currentMode === 1 || this._currentMode === 2);
    // 使用类名控制显示/隐藏，不使用内联样式
    if (shouldShow) {
      moreBtn.classList.remove('hidden');
    } else {
      moreBtn.classList.add('hidden');
    }
  }
  
  /**
   * 创建画面面板内容
   * @param {string} panelId - 面板ID
   */
  async createDisplayPanel(panelId) {
    // 初始化服务
    await this.initServices();
    
    // 获取面板元素
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;

    // 面板已创建过则直接复用，不重建DOM（性能优化）
    if (panel.dataset.panelReady === 'true') {
      return;
    }
    
    // 获取翻译
    const zhTranslations = this.langService?.translations['zh_cn'] || {};
    const idT = this.langService?.translations['id_id'] || {};
    const enT = this.langService?.translations['en_us'] || {};
    const viT = this.langService?.translations['vi_vn'] || {};
    // 兼容旧变量名
    const idTranslations = idT;
    const sceneZh = zhTranslations['scene'] || '场景';
    const materialZh = zhTranslations['material'] || '素材';
    const liveZh = zhTranslations['live'] || '直播';
    const interactionZh = zhTranslations['interaction'] || '互动';
    const moreMaterialsZh = zhTranslations['moreMaterials'] || '更多素材';
    const unlockSceneZh = zhTranslations['unlockScene'] || '解锁场景';
    const fullscreenZh = zhTranslations['fullscreen'] || '全屏';
    const pictureInPictureZh = zhTranslations['pictureInPicture'] || '画中画';
    const muralZh = zhTranslations['mural'] || '壁画';
    const romanticZh = zhTranslations['romantic'] || '浪漫';
    const movieZh = zhTranslations['movie'] || '电影';
    const restZh = zhTranslations['rest'] || '休息';
    const brightZh = zhTranslations['bright'] || '明亮';
    // 辅助函数：生成四种语言的文字内容，供 UI 组件内部静态内容使用
    const multiLangText = (key, zh, id, en, vi) => {
      // 检查字典中是否存在翻译，如果不存在则使用传入的 fallback
      const tZh = zh || zhTranslations[key] || '';
      const tId = id || idT[key] || '';
      const tEn = en || enT[key] || '';
      const tVi = vi || viT[key] || '';
      return `<span class="zh-label" data-lang-key="${key}">${tZh}</span>` +
             `<span class="indonesian-translation">${tId}</span>` +
             `<span class="en-translation">${tEn}</span>` +
             `<span class="vi-translation">${tVi}</span>`;
    };
    
    // 创建画面面板内容
    const panelContent = `
        <div id="${panelId}-overlay" class="fixed inset-0 bg-black/50 opacity-0 transition-opacity duration-300 pointer-events-none"></div>
        <div class="premium-panel-base text-white transform translate-y-[120%] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] bg-cover bg-center" style="background-image: url('./assets/images/bg_window.png')">
          
          <!-- Handle -->
          <div class="w-12 h-1.5 bg-white/20 rounded-full mx-auto mt-3 mb-1"></div>

          <div class="px-6 pt-2 pb-2 relative z-10">
            <div class="flex justify-between items-center mb-4">
              <div class="song-tabs premium-tab-container flex-1 flex space-x-1 rounded-2xl bg-white/5 p-1">
                <button class="tab-btn flex-1 px-1 py-2 rounded-xl text-sm font-bold transition-all duration-300 is-active bg-red-600 shadow-lg shadow-red-500/20 whitespace-nowrap flex items-center justify-center" data-tab="material">
                  <i class="fa fa-layer-group mr-1.5 flex-shrink-0"></i>${multiLangText('material', materialZh, idT['material'], enT['material'], viT['material'])}
                </button>
                <button class="tab-btn flex-1 px-1 py-2 rounded-xl text-sm font-medium text-gray-400 transition-all duration-300 whitespace-nowrap flex items-center justify-center" data-tab="scene">
                  <i class="fa fa-image mr-1.5 flex-shrink-0"></i>${multiLangText('scene', sceneZh, idT['scene'], enT['scene'], viT['scene'])}
                </button>
                <button class="tab-btn flex-1 px-1 py-2 rounded-xl text-sm font-medium text-gray-400 transition-all duration-300 whitespace-nowrap flex items-center justify-center" data-tab="live">
                  <i class="fa fa-broadcast-tower mr-1.5 flex-shrink-0"></i>${multiLangText('live', liveZh, idT['live'], enT['live'], viT['live'])}
                </button>
                <button class="tab-btn flex-1 px-1 py-2 rounded-xl text-sm font-medium text-gray-400 transition-all duration-300 whitespace-nowrap flex items-center justify-center" data-tab="interaction">
                  <i class="fa fa-comments mr-1.5 flex-shrink-0"></i>${multiLangText('interaction', interactionZh, idT['interaction'], enT['interaction'], viT['interaction'])}
                </button>
              </div>
              <button class="control-btn w-10 h-10 flex items-center justify-center bg-white/5 rounded-full text-white/60 hover:text-white transition-colors close-panel-btn">
                <i class="fa fa-times"></i>
              </button>
            </div>
          </div>
          
          <div class="panel-shell__body flex-1 overflow-hidden px-6 relative z-10">
            <div class="flex gap-3 mb-6">
              <button id="moreMaterialsBtn" class="flex-1 h-20 rounded-2xl bg-white/5 flex flex-col items-center justify-center gap-2 group active:scale-95 transition-transform hidden">
                <i class="fa fa-folder-open text-xl text-white/60 group-hover:text-white transition-colors"></i>
                <span class="text-xs font-bold text-white/70 flex flex-col items-center">
                  ${multiLangText('moreMaterials', moreMaterialsZh, idT['moreMaterials'] || 'Material Lebih', enT['moreMaterials'] || 'More', viT['moreMaterials'] || 'Thêm')}
                </span>
              </button>
              <button id="newLockBtn" class="flex-1 h-20 rounded-2xl bg-white/5 flex flex-col items-center justify-center gap-2 group active:scale-95 transition-transform">
                <i class="fa fa-lock-open text-xl text-white/60 group-hover:text-white transition-colors"></i>
                <span class="text-xs font-bold text-white/70 flex flex-col items-center">
                  ${multiLangText('unlockScene', unlockSceneZh, idT['unlockScene'] || 'Buka Kunci', enT['unlockScene'] || 'Unlock', viT['unlockScene'] || 'Mở khóa')}
                </span>
              </button>
            </div>

            <div class="flex-1 overflow-hidden">
              <div class="material-content h-full">
                <div class="grid grid-cols-3 gap-3 mb-6" id="material-scene-buttons">
                  <button class="h-24 rounded-2xl bg-white/5 flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform" data-command="consumer/clickButton0">
                    <i class="fa fa-expand text-xl text-white/60"></i>
                    <span class="text-[10px] font-bold flex flex-col items-center">${multiLangText('fullscreen', fullscreenZh, idT['fullscreen'], enT['fullscreen'], viT['fullscreen'])}</span>
                  </button>
                  <button class="h-24 rounded-2xl bg-white/5 flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform" data-command="consumer/clickButton1">
                    <i class="fa fa-clone text-xl text-white/60"></i>
                    <span class="text-[10px] font-bold flex flex-col items-center">${multiLangText('pictureInPicture', pictureInPictureZh, idT['pictureInPicture'], enT['pictureInPicture'], viT['pictureInPicture'])}</span>
                  </button>
                  <button class="h-24 rounded-2xl bg-white/5 flex flex-col items-center justify-center gap-2 active:scale-95 transition-transform" data-command="consumer/clickButton2">
                    <i class="fa fa-border-all text-xl text-white/60"></i>
                    <span class="text-[10px] font-bold flex flex-col items-center">${multiLangText('mural', muralZh, idT['mural'], enT['mural'], viT['mural'])}</span>
                  </button>
                </div>
                <div id="materialListContainer" class="grid grid-cols-2 gap-4 overflow-y-auto pb-20 custom-scrollbar" style="height: calc(65vh - 280px);" data-scrollable="true"></div>
              </div>

              <div class="scene-content hidden h-full overflow-y-auto pb-20 custom-scrollbar" data-scrollable="true">
                <div class="grid grid-cols-3 gap-3">
                  <button class="premium-card p-4 flex flex-col items-center gap-3 active:scale-95 transition-transform">
                    <i class="fa fa-cocktail text-xl text-blue-400"></i>
                    <span class="text-xs font-bold flex flex-col items-center">${multiLangText('romantic', romanticZh, idT['romantic'], enT['romantic'], viT['romantic'])}</span>
                  </button>
                  <button class="premium-card p-4 flex flex-col items-center gap-3 active:scale-95 transition-transform">
                    <i class="fa fa-glass-martini text-xl text-purple-400"></i>
                    <span class="text-xs font-bold flex flex-col items-center">${multiLangText('party', '派对', idT['party'], enT['party'], viT['party'])}</span>
                  </button>
                  <button class="premium-card p-4 flex flex-col items-center gap-3 active:scale-95 transition-transform">
                    <i class="fa fa-music text-xl text-pink-400"></i>
                    <span class="text-xs font-bold flex flex-col items-center">${multiLangText('K歌', 'K歌', 'K Song', 'K Song', 'K Song')}</span>
                  </button>
                </div>
              </div>

              <div class="live-content hidden py-20 text-center">
                <i class="fa fa-broadcast-tower text-4xl text-white/10 mb-4"></i>
                <div class="text-white/30 font-bold flex flex-col items-center">
                  ${multiLangText('liveDeveloping', '直播模式开发中', 'Mode siaran langsung sedang dikembangkan', 'Live mode under development', 'Chế độ trực tiếp đang được phát triển')}
                </div>
              </div>

              <div class="interaction-content hidden py-20 text-center">
                <i class="fa fa-comments text-4xl text-white/10 mb-4"></i>
                <div class="text-white/30 font-bold flex flex-col items-center">
                  ${multiLangText('interactionDeveloping', '互动内容开发中', 'Konten interaksi sedang dikembangkan', 'Interaction content under development', 'Nội dung tương tác đang được phát triển')}
                </div>
              </div>
            </div>
          </div>
        </div>`;
    
    // 更新面板内容
    panel.innerHTML = panelContent;
    // 标记面板已创建完成，后续打开直接复用
    panel.dataset.panelReady = 'true';
    
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

    // 绑定标签切换事件
    const tabButtons = panel.querySelectorAll('.tab-btn');
    const contentAreas = panel.querySelectorAll('.material-content, .scene-content, .live-content, .interaction-content');
    
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const tabId = button.dataset.tab;
        
        // 更新按钮状态
        tabButtons.forEach(btn => {
          btn.classList.remove('bg-red-600', 'shadow-lg', 'shadow-red-500/20', 'text-white', 'is-active');
          btn.classList.add('text-gray-400');
          btn.setAttribute('aria-selected', 'false');
        });
        
        button.classList.remove('text-gray-400');
        button.classList.add('bg-red-600', 'shadow-lg', 'shadow-red-500/20', 'text-white', 'is-active');
        button.setAttribute('aria-selected', 'true');
        
        // 显示对应的内容区域
        contentAreas.forEach(content => {
          if (content.classList.contains(`${tabId}-content`)) {
            content.classList.remove('hidden');
          } else {
            content.classList.add('hidden');
          }
        });
      });
    });

    // 初始化显示素材内容
    panel.querySelector('.material-content').classList.remove('hidden');

    // 绑定功能按钮点击事件
    (async () => {
      try {
        await this.initServices();
      } catch (e) {
        logWarn('DisplayUI', '服务初始化失败:', e);
      }
    })();

    // 更多素材按钮 - 修改为打开完整的素材库模态框
    const moreBtn = panel.querySelector('#moreMaterialsBtn');
    if (moreBtn) {
      moreBtn.addEventListener('click', async () => {
        try {
          await this.initServices();
          // 确保 navMaterialUI 已加载
          if (!this.navMaterialUI) {
            const services = await import('../../index.js');
            if (services.moduleLoader) {
              this.navMaterialUI = await services.moduleLoader.load('navMaterialUI');
            } else {
              throw new Error('无法加载 navMaterialUI：moduleLoader 不可用');
            }
          }
          // 打开完整的素材库模态框
          if (this.navMaterialUI && typeof this.navMaterialUI.openModal === 'function') {
            await this.navMaterialUI.openModal();
          } else {
            throw new Error('navMaterialUI.openModal 方法不可用');
          }
        } catch (e) {
          logError('DisplayUI', '打开素材库失败:', e);
          if (this.toastService && typeof this.toastService.showError === 'function') {
            this.toastService.showError('打开素材库失败', 2000);
          }
        }
      });
    }

    // 场景切换按钮（全屏/画中画/壁画）
    const sceneOptions = panel.querySelectorAll('#material-scene-buttons button.control-btn');
    sceneOptions.forEach(opt => {
      opt.addEventListener('click', async () => {
        // 若锁定则阻止切换
        const lockBtn = panel.querySelector('#newLockBtn');
        const isLocked = lockBtn && lockBtn.dataset && lockBtn.dataset.locked === 'true';
        if (isLocked) {
          return;
        }
        const command = opt.getAttribute('data-command');
        let alias = '';
        switch (command) {
          case 'consumer/clickButton0':
            alias = 'fullScreenMode';
            break;
          case 'consumer/clickButton1':
            alias = 'pipMode';
            break;
          case 'consumer/clickButton2':
            alias = 'wallPictureMode';
            break;
        }
        if (!alias) return;
        try {
          await this.initServices();
          await this.apiService.clickButton(alias);

        } catch (e) {
          logError('DisplayUI', '发送场景切换失败:', e);
        }
      });
    });

    // 场景锁定/解锁按钮
    const lockBtn = panel.querySelector('#newLockBtn');
    if (lockBtn) {
      lockBtn.addEventListener('click', async () => {
        try {
          await this.initServices();
          // 根据当前锁定状态发送对应命令
          const isLocked = lockBtn.dataset && lockBtn.dataset.locked === 'true';
          const alias = isLocked ? 'sceneUnLockButton' : 'sceneLockButton';
          await this.apiService.clickButton(alias);

        } catch (e) {
          logError('DisplayUI', '场景锁定操作失败:', e);
          this.toastService && this.toastService.showError('操作失败', 1000);
        }
      });
    }


    // 打开面板时同步按钮状态
    if (typeof this._currentMode !== 'undefined') {
      this._updateSceneModeUI(this._currentMode);
    }
    if (typeof this._isLocked !== 'undefined') {
      this._updateLockButtonUI(this._isLocked);
    }

    // 延迟启用WebSocket状态同步，先让面板显示出来（优化性能）
    setTimeout(() => {
      this.initWebSocketSync();
    }, 50);
  }
}

// 创建并导出画面管理UI实例
const displayUI = new DisplayUI();
export default displayUI;
