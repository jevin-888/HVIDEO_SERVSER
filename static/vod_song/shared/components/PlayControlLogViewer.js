/**
 * 播控操作日志查看器
 * 提供实时查看和分析播控按钮操作日志的界面
 */

class PlayControlLogViewer {
  constructor() {
    this.isVisible = false;
    this.autoRefresh = true;
    this.refreshInterval = null;
    this.filterType = 'all';
    this.maxDisplayLogs = 100;
    
    this.initViewer();
  }

  /**
   * 初始化日志查看器
   */
  initViewer() {
    this.createViewerHTML();
    this.bindEvents();
    this.startAutoRefresh();
  }

  /**
   * 创建查看器HTML结构
   */
  createViewerHTML() {
    // 创建查看器容器
    const viewerContainer = document.createElement('div');
    viewerContainer.id = 'play-control-log-viewer';
    viewerContainer.className = 'play-control-log-viewer hidden';
    
    viewerContainer.innerHTML = `
      <div class="log-viewer-overlay"></div>
      <div class="log-viewer-panel">
        <div class="log-viewer-header">
          <h3>播控操作日志</h3>
          <div class="log-viewer-controls">
            <select id="log-filter-type" class="log-filter">
              <option value="all">全部</option>
              <option value="BUTTON_CLICK">按钮点击</option>
              <option value="COMMAND_START">命令开始</option>
              <option value="COMMAND_SUCCESS">命令成功</option>
              <option value="COMMAND_ERROR">命令失败</option>
              <option value="STATE_SYNC">状态同步</option>
              <option value="WEBSOCKET_MESSAGE">WebSocket消息</option>
            </select>
            <button id="log-auto-refresh" class="log-btn active">自动刷新</button>
            <button id="log-clear" class="log-btn">清空日志</button>
            <button id="log-export" class="log-btn">导出日志</button>
            <button id="log-close" class="log-btn-close">×</button>
          </div>
        </div>
        
        <div class="log-viewer-stats">
          <div class="log-stat">
            <span class="log-stat-label">总数:</span>
            <span id="log-total-count">0</span>
          </div>
          <div class="log-stat">
            <span class="log-stat-label">错误率:</span>
            <span id="log-error-rate">0%</span>
          </div>
          <div class="log-stat">
            <span class="log-stat-label">平均执行时间:</span>
            <span id="log-avg-time">0ms</span>
          </div>
          <div class="log-stat">
            <span class="log-stat-label">会话ID:</span>
            <span id="log-session-id">-</span>
          </div>
        </div>
        
        <div class="log-viewer-content">
          <div id="log-entries" class="log-entries"></div>
        </div>
      </div>
    `;

    // 添加样式
    this.addViewerStyles();
    
    // 添加到页面
    document.body.appendChild(viewerContainer);
    this.viewerElement = viewerContainer;
  }

