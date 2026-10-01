import interactionService from '../../../shared/modules/interaction/InteractionService.js?v=20260903-interaction-submit';
import logService from '../../../shared/services/LogService.js';
import toastService from '../../../shared/services/ToastService.js';

const CATEGORY_CODES = Object.freeze({
  '\u5168\u90e8': '',
  '\u70ed\u95e8\u63a8\u8350': '',
  '\u8c6a\u8f66\u63d0\u8f66': 'code_media_videotempletetype_3',
  '\u795d\u798f\u544a\u767d': 'code_media_videotempletetype_1',
  '\u9152\u5427\u5927\u5c4f': 'code_media_videotempletetype_2',
  '\u5e7f\u544a\u5ba3\u4f20': 'code_media_videotempletetype_6'
});

const ORDER_STATUS_TEXT = Object.freeze({
  code_media_jobstatus_fail: '\u5931\u8d25',
  code_media_jobstatus_init: '\u521d\u59cb\u5316',
  code_media_jobstatus_processing: '\u5904\u7406\u4e2d',
  code_media_jobstatus_queuing: '\u6392\u961f\u4e2d',
  code_media_jobstatus_success: '\u6210\u529f'
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, window.location?.href || 'http://localhost/');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch (_) {
    return '';
  }
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function buildFallbackExtension(item) {
  const sample = parseJsonObject(item.clipsParam);
  if (!sample) return null;

  const clipsParam = [];
  const otherParams = {};
  for (const [key, rawValue] of Object.entries(sample)) {
    if (key.toLocaleLowerCase() === 'remark') continue;
    if (key.endsWith('.font_file')) {
      otherParams[key] = String(rawValue ?? '');
      continue;
    }
    clipsParam.push({
      key,
      type: key.startsWith('Media') ? 'mediaId' : 'text',
      maxLength: '',
      value: String(rawValue ?? '')
    });
  }
  return { clips_param: clipsParam, other_params: otherParams };
}

function getTemplateExtension(item) {
  const extension = parseJsonObject(item.clipsParamExt);
  if (extension && Array.isArray(extension.clips_param)) return extension;
  return buildFallbackExtension(item);
}

function mapTemplateItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('\u6a21\u677f\u9879\u5fc5\u987b\u662f\u5bf9\u8c61');
  }

  for (const field of ['id', 'title', 'no', 'templeteType']) {
    if (typeof item[field] !== 'string' || !item[field].trim()) {
      throw new Error(`\u6a21\u677f\u5b57\u6bb5 ${field} \u65e0\u6548`);
    }
  }

  const extension = getTemplateExtension(item);
  if (!extension || typeof extension !== 'object' || !Array.isArray(extension.clips_param)) {
    throw new Error(`\u6a21\u677f ${item.id} \u7684 clipsParamExt.clips_param \u65e0\u6548`);
  }

  const params = extension.clips_param.map(param => {
    if (!param || typeof param.key !== 'string' || typeof param.type !== 'string') {
      throw new Error(`\u6a21\u677f ${item.id} \u5305\u542b\u65e0\u6548\u53c2\u6570`);
    }
    const maxLength = Number(param.maxLength);
    return {
      key: param.key,
      label: param.key,
      default: typeof param.value === 'string' ? param.value : '',
      type: param.type === 'mediaId'
        ? 'media'
        : param.type === 'text' && Number.isFinite(maxLength) && maxLength > 50
          ? 'textarea'
          : 'text'
    };
  });

  const rawOtherParams = extension.other_params;
  const otherParams = rawOtherParams === undefined || rawOtherParams === '' ? {} : rawOtherParams;
  if (otherParams === null || typeof otherParams !== 'object' || Array.isArray(otherParams)) {
    throw new Error(`\u6a21\u677f ${item.id} \u7684 clipsParamExt.other_params \u65e0\u6548`);
  }

  return {
    id: item.id,
    name: item.title,
    thumbnail: typeof item.coverImage === 'string' ? item.coverImage : '',
    videoUrl: typeof item.resVUrl === 'string' ? item.resVUrl : '',
    iceNo: item.no,
    type: item.templeteType,
    params,
    otherParams: { ...otherParams }
  };
}

