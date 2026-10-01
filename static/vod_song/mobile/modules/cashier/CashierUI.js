/**
 * 移动点歌端商品点单界面。
 * API 字段严格对应：ProductCategory、Product、CreateOrderRequest。
 */
class CashierUI {
  constructor() {
    this.cashierService = null;
    this.modal = null;
    this.categories = [];
    this.products = [];
    this.categoryId = 'all';
    this.cart = new Map();
    this.loading = false;
    this.submitting = false;
  }

  initServices() {
    this.cashierService = window.cashierService || this.cashierService;
    if (!this.cashierService) throw new Error('点单服务未初始化');
    return this.cashierService;
  }

  getServiceModal() {
    return this;
  }

  async show() {
    this.initServices();
    this.ensureModal();
    this.modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    await this.loadCatalog();
  }

  hide() {
    if (this.modal) this.modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  ensureModal() {
    if (this.modal && document.body.contains(this.modal)) return;
    this.modal = document.createElement('div');
    this.modal.id = 'cashier-order-modal';
    this.modal.className = 'fixed inset-0 hidden bg-black/60 backdrop-blur-sm';
    this.modal.style.zIndex = '10100';
    this.modal.innerHTML = `
      <section class="absolute inset-x-0 bottom-0 flex max-h-[92dvh] min-h-[72dvh] flex-col overflow-hidden rounded-t-3xl bg-white text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-white" role="dialog" aria-modal="true" aria-labelledby="cashier-order-title">
        <header class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div>
            <h2 id="cashier-order-title" class="text-lg font-bold">商品点单</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400">请选择商品和数量后提交订单</p>
          </div>
          <button type="button" data-action="close" class="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-200" aria-label="关闭点单">×</button>
        </header>
        <div class="flex min-h-0 flex-1 flex-col">
          <nav data-role="categories" class="flex flex-none gap-2 overflow-x-auto border-b border-gray-100 px-3 py-2 dark:border-gray-800" aria-label="商品分类"></nav>
          <div data-role="status" class="hidden px-4 py-8 text-center text-sm text-gray-500"></div>
          <div data-role="products" class="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-3"></div>
          <section class="flex-none border-t border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-700 dark:bg-gray-950">
            <p data-role="submit-error" class="mb-2 hidden text-sm text-red-500"></p>
            <div data-role="cart" class="mb-3 max-h-32 space-y-2 overflow-y-auto"></div>
            <div class="flex items-center justify-between gap-3">
              <div><p class="text-xs text-gray-500 dark:text-gray-400">合计</p><p data-role="total" class="text-xl font-bold text-red-500">¥0.00</p></div>
              <button type="button" data-action="submit" class="min-w-32 rounded-xl bg-red-500 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled>提交订单</button>
            </div>
          </section>
        </div>
      </section>`;
    document.body.appendChild(this.modal);
    this.bindCashierEvents();
    this.renderCart();
  }

  bindCashierEvents() {
    this.modal.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) {
        if (event.target === this.modal) this.hide();
        return;
      }
      const action = target.dataset.action;
      if (action === 'close') this.hide();
      else if (action === 'category') {
        this.categoryId = target.dataset.categoryId;
        await this.loadProducts();
      } else if (action === 'add' || action === 'increase') this.changeQuantity(target.dataset.productId, 1);
      else if (action === 'decrease') this.changeQuantity(target.dataset.productId, -1);
      else if (action === 'submit') await this.submitOrder();
    });
  }

  async loadCatalog() {
    if (this.loading) return;
    this.loading = true;
    this.setStatus('正在加载商品…');
    try {
      this.categories = await this.cashierService.getDrinkCategories();
      this.categoryId = 'all';
      this.renderDrinkCategories(this.categories);
      await this.loadProducts();
    } catch (error) {
      this.setStatus(`加载商品失败：${error.message || '未知错误'}`);
      this.notify('加载商品失败，请稍后重试', 'error');
    } finally {
      this.loading = false;
    }
  }

  async loadProducts() {
    this.setStatus('正在加载商品…');
    try {
      this.products = await this.cashierService.getDrinks(this.categoryId);
      this.renderDrinkCategories(this.categories);
      this.renderDrinks(this.products);
    } catch (error) {
      this.setStatus(`加载商品失败：${error.message || '未知错误'}`);
    }
  }

  renderDrinkCategories(categories) {
    const container = this.modal.querySelector('[data-role="categories"]');
    const items = [{ id: 'all', name: '全部', sortOrder: -1 }, ...categories];
    container.innerHTML = items.map(category => {
      const active = category.id === this.categoryId;
      return `<button type="button" data-action="category" data-category-id="${this.escape(category.id)}" class="whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${active ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'}">${this.escape(category.name)}</button>`;
    }).join('');
  }

  renderDrinks(drinks) {
    const container = this.modal.querySelector('[data-role="products"]');
    this.modal.querySelector('[data-role="status"]').classList.add('hidden');
    container.classList.remove('hidden');
    if (!drinks.length) {
      container.innerHTML = '<p class="col-span-2 py-10 text-center text-sm text-gray-500">暂无可售商品</p>';
      return;
    }
    container.innerHTML = drinks.map(product => {
      const quantity = this.cart.get(product.id)?.quantity || 0;
      const soldOut = product.stock <= 0;
      const image = product.imageUrl
        ? `<img src="${this.escape(product.imageUrl)}" alt="${this.escape(product.name)}" class="h-24 w-full rounded-xl object-cover" loading="lazy">`
        : '<div class="flex h-24 items-center justify-center rounded-xl bg-gray-100 text-3xl dark:bg-gray-800">🛒</div>';
      return `<article class="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        ${image}<h3 class="mt-2 truncate font-semibold">${this.escape(product.name)}</h3>
        <div class="mt-1 flex items-end justify-between gap-2"><div><p class="font-bold text-red-500">¥${Number(product.price).toFixed(2)}</p><p class="text-[11px] text-gray-500">库存 ${product.stock}</p></div>
        <button type="button" data-action="add" data-product-id="${this.escape(product.id)}" class="rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40" ${soldOut || quantity >= product.stock ? 'disabled' : ''}>${soldOut ? '售罄' : quantity ? `已选 ${quantity}` : '加入'}</button></div>
      </article>`;
    }).join('');
  }

  updateOrderDisplay() {
    this.renderCart();
    this.renderDrinks(this.products);
  }

  changeQuantity(productId, delta) {
    const product = this.products.find(item => item.id === productId) || this.cart.get(productId)?.product;
    if (!product) return;
    const current = this.cart.get(productId)?.quantity || 0;
    const quantity = Math.max(0, Math.min(product.stock, current + delta));
    if (quantity === 0) this.cart.delete(productId);
    else this.cart.set(productId, { product, quantity });
    this.updateOrderDisplay();
  }

  renderCart() {
    if (!this.modal) return;
    const container = this.modal.querySelector('[data-role="cart"]');
    const entries = Array.from(this.cart.values());
    container.innerHTML = entries.length ? entries.map(({ product, quantity }) => `
      <div class="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm dark:bg-gray-800">
        <div class="min-w-0 flex-1"><p class="truncate font-medium">${this.escape(product.name)}</p><p class="text-xs text-gray-500">¥${Number(product.price).toFixed(2)} × ${quantity}</p></div>
        <div class="flex items-center gap-2"><button type="button" data-action="decrease" data-product-id="${this.escape(product.id)}" class="h-7 w-7 rounded-full bg-gray-200 dark:bg-gray-700" aria-label="减少${this.escape(product.name)}">−</button><span class="w-5 text-center font-semibold">${quantity}</span><button type="button" data-action="increase" data-product-id="${this.escape(product.id)}" class="h-7 w-7 rounded-full bg-gray-200 dark:bg-gray-700 disabled:opacity-40" aria-label="增加${this.escape(product.name)}" ${quantity >= product.stock ? 'disabled' : ''}>＋</button></div>
      </div>`).join('') : '<p class="text-center text-xs text-gray-500">尚未选择商品</p>';
    const total = entries.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
    this.modal.querySelector('[data-role="total"]').textContent = `¥${total.toFixed(2)}`;
    const submit = this.modal.querySelector('[data-action="submit"]');
    submit.disabled = entries.length === 0 || this.submitting;
    submit.textContent = this.submitting ? '提交中…' : '提交订单';
  }

  async submitOrder() {
    if (this.submitting || this.cart.size === 0) return;
    this.submitting = true;
    const errorElement = this.modal.querySelector('[data-role="submit-error"]');
    errorElement.textContent = '正在提交订单…';
    errorElement.classList.remove('hidden');
    this.renderCart();
    try {
      const roomId = this.cashierService.apiService.getRoomId();
      const items = Array.from(this.cart.values()).map(({ product, quantity }) => ({ productId: product.id, quantity }));
      const order = await this.cashierService.createOrder({ roomId, items, packages: [] });
      this.cart.clear();
      this.updateOrderDisplay();
      this.notify(`下单成功，订单号：${order.id}`, 'success');
      this.hide();
    } catch (error) {
      const message = error.message || '下单失败，请稍后重试';
      errorElement.textContent = message;
      errorElement.classList.remove('hidden');
      this.notify(message, 'error');
    } finally {
      this.submitting = false;
      this.renderCart();
    }
  }

  setStatus(message) {
    this.modal.querySelector('[data-role="status"]').textContent = message;
    this.modal.querySelector('[data-role="status"]').classList.remove('hidden');
    this.modal.querySelector('[data-role="products"]').classList.add('hidden');
  }

  notify(message, type) {
    const toast = window.toastService;
    if (toast && typeof toast.showToast === 'function') toast.showToast(message, type, 1800);
    else if (type === 'error') window.alert(message);
  }

  escape(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
}

const cashierUI = new CashierUI();

export function getServiceModal() {
  return cashierUI.getServiceModal();
}

export default cashierUI;