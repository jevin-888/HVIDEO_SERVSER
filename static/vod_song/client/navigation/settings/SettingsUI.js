/**
 * 设置弹窗UI模块
 */
class SettingsUI {
  constructor() {
    this.modal = null;
    this.isOpen = false;
    this.logService = null;
    this.toastService = null;
    this.langService = null;
    this.isPasswordVerified = false; // 标记密码是否已验证
    this._keyboardListenersRegistered = false;
  }

  async initServices() {
    if (!this.logService || !this.toastService || !this.langService) {
      const services = await import('../../index.js');
      this.logService = services.logService;
      this.toastService = services.toastService;
      this.langService = services.langService;
    }
    
    // 初始化语言服务
    if (this.langService && !this.langService.translations['zh_cn']) {
      await this.langService.init();
    }
    if (this.langService && !this.langService.translations['id_id']) {
      await this.langService.loadLanguageFile('id_id');
    }
  }

  /**
   * 创建设置弹窗
   */
  async createModal() {
    // 检查模态框是否已存在
    if (document.getElementById('settingsModal')) {
      return;
    }

    await this.initServices();

    // 获取翻译
    const zhTranslations = this.langService?.translations['zh_cn'] || {};
    const settingsZh = zhTranslations['settings'] || '设置';
    const enterPasswordToAccessSettingsZh = zhTranslations['enterPasswordToAccessSettings'] || '请输入密码以访问设置';
    const enterPasswordZh = zhTranslations['enterPassword'] || '请输入密码';
    const verifyZh = zhTranslations['verify'] || '验证';
    const cancelZh = zhTranslations['cancel'] || '取消';
    const clientIpAddressZh = zhTranslations['clientIpAddress'] || '客户端IP地址';
    const enterClientIpAddressZh = zhTranslations['enterClientIpAddress'] || '请输入客户端IP地址';
    const serverIpAddressZh = zhTranslations['serverIpAddress'] || '服务器IP地址';
    const enterServerIpAddressZh = zhTranslations['enterServerIpAddress'] || '请输入服务器IP地址';
    const cashierServerIpAddressZh = zhTranslations['cashierServerIpAddress'] || '收银服务器IP地址';
    const enterCashierServerIpAddressZh = zhTranslations['enterCashierServerIpAddress'] || '请输入收银服务器IP地址';
    const logLevelZh = zhTranslations['logLevel'] || '日志级别';
    const saveZh = zhTranslations['save'] || '保存';

    // 创建模态框
    this.modal = document.createElement('div');
    this.modal.id = 'settingsModal';
    this.modal.className = 'fixed inset-0 z-[10007] hidden opacity-0 transition-opacity duration-300';
    
    // 获取当前配置值
    const currentClientIp = this.getCurrentIp();
    const currentServerIp = this.getServerIp();
    const currentCashierServerIp = this.getCashierServerIp();
    const currentLogLevel = this.getLogLevel();
    
    this.modal.innerHTML = `
      <div class="fixed inset-0 bg-black/70 z-[10007] modal-backdrop"></div>
      <div class="fixed inset-0 z-[10008] flex items-center justify-center p-4" style="pointer-events: none;">
        <div class="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl shadow-2xl w-full max-w-lg relative border border-gray-700" style="max-height: 90vh; display: flex; flex-direction: column; pointer-events: auto;">
          <!-- 标题栏 -->
          <div class="flex justify-between items-center px-5 py-4 border-b border-gray-700 flex-shrink-0">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-blue-500/20 flex items-center justify-center">
                <i class="fa fa-cog text-blue-400 text-lg"></i>
              </div>
              <h3 class="text-xl font-bold text-white">${settingsZh}</h3>
            </div>
            <button id="closeSettingsModal" class="control-btn w-9 h-9 rounded-full hover:bg-gray-700/50 transition-colors flex items-center justify-center text-gray-400 hover:text-white">
              <i class="fa fa-times text-lg"></i>
            </button>
          </div>
          
          <div class="px-5 py-4 overflow-y-auto flex-1 space-y-4" style="overscroll-behavior: contain;">
            <!-- 密码验证区域 -->
            <div id="passwordSection">
              <div class="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <div class="flex items-center gap-2 mb-3">
                  <div class="w-7 h-7 rounded-full bg-yellow-500/20 flex items-center justify-center">
                    <i class="fa fa-lock text-yellow-400 text-sm"></i>
                  </div>
                  <label class="text-base font-semibold text-gray-200">
                    ${enterPasswordToAccessSettingsZh}
                  </label>
                </div>
                <input 
                  type="password" 
                  id="settingsPassword" 
                  placeholder="${enterPasswordZh}" 
                  class="w-full px-4 py-3 text-base rounded-lg border border-gray-600 bg-gray-900/50 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div class="flex gap-2 mt-3">
                  <button 
                    id="verifyPasswordBtn" 
                    class="control-btn flex-1 px-5 py-3 text-base bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors"
                  >
                    <i class="fa fa-check mr-2"></i>${verifyZh}
                  </button>
                  <button 
                    id="cancelSettingsBtn" 
                    class="control-btn flex-1 px-5 py-3 text-base bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-semibold transition-colors"
                  >
                    ${cancelZh}
                  </button>
                </div>
              </div>
            </div>
            
            <!-- 配置设置区域（默认隐藏） -->
            <div id="configSection" class="hidden space-y-3">
              <!-- 客户端IP地址 -->
              <div class="bg-gray-800/50 rounded-xl p-3 border border-gray-700">
                <div class="flex items-center gap-2 mb-2">
                  <i class="fa fa-desktop text-blue-400 text-sm"></i>
                  <label class="text-sm font-semibold text-gray-200">
                    ${clientIpAddressZh}
                  </label>
                </div>
                <input 
                  type="text" 
                  id="settingsClientIp" 
                  placeholder="${enterClientIpAddressZh}" 
                  value="${currentClientIp}"
                  class="w-full px-3 py-2 text-base rounded-lg border border-gray-600 bg-gray-900/50 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                />
              </div>
              
              <!-- 服务器IP地址 -->
              <div class="bg-gray-800/50 rounded-xl p-3 border border-gray-700">
                <div class="flex items-center gap-2 mb-2">
                  <i class="fa fa-server text-green-400 text-sm"></i>
                  <label class="text-sm font-semibold text-gray-200">
                    ${serverIpAddressZh}
                  </label>
                </div>
                <input 
                  type="text" 
                  id="settingsServerIp" 
                  placeholder="${enterServerIpAddressZh}" 
                  value="${currentServerIp}"
                  class="w-full px-3 py-2 text-base rounded-lg border border-gray-600 bg-gray-900/50 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono"
                />
              </div>
              
              <!-- 收银服务器IP地址 -->
              <div class="bg-gray-800/50 rounded-xl p-3 border border-gray-700">
                <div class="flex items-center gap-2 mb-2">
                  <i class="fa fa-cash-register text-yellow-400 text-sm"></i>
                  <label class="text-sm font-semibold text-gray-200">
                    ${cashierServerIpAddressZh}
                  </label>
                </div>
                <input 
                  type="text" 
                  id="settingsCashierServerIp" 
                  placeholder="${enterCashierServerIpAddressZh}" 
                  value="${currentCashierServerIp}"
                  class="w-full px-3 py-2 text-base rounded-lg border border-gray-600 bg-gray-900/50 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent font-mono"
                />
              </div>
              
              <!-- 日志级别 -->
              <div class="bg-gray-800/50 rounded-xl p-3 border border-gray-700">
                <div class="flex items-center gap-2 mb-2">
                  <i class="fa fa-list-alt text-purple-400 text-sm"></i>
                  <label class="text-sm font-semibold text-gray-200">
                    ${logLevelZh}
                  </label>
                </div>
                <select 
                  id="settingsLogLevel"
                  class="w-full px-3 py-2 text-base rounded-lg border border-gray-600 bg-gray-900/50 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
                >
                  <option value="debug" ${currentLogLevel === 'debug' ? 'selected' : ''}>Debug</option>
                  <option value="info" ${currentLogLevel === 'info' ? 'selected' : ''}>Info</option>
                  <option value="warn" ${currentLogLevel === 'warn' ? 'selected' : ''}>Warn</option>
                  <option value="error" ${currentLogLevel === 'error' ? 'selected' : ''}>Error</option>
                </select>
              </div>
              
              <!-- 操作按钮 -->
              <div class="flex gap-2 mt-4 pt-3 border-t border-gray-700">
                <button 
                  id="saveSettingsBtn" 
                  class="control-btn flex-1 px-5 py-3 text-base bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition-colors shadow-lg"
                >
                  <i class="fa fa-save mr-2"></i>${saveZh}
                </button>
                <button 
                  id="cancelConfigBtn" 
                  class="control-btn flex-1 px-5 py-3 text-base bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-semibold transition-colors"
                >
                  ${cancelZh}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.modal);

    // 绑定事件
    this.bindEvents();
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    const closeBtn = document.getElementById('closeSettingsModal');
    const cancelBtn = document.getElementById('cancelSettingsBtn');
    const cancelConfigBtn = document.getElementById('cancelConfigBtn');
    const verifyBtn = document.getElementById('verifyPasswordBtn');
    const saveBtn = document.getElementById('saveSettingsBtn');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }
    
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.closeModal());
    }
    
    if (cancelConfigBtn) {
      cancelConfigBtn.addEventListener('click', () => this.closeModal());
    }
    
    if (verifyBtn) {
      verifyBtn.addEventListener('click', () => this.handleVerifyPassword());
    }
    
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.handleSave());
    }

    // 支持回车键验证密码
    const passwordInput = document.getElementById('settingsPassword');
    if (passwordInput) {
      passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !this.isPasswordVerified) {
          this.handleVerifyPassword();
        } else if (e.key === 'Enter' && this.isPasswordVerified) {
          // 如果已验证，回车键可以保存
          this.handleSave();
        }
      });
    }

    // 支持回车键保存配置（在所有输入框中）
    const inputs = ['settingsClientIp', 'settingsServerIp', 'settingsCashierServerIp'];
    inputs.forEach(inputId => {
      const input = document.getElementById(inputId);
      if (input) {
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') this.handleSave();
        });
        input.addEventListener('focus', () => this.handleInputFocus(input));
        input.addEventListener('blur', () => this.handleInputBlur());
      }
    });
  }

  /**
   * 处理输入框获得焦点（备用方案，不依赖 Capacitor Keyboard API）
   */
  handleInputFocus(input) {
    // 在 APK 环境（localhost）中手动调整对话框，避免键盘遮挡
    // window.Capacitor 在重定向页面中不可用，改用 hostname 检测
    const isApp = window.location.hostname === 'localhost';
    if (!isApp) return;

    setTimeout(() => {
      const viewportHeight = window.innerHeight;
      if (this.modal) {
        this.modal.classList.add('capacitor-keyboard-visible');
      }
      const availableHeight = viewportHeight * 0.5;
      const modalContent = this.modal?.querySelector(':scope > div:last-child > div');
      if (modalContent) {
        modalContent.style.maxHeight = `${availableHeight}px`;
      }
      const rect = input.getBoundingClientRect();
      if (rect.bottom > availableHeight) {
        const scrollContainer = input.closest('.overflow-y-auto');
        if (scrollContainer) {
          scrollContainer.scrollTop += rect.bottom - availableHeight + 100;
        }
      }
    }, 300);
  }

  /**
   * 处理输入框失去焦点
   */
  handleInputBlur() {
    // 延迟执行，避免在切换输入框时闪烁
    setTimeout(() => {
      // 检查是否还有输入框获得焦点
      const activeElement = document.activeElement;
      const isInputFocused = activeElement && 
        (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') &&
        this.modal?.contains(activeElement);
      
      if (!isInputFocused) {
        // 没有输入框获得焦点，恢复对话框
        if (this.modal) {
          this.modal.classList.remove('capacitor-keyboard-visible');
          
          const modalContent = this.modal.querySelector(':scope > div:last-child > div');
          if (modalContent) {
            modalContent.style.maxHeight = '70vh';
            this.logService?.info('[SettingsUI] 恢复对话框高度');
          }
        }
      }
    }, 100);
  }

  /**
   * 获取日志级别显示文本
   */
  getLogLevelText(level) {
    const levelMap = {
      'debug': 'Debug',
      'info': 'Info',
      'warn': 'Warn',
      'error': 'Error'
    };
    return levelMap[level] || 'Error';
  }

  /**
   * 初始化自定义下拉菜单
   */
  initCustomSelect() {
    const selectBtn = document.getElementById('settingsLogLevelBtn');
    const dropdown = document.getElementById('settingsLogLevelDropdown');
    const hiddenInput = document.getElementById('settingsLogLevel');
    const textSpan = document.getElementById('settingsLogLevelText');
    
    if (!selectBtn || !dropdown || !hiddenInput || !textSpan) {
      return;
    }

    // 如果已经初始化过，先移除旧的事件监听器
    if (selectBtn.dataset.initialized === 'true') {
      return;
    }
    selectBtn.dataset.initialized = 'true';

    // 点击按钮切换下拉菜单
    const handleButtonClick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const isOpen = !dropdown.classList.contains('hidden');
      
      if (isOpen) {
        dropdown.classList.add('hidden');
      } else {
        dropdown.classList.remove('hidden');
        // 确保下拉菜单不超出屏幕
        this.adjustDropdownPosition(dropdown);
      }
    };
    selectBtn.addEventListener('click', handleButtonClick);

    // 点击选项
    const options = dropdown.querySelectorAll('.custom-select-option');
    [].forEach.call(options, option => {
      const handleOptionClick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const value = option.getAttribute('data-value');
        const text = option.textContent.trim();
        
        // 更新隐藏输入框的值
        hiddenInput.value = value;
        
        // 更新显示文本
        textSpan.textContent = text;
        
        // 更新选中状态
        [].forEach.call(options, opt => {
          opt.classList.remove('bg-blue-50', 'dark:bg-blue-900/30');
        });
        option.classList.add('bg-blue-50', 'dark:bg-blue-900/30');
        
        // 关闭下拉菜单
        dropdown.classList.add('hidden');
      };
      option.addEventListener('click', handleOptionClick);
    });

    // 点击外部关闭下拉菜单
    const handleDocumentClick = (e) => {
      if (!selectBtn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    };
    document.addEventListener('click', handleDocumentClick);

    // 监听窗口大小变化，调整下拉菜单位置
    const handleResize = () => {
      if (!dropdown.classList.contains('hidden')) {
        this.adjustDropdownPosition(dropdown);
      }
    };
    window.addEventListener('resize', handleResize);
  }

  /**
   * 调整下拉菜单位置，确保不超出屏幕
   */
  adjustDropdownPosition(dropdown) {
    if (!dropdown) return;
    
    // 重置CSS变量
    dropdown.style.removeProperty('--dropdown-offset-x');
    dropdown.style.removeProperty('--dropdown-offset-y');
    
    // 使用requestAnimationFrame确保DOM已更新
    requestAnimationFrame(() => {
      const rect = dropdown.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      let offsetX = 0;
      let offsetY = 0;
      
      // 检查是否超出右边界
      if (rect.right > viewportWidth) {
        offsetX = viewportWidth - rect.right - 8; // 留8px边距
      }
      
      // 检查是否超出左边界
      if (rect.left < 0) {
        offsetX = -rect.left + 8; // 留8px边距
      }
      
      // 检查是否超出下边界，如果超出则向上展开
      if (rect.bottom > viewportHeight) {
        const dropdownHeight = rect.height;
        const buttonRect = dropdown.previousElementSibling?.getBoundingClientRect();
        if (buttonRect) {
          offsetY = -(dropdownHeight + 4);
        }
      }
      
      // 使用CSS变量设置偏移量，避免直接使用内联样式
      if (offsetX !== 0) {
        dropdown.style.setProperty('--dropdown-offset-x', `${offsetX}px`);
      }
      if (offsetY !== 0) {
        dropdown.style.setProperty('--dropdown-offset-y', `${offsetY}px`);
      }
    });
  }

  /**
   * 处理密码验证
   */
  async handleVerifyPassword() {
    await this.initServices();
    
    // 获取翻译
    const zhTranslations = this.langService?.translations['zh_cn'] || {};
    const getPasswordInputFailed = zhTranslations['getPasswordInputFailed'] || '获取密码输入框失败';
    const passwordIncorrect = zhTranslations['passwordIncorrect'] || '密码错误';
    
    const passwordInput = document.getElementById('settingsPassword');
    if (!passwordInput) {
      this.toastService?.showError?.(getPasswordInputFailed, 2000);
      return;
    }
    
    const password = passwordInput.value.trim();
    
    // 验证密码
    if (password !== '989898') {
      this.toastService?.showError?.(passwordIncorrect, 2000);
      passwordInput.focus();
      passwordInput.value = '';
      return;
    }
    
    // 密码验证成功，显示配置设置区域
    this.isPasswordVerified = true;
    const passwordSection = document.getElementById('passwordSection');
    const configSection = document.getElementById('configSection');
    
    if (passwordSection) {
      passwordSection.classList.add('hidden');
    }
    
    if (configSection) {
      configSection.classList.remove('hidden');
      // 聚焦到第一个IP输入框
      const clientIpInput = document.getElementById('settingsClientIp');
      if (clientIpInput) {
        setTimeout(() => {
          clientIpInput.focus();
          clientIpInput.select(); // 选中当前IP，方便修改
        }, 100);
      }
    }
    
    this.logService?.info('[SettingsUI] 密码验证成功，显示配置设置区域');
  }

  /**
   * 获取当前客户端IP地址
   * 优化：统一使用 clientIp，简化配置
   */
  getCurrentIp() {
    try {
      // 从localStorage获取
      if (typeof localStorage !== 'undefined') {
        const clientIp = localStorage.getItem('clientIp');
        if (clientIp && this.validateIp(clientIp)) {
          return clientIp;
        }
      }
      
      // 从URL参数获取
      if (typeof window !== 'undefined' && window.location) {
        const search = window.location.search || '';
        if (search.length > 1) {
          const searchParams = new URLSearchParams(search.substring(1));
          const ipCandidate = searchParams.get('A') || searchParams.get('a');
          if (ipCandidate && this.validateIp(ipCandidate)) {
            return ipCandidate;
          }
        }
      }
    } catch (e) {
      this.logService?.warn('[SettingsUI] 获取当前IP失败:', e);
    }
    
    // 从 apiConfig.js 获取默认 IP
    return this.getDefaultIpFromConfig();
  }

  /**
   * 从 apiConfig.js 获取默认 IP（避免硬编码）
   */
  getDefaultIpFromConfig() {
    // 尝试从全局配置获取
    if (typeof window !== 'undefined') {
      // 方法1: 从 apiConfig.js 的 DEFAULT_IP 获取
      if (window.DEFAULT_IP) {
        return window.DEFAULT_IP;
      }
      // 方法2: 从 AppConfig 获取
      if (window.AppConfig && window.AppConfig.defaultIp) {
        return window.AppConfig.defaultIp;
      }
    }
    // 兜底：返回空字符串，强制用户配置
    return '';
  }

  /**
   * 获取服务器IP地址（统一的点歌/歌曲服务器）
   * 注意：图标服务器已改为通过 API 路由提供，不需要单独配置
   */
  getServerIp() {
    try {
      if (typeof localStorage !== 'undefined') {
        const songServerIp = localStorage.getItem('songServerIp');
        if (songServerIp && this.validateIp(songServerIp)) {
          return songServerIp;
        }
        const clientIp = localStorage.getItem('clientIp');
        if (clientIp && this.validateIp(clientIp)) {
          return clientIp;
        }
      }
    } catch (e) {
      this.logService?.warn('[SettingsUI] 获取服务器IP失败:', e);
    }
    return this.getDefaultIpFromConfig();
  }

  /**
   * 获取歌曲服务器IP地址（内部使用，映射到统一服务器IP）
   */
  getSongServerIp() {
    return this.getServerIp();
  }

  /**
   * 获取收银服务器IP地址
   */
  getCashierServerIp() {
    try {
      if (typeof localStorage !== 'undefined') {
        const cashierServerIp = localStorage.getItem('cashierServerIp');
        if (cashierServerIp && this.validateIp(cashierServerIp)) {
          return cashierServerIp;
        }
        // 回退到客户端IP
        const clientIp = localStorage.getItem('clientIp');
        if (clientIp && this.validateIp(clientIp)) {
          return clientIp;
        }
      }
    } catch (e) {
      this.logService?.warn('[SettingsUI] 获取收银服务器IP失败:', e);
    }
    return this.getDefaultIpFromConfig();
  }

  /**
   * 获取日志级别
   * 
   * ========== 日志级别统一控制 ==========
   * 这是获取日志级别的唯一方法，从 localStorage 读取
   * 日志级别统一由设置界面控制
   * ====================================
   */
  getLogLevel() {
    try {
      if (typeof localStorage !== 'undefined') {
        const logLevel = localStorage.getItem('ktv:log:level');
        const allowed = ['debug', 'info', 'warn', 'error'];
        // 转换为小写进行比较，确保大小写不敏感
        const normalizedLevel = logLevel ? logLevel.toLowerCase() : '';
        if (normalizedLevel && allowed.indexOf(normalizedLevel) !== -1) {
          return normalizedLevel;
        }
      }
    } catch (e) {
      this.logService?.warn('[SettingsUI] 获取日志级别失败:', e);
    }
    return 'error';
  }

  /**
   * 验证IP地址格式
   */
  validateIp(ip) {
    if (!ip || typeof ip !== 'string') {
      return false;
    }
    
    // 验证IPv4格式
    const ipRegex = /^\d{1,3}(\.\d{1,3}){3}$/;
    if (!ipRegex.test(ip)) {
      return false;
    }
    
    // 验证每个数字在0-255范围内
    const parts = ip.split('.').map(Number);
    return parts.every(num => num >= 0 && num <= 255);
  }

  /**
   * 处理保存操作
   * 优化：智能同步 IP 配置，简化用户操作
   */
  async handleSave() {
    await this.initServices();
    
    // 获取翻译
    const zhTranslations = this.langService?.translations['zh_cn'] || {};
    const pleaseVerifyPasswordFirst = zhTranslations['pleaseVerifyPasswordFirst'] || '请先验证密码';
    const getConfigInputFailed = zhTranslations['getConfigInputFailed'] || '获取配置输入框失败';
    const clientIpAddress = zhTranslations['clientIpAddress'] || '客户端IP地址';
    const serverIpAddress = zhTranslations['serverIpAddress'] || '服务器IP地址';
    const cashierServerIpAddress = zhTranslations['cashierServerIpAddress'] || '收银服务器IP地址';
    const logLevelInvalid = zhTranslations['logLevelInvalid'] || '日志级别无效';
    const vodLayerInvalid = zhTranslations['vodLayerInvalid'] || 'VOD 播放图层应为 1～99 的整数';
    const configSaved = zhTranslations['configSaved'] || '配置已保存，页面即将刷新...';
    const cannotSaveSettings = zhTranslations['cannotSaveSettings'] || '无法保存设置（localStorage不可用）';
    const saveFailed = zhTranslations['saveFailed'] || '保存失败';
    
    if (!this.isPasswordVerified) {
      this.toastService?.showError?.(pleaseVerifyPasswordFirst, 2000);
      return;
    }
    
    const clientIpInput = document.getElementById('settingsClientIp');
    const serverIpInput = document.getElementById('settingsServerIp');
    const cashierServerIpInput = document.getElementById('settingsCashierServerIp');
    const logLevelSelect = document.getElementById('settingsLogLevel');
    
    if (!clientIpInput || !serverIpInput || !cashierServerIpInput || !logLevelSelect) {
      this.toastService?.showError?.(getConfigInputFailed, 2000);
      return;
    }
    
    const clientIp = clientIpInput.value.trim();
    const serverIp = serverIpInput.value.trim();
    const cashierServerIp = cashierServerIpInput.value.trim();
    const logLevel = logLevelSelect.value;
    
    // 验证所有IP地址
    const ipFields = [
      { value: clientIp, name: clientIpAddress, input: clientIpInput },
      { value: serverIp, name: serverIpAddress, input: serverIpInput },
      { value: cashierServerIp, name: cashierServerIpAddress, input: cashierServerIpInput }
    ];
    
    for (const field of ipFields) {
      if (field.value && !this.validateIp(field.value)) {
        this.toastService?.showError?.(`${field.name}格式不正确`, 2000);
        field.input.focus();
        return;
      }
    }
    
    const allowedLevels = ['debug', 'info', 'warn', 'error'];
    const normalizedLevel = logLevel ? logLevel.toLowerCase() : '';
    if (allowedLevels.indexOf(normalizedLevel) === -1) {
      this.toastService?.showError?.(logLevelInvalid, 2000);
      logLevelSelect.focus();
      return;
    }
    
    try {
      if (typeof localStorage !== 'undefined') {
        // 保存客户端 IP（用于房间识别）
        localStorage.setItem('clientIp', clientIp);
        // 同步更新 currentRoomId，避免页面刷新后使用旧的房间ID
        localStorage.setItem('currentRoomId', clientIp);
        
        // 保存统一服务器 IP（点歌、歌曲服务器）
        // 注意：图标服务器已改为通过 API 路由 /api/v1/artists/:id/image 提供，不需要单独配置
        localStorage.setItem('songServerIp', serverIp);
        
        // 保存收银服务器 IP（可以独立配置）
        localStorage.setItem('cashierServerIp', cashierServerIp);
        
        // 保存日志级别
        localStorage.setItem('ktv:log:level', normalizedLevel);
        
        if (this.logService && typeof this.logService.setLogLevel === 'function') {
          this.logService.setLogLevel(normalizedLevel);
          this.logService.info('[SettingsUI] 日志级别已立即应用:', normalizedLevel);
        }
        
        this.logService?.info('[SettingsUI] 配置已保存:', {
          clientIp,
          serverIp,
          cashierServerIp,
          logLevel: normalizedLevel
        });
        
        // 显示成功提示
        this.toastService?.showSuccess?.(configSaved, 2000);
        
        // 关闭弹窗
        this.closeModal();
        
        // 延迟刷新页面，让用户看到提示信息，并确保所有页面重新初始化
        setTimeout(() => {
          this.logService?.info('[SettingsUI] 刷新页面以应用新的配置');
          window.location.reload();
        }, 1500);
      } else {
        this.toastService?.showError?.(cannotSaveSettings, 2000);
      }
    } catch (e) {
      this.logService?.error('[SettingsUI] 保存配置失败:', e);
      this.toastService?.showError?.(saveFailed, 2000);
    }
  }

  /**
   * 打开设置弹窗
   * 
   * ========== 日志级别统一控制 ==========
   * 这是唯一可以控制日志级别的地方
   * 打开设置弹窗时，确保日志级别与 localStorage 同步
   * ====================================
   */
  async showModal() {
    await this.initServices();
    
    // 确保日志级别与 localStorage 同步（统一控制点）
    if (this.logService && typeof this.logService.setLogLevel === 'function') {
      const currentLogLevel = this.getLogLevel();
      this.logService.setLogLevel(currentLogLevel);
      this.logService?.info('[SettingsUI] 应用当前日志级别:', currentLogLevel);
    }
    
    if (!this.modal) {
      await this.createModal();
    }
    
    if (this.modal && !this.isOpen) {
      this.modal.classList.remove('hidden');
      // 触发动画
      setTimeout(() => {
        this.modal.classList.remove('opacity-0');
        this.modal.classList.add('opacity-100');
      }, 10);
      
      this.isOpen = true;
      
      // 聚焦到密码输入框
      const passwordInput = document.getElementById('settingsPassword');
      if (passwordInput) {
        setTimeout(() => {
          passwordInput.focus();
        }, 100);
      }
      
      // 在 Capacitor 环境中监听键盘事件
      this.setupKeyboardListeners();
      
      this.logService?.info('[SettingsUI] 设置弹窗已打开');
    }
  }

  /**
   * 设置键盘监听器（Capacitor 环境）
   */
  setupKeyboardListeners() {
    if (this._keyboardListenersRegistered) {
      return;
    }

    if (typeof window !== 'undefined' && window.Capacitor) {
      // 监听键盘显示事件
      if (window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) {
        this._keyboardListenersRegistered = true;
        window.Capacitor.Plugins.Keyboard.addListener('keyboardWillShow', (info) => {
          // 只给模态框添加类，不影响 body
          if (this.modal) {
            this.modal.classList.add('capacitor-keyboard-visible');
            
            // 根据实际键盘高度动态调整对话框
            const keyboardHeight = info?.keyboardHeight || 300;
            const viewportHeight = window.innerHeight;
            const availableHeight = viewportHeight - keyboardHeight - 20; // 留20px边距
            
            // 找到对话框内容区域
            const modalContent = this.modal.querySelector(':scope > div:last-child > div');
            if (modalContent) {
              modalContent.style.maxHeight = `${availableHeight}px`;
              this.logService?.debug?.('[SettingsUI] 调整对话框高度');
            }
          }
          
          // 延迟滚动到焦点输入框
          setTimeout(() => {
            this.scrollToFocusedInput(info);
          }, 100);
        });
        
        window.Capacitor.Plugins.Keyboard.addListener('keyboardWillHide', () => {
          // 只从模态框移除类
          if (this.modal) {
            this.modal.classList.remove('capacitor-keyboard-visible');
            
            // 恢复对话框原始高度
            const modalContent = this.modal.querySelector(':scope > div:last-child > div');
            if (modalContent) {
              modalContent.style.maxHeight = '70vh';
              this.logService?.debug?.('[SettingsUI] 恢复对话框高度');
            }
          }
        });
      }
    }
  }

  /**
   * 滚动到获得焦点的输入框
   */
  scrollToFocusedInput(keyboardInfo) {
    const focusedElement = document.activeElement;
    if (!focusedElement || (focusedElement.tagName !== 'INPUT' && focusedElement.tagName !== 'TEXTAREA')) {
      return;
    }

    // 获取输入框的位置
    const rect = focusedElement.getBoundingClientRect();
    const keyboardHeight = keyboardInfo?.keyboardHeight || 300; // 默认键盘高度
    const viewportHeight = window.innerHeight;
    const availableHeight = viewportHeight - keyboardHeight;

    // 如果输入框被键盘遮挡
    if (rect.bottom > availableHeight) {
      // 找到可滚动的父容器
      const scrollContainer = focusedElement.closest('.overflow-y-auto');
      if (scrollContainer) {
        // 计算需要滚动的距离
        const scrollOffset = rect.bottom - availableHeight + 50; // 额外留50px空间
        scrollContainer.scrollTop += scrollOffset;
        
        this.logService?.info('[SettingsUI] 滚动到输入框，偏移:', scrollOffset);
      } else {
        // 如果没有找到滚动容器，尝试滚动到元素
        focusedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  /**
   * 关闭设置弹窗
   */
  closeModal() {
    if (this.modal && this.isOpen) {
      this.modal.classList.add('opacity-0');
      setTimeout(() => {
        this.modal.classList.add('hidden');
        this.isOpen = false;
        
        // 重置状态
        this.isPasswordVerified = false;
        
        // 清空输入框并重置UI状态
        const passwordInput = document.getElementById('settingsPassword');
        const passwordSection = document.getElementById('passwordSection');
        const configSection = document.getElementById('configSection');
        
        if (passwordInput) passwordInput.value = '';
        
        // 重置所有配置输入框的值
        const clientIpInput = document.getElementById('settingsClientIp');
        const serverIpInput = document.getElementById('settingsServerIp');
        const cashierServerIpInput = document.getElementById('settingsCashierServerIp');
        const logLevelSelect = document.getElementById('settingsLogLevel');
        
        if (clientIpInput) clientIpInput.value = this.getCurrentIp();
        if (serverIpInput) serverIpInput.value = this.getServerIp();
        if (cashierServerIpInput) cashierServerIpInput.value = this.getCashierServerIp();
        if (logLevelSelect) {
          const currentLevel = this.getLogLevel();
          logLevelSelect.value = currentLevel;
        }
        
        // 重置显示状态
        if (passwordSection) passwordSection.classList.remove('hidden');
        if (configSection) configSection.classList.add('hidden');
        
        // 隐藏设置按钮
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
          settingsBtn.classList.add('hidden');
          settingsBtn.style.display = 'none';
          this.logService?.info('[SettingsUI] 设置按钮已隐藏');
        }
        
        this.logService?.info('[SettingsUI] 设置弹窗已关闭');
      }, 300);
    }
  }
}

// 创建并导出设置UI实例
const settingsUI = new SettingsUI();

export default settingsUI;
