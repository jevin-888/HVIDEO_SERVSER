// 延迟导入，避免循环依赖
let selectedService;

/**
 * UI常量定义
 */
const UI_CONSTANTS = {
  SELECTED_TAB: 'selected',
  SINGED_TAB: 'sung',
  ACTIVE_CLASS: 'tab-active',
  INACTIVE_CLASS: 'tab-inactive',
  SONG_LIST_CONTAINER: 'selectedList',
  SONG_COUNT_CLASS: 'song-count',
  EMPTY_STATE_ID: 'empty-state'
};

/**
 * UI工具类
 */
class UIUtils {
  /**
   * 更新标签页UI状态
   * @param {HTMLElement} panel - 面板元素
   * @param {string} activeTab - 激活的标签页
   */
  static updateTabUI(panel, activeTab) {
    const tabButtons = panel.querySelectorAll('.song-tabs button');
    tabButtons.forEach(btn => {
      const isSelected = btn.dataset.tab === activeTab;
      if (isSelected) {
        btn.classList.add('bg-red-600', 'text-white', 'shadow-lg', 'shadow-red-500/20', 'tab-active');
        btn.classList.remove('text-gray-400');
        btn.style.fontWeight = 'bold';
      } else {
        btn.classList.remove('bg-red-600', 'text-white', 'shadow-lg', 'shadow-red-500/20', 'tab-active');
        btn.classList.add('text-gray-400');
        btn.style.fontWeight = '500';
      }
    });
  }

  /**
   * 获取标签页对应的标签文本
   * @param {string} tab - 标签页类型
   * @returns {string} 标签文本
   */
  static getTabLabel(tab) {
    return tab === UI_CONSTANTS.SINGED_TAB ? '已唱' : '已选';
  }

  /**
   * 获取首页标题对应的文本
   * @param {string} tab - 标签页类型
   * @returns {string} 标题文本
   */
  static getHomeTitleLabel(tab) {
    return tab === UI_CONSTANTS.SINGED_TAB ? '已唱歌曲' : '已选歌曲';
  }

  /**
   * 更新歌曲计数显示
   * @param {HTMLElement} panel - 面板元素
   * @param {number} count - 歌曲数量
   * @param {string} tab - 当前标签页
   */
  static updateSongCount(panel, count, tab) {
    const songCount = panel.querySelector(`.${UI_CONSTANTS.SONG_COUNT_CLASS}`);
    if (songCount) {
      const label = UIUtils.getTabLabel(tab);
      songCount.textContent = `${label} ${count}`;
    }
  }

  /**
   * 更新首页标题
   * @param {string} tab - 当前标签页
   */
  static updateHomeTitle(tab) {
    const homeTitle = document.querySelector('#selectedListTitle');
    if (homeTitle) {
      const label = UIUtils.getHomeTitleLabel(tab);
      homeTitle.textContent = label;
    }
  }

  /**
   * 更新空状态显示
   * @param {HTMLElement} panel - 面板元素
   * @param {number} count - 歌曲数量
   */
  static updateEmptyState(panel, count) {
    const emptyState = panel.querySelector(`#${UI_CONSTANTS.EMPTY_STATE_ID}`);
    if (emptyState) {
      if (count > 0) {
        emptyState.classList.add('hidden');
      } else {
        emptyState.classList.remove('hidden');
      }
    }
  }
}

/**
 * 模板工具类
 */
class TemplateUtils {
  /**
   * 渲染空状态模板
   * @param {string} type - 状态类型 ('error' | 'empty')
   * @returns {string} HTML字符串
   */
  static renderEmptyStateTemplate(type = 'empty') {
    if (type === 'error') {
      return `
        <div class="text-gray-400 dark:text-gray-500 text-4xl mb-4 flex justify-center">
          <i class="fa fa-exclamation-circle"></i>
        </div>
        <p class="text-gray-400 dark:text-gray-500 text-center mb-1 text-base">加载失败</p>
        <p class="text-gray-400 dark:text-gray-500 text-sm text-center">请稍后重试</p>
      `;
    }

    return `
      <div class="text-gray-400 dark:text-gray-500 text-4xl mb-4 flex justify-center">
        <i class="fa fa-music"></i>
      </div>
      <p class="text-gray-400 dark:text-gray-500 text-center mb-1 text-base">还没有点任何歌曲</p>
      <p class="text-gray-400 dark:text-gray-500 text-sm text-center">去点一些喜欢的歌曲吧</p>
    `;
  }

  /**
   * 渲染错误提示模板
   * @param {string} message - 错误信息
   * @param {string} details - 详细信息
   * @returns {string} HTML字符串
   */
  static renderErrorTemplate(message, details) {
    return `
      <div class="text-center text-red-500 p-4">
        <p class="text-xl mb-2">${message}</p>
        <p class="text-sm">${details}</p>
      </div>
    `;
  }
}

/**
 * 导航已选歌曲UI逻辑
 */