function getOrderStatusText(jobStatus) {
  return ORDER_STATUS_TEXT[jobStatus] || '\u5236\u4f5c\u4e2d';
}

class InteractionUI {
  constructor() {
    this.modal = null;
    this.currentCategory = '全部';
    this.categories = ['全部', '热门推荐', '豪车提车', '祝福告白', '酒吧大屏', '广告宣传'];
    this.apiTemplates = [];
    this.searchQuery = '';
    this.orderPollTimer = null;
    this.recordsRequestId = 0;
  }

  /**
   * 初始化交互模态框
   */
  initModal() {
    if (this.modal) return;

    this.modal = document.createElement('div');
    this.modal.id = 'interaction-modal';
    this.modal.className = 'fixed inset-0 z-[10006] hidden opacity-0 transition-opacity duration-300 bg-[#121212] flex flex-col';

    this.modal.innerHTML = `
      <!-- 头部导航 -->
      <header class="flex items-center justify-between px-4 py-3 bg-[#1a1a1a] text-white flex-shrink-0">
        <button class="close-interaction-modal p-2 -ml-2">
          <i class="fas fa-chevron-left text-xl"></i>
        </button>
        <h1 class="text-lg font-bold">视频合成</h1>
        <div class="flex items-center gap-4">
          <i class="fas fa-ellipsis-h text-lg"></i>
          <i class="fas fa-dot-circle text-lg"></i>
        </div>
      </header>

      <!-- 可滚动主内容区 -->
      <div class="flex-1 overflow-y-auto bg-[#121212] flex flex-col pb-20" id="interaction-scroll-area">
        <!-- 搜索栏 -->
        <div class="px-4 py-3 bg-[#1a1a1a]">
          <div class="flex items-center gap-2 bg-[#2a2a2a] rounded-full pl-4 pr-1 py-1">
            <i class="fas fa-search text-gray-400 text-sm"></i>
            <input type="text" placeholder="请输入关键字搜索" class="flex-1 bg-transparent border-none text-white text-sm focus:ring-0 outline-none">
            <button class="bg-[#ccff00] text-black px-6 py-1.5 rounded-full text-sm font-bold active:scale-95 transition-transform">
              搜索
            </button>
          </div>
        </div>

        <!-- 运营 Banner -->
        <div class="px-4 mt-4">
          <div class="interaction-banner relative h-44 rounded-2xl overflow-hidden bg-gradient-to-br from-[#2d2d5f] to-[#1a1a3a] border border-white/5 flex flex-col justify-center p-8">
             <div class="absolute top-0 right-0 w-32 h-32 bg-purple-500/20 blur-3xl -mr-10 -mt-10"></div>
             <h2 class="text-3xl font-black text-white mb-2 leading-tight">视频在线制作</h2>
             <p class="text-[13px] text-white/70 font-medium">极速生成你的专属高清视频 | 可保存到手机</p>
             <p class="text-[11px] text-white/50 mt-1">让每个人都能享受科技带来的便利</p>
             <div class="w-10 h-1 bg-white/20 mt-4 rounded-full"></div>
          </div>
        </div>

        <!-- 分类滑动条 -->
        <div class="mt-6 flex items-center gap-6 px-4 overflow-x-auto no-scrollbar whitespace-nowrap scroll-smooth">
          ${this.categories.map(cat => `
            <button class="category-chip text-[15px] font-medium transition-colors ${this.currentCategory === cat ? 'text-white' : 'text-gray-500'}" data-category="${cat}">
              ${cat}
            </button>
          `).join('')}
        </div>

        <!-- 模板网格 -->
        <div class="px-4 mt-6 grid grid-cols-2 gap-3" id="interaction-grid">
          ${this.renderGridItems()}
        </div>

        <!-- 表单态覆盖层 (点击模板后显示) -->
        <div id="interaction-form-overlay" class="fixed inset-0 z-50 bg-[#121212] hidden flex flex-col transform translate-x-full transition-transform duration-300">
           <!-- 表单头部 -->
           <header class="flex items-center px-4 py-3 bg-[#1a1a1a] text-white flex-shrink-0">
             <button id="back-to-grid" class="p-2 -ml-2">
               <i class="fas fa-chevron-left text-xl"></i>
             </button>
             <h1 class="flex-1 text-center font-bold text-lg mr-8" id="form-title">编辑模板</h1>
           </header>
           
           <div class="flex-1 overflow-y-auto p-6 space-y-6" id="form-fields"></div>
           
           <div class="p-6 bg-[#1a1a1a] border-t border-white/5">
             <button id="submit-interaction" class="w-full py-4 bg-[#ccff00] text-black rounded-2xl font-black text-lg shadow-xl shadow-[#ccff00]/10 active:scale-95 transition-all">
               保存并合成视频
             </button>
           </div>
        </div>
      </div>

      <!-- 悬浮按钮 (制作记录) -->
      <button id="fab-records" class="fixed bottom-24 right-6 z-[100] flex flex-col items-center gap-1 group">
         <div class="w-14 h-14 bg-[#ccff00] text-black rounded-full shadow-2xl flex items-center justify-center text-2xl group-active:scale-90 transition-transform">
           <i class="fas fa-bars"></i>
         </div>
         <span class="text-[10px] text-[#ccff00] font-bold">制作记录</span>
      </button>

      <!-- 制作记录覆盖层 -->
      <div id="interaction-records-overlay" class="fixed inset-0 z-[110] bg-[#121212] hidden flex flex-col transform translate-y-full transition-transform duration-300">
          <header class="flex items-center px-4 py-3 bg-[#1a1a1a] text-white flex-shrink-0">
             <button id="close-records" class="p-2 -ml-2">
               <i class="fas fa-chevron-down text-xl"></i>
             </button>
             <h1 class="flex-1 text-center font-bold text-lg mr-8">制作记录</h1>
          </header>
          <div class="flex-1 overflow-y-auto p-4 space-y-3" id="records-list"></div>
      </div>

      <!-- 视频预览覆盖层 (新增) -->
      <div id="interaction-preview-overlay" class="fixed inset-0 z-[120] bg-black hidden flex flex-col items-center justify-center transition-opacity duration-300 pointer-events-auto">
          <button id="close-preview" type="button" aria-label="关闭预览" class="absolute top-6 right-6 w-10 h-10 bg-black/40 backdrop-blur-md text-white rounded-full flex items-center justify-center z-[200] shadow-lg pointer-events-auto touch-manipulation">
             <i class="fas fa-times text-xl"></i>
          </button>
          <video id="preview-video" class="w-full max-h-[85vh] bg-black relative z-10" controls playsinline></video>
          <div class="mt-8 px-8 py-3 bg-[#ccff00] text-black rounded-full font-black text-sm active:scale-95 transition-transform relative z-20" id="preview-make-now">
             立即使用该素材制作
          </div>
      </div>
    `;

    document.body.appendChild(this.modal);
    this.bindEvents();
  }

