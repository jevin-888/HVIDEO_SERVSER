/**
 * KTV 使用 shared 统一 SongCardFactory（re-export）
 * 加载后 shared 会设置 window.SongCardFactory
 */
export { createUnifiedSongCard, createUnifiedSingerCard } from '../../shared/utils/SongCardFactory.js';
