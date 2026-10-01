/**
 * 统一的按钮状态管理器
 * 解决更新方法分散、DOM查询频繁、状态冲突等问题
 */

import { logInfo, logWarn, logError } from '../../utils/Logger.js';

export default class ButtonStateManager {
  constructor() {
    // 缓存的DOM元素
    this.cachedElements = new Map();
    
    // 按钮状态处理器
    this.stateHandlers = new Map();
    
    // 当前状态快照
    this.currentState = {};
    
    // 状态更新队列（防止冲突）
    this.updateQueue = [];
    this.isUpdating = false;
    
    // 初始化按钮处理器
    this.initializeHandlers();
  }

  /**
   * 初始化所有按钮的状态处理器
   */
  initializeHandlers() {
    // 播放/暂停按钮
    this.registerHandler('playButton', {
      selector: '[data-command="pause"], [data-command="resume"]',
      stateKeys: ['isPlaying', 'playState'],
      handler: this.updatePlayButton.bind(this)
    });

    // 原唱/伴唱按钮
    this.registerHandler('vocalButton', {
      selector: '[data-command="original"], [data-command="vocal"]',
      stateKeys: ['isOriginal', 'originState'],
      handler: this.updateVocalButton.bind(this)
    });

    // 静音按钮
    this.registerHandler('muteButton', {
      selector: '[data-command="mute"], [data-command="unmute"]',
      stateKeys: ['isMuted', 'muteState'],
      handler: this.updateMuteButton.bind(this)
    });

    // 空调控制按钮
    this.registerHandler('acButtons', {
      selector: '[data-command*="clickButton/wind"], [data-command*="clickButton/cool"], [data-command*="clickButton/hot"], [data-command*="clickButton/ktOpen"]',
      stateKeys: ['wind', 'mode', 'power'],
      handler: this.updateAcButtons.bind(this)
    });

    // 灯光控制按钮
    this.registerHandler('lightButtons', {
      selector: '[data-command^="light/"]',
      stateKeys: ['selectedLightMode', 'isAutoLightOn'],
      handler: this.updateLightButtons.bind(this)
    });

    // 音效按钮
    this.registerHandler('soundEffectButton', {
      selector: '[data-command="audio/effect/cycle"]',
      stateKeys: ['soundEffectMode'],
      handler: this.updateSoundEffectButton.bind(this)
    });
}

  /**
   * 注册按钮处理器
   */
  registerHandler(buttonType, config) {
    this.stateHandlers.set(buttonType, config);
  }

  /**
   * 缓存DOM元素
   */
  cacheElements() {
    this.stateHandlers.forEach((config, buttonType) => {
      const elements = document.querySelectorAll(config.selector);
      if (elements.length > 0) {
        this.cachedElements.set(buttonType, Array.from(elements));
      }
    });
  }

  /**
   * 更新状态（防冲突）
   */
  async updateState(newState, source = 'unknown') {
    return new Promise((resolve) => {
      this.updateQueue.push({ newState, source, resolve });
      this.processUpdateQueue();
    });
  }

  /**
   * 处理更新队列
   */
  async processUpdateQueue() {
    if (this.isUpdating || this.updateQueue.length === 0) {
      return;
    }

    this.isUpdating = true;

    while (this.updateQueue.length > 0) {
      const { newState, source, resolve } = this.updateQueue.shift();
      
      try {
        await this.doUpdateState(newState, source);
        resolve();
      } catch (error) {
        logError('[ButtonStateManager] 状态更新失败:', error);
        resolve();
      }
    }

    this.isUpdating = false;
  }
  /**
   * 执行状态更新
   */
  async doUpdateState(newState, source) {
    const changedButtons = this.detectStateChanges(newState);
    
    if (changedButtons.length === 0) {
      return; // 没有变化，跳过更新
    }

    // 处理状态冲突
    const resolvedState = this.resolveStateConflicts(newState, source);
    
    // 更新当前状态
    Object.assign(this.currentState, resolvedState);
    
    // 更新相关按钮
    for (const buttonType of changedButtons) {
      await this.updateButton(buttonType, resolvedState);
    }

    logInfo(`[ButtonStateManager] 状态更新完成 (${source}):`, changedButtons);
  }

  /**
   * 检测状态变化
   */
  detectStateChanges(newState) {
    const changedButtons = [];

    this.stateHandlers.forEach((config, buttonType) => {
      const hasChange = config.stateKeys.some(key => {
        return newState.hasOwnProperty(key) && newState[key] !== this.currentState[key];
      });

      if (hasChange) {
        changedButtons.push(buttonType);
      }
    });

    return changedButtons;
  }

