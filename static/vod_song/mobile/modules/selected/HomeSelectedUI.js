// 延迟导入，避免循环依赖
let homeSelectedService;

/**
 * 首页已选歌曲UI逻辑（独立于SelectedUI.js）
 */
class HomeSelectedUI {
  constructor() {
    this._songSyncCleanup = null;
    // 在需要时动态导入服务

    this._bindSongSyncListener();
    
    // 监听语言变化事件，更新热门歌曲标题
    document.addEventListener('languageChanged', () => {
      this.updateHotSongsTitle();
    });
    
    // 在构造函数中初始化热门歌曲标题（确保首次加载时标题正确显示）
    this.initializeHotSongsTitle();
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
        this.refreshHomeSelectedList();
      });
    } catch (error) {
      console.warn('[HomeSelectedUI] 初始化歌曲同步监听失败:', error);
    }
  }
  
  /**
   * 初始化热门歌曲标题
   */
  async initializeHotSongsTitle() {
    // 立即尝试更新标题
    try {
      await this.updateHotSongsTitle();
    } catch (error) {
      console.error('[HomeSelectedUI] 初始化热门歌曲标题失败:', error);
      // 如果立即执行失败，延迟重试
      setTimeout(async () => {
        await this.updateHotSongsTitle();
      }, 500);
    }
  }

  /**
   * 初始化服务
   */
   async initServices() {
    this.cacheService = window.cacheService || this.cacheService;
    this.songService = window.songService || this.songService;
    this.toastService = window.toastService || this.toastService;
    homeSelectedService = window.navSelectedService || homeSelectedService;
    this.selectedService = homeSelectedService;
    return true;
  }

  /**
   * 初始化首页热门歌曲列表
   */
  async initHomeSelectedList() {
    try {
      // 确保服务已初始化
      await this.initServices();

      const selectedContainer = document.getElementById('homeHotSongList');
      if (selectedContainer) {
        // 显示加载状态
        selectedContainer.innerHTML = this.renderLoadingTemplate();

        // 获取热门歌曲（使用歌曲搜索，获取最新的10首）
        let songs = [];
        try {
          // 使用 window.songService（已在 mobile/index.js 中导入并挂载）
          const svc = window.songService;
          if (!svc || typeof svc.getTopSongs !== 'function') throw new Error('songService 未初始化');
          const response = await svc.getTopSongs({ page: 1, pageSize: 50 });
          songs = (Array.isArray(response) ? response : []).slice(0, 50);
        } catch (error) {
          console.error('[HomeSelectedUI] 获取热门歌曲列表失败:', error);
        }

        // 渲染首页热门歌曲列表
        this.renderHomeSelectedList(songs, selectedContainer);
      } else {
        console.error('[HomeSelectedUI] 未找到首页热门歌曲列表容器');
      }
    } catch (err) {
      console.error('[HomeSelectedUI] 初始化首页热门歌曲失败:', err);
      const selectedContainer = document.getElementById('homeHotSongList');
      if (selectedContainer) {
        const t = (key) => window.langService ? window.langService.t(key) : key;
        selectedContainer.innerHTML = this.renderErrorTemplate(t('loadHotSongsError'), err.message || t('pleaseRetry'));
      }
    }
  }

  /**
   * 刷新首页热门歌曲列表
   */
  async refreshHomeSelectedList() {
    await this.initServices();

    // 获取面板元素
    const panel = document.getElementById('homeHotSongList');
    if (!panel) {
      console.warn('[HomeSelectedUI] 面板元素不存在: homeHotSongList');
      return;
    }

    // 初始化歌曲列表为空
    let songs = [];

    // 尝试获取热门歌曲列表
    try {
      // 导入SongService来获取歌曲列表
      const songService = window.songService; if (!songService) throw new Error('songService 未初始化');

      // 使用热门歌曲接口获取列表
      const response = await songService.getTopSongs({ page: 1, pageSize: 50 });

      // getTopSongs 已统一返回数组（shared SongService）
      songs = (Array.isArray(response) ? response : []).slice(0, 50);
      // 更新歌曲列表
      this.renderHomeSelectedList(songs, panel);
    } catch (error) {
      console.error('[HomeSelectedUI] 刷新首页热门歌曲列表失败:', error);
      // 显示错误状态
      panel.innerHTML = this.renderEmptyStateTemplate('error');
    }
  }

  /**
   * 渲染首页已选歌曲列表
   * @param {Array} songs - 歌曲列表
   * @param {HTMLElement} container - 容器元素
   */
  renderHomeSelectedList(songs, container) {
    if (!container) {
      console.error('[HomeSelectedUI] 容器元素不存在');
      return;
    }

    // 清空容器
    container.innerHTML = '';

    if (!songs || songs.length === 0) {
      container.innerHTML = this.renderEmptyStateTemplate('empty');
      return;
    }

    // 创建列表容器
    const list = document.createElement('ul');
    list.className = 'space-y-2 w-full'; // 添加 w-full 确保占满容器宽度

    // 为每首歌曲创建卡片
    songs.forEach((song, index) => {
      const songCard = this.createHomeSelectedSongCard(song, index);
      // 将 div 包装在 li 中以匹配模态框结构
      const listItem = document.createElement('li');
      listItem.className = 'w-full'; // 确保列表项占满宽度
      listItem.appendChild(songCard);
      list.appendChild(listItem);
    });

    // 将列表添加到容器
    container.appendChild(list);
  }

  /**
   * 创建首页已选歌曲卡片（更小的尺寸）
   * @param {Object} song - 歌曲对象
   * @param {number} index - 歌曲索引
   * @returns {HTMLElement} 歌曲卡片元素
   */
  createHomeSelectedSongCard(song, index) {
    // 热门歌曲使用统一样式
    const cardClass = 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800';

    const songCard = document.createElement('div');
    songCard.className = `song-card border ${cardClass} transition-all duration-200 rounded-lg py-3 px-4 mb-2 flex items-center hover:shadow-md hover:scale-[1.01] active:scale-[0.99] cursor-pointer`;

    // 获取歌曲ID
    const songId = song.songNo || song.songId || '';

    // 设置卡片数据属性
    if (songId) {
      songCard.dataset.songId = songId;
    }

    // 获取歌曲信息
    const t = (key) => window.langService ? window.langService.t(key) : key;
    const songName = song.songName || t('unknownSong');
    const singerName = song.singerNames || song.singerName || t('unknownSinger');

    // 生成拼音（如果歌曲名称是中文）
    let pinyinText = '';
    if (songName && /[一-龥]/.test(songName)) {
      try {
        // 使用pinyin-pro库生成拼音
        const pinyin = window.pinyinPro?.pinyin;
        if (pinyin) {
          pinyinText = pinyin(songName, { toneType: 'none' });
        }
      } catch (e) {
        console.warn('拼音转换失败:', e);
      }
    }

    const {
      iconHtml,
      isDisabled,
      buttonStateClass,
      titleStateClass
    } = this.getSongActionState(songId);

    // 简化的卡片布局：排名 + 歌曲信息 + 点播按钮
    songCard.innerHTML = `
      <div class="flex items-center justify-center w-8 h-8 mr-3 bg-primary/10 rounded-full text-primary font-semibold text-sm flex-shrink-0">
        ${index + 1}
      </div>
      <div class="song-info flex-1 min-w-0">
        <div class="title font-medium truncate text-base ${titleStateClass}">${songName}</div>
        ${pinyinText ? `<div class="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">${pinyinText}</div>` : ''}
        <div class="flex items-center text-xs flex-wrap gap-1 mt-1">
          <span class="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 truncate">
            ${singerName}
          </span>
        </div>
      </div>
      <button class="select-song-btn text-primary hover:text-primary-dark transition-colors flex-shrink-0 ${buttonStateClass} ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}" data-song-id="${songId}" ${isDisabled ? 'disabled' : ''}>
        <div class="w-10 h-10 flex items-center justify-center bg-primary/10 hover:bg-primary/20 rounded-full transition-colors">
          ${iconHtml}
        </div>
      </button>
    `;

    songCard.addEventListener('click', async (e) => {
      if (e.target.closest('.select-song-btn')) {
        return;
      }
      await this.selectSong(songId, songName, singerName);
    });

    // 添加点击事件来执行按钮动作
    const selectBtn = songCard.querySelector('.select-song-btn');
    if (selectBtn) {
      selectBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleSongAction(songId, songName, singerName);
      });
    }

    return songCard;
  }

  getSongActionState(songId) {
    const defaultState = {
      iconHtml: '<i class="fa fa-plus text-lg"></i>',
      isDisabled: false,
      buttonStateClass: '',
      titleStateClass: 'text-neutral-800 dark:text-white'
    };

    if (!songId || !this.songService) {
      return defaultState;
    }

    const songIdStr = String(songId);
    const isRequested = this.songService.isSongRequested(songIdStr);
    if (!isRequested) {
      return defaultState;
    }

    return {
      iconHtml: '<i class="fa fa-check text-lg" aria-label="已选"></i>',
      isDisabled: true,
      buttonStateClass: '',
      titleStateClass: 'text-red-500'
    };
  }

  async handleSongAction(songId, songName, singerName) {
    if (!songId) return;
    await this.selectSong(songId, songName, singerName);
  }

  /**
   * 点播歌曲
   * @param {string} songId - 歌曲ID
   * @param {string} songName - 歌曲名称
   * @param {string} singerName - 歌手名称
   */
  async selectSong(songId, songName, singerName) {
    try {
      await this.initServices();

      // 导入SongService来点播歌曲
      // 共享 SongService 统一通过 requestSong(songId) 点歌
      await this.songService.requestSong(songId);

      // 显示成功提示
      const t = (key) => window.langService ? window.langService.t(key) : key;
      this.showToast(`${t('songSelected')}《${songName}》`, 'success');
      await this.refreshHomeSelectedList();
    } catch (error) {
      console.error('[HomeSelectedUI] 点播失败:', error);
      const t = (key) => window.langService ? window.langService.t(key) : key;
      this.showToast(t('selectSongFailed'), 'error');
    }
  }

  /**
   * 添加交互效果
   * @param {HTMLElement} element - 元素
   */
  addInteractionEffects(element) {
    const resetScale = () => element.style.transform = 'scale(1)';

    element.addEventListener('mousedown', () => {
      element.style.transform = 'scale(0.98)';
    });

    element.addEventListener('mouseup', resetScale);
    element.addEventListener('mouseleave', resetScale);

    element.addEventListener('touchstart', () => {
      element.style.transform = 'scale(0.98)';
    }, { passive: true });

    element.addEventListener('touchend', resetScale, { passive: true });
    element.addEventListener('touchcancel', resetScale, { passive: true });
  }

  /**
   * 渲染空状态模板
   * @param {string} type - 状态类型 ('error' | 'empty')
   * @returns {string} HTML字符串
   */
  renderEmptyStateTemplate(type = 'empty') {
    const t = (key) => window.langService ? window.langService.t(key) : key;
    if (type === 'error') {
      return `
        <div class="flex-col items-center justify-center py-12 h-full">
          <div class="text-gray-400 dark:text-gray-500 text-4xl mb-4 flex justify-center">
            <i class="fa fa-exclamation-circle"></i>
          </div>
          <p class="text-gray-400 dark:text-gray-500 text-center mb-1 text-base">${t('loadFailed')}</p>
          <p class="text-gray-400 dark:text-gray-500 text-sm text-center">${t('pleaseRetry')}</p>
        </div>
      `;
    }

    return `
      <div class="flex-col items-center justify-center py-12 h-full">
        <div class="text-gray-400 dark:text-gray-500 text-4xl mb-4 flex justify-center">
          <i class="fa fa-music"></i>
        </div>
        <p class="text-gray-400 dark:text-gray-500 text-center mb-1 text-base">${t('noSongsSelected')}</p>
        <p class="text-gray-400 dark:text-gray-500 text-sm text-center">${t('goSelectSongs')}</p>
      </div>
    `;
  }

  /**
   * 渲染错误提示模板
   * @param {string} message - 错误信息
   * @param {string} details - 详细信息
   * @returns {string} HTML字符串
   */
  renderErrorTemplate(message, details) {
    return `
      <div class="flex-col items-center justify-center py-12 h-full">
        <div class="text-center text-red-500 p-4">
          <p class="text-xl mb-2">${message}</p>
          <p class="text-sm">${details}</p>
        </div>
      </div>
    `;
  }

  /**
   * 渲染加载提示模板
   * @returns {string} HTML字符串
   */
  renderLoadingTemplate() {
    const t = (key) => window.langService ? window.langService.t(key) : key;
    return `
      <div class="flex items-center justify-center py-12 h-full">
        <div class="flex flex-col items-center">
          <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mb-2"></div>
          <p class="text-sm text-gray-500 dark:text-gray-400">${t('loading')}</p>
        </div>
      </div>
    `;
  }

  /**
   * 绑定首页已选歌曲相关事件
   */
  bindHomeSelectedEvents() {
    // 绑定首页已选列表中的按钮事件
    const selectedContainer = document.getElementById('selectedList');
    if (selectedContainer) {
      // 使用事件委托处理按钮点击，避免重复绑定
      selectedContainer.addEventListener('click', async (e) => {
        const target = e.target;

        // 优先按钮
        const priorityBtn = target.closest('.priority-btn');
        if (priorityBtn) {
          e.stopPropagation();
          const songId = priorityBtn.dataset.songId;
          if (songId) {
            await this.upWord(songId);
          }
          return;
        }

        // 下一首按钮
        const nextBtn = target.closest('.next-btn');
        if (nextBtn) {
          e.stopPropagation();
          await this.playNextSong();
          return;
        }

        // 移除按钮
        const removeBtn = target.closest('.remove-btn');
        if (removeBtn) {
          e.stopPropagation();
          const songCard = removeBtn.closest('.song-card');
          const songId = removeBtn.dataset.songId || (songCard ? songCard.dataset.songId : undefined);
          if (songId) {
            // 调用删除接口，请求服务器删除
            await this.delete(songId);
            // 刷新首页已选列表
            await this.refreshHomeSelectedList();
          }
          return;
        }

        // 播放/暂停按钮
        const playPauseBtn = target.closest('.play-pause-btn');
        if (playPauseBtn) {
          e.stopPropagation();
          return;
        }
      });
    }
  }

  /**
   * 已选置顶
   * @param {string} songId - 歌曲ID
   */
  async upWord(songId) {
    // 初始化服务
    await this.initServices();

    try {
      await this.selectedService.upWord({ songNo: songId });

      // 立即刷新列表以显示更新
      await this.refreshHomeSelectedList();
    } catch (error) {
      console.error('[HomeSelectedUI] 已选置顶失败:', error);
      const t = (key) => window.langService ? window.langService.t(key) : key;
      this.showToast(t('topFailed'), 'error');
    }
  }

  /**
   * 删除已选歌曲
   * @param {string} songId - 歌曲ID
   */
  async delete(songId) {
    // 初始化服务
    await this.initServices();

    try {
      // 调用服务删除歌曲
      await this.selectedService.deleteSong({ songNo: songId });

      // 立即刷新列表以显示更新
      await this.refreshHomeSelectedList();
    } catch (error) {
      console.error('[HomeSelectedUI] 删除已选歌曲失败:', error);
      const t = (key) => window.langService ? window.langService.t(key) : key;
      this.showToast(t('deleteFailed'), 'error');
    }
  }

  /**
   * 播放下一首歌曲
   */
  async playNextSong() {
    // 初始化服务
    await this.initServices();

    try {
      // 调用服务播放下一首
      await this.selectedService.playNext();
      const t = (key) => window.langService ? window.langService.t(key) : key;
      this.showToast(t('nextSongRequested'), 'success');
    } catch (error) {
      console.error('[HomeSelectedUI] 播放下一首失败:', error);
      const t = (key) => window.langService ? window.langService.t(key) : key;
      this.showToast(t('nextSongFailed'), 'error');
    }
  }

  /**
   * 显示提示消息
   * @param {string} message - 消息内容
   * @param {string} type - 消息类型 (success, error)
   */
  showToast(message, type = 'success') {
    console.log(`[HomeSelectedUI提示] ${message} (类型: ${type})`);

    // 检查是否已存在提示元素，如果存在则移除
    const existingToast = document.getElementById('toast-notification');
    if (existingToast) {
      existingToast.remove();
    }

    // 创建提示元素
    const toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.className = `fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 px-6 py-3 rounded-lg shadow-lg transition-all duration-200 flex items-center min-w-[200px] max-w-[80%] ${type === 'success'
      ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
      : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
      }`;

    // 设置图标
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';

    // 设置内容
    toast.innerHTML = `
      <div class="mr-3">
        <i class="fa ${icon} text-xl"></i>
      </div>
      <div>
        ${message}
      </div>
    `;

    // 添加到页面
    document.body.appendChild(toast);

    // 触发重排
    void toast.offsetWidth;

    // 显示动画
    toast.classList.add('opacity-100');

    // 3秒后自动移除
    setTimeout(() => {
      toast.classList.remove('opacity-100');
      toast.classList.add('opacity-0', 'translate-y-[-20px]');
      setTimeout(() => {
        toast.remove();
      }, 150);
    }, 3000);
  }

  /**
   * 更新热门歌曲标题
   */
  async updateHotSongsTitle() {
    // 语言变化时更新热门歌曲标题
    if (window.langService) {
      const selectedListTitle = document.getElementById('homeHotSongTitle');
      if (selectedListTitle) {
        selectedListTitle.textContent = window.langService.t('hotSongs');
        console.log('[HomeSelectedUI] 热门歌曲标题已更新为:', window.langService.t('hotSongs'));
      }
    }
  }
}

// 首页已选歌曲UI实例（单例）
const homeSelectedUI = new HomeSelectedUI();
export default homeSelectedUI;
