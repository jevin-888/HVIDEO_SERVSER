import { parseApiArrayResponse } from '../../../shared/utils/ResponseParser.js';

// 延迟导入，避免循环依赖
let singerService;
let songTopUI;
let singerSongsUI;

// Match PAD's empty-group fallback without hardcoding legacy region codes.
export function singerFilterOptions(rows, group) {
  const entries = rows.filter(item => item.dictGroup === group && item.dictCode != null && String(item.dictCode).trim());
  const visible = entries.filter(item => item.visible == null || Number(item.visible) !== 0);
  const options = (visible.length ? visible : entries).slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map(item => ({ code: String(item.dictCode), name: item.dictName || String(item.dictCode) }));
  return [{ code: '', name: '全部' }, ...options];
}

/**
 * 歌手模块UI逻辑
 */
class SingerUI {
  constructor() {
    // 在需要时动态导入服务
    this.currentFilters = {
      sexCode: '',
      regionCode: ''
    };
    this.currentPage = 1;
    this.hasMore = true;
    this.isLoading = false;
    this.letterCache = new Map(); // key: 首字母, value: 该字母下的全部歌手（size:0）
    this.acronymCache = new Map(); // key: singerNo/id/name, value: 拼音首字母缩写
    this.reqSeq = 0;
    // 展开状态
    this._sexExpanded = false;
    this._regionExpanded = false;
  }

  /**
   * 初始化服务
   */
   async initServices() {
    singerService = window.singerService || singerService;
    songTopUI = window.songTopUI || songTopUI;
    singerSongsUI = window.singerSongsUI || singerSongsUI;

    this.singerService = singerService;
    this.songTopUI = songTopUI;
    this.singerSongsUI = singerSongsUI;
    return true;
  }

  /**
   * 渲染歌手列表
   * @param {Array} singers - 歌手列表
   */
  renderSingerList(singers) {
    // 实现歌手列表的渲染逻辑
  }

  /**
   * 渲染歌手详情
   * @param {Object} singer - 歌手信息
   */
  renderSingerDetail(singer) {
    // 实现歌手详情的渲染逻辑
  }

  /**
   * 绑定歌手相关事件
   */
  bindSingerEvents() {
    // 实现歌手相关事件绑定逻辑
  }

