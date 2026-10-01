class PartyUI {
  constructor() {
    this.modal = null;
    this.carousel = null;
    this.songService = null;
    this.singerService = null;
    this.toastService = null;
    this.cacheService = null;
    this.songSearchService = null;
    this.singerUI = null;
    this.singerSongsUI = null;
    this.songTopUI = null;
    this.songSyncManager = null; // 添加同步管理器引用
    this._songSyncCleanup = null;
    this._bindSongSyncListener();
  }

  async _bindSongSyncListener() {
    try {
      let songSyncManager = window.songSyncManager || null;
      if (!songSyncManager && window.moduleLoader) {
        songSyncManager = await window.moduleLoader.load('songSyncManager');
      }
      if (!songSyncManager || typeof songSyncManager.addSyncListener !== 'function') {
        return;
      }

      if (this._songSyncCleanup) {
        this._songSyncCleanup();
      }

      this._songSyncCleanup = songSyncManager.addSyncListener(() => {
        requestAnimationFrame(() => {
          this.updateSongListUI();
        });
      });
    } catch (_) {
      // 静默忽略
    }
  }

   async initServices() {
    this.songService = window.songService || this.songService;
    this.singerService = window.singerService || this.singerService;
    this.toastService = window.toastService || this.toastService;
    this.cacheService = window.cacheService || this.cacheService;
    this.songSearchService = window.songSearchService || this.songSearchService;
    this.singerUI = window.singerUI || this.singerUI;
    this.singerSongsUI = window.singerSongsUI || this.singerSongsUI;
    this.songTopUI = window.songTopUI || this.songTopUI;
    this.songSyncManager = window.songSyncManager || this.songSyncManager;
    return true;
  }

  /**
   * 初始化派对模态框
   */
  initPartyModal() {
    if (this.modal) return;

    this.modal = document.createElement('div');
    this.modal.id = 'party-modal';
    this.modal.className = 'fixed inset-0 z-[10000] hidden opacity-0 transition-opacity duration-300 bg-black bg-opacity-50 flex items-start justify-center';

    this.modal.innerHTML = `
      <div class="relative w-full max-w-4xl bg-white dark:bg-gray-900 rounded-lg shadow-xl flex flex-col transform translate-y-full transition-transform duration-300">
        <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center flex-shrink-0">
          <h2 class="text-xl font-bold text-gray-800 dark:text-white">
            <i class="fas fa-glass-cheers mr-2"></i>派对模式
          </h2>
          <button class="close-party-modal text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <div class="flex-1 min-h-0 flex flex-col">
          <!-- 可滚动内容区域 -->
          <div class="flex-1 min-h-0 overflow-y-auto p-4 bg-white dark:bg-gray-900 rounded-lg flex flex-col">
            <div class="grid grid-cols-2 md:grid-cols-3 gap-3" id="party-categories-container">
              <button class="party-category-btn bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-lg p-4 flex flex-col items-center justify-center hover:opacity-90 transition-opacity" data-category-id="11">
                <i class="fas fa-compact-disc text-2xl mb-2"></i>
                <span>DISCO</span>
              </button>
              <button class="party-category-btn bg-gradient-to-r from-pink-500 to-red-500 text-white rounded-lg p-4 flex flex-col items-center justify-center hover:opacity-90 transition-opacity" data-category-id="27">
                <i class="fas fa-headphones-alt text-2xl mb-2"></i>
                <span>DJ歌曲</span>
              </button>
              <button class="party-category-btn bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg p-4 flex flex-col items-center justify-center hover:opacity-90 transition-opacity" data-category-id="56">
                <i class="fas fa-headphones text-2xl mb-2"></i>
                <span>DISCO-畅听</span>
              </button>
              <button class="party-category-btn bg-gradient-to-r from-gray-500 to-dark-gray-500 text-white rounded-lg p-4 flex flex-col items-center justify-center hover:opacity-90 transition-opacity" data-category-id="59">
                <i class="fas fa-microphone-alt text-2xl mb-2"></i>
                <span>说唱</span>
              </button>
              <button class="party-category-btn bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg p-4 flex flex-col items-center justify-center hover:opacity-90 transition-opacity" data-category-id="60">
                <i class="fas fa-crown text-2xl mb-2"></i>
                <span>世界百大DJ</span>
              </button>
              <button class="party-category-btn bg-gradient-to-r from-yellow-600 to-orange-600 text-white rounded-lg p-4 flex flex-col items-center justify-center hover:opacity-90 transition-opacity" data-category-id="61">
                <i class="fas fa-glass-martini-alt text-2xl mb-2"></i>
                <span>酒吧音乐</span>
              </button>
              <button class="party-category-btn bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-lg p-4 flex flex-col items-center justify-center hover:opacity-90 transition-opacity" data-category-id="69">
                <i class="fas fa-video text-2xl mb-2"></i>
                <span>DJ现场</span>
              </button>
              <button class="party-category-btn bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg p-4 flex flex-col items-center justify-center hover:opacity-90 transition-opacity" data-category-id="70">
                <i class="fas fa-heart text-2xl mb-2"></i>
                <span>主题派对</span>
              </button>
            </div>
            <div id="party-songs-container" class="hidden mt-4 flex-1 min-h-0 flex flex-col overflow-hidden">
              <!-- 歌曲列表将在这里渲染 -->
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.modal);

    // 动态设置模态内容高度以适配移动端视口与底部导航
    this.updateModalHeight();
    if (!this._boundUpdateModalHeight) {
      this._boundUpdateModalHeight = this.updateModalHeight.bind(this);
      window.addEventListener('resize', this._boundUpdateModalHeight);
      window.addEventListener('orientationchange', this._boundUpdateModalHeight);
    }

    // 绑定关闭事件
    const closeBtn = this.modal.querySelector('.close-party-modal');
    closeBtn.addEventListener('click', () => {
      this.closePartyModal();
    });

    // 点击遮罩层关闭
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.closePartyModal();
      }
    });

    // 绑定派对分类按钮事件
    const partyButtons = this.modal.querySelectorAll('.party-category-btn');
    partyButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const categoryId = e.currentTarget.dataset.categoryId;
        const categoryName = e.currentTarget.querySelector('span').textContent;
        const log = typeof window !== 'undefined' && window.logService ? (msg, tag) => window.logService.info(msg, tag) : console.log;
        log(`[派对] 点击分类: id=${categoryId} ${categoryName}`, 'PartyUI');
        await this.showCategorySongs(categoryId, categoryName);
      });
    });

    // 模态框初始化完成
  }

  // 动态更新模态内容高度，适配移动端动态视口与底部导航
  updateModalHeight() {
    try {
      const content = this.modal?.querySelector('.relative');
      if (!content) return;
      const viewportHeight = (window.visualViewport && window.visualViewport.height) ? window.visualViewport.height : window.innerHeight;
      const bottomNavEl = document.getElementById('bottom-nav');
      const bottomNavHeight = bottomNavEl ? bottomNavEl.offsetHeight : 80;
      const carouselEl = document.getElementById('carousel');
      const topSection = carouselEl ? carouselEl.closest('section') : null;
      const topAreaHeight = topSection ? topSection.offsetHeight : 0;
      const heightPx = Math.max(0, Math.floor(viewportHeight - bottomNavHeight - topAreaHeight));
      // 内容高度恰好填满“轮播图底部”到“底部导航”之间
      content.style.height = heightPx + 'px';
      content.style.marginTop = topAreaHeight + 'px';
      content.style.marginBottom = bottomNavHeight + 'px';
    } catch (e) {
      console.warn('[PartyUI] 更新模态高度失败:', e);
    }
  }

  /**
   * 更新歌曲列表UI
   */
  async updateSongListUI() {
    // 如果当前显示的是歌曲列表，则更新UI
    const songsContainer = this.modal.querySelector('#party-songs-container');
    if (songsContainer && !songsContainer.classList.contains('hidden')) {
      // 保存当前滚动位置
      const scrollArea = songsContainer.querySelector('.flex-1.overflow-y-auto.p-4');
      const scrollTop = scrollArea ? scrollArea.scrollTop : 0;

      // 不重新渲染整个列表，而是只更新卡片状态
      // 更新所有歌曲卡片的UI状态
      updateAllSongCardsUI();

      // 恢复滚动位置（如果需要的话）
      if (scrollArea) {
        // 使用setTimeout确保DOM更新完成后再设置滚动位置
        setTimeout(() => {
          scrollArea.scrollTop = scrollTop;
        }, 0);
      }
    } else {
    }
  }

  /**
   * 加载分类歌曲
   * @param {string} categoryId - 分类ID
   * @param {HTMLElement} container - 容器元素
   */
  async loadCategorySongs(categoryId, container) {
    try {
      await this.initServices();

      const result = await this.songService.loadSongsByMode('category', { categoryCode: categoryId }, 1, 20);
      const songs = this.songService.normalizeSongs(result.list || []);

      // 重新渲染歌曲列表
      const categoryName = this.getCurrentCategoryName(categoryId);
      this.renderSongs(songs, container, categoryId, categoryName);
    } catch (error) {
      console.error('加载分类歌曲失败:', error);
    }
  }

  /**
   * 获取当前分类名称
   * @param {string} categoryId - 分类ID
   * @returns {string} 分类名称
   */
  getCurrentCategoryName(categoryId) {
    const categoryMap = {
      '11': 'DISCO',
      '27': 'DJ歌曲',
      '56': 'DISCO-畅听',
      '59': '说唱',
      '60': '世界百大DJ',
      '61': '酒吧音乐',
      '69': 'DJ现场',
      '70': '主题派对'
    };

    return categoryMap[categoryId] || '未知分类';
  }

  /**
   * 显示分类歌曲列表
   * @param {string} categoryId - 分类ID
   * @param {string} categoryName - 分类名称
   */
  async showCategorySongs(categoryId, categoryName) {
    const log = typeof window !== 'undefined' && window.logService ? (msg, tag) => window.logService.info(msg, tag) : console.log;
    try {
      log(`[派对] 开始加载分类歌曲: categoryCode=${categoryId}`, 'PartyUI');
      await this.initServices();
      if (!this.songService) {
        log('[派对] songService 未初始化，无法加载分类歌曲', 'PartyUI');
        if (this.toastService) this.toastService.showToast('服务未就绪，请重试', 'error', 800);
        return;
      }

      // 隐藏分类卡片容器
      const categoriesContainer = this.modal.querySelector('#party-categories-container');
      categoriesContainer.classList.add('hidden');

      // 显示歌曲容器
      const songsContainer = this.modal.querySelector('#party-songs-container');
      songsContainer.classList.remove('hidden');

      // 更新标题
      const titleElement = this.modal.querySelector('h2');
      titleElement.innerHTML = `<i class="fas fa-glass-cheers mr-2"></i>${categoryName}`;

      // 显示加载提示
      if (this.toastService) {
        this.toastService.showToast(`正在加载${categoryName}歌曲...`, 'info', 800);
      }

      // 调用歌曲服务获取分类歌曲
      log(`[派对] 调用 loadSongsByMode(category, { categoryCode: ${categoryId} }, 1, 20)`, 'PartyUI');
      const result = await this.songService.loadSongsByMode('category', { categoryCode: categoryId }, 1, 20);
      const songs = this.songService.normalizeSongs(result.list || []);
      const count = Array.isArray(songs) ? songs.length : 0;
      log(`[派对] 分类歌曲返回: ${count} 条`, 'PartyUI');

      // 渲染歌曲列表
      this.renderSongs(songs, songsContainer, categoryId, categoryName);

    } catch (error) {
      const errMsg = error && (error.message || String(error));
      log(`[派对] 显示分类歌曲列表失败: ${errMsg}`, 'PartyUI');
      if (typeof console !== 'undefined' && console.error) console.error('显示分类歌曲列表失败:', error);
      if (this.toastService) {
        this.toastService.showToast('加载歌曲列表失败', 'error', 800);
      }
    }
  }

  /**
   * 渲染歌曲列表
   * @param {Array} songs - 歌曲列表
   * @param {HTMLElement} container - 容器元素
   * @param {string} categoryId - 分类ID
   * @param {string} categoryName - 分类名称
   */
  renderSongs(songs, container, categoryId, categoryName) {
    // 确保songs是数组格式
    if (!Array.isArray(songs)) {
      console.warn('歌曲数据不是数组格式:', songs);
      songs = [];
    }

    if (!container) return;

    // 清空容器
    container.innerHTML = '';

    // 创建搜索框和返回按钮的头部
    const header = document.createElement('div');
    header.className = 'mb-4 flex items-center flex-shrink-0';

    header.innerHTML = `
      <button class="back-to-categories mr-3 text-gray-500 hover:text-blue-500 dark:text-gray-400 dark:hover:text-blue-400" title="返回分类">
        <i class="fas fa-arrow-left"></i>
      </button>
      <div class="flex-1 relative">
        <input type="text" placeholder="搜索歌曲..." class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-0 focus:ring-offset-0 focus:border-blue-500 transition-colors search-input" data-category-id="${categoryId}">
        <i class="fas fa-search absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
      </div>
    `;

    container.appendChild(header);

    // 创建主内容容器
    const mainContainer = document.createElement('div');
    mainContainer.className = 'flex-1 min-h-0 bg-white dark:bg-gray-900 rounded-lg flex flex-col overflow-hidden';

    // 创建滚动区域
    const scrollArea = document.createElement('div');
    scrollArea.className = 'flex-1 overflow-y-auto p-4';

    // 创建网格容器
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 gap-2';

    if (!songs || songs.length === 0) {
      // 显示无歌曲提示
      const noSongs = document.createElement('div');
      noSongs.className = 'text-center text-gray-500 dark:text-gray-400 py-10';
      noSongs.textContent = '暂无歌曲';
      noSongs.style.minHeight = '200px';
      grid.appendChild(noSongs);
    } else {
      // 渲染歌曲卡片
      songs.forEach(song => {
        const songCard = this.createSongCard(song);
        grid.appendChild(songCard);
      });
    }

    scrollArea.appendChild(grid);
    // 初始化无限滚动参数并绑定
    scrollArea.dataset.page = '1';
    scrollArea.dataset.loading = 'false';
    scrollArea.dataset.done = 'false';
    scrollArea.dataset.mode = 'category';
    scrollArea.dataset.categoryId = categoryId;
    this.bindInfiniteScroll(scrollArea, grid);
    mainContainer.appendChild(scrollArea);
    container.appendChild(mainContainer);

    // 绑定返回按钮事件
    const backButton = container.querySelector('.back-to-categories');
    backButton.addEventListener('click', () => {
      this.showCategories();
    });

    // 绑定搜索事件
    const searchInput = container.querySelector('.search-input');
    let searchTimer = null;
    searchInput.addEventListener('input', (e) => {
      // 使用 initial 参数
      const initial = e.target.value.trim();
      const categoryId = e.target.dataset.categoryId;

      // 清除之前的定时器
      if (searchTimer) {
        clearTimeout(searchTimer);
      }

      // 设置新的定时器
      searchTimer = setTimeout(async () => {
        if (initial) {
          await this.searchSongs(initial, categoryId, container);
        } else {
          // 如果搜索关键词为空，重新加载分类歌曲
          const result = await this.songService.loadSongsByMode('category', { categoryCode: categoryId }, 1, 20);
          const songs = this.songService.normalizeSongs(result.list || []);

          this.renderSongs(songs, container, categoryId, categoryName);
        }
      }, 300);
    });

    // 添加焦点管理事件，确保搜索框不会意外失去焦点
    searchInput.addEventListener('focus', () => {
      // 确保搜索框获得焦点时不会触发不必要的行为
    });

    searchInput.addEventListener('blur', (e) => {
      // 延迟检查焦点是否真的失去，避免在快速操作时失去焦点
      setTimeout(() => {
        // 如果模态框仍然打开且搜索框没有重新获得焦点，则重新聚焦
        if (this.modal && !this.modal.classList.contains('hidden') &&
          document.activeElement !== searchInput) {
          // 只在特定条件下重新聚焦，避免干扰用户操作
          const keyword = e.target.value.trim();
          if (keyword) {
            // 保持焦点，但要确保不会干扰用户操作
            // 只在用户可能需要继续输入时才重新聚焦
            const isUserTyping = document.activeElement.tagName !== 'BUTTON' &&
              document.activeElement.tagName !== 'INPUT';
            if (isUserTyping) {
              // searchInput.focus(); // 暂时注释掉，避免干扰用户操作
            }
          }
        }
      }, 100);
    });

    // 添加键盘事件处理，特别处理退格键
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        // 确保在按退格键时保持焦点
        e.stopPropagation();
      } else if (e.key === 'Escape') {
        // ESC键可以清空搜索框并返回分类列表
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // 确保搜索框在渲染后获得焦点
    setTimeout(() => {
      if (searchInput && document.activeElement !== searchInput) {
        searchInput.focus();
      }
    }, 100);

    // 同步已点播歌曲状态
    this.syncRequestedSongsState();
  }

  // 无限滚动绑定：监听滚动到底部加载更多
  bindInfiniteScroll(scrollArea, grid) {
    // 移除旧的绑定，避免重复触发
    if (scrollArea._onScrollInfinite) {
      scrollArea.removeEventListener('scroll', scrollArea._onScrollInfinite);
    }
    const handler = async () => {
      if (scrollArea.dataset.done === 'true') return;
      const loading = scrollArea.dataset.loading === 'true';
      const nearBottom = scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 50;
      if (nearBottom && !loading) {
        await this.loadMoreSongs(scrollArea, grid);
      }
    };
    scrollArea._onScrollInfinite = handler;
    scrollArea.addEventListener('scroll', handler);
  }

  // 加载更多歌曲并追加到网格
  async loadMoreSongs(scrollArea, grid) {
    try {
      scrollArea.dataset.loading = 'true';
      const page = parseInt(scrollArea.dataset.page || '1', 10);
      const nextPage = page + 1;
      const mode = scrollArea.dataset.mode || 'category';
      const categoryId = scrollArea.dataset.categoryId;
      const initial = scrollArea.dataset.initial || '';
      await this.initServices();

      let params = {};
      if (mode === 'search') params = { initial, categoryCode: categoryId };
      else params = { categoryCode: categoryId };

      const result = await this.songService.loadSongsByMode(mode, params, nextPage, 20);
      const songs = this.songService.normalizeSongs(result.list || []);

      if (!songs || songs.length === 0) {
        scrollArea.dataset.done = 'true';
      } else {
        songs.forEach(song => {
          const songCard = this.createSongCard(song);
          grid.appendChild(songCard);
        });
        scrollArea.dataset.page = String(nextPage);
        // 追加后立即更新卡片UI状态，以反映点播情况
        updateAllSongCardsUI();
      }
    } catch (error) {
      console.error('[PartyUI] 加载更多歌曲失败:', error);
      if (this.toastService) {
        this.toastService.showToast('加载更多失败', 'error', 800);
      }
    } finally {
      scrollArea.dataset.loading = 'false';
    }
  }

  /**
   * 搜索歌曲
   * @param {string} initial - 搜索首字母
   * @param {string} categoryId - 分类ID
   * @param {HTMLElement} container - 容器元素
   */
  async searchSongs(initial, categoryId, container) {
    try {
      await this.initServices();

      // 显示加载提示
      if (this.toastService) {
        this.toastService.showToast(`搜索"${initial}"...`, 'info', 500);
      }

      // 调用歌曲服务搜索歌曲，使用search模式
      // 修复：确保搜索在当前分类范围内进行，传递分类编码参数
      // 使用 initial 参数
      const result = await this.songService.loadSongsByMode('search', { initial, categoryCode: categoryId }, 1, 20);
      const songs = this.songService.normalizeSongs(result.list || []);

      // 渲染搜索结果
      const grid = container.querySelector('.grid');
      if (grid) {
        grid.innerHTML = '';

        if (!songs || songs.length === 0) {
          // 显示无结果提示
          const noResults = document.createElement('div');
          noResults.className = 'text-center text-gray-500 dark:text-gray-400 py-10';
          noResults.textContent = '未找到相关歌曲';
          grid.appendChild(noResults);
        } else {
          // 渲染搜索结果
          songs.forEach(song => {
            const songCard = this.createSongCard(song);
            grid.appendChild(songCard);
          });
        }

        // 为搜索结果设置无限滚动
        const scrollArea = container.querySelector('.flex-1.overflow-y-auto.p-4');
        if (scrollArea) {
          scrollArea.dataset.page = '1';
          scrollArea.dataset.loading = 'false';
          scrollArea.dataset.done = 'false';
          scrollArea.dataset.mode = 'search';
          scrollArea.dataset.categoryId = categoryId;
          scrollArea.dataset.initial = initial;
          this.bindInfiniteScroll(scrollArea, grid);
        }
      }
    } catch (error) {
      console.error('搜索歌曲失败:', error);
      if (this.toastService) {
        this.toastService.showToast('搜索失败', 'error', 800);
      }
    }
  }

  /**
   * 显示分类卡片
   */
  showCategories() {
    // 显示分类卡片容器
    const categoriesContainer = this.modal.querySelector('#party-categories-container');
    categoriesContainer.classList.remove('hidden');

    // 隐藏歌曲容器
    const songsContainer = this.modal.querySelector('#party-songs-container');
    songsContainer.classList.add('hidden');

    // 恢复标题
    const titleElement = this.modal.querySelector('h2');
    titleElement.innerHTML = '<i class="fas fa-glass-cheers mr-2"></i>派对模式';
  }

  /**
   * 创建歌曲卡片
   * @param {Object} song - 歌曲对象
   * @returns {HTMLElement} 歌曲卡片元素
   */
  createSongCard(song) {
    const card = document.createElement('div');
    card.className = 'song-card bg-white dark:bg-gray-800 rounded-lg shadow-sm p-3 flex items-center hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors';
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

    // 检查是否已点播以及在已选列表中的位置，决定按钮图标与禁用状态
    let iconHtml = '<i class="fa fa-plus text-sm"></i>';
    let isDisabled = false;
    let isRequested = false;
    let songIndex = -1;

    if (this.songService) {
      isRequested = this.songService.isSongRequested(songId);
      if (isRequested) {
        const songInfo = this.songService.getSelectedSongInfo(songId);
        songIndex = this.songService.getSelectedSongIndex(songId);
        if (songInfo && songIndex >= 0) {
          if (songIndex === 0) {
            iconHtml = `
                <div class="playing-indicator flex items-end h-6 space-x-0.5">
                    <div class="playing-bar h-2 w-0.5 bg-green-600 dark:bg-green-400 animate-bar1"></div>
                    <div class="playing-bar h-4 w-0.5 bg-green-600 dark:bg-green-400 animate-bar2"></div>
                    <div class="playing-bar h-3 w-0.5 bg-green-600 dark:bg-green-400 animate-bar3"></div>
                </div>
            `;
            isDisabled = true; // 当前播放不可操作
          } else if (songIndex === 1) {
            iconHtml = '<i class="fa fa-step-forward text-sm text-blue-500"></i>';
            isDisabled = false; // 允许切歌
          } else if (songIndex > 1) {
            iconHtml = '<i class="fa fa-arrow-up text-sm text-blue-500"></i>';
            isDisabled = false; // 允许优先
          } else {
            iconHtml = '<i class="fa fa-arrow-up text-sm text-blue-500"></i>';
            isDisabled = true;
          }
        } else {
          iconHtml = '<i class="fa fa-arrow-up text-sm text-blue-500"></i>';
          isDisabled = true;
        }
      }
    }

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

  // 绑定卡片与加号按钮的点播/切歌/优先操作，与热门歌曲逻辑保持一致
  bindPlayEvent(songCard, song) {
    const addBtn = songCard.querySelector('.add-btn');
    // 点击整卡触发点歌
    songCard.addEventListener('click', async (e) => {
      // 阻止在按钮区域点击时触发整卡点播
      if (e.target.closest('.add-btn')) {
        return;
      }

      const songId = song.songNo;
      try {
        await this.initServices();
        await this.songService.requestSong(songId);
        if (this.toastService) {
          this.toastService.showToast('点歌成功', 'success', 800);
        }
      } catch (err) {
        console.error('[PartyUI] 点歌失败:', err);
        if (this.toastService) {
          this.toastService.showToast('操作失败', 'error', 800);
        }
      }
    });
    // 加号按钮点击事件
    if (addBtn) {
      addBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleAddBtnClick(song, addBtn);
      });
    }
  }

  // 处理加号按钮点击，复用 SongService 行为
  async handleAddBtnClick(song, addBtn) {
    const songId = song.songNo;
    if (!songId) {
      console.warn('[PartyUI] 缺少歌曲ID，无法处理点击:', song);
      return;
    }
    try {
      await this.initServices();
      const songIndex = this.songService.getSelectedSongIndex(songId);
      const songInfo = this.songService.getSelectedSongInfo(songId);
      if (songIndex >= 0 && songInfo) {
        if (songIndex === 0) {
          if (this.toastService) {
            this.toastService.showToast('当前正在播放', 'info', 800);
          }
          return;
        } else if (songIndex === 1) {
          await this.songService.playNextSong();
          if (this.toastService) {
            this.toastService.showToast('已切到下一首', 'success', 800);
          }
        } else if (songIndex > 1) {
          // 修复：直接使用songId而不是songInfo中的id
          await this.songService.prioritizeSong(songId);
          if (this.toastService) {
            this.toastService.showToast('已优先该歌曲', 'success', 800);
          }
        }
      } else {
        await this.songService.requestSong(songId);
        if (this.toastService) {
          this.toastService.showToast('点歌成功', 'success', 800);
        }
      }
    } catch (err) {
      console.error('[PartyUI] 处理按钮点击失败:', err);
      if (this.toastService) {
        this.toastService.showToast('操作失败', 'error', 800);
      }
    }
  }

  /**
   * 同步已点播歌曲状态
   */
  async syncRequestedSongsState() {
    try {
      await this.initServices();
      if (this.songService && typeof this.songService.syncRequestedSongsFromServer === 'function') {
        // 打开派对页时拉取一次权威队列状态，避免错过早期推送
        await this.songService.syncRequestedSongsFromServer({ force: true });
      }
    } catch (error) {
      console.error('初始化派对页歌曲状态失败:', error);
    }
  }

  /**
   * 显示派对模态框
   */
  showPartyModal() {
    if (!this.modal) {
      this.initPartyModal();
    }

    this.modal.classList.remove('hidden');
    this.modal.classList.remove('opacity-0');

    this.updateModalHeight();

    setTimeout(() => {
      const content = this.modal.querySelector('.relative');
      if (content) content.style.transform = 'translateY(0)';
    }, 10);
  }

  /**
   * 关闭派对模态框
   */
  closePartyModal() {
    if (!this.modal) return;

    const content = this.modal.querySelector('.relative');
    if (content) content.style.transform = 'translateY(100%)';

    setTimeout(() => {
      this.modal.classList.add('hidden');
    }, 300);
  }
}

// 更新所有歌曲卡片的UI状态
function updateAllSongCardsUI() {
  // 查找派对模态框中的所有歌曲卡片
  const songCards = document.querySelectorAll('#party-modal .song-card');
  songCards.forEach(card => {
    const songId = card.dataset.songId;
    if (songId) {
      updateSongCardUIById(songId);
    }
  });
}

// 根据歌曲ID更新单个歌曲卡片的UI状态
function updateSongCardUIById(songId) {
  // 查找派对模态框中所有匹配的歌曲卡片
  const songCards = document.querySelectorAll(`#party-modal .song-card[data-song-id="${songId}"]`);
  songCards.forEach(card => {
    // 获取歌曲服务实例
    const services = window.partyUI ? window.partyUI : null;
    if (!services || !services.songService) return;

    const songService = services.songService;

    // 获取歌曲在已选列表中的详细信息
    const songInfo = songService.getSelectedSongInfo(songId);
    const songIndex = songService.getSelectedSongIndex(songId);

    // 检查歌曲是否已被点播
    const isRequested = songService.isSongRequested(songId);
    // 更新歌曲名称颜色
    const songNameElement = card.querySelector('h3');
    if (songNameElement) {
      if (isRequested) {
        songNameElement.classList.add('text-red-500');
        songNameElement.classList.remove('text-gray-800', 'dark:text-white');
      } else {
        songNameElement.classList.remove('text-red-500');
        songNameElement.classList.add('text-gray-800', 'dark:text-white');
      }
    }

    // 更新加号按钮状态
    const addBtn = card.querySelector('.add-btn');
    if (addBtn) {
      let icon = addBtn.querySelector('i');
      // 如果找不到<i>元素，可能是因为已经被替换为播放动画
      if (!icon) {
        icon = addBtn.querySelector('.playing-indicator');
      }

      // 如果还是找不到图标元素，重新创建
      if (!icon) {
        // 清空按钮内容并重新创建图标
        addBtn.innerHTML = '<i class="fa fa-plus text-sm"></i>';
        icon = addBtn.querySelector('i');
      }

      if (icon) {
        // 重置按钮状态
        addBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        addBtn.disabled = false;

        if (isRequested && songInfo) {
          // 歌曲已被点播，根据在已选列表中的位置显示不同图标
          if (songIndex === 0) {
            // 当前播放歌曲 - 显示播放动画
            if (icon.tagName === 'I') {
              // 如果当前是<i>元素，则替换为播放动画
              icon.outerHTML = `
                  <div class="playing-indicator flex items-end h-6 space-x-0.5">
                    <div class="playing-bar h-2 w-0.5 bg-green-600 dark:bg-green-400 animate-bar1"></div>
                    <div class="playing-bar h-4 w-0.5 bg-green-600 dark:bg-green-400 animate-bar2"></div>
                    <div class="playing-bar h-3 w-0.5 bg-green-600 dark:bg-green-400 animate-bar3"></div>
                  </div>
              `;
            } else {
              // 如果已经是播放动画，则保持不变
            }
            addBtn.classList.add('opacity-50', 'cursor-not-allowed');
            addBtn.disabled = true;
          } else if (songIndex === 1) {
            // 下一首歌曲 - 显示下一首图标（切歌图标使用蓝色）
            if (icon.tagName !== 'I' || !icon.classList.contains('fa-step-forward')) {
              if (icon.tagName === 'I') {
                icon.className = 'fa fa-step-forward text-sm text-blue-500';
              } else {
                // 如果当前是播放动画，则替换为图标
                icon.outerHTML = '<i class="fa fa-step-forward text-sm text-blue-500"></i>';
                // 重新获取图标引用
                icon = addBtn.querySelector('i');
              }
            }
            // 修复：下一首歌曲的切歌按钮不应该禁用，应该允许用户点击执行切歌操作
            // 移除 opacity-50 和 cursor-not-allowed 类，保持按钮的一致外观
            addBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            addBtn.disabled = false;
          } else if (songIndex > 1) {
            // 其他已点播歌曲 - 显示优先图标（优先图标使用蓝色，与已选页面保持一致）
            if (icon.tagName !== 'I' || !icon.classList.contains('fa-arrow-up')) {
              if (icon.tagName === 'I') {
                icon.className = 'fa fa-arrow-up text-sm text-blue-500';
              } else {
                // 如果当前是播放动画或其他图标，则替换为向上箭头
                icon.outerHTML = '<i class="fa fa-arrow-up text-sm text-blue-500"></i>';
                // 重新获取图标引用
                icon = addBtn.querySelector('i');
              }
            }
            // 修复：优先按钮也不应该禁用
            // 移除 opacity-50 和 cursor-not-allowed 类，保持按钮的一致外观
            addBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            addBtn.disabled = false;
          } else {
            // 歌曲在已选列表中但索引为负数（理论上不应该发生，但为了保险起见）
            if (icon.tagName !== 'I' || !icon.classList.contains('fa-arrow-up')) {
              if (icon.tagName === 'I') {
                icon.className = 'fa fa-arrow-up text-sm text-blue-500';
              } else {
                // 如果当前是播放动画，则替换为图标
                icon.outerHTML = '<i class="fa fa-arrow-up text-sm text-blue-500"></i>';
                // 重新获取图标引用
                icon = addBtn.querySelector('i');
              }
            }
            addBtn.classList.add('opacity-50', 'cursor-not-allowed');
            addBtn.disabled = true;
          }
        } else if (isRequested) {
          // 歌曲已被点播但不在已选列表中（可能是因为列表未完全加载或正在同步中）
          // 根据项目规范，不应显示绿色对号，应保持显示加号按钮
          if (icon.tagName !== 'I' || !icon.classList.contains('fa-plus')) {
            if (icon.tagName === 'I') {
              icon.className = 'fa fa-plus text-sm';
            } else {
              // 如果当前是播放动画或其他图标，则替换为加号
              icon.outerHTML = '<i class="fa fa-plus text-sm"></i>';
              // 重新获取图标引用
              icon = addBtn.querySelector('i');
            }
          }
          // 不禁用按钮，允许用户再次点击
          addBtn.classList.remove('opacity-50', 'cursor-not-allowed');
          addBtn.disabled = false;
        } else {
          // 歌曲未被点播 - 显示加号图标
          if (icon.tagName !== 'I' || !icon.classList.contains('fa-plus')) {
            if (icon.tagName === 'I') {
              icon.className = 'fa fa-plus text-sm';
            } else {
              // 如果当前是播放动画或其他图标，则替换为加号
              icon.outerHTML = '<i class="fa fa-plus text-sm"></i>';
              // 重新获取图标引用
              icon = addBtn.querySelector('i');
            }
          }
        }
      }
    }
  });
}

// 歌曲列表更新统一由 SongSyncManager 驱动

// 监听页面加载完成事件
document.addEventListener('DOMContentLoaded', async () => {
  // 页面加载完成后同步一次服务器状态
  if (window.partyUI) {
    try {
      await window.partyUI.initServices();
      if (window.partyUI.songService && window.partyUI.songSyncManager) {
        // 添加同步监听器
        window.partyUI.songSyncManager.addSyncListener((data) => {
          if (data.type === 'playlistUpdate') {
            // 更新所有歌曲卡片的显示状态
            updateAllSongCardsUI();
          }
        });

        // 触发初始同步
        window.partyUI.songSyncManager.syncSongState();
        // 更新所有歌曲卡片的显示状态
        updateAllSongCardsUI();
      }
    } catch (error) {
      console.error('[PartyUI] 页面加载后同步服务器状态失败:', error);
    }
  }
});

const partyUI = new PartyUI();
// 将实例挂载到window对象上，以便其他函数可以访问
window.partyUI = partyUI;
export default partyUI;