  /**
   * 添加查看器样式
   */
  addViewerStyles() {
    if (document.getElementById('play-control-log-viewer-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'play-control-log-viewer-styles';
    styles.textContent = `
      .play-control-log-viewer {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10000;
        font-family: 'Courier New', monospace;
      }

      .play-control-log-viewer.hidden {
        display: none;
      }

      .log-viewer-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
      }

      .log-viewer-panel {
        position: absolute;
        top: 5%;
        left: 5%;
        width: 90%;
        height: 90%;
        background: #1a1a1a;
        color: #00ff00;
        border: 2px solid #00ff00;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
      }

      .log-viewer-header {
        padding: 16px;
        border-bottom: 1px solid #333;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #2a2a2a;
      }

      .log-viewer-header h3 {
        margin: 0;
        color: #00ff00;
        font-size: 18px;
      }

      .log-viewer-controls {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .log-filter, .log-btn {
        padding: 4px 8px;
        background: #333;
        color: #00ff00;
        border: 1px solid #555;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
      }

      .log-btn:hover {
        background: #444;
      }

      .log-btn.active {
        background: #00aa00;
        color: #000;
      }

      .log-btn-close {
        background: #aa0000;
        color: #fff;
        border: none;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
      }

      .log-viewer-stats {
        padding: 8px 16px;
        background: #2a2a2a;
        border-bottom: 1px solid #333;
        display: flex;
        gap: 24px;
        font-size: 12px;
      }

      .log-stat {
        display: flex;
        gap: 4px;
      }

      .log-stat-label {
        color: #888;
      }

      .log-viewer-content {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .log-entries {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        font-size: 11px;
        line-height: 1.4;
      }

      .log-entry {
        margin-bottom: 4px;
        padding: 4px 8px;
        border-radius: 4px;
        border-left: 3px solid #555;
      }

      .log-entry.BUTTON_CLICK {
        border-left-color: #0088ff;
        background: rgba(0, 136, 255, 0.1);
      }

      .log-entry.COMMAND_START {
        border-left-color: #ffaa00;
        background: rgba(255, 170, 0, 0.1);
      }

      .log-entry.COMMAND_SUCCESS {
        border-left-color: #00ff00;
        background: rgba(0, 255, 0, 0.1);
      }

      .log-entry.COMMAND_ERROR {
        border-left-color: #ff0000;
        background: rgba(255, 0, 0, 0.1);
      }

      .log-entry.STATE_SYNC {
        border-left-color: #ff00ff;
        background: rgba(255, 0, 255, 0.1);
      }

      .log-entry.WEBSOCKET_MESSAGE {
        border-left-color: #00ffff;
        background: rgba(0, 255, 255, 0.1);
      }

      .log-entry-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
        gap: 8px;
      }

      .log-entry-icon {
        font-size: 12px;
        width: 16px;
        text-align: center;
      }

      .log-entry-title {
        font-weight: bold;
        font-size: 11px;
        flex: 1;
        color: #fff;
      }

      .log-entry-status {
        font-size: 9px;
        padding: 1px 4px;
        border-radius: 2px;
        font-weight: bold;
        text-transform: uppercase;
      }

      .log-entry-status.clicked {
        background: #0088ff;
        color: #fff;
      }

      .log-entry-status.executing {
        background: #ffaa00;
        color: #000;
      }

      .log-entry-status.success {
        background: #00ff00;
        color: #000;
      }

      .log-entry-status.failed {
        background: #ff0000;
        color: #fff;
      }

      .log-entry-status.synced {
        background: #ff00ff;
        color: #fff;
      }

      .log-entry-status.sent,
      .log-entry-status.received {
        background: #00ffff;
        color: #000;
      }

      .log-entry-status.unknown {
        background: #666;
        color: #fff;
      }

      .log-entry-time {
        color: #888;
        font-size: 9px;
        white-space: nowrap;
      }

      .log-entry-content {
        color: #ccc;
        font-size: 10px;
        word-break: break-all;
      }

      .log-entry-details {
        margin-top: 4px;
        padding: 4px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 2px;
        font-size: 9px;
        color: #aaa;
      }

      @media (max-width: 768px) {
        .log-viewer-panel {
          top: 2%;
          left: 2%;
          width: 96%;
          height: 96%;
        }
        
        .log-viewer-controls {
          flex-wrap: wrap;
          gap: 4px;
        }
        
        .log-viewer-stats {
          flex-wrap: wrap;
          gap: 12px;
        }
      }
    `;

    document.head.appendChild(styles);
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    // 关闭按钮
    document.getElementById('log-close').addEventListener('click', () => {
      this.hide();
    });

    // 点击遮罩关闭
    this.viewerElement.querySelector('.log-viewer-overlay').addEventListener('click', () => {
      this.hide();
    });

    // 过滤器
    document.getElementById('log-filter-type').addEventListener('change', (e) => {
      this.filterType = e.target.value;
      this.refreshLogs();
    });

    // 自动刷新
    document.getElementById('log-auto-refresh').addEventListener('click', (e) => {
      this.autoRefresh = !this.autoRefresh;
      e.target.classList.toggle('active', this.autoRefresh);
      
      if (this.autoRefresh) {
        this.startAutoRefresh();
      } else {
        this.stopAutoRefresh();
      }
    });

    // 清空日志
    document.getElementById('log-clear').addEventListener('click', () => {
      if (window.PlayControlLogger) {
        window.PlayControlLogger.clearLogs();
        this.refreshLogs();
      }
    });

    // 导出日志
    document.getElementById('log-export').addEventListener('click', () => {
      this.exportLogs();
    });

    // ESC键关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });
  }

  /**
   * 显示查看器
   */
  show() {
    this.isVisible = true;
    this.viewerElement.classList.remove('hidden');
    this.refreshLogs();
    
    if (this.autoRefresh) {
      this.startAutoRefresh();
    }
  }

  /**
   * 隐藏查看器
   */
  hide() {
    this.isVisible = false;
    this.viewerElement.classList.add('hidden');
    this.stopAutoRefresh();
  }

  /**
   * 切换显示状态
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * 开始自动刷新
   */
  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => {
      if (this.isVisible && this.autoRefresh) {
        this.refreshLogs();
      }
    }, 1000);
  }

