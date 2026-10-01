import { logWarn, logError } from '../../utils/Logger.js';
import toastService from '../../services/ToastService.js';
import { showCommandResultToast } from '../../utils/commandResultToast.js';

// Only commands that can change playback or the selected queue belong to song sync.
// Peripheral commands use dedicated state handlers and must not trigger queue pulls or song-card redraws.
const SONG_COMMANDS = new Set([
  'AddSong',
  'ClearQueue',
  'NextSong',
  'Pause',
  'Play',
  'Replay',
  'SkipSong',
  'Stop'
]);


/**
 * 歌曲状态同步管理器
 * 负责统一管理歌曲状态的同步，确保所有组件都能获得最新的状态
 */

class SongSyncManager {
  static isSongCommand(command) {
    return typeof command === 'string' && SONG_COMMANDS.has(command);
  }

  constructor() {
    this.syncListeners = new Set();
    this.lastSyncTime = 0;
    this.syncInProgress = false;
    this.syncQueue = [];
    this.maxQueueSize = 10; // 最大队列长度，防止无限积累
    this._wsListenerBound = false; // 标记WebSocket监听器是否已绑定
    this._visibilityListenerBound = false; // 标记页面可见性监听器是否已绑定
    this._visibilityHandler = null; // 保存页面可见性监听器引用
    this._readyHandler = null; // 保存WebSocket就绪事件监听器引用
    this._pollInterval = null; // 保存轮询定时器引用
    this._initTimeout = null; // 保存初始化超时定时器引用
    this._syncQueueTimer = null; // 保存队列处理定时器引用
    this._unbindHandlers = []; // 存储所有解绑函数
    this._lastPlayedSongId = null; // 存储上次播放的歌曲ID，用于避免重复同步
    /** WS 的 getPlayList 正文可能滞后于 HTTP；仅用 WS 作信号，以 HTTP getPlayList 结果为准 */
    this._wsQueuePullTimer = null;
    this._initialQueuePullTimer = null;

    // 初始化WebSocket监听器
    this.initWebSocketListener();
    
    // 监听页面可见性变化，当页面重新可见时同步状态
    this.initPageVisibilityListener();
  }
  
  /**
   * 添加同步监听器
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消监听的函数
   */
  addSyncListener(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
    
    this.syncListeners.add(callback);
    
    // 返回取消监听的函数
    return () => {
      this.syncListeners.delete(callback);
    };
  }
  
