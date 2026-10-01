import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
  clear() { storage.clear(); }
};
globalThis.window = {
  AppConfig: {
    interactionServer: {
      baseUrl: '/api/v1/interaction/proxy',
      guestCode: 'guest-code'
    }
  },
  location: { href: 'http://localhost/static/vod_song/mobile/index.html' }
};

const { InteractionService } = await import('../modules/interaction/InteractionService.js');
const { InteractionUI, mapTemplateItem, getOrderStatusText } = await import('../../mobile/modules/interaction/InteractionUI.js');

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => typeof payload === 'string' ? payload : JSON.stringify(payload)
  };
}

function success(result) {
  return { code: 200, type: 'success', message: '', result };
}

function createService() {
  storage.clear();
  return new InteractionService();
}

test('guest login extracts only result.accessToken and stores it', async () => {
  const service = createService();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return response(success({ accessToken: 'token-123', refreshToken: 'refresh', msg: '游客登录' }));
  };

  assert.equal(await service.guestLogin(), 'token-123');
  assert.equal(storage.get('interaction_auth_token'), 'token-123');
  assert.equal(requests[0].url, '/api/v1/interaction/proxy/user/guestlogin?code=guest-code');
  assert.equal(requests[0].options.method, 'GET');
});

test('guest login rejects undocumented token shapes and clears stale token', async () => {
  const service = createService();
  storage.set('interaction_auth_token', 'stale-token');
  globalThis.fetch = async () => response(success({ token: 'legacy-token' }));

  await assert.rejects(() => service.guestLogin(), /result\.accessToken/);
  assert.equal(storage.has('interaction_auth_token'), false);
});

test('business and HTTP failures are rejected instead of treated as success', async () => {
  const service = createService();
  globalThis.fetch = async () => response({
    code: 401,
    type: 'error',
    message: '401 登录已过期，请重新登录',
    result: null
  });
  await assert.rejects(() => service.getTemplateList(), /登录已过期/);

  globalThis.fetch = async () => response('Bad Gateway', { ok: false, status: 502 });
  await assert.rejects(() => service.getTemplateList(), /HTTP 502/);
});

test('template endpoint and query fields map one-to-one', async () => {
  const service = createService();
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return response(success({
      page: 2,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      items: [{ id: 'T1' }],
      hasPrevPage: true,
      hasNextPage: false
    }));
  };

  const result = await service.getTemplateList(2, 'code_media_videotempletetype_3');
  assert.equal(
    request.url,
    '/api/v1/interaction/proxy/uConfig/GetListV2?source=templete&page=2&type=code_media_type_video&code=code_media_videotempletetype_3'
  );
  assert.equal(request.options.method, 'GET');
  assert.deepEqual(result.items, [{ id: 'T1' }]);
});

test('template image upload uses the exact multipart endpoint and result.url', async () => {
  const service = createService();
  storage.set('interaction_auth_token', 'bearer-token');
  const file = new Blob(['image'], { type: 'image/png' });
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return response(success({ url: 'https://res.eu14.cn/aevideo/test.png' }));
  };

  assert.equal(
    await service.uploadTemplateImage(file),
    'https://res.eu14.cn/aevideo/test.png'
  );
  assert.equal(request.url, '/api/v1/interaction/proxy/uMediaTemplet/UploadTempleteImg');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer bearer-token');
  assert.equal(Object.hasOwn(request.options.headers, 'Content-Type'), false);
  assert.ok(request.options.body instanceof FormData);
  const uploadedFile = request.options.body.get('file');
  assert.equal(uploadedFile.size, file.size);
  assert.equal(uploadedFile.type, file.type);
});

test('member and order list use the exact bearer token and result contract', async () => {
  const service = createService();
  storage.set('interaction_auth_token', 'bearer-token');
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/uWallet/GetMemberInfo')) {
      return response(success({ isVip: false, point: 0, videoPoint: 0 }));
    }
    return response(success({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
      items: [],
      hasPrevPage: false,
      hasNextPage: false
    }));
  };

  assert.deepEqual(await service.getMemberInfo(), { isVip: false, point: 0, videoPoint: 0 });
  assert.deepEqual((await service.getOrderList(1)).items, []);
  assert.deepEqual(requests.map(item => ({
    url: item.url,
    authorization: item.options.headers.Authorization
  })), [
    {
      url: '/api/v1/interaction/proxy/uWallet/GetMemberInfo',
      authorization: 'Bearer bearer-token'
    },
    {
      url: '/api/v1/interaction/proxy/UMediaOrder/OrderList?page=1&code=code_media_type_video',
      authorization: 'Bearer bearer-token'
    }
  ]);
});