  /**
   * 停止自动刷新
   */
  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * 刷新日志显示
   */
  refreshLogs() {
    if (!window.PlayControlLogger) {
      document.getElementById('log-entries').innerHTML = '<div class="log-entry">播控日志记录器未初始化</div>';
      return;
    }

    const stats = window.PlayControlLogger.getLogStatistics();
    const logs = window.PlayControlLogger.logs || [];

    // 更新统计信息
    this.updateStats(stats);

    // 过滤日志
    let filteredLogs = logs;
    if (this.filterType !== 'all') {
      filteredLogs = logs.filter(log => log.type === this.filterType);
    }

    // 限制显示数量
    const displayLogs = filteredLogs.slice(-this.maxDisplayLogs);

    // 渲染日志条目
    this.renderLogEntries(displayLogs);
  }

  /**
   * 更新统计信息
   */
  updateStats(stats) {
    document.getElementById('log-total-count').textContent = stats.totalLogs;
    document.getElementById('log-error-rate').textContent = stats.errorRate + '%';
    document.getElementById('log-avg-time').textContent = stats.averageExecutionTime + 'ms';
    document.getElementById('log-session-id').textContent = stats.sessionId.split('_')[1] || '-';
  }

  /**
   * 渲染日志条目
   */
  renderLogEntries(logs) {
    const container = document.getElementById('log-entries');
    
    if (logs.length === 0) {
      container.innerHTML = '<div class="log-entry">暂无日志记录</div>';
      return;
    }

    const html = logs.map(log => this.renderLogEntry(log)).join('');
    container.innerHTML = html;
    
    // 滚动到底部
    container.scrollTop = container.scrollHeight;
  }

  /**
   * 渲染单个日志条目
   */
  renderLogEntry(log) {
    const time = new Date(log.timestamp).toLocaleTimeString();
    const { title, content, status, icon } = this.getLogDisplayInfo(log);

    return `
      <div class="log-entry ${log.type}" data-status="${status}">
        <div class="log-entry-header">
          <span class="log-entry-icon">${icon}</span>
          <span class="log-entry-title">${title}</span>
          <span class="log-entry-status ${status.toLowerCase()}">${this.getStatusText(status)}</span>
          <span class="log-entry-time">${time}</span>
        </div>
        <div class="log-entry-content">${content}</div>
        ${this.getLogDetails(log) ? `<div class="log-entry-details">${this.getLogDetails(log)}</div>` : ''}
      </div>
    `;
  }

  /**
   * 获取日志显示信息
   */
  getLogDisplayInfo(log) {
    switch (log.type) {
      case 'BUTTON_CLICK':
        return {
          title: log.button?.description || '按钮点击',
          content: `命令: ${log.button?.command || 'N/A'}`,
          status: log.status || 'CLICKED',
          icon: '🔘'
        };
        
      case 'COMMAND_START':
        return {
          title: log.button?.description || '命令执行',
          content: `开始执行: ${log.command?.name || 'N/A'}`,
          status: log.status || 'EXECUTING',
          icon: '⚡'
        };
        
      case 'COMMAND_SUCCESS':
        const successTime = log.result?.executionTime || 0;
        return {
          title: log.button?.description || '命令成功',
          content: `执行成功，耗时 ${successTime}ms`,
          status: log.status || 'SUCCESS',
          icon: '✅'
        };
        
      case 'COMMAND_ERROR':
        const errorTime = log.error?.executionTime || 0;
        return {
          title: log.button?.description || '命令失败',
          content: `执行失败: ${log.error?.message || '未知错误'} (耗时 ${errorTime}ms)`,
          status: log.status || 'FAILED',
          icon: '❌'
        };
        
      case 'STATE_SYNC':
        const changeCount = Object.keys(log.stateSync?.changes || {}).length;
        return {
          title: '状态同步',
          content: `${log.stateSync?.type || '未知'} - ${changeCount}个状态变化`,
          status: log.status || 'SYNCED',
          icon: '🔄'
        };
        
      case 'WEBSOCKET_MESSAGE':
        const direction = log.websocket?.direction === 'sent' ? '发送' : '接收';
        const size = log.websocket?.size || 0;
        return {
          title: 'WebSocket消息',
          content: `${direction}: ${log.websocket?.messageType || '未知'} (${size}字节)`,
          status: log.status || (log.websocket?.direction === 'sent' ? 'SENT' : 'RECEIVED'),
          icon: log.websocket?.direction === 'sent' ? '📤' : '📥'
        };
        
      default:
        return {
          title: '未知操作',
          content: log.type || 'N/A',
          status: 'UNKNOWN',
          icon: '❓'
        };
    }
  }

