// 延迟导入，避免循环依赖
let bottomNavService;
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
    // 已选歌曲数量
    this.selectedSongCount = 0;
    // WebSocket取消订阅函数
    this.wsUnsubscribe = null;
    // 键盘状态
    this._keyboardOpen = false;
    this._keyboardListenersBound = false;
  }
  
  /**
   * 初始化服务
   */
  async initServices() {
    // 优先从全局 window 获取以避免模块导入顺序问题
    bottomNavService = window.bottomNavService || bottomNavService;
    smartlUI = window.smartlUI || smartlUI;
    displayUI = window.displayUI || displayUI;
    selectedUI = window.selectedUI || selectedUI;
    langService = window.langService || langService;

    this.bottomNavService = bottomNavService;
    this.smartlUI = smartlUI;
    this.displayUI = displayUI;
    this.selectedUI = selectedUI;
    this.langService = langService;
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
          this.langService.init()
            .then(() => this.updateNavLabels())
            .catch(error => console.warn('[BottomNavUI] 语言加载失败:', error));
        }
      }
    } catch (e) {
      console.warn('[BottomNavUI] 初始化服务失败:', e);
    }
    
    // 创建底部导航栏元素
    const navElement = document.createElement('footer');
    navElement.id = 'bottom-nav';
    navElement.className = 'fixed bottom-0 left-0 right-0 z-[10005] premium-nav-base rounded-t-[1.5rem]';
    
    // 默认导航项
    const defaultItems = [
      { id: 'smart', icon: 'fa-magic', text: '控制', langKey: 'smartControl' },
      { id: 'scene', icon: 'fa-image', text: '场景', langKey: 'scene' },
      { id: 'selected', icon: 'fa-music', text: '已选', langKey: 'selected' }
    ];
    
    // 使用传入的items或默认items
    const navItems = items || defaultItems;
    
    // 构建导航栏HTML（添加徽标容器）
    let navHTML = '<div class="flex justify-around items-center pt-2 pb-1">';
    navItems.forEach(item => {
      // 为已选按钮添加徽标容器，初始状态为隐藏
      const badgeHTML = item.id === 'selected' ? '<span id="selected-badge" class="selected-badge absolute top-1 right-4 bg-red-500 text-white text-[0.6rem] font-bold rounded-full h-4 min-w-[1rem] px-1 flex items-center justify-center hidden border border-slate-900">0</span>' : '';
      const translated = this.langService?.t(item.langKey);
      const labelText = translated && translated !== item.langKey ? translated : item.text;
       
      navHTML += `
        <button data-panel="${item.id}" class="control-btn bottom-nav-btn flex flex-col items-center justify-center pt-1 pb-1 px-4 relative group transition-all duration-300">
          <div class="nav-icon-wrapper p-1.5 rounded-xl transition-all duration-300 group-[.active]:bg-red-500/10 group-[.active]:shadow-[0_0_15px_rgba(239,68,68,0.2)]">
            <i class="fa ${item.icon} text-xl text-gray-400 group-[.active]:text-red-500 transition-colors duration-300"></i>
          </div>
          <span class="text-[0.6rem] mt-0.5 font-bold tracking-wider text-gray-500 group-[.active]:text-red-500 transition-colors duration-300 uppercase" data-lang-key="${item.langKey}">${labelText}</span>
          ${badgeHTML}
          <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-red-500 opacity-0 group-[.active]:opacity-100 transition-opacity"></div>
        </button>`;
     });
     navHTML += '\n      </div>';
     
     navElement.innerHTML = navHTML;
     
     // 添加到页面
     document.body.appendChild(navElement);
     
     // 绑定事件
     this.bindNavEvents();
     
    // 监听语言变化并更新导航标签
    if (this.langService) {
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

    // 监听面板关闭事件
     document.addEventListener('closePanel', (e) => {
       this.closePanel(e.detail.panelId);
     });
     
     // 初始化徽标数据同步
     this.initBadgeSync();
 
     // 徽标更新统一由 SongSyncManager 驱动
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
    if (navElement) {
      navElement.querySelectorAll('.bottom-nav-btn').forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const panelId = e.currentTarget.dataset.panel;
          // 切换面板
          this.togglePanel(panelId);
        });
      });
    } else {
      console.warn('未找到底部导航栏元素');
    }
  }
  
  /**
   * 切换面板
   * @param {string} panelId - 面板ID
   */
   async togglePanel(panelId) {
    console.log(`[BottomNavUI] 正在切换面板: ${panelId}`);
    // 确保服务已初始化
    await this.initServices();
    
    // 如果当前有打开的面板，先关闭它
    if (this.currentOpenPanel && this.currentOpenPanel !== panelId) {
      console.log(`[BottomNavUI] 关闭当前已打开的面板: ${this.currentOpenPanel}`);
      this.closePanel(this.currentOpenPanel);
    }
    
    // 获取面板元素
    let panel = document.getElementById(`${panelId}-panel`);
    
    if (!panel) {
      console.log(`[BottomNavUI] 面板 ${panelId} 未创建，开始创建...`);
      // 如果面板不存在，创建它（createPanel 内部含所有内容）
      await this.createPanel(panelId);
      panel = document.getElementById(`${panelId}-panel`);
      if (!panel) {
        console.error(`[BottomNavUI] 创建面板 ${panelId} 后仍然找不到面板元素`);
        return;
      }
      console.log(`[BottomNavUI] 面板 ${panelId} 创建成功，准备显示`);
      this.showPanel(panelId, panel);
      return;
    }
    
    // 面板已存在
    if (panel.classList.contains('hidden')) {
      console.log(`[BottomNavUI] 显示已存在的面板: ${panelId}`);
      this.showPanel(panelId, panel);
      // 已选面板每次打开都刷新数据
      if (panelId === 'selected' && this.selectedUI && typeof this.selectedUI.refreshSelectedList === 'function') {
        this.selectedUI.refreshSelectedList(panelId);
      }
    } else {
      console.log(`[BottomNavUI] 关闭已存在的面板: ${panelId}`);
      this.closePanel(panelId);
    }
  }
  
  /**
   * 创建面板
   * @param {string} panelId - 面板ID
   */
  async createPanel(panelId) {
    // 创建空的面板容器，内容完全由各UI模块填充
    const panel = document.createElement('div');
    panel.id = `${panelId}-panel`;
    panel.className = 'fixed inset-0 z-[10100] hidden';
    // 不预设 innerHTML，让各模块自己写完整结构
    document.body.appendChild(panel);
    
    // 根据面板类型调用对应的模块来创建内容
    try {
      switch (panelId) {
        case 'smart':
          await smartlUI.createSmartlPanel(panelId);
          break;
        case 'scene':
          await displayUI.createDisplayPanel(panelId);
          break;
        case 'selected':
          if (!selectedUI) {
            throw new Error('selectedUI 未定义');
          }
          if (typeof selectedUI.createSelectedPanel !== 'function') {
            throw new Error('selectedUI.createSelectedPanel 不是函数');
          }
          await selectedUI.createSelectedPanel(panelId);
          break;
        default:
          this.setupDefaultPanel(panelId, panel);
      }
    } catch (error) {
      console.error(`[BottomNavUI] 创建面板 ${panelId} 失败:`, error);
      this.setupErrorPanel(panelId, panel, error.message);
    }
  }
  
  /**
   * 设置默认面板内容
   * @param {string} panelId - 面板ID
   * @param {HTMLElement} panel - 面板元素
   */
  setupDefaultPanel(panelId, panel) {
    const panelContent = `
      <div class="panel-overlay fixed inset-0 bg-black/20 backdrop-blur z-10 opacity-0 transition-opacity duration-300" id="${panelId}-overlay" style="bottom:80px;"></div>
      <div class="fixed bottom-[80px] left-0 right-0 bg-white dark:bg-gray-800 rounded-t-2xl p-4 h-[70vh] overflow-hidden z-20 transform translate-y-full transition-transform duration-300">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-bold text-gray-800 dark:text-white">${panelId}面板</h3>
          <button class="control-btn p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 close-panel-btn">
            <i class="fa fa-times text-lg"></i>
          </button>
        </div>
        <div class="text-center py-10">
          <p class="text-gray-500 dark:text-gray-400">${panelId}内容区域</p>
        </div>
      </div>`;
    
    panel.innerHTML = panelContent;
    
    // 重新绑定关闭事件
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closePanel(panelId);
      });
    }
    
    // 绑定遮罩层点击事件
    const overlay = panel.querySelector(`#${panelId}-overlay`);
    if (overlay) {
      overlay.addEventListener('click', () => {
        this.closePanel(panelId);
      });
    }
    
    // 显示面板
    this.showPanel(panelId, panel);
  }
  
  /**
   * 设置错误面板内容
   * @param {string} panelId - 面板ID
   * @param {HTMLElement} panel - 面板元素
   * @param {string} errorMessage - 错误信息
   */
  setupErrorPanel(panelId, panel, errorMessage) {
    const panelContent = `
      <div class="fixed inset-0 bg-black/20 backdrop-blur z-10 opacity-0 transition-opacity duration-300" id="${panelId}-overlay"></div>
      <div class="fixed bottom-[80px] left-0 right-0 bg-white dark:bg-gray-800 rounded-t-2xl p-4 h-[70vh] overflow-hidden z-20 transform translate-y-full transition-transform duration-300">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-bold text-gray-800 dark:text-white">${panelId}面板</h3>
          <button class="control-btn p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 close-panel-btn">
            <i class="fa fa-times text-lg"></i>
          </button>
        </div>
        <div class="text-center py-10">
          <p class="text-red-500 dark:text-red-400">加载失败: ${errorMessage}</p>
        </div>
      </div>`;
    
    panel.innerHTML = panelContent;
    
    // 重新绑定关闭事件
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closePanel(panelId);
      });
    }
    
    // 绑定遮罩层点击事件
    const overlay = panel.querySelector(`#${panelId}-overlay`);
    if (overlay) {
      overlay.addEventListener('click', () => {
        this.closePanel(panelId);
      });
    }
    
    // 显示面板
    this.showPanel(panelId, panel);
  }
  
  /**
   * 显示面板
   * @param {string} panelId - 面板ID
   * @param {HTMLElement} panel - 面板元素
   */
   showPanel(panelId, panel) {
    if (!panel) {
      panel = document.getElementById(`${panelId}-panel`);
      if (!panel) {
        console.error(`[BottomNavUI] showPanel 找不到面板元素: ${panelId}-panel`);
        return;
      }
    }
    
    console.log(`[BottomNavUI] 正在显示面板: ${panelId}`);
    
    // 显示面板容器
    panel.classList.remove('hidden');
    
    // 用两帧动画：第1帧确保元素可见，第2帧触发 transform 动画
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const overlay = panel.querySelector(`#${panelId}-overlay`);
        const content = panel.querySelector('.premium-panel-base');
        
        if (overlay) {
          overlay.style.opacity = '1';
          overlay.classList.remove('pointer-events-none');
        } else {
          console.warn(`[BottomNavUI] showPanel 未找到 overlay: #${panelId}-overlay`);
        }
        
        if (content) {
          content.style.transform = 'translateY(0)';
          console.log(`[BottomNavUI] 面板内容动画已启动: ${panelId}`);
        } else {
          console.warn(`[BottomNavUI] showPanel 未找到 content: .premium-panel-base`);
        }
        
        // 设置按钮激活状态
        const activeBtn = document.querySelector(`.bottom-nav-btn[data-panel="${panelId}"]`);
        if (activeBtn) {
          document.querySelectorAll('.bottom-nav-btn').forEach(btn => btn.classList.remove('active'));
          activeBtn.classList.add('active');
        }
      });
    });
    
    this.currentOpenPanel = panelId;
  }
  
  /**
   * 关闭面板
   * @param {string} panelId - 面板ID
   */
  closePanel(panelId) {
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;
    
    const overlay = panel.querySelector(`#${panelId}-overlay`);
    const content = panel.querySelector('.premium-panel-base');
    
    if (overlay) {
      overlay.style.opacity = '0';
      overlay.classList.add('pointer-events-none');
    }
    
    if (content) {
      content.style.transform = 'translateY(120%)';
    }
    
    setTimeout(() => {
      panel.classList.add('hidden');
      const navBtn = document.querySelector(`.bottom-nav-btn[data-panel="${panelId}"]`);
      if (navBtn) navBtn.classList.remove('active');
      if (this.currentOpenPanel === panelId) this.currentOpenPanel = null;
    }, 500);
  }

  /**
   * 初始化WebSocket监听器 (已弃用，改由 SongSyncManager 集中管理)
   */
  initWebSocketListener() {
    // 逻辑已移除，减少冗余订阅
  }

  /**
   * 更新已选徽标显示
   * @param {number} count - 已选歌曲数量
   */
  updateSelectedBadge(count) {
    // 更新内部计数
    this.selectedSongCount = count;
    
    // 首先尝试通过ID直接查找徽标元素（最可靠的方法）
    const badge = document.getElementById('selected-badge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
      } else {
        // 即使数量为0，也要确保徽标正确隐藏
        badge.classList.add('hidden');
      }
    } else {
      console.warn('[BottomNavUI] 未找到ID为selected-badge的徽标元素');
      // 如果通过ID找不到，则使用原来的查找方法
      const selectedBtn = document.querySelector('.bottom-nav-btn[data-panel="selected"]');
      if (selectedBtn) {
        const badgeByQuery = selectedBtn.querySelector('.selected-badge');
        if (badgeByQuery) {
          if (count > 0) {
            badgeByQuery.textContent = count > 99 ? '99+' : count;
            badgeByQuery.classList.remove('hidden');
          } else {
            badgeByQuery.classList.add('hidden');
          }
        } else {
          console.warn('[BottomNavUI] 未找到徽标元素');
          // 如果未找到徽标元素，尝试重新查找并创建
          this._createBadgeElement(selectedBtn, count);
        }
      } else {
        console.warn('[BottomNavUI] 未找到已选按钮');
        // 如果未找到已选按钮，等待DOM更新后重试
        setTimeout(() => {
          this._retryUpdateBadge(count);
        }, 100);
      }
    }
  }
  
  /**
   * 创建徽标元素（备用方案）
   * @param {HTMLElement} parent - 父元素
   * @param {number} count - 数量
   */
  _createBadgeElement(parent, count) {
    // 检查是否已经存在徽标元素
    const existingBadge = parent.querySelector('.selected-badge');
    if (existingBadge) {
      return;
    }
    
    // 创建新的徽标元素
    const badge = document.createElement('span');
    badge.className = 'selected-badge absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center';
    if (count <= 0) {
      badge.classList.add('hidden');
    }
    badge.textContent = count > 99 ? '99+' : count;
    
    parent.appendChild(badge);
  }
  
  /**
   * 重试更新徽标（备用方案）
   * @param {number} count - 数量
   */
  _retryUpdateBadge(count) {
    const selectedBtn = document.querySelector('.bottom-nav-btn[data-panel="selected"]');
    if (selectedBtn) {
      const badge = selectedBtn.querySelector('.selected-badge');
      if (badge) {
        if (count > 0) {
          badge.textContent = count > 99 ? '99+' : count;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      } else {
        this._createBadgeElement(selectedBtn, count);
      }
    }
  }
  
  /**
   * 初始化徽标数据同步
   */
  async initBadgeSync() {
    try {
      if (this._badgeSyncCleanup) {
        this._badgeSyncCleanup();
        this._badgeSyncCleanup = null;
      }

      let songSyncManager = window.songSyncManager || null;
      if (!songSyncManager && window.moduleLoader) {
        songSyncManager = await window.moduleLoader.load('songSyncManager');
      }

      if (songSyncManager && typeof songSyncManager.addSyncListener === 'function') {
        this._badgeSyncCleanup = songSyncManager.addSyncListener(() => {
          const songService = window.songService;
          // 修正：优先使用 selectedSongs.length 以显示队列总数，而不是 unique 歌曲数 (requestedSongs.size)
          const count = Array.isArray(songService?.selectedSongs) 
            ? songService.selectedSongs.length 
            : (songService?.requestedSongs instanceof Set ? songService.requestedSongs.size : 0);
          this.updateSelectedBadge(Number(count) || 0);
        });
      }

      // 立即从服务器获取最新数据（立即执行，不等待）
      this.updateBadgeFromServer();
    } catch (error) {
      console.error('[BottomNavUI] 初始化徽标数据同步失败:', error);
    }
  }

  /**
   * 从服务器获取最新的徽标数量并更新显示
   */
  async updateBadgeFromServer() {
    try {
      // 首先尝试使用全局songService（最快的方式）
      if (typeof window !== 'undefined' && window.songService && window.songService.apiService) {
        const response = await window.songService.apiService.getPlayList();
        
        let total = 0;
        if (response && response.data) {
          if (Array.isArray(response.data)) {
            total = response.data.length;
          } else if (typeof response.data.total !== 'undefined') {
            total = response.data.total;
          }
        }
        
        this.updateSelectedBadge(total);
        return; // 成功获取后立即返回
      }
      
      // 如果全局songService不可用，尝试初始化服务
      await this.initServices();
      
      if (this.bottomNavService && this.bottomNavService.getPlayListCounts) {
        // 通过服务获取播放列表数量
        const counts = await this.bottomNavService.getPlayListCounts();
        // 确保counts.totalCount 是数字类型
        const count = (counts && typeof counts.totalCount !== 'undefined') ? counts.totalCount : 0;
        
        // 更新徽标显示（使用已选列表的数量）
        this.updateSelectedBadge(Number(count) || 0);
      } else {
        console.warn('[BottomNavUI] 无法获取bottomNavService或getPlayListCounts方法');
        
        // 最后的保障：至少尝试从缓存获取数量
        if (typeof window !== 'undefined' && window.songService) {
          this.updateSelectedBadge(window.songService.selectedSongs?.length || 0);
        }
      }
    } catch (error) {
      console.error('[BottomNavUI] 从服务器获取徽标数量失败:', error);
      // 最后的保障：至少尝试从缓存获取数量
      if (typeof window !== 'undefined' && window.songService) {
        this.updateSelectedBadge(window.songService.selectedSongs?.length || 0);
      }
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
};

// 键盘感知隐藏/显示底部导航
BottomNavUI.prototype.attachKeyboardAwareBehavior = function() {
  if (this._keyboardListenersBound) return;
  const nav = () => document.getElementById('bottom-nav');
  const hideNav = () => { const el = nav(); if (el) el.classList.add('hidden'); this._keyboardOpen = true; };
  const showNav = () => { const el = nav(); if (el) el.classList.remove('hidden'); this._keyboardOpen = false; };

  // 基于 visualViewport 的检测（iOS/现代浏览器）
  if (window.visualViewport) {
    const onViewportChange = () => {
      // 当可视高度显著变小（>100px）视为键盘打开
      const keyboardLikelyOpen = (window.innerHeight - window.visualViewport.height) > 100;
      if (keyboardLikelyOpen) hideNav(); else showNav();
    };
    window.visualViewport.addEventListener('resize', onViewportChange);
    window.visualViewport.addEventListener('scroll', onViewportChange);
  } else {
    // 回退：窗口resize时尝试判断
    const onWindowResize = () => {
      // 简单回退策略：若有输入聚焦则隐藏
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) hideNav(); else showNav();
    };
    window.addEventListener('resize', onWindowResize);
  }

  // 监听输入聚焦/失焦
  const onFocusIn = (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) hideNav();
  };
  const onFocusOut = (e) => {
    // 延时，避免立即切换时闪烁
    setTimeout(() => {
      const active = document.activeElement;
      if (!(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable))) {
        showNav();
      }
    }, 100);
  };
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);

  this._keyboardListenersBound = true;
};