  /**
   * 触发同步事件
   * @param {Object} data - 同步数据
   */
  emitSyncEvent(data) {
    this.syncListeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        logError('SongSyncManager', '同步监听器执行失败:', error);
      }
    });
  }

  /**
   * WS 仅作「队列有变」信号：防抖后 HTTP 拉取 getPlayList，避免陈旧 WS 正文覆盖刚同步的内存
   */
  _scheduleAuthoritativeQueuePull() {
    if (this._wsQueuePullTimer) {
      clearTimeout(this._wsQueuePullTimer);
    }
    this._wsQueuePullTimer = setTimeout(async () => {
      this._wsQueuePullTimer = null;
      try {
        const imported = (await import('./SongService.js')).default;
        const songService = (typeof window !== 'undefined' && window.songService) ? window.songService : imported;
        if (songService && typeof songService.syncRequestedSongsFromServer === 'function') {
          await this.syncSongState(true);
        }
      } catch (error) {
        logWarn('SongSyncManager', 'WS 触发 HTTP 拉取播放列表失败，回退 syncSongState:', error);
        this.syncSongState(true);
      }
    }, 150);
  }
  
  /**
   * 初始化WebSocket监听器
   */
  initWebSocketListener() {
    // 防止重复绑定
    if (this._wsListenerBound) {
      return;
    }
    
    const handlePlayListUpdate = async (data) => {
      // 仅保留标准 playListChanged 信号处理，不再兼容旧版正文
      const listType = data.listType || (data.data && data.data.listType) || 1;

      // listType === 2：已唱列表更新，直接 emit 事件，不需要同步 SongService
      if (listType === 2) {
        this.emitSyncEvent({
          type: 'playlistUpdate',
          listType: 2,
          data: data,
          timestamp: Date.now()
        });
        return;
      }

      // listType === 1（或默认已选）：不把 WS 正文写入 SongService（易与 HTTP 竞态产生幽灵已选），只触发 HTTP 拉队列
      if (listType === 1) {
        const svcGate = typeof window !== 'undefined' ? window.songService : null;
        if (svcGate && svcGate._blockWsPlaylistApply) {
          return;
        }
        this._scheduleAuthoritativeQueuePull();

        // 触发同步事件（listType 便于 UI 侧区分已选/已唱）
        this.emitSyncEvent({
          type: 'playlistUpdate',
          listType: 1,
          data: data,
          timestamp: Date.now()
        });
      }
    };

    const handlePlaybackUpdate = async (data) => {
      const stateData = (data?.data && typeof data.data === 'object') ? data.data : (data || {});

      if (stateData.type === 'playIdleContent') {
        this.emitSyncEvent({
          type: 'playIdleContent',
          path: stateData.path,
          timestamp: Date.now()
        });
      }

      const playingNow = stateData.playingNow && typeof stateData.playingNow === 'object'
        ? stateData.playingNow
        : {};
      const hasExplicitSongId = Object.prototype.hasOwnProperty.call(stateData, 'currentSongId') ||
        Object.prototype.hasOwnProperty.call(playingNow, 'songId');
      const rawSongId = stateData.currentSongId ?? playingNow.songId ?? stateData.obj?.playInfo?.songId ?? data?.songId;
      const songId = rawSongId == null ? null : String(rawSongId).trim();
      const songName = String(playingNow.songName ?? '').trim();
      const idleName = songName.toUpperCase() === 'IDLE' || songName.includes('??');
      const isIdle = idleName || (hasExplicitSongId && (songId === '' || songId?.toUpperCase() === 'IDLE'));

      if (isIdle) {
        try {
          const imported = (await import('./SongService.js')).default;
          const songService = (typeof window !== 'undefined' && window.songService) ? window.songService : imported;
          songService?.applyRoomPlaybackIdle?.(true);
        } catch (error) {
          logWarn('SongSyncManager', '??????????:', error);
        }
        this._lastPlayedSongId = songId ?? '';
        this.emitSyncEvent({ type: 'playlistUpdate', listType: 1, source: 'roomPlaybackIdle', timestamp: Date.now() });
        return;
      }

      // currentSongId/playingNow.songId ?????????????? ID ??????????
      if (songId == null) return;
      if (this._lastPlayedSongId === songId) return;
      this._lastPlayedSongId = songId;
      this._scheduleAuthoritativeQueuePull();
    };

    const handleCommandUpdate = async (data) => {
      const command = data?.command || data?.data?.command || data?.action || data?.data?.action || null;
      if (!SongSyncManager.isSongCommand(command)) return;

      this.emitSyncEvent({
        type: 'commandUpdate',
        command,
        data,
        timestamp: Date.now()
      });
      this.syncSongState(true);
    };

    const handleCommandResult = async (data) => {
      const command = data?.action || data?.data?.action || null;
      const ok = Number(data?.ok ?? 1);
      const error = data?.error ?? 0;
      const message = data?.message || '';

      if (ok === 1) {
        console.info('[SongSyncManager] 收到播放器操作成功结果:', { command, message, data });
      } else {
        console.warn('[SongSyncManager] 收到播放器操作失败结果:', { command, error, message, data });
      }

      showCommandResultToast({ action: command, ok, error, message }, toastService);

      this.emitSyncEvent({
        type: 'commandResult',
        command,
        ok,
        error,
        message,
        data,
        timestamp: Date.now()
      });
    };

    const handleIdleContent = async (data) => {
      this.emitSyncEvent({
        type: 'playIdleContent',
        path: data.path,
        timestamp: Date.now()
      });
      console.info('[SongSyncManager] 收到顶级空闲播放信号推送:', data.path);
    };

    const bindAll = () => {
      if (!window.WebSocketClient || this._wsListenerBound) return;
      this._unbindHandlers.push(window.WebSocketClient.on('playListChanged', handlePlayListUpdate));
      this._unbindHandlers.push(window.WebSocketClient.on('getPlayList', handlePlayListUpdate));
      this._unbindHandlers.push(window.WebSocketClient.on('roomStateChanged', handlePlaybackUpdate));
      this._unbindHandlers.push(window.WebSocketClient.on('command', handleCommandUpdate));
      this._unbindHandlers.push(window.WebSocketClient.on('commandResult', handleCommandResult));
      this._unbindHandlers.push(window.WebSocketClient.on('playIdleContent', handleIdleContent));
      
      this._wsListenerBound = true;

      // 🆕 绑定完成后，延迟触发一次 HTTP 拉取，确保即使错过了初始 WS 消息也能获取最新播放列表
      // WebSocketClient.on('getPlayList') 已支持缓存回放，但 HTTP 拉取作为双保险
      this._initialQueuePullTimer = setTimeout(() => {
        this._initialQueuePullTimer = null;
        this._scheduleAuthoritativeQueuePull();
      }, 500);
    };
    
    // 如果WebSocket客户端已经存在，直接绑定事件
    if (window.WebSocketClient) {
      bindAll();
    } else {
      // 如果WebSocket客户端尚未初始化，等待其初始化完成
      this._readyHandler = () => {
        bindAll();
        if (this._wsListenerBound) {
          // 移除事件监听器，避免重复绑定
          window.removeEventListener('websocketClientReady', this._readyHandler);
          this._readyHandler = null;
        }
      };
      window.addEventListener('websocketClientReady', this._readyHandler);
      
      // 如果等待时间过长，尝试轮询检查
      let pollCount = 0;
      const maxPolls = 50; // 最多轮询50次（5秒）
      this._pollInterval = setInterval(() => {
        pollCount++;
        if (window.WebSocketClient && !this._wsListenerBound) {
          bindAll();
          if (this._wsListenerBound && this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
          }
        } else if (pollCount >= maxPolls) {
          if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
          }
        }
      }, 100);
    }
  }
  
  /**
   * 初始化页面可见性监听器
   */
  initPageVisibilityListener() {
    // 防止重复绑定
    if (this._visibilityListenerBound) {
      return;
    }
    
    // 标记页面是否已经初始化完成（避免首次加载时触发）
    let pageInitialized = false;
    // 延迟标记页面已初始化，给应用初始化时间
    this._initTimeout = setTimeout(() => {
      pageInitialized = true;
      this._initTimeout = null;
    }, 3000); // 3秒后认为页面已初始化完成
    
    this._visibilityHandler = () => {
      if (!document.hidden && pageInitialized) {
        // 页面重新可见时，延迟同步状态（只在页面已初始化后才触发）
        setTimeout(() => {
          // 移除调试日志，减少日志输出
          this.syncSongState();
        }, 1000);
      }
    };
    
    document.addEventListener('visibilitychange', this._visibilityHandler);
    this._visibilityListenerBound = true;
  }
  
  /**
   * 清理所有资源（事件监听器、定时器等）
   */
  cleanup() {
    // 清理页面可见性监听器
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
      this._visibilityListenerBound = false;
    }
    
    // 清理初始化超时定时器
    if (this._initTimeout) {
      clearTimeout(this._initTimeout);
      this._initTimeout = null;
    }
    
    // 清理WebSocket监听器
    if (Array.isArray(this._unbindHandlers)) {
      this._unbindHandlers.forEach(unbind => {
        if (typeof unbind === 'function') unbind();
      });
      this._unbindHandlers = [];
      this._wsListenerBound = false;
    }
    
    // 清理WebSocket就绪事件监听器
    if (this._readyHandler) {
      window.removeEventListener('websocketClientReady', this._readyHandler);
      this._readyHandler = null;
    }
    
    // 清理轮询定时器
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    
    // 清理队列处理定时器
    if (this._syncQueueTimer) {
      clearTimeout(this._syncQueueTimer);
      this._syncQueueTimer = null;
    }

    // 清空同步队列
    this.syncQueue = [];
    
    if (this._wsQueuePullTimer) {
      clearTimeout(this._wsQueuePullTimer);
      this._wsQueuePullTimer = null;
    }

    // 清理同步监听器
    this.syncListeners.clear();
  }
  
  /**
   * 同步歌曲状态
   * @param {boolean} force - 是否强制同步
   */
  async syncSongState(force = false) {
    // 如果正在同步中
    if (this.syncInProgress) {
      // 队列中已有待处理请求时，不重复入队，只保留一个 force 标记即可
      if (this.syncQueue.length > 0) {
        if (force) this.syncQueue[0].force = true; // 升级为 force
        return;
      }
      this.syncQueue.push({ force });
      return;
    }
    
    // 检查距离上次同步的时间，避免频繁请求
    const now = Date.now();
    if (!force) {
      if (now - this.lastSyncTime < 2000) { // 2秒内不重复同步
        return;
      }
    }
    // force：不再做时间丢弃（会与 roomStateChanged/getPlayList 连发冲突）；并发由 syncInProgress + 队列合并
    
    // 设置同步状态
    this.syncInProgress = true;
    
    try {
      const imported = (await import('./SongService.js')).default;
      const songService = (typeof window !== 'undefined' && window.songService) ? window.songService : imported;

      if (songService) {
        // 执行同步（与 WS 一致：以 HTTP 为准，避免拉取期间被误判跳过）
        await songService.syncRequestedSongsFromServer({
          force: true,
          immediate: true
        });
        this.lastSyncTime = Date.now();
        // 🆕 重要：HTTP 同步完成后发出事件，通知 UI 刷新（包括徽标数量和列表内容）
        this.emitSyncEvent({
          type: 'playlistUpdate',
          listType: 1, // 1 表示已选列表
          source: 'httpSync',
          timestamp: this.lastSyncTime
        });
      } else {
      }
    } catch (error) {
      logError('SongSyncManager', '歌曲状态同步失败:', error);
    } finally {
      // 重置同步状态
      this.syncInProgress = false;
      
      // 处理队列中的请求
      if (this.syncQueue.length > 0) {
        const nextRequest = this.syncQueue.shift();
        // 性能优化：保存定时器引用，确保可以清理
        this._syncQueueTimer = setTimeout(() => {
          this._syncQueueTimer = null;
          this.syncSongState(nextRequest.force);
        }, 500); // 队列请求间隔 500ms，避免连续触发
      }
    }
  }
  
  /**
   * 获取同步状态
   * @returns {boolean} 是否正在同步
   */
  isSyncing() {
    return this.syncInProgress;
  }
}

// 创建单例实例
const songSyncManager = new SongSyncManager();

// 导出单例实例
export default songSyncManager;
