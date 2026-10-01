import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const source = readFileSync(new URL('../static/vod_song/mobile/modules/songs/songTopUI.js', import.meta.url), 'utf8')
    .replace('export default songTopUI;', 'globalThis.ui = songTopUI;');
  const timers = new Map();
  let timerId = 0;
  const context = { console, window: {}, document: { addEventListener() {} },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(source, context);
  const ui = context.ui;
  ui.initServices = async () => {};
  return { ui, timers };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('new song search replaces a pending list request and ignores its late response', async () => {
  const { ui } = fixture();
  const pending = [], rendered = [];
  ui.songService = {
    loadSongsByMode: (mode, params) => new Promise(resolve => pending.push({ mode, params, resolve })),
    normalizeSongs: songs => songs
  };
  ui.renderSongs = songs => rendered.push(songs);
  const container = { dataset: {} };
  const old = ui.loadSongs(container);
  await settle();
  ui.currentMode = 'search'; ui.filterParams = { keyword: '后来', searchMode: 'fullName' };
  const latest = ui.loadSongs(container);
  await settle();
  assert.equal(pending.length, 2, 'new search must not be discarded while list is loading');
  pending[1].resolve({ list: [{ songNo: 'new', songName: '后来' }], totalSize: 1 });
  await latest;
  pending[0].resolve({ list: [], totalSize: 0 });
  await old;
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0][0].songName, '后来');
  assert.equal(container.dataset.loading, 'false');
});

test('typing keeps only the latest keyword, drops hidden filters, and clear cancels pending search', () => {
  const { ui, timers } = fixture();
  const calls = [], toolbar = { style: {} };
  ui.modal = { querySelector: () => toolbar };
  ui.filterParams = { languageCode: '6', categoryCode: '11', primarySingerNo: 'old' };
  ui.setMode = (mode, params) => calls.push({ mode, ...params });
  ui.scheduleSongSearch('后');
  ui.scheduleSongSearch(' 后来 ');
  assert.equal(timers.size, 1);
  for (const fn of timers.values()) fn();
  timers.clear();
  assert.equal(JSON.stringify(calls), JSON.stringify([{ mode: 'search', keyword: '后来', searchMode: 'fullName' }]));
  ui.scheduleSongSearch('成都');
  ui.scheduleSongSearch('');
  assert.equal(timers.size, 0);
  assert.equal(calls.at(-1).mode, 'top');
  assert.equal(toolbar.style.display, '');
});

test('typing invalidates an in-flight empty result before the debounce finishes', async () => {
  const { ui } = fixture();
  let resolve;
  let renders = 0;
  ui.songService = { loadSongsByMode: () => new Promise(done => { resolve = done; }), normalizeSongs: songs => songs };
  ui.renderSongs = () => renders++;
  const old = ui.loadSongs({ dataset: {} });
  await settle();
  ui.scheduleSongSearch('成都');
  resolve({ list: [], totalSize: 0 });
  await old;
  assert.equal(renders, 0);
});

test('Chinese composition waits for commit and submits the committed song name', () => {
  const source = readFileSync(new URL('../static/vod_song/mobile/modules/songs/songTopUI.js', import.meta.url), 'utf8');
  const start = source.indexOf("    const searchInput = this.modal.querySelector('#top-search-input');");
  const end = source.indexOf('    // 添加印尼歌曲按钮', start);
  const listeners = new Map(), searches = [];
  const input = { value: '', addEventListener: (name, fn) => listeners.set(name, fn) };
  const ui = { modal: { querySelector: () => input }, _loadRequestId: 0, loading: true,
    cancelPendingSearch() {}, scheduleSongSearch: value => searches.push(value) };
  vm.runInNewContext(`(function () { ${source.slice(start, end)} }).call(ui)`, { ui });
  listeners.get('compositionstart')();
  input.value = 'hou';
  listeners.get('input')({ isComposing: true });
  assert.deepEqual(searches, []);
  input.value = '后来';
  listeners.get('compositionend')();
  assert.deepEqual(searches, ['后来']);
});
