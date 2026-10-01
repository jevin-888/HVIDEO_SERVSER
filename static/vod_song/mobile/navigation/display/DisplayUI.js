// 延迟导入，避免循环依赖
let displayService;

/**
 * 画面管理UI逻辑
 */
class DisplayUI {
  constructor() {
    // 在需要时动态导入服务
    this._currentMode = null;
    this._isLocked = false;
  }

  /**
   * 初始化服务
   */
  async initServices() {
    // 直接使用全局对象，避免循环依赖
    displayService = window.displayService || displayService;
    this.displayService = displayService;

    // 动态引用其他依赖服务
    this.apiService = window.apiService;
    this.navMaterialService = window.navMaterialService;
    this.navMaterialUI = window.navMaterialUI;
    this.toastService = window.toastService;
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
        console.warn('[DisplayUI] 初始化同步状态失败:', e);
      }
    };

    const setupListeners = () => {
      const client = window.WebSocketClient;
      if (!client || typeof client.on !== 'function') return;

      // 监听同步状态消息
      client.on('syncState', (data) => {
        if (!data || typeof data !== 'object') return;
        const { opKey, state } = data;
        if (opKey === 5 && state !== undefined) {
          this._updateSceneModeUI(state);
        }
        if (opKey === 8 && state !== undefined) {
          const isLocked = (state === 1 || state === '1' || state === true);
          this._updateLockButtonUI(isLocked);
        }
      });

      // 应用当前全局状态
      applyInitial();

      // 添加主动请求状态的机制，确保获取最新状态
      this._requestCurrentState();

      // 添加连接成功事件监听，确保连接建立后能获取状态
      client.on('connected', () => {
        this._requestCurrentState();
        // 添加一个小延迟后再应用初始状态，确保状态已同步
        setTimeout(() => {
          applyInitial();
        }, 1000);
      });
    };

    if (window.WebSocketClient) {
      setupListeners();
    } else {
      window.addEventListener('websocketClientReady', () => setupListeners(), { once: true });
    }
  }

  /**
   * 主动请求当前状态
   */
  _requestCurrentState() {
    try {
      // 添加延迟确保WebSocket连接完全建立
      setTimeout(() => {
        const client = window.WebSocketClient;
        if (client && typeof client.send === 'function') {
          // 请求同步状态
          client.send({type: 'requestSyncState'});
        } else {
          console.warn('[DisplayUI] WebSocket客户端不可用或缺少send方法');
        }
      }, 500);
    } catch (e) {
      console.warn('[DisplayUI] 请求当前状态失败:', e);
    }
  }

  /**
   * 根据模式更新场景按钮UI
   * @param {number} mode - 0全屏,1画中画,2壁画
   */
  _updateSceneModeUI(mode) {
    const sceneSelectors = {
      0: '[data-command="consumer/clickButton0"]',
      1: '[data-command="consumer/clickButton1"]',
      2: '[data-command="consumer/clickButton2"]',
    };

    const inactiveClasses = ['bg-gray-100','dark:bg-gray-700','text-gray-800','dark:text-gray-300'];
    const activeClasses = ['bg-red-500','dark:bg-red-600','text-white'];

    Object.keys(sceneSelectors).forEach((key) => {
      const selector = sceneSelectors[key];
      const opt = document.querySelector(selector);
      if (!opt) return;
      const btn = opt.querySelector('.scene-btn') || opt;
      const isActive = parseInt(key, 10) === Number(mode);

      // 统一active类，用于其它可能的样式钩子
      opt.classList.toggle('active', isActive);
      btn.classList.toggle('active', isActive);

      // 切换背景/文字颜色类，确保选中可见
      if (isActive) {
        inactiveClasses.forEach(c => btn.classList.remove(c));
        activeClasses.forEach(c => btn.classList.add(c));
      } else {
        activeClasses.forEach(c => btn.classList.remove(c));
        inactiveClasses.forEach(c => btn.classList.add(c));
      }

      if (!isActive) {
        // 清理可能残留的强制激活样式
        btn.classList.remove('force-active-style');
      }
    });
    // 记录当前模式并更新"更多素材"可见性
    this._currentMode = Number(mode);
    this._updateMoreMaterialsVisibility();
  }

  /**
   * 更新锁定按钮UI
   * @param {boolean} isLocked
   */
  _updateLockButtonUI(isLocked) {
    const lockBtn = document.querySelector('#newLockBtn');
    if (!lockBtn) return;
    // 记录当前锁定状态以便点击时使用
    lockBtn.dataset.locked = isLocked ? 'true' : 'false';

    // 定义锁定/未锁定两组样式
    const inactiveLockClasses = ['bg-gray-200','dark:bg-gray-700','text-gray-700','dark:text-gray-300'];
    const activeLockClasses = ['bg-red-500','dark:bg-red-600','text-white'];

    // 根据锁定状态切换背景和文字颜色（不强制默认红色）
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
      text.textContent = isLocked ? '解锁场景' : '锁定场景';
    }

    // 锁定时禁用场景切换按钮
    const sceneOptions = document.querySelectorAll('.scene-option');
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

  // 根据当前模式与锁定状态更新“更多素材”按钮显示
  _updateMoreMaterialsVisibility() {
    const moreBtn = document.querySelector('#moreMaterialsBtn');
    if (!moreBtn) return;
    const shouldShow = !this._isLocked && (this._currentMode === 1 || this._currentMode === 2);
    moreBtn.style.display = shouldShow ? 'block' : 'none';
    moreBtn.classList.toggle('hidden', !shouldShow);
  }

  /**
   * 创建画面面板内容
   * @param {string} panelId - 面板ID
   */
  async createDisplayPanel(panelId) {
    // 获取面板元素
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;

    // 面板已创建过则直接复用
    if (panel.dataset.panelReady === 'true') {
      return;
    }

    // 创建画面面板内容
    const panelContent = `
        <div class="fixed inset-x-0 bottom-0 z-[10006] premium-panel-base mobile-panel-unified text-white h-[72vh] transform translate-y-[120%] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]">
          
          <!-- Handle -->
          <div class="w-12 h-1.5 bg-white/20 rounded-full mx-auto mt-3 mb-1"></div>

          <div class="px-6 pt-2 pb-4">
            <div class="flex justify-between items-center mb-6">
              <div class="flex items-center gap-3">
                <h3 class="text-2xl font-black gradient-text">场景库</h3>
                <button id="themeToggle" class="w-10 h-10 flex items-center justify-center bg-white/5 rounded-full text-white/60 hover:text-white transition-colors" title="切换主题" aria-label="切换主题">
                  <i class="fa fa-moon"></i>
                  <i class="fa fa-sun hidden"></i>
                </button>
              </div>
              <button class="w-10 h-10 flex items-center justify-center bg-white/5 rounded-full text-white/60 hover:text-white transition-colors close-panel-btn">
                <i class="fa fa-times"></i>
              </button>
            </div>

            <!-- 标签导航 -->
            <div class="premium-tab-container flex space-x-1 mb-8 rounded-2xl">
              <button class="tab-btn flex-1 px-4 py-3 text-sm font-bold rounded-xl transition-all duration-300 active bg-red-600 text-white shadow-lg shadow-red-500/20" data-tab="material">
                <i class="fa fa-layer-group mr-2"></i>素材
              </button>
              <button class="tab-btn flex-1 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-300 text-gray-400" data-tab="scene">
                <i class="fa fa-image mr-2"></i>场景
              </button>
              <button class="tab-btn flex-1 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-300 text-gray-400" data-tab="interaction">
                <i class="fa fa-comments mr-2"></i>互动
              </button>
            </div>
          </div>
          
          <!-- 内容区域 -->
          <div class="flex-1 overflow-y-auto px-6 h-[calc(72vh-180px)]">
            <!-- 播控模式快速切换 -->
            <div class="flex gap-3 mb-4" id="display-mode-switch">
              <div class="scene-option cursor-pointer flex-1" data-command="consumer/clickButton0">
                <div class="scene-btn premium-control-btn rounded-xl p-3 flex flex-col items-center justify-center active:scale-95 transition-all">
                  <i class="fa fa-expand text-lg mb-1.5"></i>
                  <span class="text-[0.6rem] font-bold">全屏</span>
                </div>
              </div>
              <div class="scene-option cursor-pointer flex-1" data-command="consumer/clickButton1">
                <div class="scene-btn premium-control-btn rounded-xl p-3 flex flex-col items-center justify-center active:scale-95 transition-all">
                  <i class="fa fa-clone text-lg mb-1.5"></i>
                  <span class="text-[0.6rem] font-bold">画中画</span>
                </div>
              </div>
              <div class="scene-option cursor-pointer flex-1" data-command="consumer/clickButton2">
                <div class="scene-btn premium-control-btn rounded-xl p-3 flex flex-col items-center justify-center active:scale-95 transition-all">
                  <i class="fa fa-th-large text-lg mb-1.5"></i>
                  <span class="text-[0.6rem] font-bold">壁画</span>
                </div>
              </div>
            </div>

            <!-- 素材列表 -->
            <div class="material-content flex flex-col pb-10">
              <div class="flex justify-between items-center mb-4">
                <span class="text-gray-400 text-xs font-bold uppercase tracking-widest">Materials</span>
                <div class="flex gap-2">
                  <button id="newLockBtn" data-command="settings/toggleLock" class="premium-control-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center">
                    <i class="fa fa-lock-open mr-2"></i>
                    <span>锁定</span>
                  </button>
                  <button id="moreMaterialsBtn" class="premium-control-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center">
                    <i class="fa fa-plus mr-2"></i>更多
                  </button>
                </div>
              </div>
              <div id="materialListContainer" class="grid grid-cols-2 gap-4"></div>
            </div>
            
            <!-- 场景预设 -->
            <div class="scene-content hidden pb-10">
              <div class="grid grid-cols-2 gap-4">
                <button class="premium-control-btn rounded-2xl p-6 flex flex-col items-center justify-center">
                  <i class="fa fa-cocktail text-2xl mb-3 text-blue-400"></i>
                  <span class="text-sm font-bold">浪漫</span>
                </button>
                <button class="premium-control-btn rounded-2xl p-6 flex flex-col items-center justify-center">
                  <i class="fa fa-glass-cheers text-2xl mb-3 text-purple-400"></i>
                  <span class="text-sm font-bold">派对</span>
                </button>
                <button class="premium-control-btn rounded-2xl p-6 flex flex-col items-center justify-center">
                  <i class="fa fa-music text-2xl mb-3 text-pink-400"></i>
                  <span class="text-sm font-bold">节奏</span>
                </button>
                <button class="premium-control-btn rounded-2xl p-6 flex flex-col items-center justify-center">
                  <i class="fa fa-film text-2xl mb-3 text-red-400"></i>
                  <span class="text-sm font-bold">电影</span>
                </button>
              </div>
            </div>
            
            <!-- 互动内容 -->
            <div class="interaction-content hidden pb-10">
              <div class="flex flex-col items-center justify-center py-20 bg-white/5 rounded-[2rem] border border-white/5">
                <i class="fa fa-comments text-4xl text-gray-600 mb-4"></i>
                <p class="text-gray-500 font-bold">互动功能敬请期待</p>
              </div>
            </div>
          </div>
        </div>`;

    // 更新面板内容
    panel.innerHTML = `
      <div id="${panelId}-overlay" class="fixed inset-0 bg-black/40 backdrop-blur-sm opacity-0 transition-opacity duration-300 pointer-events-none"></div>
      ${panelContent}
    `;
    // 标记面板已创建完成
    panel.dataset.panelReady = 'true';

    // 初始化主题切换图标显示并绑定点击事件
    const themeToggleBtn = panel.querySelector('#themeToggle');
    if (themeToggleBtn) {
      const html = document.documentElement;
      const isDark = html.classList.contains('dark');
      const moonIcon = themeToggleBtn.querySelector('.fa-moon');
      const sunIcon = themeToggleBtn.querySelector('.fa-sun');
      if (moonIcon && sunIcon) {
        moonIcon.style.display = isDark ? 'block' : 'none';
        sunIcon.style.display = isDark ? 'none' : 'block';
      }
      themeToggleBtn.addEventListener('click', () => {
        try {
          if (window.handleThemeToggleClick) {
            window.handleThemeToggleClick();
          }
        } catch (e) {
          console.warn('主题切换失败:', e);
        }
      });
    }

    // 绑定标签切换事件
    const tabButtons = panel.querySelectorAll('.tab-btn');
    const contentAreas = panel.querySelectorAll('.material-content, .scene-content, .live-content, .interaction-content');

    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const tabId = button.dataset.tab;

        // 更新按钮状态
        tabButtons.forEach(btn => {
          btn.classList.remove('active', 'bg-red-600', 'text-white', 'shadow-lg', 'shadow-red-500/20');
          btn.classList.add('text-gray-400');
          btn.style.fontWeight = '500';
        });

        // 为当前按钮添加激活样式
        button.classList.remove('text-gray-400');
        button.classList.add('active', 'bg-red-600', 'text-white', 'shadow-lg', 'shadow-red-500/20');
        button.style.fontWeight = 'bold';

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
        console.warn('服务初始化失败:', e);
      }
    })();

    // 更多素材按钮 - 修改为打开完整的素材库模态框
    const moreBtn = panel.querySelector('#moreMaterialsBtn');
    if (moreBtn) {
      moreBtn.addEventListener('click', async () => {
        try {
          await this.initServices();
          // 打开完整的素材库模态框
          await this.navMaterialUI.openModal();
        } catch (e) {
          console.error('打开素材库失败:', e);
          this.toastService && this.toastService.showError('打开素材库失败', 1000);
        }
      });
    }

    // 场景切换按钮（全屏/画中画/壁画）
    const sceneOptions = panel.querySelectorAll('.scene-option');
    sceneOptions.forEach(opt => {
      opt.addEventListener('click', async () => {
        // 若锁定则阻止切换
        const lockBtn = panel.querySelector('#newLockBtn');
        const isLocked = lockBtn && lockBtn.dataset && lockBtn.dataset.locked === 'true';
        if (isLocked) {
          this.toastService && this.toastService.showInfo('场景已锁定，无法切换', 800);
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
          // 移除立即UI更新，等待WebSocket opkey消息触发状态更新
        } catch (e) {
          console.error('发送场景切换失败:', e);
          this.toastService && this.toastService.showError('操作失败', 1000);
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
          // 移除立即UI更新，等待WebSocket opkey消息触发状态更新
        } catch (e) {
          console.error('场景锁定操作失败:', e);
          this.toastService && this.toastService.showError('操作失败', 1000);
        }
      });
    }

    // 关闭面板按钮
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (window.bottomNavUI && typeof window.bottomNavUI.closePanel === 'function') {
          window.bottomNavUI.closePanel(panelId);
        } else {
          panel.classList.add('hidden');
        }
      });
    }

    // 点击遮罩层关闭
    const overlay = panel.querySelector(`#${panelId}-overlay`);
    if (overlay) {
      overlay.addEventListener('click', () => {
        if (window.bottomNavUI && typeof window.bottomNavUI.closePanel === 'function') {
          window.bottomNavUI.closePanel(panelId);
        } else {
          panel.classList.add('hidden');
        }
      });
    }
    // 启用WebSocket状态同步
    this.initWebSocketSync();
  }
}

// 创建并导出画面管理UI实例
const displayUI = new DisplayUI();
export default displayUI;
