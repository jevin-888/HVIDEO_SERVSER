/**
 * 筛选器模块
 * 负责所有筛选器相关的UI逻辑
 */
import sharedModalManager from '../common/SharedModalManager.js';

export class SongTopFilters {
  constructor(ui) {
    this.ui = ui;
  }

  getFilterLabel(type, code, options) {
    if (!options || !Array.isArray(options)) return '';
    const option = options.find(item => String(item.code) === String(code));
    return option ? option.name : '';
  }

  renderFilterTags() {
    if (this.ui.topBarRenderer?.renderFilterTags) {
      return this.ui.topBarRenderer.renderFilterTags(this.ui);
    }
    const filterTagsContainer = this.ui.modal?.querySelector('#filter-tags-container');
    if (!filterTagsContainer) return;
    this.ui._clearContainer(filterTagsContainer);

    const langService = window.langService;
    const idT = langService?.translations['id_id'] || {};
    const enT = langService?.translations['en_us'] || {};
    const viT = langService?.translations['vi_vn'] || {};

    const multiLangSpan = (zh, id, en, vi) => {
      return `<span class="zh-label">${zh}</span>` +
             `<span class="indonesian-translation">${id}</span>` +
             `<span class="en-translation">${en}</span>` +
             `<span class="vi-translation">${vi}</span>`;
    };

    const prompt = document.createElement('div');
    prompt.className = 'w-full text-center font-semibold text-gray-800 dark:text-gray-100 filter-tags-prompt';

    if (this.ui.currentMode === 'singer') {
      if (this.ui.selectedSingerName) {
        prompt.innerHTML = `<span class="zh-label">搜索"${this.ui.selectedSingerName}"的歌曲</span>` +
                           `<span class="indonesian-translation">Cari lagu "${this.ui.selectedSingerName}"</span>` +
                           `<span class="en-translation">Search songs of "${this.ui.selectedSingerName}"</span>` +
                           `<span class="vi-translation">Tìm bài hát của "${this.ui.selectedSingerName}"</span>`;
      } else if (this.ui.isShowingSingersList && !this.ui.filterParams?.primarySingerNo) {
        const parts = [];
        const sexName = this.getFilterLabel('sex', this.ui.singerFilters.sex, this.ui._sexOptions || []);
        const regionName = this.getFilterLabel('region', this.ui.singerFilters.region, this.ui._regionOptions || []);
        if (sexName) parts.push(sexName);
        if (regionName) parts.push(regionName);
        if (parts.length > 0) {
          const joined = parts.join(' / ');
          prompt.innerHTML = `<span class="zh-label">歌星筛选：${joined}</span>` +
                             `<span class="indonesian-translation">Filter Penyanyi: ${joined}</span>` +
                             `<span class="en-translation">Singer Filter: ${joined}</span>` +
                             `<span class="vi-translation">Lọc ca sĩ: ${joined}</span>`;
        } else {
          prompt.innerHTML = multiLangSpan('热门歌星', idT['hotSingers'] || 'Penyanyi Populer', enT['hotSingers'] || 'Hot Singers', viT['hotSingers'] || 'Ca sĩ hot');
        }
      } else {
        prompt.innerHTML = multiLangSpan('热门歌星', idT['hotSingers'] || 'Penyanyi Populer', enT['hotSingers'] || 'Hot Singers', viT['hotSingers'] || 'Ca sĩ hot');
      }
    } else {
      prompt.innerHTML = multiLangSpan('搜索歌曲', 'Cari Lagu', 'Search Songs', 'Tìm kiếm bài hát');
    }
    filterTagsContainer.appendChild(prompt);
    filterTagsContainer.classList.remove('hidden');
  }

  async renderSingerFilters() {
    if (this.ui.topBarRenderer?.renderSingerFilters) {
      const handled = await this.ui.topBarRenderer.renderSingerFilters(this.ui);
      if (handled) return;
    }
    await this._renderSingerFilterControls();
  }

