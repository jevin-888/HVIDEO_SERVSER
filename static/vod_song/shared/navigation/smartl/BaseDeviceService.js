/**
 * 设备服务基类
 * 提取 AcService 和 LightingService 的公共方法
 */
export class BaseDeviceService {
  constructor() {
    this.state = {};
  }

  getState() {
    return { ...this.state };
  }

  updateState(newState) {
    this.state = { ...this.state, ...newState };
  }
}
