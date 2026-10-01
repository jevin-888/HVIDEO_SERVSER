import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizePlayList } from '../static/vod_song/shared/utils/NormalizeUtils.js';

const source = readFileSync(new URL('../static/vod_song/mobile/navigation/selected/SelectedUI.js', import.meta.url), 'utf8')
  .replace('export default selectedUI;', 'globalThis.ui = selectedUI;');
const context = { window: {}, console };
vm.runInNewContext(source, context);
const ui = context.ui;
const queue = normalizePlayList({ code: 0, message: 'success', data: [
  { songNo: '60000114', songName: '后来(MTV)', singerNames: 'Liu Ruo Ying', status: 1 },
  { songNo: '60000543', songName: '我怀念的(MTV)', singerNames: '孙燕姿', status: 0 }
] });

test('selected queue renders canonical API titles and singers without legacy aliases', () => {
  for (const type of ['selected', 'sung']) {
    const html = ui.renderSelectedSongsList(queue, type);
    for (const song of queue) {
      assert.ok(html.includes(song.songName));
      assert.ok(html.includes(song.singerNames));
      assert.ok(html.includes(`data-song-id="${song.songNo}"`));
    }
    assert.doesNotMatch(html, /未知歌曲|未知歌手/);
  }
});

test('played queue uses the same canonical metadata', async () => {
  const list = { innerHTML: '' };
  context.window.navSelectedService = { getPlayedList: async () => queue };
  await ui._loadSungList({ querySelector: selector => selector === '.song-list' ? list : null });
  for (const song of queue) {
    assert.ok(list.innerHTML.includes(song.songName));
    assert.ok(list.innerHTML.includes(song.singerNames));
  }
  assert.doesNotMatch(list.innerHTML, /未知歌曲|未知歌手/);
});

test('empty metadata retains explicit fallback labels', () => {
  const html = ui.renderSelectedSongsList([{ songNo: 'empty' }]);
  assert.match(html, /未知歌曲/);
  assert.match(html, /未知歌手/);
});
