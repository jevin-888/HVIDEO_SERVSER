// 延迟导入，避免循环依赖
// VERSION: 2026-03-11-MOBILE-ALIGN-WITH-CLIENT
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
  }
  
  /**
   * 初始化服务
   */
  async initServices() {
    // 优先从全局 window 获取以避免模块导入顺序问题
    smartlService = window.smartlService || smartlService;
    this.smartlService = smartlService;
    return true;
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

    // 面板已创建过则直接复用
    if (panel.dataset.panelReady === 'true') {
      return;
    }
    
    // 确保服务已初始化
    await this.initServices();
    
    // 创建智控面板内容
    const panelContent = `
        <div class="fixed inset-x-0 bottom-0 z-[10006] premium-panel-base mobile-panel-unified mobile-smart-panel text-white transform translate-y-[120%] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]">
          
          <!-- Handle -->
          <div class="smart-panel-handle w-12 h-1.5 bg-white/20 rounded-full mx-auto mt-3 mb-1"></div>

          <div class="smart-panel-header">
            <div class="flex justify-between items-center mb-2">
              <h3 class="text-xl font-black gradient-text">智控中心</h3>
              <button class="w-10 h-10 flex items-center justify-center bg-white/5 rounded-full text-white/60 hover:text-white transition-colors close-panel-btn">
                <i class="fa fa-times"></i>
              </button>
            </div>

            <!-- 标签导航 -->
            <div class="premium-tab-container flex space-x-1 rounded-2xl">
              <button class="tab-btn flex-1 px-4 py-3 text-sm font-bold rounded-xl transition-all duration-300 active bg-red-600 text-white shadow-lg shadow-red-500/20" data-tab="audio">
                <i class="fa fa-music mr-2"></i>音效
              </button>
              <button class="tab-btn flex-1 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-300 text-gray-400" data-tab="ac">
                <i class="fa fa-wind mr-2"></i>空调
              </button>
              <button class="tab-btn flex-1 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-300 text-gray-400" data-tab="light">
                <i class="fa fa-lightbulb mr-2"></i>灯光
              </button>
            </div>
          </div>

          <!-- 内容区域 -->
          <div class="smart-panel-content">
            <!-- 音效控制 -->
            <div class="tab-content" id="audio-tab">
              <div class="smart-volume-controls">
                <!-- 音乐音量控制 -->
                <div class="volume-control">
                  <div class="volume-label">
                    <span class="text-xs font-bold text-gray-400">音乐</span>
                    <span id="music-volume" class="text-base font-black text-white">0</span>
                  </div>
                  <div class="volume-actions">
                    <button aria-label="音乐音量减" class="control-btn premium-control-btn rounded-xl flex items-center justify-center active:scale-90" data-volume="music-down">
                      <i class="fa fa-minus text-xs"></i>
                    </button>
                    <div class="flex-1 premium-progress-bg h-1.5 rounded-full overflow-hidden">
                      <div id="music-progress" class="premium-progress-fill h-full transition-all duration-300" style="width: 0%"></div>
                    </div>
                    <button aria-label="音乐音量加" class="control-btn premium-control-btn rounded-xl flex items-center justify-center active:scale-90" data-volume="music-up">
                      <i class="fa fa-plus text-xs"></i>
                    </button>
                  </div>
                </div>

                <!-- 话筒音量控制 -->
                <div class="volume-control">
                  <div class="volume-label">
                    <span class="text-xs font-bold text-gray-400">麦克风</span>
                    <span id="mic-volume" class="text-base font-black text-white">0</span>
                  </div>
                  <div class="volume-actions">
                    <button aria-label="麦克风音量减" class="control-btn premium-control-btn rounded-xl flex items-center justify-center active:scale-90" data-volume="mic-down">
                      <i class="fa fa-minus text-xs"></i>
                    </button>
                    <div class="flex-1 premium-progress-bg h-1.5 rounded-full overflow-hidden">
                      <div id="mic-progress" class="premium-progress-fill h-full transition-all duration-300" style="width: 0%"></div>
                    </div>
                    <button aria-label="麦克风音量加" class="control-btn premium-control-btn rounded-xl flex items-center justify-center active:scale-90" data-volume="mic-up">
                      <i class="fa fa-plus text-xs"></i>
                    </button>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-3 gap-2.5 mb-4" id="audio-buttons">
                <button class="control-btn premium-control-btn rounded-xl py-2.5 flex flex-col items-center justify-center" data-command="repeat">
                  <i class="fa fa-redo text-base mb-1"></i>
                  <span class="text-[0.6rem] font-bold zh-label" data-lang-key="repeat">重播</span>
                  <span class="text-[0.6rem] font-bold indonesian-translation">Ulang</span>
                  <span class="text-[0.6rem] font-bold en-translation">Repeat</span>
                  <span class="text-[0.6rem] font-bold vi-translation">Hát lại</span>
                </button>
                <button class="control-btn premium-control-btn rounded-xl py-2.5 flex flex-col items-center justify-center" data-command="pause">
                  <i class="fa fa-pause text-base mb-1"></i>
                  <span class="text-[0.6rem] font-bold zh-label" data-lang-key="pause">暂停</span>
                  <span class="text-[0.6rem] font-bold indonesian-translation">Jeda</span>
                  <span class="text-[0.6rem] font-bold en-translation">Pause</span>
                  <span class="text-[0.6rem] font-bold vi-translation">Tạm dừng</span>
                </button>
                <button class="control-btn premium-control-btn rounded-xl py-2.5 flex flex-col items-center justify-center" data-command="mute">
                  <i class="fa fa-volume-mute text-base mb-1"></i>
                  <span class="text-[0.6rem] font-bold zh-label" data-lang-key="mute">静音</span>
                  <span class="text-[0.6rem] font-bold indonesian-translation">Bisukan</span>
                  <span class="text-[0.6rem] font-bold en-translation">Mute</span>
                  <span class="text-[0.6rem] font-bold vi-translation">Tắt tiếng</span>
                </button>
                <button class="control-btn premium-control-btn rounded-xl py-2.5 flex flex-col items-center justify-center" data-command="next">
                  <i class="fa fa-step-forward text-base mb-1 text-red-500"></i>
                  <span class="text-[0.6rem] font-bold zh-label" data-lang-key="next">切歌</span>
                  <span class="text-[0.6rem] font-bold indonesian-translation">Lanjut</span>
                  <span class="text-[0.6rem] font-bold en-translation">Next</span>
                  <span class="text-[0.6rem] font-bold vi-translation">Bài tiếp</span>
                </button>
                <button class="control-btn premium-control-btn rounded-xl py-2.5 flex flex-col items-center justify-center" data-command="original">
                  <i class="fa fa-microphone-alt text-base mb-1"></i>
                  <span class="text-[0.6rem] font-bold zh-label" data-lang-key="vocal">原唱</span>
                  <span class="text-[0.6rem] font-bold indonesian-translation">Vokal</span>
                  <span class="text-[0.6rem] font-bold en-translation">Vocal</span>
                  <span class="text-[0.6rem] font-bold vi-translation">Hát cùng</span>
                </button>
                <button class="control-btn premium-control-btn rounded-xl py-2.5 flex flex-col items-center justify-center" data-command="audio/effect/cycle">
                  <i class="fa fa-magic text-base mb-1"></i>
                  <span class="text-[0.6rem] font-bold">音效</span>
                </button>
              </div>
            </div>

            <!-- 空调控制 -->
            <div class="tab-content hidden" id="ac-tab">
              <div class="bg-white/5 rounded-xl p-3 mb-3 border border-white/5 flex flex-col items-center">
                <span class="text-gray-400 text-[0.6rem] font-bold mb-1.5 uppercase tracking-widest">Temperature</span>
                <div class="flex items-center gap-5">
                  <button class="control-btn premium-control-btn w-9 h-9 rounded-full flex items-center justify-center" data-command="consumer/clickButton/temMinusButton">
                    <i class="fa fa-minus text-xs"></i>
                  </button>
                  <span class="text-3xl font-black gradient-text">26°</span>
                  <button class="control-btn premium-control-btn w-9 h-9 rounded-full flex items-center justify-center" data-command="consumer/clickButton/temAddButton">
                    <i class="fa fa-plus text-xs"></i>
                  </button>
                </div>
              </div>
              
              <div class="grid grid-cols-3 gap-2 mb-3" id="ac-buttons">
                <button class="control-btn premium-control-btn rounded-lg py-2.5 flex flex-col items-center justify-center" data-command="consumer/clickButton/windLowerButton">
                  <i class="fa fa-leaf text-base mb-1"></i>
                  <span class="text-[0.6rem] font-bold">微风</span>
                </button>
                <button class="control-btn premium-control-btn rounded-lg py-2.5 flex flex-col items-center justify-center" data-command="consumer/clickButton/windMidButton">
                  <i class="fa fa-wind text-base mb-1"></i>
                  <span class="text-[0.6rem] font-bold">中风</span>
                </button>
                <button class="control-btn premium-control-btn rounded-lg py-2.5 flex flex-col items-center justify-center" data-command="consumer/clickButton/windHighButton">
                  <i class="fa fa-bolt text-base mb-1"></i>
                  <span class="text-[0.6rem] font-bold">强风</span>
                </button>
                <button class="control-btn premium-control-btn rounded-lg py-2.5 flex flex-col items-center justify-center" data-command="consumer/clickButton/coolButton">
                  <i class="fa fa-snowflake text-base mb-1"></i>
                  <span class="text-[0.6rem] font-bold">制冷</span>
                </button>
                <button class="control-btn premium-control-btn rounded-lg py-2.5 flex flex-col items-center justify-center" data-command="consumer/clickButton/hotButton">
                  <i class="fa fa-fire-alt text-base mb-1"></i>
                  <span class="text-[0.6rem] font-bold">制热</span>
                </button>
                <button class="control-btn premium-control-btn rounded-lg py-2.5 flex flex-col items-center justify-center" data-command="consumer/clickButton/ktOpenButton">
                  <i class="fa fa-power-off text-base mb-1"></i>
                  <span class="text-[0.6rem] font-bold">电源</span>
                </button>
              </div>
            </div>

            <!-- 灯光控制 -->
            <div class="tab-content hidden h-full" id="light-tab">
              <div class="grid grid-cols-2 gap-4 pb-10" id="light-buttons">
                <!-- 灯光按钮将动态生成 -->
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
    
    // 生成动态灯光按钮
    this.generateLightButtons();
    
    // 绑定事件
    this.bindPanelEvents(panelId);
    
    // 初始化WebSocket状态同步
    this.initWebSocketSync();
    
    // 移除平板设备优化，避免按钮尺寸被强制变大
    // setTimeout(() => this.optimizeForTablet(), 100);
    
    
    // 面板创建后立即根据当前服务状态更新所有UI（包括从API同步来的初始音量等）
    if (typeof this.updateAllUI === 'function') {
      this.updateAllUI();
    }
  }
  
  /**
   * 优化平板设备显示
   */
  optimizeForTablet() {
    // 检查是否为平板设备
    const isTablet = window.innerWidth >= 641 && window.innerWidth <= 1024;
    if (!isTablet) return;
    
    // 获取音频按钮容器
    const audioButtons = document.getElementById('audio-buttons');
    if (audioButtons) {
      // 调整音频按钮样式
      audioButtons.style.minHeight = '200px';
      
      // 调整音频按钮
      const buttons = audioButtons.querySelectorAll('.control-btn');
      buttons.forEach(btn => {
        btn.style.minHeight = '80px';
        btn.style.padding = '1rem';
        
        const icon = btn.querySelector('i');
        if (icon) {
          icon.style.fontSize = '1.25rem';
          icon.style.marginBottom = '0.5rem';
        }
        
        const text = btn.querySelector('span');
        if (text) {
          text.style.fontSize = '0.875rem';
        }
      });
    }
    
    // 优化标签导航栏
    const tabButtons = document.querySelectorAll('.tab-btn');
    if (tabButtons.length > 0) {
      tabButtons.forEach(btn => {
        btn.style.minHeight = '50px';
        btn.style.paddingTop = '1rem';
        btn.style.paddingBottom = '1rem';
        
        const text = btn.querySelector('span');
        if (text) {
          text.style.fontSize = '1rem';
        }
        
        // 调整按钮内的文字大小
        btn.style.fontSize = '1rem';
      });
    }
  }
  
  /**
   * 生成灯光按钮
   */
  async generateLightButtons() {
    try {
      // 确保服务已初始化
      await this.initServices();
      
      // 先尝试从缓存获取灯光数据
      let lightDicts = null;
      if (this.smartlService && typeof this.smartlService.getDictFromCache === 'function') {
        lightDicts = this.smartlService.getDictFromCache('light');
        console.log('[SmartlUI] 缓存数据是否为数组:', Array.isArray(lightDicts));
        if (Array.isArray(lightDicts)) {
        }
      }
      
      // 如果缓存中没有，尝试获取
      if (!lightDicts || !Array.isArray(lightDicts) || lightDicts.length === 0) {
        if (this.smartlService && typeof this.smartlService.getDict === 'function') {
          lightDicts = await this.smartlService.getDict('light');
          console.log('[SmartlUI] 服务器数据是否为数组:', Array.isArray(lightDicts));
          if (Array.isArray(lightDicts)) {
          }
        }
      }
      
      // 确保数据是数组格式
      if (!Array.isArray(lightDicts)) {
        console.warn('[SmartlUI] 灯光数据不是数组格式，使用空数组');
        lightDicts = [];
      }
      // 如果仍然没有数据，使用默认值
      if (lightDicts.length === 0) {
        console.warn('[SmartlUI] 未获取到灯光数据，使用默认值');
        lightDicts = [
          { code: '1', name: '柔和' },
          { code: '2', name: '明亮' },
          { code: '8', name: '浪漫' },
          { code: '98', name: '全开' },
          { code: '99', name: '全关' }
        ];
      } else {
        // 确保所有灯光数据都有name字段
        lightDicts = lightDicts.map(dict => {
          // 确保code和name字段存在
          const code = dict.code ?? dict.dictCode ?? dict.dictValue ?? '';
          const name = dict.name ?? dict.dictLabel ?? dict.dictComment ?? '未知';
          return { ...dict, code, name };
        });
        // 检查是否包含特殊的灯光模式（全开/全关）
        const hasLightMode98 = lightDicts.some(dict => String(dict.code) === '98');
        const hasLightMode99 = lightDicts.some(dict => String(dict.code) === '99');
        // 如果没有特殊灯光模式，手动添加
        if (!hasLightMode98) {
          lightDicts.push({ code: '98', name: '全开' });
        }
        if (!hasLightMode99) {
          lightDicts.push({ code: '99', name: '全关' });
        }
      }
      
      // 仅“自动”允许硬编码：若字典未提供，则插入一个“自动”项
      const hasAuto = lightDicts.some(d => String(d.code) === 'auto');
      if (!hasAuto) {
        lightDicts.unshift({ code: 'auto', name: '自动', groupKey: 'light' });
      }
      // 获取灯光按钮容器
      const lightButtonsContainer = document.getElementById('light-buttons');
      if (!lightButtonsContainer) {
        console.error('[SmartlUI] 未找到灯光按钮容器');
        return;
      }
      
      // 生成灯光按钮HTML
      let lightButtonsHTML = '';
      
      // 添加'自动'按钮
      lightButtonsHTML += `
        <div class="scene-option cursor-pointer">
          <button class="scene-btn premium-control-btn rounded-lg p-2 flex flex-col items-center justify-center active:scale-95 transition-all w-full" data-command="light/auto">
            <i class="fa fa-magic text-base mb-1"></i>
            <span class="text-[0.6rem] font-bold">自动</span>
          </button>
        </div>`;
      
      // 分离普通灯光按钮和特殊按钮
      const normalLights = lightDicts.filter(dict => 
        String(dict.code) !== 'auto' && 
        String(dict.code) !== '98' && 
        String(dict.code) !== '99'
      );
      
      const specialLights = lightDicts.filter(dict => 
        String(dict.code) === '98' || 
        String(dict.code) === '99'
      );
      // 生成普通灯光按钮
      normalLights.forEach((dict, index) => {
        const code = dict.code;
        const name = dict.name || '未知';
        const icon = this.getLightIcon(code);
        lightButtonsHTML += `
          <div class="scene-option cursor-pointer">
            <button class="scene-btn premium-control-btn rounded-lg p-2 flex flex-col items-center justify-center active:scale-95 transition-all w-full" data-command="light/${code}">
              <i class="fa ${icon} text-base mb-1"></i>
              <span class="text-[0.6rem] font-bold">${name}</span>
            </button>
          </div>`;
      });
      
      // 生成特殊灯光按钮（全开/全关）
      specialLights.forEach((dict, index) => {
        const code = dict.code;
        const name = dict.name || (String(code) === '98' ? '全开' : '全关');
        const icon = String(code) === '98' ? 'fa-toggle-on text-green-400' : 'fa-toggle-off text-gray-500';
        lightButtonsHTML += `
          <div class="scene-option cursor-pointer">
            <button class="scene-btn premium-control-btn rounded-lg p-2 flex flex-col items-center justify-center active:scale-95 transition-all w-full" data-command="light/${code}">
              <i class="fa ${icon} text-base mb-1"></i>
              <span class="text-[0.6rem] font-bold">${name}</span>
            </button>
          </div>`;
      });
      // 更新灯光按钮容器
      lightButtonsContainer.innerHTML = lightButtonsHTML;
    } catch (error) {
      console.error('[SmartlUI] 生成灯光按钮失败:', error);
      
      // 如果生成失败，使用默认按钮
      const lightButtonsContainer = document.getElementById('light-buttons');
      if (lightButtonsContainer) {
        lightButtonsContainer.innerHTML = `
          <button class="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 flex flex-col items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" data-command="light/auto">
            <i class="fa fa-magic text-lg mb-2 text-gray-700 dark:text-gray-300"></i>
            <span class="text-sm text-gray-700 dark:text-gray-300">自动</span>
          </button>
          <button class="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 flex flex-col items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" data-command="light/98">
            <i class="fa fa-toggle-on text-lg mb-2 text-gray-700 dark:text-gray-300"></i>
            <span class="text-sm text-gray-700 dark:text-gray-300">全开</span>
          </button>
          <button class="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 flex flex-col items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" data-command="light/99">
            <i class="fa fa-toggle-off text-lg mb-2 text-gray-700 dark:text-gray-300"></i>
            <span class="text-sm text-gray-700 dark:text-gray-300">全关</span>
          </button>
          <button class="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 flex flex-col items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" data-command="light/1">
            <i class="fa fa-lightbulb text-lg mb-2 text-yellow-500 dark:text-yellow-500"></i>
            <span class="text-sm text-gray-700 dark:text-gray-300">柔和</span>
          </button>
          <button class="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 flex flex-col items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" data-command="light/2">
            <i class="fa fa-sun text-lg mb-2 text-orange-500 dark:text-orange-500"></i>
            <span class="text-sm text-gray-700 dark:text-gray-300">明亮</span>
          </button>
          <button class="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 flex flex-col items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" data-command="light/8">
            <i class="fa fa-heart text-2xl mb-2 text-purple-500 dark:text-purple-500"></i>
            <span class="text-sm text-gray-700 dark:text-gray-300">浪漫</span>
          </button>`;
      }
    }
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
   * 绑定面板事件
   * @param {string} panelId - 面板ID
   */
  bindPanelEvents(panelId) {
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;
    
    // 绑定标签切换事件
    const tabButtons = panel.querySelectorAll('.tab-btn');
    const tabContents = panel.querySelectorAll('.tab-content');
    
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
          } else {
            content.classList.add('hidden');
          }
        });
      });
    });
    
    // 绑定命令按钮点击事件
    const handlePanelClick = async (e) => {
      // 防止事件重复处理和冲突
      if (e.__smartControlProcessed) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      e.__smartControlProcessed = true;
      
      const commandBtn = e.target.closest('[data-command]');
      if (commandBtn) {
        // 阻止事件冒泡，避免与其他事件监听器冲突
        e.preventDefault();
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
          // 灯光模式按钮点击：本地乐观更新选中态并立即高亮，随后发送命令
          if (command && command.startsWith('light/') && command !== 'light/auto') {
            if (this.smartlService) {
              this.smartlService.updateState({ selectedLightMode: command });
            }
            this.updateLightModeButtonsUI();
          }
          // 发送命令，最终状态以服务端WebSocket同步为准
          await this.handleCommand(command);
        }
      }
      
      // 音量控制
      const volumeBtn = e.target.closest('[data-volume]');
      if (volumeBtn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await this.handleVolumeChange(volumeBtn.dataset.volume);
      }
      
      // 清除事件标记
      setTimeout(() => {
        delete e.__smartControlProcessed;
      }, 0);
    };
    
    // 手机端只用 touchstart，避免 touchstart + click 双重触发
    // 如果不支持 touch（PC调试），降级为 click
    if ('ontouchstart' in window) {
      panel.addEventListener('touchstart', handlePanelClick, { passive: false });
    } else {
      panel.addEventListener('click', handlePanelClick, { passive: false });
    }
    
    // 绑定关闭按钮事件
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        // 触发面板关闭事件
        document.dispatchEvent(new CustomEvent('closePanel', {
          detail: { panelId }
        }));
      });
    }
    
    // 绑定遮罩层点击事件
    const overlay = panel.querySelector(`#${panelId}-overlay`);
    if (overlay) {
      overlay.addEventListener('click', () => {
        // 触发面板关闭事件
        document.dispatchEvent(new CustomEvent('closePanel', {
          detail: { panelId }
        }));
      });
    }
  }
  
  /**
   * 处理命令
   * @param {string} command - 命令
   */
  async handleCommand(command) {
    if (this._processingCommand) return;
    this._processingCommand = command;
    // 超时保护：3秒后强制释放锁
    const lockTimeout = setTimeout(() => { this._processingCommand = null; }, 3000);

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
          case 'coolButton':      mode  = 'cool';    break;
          case 'hotButton':       mode  = 'heat';    break;
          case 'windLowerButton': wind  = 'low';     break;
          case 'windMidButton':   wind  = 'mid';     break;
          case 'windHighButton':  wind  = 'high';    break;
        }

        const payload = { power, temp, mode, wind };
        window.__rawConsole?.log('[AC] 发送:', JSON.stringify(payload));

        const res = await window.apiService.controlAc(payload);
        window.__rawConsole?.log('[AC] 返回:', JSON.stringify(res));

        if (res?.code === 0 && res.data?.ac) {
          const ac = res.data.ac;
          if (this.smartlService) {
            this.smartlService.state.power = ac.power ?? power;
            this.smartlService.state.temp  = ac.temp  ?? temp;
            this.smartlService.state.mode  = ac.mode  ?? mode;
            this.smartlService.state.wind  = ac.wind  ?? wind;
          }
          this._updateAcUI(ac);
        }
        return;
      }

      if (!this.smartlService) throw new Error('smartlService 未初始化');

      const api = window.apiService;
      let result;
      switch (command) {
        case 'repeat':
        case 'pause':
        case 'play':
        case 'resume':
        case 'next':
        case 'original':
        case 'vocal':
          result = await this.smartlService.handlePlaybackCommand(command);
          break;
        case 'mute':
        case 'unmute':
          result = await this.smartlService.handleAudioControlCommand(command);
          break;
        case 'audio/effect/cycle':
          result = await this.smartlService.handleSoundEffectCommand(command);
          break;
        default:
          if (command.startsWith('light/')) {
            result = await this.smartlService.lightingService.handleLightCommand(command);
          } else if (command.startsWith('effect/')) {
            const mode = command.split('/')[1];
            result = await api.controlEffect({ mode });
            if (this.smartlService) this.smartlService.state.soundEffectMode = mode;
          } else {
            console.warn(`[SmartlUI] 未知命令: ${command}`);
          }
      }
      if (typeof this.updateButtonStates === 'function') this.updateButtonStates();

    } catch (error) {
      console.error(`命令 ${command} 执行失败:`, error);
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
    // 温度
    const tempEl = document.querySelector('#ac-tab .text-3xl.font-black');
    if (tempEl) tempEl.textContent = `${ac.temp}°`;

    // 所有空调按钮：用 data-active 属性标记选中态，CSS控制高亮
    const acTab = document.getElementById('ac-tab');
    if (!acTab) return;

    // 开机/关机
    const powerBtn = acTab.querySelector('[data-command="consumer/clickButton/ktOpenButton"], [data-command="consumer/clickButton/ktCloseButton"]');
    if (powerBtn) {
      const icon = powerBtn.querySelector('i');
      if (icon) {
        icon.style.color = ac.power ? '#4ade80' : '';
      }
    }

    // 制冷/制热
    const coolBtn = acTab.querySelector('[data-command="consumer/clickButton/coolButton"]');
    const hotBtn  = acTab.querySelector('[data-command="consumer/clickButton/hotButton"]');
    if (coolBtn) {
      const icon = coolBtn.querySelector('i');
      if (icon) icon.style.color = ac.mode === 'cool' ? '#60a5fa' : '';
    }
    if (hotBtn) {
      const icon = hotBtn.querySelector('i');
      if (icon) icon.style.color = ac.mode === 'heat' ? '#fb923c' : '';
    }

    // 风速
    const windMap = { low: 'windLowerButton', mid: 'windMidButton', high: 'windHighButton' };
    Object.entries(windMap).forEach(([w, cmd]) => {
      const btn = acTab.querySelector(`[data-command="consumer/clickButton/${cmd}"]`);
      if (btn) {
        const icon = btn.querySelector('i');
        if (icon) icon.style.color = ac.wind === w ? '#60a5fa' : '';
      }
    });
  }

  /**
   * 处理音量变化
   * @param {string} action - 音量操作
   */
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
      // 音量提示由后端 broadcast 经 WebSocket 统一弹一次
      // 更新音量显示
      this.updateVolumeDisplay(action);
    } catch (error) {
      console.error(`[SmartlUI] 音量操作 ${action} 执行失败:`, error);
      const raw = (error && error.message) ? error.message : '';
      const msg = (error && error.name === 'NetworkError') || (raw && (raw.includes('fetch') || raw.includes('网络请求失败')))
        ? '网络异常或服务未就绪，请稍后重试'
        : (raw || '音量操作失败');
      if (typeof window !== 'undefined' && window.toastService && typeof window.toastService.showToast === 'function') {
        window.toastService.showToast(msg, 'error', 2000);
      }
      if (typeof this.syncCurrentState === 'function') {
        this.syncCurrentState().catch(() => {});
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

      // 读当前温度，本地预估
      const currentTemp = (this.smartlService?.state?.temp) ?? 26;
      const newTemp = action === 'temp-up'
        ? Math.min(32, currentTemp + 1)
        : Math.max(16, currentTemp - 1);

      // 直接调 API
      const res = await window.apiService.controlAc({
        temp: newTemp,
        power: this.smartlService?.state?.power ?? true,
        mode: this.smartlService?.state?.mode ?? 'cool',
        wind: this.smartlService?.state?.wind ?? 'low',
      });

      // 用后台返回值更新状态和 UI
      const actualTemp = res?.data?.ac?.temp ?? newTemp;
      if (this.smartlService) this.smartlService.state.temp = actualTemp;

      const tempDisplay = document.querySelector('#ac-tab .text-3xl.font-black')
        || document.querySelector('#ac-tab .text-lg.font-bold');
      if (tempDisplay) tempDisplay.textContent = `${actualTemp}°`;

    } catch (error) {
      console.error(`温度操作 ${action} 失败:`, error);
    }
  }
  
  /**
   * 更新温度显示
   */
  updateTemperatureDisplay() {
    if (!this.smartlService) return;
    const state = this.smartlService.getState();
    // 手机端选择器
    const tempDisplay = document.querySelector('#ac-tab .text-3xl.font-black')
      || document.querySelector('#ac-tab .text-lg.font-bold.text-gray-800');
    if (tempDisplay) {
      tempDisplay.textContent = `${state.temp}°`;
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
      musicProgress.style.width = `${state.volume}%`;
    }
    
    // 更新麦克风音量显示
    const micVolume = document.getElementById('mic-volume');
    const micProgress = document.getElementById('mic-progress');
    if (micVolume) {
      micVolume.textContent = state.micVolume;
    }
    if (micProgress) {
      micProgress.style.width = `${state.micVolume}%`;
    }
    
    // 更新静音按钮状态
    this.updateButtonStates();
  }
  
  /**
   * 初始化WebSocket状态同步
   */
  initWebSocketSync() {
    // 检查WebSocket客户端是否可用
    if (!window.WebSocketClient) {
      console.warn('[SmartlUI] WebSocket客户端不可用，无法同步状态');
      setTimeout(() => {
        if (window.WebSocketClient) this.initWebSocketSync();
      }, 1000);
      return;
    }

    // 监听 SmartlService 的 stateChange 事件：
    // command / roomStateChanged 都会先更新 SmartlService.state，再 emit('stateChange')
    // SmartlUI 统一在这里刷新 UI，避免在多处重复订阅 WS 事件
    if (this.smartlService && typeof this.smartlService.on === 'function') {
      this.smartlService.on('stateChange', () => {
        this.updateAllUI();
      });
    }

    // commandResult：播控指令执行结果，弹 Toast 告知用户
    if (this.smartlService && typeof this.smartlService.on === 'function') {
      this.smartlService.on('commandResult', (data) => {
        const toastSvc = window.toastService;
        if (!toastSvc || typeof toastSvc.showToast !== 'function') return;
        const LABELS = {
          Play: '播放', Pause: '暂停', Replay: '重唱', SkipSong: '切歌', NextSong: '下一首',
          SwitchTrack: '切换原伴唱', SetVolume: '调节音量', Mute: '静音', Unmute: '取消静音',
          SetAC: '空调控制', SetLight: '灯光控制', SetEffect: '音效控制',
        };
        const action = data.action || '';
        const label = LABELS[action] || action || '操作';
        const ok = data.ok === 1 || data.ok === true || data.ok === '1';
        const msg = ok ? `${label}成功` : `${label}失败${data.message ? '：' + data.message : ''}`;
        toastSvc.showToast(msg, ok ? 'success' : 'error', ok ? 1000 : 1800);
      });
    }

    // 重连后重新同步（HTTP 兜底拉一次最新状态）
    window.WebSocketClient.on('connected', () => {
      setTimeout(() => {
        if (this.smartlService && typeof this.smartlService.apiService?.getRoomState === 'function') {
          this.smartlService.apiService.getRoomState().then(data => {
            if (data) this.smartlService.syncStateFromServer(data);
          }).catch(() => {});
        } else {
          this.updateAllUI();
        }
      }, 500);
    });
  }
  
  /**
   * 同步当前状态。仅在后端有数据时更新，统一交给 SmartlService.syncStateFromServer 解析。
   */
  async syncCurrentState() {
    try {
      await this.initServices();
      if (!this.smartlService) return;
      let hasBackendState = false;
      if (typeof this.smartlService.apiService?.getRoomState === 'function') {
        const data = await this.smartlService.apiService.getRoomState();
        if (data && typeof this.smartlService.syncStateFromServer === 'function') {
          this.smartlService.syncStateFromServer(data);
          hasBackendState = true;
        }
      }
      if (!hasBackendState) console.log('[SmartlUI] 未获取到后端状态，不刷新UI');
      if (hasBackendState) this.updateAllUI();
    } catch (error) {
      console.error('[SmartlUI] 同步当前状态失败:', error);
    }
  }
  
  /**
   * 根据opKey更新相关UI
   * @param {number} opKey - 操作键
   */
  updateUIForSyncState(opKey) {
    // 更新音量显示
    if (opKey === 4) {
      this.updateVolumeDisplay('music');
    }
    
    // 更新麦克风音量显示
    if (opKey === 3) {
      this.updateVolumeDisplay('mic');
    }
    
    // 更新温度显示
    if (opKey === 16) {
      const tempDisplay = document.querySelector('#ac-tab .text-lg.font-bold.text-gray-800');
      if (tempDisplay) {
        const state = this.smartlService.getState();
        tempDisplay.textContent = `${state.temp}°C`;
      } else {
        console.warn('[SmartlUI] 未找到温度显示元素');
      }
    }
    
    // 更新按钮状态（根据opKey类型更新对应按钮）
    switch (opKey) {
      case 1:  // 播放状态
      case 2:  // 原伴唱状态
      case 3:  // 静音状态
      case 13: // 空调开机状态
      case 14: // 空调风速状态
      case 15: // 空调制冷制热状态
        this.updateButtonStates();
        break;
        
      case 11: // 自动灯光按钮状态
        this.updateAutoLightButtonUI();
        break;
        
      case 9:  // 灯光模式状态
        this.updateLightModeButtonsUI();
        break;
        
      case 10: // 音效模式状态
        this.updateSoundEffectUI();
        break;
    }
  }
  
  /**
   * 更新所有UI显示
   */
  updateAllUI() {
    // 更新音量显示
    this.updateVolumeDisplay('music');
    this.updateVolumeDisplay('mic');
    
    // 更新温度显示
    const tempDisplay = document.querySelector('#ac-tab .text-lg.font-bold.text-gray-800');
    if (tempDisplay) {
      const state = this.smartlService.getState();
      tempDisplay.textContent = `${state.temp}°C`;
    } else {
      console.warn('[SmartlUI] 未找到温度显示元素');
    }

    // 更新按钮状态（除了灯光相关按钮）
    this.updateButtonStates();
    
    // 更新自动灯光按钮UI
    this.updateAutoLightButtonUI();
    
    // 更新灯光模式按钮UI
    this.updateLightModeButtonsUI();
    
    // 更新音效按钮UI
    this.updateSoundEffectUI();
  }
  
  /**
   * 更新按钮状态
   */
  updateButtonStates() {
    // 确保服务已初始化
    if (!this.smartlService) return;
    
    const state = this.smartlService.getState();
    
    // 更新播放/暂停按钮
    const playBtn = document.querySelector('[data-command="pause"], [data-command="resume"]');
    if (playBtn) {
      const isPlaying = state.isPlaying === true || state.playState === 1;
      const targetCommand = isPlaying ? 'pause' : 'resume';
      playBtn.dataset.command = targetCommand;
      const icon = playBtn.querySelector('i');
      const text = playBtn.querySelector('span');
      if (icon) {
        icon.className = `fa ${isPlaying ? 'fa-pause' : 'fa-play'} text-lg mb-2 text-gray-700 dark:text-gray-300`;
      }
      if (text) {
        text.textContent = isPlaying ? '暂停' : '播放';
      }
    }
    
    // 更新原唱/伴唱按钮
    const vocalBtn = document.querySelector('[data-command="original"], [data-command="vocal"]');
    if (vocalBtn) {
      const isOriginal = state.isOriginal === true || state.originState === 1;
      const targetCommand = isOriginal ? 'vocal' : 'original';
      vocalBtn.dataset.command = targetCommand;
      const icon = vocalBtn.querySelector('i');
      const text = vocalBtn.querySelector('span');
      if (icon) {
        icon.className = `fa ${isOriginal ? 'fa-microphone' : 'fa-music'} text-lg mb-2 text-gray-700 dark:text-gray-300`;
      }
      if (text) {
        text.textContent = isOriginal ? '伴唱' : '原唱';
      }
    }
    
    // 更新静音按钮
    const muteBtn = document.querySelector('[data-command="mute"], [data-command="unmute"]');
    if (muteBtn) {
      const isMuted = state.isMuted === true || state.muteState === 1;
      const targetCommand = isMuted ? 'unmute' : 'mute';
      muteBtn.dataset.command = targetCommand;
      const icon = muteBtn.querySelector('i');
      if (icon) {
        icon.className = `fa ${isMuted ? 'fa-volume-off' : 'fa-volume-up'} text-lg mb-2 text-gray-700 dark:text-gray-300`;
      }
      const langSvc = window.langService;
      const muteKey = isMuted ? 'unmute' : 'mute';
      const getLang = (lang, key) => langSvc?.translations?.[lang]?.[key] || null;
      const zhSpan = muteBtn.querySelector('.zh-label');
      const idSpan = muteBtn.querySelector('.indonesian-translation');
      const enSpan = muteBtn.querySelector('.en-translation');
      const viSpan = muteBtn.querySelector('.vi-translation');
      if (zhSpan) {
        zhSpan.textContent = getLang('zh_cn', muteKey) || (isMuted ? '取消静音' : '静音');
      } else {
        const text = muteBtn.querySelector('span');
        if (text) text.textContent = getLang('zh_cn', muteKey) || (isMuted ? '取消静音' : '静音');
      }
      if (idSpan) idSpan.textContent = getLang('id_id', muteKey) || (isMuted ? 'Buka bisukan' : 'Bisukan');
      if (enSpan) enSpan.textContent = getLang('en_us', muteKey) || (isMuted ? 'Unmute' : 'Mute');
      if (viSpan) viSpan.textContent = getLang('vi_vn', muteKey) || (isMuted ? 'Bật tiếng' : 'Tắt tiếng');
      // 减少不必要的详细日志输出，只在开发环境中输出详细信息
      if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
      }
    }
    
    // 空调按钮高亮：只改图标颜色，背景和文字不变
    this._updateAcUI(state);
    
    // 不在此处调用灯光或音效的UI更新，保持按需更新
  }
  
  /**
   * 更新空调开关按钮UI
   */
  updatePowerButtonUI(state) {
    const powerBtn = document.querySelector('[data-command="consumer/clickButton/ktOpenButton"], [data-command="consumer/clickButton/ktCloseButton"]');
    if (!powerBtn) return;
    const icon = powerBtn.querySelector('i');
    if (icon) icon.style.color = state.power ? '#4ade80' : '';
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
      icon.className = `fa fa-thermometer-half text-2xl mb-2 ${state.power ? 'text-green-500 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`;
    }
    if (text) {
      text.textContent = `${state.temp}°C`;
      // 根据开关状态改变文字颜色，保持背景色不变
      if (state.power) {
        text.classList.remove('text-gray-700', 'dark:text-gray-300');
        text.classList.add('text-green-500', 'dark:text-green-400');
      } else {
        text.classList.remove('text-green-500', 'dark:text-green-400');
        text.classList.add('text-gray-700', 'dark:text-gray-300');
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
      icon.className = `fa fa-fan text-2xl mb-2 ${state.power ? 'text-green-500 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`;
    }
    if (text) {
      text.textContent = state.fan;
      // 根据开关状态改变文字颜色，保持背景色不变
      if (state.power) {
        text.classList.remove('text-gray-700', 'dark:text-gray-300');
        text.classList.add('text-green-500', 'dark:text-green-400');
      } else {
        text.classList.remove('text-green-500', 'dark:text-green-400');
        text.classList.add('text-gray-700', 'dark:text-gray-300');
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
      icon.className = `fa fa-sun text-2xl mb-2 ${state.power ? 'text-green-500 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`;
    }
    if (text) {
      text.textContent = state.mode;
      // 根据开关状态改变文字颜色，保持背景色不变
      if (state.power) {
        text.classList.remove('text-gray-700', 'dark:text-gray-300');
        text.classList.add('text-green-500', 'dark:text-green-400');
      } else {
        text.classList.remove('text-green-500', 'dark:text-green-400');
        text.classList.add('text-gray-700', 'dark:text-gray-300');
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
      icon.className = `fa fa-arrows-alt-v text-2xl mb-2 ${state.power ? 'text-green-500 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`;
    }
    if (text) {
      text.textContent = state.swing;
      // 根据开关状态改变文字颜色，保持背景色不变
      if (state.power) {
        text.classList.remove('text-gray-700', 'dark:text-gray-300');
        text.classList.add('text-green-500', 'dark:text-green-400');
      } else {
        text.classList.remove('text-green-500', 'dark:text-green-400');
        text.classList.add('text-gray-700', 'dark:text-gray-300');
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
    const autoBtn = document.querySelector('#light-buttons button[data-command="light/auto"]');
    const powerBtn = document.querySelector('[data-command="consumer/clickButton/ktOpenButton"], [data-command="consumer/clickButton/ktCloseButton"]');
    const tempBtn = document.querySelector('[data-command^="consumer/clickButton/ktTempButton"]');
    const fanBtn = document.querySelector('[data-command^="consumer/clickButton/ktFanButton"]');
    const modeBtn = document.querySelector('[data-command^="consumer/clickButton/ktModeButton"]');
    const swingBtn = document.querySelector('[data-command^="consumer/clickButton/ktSwingButton"]');
    
    if (autoBtn) {
      autoBtn.addEventListener('click', () => {
        const isAutoLightOn = !autoBtn.classList.contains('bg-red-500');
        this.updateAutoLightButtonUI({ isAutoLightOn });
        // 发送命令的逻辑应该在这里添加
      });
    }
    
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
    if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
    }
    
    // 获取所有灯光按钮（除了自动按钮）
    const lightButtons = document.querySelectorAll('#light-buttons button[data-command^="light/"]:not([data-command="light/auto"])');
    // 减少不必要的详细日志输出，只在开发环境中输出详细信息
    if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
    }
    
    lightButtons.forEach((btn, index) => {
      const command = btn.dataset.command;
      const isSelected = state.selectedLightMode === command;
      
      // 减少不必要的详细日志输出，只在开发环境中输出详细信息
      if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
      }
      
      const icon = btn.querySelector('i');
      const textSpan = btn.querySelector('span');
      
      // 选中的按钮：红底白字
      if (isSelected) {
        btn.classList.add('bg-red-500', 'text-white', 'shadow-lg', 'shadow-red-500/20');
        btn.classList.remove('bg-white/5', 'text-white/60');
        if (icon) icon.className = `fa ${this.getLightIcon(command)} text-base mb-1 text-white`;
        if (textSpan) textSpan.className = 'text-[0.6rem] font-bold text-white';
      } else {
        // 未选中的按钮：深色背景，半透明白字
        btn.classList.remove('bg-red-500', 'text-white', 'shadow-lg', 'shadow-red-500/20');
        btn.classList.add('bg-white/5', 'text-white/60');
        if (icon) icon.className = `fa ${this.getLightIcon(command)} text-base mb-1 text-white/60`;
        if (textSpan) textSpan.className = 'text-[0.6rem] font-bold text-white/60';
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
    if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
      // 减少不必要的详细日志输出，只在开发环境中输出详细信息
    if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
    }
    }
    
    // 查找自动灯光按钮
    const autoBtn = document.querySelector('#light-buttons button[data-command="light/auto"]');
    if (!autoBtn) {
      console.warn('[SmartlUI] 未找到自动灯光按钮');
      return;
    }
    
    // 先移除已有的红点
    autoBtn.querySelectorAll('.auto-dot').forEach(dot => dot.remove());
    
    const icon = autoBtn.querySelector('i');
    const textSpan = autoBtn.querySelector('span');
    
    // 确保状态字段存在
    const isAutoLightOn = state.isAutoLightOn === true || state.autoLightState === 1;
    
    // 重置按钮到默认状态
    autoBtn.classList.remove('bg-red-500', 'text-red-500', 'dark:text-red-400');
    autoBtn.classList.add('bg-gray-100', 'dark:bg-gray-700');
    
    if (icon) {
      icon.classList.remove('text-red-500', 'dark:text-red-400', 'text-white');
      icon.classList.add('text-gray-700', 'dark:text-gray-300');
    }
    if (textSpan) {
      textSpan.classList.remove('text-red-500', 'dark:text-red-400', 'text-white');
      textSpan.classList.add('text-gray-700', 'dark:text-gray-300');
    }
    
    if (isAutoLightOn) {
      // 开启自动灯光时添加红点
      const dot = document.createElement('span');
      dot.className = 'auto-dot absolute top-2 left-2 w-1.5 h-1.5 bg-red-500 rounded-full z-1000';
      autoBtn.style.position = 'relative';
      autoBtn.appendChild(dot);
      
      // 保持默认灰色背景，仅将文本和图标设置为红色，不与模式按钮混淆
      if (icon) {
        icon.classList.remove('text-gray-700', 'dark:text-gray-300', 'text-white');
        icon.classList.add('text-red-500', 'dark:text-red-400');
      }
      if (textSpan) {
        textSpan.classList.remove('text-gray-700', 'dark:text-gray-300', 'text-white');
        textSpan.classList.add('text-red-500', 'dark:text-red-400');
      }
    }
    
    // 减少不必要的详细日志输出，只在开发环境中输出详细信息
    if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
      // 减少不必要的详细日志输出，只在开发环境中输出详细信息
    if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
    }
    }
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
      const textSpan = effectBtn.querySelector('span');
      if (textSpan && effectName) {
        textSpan.textContent = effectName;
      }
      
      effectBtn.querySelectorAll('.sound-effect-dot').forEach(dot => dot.remove());
      
      if (state.soundEffectMode) {
        const dot = document.createElement('span');
        dot.className = 'sound-effect-dot absolute top-2 left-2 w-1.5 h-1.5 bg-red-500 rounded-full z-1000';
        effectBtn.style.position = 'relative';
        effectBtn.appendChild(dot);
      }
    } catch (error) {
      console.error('[SmartlUI] 更新音效按钮UI失败:', error);
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
      console.error('[SmartlUI] 获取音效名称失败:', error);
      return '';
    }
  }
}

// 创建并导出导航控制UI实例
const smartlUI = new SmartlUI();
export default smartlUI;
