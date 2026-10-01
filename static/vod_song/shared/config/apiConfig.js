// KTV/VOD 统一配置：单端口 8080，通过路径 /ktv、/vod 区分 UI，后台与数据解析在 shared 统一处理
// 说明：下方 getClientIp/getServerIp 等返回的是「要连接的服务器地址」(WebSocket/API 的 host)。
//       优先使用当前页面所在主机（如 http://192.168.1.28:8080/... 则连 28）；URL 中的 IP 参数仅供服务端做房间解析用。
window.AppConfig = window.AppConfig || {};

// ========== 默认 IP 配置（唯一配置点） ==========
// 修改此处即可更改整个系统的默认 IP
var DEFAULT_IP = '192.168.1.28';
// 暴露到全局，供其他模块使用
window.DEFAULT_IP = DEFAULT_IP;
window.AppConfig.defaultIp = DEFAULT_IP;
// ===============================================

function isLocalHost(hostname) {
  return !hostname || hostname === 'localhost' || hostname === '127.0.0.1';
}

function isValidIpv4(str) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(str);
}

function withinRange(ip) {
  return ip.split('.').map(Number).every(function (num) { return num >= 0 && num <= 255; });
}

function getUrlParamServerIp() {
  try {
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      var search = window.location.search.substring(1);
      if (!search) return null;
      var searchParams = new URLSearchParams(search);
      var ip = searchParams.get('A') || searchParams.get('a') || searchParams.get('host') || searchParams.get('server');
      if (ip && isValidIpv4(ip) && withinRange(ip)) return ip;
      var first = search.split('&')[0];
      if (first && first.indexOf('=') === -1 && isValidIpv4(first) && withinRange(first)) return first;
    }
  } catch (e) {}
  return null;
}

// 移动端历史链接使用 `?192.168.x.x` 传递终端地址，新链接使用
// `?roomId=...`。两种形式都表示点歌目标房间，必须由所有客户端入口统一解析。
function getUrlParamRoomId() {
  try {
    if (typeof window === 'undefined' || !window.location || !window.location.search) return null;
    var search = window.location.search.substring(1);
    if (!search) return null;

    var searchParams = new URLSearchParams(search);
    var explicit = searchParams.get('roomId');
    if (explicit && explicit.trim()) return explicit.trim();

    var first = search.split('&')[0];
    if (first && first.indexOf('=') === -1) {
      var legacy = decodeURIComponent(first).trim();
      if (legacy && isValidIpv4(legacy) && withinRange(legacy)) return legacy;
    }
  } catch (e) {}
  return null;
}

function getServerIp() {
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    var hostname = window.location.hostname;
    if (hostname && !isLocalHost(hostname) && isValidIpv4(hostname)) return hostname;
  }
  if (typeof localStorage !== 'undefined') {
    var songServerIp = localStorage.getItem('songServerIp');
    if (songServerIp && isValidIpv4(songServerIp) && withinRange(songServerIp)) return songServerIp;
    var clientIp = localStorage.getItem('clientIp');
    if (clientIp && isValidIpv4(clientIp)) return clientIp;
  }
  var urlIp = getUrlParamServerIp();
  if (urlIp) return urlIp;
  return DEFAULT_IP;
}

function getSongServerIp() {
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    var hostname = window.location.hostname;
    if (hostname && !isLocalHost(hostname) && isValidIpv4(hostname)) return hostname;
  }
  if (typeof localStorage !== 'undefined') {
    var songServerIp = localStorage.getItem('songServerIp');
    if (songServerIp && isValidIpv4(songServerIp)) return songServerIp;
    var clientIp = localStorage.getItem('clientIp');
    if (clientIp && isValidIpv4(clientIp)) return clientIp;
  }
  var urlIp = getUrlParamServerIp();
  if (urlIp) return urlIp;
  return DEFAULT_IP;
}

function getCashierServerIp() {
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    var hostname = window.location.hostname;
    if (hostname && !isLocalHost(hostname) && isValidIpv4(hostname) && withinRange(hostname)) return hostname;
  }
  if (typeof localStorage !== 'undefined') {
    var cashierServerIp = localStorage.getItem('cashierServerIp');
    if (cashierServerIp && isValidIpv4(cashierServerIp) && withinRange(cashierServerIp)) return cashierServerIp;
    var clientIp = localStorage.getItem('clientIp');
    if (clientIp && isValidIpv4(clientIp) && withinRange(clientIp)) return clientIp;
  }
  var urlIp = getUrlParamServerIp();
  if (urlIp) return urlIp;
  return DEFAULT_IP;
}

