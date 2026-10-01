/**
 * KTV 使用 shared 统一 NormalizeUtils（re-export）
 */
export {
  normalizeSongsList,
  normalizeSingersList,
  normalizePlayList,
  ensureArray,
  isNonEmptyArray,
  isEmptyArray
} from '../../shared/utils/NormalizeUtils.js';

// normalizeTopSongs 别名，实际使用 normalizeSongsList
export { normalizeSongsList as normalizeTopSongs } from '../../shared/utils/NormalizeUtils.js';
