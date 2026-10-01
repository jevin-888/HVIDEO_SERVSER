/**
 * 收银服务类 - 通过统一 ApiService 与后台 /api/v1 对接
 */

import apiService from '../../core/ApiService.js';
import { isEmptyArray } from '../../utils/NormalizeUtils.js';

class CashierServiceClass {
    constructor() {
        this.apiService = apiService;
    }

    /**
     * 获取商品分类（计费）
     * GET /api/v1/products/categories
     */
    async getDrinkCategories(params = {}) {
        return await this.apiService.getCashierDrinkCategories(params);
    }

    /**
     * 获取免费商品分类
     * GET /api/v1/products/categories/free
     */
    async getFreeDrinkCategories(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.drinkCategoryFree || '/products/categories/free';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 获取商品列表
     * GET /api/v1/products
     */
    async getDrinks(params = {}) {
        return await this.apiService.getCashierDrinks(params.categoryId);
    }

    /**
     * 获取套餐列表
     * GET /api/v1/products/combos
     */
    async getComboGroups(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.comboGroup || '/products/combos';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 获取套餐明细
     * GET /api/v1/products/combos/:id/items
     */
    async getComboGroupDetail(params = {}) {
        if (!params.id) {
            throw new Error('缺少必要参数: id');
        }
        const comboId = params.id;
        const ep = `/products/combos/${encodeURIComponent(comboId)}/items`;
        return await this.apiService._sendGet('cashier', ep, {});
    }

    /**
     * 获取口味列表
     * GET /api/v1/products/tastes
     */
    async getSpecialTastes(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.specialTaste || '/products/tastes';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 提交订单
     * POST /api/v1/orders
     */
    async submitOrder(params = {}) {
        this._validateOrderItems(params.items);
        return await this.apiService.submitCashierOrder(params);
    }

    /**
     * 获取账单信息
     * GET /api/v1/orders/bill
     */
    async getBillInfo(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.billInfo || '/orders/bill';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 获取订单明细
     * GET /api/v1/orders/:id/detail
     */
    async getConsumptionDetail(params = {}) {
        const orderId = params.id;
        if (orderId) {
            return await this.apiService.getOrderDetail(orderId);
        }
        const ep = window.AppConfig?.cashierServer?.endpoints?.consumptionDetail || '/orders/:id/detail';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 服务员登录
     * POST /api/v1/auth/waiter/login
     */
    async waiterLogin(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.waiterLogin || '/auth/waiter/login';
        return await this.apiService._sendJson('cashier', ep, params, 'POST');
    }

    /**
     * 获取房间列表
     * GET /api/v1/rooms (通过 cashier 服务)
     */
    async getRoomList(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.roomList || '/rooms';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 房间控制（开关房）
     * POST /api/v1/rooms/:id/control
     */
    async roomControl(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.roomControl || '/rooms/:id/control';
        return await this.apiService._sendJson('cashier', ep, params, 'POST');
    }

    /**
     * 向房间发送消息
     * POST /api/v1/rooms/:id/message
     */
    async sendRoomNotice(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.roomNotice || '/rooms/:id/message';
        return await this.apiService._sendJson('cashier', ep, params, 'POST');
    }

    /**
     * 服务铃呼叫
     * POST /api/v1/rooms/:id/service/bell
     */
    async serviceBell(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.serviceBell || '/rooms/:id/service/bell';
        return await this.apiService._sendJson('cashier', ep, params, 'POST');
    }

    /**
     * 服务铃响应
     * POST /api/v1/rooms/:id/service/response
     */
    async serviceBellResponse(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.serviceBellResponse || '/rooms/:id/service/response';
        return await this.apiService._sendJson('cashier', ep, params, 'POST');
    }

    /**
     * 取消服务铃
     * POST /api/v1/rooms/:id/service/cancel
     */
    async closeServiceBell(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.serviceBellClose || '/rooms/:id/service/cancel';
        return await this.apiService._sendJson('cashier', ep, params, 'POST');
    }

    /**
     * 获取点单二维码
     * GET /api/v1/orders/qrcode
     */
    async getQrCodeForDrinks(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.qrcodeBuyDrinks || '/orders/qrcode';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 获取广告列表
     * GET /api/v1/marketing/ads
     */
    async getAdList(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.adList || '/marketing/ads';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 获取公关人员列表
     * GET /api/v1/pr/staff
     */
    async getPrList(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.prList || '/pr/staff';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 获取公关分组统计
     * GET /api/v1/pr/groups/stats
     */
    async getPrCateCount(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.prCateCount || '/pr/groups/stats';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 获取公关分组
     * GET /api/v1/pr/groups
     */
    async getPrCateInfo(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.prCateInfo || '/pr/groups';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 获取公关记录
     * GET /api/v1/pr/records
     */
    async getPrCheckInDetail(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.prCheckInDetail || '/pr/records';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 获取打赏礼物列表
     * GET /api/v1/pr/flowers
     */
    async getPrFlowerList(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.prFlowerList || '/pr/flowers';
        return await this.apiService._sendGet('cashier', ep, params);
    }

    /**
     * 公关服务（上台/下台/退台）
     * POST /api/v1/pr/service
     */
    async prService(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.prService || '/pr/service';
        return await this.apiService._sendJson('cashier', ep, params, 'POST');
    }

    /**
     * 创建公关订单
     * POST /api/v1/pr/orders
     */
    async prPurchase(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.prPurchase || '/pr/orders';
        return await this.apiService._sendJson('cashier', ep, params, 'POST');
    }

    /**
     * 公关呼叫
     * POST /api/v1/rooms/:id/peripheral/call
     */
    async prCall(params = {}) {
        const ep = window.AppConfig?.cashierServer?.endpoints?.prCall || '/rooms/:id/peripheral/call';
        return await this.apiService._sendJson('cashier', ep, params, 'POST');
    }

    /**
     * 验证订单商品列表参数
     * @private
     */
    _validateOrderItems(items) {
        if (isEmptyArray(items)) {
            throw new Error('缺少必要参数: items');
        }
        items.forEach((item, i) => {
            if (!item.productId || !item.quantity) {
                throw new Error(`items[${i}] 缺少必要参数: productId/quantity`);
            }
        });
    }
}

const cashierService = new CashierServiceClass();
export default cashierService;
