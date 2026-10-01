import apiService from '../../core/ApiService.js';
import cacheService from '../../services/CacheService.js';
import { normalizePlayList } from '../../utils/NormalizeUtils.js';
import { parseApiArrayResponse } from '../../utils/ResponseParser.js';
import { isApiOk, getApiErrorMessage } from '../../utils/ApiResponseUtils.js';

/**
 * 导航已选歌曲业务逻辑
 */
class SelectedService {
  constructor() {
    this.apiService = apiService;
  }

  _songService() {
    return typeof window !== 'undefined' ? window.songService : null;
  }

  _requireSuccess(response, fallbackMessage) {
    if (!isApiOk(response)) {
      throw new Error(getApiErrorMessage(response, fallbackMessage));
    }
    return response;
  }


  /**
   * 已选列表：GET /api/v1/rooms/:id/queue（经 SongService 拉取并写入内存，与后台队列一致）
   */
  async getPlayList() {
    const songService = typeof window !== 'undefined' ? window.songService : null;
    if (songService?.syncRequestedSongsFromServer) {
      await songService.syncRequestedSongsFromServer({ force: true, immediate: true });
      const list = Array.isArray(songService.selectedSongs) ? songService.selectedSongs.slice() : [];
      if (cacheService?.updateSelectedListCache) {
        cacheService.updateSelectedListCache(list, 5 * 60 * 1000, { source: 'api' });
      }
      return { code: 0, message: 'success', data: list };
    }

    try {
      const response = await this.apiService.getPlayList();
      const list = normalizePlayList(response);
      if (cacheService?.updateSelectedListCache) {
        cacheService.updateSelectedListCache(list, 5 * 60 * 1000, { source: 'api' });
      }
      if (typeof window !== 'undefined' && window.songService?.processPlayListResponse) {
        try {
          window.songService.processPlayListResponse(response, { source: 'selectedService' });
        } catch (e) {
          console.warn('[SelectedService] 同步已选列表到 SongService 失败', e);
        }
      }
      return response;
    } catch (error) {
      console.error('获取播放列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取已唱列表
   * GET /api/v1/rooms/:id/queue/played
   */
  async getPlayedList() {
    const res = await this.apiService.getPlayedList();
    if (!isApiOk(res)) {
      throw new Error(getApiErrorMessage(res, '获取已唱列表失败'));
    }
    const raw = parseApiArrayResponse(res, 'Played queue');
    return raw.map(item => ({
      ...item,
      name: item.songName || '',
      singer: item.singerNames || '',
      songNo: item.songNo || '',
    }));
  }

  processPlayListResponse(response) {
    return normalizePlayList(response);
  }


  async shufflePlayList() {
    const response = this._requireSuccess(
      await this.apiService.shufflePlayList(),
      'Failed to shuffle queue'
    );
    this._songService()?.markQueueMutationAccepted?.('shufflePlayList');
    return response;
  }

  async clearPlayList() {
    const response = this._requireSuccess(
      await this.apiService.clearPlayList(),
      'Failed to clear queue'
    );
    this._songService()?.applyClearAccepted?.();
    return response;
  }

  async playNext() {
    const songService = this._songService();
    const previousHeadId = songService?.selectedSongs?.[0]?.songNo ?? null;
    const response = this._requireSuccess(
      await this.apiService.playNext(),
      'Failed to play next song'
    );
    songService?.applyNextAccepted?.(previousHeadId);
    return response;
  }

  async upWord(params = {}) {
    const response = this._requireSuccess(
      await this.apiService.upWord(params),
      'Failed to prioritize song'
    );
    this._songService()?.applyPrioritizeAccepted?.(params.songNo);
    return response;
  }

  async deleteSong(params = {}) {
    const response = this._requireSuccess(
      await this.apiService.deleteSong(params),
      'Failed to remove song'
    );
    this._songService()?.applyDeleteAccepted?.(params.songNo);
    return response;
  }

  async requestSong(params = {}) {
    const songNo = typeof params === 'string' ? params : params.songNo;
    const songService = this._songService();
    if (songService?.requestSong) {
      const result = await songService.requestSong(songNo, null, params);
      return result.response;
    }
    const payload = { songNo };
    if (typeof params === 'object' && params?.isPriority === true) payload.isPriority = true;
    const response = this._requireSuccess(
      await this.apiService.selectSong(payload),
      'Failed to request song'
    );
    this._songService()?.applyRequestAccepted?.(songNo);
    return response;
  }
}

const selectedService = new SelectedService();
export default selectedService;
