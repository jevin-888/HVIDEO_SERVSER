/**
 * 外设状态栏组件
 * 用于在底部显示房间的外设状态（空调、灯光、音效）
 */
class PeripheralStatusBar {
  constructor() {
    this.statusBarElement = null;
    this.currentRoomId = null;
  }

  /**
   * 初始化状态栏
   * @param {string} containerId - 状态栏容器ID
   */
  init(containerId) {
    this.statusBarElement = document.getElementById(containerId);
    if (!this.statusBarElement) {
      console.error('[PeripheralStatusBar] 状态栏容器未找到:', containerId);
      return false;
    }
    return true;
  }

  /**
   * 解析空调状态
   * @param {string} acStateJson - 空调状态JSON字符串
   * @returns {Object} 解析后的状态对象
   */
  parseAcState(acStateJson) {
    try {
      const state = JSON.parse(acStateJson || '{}');
      return {
        power: state.power || false,
        temp: state.temp || 26,
        mode: state.mode || 'auto'
      };
    } catch (e) {
      console.warn('[PeripheralStatusBar] 解析空调状态失败:', e);
      return { power: false, temp: 26, mode: 'auto' };
    }
  }

  /**
   * 解析灯光状态
   * @param {string} lightStateJson - 灯光状态JSON字符串
   * @returns {Object} 解析后的状态对象
   */
  parseLightState(lightStateJson) {
    try {
      const state = JSON.parse(lightStateJson || '{}');
      const sceneMap = {
        'bright': '明亮',
        'warm': '温馨',
        'dynamic': '梦幻',
        'standard': '标准',
        'romantic': '浪漫',
        'off': '全关',
        'auto': '自动'
      };
      return {
        scene: state.scene || 'auto',
        sceneName: sceneMap[state.scene] || '自动'
      };
    } catch (e) {
      console.warn('[PeripheralStatusBar] 解析灯光状态失败:', e);
      return { scene: 'auto', sceneName: '自动' };
    }
  }

  /**
   * 解析音效状态
   * @param {string} effectStateJson - 音效状态JSON字符串
   * @returns {Object} 解析后的状态对象
   */
  parseEffectState(effectStateJson) {
    try {
      const state = JSON.parse(effectStateJson || '{}');
      const modeMap = {
        'ktv': 'KTV模式',
        'concert': '音乐会',
        'pop': '流行',
        'rock': '摇滚',
        'standard': '标准'
      };
      return {
        mode: state.mode || 'standard',
        modeName: modeMap[state.mode] || '标准'
      };
    } catch (e) {
      console.warn('[PeripheralStatusBar] 解析音效状态失败:', e);
      return { mode: 'standard', modeName: '标准' };
    }
  }

  /**
   * 更新状态栏显示
   * @param {Object} roomData - 房间数据
   */
  updateStatus(roomData) {
    if (!this.statusBarElement) {
      console.warn('[PeripheralStatusBar] 状态栏未初始化');
      return;
    }

    if (!roomData) {
      this.clear();
      return;
    }

    this.currentRoomId = roomData.id;

    // 解析外设状态
    const acState = this.parseAcState(roomData.acState);
    const lightState = this.parseLightState(roomData.lightState);
    const effectState = this.parseEffectState(roomData.effectState);

    // 空调状态显示
    const acIcon = acState.power ? 'fa-snowflake text-blue-400' : 'fa-snowflake text-gray-500';
    const acText = acState.power ? `${acState.temp}℃` : '关';
    
    // 灯光状态显示
    const lightIcon = lightState.scene !== 'off' ? 'fa-lightbulb text-yellow-400' : 'fa-lightbulb text-gray-500';
    const lightText = lightState.sceneName;
    
    // 音效状态显示
    const effectIcon = 'fa-sliders-h text-green-400';
    const effectText = effectState.modeName;

    // 底部状态栏样式 - 横向紧凑布局
    this.statusBarElement.innerHTML = `
      <div class="flex items-center space-x-4">
        <!-- 空调 -->
        <div class="flex items-center space-x-1.5">
          <i class="fas ${acIcon}"></i>
          <span class="text-gray-400">空调</span>
          <span class="text-white font-medium">${acText}</span>
        </div>
        
        <span class="text-gray-600">|</span>
        
        <!-- 灯光 -->
        <div class="flex items-center space-x-1.5">
          <i class="fas ${lightIcon}"></i>
          <span class="text-gray-400">灯光</span>
          <span class="text-white font-medium">${lightText}</span>
        </div>
        
        <span class="text-gray-600">|</span>
        
        <!-- 音效 -->
        <div class="flex items-center space-x-1.5">
          <i class="fas ${effectIcon}"></i>
          <span class="text-gray-400">音效</span>
          <span class="text-white font-medium">${effectText}</span>
        </div>
      </div>
    `;
  }

  /**
   * 清空状态栏
   */
  clear() {
    if (this.statusBarElement) {
      this.statusBarElement.innerHTML = '<span class="text-gray-500">所有状态区域</span>';
      this.currentRoomId = null;
    }
  }

  /**
   * 获取房间类型名称
   * @param {number} typeId - 类型ID
   * @returns {string} 类型名称
   */
  getRoomTypeName(typeId) {
    // 这里应该从全局的房间类型列表中获取
    // 暂时返回空，后续可以通过 window.roomTypes 获取
    if (window.roomTypes && typeId) {
      const type = window.roomTypes.find(t => t.id === typeId);
      return type ? type.name : '';
    }
    return '';
  }

  /**
   * 获取房间区域名称
   * @param {number} areaId - 区域ID
   * @returns {string} 区域名称
   */
  getRoomAreaName(areaId) {
    // 这里应该从全局的房间区域列表中获取
    // 暂时返回空，后续可以通过 window.roomAreas 获取
    if (window.roomAreas && areaId) {
      const area = window.roomAreas.find(a => a.id === areaId);
      return area ? area.name : '';
    }
    return '';
  }

  /**
   * 滚动到外设控制区域
   * @param {string} type - 外设类型 (ac/light/effect)
   */
  scrollToPeripheral(type) {
    // 这里可以实现滚动到包厢详情面板的外设控制区域
    // 或者触发打开外设控制面板的事件
    const detailPanel = document.getElementById('room-detail');
    if (detailPanel && !detailPanel.classList.contains('hidden')) {
      // 如果详情面板已打开，滚动到对应的外设控制区域
      const peripheralSection = detailPanel.querySelector('.peripheral-controls');
      if (peripheralSection) {
        peripheralSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  /**
   * 清空状态栏
   */
  clear() {
    if (this.statusBarElement) {
      this.statusBarElement.innerHTML = '';
      this.currentRoomId = null;
    }
  }

  /**
   * 更新单个外设状态（用于实时更新）
   * @param {string} roomId - 房间ID
   * @param {string} type - 外设类型 (ac/light/effect)
   * @param {string} stateJson - 状态JSON字符串
   */
  updatePeripheralState(roomId, type, stateJson) {
    if (this.currentRoomId !== roomId) {
      return; // 不是当前显示的房间，忽略
    }

    // 这里可以实现更细粒度的更新，避免重新渲染整个状态栏
    // 暂时简化处理，后续优化
  }
}

// 创建全局实例
const peripheralStatusBar = new PeripheralStatusBar();