function getClientIp() {
  // 1. 优先尝试从本页 URL 解析目标房间终端 IP：?roomId=xxx 或 ?192.168.x.x
  try {
    var ipCandidate = getUrlParamRoomId();
    if (ipCandidate && isValidIpv4(ipCandidate) && withinRange(ipCandidate)) {
      if (typeof localStorage !== 'undefined') localStorage.setItem('clientIp', ipCandidate);
      return ipCandidate;
    }
  } catch (e) {
    console.warn('解析URL参数获取ClientIp时出错:', e);
  }

  // 2. 其次尝试从 localStorage 获取（上次成功访问的 ID）
  if (typeof localStorage !== 'undefined') {
    var storedIp = localStorage.getItem('clientIp');
    if (storedIp && isValidIpv4(storedIp) && withinRange(storedIp)) return storedIp;
  }

  // 3. 最后使用当前页面所在主机（针对普通 PC 访问或调试）
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    var hostname = window.location.hostname;
    if (hostname && !isLocalHost(hostname) && isValidIpv4(hostname) && withinRange(hostname)) {
      return hostname;
    }
  }

  return DEFAULT_IP;
}

function getWebSocketHost() {
  // 优先使用当前页面的hostname，与API请求保持一致
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    var hostname = window.location.hostname;
    if (hostname && !isLocalHost(hostname) && isValidIpv4(hostname) && withinRange(hostname)) {
      return hostname;
    }
  }
  
  // 如果是localhost或无效IP，使用getClientIp的逻辑
  return getClientIp();
}

var clientIp = getClientIp();
var webSocketHost = getWebSocketHost();
var singerImgServerIp = getServerIp();

// WebSocket 使用与 HTTP API 相同的端口 (8080)，路径为 /ws/:terminalId
// 确保WebSocket和API使用相同的服务器地址
// 在 Capacitor 环境中，WebSocket 也需要使用完整的服务器 IP
var isCapacitor = typeof window !== 'undefined' && window.Capacitor !== undefined;
if (isCapacitor) {
  // Capacitor 环境：WebSocket 使用配置的服务器 IP
  webSocketHost = getServerIp();
}

window.AppConfig.websocket = { host: webSocketHost, port: '9898', path: '/ws' };
window.AppConfig.currentEnv = 'production';

var PORT = (typeof window !== 'undefined' && window.location && window.location.port)
  ? (parseInt(window.location.port, 10) || 9898)
  : 9898;

// 可选：两页数据一致时需请求同一歌曲后端。二选一：songApiBaseUrl 完整地址，或 songApiPort（与 getSongServerIp 拼成地址，仅 8088/8080 时生效）
var songApiBaseUrl = null;
if (typeof window !== 'undefined' && window.AppConfig) {
  if (typeof window.AppConfig.songApiBaseUrl === 'string')
    songApiBaseUrl = window.AppConfig.songApiBaseUrl.replace(/\/+$/, '');
  else if (window.AppConfig.songApiPort != null && window.location && window.location.port === '8080')
    songApiBaseUrl = window.location.protocol + '//' + getSongServerIp() + ':' + window.AppConfig.songApiPort + '/api/v1';
}

