/**
 * 启动加载管理器
 * 跟踪所有预加载任务，管理启动加载动画
 */
import logService from '../services/LogService.js';
import DomUtils from './DomUtils.js';

class LoadingManager {
  constructor() {
    this.tasks = new Map(); // 预加载任务集合
    this.completedTasks = new Set(); // 已完成的任务
    this.totalTasks = 0; // 总任务数
    this.onCompleteCallbacks = []; // 完成回调
    this.isComplete = false; // 是否已完成
  }

  /**
   * 注册预加载任务
   * @param {string} taskId - 任务ID
   * @param {string} taskName - 任务名称（用于显示）
   */
  registerTask(taskId, taskName = '') {
    if (this.tasks.has(taskId)) {
      return;
    }
    this.tasks.set(taskId, {
      id: taskId,
      name: taskName || taskId,
      status: 'pending',
      startTime: Date.now()
    });
    this.totalTasks = this.tasks.size;
    this.updateProgress();
  }

  /**
   * 标记任务完成
   * @param {string} taskId - 任务ID
   */
  completeTask(taskId) {
    if (!this.tasks.has(taskId)) {
      return;
    }
    
    const task = this.tasks.get(taskId);
    task.status = 'completed';
    task.endTime = Date.now();
    task.duration = task.endTime - task.startTime;
    
    this.completedTasks.add(taskId);
    this.updateProgress();
    
    logService.debug(`[LoadingManager] 任务完成: ${task.name} (${task.duration}ms)`);
    
    // 检查是否所有任务都完成
    this.checkCompletion();
  }

  /**
   * 标记任务失败
   * @param {string} taskId - 任务ID
   * @param {Error} error - 错误信息
   */
  failTask(taskId, error) {
    if (!this.tasks.has(taskId)) {
      return;
    }
    
    const task = this.tasks.get(taskId);
    task.status = 'failed';
    task.error = error;
    task.endTime = Date.now();
    
    // 失败的任务也计入完成（允许继续）
    this.completedTasks.add(taskId);
    this.updateProgress();
    
    logService.warn(`[LoadingManager] 任务失败: ${task.name}`, error);
    
    // 检查是否所有任务都完成
    this.checkCompletion();
  }

  /**
   * 更新加载进度
   */
  updateProgress() {
    const progress = this.totalTasks > 0 
      ? Math.round((this.completedTasks.size / this.totalTasks) * 100) 
      : 0;
    
    const progressBar = document.getElementById('loading-progress');
    const loadingText = document.getElementById('loading-text');
    
    if (progressBar) {
      DomUtils.setProgressWidth(progressBar, progress);
    }
    
    if (loadingText) {
      // 显示当前正在进行的任务
      const pendingTasks = Array.from(this.tasks.values())
        .filter(t => t.status === 'pending')
        .slice(0, 1);
      
      if (pendingTasks.length > 0) {
        loadingText.textContent = `Loading: ${pendingTasks[0].name}...`;
      } else if (this.completedTasks.size === this.totalTasks && this.totalTasks > 0) {
        loadingText.textContent = 'Loading complete, entering...';
      } else {
        loadingText.textContent = `Loading... ${this.completedTasks.size}/${this.totalTasks}`;
      }
    }
  }

  /**
   * 检查是否所有任务都完成
   */
  checkCompletion() {
    if (this.isComplete) {
      return;
    }
    
    // 如果所有任务都完成（包括失败的）
    if (this.completedTasks.size >= this.totalTasks && this.totalTasks > 0) {
      this.isComplete = true;
      logService.info(`[LoadingManager] 所有预加载任务完成 (${this.completedTasks.size}/${this.totalTasks})`);
      
      // 减少延迟时间，更快显示首页（从300ms减少到100ms）
      setTimeout(() => {
        this.onCompleteCallbacks.forEach(callback => {
          try {
            callback();
          } catch (error) {
            logService.error('[LoadingManager] 完成回调执行失败', error);
          }
        });
      }, 100);
    }
  }

  /**
   * 注册完成回调
   * @param {Function} callback - 完成回调函数
   */
  onComplete(callback) {
    if (typeof callback === 'function') {
      this.onCompleteCallbacks.push(callback);
    }
    
    // 如果已经完成，立即执行回调
    if (this.isComplete) {
      setTimeout(callback, 0);
    }
  }

  /**
   * 获取加载统计信息
   */
  getStats() {
    const tasks = Array.from(this.tasks.values());
    return {
      total: this.totalTasks,
      completed: this.completedTasks.size,
      pending: tasks.filter(t => t.status === 'pending').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      progress: this.totalTasks > 0 
        ? Math.round((this.completedTasks.size / this.totalTasks) * 100) 
        : 0,
      tasks: tasks
    };
  }

  /**
   * 强制完成（用于超时或错误情况）
   */
  forceComplete() {
    if (this.isComplete) {
      return;
    }
    
    logService.warn('[LoadingManager] 强制完成加载');
    this.isComplete = true;
    
    // 标记所有未完成的任务为失败
    this.tasks.forEach((task, taskId) => {
      if (task.status === 'pending') {
        task.status = 'failed';
        task.error = new Error('强制完成');
        this.completedTasks.add(taskId);
      }
    });
    
    this.updateProgress();
    
    setTimeout(() => {
      this.onCompleteCallbacks.forEach(callback => {
        try {
          callback();
        } catch (error) {
          logService.error('[LoadingManager] 完成回调执行失败', error);
        }
      });
    }, 100);
  }
}

// 创建并导出单例
const loadingManager = new LoadingManager();
export default loadingManager;