class SelectedUI {
  constructor() {
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

      this._songSyncCleanup = songSyncManager.addSyncListener(async (data) => {
        const panel = document.getElementById('selected-panel');

        if (data?.type !== 'playlistUpdate' && data?.type !== 'commandUpdate') {
          return;
        }

        if (data?.type === 'playlistUpdate' && data.listType === 2) {
          // 已唱列表更新：仅当面板可见且当前在已唱 tab 时刷新
          if (panel && !panel.classList.contains('hidden')) {
            const activeTab = panel.querySelector('.tab-active');
            if (activeTab && activeTab.dataset.tab === 'sung') {
              await this._loadSungList(panel);
            }
          }
          return;
        }

        try {
          if (panel && !panel.classList.contains('hidden')) {
            const activeTab = panel.querySelector('.tab-active');
            if (!activeTab || activeTab.dataset.tab === 'selected') {
              await this.refreshSelectedList('selected');
            }
          }
        } catch (_) {
          // 静默忽略
        }
      });
    } catch (_) {
      // 静默忽略
    }
  }

  /**
   * 初始化服务
   */
   async initServices() {
    // 优先从全局 window 获取以避免模块导入顺序问题
    selectedService = window.navSelectedService || selectedService;
    this.selectedService = selectedService;
    this.cacheService = window.cacheService;
    
    return true;
  }

  /**
   * 初始化已选歌曲列表
   */
  async initSelectedList() {
    try {
      // 确保服务已初始化
      await this.initServices();

      const selectedContainer = document.getElementById('selectedList');
      if (selectedContainer) {
        // 先尝试使用缓存的预加载数据，快速渲染
        try {
          const cached = this.cacheService?.getPreloadedSelectedList?.() || [];
          if (Array.isArray(cached) && cached.length > 0) {
            this.renderSelectedList(cached, selectedContainer);
          }
        } catch (e) {
          console.warn('[SelectedUI] 读取缓存已选列表失败:', e);
        }

        // 然后进行网络请求以获取最新数据并覆盖更新
        let songs = [];
        try {
          const response = await this.selectedService.getPlayList();
          songs = this.selectedService.processPlayListResponse(response);
        } catch (error) {
          console.error('[SelectedUI] 获取已选歌曲列表失败:', error);
        }

        // 渲染已选歌曲列表（覆盖缓存渲染）
        this.renderSelectedList(songs, selectedContainer);
      } else {
        console.error('[SelectedUI] 未找到已选歌曲列表容器');
      }
    } catch (err) {
      console.error('[SelectedUI] 初始化已选歌曲失败:', err);
      const selectedContainer = document.getElementById('selectedList');
      if (selectedContainer) {
        selectedContainer.innerHTML = TemplateUtils.renderErrorTemplate('加载已选歌曲失败', err.message || '请检查网络连接或联系管理员');
      }
    }
  }

  /**
   * 刷新首页已选列表
   * @param {string} panelId - 面板ID
   */
  async refreshSelectedListForHome() {
    // 初始化服务
    await this.initServices();

    // 获取面板元素
    const panel = document.getElementById('selectedList');
    if (!panel) {
      console.warn('[SelectedUI] 面板元素不存在: selectedList');
      return;
    }

    // 初始化歌曲列表为空
    let songs = [];

    // 尝试从服务器获取已选歌曲列表
    try {
      const response = await this.selectedService.getPlayList();
      // 处理响应数据
      songs = this.selectedService.processPlayListResponse(response);
      // 更新歌曲列表
      const songList = panel.querySelector('.song-list');
      if (songList) {
        songList.innerHTML = this.renderSelectedSongsList(songs, 'selected');
      } else {
        // 如果找不到.song-list容器，直接更新面板内容
        this.renderSelectedList(songs, panel);
      }

      // 更新空状态显示
      const emptyState = panel.querySelector('#empty-state');
      if (emptyState) {
        if (songs.length > 0) {
          emptyState.classList.add('hidden');
        } else {
          emptyState.classList.remove('hidden');
        }
      }

      // 更新歌曲计数
      const songCount = panel.querySelector('.song-count');
      if (songCount) {
        // 检查当前激活的标签页
        const activeTab = panel.querySelector('.tab-active');
        const isSungTab = activeTab && activeTab.dataset.tab === UI_CONSTANTS.SINGED_TAB;
        UIUtils.updateSongCount(panel, songs.length, isSungTab ? UI_CONSTANTS.SINGED_TAB : UI_CONSTANTS.SELECTED_TAB);
      }

      // 重新绑定事件
      this.bindSelectedPanelEvents('selectedList');
    } catch (error) {
      console.error('[SelectedUI] 刷新已选列表失败:', error);
      // 显示错误状态
      const emptyState = panel.querySelector('#empty-state');
      if (emptyState) {
        emptyState.innerHTML = TemplateUtils.renderEmptyStateTemplate('error');
        emptyState.classList.remove('hidden');
      }
    }
  }

  /**
   * 渲染已选歌曲列表
   * @param {Array} songs - 歌曲列表
   * @param {HTMLElement} container - 容器元素
   */
  renderSelectedList(songs, container) {
    if (!container) {
      console.error('[SelectedUI] 容器元素不存在');
      return;
    }

    // 清空容器
    container.innerHTML = '';

    if (!songs || songs.length === 0) {
      container.innerHTML = `
        <div class="flex-col items-center justify-center py-12 h-full">
          <div class="text-gray-400 dark:text-gray-500 text-4xl mb-4 flex justify-center">
            <i class="fa fa-music"></i>
          </div>
          <p class="text-gray-400 dark:text-gray-500 text-center mb-1 text-base">还没有点任何歌曲</p>
          <p class="text-gray-400 dark:text-gray-500 text-sm text-center">去点一些喜欢的歌曲吧</p>
        </div>
      `;
      return;
    }

    // 创建列表容器
    const list = document.createElement('ul');
    list.className = 'space-y-2 w-full'; // 统一间距和宽度

    // 为每首歌曲创建卡片
    songs.forEach((song, index) => {
      const songCard = this.createSelectedSongCardForHome(song, index);
      // 将 div 包装在 li 中以匹配模态框结构
      const listItem = document.createElement('li');
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
  createSelectedSongCardForHome(song, index) {
    // 根据位置设置卡片样式
    let cardClass = '';
    if (index === 0) {
      // 第一首 - 使用更明显的蓝色背景（当前播放）
      cardClass = 'border-blue-300 dark:border-blue-700 bg-blue-100 dark:bg-blue-900/30';
    } else if (index === 1) {
      // 第二首 - 使用更明显的紫色背景（下一首）
      cardClass = 'border-purple-300 dark:border-purple-700 bg-purple-100 dark:bg-purple-900/30';
    } else {
      // 其他卡片 - 使用默认背景
      cardClass = 'border-gray-100 dark:border-gray-700 bg-gray-100 dark:bg-gray-900/20';
    }

    const songCard = document.createElement('div');
    // 首页卡片使用紧凑布局
    songCard.className = `song-card border ${cardClass} transition-all duration-200 rounded-lg py-1 px-3 mb-1.5 flex items-center hover:scale-[0.98] active:scale-[0.95] active:shadow-md cursor-pointer`;

    // 获取歌曲ID
    const songId = song.songNo;

    // 设置卡片数据属性
    if (songId) {
      songCard.dataset.songId = songId;
    }

    // 获取歌曲信息
    const songName = song.songName || '未知歌曲';
    const singerName = song.singerNames || '未知歌手';

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

    // 首页卡片使用更紧凑但高级的布局
    songCard.innerHTML = `
      <div class="song-info flex-1 min-w-0">
        <div class="title font-bold text-neutral-800 dark:text-white truncate text-sm mb-0.5">${songName}</div>
        ${pinyinText ? `<div class="text-[0.6rem] text-gray-500 dark:text-gray-400 truncate opacity-70">${pinyinText}</div>` : ''}
        <div class="flex items-center text-[0.6rem] mt-0.5">
          <span class="px-1.5 py-0.5 rounded bg-white/10 dark:bg-white/5 text-gray-500 dark:text-gray-400 border border-black/5 dark:border-white/5">
            ${singerName}
          </span>
        </div>
      </div>
      <div class="music-icon-container flex items-center ml-2 space-x-2">
        ${index > 1 ? `
          <button class="priority-btn text-blue-500 active:scale-90 transition-transform" data-song-id="${songId}">
            <div class="w-8 h-8 flex items-center justify-center bg-blue-500/10 rounded-lg border border-blue-500/10">
              <i class="fa fa-arrow-up text-[0.7rem]"></i>
            </div>
          </button>
        ` : ''}
        <button class="${index === 0 ? 'play-pause-btn' : index === 1 ? 'next-btn' : 'remove-btn'} ${index === 0 || index === 1 ? 'text-red-500' : 'text-gray-400'} active:scale-90 transition-transform" data-song-id="${songId}">
          <div class="w-8 h-8 flex items-center justify-center ${index > 1 ? 'bg-black/5 dark:bg-white/5 rounded-lg border border-black/5 dark:border-white/10' : 'bg-red-500/10 rounded-lg border border-red-500/10'}">
            ${index === 0
        ? `<div class="playing-indicator-v2 flex items-end h-3 gap-0.5">
              <div class="bar h-full w-0.5"></div>
              <div class="bar h-full w-0.5"></div>
              <div class="bar h-full w-0.5"></div>
            </div>`
        : index === 1
          ? '<i class="fa fa-step-forward text-[0.7rem]"></i>'
          : '<i class="fa fa-trash-alt text-[0.7rem]"></i>'
      }
          </div>
        </button>
      </div>
    `;

    // 添加交互效果
    this.addInteractionEffects(songCard);

    return songCard;
  }

  /**
   * 创建已选歌曲卡片
   * @param {Object} song - 歌曲对象
   * @param {number} index - 歌曲索引
   * @returns {HTMLElement} 歌曲卡片元素
   */
  createSelectedSongCard(song, index) {
    // 根据位置设置卡片样式
    let cardClass = '';
    if (index === 0) {
      // 第一首 - 使用更明显的蓝色背景（当前播放）
      cardClass = 'border-blue-300 dark:border-blue-700 bg-blue-100 dark:bg-blue-900/30';
    } else if (index === 1) {
      // 第二首 - 使用更明显的紫色背景（下一首）
      cardClass = 'border-purple-300 dark:border-purple-700 bg-purple-100 dark:bg-purple-900/30';
    } else {
      // 其他卡片 - 使用默认背景
      cardClass = 'border-gray-100 dark:border-gray-700 bg-gray-100 dark:bg-gray-900/20';
    }

    const songCard = document.createElement('div');
    // 使用紧凑布局
    songCard.className = `song-card border ${cardClass} transition-all duration-200 rounded-lg py-1 px-3 mb-1.5 flex items-center hover:scale-[0.98] active:scale-[0.95] active:shadow-md cursor-pointer`;

    // 获取歌曲ID
    const songId = song.songNo;

    // 设置卡片数据属性
    if (songId) {
      songCard.dataset.songId = songId;
    }

    // 获取歌曲信息
    const songName = song.songName || '未知歌曲';
    const singerName = song.singerNames || '未知歌手';

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

    // 与模态框中的卡片内容保持一致
    songCard.innerHTML = `
      <div class="song-info flex-1 min-w-0">
        <div class="title font-bold text-neutral-800 dark:text-white truncate text-sm mb-0.5">${songName}</div>
        ${pinyinText ? `<div class="text-[0.6rem] text-gray-500 dark:text-gray-400 truncate opacity-70">${pinyinText}</div>` : ''}
        <div class="flex items-center text-[0.7rem] mt-0.5">
          <span class="px-1.5 py-0.5 rounded bg-white/10 dark:bg-white/5 text-gray-500 dark:text-gray-400 border border-black/5 dark:border-white/5">
            ${singerName}
          </span>
        </div>
      </div>
    <div class="music-icon-container flex items-center ml-2 space-x-2">
      ${index > 1 ? `
        <button class="priority-btn text-blue-500 dark:text-blue-400 active:scale-90 transition-transform" data-song-id="${songId}">
          <div class="w-8 h-8 flex items-center justify-center bg-blue-500/10 dark:bg-blue-400/10 rounded-lg border border-blue-500/10">
            <i class="fa fa-arrow-up text-[0.7rem]"></i>
          </div>
        </button>
        ` : ''}
        <button class="${index === 0 ? 'play-pause-btn' : index === 1 ? 'next-btn' : 'remove-btn'} ${index === 0 || index === 1 ? 'text-red-500' : 'text-gray-400'} active:scale-90 transition-transform" data-song-id="${songId}">
          <div class="w-8 h-8 flex items-center justify-center ${index > 1 ? 'bg-black/5 dark:bg-white/5 rounded-lg border border-black/5 dark:border-white/10' : 'bg-red-500/10 rounded-lg border border-red-500/10'}">
            ${index === 0
          ? `<div class="playing-indicator-v2 flex items-end h-3 gap-0.5">
                <div class="bar h-full w-0.5"></div>
                <div class="bar h-full w-0.5"></div>
                <div class="bar h-full w-0.5"></div>
              </div>`
          : index === 1
            ? '<i class="fa fa-step-forward text-[0.7rem]"></i>'
            : '<i class="fa fa-trash-alt text-[0.7rem]"></i>'
        }
          </div>
        </button>
      </div>
    `;

    // 添加交互效果
    this.addInteractionEffects(songCard);

    return songCard;
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
   * 创建已选歌曲面板
   * @param {string} panelId - 面板ID
   */
  async createSelectedPanel(panelId) {
    // 初始化服务
    await this.initServices();
    // 获取面板元素
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) {
      console.error('[SelectedUI] 面板元素不存在:', `${panelId}-panel`);
      return;
    }

    // 面板已创建过则直接复用，不重建DOM（性能优化）
    if (panel.dataset.panelReady === 'true') {
      this.currentOpenPanel = panelId;
      return;
    }
    this.currentOpenPanel = panelId;

    // 初始化歌曲列表为空
    let songs = [];

    // 尝试从服务器获取已选歌曲列表
    try {
      const response = await this.selectedService.getPlayList();
      console.log('[SelectedUI] 响应是否为数组:', Array.isArray(response));
      console.log('[SelectedUI] 响应.data 是否为数组:', Array.isArray(response?.data));

      // 处理响应数据
      songs = this.selectedService.processPlayListResponse(response);
      if (songs.length > 0) {
      } else {
        console.warn('[SelectedUI] ⚠️ 歌曲列表为空！');
      }
    } catch (error) {
      console.error('[SelectedUI] 获取已选歌曲列表失败:', error);
      console.error('[SelectedUI] 错误堆栈:', error.stack);
      // 使用空列表继续
    }

    const panelContent = `
        <div id="${panelId}-panel-content" class="mobile-selected-panel mobile-panel-unified fixed inset-x-0 bottom-0 premium-panel-base text-white transform translate-y-[120%] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]" style="z-index:10006;height:72vh;">
        
        <!-- Handle for dragging feel -->
        <div class="w-12 h-1.5 bg-white/20 rounded-full mx-auto mt-3 mb-1"></div>

        <div class="px-6 pt-2 pb-4">
          <div class="flex justify-between items-center mb-6">
            <div class="song-tabs premium-tab-container flex space-x-1 rounded-2xl">
              <button class="tab-btn flex-1 px-6 py-2 rounded-xl text-sm font-bold transition-all duration-300 selected-tab-btn tab-active bg-red-600 text-white" data-tab="selected">
                <i class="fa fa-list-ul mr-2"></i>已选
              </button>
              <button class="tab-btn flex-1 px-6 py-2 rounded-xl text-sm font-medium text-gray-400 transition-all duration-300 sung-tab-btn" data-tab="sung">
                <i class="fa fa-history mr-2"></i>已唱
              </button>
            </div>
            <button class="control-btn w-10 h-10 flex items-center justify-center bg-white/5 rounded-full text-white/60 hover:text-white transition-colors close-panel-btn">
              <i class="fa fa-times"></i>
            </button>
          </div>
          
          <div class="flex justify-between items-center mb-4">
            <div class="flex flex-col">
              <h2 class="text-2xl font-black gradient-text">播放列表</h2>
              <div class="text-xs text-gray-500 font-medium mt-0.5 song-count">
                当前共有 0 首歌曲
              </div>
            </div>
            <div class="flex gap-2">
              <button class="premium-control-btn btn-premium-gray px-4 py-2 rounded-xl text-xs font-bold flex items-center text-white/80 hover:text-white shuffle-btn">
                <i class="fa fa-random mr-1.5"></i>打乱
              </button>
              <button class="premium-control-btn btn-premium-gray px-4 py-2 rounded-xl text-xs font-bold flex items-center text-white/80 hover:text-white clear-btn">
                <i class="fa fa-trash-alt mr-1.5 text-red-400"></i>清空
              </button>
            </div>
          </div>
        </div>
        
        <!-- Song list container -->
        <div class="flex-1 overflow-y-auto px-4 pb-20" style="height: calc(72vh - 160px);">
          <ul class="space-y-1.5 song-list w-full"></ul>
          
          <div id="empty-state" class="flex flex-col items-center justify-center py-20">
            <div class="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
              <i class="fa fa-music text-3xl text-gray-600"></i>
            </div>
            <h3 class="text-xl font-bold text-gray-300 mb-2">列表空空如也</h3>
            <p class="text-gray-500 text-sm">点击下方点歌按钮开启派对吧</p>
          </div>
        </div>
      </div>`;

    // 更新面板内容
    panel.innerHTML = `
      <div id="${panelId}-overlay" class="fixed inset-0 bg-black/40 backdrop-blur-sm opacity-0 transition-opacity duration-300 pointer-events-none"></div>
      ${panelContent}
    `;
    // 标记面板已创建完成
    panel.dataset.panelReady = 'true';
    this.currentOpenPanel = panelId;

    // 绑定事件
    this.bindSelectedPanelEvents(panelId);

    // 刷新已选列表以获取最新数据
    this.refreshSelectedList(panelId);
  }

  /**
   * 刷新已选列表
   * @param {string} panelId - 面板ID
   */
  async refreshSelectedList(panelId) {
    // 初始化服务
    await this.initServices();

    // 获取面板元素
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) {
      console.warn('[SelectedUI] 面板元素不存在:', panelId);
      return;
    }

    // 如果当前在已唱 tab，完全跳过，不干扰已唱列表
    const activeTab = panel.querySelector('.tab-active');
    const isOnSungTab = activeTab && activeTab.dataset.tab === UI_CONSTANTS.SINGED_TAB;
    if (isOnSungTab) return;

    // 初始化歌曲列表为空
    let songs = [];

    // 尝试从服务器获取已选歌曲列表
    try {
      const response = await this.selectedService.getPlayList();
      // 处理响应数据
      songs = this.selectedService.processPlayListResponse(response);
      const songList = panel.querySelector('.song-list');
      if (songList) {
        songList.innerHTML = this.renderSelectedSongsList(songs, 'selected');
      }

      UIUtils.updateEmptyState(panel, songs.length);
      UIUtils.updateSongCount(panel, songs.length, UI_CONSTANTS.SELECTED_TAB);

      // 触发歌曲列表同步事件，确保底部导航徽标等其他组件更新
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('songListSynced', {
          detail: { selectedSongs: songs, totalCount: songs.length, source: 'refreshSelectedList' }
        }));
      }

      // 重新绑定事件
      this.bindSelectedPanelEvents(panelId);
    } catch (error) {
      console.error('[SelectedUI] 刷新已选列表失败:', error);
      const emptyState = panel.querySelector('#empty-state');
      if (emptyState) {
        emptyState.innerHTML = TemplateUtils.renderEmptyStateTemplate('error');
        emptyState.classList.remove('hidden');
      }
    }
  }

  /**
   * 刷新已唱列表
   * @param {string} panelId - 面板ID
   */
  async refreshSungList(panelId) {
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;
    const activeTab = panel.querySelector('.tab-active');
    if (!activeTab || activeTab.dataset.tab !== 'sung') return;
    await this._loadSungList(panel);
  }

  /**
   * 加载已唱列表数据并渲染
   * GET /api/v1/rooms/:id/queue/played → { code:0, data: Array<RoomQueueItem> }
   */
  async _loadSungList(panel) {
    await this.initServices();
    try {
      const songs = await this.selectedService.getPlayedList();
      const songList = panel.querySelector('.song-list');
      if (!songList) return;
      songList.innerHTML = songs.map(song => {
        const songNo = song.songNo || '';
        const name = song.songName || '未知歌曲';
        const singer = song.singerNames || '未知歌手';
        return `<li>
          <div class="song-card-premium rounded-xl p-2.5 flex items-center gap-3"  data-song-id="${songNo}">
            <div class="song-info flex-1 min-w-0">
              <div class="title font-bold text-white truncate text-sm">${name}</div>
              <div class="text-xs text-gray-400 mt-1">${singer}</div>
            </div>
            <div class="music-icon-container flex items-center">
              <button class="request-btn active:scale-90 transition-transform text-gray-400" data-song-id="${songNo}">
                <div class="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 border border-white/10">
                  <i class="fa fa-redo text-sm"></i>
                </div>
              </button>
            </div>
          </div>
        </li>`;
      }).join('');
      UIUtils.updateEmptyState(panel, songs.length);
      UIUtils.updateSongCount(panel, songs.length, UI_CONSTANTS.SINGED_TAB);
    } catch (e) {
      console.error('[SelectedUI] 获取已唱列表失败:', e);
    }
  }

  /**
   * 渲染已选歌曲列表
   * @param {Array} songs - 歌曲列表
   * @param {string} tabType - 标签页类型 ('selected' 或 'sung')
   * @returns {string} HTML字符串
   */
  renderSelectedSongsList(songs, tabType = 'selected') {
    const isSungList = tabType === 'sung';

    let songsHtml = '';
    songs.forEach((song, index) => {
      const queueSongId = song.songNo || song.id || '';
      const actionSongId = isSungList ? (song.songNo || '') : queueSongId;

      // 判断是否为当前播放或下一首
      const isCurrent = index === 0; // 第一首为当前播放
      const isNext = index === 1; // 第二首为下一首

      // 生成拼音（如果歌曲名称是中文）
      let pinyinText = '';
      const songName = song.songName || '未知歌曲';
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

      // 根据位置和列表类型设置卡片样式
      const cardStyle = !isSungList && isCurrent ? 'playing-card'
        : !isSungList && isNext ? 'next-card' : '';

      songsHtml += `
        <li class="animate-stagger" style="animation-delay: ${index * 0.05}s">

          <div class="song-card-premium ${cardStyle} rounded-xl p-2.5" style="display:flex;align-items:center;gap:0;border-radius:1rem;transition:all 0.3s ease;" data-song-id="${actionSongId}">
            <div class="song-info" style="flex:1;min-width:0">
              <div class="title" style="font-weight:700;color:var(--mobile-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.9rem;margin-bottom:1px">${songName}</div>
              ${pinyinText ? `<div class="text-[0.6rem] text-gray-400 truncate opacity-50 font-medium uppercase tracking-wider">${pinyinText}</div>` : ''}
              <div class="flex items-center text-[0.65rem] mt-1.5">
                <span class="px-2 py-0.5 rounded-md category-tag text-gray-300 border border-white/10 font-bold shadow-sm">
                  ${song.singerNames || '未知歌手'}
                </span>
              </div>
            </div>
            
            <div class="music-icon-container flex items-center ml-3 space-x-3">
              ${!isSungList && index > 1 ? `
                <button class="priority-btn text-blue-400 active:scale-90 transition-transform" data-song-id="${actionSongId}">
                  <div class="w-9 h-9 flex items-center justify-center bg-blue-500/10 rounded-xl border border-blue-500/20 shadow-inner">
                    <i class="fa fa-arrow-up text-[0.8rem]"></i>
                  </div>
                </button>
              ` : ''}
              
              <button class="${isCurrent && !isSungList ? 'play-pause-btn' : isNext && !isSungList ? 'next-btn' : isSungList ? 'request-btn' : 'remove-btn'} active:scale-90 transition-transform" style="color:${isCurrent ? '#ef4444' : isNext ? '#3b82f6' : '#9ca3af'}" data-song-id="${actionSongId}">
                 <div class="w-9 h-9 flex items-center justify-center rounded-xl shadow-inner" style="background:${isCurrent ? 'rgba(239,68,68,0.1)' : isNext ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.05)'};border:1px solid ${isCurrent ? 'rgba(239,68,68,0.2)' : isNext ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.1)'}">
                   ${isCurrent && !isSungList 
                     ? `<div style="display:flex;align-items:flex-end;height:18px;gap:3px">
                         <div style="width:4px;height:18px;background:var(--mobile-playing-bars);border-radius:99px;transform-origin:bottom;animation:bar-rise 0.8s 0s infinite ease-in-out"></div>
                         <div style="width:4px;height:18px;background:var(--mobile-playing-bars);border-radius:99px;transform-origin:bottom;animation:bar-rise 0.8s 0.2s infinite ease-in-out"></div>
                         <div style="width:4px;height:18px;background:var(--mobile-playing-bars);border-radius:99px;transform-origin:bottom;animation:bar-rise 0.8s 0.1s infinite ease-in-out"></div>
                         <div style="width:4px;height:18px;background:var(--mobile-playing-bars);border-radius:99px;transform-origin:bottom;animation:bar-rise 0.8s 0.3s infinite ease-in-out"></div>
                       </div>`
                    : isNext && !isSungList 
                      ? '<i class="fa fa-step-forward text-sm"></i>'
                      : isSungList 
                        ? '<i class="fa fa-redo text-gray-300 text-sm"></i>'
                        : '<i class="fa fa-trash-alt text-sm"></i>'
                  }
                 </div>
              </button>
            </div>
          </div>
        </li>`;
    });

    return songsHtml;
  }

  /**
   * 绑定已选歌曲面板事件
   * @param {string} panelId - 面板ID
   */
  bindSelectedPanelEvents(panelId) {
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;

    // 使用一个标记来确保事件监听器只绑定一次
    if (panel.dataset.eventsBound === 'true') {
      return;
    }

    // 绑定关闭按钮事件
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        // 触发底部导航UI关闭面板
        const event = new CustomEvent('closePanel', { detail: { panelId } });
        document.dispatchEvent(event);
      });
    }

    // 绑定遮罩层点击事件
    const overlay = panel.querySelector(`#${panelId}-overlay`);
    if (overlay) {
      overlay.addEventListener('click', () => {
        // 触发底部导航UI关闭面板
        const event = new CustomEvent('closePanel', { detail: { panelId } });
        document.dispatchEvent(event);
      });
    }

    // 绑定标签页切换事件
    const selectedTabBtn = panel.querySelector('.selected-tab-btn');
    const sungTabBtn = panel.querySelector('.sung-tab-btn');

    if (selectedTabBtn) {
      selectedTabBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.switchTab(panelId, 'selected');
      });
    }

    if (sungTabBtn) {
      sungTabBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.switchTab(panelId, 'sung');
      });
    }

    // 绑定打乱按钮事件
    const shuffleBtn = panel.querySelector('.shuffle-btn');
    if (shuffleBtn) {
      shuffleBtn.addEventListener('click', () => {
        this.shuffleSongs(panelId);
      });
    }

    // 绑定清空按钮事件
    const clearBtn = panel.querySelector('.clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearSongs(panelId);
      });
    }

    // 统一事件委托：为动态渲染的歌曲按钮绑定点击事件
    panel.addEventListener('click', async (e) => {
      const target = e.target;

      // 优先按钮
      const priorityBtn = target.closest('.priority-btn');
      if (priorityBtn) {
        e.stopPropagation();
        const songId = priorityBtn.dataset.songId;
        if (songId) {
          await this.upWord(panelId, songId);
        }
        return;
      }

      // 点唱按钮（已唱列表中的点唱按钮）
      const requestBtn = target.closest('.request-btn');
      if (requestBtn) {
        e.stopPropagation();
        const songId = requestBtn.dataset.songId;
        if (songId) {
          await this.requestSong(panelId, songId);
        }
        return;
      }

      // 下一首按钮
      const nextBtn = target.closest('.next-btn');
      if (nextBtn) {
        e.stopPropagation();
        await this.playNextSong(panelId);
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
          await this.delete(panelId, songId);
        } else if (songCard) {
          // 兜底：如果无法获取到songId，仅移除UI
          songCard.remove();
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

    // 标记事件已绑定
    panel.dataset.eventsBound = 'true';
  }

  /**
   * 切换标签页
   * @param {string} panelId - 面板ID
   * @param {string} tab - 标签页类型
   */
  async switchTab(panelId, tab) {
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;

    await this.initServices();
    UIUtils.updateTabUI(panel, tab);

    if (tab === UI_CONSTANTS.SINGED_TAB) {
      await this._loadSungList(panel);
      return;
    }

    // 已选列表
    try {
      const response = await this.selectedService.getPlayList();
      const songs = this.selectedService.processPlayListResponse(response);
      const songList = panel.querySelector('.song-list');
      if (songList) {
        songList.innerHTML = this.renderSelectedSongsList(songs, tab);
        UIUtils.updateEmptyState(panel, songs.length);
        UIUtils.updateSongCount(panel, songs.length, tab);
        UIUtils.updateHomeTitle(tab);
      }
    } catch (error) {
      console.error(`切换到${tab}标签页失败:`, error);
    }
  }

  /**
   * 打乱歌曲顺序
   * @param {string} panelId - 面板ID
   */
  async shuffleSongs(panelId) {
    // 初始化服务
    await this.initServices();

    try {
      // 调用服务打乱播放列表
      await this.selectedService.shufflePlayList();

      // 列表变化统一由 SongSyncManager 驱动
      
    } catch (error) {
      console.error('打乱歌曲顺序失败:', error);
      this.showToast('打乱歌曲失败', 'error');
    }
  }

  /**
   * 清空歌曲列表
   * @param {string} panelId - 面板ID
   */
  async clearSongs(panelId) {
    // 初始化服务
    await this.initServices();

    try {
      await this.selectedService.clearPlayList();

      // 列表变化统一由 SongSyncManager 驱动
      
    } catch (error) {
      console.error('清空歌曲列表失败:', error);
      this.showToast('清空列表失败', 'error');
    }
  }

  /**
   * 显示提示消息
   * @param {string} message - 消息内容
   * @param {string} type - 消息类型 (success, error)
   */
  showToast(message, type = 'success') {
    console.log(`[提示] ${message} (类型: ${type})`);

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
   * 已选置顶
   * @param {string} panelId - 面板ID
   * @param {string} songId - 歌曲ID
   */
  async upWord(panelId, songId) {
    // 初始化服务
    await this.initServices();

    try {
      await this.selectedService.upWord({ songNo: songId });

      // 列表更新统一由 SongSyncManager 驱动
    } catch (error) {
      console.error('已选置顶失败:', error);
      this.showToast('置顶失败', 'error');
    }
  }

  /**
   * 删除已选歌曲
   * @param {string} panelId - 面板ID
   * @param {string} songId - 歌曲ID
   */
  async delete(panelId, songId) {
    // 初始化服务
    await this.initServices();

    try {
      // 调用服务删除歌曲
      await this.selectedService.deleteSong({ songNo: songId });

      // 列表更新统一由 SongSyncManager 驱动
    } catch (error) {
      console.error('删除已选歌曲失败:', error);
      this.showToast('删除失败', 'error');
    }
  }

  /**
   * 点唱歌曲（已唱列表中的点唱操作）
   * @param {string} panelId - 面板ID
   * @param {string} songId - 歌曲ID
   */
  async requestSong(panelId, songNo) {
    await this.initServices();
    try {
      if (!songNo) throw new Error('歌曲编号不存在');
      await this.selectedService.requestSong({ songNo });
      this.showToast('已添加到已选列表', 'success');

    } catch (error) {
      console.error('点唱歌曲失败:', error);
      this.showToast('点唱失败: ' + error.message, 'error');
    }
  }

  /**
   * 播放下一首歌曲
   * @param {string} panelId - 面板ID
   */
  async playNextSong(panelId) {
    // 初始化服务
    await this.initServices();

    try {
      // 调用服务播放下一首
      await this.selectedService.playNext();
      this.showToast('已发送切歌请求', 'success');

      // 列表变化统一由 SongSyncManager 驱动
      // 列表更新统一由 SongSyncManager 驱动
    } catch (error) {
      console.error('播放下一首失败:', error);
      this.showToast('切歌失败', 'error');
    }
  }

  /**
   * 渲染导航已选歌曲列表
   * @param {Array} selectedSongs - 已选歌曲列表
   */
  renderNavSelectedSongs(selectedSongs) {
    // 实现导航已选歌曲列表的渲染逻辑
  }

  /**
   * 更新歌曲选中状态
   * @param {string} songId - 歌曲ID
   * @param {boolean} selected - 选中状态
   */
  updateSongSelection(songId, selected) {
    // 实现歌曲选中状态更新逻辑
  }

  /**
   * 绑定已选歌曲相关事件
   */
  bindSelectedEvents() {
    // 实现已选歌曲相关事件绑定逻辑
    // 绑定已选列表中的按钮事件
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
            await this.upWord('selectedList', songId);
          }
          return;
        }

        // 点唱按钮（已唱列表中的点唱按钮）
        const requestBtn = target.closest('.request-btn');
        if (requestBtn) {
          e.stopPropagation();
          const songId = requestBtn.dataset.songId;
          if (songId) {
            await this.requestSong('selectedList', songId);
          }
          return;
        }

        // 下一首按钮
        const nextBtn = target.closest('.next-btn');
        if (nextBtn) {
          e.stopPropagation();
          await this.playNext('selectedList');
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
            await this.delete('selectedList', songId);
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
}

// 创建并导出导航已选歌曲UI实例
const selectedUI = new SelectedUI();
export default selectedUI;
