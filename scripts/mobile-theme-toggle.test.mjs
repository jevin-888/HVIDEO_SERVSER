import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('theme toggles update root state, persisted choice, icons and notification together', () => {
  const html = readFileSync(new URL('../static/vod_song/mobile/index.html', import.meta.url), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(text => text.includes('window.handleThemeToggleClick ='));
  const classes = new Set(['dark']);
  const attrs = new Map([['data-theme', 'dark']]);
  const saved = new Map();
  const events = [];
  const moon = { style: {} }, sun = { style: {} };
  const root = {
    classList: {
      contains: name => classes.has(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
    },
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: name => attrs.delete(name)
  };
  const context = {
    window: {},
    document: {
      documentElement: root,
      getElementById: () => ({ querySelector: selector => selector === '.fa-moon' ? moon : sun }),
      dispatchEvent: event => events.push(event)
    },
    localStorage: { setItem: (key, value) => saved.set(key, value) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  };
  vm.runInNewContext(script, context);
  for (const dark of [false, true, false]) {
    assert.equal(context.window.handleThemeToggleClick(), dark);
    assert.equal(classes.has('dark'), dark);
    assert.equal(attrs.get('data-theme'), dark ? 'dark' : undefined);
    assert.equal(saved.get('theme'), dark ? 'dark' : 'light');
    assert.equal(moon.style.display, dark ? 'block' : 'none');
    assert.equal(sun.style.display, dark ? 'none' : 'block');
    assert.equal(events.at(-1).detail.isDark, dark);
  }
});
