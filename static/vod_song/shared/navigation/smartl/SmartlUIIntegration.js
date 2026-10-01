/**
 * SmartlUI 集成 ButtonStateManager 的包装器
 * 解决更新方法分散、DOM查询频繁、状态冲突风险等问题
 */

import ButtonStateManager from './ButtonStateManager.js';
import { logInfo, logWarn, logError } from '../../utils/Logger.js';

export default class SmartlUIIntegration {
  constructor(smartlService) {
    this.smartlService = smartlService;
    this.buttonStateManager = new ButtonStateManager();
    this.isInitialized = false;
    
    // 绑定方法到实例
    this.updateButtonStates = this.updateButtonStates.bind(this);
    this.updateVolumeDisplay = this.updateVolumeDisplay.bind(this);
    this.updateAutoLightButtonUI = this.updateAutoLightButtonUI.bind(this);
    this.updateLightModeButtonsUI = this.updateLightModeButtonsUI.bind(this);
    this.updateSoundEffectUI = this.updateSoundEffectUI.bind(this);
  }

  /**
   * 初始化集成系统
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // 初始化按钮状态管理器
      await this.buttonStateManager.initialize();
      
      // 设置音效名称获取函数
      this.buttonStateManager.getSoundEffectName = this.getSoundEffectName.bind(this);
      
      this.isInitialized = true;
    } catch (error) {
      logError('[SmartlUIIntegration] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 统一的按钮状态更新方法（替代原有的分散更新方法）
   */
  async updateButtonStates(source = 'local') {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.smartlService) {
      return;
    }

    try {
      const state = this.smartlService.getState();
      await this.buttonStateManager.updateState(state, source);
      
      logInfo(`[SmartlUIIntegration] 按钮状态更新完成 (${source})`);
    } catch (error) {
      logError('[SmartlUIIntegration] 按钮状态更新失败:', error);
    }
  }

  /**
   * 更新音量显示（保持原有接口兼容性）
   */
  updateVolumeDisplay(action) {
    if (!this.smartlService) return;
    
    const state = this.smartlService.getState();
    
    // 更新音乐音量显示
    const musicVolume = document.getElementById('music-volume');
    const musicProgress = document.getElementById('music-progress');
    if (musicVolume) {
      musicVolume.textContent = state.volume;
    }
    if (musicProgress) {
      musicProgress.style.setProperty('--progress-width', `${state.volume}%`);
      musicProgress.style.width = `${state.volume}%`;
    }
    
    // 更新麦克风音量显示
    const micVolume = document.getElementById('mic-volume');
    const micProgress = document.getElementById('mic-progress');
    if (micVolume) {
      micVolume.textContent = state.micVolume;
    }
    if (micProgress) {
      micProgress.style.setProperty('--progress-width', `${state.micVolume}%`);
      micProgress.style.width = `${state.micVolume}%`;
    }
    
    // 同时更新相关按钮状态
    this.updateButtonStates('volume');
  }

  /**
   * 更新自动灯光按钮UI（保持原有接口兼容性）
   */
  async updateAutoLightButtonUI() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.smartlService) return;
    
    const state = this.smartlService.getState();
    
    // 只更新自动灯光按钮
    const autoButton = document.querySelector('[data-command="light/auto"]');
    if (autoButton) {
      this.buttonStateManager.updateAutoLightButton(autoButton, state);
    }
  }

  /**
   * 更新灯光模式按钮UI（保持原有接口兼容性）
   */
  async updateLightModeButtonsUI() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.smartlService) return;
    
    const state = this.smartlService.getState();
    
    // 更新所有灯光模式按钮
    const lightButtons = document.querySelectorAll('[data-command^="light/"]:not([data-command="light/auto"])');
    lightButtons.forEach(button => {
      const command = button.dataset.command;
      this.buttonStateManager.updateLightModeButton(button, command, state);
    });
  }

  /**
   * 更新音效按钮UI（保持原有接口兼容性）
   */
  async updateSoundEffectUI() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.smartlService) return;
    
    const state = this.smartlService.getState();
    
    // 更新音效按钮
    const effectButton = document.querySelector('[data-command="audio/effect/cycle"]');
    if (effectButton) {
      await this.buttonStateManager.updateSoundEffectButton([effectButton], state);
    }
  }

  /**
   * 获取音效名称（提供给 ButtonStateManager 使用）
   */
  async getSoundEffectName(mode) {
    try {
      if (!this.smartlService) return '';
      const soundEffects = await this.smartlService.getDict('soundEffect');
      if (Array.isArray(soundEffects) && soundEffects.length > 0) {
        const effect = soundEffects.find(item => item.code === mode || item.mode === mode);
        if (effect && effect.name) return effect.name;
      }
      return '';
    } catch (error) {
      logError('[SmartlUIIntegration] 获取音效名称失败:', error);
      return '';
    }
  }

  /**
   * 更新所有UI（统一入口）
   */
  async updateAllUI(source = 'sync') {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // 更新按钮状态
      await this.updateButtonStates(source);
      
      // 更新音量显示
      this.updateVolumeDisplay();
      
      // 更新温度显示
      this.updateTemperatureDisplay();
      
      logInfo(`[SmartlUIIntegration] 所有UI更新完成 (${source})`);
    } catch (error) {
      logError('[SmartlUIIntegration] 更新所有UI失败:', error);
    }
  }

  /**
   * 更新温度显示
   */
  updateTemperatureDisplay() {
    if (!this.smartlService) return;
    
    const state = this.smartlService.getState();
    const tempDisplay = document.querySelector('#ac-tab .text-lg.font-bold.text-gray-800, #ac-tab .page-subtitle.font-bold');
    if (tempDisplay) {
      tempDisplay.textContent = `${state.temp}°C`;
    }
  }

  /**
   * 根据opKey更新相关UI（WebSocket同步使用）
   */
  async updateUIForSyncState(opKey) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      switch (opKey) {
        case 1:  // 播放状态
        case 2:  // 原伴唱状态
        case 3:  // 静音状态
        case 13: // 空调开机状态
        case 14: // 空调风速状态
        case 15: // 空调制冷制热状态
          await this.updateButtonStates('server');
          break;
          
        case 4:  // 音乐音量
        case 5:  // 麦克风音量
          this.updateVolumeDisplay();
          break;
          
        case 9:  // 灯光模式状态
          await this.updateLightModeButtonsUI();
          break;
          
        case 10: // 音效模式状态
          await this.updateSoundEffectUI();
          break;
          
        case 11: // 自动灯光按钮状态
          await this.updateAutoLightButtonUI();
          break;
          
        case 16: // 温度显示
          this.updateTemperatureDisplay();
          break;
      }
    } catch (error) {
      logError(`[SmartlUIIntegration] 更新UI失败 (opKey: ${opKey}):`, error);
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.buttonStateManager) {
      this.buttonStateManager.cleanup();
    }
    this.isInitialized = false;
  }
}