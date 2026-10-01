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
    songServer: {
      baseUrl: '/api/v1',
      endpoints: {
        songList: '/songdb/songs',
        singerList: '/songdb/singers'
      }
    },
    mucServer: {
      baseUrl: '/api/v1',
      endpoints: {
        roomState: '/rooms/:id/state',
        requestSong: '/rooms/:id/queue',
        getPlayList: '/rooms/:id/queue',
        playNext: '/rooms/:id/next',
        upWord: '/rooms/:id/queue/prioritize',
        delete: '/rooms/:id/queue/:songNo',
        shufflePlay: '/rooms/:id/queue/shuffle',
        musicBarControl: '/rooms/:id/command',
        controlVoice: '/rooms/:id/peripheral/voice'
      }
    },
    cashierServer: { baseUrl: '/api/v1', endpoints: {} }
  },
  location: { search: '' }
};

const { default: apiService } = await import('../core/ApiService.js');

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => data,
    text: async () => JSON.stringify(data)
  };
}

test('catalog APIs send only the documented Flutter query fields', async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return jsonResponse({ code: 0, message: 'ok', data: { items: [], total: 0, page: 2, pageSize: 40 } });
  };

  await apiService.getSongList({
    page: 2,
    pageSize: 40,
    current: 99,
    size: 99,
    keyword: 'hello',
    searchMode: 'song',
    languageCode: 'id',
    unused: 'drop-me'
  });
  await apiService.getSingerList({
    page: 3,
    pageSize: 20,
    current: 99,
    size: 99,
    keyword: 'jay',
    regionCode: 'cn',
    unused: 'drop-me'
  });

  assert.equal(
    requests[0].url,
    '/api/v1/songdb/songs?page=2&pageSize=40&availableOnly=true&keyword=hello&searchMode=song&languageCode=id'
  );
  assert.equal(
    requests[1].url,
    '/api/v1/songdb/singers?page=3&pageSize=20&keyword=jay&regionCode=cn'
  );
});

test('queue endpoints and payloads map one-to-one', async () => {
  apiService.setRoomId('room-a');
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return jsonResponse({ code: 0, message: 'ok', data: [] });
  };

  await apiService.selectSong({ songNo: 'S001', isPriority: true, songId: 'legacy' });
  await apiService.deleteSong({ songNo: 'S001' });
  await apiService.upWord({ songNo: 'S002' });
  await apiService.playNext();
  await apiService.clearPlayList();
  await apiService.shufflePlayList();
  await apiService.getPlayList();

  assert.deepEqual(requests.map(({ url, options }) => ({
    url,
    method: options.method,
    body: options.body ? JSON.parse(options.body) : null
  })), [
    { url: '/api/v1/rooms/room-a/queue', method: 'POST', body: { songNo: 'S001', isPriority: true } },
    { url: '/api/v1/rooms/room-a/queue/S001', method: 'DELETE', body: null },
    { url: '/api/v1/rooms/room-a/queue/prioritize', method: 'POST', body: { songNo: 'S002' } },
    { url: '/api/v1/rooms/room-a/next', method: 'POST', body: null },
    { url: '/api/v1/rooms/room-a/clear', method: 'POST', body: null },
    { url: '/api/v1/rooms/room-a/queue/shuffle', method: 'POST', body: null },
    { url: '/api/v1/rooms/room-a/queue', method: 'GET', body: null }
  ]);
});

test('room id parsing supports both explicit and legacy mobile URLs', () => {
  window.location.search = '?roomId=room-a';
  assert.equal(apiService._getRoomIdFromUrl(), 'room-a');

  window.location.search = '?192.168.2.104';
  assert.equal(apiService._getRoomIdFromUrl(), '192.168.2.104');

  window.location.search = '?roomId=   ';
  assert.equal(apiService._getRoomIdFromUrl(), null);
  window.location.search = '';
});

test('legacy mobile room id is used by the song request endpoint', async () => {
  window.location.search = '?192.168.2.104';
  apiService.setRoomId(apiService._getRoomIdFromUrl());
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return jsonResponse({ code: 0, message: 'ok', data: {} });
  };

  await apiService.selectSong({ songNo: 'S001' });
  assert.equal(request.url, '/api/v1/rooms/192.168.2.104/queue');
  assert.deepEqual(JSON.parse(request.options.body), { songNo: 'S001' });

  window.location.search = '';
  apiService.setRoomId('current');
});

test('room state accepts only the documented direct data object', async () => {
  globalThis.fetch = async () => jsonResponse({
    code: 0,
    message: 'ok',
    data: { roomId: 'room-a', playState: 1, volume: 50, micVolume: 40, mute: false }
  });
  assert.deepEqual(await apiService.getRoomState(), {
    roomId: 'room-a', playState: 1, volume: 50, micVolume: 40, mute: false
  });

  globalThis.fetch = async () => jsonResponse({ code: 0, message: 'ok', data: [] });
  await assert.rejects(() => apiService.getRoomState(), /must be an object/);
});
