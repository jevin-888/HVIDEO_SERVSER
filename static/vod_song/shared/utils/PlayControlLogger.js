/**
 * 播控按钮操作日志记录器
 * 记录所有播控按钮的操作、状态变化和执行结果
 */

class PlayControlLogger {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000; // 最大日志条数
    this.sessionId = this.generateSessionId();
    this.isEnabled = true;
    
    // 初始化日志服务
    this.initLogService();
  }

  /**
   * 生成会话ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 初始化日志服务
   */
  async initLogService() {
    try {
      if (typeof window !== 'undefined' && window.logService) {
        this.logService = window.logService;
      } else {
        // 尝试动态导入日志服务
        const { logInfo, logWarn, logError } = await import('./Logger.js');
        this.logService = { info: logInfo, warn: logWarn, error: logError };
      }
    } catch (error) {
      console.warn('[PlayControlLogger] 日志服务初始化失败，使用console输出:', error);
      this.logService = {
        info: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console)
      };
    }
  }

  /**
   * 记录按钮点击操作开始
   */
  logButtonClick(buttonInfo) {
    const logEntry = {
      id: this.generateLogId(),
      type: 'BUTTON_CLICK',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      button: {
        command: buttonInfo.command,
        element: buttonInfo.element?.tagName || 'UNKNOWN',
        text: buttonInfo.text || buttonInfo.element?.textContent?.trim() || '',
        position: this.getElementPosition(buttonInfo.element),
        panel: this.getCurrentPanel(),
        // 添加按钮类型识别
        buttonType: this.getButtonType(buttonInfo.command),
        // 添加按钮描述
        description: this.getButtonDescription(buttonInfo.command, buttonInfo.text)
      },
      user: this.getUserInfo(),
      device: this.getDeviceInfo(),
      // 添加操作状态
      status: 'CLICKED'
    };

    this.addLog(logEntry);
    
    // 使用更清晰的日志格式
    const buttonDesc = logEntry.button.description;
    this.logService.info(`🔘 [按钮点击] ${buttonDesc}`, 'PlayControl', {
      command: buttonInfo.command,
      text: buttonInfo.text,
      logId: logEntry.id
    });
    
    return logEntry.id;
  }

  /**
   * 获取按钮类型
   */
  getButtonType(command) {
    if (!command) return 'UNKNOWN';
    
    if (command.includes('musicBarControl')) return 'MUSIC_CONTROL';
    if (command.includes('light')) return 'LIGHTING';
    if (command.includes('controlVoice')) return 'AUDIO';
    if (command.includes('clickButton')) return 'AC_CONTROL';
    if (command.includes('effect')) return 'SOUND_EFFECT';
    if (command.includes('queue') || command.includes('playlist')) return 'PLAYLIST';
    return 'OTHER';
  }

  /**
   * 获取按钮描述
   */
  getButtonDescription(command, text) {
    if (!command) return text || '未知按钮';
    
    // 音乐控制按钮
    if (command.includes('musicBarControl')) {
      if (command.includes('play')) return '▶️ 播放';
      if (command.includes('pause')) return '⏸️ 暂停';
      if (command.includes('stop')) return '⏹️ 停止';
      if (command.includes('next')) return '⏭️ 下一首';
      if (command.includes('prev')) return '⏮️ 上一首';
      if (command.includes('switchTrack')) {
        if (text && text.includes('原唱')) return '🎤 切换到原唱';
        if (text && text.includes('伴唱')) return '🎵 切换到伴唱';
        return '🔄 切换音轨';
      }
      return '🎵 音乐控制';
    }
    
    // 音效控制按钮
    if (command.includes('controlVoice')) {
      if (command.includes('mute')) return '🔇 静音';
      if (command.includes('unmute')) return '🔊 取消静音';
      if (command.includes('volumeUp')) return '🔊+ 音量增加';
      if (command.includes('volumeDown')) return '🔊- 音量减少';
      return '🔊 音效控制';
    }
    
    // 灯光控制按钮
    if (command.includes('light')) {
      if (command.includes('on')) return '💡 开灯';
      if (command.includes('off')) return '🌙 关灯';
      if (command.includes('dim')) return '🔅 调光';
      return '💡 灯光控制';
    }
    
    // 空调控制按钮
    if (command.includes('clickButton')) {
      if (text) {
        if (text.includes('开机') || text.includes('ON')) return '❄️ 空调开机';
        if (text.includes('关机') || text.includes('OFF')) return '🔴 空调关机';
        if (text.includes('制冷')) return '❄️ 制冷模式';
        if (text.includes('制热')) return '🔥 制热模式';
        if (text.includes('风速')) return '💨 风速调节';
        if (text.includes('温度')) return '🌡️ 温度调节';
      }
      return '❄️ 空调控制';
    }
    
    // 音效控制按钮
    if (command.includes('effect')) {
      if (text) {
        if (text.includes('掌声')) return '👏 掌声音效';
        if (text.includes('喝彩')) return '🎉 喝彩音效';
        if (text.includes('嘘声')) return '🤫 嘘声音效';
        return `🎵 ${text}音效`;
      }
      return '🎵 音效控制';
    }
    
    // 播放列表控制
    if (command.includes('queue') || command.includes('playlist')) {
      if (command.includes('add')) return '➕ 添加到播放列表';
      if (command.includes('remove')) return '➖ 从播放列表移除';
      if (command.includes('clear')) return '🗑️ 清空播放列表';
      if (command.includes('shuffle')) return '🔀 随机播放';
      return '📋 播放列表操作';
    }
    
    // 使用文本作为描述
    if (text && text.trim()) {
      return `🔘 ${text.trim()}`;
    }
    
    return `🔘 ${command}`;
  }

  /**
   * 记录命令执行开始
   */
  logCommandStart(logId, command, params = {}) {
    const logEntry = {
      id: logId,
      type: 'COMMAND_START',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      command: {
        name: command,
        params: this.sanitizeParams(params),
        category: this.getCommandCategory(command)
      },
      status: 'EXECUTING'
    };

    this.updateLog(logId, logEntry);
    
    const buttonDesc = this.getButtonDescriptionFromLog(logId);
    this.logService.info(`⚡ [命令执行] ${buttonDesc} - 开始执行`, 'PlayControl', {
      command: command,
      params: params,
      logId: logId
    });
  }

  /**
   * 记录命令执行成功
   */
  logCommandSuccess(logId, result, stateChanges = {}) {
    const executionTime = this.getExecutionTime(logId);
    const logEntry = {
      type: 'COMMAND_SUCCESS',
      timestamp: Date.now(),
      result: {
        success: true,
        data: this.sanitizeResult(result),
        executionTime: executionTime
      },
      stateChanges: stateChanges,
      status: 'SUCCESS'
    };

    this.updateLog(logId, logEntry);
    
    const buttonDesc = this.getButtonDescriptionFromLog(logId);
    const command = this.getCommandFromLog(logId);
    this.logService.info(`✅ [执行成功] ${buttonDesc} - 耗时${executionTime}ms`, 'PlayControl', {
      command: command,
      result: result,
      executionTime: executionTime,
      logId: logId
    });
  }

  /**
   * 记录命令执行失败
   */
  logCommandError(logId, error) {
    const executionTime = this.getExecutionTime(logId);
    const logEntry = {
      type: 'COMMAND_ERROR',
      timestamp: Date.now(),
      error: {
        message: error.message || String(error),
        stack: error.stack,
        name: error.name,
        executionTime: executionTime
      },
      status: 'FAILED'
    };

    this.updateLog(logId, logEntry);
    
    const buttonDesc = this.getButtonDescriptionFromLog(logId);
    const command = this.getCommandFromLog(logId);
    this.logService.error(`❌ [执行失败] ${buttonDesc} - ${error.message || error}`, 'PlayControl', {
      command: command,
      error: error.message || String(error),
      executionTime: executionTime,
      logId: logId
    });
  }

  /**
   * 记录状态同步
   */
  logStateSync(stateType, oldState, newState, relatedLogId = null) {
    const changes = this.getStateChanges(oldState, newState);
    const logEntry = {
      id: this.generateLogId(),
      type: 'STATE_SYNC',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      stateSync: {
        type: stateType,
        oldState: this.sanitizeState(oldState),
        newState: this.sanitizeState(newState),
        changes: changes,
        relatedLogId: relatedLogId
      },
      status: 'SYNCED'
    };

    this.addLog(logEntry);
    
    const changeCount = Object.keys(changes).length;
    const changeDesc = changeCount > 0 ? `${changeCount}个状态变化` : '无变化';
    
    this.logService.info(`🔄 [状态同步] ${stateType} - ${changeDesc}`, 'PlayControl', {
      stateType: stateType,
      changes: changes,
      changeCount: changeCount,
      relatedLogId: relatedLogId
    });
  }

  /**
   * 记录WebSocket消息
   */
  logWebSocketMessage(messageType, data, direction = 'received', relatedLogId = null) {
    const logEntry = {
      id: this.generateLogId(),
      type: 'WEBSOCKET_MESSAGE',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      websocket: {
        messageType: messageType,
        direction: direction, // 'sent' | 'received'
        data: this.sanitizeWebSocketData(data),
        size: JSON.stringify(data).length,
        relatedLogId: relatedLogId
      },
      status: direction === 'sent' ? 'SENT' : 'RECEIVED'
    };

    this.addLog(logEntry);
    
    const directionIcon = direction === 'sent' ? '📤' : '📥';
    const sizeDesc = `${logEntry.websocket.size}字节`;
    
    this.logService.info(`${directionIcon} [WebSocket] ${messageType} - ${sizeDesc}`, 'PlayControl', {
      messageType: messageType,
      direction: direction,
      size: logEntry.websocket.size,
      relatedLogId: relatedLogId
    });
  }

  /**
   * 记录用户交互序列
   */
  logInteractionSequence(interactions) {
    const logEntry = {
      id: this.generateLogId(),
      type: 'INTERACTION_SEQUENCE',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      sequence: {
        interactions: interactions,
        duration: interactions.length > 1 ? 
          interactions[interactions.length - 1].timestamp - interactions[0].timestamp : 0,
        pattern: this.analyzeInteractionPattern(interactions)
      }
    };

    this.addLog(logEntry);
    this.logService.info(`[播控] 交互序列: ${interactions.length}个操作`, 'PlayControl', logEntry);
  }

  /**
   * 获取日志统计
   */
  getLogStatistics() {
    const stats = {
      totalLogs: this.logs.length,
      sessionId: this.sessionId,
      timeRange: {
        start: this.logs.length > 0 ? this.logs[0].timestamp : null,
        end: this.logs.length > 0 ? this.logs[this.logs.length - 1].timestamp : null
      },
      byType: {},
      byCommand: {},
      errorRate: 0,
      averageExecutionTime: 0
    };

    let totalExecutionTime = 0;
    let executionCount = 0;
    let errorCount = 0;

    this.logs.forEach(log => {
      // 按类型统计
      stats.byType[log.type] = (stats.byType[log.type] || 0) + 1;

      // 按命令统计
      if (log.command?.name) {
        stats.byCommand[log.command.name] = (stats.byCommand[log.command.name] || 0) + 1;
      }

      // 错误统计
      if (log.type === 'COMMAND_ERROR') {
        errorCount++;
      }

      // 执行时间统计
      if (log.result?.executionTime) {
        totalExecutionTime += log.result.executionTime;
        executionCount++;
      }
    });

    stats.errorRate = this.logs.length > 0 ? (errorCount / this.logs.length * 100).toFixed(2) : 0;
    stats.averageExecutionTime = executionCount > 0 ? (totalExecutionTime / executionCount).toFixed(2) : 0;

    return stats;
  }

  /**
   * 导出日志
   */
  exportLogs(format = 'json') {
    const exportData = {
      sessionId: this.sessionId,
      exportTime: Date.now(),
      statistics: this.getLogStatistics(),
      logs: this.logs
    };

    switch (format) {
      case 'json':
        return JSON.stringify(exportData, null, 2);
      case 'csv':
        return this.convertToCSV(exportData.logs);
      case 'text':
        return this.convertToText(exportData.logs);
      default:
        return exportData;
    }
  }

  /**
   * 清空日志
   */
  clearLogs() {
    this.logs = [];
    this.sessionId = this.generateSessionId();
    this.logService.info('[播控] 日志已清空', 'PlayControl');
  }

  // ==================== 私有方法 ====================

  generateLogId() {
    return `log_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  addLog(logEntry) {
    this.logs.push(logEntry);
    
    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  updateLog(logId, updates) {
    const logIndex = this.logs.findIndex(log => log.id === logId);
    if (logIndex !== -1) {
      Object.assign(this.logs[logIndex], updates);
    }
  }

  getCommandFromLog(logId) {
    const log = this.logs.find(log => log.id === logId);
    return log?.command?.name || log?.button?.command || 'UNKNOWN';
  }

  getButtonDescriptionFromLog(logId) {
    const log = this.logs.find(log => log.id === logId);
    return log?.button?.description || log?.command?.name || log?.button?.command || '未知操作';
  }

  getExecutionTime(logId) {
    const log = this.logs.find(log => log.id === logId);
    if (log && log.timestamp) {
      return Date.now() - log.timestamp;
    }
    return 0;
  }

  getElementPosition(element) {
    if (!element) return null;
    
    try {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    } catch (error) {
      return null;
    }
  }

  getCurrentPanel() {
    try {
      const activePanel = document.querySelector('.panel.active, .tab-content.active');
      return activePanel?.id || activePanel?.dataset?.panel || 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  getUserInfo() {
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      cookieEnabled: navigator.cookieEnabled,
      onLine: navigator.onLine
    };
  }

  getDeviceInfo() {
    return {
      screenWidth: screen.width,
      screenHeight: screen.height,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      touchSupport: 'ontouchstart' in window
    };
  }

  getCommandCategory(command) {
    if (command.includes('musicBarControl')) return 'MUSIC_CONTROL';
    if (command.includes('light')) return 'LIGHTING';
    if (command.includes('controlVoice')) return 'AUDIO';
    if (command.includes('clickButton')) return 'AC_CONTROL';
    if (command.includes('effect')) return 'SOUND_EFFECT';
    return 'OTHER';
  }

  sanitizeParams(params) {
    // 移除敏感信息，限制大小
    const sanitized = { ...params };
    const maxSize = 1000;
    const str = JSON.stringify(sanitized);
    
    if (str.length > maxSize) {
      return { ...sanitized, _truncated: true, _originalSize: str.length };
    }
    
    return sanitized;
  }

  sanitizeResult(result) {
    // 类似sanitizeParams的处理
    return this.sanitizeParams(result);
  }

  sanitizeState(state) {
    return this.sanitizeParams(state);
  }

  sanitizeWebSocketData(data) {
    return this.sanitizeParams(data);
  }

  getStateChanges(oldState, newState) {
    const changes = {};
    
    if (!oldState || !newState) return changes;
    
    Object.keys(newState).forEach(key => {
      if (oldState[key] !== newState[key]) {
        changes[key] = {
          from: oldState[key],
          to: newState[key]
        };
      }
    });
    
    return changes;
  }

  analyzeInteractionPattern(interactions) {
    if (interactions.length < 2) return 'single';
    
    const timeGaps = [];
    for (let i = 1; i < interactions.length; i++) {
      timeGaps.push(interactions[i].timestamp - interactions[i-1].timestamp);
    }
    
    const avgGap = timeGaps.reduce((a, b) => a + b, 0) / timeGaps.length;
    
    if (avgGap < 1000) return 'rapid';
    if (avgGap < 5000) return 'normal';
    return 'slow';
  }

  convertToCSV(logs) {
    const headers = ['timestamp', 'type', 'command', 'success', 'executionTime', 'error'];
    const rows = logs.map(log => [
      new Date(log.timestamp).toISOString(),
      log.type,
      log.command?.name || log.button?.command || '',
      log.result?.success || false,
      log.result?.executionTime || log.error?.executionTime || '',
      log.error?.message || ''
    ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  convertToText(logs) {
    return logs.map(log => {
      const time = new Date(log.timestamp).toLocaleString();
      const command = log.command?.name || log.button?.command || 'N/A';
      const status = log.result?.success ? 'SUCCESS' : (log.error ? 'ERROR' : 'PENDING');
      return `[${time}] ${log.type} - ${command} - ${status}`;
    }).join('\n');
  }
}

// 创建全局实例
const playControlLogger = new PlayControlLogger();

// 导出
export default playControlLogger;

// 全局访问
if (typeof window !== 'undefined') {
  window.PlayControlLogger = playControlLogger;
}
