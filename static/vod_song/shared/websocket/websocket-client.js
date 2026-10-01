/**
 * 简化版WebSocket客户端
 * 只保留核心功能：连接、接收消息、事件监听
 */

// 导入日志服务
let logService;

// 动态导入播控日志记录器
let playControlLogger = null;
(async () => {
  try {
    const module = await import('../../shared/utils/PlayControlLogger.js');
    playControlLogger = module.default;
  } catch (error) {
    console.warn('[WebSocketClient] 播控日志记录器加载失败:', error);
  }
})();

function getPageRoomId() {
    try {
        if (typeof window === 'undefined' || !window.location) return null;

        const configuredRoomId = window.AppConfig?.getRoomIdFromUrl;
        if (typeof configuredRoomId === 'function') return configuredRoomId() || null;

        const search = window.location.search.substring(1);
        if (!search) return null;
        const params = new URLSearchParams(search);
        const explicit = params.get('roomId');
        if (explicit && explicit.trim()) return explicit.trim();

        const first = search.split('&')[0];
        if (!first || first.indexOf('=') !== -1) return null;
        const legacy = decodeURIComponent(first).trim();
        const octets = legacy.split('.').map(Number);
        return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(legacy) && octets.every(Number.isInteger)
            && octets.every(value => value >= 0 && value <= 255)
            ? legacy
            : null;
    } catch (_) {
        return null;
    }
}

/**
 * WebSocket客户端类
 */
class WebSocketClient {
    constructor(url) {
        this.url = typeof url === 'string' ? url : '';
        this.socket = null;
        this.connectionStatus = 'disconnected';
        this.reconnectAttempts = 0;
        this.reconnectInterval = 5000; // 5秒后重连
        this.reconnectTimer = null;
        this.manualDisconnect = false; // 标记是否手动断开
        this.connectionTimeout = null; // 保存连接超时定时器引用
        this.delayConnectTimer = null; // 保存延迟连接定时器引用
        
        // 事件监听器管理
        this.listeners = new Map();
        
        // 全局状态缓存
        this.globalState = {
            syncState: null,
            initialState: null,
            lastPlayList: null
        };
        
        // 初始化日志服务
        this._initLogService();
        
        // 如果提供了有效URL，则立即尝试连接；否则等待后续配置
        if (this.url) {
            this.setupWebSocket(this.url);
        }
    }
    
    /**
     * 初始化日志服务
     */
    async _initLogService() {
        if (logService) {
            return;
        }

        if (typeof window !== 'undefined' && window.logService) {
            logService = window.logService;
            return;
        }

        try {
            const services = await import('../services/LogService.js');
            const resolvedService = services.default || services.logService;
            if (resolvedService) {
                logService = resolvedService;
                return;
            }
        } catch (_) {
            // 忽略，继续尝试加载 Logger 工具
        }

        try {
            const loggerModule = await import('../utils/Logger.js');
            const ensureContext = (context) => (typeof context === 'string' && context.trim()) ? context : 'WebSocketClient';

            logService = {
                debug: (message, context, ...args) => {
                    const ctx = ensureContext(context);
                    if (loggerModule.logInfo) {
                        loggerModule.logInfo(ctx, message, ...args);
                    } else {
                        console.debug(`[${ctx}] ${message}`, ...args);
                    }
                },
                info: (message, context, ...args) => {
                    const ctx = ensureContext(context);
                    if (loggerModule.logInfo) {
                        loggerModule.logInfo(ctx, message, ...args);
                    } else {
                        console.info(`[${ctx}] ${message}`, ...args);
                    }
                },
                warn: (message, context, ...args) => {
                    const ctx = ensureContext(context);
                    if (loggerModule.logWarn) {
                        loggerModule.logWarn(ctx, message, ...args);
                    } else {
                        console.warn(`[${ctx}] ${message}`, ...args);
                    }
                },
                error: (message, context, error) => {
                    const ctx = ensureContext(context);
                    const err = error instanceof Error
                        ? error
                        : (error && typeof error === 'object' ? error : new Error(error));
                    if (loggerModule.logError) {
                        loggerModule.logError(ctx, message, err);
                    } else {
                        console.error(`[${ctx}] ${message}`, err);
                    }
                }
            };
            return;
        } catch (_) {
            // 忽略，降级到原生 console
        }

        logService = {
            debug: (...args) => console.debug(...args),
            info: (...args) => console.info(...args),
            warn: (...args) => console.warn(...args),
            error: (...args) => console.error(...args)
        };
    }
    
