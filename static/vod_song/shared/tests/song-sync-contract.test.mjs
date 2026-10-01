import test from 'node:test';
import assert from 'node:assert/strict';

const websocketHandlers = new Map();

globalThis.window = {
  WebSocketClient: {
    on(event, callback) {
      websocketHandlers.set(event, callback);
      return () => websocketHandlers.delete(event);
    }
  },
  addEventListener() {},
  removeEventListener() {}
};

globalThis.document = {
  hidden: false,
  body: null,
  addEventListener() {},
  removeEventListener() {}
};

const { default: songSyncManager } = await import('../modules/songs/SongSyncManager.js');

test.after(() => {
  songSyncManager.cleanup();
});

test('peripheral commands never trigger song queue synchronization or song UI updates', async () => {
  const commandHandler = websocketHandlers.get('command');
  assert.equal(typeof commandHandler, 'function');

  const syncCalls = [];
  const syncEvents = [];
  songSyncManager.syncSongState = force => {
    syncCalls.push(force);
  };
  const removeListener = songSyncManager.addSyncListener(event => syncEvents.push(event));

  for (const action of ['SetLight', 'SetAC', 'SetEffect', 'SetVolume', 'SwitchTrack']) {
    await commandHandler({ type: 'command', action });
  }

  assert.deepEqual(syncCalls, []);
  assert.deepEqual(syncEvents, []);

  await commandHandler({ type: 'command', action: 'Play' });
  assert.deepEqual(syncCalls, [true]);
  assert.equal(syncEvents.length, 1);
  assert.equal(syncEvents[0].type, 'commandUpdate');
  assert.equal(syncEvents[0].command, 'Play');

  removeListener();
});
