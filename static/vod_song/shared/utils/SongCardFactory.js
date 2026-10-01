// 统一的歌曲卡片创建工厂函数
// 所有歌曲卡片都应该使用这个函数，确保样式完全一致

// 性能优化：拼音转换缓存，避免重复计算
const pinyinCache = new Map();

// 已确认加载失败的歌星图 URL，不再发起请求，直接显示占位图
const failedSingerImageUrls = new Set();
const PENDING_IMAGE_CLASS = 'is-pending';
const imageLazyLoadCallbacks = new WeakMap();
let sharedImageObserver = null;

// 动态导入图片缓存服务（避免循环依赖）
// 注意: ImageCacheService 在 client 目录,shared 代码无法直接导入
// 通过 window.imageCacheService 访问(如果可用)
let imageCacheService = null;
const getImageCacheService = async () => {
  if (!imageCacheService) {
    // 优先使用全局实例
    if (typeof window !== 'undefined' && window.imageCacheService) {
      imageCacheService = window.imageCacheService;
    } else {
      // 尝试动态导入(仅在 client 环境有效)
      try {
        const module = await import('../../client/services/ImageCacheService.js');
        imageCacheService = module.default;
      } catch (e) {
        // shared 代码无法访问 client 代码,这是正常的
        // 降级到浏览器缓存
      }
    }
  }
  return imageCacheService;
};

function getSharedImageObserver() {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
    return null;
  }

  if (sharedImageObserver) {
    return sharedImageObserver;
  }

  sharedImageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) {
        return;
      }

      const callback = imageLazyLoadCallbacks.get(entry.target);
      if (callback) {
        callback(entry.target);
        imageLazyLoadCallbacks.delete(entry.target);
      }

      sharedImageObserver.unobserve(entry.target);
    });
  }, { rootMargin: '50px' });

  return sharedImageObserver;
}

/**
 * 获取拼音（带缓存）
 * @param {string} text - 要转换的文本
 * @returns {string} 拼音文本
 */
function getPinyinWithCache(text) {
  if (!text || !/[\u4e00-\u9fa5]/.test(text)) {
    return '';
  }

  // 检查缓存
  if (pinyinCache.has(text)) {
    return pinyinCache.get(text);
  }

  // 转换拼音
  try {
    const pinyin = window.pinyinPro?.pinyin;
    if (pinyin) {
      const result = pinyin(text, { toneType: 'none' });
      // 缓存结果（限制缓存大小，避免内存泄漏）
      if (pinyinCache.size > 1000) {
        // 删除最旧的缓存项（FIFO）
        const firstKey = pinyinCache.keys().next().value;
        pinyinCache.delete(firstKey);
      }
      pinyinCache.set(text, result);
      return result;
    }
  } catch (e) {
    console.warn('[SongCardFactory] 拼音转换失败:', e);
  }

  return '';
}

// 播放动画函数（从SongTopRenderer复制，避免循环依赖）
function createPlayingAnimation() {
  // 完全使用CSS类，移除所有内联样式
  // 动画延迟通过CSS选择器控制（.playing-bar.animate-bar:nth-of-type）
  return `
    <div class="playing-indicator">
      <div class="playing-indicator-inner">
        <div class="playing-bar animate-bar"></div>
        <div class="playing-bar animate-bar"></div>
        <div class="playing-bar animate-bar"></div>
      </div>
    </div>
  `;
}

/**
 * 设置图片懒加载（公共方法）
 * 若该 URL 曾加载失败则直接显示占位图，不再请求
 * @param {HTMLElement} img - 图片元素
 * @param {HTMLElement} iconWrapper - 图标包装元素
 * @param {string} imgUrl - 图片URL
 */