    /**
     * 注册事件监听器
     */
    on(eventName, callback) {
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }
        
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, new Set());
        }
        
        this.listeners.get(eventName).add(callback);
        
        // 🆕 如果是 initialState 事件且已有缓存，立即触发回调
        if (eventName === 'initialState' && this.globalState.initialState) {
            try {
                callback(this.globalState.initialState);
                if (logService && logService.debug) {
                    logService.debug('新监听器注册，立即触发缓存的 initialState', 'WebSocketClient');
                }
            } catch (error) {
                if (logService && logService.error) {
                    logService.error('触发缓存的 initialState 失败:', 'WebSocketClient', error);
                }
            }
        }

        // 🆕 如果是 getPlayList 事件且已有缓存，立即触发回调（解决 SongSyncManager 晚绑定时错过初始播放列表的问题）
        if (eventName === 'getPlayList' && this.globalState.lastPlayList) {
            try {
                callback(this.globalState.lastPlayList);
                if (logService && logService.debug) {
                    logService.debug('新监听器注册，立即触发缓存的 getPlayList', 'WebSocketClient');
                }
            } catch (error) {
                if (logService && logService.error) {
                    logService.error('触发缓存的 getPlayList 失败:', 'WebSocketClient', error);
                }
            }
        }
        
        // 返回取消监听的函数
        return () => {
            const listeners = this.listeners.get(eventName);
            if (listeners) {
                listeners.delete(callback);
            }
        };
    }
    
    /**
     * 取消监听事件
     * @param {string} eventName - 事件名称
     * @param {Function} callback - 要移除的回调函数
     */
    off(eventName, callback) {
        const listeners = this.listeners.get(eventName);
        if (listeners && callback) {
            listeners.delete(callback);
        }
    }

    /**
     * 触发事件
     */
    emit(eventName, data) {
        const listeners = this.listeners.get(eventName);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    if (logService && logService.error) {
                        logService.error(`Error in ${eventName} listener:`, 'WebSocketClient', error);
                    } else {
                        console.error(`Error in ${eventName} listener:`, error);
                    }
                }
            });
        }
    }

    /**
     * 设置WebSocket连接
     */
    /**
     * 获取当前连接应加入的房间标识。
     * 与 ApiService 保持一对一优先级：WS URL > ApiService > 页面 URL > currentRoomId > clientIp。
     */
    _getRoomIdForJoin(candidateUrl = this.url) {
        try {
            const pagePath = typeof window !== 'undefined' ? window.location.pathname : '';
            const socketUrl = candidateUrl ? new URL(candidateUrl) : null;
            if (pagePath.includes('/admin/') || pagePath.includes('admin.html') ||
                (socketUrl && socketUrl.pathname.includes('/admin-'))) {
                return null;
            }

            const wsRoomId = socketUrl && socketUrl.searchParams.get('roomId');
            if (wsRoomId) return wsRoomId;

            if (typeof window !== 'undefined' && window.apiService) {
                const apiRoomId = typeof window.apiService.getRoomId === 'function'
                    ? window.apiService.getRoomId()
                    : window.apiService.roomId;
                if (apiRoomId) return apiRoomId;
            }

            if (typeof window !== 'undefined') {
                const pageRoomId = getPageRoomId();
                if (pageRoomId) return pageRoomId;

                const currentRoomId = localStorage.getItem('currentRoomId');
                if (currentRoomId && currentRoomId !== 'current') return currentRoomId;

                const clientIp = localStorage.getItem('clientIp');
                if (clientIp) return clientIp;

                if (currentRoomId) return currentRoomId;
            }
        } catch (error) {
            console.warn('[WebSocketClient] 获取 join_room 房间标识失败:', error);
        }
        return null;
    }

    /**
     * 每次连接建立后主动加入房间，触发服务端下发完整权威房态。
     */
    _sendJoinRoom() {
        const roomId = this._getRoomIdForJoin();
        if (!roomId) {
            console.warn('[WebSocketClient] 未找到房间标识，跳过 join_room');
            return false;
        }

        const sent = this.send({ type: 'join_room', roomId });
        if (sent) {
            console.info('[WebSocketClient] 已发送 join_room，等待完整房态:', roomId);
        } else {
            console.error('[WebSocketClient] join_room 发送失败:', roomId);
        }
        return sent;
    }

    setupWebSocket(url) {
        // 记录传入的URL用于调试
        if (logService && logService.debug) {
            logService.debug('准备建立WebSocket连接', 'WebSocketClient');
        } else {
            console.debug('[WebSocketClient] 准备建立连接:', url);
        }
        
        let finalUrl = url;
        try {
            // 自动补齐 roomId 参数，确保后端能分清房间
            const urlObj = new URL(url);
            if (!urlObj.searchParams.has('roomId')) {
                // Reuse the canonical room resolver so HTTP, WS URL and join_room cannot diverge.
                const roomId = this._getRoomIdForJoin(urlObj.toString());

                if (roomId) {
                    urlObj.searchParams.set('roomId', roomId);
                    finalUrl = urlObj.toString();
                    console.log('[WebSocketClient] 自动注入 RoomID:', roomId);
                }
            }
        } catch (e) {
            console.warn('[WebSocketClient] 补齐roomId参数失败:', e);
        }

        this.url = finalUrl;
        
        // 如果已有连接，先清理
        if (this.socket) {
            this._cleanupConnection();
        }
        
        // 清理重连定时器
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        // 清理之前的延迟连接定时器
        if (this.delayConnectTimer) {
            clearTimeout(this.delayConnectTimer);
            this.delayConnectTimer = null;
        }
        
        // 清理之前的连接超时定时器
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
        
        // 延迟连接建立，减少初始加载压力
        this.delayConnectTimer = setTimeout(() => {
            try {
                // 必须使用 this.url：上面已将补齐 roomId 后的 finalUrl 写入 this.url，
                // 闭包里的入参 url 仍是旧值，用错会导致连接缺少 roomId 等参数。
                const connectUrl = this.url;
                if (!connectUrl || typeof connectUrl !== 'string') {
                    throw new Error('Invalid WebSocket URL: URL is empty or not a string');
                }
                
                // 检查URL是否以ws:或wss:开头
                if (!connectUrl.startsWith('ws://') && !connectUrl.startsWith('wss://')) {
                    throw new Error('Invalid WebSocket URL: must start with ws:// or wss://');
                }
                
                // 尝试创建URL对象来验证格式
                const urlObj = new URL(connectUrl);
                if (urlObj.protocol !== 'ws:' && urlObj.protocol !== 'wss:') {
                    throw new Error('Invalid WebSocket URL protocol: ' + urlObj.protocol);
                }
                
                if (logService && logService.info) {
                    logService.info('正在建立WebSocket连接', 'WebSocketClient');
                } else {
                }
                
                this.socket = new WebSocket(connectUrl);
                this._setupEventHandlers();
                
                // 添加连接超时检测
                this.connectionTimeout = setTimeout(() => {
                    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
                        if (logService && logService.warn) {
                            logService.warn('WebSocket连接超时', 'WebSocketClient', {
                                url: connectUrl,
                                timeout: 10000 // 10秒超时
                            });
                        } else {
                            console.warn('[WebSocketClient] 连接超时:', connectUrl);
                        }
                        this._cleanupConnection();
                        this.connectionStatus = 'error';
                        this._scheduleReconnect();
                    }
                }, 10000); // 10秒超时
                
                // 连接成功后清除超时检测
                this.socket.onopen = () => {
                    if (this.connectionTimeout) {
                        clearTimeout(this.connectionTimeout);
                        this.connectionTimeout = null;
                    }
                    if (logService && logService.info) {
                        logService.info('WebSocket连接成功', 'WebSocketClient', { url: this.url });
                    } else {
                    }
                    this.connectionStatus = 'connected';
                    this.connectionAttempts = 0;
                    this._setupEventHandlers();
                    
                    // 必须先加入房间，服务端才会在首次启动和每次重连时下发完整权威房态。
                    this._sendJoinRoom();

                    // 启动应用级心跳
                    this.startHeartbeat();

                    this.emit('connected', { url: this.url });
                };

                // 注意：不在此处派发 websocketClientReady，因为此时连接尚未建立
                // websocketClientReady 已在底部 IIFE 中暴露 window.WebSocketClient 后触发
            } catch (error) {
                if (logService && logService.error) {
                    logService.error('连接创建失败:', 'WebSocketClient', {
                        error: error.message,
                        url: this.url
                    });
                } else {
                    console.error('连接创建失败:', error.message, 'URL:', this.url);
                }
                this.connectionStatus = 'error';
                this._scheduleReconnect();
            }
            // 清理延迟连接定时器引用
            this.delayConnectTimer = null;
        }, 1000); // 延迟1秒建立连接
    }
    
    /**
     * 设置事件处理器
     */
    _setupEventHandlers() {
        // 注意：onopen事件已经在setupWebSocket中设置，避免重复设置
        
        this.socket.onclose = () => {
            if (logService && logService.info) {
                logService.info('WebSocket连接关闭', 'WebSocketClient');
            } else {
            }
            this.stopHeartbeat();
            
            // 如果不是手动断开，则自动重连
            if (!this.manualDisconnect) {
                this._scheduleReconnect();
            } else {
                // 手动断开后，重置标记
                this.manualDisconnect = false;
                }
        };
        
        this.socket.onerror = (error) => {
            if (logService && logService.error) {
                logService.error('WebSocket连接错误', 'WebSocketClient', {
                    error: error,
                    url: this.url,
                    readyState: this.socket ? this.socket.readyState : 'unknown',
                    connectionStatus: this.connectionStatus
                });
            } else {
                console.error('[WebSocketClient] 连接错误:', error, 'URL:', this.url);
            }
            this.connectionStatus = 'error';
            
            // 连接错误时，如果不是手动断开，也尝试重连
            // 注意：onerror 后通常会触发 onclose，所以这里可以不重连
            // 但为了保险，如果连接已经关闭，可以尝试重连
            if (!this.manualDisconnect && (!this.socket || this.socket.readyState === WebSocket.CLOSED)) {
                this._scheduleReconnect();
            }
        };
        
        this.socket.onmessage = (event) => {
            this._handleMessage(event);
        };
    }
    
    /**
     * 处理消息
     */
    _handleMessage(event) {
        try {
            const data = JSON.parse(event.data);
            const messageType = data.type || data.method || data.action || 'unknown';
            
            // 记录WebSocket消息到播控日志
            if (playControlLogger) {
                playControlLogger.logWebSocketMessage(messageType, data, 'received');
            }
            
            if (logService && logService.debug) {
                logService.debug(`收到 WebSocket 消息: ${messageType}`, 'WebSocketClient');
            }
    
            // 根据消息类型触发相应事件
            if (data.type === 'getPlayList' || data.method === 'getPlayList') {
                // 缓存最新的播放列表数据，供晚绑定的 SongSyncManager 立即获取
                this.globalState.lastPlayList = data;
                this.emit('getPlayList', data);
            } else if (data.type === 'playListChanged') {
                // 播放列表有变（信号模式）
                this.emit('playListChanged', data);
            } else if (data.type === 'roomStateChanged') {
                const incomingState = data.data || data;
                this.globalState.initialState = this._mergeRoomState(
                    this.globalState.initialState,
                    incomingState
                );
                this._applySyncStateFromRoomState(this.globalState.initialState);
                this.emit('initialState', this.globalState.initialState);
                // 房间状态变更
                if (logService && logService.info) {
                    logService.info('收到房间状态变更消息', 'WebSocketClient');
                } else {
                }
                this.emit('roomStateChanged', {
                    ...data,
                    data: this.globalState.initialState
                });
            } else if (data.type === 'playIdleContent') {
                // 空闲播放推送 (顶级类型)
                this.emit('playIdleContent', data);
            } else if (data.type === 'command') {
                // 播控指令（Play/Pause/SkipSong/SetVolume/Replay 等）
                this.emit('command', data);
            } else if (data.type === 'commandResult') {
                // 播放器执行结果（成功/失败）统一推送给 PC / 手机端
                this.emit('commandResult', data);
            } else if (data.type === 'terminals_updated') {
                this.emit('terminals_updated', data);
            } else if (data.type === 'service_call_new') {
                this.emit('service_call_new', data.data || data);
            } else if (data.type === 'service_call_completed') {
                this.emit('service_call_completed', data.data || data);
            } else if (data.source === 'ktv' && data.action === 'controlVoice') {
                // 播控广播（后端 broadcastAll 经 WebSocket 推送），供界面显示提示
                this.emit('broadcastStatus', data);
            } else {
                // 其他消息
                this.emit('unknown', data);
            }
        } catch (error) {
            if (logService && logService.warn) {
                logService.warn('消息解析失败', 'WebSocketClient');
            } else {
                console.warn('[WebSocketClient] 消息解析失败:', event.data);
            }
        }
    }
    
    /**
     * 安排重连
     */
    _scheduleReconnect() {
        if (this.reconnectTimer) {
            return;
        }
        
        const reconnectDelay = Math.min(Math.max(this.reconnectInterval, this.reconnectInterval * this.reconnectAttempts), 30000);
        
        this.reconnectTimer = setTimeout(() => {
            this.reconnectAttempts++;
            if (logService && logService.info) {
                logService.info(`尝试重连 (第${this.reconnectAttempts}次)`, 'WebSocketClient');
            } else {
            }
            this.reconnectTimer = null;
            this.setupWebSocket(this.url);
        }, reconnectDelay);
    }

    /**
     * 清理连接
     */
    _cleanupConnection() {
        // 清理重连定时器
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        // 清理连接超时定时器
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
        
        // 清理延迟连接定时器
        if (this.delayConnectTimer) {
            clearTimeout(this.delayConnectTimer);
            this.delayConnectTimer = null;
        }
        
        if (this.socket) {
            try {
                this.socket.onopen = null;
                this.socket.onclose = null;
                this.socket.onerror = null;
                this.socket.onmessage = null;
                if (this.socket.readyState === WebSocket.OPEN) {
                    this.socket.close();
                }
            } catch (error) {
                if (logService && logService.warn) {
                    logService.warn('清理连接时出错:', 'WebSocketClient', error);
                } else {
                    console.warn('[WebSocketClient] 清理连接时出错:', error);
                }
            }
            this.socket = null;
        }
    }

    /**
     * 启动应用级心跳机制
     * 解决浏览器后台节流或网络闲置导致的连接被强行重置 (ResetWithoutClosingHandshake)
     */
    startHeartbeat() {
        this.stopHeartbeat(); // 确保旧的已清理
        
        const INTERVAL = 30000; // 30秒一次心跳
        this.heartbeatTimer = setInterval(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping', timestamp: Date.now() });
                if (logService && logService.debug) {
                    logService.debug('发送心跳探测 (ping)', 'WebSocketClient');
                }
            }
        }, INTERVAL);
        
        if (logService && logService.info) {
            logService.info(`已启动 WebSocket 心跳机制 (${INTERVAL / 1000}s)`, 'WebSocketClient');
        }
    }

    /**
     * 停止心跳机制
     */
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    _mergeRoomState(previousState, incomingState) {
        if (!incomingState || typeof incomingState !== 'object' || Array.isArray(incomingState)) {
            return previousState || incomingState;
        }

        const previousRoomId = previousState && typeof previousState === 'object'
            ? previousState.roomId
            : null;
        const incomingRoomId = incomingState.roomId;
        // A room switch must never inherit nested state or sparse syncState values
        // from the previously connected room. Partial updates only merge within one room.
        const sameRoom = !previousRoomId || !incomingRoomId || previousRoomId === incomingRoomId;
        const previous = sameRoom && previousState && typeof previousState === 'object'
            ? previousState
            : {};
        const merged = { ...previous, ...incomingState };

        ['ac', 'light', 'effect', 'playingNow'].forEach((key) => {
            const oldValue = previous[key];
            const newValue = incomingState[key];
            if (oldValue && newValue
                && typeof oldValue === 'object' && !Array.isArray(oldValue)
                && typeof newValue === 'object' && !Array.isArray(newValue)) {
                merged[key] = { ...oldValue, ...newValue };
            }
        });

        if (Array.isArray(incomingState.syncState)) {
            const oldSyncState = Array.isArray(previous.syncState)
                ? previous.syncState
                : [];
            const length = Math.max(oldSyncState.length, incomingState.syncState.length);
            merged.syncState = Array.from({ length }, (_, index) => {
                const value = incomingState.syncState[index];
                return value === undefined || value === null ? oldSyncState[index] : value;
            });
        }
        return merged;
    }

    _applySyncStateFromRoomState(stateData) {
        const syncState = stateData && stateData.syncState;
        if (!Array.isArray(syncState)) return;

        this.globalState.syncState = syncState;
        [5, 8].forEach((opKey) => {
            if (syncState[opKey] !== undefined && syncState[opKey] !== null) {
                this.emit('syncState', {
                    opKey,
                    state: syncState[opKey],
                    syncState
                });
            }
        });
    }

    /**
     * 断开连接
     */
    disconnect() {
        this.manualDisconnect = true; // 标记为手动断开
        this._cleanupConnection();
        this.connectionStatus = 'disconnected';
        this.emit('disconnected', { manual: true });
    }

    /**
     * 发送消息
     */
    send(message) {
        if (!message || !this.socket || this.connectionStatus !== 'connected') {
            return false;
        }
        
        try {
            const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
            this.socket.send(messageStr);
            return true;
        } catch (error) {
            if (logService && logService.error) {
                logService.error('发送消息失败:', 'WebSocketClient', error);
            } else {
                console.error('[WebSocketClient] 发送消息失败:', error);
            }
            return false;
        }
    }

    /**
     * 获取连接状态
     */
    getConnectionStatus() {
        return this.connectionStatus;
    }

    /**
     * 获取最新的同步状态
     */
    getSyncState() {
        return this.globalState.syncState;
    }

    /**
     * 获取缓存的 initialState
     */
    getInitialState() {
        return this.globalState.initialState;
    }

    /**
     * 获取综合全局状态
     */
    getGlobalState() {
        return {
            syncState: this.getSyncState(),
            initialState: this.getInitialState()
        };
    }
    
    /**
     * 等待配置
     */
    waitForConfig(retries = 5, interval = 100) {
        return new Promise((resolve) => {
            const checkConfig = () => {
                // 检查全局配置
                if (window.AppConfig?.websocket) {
                    const { host, port, path } = window.AppConfig.websocket;
                    if (host && port && path) {
                        let finalHost = host;
                        // 如果是localhost，尝试从页面URL获取
                        if (host === 'localhost' || host === '127.0.0.1') {
                                try {
                                    const url = new URL(window.location.href);
                                    if (url.hostname && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
                                        finalHost = url.hostname;
                                }
                            } catch (e) {
                                // 忽略错误
                            }
                        }
                        
                        // 提取当前房间ID
                        let roomId = null;
                        try {
                            roomId = getPageRoomId();
                            if (!roomId && window.apiService) {
                                roomId = typeof window.apiService.getRoomId === 'function'
                                    ? window.apiService.getRoomId()
                                    : window.apiService.roomId;
                            }
                            if (!roomId) {
                                const currentRoomId = localStorage.getItem('currentRoomId');
                                roomId = (currentRoomId && currentRoomId !== 'current')
                                    ? currentRoomId
                                    : (localStorage.getItem('clientIp') || currentRoomId || 'current');
                            }
                        } catch (e) {
                            console.error('[WebSocketClient] 获取RoomID失败:', e);
                        }

                        // Determine if it's an admin page and construct path accordingly
                        let finalPath = path;
                        const isAdminPage = typeof window !== 'undefined' && 
                                           (window.location.pathname.includes('/admin/') || 
                                            window.location.pathname.includes('admin.html'));
                        
                        if (isAdminPage && !path.includes('/admin-')) {
                            // If it's an admin page, use the terminal ID path to get admin privileges
                            const adminId = `admin-web-${Math.random().toString(36).substring(2, 7)}`;
                            finalPath = `/ws/${adminId}`;
                        }

                        // 构造完整的WebSocket URL，admin页面不需要roomId参数
                        const wsUrl = isAdminPage
                            ? `ws://${finalHost}:${port}${finalPath}`
                            : `ws://${finalHost}:${port}${finalPath}${finalPath.includes('?') ? '&' : '?'}roomId=${encodeURIComponent(roomId)}`;
                        
                        // 验证URL格式
                        try {
                            new URL(wsUrl);
                            resolve(wsUrl);
                        } catch (e) {
                             // 如果带参数的无效，尝试不带参数的
                             const fallbackUrl = `ws://${finalHost}:${port}${path}`;
                             resolve(fallbackUrl);
                        }
                        return;
                    }
                }
                
                // 重试
                if (retries-- > 0) {
                    setTimeout(checkConfig, interval);
                } else {
                    // 使用与页面主机一致的默认配置
                    let defaultHost = window.location.hostname || '127.0.0.1'; // 使用当前页面的 hostname
                    let defaultPort = window.location.port || '9898'; // 使用当前页面的端口
                    let defaultPath = '/ws';
                    
                    // 尝试使用当前页面的主机地址
                    try {
                        if (typeof window !== 'undefined' && window.location) {
                            const url = new URL(window.location.href);
                            if (url.hostname && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
                                defaultHost = url.hostname;
                            }
                            
                            // 检查URL参数中是否有WebSocket配置
                            const wsHost = url.searchParams.get('wsHost');
                            const wsPort = url.searchParams.get('wsPort');
                            const wsPath = url.searchParams.get('wsPath');
                            
                            if (wsHost) defaultHost = wsHost;
                            if (wsPort) defaultPort = wsPort;
                            if (wsPath) defaultPath = wsPath;
                        }
                    } catch (e) {
                        // 忽略错误
                    }
                    
                    // 构造默认WebSocket URL
                    const defaultWsUrl = `ws://${defaultHost}:${defaultPort}${defaultPath}`;
                    
                    // 验证默认URL格式
                    try {
                        new URL(defaultWsUrl);
                        if (logService && logService.warn) {
                            logService.warn('WebSocket配置未找到，使用默认配置', 'WebSocketClient', { 
                                host: defaultHost, 
                                port: defaultPort, 
                                path: defaultPath,
                                url: defaultWsUrl
                            });
                        }
                        resolve(defaultWsUrl);
                    } catch (e) {
                        if (logService && logService.error) {
                            logService.error('默认WebSocket配置无效:', 'WebSocketClient', {
                                host: defaultHost,
                                port: defaultPort,
                                path: defaultPath,
                                error: e.message
                            });
                        }
                        // 如果默认配置也无效，返回一个安全的默认值
                        resolve(`ws://${defaultHost}:${defaultPort}${defaultPath}`);
                    }
                }
            };
            checkConfig();
        });
    }
}

