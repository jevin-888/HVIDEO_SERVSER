import test from 'node:test';
import assert from 'node:assert/strict';

const { normalizeSongsList } = await import('../utils/NormalizeUtils.js');

test('song singer mapping follows the song API contract', () => {
  const [song] = normalizeSongsList([{
    songNo: '60000114',
    songName: '??(MTV)',
    singerNames: 'Liu Ruo Ying',
    primarySingerName: '???',
    primarySingerNo: '2031'
  }]);

  assert.equal(song.singerNames, 'Liu Ruo Ying');
  assert.equal(song.singerName, 'Liu Ruo Ying');
  assert.equal(song.primarySingerNo, '2031');
  assert.equal(song.singerNo, '2031');
});

test('blank singerNames falls back only to the documented primary singer field', () => {
  const [song] = normalizeSongsList([{
    songNo: '60000114',
    songName: '??(MTV)',
    singerNames: '   ',
    primarySingerName: '???',
    primarySingerNo: '2031',
    artistName: 'legacy artist',
    singerName: 'legacy singer'
  }]);

  assert.equal(song.singerNames, '???');
  assert.equal(song.singerName, '???');
});

test('non-contract legacy singer fields are not consumed', () => {
  const [song] = normalizeSongsList([{
    songNo: 'S001',
    songName: 'Test',
    artistName: 'legacy artist',
    singerName: 'legacy singer',
    singerNo: 'legacy-no'
  }]);

  assert.equal(song.singerNames, '');
  assert.equal(song.singerName, '');
  assert.equal(song.primarySingerNo, '');
  assert.equal(song.singerNo, '');
});