  /**
   * 解决状态冲突
   */
  resolveStateConflicts(newState, source) {
    const resolvedState = { ...newState };

    // 服务器状态优先级最高
    if (source === 'server') {
      return resolvedState;
    }

    // 检查冲突并记录
    Object.keys(newState).forEach(key => {
      if (this.currentState.hasOwnProperty(key) && 
          this.currentState[key] !== newState[key]) {
      }
    });

    return resolvedState;
  }
  /**
   * 更新单个按钮
   */
  async updateButton(buttonType, state) {
    const config = this.stateHandlers.get(buttonType);
    const elements = this.cachedElements.get(buttonType);

    if (!config || !elements || elements.length === 0) {
      return;
    }

    try {
      await config.handler(elements, state);
    } catch (error) {
      logError(`[ButtonStateManager] 更新 ${buttonType} 失败:`, error);
    }
  }

  /**
   * 播放按钮更新处理器
   */
  updatePlayButton(elements, state) {
    const isPlaying = state.isPlaying === true || state.playState === 1;

    elements.forEach(button => {
      const targetCommand = isPlaying ? 'pause' : 'resume';
      button.dataset.command = targetCommand;

      const icon = button.querySelector('i');
      const text = button.querySelector('span:not(.indonesian-translation)');

      if (icon) {
        const isInBottomNav = button.closest('#bottom-nav');
        if (isInBottomNav) {
          icon.className = `fa ${isPlaying ? 'fa-pause' : 'fa-play'}`;
        } else {
          icon.className = `page-button-icon fa ${isPlaying ? 'fa-pause' : 'fa-play'} mb-1 text-gray-700 dark:text-gray-300 leading-tight`;
        }
      }

      if (text) {
        text.textContent = isPlaying ? '暂停' : '播放';
      }
    });
  }

  /**
   * 原唱/伴唱按钮更新处理器
   */
  updateVocalButton(elements, state) {
    const isOriginal = state.isOriginal === true || state.originState === 1;

    elements.forEach(button => {
      const targetCommand = isOriginal ? 'vocal' : 'original';
      button.dataset.command = targetCommand;

      const icon = button.querySelector('i');
      const text = button.querySelector('span:not(.indonesian-translation)');

      if (icon) {
        const isInBottomNav = button.closest('#bottom-nav');
        if (isInBottomNav) {
          icon.className = `fa ${isOriginal ? 'fa-microphone' : 'fa-music'}`;
        } else {
          icon.className = `page-button-icon fa ${isOriginal ? 'fa-microphone' : 'fa-music'} mb-1 text-gray-700 dark:text-gray-300 leading-tight`;
        }
      }

      if (text) {
        text.textContent = isOriginal ? '伴唱' : '原唱';
      }
    });
  }

  /**
   * 静音按钮更新处理器
   */
  updateMuteButton(elements, state) {
    const isMuted = state.isMuted === true || state.muteState === 1;
    const langService = window.langService;

    // 获取各语言的静音/取消静音文本
    const getLangText = (lang, key) => {
      if (langService && langService.translations && langService.translations[lang]) {
        return langService.translations[lang][key] || null;
      }
      return null;
    };
    const muteKey = isMuted ? 'unmute' : 'mute';
    const zhText = getLangText('zh_cn', muteKey) || (isMuted ? '取消静音' : '静音');
    const idText = getLangText('id_id', muteKey) || (isMuted ? 'Buka bisukan' : 'Bisukan');
    const enText = getLangText('en_us', muteKey) || (isMuted ? 'Unmute' : 'Mute');
    const viText = getLangText('vi_vn', muteKey) || (isMuted ? 'Bật tiếng' : 'Tắt tiếng');

    elements.forEach(button => {
      const targetCommand = isMuted ? 'unmute' : 'mute';
      button.dataset.command = targetCommand;

      const icon = button.querySelector('i');
      if (icon) {
        const isInBottomNav = button.closest('#bottom-nav');
        if (isInBottomNav) {
          icon.className = `fa ${isMuted ? 'fa-volume-off' : 'fa-volume-up'}`;
        } else {
          icon.className = `page-button-icon fa ${isMuted ? 'fa-volume-off' : 'fa-volume-up'} mb-1 text-gray-700 dark:text-gray-300 leading-tight`;
        }
      }

      // 更新所有语言的文本 span
      const zhSpan = button.querySelector('.zh-label');
      const idSpan = button.querySelector('.indonesian-translation');
      const enSpan = button.querySelector('.en-translation');
      const viSpan = button.querySelector('.vi-translation');

      if (zhSpan) {
        zhSpan.textContent = zhText;
      } else {
        // 没有多语言 span 结构时，更新第一个非翻译 span
        const text = button.querySelector('span:not(.indonesian-translation):not(.en-translation):not(.vi-translation):not(.mute-volume-value)');
        if (text) text.textContent = zhText;
      }
      if (idSpan) idSpan.textContent = idText;
      if (enSpan) enSpan.textContent = enText;
      if (viSpan) viSpan.textContent = viText;
    });
  }

