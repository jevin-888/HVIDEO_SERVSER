import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizeSongsList, normalizePlayList } from '../static/vod_song/shared/utils/NormalizeUtils.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function songService() {
  const source = read('../static/vod_song/shared/modules/songs/SongService.js')
    .replace(/^import .*;\r?$/gm, '').replace('export default songService;', 'globalThis.service = songService;');
  const context = { console, apiService: {}, cacheService: {}, normalizeSongsList, normalizePlayList,
    isApiOk: response => response.code === 0, getApiErrorMessage: response => response.message };
  vm.runInNewContext(source, context);
  context.service._scheduleAuthoritativeResync = () => {};
  context.service._logService = { debug() {}, warn() {}, error() {} };
  return context.service;
}
const song = { songNo: '60000114', songName: '后来', singerNames: '刘若英' };

test('rapid requests send once, queued songs stay blocked, deleting allows another request', async () => {
  const service = songService();
  let resolve, calls = 0;
  service.apiService.selectSong = () => { calls++; return new Promise(done => { resolve = done; }); };
  const first = service.requestSong(song.songNo, song);
  await assert.rejects(service.requestSong(song.songNo, song), /重复点播/);
  assert.equal(calls, 1);
  resolve({ code: 0, data: song });
  await first;
  await assert.rejects(service.requestSong(song.songNo), /重复点播/);
  service.applyDeleteAccepted(song.songNo);
  const again = service.requestSong(song.songNo, song);
  resolve({ code: 0, data: song });
  await again;
  assert.equal(calls, 2);
  assert.equal(service.selectedSongs.length, 1);
});

test('failed requests release the pending lock; server snapshots deduplicate selected songs', async () => {
  const service = songService();
  service.apiService.selectSong = async () => ({ code: 1, message: 'offline' });
  await assert.rejects(service.requestSong(song.songNo), /offline/);
  assert.equal(service.isSongRequested(song.songNo), false);
  service.applyPlayListSnapshot([song, { ...song, id: 'duplicate' }, { songNo: 'second' }]);
  assert.equal(service.selectedSongs.length, 2);
  assert.equal(service.getSelectedSongIndex('second'), 1);
  service.applyDeleteAccepted(song.songNo);
  assert.equal(service.isSongRequested(song.songNo), false);
  assert.equal(service._isStaleMutationSnapshot([song]), true);
});

function languageService(storage) {
  const source = read('../static/vod_song/shared/services/LangService/LangService.js')
    .replace('export default langService;', 'globalThis.service = langService;');
  const context = { console, localStorage: storage,
    document: { body: { classList: { add() {}, remove() {} } } } };
  vm.runInNewContext(source, context);
  context.service.loadLanguageFile = async language => {
    context.service.translations[language] = { music: language === 'id_id' ? 'Musik' : '点歌' };
    return { success: true };
  };
  return context.service;
}

test('Indonesian survives a new page instance and initialization', async () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const first = languageService(storage);
  await first.switchLanguage('id_id');
  const reopened = languageService(storage);
  await reopened.init();
  assert.equal(reopened.getCurrentLanguage(), 'id_id');
  assert.equal(reopened.t('music'), 'Musik');
});

test('invalid or unavailable storage does not break language initialization', async () => {
  for (const storage of [
    { getItem: () => 'invalid', setItem() {} },
    { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
  ]) {
    const service = languageService(storage);
    await service.init();
    assert.equal(service.getCurrentLanguage(), 'zh_cn');
    await service.switchLanguage('id_id');
    assert.equal(service.getCurrentLanguage(), 'id_id');
  }
});