test('add order sends only the seven documented fields', async () => {
  const service = createService();
  storage.set('interaction_auth_token', 'bearer-token');
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return response(success({ orderNo: 'O1' }));
  };

  const payload = {
    JobParam: '{"Text0":"测试"}',
    TempleteId: 'aab3d30862854821b397d35fc83a92a6',
    TempleteICENo: 'aab3d30862854821b397d35fc83a92a6',
    TempleteName: '乔迁之喜乔迁宴邀请函',
    JobName: '乔迁之喜乔迁宴邀请函',
    TempleteType: 'code_media_type_video',
    Remark: '',
    unused: 'must-not-be-sent'
  };

  assert.deepEqual(await service.addOrder(payload), { orderNo: 'O1' });
  assert.equal(request.url, '/api/v1/interaction/proxy/UMediaOrder/AddOrder');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer bearer-token');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.options.body), {
    JobParam: payload.JobParam,
    TempleteId: payload.TempleteId,
    TempleteICENo: payload.TempleteICENo,
    TempleteName: payload.TempleteName,
    JobName: payload.JobName,
    TempleteType: payload.TempleteType,
    Remark: payload.Remark
  });
});

test('template item mapping follows the real GetListV2 fields exactly', () => {
  const template = mapTemplateItem({
    id: '44881718490437',
    title: '乔迁之喜乔迁宴邀请函',
    coverImage: 'https://example.com/cover.jpg',
    mainImage: 'https://example.com/main.jpg',
    resVUrl: 'http://example.com/video.mp4',
    no: 'ice-no',
    no2: 'must-not-be-used',
    templeteType: 'code_media_type_video',
    clipsParamExt: JSON.stringify({
      clips_param: [
        { key: 'Text0', type: 'text', maxLength: '5', value: '乔迁宴' },
        { key: 'Text4', type: 'text', maxLength: '250', value: '邀请内容' }
      ],
      other_params: { 'Text0.font_file': 'FZHei-B01S' }
    })
  });

  assert.deepEqual(template, {
    id: '44881718490437',
    name: '乔迁之喜乔迁宴邀请函',
    thumbnail: 'https://example.com/cover.jpg',
    videoUrl: 'http://example.com/video.mp4',
    iceNo: 'ice-no',
    type: 'code_media_type_video',
    params: [
      { key: 'Text0', label: 'Text0', default: '乔迁宴', type: 'text' },
      { key: 'Text4', label: 'Text4', default: '邀请内容', type: 'textarea' }
    ],
    otherParams: { 'Text0.font_file': 'FZHei-B01S' }
  });
});

test('template item maps the upstream empty-string other_params to no extra parameters', () => {
  const template = mapTemplateItem({
    id: '41479533295941',
    title: '情人节告白',
    coverImage: 'https://example.com/cover.jpg',
    resVUrl: 'http://example.com/video.mp4',
    no: 'ice-no',
    templeteType: 'code_media_type_video',
    clipsParamExt: JSON.stringify({
      clips_param: [{ key: 'Media0', type: 'mediaId', maxLength: '', value: '' }],
      other_params: ''
    })
  });

  assert.deepEqual(template.otherParams, {});
  assert.deepEqual(template.params, [
    { key: 'Media0', label: 'Media0', default: '', type: 'media' }
  ]);
});

test('template item falls back to clipsParam when clipsParamExt is null', () => {
  const template = mapTemplateItem({
    id: '39131283782981',
    title: '新年快乐烟花版04',
    coverImage: 'https://example.com/cover.jpg',
    resVUrl: 'https://example.com/video.mp4',
    no: '8ef3ee1120f143dea03704657f84d2ae',
    templeteType: 'code_media_type_video',
    clipsParam: JSON.stringify({ Text0: '荟视定制', Text1: '助力品牌传递', Media0: '' }),
    clipsParamExt: null
  });

  assert.deepEqual(template.params.map(({ key, type }) => ({ key, type })), [
    { key: 'Text0', type: 'text' },
    { key: 'Text1', type: 'text' },
    { key: 'Media0', type: 'media' }
  ]);
});

test('submitted order matching supports AddOrder result and job name fallback', () => {
  const ui = new InteractionUI();
  const orders = [
    { orderNo: 'O2', jobName: '另一个任务', jobStatus: 'code_media_jobstatus_processing' },
    { orderNo: 'O1', jobName: '乔迁之喜乔迁宴邀请函', jobStatus: 'code_media_jobstatus_success', url: 'https://example.com/video.mp4' }
  ];

  assert.equal(ui.findSubmittedOrder(orders, { result: { orderNo: 'O1' } }), orders[1]);
  assert.equal(ui.findSubmittedOrder(orders, {
    result: null,
    jobName: '乔迁之喜乔迁宴邀请函'
  }), orders[1]);
});

test('order status uses the documented jobStatus codes', () => {
  assert.equal(getOrderStatusText('code_media_jobstatus_queuing'), '排队中');
  assert.equal(getOrderStatusText('code_media_jobstatus_success'), '成功');
  assert.equal(getOrderStatusText('unknown'), '制作中');
});
