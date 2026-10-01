import cashierService from './cashierService.js';
import toastService from '../../../shared/services/ToastService.js';
import { BottomPanelPositionManager } from '../../utils/BottomPanelPositionManager.js';
import { isNonEmptyArray } from '../../utils/NormalizeUtils.js';

/**
 * 点单模态框类 - 仅保留UI和交互逻辑
 * 所有业务逻辑已移至CashierService.js
 */
class OrderModal {
    constructor() {
        this.modal = null;
        this.isOpen = false;
        this.activeCategory = 'drinks'; // 默认选中酒水分类
        this.selectedProducts = []; // 存储已选商品
        // 新架构：后端通过IP自动识别房间，roomCode仅用于显示
        this.roomCode = '';
        this.drinksCategories = []; // 存储酒水分类
        this.categoryType = '0'; // 分类类型：0计费 1免费
        this.roomStatus = 1; // 房间状态，默认为1表示可用（防止初始化延迟导致误判）
        this._wsUnbindHandlers = []; // WebSocket监听器清理函数数组

        // 添加商品数据缓存
        this.productCache = new Map(); // 使用Map来存储分类商品数据缓存
        this.cacheExpiry = 5 * 60 * 1000; // 缓存过期时间5分钟

        // 监听语言切换事件
        document.addEventListener('languageChanged', () => {
            // 如果模态框已打开，则更新内容
            if (this.isOpen && this.modal) {
                this.updateModalContent();
            }
        });

        // 添加必要的CSS样式
        this.addModalStyles();

        // 确保模态框已创建后再添加事件监听器
        if (this.modal) {
            // 禁止双指放大缩小
            this.modal.addEventListener('touchstart', (e) => {
                if (e.touches.length > 1) {
                    e.preventDefault();
                }
            }, { passive: false });

            this.modal.addEventListener('touchmove', (e) => {
                if (e.touches.length > 1) {
                    e.preventDefault();
                }
            }, { passive: false });
        }
    }

    checkRoomStatus() {
        if (window.WebSocketClient) {
            const globalState = window.WebSocketClient.getGlobalState?.();
            const initialState = globalState?.initialState;
            if (initialState && initialState.status !== undefined) {
                this.roomStatus = initialState.status;
                return this.roomStatus;
            }
        }
        return this.roomStatus;
    }

    // 检查房间是否可用（房间状态为1表示可用）
    isRoomAvailable() {
        const status = this.checkRoomStatus();
        return Number(status) === 1;
    }

    // 显示房间状态错误提示
    showRoomStatusError() {
        const status = this.checkRoomStatus();
        this.showToast(`当前房间不是消费状态，不能点单（房态：${this.getRoomStatusText(status)}）`);
    }

    // 获取翻译文本
    getText(key) {
        // 使用全局langService获取翻译
        return window.langService && window.langService.t(key) || key;
    }

    // 添加模态框样式
    addModalStyles() {
        // 检查是否已经添加了样式
        if (document.getElementById('order-modal-styles')) {
            return;
        }

        // 创建style元素引入内联CSS样式
        const style = document.createElement('style');
        style.id = 'order-modal-styles';
        style.textContent = `
            #orderModal .order-modal-body {
                display: flex;
                height: 100%;
                background: var(--bg-secondary, #111827);
                color: var(--text-primary, #f3f4f6);
            }
            
            #orderModal .order-modal-sidebar {
                width: 120px;
                background: var(--bg-primary, #0b1120);
                border-right: 1px solid var(--border-color, rgba(148, 163, 184, 0.25));
                overflow-y: auto;
                padding: 10px 0;
            }
            
            #orderModal .order-modal-content {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            
            #orderModal .category-title {
                font-size: 16px;
                font-weight: bold;
                padding: 10px 15px;
                border-bottom: 1px solid var(--border-color, rgba(148, 163, 184, 0.25));
                margin: 0;
                color: var(--text-primary, #f3f4f6);
            }
            
            #orderModal .category-item {
                padding: 12px 15px;
                cursor: pointer;
                border-bottom: 1px solid var(--border-color, rgba(148, 163, 184, 0.25));
                transition: background-color 0.2s;
                color: var(--text-primary, #f3f4f6);
            }
            
            #orderModal .category-item:hover {
                background-color: var(--bg-elevated, rgba(30, 41, 59, 0.88));
            }
            
            #orderModal .category-item.active {
                background-color: var(--primary-color, #e53e3e);
                color: var(--color-white, #fff);
            }
            
            #orderModal .dish-item {
                display: flex;
                align-items: center;
                padding: 10px 15px;
                border-bottom: 1px solid var(--border-color, rgba(148, 163, 184, 0.25));
            }
            
            #orderModal .dish-img-container {
                width: 60px;
                height: 60px;
                margin-right: 15px;
                border-radius: 8px;
                overflow: hidden;
                background: var(--bg-primary, #0b1120);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            #orderModal .dish-img-container img {
                max-width: 100%;
                max-height: 100%;
                object-fit: cover;
            }
            
            #orderModal .dish-info {
                flex: 1;
            }
            
            #orderModal .dish-name {
                font-weight: bold;
                margin-bottom: 5px;
                color: var(--text-primary, #f3f4f6);
            }
            
            #orderModal .dish-taste {
                font-size: 14px;
                color: var(--text-muted, rgba(148, 163, 184, 0.85));
                margin-bottom: 8px;
            }
            
            #orderModal .dish-price {
                font-weight: bold;
                color: var(--success-color, #22c55e);
            }
            
            #orderModal .count-control {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            #orderModal .count-btn {
                width: 30px;
                height: 30px;
                border: 1px solid var(--border-color, rgba(148, 163, 184, 0.25));
                background: var(--bg-elevated, rgba(30, 41, 59, 0.88));
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--text-primary, #f3f4f6);
            }
            
            #orderModal .count-display {
                min-width: 30px;
                text-align: center;
                color: var(--text-primary, #f3f4f6);
            }
            
            #orderModal #categoryContentContainer .category-item {
                padding: 15px;
                border-bottom: 1px solid var(--border-color, rgba(148, 163, 184, 0.25));
                cursor: pointer;
            }
            
            #orderModal #categoryContentContainer .category-item:last-child {
                border-bottom: none;
            }
            
            #orderModal #categoryContentContainer .category-item.active {
                background-color: var(--bg-elevated, rgba(30, 41, 59, 0.88));
            }
        `;

        // 添加到head
        document.head.appendChild(style);
    }

    // 获取酒水分类 - 使用CashierService
    async fetchDrinksCategories() {
        try {
            const params = {};
            // 设置分类类型为计费
            this.categoryType = '0';

            // 使用CashierService的getDrinkCategories方法获取计费酒水分类
            const result = await cashierService.getDrinkCategories(params);
            // 检查响应数据格式并提取分类数据
            let categories = [];

            // 从响应中提取分类数据
            if (result && result.code === 0 && result.data) {
                if (Array.isArray(result.data)) {
                    categories = result.data;
                }
            }

            this.drinksCategories = categories;

            if (categories.length > 0) {
            } else {
                console.warn('计费酒水分类返回空数据');
                // 如果计费分类获取失败，尝试获取免费分类
                await this.fetchFreeDrinksCategories();
            }

            // 无论是否有数据，都调用updateDrinksContent来更新界面
            this.updateDrinksContent();

            return categories;
        } catch (error) {
            console.error('获取酒水分类异常:', error.message);
            console.error('错误详情:', error);

            // 如果计费分类获取失败，尝试获取免费分类
            await this.fetchFreeDrinksCategories();

            return [];
        }
    }

    // 获取免费酒水分类 - 使用CashierService
    async fetchFreeDrinksCategories() {
        try {
            const params = {
                card: '1',
                password: '1',
                verify_mode: '1'
            };
            // 设置分类类型为免费
            this.categoryType = '1';

            // 使用CashierService的getFreeDrinkCategories方法获取免费酒水分类
            const result = await cashierService.getFreeDrinkCategories(params);
            // 检查响应数据格式并提取分类数据
            let categories = [];

            // 从响应中提取分类数据
            if (result && result.code === 0 && result.data) {
                if (Array.isArray(result.data)) {
                    categories = result.data;
                }
            }

            this.drinksCategories = categories;

            if (categories.length > 0) {
            } else {
                console.warn('免费酒水分类返回空数据');
                // 使用空数组作为后备
                this.drinksCategories = [];
            }

            // 更新界面
            this.updateDrinksContent();

            return categories;
        } catch (error) {
            console.error('获取免费酒水分类异常:', error.message);
            console.error('错误详情:', error);

            // 使用空数组作为后备
            this.drinksCategories = [];
            this.updateDrinksContent();
            return [];
        }
    }


