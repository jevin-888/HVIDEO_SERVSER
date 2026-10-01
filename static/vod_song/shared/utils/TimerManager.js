/**
 * 统一的定时器管理器
 * 用于集中管理 setTimeout / setInterval / requestAnimationFrame
 * 避免内存泄漏并便于调试
 */
class TimerManager {
  constructor() {
    this._timeouts = new Set();
    this._intervals = new Set();
    this._animationFrames = new Set();
  }

  /**
   * 注册一个 setTimeout
   * @param {Function} callback - 回调函数
   * @param {number} delay - 延迟毫秒
   * @returns {number} 定时器ID
   */
  addTimeout(callback, delay = 0) {
    const id = setTimeout(() => {
      try {
        callback();
      } finally {
        this._timeouts.delete(id);
      }
    }, delay);
    this._timeouts.add(id);
    return id;
  }

  /**
   * 注册一个 setInterval
   * @param {Function} callback - 回调函数
   * @param {number} interval - 间隔毫秒
   * @returns {number} 定时器ID
   */
  addInterval(callback, interval = 0) {
    const id = setInterval(callback, interval);
    this._intervals.add(id);
    return id;
  }

  /**
   * 注册一个 requestAnimationFrame
   * @param {Function} callback - 回调函数
   * @returns {number} 帧ID
   */
  addAnimationFrame(callback) {
    const id = requestAnimationFrame((timestamp) => {
      try {
        callback(timestamp);
      } finally {
        this._animationFrames.delete(id);
      }
    });
    this._animationFrames.add(id);
    return id;
  }

  /**
   * 清理指定的 timeout
   * @param {number} id - 定时器ID
   */
  clearTimeout(id) {
    if (this._timeouts.has(id)) {
      this._timeouts.delete(id);
    }
    clearTimeout(id);
  }

  /**
   * 清理指定的 interval
   * @param {number} id - 定时器ID
   */
  clearInterval(id) {
    if (this._intervals.has(id)) {
      this._intervals.delete(id);
    }
    clearInterval(id);
  }

  /**
   * 清理指定的 animationFrame
   * @param {number} id - 帧ID
   */
  cancelAnimationFrame(id) {
    if (this._animationFrames.has(id)) {
      this._animationFrames.delete(id);
    }
    cancelAnimationFrame(id);
  }

  /**
   * 判断是否还有未清理的定时器
   * @returns {boolean} 是否仍存在活跃定时器
   */
  hasPending() {
    return (
      this._timeouts.size > 0 ||
      this._intervals.size > 0 ||
      this._animationFrames.size > 0
    );
  }

  /**
   * 清理全部定时器
   */
  clearAll() {
    this._timeouts.forEach((id) => clearTimeout(id));
    this._intervals.forEach((id) => clearInterval(id));
    this._animationFrames.forEach((id) => cancelAnimationFrame(id));

    this._timeouts.clear();
    this._intervals.clear();
    this._animationFrames.clear();
  }

  /**
   * 创建一个延迟 Promise（用于替换重复的 new Promise(resolve => setTimeout(resolve, delay))）
   * @param {number} delay - 延迟毫秒数
   * @returns {Promise} 延迟后解析的 Promise
   */
  static delay(delay) {
    return new Promise(resolve => setTimeout(resolve, delay));
  }
}

export default TimerManager;

