import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { location: { search: '' }, AppConfig: {}, addEventListener() {} };
globalThis.document = { addEventListener() {} };
const { default: songs } = await import('../modules/songs/SongService.js');
const { default: DomUtils } = await import('../utils/DomUtils.js');

test('reopening PAD new songs fetches current library despite stale first-page cache', async () => {
  let requests = 0;
  let cachedReads = 0;
  DomUtils.getCacheService = () => ({
    getCachedData() { cachedReads++; return [{ songNo: 'old' }]; },
    setCachedData() {}
  });
  songs._logService = { info() {}, warn() {}, error() {}, debug() {} };
  songs.apiService = {
    async getSongList(params) {
      requests++;
      assert.equal(String(params.categoryCode), '1');
      return { code: 0, message: 'success', data: { items: [{ songNo: '80000101', songName: 'New', categoryCode: '16' }], total: 1, page: 1, pageSize: 20 } };
    }
  };
  for (const categoryCode of ['1', 1]) {
    const result = await songs.loadSongsByMode('category', { categoryCode }, 1, 20);
    assert.equal(result.list[0].songNo, '80000101');
    assert.equal(result.totalSize, 1);
  }
  assert.equal(requests, 2);
  assert.equal(cachedReads, 0);
});