  getVisibleTemplates() {
    const keyword = this.searchQuery.trim().toLocaleLowerCase();
    if (!keyword) return this.apiTemplates;
    return this.apiTemplates.filter(template => template.name.toLocaleLowerCase().includes(keyword));
  }

  renderGridItems(filtered = null) {
    const list = filtered ?? this.getVisibleTemplates();
    if (!list || list.length === 0) {
       return `<div class="col-span-2 py-20 text-center text-gray-500 text-sm">\u6682\u65e0\u7d20\u6750\u6570\u636e</div>`;
    }
    return list.map(tpl => {
      const templateId = escapeHtml(tpl.id);
      const templateName = escapeHtml(tpl.name);
      const thumbnail = escapeHtml(safeHttpUrl(tpl.thumbnail));
      const videoUrl = escapeHtml(safeHttpUrl(tpl.videoUrl));
      return `
      <div class="template-item relative aspect-[3/4] rounded-xl overflow-hidden bg-[#2a2a2a] group cursor-pointer active:scale-[0.98] transition-all" data-id="${templateId}">
        <!-- thumbnail -->
        <div class="absolute inset-0 bg-cover bg-center" style="background-image: url('${thumbnail}'); background-color: #2a2a2a;">
           <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
        </div>
        <div class="absolute top-3 left-3 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full">
           <span class="text-[10px] text-white font-medium">${templateName}</span>
        </div>
        ${videoUrl ? `
        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-active:opacity-100 transition-opacity">
           <div class="preview-btn-trigger w-12 h-12 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/30" data-video="${videoUrl}">
              <i class="fas fa-play text-white ml-1"></i>
           </div>
        </div>
        ` : ''}
        ${videoUrl ? `
        <div class="preview-btn-trigger absolute bottom-3 left-3 w-7 h-7 bg-black/40 backdrop-blur-sm rounded-lg flex items-center justify-center text-white text-[10px]" data-video="${videoUrl}">
           <i class="fas fa-play ml-0.5"></i>
        </div>
        ` : ''}
        <div class="absolute bottom-3 right-3 flex items-center gap-1 bg-[#ccff00] text-black px-2.5 py-1 rounded-lg">
           <i class="fas fa-file-export text-[10px]"></i>
           <span class="text-[10px] font-black italic">\u7acb\u5373\u5236\u4f5c</span>
        </div>
      </div>
    `;
    }).join('');
  }

