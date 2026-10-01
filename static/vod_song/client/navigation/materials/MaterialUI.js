// 延迟导入，避免循环依赖
import DomUtils from '../../utils/DomUtils.js';
import { ensureArray } from '../../utils/NormalizeUtils.js';
import { isApiOk, getApiErrorMessage } from '../../../shared/utils/ApiResponseUtils.js';
let materialService;
let apiServiceRef;
let cacheService; // 添加缓存服务
let logService; // 添加日志服务

class MaterialUI {
  constructor() {
    this.currentCategoryId = 'all';
    this.currentPage = 1;
    this.pageSize = 20;
    this.isLoading = false;
    this.hasMore = true;
    this.materialCssPromise = null;
  }

  ensureStylesLoaded() {
    if (this.materialCssPromise) {
      return this.materialCssPromise;
    }

    const existing = document.querySelector('link[data-material-css="true"]');
    if (existing) {
      this.materialCssPromise = Promise.resolve();
      return this.materialCssPromise;
    }

    this.materialCssPromise = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = './assets/styles/material.css?v=20241111';
      link.dataset.materialCss = 'true';
      link.onload = () => resolve();
      link.onerror = (event) => {
        this.materialCssPromise = null;
        const error = new Error('素材库样式加载失败');
        error.event = event;
        reject(error);
      };
      document.head.appendChild(link);
    });

    return this.materialCssPromise;
  }

  /**
   * 统一规范化素材字段
   */
  normalizeMaterial(raw) {
    const id = raw?.id || '';
    const nameRaw = raw?.name;
    const categoryRaw = raw?.categoryName;
    const cover = raw?.cover || raw?.url || '';

    const name = (nameRaw ?? '').toString().trim() || '未命名素材';
    const category = (categoryRaw ?? '').toString().trim() || '未分类';

    return { id, name, category, cover, _raw: raw };
  }

  async initServices() {
    if (!materialService || !apiServiceRef || !cacheService || !logService) {
      // 直接从各自的文件导入服务，避免循环依赖
      const [materialServiceModule, services] = await Promise.all([
        import('./MaterialService.js'),
        import('../../index.js')
      ]);
      materialService = materialServiceModule.default;
      apiServiceRef = services.apiService;
      cacheService = services.cacheService; // 初始化缓存服务
      logService = services.logService; // 初始化日志服务
    }
    this.materialService = materialService;
    this.apiService = apiServiceRef;
    this.cacheService = cacheService; // 保存缓存服务引用
    this.logService = logService; // 保存日志服务引用
  }

  // 在底部导航的素材入口中渲染简版列表
  renderNavMaterials(materials) {
    this.ensureStylesLoaded()?.catch((error) => {
      console.error('素材样式加载失败', error);
    });
    const container = document.getElementById('materialListContainer');
    if (!container) return;
    const list = ensureArray(materials);

    // 统一规范化
    const normalized = list.map(m => this.normalizeMaterial(m));

    // 使用当前选中分类标签文案作为副分类（若存在）
    const activeTab = document.querySelector('#materialCategories .category-tab.active');
    const activeCategoryText = activeTab ? activeTab.textContent.trim() : '';

    container.innerHTML = normalized.map((m) => {
      // 检查 cover 是否有效（非空且非空字符串）
      const hasValidCover = m.cover && m.cover.trim() !== '';
      return `
        <div class="material-card" data-material-id="${m.id}">
          <div class="thumb">
            ${hasValidCover ? 
              DomUtils.createImageWithFallback(m.cover, m.name) : 
              `<i class="fas fa-image"></i>`}
          </div>
          <div class="card-body">
            <h4 class="card-title">${m.name}</h4>
            <p class="card-subtitle">${activeCategoryText || m.category || ''}</p>
          </div>
        </div>
      `;
    }).join('');

    const rawById = new Map();
    normalized.forEach(n => rawById.set(n.id, n._raw));

    // 绑定播放与预览事件（使用原始数据调用播放）
    container.querySelectorAll('.material-card').forEach((card) => {
      const id = card.getAttribute('data-material-id');
      card.addEventListener('click', async () => {
        container.querySelectorAll('.material-card').forEach(c => c.classList.remove('selected', 'active'));
        card.classList.add('selected', 'active');
        const material = rawById.get(id);
        if (material) {
          await this.selectMaterial(material);
        }
      });
    });
  }

  /**
   * 创建素材模态框
   */
  async createModal() {
    logService?.info('[MaterialUI] [createModal] 开始创建模态框');
    // 检查模态框是否已存在
    const existingBackdrop = document.getElementById('materialModalBackdrop');
    if (existingBackdrop) {
      logService?.warn('[MaterialUI] [createModal] 模态框已存在，跳过创建');
      return;
    }

    logService?.info('[MaterialUI] [createModal] 加载样式');
    await this.ensureStylesLoaded();
    logService?.info('[MaterialUI] [createModal] 样式加载完成');

    logService?.info('[MaterialUI] [createModal] 初始化服务');
    await this.initServices();
    logService?.info('[MaterialUI] [createModal] 服务初始化完成');
    
    // 创建模态框背景
    const backdrop = document.createElement('div');
    backdrop.id = 'materialModalBackdrop';
    backdrop.className = 'fixed inset-0 bg-black bg-opacity-50 z-[10006] hidden modal-backdrop';
    document.body.appendChild(backdrop);

    // 创建模态框内容，参考DisplayUI.js的实现方式
    const content = document.createElement('div');
    content.id = 'materialModalContent';
    content.className = 'fixed inset-0 z-[10006] flex items-end justify-center hidden modal-content';
    content.innerHTML = `
      <div class="material-panel material-panel-container rounded-t-2xl overflow-hidden flex flex-col">
        <div class="p-4 border-b dark:border-gray-700 flex justify-between items-center bg-white dark:bg-gray-800">
          <h3 class="text-xl font-bold text-gray-800 dark:text-white">素材库</h3>
          <button id="closeMaterialModal" class="control-btn p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 modal-close-btn">
            <i class="fa fa-times text-2xl"></i>
          </button>
        </div>
        <div class="flex-1 overflow-hidden flex flex-col min-h-0 bg-white dark:bg-gray-800">
          <div id="materialCategories" class="category-tabs-container">
            <div class="category-tabs-wrapper overflow-x-auto">
              <div class="category-tabs flex gap-2 p-2"></div>
            </div>
          </div>
          <div id="materialsContainer" class="material-content grid flex-1 overflow-y-auto p-4 gap-3 w-full" data-scrollable="true">
            <div class="col-span-full text-center py-10">加载中...</div>
          </div>
          <div id="materialPagination" class="border-t dark:border-gray-700 p-4 flex justify-center items-center hidden"></div>
        </div>
      </div>
    `;
    document.body.appendChild(content);

    // 样式已提取到 assets/styles/style.css

    // 绑定关闭事件
    const closeBtn = document.getElementById('closeMaterialModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
      logService?.info('[MaterialUI] [createModal] 关闭按钮事件已绑定');
    }
    if (backdrop) {
      backdrop.addEventListener('click', () => this.closeModal());
      logService?.info('[MaterialUI] [createModal] 背景点击事件已绑定');
    }

    logService?.info('[MaterialUI] [createModal] 开始加载分类和素材');
    // 加载分类和素材
    try {
      await this.loadCategories();
      logService?.info('[MaterialUI] [createModal] 分类加载完成');
    } catch (error) {
      logService?.error('[MaterialUI] [createModal] 分类加载失败:', error);
    }
    
    try {
      await this.loadMaterials();
      logService?.info('[MaterialUI] [createModal] 素材加载完成');
    } catch (error) {
      logService?.error('[MaterialUI] [createModal] 素材加载失败:', error);
    }
    
    logService?.info('[MaterialUI] [createModal] 模态框创建完成');
  }

  /**
   * 打开素材模态框
   */
  async openModal() {
    logService?.info('[MaterialUI] ========== 开始打开素材模态框 ==========');
    try {
      logService?.info('[MaterialUI] 步骤1: 初始化服务');
      await this.initServices();
      logService?.info('[MaterialUI] 步骤1完成: 服务已初始化', {
        hasMaterialService: !!this.materialService,
        hasApiService: !!this.apiService,
        hasCacheService: !!this.cacheService,
        hasLogService: !!this.logService
      });
      
      logService?.info('[MaterialUI] 步骤2: 清除旧的素材缓存');
      // 清除旧的素材缓存，确保显示最新数据
      this.clearMaterialCache();
      logService?.info('[MaterialUI] 步骤2完成: 缓存已清除');
      
      logService?.info('[MaterialUI] 步骤3: 创建模态框DOM');
      await this.createModal();
      logService?.info('[MaterialUI] 步骤3完成: 模态框DOM已创建');
      
      const backdrop = document.getElementById('materialModalBackdrop');
      const content = document.getElementById('materialModalContent');
      logService?.info('[MaterialUI] 步骤4: 显示模态框', {
        hasBackdrop: !!backdrop,
        hasContent: !!content
      });
      
      if (backdrop) {
        backdrop.classList.remove('hidden');
      }
      if (content) {
        content.classList.remove('hidden');
      }
      
      // 在 DOM 完全渲染后再添加 active 类，确保布局计算准确
      requestAnimationFrame(() => {
        if (backdrop) {
          backdrop.classList.add('active');
        }
        if (content) {
          content.classList.add('active');
        }
        logService?.info('[MaterialUI] 步骤4完成: 模态框已显示并激活');
        logService?.info('[MaterialUI] ========== 素材模态框打开完成 ==========');
      });
    } catch (error) {
      logService?.error('[MaterialUI] 打开素材模态框失败:', error);
      throw error;
    }
  }

  /**
   * 关闭素材模态框
   */
  closeModal() {
    // 清理 IntersectionObserver，避免内存泄漏
    if (this._io) {
      this._io.disconnect();
      this._io = null;
    }
    
    const backdrop = document.getElementById('materialModalBackdrop');
    const content = document.getElementById('materialModalContent');
    if (backdrop) {
      backdrop.classList.remove('active');
      backdrop.classList.add('hidden');
    }
    if (content) {
      content.classList.remove('active');
      content.classList.add('hidden');
    }
  }

  /**
   * 清除素材相关的缓存
   */
  clearMaterialCache() {
    if (this.cacheService) {
      // 清除素材分类缓存
      this.cacheService.delete('material.categories');
      
      // 清除所有素材列表缓存
      const cacheKeys = [];
      for (let key of this.cacheService.cache.keys()) {
        if (key.startsWith('materials.list.')) {
          cacheKeys.push(key);
        }
      }
      
      cacheKeys.forEach(key => {
        this.cacheService.delete(key);
      });
    }
  }

  /**
   * 加载素材分类
   */
  async loadCategories() {
    logService?.info('[MaterialUI] [loadCategories] ========== 开始加载分类 ==========');
    try {
      logService?.info('[MaterialUI] [loadCategories] 步骤1: 初始化服务');
      await this.initServices();
      logService?.info('[MaterialUI] [loadCategories] 步骤1完成');
      
      const cacheKey = 'material.categories';
      logService?.info('[MaterialUI] [loadCategories] 步骤2: 检查缓存', { cacheKey });
      let categories = this.cacheService?.get(cacheKey);
      logService?.info('[MaterialUI] [loadCategories] 缓存结果', { 
        hasCache: !!categories, 
        cacheLength: categories?.length || 0 
      });
      let loadError = false;

      if (!categories) {
        logService?.info('[MaterialUI] [loadCategories] 步骤3: 从服务器获取分类');
        try {
          const categoryParams = { getAll: 0, filter: 1 };
          logService?.info('[MaterialUI] [loadCategories] 请求参数:', categoryParams);
          logService?.info('[MaterialUI] [loadCategories] materialService状态:', {
            exists: !!this.materialService,
            hasMethod: !!(this.materialService && typeof this.materialService.getMaterialCategories === 'function')
          });
          
          const response = await this.materialService.getMaterialCategories(categoryParams);
          logService?.info('[MaterialUI] [loadCategories] 服务器响应:', {
            response,
            responseType: typeof response,
            isArray: Array.isArray(response),
            length: Array.isArray(response) ? response.length : 'N/A'
          });
          
          categories = ensureArray(response);
          logService?.info('[MaterialUI] [loadCategories] 处理后的分类:', {
            count: categories.length,
            categories: categories.slice(0, 3) // 只显示前3个
          });
          
          if (categories.length > 0) {
            this.cacheService?.set(cacheKey, categories, 10 * 60 * 1000);
            logService?.info('[MaterialUI] [loadCategories] 分类已缓存');
          } else {
            logService?.warn('[MaterialUI] [loadCategories] 服务器返回空分类列表');
          }
        } catch (error) {
          logService?.error('[MaterialUI] [loadCategories] 获取分类失败:', {
            error,
            errorMessage: error?.message,
            errorStack: error?.stack,
            errorCode: error?.code,
            errorStatus: error?.status,
            errorResponse: error?.response
          });
          loadError = true;
          // 保存错误信息，用于在UI中显示
          this._lastCategoryError = {
            message: error?.message || '未知错误',
            code: error?.code,
            status: error?.status,
            statusText: error?.statusText
          };
          categories = [];
        }
      } else {
        logService?.info('[MaterialUI] [loadCategories] 使用缓存分类，跳过服务器请求');
      }

      // 如果服务器返回空数据，保持为空数组，不显示假的分类数据
      if (!categories || categories.length === 0) {
        logService?.warn('[MaterialUI] [loadCategories] 服务器返回空分类列表', {
          loadError,
          hasCache: !!this.cacheService?.get(cacheKey)
        });
      }

      logService?.info('[MaterialUI] [loadCategories] 步骤5: 获取DOM容器');
      const container = document.getElementById('materialCategories');
      logService?.info('[MaterialUI] [loadCategories] 容器状态:', {
        exists: !!container,
        innerHTML: container ? container.innerHTML.substring(0, 100) : 'N/A'
      });
      if (!container) {
        logService?.error('[MaterialUI] [loadCategories] 容器不存在，无法继续');
        return;
      }

      // 确保容器结构正确
      let tabsWrapper = container.querySelector('.category-tabs-wrapper');
      if (!tabsWrapper) {
        container.innerHTML = `
          <div class="category-tabs-wrapper overflow-x-auto">
            <div class="category-tabs flex gap-2 p-2"></div>
          </div>
        `;
        tabsWrapper = container.querySelector('.category-tabs-wrapper');
      }

      let tabsContainer = container.querySelector('.category-tabs');
      if (!tabsContainer) {
        const wrapper = container.querySelector('.category-tabs-wrapper') || container;
        wrapper.innerHTML = '<div class="category-tabs flex gap-2 p-2"></div>';
        tabsContainer = container.querySelector('.category-tabs');
      }

      // 显示错误消息（如果有），但不覆盖分类标签
      if (loadError) {
        // 在分类标签上方显示错误提示
        let errorMsg = container.querySelector('.category-error-message');
        if (!errorMsg) {
          errorMsg = document.createElement('div');
          errorMsg.className = 'category-error-message border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 rounded p-2 mb-2';
          
          const errorInfo = this._lastCategoryError || {};
          const errorDetails = [];
          if (errorInfo.status) {
            errorDetails.push(`HTTP ${errorInfo.status}${errorInfo.statusText ? ': ' + errorInfo.statusText : ''}`);
          }
          if (errorInfo.code !== undefined) {
            errorDetails.push(`错误代码: ${errorInfo.code}`);
          }
          if (errorInfo.message && errorInfo.message !== '未知错误') {
            errorDetails.push(errorInfo.message);
          }
          
          errorMsg.innerHTML = `
            <div class="flex justify-between items-start">
              <div class="flex-1">
                <p class="error-text text-red-500 text-sm font-semibold">素材分类加载失败</p>
                ${errorDetails.length > 0 ? `<p class="text-xs mt-1 text-red-400 font-mono">${errorDetails.join(' | ')}</p>` : ''}
                <p class="text-xs mt-1 text-gray-600 dark:text-gray-400">请检查网络连接或稍后重试</p>
              </div>
              <button id="retryCategoryBtn" class="control-btn ml-2 px-3 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded">
                重试
              </button>
            </div>
          `;
          container.insertBefore(errorMsg, tabsWrapper);
          
          // 绑定重试按钮
          const retryBtn = document.getElementById('retryCategoryBtn');
          if (retryBtn) {
            retryBtn.addEventListener('click', async () => {
              logService?.info('[MaterialUI] [loadCategories] 用户点击重试按钮');
              // 清除错误状态
              this._lastCategoryError = null;
              // 清除缓存，强制重新请求
              if (this.cacheService) {
                this.cacheService.delete('material.categories');
              }
              // 重新加载分类
              await this.loadCategories();
            });
          }
        }
      } else {
        // 移除错误消息（如果存在）
        const errorMsg = container.querySelector('.category-error-message');
        if (errorMsg) {
          errorMsg.remove();
        }
        // 清除错误状态
        this._lastCategoryError = null;
      }

      let tabsHtml = '';
      tabsHtml += `<button class="control-btn category-tab active" data-category="all">全部</button>`;
      categories.forEach(category => {
        tabsHtml += `<button class="control-btn category-tab" data-category="${category.classify}">${category.classifyName}</button>`;
      });

      // 写入分类标签
      logService?.info('[MaterialUI] [loadCategories] 步骤6: 渲染分类标签', {
        tabsHtmlLength: tabsHtml.length,
        tabsCount: (tabsHtml.match(/category-tab/g) || []).length
      });
      tabsContainer.innerHTML = tabsHtml;
      logService?.info('[MaterialUI] [loadCategories] 分类标签已写入DOM');

      logService?.info('[MaterialUI] [loadCategories] 步骤7: 绑定分类标签点击事件');
      const tabButtons = container.querySelectorAll('.category-tab');
      logService?.info('[MaterialUI] [loadCategories] 找到的标签按钮数量:', tabButtons.length);
      tabButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          container.querySelectorAll('.category-tab').forEach(b => {
            b.classList.remove('active');
          });
          e.target.classList.add('active');

          this.currentCategoryId = e.target.getAttribute('data-category');
          this.currentPage = 1;
          await this.loadMaterials();

          // 不再联动语种标签，避免点击分类误选中语种
        });
      });
      logService?.info('[MaterialUI] [loadCategories] 步骤7完成: 所有事件已绑定');
      logService?.info('[MaterialUI] [loadCategories] ========== 分类加载完成 ==========');
    } catch (error) {
      logService?.error('[MaterialUI] [loadCategories] 加载分类异常:', {
        error,
        errorMessage: error?.message,
        errorStack: error?.stack
      });
    }
  }

  /**
   * 加载素材列表
   */
  async loadMaterials() {
    logService?.info('[MaterialUI] [loadMaterials] ========== 开始加载素材 ==========');
    logService?.info('[MaterialUI] [loadMaterials] 当前状态:', {
      isLoading: this.isLoading,
      currentCategoryId: this.currentCategoryId,
      currentPage: this.currentPage,
      pageSize: this.pageSize,
      hasMore: this.hasMore
    });
    
    if (this.isLoading) {
      logService?.warn('[MaterialUI] [loadMaterials] 正在加载中，跳过本次请求');
      return;
    }
    this.isLoading = true;
    
    logService?.info('[MaterialUI] [loadMaterials] 步骤1: 获取素材容器');
    const container = document.getElementById('materialsContainer');
    logService?.info('[MaterialUI] [loadMaterials] 容器状态:', {
      exists: !!container,
      innerHTML: container ? container.innerHTML.substring(0, 100) : 'N/A'
    });
    if (!container) {
      logService?.error('[MaterialUI] [loadMaterials] 容器不存在，无法继续');
      this.isLoading = false;
      return;
    }

    try {
      logService?.info('[MaterialUI] [loadMaterials] 步骤2: 初始化服务');
      await this.initServices();
      logService?.info('[MaterialUI] [loadMaterials] 步骤2完成');
      
      logService?.info('[MaterialUI] [loadMaterials] 步骤3: 检查缓存');
      const cacheKey = `materials.list.${this.currentCategoryId}.${this.currentPage}`;
      let materialsData = this.cacheService?.get(cacheKey);
      logService?.info('[MaterialUI] [loadMaterials] 缓存结果', {
        hasCache: !!materialsData,
        cacheKey,
        materialsCount: materialsData?.materials?.length || 0
      });

      if (!materialsData) {
        logService?.info('[MaterialUI] [loadMaterials] 步骤4: 从服务器获取素材');
        // 仅在第一页显示加载占位
        if (this.currentPage === 1) {
          container.innerHTML = `<div class="col-span-full text-center py-10">加载中...</div>`;
          logService?.info('[MaterialUI] [loadMaterials] 显示加载占位');
        }
        
        const params = { size: this.pageSize, current: this.currentPage };
        if (this.currentCategoryId !== 'all') {
          params.classifyName = this.currentCategoryId;
        }
        logService?.info('[MaterialUI] [loadMaterials] 请求参数:', params);
        logService?.info('[MaterialUI] [loadMaterials] materialService状态:', {
          exists: !!this.materialService,
          hasMethod: !!(this.materialService && typeof this.materialService.getMaterials === 'function')
        });
        
        try {
          const response = await this.materialService.getMaterials(params);
          logService?.info('[MaterialUI] [loadMaterials] 服务器响应:', {
            response,
            hasData: !!response?.data,
            dataType: typeof response?.data,
            materialsCount: response?.data?.data?.length || 0,
            total: response?.data?.totalSize || response?.data?.total || 0
          });
          
          materialsData = {
            materials: response.data?.data || [],
            total: response.data?.totalSize || response.data?.total || 0
          };
          logService?.info('[MaterialUI] [loadMaterials] 处理后的素材数据:', {
            materialsCount: materialsData.materials.length,
            total: materialsData.total
          });
          
          this.cacheService?.set(cacheKey, materialsData, 5 * 60 * 1000);
          logService?.info('[MaterialUI] [loadMaterials] 素材数据已缓存');
        } catch (error) {
          logService?.error('[MaterialUI] [loadMaterials] 获取素材列表失败:', {
            error,
            errorMessage: error?.message,
            errorStack: error?.stack
          });
          if (this.currentPage === 1) {
            container.innerHTML = `
              <div class="col-span-full text-center py-10">
                <div class="text-red-500">
                  <p>素材加载失败</p>
                  <p class="text-sm mt-2">请检查网络连接或稍后重试</p>
                  <button id="retryMaterialsBtn" class="control-btn mt-4">重新加载</button>
                </div>
              </div>
            `;
            const retryBtn = document.getElementById('retryMaterialsBtn');
            if (retryBtn) {
              retryBtn.addEventListener('click', () => {
                this.loadMaterials();
              });
            }
          }
          materialsData = { materials: [], total: 0 };
        }
      } else {
        logService?.info('[MaterialUI] [loadMaterials] 使用缓存素材，跳过服务器请求');
      }

      // 如果服务器返回空数据，保持为空，不显示假的素材数据
      if ((!materialsData.materials || materialsData.materials.length === 0) && this.currentPage === 1) {
        logService?.warn('[MaterialUI] [loadMaterials] 服务器返回空素材列表', {
          categoryId: this.currentCategoryId,
          currentPage: this.currentPage
        });
      }

      logService?.info('[MaterialUI] [loadMaterials] 步骤6: 处理素材数据');
      const { materials, total } = materialsData;
      const totalPages = Math.ceil(total / this.pageSize) || 1;
      this.hasMore = this.currentPage < totalPages;
      logService?.info('[MaterialUI] [loadMaterials] 分页信息:', {
        currentPage: this.currentPage,
        totalPages,
        total,
        hasMore: this.hasMore,
        materialsCount: materials?.length || 0
      });

      // 解析后示例，便于确认字段映射
      const normalized = (materials || []).map(m => this.normalizeMaterial(m));
      logService?.info('[MaterialUI] [loadMaterials] 规范化后的素材:', {
        count: normalized.length,
        examples: normalized.slice(0, 3).map(m => ({
          id: m.id,
          name: m.name,
          category: m.category,
          hasCover: !!m.cover && m.cover.trim() !== ''
        }))
      });

      logService?.info('[MaterialUI] [loadMaterials] 步骤7: 渲染素材卡片');
      if (normalized.length === 0 && this.currentPage === 1) {
        logService?.warn('[MaterialUI] [loadMaterials] 没有素材可显示');
        container.innerHTML = `<div class="col-span-full text-center py-10">暂无素材</div>`;
      } else {
        logService?.info('[MaterialUI] [loadMaterials] 生成HTML');
        const html = normalized.map(material => this.createMaterialCard(material)).join('');
        logService?.info('[MaterialUI] [loadMaterials] HTML生成完成', {
          htmlLength: html.length,
          cardsCount: (html.match(/material-card/g) || []).length
        });
        
        if (this.currentPage === 1) {
          container.innerHTML = html;
          logService?.info('[MaterialUI] [loadMaterials] 第一页内容已渲染');
        } else {
          // 追加渲染，不清空已有内容
          const sentinel = container.querySelector('#materialsSentinel');
          if (sentinel) {
            sentinel.insertAdjacentHTML('beforebegin', html);
            logService?.info('[MaterialUI] [loadMaterials] 追加内容到哨兵前');
          } else {
            container.insertAdjacentHTML('beforeend', html);
            logService?.info('[MaterialUI] [loadMaterials] 追加内容到容器末尾');
          }
        }

        logService?.info('[MaterialUI] [loadMaterials] 步骤8: 绑定卡片点击事件');
        const rawById = new Map();
        normalized.forEach(n => rawById.set(n.id, n._raw));
        const cards = container.querySelectorAll('.material-card');
        logService?.info('[MaterialUI] [loadMaterials] 找到的卡片数量:', cards.length);
        let boundCount = 0;
        cards.forEach(card => {
          if (card.dataset.bound === '1') return;
          const raw = rawById.get(card.dataset.materialId);
          if (raw) {
            card.addEventListener('click', () => {
              cards.forEach(c => c.classList.remove('selected', 'active'));
              card.classList.add('selected', 'active');
              logService?.info('[MaterialUI] [loadMaterials] 素材卡片被点击:', {
                materialId: card.dataset.materialId,
                materialName: raw?.name || raw?.materialName
              });
              this.selectMaterial(raw);
            });
            card.dataset.bound = '1';
            boundCount++;
          }
        });
        logService?.info('[MaterialUI] [loadMaterials] 已绑定事件:', { boundCount, totalCards: cards.length });
      }

      logService?.info('[MaterialUI] [loadMaterials] 步骤9: 设置无限滚动');
      // 设置/更新滚动加载观察者（仅在第一页或未初始化时）
      if (this.currentPage === 1) {
        this.setupInfiniteScroll();
        logService?.info('[MaterialUI] [loadMaterials] 无限滚动已设置');
      } else {
        // 确保哨兵在列表末尾
        const containerSentinel = container.querySelector('#materialsSentinel');
        if (containerSentinel) container.appendChild(containerSentinel);
      }
    } catch (error) {
      logService?.error('[MaterialUI] [loadMaterials] 加载素材异常:', {
        error,
        errorMessage: error?.message,
        errorStack: error?.stack
      });
      if (this.currentPage === 1) {
        container.innerHTML = `
          <div class="col-span-full text-center py-10">
            <div class="text-red-500">
              <p>加载失败</p>
              <p class="text-sm mt-2">请检查网络连接或稍后重试</p>
              <button id="retryMaterialsBtn" class="control-btn mt-4">重新加载</button>
            </div>
          </div>
        `;
        const retryBtn = document.getElementById('retryMaterialsBtn');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => {
            this.loadMaterials();
          });
        }
      }
    } finally {
      this.isLoading = false;
      logService?.info('[MaterialUI] [loadMaterials] ========== 素材加载完成 ==========');
    }
  }

  /**
   * 创建素材卡片
   */
  createMaterialCard(material) {
    // 使用规范化后的字段
    const name = material.name;
    const cover = material.cover;
    const category = material.category;
    const materialId = material.id;

    // 按当前分类统一显示副标题文案（非"全部"时以选中标签为准）
    const activeTab = document.querySelector('#materialCategories .category-tab.active');
    const activeCategoryText = activeTab ? activeTab.textContent.trim() : '';
    const categoryLabel = (this.currentCategoryId && this.currentCategoryId !== 'all') ? (activeCategoryText || category || '') : (category || '');
    
    // 检查 cover 是否有效（非空且非空字符串）
    const hasValidCover = cover && cover.trim() !== '';
    return `
      <div class="material-card" data-material-id="${materialId}">
        <div class="thumb">
          ${hasValidCover ? 
            DomUtils.createImageWithFallback(cover, name) : 
            `<i class="fas fa-image"></i>`}
        </div>
        <div class="card-body">
          <h4 class="card-title">${name}</h4>
          <p class="card-subtitle">${categoryLabel}</p>
        </div>
      </div>
    `;
  }

  /**
   * 选择素材
   */
  async selectMaterial(material) {
    try {
      await this.initServices();
      
      const materialIdStr = String(material.id || '').trim();
      const invalidId = !materialIdStr || materialIdStr === '-1' || materialIdStr === '-2' || /^-\d+$/.test(materialIdStr);
      if (invalidId) {
        logService.error('[REQ04] 素材ID无效，已阻止请求。构造参数:', { mediaId: materialIdStr });
        return;
      }

      const playParams = {
        mediaId: materialIdStr,
        mediaType: 'material'
      };

      logService.info('[MaterialUI] 准备播放素材，参数:', playParams);

      const result = await this.materialService.playMaterial(playParams);
      
      if (!isApiOk(result)) {
        logService.error('播放素材失败:', getApiErrorMessage(result, '未知错误'));
      } else {
        logService.info('素材播放成功');
      }
    } catch (error) {
      logService.error('播放素材失败:', error);
    }
  }

  setupInfiniteScroll() {
    const container = document.getElementById('materialsContainer');
    if (!container) return;

    let sentinel = container.querySelector('#materialsSentinel');
    if (!sentinel) {
      sentinel = document.createElement('div');
      sentinel.id = 'materialsSentinel';
      sentinel.style.minHeight = '1px';
      sentinel.style.marginTop = '1px';
      container.appendChild(sentinel);
    }

    if (this._io) this._io.disconnect();
    this._io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          if (this.hasMore && !this.isLoading) {
            this.currentPage += 1;
            this.loadMaterials();
          }
        }
      });
    }, { root: container, rootMargin: '100px', threshold: 0 });

    this._io.observe(sentinel);
  }

  /**
   * 更新分页
   */
  updatePagination(total) {
    const container = document.getElementById('materialPagination');
    if (container) container.innerHTML = '';
  }
}
// 单例导出
const materialUI = new MaterialUI();
export default materialUI;
