import apiService from '../../core/ApiService.js';
import { BaseDeviceService } from './BaseDeviceService.js';
import { logError } from '../../utils/Logger.js';

/**
 * 空调控制业务逻辑
 * 状态字段严格对齐后端 ACControlRequest：
 *   power: bool
 *   temp: number (16~32)
 *   mode: 'cool' | 'heat' | 'auto'
 *   wind: 'low' | 'mid' | 'high'
 */
class AcService extends BaseDeviceService {
  constructor() {
    super();
    this.apiService = apiService;
    this.state = {
      power: false,
      temp: 26,
      mode: 'cool',
      wind: 'low',
    };
  }

  async handleAcCommand(command) {
    try {
      let buttonNameAlias = command;
      if (command.startsWith('consumer/clickButton/')) {
        buttonNameAlias = command.replace('consumer/clickButton/', '');
      }

      switch (buttonNameAlias) {
        case 'ktOpenButton':
          this.state.power = true;
          break;
        case 'ktCloseButton':
          this.state.power = false;
          break;
        case 'temAddButton':
          this.state.temp = Math.min(32, this.state.temp + 1);
          break;
        case 'temMinusButton':
          this.state.temp = Math.max(16, this.state.temp - 1);
          break;
        case 'coolButton':
          this.state.mode = 'cool';
          break;
        case 'hotButton':
          this.state.mode = 'heat';
          break;
        case 'windLowerButton':
          this.state.wind = 'low';
          break;
        case 'windMidButton':
          this.state.wind = 'mid';
          break;
        case 'windHighButton':
          this.state.wind = 'high';
          break;
      }

      const response = await this.apiService.controlAc({
        power: this.state.power,
        temp: this.state.temp,
        mode: this.state.mode,
        wind: this.state.wind,
      });

      // 用后台返回的实际值更新状态
      if (response && response.code === 0 && response.data?.ac) {
        const ac = response.data.ac;
        if (ac.temp !== undefined) this.state.temp = ac.temp;
        if (ac.power !== undefined) this.state.power = ac.power;
        if (ac.mode !== undefined) this.state.mode = ac.mode;
        if (ac.wind !== undefined) this.state.wind = ac.wind;
        // 同步到 smartlService.state
        if (typeof window !== 'undefined' && window.smartlService) {
          window.smartlService.state.temp = this.state.temp;
          window.smartlService.state.power = this.state.power;
          window.smartlService.state.mode = this.state.mode;
          window.smartlService.state.wind = this.state.wind;
        }
      }

      return response;
    } catch (error) {
      if (typeof window !== 'undefined' && window.logService) {
        window.logService.error('处理空调命令失败', 'AcService', error);
      } else {
        logError('AcService', '处理空调命令失败:', error);
      }
      throw error;
    }
  }
}

const acService = new AcService();
export default acService;