function setupImageLazyLoad(img, iconWrapper, imgUrl) {
  if (!img || !iconWrapper || !imgUrl) return;

  if (failedSingerImageUrls.has(imgUrl)) {
    iconWrapper.classList.remove('hidden');
    return;
  }

  img.classList.add(PENDING_IMAGE_CLASS);
  img.removeAttribute('alt');

  const onLoadFail = () => {
    failedSingerImageUrls.add(imgUrl);
    img.removeAttribute('src');
    img.classList.add(PENDING_IMAGE_CLASS);
    iconWrapper.classList.remove('hidden');
    if (img.dataset.objectUrl) {
      URL.revokeObjectURL(img.dataset.objectUrl);
      delete img.dataset.objectUrl;
    }
  };

  const loadImage = async () => {
    try {
      const cacheService = await getImageCacheService();
      if (cacheService) {
        const imageSrc = await cacheService.loadAndCache(imgUrl);
        if (failedSingerImageUrls.has(imgUrl)) return;
        img.src = imageSrc;
        const isObjectUrl = imageSrc.startsWith('blob:');

        img.addEventListener('load', function () {
          if (failedSingerImageUrls.has(imgUrl)) return;
          this.classList.remove(PENDING_IMAGE_CLASS);
          if (isObjectUrl) {
            if (this.dataset.objectUrl && this.dataset.objectUrl !== imageSrc) {
              URL.revokeObjectURL(this.dataset.objectUrl);
            }
            this.dataset.objectUrl = imageSrc;
          } else {
            if (this.dataset.objectUrl) {
              URL.revokeObjectURL(this.dataset.objectUrl);
              delete this.dataset.objectUrl;
            }
          }
          iconWrapper.classList.add('hidden');
        }, { once: true });
      } else {
        if (failedSingerImageUrls.has(imgUrl)) return;
        img.src = imgUrl;
      }
    } catch (_) {
      onLoadFail();
      return;
    }

    img.addEventListener('load', function () {
      if (this.complete && this.naturalHeight > 0 && !failedSingerImageUrls.has(imgUrl)) {
        this.classList.remove(PENDING_IMAGE_CLASS);
        iconWrapper.classList.add('hidden');
      }
    }, { once: true });

    img.addEventListener('error', function () {
      onLoadFail();
    }, { once: true });
  };

  const sharedObserver = getSharedImageObserver();
  if (sharedObserver) {
    imageLazyLoadCallbacks.set(img, () => {
      if (failedSingerImageUrls.has(imgUrl)) {
        iconWrapper.classList.remove('hidden');
        return;
      }
      loadImage();
    });
    sharedObserver.observe(img);
  } else {
    loadImage();
  }
}

/**
 * 创建统一的歌曲卡片
 * @param {Object} ui - UI实例（需要songService, addInteractionEffects, bindPlayEvent方法）
 * @param {Object} song - 歌曲对象
 * @returns {HTMLElement} 歌曲卡片元素
 */
