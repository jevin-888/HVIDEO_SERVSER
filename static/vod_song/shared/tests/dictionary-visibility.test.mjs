import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map([['ktv:dict:payload', JSON.stringify({ version: 1, timestamp: Date.now(), ttl: 999999, groups: {category: [{code:'13',name:'戏曲'}]} })]]);
globalThis.localStorage = {getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key)};
globalThis.window = {localStorage, location: {hostname:'test',search:''}, AppConfig:{}};
const {default: cache} = await import('../services/CacheService.js');
const {default: api} = await import('../core/ApiService.js');

test('PAD filters hidden dictionaries and maps server classify to category without restoring legacy cache', async () => {
  assert.equal(storage.has('ktv:dict:payload'),false);
  api.getDictList = async () => ({code:0,message:'success',data:[
    {dictGroup:'classify',dictCode:'13',dictName:'戏曲',visible:0},
    {dictGroup:'classify',dictCode:'0',dictName:'其他',visible:0},
    {dictGroup:'classify',dictCode:'16',dictName:'流行金曲',visible:1},
    {dictGroup:'language',dictCode:'1',dictName:'国语',visible:1}
  ]});
  await cache.fetchAndCacheDictAll();
  assert.deepEqual((await cache.getDict('category')).map(x=>x.code),['16']);
  assert.deepEqual((await cache.getDict('language')).map(x=>x.code),['1']);
  assert.equal(JSON.parse(storage.get('ktv:dict:payload')).version,2);
  api.getDictList = async () => ({code:0,message:'success',data:[{dictGroup:'classify',dictCode:'13',dictName:'戏曲',visible:0}]});
  await cache.fetchAndCacheDictAll();
  assert.deepEqual(await cache.getDict('category'),[]);
});