  /**
   * 空调按钮更新处理器
   */
  updateAcButtons(elements, state) {
    elements.forEach(button => {
      const command = button.dataset.command;
      
      if (command.includes('wind')) {
        this.updateWindButton(button, command, state);
      } else if (command.includes('cool') || command.includes('hot')) {
        this.updateAcModeButton(button, command, state);
      } else if (command.includes('ktOpen')) {
        this.updateAcPowerButton(button, state);
      }
    });
  }

  /**
   * 更新风速按钮
   */
  updateWindButton(button, command, state) {
    const windMap = {
      'consumer/clickButton/windLowerButton': 'low',
      'consumer/clickButton/windMidButton': 'mid',
      'consumer/clickButton/windHighButton': 'high'
    };

    const isActive = state.wind === windMap[command];

    const icon = button.querySelector('i');
    const text = button.querySelector('span:not(.indonesian-translation)');
    
    // 重置样式
    button.classList.remove('bg-red-500', 'text-white', 'hover:bg-gray-200', 'dark:hover:bg-gray-600');
    button.classList.add('bg-gray-100', 'dark:bg-gray-700');

    if (icon) {
      icon.classList.remove('text-white');
      icon.classList.add('text-gray-700', 'dark:text-gray-300');
    }
    if (text) {
      text.classList.remove('text-white');
      text.classList.add('text-gray-700', 'dark:text-gray-300');
    }

    if (isActive) {
      button.classList.remove('bg-gray-100', 'dark:bg-gray-700');
      button.classList.add('bg-red-500', 'text-white');
      
      if (icon) {
        icon.classList.remove('text-gray-700', 'dark:text-gray-300');
        icon.classList.add('text-white');
      }
      if (text) {
        text.classList.remove('text-gray-700', 'dark:text-gray-300');
        text.classList.add('text-white');
      }
    }
  }

  /**
   * 更新空调模式按钮
   */
  updateAcModeButton(button, command, state) {
    const icon = button.querySelector('i');
    const text = button.querySelector('span:not(.indonesian-translation)');
    
    const isCoolButton = command.includes('cool');
    const isHeatButton = command.includes('hot');
    const isActive = (isCoolButton && state.mode === 'cool') || 
                     (isHeatButton && state.mode === 'heat');

    if (icon) {
      icon.classList.remove('text-blue-500', 'dark:text-blue-500', 'text-red-500', 'dark:text-red-500', 'text-gray-700', 'dark:text-gray-300');
      
      if (isActive) {
        if (isCoolButton) {
          icon.classList.add('text-blue-500', 'dark:text-blue-500');
        } else if (isHeatButton) {
          icon.classList.add('text-red-500', 'dark:text-red-500');
        }
      } else {
        icon.classList.add('text-gray-700', 'dark:text-gray-300');
      }
    }

    if (text) {
      text.classList.remove('text-blue-500', 'dark:text-blue-500', 'text-red-500', 'dark:text-red-500', 'text-gray-700', 'dark:text-gray-300');
      
      if (isActive) {
        if (isCoolButton) {
          text.classList.add('text-blue-500', 'dark:text-blue-500');
        } else if (isHeatButton) {
          text.classList.add('text-red-500', 'dark:text-red-500');
        }
      } else {
        text.classList.add('text-gray-700', 'dark:text-gray-300');
      }
    }
  }

  /**
   * 更新空调电源按钮
   */
  updateAcPowerButton(button, state) {
    const targetCommand = state.power ? 'consumer/clickButton/ktCloseButton' : 'consumer/clickButton/ktOpenButton';
    button.dataset.command = targetCommand;
    
    const icon = button.querySelector('i');
    const text = button.querySelector('span:not(.indonesian-translation)');
    
    if (icon) {
      icon.classList.remove('text-green-500', 'dark:text-green-400', 'text-gray-700', 'dark:text-gray-300');
      if (state.power) {
        icon.classList.add('text-green-500', 'dark:text-green-400');
      } else {
        icon.classList.add('text-gray-700', 'dark:text-gray-300');
      }
    }

    if (text) {
      text.textContent = state.power ? '关机' : '开机';
      text.classList.remove('text-green-500', 'dark:text-green-400', 'text-gray-700', 'dark:text-gray-300');
      if (state.power) {
        text.classList.add('text-green-500', 'dark:text-green-400');
      } else {
        text.classList.add('text-gray-700', 'dark:text-gray-300');
      }
    }
  }