export function createUnifiedSongCard(ui, song) {
  const card = document.createElement('div');
  // 统一使用CSS类，移除所有内联样式
  // 按照规范，统一使用半透明黑色背景，移除深色模式下的灰色背景
  card.className = 'song-card';

  const songId = song.songNo;
  if (songId) {
    card.dataset.songId = songId;
  }

  let imgUrl = null;
  if (song.primarySingerNo && window.AppConfig?.singerImgServer?.getUrl) {
    imgUrl = window.AppConfig.singerImgServer.getUrl(song.primarySingerNo);
  }

  const songName = song.songName || '未知歌名';
  const singerNames = song.singerNames || '未知歌手';

  // 调整图标 - 使用CSS类，移除内联样式
  let iconHtml = '<i class="fa fa-plus song-card-add-icon"></i>';
  let isDisabled = false;
  let isRequested = false;
  let songIndex = -1;
  let buttonStateClass = ''; // 按钮状态类名

  const songSvc = (ui && ui.songService) || (typeof window !== 'undefined' ? window.songService : null);
  if (songSvc) {
    const songIdStr = songId != null ? String(songId) : null;
    if (songIdStr) {
      isRequested = songSvc.isSongRequested(songIdStr);
      if (isRequested) {
        songIndex = songSvc.getSelectedSongIndex(songIdStr);

        if (songIndex < 0) {
          iconHtml = '<i class="fa fa-arrow-up song-card-priority-icon"></i>';
          isDisabled = false;
          buttonStateClass = 'priority-btn';
        } else if (songIndex === 0) {
          iconHtml = createPlayingAnimation();
          isDisabled = true;
          buttonStateClass = 'play-pause-btn has-playing-indicator';
        } else if (songIndex === 1) {
          iconHtml = '<i class="fa fa-step-forward song-card-step-icon"></i>';
          isDisabled = false;
          buttonStateClass = 'next-btn';
        } else {
          iconHtml = '<i class="fa fa-arrow-up song-card-priority-icon"></i>';
          isDisabled = false;
          buttonStateClass = 'priority-btn';
        }
      }
    }
  }

  // 性能优化：使用缓存获取拼音
  const pinyinText = getPinyinWithCache(songName);

  // 性能优化：使用 IndexedDB 缓存和 IntersectionObserver 实现懒加载
  // 注意：不使用 src 属性，而是通过 IntersectionObserver 动态加载
  const imgAttribute = imgUrl ? '' : '';

  // 确保图标默认显示，图片初始隐藏，加载成功后才显示
  // 这样可以避免图片加载过程中的闪烁
  const calcDisplayLength = (text) => {
    if (!text) return 0;
    let total = 0;
    for (const ch of String(text)) {
      total += /[\u4e00-\u9fa5\u3040-\u30ff]/.test(ch) ? 2 : 1;
    }
    return total;
  };

  const shouldMarqueeTitle = calcDisplayLength(songName) > 38;
  const shouldMarqueePinyin = calcDisplayLength(pinyinText) > 76;

  card.innerHTML = `
    <div class="song-card-inner">
      <div class="song-card-img-container">
        <div class="song-card-icon-wrapper">
          <i class="fa fa-music song-card-icon"></i>
        </div>
        ${imgUrl ? `<img class="song-card-img ${PENDING_IMAGE_CLASS}">` : ''}
      </div>
      <div class="song-card-content">
        <h3 class="song-card-title ${isRequested ? 'song-card-title--requested' : ''} ${shouldMarqueeTitle ? 'song-card-title--marquee' : ''}">
          <span class="song-card-title-text">${songName}</span>
        </h3>
        ${pinyinText ? `<div class="song-card-pinyin ${shouldMarqueePinyin ? 'song-card-pinyin--marquee' : ''}">
          <span class="song-card-pinyin-text">${pinyinText}</span>
        </div>` : ''}
        <div class="song-card-singer-container">
          <span class="song-card-singer">
            ${singerNames}
          </span>
        </div>
      </div>
      <div class="song-card-actions">
        <button class="add-btn song-card-add-btn ${buttonStateClass} ${isDisabled ? 'is-disabled' : ''}" ${isDisabled ? 'disabled' : ''}>
          ${iconHtml}
        </button>
      </div>
    </div>
  `;

  // 先绑定歌星头像的点击事件（在卡片点击事件之前，确保优先处理）
  const singerId = song.primarySingerNo;
  if (singerId) {
    // 改进的滑动检测：更精确地区分滑动和点击
    let touchStartX = 0;
    let touchStartY = 0;
    let hasMoved = false;
    let touchStartTime = 0;
    const SCROLL_THRESHOLD = 15; // 滑动阈值（像素）
    const CLICK_DURATION_THRESHOLD = 400; // 点击时间阈值（毫秒）

    const handleTouchStart = (e) => {
      const touch = e.touches?.[0];
      if (touch) {
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchStartTime = Date.now();
        hasMoved = false;
      }
    };

    const handleTouchMove = (e) => {
      const touch = e.touches?.[0];
      if (touch && (touchStartX !== 0 || touchStartY !== 0)) {
        const deltaX = Math.abs(touch.clientX - touchStartX);
        const deltaY = Math.abs(touch.clientY - touchStartY);
        if (deltaX > SCROLL_THRESHOLD || deltaY > SCROLL_THRESHOLD) {
          hasMoved = true;
        }
      }
    };

    const handleTouchEnd = (e) => {
      const target = e.target;
      const isAvatarClick = target.closest('.song-card-img-container');

      // 只处理头像点击
      if (!isAvatarClick) {
        // 重置状态
        touchStartX = 0;
        touchStartY = 0;
        hasMoved = false;
        touchStartTime = 0;
        return;
      }

      // 检查是否发生了滑动
      const touch = e.changedTouches?.[0];
      if (touch && (touchStartX !== 0 || touchStartY !== 0)) {
        const deltaX = Math.abs(touch.clientX - touchStartX);
        const deltaY = Math.abs(touch.clientY - touchStartY);
        const touchDuration = Date.now() - touchStartTime;

        // 如果移动距离超过阈值，或者触摸时间很短但移动距离较大，认为是滑动
        if (hasMoved || deltaX > SCROLL_THRESHOLD || deltaY > SCROLL_THRESHOLD) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          // 重置状态
          touchStartX = 0;
          touchStartY = 0;
          hasMoved = false;
          touchStartTime = 0;
          return;
        }

        // 如果触摸时间过短，可能是误触，不处理
        if (touchDuration < 150) { // 最小触摸时间
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          // 重置状态
          touchStartX = 0;
          touchStartY = 0;
          hasMoved = false;
          touchStartTime = 0;
          return;
        }
      }

      // 真正的点击：阻止事件传播并执行导航
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (typeof ui.openSingerSongs === 'function') {
        ui.openSingerSongs(String(singerId), singerNames);
      } else if (typeof ui.setMode === 'function') {
        ui.setMode('singer', { primarySingerNo: String(singerId), singerNames });
      }

      // 重置状态
      touchStartX = 0;
      touchStartY = 0;
      hasMoved = false;
      touchStartTime = 0;
    };

    // 处理click事件（桌面端）
    const handleClick = (event) => {
      const target = event.target;
      const isAvatarClick = target.closest('.song-card-img-container');

      if (!isAvatarClick) {
        return;
      }

      // 如果有触摸事件发生（移动端），忽略click事件
      if (hasMoved || touchStartX !== 0 || touchStartY !== 0) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (typeof ui.openSingerSongs === 'function') {
        ui.openSingerSongs(String(singerId), singerNames);
      } else if (typeof ui.setMode === 'function') {
        ui.setMode('singer', { primarySingerNo: String(singerId), singerNames });
      }
    };

    // 在卡片级别绑定事件，使用捕获阶段确保优先处理
    card.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
    card.addEventListener('touchmove', handleTouchMove, { passive: true, capture: true });
    card.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true });
    card.addEventListener('click', handleClick, true);
  }

  // 绑定交互效果和事件
  if (ui.addInteractionEffects) {
    ui.addInteractionEffects(card);
  }
  if (ui.bindPlayEvent) {
    ui.bindPlayEvent(card, song);
  }

  // 性能优化：使用 IndexedDB 缓存图片加载
  // 优先从 IndexedDB 缓存加载，如果没有则从网络加载并缓存
  // 自动处理 CORS 问题：如果服务器不支持 CORS，降级到直接使用原始 URL
  if (imgUrl) {
    const img = card.querySelector('.song-card-img');
    const iconWrapper = card.querySelector('.song-card-icon-wrapper');
    if (img && iconWrapper) {
      // 使用公共方法设置图片懒加载
      setupImageLazyLoad(img, iconWrapper, imgUrl);
    }
  }

  // 检查按钮是否包含播放指示器，添加相应的类名以提高可见性
  const addBtn = card.querySelector('.add-btn');
  if (addBtn) {
    const hasPlayingIndicator = addBtn.querySelector('.playing-indicator') !== null;
    if (hasPlayingIndicator) {
      addBtn.classList.add('has-playing-indicator');
    }
  }

  // 添加卡片选中效果 - 已禁用，直接改变状态，不等待动画
  // 优化：移除选中效果，避免白色动画延迟状态变化
  /* card.addEventListener('click', function() {
    // 移除其他卡片的选中状态
    const allCards = document.querySelectorAll('.song-card, .singer-card');
    allCards.forEach(c => {
      // 移除选中状态的类名，恢复默认的 bg-black/50 背景
      c.classList.remove('song-card-selected');
    });
    
    // 添加选中状态的类名，CSS 会自动应用半透明青色背景
    card.classList.add('song-card-selected');
  }); */

  return card;
}

