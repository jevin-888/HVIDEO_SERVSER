/**
 * 搜索参数构建工具
 * 统一构建搜索请求参数，避免重复代码
 */

/**
 * 构建搜索参数
 * @param {Object} options - 配置选项
 * @param {string} options.keyword - 搜索关键词
 * @param {string} options.initial - 歌曲名称首字母
 * @param {Object} options.baseFilterParams - 基础过滤参数（语种、分类、性别、地区等）
 * @param {number} options.page - 当前页码，默认1
 * @param {number} options.pageSize - 每页大小，默认50
 * @returns {Object} 构建好的搜索参数对象
 */
export function buildSearchParams({ keyword, initial, baseFilterParams = {}, page = 1, pageSize = 50, searchMode }) {
  const searchParams = {
    page,
    pageSize
  };

  const trimmedKeyword = (keyword || '').trim();
  const trimmedInitial = (initial || '').trim();
  if (trimmedKeyword) searchParams.keyword = trimmedKeyword;
  if (trimmedInitial) searchParams.initial = trimmedInitial;
  if (searchMode) searchParams.searchMode = searchMode;

  // 合并基础过滤参数（语种、分类、性别、地区等）
  if (baseFilterParams.sexCode) searchParams.sexCode = baseFilterParams.sexCode;
  if (baseFilterParams.regionCode) searchParams.regionCode = baseFilterParams.regionCode;
  if (baseFilterParams.primarySingerNo) searchParams.primarySingerNo = baseFilterParams.primarySingerNo;
  if (baseFilterParams.languageCode) searchParams.languageCode = baseFilterParams.languageCode;
  if (baseFilterParams.categoryCode) searchParams.categoryCode = baseFilterParams.categoryCode;

  // 清理空值
  Object.keys(searchParams).forEach(key => {
    if (searchParams[key] === '' || searchParams[key] === null || searchParams[key] === undefined) {
      delete searchParams[key];
    }
  });

  return searchParams;
}