var config = {
  auth: { _uname: '5', clientId: '8' },
  songServer: {
    baseUrl: songApiBaseUrl || '/api/v1',
    endpoints: {
      getDictList: '/system/dicts',
      songList: '/songdb/songs',
      singerList: '/songdb/singers'
    }
  },
  // 与后台 src/api/mod.rs terminal_routes 中 /api/v1/rooms/:id/* 对齐
  mucServer: {
    baseUrl: '/api/v1',
    endpoints: {
      requestSong: '/rooms/:id/queue',
      youtubeQueue: '/rooms/:id/youtube/queue',
      musicBarControl: '/rooms/:id/command',
      roomState: '/rooms/:id/state',
      getPlayList: '/rooms/:id/queue',
      playNext: '/rooms/:id/next',
      getVodConfig: '/rooms/:id/config',
      setTargetLayer: '/rooms/:id/config',
      upWord: '/rooms/:id/queue/prioritize',
      delete: '/rooms/:id/queue/:songNo',
      shufflePlay: '/rooms/:id/queue/shuffle',
      clear: '/rooms/:id/clear',
      getClassifyList: '/materials/categories',
      getMaterialList: '/materials',
      playMaterial: '/rooms/:id/materials/play',
      clickButton: '/rooms/:id/peripheral/button',
      controlVoice: '/rooms/:id/peripheral/voice',
      getSetting: '/rooms/:id/settings',
      getStreamList: '/streams',
      getPlayLive: '/rooms/:id/streams/play',
      getStopLive: '/rooms/:id/streams/stop'
    }
  },
  cashierServer: {
    host: getCashierServerIp(),
    baseUrl: '/api/v1',
    port2800Url: '/api/v1',
    endpoints: {
      drinkCategory: '/products/categories',
      drinkCategoryFree: '/products/categories/free',
      getDrinks: '/products',
      comboGroup: '/products/combos',
      comboGroupDetail: '/products/combos/:id/items',
      specialTaste: '/products/tastes',
      submitOrder: '/orders',
      billInfo: '/orders/bill',
      consumptionDetail: '/orders/:id/detail',
      waiterLogin: '/auth/waiter/login',
      roomList: '/rooms',
      roomControl: '/rooms/:id/control',
      roomNotice: '/rooms/:id/message',
      serviceBell: '/rooms/:id/service/bell',
      serviceBellResponse: '/rooms/:id/service/response',
      serviceBellClose: '/rooms/:id/service/cancel',
      qrcodeBuyDrinks: '/orders/qrcode',
      adList: '/marketing/ads',
      prList: '/pr/staff',
      prCateCount: '/pr/groups/stats',
      prCateInfo: '/pr/groups',
      prCheckInDetail: '/pr/records',
      prFlowerList: '/pr/flowers',
      prService: '/pr/service',
      prPurchase: '/pr/orders',
      prCall: '/rooms/:id/peripheral/call'
    }
  },
  singerImgServer: {
    host: singerImgServerIp,
    baseUrl: '',
    imagePath: '/api/v1/artists/:id/image',
    getUrl: function (singerNo) {
      return '/api/v1/artists/' + encodeURIComponent(singerNo) + '/image';
    }
  },
  port: PORT,
  debug: false,
  settings: { maxRetryCount: 3, timeout: 10000 },
  vod: { targetLayerId: 1 },
  interactionServer: {
    baseUrl: '/api/v1/interaction/proxy',
    guestCode: '8a4d9f87a6b74cdc0e4c3ba1f48c9b83'
  }
};

function getVodTargetLayerId() {
  if (typeof localStorage !== 'undefined') {
    var stored = localStorage.getItem('vodTargetLayerId');
    if (stored !== null && stored !== '') {
      var num = parseInt(stored, 10);
      if (!isNaN(num) && num >= 1 && num <= 99) return num;
    }
  }
  return (config.vod && typeof config.vod.targetLayerId === 'number')
    ? config.vod.targetLayerId
    : (config.vod && typeof config.vod.targetLayerId === 'string' ? parseInt(config.vod.targetLayerId, 10) : 1) || 1;
}

var serverIp = getServerIp();

if (isCapacitor) {
  // Capacitor 环境：使用完整 URL
  config.mucServer.baseUrl = 'http://' + serverIp + ':9898/api/v1';
  config.songServer.baseUrl = 'http://' + serverIp + ':9898/api/v1';
  config.cashierServer.baseUrl = 'http://' + getCashierServerIp() + ':9898/api/v1';
  config.singerImgServer.baseUrl = 'http://' + singerImgServerIp + ':9898';
  config.interactionServer.baseUrl = 'http://' + serverIp + ':9898/api/v1/interaction/proxy';
}

var apiConfig = {
  baseUrl: config.mucServer.baseUrl,
  endpoints: config.mucServer.endpoints,
  auth: config.auth
};

window.AppConfig.apiConfig = apiConfig;
window.AppConfig.config = config;
window.AppConfig.getRoomIdFromUrl = getUrlParamRoomId;
window.AppConfig.getVodTargetLayerId = getVodTargetLayerId;
window.AppConfig.api = { development: { baseUrl: config.mucServer.baseUrl, endpoints: config.mucServer.endpoints } };
window.apiConfig = apiConfig;
window.AppConfig.mucServer = config.mucServer;
window.AppConfig.cashierServer = config.cashierServer;
window.AppConfig.singerImgServer = config.singerImgServer;
window.AppConfig.songServer = config.songServer;
window.AppConfig.interactionServer = config.interactionServer;

(function () {
  // 歌星图片通过同源 API /api/v1/artists/:id/image 提供，无需探测
})();
