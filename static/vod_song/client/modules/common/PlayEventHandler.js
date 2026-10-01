/**
 * 统一的播放事件处理器
 * 处理歌曲卡片的点击事件和添加按钮点击事件
 */

async function requestAuthoritativeSongStateSync(ui) {
  try {
    const songSyncManager = ui?.songSyncManager || window.songSyncManager || null;
    if (songSyncManager && typeof songSyncManager.syncSongState === 'function') {
      await songSyncManager.syncSongState(true);
      return;
    }

    if (ui?.songService && typeof ui.songService.syncRequestedSongsFromServer === 'function') {
      await ui.songService.syncRequestedSongsFromServer({
        force: true,
        immediate: true
      });
    }
  } catch (err) {
    if (ui?._log && typeof ui._log === 'function') {
      ui._log('warn', '权威歌曲状态同步失败', err);
    }
  }
}

/**
 * 绑定播放事件到歌曲卡片
 * @param {Object} ui - UI实例（SongTopUI 或 PartyUI）
 * @param {HTMLElement} songCard - 歌曲卡片元素
 * @param {Object} song - 歌曲对象
 */
export function bindPlayEvent(ui, songCard, song) {
  const addBtn = songCard.querySelector('.add-btn');
  
  // 防止重复绑定事件
  if (addBtn && addBtn.dataset.eventBound !== 'true') {
    addBtn.dataset.eventBound = 'true';
    
    const handleClick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (processingButtons.has(addBtn)) return;
      handleAddBtnClick(ui, song, addBtn);
    };
    
    addBtn.addEventListener('click', handleClick, { passive: false });
  }
  
  // 卡片点击事件（排除按钮区域、歌星头像和歌星名称）- 只执行点播操作，不执行切歌和优先
  songCard.addEventListener('click', async (e) => {
    if (e.target.closest('.add-btn')) {
      return;
    }
    // 排除歌星头像和歌星名称的点击，这些点击应该打开歌星歌曲列表
    if (e.target.closest('.song-card-img-container') || e.target.closest('.song-card-singer')) {
      return;
    }
    
    const songId = song.songNo || song.serialNumber || song.id || song.num;
    if (!songId) return;
    
    try {
      // 检查歌曲状态
      const isRequested = ui.songService?.isSongRequested(songId);
      const songInfo = ui.songService?.getSelectedSongInfo(songId);
      const songIndex = ui.songService?.getSelectedSongIndex(songId);
      
      // 如果歌曲已点播，卡片点击不做任何操作（切歌和优先必须点击图标）
      if (isRequested && songInfo && songIndex >= 0) {
        return;
      }
      
      if (!isRequested || !songInfo || songIndex < 0) {
        ui.songService.requestSong(songId).catch(async (err) => {
          if (ui._log && typeof ui._log === 'function') ui._log('error', '点歌失败', err);
          await requestAuthoritativeSongStateSync(ui);
        });
      }
    } catch (err) {
      if (ui._log && typeof ui._log === 'function') {
        ui._log('error', '点歌失败', err);
      }
    }
  });
}

/**
 * 处理添加按钮点击事件
 * @param {Object} ui - UI实例（SongTopUI 或 PartyUI）
 * @param {Object} song - 歌曲对象
 * @param {HTMLElement} addBtn - 添加按钮元素
 */
// 防止重复点击的标记
const processingButtons = new WeakMap();

export async function handleAddBtnClick(ui, song, addBtn) {
  const songId = song.songNo || song.serialNumber || song.id || song.num;
  if (!songId) {
    if (ui._log && typeof ui._log === 'function') {
      ui._log('warn', '缺少歌曲ID，无法处理点击', song);
    }
    return;
  }
  
  // 防止重复点击：如果按钮正在处理中，直接返回
  if (processingButtons.has(addBtn)) {
    if (ui._log && typeof ui._log === 'function') {
      ui._log('debug', '按钮正在处理中，忽略重复点击', { songId });
    }
    return;
  }
  
  // 标记按钮正在处理
  processingButtons.set(addBtn, true);
  
  try {
    await ui.initServices();
    
    // 优化：对于点播操作，不需要等待同步状态，直接使用本地状态判断
    // 这样可以立即响应用户操作，提供更好的用户体验
    // 如果需要最新状态，可以在后台异步同步，但不阻塞UI更新
    
    const songIndex = ui.songService.getSelectedSongIndex(songId);
    const songInfo = ui.songService.getSelectedSongInfo(songId);
    const isRequested = ui.songService.isSongRequested(songId);
    
    const log = (level, message, ...args) => {
      if (ui._log && typeof ui._log === 'function') {
        ui._log(level, message, ...args);
      }
    };
    
    if (isRequested && songIndex >= 0) {
      if (songIndex === 0) {
        return;
      } else if (songIndex === 1) {
        if (!songInfo) {
          await requestAuthoritativeSongStateSync(ui);
          const updatedSongInfo = ui.songService.getSelectedSongInfo(songId);
          const updatedSongIndex = ui.songService.getSelectedSongIndex(songId);
          if (updatedSongIndex === 1 && updatedSongInfo) {
            try {
              await ui.songService.playNextSong();
            } catch (err) {
              log('error', '切歌失败', err);
              await requestAuthoritativeSongStateSync(ui);
            }
          }
          return;
        }
        try {
          await ui.songService.playNextSong();
        } catch (err) {
          log('error', '切歌失败', err);
          await requestAuthoritativeSongStateSync(ui);
        }
        return;
      } else if (songIndex > 1) {
        try {
          await ui.songService.prioritizeSong(songId);
        } catch (err) {
          log('error', '优先播放失败', err);
          await requestAuthoritativeSongStateSync(ui);
        }
        return;
      }
    }
    
    if (!isRequested || !songInfo || songIndex < 0) {
      try {
        await ui.songService.requestSong(songId);
      } catch (err) {
        log('error', '点歌失败', err);
        await requestAuthoritativeSongStateSync(ui);
      }
    }
  } catch (err) {
    if (ui._log && typeof ui._log === 'function') {
      ui._log('error', '处理按钮点击失败', err);
    }
  } finally {
    setTimeout(() => {
      processingButtons.delete(addBtn);
    }, 300);
  }
}

