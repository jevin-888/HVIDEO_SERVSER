import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('slow or failed warmup and queue requests never block home songs or control bindings', async () => {
  for (const fail of [false, true]) {
    let source = read('../static/vod_song/mobile/index.js');
    const names = [...source.matchAll(/^import (\w+) from .+;$/gm)].map(match => match[1]);
    source = source.replace(/^import .+;$/gm, '').replace(/export \{[\s\S]*?\};/, '');
    const background = deferred();
    const queue = deferred();
    const listeners = new Map();
    const elements = new Map(['party-call-btn', 'music-btn', 'interaction-btn', 'languageToggle'].map(id => [id, {
      addEventListener: (type, fn) => listeners.set(`${id}:${type}`, fn)
    }]));
    const calls = { home: 0, nav: 0, preload: 0, queue: 0, extraQueue: 0, badge: null };
    const context = Object.fromEntries(names.map(name => [name, {}]));
    Object.assign(context, {
      console, URLSearchParams, setTimeout, clearTimeout,
      window: { location: { hostname: '192.168.2.11', search: '?192.168.2.101' } },
      localStorage: { getItem: () => null, setItem() {} },
      document: { readyState: 'complete', getElementById: id => elements.get(id), addEventListener: (type, fn) => listeners.set(type, fn) },
      logService: { logLevel: 'warn', setOptions() {}, setLogLevel() {}, info() {}, warn() {}, error() {} },
      router: { addRoute() {}, init() {} },
      apiService: { getRoomId: () => '192.168.2.101', _getRoomIdFromUrl: () => '192.168.2.101' },
      langService: { init: () => new Promise(() => {}), getCurrentLanguage: () => 'id_id' },
      homeSelectedUI: { initHomeSelectedList: async () => { calls.home++; }, bindHomeSelectedEvents() {} },
      cacheService: { preloadAll: () => { calls.preload++; return background.promise; } },
      songService: { selectedSongs: [1, 2], syncRequestedSongsFromServer: () => { calls.queue++; return queue.promise; } },
      bottomNavUI: {
        renderBottomNav: async () => { calls.nav++; },
        updateBadgeFromServer: () => { calls.extraQueue++; return queue.promise; },
        updateSelectedBadge: count => { calls.badge = count; }
      }
    });
    vm.runInNewContext(source, context);
    await settle();
    assert.equal(calls.home, 1, 'home songs start before background responses');
    assert.equal(calls.nav, 1);
    assert.equal(calls.preload, 1);
    assert.equal(calls.queue, 1);
    assert.equal(calls.extraQueue, 0, 'entry must reuse the queue response for its badge');
    for (const id of elements.keys()) assert.equal(typeof listeners.get(`${id}:click`), 'function', id);
    assert.equal(typeof listeners.get('click'), 'function', 'entry initialization completes while responses are pending');
    if (fail) {
      background.reject(new Error('delayed preload failure'));
      queue.reject(new Error('delayed queue failure'));
    } else {
      background.resolve();
      queue.resolve();
    }
    await settle();
    assert.equal(calls.badge, fail ? null : 2);
    assert.equal(calls.home, 1);
  }
});

test('navigation renders fallback labels before its language request completes', async () => {
  const language = deferred();
  const source = read('../static/vod_song/mobile/navigation/bottomNav/BottomNavUI.js');
  const start = source.indexOf('  async renderBottomNav(');
  const end = source.indexOf('\n  /**', start);
  let footer;
  let updated = false;
  const context = vm.createContext({
    console,
    document: {
      createElement: () => ({}),
      body: { appendChild: element => { footer = element; } },
      addEventListener() {}
    }
  });
  const ui = vm.runInContext(`({${source.slice(start, end)}})`, context);
  Object.assign(ui, {
    initServices: async () => { ui.langService = { translations: {}, init: () => language.promise, t: key => key, addObserver() {} }; },
    bindNavEvents() {}, initBadgeSync() {}, updateNavLabels() { updated = true; }
  });
  let rendered = false;
  const rendering = ui.renderBottomNav().then(() => { rendered = true; });
  await settle();
  assert.equal(rendered, true);
  assert.match(footer.innerHTML, /控制/);
  assert.match(footer.innerHTML, /已选/);
  assert.equal(updated, false);
  language.resolve();
  await rendering;
  await settle();
  assert.equal(updated, true);
});
