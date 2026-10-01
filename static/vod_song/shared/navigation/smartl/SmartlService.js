import apiService from '../../core/ApiService.js';
import lightingService from './lightingService.js';
import acService from './AcService.js';
import { logInfo, logWarn, logError } from '../../utils/Logger.js';
import { isApiOk, getApiErrorMessage } from '../../utils/ApiResponseUtils.js';

/**
 * 导航控制业务逻辑
 */
class SmartlService {
  constructor() {
    this.apiService = apiService;
    this.lightingService = lightingService;
    this.acService = acService;

    // 事件监听器
    this._listeners = {};

    // WebSocket 订阅清理函数
    this._wsUnsubscribers = [];
    this._wsSyncInitialized = false;
    this._volumeIntentGeneration = 0;
    this._volumeCommitTimer = null;
    this._volumeCommitWaiters = [];
    this._desiredVoiceState = null;
    this._desiredVoiceConfirmed = { volume: false, micVolume: false };
    this._pendingVoiceConfirmation = null;
    this._voiceWritePromise = null;
    this._voiceReadyToCommit = false;
    this._musicVolumeToRestore = 50;
    this._muteCommandPromise = null;

    // 状态（初始值为 null，等待服务器推送覆盖）
    this.state = {
      isPlaying: false,
      isMuted: false,
      isOriginal: true,
      volume: null,
      micVolume: null,
      currentTab: 'audio',
      power: false,
      temp: null,
      mode: null,
      wind: null,
      isAutoLightOn: false,
      selectedLightMode: null,
      soundEffectMode: null
    };
  }

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(cb => { try { cb(data); } catch (_) {} });
  }

  /**
   * 获取控制项列表
   * GET /api/v1/navigation/smartl
   */
  async handleAudioControlCommand(action) {
    if (this._muteCommandPromise) return this._muteCommandPromise;

    const command = action === 'mute' || action.endsWith('/mute')
      ? 'Mute'
      : action === 'unmute' || action.endsWith('/unmute')
        ? 'Unmute'
        : null;
    if (!command) throw new Error(`Unsupported audio control action: ${action}`);

    const task = (async () => {
      const response = await this.apiService.musicBarControl({ action: command });
      this._requireApiSuccess(response, command === 'Mute' ? 'Failed to mute' : 'Failed to unmute');

      if (command === 'Mute') {
        const current = Number(this.state.volume);
        if (Number.isFinite(current) && current > 0) this._musicVolumeToRestore = current;
        this._setState({ isMuted: true, volume: 0 }, { volumeChanged: true });
      } else {
        const current = Number(this.state.volume);
        const restored = Number.isFinite(current) && current > 0 ? current : this._musicVolumeToRestore;
        this._setState(
          { isMuted: false, volume: Math.max(0, Math.min(100, restored)) },
          { volumeChanged: true }
        );
      }
      return response;
    })();

    this._muteCommandPromise = task;
    try {
      return await task;
    } finally {
      if (this._muteCommandPromise === task) this._muteCommandPromise = null;
    }
  }

  _requireApiSuccess(response, fallbackMessage) {
    if (!isApiOk(response)) {
      throw new Error(getApiErrorMessage(response, fallbackMessage));
    }
    return response;
  }

  _setState(patch, options = {}) {
    this.state = { ...this.state, ...patch };
    this._emit('stateChange', this.state);
    if (options.volumeChanged) this._emit('volumeChange', this.state.volume);
    if (options.micVolumeChanged) this._emit('micVolumeChange', this.state.micVolume);
    this._notifyUIUpdate();
    return this.state;
  }

  /**
   * Route each playback action to its single Flutter-compatible room API.
   * HTTP success updates local intent; WebSocket remains authoritative.
   */
  async handlePlaybackCommand(action) {
    let response;
    switch (action) {
      case 'repeat':
        response = await this.apiService.replay();
        this._requireApiSuccess(response, 'Failed to replay');
        break;
      case 'pause':
        response = await this.apiService.pause();
        this._requireApiSuccess(response, 'Failed to pause');
        this._setState({ isPlaying: false, playState: 0 });
        break;
      case 'play':
      case 'resume':
        response = await this.apiService.play();
        this._requireApiSuccess(response, 'Failed to play');
        this._setState({ isPlaying: true, playState: 1 });
        break;
      case 'next': {
        const songService = typeof window !== 'undefined' ? window.songService : null;
        const previousHeadId = songService?.selectedSongs?.[0]?.songNo ?? null;
        response = await this.apiService.playNext();
        this._requireApiSuccess(response, 'Failed to play next song');
        songService?.applyNextAccepted?.(previousHeadId);
        break;
      }
      case 'original':
        response = await this.apiService.switchTrack(1);
        this._requireApiSuccess(response, 'Failed to switch to original track');
        this._setState({ isOriginal: true });
        break;
      case 'vocal':
        response = await this.apiService.switchTrack(0);
        this._requireApiSuccess(response, 'Failed to switch to accompaniment track');
        this._setState({ isOriginal: false });
        break;
      default:
        throw new Error(`Unsupported playback action: ${action}`);
    }

    if (response?.data && typeof response.data === 'object') {
      this.syncStateFromServer(response.data);
    }
    return response;
  }

  /** ?? UI ??? */
  _notifyUIUpdate() {
    try {
      if (window.smartlUI && typeof window.smartlUI.updateAllUI === 'function') {
        window.smartlUI.updateAllUI();
      }
    } catch (e) { /* silent */ }
  }

  /**
   * 处理音量变化
   * POST /api/v1/rooms/:id/peripheral/voice  { volume, micVolume }
   */
  async handleVolumeChange(action) {
    const [type, direction] = action.split('-');
    if (type !== 'music' && type !== 'mic') throw new Error('Invalid volume channel');
    if (direction !== 'up' && direction !== 'down') throw new Error('Invalid volume direction');

    const rawCurrent = Number(type === 'music' ? this.state.volume : this.state.micVolume);
    const currentVolume = Number.isFinite(rawCurrent) ? rawCurrent : 0;
    const stepValue = direction === 'up' ? 5 : -5;
    const newVolume = Math.max(0, Math.min(100, currentVolume + stepValue));

    if (type === 'music') {
      if (newVolume > 0) this._musicVolumeToRestore = newVolume;
      this._setState({ volume: newVolume, isMuted: false }, { volumeChanged: true });
    } else {
      this._setState({ micVolume: newVolume }, { micVolumeChanged: true });
    }

    const nextVoicePatch = type === 'music'
      ? { volume: Number.isFinite(Number(this.state.volume)) ? Number(this.state.volume) : 0 }
      : {
          volume: Number.isFinite(Number(this.state.volume)) ? Number(this.state.volume) : 0,
          micVolume: Number.isFinite(Number(this.state.micVolume)) ? Number(this.state.micVolume) : 0
        };
    this._desiredVoiceState = { ...(this._desiredVoiceState || {}), ...nextVoicePatch };
    this._desiredVoiceConfirmed = { volume: false, micVolume: false };
    this._pendingVoiceConfirmation = null;
    const generation = ++this._volumeIntentGeneration;

    if (this._volumeCommitTimer) clearTimeout(this._volumeCommitTimer);
    this._voiceReadyToCommit = false;

    const resultPromise = new Promise((resolve, reject) => {
      this._volumeCommitWaiters.push({ generation, resolve, reject });
    });
    this._volumeCommitTimer = setTimeout(() => {
      this._volumeCommitTimer = null;
      this._voiceReadyToCommit = true;
      this._drainVoiceWrites();
    }, 300);
    return await resultPromise;
  }

  async _drainVoiceWrites() {
    if (!this._voiceReadyToCommit || this._voiceWritePromise || !this._desiredVoiceState) return;

    this._voiceReadyToCommit = false;
    const generation = this._volumeIntentGeneration;
    const payload = { ...this._desiredVoiceState };
    const write = this.apiService.controlVoice(payload);
    this._voiceWritePromise = write;

    try {
      const response = await write;
      this._requireApiSuccess(response, 'Failed to set volume');

      if (generation === this._volumeIntentGeneration) {
        this._desiredVoiceState = null;
        this._pendingVoiceConfirmation = {
          volume: this._desiredVoiceConfirmed.volume ? null : payload.volume,
          micVolume: this._desiredVoiceConfirmed.micVolume ? null : payload.micVolume
        };
        this._desiredVoiceConfirmed = { volume: false, micVolume: false };
      }
      this._settleVolumeWaiters(generation, null, response);
    } catch (error) {
      if (generation === this._volumeIntentGeneration) {
        this._desiredVoiceState = null;
        this._pendingVoiceConfirmation = null;
        this._desiredVoiceConfirmed = { volume: false, micVolume: false };
      }
      this._settleVolumeWaiters(generation, error);
    } finally {
      if (this._voiceWritePromise === write) this._voiceWritePromise = null;
      if (this._voiceReadyToCommit && this._desiredVoiceState) this._drainVoiceWrites();
    }
  }

  _settleVolumeWaiters(generation, error, response) {
    const settled = [];
    const pending = [];
    this._volumeCommitWaiters.forEach(waiter => {
      (waiter.generation <= generation ? settled : pending).push(waiter);
    });
    this._volumeCommitWaiters = pending;
    settled.forEach(waiter => error ? waiter.reject(error) : waiter.resolve(response));
  }

  _acceptServerVoiceValue(field, rawValue) {
    if (rawValue == null) return null;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return null;

    const desired = this._desiredVoiceState?.[field];
    if (desired != null) {
      if (value === desired) this._desiredVoiceConfirmed[field] = true;
      return null;
    }

    const expected = this._pendingVoiceConfirmation?.[field];
    if (expected != null) {
      if (value !== expected) return null;
      this._pendingVoiceConfirmation[field] = null;
      if (this._pendingVoiceConfirmation.volume == null && this._pendingVoiceConfirmation.micVolume == null) {
        this._pendingVoiceConfirmation = null;
      }
    }
    return value;
  }

  /** Handle temperature change. */
  async handleTemperatureChange(action) {
    try {
      if (action === 'temp-up') {
        return await this.acService.handleAcCommand('consumer/clickButton/temAddButton');
      } else if (action === 'temp-down') {
        return await this.acService.handleAcCommand('consumer/clickButton/temMinusButton');
      }
    } catch (error) {
      logError('处理温度变化失败:', error);
      throw error;
    }
  }

  /**
   * 处理音效切换命令
   * POST /api/v1/rooms/:id/peripheral/effect  { mode }
   */
  async handleSoundEffectCommand() {
    const modes = ['standard', 'ktv', 'concert', 'theater'];
    const currentIndex = modes.indexOf(this.state.soundEffectMode ?? 'standard');
    const nextMode = modes[(currentIndex + 1) % modes.length];
    const response = await this.apiService.controlEffect({ mode: nextMode });
    this._requireApiSuccess(response, 'Failed to change sound effect');
    this._setState({ soundEffectMode: nextMode });
    return response;
  }

  /**
   * 从缓存直接获取字典
   */
  getDictFromCache(groupKey) {
    if (typeof window !== 'undefined' && window.cacheService) {
      const cacheKey = `dict.${groupKey}`;
      const result = window.cacheService.get(cacheKey);
      return result || window.cacheService.getDictFromCache(groupKey) || null;
    }
    return null;
  }

  /**
   * 获取某一分组的字典
   */
  async getDict(groupKey, ttl = 30 * 60 * 1000) {
    if (typeof window !== 'undefined' && window.cacheService) {
      try {
        return await window.cacheService.getDict(groupKey, ttl);
      } catch (error) {
        logError(`[SmartlService] 获取字典 ${groupKey} 失败:`, error);
      }
    }
    return [];
  }

  /**
   * 获取控制状态
   */
  getState() {
    const lightingState = this.lightingService ? this.lightingService.getState() : {};
    return {
      ...this.state,
      ...lightingState,
    };
  }

  /**
   * 更新状态
   */
  updateState(newState) {
    this.state = { ...this.state, ...newState };
    if (this.lightingService && typeof this.lightingService.updateState === 'function') {
      this.lightingService.updateState(newState);
    }
    if (this.acService && typeof this.acService.updateState === 'function') {
      this.acService.updateState(newState);
    }
  }

  /**
   * 初始化WebSocket状态同步
   *
   * 服务器（ws/mod.rs）向房间内所有客户端推送的事件：
   *   - roomStateChanged  完整房间状态（playState/volume/mute/micStatus/ac/light/effect）
   *   - command           播控指令（Play/Pause/SetVolume/Mute/Unmute/MicOn/MicOff/SwitchTrack 等）
   *   - playListChanged   播放列表变更信号（无数据负载）
   *
   * 初始完整状态通过 HTTP GET /api/v1/rooms/:id/state 拉取（WS 连接建立前的兜底）。
   */
  initWebSocketSync() {
    if (this._wsSyncInitialized) {
      this._cleanupWebSocketListeners();
    }

    if (!window.WebSocketClient) {
      setTimeout(() => {
        if (window.WebSocketClient) {
          this.initWebSocketSync();
        }
      }, 1000);
      return;
    }

    // 1. 监听完整房间状态推送（roomStateChanged）
    // 服务器在每次状态变更后广播给房间内所有客户端（含触摸屏）
    // 数据字段对齐 GET /api/v1/rooms/:id/state 响应格式
    const unsubRoomState = window.WebSocketClient.on('roomStateChanged', (data) => {
      if (!data) return;
      const stateData = data.data || data;
      this.syncStateFromServer(stateData);
    });
    this._wsUnsubscribers.push(unsubRoomState);

    // 2. 监听播控指令（command）——用于即时 UI 反馈，无需等待 roomStateChanged 回环
    // action 字段严格对齐 room_handler.rs 中 send_command 的推送格式
    const unsubCommand = window.WebSocketClient.on('command', (data) => {
      if (!data || !data.action) return;
      const action = data.action;
      const newState = {};

      if (action === 'SetVolume') {
        const volume = this._acceptServerVoiceValue('volume', data.volume);
        const micVolume = this._acceptServerVoiceValue('micVolume', data.micVolume);
        if (volume != null) {
          newState.volume = volume;
          newState.isMuted = false;
        }
        if (micVolume != null) newState.micVolume = micVolume;
      } else if (action === 'Mute') {
        newState.isMuted = true;
        newState.volume = 0;
      } else if (action === 'Unmute') {
        const restoredVolume = Number(data.volume);
        if (Number.isFinite(restoredVolume)) {
          this._musicVolumeToRestore = Math.max(0, Math.min(100, restoredVolume));
          newState.isMuted = false;
          newState.volume = this._musicVolumeToRestore;
        }
      } else if (action === 'MicOn') {
        newState.isOriginal = true;
      } else if (action === 'MicOff') {
        newState.isOriginal = false;
      } else if (action === 'SwitchTrack') {
        if (data.micStatus != null) {
          const micStatus = Number(data.micStatus);
          if (!Number.isNaN(micStatus)) newState.isOriginal = micStatus === 1;
        }
      } else if (action === 'Play') {
        newState.isPlaying = true;
      } else if (action === 'Pause') {
        newState.isPlaying = false;
      } else if (action === 'SetAC') {
        // 对齐 ACControlRequest 字段
        if (data.power !== undefined) newState.power = data.power === true;
        if (data.temp != null) newState.temp = Number(data.temp);
        if (data.mode !== undefined) newState.mode = data.mode;
        if (data.wind !== undefined) newState.wind = data.wind;
        if (this.acService) this.acService.updateState(newState);
      } else if (action === 'SetLight') {
        // 对齐 LightControlRequest 字段
        if (data.scene !== undefined) {
          if (data.scene === 'auto') {
            newState.isAutoLightOn = true;
            newState.selectedLightMode = null;
          } else if (data.scene === 'manual') {
            newState.isAutoLightOn = false;
            newState.selectedLightMode = null;
          } else {
            newState.isAutoLightOn = false;
            newState.selectedLightMode = `light/${data.scene}`;
          }
        }
      } else if (action === 'SetEffect') {
        // 对齐 EffectControlRequest 字段
        if (data.mode !== undefined) newState.soundEffectMode = data.mode;
      }

      if (Object.keys(newState).length > 0) {
        this.state = { ...this.state, ...newState };
        this._emit('stateChange', this.state);
        if (newState.volume !== undefined) this._emit('volumeChange', this.state.volume);
        if (newState.micVolume !== undefined) this._emit('micVolumeChange', this.state.micVolume);
      }
    });
    this._wsUnsubscribers.push(unsubCommand);
    // Forward the player's real execution result to PAD and mobile clients.
    const unsubCommandResult = window.WebSocketClient.on('commandResult', (data) => {
      if (data) this._emit('commandResult', data);
    });
    this._wsUnsubscribers.push(unsubCommandResult);

    this._wsSyncInitialized = true;
    // Consume a cached authoritative state if it arrived before this listener.
    const cachedState = typeof window.WebSocketClient.getInitialState === 'function'
      ? window.WebSocketClient.getInitialState()
      : null;
    if (cachedState) this.syncStateFromServer(cachedState);

    // HTTP 兜底：WS 连接建立前先拉取一次完整状态，避免首屏空白
    this.apiService.getRoomState().then(data => {
      if (data && data.volume != null) {
        this.syncStateFromServer(data);
      }
    }).catch(() => {});
  }

  /**
   * 清理WebSocket监听器
   */
  _cleanupWebSocketListeners() {
    if (this._wsUnsubscribers && this._wsUnsubscribers.length > 0) {
      this._wsUnsubscribers.forEach(unsubscribe => {
        try {
          if (typeof unsubscribe === 'function') unsubscribe();
        } catch (_) {}
      });
      this._wsUnsubscribers = [];
    }
    this._wsSyncInitialized = false;
  }

  /**
   * 从服务器同步状态（唯一解析入口）
   * 字段严格对齐 GET /api/v1/rooms/:id/state 响应的 data 对象
   * 参见 room_handler.rs get_full_room_state_json
   */
  syncStateFromServer(data) {
    if (!data) return;
    try {
      const stateData = data;

      const newState = { ...this.state };

      // 1. 播放状态 (playState: 1=播放, 0/2=暂停)
      if (stateData.playState !== undefined) {
        newState.playState = Number(stateData.playState);
        newState.isPlaying = newState.playState === 1;
      }

      // 2. 静音状态 (mute: bool)
      if (stateData.mute !== undefined) {
        newState.isMuted = stateData.mute === true || stateData.mute === 1;
      }

      if (stateData.micStatus != null) {
        newState.isOriginal = Number(stateData.micStatus) === 1;
      }

      if (stateData.volume != null) {
        const volume = this._acceptServerVoiceValue('volume', stateData.volume);
        if (volume != null) {
          newState.volume = volume;
          if (!newState.isMuted && volume > 0) this._musicVolumeToRestore = volume;
        }
      }
      if (stateData.micVolume != null) {
        const micVolume = this._acceptServerVoiceValue('micVolume', stateData.micVolume);
        if (micVolume != null) newState.micVolume = micVolume;
      }

      if (stateData.currentSongId !== undefined) {
        newState.currentSongId = stateData.currentSongId;
      }
      if (stateData.currentSongTitle !== undefined) {
        newState.currentSongTitle = stateData.currentSongTitle;
      }

      // 6. 空调状态 (ac.power, ac.temp, ac.wind, ac.mode)
      if (stateData.ac) {
        const ac = stateData.ac;
        if (ac.power !== undefined) newState.power = ac.power === true;
        if (ac.temp != null) newState.temp = Number(ac.temp);
        if (ac.wind !== undefined) newState.wind = ac.wind;
        if (ac.mode !== undefined) newState.mode = ac.mode;
        if (this.acService) {
          this.acService.updateState({
            power: newState.power,
            temp: newState.temp,
            wind: newState.wind,
            mode: newState.mode,
          });
        }
      }

      // 7. 灯光状态 (light.scene)
      if (stateData.light) {
        const light = stateData.light;
        if (light.scene != null) {
          const scene = String(light.scene);
          newState.lightMode = scene;
          if (scene === 'auto') {
            newState.isAutoLightOn = true;
            newState.selectedLightMode = null;
          } else if (scene === 'manual') {
            newState.isAutoLightOn = false;
            newState.selectedLightMode = null;
          } else if (scene) {
            newState.isAutoLightOn = false;
            newState.selectedLightMode = `light/${scene}`;
          }
        }
      }

      // 8. 音效状态 (effect.mode)
      if (stateData.effect) {
        const effect = stateData.effect;
        if (effect.mode !== undefined) {
          newState.soundEffectMode = effect.mode;
        }
      }

      this.state = newState;
      this._emit('stateChange', this.state);
      this._emit('volumeChange', this.state.volume);
      this._emit('micVolumeChange', this.state.micVolume);

    } catch (error) {
      logError('[SmartlService] 同步状态失败:', error);
    }
  }
}

// 创建并导出导航控制服务实例
const smartlService = new SmartlService();
export default smartlService;
