/**
 * PlayerService - 大屏播放器核心订阅服务
 *
 * 职责：
 *   1. 订阅 WebSocket 的 command / getPlayList / initialState / roomStateChanged
 *   2. 维护本地播放队列与播放状态
 *   3. 对外派发语义明确的播控事件，供播放器 UI / 视频引擎消费
 *
 * 事件列表（通过 on() 订阅）：
 *   play(item)           - 开始播放指定曲目
 *   pause()              - 暂停
 *   resume()             - 恢复播放
 *   stop()               - 停止（队列为空）
 *   replay()             - 重播当前曲目
 *   skip(nextItem)       - 切歌，nextItem 可能为 null
 *   volumeChange(vol)    - 音量变化 0-100
 *   trackSwitch(trackId) - 原伴唱切换 0=伴唱 1=原唱
 *   queueUpdate(queue)   - 播放队列更新
 *   stateSync(state)     - 房间完整状态同步
 */

class PlayerService {
  constructor() {
    this._listeners = {};
    this._unbindHandlers = [];
    this._wsListenerBound = false;

    this.queue = [];
    this.currentItem = null;
    this.state = {
      playing: false,
      volume: 50,
      muted: false,
      trackId: 1,
    };

    this._bindWebSocket();
  }

  // ────────────────── 事件系统 ──────────────────

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
    return () => {
      const arr = this._listeners[event];
      if (arr) {
        const idx = arr.indexOf(cb);
        if (idx !== -1) arr.splice(idx, 1);
      }
    };
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(cb => {
      try { cb(data); } catch (_) {}
    });
  }

  // ────────────────── WebSocket 订阅 ──────────────────

  _bindWebSocket() {
    const doBind = () => {
      if (!window.WebSocketClient || this._wsListenerBound) return;

      this._unbindHandlers.push(
        window.WebSocketClient.on('command', (data) => this._onCommand(data))
      );
      this._unbindHandlers.push(
        window.WebSocketClient.on('playListChanged', (data) => this._onPlayList(data))
      );
      this._unbindHandlers.push(
        window.WebSocketClient.on('roomStateChanged', (data) => this._onRoomStateChanged(data))
      );

      this._wsListenerBound = true;
    };

    if (window.WebSocketClient) {
      doBind();
    } else {
      const handler = () => {
        doBind();
        if (this._wsListenerBound) {
          window.removeEventListener('websocketClientReady', handler);
        }
      };
      window.addEventListener('websocketClientReady', handler);
    }
  }

  // ────────────────── 消息处理 ──────────────────

  /** 连接建立后服务器推送的完整初始状态 */
  _onInitialState(data) {
    if (!data) return;

    this.state.playing = data.playState === 1;
    this.state.volume = data.volume ?? this.state.volume;
    this.state.muted = data.mute === true || data.mute === 1;
    this.state.trackId = data.micStatus ?? this.state.trackId;

    if (data.currentSongId) {
      this.currentItem = {
        songId: data.currentSongId,
        songName: data.currentSongTitle || '',
      };
    }

    this._emit('stateSync', { ...this.state, currentItem: this.currentItem });
  }

  /** 播控指令 */
  _onCommand(data) {
    if (!data) return;
    const action = data.action;

    switch (action) {
      case 'Play': {
        this.state.playing = true;
        const item = data.data || this.currentItem;
        if (item) {
          this.currentItem = item;
          this._emit('play', item);
        } else {
          this._emit('resume');
        }
        break;
      }
      case 'Pause':
        this.state.playing = false;
        this._emit('pause');
        break;
      case 'Replay':
        this._emit('replay');
        break;
      case 'SkipSong': {
        const nextItem = data.data || null;
        this.currentItem = nextItem;
        this.state.playing = !!nextItem;
        this._emit('skip', nextItem);
        break;
      }
      case 'Stop':
        this.state.playing = false;
        this.currentItem = null;
        this._emit('stop');
        break;
      case 'SetVolume':
        if (data.volume != null) {
          this.state.volume = data.volume;
          this._emit('volumeChange', data.volume);
        }
        break;
      case 'SwitchTrack':
        if (data.micStatus != null) {
          const micStatus = Number(data.micStatus);
          if (!Number.isNaN(micStatus)) {
            this.state.trackId = micStatus;
            this._emit('trackSwitch', micStatus);
          }
        }
        break;
      case 'MicOn':
        this.state.micEnabled = true;
        this._emit('micChange', true);
        break;
      case 'MicOff':
        this.state.micEnabled = false;
        this._emit('micChange', false);
        break;
      case 'Mute':
        this.state.muted = true;
        this._emit('muteChange', true);
        break;
      case 'Unmute':
        this.state.muted = false;
        this._emit('muteChange', false);
        break;
      case 'SetMute':
        if (data.enabled !== undefined) {
          this.state.muted = data.enabled;
          this._emit('muteChange', data.enabled);
        }
        break;
      default:
        // SetAC / SetLight / SetEffect 等外设指令播放器无需处理
        break;
    }
  }

  /** 播放列表推送 */
  _onPlayList(data) {
    if (!data) return;
    const listType = data.listType ?? 1;
    if (listType !== 1) return;

    const raw = data.data;
    // 如果是轻量通知信号，不应清空队列，而应触发全量拉取
    if (data._notification || data.type === 'playListChanged' || !Array.isArray(raw)) {
      this._triggerQueueFetch();
      return;
    }

    this.queue = Array.isArray(raw) ? raw : [];

    // 同步当前播放曲目
    const playing = this.queue.find(item => item.status === 1);
    if (playing) {
      this.currentItem = playing;
    }

    this._emit('queueUpdate', this.queue);
  }

  /** 触发 HTTP 增量拉取（信号转主动拉取） */
  async _triggerQueueFetch() {
    if (window.apiService) {
      try {
        console.log('[PlayerService] 收到推送，正在拉取权威点歌队列...');
        const res = await window.apiService.getPlayList();
        if (res) {
          this._onPlayList(res);
        }
      } catch (e) {
        console.error('[PlayerService] 拉取失败:', e);
      }
    }
  }

  /** 房间状态变更 */
  _onRoomStateChanged(data) {
    if (!data) return;
    const s = data.data || data;

    const oldSongId = this.currentItem?.songId;
    const oldPlayState = this.state.playing;

    if (s.playState != null) this.state.playing = s.playState === 1;
    if (s.volume != null) {
      const oldVol = this.state.volume;
      this.state.volume = Number(s.volume);
      if (oldVol !== this.state.volume) this._emit('volumeChange', this.state.volume);
    }
    if (s.mute !== undefined) {
      const oldMute = this.state.muted;
      this.state.muted = s.mute === true || s.mute === 1;
      if (oldMute !== this.state.muted) this._emit('muteChange', this.state.muted);
    }
    if (s.micStatus != null) this.state.trackId = s.micStatus;

    if (s.playingNow) {
      this.currentItem = s.playingNow;
      const newSongId = this.currentItem?.songId;
      // 🆕 核心逻辑：检测曲目变更
      if (newSongId && oldSongId !== newSongId) {
          if (oldSongId) {
              console.log(`[PlayerService] 检测到切歌信号 (StateSync): ${oldSongId} -> ${newSongId}`);
              this._emit('skip', this.currentItem);
          } else {
              console.log(`[PlayerService] 检测到首首起播信号 (StateSync): ${newSongId}`);
              this._emit('play', this.currentItem);
          }
      }
    } else if (s.currentSongId !== undefined) {
      if (s.currentSongId) {
        this.currentItem = {
          ...(this.currentItem || {}),
          songId: s.currentSongId,
          songName: s.currentSongTitle || this.currentItem?.songName || '',
        };
        if (s.currentSongId !== oldSongId) {
            if (oldSongId) this._emit('skip', this.currentItem);
            else this._emit('play', this.currentItem);
        }
      } else {
        this.currentItem = null;
        if (oldSongId) {
            console.log('[PlayerService] 队列变为空');
            this._emit('stop');
        }
      }
    }

    // 处理播放/暂停状态转变 (非首首起播时的状态联动)
    if (!oldPlayState && this.state.playing) {
        this._emit('resume');
    } else if (oldPlayState && !this.state.playing) {
        this._emit('pause');
    }

    this._emit('stateSync', { ...this.state, currentItem: this.currentItem });
  }

  // ────────────────── 查询方法 ──────────────────

  getQueue() { return this.queue; }
  getCurrentItem() { return this.currentItem; }
  getState() { return { ...this.state }; }
  isPlaying() { return this.state.playing; }

  // ────────────────── 清理 ──────────────────

  destroy() {
    this._unbindHandlers.forEach(fn => { try { fn(); } catch (_) {} });
    this._unbindHandlers = [];
    this._wsListenerBound = false;
    this._listeners = {};
  }
}

const playerService = new PlayerService();
export default playerService;
