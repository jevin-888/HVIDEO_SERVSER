/**
 * 日志服务
 * 
 * 重要说明：日志级别统一由设置界面（SettingsUI）控制
 * - 初始化时：从 localStorage 读取已保存的日志级别
 * - 运行时：通过设置界面打开时同步日志级别
 * - 其他代码不应直接调用 setLogLevel()，应通过设置界面操作
 */

import { isNonEmptyArray } from '../utils/NormalizeUtils.js';

class LogService {
  constructor() {
    // 日志级别初始化：从 localStorage 读取
    // 如果没有设置或无效，使用默认值 'error'
    try {
      const lsLevel = (typeof window !== 'undefined') ? localStorage.getItem('ktv:log:level') : null;
      const allowed = ['debug','info','warn','error'];
      // 转换为小写进行比较，确保大小写不敏感
      const normalizedLevel = lsLevel ? lsLevel.toLowerCase() : '';
      this.logLevel = (normalizedLevel && allowed.indexOf(normalizedLevel) !== -1) ? normalizedLevel : 'info';
      
      // 在生产环境（APK）中，强制设置为 error 级别（除非用户明确设置了其他级别）
      // 检测 Capacitor 环境作为生产环境标识
      const isCapacitor = (typeof window !== 'undefined' && window.Capacitor);
      if (isCapacitor && !lsLevel) {
        this.logLevel = 'info';
        // 保存到 localStorage，避免每次都检测
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('ktv:log:level', 'error');
          }
        } catch (_) {}
      }
    } catch (_) {
      // 出错时使用默认值
      this.logLevel = 'error';
    }
    // 新增：日志选项与重复折叠支持
    this.options = { showSource: true, foldDuplicates: true, foldWindowMs: 5000 }; // 增加到5秒，更好地折叠重复日志
    this._duplicateMap = new Map();
    this._originalConsole = null; // 保存原始console方法，防止递归
    this._isProd = null; // 缓存生产环境检测结果
    
    // 性能优化：预计算级别索引，避免重复查找
    this._levelIndexMap = { debug: 0, info: 1, warn: 2, error: 3 };
    this._currentLevelIndex = (this._levelIndexMap[this.logLevel] !== undefined) ? this._levelIndexMap[this.logLevel] : 0; // 默认使用较高级别展示，此处设为0以便调试
  }

  /**
   * 检测是否为生产环境
   * 修改为不影响日志控制的版本
   * @returns {boolean} 是否为生产环境
   */
  _isProduction() {
    // 不影响日志级别控制，始终返回false
    // 日志级别完全由设置界面控制
    return false;
  }


  /**
   * 内部系统日志输出（使用原始console避免递归）
   * @param {string} message - 日志消息
   */
  _systemLog(message) {
    (this._originalConsole?.info || console.info)(message);
  }

  /**
   * 设置日志级别
   * 
   * ========== 重要：日志级别统一控制 ==========
   * 此方法仅应由设置界面（SettingsUI）调用，其他代码不应直接调用
   * 如需修改日志级别，请通过设置界面操作
   * 
   * @param {string} level - 日志级别 (debug, info, warn, error)
   */
  setLogLevel(level) {
    const allowed = ['debug','info','warn','error'];
    // 转换为小写进行比较，确保大小写不敏感
    const normalizedLevel = level ? level.toLowerCase() : '';
    if (allowed.indexOf(normalizedLevel) === -1) {
      this._systemLog(`[SYSTEM] 无效的日志级别: ${level}，已忽略`);
      return;
    }
    
    // 如果级别相同，不重复设置和输出日志
    if (this.logLevel === normalizedLevel) {
      return;
    }
    
    this.logLevel = normalizedLevel;
    // 更新当前级别索引，提升性能
    this._currentLevelIndex = (this._levelIndexMap[normalizedLevel] !== undefined) ? this._levelIndexMap[normalizedLevel] : 0;
    this._systemLog(`[SYSTEM] 日志级别已设置为: ${normalizedLevel} (由设置界面控制)`);
  }

  /**
   * 设置日志选项
   * @param {{showSource?: boolean, foldDuplicates?: boolean, foldWindowMs?: number}} opts
   */
  setOptions(opts = {}) {
    const oldOptions = JSON.stringify(this.options);
    this.options = { ...this.options, ...opts };
    const newOptions = JSON.stringify(this.options);
    // 如果选项没有变化，不重复输出日志
    if (oldOptions !== newOptions) {
      this._systemLog(`[SYSTEM] 更新日志选项: ${newOptions}`);
    }
  }

  /**
   * 启用控制台钩子，将console.*重定向到日志服务（避免在logService内部再次调用console导致递归）
   * 移除生产环境自动禁用 debug/info/log 的限制，全部由设置界面控制
   */
  patchConsole() {
    if (this._originalConsole) return; // 已经启用
    // 优先使用 index.html 预加载 shim 暴露的原生 console，避免把队列代理当成原生
    const raw = (typeof window !== 'undefined' && window.__rawConsole) ? window.__rawConsole : console;
    this._originalConsole = {
      log: raw.log.bind(raw),
      info: raw.info.bind(raw),
      warn: raw.warn.bind(raw),
      error: raw.error.bind(raw),
      debug: (raw.debug ? raw.debug.bind(raw) : raw.log.bind(raw)),
      count: (raw.count ? raw.count.bind(raw) : null)
    };
    
    // 移除生产环境判断，所有日志级别都由设置界面控制
    const wrap = (level) => {
      return (...args) => {
        if (!this.shouldLog(level)) return;
        const [message, ...rest] = args;
        this._write(level, message, undefined, ...rest);
      };
    };
    
    // 所有环境下都启用完整的日志功能
    console.log = wrap('info');
    console.info = wrap('info');
    console.warn = wrap('warn');
    console.error = wrap('error');
    console.debug = wrap('debug');

    // 回放在 index.html shim 队列中的早期日志，统一走日志系统
    // 注意：只回放一次，避免重复输出
    try {
      if (typeof window !== 'undefined' && isNonEmptyArray(window.__earlyLogs)) {
        const queued = window.__earlyLogs;
        // 立即清空队列，防止重复回放
        window.__earlyLogs = [];
        for (const item of queued) {
          const level = item && item.level ? item.level : 'info';
          if (!this.shouldLog(level)) {
            continue;
          }
          const args = item && Array.isArray(item.args) ? item.args : [];
          const [msg, ...rest] = args;
          
          // 清理消息中的标签（如果消息本身包含了 [INFO]/[WARN]/[ERROR]/[DEBUG] 标签，移除它们）
          let cleanMsg = typeof msg === 'string' ? msg : String(msg);
          // 移除消息开头的标签格式（如 [INFO] [WebSocketClient] ...）
          cleanMsg = cleanMsg.replace(/^\[(INFO|WARN|ERROR|DEBUG)\]\s*\[[^\]]+\]\s*/, '');
          
          // 使用已有的 _getSourceFromStack 方法，传入存储的堆栈字符串，避免重复代码
          const src = this.options.showSource ? this._getSourceFromStack(item && item.stack) : undefined;
          this._write(level, cleanMsg, src, ...rest);
        }
      }
    } catch (e) {
      const warnFn = this._originalConsole?.warn || console.warn;
      warnFn(`[SYSTEM] 早期日志回放失败: ${e && e.message ? e.message : e}`);
    }
  }

  /**
   * 关闭控制台钩子，恢复原始console
   */
  unpatchConsole() {
    if (!this._originalConsole) return;
    console.log = this._originalConsole.log;
    console.info = this._originalConsole.info;
    console.warn = this._originalConsole.warn;
    console.error = this._originalConsole.error;
    console.debug = this._originalConsole.debug;
    this._originalConsole = null;
  }

  /**
   * 规范化日志参数（提取source参数，如果第二个参数不是字符串则视为附加数据）
   * @param {string} message - 日志消息
   * @param {string|any} sourceOrArg - 来源文件/模块名或第一个附加数据
   * @param {...any} args - 附加数据
   * @returns {{message: string, source: string|undefined, args: any[]}}
   */
  _normalizeLogArgs(message, sourceOrArg, ...args) {
    let source;
    if (typeof sourceOrArg === 'string') {
      source = sourceOrArg;
    } else {
      args = [sourceOrArg, ...args];
      source = undefined;
    }
    return { message, source, args };
  }

  /**
   * 记录调试日志
   * @param {string} message - 日志消息
   * @param {string} [source] - 来源文件/模块名，可选；不传则自动从堆栈解析
   * @param  {...any} args - 附加数据
   */
  debug(message, source, ...args) {
    // 性能优化：在方法开始就检查级别，避免不必要的参数处理
    if (!this.shouldLog('debug')) return;
    const normalized = this._normalizeLogArgs(message, source, ...args);
    this._write('debug', normalized.message, normalized.source, ...normalized.args);
  }

  /**
   * 记录信息日志
   * @param {string} message - 日志消息
   * @param {string} [source] - 来源文件/模块名，可选；不传则自动从堆栈解析
   * @param  {...any} args - 附加数据
   */
  info(message, source, ...args) {
    // 性能优化：在方法开始就检查级别，避免不必要的参数处理
    if (!this.shouldLog('info')) return;
    const normalized = this._normalizeLogArgs(message, source, ...args);
    this._write('info', normalized.message, normalized.source, ...normalized.args);
  }

  /**
   * 记录警告日志
   * @param {string} message - 日志消息
   * @param {string} [source] - 来源文件/模块名，可选；不传则自动从堆栈解析
   * @param  {...any} args - 附加数据
   */
  warn(message, source, ...args) {
    // 性能优化：在方法开始就检查级别，避免不必要的参数处理
    if (!this.shouldLog('warn')) return;
    const normalized = this._normalizeLogArgs(message, source, ...args);
    this._write('warn', normalized.message, normalized.source, ...normalized.args);
  }

  /**
   * 记录错误日志
   * @param {string} message - 日志消息
   * @param {string} [source] - 来源文件/模块名，可选；不传则自动从堆栈解析
   * @param  {...any} args - 错误或附加数据
   */
  error(message, source, ...args) {
    // 性能优化：在方法开始就检查级别，避免不必要的参数处理
    // 注意：error 通常总是需要记录，但为了保持一致性也进行检查
    if (!this.shouldLog('error')) return;
    const normalized = this._normalizeLogArgs(message, source, ...args);
    this._write('error', normalized.message, normalized.source, ...normalized.args);
  }

  /**
   * 判断是否应该记录指定级别的日志（性能优化版本）
   * @param {string} level - 日志级别
   * @returns {boolean} 是否应该记录
   */
  shouldLog(level) {
    // 性能优化：使用预计算的索引映射，避免数组查找
    const messageLevelIndex = this._levelIndexMap[level];
    
    // 如果级别无效，返回 false（不输出日志，避免影响性能）
    if (messageLevelIndex === undefined) {
      return false;
    }
    
    // 快速比较：消息级别索引 >= 当前级别索引
    return messageLevelIndex >= this._currentLevelIndex;
  }

  /**
   * 获取原始console方法（避免递归调用）
   */
  _getConsoleMethod(method = 'log') {
    return this._originalConsole?.[method] || console[method] || console.log;
  }

  /**
   * 内部写日志实现，支持来源显示与重复折叠
   * 注意：此方法假设级别已经通过 shouldLog 检查，不再重复检查
   */
  _write(level, message, source, ...args) {
    // 注意：级别检查已在外部方法中完成，这里不再检查以提升性能
    const now = Date.now();

    // 自动解析来源
    let src = source;
    if (!src && this.options.showSource) {
      src = this._getSourceFromStack();
    }
    if (!src) src = 'unknown';

    const label = `[${level.toUpperCase()}] [${src}] ${message}`;

    // 重复折叠逻辑
    if (this.options.foldDuplicates) {
      const key = `${level}|${src}|${message}`;
      const info = this._duplicateMap.get(key);
      if (info && (now - info.timestamp) <= this.options.foldWindowMs) {
        // 在时间窗口内，只更新计数，不重复输出日志（完全静默折叠）
        info.count += 1;
        info.timestamp = now;
        return; // 静默折叠，不输出重复日志
      }
      // 如果之前有计数但已超过时间窗口，清理旧的记录，开始新的时间窗口
      // 不输出带计数的日志，避免干扰用户
      if (info && info.count > 1) {
        // 重置计数，开始新的时间窗口，正常输出本次日志
        this._duplicateMap.set(key, { count: 1, timestamp: now });
      } else {
        // 第一次或时间窗口外的第一次：正常输出并记录
        this._duplicateMap.set(key, { count: 1, timestamp: now });
      }
    }

    // 选择正确的输出方法
    const printer = this._getConsoleMethod(level).bind(this._originalConsole || console);
    // 过滤掉 undefined 值，避免在日志中输出 undefined
    const filteredArgs = args.filter(arg => arg !== undefined);
    if (filteredArgs.length > 0) {
      printer(label, ...filteredArgs);
    } else {
      printer(label);
    }
  }

  /**
   * 从错误堆栈中解析来源文件名
   * @param {string} [stackString] - 可选的堆栈字符串，如果不提供则创建新的Error
   * @returns {string}
   */
  _getSourceFromStack(stackString) {
    try {
      const stack = stackString 
        ? String(stackString).split('\n')
        : (new Error().stack ? String(new Error().stack).split('\n') : []);
      // 尝试从堆栈的多行中查找调用者信息
      // 跳过 LogService 内部方法（_write, info/debug/warn/error, _normalizeLogArgs）
      // 跳过 Logger.js 工具函数（logInfo, logWarn, logError）
      const skipPatterns = [
        /LogService\.js/,
        /Logger\.js/,
        /at\s+_write/,
        /at\s+info/,
        /at\s+debug/,
        /at\s+warn/,
        /at\s+error/,
        /at\s+logInfo/,
        /at\s+logWarn/,
        /at\s+logError/,
        /at\s+_normalizeLogArgs/
      ];
      
      // 从第 2 行开始查找（跳过 Error 本身和 _getSourceFromStack）
      for (let i = 2; i < Math.min(stack.length, 10); i++) {
        const line = stack[i] || '';
        // 跳过内部方法
        if (skipPatterns.some(pattern => pattern.test(line))) {
          continue;
        }
        // 兼容Chrome格式: " at function (url:line:col)" 或 " at url:line:col"
        const match = line.match(/\(?([^()]+):(\d+):(\d+)\)?$/);
        if (match && match[1]) {
          const url = match[1];
          // 排除 node_modules 和浏览器内置文件
          if (url.includes('node_modules') || url.includes('<anonymous>')) {
            continue;
          }
          const parts = url.split('/');
          const filename = parts[parts.length - 1];
          // 如果文件名包含扩展名，返回它
          if (filename && filename.includes('.')) {
            return filename;
          }
        }
      }
      return 'unknown';
    } catch (_) {
      return 'unknown';
    }
  }

  /**
   * 将日志发送到服务器
   * @param {Object} logData - 日志数据
   * @returns {Promise} 发送结果Promise
   */
  async sendLogToServer(logData) {
    try {
      this.info('发送日志到服务器', 'LogService', logData);
      // 在浏览器环境中，我们可以发送日志到服务器
      // 这里可以实现实际的日志发送逻辑
      return { success: true };
    } catch (error) {
      this.error('发送日志到服务器失败', 'LogService', error);
      throw error;
    }
  }
}

// 创建并导出日志服务实例
const logService = new LogService();

// 同时支持ES6默认导出和CommonJS导出
export default logService;
export { logService };