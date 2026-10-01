class SongTopUI {
  constructor() {
    this.modal = null;
    this.page = 1;
    this.size = 20;
    this.loading = false;
    this.songService = null;
    this.toastService = null;
    // 模式与过滤参数
    this.currentMode = 'top'; // top | search | singer | language | classify
    this.filterParams = {};
    // 其他服务
    this.apiService = null;
    this.cacheService = null;
    this.singerService = null;
    this.songSearchService = null;
    // 防抖计时器
    this._searchTimer = null;
    this._loadRequestId = 0;
    // 默认折叠：语种、分类、热门歌星仅显示5个，后面显示"更多"按钮
    this._langExpanded = false;
    this._clsExpanded = false;
    this._singersExpanded = false;
    // 自动滚动到选中项的标志
    this._autoScrollToSelected = false;
    // 屏幕尺寸变化监听器
    this._resizeHandler = null;
    // 根因修复：一次性事件绑定与字典缓存
    this._selectorsBound = false;
    this._languages = null;
    this._classifies = null;
    // 保持最后一次使用的选择区域（songname|language|classify），用于在top模式下保持区域不切换
    this._lastSelector = 'songname';
    this._isIndonesianSongs = false;

    // 监听语言变化事件
    document.addEventListener('languageChanged', () => {
      if (this.modal) {
        this.updateModalLanguage();
      }
    });
  }

  updateSearchHint() {
    const input = this.modal?.querySelector('#top-search-input');
    if (!input) return;
    const chinese = '请输入歌名搜索';
    const language = (window.langService?.getCurrentLanguage() || 'zh_cn').split('_')[0];
    const translated = {
      en: 'Enter a song title to search',
      id: 'Masukkan judul lagu untuk mencari',
      vi: 'Nhập tên bài hát để tìm kiếm'
    }[language] || '';
    input.placeholder = translated ? `${chinese} / ${translated}` : chinese;
    input.setAttribute('aria-label', input.placeholder);
    const secondary = this.modal.querySelector('.song-search-hint-secondary');
    if (secondary) {
      secondary.textContent = translated;
      secondary.hidden = !translated;
    }
  }

  updateSelectorLabels() {
    const labels = [
      ['songname-selector', '歌名', 'songName'],
      ['language-selector', '语种', 'language'],
      ['classify-selector', '分类', 'classify'],
      ['indonesian-songs-btn', '印尼歌曲', 'indonesianSongs']
    ];
    const language = window.langService?.getCurrentLanguage() || 'zh_cn';
    for (const [id, chinese, key] of labels) {
      const button = this.modal?.querySelector(`#${id}`);
      if (!button) continue;
      button.replaceChildren();
      const primary = document.createElement('span');
      primary.className = 'song-filter-primary';
      primary.textContent = chinese;
      button.appendChild(primary);
      const translated = window.langService?.t(key);
      if (!language.startsWith('zh') && translated && translated !== key && translated !== chinese) {
        const secondary = document.createElement('span');
        secondary.className = 'song-filter-secondary';
        secondary.textContent = translated;
        button.appendChild(secondary);
      }
    }
  }

  updateSelectorState() {
    let selected = 'songname';
    if (this._isIndonesianSongs && this.currentMode === 'language') selected = 'indonesian';
    else if (this.currentMode === 'language') selected = 'language';
    else if (this.currentMode === 'category') selected = 'category';
    else if (this.currentMode === 'top' || this.currentMode === 'search') selected = this._lastSelector;

    for (const [key, id] of [
      ['songname', 'songname-selector'], ['language', 'language-selector'],
      ['category', 'classify-selector'], ['indonesian', 'indonesian-songs-btn']
    ]) {
      const button = this.modal?.querySelector(`#${id}`);
      if (!button) continue;
      const active = key === selected;
      button.classList.toggle('bg-blue-500', active);
      button.classList.toggle('text-white', active);
      button.classList.toggle('text-gray-700', !active);
      button.classList.toggle('dark:text-gray-200', !active);
      button.setAttribute('aria-pressed', String(active));
    }
    this.modal?.querySelector('#quick-language')?.classList.toggle('hidden', selected !== 'language');
    this.modal?.querySelector('#quick-classify')?.classList.toggle('hidden', selected !== 'category');
  }

  /**
   * 更新模态框中的语言文本
   */
  updateModalLanguage() {
    if (!this.modal || !window.langService) return;
    const t = (key) => window.langService.t(key);

    this.updateSearchHint();

    // 更新返回主页 tooltip
    const homeBtn = this.modal.querySelector('.home-btn');
    if (homeBtn) homeBtn.title = t('backToHome');

    // 更新清空搜索 tooltip
    const closeBtn = this.modal.querySelector('.close-btn');
    if (closeBtn) {
      closeBtn.title = t('clearSearch');
      closeBtn.setAttribute('aria-label', t('clearSearch'));
    }

    this.updateSelectorLabels();

    // 更新热门歌星标题
    const singersTitle = this.modal.querySelector('#top-singers-section .text-xs');
    if (singersTitle) singersTitle.textContent = t('hotSingers');

    // 重新渲染语种及分类标签
    this.renderQuickCategories();
    // 重新渲染热门歌星条（包含更多歌星按钮）
    this.renderTopSingersBar();
  }

   async initServices() {
    this.songService = window.songService || this.songService;
    this.toastService = window.toastService || this.toastService;
    this.apiService = window.apiService || this.apiService;
    this.cacheService = window.cacheService || this.cacheService;
    this.singerService = window.singerService || this.singerService;
    this.songSearchService = window.songSearchService || this.songSearchService;
    this.singerUI = window.singerUI || this.singerUI;
    this.singerSongsUI = window.singerSongsUI || this.singerSongsUI;
  }

  initTopModal() {
    if (this.modal) return;
    const t = (key) => window.langService ? window.langService.t(key) : key;
    this.modal = document.createElement('div');
    this.modal.id = 'songTopModal';
    this.modal.className = 'fixed inset-0 z-[9999] hidden opacity-0 transition-opacity duration-300 bg-black bg-opacity-50 flex items-center justify-center';
    this.modal.innerHTML = `
      <div class="relative w-full max-w-4xl h-[calc(103vh-65px)] mb-[65px] bg-white dark:bg-gray-900 rounded-lg shadow-xl flex flex-col transform translate-y-full transition-transform duration-300">
        <style>
          .hide-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .hide-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
        </style>
        <!-- 搜索框放在顶部 -->
        <div class="p-6 border-b border-gray-200 dark:border-gray-700">
          <div class="relative flex items-center">
            <button class="home-btn mr-2 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400" title="${t('backToHome')}">
              <i class="fas fa-home"></i>
            </button>
            <div class="flex-1">
               <div class="relative w-[92%] mx-auto">
                 <input id="top-search-input" type="text" placeholder="请输入歌名搜索" class="block w-full px-3 py-2 pl-9 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-base text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                 <div class="song-search-hint" aria-hidden="true">
                   <span>请输入歌名搜索</span>
                   <span class="song-search-hint-secondary" hidden></span>
                 </div>
                 <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"></i>
                 <button class="close-btn absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400" title="${t('clearSearch')}" aria-label="${t('clearSearch')}">
                   <i class="fas fa-times"></i>
                 </button>
               </div>
             </div>
          </div>
        </div>
        <!-- 顶部工具栏：快速分类、热门歌星 -->
        <div id="top-toolbar" class="px-4 pt-2 pb-0 space-y-3 border-b border-gray-100 dark:border-gray-800">
          <!-- 快速分类：歌名、语种与分类选择放在第一行，对应的标签显示在第二行 -->
          <div id="quick-categories" class="space-y-3">
            <div class="bg-gray-100 dark:bg-gray-900 rounded-lg px-2">
              <!-- 第一行：歌名、语种和分类选择 -->
              <div class="song-filter-selectors grid grid-cols-4 gap-2 mb-2">
                <button id="songname-selector" class="px-3 py-2 rounded-lg border text-sm whitespace-nowrap border-gray-300 dark:border-gray-700 flex-1 text-gray-700 dark:text-gray-200">${t('songName')}</button>
                <button id="language-selector" class="px-3 py-2 rounded-lg border text-sm whitespace-nowrap border-gray-300 dark:border-gray-700 flex-1 text-gray-700 dark:text-gray-200">${t('language')}</button>
                <button id="classify-selector" class="px-3 py-2 rounded-lg border text-sm whitespace-nowrap border-gray-300 dark:border-gray-700 flex-1 text-gray-700 dark:text-gray-200">${t('classify')}</button>
                <!-- 添加印尼歌曲按钮 -->
                <button id="indonesian-songs-btn" class="px-3 py-2 rounded-lg border text-sm whitespace-nowrap border-gray-300 dark:border-gray-700 flex-1 text-gray-700 dark:text-gray-200">${t('indonesianSongs')}</button>
              </div>
              <!-- 第二行：根据选择显示对应的标签 -->
              <div class="flex gap-2">
                <div id="quick-language" class="flex-1 min-w-0 hidden"></div>
                <div id="quick-classify" class="flex-1 min-w-0 hidden"></div>
              </div>
            </div>
          </div>
          <!-- 热门歌星条 -->
          <div id="top-singers-section">
            <div class="text-xs text-gray-500 dark:text-gray-400 mb-2">${t('hotSingers')}</div>
            <div id="top-singers-bar" class="flex gap-3 overflow-x-auto hide-scrollbar pb-2"></div>
          </div>
        </div>
        <div id="top-songs-container" class="p-4 overflow-y-auto flex-1"></div>
      </div>
    `;
    this.updateSelectorLabels();
    this.updateSearchHint();
    document.body.appendChild(this.modal);

    const closeBtn = this.modal.querySelector('.close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => {
      const input = this.modal.querySelector('#top-search-input');
      if (input) {
        input.value = '';
        // 恢复工具栏显示
        const toolbar = this.modal.querySelector('#top-toolbar');
        if (toolbar) toolbar.style.display = '';
        // 立即恢复到顶部模式
        this.setMode('top', {});
        input.focus();
      }
    });
    const homeBtn = this.modal.querySelector('.home-btn');
    if (homeBtn) homeBtn.addEventListener('click', () => this.goToHome());

    // 中文输入法组词完成后再搜索，始终以最新输入为准。
    const searchInput = this.modal.querySelector('#top-search-input');
    if (searchInput) {
      let composing = false;
      searchInput.addEventListener('compositionstart', () => {
        composing = true;
        this.cancelPendingSearch();
        this._loadRequestId += 1;
        this.loading = false;
      });
      searchInput.addEventListener('compositionend', () => {
        composing = false;
        this.scheduleSongSearch(searchInput.value);
      });
      searchInput.addEventListener('input', event => {
        if (!composing && !event.isComposing) this.scheduleSongSearch(searchInput.value);
      });
    }

    // 添加印尼歌曲按钮事件处理
    const indonesianSongsBtn = this.modal.querySelector('#indonesian-songs-btn');
    if (indonesianSongsBtn) {
      indonesianSongsBtn.addEventListener('click', async () => {
        // 首先获取语种数据，找到印尼语的编码
        try {
          await this.initServices();
          const languages = await this.cacheService.getDict('language') || [];

          // 查找印尼语的编码
          let indonesianCode = null;
          for (const lang of languages) {
            // 检查是否是印尼语（支持多种可能的名称）
            if (lang.name && (lang.name.includes('印尼') || lang.name.includes('印度尼西亚') ||
              lang.name.toLowerCase().includes('indonesia') || lang.name.toLowerCase().includes('indonesian'))) {
              indonesianCode = lang.code;
              break;
            }
          }

          // 如果没有找到印尼语，使用默认值'id'或'6'
          if (!indonesianCode) {
            // 先尝试使用'id'作为编码
            indonesianCode = 'id';

            // 检查是否已存在该编码
            const existingLang = languages.find(lang => lang.code === indonesianCode);
            if (!existingLang) {
              // 如果'id'编码不存在，尝试使用数字编码'6'
              indonesianCode = '6';
            }
          }

          // 设置模式为语种，并指定印尼语编码
          this.setMode('language', { languageCode: indonesianCode }, true);

        } catch (error) {
          console.error('[SongTopUI] 处理印尼歌曲按钮点击失败:', error);
          // 即使出错也尝试使用默认编码
          this.setMode('language', { languageCode: 'id' }, true);
        }
      });
    }

    // 渲染快速分类与热门歌星
    this.renderQuickCategories();
    this.renderTopSingersBar();

    const container = this.modal.querySelector('#top-songs-container');
    if (container) {
      container.dataset.loading = 'false';
      this.bindInfiniteScroll(container);
      this.loadSongs(container, 1);
    }

    this.modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeTopModal();
    });
  }

  cancelPendingSearch() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = null;
  }

  scheduleSongSearch(value) {
    this.cancelPendingSearch();
    this._loadRequestId += 1; // 旧查询不能覆盖尚在防抖中的新输入。
    this.loading = false;
    const keyword = value.trim();
    const toolbar = this.modal?.querySelector('#top-toolbar');
    if (toolbar) toolbar.style.display = keyword ? 'none' : '';
    if (!keyword) {
      this.setMode('top', {});
      return;
    }
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null;
      // 搜索框按歌名查询，不携带已隐藏的语种、分类或歌星筛选。
      this.setMode('search', { keyword, searchMode: 'fullName' });
    }, 300);
  }

  setMode(mode, params = {}, isIndonesianSongs = false) {
    this.cancelPendingSearch();
    // 保存当前的滚动位置
    const langContainer = this.modal?.querySelector('#quick-language');
    const clsContainer = this.modal?.querySelector('#quick-classify');
    let langScrollLeft = 0, clsScrollLeft = 0;

    if (langContainer) langScrollLeft = langContainer.scrollLeft;
    if (clsContainer) clsScrollLeft = clsContainer.scrollLeft;

    this.currentMode = mode;
    this._isIndonesianSongs = mode === 'language' && isIndonesianSongs;
    this.filterParams = params || {};
    // 移除开发环境限制，使日志在所有环境中都能输出
    if (mode === 'language') {
      this.selectedLanguageCode = params.languageCode || null;
      // 不再重置分类，避免非预期联动

    } else if (mode === 'category') {
      this.selectedCategoryCode = params.categoryCode || null;

    } else if (mode === 'singer') {
      // 歌手模式：重置语种和分类选择，确保只显示该歌手的歌曲
      this.selectedLanguageCode = null;
      this.selectedCategoryCode = null;

    } else if (mode === 'top') {
      this.selectedLanguageCode = null;
      this.selectedCategoryCode = null;

    }
    this.page = 1;
    const container = this.modal?.querySelector('#top-songs-container');
    if (container) {
      // 不再根据模式隐藏语种与分类区域
      // this.toggleQuickCategories(mode === 'search');

      // 重新渲染快速分类，更新激活态
      this.renderQuickCategories().then(() => {
        // 恢复滚动位置
        if (langContainer) {
          // 使用平滑滚动回到之前的位置
          langContainer.scrollTo({
            left: langScrollLeft,
            behavior: 'instant'
          });
        }
        if (clsContainer) {
          // 使用平滑滚动回到之前的位置
          clsContainer.scrollTo({
            left: clsScrollLeft,
            behavior: 'instant'
          });
        }

        this.updateSelectorState();
      });

      // 搜索模式不联动歌星，不更新热门歌星条
      if (mode === 'search') {
        // 保持现有热门歌星显示，不做联动
      } else if (mode === 'singer') {
        // 在歌手模式下，高亮显示选中的歌手
        this.renderTopSingersBar(null, params.primarySingerNo);
      } else if (mode === 'top') {
        // 在回到顶部模式时，恢复显示热门歌星
        this.renderTopSingersBar();
      }

      this.loadSongs(container, 1);
    }
  }

  /**
   * 根据搜索关键词更新热门歌星条
   * @param {string} keyword - 搜索关键词
   */
  async updateSingersBarWithSearch(keyword) {
    try {
      await this.initServices();
      // 获取所有热门歌星
      let allSingers = this.cacheService.getPreloadedTopSingers();
      if (!allSingers || allSingers.length === 0) {
        const resp = await this.singerService.getTopSingers({ page: 1, pageSize: 100 });
        allSingers = Array.isArray(resp) ? resp : [];
      }
      const k = (keyword || '').trim();
      const isSingleLetter = /^[A-Za-z]$/.test(k);
      const filteredSingers = allSingers.filter(singer => {
        const name = singer.singerName || '';
        if (isSingleLetter) {
          const first = (name.charAt(0) || '').toLowerCase();
          return first === k.toLowerCase();
        }
        return name.toLowerCase().includes(k.toLowerCase());
      });
      // 更新热门歌星条显示过滤后的结果
      this.renderTopSingersBar(filteredSingers);
    } catch (e) {
      console.warn('[SongTopUI] 更新搜索歌星条失败:', e);
      // 如果搜索失败，仍然显示所有热门歌星
      this.renderTopSingersBar();
    }
  }

  async loadSongs(container, page = 1) {
    if (!container || (this.loading && page !== 1)) return;
    const requestId = ++this._loadRequestId;
    const mode = this.currentMode;
    const params = { ...this.filterParams };
    this.loading = true;
    container.dataset.loading = 'true';
    try {
      await this.initServices();
      if (requestId !== this._loadRequestId) return;
      const loadOpts = {};
      if (this._skipSongCacheOnce && page === 1) {
        loadOpts.skipCache = true;
        this._skipSongCacheOnce = false;
      }
      const result = await this.songService.loadSongsByMode(mode, params, page, this.size, loadOpts);
      if (requestId !== this._loadRequestId) return;
      const songs = this.songService.normalizeSongs(result.list || []);
      this.totalSize = result.totalSize ?? 0;
      this.renderSongs(songs, container, page);
      this.page = page;
    } catch (e) {
      if (requestId !== this._loadRequestId) return;
      console.error('[SongTopUI] 加载歌曲失败:', e);
      const t = (key) => window.langService ? window.langService.t(key) : key;
      const errorEl = document.createElement('div');
      errorEl.className = 'text-center text-red-500 py-10';
      errorEl.textContent = t('loadError') || '加载失败，请稍后重试';
      container.appendChild(errorEl);
      setTimeout(() => errorEl.remove(), 3000);
    } finally {
      if (requestId === this._loadRequestId) {
        this.loading = false;
        container.dataset.loading = 'false';
      }
    }
  }

  // 统一切换语种与分类区域显示/隐藏
  toggleQuickCategories(isHidden) {
    const quickCategories = this.modal?.querySelector('#quick-categories');
    const quickLanguage = this.modal?.querySelector('#quick-language');
    const quickClassify = this.modal?.querySelector('#quick-classify');
    const method = isHidden ? 'add' : 'remove';
    if (quickCategories) quickCategories.classList[method]('hidden');
    if (quickLanguage) quickLanguage.classList[method]('hidden');
    if (quickClassify) quickClassify.classList[method]('hidden');
  }

  async loadTopSongs(container, page = 1) {
    return this.loadSongs(container, page);
  }

  renderSongs(songs, container, page) {
    if (page === 1) container.innerHTML = '';
    const grid = container.querySelector('.grid') || document.createElement('div');
    if (!grid.parentNode) {
      grid.className = 'grid grid-cols-1 gap-1';
      container.appendChild(grid);
    }
    if (!Array.isArray(songs) || songs.length === 0) {
      const t = (key) => window.langService ? window.langService.t(key) : key;
      const noResult = document.createElement('div');
      noResult.className = 'text-center text-gray-500 dark:text-gray-400 py-10';
      noResult.textContent = t('noData');
      grid.appendChild(noResult);
      return;
    }
    songs.forEach(song => grid.appendChild(this.createSongCard(song)));
  }

  createSingerCard(singer) {
    const card = document.createElement('div');
    card.className = 'singer-card bg-white dark:bg-gray-800 rounded-lg shadow-sm p-2 flex items-center';
    card.style.transition = 'transform 0.2s ease';
    card.style.cursor = 'pointer';
    card.style.marginBottom = '0.1rem';

    // 获取歌星ID
    const singerId = singer.singerNo || singer.id || singer.singerId;
    if (singerId) {
      card.dataset.singerId = singerId;
    }

    // 构造图片URL
    let imgUrl = null;
    if (singerId && window.AppConfig?.singerImgServer?.getUrl) {
      imgUrl = window.AppConfig.singerImgServer.getUrl(singerId);
    }
    const imgAttribute = imgUrl ? `src="${imgUrl}"` : '';
    const imgStyle = imgUrl ? '' : 'style="display: none;"';

    const singerName = singer.singerName || singer.Name || singer.name || '未知歌星';

    // 生成拼音
    let pinyinText = '';
    if (singerName && /[\u4e00-\u9fa5]/.test(singerName)) {
      try {
        const pinyin = window.pinyinPro?.pinyin;
        if (pinyin) {
          pinyinText = pinyin(singerName, { toneType: 'none' });
        }
      } catch (e) {
        console.warn('[SongTopUI] 拼音转换失败:', e);
      }
    }

    card.innerHTML = `
      <div class="flex items-center w-full">
        <div class="mr-3 flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center overflow-hidden">
          <div class="icon-circle bg-primary/20 text-primary w-12 h-12 rounded-full flex items-center justify-center" style="display: flex;">
            <i class="fa fa-user text-xl"></i>
          </div>
          <img ${imgAttribute} alt="${singerName || '未知歌星'}" class="w-12 h-12 rounded-full object-cover" ${imgStyle} onerror="this.style.display='none'; this.previousElementSibling.style.display='flex';" onload="this.style.display='block'; this.previousElementSibling.style.display='none';">
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-medium text-xl truncate text-gray-800 dark:text-white">${singerName}</h3>
          ${pinyinText ? `<div class="text-base text-gray-500 dark:text-gray-400 truncate mt-1">${pinyinText}</div>` : ''}
          <div class="flex items-center gap-2 mt-1">
            <span class="text-sm px-2 py-1 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 truncate">
              歌星
            </span>
          </div>
        </div>
        <div class="ml-2 flex-shrink-0 text-gray-400 dark:text-gray-300">
          <i class="fas fa-chevron-right"></i>
        </div>
      </div>
    `;

    // 交互效果
    this.addInteractionEffects(card);

    // 绑定点击事件，点击歌星卡片显示该歌星的歌曲
    card.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (singerId) {
        await this.initServices();
        // 从搜索结果点击歌星时也使用专用歌星歌曲页面
        this.closeTopModal();
        if (this.singerSongsUI && typeof this.singerSongsUI.showSingerSongsModal === 'function') {
          this.singerSongsUI.showSingerSongsModal(singerId, singerName);
        }
      }
    });

    return card;
  }

  createSongCard(song) {
    const card = document.createElement('div');
    card.className = 'song-card bg-white dark:bg-gray-800 rounded-lg shadow-sm p-2 flex items-center';
    card.style.transition = 'transform 0.2s ease';
    card.style.cursor = 'pointer';
    card.style.marginBottom = '0.1rem';

    // 获取歌曲ID
    const songId = song.songNo;
    if (songId) {
      card.dataset.songId = songId;
    }

    // 构造图片URL（与热门歌曲一致，使用圆形头像+音乐图标占位）
    let imgUrl = null;
    if (song.singerNo && window.AppConfig?.singerImgServer?.getUrl) {
      imgUrl = window.AppConfig.singerImgServer.getUrl(song.singerNo);
    }
    const imgAttribute = imgUrl ? `src="${imgUrl}"` : '';
    const imgStyle = imgUrl ? '' : 'style="display: none;"';

    const songName = song.songName || '未知歌名';
    const singerName = song.singerName || '未知歌手';

    const isRequested = this.songService?.isSongRequested(songId) || false;
    const isDisabled = isRequested;
    const iconHtml = isRequested
      ? '<i class="fa fa-check text-sm" aria-label="已选"></i>'
      : '<i class="fa fa-plus text-sm"></i>';

    // 拼音延迟计算（不阻塞卡片渲染）
    let pinyinText = '';

    card.innerHTML = `
      <div class="flex items-center w-full">
        <div class="mr-3 flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center overflow-hidden">
          <div class="icon-circle bg-primary/20 text-primary w-12 h-12 rounded-full flex items-center justify-center" style="display: flex;">
            <i class="fa fa-music text-xl"></i>
          </div>
          <img ${imgAttribute} alt="${singerName || '未知歌星'}" class="w-12 h-12 rounded-full object-cover" ${imgStyle} onerror="this.style.display='none'; this.previousElementSibling.style.display='flex';" onload="this.style.display='block'; this.previousElementSibling.style.display='none';">
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-medium text-lg truncate text-gray-800 dark:text-white ${isRequested ? 'text-red-500' : ''}">${songName}</h3>
          <div class="pinyin-slot text-sm text-gray-500 dark:text-gray-400 truncate mt-1" style="display:none"></div>
          <div class="flex items-center gap-2 mt-1">
            <span class="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 truncate">
              ${singerName}
            </span>
          </div>
        </div>
        <button class="add-btn ml-2 w-7 h-7 rounded-full bg-primary/10 text-primary transition-colors transform transition-transform duration-200 flex items-center justify-center ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}" ${isDisabled ? 'disabled' : ''}>
          ${iconHtml}
        </button>
      </div>
    `;

    // 交互效果与事件绑定（与热门歌曲一致）
    this.addInteractionEffects(card);
    this.bindPlayEvent(card, song);

    // 异步延迟计算拼音（不阻塞卡片渲染）
    if (songName && /[\u4e00-\u9fa5]/.test(songName)) {
      setTimeout(() => {
        try {
          const pinyinFn = window.pinyinPro?.pinyin;
          if (pinyinFn) {
            const py = pinyinFn(songName, { toneType: 'none' });
            const slot = card.querySelector('.pinyin-slot');
            if (slot && py) {
              slot.textContent = py;
              slot.style.display = '';
            }
          }
        } catch (e) { /* 忽略拼音错误 */ }
      }, 0);
    }

    return card;
  }

  // 与热门歌曲一致的交互按压缩放效果
  addInteractionEffects(element) {
    const resetScale = () => element.style.transform = 'scale(1)';
    element.addEventListener('mousedown', () => {
      element.style.transform = 'scale(0.95)';
    });
    element.addEventListener('mouseup', resetScale);
    element.addEventListener('mouseleave', resetScale);
    element.addEventListener('touchstart', () => {
      element.style.transform = 'scale(0.95)';
    }, { passive: true });
    element.addEventListener('touchend', resetScale, { passive: true });
    element.addEventListener('touchcancel', resetScale, { passive: true });
  }

  // 整行和加号统一走同一个点播入口，已选歌曲不可重复点播。
  bindPlayEvent(songCard, song) {
    const addBtn = songCard.querySelector('.add-btn');
    songCard.addEventListener('click', async (event) => {
      if (event.target.closest('.add-btn')) return;
      await this.handleAddBtnClick(song, addBtn);
    });
    addBtn?.addEventListener('click', async (event) => {
      event.stopPropagation();
      await this.handleAddBtnClick(song, addBtn);
    });
  }

  async handleAddBtnClick(song, addBtn) {
    const songId = song.songNo;
    if (!songId || addBtn?.dataset.pending === 'true') return;
    if (addBtn) addBtn.dataset.pending = 'true';
    try {
      await this.initServices();
      if (this.songService.isSongRequested(songId)) {
        this.toastService?.show?.('该歌曲已在已选列表中');
        return;
      }
      if (addBtn) addBtn.disabled = true;
      await this.songService.requestSong(songId, song);
      this.toastService?.show?.('点歌成功');
    } catch (error) {
      console.error('[SongTopUI] 点歌失败:', error);
      this.toastService?.show?.(error.message || '操作失败');
    } finally {
      if (addBtn) delete addBtn.dataset.pending;
      this.updateSongCardUIById(songId);
      this.singerSongsUI?.updateSongCardUIById(songId);
    }
  }

  bindInfiniteScroll(container) {
    container.addEventListener('scroll', () => {
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      if (this.page * this.size >= this.totalSize) return;
      if (scrollTop + clientHeight >= scrollHeight - 50 && container.dataset.loading === 'false') {
        // 确保传递正确的参数给loadSongs方法
        this.loadSongs(container, this.page + 1);
      }
    });
  }

  async renderQuickCategories() {
    try {
      await this.initServices();

      // 获取语种、分类和歌名数据用于渲染UI（使用缓存避免重复获取与重复绑定）
      const langWrap = this.modal.querySelector('#quick-language');
      const clsWrap = this.modal.querySelector('#quick-classify');
      const langSelector = this.modal.querySelector('#language-selector');
      const clsSelector = this.modal.querySelector('#classify-selector');
      const snSelector = this.modal.querySelector('#songname-selector');

      // 使用缓存的语种数据
      if (langWrap) {
        if (!this._languages) {
          // 移除开发环境限制，使日志在所有环境中都能输出

          this._languages = await this.cacheService.getDict('language') || [];
          // 移除开发环境限制，使日志在所有环境中都能输出

          if (!Array.isArray(this._languages) || this._languages.length === 0) {
            // 移除开发环境限制，使日志在所有环境中都能输出
            console.warn('[SongTopUI] 语种数据为空，使用默认数据');
            this._languages = [
              { code: '1', name: '国语' },
              { code: '2', name: '粤语' },
              { code: '3', name: '英语' },
              { code: '4', name: '日语' },
              { code: '5', name: '韩语' },
              { code: '6', name: '闽南' },
              { code: '10', name: '印尼' },
              { code: '0', name: '其他' }
            ];
          }
        }
      }

      // 使用缓存的分类数据
      if (clsWrap) {
        if (!this._classifies) {
          // 移除开发环境限制，使日志在所有环境中都能输出

          this._classifies = await this.cacheService.getDict('category') || [];
          // 移除开发环境限制，使日志在所有环境中都能输出

          if (!Array.isArray(this._classifies) || this._classifies.length === 0) {
            // 移除开发环境限制，使日志在所有环境中都能输出
            console.warn('[SongTopUI] 暂无可显示的歌曲分类');
            this._classifies = [];
          }
        }
      }

      const languages = this._languages || [];
      const classifies = this._classifies || [];

      // 重置所有选择器样式的辅助函数
      const resetAllSelectors = () => {
        [langSelector, clsSelector, snSelector].forEach(s => {
          if (s) {
            s.classList.remove('bg-blue-500', 'text-white');
            s.classList.add('text-gray-700', 'dark:text-gray-200');
          }
        });
        const idBtn = this.modal.querySelector('#indonesian-songs-btn');
        if (idBtn) {
          idBtn.classList.remove('bg-blue-500', 'text-white');
          idBtn.classList.add('text-gray-700', 'dark:text-gray-200');
        }
      };

      const hideAllWraps = () => {
        if (langWrap) langWrap.classList.add('hidden');
        if (clsWrap) clsWrap.classList.add('hidden');
      };

      // 分类、语种和歌名选择器的点击事件仅绑定一次
      if (!this._selectorsBound) {
        // 歌名选择器
        if (snSelector) {
          snSelector.addEventListener('click', () => {
            resetAllSelectors();
            hideAllWraps();
            snSelector.classList.remove('text-gray-700', 'dark:text-gray-200');
            snSelector.classList.add('bg-blue-500', 'text-white');
            this._lastSelector = 'songname';
            this._isIndonesianSongs = false;
            this.updateSelectorState();
            // 若存在已选标签，点击选择器时重置为全部
            const hasSelected = !!(this.selectedLanguageCode || this.selectedCategoryCode);
            if (hasSelected) {
              this.setMode('top', {});
            }
          });
        }

        if (langSelector) {
          langSelector.addEventListener('click', () => {
            resetAllSelectors();
            hideAllWraps();
            langSelector.classList.remove('text-gray-700', 'dark:text-gray-200');
            langSelector.classList.add('bg-blue-500', 'text-white');
            if (langWrap) langWrap.classList.remove('hidden');
            this._lastSelector = 'language';
            this._isIndonesianSongs = false;
            this.updateSelectorState();
            const hasSelected = !!(this.selectedLanguageCode || this.selectedCategoryCode);
            if (hasSelected) {
              this.setMode('top', {});
            }
          });
        }

        if (clsSelector) {
          clsSelector.addEventListener('click', () => {
            resetAllSelectors();
            hideAllWraps();
            clsSelector.classList.remove('text-gray-700', 'dark:text-gray-200');
            clsSelector.classList.add('bg-blue-500', 'text-white');
            if (clsWrap) clsWrap.classList.remove('hidden');
            this._lastSelector = 'category';
            this._isIndonesianSongs = false;
            this.updateSelectorState();
            const hasSelected = !!(this.selectedLanguageCode || this.selectedCategoryCode);
            if (hasSelected) {
              this.setMode('top', {});
            }
          });
        }
        this._selectorsBound = true;
      }

      const renderGroup = (wrap, list, type) => {
        if (!wrap) return;
        wrap.innerHTML = '';
        const selectedCode = type === 'language' ? this.selectedLanguageCode : this.selectedCategoryCode;
        const expanded = type === 'language' ? this._langExpanded : this._clsExpanded;
        const maxCount = expanded ? list.length : 5;

        // 创建一个容器用于滚动内容，隐藏滚动条
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'flex gap-2 overflow-x-auto hide-scrollbar';
        // 为滚动容器添加ID以便于访问
        scrollContainer.id = `${type}-scroll-container`;

        // 分类项按钮
        list.slice(0, maxCount).forEach((item) => {
          const code = item.code || item.dictCode || item.dictValue;
          const name = item.name || item.dictLabel || code;
          const btn = document.createElement('button');
          const baseClass = 'px-3 py-2 rounded-lg border text-sm whitespace-nowrap border-gray-300 dark:border-gray-700 flex-shrink-0';
          const activeClass = ' bg-blue-500 text-white border-blue-500';
          const normalClass = ' text-gray-700 dark:text-gray-200';
          btn.className = baseClass + (selectedCode && selectedCode === code ? activeClass : normalClass);
          btn.textContent = name;

          // 为选中的按钮添加特殊标识
          if (selectedCode && selectedCode === code) {
            btn.id = `selected-${type}-btn`;
            btn.className += ' font-bold';
          }

          btn.addEventListener('click', () => {
            // 获取选择器元素
            const langSelector = this.modal?.querySelector('#language-selector');
            const clsSelector = this.modal?.querySelector('#classify-selector');
            const langWrap = this.modal?.querySelector('#quick-language');
            const clsWrap = this.modal?.querySelector('#quick-classify');

            // 获取滚动容器
            const langScrollContainer = langWrap?.querySelector('#language-scroll-container');
            const clsScrollContainer = clsWrap?.querySelector('#classify-scroll-container');

            if (type === 'language') {
              if (this.selectedLanguageCode === code && this.currentMode === 'language') {
                // 再次点击已选语种，回到全部
                this.setMode('top', {});
              } else {
                // 切换到语种模式
                this._lastSelector = 'language';
                this.selectedLanguageCode = code;
                this.currentMode = 'language';
                this.page = 1;
                // 更新过滤参数
                this.filterParams = { languageCode: code };

                // 更新选择器样式
                if (langSelector) {
                  langSelector.classList.remove('text-gray-700', 'dark:text-gray-200');
                  langSelector.classList.add('bg-blue-500', 'text-white');
                }
                if (clsSelector) {
                  clsSelector.classList.remove('bg-blue-500', 'text-white');
                  clsSelector.classList.add('text-gray-700', 'dark:text-gray-200');
                }
                if (langWrap) langWrap.classList.remove('hidden');
                if (clsWrap) clsWrap.classList.add('hidden');

                // 更新标签按钮样式，避免重新渲染整个标签栏
                const allLangButtons = langScrollContainer?.querySelectorAll('button');
                if (allLangButtons) {
                  allLangButtons.forEach(button => {
                    if (button.textContent === name) {
                      // 选中当前按钮
                      button.classList.remove('text-gray-700', 'dark:text-gray-200');
                      button.classList.add('bg-blue-500', 'text-white', 'border-blue-500');
                      button.classList.add('font-bold');
                      button.id = 'selected-language-btn';
                    } else {
                      // 取消其他按钮的选中状态
                      button.classList.remove('bg-blue-500', 'text-white', 'border-blue-500', 'font-bold');
                      button.classList.add('text-gray-700', 'dark:text-gray-200');
                      if (button.id === 'selected-language-btn') {
                        button.removeAttribute('id');
                      }
                    }
                  });
                }

                // 加载对应语种的歌曲
                const container = this.modal?.querySelector('#top-songs-container');
                if (container) {
                  // 确保服务已初始化
                  this.initServices().then(() => {
                    this.loadSongs(container, 1);
                  });
                }
              }
            } else {
              if (this.selectedCategoryCode === code && this.currentMode === 'category') {
                // 再次点击已选分类，回到全部
                this.setMode('top', {});
              } else {
                // 切换到分类模式
                this._lastSelector = 'category';
                this.selectedCategoryCode = code;
                this.currentMode = 'category';
                this.page = 1;
                // 更新过滤参数
                this.filterParams = { categoryCode: code };

                // 更新选择器样式
                if (clsSelector) {
                  clsSelector.classList.remove('text-gray-700', 'dark:text-gray-200');
                  clsSelector.classList.add('bg-blue-500', 'text-white');
                }
                if (langSelector) {
                  langSelector.classList.remove('bg-blue-500', 'text-white');
                  langSelector.classList.add('text-gray-700', 'dark:text-gray-200');
                }
                if (clsWrap) clsWrap.classList.remove('hidden');
                if (langWrap) langWrap.classList.add('hidden');

                // 更新标签按钮样式，避免重新渲染整个标签栏
                const allClsButtons = clsScrollContainer?.querySelectorAll('button');
                if (allClsButtons) {
                  allClsButtons.forEach(button => {
                    if (button.textContent === name) {
                      // 选中当前按钮
                      button.classList.remove('text-gray-700', 'dark:text-gray-200');
                      button.classList.add('bg-blue-500', 'text-white', 'border-blue-500');
                      button.classList.add('font-bold');
                      button.id = 'selected-classify-btn';
                    } else {
                      // 取消其他按钮的选中状态
                      button.classList.remove('bg-blue-500', 'text-white', 'border-blue-500', 'font-bold');
                      button.classList.add('text-gray-700', 'dark:text-gray-200');
                      if (button.id === 'selected-classify-btn') {
                        button.removeAttribute('id');
                      }
                    }
                  });
                }

                // 加载对应分类的歌曲
                const container = this.modal?.querySelector('#top-songs-container');
                if (container) {
                  // 确保服务已初始化
                  this.initServices().then(() => {
                    this.loadSongs(container, 1);
                  });
                }
              }
            }
          });
          scrollContainer.appendChild(btn);
        });

        // 更多/收起 切换
        if (list.length > 5) {
          const t = (key) => window.langService ? window.langService.t(key) : key;
          const moreBtn = document.createElement('button');
          moreBtn.className = 'px-3 py-2 ml-1 rounded-lg border text-sm whitespace-nowrap border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 flex-shrink-0';
          moreBtn.textContent = expanded ? t('collapse') : t('more');
          moreBtn.addEventListener('click', () => {
            if (type === 'language') this._langExpanded = !expanded;
            else this._clsExpanded = !expanded;
            // 设置自动滚动标志
            this._autoScrollToSelected = true;
            this.renderQuickCategories();
          });
          scrollContainer.appendChild(moreBtn);
        }

        // 如果没有任何数据，显示提示信息
        if (list.length === 0) {
          const t = (key) => window.langService ? window.langService.t(key) : key;
          const noDataText = document.createElement('div');
          noDataText.className = 'text-gray-500 dark:text-gray-400 text-sm py-2';
          noDataText.textContent = t('noData');
          scrollContainer.appendChild(noDataText);
        }

        wrap.appendChild(scrollContainer);

        // 修复：确保选中的标签保持可见
        if (selectedCode) {
          // 等待DOM更新完成后滚动到选中的标签
          setTimeout(() => {
            const selectedBtn = scrollContainer.querySelector(`#selected-${type}-btn`);
            if (selectedBtn) {
              // 计算选中按钮相对于容器的位置
              const containerRect = scrollContainer.getBoundingClientRect();
              const btnRect = selectedBtn.getBoundingClientRect();

              // 计算需要滚动的距离，使选中按钮居中显示
              const scrollLeft = btnRect.left - containerRect.left - (containerRect.width / 2) + (btnRect.width / 2);
              scrollContainer.scrollBy({ left: scrollLeft, behavior: 'smooth' });
            }
          }, 0);
        }
      };

      // 优化日志输出，只在开发环境中输出详细信息
      if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {

      }
      renderGroup(langWrap, languages, 'language');
      // 优化日志输出，只在开发环境中输出详细信息
      if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {

      }
      renderGroup(clsWrap, classifies, 'category');

      this.updateSelectorState();

      // 重置自动滚动标志，避免不必要的滚动
      this._autoScrollToSelected = false;
    } catch (e) {
      // 优化日志输出，只在开发环境中输出详细信息
      if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
        console.warn('[SongTopUI] 渲染快速分类失败:', e);
      }
    }
  }

  async renderTopSingersBar(filteredSingers = null) {
    try {
      await this.initServices();
      const bar = this.modal.querySelector('#top-singers-bar');
      if (!bar) return;
      bar.innerHTML = '';

      let singers = [];
      if (filteredSingers) {
        // 使用过滤后的歌星列表
        singers = filteredSingers;
      } else {
        // 获取预加载的热门歌星
        singers = this.cacheService.getPreloadedTopSingers();
        if (!singers || singers.length === 0) {
          const resp = await this.singerService.getTopSingers({ page: 1, pageSize: 20 });
          singers = Array.isArray(resp) ? resp : [];
        }
      }

      singers = (singers || []).filter(s => {
        const name = s.singerName || '';
        const trimmedName = String(name).trim().toLowerCase();
        return trimmedName !== 'jd' && trimmedName !== 'dj';
      });

      // 根据屏幕宽度决定显示的歌星数量
      // 小屏设备显示4个，其他设备显示5个
      const isSmallScreen = window.innerWidth < 768; // 使用Bootstrap的sm断点
      const expanded = this._singersExpanded;
      const maxCount = expanded ? singers.length : (isSmallScreen ? 4 : 5);

      (singers || []).slice(0, maxCount).forEach(s => {
        // 调试日志：输出完整的歌星数据对象，帮助诊断字段名问题
        console.log('[SongTopUI] 渲染歌星卡片 - 原始数据:', JSON.stringify(s));
        const singerNo = s.singerNo || s.id || s.singerId;

        const name = s.singerName || s.name || s.Name || '未知';
        const imgUrl = singerNo && window.AppConfig?.singerImgServer?.getUrl
          ? window.AppConfig.singerImgServer.getUrl(singerNo)
          : null;
        const item = document.createElement('div');
        item.className = 'flex-shrink-0 flex flex-col items-center w-14';
        item.innerHTML = `
          <div class="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mb-1 flex items-center justify-center relative">
            ${imgUrl ? `<img src="${imgUrl}" class="w-full h-full object-cover" onerror="this.nextElementSibling.style.display='flex'; this.style.display='none'">` : ''}
            <div class="absolute inset-0 flex items-center justify-center" style="${imgUrl ? 'display:none' : 'display:flex'}">
              <i class="fas fa-user text-gray-400 dark:text-gray-500 text-lg"></i>
            </div>
          </div>
          <div class="text-sm text-gray-700 dark:text-gray-300 truncate w-full text-center">${name}</div>
        `;
        item.addEventListener('click', async () => {
          if (singerNo) {
            await this.initServices();
            // 不关闭点歌页面，让歌星页面覆盖在上面，返回时直接显示点歌页
            if (this.singerSongsUI && typeof this.singerSongsUI.showSingerSongsModal === 'function') {
              this.singerSongsUI.showSingerSongsModal(singerNo, name);
            } else if (this.singerUI && typeof this.singerUI.showSingerList === 'function') {
              this.singerUI.showSingerList();
            }
          }
        });
        bar.appendChild(item);
      });

      // 根据屏幕宽度和歌星总数决定是否显示"更多"按钮
      const showMoreButton = isSmallScreen ? (singers || []).length > 4 : (singers || []).length > 5;
      if (showMoreButton) {
        const t = (key) => window.langService ? window.langService.t(key) : key;
        const moreBtn = document.createElement('button');
        // 修改"更多歌星"按钮样式：与热门歌星条中的歌星项保持一致
        moreBtn.className = 'flex-shrink-0 flex flex-col items-center w-14';
        moreBtn.innerHTML = `
          <div class="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 mb-1 flex items-center justify-center">
            <i class="fas fa-users text-gray-500 dark:text-gray-400"></i>
          </div>
          <div class="text-sm text-gray-700 dark:text-gray-300 truncate w-full text-center">${t('moreSingers')}</div>
        `;
        moreBtn.title = t('moreSingers');
        moreBtn.setAttribute('aria-label', t('moreSingers'));
        moreBtn.addEventListener('click', async () => {
          // 打开歌星列表UI（不关闭点歌页面，让歌星页覆盖在上面）
          await this.initServices();
          if (this.singerUI && typeof this.singerUI.showSingerList === 'function') {
            this.singerUI.showSingerList();
          }
        });
        bar.appendChild(moreBtn);
      }
    } catch (e) {
      // 优化日志输出，只在开发环境中输出详细信息
      if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
        console.warn('[SongTopUI] 渲染热门歌星失败:', e);
      }
    }
  }

  // 根据歌曲ID刷新卡片UI（图标、按钮状态、标题颜色）
  updateSongCardUIById(songId) {
    const container = this.modal?.querySelector('#top-songs-container');
    if (!container || !songId) return;
    const card = container.querySelector(`.song-card[data-song-id="${songId}"]`);
    if (!card) return;

    const addBtn = card.querySelector('.add-btn');
    const titleEl = card.querySelector('h3');

    const isRequested = this.songService?.isSongRequested(songId) || false;
    const isDisabled = isRequested || addBtn?.dataset.pending === 'true';
    const songIndex = this.songService?.getSelectedSongIndex(songId) ?? -1;
    const iconHtml = isRequested
      ? '<i class="fa fa-check text-sm" aria-label="已选"></i>'
      : '<i class="fa fa-plus text-sm"></i>';

    if (addBtn) {
      addBtn.innerHTML = iconHtml;
      if (isDisabled) {
        addBtn.disabled = true;
        addBtn.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        addBtn.disabled = false;
        addBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }

    // 更新标题颜色
    if (titleEl) {
      if (isRequested && songIndex >= 0) {
        titleEl.classList.add('text-red-500');
      } else {
        titleEl.classList.remove('text-red-500');
      }
    }
  }

  // 刷新当前列表中所有可见歌曲卡片
  updateAllSongCardsUI() {
    const container = this.modal?.querySelector('#top-songs-container');
    if (!container) return;
    const cards = container.querySelectorAll('.song-card[data-song-id]');
    cards.forEach(card => {
      const id = card.dataset.songId;
      if (id) this.updateSongCardUIById(id);
    });
  }

  openTopModal() {
    if (!this.modal) this.initTopModal();
    this.modal.classList.remove('hidden');
    this.modal.classList.remove('opacity-0');
    this._resizeHandler = () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        this.renderTopSingersBar();
      }, 100);
    };
    window.addEventListener('resize', this._resizeHandler);

    if (this._songSyncCleanup) {
      this._songSyncCleanup();
      this._songSyncCleanup = null;
    }
    const bindSongSync = async () => {
      let songSyncManager = window.songSyncManager || null;
      if (!songSyncManager && window.moduleLoader) {
        songSyncManager = await window.moduleLoader.load('songSyncManager');
      }
      if (songSyncManager && typeof songSyncManager.addSyncListener === 'function') {
        this._songSyncCleanup = songSyncManager.addSyncListener(() => this.updateAllSongCardsUI());
      }
    };
    bindSongSync();
    const container = this.modal.querySelector('#top-songs-container');
    const loadDataAndInit = async () => {
      try {
        await this.initServices();
        const svc = this.songService || (typeof window !== 'undefined' ? window.songService : null);
        if (svc && typeof svc.setBlockWsPlaylistApply === 'function') {
          svc.setBlockWsPlaylistApply(true);
        }
        try {
          if (svc && typeof svc.applyPlayListSnapshot === 'function') {
            svc.applyPlayListSnapshot([], { source: 'openSongTop-reset', emitEvent: true });
          }
          if (svc && typeof svc.syncRequestedSongsFromServer === 'function') {
            await svc.syncRequestedSongsFromServer({
              force: true,
              immediate: true
            });
          }
        } catch (syncErr) {
          console.warn('[SongTopUI] 打开点歌前同步已选失败', syncErr);
        } finally {
          if (svc && typeof svc.setBlockWsPlaylistApply === 'function') {
            svc.setBlockWsPlaylistApply(false);
          }
        }
        this._skipSongCacheOnce = true;
        if (container && container.dataset.loading !== 'true') {
          await this.loadSongs(container, 1);
        }
        this.updateAllSongCardsUI();
      } catch (err) {
        console.error('[SongTopUI] 打开点歌加载失败', err);
      }
    };
    requestAnimationFrame(() => {
      setTimeout(() => this.updateAllSongCardsUI(), 0);
      loadDataAndInit();
    });
    setTimeout(() => {
      const content = this.modal.querySelector('.relative');
      if (content) content.style.transform = 'translateY(0)';
    }, 10);
  }

  closeTopModal() {
    if (!this.modal) return;
    const content = this.modal.querySelector('.relative');
    if (content) content.style.transform = 'translateY(100%)';

    // 移除窗口大小改变监听器
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }

    // 移除同步事件监听器
    if (this._songSyncCleanup) {
      this._songSyncCleanup();
      this._songSyncCleanup = null;
    }

    setTimeout(() => this.modal.classList.add('hidden'), 300);
  }

  /**
   * 返回主页
   */
  goToHome() {
    // 关闭当前模态框
    this.closeTopModal();

    // 触发返回主页的事件
    document.dispatchEvent(new CustomEvent('navigateToHome'));
  }

  showTopSongsModal() {
    this.openTopModal();
  }
}

const songTopUI = new SongTopUI();
export default songTopUI;