  renderCurrentGrid() {
    const grid = this.modal.querySelector('#interaction-grid');
    grid.innerHTML = this.renderGridItems();
    this.bindGridItems();
  }

  bindEvents() {
    this.modal.querySelector('.close-interaction-modal').onclick = () => this.hide();

    const searchInput = this.modal.querySelector('input[placeholder="\u8bf7\u8f93\u5165\u5173\u952e\u5b57\u641c\u7d22"]');
    const searchButton = searchInput?.parentElement?.querySelector('button');
    const runSearch = () => {
      this.searchQuery = searchInput?.value || '';
      this.renderCurrentGrid();
    };
    if (searchButton) searchButton.onclick = runSearch;
    if (searchInput) {
      searchInput.onkeydown = event => {
        if (event.key === 'Enter') runSearch();
      };
    }

    this.modal.querySelectorAll('.category-chip').forEach(chip => {
      chip.onclick = () => {
        const category = chip.dataset.category;
        this.currentCategory = category;
        this.searchQuery = '';
        if (searchInput) searchInput.value = '';
        this.modal.querySelectorAll('.category-chip').forEach(item => item.classList.replace('text-white', 'text-gray-500'));
        chip.classList.replace('text-gray-500', 'text-white');
        this.loadTemplates(1, CATEGORY_CODES[category] ?? '');
      };
    });

    this.modal.querySelector('#fab-records').onclick = () => this.showRecords();
    this.bindGridItems();
  }

  async loadTemplates(page = 1, code = CATEGORY_CODES[this.currentCategory] ?? '') {
    const grid = this.modal.querySelector('#interaction-grid');
    grid.innerHTML = `
      <div class="col-span-2 flex flex-col items-center justify-center py-20">
        <div class="animate-spin rounded-full h-8 w-8 border-2 border-[#ccff00] border-t-transparent mb-4"></div>
        <p class="text-[11px] text-gray-500">\u6b63\u5728\u641c\u7d22\u83b7\u53d6\u6700\u65b0\u4e92\u52a8\u7d20\u6750...</p>
      </div>
    `;

    try {
      const pageResult = await interactionService.getTemplateList(page, code);
      const templates = [];
      for (const item of pageResult.items) {
        try {
          templates.push(mapTemplateItem(item));
        } catch (error) {
          logService.warn('[InteractionUI] invalid template ignored:', error);
        }
      }
      this.apiTemplates = templates;
      this.renderCurrentGrid();
    } catch (error) {
      logService.error('[InteractionUI] load templates failed:', error);
      grid.innerHTML = `<div class="col-span-2 py-20 text-center text-red-500/50 text-xs">\u52a0\u8f7d\u5931\u8d25: ${escapeHtml(error.message)}</div>`;
    }
  }

