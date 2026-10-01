import apiService from '../../core/ApiService.js';
import { BaseDeviceService } from './BaseDeviceService.js';
import { logError } from '../../utils/Logger.js';

/**
 * 灯光控制业务逻辑
 */
class LightingService extends BaseDeviceService {
  constructor() {
    super();
    this.apiService = apiService;
    this.state = {
      isAutoLightOn: false,
      selectedLightMode: null
    };
  }

  async handleLightCommand(command) {
    try {
      // 提取场景信息
      // 格式: "light/auto" | "light/manual" | "light/{code}"
      let scene;
      
      if (command === 'light/auto') {
        scene = 'auto';
      } else if (command === 'light/manual') {
        scene = 'manual';
      } else {
        // light/1, light/2, light/98, etc.
        scene = command.replace('light/', '');
      }
      
      // 直接调用结构化控制接口，由后端负责持久化并推送终端指令
      const response = await this.apiService.controlLight({
        scene: scene
      });

      // 更新本地预测状态，语义与后端 light.scene 完全一致
      const newState = {};
      if (scene === 'auto') {
        newState.isAutoLightOn = true;
        newState.selectedLightMode = null;
      } else if (scene === 'manual') {
        newState.isAutoLightOn = false;
        newState.selectedLightMode = null;
      } else {
        newState.isAutoLightOn = false;
        newState.selectedLightMode = command;
      }
      
      // 更新本地状态
      this.state = { ...this.state, ...newState };
      
      // 通过 updateState 方法更新，确保状态同步
      if (typeof this.updateState === 'function') {
        this.updateState(newState);
      }
      
      return response;
    } catch (error) {
      logError('LightingService', '处理灯光命令失败:', error);
      throw error;
    }
  }
}

const lightingService = new LightingService();
export default lightingService;
