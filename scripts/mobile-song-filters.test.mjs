import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const singerSource = read('../static/vod_song/mobile/modules/singers/SingerUI.js')
  .replace(/^import .+;$/gm, '').replace('export function singerFilterOptions', 'function singerFilterOptions')
  .replace('export default singerUI;', 'globalThis.ui = singerUI; globalThis.options = singerFilterOptions;');
const singer = { window: {}, console };
vm.runInNewContext(singerSource, singer);

test('singer dictionaries use server codes, show visible entries, and recover fully hidden legacy groups', () => {
  const rows = [
    { dictGroup: 'region', dictCode: '16', dictName: '欧美', visible: 0, sortOrder: 16 },
    { dictGroup: 'region', dictCode: '0', dictName: '其他', visible: 0, sortOrder: 99 },
    { dictGroup: 'region', dictCode: '7', dictName: '日本', visible: 0, sortOrder: 7 },
    { dictGroup: 'sex', dictCode: '1', dictName: '男', visible: 1, sortOrder: 1 }
  ];
  assert.equal(JSON.stringify(singer.options(rows, 'region')), JSON.stringify([
    { code: '', name: '全部' }, { code: '7', name: '日本' },
    { code: '16', name: '欧美' }, { code: '0', name: '其他' }
  ]));
  rows[0].visible = 1;
  assert.equal(JSON.stringify(singer.options(rows, 'region')), JSON.stringify([
    { code: '', name: '全部' }, { code: '16', name: '欧美' }
  ]));
  assert.deepEqual(Object.keys(singer.ui.currentFilters).sort(), ['regionCode', 'sexCode']);
});

test('song selectors preserve Chinese and show the current translation without duplicate Chinese', () => {
  const buttons = new Map(['songname-selector', 'language-selector', 'classify-selector', 'indonesian-songs-btn'].map(id => [id, {
    children: [], replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); }
  }]));
  let language = 'en_us';
  const tables = {
    en_us: JSON.parse(read('../static/vod_song/shared/services/LangService/en_us.json')),
    id_id: JSON.parse(read('../static/vod_song/shared/services/LangService/id_di.json')),
    vi_vn: JSON.parse(read('../static/vod_song/shared/services/LangService/vi_vn.json')),
    zh_cn: JSON.parse(read('../static/vod_song/shared/services/LangService/cn_zh.json'))
  };
  const context = {
    window: { langService: { getCurrentLanguage: () => language, t: key => tables[language][key] } },
    document: { addEventListener() {}, createElement: () => ({}) }
  };
  const source = read('../static/vod_song/mobile/modules/songs/songTopUI.js')
    .replace('export default songTopUI;', 'globalThis.ui = songTopUI;');
  vm.runInNewContext(source, context);
  context.ui.modal = { querySelector: selector => buttons.get(selector.slice(1)) };
  for (language of ['en_us', 'id_id', 'vi_vn', 'zh_cn', 'en_us']) {
    context.ui.updateSelectorLabels();
    for (const [id, chinese, key] of [
      ['songname-selector', '歌名', 'songName'], ['language-selector', '语种', 'language'],
      ['classify-selector', '分类', 'classify'], ['indonesian-songs-btn', '印尼歌曲', 'indonesianSongs']
    ]) {
      const children = buttons.get(id).children;
      assert.equal(children[0].textContent, chinese);
      assert.equal(children.length, language === 'zh_cn' ? 1 : 2);
      if (children[1]) assert.equal(children[1].textContent, tables[language][key]);
    }
  }
});