  showPreview(videoUrl, template) {
    const overlay = this.modal.querySelector('#interaction-preview-overlay');
    const video = overlay.querySelector('#preview-video');
    const makeBtn = overlay.querySelector('#preview-make-now');

    video.src = videoUrl;
    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('opacity-100');
    video.play().catch(e => logService.warn('Auto play failed', e));

    const closePreview = (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
      overlay.classList.remove('opacity-100');
      overlay.classList.add('hidden');
    };

    const closeBtn = overlay.querySelector('#close-preview');
    closeBtn.onclick = closePreview;
    overlay.onclick = (event) => {
      if (event.target === overlay) closePreview(event);
    };
    video.onclick = (event) => event.stopPropagation();

    makeBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      video.pause();
      video.removeAttribute('src');
      video.load();
      overlay.classList.remove('opacity-100');
      overlay.classList.add('hidden');
      this.showForm(template);
    };
  }

  bindGridItems() {
    this.modal.querySelectorAll('.template-item').forEach(item => {
      const tpl = this.apiTemplates.find(t => t.id === item.dataset.id);
      if (!tpl) return;

      // 预览逻辑
      const previewButton = item.querySelector(':scope > .preview-btn-trigger');
      if (previewButton) {
        previewButton.onclick = (event) => {
          event.stopPropagation();
          this.showPreview(tpl.videoUrl, tpl);
        };
      }

      // 制作逻辑
      item.onclick = () => {
        this.showForm(tpl);
      };
    });
  }

  showForm(template) {
    const overlay = this.modal.querySelector('#interaction-form-overlay');
    const fieldsContainer = overlay.querySelector('#form-fields');
    const title = overlay.querySelector('#form-title');

    title.innerText = template.name;
    fieldsContainer.innerHTML = template.params.map(param => {
      const key = escapeHtml(param.key);
      const label = escapeHtml(param.label);
      const defaultValue = escapeHtml(param.default);
      return `
      <div class="space-y-3">
        <label class="text-[13px] font-bold text-gray-500 ml-1 uppercase tracking-wider">${label}</label>
        ${param.type === 'textarea'
          ? `<textarea data-key="${key}" rows="5" class="w-full bg-[#1a1a1a] border border-white/5 rounded-2xl px-5 py-4 text-white text-[15px] focus:ring-2 ring-[#ccff00]/20 focus:border-[#ccff00]/40 transition-all outline-none">${defaultValue}</textarea>`
          : param.type === 'media'
            ? `<input type="text" data-key="${key}" data-param-type="media" value="${defaultValue}" readonly class="w-full h-14 bg-[#1a1a1a] border border-white/5 rounded-2xl px-5 text-white text-[15px] focus:ring-2 ring-[#ccff00]/20 focus:border-[#ccff00]/40 transition-all outline-none">
               <input type="file" data-upload-key="${key}" accept="image/*" class="hidden">`
            : `<input type="text" data-key="${key}" value="${defaultValue}" class="w-full h-14 bg-[#1a1a1a] border border-white/5 rounded-2xl px-5 text-white text-[15px] focus:ring-2 ring-[#ccff00]/20 focus:border-[#ccff00]/40 transition-all outline-none">`
        }
      </div>
    `;
    }).join('');

    fieldsContainer.querySelectorAll('[data-param-type="media"]').forEach(input => {
      const fileInput = Array.from(fieldsContainer.querySelectorAll('[data-upload-key]'))
        .find(item => item.dataset.uploadKey === input.dataset.key);
      if (!fileInput) return;
      input.onclick = () => fileInput.click();
      fileInput.onchange = () => {
        const file = fileInput.files?.[0];
        if (file) input.value = file.name;
      };
    });

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.remove('translate-x-full');
    overlay.classList.add('translate-x-0');

    overlay.querySelector('#back-to-grid').onclick = () => {
      overlay.classList.replace('translate-x-0', 'translate-x-full');
      setTimeout(() => overlay.classList.add('hidden'), 300);
    };

    overlay.querySelector('#submit-interaction').onclick = () => this.handleSubmit(template);
  }

  async handleSubmit(template) {
    const fieldsContainer = this.modal.querySelector('#form-fields');
    const inputs = fieldsContainer.querySelectorAll('[data-key]');
    const jobParam = { ...template.otherParams };

    try {
      const btn = this.modal.querySelector('#submit-interaction');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>\u6b63\u5728\u63d0\u4ea4\u6392\u961f...';

      for (const input of inputs) {
        if (input.dataset.paramType !== 'media') {
          jobParam[input.dataset.key] = input.value;
          continue;
        }

        const fileInput = Array.from(fieldsContainer.querySelectorAll('[data-upload-key]'))
          .find(item => item.dataset.uploadKey === input.dataset.key);
        const file = fileInput?.files?.[0];
        jobParam[input.dataset.key] = file
          ? await interactionService.uploadTemplateImage(file)
          : input.value;
      }

      const order = await interactionService.addOrder({
        JobParam: JSON.stringify(jobParam),
        // 上游文档示例要求 TempleteId 与 TempleteICENo 都使用模板 no。
        TempleteId: template.iceNo,
        TempleteICENo: template.iceNo,
        TempleteName: template.name,
        JobName: template.name,
        TempleteType: template.type,
        Remark: ''
      });
      toastService.showToast('\u63d0\u4ea4\u4efb\u52a1\u6210\u529f\uff0c\u8bf7\u5728\u8bb0\u5f55\u4e2d\u67e5\u770b\u8be6\u60c5', 'success');

      this.modal.querySelector('#back-to-grid').click();
      setTimeout(() => this.showRecords({
        result: order,
        jobName: template.name
      }), 500);
    } catch (error) {
      logService.error('[InteractionUI] submit order failed:', error);
      toastService.showError(error.message || '\u63d0\u4ea4\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
    } finally {
      const btn = this.modal.querySelector('#submit-interaction');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '\u4fdd\u5b58\u5e76\u5408\u6210\u89c6\u9891';
      }
    }
  }

  async showRecords(submittedOrder = null, pollAttempt = 0) {
    const overlay = this.modal.querySelector('#interaction-records-overlay');
    const list = overlay.querySelector('#records-list');
    const requestId = ++this.recordsRequestId;

    this.clearOrderPolling();

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.replace('translate-y-full', 'translate-y-0');

    overlay.querySelector('#close-records').onclick = () => {
      this.recordsRequestId += 1;
      this.clearOrderPolling();
      overlay.classList.replace('translate-y-0', 'translate-y-full');
      setTimeout(() => overlay.classList.add('hidden'), 300);
    };

    list.innerHTML = `
      <div class="flex flex-col items-center justify-center py-20">
        <div class="animate-spin rounded-full h-8 w-8 border-2 border-[#ccff00] border-t-transparent mb-4"></div>
        <p class="text-xs text-gray-500">\u6b63\u5728\u5237\u65b0\u8bb0\u5f55...</p>
      </div>
    `;

    try {
      const pageResult = await interactionService.getOrderList(1);
      if (requestId !== this.recordsRequestId) return;

      const orders = pageResult.items;
      const submitted = this.findSubmittedOrder(orders, submittedOrder);

      if (orders.length === 0) {
        list.innerHTML = `
          <div class="flex flex-col items-center justify-center py-20 opacity-20">
            <i class="fas fa-history text-5xl mb-4"></i>
            <p class="text-sm">${submittedOrder ? '\u5408\u6210\u4efb\u52a1\u5df2\u63d0\u4ea4\uff0c\u6b63\u5728\u7b49\u5f85\u64ad\u653e\u5730\u5740...' : '\u6682\u65e0\u4efb\u52a1\u8bb0\u5f55'}</p>
          </div>
        `;
        if (submittedOrder && pollAttempt < 20) {
          this.scheduleOrderRefresh(submittedOrder, pollAttempt + 1);
        }
        return;
      }

      list.innerHTML = orders.map(order => {
        const playbackUrl = safeHttpUrl(order.url);
        const action = playbackUrl
          ? `<a class="inline-flex items-center mt-2 text-xs text-[#ccff00] underline" href="${escapeHtml(playbackUrl)}" target="_blank" rel="noopener noreferrer">打开播放地址</a>`
          : `<span class="inline-flex items-center mt-2 text-xs text-gray-500">${this.isPendingOrder(order) ? '合成中，等待播放地址...' : '暂无播放地址'}</span>`;
        return `
        <div class="bg-[#1a1a1a] rounded-2xl p-4 flex items-center gap-4 border border-white/5 active:bg-[#222] transition-colors">
          <div class="w-14 h-14 bg-[#ccff00]/10 text-[#ccff00] rounded-xl flex items-center justify-center text-xl shrink-0">
            <i class="fas fa-video"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex justify-between items-start mb-1">
              <h4 class="font-bold text-sm text-white truncate">${escapeHtml(order.jobName)}</h4>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-[#ccff00]/20 text-[#ccff00] font-black">${escapeHtml(getOrderStatusText(order.jobStatus))}</span>
            </div>
            <p class="text-[11px] text-gray-500 tracking-wider">${escapeHtml(order.createTime || '')}</p>
            ${action}
          </div>
        </div>
      `;
      }).join('');

      const synthesisFailed = submitted?.jobStatus === 'code_media_jobstatus_fail';
      if (submittedOrder && !synthesisFailed && (!submitted || !safeHttpUrl(submitted.url)) && pollAttempt < 20) {
        this.scheduleOrderRefresh(submittedOrder, pollAttempt + 1);
      }
    } catch (error) {
      if (requestId !== this.recordsRequestId) return;
      logService.error('[InteractionUI] load order records failed:', error);
      list.innerHTML = `<p class="text-center py-10 text-red-500/60 text-xs">\u83b7\u53d6\u8bb0\u5f55\u5931\u8d25</p>`;
      if (submittedOrder && pollAttempt < 20) {
        this.scheduleOrderRefresh(submittedOrder, pollAttempt + 1);
      }
    }
  }

  findSubmittedOrder(orders, submittedOrder) {
    if (!submittedOrder || !Array.isArray(orders)) return null;
    const source = typeof submittedOrder === 'object' ? submittedOrder : { id: submittedOrder };
    const result = source.result && typeof source.result === 'object' ? source.result : null;
    const keys = ['id', 'orderId', 'orderNo', 'jobId'];
    const matchedById = orders.find(order => keys.some(key => {
      const sourceValue = source[key] ?? result?.[key];
      return sourceValue != null && order?.[key] != null && String(sourceValue) === String(order[key]);
    }));
    if (matchedById) return matchedById;

    const jobName = source.jobName ?? result?.jobName;
    return typeof jobName === 'string'
      ? orders.find(order => order?.jobName === jobName) || null
      : null;
  }

  scheduleOrderRefresh(submittedOrder, pollAttempt) {
    const overlay = this.modal?.querySelector('#interaction-records-overlay');
    if (!overlay?.classList.contains('translate-y-0')) return;

    this.clearOrderPolling();
    this.orderPollTimer = setTimeout(() => {
      this.orderPollTimer = null;
      this.showRecords(submittedOrder, pollAttempt);
    }, 3000);
  }

  clearOrderPolling() {
    if (this.orderPollTimer !== null) {
      clearTimeout(this.orderPollTimer);
      this.orderPollTimer = null;
    }
  }

  isPendingOrder(order) {
    return ['code_media_jobstatus_init', 'code_media_jobstatus_processing', 'code_media_jobstatus_queuing']
      .includes(order?.jobStatus);
  }

  async show() {
    this.initModal();
    this.modal.classList.remove('hidden');
    void this.modal.offsetWidth;
    this.modal.classList.add('opacity-100');

    try {
      await interactionService.guestLogin();
    } catch (error) {
      logService.error('[InteractionUI] guest login failed:', error);
    }

    this.loadTemplates();
  }

  hide() {
    if (!this.modal) return;
    this.recordsRequestId += 1;
    this.clearOrderPolling();
    this.modal.classList.remove('opacity-100');
    setTimeout(() => {
      this.modal.classList.add('hidden');
    }, 300);
  }
}

export { InteractionUI, mapTemplateItem, getOrderStatusText };

const interactionUI = new InteractionUI();
export default interactionUI;
