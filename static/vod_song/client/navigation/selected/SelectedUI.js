// 延迟导入，避免循环依赖
import { logInfo, logWarn, logError } from '../../utils/Logger.js';
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
      const translationSpans = btn.querySelectorAll('.indonesian-translation, .en-translation, .vi-translation');
      // 注意：这里由于 tabButtons 内部已经包含所有语言 span，只需切换 active 状态
      if (btn.dataset.tab === activeTab) {
        btn.classList.add(UI_CONSTANTS.ACTIVE_CLASS);
        btn.classList.remove(UI_CONSTANTS.INACTIVE_CLASS);
        // 更新文字颜色 - 已选和已唱标签都使用红色
        btn.classList.add('tab-active-color');
        btn.classList.remove('tab-inactive-color');
        const icon = btn.querySelector('i');
        if (icon) {
          icon.classList.add('tab-active-color');
          icon.classList.remove('tab-inactive-color');
        }
        // 更新印尼语翻译颜色为白色
        translationSpans.forEach(span => {
          span.classList.remove('text-gray-500', 'dark:text-gray-400');
          span.classList.add('text-white');
        });
      } else {
        btn.classList.add(UI_CONSTANTS.INACTIVE_CLASS);
        btn.classList.remove(UI_CONSTANTS.ACTIVE_CLASS);
        // 更新文字颜色
        btn.classList.add('tab-inactive-color');
        btn.classList.remove('tab-active-color');
        const icon = btn.querySelector('i');
        if (icon) {
          icon.classList.add('tab-inactive-color');
          icon.classList.remove('tab-active-color');
        }
        // 恢复印尼语翻译颜色为默认颜色
        translationSpans.forEach(span => {
          span.classList.remove('text-white');
          span.classList.add('text-gray-500', 'dark:text-gray-400');
        });
      }
    });
  }

  /**
   * 获取多语言 Span 结构
   */
  static getMultiLangText(key, zhFallback, idFallback, enFallback, viFallback) {
    const langService = window.langService;
    const idT = langService?.translations['id_id'] || {};
    const enT = langService?.translations['en_us'] || {};
    const viT = langService?.translations['vi_vn'] || {};
    
    return `<span class="zh-label" data-lang-key="${key}">${zhFallback}</span>` +
           `<span class="indonesian-translation">${idT[key] || idFallback}</span>` +
           `<span class="en-translation">${enT[key] || enFallback}</span>` +
           `<span class="vi-translation">${viT[key] || viFallback}</span>`;
  }

  /**
   * 获取标签页对应的标签文本
   * @param {string} tab - 标签页类型
   * @returns {string} 标签文本 HTML
   */
  static getTabLabel(tab) {
    return tab === UI_CONSTANTS.SINGED_TAB 
      ? UIUtils.getMultiLangText('sung', '已唱', 'Sudah nyanyi', 'Sung', 'Đã hát')
      : UIUtils.getMultiLangText('selected', '已选', 'Dipilih', 'Selected', 'Đã chọn');
  }

  /**
   * 获取首页标题对应的文本
   * @param {string} tab - 标签页类型
   * @returns {string} 标题文本 HTML
   */
  static getHomeTitleLabel(tab) {
    const isSung = (tab === UI_CONSTANTS.SINGED_TAB);
    const key = isSung ? 'sungSongs' : 'playlist';
    const zh = isSung ? '已唱歌曲' : '播放列表';
    const id = isSung ? 'Sudah dinyanyikan' : 'Daftar Putar';
    const en = isSung ? 'Sung Songs' : 'Playlist';
    const vi = isSung ? 'Đã hát' : 'Danh sách phát';
    return UIUtils.getMultiLangText(key, zh, id, en, vi);
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
      const prefix = UIUtils.getMultiLangText('songCountPrefix', '当前共有', 'Saat ini ada', 'Total', 'Hiện có');
      const suffix = UIUtils.getMultiLangText('songCountSuffix', '首歌曲', 'lagu', 'songs', 'bài hát');
      songCount.innerHTML = `${prefix} ${count} ${suffix}`;
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
      homeTitle.innerHTML = label;
    }
  }

  /**
   * 更新面板标题
   * @param {HTMLElement} panel - 面板元素
   * @param {string} tab - 当前标签页
   */
  static updatePanelTitle(panel, tab) {
    const panelTitle = panel.querySelector('.selected-panel-title');
    if (panelTitle) {
      panelTitle.innerHTML = UIUtils.getHomeTitleLabel(tab);
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
   * @param {Object} translations - 翻译对象，包含 noSongsSelected 和 goSelectSongs
   * @returns {string} HTML字符串
   */
  static renderEmptyStateTemplate(type = 'empty', translations = {}) {
    if (type === 'error') {
      return `
        <div class="text-gray-400 dark:text-gray-500 page-empty-state-title mb-6 flex justify-center">
          <i class="fa fa-exclamation-circle empty-state-icon"></i>
        </div>
        <p class="page-subtitle text-gray-400 dark:text-gray-500 text-center mb-2">加载失败</p>
        <p class="page-button text-gray-400 dark:text-gray-500 text-center">请稍后重试</p>
      `;
    }

    const noSongsSelected = translations.noSongsSelected || '还没有点任何歌曲';
    const goSelectSongs = translations.goSelectSongs || '去点一些喜欢的歌曲吧';

    return `
      <div class="text-gray-400 dark:text-gray-500 page-empty-state-title mb-6 flex justify-center">
        <i class="fa fa-music empty-state-icon"></i>
      </div>
      <p class="page-empty-state-title text-gray-400 dark:text-gray-500 text-center mb-2">${noSongsSelected}</p>
      <p class="page-empty-state-text text-gray-400 dark:text-gray-500 text-center">${goSelectSongs}</p>
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
      <div class="text-center text-red-500 p-6">
        <p class="page-subtitle mb-4">${message}</p>
        <p class="page-button">${details}</p>
      </div>
    `;
  }
}

/**
 * 导航已选歌曲UI逻辑
 */
class SelectedUI {
  constructor() {
    // 在需要时动态导入服务
    this.currentOpenPanel = null;
    // 防抖刷新首页列表，避免频繁刷新导致闪烁
    this.refreshHomeListThrottle = null;
    this.lastHomeListRefresh = 0;
    // 刷新串行与节流控制
    this._refreshBusy = false;
    this._refreshPending = false;
    // 拼音缓存
    this._pinyinCache = new Map();
    // 事件监听器管理：存储事件处理器引用，便于清理
    this._eventHandlers = new WeakMap();
    // WebSocket监听器清理函数
    this._wsCleanupFunctions = [];
  }

  /**
   * 初始化服务
   */
  async initServices() {
    // 防止重复初始化
    if (this._initServicesPromise) {
      return this._initServicesPromise;
    }

    this._initServicesPromise = (async () => {
      // 使用 moduleLoader 加载懒加载的服务
      const moduleLoader = (typeof window !== 'undefined' && window.moduleLoader)
        ? window.moduleLoader
        : null;

      // 优先从全局获取（如果已预加载）
      if (!selectedService && window.navSelectedService) {
        selectedService = window.navSelectedService;
      }

      if (!selectedService && moduleLoader) {
        try {
          selectedService = await moduleLoader.load('navSelectedService');
          // 缓存到全局，避免重复加载
          if (typeof window !== 'undefined') {
            window.navSelectedService = selectedService;
          }
        } catch (e) {
          logWarn('SelectedUI', '通过moduleLoader加载navSelectedService失败，尝试从index.js导入', e);
        }
      }

      // 降级方案：优先尝试从全局 window 获取
      if (!selectedService && typeof window !== 'undefined') {
        const services = window;
        if (services.navSelectedService) {
          selectedService = services.navSelectedService;
        } else if (services.moduleLoader) {
          try {
            selectedService = await services.moduleLoader.load('navSelectedService');
            services.navSelectedService = selectedService;
          } catch (e) {}
        }
      }

      // 同步服务从 index.js 导入
      if (!this.cacheService || !this.langService || !this.toastService) {
        const services = await import('../../index.js');
        if (!this.cacheService) this.cacheService = services.cacheService;
        if (!this.langService) this.langService = services.langService;
        if (!this.toastService) this.toastService = services.toastService;
      }

      if (!selectedService) {
        throw new Error('无法加载 navSelectedService');
      }

      this.selectedService = selectedService;

      // 初始化语言服务
      if (this.langService && !this.langService.translations['zh_cn']) {
        await this.langService.init();
      }
      await Promise.all(['id_id', 'en_us', 'vi_vn'].map(code =>
        (this.langService && !this.langService.translations[code])
          ? this.langService.loadLanguageFile(code).catch(() => {})
          : Promise.resolve()
      ));

      // 🆕 接入统一同步管理器 (Notification-Pull 架构)
      try {
        const songSyncManager = (window.songSyncManager) || (await moduleLoader?.load('songSyncManager'));
        if (songSyncManager?.addSyncListener) {
          songSyncManager.addSyncListener((event) => {
            // 当收到已选列表更新通知时，刷新首页列表和已打开的面板
            if (event.type === 'playlistUpdate' && event.listType === 1) {
              requestAnimationFrame(() => {
                this._refreshHomeSelectedListFromSongService?.();
                if (this.currentOpenPanel) {
                  this.refreshSelectedList(this.currentOpenPanel);
                }
              });
            }
          });
        }
      } catch (e) {
        logWarn('SelectedUI', '由于同步管理器缺失，降级为常规更新模式');
      }
    })();

    return this._initServicesPromise;
  }

  /**
   * 初始化已选歌曲列表（唯一数据源：getPlayList 经 SongService 同步后返回）
   */
  async initSelectedList() {
    try {
      // 仅初始化服务。实际数据拉取由 index.js -> SongSyncManager 同步触发
      await this.initServices();
      
      const selectedContainer = document.getElementById('selectedList');
      if (!selectedContainer) {
        logWarn('SelectedUI', '已选歌曲列表容器未挂载 (Home)，跳过首页初始化');
        return;
      }

      // 如果 SongService 已经有数据（如已完成初次同步），则启动首次渲染
      requestAnimationFrame(() => {
        this._refreshHomeSelectedListFromSongService?.();
      });
    } catch (err) {
      logError('SelectedUI', '初始化已选歌曲失败:', err);
    }
  }

  /**
   * 刷新首页已选列表 - 暂不开放首页背景列表显示
   */
  _refreshHomeSelectedListFromSongService() {
    return;
  }

  /**
   * 刷新首页已选列表
   * @param {string} panelId - 面板ID
   */
  async refreshSelectedListForHome(force = false) {
    // 防抖：如果不是强制刷新，且在短时间内已经刷新过，则跳过
    const now = Date.now();
    if (!force && (now - this.lastHomeListRefresh < 500)) {
      return;
    }
    this.lastHomeListRefresh = now;

    // 清除之前的防抖定时器
    if (this.refreshHomeListThrottle) {
      clearTimeout(this.refreshHomeListThrottle);
      this.refreshHomeListThrottle = null;
    }

    // 初始化服务
    await this.initServices();

    // 获取面板元素
    const panel = document.getElementById('selectedList');
    if (!panel) {
      logWarn('SelectedUI', '面板元素不存在: selectedList');
      return;
    }

    let songs = [];
    try {
      const response = await this.selectedService.getPlayList();
      songs = this.selectedService.processPlayListResponse(response);
    } catch (error) {
      logError('SelectedUI', '刷新已选列表失败:', error);
      // 显示错误状态
      const emptyState = panel.querySelector('#empty-state');
      if (emptyState) {
        emptyState.innerHTML = TemplateUtils.renderEmptyStateTemplate('error');
        emptyState.classList.remove('hidden');
      }
      return;
    }

    // 获取现有的歌曲列表容器
    const songList = panel.querySelector('.song-list');
    const existingList = songList?.querySelector('ul') || panel.querySelector('ul');

    // 如果有歌曲，先清理可能存在的空状态提示
    if (songs.length > 0) {
      // 查找并移除空状态提示（首页容器中直接渲染的空状态）
      // 空状态提示通常在一个包含 flex-col items-center justify-center 的 div 中
      const emptyStateContainers = panel.querySelectorAll('.flex-col.items-center.justify-center');
      emptyStateContainers.forEach(container => {
        const text = container.textContent || '';
        // 检查是否包含空状态提示的文本
        if (text.includes('还没有点任何歌曲') || text.includes('去点一些喜欢的歌曲') ||
          text.includes('No songs selected') || text.includes('Go select some favorite songs')) {
          container.remove();
        }
      });
      // 同时检查是否有独立的空状态图标
      const emptyIcons = panel.querySelectorAll('.fa-music.empty-state-icon');
      emptyIcons.forEach(icon => {
        const container = icon.closest('.flex-col.items-center.justify-center');
        if (container && !container.querySelector('ul')) {
          container.remove();
        }
      });
    }

    // 如果列表不存在，则创建新的
    if (!existingList) {
      if (songList) {
        songList.innerHTML = '';
        const fragment = this.renderSelectedSongsList(songs, 'selected');
        songList.appendChild(fragment);
      } else {
        this.renderSelectedList(songs, panel);
      }
    } else {
      const existingCards = existingList.querySelectorAll('.song-card[data-song-id]');
      const existingSongIds = Array.from(existingCards).map(card => card.dataset.songId);
      const newSongIds = songs.map(song => String(song.id || song.songNo || song.serialNumber || song.num || ''));
      const needsFullRefresh = existingSongIds.length !== newSongIds.length ||
        existingSongIds.some((id, index) => id !== newSongIds[index]);
      const shouldForceRefresh = songs.length <= 1 || Math.abs(existingSongIds.length - newSongIds.length) > 1;

      if (needsFullRefresh || shouldForceRefresh) {
        if (songList) {
          songList.innerHTML = '';
          const fragment = this.renderSelectedSongsList(songs, 'selected');
          songList.appendChild(fragment);

        } else {
          this.renderSelectedList(songs, panel);
        }
      } else {
        existingCards.forEach((card, index) => {
          const song = songs[index];
          if (song) {
            const isCurrent = index === 0;
            const isNext = index === 1;
            card.classList.remove('song-card--current', 'song-card--next', 'song-card--queued');
            if (isCurrent) {
              card.classList.add('song-card--current');
            } else if (isNext) {
              card.classList.add('song-card--next');
            } else {
              card.classList.add('song-card--queued');
            }

            const addButton = card.querySelector('.add-btn');
            if (addButton) {
              addButton.className = 'add-btn song-card-add-btn';
              addButton.classList.remove('play-pause-btn', 'next-btn', 'remove-btn', 'has-playing-indicator', 'is-disabled');
              addButton.removeAttribute('disabled');

              if (isCurrent) {
                addButton.innerHTML = '<div class="playing-indicator"><div class="playing-indicator-inner"><div class="playing-bar animate-bar"></div><div class="playing-bar animate-bar"></div><div class="playing-bar animate-bar"></div></div></div>';
                addButton.classList.add('play-pause-btn', 'has-playing-indicator', 'is-disabled');
                addButton.setAttribute('disabled', 'disabled');
              } else if (isNext) {
                addButton.innerHTML = '<i class="fa fa-step-forward song-card-step-icon"></i>';
                addButton.classList.add('next-btn');
              } else {
                addButton.innerHTML = '<i class="fa fa-trash song-card-arrow-icon"></i>';
                addButton.classList.add('remove-btn');
              }
            }

            const existingPriorityBtn = card.querySelector('.priority-btn');
            if (index > 1) {
              if (!existingPriorityBtn && addButton && addButton.parentNode) {
                const priorityBtn = document.createElement('button');
                priorityBtn.className = 'priority-btn';
                priorityBtn.dataset.songId = String(song.id || song.songNo || song.serialNumber || song.num || '');
                priorityBtn.innerHTML = '<i class="fa fa-arrow-up song-card-priority-icon"></i>';
                addButton.parentNode.insertBefore(priorityBtn, addButton);
              } else if (existingPriorityBtn) {
                existingPriorityBtn.dataset.songId = String(song.id || song.songNo || song.serialNumber || song.num || '');
              }
            } else if (existingPriorityBtn) {
              existingPriorityBtn.remove();
            }
          }
        });
      }
    }

    const emptyState = panel.querySelector('#empty-state');
    if (emptyState) {
      if (songs.length > 0) {
        emptyState.classList.add('hidden');
      } else {
        emptyState.classList.remove('hidden');
      }
    }

    const songCount = panel.querySelector('.song-count');
    if (songCount) {
      const activeTab = panel.querySelector('.tab-active');
      const isSungTab = activeTab && activeTab.dataset.tab === UI_CONSTANTS.SINGED_TAB;
      UIUtils.updateSongCount(panel, songs.length, isSungTab ? UI_CONSTANTS.SINGED_TAB : UI_CONSTANTS.SELECTED_TAB);
    }

    if (!existingList || existingList.querySelectorAll('.song-card').length !== songs.length) {
      this.bindSelectedPanelEvents('selectedList');
    }
  }

  /**
   * 渲染已选歌曲列表
   * @param {Array} songs - 歌曲列表
   * @param {HTMLElement} container - 容器元素
   */
  renderSelectedList(songs, container) {
    if (!container) return;
    
    // 如果没有歌曲，直接渲染空状态
    if (!songs || songs.length === 0) {
      container.innerHTML = '';
      const idT = this.langService?.translations?.zh_cn || {};
      const noSongsSelectedZh = idT['noSongsSelected'] || '还没有点任何歌曲';
      const goSelectSongsZh = idT['goSelectSongs'] || '去点一些喜欢的歌曲吧';
      container.innerHTML = `
        <div class="flex-col items-center justify-center py-16 h-full">
          <p class="page-empty-state-title text-gray-400 dark:text-gray-500 text-center mb-2">${noSongsSelectedZh}</p>
          <p class="page-empty-state-text text-gray-400 dark:text-gray-500 text-center">${goSelectSongsZh}</p>
        </div>`;
      return;
    }

    // 确保有 <ul> 容器
    let list = container.querySelector('ul.space-y-2');
    if (!list) {
      container.innerHTML = '';
      list = document.createElement('ul');
      list.className = 'space-y-2 w-full';
      container.appendChild(list);
    }

    // --- 开始智能差异化渲染 (Reconciliation) ---
    const getSongKey = (s) => String(s?.id || s?.songNo || s?.serialNumber || s?.num || '');
    
    // 1. 建立现有节点池，处理 ID 相同的情况 (一个 ID 对应多个元素)
    const nodePool = new Map();
    Array.from(list.children).forEach(li => {
      const card = li.querySelector('.song-card');
      const sid = card?.dataset.songId;
      if (sid) {
        if (!nodePool.has(sid)) nodePool.set(sid, []);
        nodePool.get(sid).push(li);
      } else {
        li.remove();
      }
    });

    // 2. 根据新数据重新组织列表
    const newItems = [];
    songs.forEach((song, index) => {
      const sid = getSongKey(song);
      let li = null;
      
      if (nodePool.has(sid)) {
        const list = nodePool.get(sid);
        li = list.shift();
        if (list.length === 0) nodePool.delete(sid);
      }
      
      if (!li) {
        // 创建新节点
        li = document.createElement('li');
        const songCard = this.createSelectedSongCardForHome(song, index);
        li.appendChild(songCard);
      }
      
      // 更新现有节点的状态（不替换 card 以免头像闪烁）
      const card = li.querySelector('.song-card');
      if (card) {
        const isCurrent = index === 0;
        const isNext = index === 1;
        const isQueued = !isCurrent && !isNext;
        
        card.classList.toggle('song-card--current', isCurrent);
        card.classList.toggle('playing-card', isCurrent);
        card.classList.toggle('song-card--next', isNext);
        card.classList.toggle('next-card', isNext);
        card.classList.toggle('song-card--queued', isQueued);
        
        const titleEl = card.querySelector('.song-card-title');
        if (titleEl) titleEl.classList.toggle('title-glow', isCurrent);
      }
      
      newItems.push(li);
    });

    // 3. 移除池中剩余不再使用的节点
    nodePool.forEach(list => list.forEach(li => li.remove()));

    // 4. 严格对比并刷新 DOM 顺序
    newItems.forEach((li, index) => {
      if (list.children[index] !== li) {
        list.insertBefore(li, list.children[index] || null);
      }
    });
    
    // 5. 数量对齐清理
    while (list.children.length > newItems.length) {
      list.removeChild(list.lastChild);
    }

    if (list.querySelectorAll('.song-card').length !== songs.length) {
      this.bindSelectedPanelEvents('selectedList');
    }
  }

  /**
   * 创建首页已选歌曲卡片（更小的尺寸）
   * @param {Object} song - 歌曲对象
   * @param {number} index - 歌曲索引
   * @returns {HTMLElement} 歌曲卡片元素
   */
  createSelectedSongCardForHome(song, index) {
    // 使用卡片工厂创建统一的歌曲卡片
    const card = window.SongCardFactory.createUnifiedSongCard(this, song);

    card.classList.remove('song-card--current', 'song-card--next', 'song-card--queued');
    if (index === 0) {
      card.classList.add('song-card--current');
    } else if (index === 1) {
      card.classList.add('song-card--next');
    } else {
      card.classList.add('song-card--queued');
    }

    // 获取歌曲ID
    const songId = song.id || song.songNo || song.serialNumber;

    // 设置卡片数据属性
    if (songId) {
      card.dataset.songId = songId;
    }

    // 添加交互效果
    this.addInteractionEffects(card);

    return card;
  }

  /**
   * 创建已选歌曲卡片
   * @param {Object} song - 歌曲对象
   * @param {number} index - 歌曲索引
   * @returns {HTMLElement} 歌曲卡片元素
   */
  createSelectedSongCard(song, index) {
    // 使用卡片工厂创建统一的歌曲卡片
    const card = window.SongCardFactory.createUnifiedSongCard(this, song);

    card.classList.remove('song-card--current', 'song-card--next', 'song-card--queued');
    if (index === 0) {
      card.classList.add('song-card--current');
    } else if (index === 1) {
      card.classList.add('song-card--next');
    } else {
      card.classList.add('song-card--queued');
    }

    // 获取歌曲ID
    const songId = song.id || song.songNo || song.serialNumber;

    // 设置卡片数据属性
    if (songId) {
      card.dataset.songId = songId;
    }

    // 添加交互效果
    this.addInteractionEffects(card);

    return card;
  }

  /**
   * 添加交互效果
   * @param {HTMLElement} element - 元素
   */
  addInteractionEffects(element) {
    // 已删除卡片动画效果，使用全局样式
  }

  /**
   * 创建已选歌曲面板
   * @param {string} panelId - 面板ID
   */
  async createSelectedPanel(panelId) {
    await this.initServices();

    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;

    // 面板已创建过则直接复用，不重建DOM（性能优化）
    if (panel.dataset.panelReady === 'true') {
      this.currentOpenPanel = panelId;
      return;
    }
    this.currentOpenPanel = panelId;

    // 获取翻译
    const zhTranslations = this.langService?.translations['zh_cn'] || {};
    const idT = this.langService?.translations['id_id'] || {};
    const enT = this.langService?.translations['en_us'] || {};
    const viT = this.langService?.translations['vi_vn'] || {};
    const selectedZh = zhTranslations['selected'] || '已选';
    const sungZh = zhTranslations['sung'] || '已唱';
    const shuffleZh = zhTranslations['shuffle'] || '打乱';
    const clearZh = zhTranslations['clear'] || '清空';
    const noSongsSelectedZh = zhTranslations['noSongsSelected'] || '还没有点任何歌曲';
    const goSelectSongsZh = zhTranslations['goSelectSongs'] || '去点一些喜欢的歌曲吧';
    // 辅助函数：生成四种语言的文字内容
    const multiLangText = (key, zh, id, en, vi) => {
      const tZh = zh || zhTranslations[key] || '';
      const tId = id || idT[key] || '';
      const tEn = en || enT[key] || '';
      const tVi = vi || viT[key] || '';
      return `<span class="zh-label" data-lang-key="${key}">${tZh}</span>` +
             `<span class="indonesian-translation">${tId}</span>` +
             `<span class="en-translation">${tEn}</span>` +
             `<span class="vi-translation">${tVi}</span>`;
    };

    // 先创建面板结构
    const panelContent = `
        <div id="${panelId}-overlay" class="fixed inset-0 bg-black/50 opacity-0 transition-opacity duration-300 pointer-events-none"></div>
        <div class="premium-panel-base text-white transform translate-y-[120%] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] bg-cover bg-center flex flex-col" style="background-image: url('./assets/images/bg_window.png')">
          
          <!-- Handle -->
          <div class="w-14 h-2 bg-white/20 rounded-full mx-auto mt-3 mb-1"></div>

          <div class="px-6 pt-4 pb-6 relative z-10">
            <div class="flex justify-between items-center mb-8">
              <div class="song-tabs premium-tab-container flex-1 flex space-x-2 rounded-2xl">
                <button class="tab-btn flex-1 px-2 py-3 rounded-xl text-xl font-bold transition-all duration-300 selected-tab-btn text-gray-400 whitespace-nowrap flex items-center justify-center" data-tab="selected">
                  <i class="fa fa-list-ul text-2xl mr-2 flex-shrink-0"></i>${multiLangText('selected', selectedZh, idT['selected'], enT['selected'], viT['selected'])}
                </button>
                <button class="tab-btn flex-1 px-2 py-3 rounded-xl text-xl font-bold text-gray-400 transition-all duration-300 sung-tab-btn whitespace-nowrap flex items-center justify-center" data-tab="sung">
                  <i class="fa fa-history text-2xl mr-2 flex-shrink-0"></i>${multiLangText('sung', sungZh, idT['sung'], enT['sung'], viT['sung'])}
                </button>
              </div>
              <button class="control-btn w-12 h-12 flex items-center justify-center bg-white/10 rounded-full text-white/60 hover:text-white transition-colors close-panel-btn">
                <i class="fa fa-times text-2xl"></i>
              </button>
            </div>
            
            <div class="flex justify-between items-center mb-6">
              <div class="flex flex-col">
                <h2 class="text-3xl font-black gradient-text selected-panel-title">${multiLangText('playlist', '播放列表', idT['playlist'] || 'Daftar Putar', enT['playlist'] || 'Playlist', viT['playlist'] || 'Danh sách phát')}</h2>
                <div class="text-lg text-gray-400 font-bold mt-1.5 song-count">
                  ${multiLangText('songCountPrefix', '当前共有', idT['songCountPrefix'] || 'Saat ini ada', enT['songCountPrefix'] || 'Total', viT['songCountPrefix'] || 'Tổng cộng')} 0 ${multiLangText('songCountSuffix', '首歌曲', idT['songCountSuffix'] || 'lagu', enT['songCountSuffix'] || 'songs', viT['songCountSuffix'] || 'bài hát')}
                </div>
              </div>
              <div class="flex gap-2">
                <button class="premium-control-btn btn-premium-gray px-6 py-3 rounded-2xl text-lg font-bold flex items-center text-white/80 hover:text-white shuffle-btn">
                  <i class="fa fa-random mr-2"></i>${multiLangText('shuffle', shuffleZh, idT['shuffle'], enT['shuffle'], viT['shuffle'])}
                </button>
                <button class="premium-control-btn btn-premium-gray px-6 py-3 rounded-2xl text-lg font-bold flex items-center text-white/80 hover:text-white clear-btn">
                  <i class="fa fa-trash-alt mr-2 text-red-500"></i>${multiLangText('clear', clearZh, idT['clear'], enT['clear'], viT['clear'])}
                </button>
              </div>
            </div>
          </div>
          
          <div class="panel-shell__body relative z-10 flex flex-col" style="min-height:0;flex:1;">
            <div class="overflow-y-auto px-4 pb-4" style="flex:1;min-height:0;" data-scrollable="true">
              <ul class="space-y-3 song-list w-full"></ul>
              <div id="empty-state" class="hidden flex-col items-center justify-center py-12" style="display:none">
                <div class="text-gray-400 dark:text-gray-500 page-empty-state-title mb-4 flex justify-center">
                  <i class="fa fa-music empty-state-icon"></i>
                </div>
                <p class="page-empty-state-title text-gray-400 dark:text-gray-500 text-center mb-2">${multiLangText('noSongsSelected', noSongsSelectedZh, idT['noSongsSelected'], enT['noSongsSelected'], viT['noSongsSelected'])}</p>
                <p class="page-empty-state-text text-gray-400 dark:text-gray-500 text-center">${multiLangText('goSelectSongs', goSelectSongsZh, idT['goSelectSongs'], enT['goSelectSongs'], viT['goSelectSongs'])}</p>
              </div>
            </div>
          </div>
        </div>`;

    panel.innerHTML = panelContent;
    // 标记面板已创建完成，后续打开直接复用
    panel.dataset.panelReady = 'true';

    // 关闭处理函数
    const closeHandler = () => {
      document.dispatchEvent(new CustomEvent('closePanel', {
        detail: { panelId }
      }));
    };
    
    // 关闭面板按钮
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeHandler);
    
    // 遮罩点击关闭
    const overlay = panel.querySelector(`#${panelId}-overlay`);
    if (overlay) overlay.addEventListener('click', closeHandler);
    this.bindSelectedPanelEvents(panelId);
    UIUtils.updateTabUI(panel, UI_CONSTANTS.SELECTED_TAB);
    UIUtils.updatePanelTitle(panel, UI_CONSTANTS.SELECTED_TAB);

    // 重置滚动位置
    const scrollableContainer = panel.querySelector('[data-scrollable="true"]');
    if (scrollableContainer) {
      scrollableContainer.scrollTop = 0;
    }

    // 注意：面板显示由 BottomNavUI.showPanel 统一管理，这里不显示面板
    // 避免重复显示导致的问题

    // 加载数据（异步加载，不阻塞面板显示）
    this._loadAndRenderSongs(panelId, panel);

    // 仅禁用「已选」按钮本身，避免重复打开；不禁用整个按钮栏，保证首页/派对/点歌/点单等仍可点击
    const selectedOpenBtn = document.getElementById('selected-open');
    if (selectedOpenBtn) {
      selectedOpenBtn.classList.add('pointer-events-none');
      selectedOpenBtn.classList.remove('pointer-events-auto');
    }

    // 注意：动画效果由 BottomNavUI.showPanel 统一管理，这里不启动动画
  }


  /**
   * 从 SongService 刷新已选面板列表（与歌曲卡片同一数据源，保证状态一致）
   * 在歌曲同步时调用，仅当已选面板可见时刷新
   */
  _refreshSelectedPanelFromSongService() {
    const panel = document.getElementById('selected-panel');
    if (!panel || panel.classList.contains('hidden')) return;
    const songService = typeof window !== 'undefined' ? window.songService : null;
    if (!songService || !Array.isArray(songService.selectedSongs)) return;
    const songList = panel.querySelector('.song-list');
    if (!songList) return;
    const activeTab = panel.querySelector('.tab-active');
    const currentTab = activeTab ? activeTab.dataset.tab : 'selected';
    if (currentTab !== UI_CONSTANTS.SELECTED_TAB) return;
    const songs = songService.selectedSongs;
    const getSongKey = (song) => String(song?.id || song?.songNo || song?.serialNumber || song?.num || '');
    const newSig = songs.map(s => `${getSongKey(s)}:${s?.status ?? ''}`).join(',');
    const newIdsSig = songs.map(getSongKey).join(',');

    if (this._lastRenderedSig === newSig) return;

    // 防抖：16ms 内多次触发只渲染一次
    if (this._refreshPanelTimer) return;
    this._refreshPanelTimer = requestAnimationFrame(() => {
      this._refreshPanelTimer = null;
      const existingCards = songList.querySelectorAll('.song-card[data-song-id]');
      const canPatchInPlace =
        this._lastRenderedIdsSig === newIdsSig &&
        existingCards.length === songs.length &&
        songs.length > 0;

      if (canPatchInPlace) {
        existingCards.forEach((card, index) => {
          const song = songs[index];
          if (!song) return;

          const isCurrent = index === 0;
          const isNext = index === 1;
          card.classList.remove('song-card--current', 'song-card--next', 'song-card--queued');

          if (isCurrent) {
            card.classList.add('song-card--current');
          } else if (isNext) {
            card.classList.add('song-card--next');
          } else {
            card.classList.add('song-card--queued');
          }

          const addButton = card.querySelector('.add-btn');
          if (!addButton) return;

          addButton.className = 'add-btn song-card-add-btn';
          addButton.classList.remove('play-pause-btn', 'next-btn', 'remove-btn', 'has-playing-indicator', 'is-disabled');
          addButton.removeAttribute('disabled');

          if (isCurrent) {
            addButton.innerHTML = '<div class="playing-indicator"><div class="playing-indicator-inner"><div class="playing-bar animate-bar"></div><div class="playing-bar animate-bar"></div><div class="playing-bar animate-bar"></div></div></div>';
            addButton.classList.add('play-pause-btn', 'has-playing-indicator', 'is-disabled');
            addButton.setAttribute('disabled', 'disabled');
          } else if (isNext) {
            addButton.innerHTML = '<i class="fa fa-step-forward song-card-step-icon"></i>';
            addButton.classList.add('next-btn');
          } else {
            addButton.innerHTML = '<i class="fa fa-trash song-card-arrow-icon"></i>';
            addButton.classList.add('remove-btn');
          }

          const actionContainer = card.querySelector('.song-card-actions');
          const existingPriorityBtn = actionContainer?.querySelector('.priority-btn');
          if (index > 1) {
            const dbId = song.id != null ? String(song.id) : '';
            if (!existingPriorityBtn && actionContainer) {
              const priorityBtn = document.createElement('button');
              priorityBtn.className = 'priority-btn';
              if (dbId) {
                priorityBtn.dataset.dbId = dbId;
              }
              priorityBtn.innerHTML = '<i class="fa fa-arrow-up song-card-priority-icon"></i>';
              actionContainer.insertBefore(priorityBtn, addButton);
            } else if (existingPriorityBtn) {
              if (dbId) {
                existingPriorityBtn.dataset.dbId = dbId;
              } else {
                delete existingPriorityBtn.dataset.dbId;
              }
            }
          } else if (existingPriorityBtn) {
            existingPriorityBtn.remove();
          }
        });
      } else {
        // --- 智能对齐逻辑：避免 innerHTML = '' 导致的头像闪烁 ---
        // 1. 建立现有节点池，处理 ID 相同的情况 (一个 ID 对应多个元素)
        const nodePool = new Map();
        Array.from(songList.children).forEach(li => {
          const card = li.querySelector('.song-card');
          const sid = card?.dataset.songId;
          if (sid) {
            if (!nodePool.has(sid)) nodePool.set(sid, []);
            nodePool.get(sid).push(li);
          } else {
            li.remove(); // 移除没有 ID 的异常节点
          }
        });

        const newItems = [];
        songs.forEach((song, index) => {
          const sid = getSongKey(song);
          let li = null;
          
          // 从池中取出一个可复用的节点
          if (nodePool.has(sid)) {
            const list = nodePool.get(sid);
            li = list.shift();
            if (list.length === 0) nodePool.delete(sid);
          }
          
          if (!li) {
            // 池中没有，则创建新节点
            li = document.createElement('li');
            const card = window.SongCardFactory.createUnifiedSongCard(this, song);
            if (card) li.appendChild(card);
          }
          
          // 统一应用最新的状态样式（解决复用时状态不更新问题）
          let card = li.querySelector('.song-card');
          if (card) {
             const isCurrent = index === 0;
             const isNext = index === 1;
             const isQueued = !isCurrent && !isNext;
             
             // --- 1. 更新卡片状态类名 (控制背景色) ---
             card.classList.toggle('song-card--current', isCurrent);
             card.classList.toggle('playing-card', isCurrent);
             card.classList.toggle('song-card--next', isNext);
             card.classList.toggle('next-card', isNext);
             card.classList.toggle('song-card--queued', isQueued);
             
             // --- 2. 更新按钮图标和状态 (不重置整个卡片) ---
             const addButton = card.querySelector('.add-btn');
             if (addButton) {
               const currentBtnType = addButton.dataset.btnType;
               const nextBtnType = isCurrent ? 'playing' : (isNext ? 'next' : 'remove');
               
               if (currentBtnType !== nextBtnType) {
                 addButton.dataset.btnType = nextBtnType;
                 addButton.className = 'add-btn song-card-add-btn w-11 h-11 flex items-center justify-center rounded-2xl transition-transform active:scale-90';
                 addButton.removeAttribute('disabled');
                 
                 if (isCurrent) {
                   addButton.classList.add('bg-red-500/10', 'border', 'border-red-500/20', 'shadow-inner', 'play-pause-btn', 'has-playing-indicator', 'is-disabled');
                   addButton.setAttribute('disabled', 'disabled');
                   addButton.innerHTML = window.SongCardFactory.createPlayingAnimation();
                 } else if (isNext) {
                   addButton.classList.add('bg-red-500/10', 'border', 'border-red-500/20', 'shadow-inner', 'next-btn');
                   addButton.innerHTML = '<i class="fa fa-step-forward song-card-step-icon"></i>';
                 } else {
                   addButton.classList.add('bg-white/5', 'border', 'border-white/10', 'shadow-inner', 'remove-btn');
                   addButton.innerHTML = '<i class="fa fa-trash song-card-arrow-icon"></i>';
                 }
               }
             }

             // --- 3. 更新优先按钮 (Priority Button) ---
             const actionContainer = card.querySelector('.song-card-actions');
             if (actionContainer) {
                const existingPriorityBtn = actionContainer.querySelector('.priority-btn');
                if (!isQueued) {
                  existingPriorityBtn?.remove();
                } else if (!existingPriorityBtn && addButton) {
                  const priorityBtn = document.createElement('button');
                  priorityBtn.className = 'priority-btn';
                  const dbId = song.id != null ? String(song.id) : '';
                  if (dbId) priorityBtn.dataset.dbId = dbId;
                  priorityBtn.innerHTML = '<i class="fa fa-arrow-up song-card-priority-icon"></i>';
                  actionContainer.insertBefore(priorityBtn, addButton);
                } else if (existingPriorityBtn) {
                  const dbId = song.id != null ? String(song.id) : '';
                  if (dbId) existingPriorityBtn.dataset.dbId = dbId;
                }
             }

             // --- 4. 更新标题状态 ---
             const titleEl = card.querySelector('.song-card-title');
             if (titleEl) {
               titleEl.classList.toggle('title-glow', isCurrent);
             }
          }
          newItems.push(li);
        });

        // 3. 移除剩余不再使用的节点
        nodePool.forEach(list => {
          list.forEach(li => li.remove());
        });

        // 4. 严格同步 DOM 顺序和数量
        newItems.forEach((li, index) => {
          if (songList.children[index] !== li) {
            songList.insertBefore(li, songList.children[index] || null);
          }
        });
        
        // 5. 二次清理多出的尾部节点（双重保险）
        while (songList.children.length > newItems.length) {
          songList.removeChild(songList.lastChild);
        }
      }

      this._lastRenderedSig = newSig;
      this._lastRenderedIdsSig = newIdsSig;
      const emptyState = panel.querySelector('#empty-state');
      if (emptyState) emptyState.classList.toggle('hidden', songs.length > 0);
      const songCount = panel.querySelector('.song-count');
      if (songCount) UIUtils.updateSongCount(panel, songs.length, UI_CONSTANTS.SELECTED_TAB);
      UIUtils.updatePanelTitle(panel, UI_CONSTANTS.SELECTED_TAB);
    });
  }

  /**
   * 加载并渲染歌曲列表
   * @param {string} panelId - 面板ID
   * @param {HTMLElement} panel - 面板元素
   */
  async _loadAndRenderSongs(panelId, panel) {
    if (!panel) {
      panel = document.getElementById(`${panelId}-panel`);
      if (!panel) return;
    }

    try {
      await this.initServices();
      if (!this.selectedService) throw new Error('selectedService 未初始化');

      // 优先使用 SongService 内存缓存，避免打开面板时发起额外请求
      const songService = typeof window !== 'undefined' ? window.songService : null;
      let songs = null;
      if (songService && Array.isArray(songService.selectedSongs) && songService.selectedSongs.length > 0) {
        songs = songService.selectedSongs;
      } else {
        // 缓存不可用时才发请求（不强制刷新）
        const response = await this.selectedService.getPlayList();
        songs = this.selectedService.processPlayListResponse(response);
      }

      const songList = panel.querySelector('.song-list');
      const emptyState = panel.querySelector('#empty-state');
      const songCount = panel.querySelector('.song-count');
      if (!songList) return;

      // 重置签名，确保本次渲染不被跳过
      this._lastRenderedSig = null;
      this._lastRenderedIdsSig = null;

      // 强制隐藏空状态（防止任何情况下误显示）
      if (emptyState) {
        emptyState.style.display = 'none';
        emptyState.classList.add('hidden');
      }

      if (songs.length > 0) {
        try {
          const getSongKey = (s) => String(s?.id || s?.songNo || s?.serialNumber || s?.num || '');
          
          // --- 智能对齐：通过节点池处理重复项 ---
          const nodePool = new Map();
          Array.from(songList.children).forEach(li => {
            const card = li.querySelector('.song-card');
            const sid = card?.dataset.songId;
            if (sid) {
              if (!nodePool.has(sid)) nodePool.set(sid, []);
              nodePool.get(sid).push(li);
            } else {
              li.remove();
            }
          });

          const newItems = [];
          songs.forEach((song, index) => {
            const sid = getSongKey(song);
            let li = null;
            
            if (nodePool.has(sid)) {
              const list = nodePool.get(sid);
              li = list.shift();
              if (list.length === 0) nodePool.delete(sid);
            }
            
            if (!li) {
              li = document.createElement('li');
              const card = window.SongCardFactory.createUnifiedSongCard(this, song);
              if (card) li.appendChild(card);
            }
            
            // 统一应用最新的状态样式
            let card = li.querySelector('.song-card');
            if (card) {
                const isCurrent = index === 0;
                const isNext = index === 1;
                const isQueued = !isCurrent && !isNext;
                
                card.classList.toggle('song-card--current', isCurrent);
                card.classList.toggle('playing-card', isCurrent);
                card.classList.toggle('song-card--next', isNext);
                card.classList.toggle('next-card', isNext);
                card.classList.toggle('song-card--queued', isQueued);
                
                const titleEl = card.querySelector('.song-card-title');
                if (titleEl) titleEl.classList.toggle('title-glow', isCurrent);
                
                // 此处复用简单的按钮内容重置（如果已经有正确内容则不操作）
                const addButton = card.querySelector('.add-btn');
                if (addButton) {
                    const btnType = isCurrent ? 'playing' : (isNext ? 'next' : 'remove');
                    if (addButton.dataset.btnType !== btnType) {
                        addButton.dataset.btnType = btnType;
                        // 重置并应用正确的状态类名
                        addButton.className = 'add-btn song-card-add-btn w-11 h-11 flex items-center justify-center rounded-2xl transition-transform active:scale-90';
                        if (isCurrent) {
                            addButton.classList.add('play-pause-btn', 'has-playing-indicator', 'is-disabled');
                            addButton.innerHTML = window.SongCardFactory.createPlayingAnimation();
                        } else if (isNext) {
                            addButton.classList.add('next-btn');
                            addButton.innerHTML = '<i class="fa fa-step-forward song-card-step-icon"></i>';
                        } else {
                            addButton.classList.add('remove-btn');
                            addButton.innerHTML = '<i class="fa fa-trash song-card-arrow-icon"></i>';
                        }
                    }
                }
            }
            newItems.push(li);
          });

          // 移除移除多余节点
          nodePool.forEach(list => list.forEach(li => li.remove()));
          
          // 对比并刷新 DOM 顺序
          newItems.forEach((li, index) => {
            if (songList.children[index] !== li) {
              songList.insertBefore(li, songList.children[index] || null);
            }
          });
          
          // 最终数量对齐
          while (songList.children.length > newItems.length) {
            songList.removeChild(songList.lastChild);
          }

          this._lastRenderedSig = songs.map(s => `${getSongKey(s)}:${s?.status ?? ''}`).join(',');
          this._lastRenderedIdsSig = songs.map(getSongKey).join(',');
        } catch (renderErr) {
          logError('SelectedUI', '渲染歌曲列表失败:', renderErr);
        }
        // 有歌曲就隐藏空状态
        if (emptyState) { emptyState.style.display = 'none'; emptyState.classList.add('hidden'); }
        if (songCount) UIUtils.updateSongCount(panel, songs.length, UI_CONSTANTS.SELECTED_TAB);
        UIUtils.updatePanelTitle(panel, UI_CONSTANTS.SELECTED_TAB);
      } else {
        songList.innerHTML = '';
        if (emptyState) { emptyState.style.display = 'flex'; emptyState.classList.remove('hidden'); }
        if (songCount) UIUtils.updateSongCount(panel, 0, UI_CONSTANTS.SELECTED_TAB);
        UIUtils.updatePanelTitle(panel, UI_CONSTANTS.SELECTED_TAB);
      }

      const scrollableContainer = panel.querySelector('[data-scrollable="true"]');
      if (scrollableContainer) scrollableContainer.scrollTop = 0;
    } catch (error) {
      logError('SelectedUI', '加载歌曲列表失败:', error);
      // 不在catch里显示空状态，避免因渲染错误误显示
    }
  }

  /**
   * 刷新已选列表
   * @param {string} panelId - 面板ID
   */
  async refreshSelectedList(panelId) {
    if (this._refreshBusy) {
      this._refreshPending = true;
      return;
    }

    await this.initServices();
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) {
      return;
    }

    // 如果当前在已唱 tab，完全跳过，不干扰已唱列表
    const activeTab = panel.querySelector('.tab-active');
    const isOnSungTab = activeTab && activeTab.dataset.tab === UI_CONSTANTS.SINGED_TAB;
    if (isOnSungTab) return;

    this._refreshBusy = true;

    // 重置滚动位置（在刷新前）
    const scrollableContainer = panel.querySelector('[data-scrollable="true"]');
    if (scrollableContainer) {
      scrollableContainer.scrollTop = 0;
    }

    // 直接调用统一的加载和渲染方法
    await this._loadAndRenderSongs(panelId, panel);

    this.bindSelectedPanelEvents(panelId);

    this._refreshBusy = false;
    if (this._refreshPending) {
      this._refreshPending = false;
      setTimeout(() => this.refreshSelectedList(panelId), 100);
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
   * 加载已唱列表：GET /api/v1/rooms/:id/queue/played → { code:0, data: Array<RoomQueueItem> }
   */
  async _loadSungList(panel) {
    await this.initServices();
    try {
      const songs = await this.selectedService.getPlayedList();
      const songList = panel.querySelector('.song-list');
      if (!songList) return;
      songList.innerHTML = songs.map(song => {
        const songNo = song.songNo || '';
        const name = song.name || '未知歌曲';
        const singer = song.singer || '未知歌手';
        return `<li>
          <div class="song-card song-card-premium song-card--queued rounded-xl p-2.5 flex items-center gap-3" data-song-id="${songNo}">
            <div class="song-info flex-1 min-w-0">
              <div class="song-card-title font-bold text-white truncate text-sm">${name}</div>
              <div class="text-xs text-gray-400 mt-1">${singer}</div>
            </div>
            <div class="song-card-actions flex items-center">
              <button class="request-btn add-btn song-card-add-btn w-11 h-11 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10" data-song-id="${songNo}">
                <i class="fa fa-undo song-card-replay-icon"></i>
              </button>
            </div>
          </div>
        </li>`;
      }).join('');
      UIUtils.updateEmptyState(panel, songs.length);
      UIUtils.updateSongCount(panel, songs.length, 'sung');
    } catch (e) {
      logError('[SelectedUI] 获取已唱列表失败:', e);
    }
  }

  /**
   * 渲染已选歌曲列表（使用DocumentFragment优化性能）
   * @param {Array} songs - 歌曲列表
   * @param {string} tabType - 标签页类型 ('selected' 或 'sung')
   * @returns {DocumentFragment} DocumentFragment对象，用于批量DOM更新
   */
  renderSelectedSongsList(songs, tabType = 'selected') {
    const isSungList = tabType === 'sung';

    // 使用DocumentFragment批量创建DOM，减少重排重绘
    const fragment = document.createDocumentFragment();
    const orderedSongs = isSungList ? [...songs].reverse() : songs;

    orderedSongs.forEach((song, index) => {
      // 判断是否为当前播放或下一首
      const isCurrent = index === 0;
      const isNext = index === 1;

      // 生成拼音（如果歌曲名称是中文），兼容 API 字段 songName
      let pinyinText = '';
      const songName = song.name || song.songName || '未知歌曲';
      if (songName && /[一-龥]/.test(songName)) {
        try {
          const pinyin = window.pinyinPro?.pinyin;
          if (pinyin) {
            pinyinText = pinyin(songName, { toneType: 'none' });
          }
        } catch (e) {
          logWarn('SelectedUI', '拼音转换失败:', e);
        }
      }

      if (!window.SongCardFactory?.createUnifiedSongCard) {
        logError('SelectedUI', 'SongCardFactory 不可用');
        return;
      }

      const card = window.SongCardFactory.createUnifiedSongCard(this, song);
      if (!card) return;

      card.classList.add('song-card-premium', 'animate-stagger');
      card.style.animationDelay = `${index * 0.05}s`;

      if (isCurrent) {
        card.classList.add('playing-card', 'song-card--current');
        const titleEl = card.querySelector('.song-card-title');
        if (titleEl) titleEl.classList.add('title-glow');
      } else if (isNext) {
        card.classList.add('next-card', 'song-card--next');
      } else {
        card.classList.add('song-card--queued');
      }

      const addButton = card.querySelector('.add-btn');
      const actionContainer = card.querySelector('.song-card-actions');
      if (!addButton || !actionContainer) return;

      addButton.className = 'add-btn song-card-add-btn w-11 h-11 flex items-center justify-center rounded-2xl transition-transform active:scale-90';
      addButton.removeAttribute('disabled');
      addButton.innerHTML = '';

      // 清理旧的 priority-btn
      actionContainer.querySelector('.priority-btn')?.remove();

      if (isCurrent) {
        addButton.classList.add('bg-red-500/10', 'border', 'border-red-500/20', 'shadow-inner', 'play-pause-btn', 'has-playing-indicator', 'is-disabled');
        addButton.setAttribute('disabled', 'disabled');
        addButton.innerHTML = '<div class="playing-indicator"><div class="playing-indicator-inner"><div class="playing-bar animate-bar"></div><div class="playing-bar animate-bar"></div><div class="playing-bar animate-bar"></div></div></div>';
      } else if (isNext) {
        addButton.classList.add('bg-red-500/10', 'border', 'border-red-500/20', 'shadow-inner', 'next-btn');
        addButton.innerHTML = '<i class="fa fa-step-forward song-card-step-icon"></i>';
      } else {
        addButton.classList.add('bg-white/5', 'border', 'border-white/10', 'shadow-inner', 'remove-btn');
        addButton.innerHTML = '<i class="fa fa-trash song-card-arrow-icon"></i>';
      }

      if (index > 1) {
        const priorityBtn = document.createElement('button');
        priorityBtn.className = 'priority-btn';
        const id = song.id || song.songNo;
        if (id != null) priorityBtn.dataset.dbId = String(id);
        priorityBtn.innerHTML = '<i class="fa fa-arrow-up song-card-priority-icon"></i>';
        actionContainer.insertBefore(priorityBtn, addButton);
      }

      const listItem = document.createElement('li');
      listItem.appendChild(card);
      fragment.appendChild(listItem);
    });

    return fragment;
  }

  /**
   * 清理面板事件监听器
   * @param {string} panelId - 面板ID
   */
  cleanupPanelEvents(panelId) {
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;

    // 获取已存储的事件处理器
    const handlers = this._eventHandlers.get(panel);
    if (handlers) {
      // 移除所有事件监听器
      if (handlers.closeBtn && handlers.closeBtnHandler) {
        handlers.closeBtn.removeEventListener('click', handlers.closeBtnHandler);
      }
      if (handlers.selectedTabBtn && handlers.selectedTabHandler) {
        handlers.selectedTabBtn.removeEventListener('click', handlers.selectedTabHandler);
      }
      if (handlers.sungTabBtn && handlers.sungTabHandler) {
        handlers.sungTabBtn.removeEventListener('click', handlers.sungTabHandler);
      }
      if (handlers.shuffleBtn && handlers.shuffleHandler) {
        handlers.shuffleBtn.removeEventListener('click', handlers.shuffleHandler);
      }
      if (handlers.clearBtn && handlers.clearHandler) {
        handlers.clearBtn.removeEventListener('click', handlers.clearHandler);
      }
      if (handlers.panelClickHandler) {
        panel.removeEventListener('click', handlers.panelClickHandler);
      }

      // 从WeakMap中删除
      this._eventHandlers.delete(panel);
    }

    // 重置绑定标记
    panel.dataset.eventsBound = 'false';
  }

  /**
   * 绑定已选歌曲面板事件
   * @param {string} panelId - 面板ID
   */
  bindSelectedPanelEvents(panelId) {
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;

    // 如果已绑定，先清理旧的事件监听器
    if (panel.dataset.eventsBound === 'true') {
      this.cleanupPanelEvents(panelId);
    }

    // 创建事件处理器对象，存储引用以便后续清理
    const handlers = {};

    // 绑定关闭按钮事件
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) {
      handlers.closeBtnHandler = () => {
        // 触发底部导航UI关闭面板
        const event = new CustomEvent('closePanel', { detail: { panelId } });
        document.dispatchEvent(event);
      };
      handlers.closeBtn = closeBtn;
      closeBtn.addEventListener('click', handlers.closeBtnHandler);
    }

    // 绑定标签页切换事件
    const selectedTabBtn = panel.querySelector('.selected-tab-btn');
    const sungTabBtn = panel.querySelector('.sung-tab-btn');

    if (selectedTabBtn) {
      handlers.selectedTabHandler = async (e) => {
        if (e.cancelable) {
          e.preventDefault();
        }
        await this.switchTab(panelId, 'selected');
      };
      handlers.selectedTabBtn = selectedTabBtn;
      selectedTabBtn.addEventListener('click', handlers.selectedTabHandler);
    }

    if (sungTabBtn) {
      handlers.sungTabHandler = async (e) => {
        if (e.cancelable) {
          e.preventDefault();
        }
        await this.switchTab(panelId, 'sung');
      };
      handlers.sungTabBtn = sungTabBtn;
      sungTabBtn.addEventListener('click', handlers.sungTabHandler);
    }

    // 绑定打乱按钮事件
    const shuffleBtn = panel.querySelector('.shuffle-btn');
    if (shuffleBtn) {
      handlers.shuffleHandler = () => {
        this.shuffleSongs(panelId);
      };
      handlers.shuffleBtn = shuffleBtn;
      shuffleBtn.addEventListener('click', handlers.shuffleHandler);
    }

    // 绑定清空按钮事件
    const clearBtn = panel.querySelector('.clear-btn');
    if (clearBtn) {
      handlers.clearHandler = () => {
        this.clearSongs(panelId);
      };
      handlers.clearBtn = clearBtn;
      clearBtn.addEventListener('click', handlers.clearHandler);
    }

    // 统一事件委托：为动态渲染的歌曲按钮绑定点击事件
    handlers.panelClickHandler = async (e) => {
      const target = e.target;

      // 优先按钮
      const priorityBtn = target.closest('.priority-btn');
      if (priorityBtn) {
        e.stopPropagation();

        const dbId = priorityBtn.dataset.dbId;
        if (dbId) {
          await this.upWord(panelId, dbId);
        } else {
          logError('SelectedUI', '优先播放按钮缺少有效的 dbId');
        }
        return;
      }

      // 点唱按钮（已唱列表中的点唱按钮）
      const requestBtn = target.closest('.request-btn');
      if (requestBtn) {
        e.stopPropagation();

        const icon = requestBtn.querySelector('.song-card-replay-icon');
        if (icon) {
          icon.classList.remove('song-card-replay-icon--animating');
          void icon.offsetWidth;
          icon.classList.add('song-card-replay-icon--animating');
          const handleAnimationEnd = () => {
            icon.classList.remove('song-card-replay-icon--animating');
            icon.removeEventListener('animationend', handleAnimationEnd);
          };
          icon.addEventListener('animationend', handleAnimationEnd, { once: true });
        }
        const songCard = requestBtn.closest('.song-card');
        const songId = requestBtn.dataset.songId || songCard?.dataset.songId;
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
        const dbId = songCard ? (songCard.dataset.dbId || songCard.dataset.songId) : undefined;
        if (dbId) {
          // 调用删除接口，传入数据库记录 ID 或歌曲编号
          await this.delete(panelId, dbId);
        } else if (songCard) {
          // 兜底：如果无法获取到 id，仅移除UI
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
    };
    panel.addEventListener('click', handlers.panelClickHandler);

    // 存储所有事件处理器引用，以便后续清理
    this._eventHandlers.set(panel, handlers);

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

    // 检查当前激活的标签页，如果已经是目标标签，则跳过切换，避免不必要的清空和重新加载
    const activeTab = panel.querySelector('.tab-active');
    if (activeTab && activeTab.dataset.tab === tab) {

      return;
    }

    // 保存当前标签页，以便在切换失败时恢复
    const previousTab = activeTab ? activeTab.dataset.tab : null;

    // 初始化服务
    await this.initServices();

    // 切换标签页UI（先切换UI，如果失败再恢复）
    UIUtils.updateTabUI(panel, tab);
    UIUtils.updatePanelTitle(panel, tab);

    // 获取对应标签页的数据
    try {
      if (tab === UI_CONSTANTS.SINGED_TAB) {
        await this._loadSungList(panel);
        return;
      }

      const response = await this.selectedService.getPlayList();
      const songs = this.selectedService.processPlayListResponse(response);
      // 更新歌曲列表（使用DocumentFragment批量更新）
      const songList = panel.querySelector('.song-list');
      if (songList) {
        // 只有在成功获取数据后才清空现有内容
        // 清空现有内容
        songList.innerHTML = '';
        // 使用DocumentFragment批量添加
        const fragment = this.renderSelectedSongsList(songs, tab);
        songList.appendChild(fragment);

        // 更新空状态显示
        UIUtils.updateEmptyState(panel, songs.length);

        // 更新歌曲计数
        UIUtils.updateSongCount(panel, songs.length, tab);

        // 同步更新首页标题
        UIUtils.updateHomeTitle(tab);
        UIUtils.updatePanelTitle(panel, tab);

      }
    } catch (error) {
      logError(`[SelectedUI] 切换到${tab}标签页失败:`, error);
      // 如果切换失败，恢复原来的标签页状态
      if (previousTab) {
        UIUtils.updateTabUI(panel, previousTab);
        UIUtils.updatePanelTitle(panel, previousTab);

      }
      // 显示错误状态
      const emptyState = panel.querySelector('#empty-state');
      if (emptyState) {
        emptyState.innerHTML = TemplateUtils.renderEmptyStateTemplate('error');
        emptyState.classList.remove('hidden');
      }
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

      // 移除立即列表刷新，等待WebSocket消息触发列表更新

    } catch (error) {
      logError('SelectedUI', '打乱歌曲顺序失败:', error);
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

    // 获取面板元素以检查当前激活的标签页
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) {
      logError('SelectedUI', '面板元素不存在:', panelId);
      this.showToast('清空列表失败：找不到面板', 'error');
      return;
    }

    // 检查当前激活的标签页
    const activeTab = panel.querySelector('.tab-active');
    if (!activeTab) {
      logError('未找到激活的标签页');
      this.showToast('清空列表失败：无法确定当前标签页', 'error');
      return;
    }

    const currentTab = activeTab.dataset.tab;

    if (currentTab !== UI_CONSTANTS.SELECTED_TAB && currentTab !== UI_CONSTANTS.SINGED_TAB) {
      logError('SelectedUI', '未知的标签页类型:', currentTab);
      this.showToast('清空列表失败：未知的标签页类型', 'error');
      return;
    }

    try {
      // 调用服务清空列表
      await this.selectedService.clearPlayList();
      logInfo('清空列表请求已发送');
    } catch (error) {
      logError('SelectedUI', '清空歌曲列表失败:', error);
      this.showToast('清空列表失败', 'error');
      // 如果清空失败，重新刷新列表
      if (currentTab === UI_CONSTANTS.SELECTED_TAB) {
        await this.refreshSelectedList(panelId);
        await this.refreshSelectedListForHome(true);
      }
    }
  }

  /**
   * 显示提示消息
   * @param {string} message - 消息内容
   * @param {string} type - 消息类型 (success, error)
   */
  showToast(message, type = 'success') {
    logInfo(`[提示] ${message} (类型: ${type})`);
  }

  /**
   * 已选置顶（优先播放）
   * @param {string} panelId - 面板ID
   * @param {number} songDbId - 歌曲数据库记录ID
   */
  async upWord(panelId, songDbId) {

    // 初始化服务
    await this.initServices();

    try {
      // 调用服务置顶歌曲
      await this.selectedService.upWord({ songNo: songDbId });
    } catch (error) {
      logError('SelectedUI', '已选置顶失败:', error);
      this.showToast('置顶失败', 'error');
    }
  }

  /**
   * 删除已选歌曲
   * @param {string} panelId - 面板ID
   * @param {number} songDbId - 歌曲数据库记录ID
   */
  async delete(panelId, songDbId) {

    // 初始化服务
    await this.initServices();

    try {
      // 调用服务删除歌曲
      await this.selectedService.deleteSong({ songNo: songDbId });
    } catch (error) {
      logError('SelectedUI', '删除已选歌曲失败:', error);
      this.showToast('删除失败', 'error');
    }
  }

  /**
   * 点唱歌曲（已唱列表中的点唱操作）
   * @param {string} panelId - 面板ID
   * @param {string} songId - 歌曲ID
   */
  async requestSong(panelId, songId) {
    await this.initServices();
    try {
      if (!songId) throw new Error('歌曲编号不存在');
      await this.selectedService.requestSong({ songNo: songId });
      this.showToast('已添加到已选列表', 'success');
    } catch (error) {
      logError('SelectedUI', '点唱歌曲失败:', error);
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

      // 列表更新统一由 SongSyncManager 驱动
    } catch (error) {
      logError('SelectedUI', '播放下一首失败:', error);
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

  /**
   * 清理所有资源（事件监听器、WebSocket监听器等）
   */
  cleanup() {
    // 清理所有WebSocket监听器
    if (Array.isArray(this._wsCleanupFunctions)) {
      this._wsCleanupFunctions.forEach(cleanup => {
        if (typeof cleanup === 'function') {
          try {
            cleanup();
          } catch (e) {
            logWarn('SelectedUI', '清理WebSocket监听器失败:', e);
          }
        }
      });
      this._wsCleanupFunctions = [];
    }

    // 清理所有面板事件监听器
    if (this._eventHandlers) {
      // WeakMap会自动清理，但我们可以显式清理已知的面板
      const panelIds = ['selected', 'selectedList'];
      panelIds.forEach(panelId => {
        this.cleanupPanelEvents(panelId);
      });
    }
  }

  /**
   * 关闭已选模态框
   */
  closeSelectedModal() {
    // 如果有打开的已选面板，关闭它
    if (this.currentOpenPanel) {
      // 触发面板关闭事件
      const event = new CustomEvent('closePanel', { detail: { panelId: this.currentOpenPanel } });
      document.dispatchEvent(event);
    }

    if (typeof window !== 'undefined' && window.logService) {
      window.logService.info('关闭已选模态框');
    } else {

    }

    // 只触发已选面板关闭事件，避免触发 modalClosed → restoreHomeButtons → closeAllModals 误关点歌/派对
    document.dispatchEvent(new CustomEvent('selectedPanelClosed'));
  }
}

/**
 * 初始化歌曲同步监听：前端统一只消费 `SongSyncManager`
 * 底层事件统一为 `roomStateChanged` / `playListChanged` / `command`
 */
function initSongSyncListener() {
  // 防止重复初始化
  if (selectedUI._wsSyncInitialized) return;

  const managerPromise = (typeof window !== 'undefined' && window.moduleLoader)
    ? window.moduleLoader.load('songSyncManager')
    : Promise.resolve(null);

  managerPromise.then(songSyncManager => {
    if (!songSyncManager) return;

    const cleanup = songSyncManager.addSyncListener(async (data) => {
      if (data.type !== 'playlistUpdate' && data.type !== 'commandUpdate') return;

      const panel = document.getElementById('selected-panel');
      const activeTab = panel && !panel.classList.contains('hidden')
        ? panel.querySelector('.tab-active')
        : null;
      const currentTab = activeTab ? activeTab.dataset.tab : null;

      if (data.type === 'playlistUpdate' && data.listType === 2) {
        // 已唱列表变更：仅当面板可见且在已唱 tab 时刷新
        if (currentTab === 'sung') {
          try {
            await selectedUI._loadSungList(panel);
          } catch (e) {
            logError('SelectedUI', '刷新已唱列表失败', e);
          }
        }
        return;
      }

      // 已选列表 / 指令状态更新
      selectedUI._refreshHomeSelectedListFromSongService();

      // 如果面板正处于已选标签页，则刷新面板
      if (currentTab === 'selected') {
        selectedUI._refreshSelectedPanelFromSongService();
      }
    });

    if (selectedUI && Array.isArray(selectedUI._wsCleanupFunctions)) {
      selectedUI._wsCleanupFunctions.push(cleanup);
    }
    selectedUI._wsSyncInitialized = true;
  }).catch(err => {
    logError('SelectedUI', '初始化歌曲同步监听失败:', err);
  });
}

// 页面加载完成后初始化WebSocket监听器
let domContentLoadedHandler = null;
let websocketInitTimeoutId = null;

if (typeof document !== 'undefined') {
  domContentLoadedHandler = () => {
    // SongSyncManager 已在 index 入口静态加载；此处仅注册 playlistUpdate → UI 刷新，无需长延迟
    const run = () => { initSongSyncListener(); };
    if (typeof window !== 'undefined' && window.timerManager) {
      websocketInitTimeoutId = window.timerManager.addTimeout(run, 0);
    } else {
      websocketInitTimeoutId = setTimeout(run, 0);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', domContentLoadedHandler);
  } else {
    // DOM已经加载完成，直接执行
    domContentLoadedHandler();
  }
}

/**
 * 清理歌曲同步初始化相关资源
 */
function cleanupSongSyncInit() {
  if (domContentLoadedHandler) {
    document.removeEventListener('DOMContentLoaded', domContentLoadedHandler);
    domContentLoadedHandler = null;
  }
  if (websocketInitTimeoutId !== null) {
    if (typeof window !== 'undefined' && window.timerManager) {
      window.timerManager.clearTimeout(websocketInitTimeoutId);
    } else {
      clearTimeout(websocketInitTimeoutId);
    }
    websocketInitTimeoutId = null;
  }
}

// 在应用清理时调用清理函数
if (typeof window !== 'undefined') {
  // 监听应用清理事件（如果存在）
  window.addEventListener('beforeunload', () => {
    cleanupSongSyncInit();
  });
}

// 创建并导出导航已选歌曲UI实例
const selectedUI = new SelectedUI();
if (typeof window !== 'undefined') {
  window.selectedUI = selectedUI;
}
export default selectedUI;