/**
 * 创建统一的歌星卡片
 * @param {Object} ui - UI实例
 * @param {Object} singer - 歌星对象
 * @returns {HTMLElement} 歌星卡片元素
 */
export function createUnifiedSingerCard(ui, singer) {
  const card = document.createElement('div');
  // 统一使用CSS类，移除所有内联样式
  // 按照规范，统一使用半透明黑色背景，移除深色模式下的灰色背景
  card.className = 'singer-card';

  const singerId = singer.singerNo;
  if (singerId) {
    card.dataset.singerId = singerId;
  }

  let imgUrl = null;
  if (singerId && window.AppConfig?.singerImgServer?.getUrl) {
    imgUrl = window.AppConfig.singerImgServer.getUrl(singerId);
  }

  const singerName = singer.singerName || '未知歌星';

  // 性能优化：使用缓存获取拼音
  const pinyinText = getPinyinWithCache(singerName);

  card.innerHTML = `
    <div class="singer-card-inner">
      <div class="singer-card-img-container">
        <div class="singer-card-icon-wrapper">
          <i class="fa fa-user singer-card-icon"></i>
        </div>
        ${imgUrl ? `<img class="singer-card-img ${PENDING_IMAGE_CLASS}">` : ''}
      </div>
      <div class="singer-card-content">
        <h3 class="singer-card-title">${singerName}</h3>
        ${pinyinText ? `<div class="singer-card-pinyin">${pinyinText}</div>` : ''}
        <div class="singer-card-tag-container">
          <span class="singer-card-tag">歌星</span>
        </div>
      </div>
      <div class="singer-card-arrow">
        <i class="fas fa-chevron-right"></i>
      </div>
    </div>
  `;

  // 性能优化：使用 IndexedDB 缓存图片加载（与歌曲卡片一致）
  // 自动处理 CORS 问题：如果服务器不支持 CORS，降级到直接使用原始 URL
  if (imgUrl) {
    const img = card.querySelector('.singer-card-img');
    const iconWrapper = card.querySelector('.singer-card-icon-wrapper');
    if (img && iconWrapper) {
      // 使用公共方法设置图片懒加载
      setupImageLazyLoad(img, iconWrapper, imgUrl);
    }
  }

  // 绑定歌星卡片点击事件，加载该歌星的歌曲
  card.addEventListener('click', () => {
    if (!singerId) return;
    if (typeof ui.openSingerSongs === 'function') {
      ui.openSingerSongs(String(singerId), singerName);
    } else if (typeof ui.setMode === 'function') {
      ui.setMode('singer', { primarySingerNo: String(singerId), singerName });
    }
  });

  if (ui.addInteractionEffects) {
    ui.addInteractionEffects(card);
  }

  return card;
}

// 导出到全局，方便其他地方使用
if (typeof window !== 'undefined') {
  window.SongCardFactory = { createUnifiedSongCard, createUnifiedSingerCard, createPlayingAnimation };
}