/**
 * 初始化WebSocket客户端
 */
let wsClient;
let clientInterface;
let isInitializing = false;
let isInitialized = false;

(async function initWebSocket() {
    // 防止重复初始化
    if (isInitializing || isInitialized || window.WebSocketClient) {
        if (!logService) {
            try {
                const services = await import('../services/LogService.js');
                logService = services.default || services.logService;
            } catch (_) {}
        }
        return;
    }
    
    isInitializing = true;
    
    // 初始化日志服务
    if (!logService) {
        try {
            const services = await import('../services/LogService.js');
            logService = services.default || services.logService;
        } catch (_) {}
    }
    
    try {
        if (logService && logService.info) {
            logService.info('正在初始化WebSocket客户端...', 'WebSocketClient');
        } else {
        }
        
        // 创建WebSocket客户端实例（暂时不传URL，稍后设置）
        const wsClient = new WebSocketClient('');
        
        // 等待配置
        const wsUrl = await wsClient.waitForConfig();
        
        if (logService && logService.info) {
            logService.info('获取到WebSocket配置', 'WebSocketClient');
        } else {
        }
        
        // 更新客户端URL
        wsClient.setupWebSocket(wsUrl);
        
        // 创建客户端接口
        clientInterface = {
            // 事件监听
            on: (eventName, callback) => wsClient.on(eventName, callback),
            off: (eventName, callback) => wsClient.off(eventName, callback),
            
            // 发送消息
            send: (message) => wsClient.send(message),
            
            // 获取连接状态
            getConnectionStatus: () => wsClient.getConnectionStatus(),
            
            // 断开连接
            disconnect: () => wsClient.disconnect(),
            
            getStatus: () => wsClient.getConnectionStatus(),
            getGlobalState: () => wsClient.getGlobalState(),
            getSyncState: () => wsClient.getSyncState(),
            
            // 暴露 listeners 用于调试
            listeners: wsClient.listeners
        };
        
        // 暴露到全局
        window.WebSocketClient = clientInterface;
        isInitialized = true;
        isInitializing = false;
        
        // 触发就绪事件
        if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('websocketClientReady'));
        }
        
            if (logService && logService.info) {
            logService.info('WebSocket客户端初始化完成', 'WebSocketClient');
            } else {
            }
        
        // 监听连接事件
        wsClient.on('connected', () => {
            if (logService && logService.info) {
                logService.info('WebSocket连接成功', 'WebSocketClient');
            }
        });
        
        wsClient.on('disconnected', (data) => {
            if (logService && logService.info) {
                logService.info('WebSocket连接断开', 'WebSocketClient');
            }
        });
        
    } catch (error) {
        isInitializing = false;
        if (logService && logService.error) {
            logService.error('WebSocket客户端初始化失败', 'WebSocketClient', error);
        } else {
            console.error('[WebSocketClient] 初始化失败:', error);
        }
        
        // 创建错误时的备用接口
        if (!window.WebSocketClient) {
            window.WebSocketClient = {
                on: () => () => {},
                send: () => false,
                getConnectionStatus: () => 'error',
                disconnect: () => {},
                getStatus: () => 'error',
                getGlobalState: () => ({}),
                getSyncState: () => ({}),
                listeners: new Map()
            };
        }
    }
})();

// 注意：此文件通过普通 script 标签加载，不支持 ES6 export
// 如需在其他模块中使用，请使用 window.WebSocketClient 或动态导入