  async _renderSingerFilterControls() {
    await this.ui.initServices();
    const middleContentEl = sharedModalManager.getMiddleContentElement();
    const singerWrap = middleContentEl?.querySelector('#quick-singer');
    const langWrap = middleContentEl?.querySelector('#quick-language');
    const clsWrap = middleContentEl?.querySelector('#quick-category');

    if (!singerWrap) return;

    if (this.ui.currentMode !== 'singer' || !this.ui.isShowingSingersList) {
      singerWrap.classList.add('hidden');
      return;
    }

    singerWrap.classList.remove('hidden');
    if (langWrap) langWrap.classList.add('hidden');
    if (clsWrap) clsWrap.classList.add('hidden');

    try {
      if (!this.ui._sexOptions) {
        this.ui._sexOptions = await this.ui.cacheService.getDict('sex') || [];
      }
    } catch (e) {
      console.warn('[SongTopUI] 获取性别字典失败:', e);
      this.ui._sexOptions = [];
    }

    try {
      if (!this.ui._regionOptions) {
        this.ui._regionOptions = await this.ui.cacheService.getDict('region') || [];
      }
    } catch (e) {
      console.warn('[SongTopUI] 获取地区字典失败:', e);
      this.ui._regionOptions = [];
    }

    const sexName = this.getFilterLabel('sex', this.ui.singerFilters.sex, this.ui._sexOptions) || '';
    const regionName = this.getFilterLabel('region', this.ui.singerFilters.region, this.ui._regionOptions) || '';
    const sexLabel = this.ui.singerFilters.sex ? `性别 · ${sexName}` : '性别';
    const regionLabel = this.ui.singerFilters.region ? `地区 · ${regionName}` : '地区';

    this.ui._clearContainer(singerWrap);

    const banner = document.createElement('div');
    banner.className = 'flex gap-2';
    singerWrap.appendChild(banner);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'flex gap-2';
    banner.appendChild(buttonRow);

    const multiLangSpan = (zh, id, en, vi) => {
      return `<span class="zh-label">${zh}</span>` +
             `<span class="indonesian-translation">${id}</span>` +
             `<span class="en-translation">${en}</span>` +
             `<span class="vi-translation">${vi}</span>`;
    };

    const createFilterButton = (type, zh, id, en, vi, isActive) => {
      const btn = document.createElement('button');
      btn.className = [
        'px-5 py-3 rounded-xl border font-semibold transition-all duration-150',
        'song-singer-filter-btn flex flex-col items-center justify-center',
        isActive
          ? 'bg-blue-500 text-white border-blue-500 shadow'
          : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-700'
      ].join(' ');
      btn.dataset.filterType = type;
      btn.innerHTML = multiLangSpan(zh, id, en, vi);
      this.ui._addEventListener(btn, 'click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openFilterDialog(type);
      });
      return btn;
    };