    // 更新酒水分类内容显示
    updateDrinksContent() {
        if (!this.modal) return;

        // 获取分类内容容器
        const categoryContainer = this.modal.querySelector('#categoryContentContainer');
        if (!categoryContainer) {
            console.error('未找到分类内容容器');
            return;
        }

        // 清空容器
        categoryContainer.innerHTML = '';

        // 检查是否有分类数据
        if (!this.drinksCategories || this.drinksCategories.length === 0) {
            categoryContainer.innerHTML = `
                <div class="text-center text-gray-500 dark:text-gray-400 text-xs sm:text-sm">
                    <p>暂无分类</p>
                </div>
            `;
            return;
        }

        // 创建分类列表
        const categoryList = document.createElement('div');
        categoryList.className = 'space-y-1';

        // 添加每个分类
        this.drinksCategories.forEach((category, index) => {
            const categoryItem = document.createElement('div');
            categoryItem.dataset.category = `drinks_${category.CateID || index}`;
            categoryItem.className = 'category-item p-3 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm sm:text-base w-full mb-2';

            // 如果是第一个分类，设置为激活状态
            if (index === 0) {
                categoryItem.classList.add('active', 'bg-blue-100', 'dark:bg-blue-900/30', 'text-blue-800', 'dark:text-blue-200');
            }

            categoryItem.innerHTML = `
                <div class="flex flex-col items-center justify-center p-1">
                    <i class="fas fa-glass-cheers text-lg mb-1"></i>
                    <span class="category-name text-xs">${category.Name || category.name || '未知分类'}</span>
                </div>
            `;

            // 绑定点击事件
            categoryItem.addEventListener('click', () => {
                // 移除其他分类的激活状态
                categoryContainer.querySelectorAll('.category-item').forEach(item => {
                    item.classList.remove('active', 'bg-blue-100', 'dark:bg-blue-900/30', 'text-blue-800', 'dark:text-blue-200');
                });

                // 添加当前分类的激活状态
                categoryItem.classList.add('active', 'bg-blue-100', 'dark:bg-blue-900/30', 'text-blue-800', 'dark:text-blue-200');

                // 切换分类
                this.switchCategory(categoryItem.dataset.category);
            });

            categoryList.appendChild(categoryItem);
        });

        // 添加到容器
        categoryContainer.appendChild(categoryList);

        // 如果有分类数据，自动切换到第一个分类
        if (this.drinksCategories.length > 0) {
            const firstCategory = `drinks_${this.drinksCategories[0].CateID || this.drinksCategories[0].cate_id || 0}`;
            this.switchCategory(firstCategory);
        }
    }

    // 获取分类商品数据 - 使用CashierService
    async fetchCategoryProducts(categoryId) {
        try {
            // 从categoryId中提取实际的分类ID（去除可能的前缀）
            const cleanCategoryId = categoryId.replace('drinks_', '');

            // 检查缓存中是否已有该分类的商品数据
            const cacheKey = `${this.roomCode}_${cleanCategoryId}`;
            const cachedData = this.productCache.get(cacheKey);

            // 如果缓存存在且未过期，直接返回缓存数据
            if (cachedData && (Date.now() - cachedData.timestamp < this.cacheExpiry)) {
                // 注意：这里可能需要根据分类ID过滤数据
                const filteredData = this.filterProductsByCategory(cachedData.data, cleanCategoryId);
                return filteredData;
            }

            const params = {
                type: this.categoryType, // 使用当前设置的分类类型
                categoryId: cleanCategoryId
            };

            // 如果是免费分类，添加必要的认证参数
            if (this.categoryType === '1') {
                params.card = '1';
                params.password = '1';
                params.verify_mode = '1';
            }

            // 使用CashierService获取分类商品数据
            const result = await cashierService.getDrinks(params);
            // 检查响应数据格式并提取商品列表
            if (result.code === 0 && result.data) {
                let productList = [];
                if (Array.isArray(result.data)) {
                    productList = result.data;
                }
                // 将数据存入缓存
                this.productCache.set(cacheKey, {
                    data: productList,
                    timestamp: Date.now()
                });

                // 注意：这里可能需要根据分类ID过滤数据
                const filteredData = this.filterProductsByCategory(productList, cleanCategoryId);
                return filteredData;
            } else {
                console.warn('商品数据格式不符合预期:', result);
                return [];
            }
        } catch (error) {
            console.error('获取分类商品异常:', error.message);
            console.error('错误详情:', error);
            return [];
        }
    }

    // 判断是否为免费分类
    isFreeCategory(categoryId) {
        // 这里可以根据实际业务逻辑判断是否为免费分类
        // 例如，可以检查分类ID是否在免费分类列表中
        // 或者根据分类名称判断
        // 暂时返回false，表示默认都使用计费分类
        return false;
    }

    // 根据分类ID过滤商品数据
    filterProductsByCategory(products, categoryId) {
        // 打印调试信息
        // 如果商品数据中包含分类ID字段，进行过滤
        if (Array.isArray(products)) {
            // 检查商品数据中是否有分类ID字段
            const filteredProducts = products.filter(product => {
                // 兼容不同的分类ID字段名
                const productCategoryId = product.cate_id || product.CateID || product.categoryId || product.CategoryID || product.cateId;
                // 如果商品数据中没有分类ID字段，说明所有商品都属于当前分类
                if (productCategoryId === undefined) {
                    return true;
                }

                // 转换为字符串进行比较，确保类型一致
                return String(productCategoryId) === String(categoryId);
            });
            return filteredProducts;
        }

        return products;
    }

    // 处理图片路径
    processImagePath(picPath) {
        // 确保图片路径格式正确
        if (!picPath) return '';

        // 移除图片URL末尾可能的转义字符或多余的引号
        let processedPath = picPath.trim();

        // 处理各种引号和转义字符的情况
        if (processedPath.startsWith('`') && processedPath.endsWith('`')) {
            processedPath = processedPath.substring(1, processedPath.length - 1);
        } else if (processedPath.startsWith('"') && processedPath.endsWith('"')) {
            processedPath = processedPath.substring(1, processedPath.length - 1);
        } else if (processedPath.startsWith("'") && processedPath.endsWith("'")) {
            processedPath = processedPath.substring(1, processedPath.length - 1);
        }

        // 移除末尾可能的反斜杠
        if (processedPath.endsWith('\\')) {
            processedPath = processedPath.slice(0, -1);
        }

        // 移除末尾可能的#号
        if (processedPath.endsWith('#')) {
            processedPath = processedPath.slice(0, -1);
        }

        // 处理可能的URL编码问题
        try {
            processedPath = decodeURIComponent(processedPath);
        } catch (e) {
            // 如果解码失败，保持原路径
            console.warn('图片路径解码失败:', e);
        }

        return processedPath;
    }