  /**
   * 获取状态文本
   */
  getStatusText(status) {
    const statusMap = {
      'CLICKED': '已点击',
      'EXECUTING': '执行中',
      'SUCCESS': '成功',
      'FAILED': '失败',
      'SYNCED': '已同步',
      'SENT': '已发送',
      'RECEIVED': '已接收',
      'UNKNOWN': '未知'
    };
    
    return statusMap[status] || status;
  }

  /**
   * 获取日志详细信息
   */
  getLogDetails(log) {
    const details = [];

    // 按钮位置信息
    if (log.button?.position) {
      details.push(`位置: (${log.button.position.x}, ${log.button.position.y})`);
    }

    // 命令参数
    if (log.command?.params && Object.keys(log.command.params).length > 0) {
      const paramStr = JSON.stringify(log.command.params);
      if (paramStr.length > 100) {
        details.push(`参数: ${paramStr.substring(0, 100)}...`);
      } else {
        details.push(`参数: ${paramStr}`);
      }
    }

    // 状态变化详情
    if (log.stateChanges && Object.keys(log.stateChanges).length > 0) {
      const changes = Object.entries(log.stateChanges).map(([key, change]) => {
        return `${key}: ${change.from} → ${change.to}`;
      }).join(', ');
      details.push(`状态变化: ${changes}`);
    }

    // 状态同步变化详情
    if (log.stateSync?.changes && Object.keys(log.stateSync.changes).length > 0) {
      const changes = Object.entries(log.stateSync.changes).map(([key, change]) => {
        return `${key}: ${change.from} → ${change.to}`;
      }).join(', ');
      details.push(`变化详情: ${changes}`);
    }

    // WebSocket消息详情
    if (log.websocket?.data && typeof log.websocket.data === 'object') {
      const dataKeys = Object.keys(log.websocket.data);
      if (dataKeys.length > 0) {
        details.push(`数据字段: ${dataKeys.join(', ')}`);
      }
    }

    // 错误堆栈信息（简化显示）
    if (log.error?.stack) {
      const stackLines = log.error.stack.split('\n');
      if (stackLines.length > 1) {
        details.push(`错误位置: ${stackLines[1].trim()}`);
      }
    }

    // 关联日志ID
    if (log.stateSync?.relatedLogId || log.websocket?.relatedLogId) {
      const relatedId = log.stateSync?.relatedLogId || log.websocket?.relatedLogId;
      details.push(`关联操作: ${relatedId.split('_')[2] || relatedId}`);
    }

    return details.length > 0 ? details.join(' | ') : null;
  }

  /**
   * 导出日志
   */
  exportLogs() {
    if (!window.PlayControlLogger) return;

    const format = prompt('选择导出格式:\n1. JSON\n2. CSV\n3. 文本', '1');
    let exportFormat = 'json';
    
    switch (format) {
      case '2':
        exportFormat = 'csv';
        break;
      case '3':
        exportFormat = 'text';
        break;
      default:
        exportFormat = 'json';
    }

    const data = window.PlayControlLogger.exportLogs(exportFormat);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `play-control-logs-${timestamp}.${exportFormat}`;

    // 创建下载链接
    const blob = new Blob([data], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// 创建全局实例
const playControlLogViewer = new PlayControlLogViewer();

// 全局访问
if (typeof window !== 'undefined') {
  window.PlayControlLogViewer = playControlLogViewer;
  
  // 添加快捷键 Ctrl+Shift+L 打开日志查看器
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
      e.preventDefault();
      playControlLogViewer.toggle();
    }
  });
}

export default playControlLogViewer;