    const hasAnyFilter = Boolean(this.ui.singerFilters.sex || this.ui.singerFilters.region);
    const allButton = document.createElement('button');
    allButton.className = [
      'px-5 py-3 rounded-xl border font-semibold transition-all duration-150',
      'song-singer-filter-btn flex flex-col items-center justify-center',
      !hasAnyFilter
        ? 'bg-blue-500 text-white border-blue-500 shadow'
        : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-700'
    ].join(' ');
    allButton.innerHTML = multiLangSpan('全部', 'Semua', 'All', 'Tất cả');
    this.ui._addEventListener(allButton, 'click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (hasAnyFilter) {
        this.ui.singerFilters.sex = '';
        this.ui.singerFilters.region = '';
        this.ui.singersPage = 1;

        const container = sharedModalManager.getContainer();
        if (container) {
          this.ui._clearContainer(container);
          container.scrollTop = 0;
          delete container.dataset._restoringScroll;
          delete container.dataset._updatingHeight;
          await this.ui.loadSingers(container, 1);
        }

        await this.renderSingerFilters();
        this.renderFilterTags();
      }
    });
    buttonRow.appendChild(allButton);

    const sexLabelZh = this.ui.singerFilters.sex ? `性别 · ${sexName}` : '性别';
    const sexLabelId = this.ui.singerFilters.sex ? `Jenis · ${sexName}` : 'Jenis';
    const sexLabelEn = this.ui.singerFilters.sex ? `Gender · ${sexName}` : 'Gender';
    const sexLabelVi = this.ui.singerFilters.sex ? `Phái · ${sexName}` : 'Phái';

    const regionLabelZh = this.ui.singerFilters.region ? `地区 · ${regionName}` : '地区';
    const regionLabelId = this.ui.singerFilters.region ? `Wilayah · ${regionName}` : 'Wilayah';
    const regionLabelEn = this.ui.singerFilters.region ? `Region · ${regionName}` : 'Region';
    const regionLabelVi = this.ui.singerFilters.region ? `Vùng · ${regionName}` : 'Vùng';

    buttonRow.appendChild(createFilterButton('sex', sexLabelZh, sexLabelId, sexLabelEn, sexLabelVi, Boolean(this.ui.singerFilters.sex)));
    buttonRow.appendChild(createFilterButton('region', regionLabelZh, regionLabelId, regionLabelEn, regionLabelVi, Boolean(this.ui.singerFilters.region)));
  }

  async applySingerFilter(type, code) {
    try {
      await this.ui.initServices();
      const normalizedCode = code ? String(code) : '';

      if (type === 'sex') {
        if (this.ui.singerFilters.sex === normalizedCode) {
          await this.renderSingerFilters();
          return;
        }
        this.ui.singerFilters.sex = normalizedCode;
      } else if (type === 'region') {
        if (this.ui.singerFilters.region === normalizedCode) {
          await this.renderSingerFilters();
          return;
        }
        this.ui.singerFilters.region = normalizedCode;
      } else {
        return;
      }

      this.ui.singersPage = 1;
      this.ui.isShowingSingersList = true;
      if (this.ui.filterParams?.primarySingerNo) {
        delete this.ui.filterParams.primarySingerNo;
      }

      const container = sharedModalManager.getContainer();
      if (container) {
        container.dataset.done = 'false';
        container.dataset.loading = 'false';
        container.scrollTop = 0;
        delete container.dataset._restoringScroll;
        delete container.dataset._updatingHeight;
        this.ui._clearContainer(container);
        await this.ui.loadSingers(container, 1);
        this.ui.bindInfiniteScroll(container);
      }

      await this.renderSingerFilters();
      this.renderFilterTags();
    } catch (error) {
      console.error('[SongTopUI] 应用歌星筛选失败:', error);
    }
  }

  async renderQuickCategories() {
    try {
      await this.ui.initServices();
      const middleContentEl = sharedModalManager.getMiddleContentElement();
      if (!middleContentEl) return;

      const ensureWrap = (id) => {
        let wrap = middleContentEl.querySelector(`#${id}`);
        if (!wrap) {
          wrap = document.createElement('div');
          wrap.id = id;
          wrap.className = 'bg-transparent rounded-lg py-1 hidden';
          middleContentEl.appendChild(wrap);
        } else {
          wrap.classList.add('bg-transparent', 'rounded-lg', 'py-1');
        }
        return wrap;
      };

      const langWrap = ensureWrap('quick-language');
      const clsWrap = ensureWrap('quick-category');
      ensureWrap('quick-singer');
      const selectorButtons = this.ui._getSelectorButtons();
      const langSelector = selectorButtons?.langSelector || middleContentEl.querySelector('#language-selector');
      const clsSelector = selectorButtons?.clsSelector || middleContentEl.querySelector('#category-selector');

      const [languages, classifies] = await Promise.all([
        langWrap && !this.ui._languages
          ? this.ui.cacheService.getDict('language').then(data => {
            this.ui._languages = Array.isArray(data) && data.length > 0 ? data : [];
            return this.ui._languages;
          }).catch(() => {
            this.ui._languages = [];
            return [];
          })
          : Promise.resolve(this.ui._languages || []),
        clsWrap && !this.ui._classifies
          ? this.ui.cacheService.getDict('category').then(data => {
            this.ui._classifies = Array.isArray(data) && data.length > 0 ? data : [];
            return this.ui._classifies;
          }).catch(() => {
            this.ui._classifies = [];
            return [];
          })
          : Promise.resolve(this.ui._classifies || [])
      ]);

      if (langWrap && !this.ui._languages) {
        this.ui._languages = languages;
      }

      if (clsWrap && !this.ui._classifies) {
        this.ui._classifies = classifies;
      }

      const languagesList = this.ui._languages || [];
      const classifiesList = this.ui._classifies || [];

      const renderGroup = (wrap, list, type) => {
        if (!wrap) return;
        this.ui._clearContainer(wrap);
        const selectedCode = type === 'language' ? this.ui.selectedLanguageCode : this.ui.selectedCategoryCode;
        const maxCount = list.length;

        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'flex gap-2 overflow-x-auto hide-scrollbar';
        scrollContainer.id = `${type}-scroll-container`;
        this.ui._addEventListener(scrollContainer, 'wheel', () => {
          this.ui._autoScrollToSelected = false;
        }, { passive: true });
        this.ui._addEventListener(scrollContainer, 'touchstart', () => {
          this.ui._autoScrollToSelected = false;
        }, { passive: true });

        list.slice(0, maxCount).forEach((item) => {
          const code = item.code || item.dictCode || item.dictValue;
          const name = item.name || item.dictLabel || code;
          const btn = document.createElement('button');
          const baseClass = 'song-top-filter-btn song-top-filter-btn--sub rounded-full whitespace-nowrap flex-shrink-0 border font-semibold';
          const activeClass = 'bg-blue-500 border-blue-500 text-white';
          const normalClass = 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200';
          btn.className = baseClass + ' ' + (selectedCode && selectedCode === code ? activeClass : normalClass);
          btn.dataset.code = code;
          btn.dataset.type = type;
          btn.innerHTML = `<span class="leading-tight font-semibold">${name}</span>`;
          this.ui._applyQuickButtonTypography(btn);

          if (selectedCode && selectedCode === code) {
            btn.id = `selected-${type}-btn`;
          }

          scrollContainer.appendChild(btn);
        });

        if (list.length === 0) {
          const noDataText = document.createElement('div');
          noDataText.className = 'text-gray-500 dark:text-gray-400 text-sm py-2';
          noDataText.textContent = '暂无数据';
          scrollContainer.appendChild(noDataText);
        }

        wrap.appendChild(scrollContainer);

        this.ui._addEventListener(scrollContainer, 'click', async (event) => {
          const targetBtn = event.target.closest('button');
          if (!targetBtn) return;

          const { code, type: btnType } = targetBtn.dataset || {};
          if (!code) return;

          event.preventDefault();
          event.stopPropagation();

          const isLanguage = btnType === 'language';
          const currentCode = isLanguage ? this.ui.selectedLanguageCode : this.ui.selectedCategoryCode;
          if (currentCode && String(currentCode) === String(code)) {
            return;
          }

          this.ui._autoScrollToSelected = true;

          if (isLanguage) {
            this.ui.setMode('language', { languageCode: code });
          } else if (btnType === 'category') {
            this.ui.setMode('category', { categoryCode: code });
          } else {
            return;
          }

          const container = sharedModalManager.getContainer();
          if (container) {
            container.scrollTop = 0;
            await this.ui.loadSongs(container, 1);
          }
        });

        if (selectedCode && this.ui._autoScrollToSelected) {
          requestAnimationFrame(() => {
            const selectedBtn = scrollContainer.querySelector(`#selected-${type}-btn`);
            if (!selectedBtn) return;
            const containerRect = scrollContainer.getBoundingClientRect();
            const btnRect = selectedBtn.getBoundingClientRect();
            const scrollLeft = btnRect.left - containerRect.left - (containerRect.width / 2) + (btnRect.width / 2);
            scrollContainer.scrollTo({ left: scrollContainer.scrollLeft + scrollLeft, behavior: 'smooth' });
          });
        }
      }

      renderGroup(langWrap, languagesList, 'language');
      renderGroup(clsWrap, classifiesList, 'category');

      const selectorButtonsForUI = this.ui._getSelectorButtons();
      if (selectorButtonsForUI) {
        if (this.ui.currentMode === 'language') {
          if (langWrap) langWrap.classList.remove('hidden');
          if (clsWrap) clsWrap.classList.add('hidden');
          if (!this.ui._isIndonesianSongsMode()) {
            this.ui._updateButtonState(selectorButtonsForUI.langSelector, true);
            this.ui._updateButtonState(selectorButtonsForUI.clsSelector, false);
          }
        } else if (this.ui.currentMode === 'category') {
          if (clsWrap) clsWrap.classList.remove('hidden');
          if (langWrap) langWrap.classList.add('hidden');
          this.ui._updateButtonState(selectorButtonsForUI.clsSelector, true);
          this.ui._updateButtonState(selectorButtonsForUI.langSelector, false);
        } else {
          if (langWrap) langWrap.classList.add('hidden');
          if (clsWrap) clsWrap.classList.add('hidden');
          this.ui._updateButtonState(selectorButtonsForUI.langSelector, false);
          this.ui._updateButtonState(selectorButtonsForUI.clsSelector, false);
        }
      }

      if (this.ui._isIndonesianSongsMode()) {
        this.ui._updateButtonsState({
          indonesianSongsBtn: true,
          langSelector: false,
          clsSelector: false,
          singersBtn: false,
          songnameBtn: false
        });
      }

      this.ui._autoScrollToSelected = false;
    } catch (e) {
      console.warn('[SongTopUI] 渲染快速分类失败:', e);
    }
  }

  async _switchFilterModeAndLoad(mode, codeKey, selectedCode) {
    const container = sharedModalManager.getContainer?.();
    if (!container) return false;

    if (this.ui.currentMode !== mode || this.ui.isShowingSingersList) {
      const previousMode = this.ui.currentMode;
      const wasShowingSingersList = this.ui.isShowingSingersList;
      const params = selectedCode ? { [codeKey]: selectedCode } : {};

      this.ui.setMode(mode, params);

      if (previousMode !== mode || wasShowingSingersList) {
        this.ui._clearContainer(container);
        container.scrollTop = 0;
        delete container.dataset._restoringScroll;
        delete container.dataset._updatingHeight;
      }
      await this.ui.loadSongs(container, 1);
      this.ui.bindInfiniteScroll(container);
      return true;
    }

    this.ui._autoScrollToSelected = true;
    await this.renderQuickCategories();
    this.ui.renderFilterBar();
    return false;
  }

  async activateQuickFilter(type) {
    if (type === 'language') {
      if (this.ui._isIndonesianSongsMode()) {
        this.ui.setMode('language', {});
        await this.renderQuickCategories();
        this.ui.renderFilterBar();
        return;
      }
      const switched = await this._switchFilterModeAndLoad('language', 'languageCode', this.ui.selectedLanguageCode);
      if (switched) return;
      return;
    }

    if (type === 'category') {
      const switched = await this._switchFilterModeAndLoad('category', 'categoryCode', this.ui.selectedCategoryCode);
      if (switched) return;
      return;
    }

    if (typeof this.openFilterDialog === 'function') {
      this.openFilterDialog(type);
    }
  }

  async openFilterDialog(type) {
    if (type === 'language' || type === 'category') {
      this.activateQuickFilter?.(type);
      return;
    }
    try {
      if (!this.ui.modal) this.ui.initTopModal();
      await this.ui.initServices();

      const content = this.ui.modal?.querySelector('.relative') || this.ui.modal;
      if (!content) return;

      this.closeFilterDialog();

      let options = [];
      let selectedCode = '';
      let title = '';
      let isSingerFilter = false;

      const multiLangSpan = (zh, id, en, vi) => {
        return `<span class="zh-label">${zh}</span>` +
               `<span class="indonesian-translation">${id}</span>` +
               `<span class="en-translation">${en}</span>` +
               `<span class="vi-translation">${vi}</span>`;
      };

      if (type === 'language') {
        if (!this.ui._languages) this.ui._languages = await this.ui.cacheService.getDict('language') || [];
        options = this.ui._languages || [];
        selectedCode = this.ui.selectedLanguageCode;
        title = multiLangSpan('选择语种', 'Pilih Bahasa', 'Select Language', 'Chọn ngôn ngữ');
      } else if (type === 'category') {
        if (!this.ui._classifies) this.ui._classifies = await this.ui.cacheService.getDict('category') || [];
        options = this.ui._classifies || [];
        selectedCode = this.ui.selectedCategoryCode;
        title = multiLangSpan('选择分类', 'Pilih Kategori', 'Select Category', 'Chọn thể loại');
      } else if (type === 'sex') {
        if (!this.ui._sexOptions) this.ui._sexOptions = await this.ui.cacheService.getDict('sex') || [];
        options = this.ui._sexOptions || [];
        selectedCode = this.ui.singerFilters?.sex || '';
        title = multiLangSpan('选择歌手性别', 'Pilih Jenis Kelamin Penyanyi', 'Select Artist Gender', 'Chọn giới tính ca sĩ');
        isSingerFilter = true;
      } else if (type === 'region') {
        if (!this.ui._regionOptions) this.ui._regionOptions = await this.ui.cacheService.getDict('region') || [];
        options = this.ui._regionOptions || [];
        selectedCode = this.ui.singerFilters?.region || '';
        title = multiLangSpan('选择歌手地区', 'Pilih Wilayah Penyanyi', 'Select Artist Region', 'Chọn vùng miền ca sĩ');
        isSingerFilter = true;
      } else {
        console.warn('[SongTopUI] 未知的筛选类型:', type);
        return;
      }

      const dialog = document.createElement('div');
      dialog.id = 'filter-dialog';
      dialog.className = 'fixed inset-0 z-[10001] bg-black/40 flex items-center justify-center';

      const panel = document.createElement('div');
      panel.className = 'bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-2xl filter-dialog-panel';

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between mb-4';
      const titleEl = document.createElement('div');
      titleEl.className = 'font-bold text-gray-800 dark:text-gray-100';
      titleEl.innerHTML = title;
      const closeBtn = document.createElement('button');
      closeBtn.id = 'filter-dialog-close';
      closeBtn.className = 'w-12 h-12 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200';
      const icon = document.createElement('i');
      icon.className = 'fas fa-times';
      closeBtn.appendChild(icon);
      this.ui._addEventListener(closeBtn, 'click', () => this.closeFilterDialog());
      header.appendChild(titleEl);
      header.appendChild(closeBtn);

      const grid = document.createElement('div');
      grid.id = 'filter-dialog-grid';
      grid.className = 'grid grid-cols-3 sm:grid-cols-4 gap-3 filter-dialog-grid';

      const makeLabel = (item) => item.name || item.dictLabel || item.dictValue || item.code || '';
      const makeCode = (item) => String(item.code || item.dictCode || item.dictValue || '');

      options.forEach(item => {
        const code = makeCode(item);
        const name = makeLabel(item);
        const isSelected = selectedCode && String(selectedCode) === String(code);

        const btn = document.createElement('button');
        btn.className = [
          'px-3 py-2 rounded-xl border text-center',
          'text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-700',
          'hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400',
          isSelected ? 'bg-blue-500 text-white border-blue-500' : 'bg-transparent',
          'overflow-hidden text-ellipsis whitespace-nowrap max-w-full'
        ].join(' ');
        btn.textContent = name;
        btn.title = name;
        this.ui._addEventListener(btn, 'click', async () => {
          try {
            if (type === 'language') {
              this.ui.setMode('language', { languageCode: code });
              this.closeFilterDialog();
            } else if (type === 'category') {
              this.ui.setMode('category', { categoryCode: code });
              this.closeFilterDialog();
            } else if (isSingerFilter) {
              this.closeFilterDialog();
              await this.applySingerFilter(type, code);
              return;
            }
          } catch (err) {
            console.warn('[SongTopUI] 应用筛选失败:', err);

          }
        });
        grid.appendChild(btn);
      });

      if (options.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'text-gray-500 dark:text-gray-400 text-center py-6';
        msg.textContent = '暂无数据';
        grid.appendChild(msg);
      }

      const footer = document.createElement('div');
      footer.className = 'mt-4 flex justify-end';
      const allBtn = document.createElement('button');
      allBtn.className = 'px-3 py-2 rounded-xl border text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-700 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 flex flex-col items-center justify-center';
      allBtn.innerHTML = multiLangSpan('全部', 'Semua', 'All', 'Tất cả');
      this.ui._addEventListener(allBtn, 'click', async () => {
        try {
          if (type === 'language') {
            this.ui.setMode('language', {});
            this.closeFilterDialog();
          } else if (type === 'category') {
            this.ui.setMode('category', {});
            this.closeFilterDialog();
          } else if (isSingerFilter) {
            this.closeFilterDialog();
            await this.applySingerFilter(type, '');
            return;
          }
        } catch (err) {
          console.warn('[SongTopUI] 清空筛选失败:', err);
        }
      });

      panel.appendChild(header);
      panel.appendChild(grid);
      panel.appendChild(footer);
      dialog.appendChild(panel);
      document.body.appendChild(dialog);

      this.ui._addEventListener(dialog, 'click', (e) => {
        if (e.target === dialog) this.closeFilterDialog();
      });
    } catch (e) {
      console.warn('[SongTopUI] 打开筛选弹窗失败:', e);
    }
  }

  closeFilterDialog() {
    try {
      const dialog = document.body.querySelector('#filter-dialog');
      if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog);
    } catch (_) { }
  }
}
