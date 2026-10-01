import apiService from '../../../shared/core/ApiService.js';
import sharedModalManager, { UNIFIED_CONTAINER_ID, SEARCH_PLACEHOLDERS } from '../common/SharedModalManager.js';
import { bindSearchInput, bindSearchCloseBtn } from '../common/SearchInputHandler.js';
import { 
  hideAllButtons, 
  showAllButtons, 
  MODAL_ANIMATION_CLASSES 
} from '../common/ModalUtils.js';

/**
 * YouTube 专题页面 UI
 * 用于搜索和点播 YouTube 视频
 */
class YouTubeUI {
  constructor() {
    this.results = [];
    this.isSearching = false;
    this.keyword = '';
    this.searchHandler = null;
    this.closeHandler = null;
  }

  /**
   * 打开 YouTube 模态框
   */
  async showYouTubeModal() {
    // 强制隐藏底部三按钮并展示首页（返回）按钮
    if (typeof hideAllButtons === 'function') {
      hideAllButtons();
    }
    
    const modal = sharedModalManager.getOrCreateModal();
    
    // 初始化显示状态
    modal.classList.remove('hidden');
    // 强制重绘以触发动画
    modal.offsetHeight; 
    modal.classList.add('song-modal-visible');
    modal.classList.remove('opacity-0');

    sharedModalManager.setCurrentMode('youtube', this);
    sharedModalManager.clearContent();
    
    // 统一的多语言标题：使用中/印/英/越四个并排标签，通过 CSS 控制显隐
    const youtubeTitleHtml = `
      <div class="py-2 text-red-500 font-bold flex items-center gap-2">
        <i class="fas fa-video text-2xl"></i>
        <span class="zh-label">YouTube 专用点播</span>
        <span class="indonesian-translation">YouTube Sesuai Permintaan</span>
        <span class="en-translation">YouTube On Demand</span>
        <span class="vi-translation">YouTube Theo Yêu Cầu</span>
      </div>
    `;
    sharedModalManager.setMiddleContent(youtubeTitleHtml);

    const input = sharedModalManager.getSearchInput();
    if (input) {
      // 获取当前语言环境下的占位符
      const curLang = localStorage.getItem('subtitleLang') || 'none';
      input.placeholder = SEARCH_PLACEHOLDERS.youtube[curLang] || SEARCH_PLACEHOLDERS.youtube.none;
      input.value = this.keyword;
      this.searchHandler = bindSearchInput({
        searchInput: input,
        onSearch: (q) => this.search(q),
        onClear: () => this.clear(),
        debounceDelay: 500
      });
    }

    const closeBtn = sharedModalManager.getCloseBtn();
    if (closeBtn) {
      this.closeHandler = bindSearchCloseBtn({
        closeBtn,
        searchInput: input,
        onClear: () => this.clear()
      });
    }

    // 初始渲染
    if (this.results.length > 0) {
      this.renderResults(this.results);
    } else {
      await this.loadHotVideos();
    }
    
    // 自动聚焦搜索框（用户体验提升）
    setTimeout(() => input?.focus(), 300);
  }

  /**
   * 首次进入加载服务器缓存的热门视频，避免空白首页。
   */
  async loadHotVideos() {
    this.isSearching = true;
    this.renderLoading();
    try {
      const res = await apiService.get('/api/v1/youtube/hot');
      if (res && res.code === 0 && Array.isArray(res.data)) {
        this.results = res.data;
        this.renderResults(this.results);
        return this.results;
      }
      throw new Error(res?.message || '热门视频加载失败');
    } catch (error) {
      this.results = [];
      this.renderError(error.message || '热门视频加载失败，请点击重试');
      return [];
    } finally {
      this.isSearching = false;
    }
  }

  async search(q) {
    if (!q || q.trim() === '') {
      this.clear();
      return;
    }
    this.keyword = q;
    this.isSearching = true;
    this.renderLoading();

    try {
      const res = await apiService.get(`/api/v1/youtube/search?q=${encodeURIComponent(q)}`);
      if (res && res.code === 0) {
        this.results = res.data;
        this.renderResults(this.results);
      } else {
        this.renderError(res.message || '搜索失败，请稍后重试');
      }
    } catch (e) {
      this.renderError('网络请求失败，请检查服务器连接');
    } finally {
      this.isSearching = false;
    }
  }

  /**
   * 清空状态
   */
  clear() {
    this.results = [];
    this.keyword = '';
    this.loadHotVideos();
  }

