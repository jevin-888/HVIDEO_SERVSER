import apiService from '../../../shared/core/ApiService.js?v=20260730-order';
import { parseApiArrayResponse } from '../../../shared/utils/ResponseParser.js';
import { isApiOk, getApiErrorMessage } from '../../../shared/utils/ApiResponseUtils.js';

/**
 * 收银业务逻辑
 */
class CashierService {
  constructor() {
    this.apiService = apiService;
  }

  /**
   * 获取酒水分类列表
   * @returns {Promise} 酒水分类列表Promise
   */
  async getDrinkCategories() {
    try {
      const response = await this.apiService.getCashierDrinkCategories();
      return parseApiArrayResponse(response, 'Product categories');
    } catch (error) {
      console.error('获取酒水分类列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取酒水列表
   * @param {string} categoryId - 分类ID
   * @returns {Promise} 酒水列表Promise
   */
  async getDrinks(categoryId) {
    try {
      const response = await this.apiService.getCashierDrinks(categoryId);
      return parseApiArrayResponse(response, 'Products');
    } catch (error) {
      console.error('获取酒水列表失败:', error);
      throw error;
    }
  }

  /**
   * 创建订单
   * @param {Object} orderData - 订单数据
   * @returns {Promise} 订单创建结果Promise
   */
  async createOrder(orderData) {
    try {
      const roomId = String(orderData?.roomId || this.apiService.getRoomId() || '').trim();
      const items = Array.isArray(orderData?.items) ? orderData.items : [];
      if (!roomId || items.length === 0) throw new Error('Order requires roomId and at least one item');
      const response = await this.apiService.submitCashierOrder({ roomId, items });
      if (!isApiOk(response)) throw new Error(getApiErrorMessage(response, 'Failed to create order'));
      return response.data;
    } catch (error) {
      console.error('创建订单失败:', error);
      throw error;
    }
  }

  /**
   * 获取订单详情
   * @param {string} orderId - 订单ID
   * @returns {Promise} 订单详情Promise
   */
  async getOrderDetail(orderId) {
    try {
      const id = String(orderId ?? '').trim();
      if (!id) throw new Error('Invalid order ID');
      const response = await this.apiService.getOrderDetail(id);
      if (!isApiOk(response)) {
        throw new Error(getApiErrorMessage(response, 'Failed to get order detail'));
      }
      return response.data;
    } catch (error) {
      console.error('收银操作失败:', error);
      throw error;
    }
  }
}

// 创建并导出收银服务实�?
const cashierService = new CashierService();
export default cashierService;
