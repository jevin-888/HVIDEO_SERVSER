import apiService from '../../core/ApiService.js';
import { parseApiArrayResponse } from '../../utils/ResponseParser.js';
import { isApiOk, getApiErrorMessage } from '../../utils/ApiResponseUtils.js';

class MaterialService {
  constructor() {}

  normalizeCategory(item = {}) {
    return {
      id: String(item.id || ''),
      name: item.name || '未分类'
    };
  }

  normalizeMaterial(item = {}) {
    return {
      id: String(item.id || ''),
      name: item.name || '未命名素材',
      categoryId: String(item.categoryId || ''),
      categoryName: item.categoryName || '',
      url: item.url || '',
      cover: item.cover || '',
      duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : 0
    };
  }

  async getMaterialCategories(params = {}) {
    try {
      const resp = await apiService.getMaterialCategories(params);
      const list = parseApiArrayResponse(resp, 'Material categories');
      return list.map((item) => this.normalizeCategory(item));
    } catch (error) {
      console.error('[MaterialService] 获取素材分类失败:', error);
      throw error;
    }
  }

  async getMaterials(params = {}) {
    const resp = await apiService.getMaterialList(params);
    const list = parseApiArrayResponse(resp, 'Materials');
    return list.map((item) => this.normalizeMaterial(item));
  }

  async playMaterial(params = {}) {
    const response = await apiService.playMaterial(params);
    if (!isApiOk(response)) {
      throw new Error(getApiErrorMessage(response, '??????'));
    }
    return response;
  }
}

const materialService = new MaterialService();
export default materialService;
