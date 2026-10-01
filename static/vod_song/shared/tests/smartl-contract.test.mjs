import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
globalThis.window = {
  AppConfig: {
    songServer: { baseUrl: '/api/v1', endpoints: {} },
    mucServer: { baseUrl: '/api/v1', endpoints: {} },
    cashierServer: { baseUrl: '/api/v1', endpoints: {} }
  },
  location: { search: '' },
  smartlUI: null
};

const { default: smartlService } = await import('../navigation/smartl/SmartlService.js');

function resetService() {
  if (smartlService._volumeCommitTimer) clearTimeout(smartlService._volumeCommitTimer);
  smartlService._listeners = {};
  smartlService._volumeIntentGeneration = 0;
  smartlService._volumeCommitTimer = null;
  smartlService._volumeCommitWaiters = [];
  smartlService._desiredVoiceState = null;
  smartlService._desiredVoiceConfirmed = { volume: false, micVolume: false };
  smartlService._pendingVoiceConfirmation = null;
  smartlService._voiceWritePromise = null;
  smartlService._voiceReadyToCommit = false;
  smartlService._muteCommandPromise = null;
  smartlService._musicVolumeToRestore = 50;
  smartlService.state = {
    isPlaying: false,
    isMuted: false,
    isOriginal: true,
    volume: 25,
    micVolume: 25,
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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test.beforeEach(resetService);

test('rapid volume taps submit only the final music volume', async () => {
  const calls = [];
  smartlService.apiService.controlVoice = async payload => {
    calls.push({ ...payload });
    return { code: 0, message: 'ok', data: {} };
  };

  const first = smartlService.handleVolumeChange('music-up');
  await delay(100);
  const second = smartlService.handleVolumeChange('music-up');
  await delay(100);
  const third = smartlService.handleVolumeChange('music-up');

  assert.equal(smartlService.state.volume, 40);
  assert.deepEqual(calls, []);
  await Promise.all([first, second, third]);
  assert.deepEqual(calls, [{ volume: 40 }]);
});

test('in-flight writes stay single-concurrency, ignore stale echoes, and send final value', async () => {
  const calls = [];
  const gates = [];
  let inFlight = 0;
  let maxInFlight = 0;
  smartlService.apiService.controlVoice = payload => {
    calls.push({ ...payload });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    gates.push(() => { inFlight -= 1; release({ code: 0, message: 'ok', data: {} }); });
    return gate;
  };

  const first = smartlService.handleVolumeChange('music-up');
  await delay(350);
  assert.deepEqual(calls, [{ volume: 30 }]);

  const second = smartlService.handleVolumeChange('music-up');
  const third = smartlService.handleVolumeChange('music-up');
  assert.equal(smartlService.state.volume, 40);
  smartlService.syncStateFromServer({ volume: 30 });
  assert.equal(smartlService.state.volume, 40);

  await delay(350);
  assert.equal(calls.length, 1);
  gates[0]();
  await delay(0);
  await delay(0);
  assert.deepEqual(calls, [{ volume: 30 }, { volume: 40 }]);

  smartlService.syncStateFromServer({ volume: 30 });
  assert.equal(smartlService.state.volume, 40);
  smartlService.syncStateFromServer({ volume: 40 });
  assert.equal(smartlService.state.volume, 40);

  gates[1]();
  await Promise.all([first, second, third]);
  assert.equal(maxInFlight, 1);
  smartlService.syncStateFromServer({ volume: 45 });
  assert.equal(smartlService.state.volume, 45);
});

test('mute and unmute use one command API each and pending taps deduplicate', async () => {
  const calls = [];
  let release;
  smartlService.apiService.musicBarControl = payload => {
    calls.push({ ...payload });
    if (calls.length === 1) {
      return new Promise(resolve => { release = () => resolve({ code: 0, message: 'ok', data: {} }); });
    }
    return Promise.resolve({ code: 0, message: 'ok', data: {} });
  };

  const first = smartlService.handleAudioControlCommand('mute');
  const duplicate = smartlService.handleAudioControlCommand('mute');
  assert.deepEqual(calls, [{ action: 'Mute' }]);
  release();
  await Promise.all([first, duplicate]);
  assert.equal(smartlService.state.isMuted, true);
  assert.equal(smartlService.state.volume, 0);

  await smartlService.handleAudioControlCommand('unmute');
  assert.deepEqual(calls, [{ action: 'Mute' }, { action: 'Unmute' }]);
  assert.equal(smartlService.state.isMuted, false);
  assert.equal(smartlService.state.volume, 25);
});

test('playback actions route to their unique APIs', async () => {
  const calls = [];
  smartlService.apiService.replay = async () => { calls.push(['replay']); return { code: 0, data: {} }; };
  smartlService.apiService.pause = async () => { calls.push(['pause']); return { code: 0, data: {} }; };
  smartlService.apiService.play = async () => { calls.push(['play']); return { code: 0, data: {} }; };
  smartlService.apiService.playNext = async () => { calls.push(['next']); return { code: 0, data: {} }; };
  smartlService.apiService.switchTrack = async trackId => { calls.push(['track', trackId]); return { code: 0, data: {} }; };

  for (const action of ['repeat', 'pause', 'play', 'next', 'original', 'vocal']) {
    await smartlService.handlePlaybackCommand(action);
  }
  assert.deepEqual(calls, [
    ['replay'], ['pause'], ['play'], ['next'], ['track', 1], ['track', 0]
  ]);
});

test('Unmute websocket command without a valid volume does not unmute', () => {
  const handlers = new Map();
  window.WebSocketClient = {
    on(event, cb) { handlers.set(event, cb); return () => handlers.delete(event); },
    getInitialState() { return null; }
  };
  smartlService.apiService.getRoomState = async () => ({ volume: 0, mute: true });
  smartlService.state.isMuted = true;
  smartlService.state.volume = 0;
  smartlService.initWebSocketSync();

  handlers.get('command')({ action: 'Unmute' });
  assert.equal(smartlService.state.isMuted, true);
  assert.equal(smartlService.state.volume, 0);

  handlers.get('command')({ action: 'Unmute', volume: 19 });
  assert.equal(smartlService.state.isMuted, false);
  assert.equal(smartlService.state.volume, 19);
  smartlService._cleanupWebSocketListeners();
});
