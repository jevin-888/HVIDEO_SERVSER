// 延迟导入，避免循环依赖
import { isApiOk, getApiErrorMessage } from '../../../shared/utils/ApiResponseUtils.js';

let materialService;
let apiServiceRef;
let cacheService; // 添加缓存服务

class MaterialUI {
  constructor() {
    this.currentCategoryId = 'all';
    this.currentPage = 1;
    this.pageSize = 20;
    this.isLoading = false;
    this.hasMore = true;
  }

  /**
   * 统一规范化素材字段
   */
  normalizeMaterial(raw) {
    const id = String(raw?.id || '');
    const name = String(raw?.name || '').trim() || '未命名素材';
    const categoryId = String(raw?.categoryId || '');
    const category = String(raw?.categoryName || '').trim() || '未分类';
    const cover = raw?.cover || raw?.url || '';

    return { id, name, categoryId, category, cover, _raw: raw };
  }

  async initServices() {
    materialService = window.navMaterialService || materialService;
    apiServiceRef = window.apiService || apiServiceRef;
    cacheService = window.cacheService || cacheService;

    this.materialService = materialService;
    this.apiService = apiServiceRef;
    this.cacheService = cacheService;
  }

  // 在底部导航的素材入口中渲染简版列表
  renderNavMaterials(materials) {
    const container = document.getElementById('materialListContainer');
    if (!container) return;
    const list = Array.isArray(materials) ? materials : [];

    // 统一规范化
    const normalized = list.map(m => this.normalizeMaterial(m));

    // 使用当前选中分类标签文案作为副分类（若存在）
    const activeTab = document.querySelector('#materialCategories .category-tab.active');
    const activeCategoryText = activeTab ? activeTab.textContent.trim() : '';

    container.innerHTML = normalized.map((m) => {
      return `
        <div class="material-card" data-material-id="${m.id}">
          <div class="thumb">
            ${m.cover ? 
              `<img src="${m.cover}" alt="${m.name}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-image text-gray-400\\'></i>'">` : 
              `<i class="fas fa-image" style="color:#9ca3af"></i>`}
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
    // 检查模态框是否已存在
    if (document.getElementById('materialModalBackdrop')) {
      return;
    }

    await this.initServices();
    
    // 创建模态框背景
    const backdrop = document.createElement('div');
    backdrop.id = 'materialModalBackdrop';
    backdrop.className = 'fixed inset-0 bg-black bg-opacity-50 z-[10006] hidden modal-backdrop';
    document.body.appendChild(backdrop);

    // 创建模态框内容
    const content = document.createElement('div');
    content.id = 'materialModalContent';
    content.className = 'fixed inset-x-0 bottom-0 z-[10006] flex items-center justify-center hidden modal-content';
    content.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-t-lg shadow-xl w-full max-w-4xl h-[calc(100vh-65px)] flex flex-col">
        <div class="p-4 border-b dark:border-gray-700 flex justify-between items-center">
          <h3 class="text-xl font-semibold dark:text-gray-200">素材库</h3>
          <button id="closeMaterialModal" class="control-btn text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 modal-close-btn">
            <i class="fas fa-times text-lg"></i>
          </button>
        </div>
        <div class="flex-1 overflow-hidden flex flex-col">
          <div id="materialCategories" class="category-tabs-container">
            <div class="category-tabs-wrapper">
              <div class="category-tabs"></div>
            </div>
          </div>
          <div id="materialsContainer" class="material-content grid" style="flex:1; overflow-y:auto; padding:1rem; gap:0.75rem;">
            <div class="col-span-full text-center py-10">加载中...</div>
          </div>
          <div id="materialPagination" class="border-t dark:border-gray-700 p-4 flex justify-center items-center" style="display:none"></div>
        </div>
      </div>
    `;
    document.body.appendChild(content);

    // 注入统一样式（响应式栅格与卡片文本）
    if (!document.getElementById('materialInlineStyles')) {
      const style = document.createElement('style');
      style.id = 'materialInlineStyles';
      style.textContent = `
        /* 统一素材栅格：小屏两列 */
        .material-content.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; align-content: start; align-items: start; grid-auto-rows: max-content; }
        @media (min-width: 1024px) { .material-content.grid { grid-template-columns: 1fr 1fr 1fr; } }
        /* 统一卡片文本结构（与全局CSS保持一致）*/
        .material-card .card-body { padding: 0.75rem; height: 64px; }
      `;
      document.head.appendChild(style);
    }

    // 绑定关闭事件
    document.getElementById('closeMaterialModal').addEventListener('click', () => this.closeModal());
    backdrop.addEventListener('click', () => this.closeModal());

    // 加载分类和素材
    await this.loadCategories();
    await this.loadMaterials();
  }

  /**
   * 打开素材模态框
   */
  async openModal() {
    await this.initServices();
    
    // 清除旧的素材缓存，确保显示最新数据
    this.clearMaterialCache();
    
    await this.createModal();
    const backdrop = document.getElementById('materialModalBackdrop');
    const content = document.getElementById('materialModalContent');
    if (backdrop) {
      backdrop.classList.remove('hidden');
      backdrop.classList.add('active');
    }
    if (content) {
      content.classList.remove('hidden');
      content.classList.add('active');
    }
  }

  /**
   * 关闭素材模态框
   */
  closeModal() {
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
    try {
      await this.initServices();
      const cacheKey = 'material.categories';
      let categories = this.cacheService.get(cacheKey);

      if (!categories) {
        try {
          const categoryParams = { getAll: 0, filter: 1 };
          logService.info('[MaterialUI] 从服务器获取素材分类，参数:', categoryParams);
          const response = await this.materialService.getMaterialCategories(categoryParams);
          logService.info('[MaterialUI] 服务器返回的素材分类响应:', response);
          categories = Array.isArray(response) ? response : [];
          this.cacheService.set(cacheKey, categories, 10 * 60 * 1000);
        } catch (error) {
          logService.error('获取素材分类失败，使用空数组:', error);
          const container = document.getElementById('materialCategories');
          if (container) {
            container.innerHTML = `
              <div class="error-message border border-red-200 bg-red-50 dark:bg-gray-800 rounded">
                <p class="error-text text-red-500">素材分类加载失败</p>
                <p class="text-sm mt-2 text-gray-600">请检查网络连接或稍后重试</p>
              </div>
            `;
          }
          categories = [];
        }
      }

      const container = document.getElementById('materialCategories');
      if (!container) return;

      let tabsHtml = '';
      tabsHtml += `<button class="control-btn category-tab active" data-category="all">全部</button>`;
      categories.forEach(category => {
        tabsHtml += `<button class="control-btn category-tab" data-category="${category.id}">${category.name}</button>`;
      });

      // 写入旧项目结构的标签容器
      container.querySelector('.category-tabs').innerHTML = tabsHtml;

      container.querySelectorAll('.category-tab').forEach(btn => {
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
    } catch (error) {
      logService.error('加载素材分类失败:', error);
    }
  }

  /**
   * 加载素材列表
   */
  async loadMaterials() {
    if (this.isLoading) return;
    this.isLoading = true;
    const container = document.getElementById('materialsContainer');
    if (!container) {
      this.isLoading = false;
      return;
    }

    try {
      // 仅在第一页显示加载占位
      if (this.currentPage === 1) {
        container.innerHTML = `<div class="col-span-full text-center py-10">加载中...</div>`;
      }
      await this.initServices();
      const cacheKey = `materials.list.${this.currentCategoryId}.${this.currentPage}`;
      let materialsData = this.cacheService.get(cacheKey);

      if (!materialsData) {
        const params = {};
        try {
          logService.info('[MaterialUI] 从服务器获取素材列表，参数:', params);
          const response = await this.materialService.getMaterials(params);
          logService.info('[MaterialUI] 服务器返回的素材列表响应:', response);
          const filteredList = this.currentCategoryId !== 'all'
            ? response.filter(item => String(item.categoryId) === String(this.currentCategoryId))
            : response;
          const start = (this.currentPage - 1) * this.pageSize;
          const end = start + this.pageSize;
          materialsData = {
            materials: filteredList.slice(start, end),
            total: filteredList.length
          };
          this.cacheService.set(cacheKey, materialsData, 5 * 60 * 1000);
        } catch (error) {
          logService.error('获取素材列表失败，使用空数组:', error);
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
      }

      const { materials, total } = materialsData;
      const totalPages = Math.ceil(total / this.pageSize) || 1;
      this.hasMore = this.currentPage < totalPages;

      // 解析后示例，便于确认字段映射
      const normalized = (materials || []).map(m => this.normalizeMaterial(m));
      logService.info('[MaterialUI] 列表规范化后条目示例:', normalized.slice(0, 3));

      if (normalized.length === 0 && this.currentPage === 1) {
        container.innerHTML = `<div class="col-span-full text-center py-10">暂无素材</div>`;
      } else {
        const html = normalized.map(material => this.createMaterialCard(material)).join('');
        if (this.currentPage === 1) {
          container.innerHTML = html;
        } else {
          // 追加渲染，不清空已有内容
          const sentinel = container.querySelector('#materialsSentinel');
          if (sentinel) {
            sentinel.insertAdjacentHTML('beforebegin', html);
          } else {
            container.insertAdjacentHTML('beforeend', html);
          }
        }

        const rawById = new Map();
        normalized.forEach(n => rawById.set(n.id, n._raw));
        const cards = container.querySelectorAll('.material-card');
        cards.forEach(card => {
          if (card.dataset.bound === '1') return;
          const raw = rawById.get(card.dataset.materialId);
          if (raw) {
            card.addEventListener('click', () => {
              cards.forEach(c => c.classList.remove('selected', 'active'));
              card.classList.add('selected', 'active');
              this.selectMaterial(raw);
            });
            card.dataset.bound = '1';
          }
        });
      }

      // 设置/更新滚动加载观察者（仅在第一页或未初始化时）
      if (this.currentPage === 1) {
        this.setupInfiniteScroll();
      } else {
        // 确保哨兵在列表末尾
        const containerSentinel = container.querySelector('#materialsSentinel');
        if (containerSentinel) container.appendChild(containerSentinel);
      }
    } catch (error) {
      logService.error('加载素材失败:', error);
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

    // 按当前分类统一显示副标题文案（非“全部”时以选中标签为准）
    const activeTab = document.querySelector('#materialCategories .category-tab.active');
    const activeCategoryText = activeTab ? activeTab.textContent.trim() : '';
    const categoryLabel = (this.currentCategoryId && this.currentCategoryId !== 'all') ? (activeCategoryText || category || '') : (category || '');
    
    return `
      <div class="material-card" data-material-id="${materialId}">
        <div class="thumb">
          ${cover ? 
            `<img src="${cover}" alt="${name}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-image text-gray-400\\'></i>'">` : 
            `<i class="fas fa-image" style="color:#9ca3af"></i>`}
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
      
      const materialId = String(material.id || '').trim();
      if (!materialId) {
        logService.error('[MaterialUI] 素材ID缺失，已阻止请求。原始素材:', material);
        return;
      }

      const playParams = {
        mediaId: materialId,
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