  /**
   * 渲染加载中
   */
  renderLoading() {
    const container = sharedModalManager.getContainer();
    if (container) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-24">
          <div class="animate-spin rounded-full h-12 w-12 border-4 border-white/10 border-t-red-600 mb-4"></div>
          <p class="text-gray-400 animate-pulse">正在为您搜索 YouTube...</p>
        </div>
      `;
    }
  }

  /**
   * 渲染错误信息
   */
  renderError(msg) {
    const container = sharedModalManager.getContainer();
    if (container) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20 text-red-500/80">
          <i class="fas fa-exclamation-circle text-5xl mb-4"></i>
          <p class="text-lg">${msg}</p>
          <button class="mt-4 px-4 py-2 bg-white/10 rounded-lg text-white hover:bg-white/20" onclick="window.youtubeUI.keyword ? window.youtubeUI.search(window.youtubeUI.keyword) : window.youtubeUI.loadHotVideos()">
            重试
          </button>
        </div>
      `;
    }
  }

  /**
   * 渲染结果列表
   */
  renderResults(results) {
    const container = sharedModalManager.getContainer();
    if (!container) return;

    if (results.length === 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20 text-gray-400">
          <i class="fas fa-search text-5xl mb-4 opacity-20"></i>
          <p>抱歉，未找到相关视频</p>
        </div>
      `;
      return;
    }

    const grid = document.createElement('div');
    // 同时应用 Tailwind 类和行内样式，确保两列布局在任何情况下都生效
    grid.className = 'grid grid-cols-2 gap-3 sm:gap-6 pb-20 w-full';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    grid.style.gap = '12px';
    grid.style.width = '100%';

    results.forEach(video => {
      const card = this.createVideoCard(video);
      grid.appendChild(card);
    });

    container.innerHTML = '';
    container.appendChild(grid);
  }

  /**
   * 创建视频卡片
   */
  createVideoCard(video) {
    const card = document.createElement('div');
    card.className = 'group flex flex-col bg-white/5 rounded-2xl overflow-hidden border border-white/5 hover:border-red-500/30 active:scale-95 transition-all duration-300 cursor-pointer shadow-lg hover:shadow-red-900/10';
    
    // 改进：使用本地占位图或简单的 CSS 样式作为兜底，避免外部 URL 访问失败
    // 同时通过 videoId 构造官方备用封面地址 (mqdefault)
    const thumbUrl = video.thumbnail || '';
    const videoId = video.id;
    const backupThumbUrl = videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : '';
    
    const fallbackHtml = `
      <div class="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex flex-col items-center justify-center text-gray-600">
        <i class="fas fa-video text-4xl mb-2 opacity-20"></i>
        <span class="text-[10px] uppercase tracking-widest opacity-30 font-bold">YouTube Video</span>
      </div>
    `;

    card.innerHTML = `
      <div class="relative aspect-video overflow-hidden bg-gray-900">
        ${fallbackHtml}
        ${thumbUrl ? `
          <img src="${thumbUrl}" 
               class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-0 thumbnail-primary" 
               onload="this.classList.remove('opacity-0')"
               onerror="this.classList.add('hidden'); if(this.nextElementSibling.classList.contains('thumbnail-backup')){this.nextElementSibling.classList.remove('hidden'); this.nextElementSibling.src='${backupThumbUrl}';}"
               loading="lazy">
        ` : ''}
        ${backupThumbUrl ? `
          <img src="${backupThumbUrl}" 
               class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 hidden thumbnail-backup" 
               onload="this.classList.remove('hidden')"
               onerror="this.classList.add('hidden')">
        ` : ''}
        <div class="absolute bottom-2 right-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[10px] text-white font-bold z-10">
          ${video.duration || '0:00'}
        </div>
        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-4 transition-opacity z-20">
           <!-- 预览按钮 -->
           <div class="btn-preview w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-white/40 transition-colors shadow-lg" title="预览">
              <i class="fas fa-eye"></i>
           </div>
           <!-- 点播按钮 -->
           <div class="btn-push w-12 h-12 bg-red-600 rounded-full flex items-center justify-center text-white hover:bg-red-700 transition-colors shadow-2xl scale-90 hover:scale-110 active:scale-95 transition-transform" title="点播到大屏">
              <i class="fas fa-play ml-1"></i>
           </div>
        </div>
      </div>
      <div class="p-3 sm:p-4 flex-1 flex flex-col justify-between">
        <div>
          <h4 class="text-xs sm:text-sm font-medium text-gray-100 line-clamp-2 mb-2 leading-snug group-hover:text-red-400 transition-colors">${video.title}</h4>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-4 h-4 bg-white/10 rounded-full flex items-center justify-center text-[6px] text-gray-400">
            <i class="fas fa-tv"></i>
          </div>
          <span class="text-[10px] text-gray-400 truncate flex-1">${video.channel || 'YouTube'}</span>
        </div>
      </div>
    `;

    // 绑定预览
    card.querySelector('.btn-preview').addEventListener('click', (e) => {
      e.stopPropagation();
      this.previewVideo(video);
    });

    // 绑定推送到电视
    card.querySelector('.btn-push').addEventListener('click', (e) => {
      e.stopPropagation();
      this.playVideo(video);
    });

    // 整个卡片点击也触发电视播放
    card.addEventListener('click', () => this.playVideo(video));
    return card;
  }

  /**
   * 预览视频
   */
  async previewVideo(video) {
    if (window.toastService) window.toastService.showInfo(`正在加载预览: ${video.title}`);
    
    try {
      const res = await apiService.get('/api/v1/youtube/parse', { videoId: video.id });
      if (res && res.code === 0) {
        this.showPreviewPlayer(res.data, video.title, video.id);
      } else {
        throw new Error(res.message || '获取预览地址失败');
      }
    } catch (e) {
      if (window.toastService) window.toastService.showError(`无法预览: ${e.message}`);
    }
  }

  /**
   * 显示预览播放器
   */
  showPreviewPlayer(url, title, videoId) {
    // 如果已经存在，先移除
    const old = document.getElementById('youtube-preview-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'youtube-preview-overlay';
    // 强制层级最高 z-index
    overlay.className = 'fixed inset-0 z-[99999] bg-black/95 flex flex-col items-center justify-center animate-fade-in pointer-events-auto';
    overlay.style.backdropFilter = 'blur(10px)';
    
    overlay.innerHTML = `
      <div class="w-full max-w-4xl p-0 sm:p-4 animate-scale-up">
        <div class="flex justify-between items-center mb-4 px-4">
          <h3 class="text-white text-base sm:text-xl font-bold truncate max-w-[80%]">${title}</h3>
          <button class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white text-2xl" onclick="this.closest('#youtube-preview-overlay').remove()">
            &times;
          </button>
        </div>
        <div class="bg-black rounded-xl overflow-hidden shadow-2xl aspect-video relative group">
          <video src="${url}" controls autoplay class="w-full h-full"></video>
        </div>
        <div class="mt-8 flex gap-4 px-4">
          <button id="preview-push-btn" class="flex-1 py-4 bg-red-600 animate-pulse-slow text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-red-700 active:scale-95 transition-all shadow-xl shadow-red-900/40">
            <i class="fas fa-tv text-xl"></i>
            <span>发送大屏幕播放</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 绑定预览窗口中的点播按钮
    overlay.querySelector('#preview-push-btn').onclick = () => {
      this.playVideo({ id: videoId, title: title });
      overlay.remove();
    };
  }

  /**
   * 点播视频
   */
  async playVideo(video) {
    // 显示加载提示
    if (window.toastService) window.toastService.showInfo(`正在解析并点播: ${video.title}`);

    try {
      const res = await apiService.queueYouTube({
        videoId: video.id,
        title: video.title,
        channel: video.channel || 'YouTube',
        isPriority: false
      });

      if (res && res.code === 0) {
        // WebSocket 广播是主链路，HTTP 刷新是点播成功后的权威兜底，确保已选列表立即可见。
        await window.songService?.syncRequestedSongsFromServer?.({
          force: true,
          immediate: true
        });
        document.dispatchEvent(new CustomEvent('playListChanged', {
          detail: { source: 'youtube', song: res.data }
        }));
        if (window.toastService) window.toastService.showSuccess(`点播成功！已加入已选列表`);
      } else {
        throw new Error(res?.message || '点播失败，请尝试其他视频');
      }
    } catch (e) {
      if (window.toastService) window.toastService.showError(`点播失败: ${e.message}`);
    }
  }

  async closeYouTubeModal() {
    if (sharedModalManager.getCurrentMode() !== 'youtube') {
      return;
    }
    const modal = sharedModalManager.getOrCreateModal();
    modal.classList.remove('song-modal-visible');
    modal.classList.add('opacity-0');
    
    // 等待动画结束
    await new Promise(r => setTimeout(r, 300));
    
    modal.classList.add('hidden');
    sharedModalManager.clearContent();
    sharedModalManager.clearCurrentMode();
    
    if (this.searchHandler) {
      this.searchHandler.cleanup();
      this.searchHandler = null;
    }
    if (this.closeHandler) {
      this.closeHandler();
      this.closeHandler = null;
    }

    const event = new CustomEvent('modalClosed', { detail: { mode: 'youtube' } });
    document.dispatchEvent(event);
  }
}

const youtubeUI = new YouTubeUI();

// 暴露到全局以供 index.js 使用
if (typeof window !== 'undefined') {
  window.youtubeUI = youtubeUI;
}

export default youtubeUI;