  /**
   * 灯光按钮更新处理器
   */
  updateLightButtons(elements, state) {
    elements.forEach(button => {
      const command = button.dataset.command;
      
      if (command === 'light/auto') {
        this.updateAutoLightButton(button, state);
      } else {
        this.updateLightModeButton(button, command, state);
      }
    });
  }

  /**
   * 更新自动灯光按钮
   */
  updateAutoLightButton(button, state) {
    const isAutoLightOn = state.isAutoLightOn === true || state.autoLightState === 1;
    
    // 移除已有的红点
    button.querySelectorAll('.auto-dot').forEach(dot => dot.remove());
    
    const icon = button.querySelector('i');
    const text = button.querySelector('span:not(.indonesian-translation)');
    
    // 重置样式
    button.classList.remove('bg-red-500', 'text-red-500', 'dark:text-red-400');
    button.classList.add('bg-gray-100', 'dark:bg-gray-700');
    
    if (icon) {
      icon.classList.remove('text-red-500', 'dark:text-red-400', 'text-white');
      icon.classList.add('text-gray-700', 'dark:text-gray-300');
    }
    if (text) {
      text.classList.remove('text-red-500', 'dark:text-red-400', 'text-white');
      text.classList.add('text-gray-700', 'dark:text-gray-300');
    }
    
    if (isAutoLightOn) {
      // 添加红点
      const dot = document.createElement('span');
      dot.className = 'auto-dot absolute top-2 left-2 w-1.5 h-1.5 bg-red-500 rounded-full z-1000';
      button.style.position = 'relative';
      button.appendChild(dot);
      
      // 设置红色文本
      if (icon) {
        icon.classList.remove('text-gray-700', 'dark:text-gray-300');
        icon.classList.add('text-red-500', 'dark:text-red-400');
      }
      if (text) {
        text.classList.remove('text-gray-700', 'dark:text-gray-300');
        text.classList.add('text-red-500', 'dark:text-red-400');
      }
    }
  }

  /**
   * 更新灯光模式按钮
   */
  updateLightModeButton(button, command, state) {
    const isSelected = state.selectedLightMode === command;
    
    const icon = button.querySelector('i');
    const text = button.querySelector('span:not(.indonesian-translation)');
    
    // 重置样式
    button.classList.remove('bg-red-500', 'text-white', 'hover:bg-red-500', 'dark:hover:bg-red-500');
    button.classList.add('bg-gray-100', 'dark:bg-gray-700', 'hover:bg-gray-200', 'dark:hover:bg-gray-600');
    
    if (icon) {
      icon.classList.remove('text-white');
      icon.classList.add('text-gray-700', 'dark:text-gray-300');
    }
    if (text) {
      text.classList.remove('text-white');
      text.classList.add('text-gray-700', 'dark:text-gray-300');
    }
    
    if (isSelected) {
      button.classList.remove('bg-gray-100', 'dark:bg-gray-700', 'hover:bg-gray-200', 'dark:hover:bg-gray-600');
      button.classList.add('bg-red-500', 'text-white', 'hover:bg-red-500', 'dark:hover:bg-red-500');
      
      if (icon) {
        icon.classList.remove('text-gray-700', 'dark:text-gray-300');
        icon.classList.add('text-white');
      }
      if (text) {
        text.classList.remove('text-gray-700', 'dark:text-gray-300');
        text.classList.add('text-white');
      }
    }
  }

  /**
   * 音效按钮更新处理器
   */
  async updateSoundEffectButton(elements, state) {
    elements.forEach(button => {
      button.querySelectorAll('.sound-effect-dot').forEach(dot => dot.remove());
      
      if (state.soundEffectMode) {
        const dot = document.createElement('span');
        dot.className = 'sound-effect-dot absolute top-2 left-2 w-1.5 h-1.5 bg-red-500 rounded-full z-1000';
        button.style.position = 'relative';
        button.appendChild(dot);
      }
    });
  }

  /**
   * 初始化管理器
   */
  async initialize() {
    // 缓存DOM元素
    this.cacheElements();
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.cachedElements.clear();
    this.stateHandlers.clear();
    this.currentState = {};
    this.updateQueue = [];
    this.isUpdating = false;
  }
}