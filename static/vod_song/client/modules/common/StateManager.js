/**
 * 统一状态管理器
 * 用于管理UI组件的状态，避免状态分散和混乱
 */
export class StateManager {
  constructor(initialState = {}) {
    // 状态存储
    this._state = { ...initialState };
    
    // 状态变更监听器
    this._listeners = new Map();
    
    // 状态变更历史（用于调试）
    this._history = [];
    this._maxHistorySize = 50;
  }

  /**
   * 获取状态值
   * @param {string} key - 状态键
   * @param {any} defaultValue - 默认值
   * @returns {any} 状态值
   */
  get(key, defaultValue = undefined) {
    return this._state[key] !== undefined ? this._state[key] : defaultValue;
  }

  /**
   * 设置状态值
   * @param {string|Object} key - 状态键或状态对象
   * @param {any} value - 状态值（当key为对象时忽略）
   * @returns {this} 返回this以支持链式调用
   */
  set(key, value) {
    const oldState = { ...this._state };
    
    if (typeof key === 'object' && key !== null) {
      // 批量设置
      Object.assign(this._state, key);
    } else {
      // 单个设置
      this._state[key] = value;
    }
    
    // 记录变更历史
    this._recordChange(key, oldState, this._state);
    
    // 触发监听器
    this._notifyListeners(key, oldState, this._state);
    
    return this;
  }

  /**
   * 批量更新状态
   * @param {Object} updates - 要更新的状态对象
   * @returns {this} 返回this以支持链式调用
   */
  update(updates) {
    return this.set(updates);
  }

  /**
   * 重置状态到初始值
   * @param {Object} initialState - 新的初始状态（可选）
   * @returns {this} 返回this以支持链式调用
   */
  reset(initialState = null) {
    const oldState = { ...this._state };
    
    if (initialState) {
      this._state = { ...initialState };
    } else {
      // 重置到构造函数传入的初始状态
      this._state = {};
    }
    
    // 记录变更历史
    this._recordChange('reset', oldState, this._state);
    
    // 触发监听器
    this._notifyListeners('reset', oldState, this._state);
    
    return this;
  }

  /**
   * 获取所有状态
   * @returns {Object} 状态对象的副本
   */
  getAll() {
    return { ...this._state };
  }

  /**
   * 检查状态是否存在
   * @param {string} key - 状态键
   * @returns {boolean} 是否存在
   */
  has(key) {
    return key in this._state;
  }

  /**
   * 删除状态
   * @param {string} key - 状态键
   * @returns {boolean} 是否删除成功
   */
  delete(key) {
    if (!(key in this._state)) {
      return false;
    }
    
    const oldState = { ...this._state };
    delete this._state[key];
    
    // 记录变更历史
    this._recordChange(key, oldState, this._state);
    
    // 触发监听器
    this._notifyListeners(key, oldState, this._state);
    
    return true;
  }

  /**
   * 监听状态变更
   * @param {string|Function} keyOrCallback - 状态键或回调函数
   * @param {Function} callback - 回调函数（当第一个参数是key时）
   * @returns {Function} 取消监听的函数
   */
  subscribe(keyOrCallback, callback) {
    let key, handler;
    
    if (typeof keyOrCallback === 'function') {
      // 监听所有状态变更
      key = '*';
      handler = keyOrCallback;
    } else {
      // 监听特定状态变更
      key = keyOrCallback;
      handler = callback;
    }
    
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    
    this._listeners.get(key).add(handler);
    
    // 返回取消监听的函数
    return () => {
      const listeners = this._listeners.get(key);
      if (listeners) {
        listeners.delete(handler);
        if (listeners.size === 0) {
          this._listeners.delete(key);
        }
      }
    };
  }

  /**
   * 取消监听
   * @param {string|Function} keyOrCallback - 状态键或回调函数
   * @param {Function} callback - 回调函数（当第一个参数是key时）
   */
  unsubscribe(keyOrCallback, callback) {
    let key, handler;
    
    if (typeof keyOrCallback === 'function') {
      key = '*';
      handler = keyOrCallback;
    } else {
      key = keyOrCallback;
      handler = callback;
    }
    
    const listeners = this._listeners.get(key);
    if (listeners) {
      listeners.delete(handler);
      if (listeners.size === 0) {
        this._listeners.delete(key);
      }
    }
  }

  /**
   * 记录状态变更历史
   * @private
   */
  _recordChange(key, oldState, newState) {
    this._history.push({
      key,
      oldState: { ...oldState },
      newState: { ...newState },
      timestamp: Date.now()
    });
    
    // 限制历史记录大小
    if (this._history.length > this._maxHistorySize) {
      this._history.shift();
    }
  }

  /**
   * 通知监听器
   * @private
   */
  _notifyListeners(changedKey, oldState, newState) {
    // 通知特定键的监听器
    const specificListeners = this._listeners.get(changedKey);
    if (specificListeners) {
      specificListeners.forEach(listener => {
        try {
          listener(newState[changedKey], oldState[changedKey], changedKey, newState);
        } catch (error) {
          console.error('[StateManager] 监听器执行错误:', error);
        }
      });
    }
    
    // 通知全局监听器
    const globalListeners = this._listeners.get('*');
    if (globalListeners) {
      globalListeners.forEach(listener => {
        try {
          listener(newState, oldState, changedKey);
        } catch (error) {
          console.error('[StateManager] 监听器执行错误:', error);
        }
      });
    }
  }

  /**
   * 获取状态变更历史
   * @param {number} limit - 限制返回的历史记录数量
   * @returns {Array} 历史记录数组
   */
  getHistory(limit = 10) {
    return this._history.slice(-limit);
  }

  /**
   * 清空历史记录
   */
  clearHistory() {
    this._history = [];
  }

  /**
   * 导出状态（用于持久化）
   * @returns {Object} 状态对象
   */
  export() {
    return JSON.parse(JSON.stringify(this._state));
  }

  /**
   * 导入状态（用于恢复）
   * @param {Object} state - 要导入的状态对象
   */
  import(state) {
    if (typeof state === 'object' && state !== null) {
      const oldState = { ...this._state };
      this._state = JSON.parse(JSON.stringify(state));
      
      // 记录变更历史
      this._recordChange('import', oldState, this._state);
      
      // 触发监听器
      this._notifyListeners('import', oldState, this._state);
    }
  }

  /**
   * 清理所有监听器和历史记录
   */
  cleanup() {
    this._listeners.clear();
    this._history = [];
  }
}

/**
 * 创建状态管理器的工厂函数
 * @param {Object} initialState - 初始状态
 * @returns {StateManager} 状态管理器实例
 */
function createStateManager(initialState = {}) {
  return new StateManager(initialState);
}

export default StateManager;