  /**
   * 显示歌星列表（全屏模态框）
   */
  async showSingerList() {
    await this.initServices();

    // 创建模态框容器
    const modal = document.createElement('div');
    modal.id = 'singerListModal';
    modal.className = 'fixed inset-0 z-[9999] hidden opacity-0 transition-opacity duration-300 bg黑 bg-opacity-50 flex items-center justify-center'.replace('bg黑', 'bg-black');
    modal.innerHTML = `
      <div class="relative w-full max-w-4xl h-[calc(100vh-65px)] mb-[65px] bg-white dark:bg-gray-900 rounded-lg shadow-xl flex flex-col transform translate-y-full transition-transform duration-300">
        <style>
          .hide-scrollbar::-webkit-scrollbar { display: none; }
          .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          /* Prevent iOS zoom on focus for singer search */
          .singer-search-input {
            font-size: 16px !important;
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
            text-size-adjust: 100%;
          }
        </style>
        <div class="flex-shrink-0 p-4 flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <button class="close-singer-list-btn px-3 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400">
            <i class="fas fa-arrow-left"></i>
          </button>
          <h2 class="text-lg font-bold text-gray-800 dark:text-white flex-1 text-center">歌星</h2>
        </div>
        <!-- 搜索区域 -->
        <div class="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <div class="flex items-center bg-gray-100 dark:bg-gray-700 rounded-full px-3 py-3 mb-3">
            <i class="fa fa-search text-gray-500 dark:text-gray-400 mr-2"></i>
            <input type="text" placeholder="搜索歌星" class="singer-search-input flex-1 bg-transparent focus:outline-none text-gray-800 dark:text-white text-base">
          </div>
          <!-- 性别筛选 -->
          <div id="singer-filter-section" class="">
            <div class="mb-3">
              <div class="text-xs text-gray-500 dark:text-gray-400 mb-2">性别</div>
              <div id="sex-filters" class="flex gap-2 overflow-x-auto hide-scrollbar"></div>
            </div>
            <!-- 地区筛选 -->
            <div class="mb-3">
              <div class="text-xs text-gray-500 dark:text-gray-400 mb-2">地区</div>
              <div id="region-filters" class="flex gap-2 overflow-x-auto hide-scrollbar"></div>
            </div>
          </div>
        </div>
        <div class="flex-1 overflow-auto p-4 hide-scrollbar">
          <div id="singers-grid" class="grid grid-cols-3 md:grid-cols-5 gap-3"></div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 打开动画
    requestAnimationFrame(() => {
      modal.classList.remove('hidden');
      modal.classList.remove('opacity-0');
      const panel = modal.querySelector('.transform');
      if (panel) panel.classList.remove('translate-y-full');
    });

    // 关闭事件
    const closeBtn = modal.querySelector('.close-singer-list-btn');
    closeBtn?.addEventListener('click', () => {
      const panel = modal.querySelector('.transform');
      if (panel) panel.classList.add('translate-y-full');
      modal.classList.add('opacity-0');
      setTimeout(() => {
        modal.remove();
        // 不需要重新打开点歌页面，因为点歌页面一直保持在底层
      }, 300);
    });

    // 获取DOM元素
    const grid = modal.querySelector('#singers-grid');
    const searchInput = modal.querySelector('.singer-search-input');
    const sexFiltersContainer = modal.querySelector('#sex-filters');
    const regionFiltersContainer = modal.querySelector('#region-filters');

    // 初始化筛选条件
    this.currentFilters = {
      sexCode: '',
      regionCode: ''
    };

    // 获取性别和地区数据
    let sexOptions = [{ code: '', name: '全部' }];
    let regionOptions = [{ code: '', name: '全部' }];

    try {
      const response = await window.apiService.getDictList({ groupKey: '_all' });
      const rows = parseApiArrayResponse(response, 'Singer filter dictionaries');
      sexOptions = singerFilterOptions(rows, 'sex');
      regionOptions = singerFilterOptions(rows, 'region');
    } catch (error) {
      console.warn('[SingerUI] 获取性别或地区字典失败:', error);
      window.toastService?.showError?.('歌星筛选加载失败，请重新打开重试');
    }

    // 渲染筛选标签组
    const renderFilterGroup = (container, options, type, selectedCode) => {
      container.innerHTML = '';
      const expanded = type === 'sex' ? this._sexExpanded : this._regionExpanded;
      const maxCount = expanded ? options.length : 5;

      // 创建一个容器用于滚动内容，隐藏滚动条
      const scrollContainer = document.createElement('div');
      scrollContainer.className = 'flex gap-2 overflow-x-auto hide-scrollbar';

      // 筛选项按钮
      options.slice(0, maxCount).forEach((item, index) => {
        const code = item.code;
        const name = item.name;
        const btn = document.createElement('button');
        const baseClass = 'px-3 py-2 rounded-lg border text-sm whitespace-nowrap hover:bg-blue-50 dark:hover:bg-gray-700 border-gray-300 dark:border-gray-700 flex-shrink-0';
        const activeClass = ' bg-blue-500 text-white border-blue-500';
        const normalClass = ' text-gray-700 dark:text-gray-200';
        btn.className = baseClass + (selectedCode === code ? activeClass : normalClass);
        btn.textContent = name;

        // 为选中的按钮添加特殊标识
        if (selectedCode === code) {
          btn.id = `selected-${type}-btn`;
          btn.className += ' font-bold'; // 加粗显示选中项
        }

        btn.addEventListener('click', () => {
          if (type === 'sex') {
            this.currentFilters.sexCode = code;
            this.currentPage = 1;
            this.hasMore = true;
            // 保存当前搜索关键词
            const currentKeyword = searchInput?.value?.trim() || '';
            if (currentKeyword) {
              // 如果有搜索关键词，重新执行搜索并应用筛选条件
              this.performSearch(currentKeyword);
            } else {
              // 如果没有搜索关键词，直接加载筛选后的数据
              loadSingers(1);
            }
            renderFilterGroup(sexFiltersContainer, sexOptions, 'sex', code);
            // 重置地区筛选的选中状态显示
            renderFilterGroup(regionFiltersContainer, regionOptions, 'region', this.currentFilters.regionCode);
          } else {
            this.currentFilters.regionCode = code;
            this.currentPage = 1;
            this.hasMore = true;
            // 保存当前搜索关键词
            const currentKeyword = searchInput?.value?.trim() || '';
            if (currentKeyword) {
              // 如果有搜索关键词，重新执行搜索并应用筛选条件
              this.performSearch(currentKeyword);
            } else {
              // 如果没有搜索关键词，直接加载筛选后的数据
              loadSingers(1);
            }
            renderFilterGroup(regionFiltersContainer, regionOptions, 'region', code);
            // 重置性别筛选的选中状态显示
            renderFilterGroup(sexFiltersContainer, sexOptions, 'sex', this.currentFilters.sexCode);
          }
        });
        scrollContainer.appendChild(btn);
      });

      // 更多/收起 切换
      if (options.length > 5) {
        const moreBtn = document.createElement('button');
        moreBtn.className = 'px-3 py-2 ml-1 rounded-lg border text-sm whitespace-nowrap hover:bg-blue-50 dark:hover:bg-gray-700 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 flex-shrink-0';
        moreBtn.textContent = expanded ? '收起' : '更多';
        moreBtn.addEventListener('click', () => {
          if (type === 'sex') this._sexExpanded = !expanded;
          else this._regionExpanded = !expanded;
          renderFilterGroup(container, options, type, selectedCode);
        });
        scrollContainer.appendChild(moreBtn);
      }

      // 如果没有任何数据，显示提示信息
      if (options.length === 0) {
        const noDataText = document.createElement('div');
        noDataText.className = 'text-gray-500 dark:text-gray-400 text-sm py-2';
        noDataText.textContent = '暂无数据';
        scrollContainer.appendChild(noDataText);
      }

      container.appendChild(scrollContainer);
    };

    // IntersectionObserver 实现真正的图片懒加载
    const imgObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const realSrc = img.dataset.src;
          if (realSrc) {
            img.src = realSrc;
            img.removeAttribute('data-src');
          }
          imgObserver.unobserve(img);
        }
      });
    }, { rootMargin: '100px' }); // 提前100px开始加载

    // 创建单个歌星卡片
    const createSingerCard = (s) => {
      const singerNo = s.singerNo || s.id || s.singerId;
      const name = s.singerName || s.name || s.Name || '未知';
      const imgUrl = singerNo && window.AppConfig?.singerImgServer?.getUrl
        ? window.AppConfig.singerImgServer.getUrl(singerNo)
        : null;

      const card = document.createElement('div');
      card.className = 'flex flex-col items-center p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-gray-800 cursor-pointer';
      card.innerHTML = `
        <div class="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mb-1 flex items-center justify-center relative">
          ${imgUrl ? `<img data-src="${imgUrl}" decoding="async" class="singer-lazy-img w-full h-full object-cover" style="display:none" onerror="this.nextElementSibling.style.display='flex'; this.style.display='none'" onload="this.style.display='block'; this.nextElementSibling.style.display='none'">` : ''}
          <div class="absolute inset-0 flex items-center justify-center" style="display:flex">
            <i class="fas fa-user text-gray-400 text-lg"></i>
          </div>
        </div>
        <div class="text-xs text-gray-700 dark:text-gray-300 truncate w-full text-center">${name}</div>
      `;

      // 注册懒加载观察
      if (imgUrl) {
        const img = card.querySelector('.singer-lazy-img');
        if (img) imgObserver.observe(img);
      }

      card.addEventListener('click', async () => {
        await this.initServices();
        if (this.singerSongsUI && singerNo) {
          await this.singerSongsUI.initServices();
          this.singerSongsUI.songTopUI = this.songTopUI;
          this.singerSongsUI.showSingerSongsModal(singerNo, name);
        }
        const panel = modal.querySelector('.transform');
        if (panel) panel.classList.add('translate-y-full');
        modal.classList.add('opacity-0');
        setTimeout(() => modal.remove(), 300);
      });
      return card;
    };

    // 渲染卡片函数（全量替换）
    const renderCards = (list) => {
      grid.innerHTML = '';
      grid.style.willChange = 'transform';
      grid.style.contain = 'layout style';
      const frag = document.createDocumentFragment();
      (list || []).forEach(s => frag.appendChild(createSingerCard(s)));
      requestAnimationFrame(() => grid.appendChild(frag));
    };

    // 追加卡片函数（增量添加，不清空已有DOM）
    const appendCards = (list) => {
      // 移除加载骨架屏
      grid.querySelectorAll('.skeleton-card').forEach(el => el.remove());
      if (!list || list.length === 0) return;
      const frag = document.createDocumentFragment();
      list.forEach(s => frag.appendChild(createSingerCard(s)));
      requestAnimationFrame(() => grid.appendChild(frag));
    };

    // 显示骨架屏占位
    const showSkeleton = (count = 12) => {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const sk = document.createElement('div');
        sk.className = 'skeleton-card flex flex-col items-center p-2';
        sk.innerHTML = `
          <div class="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-700 mb-1 animate-pulse"></div>
          <div class="h-3 w-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
        `;
        frag.appendChild(sk);
      }
      grid.appendChild(frag);
    };

    const PAGE_SIZE = 60;

    // 加载歌手列表
    const loadSingers = async (page = 1) => {
      if (this.isLoading) return;
      this.isLoading = true;

      // 首次加载时显示骨架屏
      if (page === 1 && grid.children.length === 0) {
        showSkeleton(15);
      } else if (page > 1) {
        showSkeleton(6);
      }

      try {
        const t0 = performance.now();
        const { list, total } = await this.singerService.getSingersByFilters(this.currentFilters, page, PAGE_SIZE);
        const t1 = performance.now();

        if (page === 1) {
          renderCards(list);
        } else {
          appendCards(list);
        }
        const t2 = performance.now();

        const loadedCount = (page - 1) * PAGE_SIZE + (list ? list.length : 0);
        this.hasMore = total > 0 ? loadedCount < total : (list && list.length === PAGE_SIZE);
        this.currentPage = page;
      } catch (e) {
        console.warn('[SingerUI] 加载歌星列表失败:', e);
        grid.querySelectorAll('.skeleton-card').forEach(el => el.remove());
        this.hasMore = false;
      } finally {
        this.isLoading = false;
      }
    };

    // 初次加载
    await loadSingers(1);

    // 渲染筛选标签
    renderFilterGroup(sexFiltersContainer, sexOptions, 'sex', this.currentFilters.sexCode);
    renderFilterGroup(regionFiltersContainer, regionOptions, 'region', this.currentFilters.regionCode);

    // 添加滚动事件监听器实现无限滚动（无防抖，与歌曲列表一致）
    const container = modal.querySelector('.flex-1.overflow-auto');
    container?.addEventListener('scroll', () => {
      if (!container || this.isLoading || !this.hasMore) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - (scrollTop + clientHeight) <= 100) {
        loadSingers(this.currentPage + 1);
      }
    }, { passive: true });

    // 执行搜索的方法
    this.performSearch = async (kw) => {
      try {
        const myReq = ++this.reqSeq;
        if (!kw) {
          // 恢复默认列表，包含筛选条件
          const { list } = await this.singerService.getSingersByFilters(this.currentFilters, 1, PAGE_SIZE);
          if (myReq !== this.reqSeq) return;
          renderCards(list);
          return;
        }

        // 如果是单个字母，直接使用后端搜索
        if (kw.length === 1 && /^[A-Za-z]$/i.test(kw)) {
          const firstChar = kw.toUpperCase();
          const list = await this.singerService.getSingersByFirstChar(firstChar, this.currentFilters, 1, PAGE_SIZE);
          if (myReq !== this.reqSeq) return;
          renderCards(list);
        }
        // 如果是多个字母（拼音首字母缩写），先获取该首字母下的所有歌手，然后前端过滤
        else if (/^[A-Za-z]+$/i.test(kw)) {
          const target = kw.toLowerCase();
          const firstChar = kw[0].toUpperCase();

          // 先尝试从缓存获取，如果没有则从服务器获取
          const filterKey = JSON.stringify([firstChar, this.currentFilters.sexCode, this.currentFilters.regionCode]);
          let list = this.letterCache.get(filterKey);
          if (!list) {
            // 使用size=9999获取所有以该首字母开头的歌手
            // getAllSingersByFirstChar 现在直接返回解析后的数组
            list = await this.singerService.getAllSingersByFirstChar(this.currentFilters, firstChar);

            // 如果获取不到数据，尝试使用普通搜索
            if (!list || list.length === 0) {
              list = await this.singerService.getSingersByFirstChar(firstChar, this.currentFilters, 1, PAGE_SIZE);
            }

            this.letterCache.set(filterKey, list || []);
          }

          // 获取歌手名称的拼音首字母缩写
          const getAcronym = (name) => {
            const n = String(name || '').trim();
            // 中文优先使用 pinyin-pro 取首字母
            if (window.pinyinPro && /[\u4e00-\u9fa5]/.test(n)) {
              try {
                return window.pinyinPro.pinyin(n, { pattern: 'first', toneType: 'none' }).replace(/\s+/g, '');
              } catch (_) { }
            }
            // 英文名：取单词首字母
            const words = n.split(/\s+/).filter(Boolean);
            if (words.length > 1) return words.map(w => w[0] || '').join('');
            // 退化：保留字母
            return n.replace(/[^A-Za-z]/g, '');
          };

          // 前端过滤：根据拼音首字母缩写进行过滤
          const filtered = (list || []).filter(s => {
            const name = s.singerName || s.Name || s.name || '';
            const key = s.singerNo || s.id || s.singerId || name;
            let ac = this.acronymCache.get(key);
            if (!ac) {
              ac = getAcronym(name);
              this.acronymCache.set(key, ac);
            }
            ac = String(ac || '').toLowerCase();
            return ac.includes(target);
          });

          if (myReq !== this.reqSeq) return;
          renderCards(filtered);
        }
        // 其他情况（中文搜索词），使用后端搜索
        else {
          // searchSingers 现在直接返回解析后的数组
          const list = await this.singerService.getSingerList({ page: 1, pageSize: PAGE_SIZE, keyword: kw, ...this.currentFilters });
          if (myReq !== this.reqSeq) return;

          // 前端过滤：名称包含
          const lowerKw = kw.toLowerCase();
          const filtered = (list || []).filter(s => {
            const name = s.singerName || s.Name || s.name || '';
            return String(name).toLowerCase().includes(lowerKw);
          });

          renderCards(filtered);
        }
      } catch (err) {
        console.warn('[SingerUI] 搜索歌星失败:', err);
      }
    };

    // 搜索事件：首字母走后端；多字母缩写先按首字母请求再前端过滤；其他走前端包含过滤
    let searchTimer = null;
    const filterSection = modal.querySelector('#singer-filter-section');
    searchInput?.addEventListener('input', (e) => {
      const kw = String(e.target.value || '').trim();
      // 搜索模式下隐藏性别/地区筛选器，释放空间
      if (filterSection) {
        filterSection.style.display = kw ? 'none' : '';
      }
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        await this.performSearch(kw);
      }, 500);
    });
  }
}

// 创建并导出歌手UI实例
const singerUI = new SingerUI();
export default singerUI;