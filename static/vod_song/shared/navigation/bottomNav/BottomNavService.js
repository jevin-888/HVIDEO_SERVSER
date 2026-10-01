/**
 * 底部导航服务
 * 提供播放列表数量等功能
 */
class BottomNavService {
  constructor() {
    this.playListCounts = {
      selected: 0,
      playing: 0,
      next: 0
    };
  }

  /**
   * 获取播放列表数量
   * @returns {Object} 播放列表数量对象
   */
  getPlayListCounts() {
    return { ...this.playListCounts };
  }

  /**
   * 更新播放列表数量
   * @param {Object} counts - 数量对象
   */
  updatePlayListCounts(counts) {
    if (counts) {
      this.playListCounts = { ...this.playListCounts, ...counts };
    }
  }

  /**
   * 设置已选数量
   * @param {number} count - 数量
   */
  setSelectedCount(count) {
    this.playListCounts.selected = count;
  }

  /**
   * 设置正在播放数量
   * @param {number} count - 数量
   */
  setPlayingCount(count) {
    this.playListCounts.playing = count;
  }

  /**
   * 设置下一首数量
   * @param {number} count - 数量
   */
  setNextCount(count) {
    this.playListCounts.next = count;
  }
}

// 创建单例
const bottomNavService = new BottomNavService();

export default bottomNavService;
