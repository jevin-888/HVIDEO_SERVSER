// 专用歌星歌曲页面 UI
let songService;
let songTopUI;
let toastService;

class SingerSongsUI {
  constructor() {
    this.modal = null;
    this.singerNo = null;
    this.singerName = '';
    this.page = 1;
    this.size = 20;
    this.loading = false;
    this.keyword = '';
    this._songMetaCache = new Map();
  }

   async initServices() {
    songService = window.songService || songService;
    songTopUI = window.songTopUI || songTopUI;
    toastService = window.toastService || toastService;

    this.songService = songService;
    this.songTopUI = songTopUI;
    this.toastService = toastService;
    return true;
  }

  showSingerSongsModal(singerNo, singerName = '') {
    this.singerNo = singerNo;
    this.singerName = singerName || '';
    this.page = 1;
    this.keyword = '';
    this._songMetaCache.clear();
    this._loadedPages = {};
    this._allLoadedSongs = [];

    if (!this.modal) {
      this.modal = document.createElement('div');
      this.modal.id = 'singerSongsModal';
      this.modal.className = 'fixed inset-0 z-[9999] hidden opacity-0 transition-opacity duration-300';
      this.modal.innerHTML = `
        <div class="absolute inset-0 w-full h-full overflow-hidden transform translate-y-full transition-transform duration-300 bg-white dark:bg-gray-900">
          <!-- 头部 -->
          <div class="p-4 flex items-center gap-3 border-b border-gray-200 dark:border-gray-700">
            <button class="close-btn px-3 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400" title="返回">
              <i class="fas fa-arrow-left"></i>
            </button>
            <div class="flex-1">
              <div class="text-base font-semibold text-gray-800 dark:text-white">歌星歌曲 ${this.singerName ? ' - ' + this.singerName : ''}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400">仅显示该歌星的歌曲</div>
            </div>
          </div>
          <!-- 搜索输入 -->
          <div class="px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-800">
            <div class="relative">
              <input id="singer-song-search-input" type="text" placeholder="在该歌星中搜索歌曲" class="block w-full px-3 py-2 pl-9 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-base text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" autocomplete="off">
              <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"></i>
              <button class="clear-btn absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400" title="清空" aria-label="清空搜索">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>
          <!-- 列表容器 -->
          <div id="singer-songs-container" class="p-2 overflow-auto h-[calc(100vh-65px)]" data-loading="false"></div>
        </div>
      `;
      document.body.appendChild(this.modal);

      // 关闭/返回按钮
      const closeBtn = this.modal.querySelector('.close-btn');
      closeBtn?.addEventListener('click', () => {
        const panel = this.modal.querySelector('.transform');
        if (panel) panel.classList.add('translate-y-full');
        this.modal.classList.add('opacity-0');
        setTimeout(() => {
          this.modal.classList.add('hidden');
          // 移除同步事件监听器
          if (this._songSyncCleanup) {
            this._songSyncCleanup();
            this._songSyncCleanup = null;
          }
          // 不需要重新打开点歌页面，因为点歌页面一直保持在底层
        }, 300);
      });

      // 清空按钮
      const clearBtn = this.modal.querySelector('.clear-btn');
      const searchInput = this.modal.querySelector('#singer-song-search-input');
      clearBtn?.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
          this.keyword = '';
          // 仅清空，不刷新整体数据；保持当前页并重新渲染过滤
          this.renderCurrentPage();
          searchInput.dispatchEvent(new Event('input'));
          searchInput.focus();
        }
      });

      // 搜索输入事件（前端过滤）
      let searchTimer = null;
      searchInput?.addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          this.keyword = String(e.target.value || '').trim();
          this.renderCurrentPage();
        }, 200);
      });

      // 滚动加载
      const container = this.modal.querySelector('#singer-songs-container');
      let scrollTimer = null;
      container?.addEventListener('scroll', () => {
        if (this.loading) return;
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          const { scrollTop, scrollHeight, clientHeight } = container;
          const distanceToBottom = scrollHeight - (scrollTop + clientHeight);
          if (distanceToBottom <= 120) {
            this.loadMore();
          }
        }, 300);
      });
    }

    // 打开模态
    const panel = this.modal.querySelector('.transform');
    if (panel) panel.classList.remove('translate-y-full');
    this.modal.classList.remove('hidden');
    setTimeout(() => this.modal.classList.remove('opacity-0'), 0);

    // 监听歌曲同步事件，刷新当前卡片UI
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
    setTimeout(() => this.updateAllSongCardsUI(), 0);

    // 加载第一页
    const container = this.modal.querySelector('#singer-songs-container');
    if (container) {
      container.innerHTML = '';
      container.dataset.loading = 'false';
      this.loadSongs(1);
    }
  }

  // 根据歌曲ID刷新卡片UI
  updateSongCardUIById(songId) {
    const container = this.modal?.querySelector('#singer-songs-container');
    if (!container || !songId) return;
    const card = container.querySelector(`.song-card[data-song-id="${songId}"]`);
    if (!card) return;

    const addBtn = card.querySelector('.add-btn');
    const titleEl = card.querySelector('h3');

    const isRequested = this.songService?.isSongRequested(songId) || false;
    const isDisabled = isRequested || addBtn?.dataset.pending === 'true';
    const iconHtml = isRequested
      ? '<i class="fa fa-check text-sm" aria-label="已选"></i>'
      : '<i class="fa fa-plus text-sm"></i>';
    titleEl?.classList.toggle('text-red-500', isRequested);

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
  }

  // 刷新当前列表中所有可见歌曲卡片
  updateAllSongCardsUI() {
    const container = this.modal?.querySelector('#singer-songs-container');
    if (!container) return;
    const cards = container.querySelectorAll('.song-card[data-song-id]');
    cards.forEach(card => {
      const id = card.dataset.songId;
      if (id) this.updateSongCardUIById(id);
    });
  }

  async loadSongs(page = 1) {
    if (this.loading) return;
    const container = this.modal?.querySelector('#singer-songs-container');
    if (!container) return;
    this.loading = true;
    container.dataset.loading = 'true';
    try {
      await this.initServices();
      const result = await this.songService.loadSongsByMode('singer', { primarySingerNo: this.singerNo }, page, this.size);
      const songs = this.songService.normalizeSongs(result.list || []);

      // 缓存已加载的数据
      if (!this._loadedPages) this._loadedPages = {};
      this._loadedPages[page] = songs;

      // 合并所有已加载页的数据（用于搜索过滤）
      this._allLoadedSongs = [];
      for (let p = 1; p <= page; p++) {
        if (this._loadedPages[p]) {
          this._allLoadedSongs.push(...this._loadedPages[p]);
        }
      }

      if (this.keyword) {
        // 搜索模式：用缓存数据做前端过滤，需要全部重渲染
        const filtered = this._filterSongs(this._allLoadedSongs);
        this.renderSongs(filtered, container, 1);
      } else {
        // 非搜索模式：追加新数据即可，不重建整个列表
        this.renderSongs(songs, container, page);
      }
      this.page = page;
    } catch (e) {
      console.error('[SingerSongsUI] 加载歌星歌曲失败:', e);
      const errorEl = document.createElement('div');
      errorEl.className = 'text-center text-red-500 py-10';
      errorEl.textContent = '加载失败，请稍后重试';
      container.appendChild(errorEl);
      setTimeout(() => errorEl.remove(), 3000);
    } finally {
      this.loading = false;
      container.dataset.loading = 'false';
    }
  }

  // 前端过滤（使用缓存的所有已加载数据）
  _filterSongs(songs) {
    const kw = this.keyword.toLowerCase();
    if (!kw) return songs;
    return songs.filter(s => {
      const meta = this.getSongMeta(s);
      return meta.lowerName.includes(kw) || meta.pinyin.includes(kw) || meta.initials.includes(kw);
    });
  }

  async loadMore() {
    const container = this.modal?.querySelector('#singer-songs-container');
    if (!container || container.dataset.loading === 'true') return;
    await this.loadSongs(this.page + 1);
  }

  renderSongs(songs, container, page) {
    if (page === 1) container.innerHTML = '';
    const grid = container.querySelector('.grid') || document.createElement('div');
    if (!grid.parentNode) {
      grid.className = 'grid grid-cols-1 gap-1';
      // 提升滚动性能
      grid.style.willChange = 'transform';
      grid.style.contain = 'layout style';
      container.appendChild(grid);
    }
    if (page === 1) grid.innerHTML = '';

    if (!songs || songs.length === 0) {
      if (page === 1) {
        const emptyEl = document.createElement('p');
        emptyEl.className = 'text-center text-gray-500 dark:text-gray-400 py-10';
        emptyEl.textContent = this.keyword ? '该歌星下无匹配歌曲' : '该歌星暂无歌曲';
        grid.appendChild(emptyEl);
      }
      return;
    }

    const frag = document.createDocumentFragment();
    songs.forEach(song => {
      const card = this.songTopUI.createSongCard(song);
      frag.appendChild(card);
    });
    requestAnimationFrame(() => {
      grid.appendChild(frag);
    });
  }

  renderCurrentPage() {
    const container = this.modal?.querySelector('#singer-songs-container');
    if (!container) return;
    // 使用已缓存的数据做前端过滤渲染，不重新请求API
    if (this._allLoadedSongs && this._allLoadedSongs.length > 0) {
      const filtered = this._filterSongs(this._allLoadedSongs);
      this.renderSongs(filtered, container, 1);
    } else {
      this.loadSongs(this.page);
    }
  }

  // 生成歌曲搜索元数据：名称、拼音、首字母
  getSongMeta(song) {
    const id = song.songNo;
    const name = String(song.songName || '');
    const cached = id && this._songMetaCache.get(id);
    if (cached) return cached;

    const lowerName = name.toLowerCase();
    let pinyinText = '';
    let initials = '';
    try {
      const pinyin = window.pinyinPro?.pinyin;
      if (pinyin && name && /[\u4e00-\u9fa5]/.test(name)) {
        const str = pinyin(name, { toneType: 'none' });
        pinyinText = String(str || '').toLowerCase();
        initials = pinyinText
          .split(/\s+/)
          .map(syl => syl[0] || '')
          .join('');
      } else {
        // 非中文或无库时，直接用名称的字母作为匹配基础
        pinyinText = lowerName;
        initials = lowerName.replace(/[^a-z]/g, '');
      }
    } catch (e) {
      pinyinText = lowerName;
      initials = lowerName.replace(/[^a-z]/g, '');
    }

    const meta = { lowerName, pinyin: pinyinText, initials };
    if (id) this._songMetaCache.set(id, meta);
    return meta;
  }
}

const singerSongsUI = new SingerSongsUI();
export default singerSongsUI;