    // 更新商品内容显示
    updateProductsContent(products, categoryId) {
        if (!this.modal) return;

        // 获取商品内容容器
        const productContainer = this.modal.querySelector('#productContentContainer');
        if (!productContainer) {
            console.error('未找到商品内容容器');
            return;
        }

        // 清空容器
        productContainer.innerHTML = '';

        // 检查是否有商品数据
        if (!products || products.length === 0) {
            productContainer.innerHTML = `
                <div class="text-center text-gray-500 dark:text-gray-400 flex items-center justify-center h-full">
                    <p class="text-lg">当前分类暂无商品</p>
                </div>
            `;
            return;
        }

        // 创建商品列表容器
        const productList = document.createElement('div');
        productList.className = 'dish-list';

        // 添加每个商品作为横条
        products.forEach(product => {
            // 调试：打印商品数据结构
            const productItem = document.createElement('div');
            productItem.dataset.productId = product.id || '';
            productItem.dataset.productName = product.name || '未知商品';
            productItem.dataset.productPrice = product.price || 0;
            productItem.dataset.productUnit = product.unit || '个';
            productItem.className = 'dish-item';

            // 获取商品图标
            const productName = product.name || '未知商品';
            const iconClass = this.getProductIcon(productName);

            // 处理图片路径
            const imagePath = this.processImagePath(product.imageUrl);

            // 查找该商品在已选商品列表中的数量
            const selectedProduct = this.selectedProducts.find(item => {
                const itemId = item.id || '';
                const productId = product.id || '';
                return itemId === productId;
            });
            const initialCount = selectedProduct ? selectedProduct.quantity : 0;

            // 确保价格存在且为有效数字，否则使用默认值0
            const price = (typeof product.price === 'number' && !isNaN(product.price)) ? product.price : 0;

            productItem.innerHTML = `
                <div class="dish-img-container">
                    ${imagePath ?
                    `<img src="${imagePath}" alt="${productName}" class="dish-img">` :
                    `<img src="assets/images/order.png" alt="默认图片" class="dish-img">`
                }
                </div>
                <div class="dish-info">
                    <div class="dish-name">${productName}</div>
                    <div class="dish-taste">口味：暂无 | 食材：暂无</div>
                    <div class="dish-price"><span>¥</span>${price.toFixed(2)} / ${product.unit || '个'}</div>
                </div>
                <div class="count-control">
                    <button class="count-btn minus-btn" data-action="decrease" data-product-id="${product.id || ''}">-</button>
                    <span class="count-num" data-count="${initialCount}">${initialCount}</span>
                    <button class="count-btn plus-btn" data-action="increase" data-product-id="${product.id || ''}">+</button>
                </div>
            `;

            // 获取数量控制相关元素
            const minusBtn = productItem.querySelector('.minus-btn');
            const plusBtn = productItem.querySelector('.plus-btn');
            const countNum = productItem.querySelector('.count-num');

            // 初始化数量
            let count = initialCount;

            // 添加减少数量按钮事件
            minusBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                if (count > 0) {
                    count--;
                    countNum.textContent = count;
                    countNum.dataset.count = count;
                    this.updateOrder(product, -1);
                }
                // 根据数量更新按钮状态
                minusBtn.disabled = count === 0;
                // 确保在每次点击后都更新徽标
                this.updateSelectedBadge();
            });

            // 添加增加数量按钮事件
            plusBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                count++;
                countNum.textContent = count;
                countNum.dataset.count = count;
                this.updateOrder(product, 1);
                // 启用减少按钮
                minusBtn.disabled = false;
                // 确保在每次点击后都更新徽标
                this.updateSelectedBadge();
            });

            // 根据初始数量设置按钮状态
            minusBtn.disabled = count === 0;

            productList.appendChild(productItem);
        });

        // 添加到容器
        productContainer.appendChild(productList);
    }

    // 获取商品图标
    getProductIcon(productName, productCategory = null) {
        // 如果没有商品名称，返回默认图标
        if (!productName) return 'fa-glass';

        // 转换为小写以便比较
        const name = productName.toLowerCase();

        // 根据商品名称包含的关键词返回不同的图标
        if (name.includes('啤酒') || name.includes('beer')) return 'fa-beer';
        else if (name.includes('红酒') || name.includes('wine') || name.includes('red')) return 'fa-wine-bottle';
        else if (name.includes('白酒') || name.includes('liquor') || name.includes('white')) return 'fa-glass-whiskey';
        else if (name.includes('鸡尾酒') || name.includes('cocktail')) return 'fa-cocktail';
        else if (name.includes('可乐') || name.includes('cola')) return 'fa-wine-glass-alt';
        else if (name.includes('茶') || name.includes('tea')) return 'fa-mug-hot';
        else if (name.includes('咖啡') || name.includes('coffee')) return 'fa-coffee';
        else if (name.includes('果汁') || name.includes('juice')) return 'fa-glass-juice';
        else if (name.includes('水') || name.includes('water')) return 'fa-glass-water';
        else if (name.includes('牛奶') || name.includes('milk')) return 'fa-cheese';
        else if (name.includes('小吃') || name.includes('snack')) return 'fa-utensils';
        else if (name.includes('套餐') || name.includes('combo')) return 'fa-box';

        // 默认图标
        return 'fa-glass';
    }

    // 切换分类
    async switchCategory(category) {
        try {
            // 设置当前激活的分类
            this.activeCategory = category;

            // 更新分类项的选中状态
            const categoryItems = this.modal.querySelectorAll('.category-item');
            categoryItems.forEach(item => {
                if (item.dataset.category === category) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });

            // 更新商品展示标题为当前选中的分类名称
            const activeCategoryElement = Array.from(categoryItems).find(item => item.dataset.category === category);
            if (activeCategoryElement) {
                const categoryName = activeCategoryElement.querySelector('.category-name')?.textContent || '商品展示';
                const productTitle = this.modal.querySelector('#productTitle h4');
                if (productTitle) {
                    productTitle.textContent = categoryName;
                }
            }

            // 显示加载状态
            const productContainer = this.modal.querySelector('#productContentContainer');
            if (productContainer) {
                productContainer.innerHTML = `
                    <div class="loading-more flex items-center justify-center h-full"></div>
                `;
            }

            // 获取分类商品数据
            const products = await this.fetchCategoryProducts(category);

            // 更新商品显示
            this.updateProductsContent(products, category);
        } catch (error) {
            console.error('切换分类时出错:', error);

            // 显示错误信息
            const productContainer = this.modal.querySelector('#productContentContainer');
            if (productContainer) {
                productContainer.innerHTML = `
                    <div class="text-center text-red-500 dark:text-red-400 flex items-center justify-center h-full">
                        <p class="text-lg">加载商品失败，请重试</p>
                    </div>
                `;
            }
        }
    }

    // 初始化模态框
    init() {
        this.createModal();
        this.bindEvents();

        if (window.WebSocketClient) {
            const globalState = window.WebSocketClient.getGlobalState?.();
            const initialState = globalState?.initialState;
            if (initialState) {
                const roomName = this.getRoomDisplayName(initialState);
                if (roomName) {
                    this.roomCode = roomName;
                    this.updateRoomNumber(this.roomCode);
                }
                if (initialState.status !== undefined) {
                    this.roomStatus = initialState.status;
                }
            }
        }
        return this;
    }

    // 创建模态框DOM结构
    createModal() {
        // 创建模态框元素
        this.modal = document.createElement('div');
        this.modal.id = 'orderModal';
        // 确保模态框初始状态为隐藏 (设置z-index为100，已选商品模态框z-index为10002，确保已选商品模态框能显示在其上方)
        this.modal.className = 'fixed inset-0 bg-black/50 z-[100] hidden opacity-0 transition-opacity duration-300';
        this.modal.style.touchAction = 'manipulation';
        this.modal.style.userSelect = 'none';
        this.modal.style.webkitUserSelect = 'none';
        // 创建模态框内容 - 与酒水页面样式保持一致
        const modalContent = document.createElement('div');
        // 确保内容初始状态在屏幕外
        // 移除固定高度 h-[70vh]，使用动态高度计算
        modalContent.className = 'fixed bottom-[65px] left-0 right-0 bg-white dark:bg-gray-800 rounded-t-2xl flex flex-col transform translate-y-full transition-transform duration-300';
        modalContent.id = 'orderModalContent';
        modalContent.classList.add('order-modal-container');
        // 添加模态框头部 - 固定在顶部
        const header = document.createElement('div');
        header.className = 'p-4 flex items-center justify-between border-b border-gray-200 dark:border-gray-700 z-10';
        header.innerHTML = `
            <h3 class="text-sm sm:text-base font-bold text-gray-800 dark:text-white">${this.getText('order')}</h3>
            <h3 class="text-sm sm:text-base font-bold text-gray-800 dark:text-white max-w-[40%] truncate" id="roomNumber">${this.getText('room')}${this.getText('loading')}</h3>
            <button id="closeOrderModal" class="btn-touch p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors" title="${this.getText('close')}" aria-label="关闭">
                <i class="fa fa-times text-base sm:text-lg"></i>
            </button>
        `;

        // 添加模态框主体内容 - 左侧分类 + 右侧内容
        const body = document.createElement('div');
        body.className = 'flex-1 flex overflow-hidden';
        body.classList.add('order-modal-body');

        // 左侧分类导航 - 添加固定的商品分类标题，优化响应式布局
        const categories = document.createElement('div');
        categories.className = 'w-1/4 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 order-0 flex flex-col md:w-1/4 lg:w-1/5 transition-all duration-300';
        categories.classList.add('order-modal-sidebar');

        // 添加商品分类标题（固定在顶部）
        const categoryTitle = document.createElement('div');
        categoryTitle.className = 'category-title p-4 border-b border-gray-200 dark:border-gray-700';
        categoryTitle.innerHTML = `
            <h4 class="text-base font-bold text-gray-800 dark:text-white">商品分类</h4>
        `;
        categories.appendChild(categoryTitle);

        // 分类内容区域，优化响应式滚动和高度
        const categoryContent = document.createElement('div');
        categoryContent.id = 'categoryContentContainer';
        categoryContent.className = 'flex-1 p-4 overflow-y-auto high-performance-scroll';
        categoryContent.style.height = '100%';
        categoryContent.style.minHeight = '0'; // 移除固定最小高度，允许更好的响应式调整
        categoryContent.style.maxHeight = 'none';
        categoryContent.innerHTML = `
            <div class="text-center text-gray-500 dark:text-gray-400 text-xs sm:text-sm">
                <p>暂无分类</p>
            </div>
        `;
        categories.appendChild(categoryContent);

        // 右侧内容区域 - 添加固定的商品展示标题，优化响应式布局
        const contentArea = document.createElement('div');
        contentArea.className = 'w-3/4 bg-white dark:bg-gray-800 order-1 flex flex-col md:w-3/4 lg:w-4/5 transition-all duration-300';
        contentArea.classList.add('order-modal-content');

        // 添加商品展示标题（固定在顶部）
        const productTitle = document.createElement('div');
        productTitle.className = 'product-title p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center';
        productTitle.id = 'productTitle'; // 添加ID以便查找
        productTitle.innerHTML = `
            <h4 class="text-base font-bold text-gray-800 dark:text-white">商品展示</h4>
            <div class="flex items-center">
                <button id="clearSelectedProducts" class="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600 transition-colors mr-2">清空</button>
                <div class="flex items-center">
                    <span class="text-xs sm:text-sm text-gray-800 dark:text-white mr-2">已选</span>
                    <div id="selectedBadge" class="bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs cursor-pointer hidden" title="查看已选商品">
                        0
                    </div>
                </div>
            </div>
        `;
        contentArea.appendChild(productTitle);

        // 绑定清空按钮事件
        const clearBtn = productTitle.querySelector('#clearSelectedProducts');
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                // 清空已选商品数组
                this.selectedProducts = [];

                // 更新徽标显示
                this.updateSelectedBadge();

                // 更新所有商品的数量显示
                this.updateAllProductCounts();

                // 显示提示信息
                this.showToast('已清空所有商品');
            });
        }

        // 商品内容滚动区域，优化响应式滚动
        const productContent = document.createElement('div');
        productContent.id = 'productContentContainer';
        productContent.className = 'flex-1 overflow-y-auto p-4 high-performance-scroll';
        productContent.innerHTML = `
            <div class="text-center text-gray-500 dark:text-gray-400 flex items-center justify-center h-full">
                <p class="text-base sm:text-lg">请选择左侧分类查看商品</p>
            </div>
        `;
        contentArea.appendChild(productContent);

        // 组装主体内容 - 确保分类导航在左侧，内容区域在右侧
        body.appendChild(categories);
        body.appendChild(contentArea);

        // 组装模态框
        modalContent.appendChild(header);
        modalContent.appendChild(body);
        this.modal.appendChild(modalContent);

        // 添加到页面
        document.body.appendChild(this.modal);
    }

    // 绑定事件
    bindEvents() {
        // 如果已绑定过WebSocket监听器，先清理
        if (this._wsUnbindHandlers && this._wsUnbindHandlers.length > 0) {
            this._wsUnbindHandlers.forEach(unbind => {
                if (typeof unbind === 'function') {
                    unbind();
                }
            });
            this._wsUnbindHandlers = [];
        }

        if (!this._wsUnbindHandlers) {
            this._wsUnbindHandlers = [];
        }

        if (window.WebSocketClient) {
            const unbind1 = window.WebSocketClient.on('roomStateChanged', (data) => {
                const stateData = data?.data || data;
                const roomName = this.getRoomDisplayName(stateData);
                if (roomName) {
                    this.updateRoomNumber(roomName);
                }
                if (stateData.status !== undefined) {
                    this.roomStatus = stateData.status;
                }
            });
            this._wsUnbindHandlers.push(unbind1);

        }

        // 立即尝试获取当前房间状态
        this.updateRoomNumberFromWebSocket();

        // 关闭按钮事件
        const closeBtn = this.modal.querySelector('#closeOrderModal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hide();
            });
        }

        // ESC键关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.hide();
            }
        });
    }

    // 添加商品到订单
    async addToOrder(product) {
        try {
            // 检查房间状态
            if (!this.isRoomAvailable()) {
                this.showRoomStatusError();
                return;
            }

            // 创建订单商品数据
            const orderItem = {
                id: product.id || '',
                name: product.name || '未知商品',
                unit: product.unit || '个',
                price: product.price || 0,
                quantity: 1
            };

            // 显示添加成功提示
            this.showToast(`已添加 ${orderItem.name} 到订单`);

            // 触发添加成功事件，供其他组件监听
            const event = new CustomEvent('orderItemAdded', { detail: orderItem });
            document.dispatchEvent(event);
        } catch (error) {
            console.error('添加商品到订单失败:', error);
            this.showToast('添加商品失败，请重试');
        }
    }

    // 更新订单中的商品数量
    updateOrder(product, quantityChange) {
        // 检查房间状态
        if (!this.isRoomAvailable()) {
            this.showRoomStatusError();
            return;
        }

        // 更新已选商品列表
        this.updateSelectedProducts(product, quantityChange);

        // 触发订单更新事件
        if (quantityChange > 0) {
            // 添加商品到订单
            this.addToOrder(product);
        } else {
            // 减少商品数量
            // 触发商品数量减少事件
            // 确保商品名称存在，否则使用默认值
            const productName = product.name || '未知商品';
            const productId = product.id || '';
            const event = new CustomEvent('orderItemDecreased', {
                detail: {
                    id: productId,
                    name: productName,
                    quantity: Math.abs(quantityChange)
                }
            });
            document.dispatchEvent(event);
        }
    }

    // 更新已选商品列表
    updateSelectedProducts(product, quantityChange) {
        const productId = product.id || '';
        // 查找是否已存在该商品
        const existingProductIndex = this.selectedProducts.findIndex(item => {
            const itemId = item.id || '';
            return itemId === productId;
        });

        if (existingProductIndex >= 0) {
            // 如果商品已存在，更新数量
            this.selectedProducts[existingProductIndex].quantity += quantityChange;
            // 如果数量为0或负数，移除该商品
            if (this.selectedProducts[existingProductIndex].quantity <= 0) {
                this.selectedProducts.splice(existingProductIndex, 1);
            }
        } else if (quantityChange > 0) {
            // 如果是新商品且数量增加，添加到列表
            // 确保价格存在且为有效数字，否则使用默认值0
            const price = (typeof product.price === 'number' && !isNaN(product.price)) ? product.price : 0;
            const productName = product.name || '未知商品';

            // 创建要添加到已选商品列表的商品对象
            const selectedItem = {
                id: productId,
                name: productName,
                price: price,
                unit: product.unit,
                quantity: quantityChange
            };

            // 如果商品有point_type字段，添加到selectedItem中
            if (product.point_type !== undefined) {
                selectedItem.point_type = product.point_type;
            }

            // 如果商品有taste字段，添加到selectedItem中
            if (product.taste !== undefined) {
                selectedItem.taste = product.taste;
            }

            // 如果商品有套餐信息，添加到selectedItem中
            if (isNonEmptyArray(product.combo)) {
                selectedItem.combo = product.combo;
            }

            this.selectedProducts.push(selectedItem);
        }
    }

    // 更新已选商品徽标
    updateSelectedBadge() {
        const badge = this.modal.querySelector('#selectedBadge');
        if (badge) {
            if (this.selectedProducts.length > 0) {
                badge.textContent = this.selectedProducts.length;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }

    // 更新所有商品的数量显示
    updateAllProductCounts() {
        if (!this.modal) return;

        // 获取所有商品项
        const productItems = this.modal.querySelectorAll('.dish-item');
        productItems.forEach(item => {
            const productId = item.dataset.productId;
            const selectedProduct = this.selectedProducts.find(p => p.id === productId);
            const count = selectedProduct ? selectedProduct.quantity : 0;
            const countNum = item.querySelector('.count-num');
            if (countNum) {
                countNum.textContent = count;
                countNum.dataset.count = count;
            }
        });
    }

    // 显示模态框
    show() {
        if (this.modal) {
            this.modal.classList.remove('hidden');
            this.modal.classList.add('opacity-100');
            this.modal.classList.add('translate-y-0');
            this.isOpen = true;
        }
    }

    // 隐藏模态框
    hide() {
        if (this.modal) {
            this.modal.classList.add('hidden');
            this.modal.classList.remove('opacity-100');
            this.modal.classList.remove('translate-y-0');
            this.isOpen = false;
        }
    }

    // 更新房间号显示
    updateRoomNumber(roomName = this.roomCode) {
        if (!roomName) return;
        this.roomCode = roomName;
        const roomNumberElement = this.modal?.querySelector('#roomNumber');
        if (roomNumberElement) {
            roomNumberElement.textContent = `${this.getText('room')}${roomName}`;
        }
    }

    // 更新模态框内容
    updateModalContent() {
        if (this.modal) {
            // 更新房间号
            this.updateRoomNumber();

            // 更新分类内容
            this.updateDrinksContent();

            // 更新商品内容
            this.updateProductsContent(this.selectedProducts, this.activeCategory);
        }
    }

    // 更新已选商品数量
    updateSelectedProductQuantity(product, quantityChange) {
        const productId = product.id || '';
        // 查找是否已存在该商品
        const existingProductIndex = this.selectedProducts.findIndex(item => {
            const itemId = item.id || '';
            return itemId === productId;
        });

        if (existingProductIndex >= 0) {
            // 如果商品已存在，更新数量
            this.selectedProducts[existingProductIndex].quantity += quantityChange;
            // 如果数量为0或负数，移除该商品
            if (this.selectedProducts[existingProductIndex].quantity <= 0) {
                this.selectedProducts.splice(existingProductIndex, 1);
            }
        } else if (quantityChange > 0) {
            // 如果是新商品且数量增加，添加到列表
            // 确保价格存在且为有效数字，否则使用默认值0
            const price = (typeof product.price === 'number' && !isNaN(product.price)) ? product.price : 0;
            const productName = product.name || '未知商品';

            // 创建要添加到已选商品列表的商品对象
            const selectedItem = {
                id: productId,
                name: productName,
                price: price,
                unit: product.unit,
                quantity: quantityChange
            };

            // 如果商品有point_type字段，添加到selectedItem中
            if (product.point_type !== undefined) {
                selectedItem.point_type = product.point_type;
            }

            // 如果商品有taste字段，添加到selectedItem中
            if (product.taste !== undefined) {
                selectedItem.taste = product.taste;
            }

            // 如果商品有套餐信息，添加到selectedItem中
            if (isNonEmptyArray(product.combo)) {
                selectedItem.combo = product.combo;
            }

            this.selectedProducts.push(selectedItem);
        }
        // 更新徽标显示
        this.updateSelectedBadge();

        // 同步更新主模态框中商品的数量显示
        this.updateMainModalProductCount(productId,
            existingProductIndex >= 0 ?
                Math.max(0, this.selectedProducts[existingProductIndex]?.quantity || 0) :
                quantityChange > 0 ? quantityChange : 0);
    }

    // 更新主模态框中商品的数量显示
    updateMainModalProductCount(productId, count) {
        // 查找主模态框中对应的商品项
        // 确保使用正确的商品ID进行查找
        const productItems = this.modal?.querySelectorAll('.dish-item');
        let productItem = null;

        if (productItems) {
            for (let i = 0; i < productItems.length; i++) {
                const item = productItems[i];
                const itemId = item.dataset.productId || '';
                if (itemId === productId) {
                    productItem = item;
                    break;
                }
            }
        }

        if (productItem) {
            const countNum = productItem.querySelector('.count-num');
            const minusBtn = productItem.querySelector('.minus-btn');

            if (countNum) {
                countNum.textContent = count;
                countNum.dataset.count = count;
            }

            if (minusBtn) {
                minusBtn.disabled = count === 0;
            }
        }
    }

    // 更新已选商品徽标
    updateSelectedBadge() {
        const badge = this.modal?.querySelector('#selectedBadge');
        if (badge) {
            // 计算总数量
            const totalCount = this.selectedProducts.reduce((sum, item) => sum + item.quantity, 0);

            if (totalCount > 0) {
                badge.textContent = totalCount;
                badge.classList.remove('hidden');

                // 移除所有现有的点击事件监听器，然后重新绑定
                const clone = badge.cloneNode(true);
                badge.parentNode.replaceChild(clone, badge);
                clone.addEventListener('click', () => {
                    this.showSelectedProducts();
                });
            } else {
                badge.textContent = '0';
                badge.classList.add('hidden');
            }
        }

        // 同时更新所有商品的数量显示
        this.updateAllProductCounts();
    }

    // 显示已选商品列表
    showSelectedProducts() {
        // 过滤出数量大于0的商品
        const validProducts = this.selectedProducts.filter(product => product.quantity > 0);

        // 检查是否有已选商品
        if (validProducts.length === 0) {
            this.showToast('暂无已选商品');
            return;
        }

        // 检查模态框是否已经存在，如果存在则先移除
        const existingModal = document.getElementById('selectedProductsModal');
        if (existingModal) {
            existingModal.remove();
        }

        // 创建已选商品列表模态框 (设置足够高的z-index确保显示在分类商品之上)
        const selectedModal = document.createElement('div');
        selectedModal.id = 'selectedProductsModal';
        // 移除与CSS样式冲突的class，确保z-index生效
        selectedModal.className = 'fixed inset-0 bg-black/50 z-[10002] hidden opacity-0';

        // 创建模态框内容 - 与酒水页面样式保持一致
        const modalContent = document.createElement('div');
        // 移除固定高度和硬编码的bottom值，使用动态位置计算
        modalContent.className = 'fixed left-0 right-0 bg-white dark:bg-gray-800 rounded-t-2xl flex flex-col transform translate-y-full transition-transform duration-300';
        modalContent.id = 'selectedProductsModalContent';

        // 添加头部 - 与酒水页面样式保持一致
        const header = document.createElement('div');
        header.className = 'p-3 sm:p-4 flex items-center justify-between border-b border-gray-200 dark:border-gray-700 z-10';
        header.innerHTML = `
            <h3 class="text-sm sm:text-base font-bold text-gray-800 dark:text-white">已选商品 (${validProducts.length})</h3>
            <h3 class="text-sm sm:text-base font-bold text-gray-800 dark:text-white max-w-[40%] truncate" id="selectedRoomNumber">${this.getText('room')} ${this.getText('loading')}</h3>
            <button id="closeSelectedModal" class="btn-touch p-1 sm:p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors" title="${this.getText('close')}">
                <i class="fa fa-times text-base sm:text-lg"></i>
            </button>
        `;

        // 添加内容区域 - 左侧付款方式 + 右侧商品列表和总计 - 与酒水页面样式保持一致
        const content = document.createElement('div');
        content.className = 'flex-1 flex overflow-hidden';

        // 左侧付款方式区域 - 与酒水页面样式保持一致
        const paymentMethodArea = document.createElement('div');
        paymentMethodArea.className = 'w-1/4 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 order-0 flex flex-col md:w-1/4 lg:w-1/5 transition-all duration-300';

        // 添加付款方式标题 - 与酒水页面样式保持一致
        const paymentMethodTitle = document.createElement('div');
        paymentMethodTitle.className = 'category-title p-4 border-b border-gray-200 dark:border-gray-700';
        paymentMethodTitle.innerHTML = `
            <h4 class="text-base font-bold text-gray-800 dark:text-white">付款方式</h4>
        `;
        paymentMethodArea.appendChild(paymentMethodTitle);

        // 计算总价
        let totalPrice = 0;

        // 遍历所有有效商品计算总价
        validProducts.forEach(product => {
            // 确保价格存在且为有效数字，否则使用默认值0
            const price = (typeof product.price === 'number' && !isNaN(product.price)) ? product.price : 0;
            const quantity = product.quantity || 0;
            totalPrice += price * quantity;
        });

        // 右侧商品列表区域 - 与酒水页面样式保持一致
        const productListArea = document.createElement('div');
        productListArea.className = 'w-3/4 bg-white dark:bg-gray-800 order-1 flex flex-col md:w-3/4 lg:w-4/5 transition-all duration-300';

        // 添加商品列表标题 - 与酒水页面样式保持一致，包含总计信息
        const productListTitle = document.createElement('div');
        productListTitle.className = 'product-title p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center';
        productListTitle.innerHTML = `
            <h4 class="text-base font-bold text-gray-800 dark:text-white">已选商品</h4>
            <div class="font-bold text-lg">总计: ¥${totalPrice.toFixed(2)}</div>
        `;
        productListArea.appendChild(productListTitle);

        // 商品列表滚动区域 - 与酒水页面样式保持一致
        const productListContainer = document.createElement('div');
        productListContainer.className = 'flex-1 overflow-y-auto p-2 sm:p-4 high-performance-scroll';

        // 创建商品列表
        const productList = document.createElement('div');
        productList.className = 'space-y-4';

        // 添加每个商品 - 使用与酒水页面相同的样式
        validProducts.forEach(product => {
            // 确保价格存在且为有效数字，否则使用默认值0
            const price = (typeof product.price === 'number' && !isNaN(product.price)) ? product.price : 0;
            // 确保商品名称存在，否则使用默认值
            const productName = product.name || product.Name || '未知商品';
            const subtotal = price * product.quantity;

            // 创建商品项 - 使用与酒水页面相同的样式
            const productItem = document.createElement('div');
            productItem.className = 'dish-item flex items-center justify-between p-3'; // 使用与酒水页面相同的类名，并添加flex布局
            productItem.innerHTML = `
                <div class="dish-info flex-1">
                    <div class="dish-name font-medium">${productName}</div>
                    <div class="dish-price text-sm text-red-500">¥${price.toFixed(2)}</div>
                </div>
                <div class="count-control flex items-center space-x-3 mr-4"> <!-- 增加间距 -->
                    <button class="count-btn minus-btn w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-white flex items-center justify-center" data-product-id="${product.id || ''}" data-action="decrease">-</button>
                    <span class="count-num text-lg font-bold">${product.quantity}</span>
                    <button class="count-btn plus-btn w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-white flex items-center justify-center" data-product-id="${product.id || ''}" data-action="increase">+</button>
                </div>
                <div class="dish-price font-bold text-lg">¥${subtotal.toFixed(2)}</div>
            `;

            // 绑定加减按钮事件
            const minusBtn = productItem.querySelector('.minus-btn');
            const plusBtn = productItem.querySelector('.plus-btn');
            const countNum = productItem.querySelector('.count-num');
            const subtotalElement = productItem.querySelector('.dish-price.font-bold');

            minusBtn.addEventListener('click', () => {
                // 更新商品数量
                this.updateSelectedProductQuantity(product, -1);

                // 更新当前商品的数量显示
                const updatedProduct = this.selectedProducts.find(p => p.id === product.id);
                const newQuantity = updatedProduct ? updatedProduct.quantity : 0;

                // 更新数量显示
                if (countNum) {
                    countNum.textContent = newQuantity;
                }

                // 更新小计显示
                const newSubtotal = price * newQuantity;
                if (subtotalElement) {
                    subtotalElement.textContent = `¥${newSubtotal.toFixed(2)}`;
                }

                // 更新总计
                this.updateSelectedProductsTotal();

                // 如果数量为0，移除商品项
                if (newQuantity <= 0) {
                    productItem.remove();
                }
            });

            plusBtn.addEventListener('click', () => {
                // 更新商品数量
                this.updateSelectedProductQuantity(product, 1);

                // 更新当前商品的数量显示
                const updatedProduct = this.selectedProducts.find(p => p.id === product.id);
                const newQuantity = updatedProduct ? updatedProduct.quantity : 0;

                // 更新数量显示
                if (countNum) {
                    countNum.textContent = newQuantity;
                }

                // 更新小计显示
                const newSubtotal = price * newQuantity;
                if (subtotalElement) {
                    subtotalElement.textContent = `¥${newSubtotal.toFixed(2)}`;
                }

                // 更新总计
                this.updateSelectedProductsTotal();
            });

            productList.appendChild(productItem);
        });

        productListContainer.appendChild(productList);
        productListArea.appendChild(productListContainer);

        // 付款方式内容区域 - 与酒水页面样式保持一致
        const paymentMethodContent = document.createElement('div');
        paymentMethodContent.className = 'flex-1 p-1 sm:p-2 overflow-y-auto high-performance-scroll';
        paymentMethodContent.style.height = '100%';
        paymentMethodContent.style.minHeight = '0';
        paymentMethodContent.style.maxHeight = 'none';

        // 添加付款方式选择 - 与酒水页面样式保持一致
        const paymentMethod = document.createElement('div');
        paymentMethod.className = 'pt-4';
        paymentMethod.innerHTML = `
            <div class="grid grid-cols-1 gap-2">
                <button class="payment-method-btn bg-gray-100 dark:bg-gray-700 hover:bg-blue-100 dark:hover:bg-blue-900 text-gray-800 dark:text-white py-2 px-3 rounded text-sm" data-mode="0">
                    刷卡支付
                </button>
                <button class="payment-method-btn bg-gray-100 dark:bg-gray-700 hover:bg-blue-100 dark:hover:bg-blue-900 text-gray-800 dark:text-white py-2 px-3 rounded text-sm" data-mode="1">
                    账号密码
                </button>
                <button class="payment-method-btn bg-gray-100 dark:bg-gray-700 hover:bg-blue-100 dark:hover:bg-blue-900 text-gray-800 dark:text-white py-2 px-3 rounded text-sm" data-mode="2">
                    在线支付
                </button>
            </div>
        `;
        paymentMethodContent.appendChild(paymentMethod);
        paymentMethodArea.appendChild(paymentMethodContent);

        // 组装内容区域
        content.appendChild(paymentMethodArea);
        content.appendChild(productListArea);

        // 组装模态框
        modalContent.appendChild(header);
        modalContent.appendChild(content);
        selectedModal.appendChild(modalContent);

        // 添加到页面body末尾，确保z-index生效
        document.body.appendChild(selectedModal);

        // 存储 resize 事件处理器引用，以便清理
        let resizeTimer = null;
        const resizeHandler = () => {
            // 窗口大小变化时，更新导航栏高度缓存并重新计算位置
            BottomPanelPositionManager.updateNavHeightCache();
            BottomPanelPositionManager.updatePanelPosition(modalContent, 4, true);
        };
        const debouncedResizeHandler = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(resizeHandler, 150);
        };

        // 清理事件监听器的函数
        const cleanupResizeListener = () => {
            window.removeEventListener('resize', debouncedResizeHandler);
            if (resizeTimer) {
                clearTimeout(resizeTimer);
                resizeTimer = null;
            }
        };

        // 监听窗口大小变化，自动更新模态框位置和高度
        window.addEventListener('resize', debouncedResizeHandler);

        // 绑定关闭按钮事件
        const closeBtn = selectedModal.querySelector('#closeSelectedModal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                cleanupResizeListener();
                selectedModal.remove();
            });
        }

        // 绑定付款方式按钮事件
        const paymentButtons = selectedModal.querySelectorAll('.payment-method-btn');
        paymentButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const paymentMode = e.currentTarget.dataset.mode;
                // 如果是刷卡支付或账号密码支付，显示输入模态框
                if (paymentMode === '0' || paymentMode === '1') {
                    this.showPaymentInputModal(paymentMode, (card, password) => {
                        this.submitOrderWithCredentials(paymentMode, card, password);
                    });
                } else if (paymentMode === '2') {
                    // 在线支付直接提交
                    this.submitOrder(paymentMode);
                }
            });
        });

        // 显示模态框 - 简化显示逻辑，确保z-index生效
        // 立即显示模态框，避免复杂的过渡效果影响堆叠顺序
        selectedModal.classList.remove('hidden');
        selectedModal.classList.add('opacity-100');

        // 使用 BottomPanelPositionManager 动态计算模态框位置，确保显示在底部导航栏上方
        // 直接使用存储的导航栏高度，简单准确
        requestAnimationFrame(() => {
            // 如果缓存不存在，会自动计算并存储
            BottomPanelPositionManager.updatePanelPosition(modalContent, 4, false);
            // 动画效果：从底部滑入
            modalContent.classList.remove('translate-y-full');
        });
    }

    // 更新已选商品总计
    updateSelectedProductsTotal() {
        // 计算总价
        let totalPrice = 0;

        // 遍历所有已选商品计算总价
        this.selectedProducts.forEach(product => {
            // 确保价格存在且为有效数字，否则使用默认值0
            const price = (typeof product.price === 'number' && !isNaN(product.price)) ? product.price : 0;
            const quantity = product.quantity || 0;
            totalPrice += price * quantity;
        });

        // 更新总计显示 - 在新的位置
        const totalElement = document.querySelector('#selectedProductsModal .product-title .font-bold.text-lg');
        if (totalElement) {
            totalElement.textContent = `总计: ¥${totalPrice.toFixed(2)}`;
        }
    }

    // 更新所有商品的数量显示
    updateAllProductCounts() {
        // 获取所有商品项
        const productItems = this.modal?.querySelectorAll('.dish-item');
        if (productItems) {
            productItems.forEach(item => {
                const productId = item.dataset.productId || '';
                const countNum = item.querySelector('.count-num');
                const minusBtn = item.querySelector('.minus-btn');

                // 查找该商品在已选商品列表中的数量
                const selectedProduct = this.selectedProducts.find(product => {
                    return product.id === productId;
                });

                const count = selectedProduct ? selectedProduct.quantity : 0;

                if (countNum) {
                    countNum.textContent = count;
                    countNum.dataset.count = count;
                }

                if (minusBtn) {
                    minusBtn.disabled = count === 0;
                }
            });
        }
    }

    // 添加商品到订单
    async addToOrder(product) {
        try {
            // 检查房间状态
            if (!this.isRoomAvailable()) {
                this.showRoomStatusError();
                return;
            }

            // 创建订单商品数据
            const orderItem = {
                id: product.id || '',
                name: product.name || '未知商品',
                unit: product.unit || '个',
                price: product.price || 0,
                quantity: 1
            };

            // 显示添加成功提示
            this.showToast(`已添加 ${orderItem.name} 到订单`);

            // 触发添加成功事件，供其他组件监听
            const event = new CustomEvent('orderItemAdded', { detail: orderItem });
            document.dispatchEvent(event);
        } catch (error) {
            console.error('添加商品到订单失败:', error);
            this.showToast('添加商品失败，请重试');
        }
    }

    // 显示提示信息
    showToast(message, duration = 2000) {
        if (toastService && typeof toastService.showToast === 'function') {
            toastService.showToast(message, 'info', duration);
            return;
        }

        // Fallback：在极端情况下仍使用本地样式展示
        let fallbackToast = document.getElementById('orderToast');
        if (fallbackToast) {
            fallbackToast.remove();
        }

        fallbackToast = document.createElement('div');
        fallbackToast.id = 'orderToast';
        fallbackToast.className = 'fixed top-16 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-6 py-3 rounded-lg z-[100] opacity-0 transition-opacity duration-300 text-lg font-semibold shadow-xl';
        fallbackToast.textContent = message;

        document.body.appendChild(fallbackToast);

        requestAnimationFrame(() => {
            fallbackToast.classList.add('opacity-95');
        });

        setTimeout(() => {
            fallbackToast.classList.remove('opacity-95');
            setTimeout(() => {
                fallbackToast.remove();
            }, 300);
        }, duration);
    }

    // 更新房间号显示
    updateRoomNumber(roomName = null) {
        // 如果提供了房间名，则更新房间号
        if (roomName) {
            this.roomCode = roomName;
        }

        // 更新房间号显示
        const roomNumberElement = this.modal?.querySelector('#roomNumber');
        if (roomNumberElement) {
            console.log('Updating room number display to:', `${this.getText('room')} ${this.roomCode}`);
            roomNumberElement.textContent = `${this.getText('room')} ${this.roomCode}`;
        } else {
        }

        // 同时更新已选商品模态框中的房间号显示
        const selectedRoomNumberElement = document.querySelector('#selectedProductsModal #selectedRoomNumber');
        if (selectedRoomNumberElement) {
            selectedRoomNumberElement.textContent = `${this.getText('room')} ${this.roomCode}`;
        }
    }

    updateRoomNumberFromWebSocket() {
        if (window.WebSocketClient) {
            const globalState = window.WebSocketClient.getGlobalState?.();
            const initialState = globalState?.initialState;
            const roomName = this.getRoomDisplayName(initialState || {});
            if (roomName) {
                this.updateRoomNumber(roomName);
            }
        }
    }

    getRoomDisplayName(stateData = {}) {
        return stateData.roomName || stateData.name || stateData.roomId || '';
    }

    getRoomStatusText(status) {
        const normalized = Number(status);
        if (normalized === 1) return '消费中';
        if (normalized === 0) return '空闲';
        if (normalized === 2) return '预订';
        if (normalized === 3) return '维修';
        if (normalized === -1) return '未知';
        return String(status ?? '未知');
    }

    show() {

        // 检查房间状态
        if (!this.isRoomAvailable()) {
            this.showRoomStatusError();
            return;
        }

        if (!this.modal) {
            this.init();
        } else {
        }

        // 每次打开酒水页面时清空已选商品
        this.selectedProducts = [];

        // 更新徽标显示
        this.updateSelectedBadge();

        // 更新所有商品的数量显示
        this.updateAllProductCounts();

        // 显示模态框
        this.modal.classList.remove('hidden');

        // 单次强制重排确保CSS过渡生效
        this.modal.offsetHeight;

        // 立即触发过渡效果
        this.modal.classList.remove('opacity-0');
        this.modal.classList.add('opacity-100');
        const modalContent = this.modal.querySelector('#orderModalContent');
        if (modalContent) {
            modalContent.classList.remove('translate-y-full');
        }

        // 标记为已打开
        this.isOpen = true;
        // 高度由CSS自动计算，无需resize事件监听

        // 获取酒水分类数据
        this.fetchDrinksCategories();

        // 更新房间号显示
        this.updateRoomNumberFromWebSocket();
        this.updateRoomNumber();

        // 触发模态框打开事件
        const event = new CustomEvent('orderModalOpened');
        document.dispatchEvent(event);
    }

    // 隐藏模态框
    hide() {
        try { window.flowMetrics?.mark('orderModal.hide.start', { isOpen: this.isOpen }); } catch (_) { }
        if (!this.modal) {
            return;
        }
        // 添加过渡效果
        this.modal.classList.remove('opacity-100');
        this.modal.classList.add('opacity-0');
        const modalContent = this.modal.querySelector('#orderModalContent');
        if (modalContent) {
            modalContent.classList.add('translate-y-full');
        } else {
        }

        // 延迟隐藏，等待过渡效果完成
        setTimeout(() => {
            this.modal.classList.add('hidden');
        }, 300);

        // 标记为已关闭
        this.isOpen = false;
        // 清空已选商品
        this.selectedProducts = [];

        // 更新徽标显示
        this.updateSelectedBadge();

        // 更新所有商品的数量显示
        this.updateAllProductCounts();

        // 触发模态框关闭事件
        const event = new CustomEvent('orderModalClosed');
        document.dispatchEvent(event);
        try { window.flowMetrics?.mark('orderModal.hide.done'); } catch (_) { }
    }

    // 移除resize事件处理器，高度由CSS自动计算，无需JavaScript干预

    // 更新模态框内容（用于语言切换）
    updateModalContent() {
        // 更新标题
        const title = this.modal.querySelector('h3');
        if (title) {
            title.textContent = this.getText('order');
        }

        // 更新房间号
        this.updateRoomNumber();

        // 更新关闭按钮提示
        const closeBtn = this.modal.querySelector('#closeOrderModal');
        if (closeBtn) {
            closeBtn.title = this.getText('close');
        }
    }

    // 显示输入卡号/账号和密码的模态框
    showPaymentInputModal(paymentMode, onSubmit) {
        // 检查房间状态
        if (!this.isRoomAvailable()) {
            this.showRoomStatusError();
            return;
        }
        // 创建模态框元素
        const inputModal = document.createElement('div');
        inputModal.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center';
        inputModal.id = 'paymentInputModal';

        // 创建模态框内容
        const modalContent = document.createElement('div');
        modalContent.className = 'bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl';

        // 添加标题
        const header = document.createElement('div');
        header.className = 'flex items-center justify-between mb-4';
        header.innerHTML = `
            <h3 class="text-lg font-bold text-gray-800 dark:text-white">
                ${paymentMode === '0' ? '刷卡支付' : '账号密码支付'}
            </h3>
            <button id="closePaymentInputModal" class="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <i class="fas fa-times"></i>
            </button>
        `;

        // 添加输入表单
        const form = document.createElement('div');
        form.innerHTML = `
            <div class="mb-4">
                <label class="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">
                    ${paymentMode === '0' ? '卡号' : '账号'}
                </label>
                <input type="password" id="passwordInput" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white" placeholder="请输入密码">
            </div>
            <div class="flex justify-end gap-2">
                <button id="cancelPaymentInput" class="px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-white rounded-lg hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors">
                    取消
                </button>
                <button id="submitPaymentInput" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    确认
                </button>
            </div>
        `;

        // 组装模态框
        modalContent.appendChild(header);
        modalContent.appendChild(form);
        inputModal.appendChild(modalContent);

        // 添加到页面
        document.body.appendChild(inputModal);
        // 绑定事件
        const closeBtn = inputModal.querySelector('#closePaymentInputModal');
        const cancelBtn = inputModal.querySelector('#cancelPaymentInput');
        const submitBtn = inputModal.querySelector('#submitPaymentInput');
        const cardInput = inputModal.querySelector('#cardInput');
        const passwordInput = inputModal.querySelector('#passwordInput');
        // 关闭模态框
        const closeInputModal = () => {
            inputModal.remove();
        };

        if (closeBtn) {
            closeBtn.addEventListener('click', closeInputModal);
        } else {
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeInputModal);
        } else {
        }

        // 提交表单
        if (submitBtn) {
            submitBtn.addEventListener('click', () => {
                const card = cardInput ? cardInput.value.trim() : '';
                const password = passwordInput ? passwordInput.value.trim() : '';
                if (!card) {
                    this.showToast(paymentMode === '0' ? '请输入卡号' : '请输入账号');
                    return;
                }

                if (!password) {
                    this.showToast('请输入密码');
                    return;
                }

                // 调用回调函数
                if (onSubmit && typeof onSubmit === 'function') {
                    onSubmit(card, password);
                } else {
                }

                // 关闭模态框
                closeInputModal();
            });
        } else {
        }

        // 聚焦到第一个输入框
        if (cardInput) {
            cardInput.focus();
        }
    }

    // 提交订单 - 使用CashierService
    async submitOrder(paymentMode) {
        try {
            // 检查房间状态
            if (!this.isRoomAvailable()) {
                this.showRoomStatusError();
                return;
            }
            // 过滤出数量大于0的商品
            const validProducts = this.selectedProducts.filter(product => product.quantity > 0);

            // 检查是否有已选商品
            if (validProducts.length === 0) {
                this.showToast('请先选择商品');
                return;
            }

            // 检查是否选择了付款方式
            if (paymentMode === undefined || paymentMode === null) {
                this.showToast('请选择付款方式');
                return;
            }

            // 显示加载状态
            this.showToast('正在提交订单...');

            // 根据付款方式设置参数
            let orderData = {
                roomId: this.roomCode,
                card: '',
                password: '',
                verify_mode: 2, // 默认在线支付
                items: validProducts.map(item => ({
                    productId: item.id || '',
                    quantity: item.quantity || 1
                }))
            };

            // 根据不同的付款方式设置相应的参数
            switch (paymentMode) {
                case '0': // 刷卡支付
                    // 注意：刷卡支付应该通过showPaymentInputModal处理，不应该直接调用此方法
                    // 但如果直接调用此方法，我们也应该处理
                    orderData.card = '1';
                    orderData.password = '1'; // verify_mode=0时，password应和card一样
                    orderData.verify_mode = 0; // 使用整数而不是字符串
                    break;
                case '1': // 账号密码
                    // 注意：账号密码支付应该通过showPaymentInputModal处理，不应该直接调用此方法
                    // 但如果直接调用此方法，我们也应该处理
                    orderData.card = '1';
                    orderData.password = '1';
                    orderData.verify_mode = 1; // 使用整数而不是字符串
                    break;
                case '2': // 在线支付
                    orderData.card = '1';
                    orderData.password = ''; // verify_mode=2时，password应为空值
                    orderData.verify_mode = 2; // 使用整数而不是字符串
                    break;
                default:
                    this.showToast('不支持的付款方式');
                    return;
            }

            // 如果是免费酒水分类，添加type参数
            if (this.categoryType === '1') {
                orderData.type = '1'; // 使用字符串而不是整数
            }
            // 调用CashierService提交订单
            const result = await cashierService.submitOrder(orderData);
            // 检查响应是否存在
            if (!result) {
                this.showToast('服务器无响应，请稍后重试');
                return;
            }

            if (result.code === 0) {
                // 订单提交成功
                // 检查purchase_result状态，确保订单真正成功
                let isPurchaseSuccessful = true;
                let purchaseInfo = '';

                // 首先检查data中是否有status字段（用于二维码支付）
                if (result.data && result.data.status !== undefined) {
                    // status为0表示失败，status为1表示成功
                    if (result.data.status === 0) {
                        isPurchaseSuccessful = false;
                        purchaseInfo = result.data.info || result.msg || result.tips || '订单处理失败';
                    } else if (result.data.status === 1) {
                        purchaseInfo = result.data.info || result.msg || result.tips || '订单提交成功';
                    }
                }
                // 如果没有status字段，再检查purchase_result中的status字段
                else if (result.data && result.data.purchase_result) {
                    // 检查purchase_result中的status字段
                    if (result.data.purchase_result.status === 0) {
                        // status为0表示失败
                        isPurchaseSuccessful = false;
                        purchaseInfo = result.data.purchase_result.info || '订单处理失败';
                    } else if (result.data.purchase_result.status === 1) {
                        // status为1表示成功
                        purchaseInfo = result.data.purchase_result.info || '订单提交成功';
                    }
                }
                // 如果都没有，检查msg和tips字段是否包含失败信息
                else if ((result.msg && result.msg.includes('失败')) || (result.tips && result.tips.includes('失败'))) {
                    isPurchaseSuccessful = false;
                    purchaseInfo = result.msg || result.tips || '订单处理失败';
                }

                if (isPurchaseSuccessful) {
                    // 检查是否为在线支付并返回了二维码
                    if (result.data && result.data.qrCode) {
                        // 显示二维码模态框
                        this.showQRCodeModal(result.data.qrCode);
                    } else {
                        // 真正的订单提交成功
                        // 检查是否有返回订单ID，如果没有则显示通用成功消息
                        if (result.data && result.data.orderId) {
                            this.showToast(`订单提交成功，订单号: ${result.data.orderId}`);
                        } else {
                            this.showToast(purchaseInfo || '订单提交成功');
                        }

                        // 清空已选商品
                        this.selectedProducts = [];

                        // 更新徽标显示
                        this.updateSelectedBadge();

                        // 更新所有商品的数量显示
                        this.updateAllProductCounts();

                        // 触发订单提交成功事件
                        const event = new CustomEvent('orderSubmitted', {
                            detail: {
                                orderId: result.data && result.data.orderId ? result.data.orderId : null,
                                products: validProducts
                            }
                        });
                        document.dispatchEvent(event);
                    }
                } else {
                    // 虽然返回code为0，但订单实际处理失败
                    this.showToast(`订单提交失败: ${purchaseInfo}`);
                    console.error('订单处理失败详情:', result);
                    // 注意：不要关闭页面，让用户可以看到错误信息并重新尝试
                }
            } else {
                // 订单提交失败
                // 提供更详细的错误信息，包括服务器返回的所有相关信息
                let errorMsg = '订单提交失败';

                // 尝试获取服务器返回的错误信息
                if (result.msg) {
                    errorMsg += `: ${result.msg}`;
                } else if (result.message) {
                    errorMsg += `: ${result.message}`;
                } else if (result.data && result.data.info) {
                    errorMsg += `: ${result.data.info}`;
                } else if (result.data && result.data.error) {
                    errorMsg += `: ${result.data.error}`;
                } else {
                    errorMsg += ': 未知错误';
                }

                // 如果有错误代码，也一并显示
                if (result.code !== undefined) {
                    errorMsg += ` (错误代码: ${result.code})`;
                }

                this.showToast(errorMsg);
                console.error('订单提交失败详情:', result);
                // 注意：不要关闭页面，让用户可以看到错误信息并重新尝试
            }
        } catch (error) {
            console.error('提交订单异常:', error);
            // 根据错误类型提供不同的提示信息
            let errorMsg = '订单提交失败';

            if (error.message && error.message.includes('网络请求失败')) {
                errorMsg = '网络连接失败，请检查网络或稍后重试';
            } else if (error.message) {
                errorMsg += `: ${error.message}`;
            }

            this.showToast(errorMsg);
            // 注意：不要关闭页面，让用户可以看到错误信息并重新尝试
        }
    }

    // 带凭证提交订单
    async submitOrderWithCredentials(paymentMode, card, password) {
        try {
            // 检查房间状态
            if (!this.isRoomAvailable()) {
                this.showRoomStatusError();
                return;
            }
            // 过滤出数量大于0的商品
            const validProducts = this.selectedProducts.filter(product => product.quantity > 0);

            // 检查是否有已选商品
            if (validProducts.length === 0) {
                this.showToast('请先选择商品');
                return;
            }

            // 检查是否选择了付款方式
            if (paymentMode === undefined || paymentMode === null) {
                this.showToast('请选择付款方式');
                return;
            }

            // 显示加载状态
            this.showToast('正在提交订单...');

            // 根据付款方式设置参数
            let orderData = {
                roomId: this.roomCode,
                card: card,
                password: password,
                verify_mode: paymentMode === '0' ? 0 : 1, // 刷卡支付为0，账号密码为1
                items: validProducts.map(item => ({
                    productId: item.id || '',
                    quantity: item.quantity || 1
                }))
            };

            // 根据不同的付款方式设置相应的参数
            // 注意：verify_mode已经在上面设置过了，这里不需要重复设置
            // 确保verify_mode是整数类型
            orderData.verify_mode = parseInt(orderData.verify_mode);

            // 根据verify_mode的值调整password字段
            if (orderData.verify_mode === 0) {
                // verify_mode=0时，password应和card一样
                orderData.password = orderData.card;
            } else if (orderData.verify_mode === 2) {
                // verify_mode=2时，password应为空值
                orderData.password = '';
            }
            // verify_mode=1时，password保持用户输入的值

            // 如果是免费酒水分类，添加type参数
            if (this.categoryType === '1') {
                orderData.type = '1'; // 使用字符串而不是整数
            }
            // 调用CashierService提交订单
            const result = await cashierService.submitOrder(orderData);
            // 检查响应是否存在
            if (!result) {
                this.showToast('服务器无响应，请稍后重试');
                return;
            }

            if (result.code === 0) {
                // 订单提交成功
                // 检查purchase_result状态，确保订单真正成功
                let isPurchaseSuccessful = true;
                let purchaseInfo = '';

                // 首先检查data中是否有status字段（用于二维码支付）
                if (result.data && result.data.status !== undefined) {
                    // status为0表示失败，status为1表示成功
                    if (result.data.status === 0) {
                        isPurchaseSuccessful = false;
                        purchaseInfo = result.data.info || result.msg || result.tips || '订单处理失败';
                    } else if (result.data.status === 1) {
                        purchaseInfo = result.data.info || result.msg || result.tips || '订单提交成功';
                    }
                }
                // 如果没有status字段，再检查purchase_result中的status字段
                else if (result.data && result.data.purchase_result) {
                    // 检查purchase_result中的status字段
                    if (result.data.purchase_result.status === 0) {
                        // status为0表示失败
                        isPurchaseSuccessful = false;
                        purchaseInfo = result.data.purchase_result.info || '订单处理失败';
                    } else if (result.data.purchase_result.status === 1) {
                        // status为1表示成功
                        purchaseInfo = result.data.purchase_result.info || '订单提交成功';
                    }
                }
                // 如果都没有，检查msg和tips字段是否包含失败信息
                else if ((result.msg && result.msg.includes('失败')) || (result.tips && result.tips.includes('失败'))) {
                    isPurchaseSuccessful = false;
                    purchaseInfo = result.msg || result.tips || '订单处理失败';
                }

                if (isPurchaseSuccessful) {
                    // 检查是否为在线支付并返回了二维码
                    if (result.data && result.data.qrCode) {
                        // 显示二维码模态框
                        this.showQRCodeModal(result.data.qrCode);
                    } else {
                        // 真正的订单提交成功
                        // 检查是否有返回订单ID，如果没有则显示通用成功消息
                        if (result.data && result.data.orderId) {
                            this.showToast(`订单提交成功，订单号: ${result.data.orderId}`);
                        } else {
                            this.showToast(purchaseInfo || '订单提交成功');
                        }

                        // 清空已选商品
                        this.selectedProducts = [];

                        // 更新徽标显示
                        this.updateSelectedBadge();

                        // 更新所有商品的数量显示
                        this.updateAllProductCounts();

                        // 关闭已选商品模态框 (submitOrderWithCredentials方法)
                        const selectedModal = document.getElementById('selectedProductsModal');
                        if (selectedModal) {
                            selectedModal.remove();
                        }

                        // 触发订单提交成功事件
                        const event = new CustomEvent('orderSubmitted', {
                            detail: {
                                orderId: result.data && result.data.orderId ? result.data.orderId : null,
                                products: validProducts
                            }
                        });
                        document.dispatchEvent(event);
                    }
                } else {
                    // 虽然返回code为0，但订单实际处理失败
                    this.showToast(`订单提交失败: ${purchaseInfo}`);
                    console.error('订单处理失败详情:', result);
                    // 注意：不要关闭页面，让用户可以看到错误信息并重新尝试
                }
            } else {
                // 订单提交失败
                // 提供更详细的错误信息，包括服务器返回的所有相关信息
                let errorMsg = '订单提交失败';

                // 尝试获取服务器返回的错误信息
                if (result.msg) {
                    errorMsg += `: ${result.msg}`;
                } else if (result.message) {
                    errorMsg += `: ${result.message}`;
                } else if (result.data && result.data.info) {
                    errorMsg += `: ${result.data.info}`;
                } else if (result.data && result.data.error) {
                    errorMsg += `: ${result.data.error}`;
                } else {
                    errorMsg += ': 未知错误';
                }

                // 如果有错误代码，也一并显示
                if (result.code !== undefined) {
                    errorMsg += ` (错误代码: ${result.code})`;
                }

                this.showToast(errorMsg);
                console.error('订单提交失败详情:', result);
                // 注意：不要关闭页面，让用户可以看到错误信息并重新尝试
            }
        } catch (error) {
            console.error('提交订单异常:', error);
            // 根据错误类型提供不同的提示信息
            let errorMsg = '订单提交失败';

            if (error.message && error.message.includes('网络请求失败')) {
                errorMsg = '网络连接失败，请检查网络或稍后重试';
            } else if (error.message) {
                errorMsg += `: ${error.message}`;
            }

            this.showToast(errorMsg);
            // 注意：不要关闭页面，让用户可以看到错误信息并重新尝试
        }
    }

    // 显示二维码模态框
    showQRCodeModal(qrCodeData) {
        // 检查房间状态
        if (!this.isRoomAvailable()) {
            this.showRoomStatusError();
            return;
        }

        // 创建模态框元素
        const qrModal = document.createElement('div');
        qrModal.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center';
        qrModal.id = 'qrCodeModal';

        // 创建模态框内容
        const modalContent = document.createElement('div');
        modalContent.className = 'bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl';

        // 添加标题
        const header = document.createElement('div');
        header.className = 'flex items-center justify-between mb-4';
        header.innerHTML = `
            <h3 class="text-lg font-bold text-gray-800 dark:text-white">
                二维码支付
            </h3>
            <button id="closeQRModal" class="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <i class="fas fa-times"></i>
            </button>
        `;

        // 添加二维码图像
        const qrContainer = document.createElement('div');
        qrContainer.className = 'flex justify-center mb-4';
        qrContainer.innerHTML = `
            <img src="${qrCodeData}" alt="支付二维码" class="w-48 h-48">
        `;

        // 添加说明文字
        const description = document.createElement('p');
        description.className = 'text-center text-gray-600 dark:text-gray-300 mb-4';
        description.textContent = '请使用手机扫描二维码完成支付';

        // 添加确认按钮
        const confirmBtn = document.createElement('button');
        confirmBtn.id = 'confirmQRPayment';
        confirmBtn.className = 'w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors';
        confirmBtn.textContent = '我已支付';

        // 组装模态框
        modalContent.appendChild(header);
        modalContent.appendChild(qrContainer);
        modalContent.appendChild(description);
        modalContent.appendChild(confirmBtn);
        qrModal.appendChild(modalContent);

        // 添加到页面
        document.body.appendChild(qrModal);

        // 绑定关闭事件
        const closeBtn = qrModal.querySelector('#closeQRModal');
        const confirmPaymentBtn = qrModal.querySelector('#confirmQRPayment');

        const closeQRModal = () => {
            qrModal.remove();
        };

        if (closeBtn) {
            closeBtn.addEventListener('click', closeQRModal);
        }

        if (confirmPaymentBtn) {
            confirmPaymentBtn.addEventListener('click', () => {
                // 清空已选商品
                this.selectedProducts = [];

                // 更新徽标显示
                this.updateSelectedBadge();

                // 更新所有商品的数量显示
                this.updateAllProductCounts();

                // 显示支付成功消息
                this.showToast('支付成功');

                // 关闭模态框
                closeQRModal();

                // 触发订单提交成功事件
                const event = new CustomEvent('orderSubmitted', {
                    detail: {
                        orderId: null, // 二维码支付可能没有订单ID
                        products: []
                    }
                });
                document.dispatchEvent(event);
            });
        }
    }

    // 导出默认实例
    static getInstance() {
        if (!this.instance) {
            this.instance = new OrderModal();
        }
        return this.instance;
    }
}

// 创建并导出默认实例
const orderModal = new OrderModal();
export default orderModal;
