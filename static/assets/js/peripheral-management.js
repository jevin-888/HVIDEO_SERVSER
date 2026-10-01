/**
 * 外设品类管理模块
 * 四列并排：灯光管理 / 音效管理 / 空调管理 / 服务管理
 * 每列支持添加、点击名称改名、删除
 */

// ─── 歌曲分类 ─────────────────────────────────────────────────────────────────

// 正确的兜底分类（来自 hy_muc_dict classify 分组）
const SONG_CATEGORIES_DEFAULT = ['流行', '摇滚', '民谣', '儿歌', '戏曲', '舞曲'];

let _songCategories = SONG_CATEGORIES_DEFAULT;

async function loadSongCategories() {
    try {
        // GET /api/v1/songdb/dict/classify → 返回 [{dictName, dictSort, showToUi, ...}]
        const res = await apiService.getSongDbDict('classify');
        const list = (res && res.data) || [];
        const seen = new Set();
        const classifies = list
            .filter(d => d.showToUi !== 0 && d.dictName)
            .sort((a, b) => (a.dictSort ?? 0) - (b.dictSort ?? 0))
            .map(d => d.dictName)
            .filter(name => {
                if (seen.has(name)) return false;
                seen.add(name);
                return true;
            });
        if (classifies.length) _songCategories = classifies;
    } catch (_) {
        // 使用兜底列表（来自 hy_muc_dict classify 组）
    }
}

function _categoryOptions(selected) {
    return `<option value="">无</option>` + _songCategories.map(c =>
        `<option value="${escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`
    ).join('');
}

// ─── 列表渲染 ─────────────────────────────────────────────────────────────────

function _controlNameButton(type, item, color = 'text-white') {
    return `<button type="button" onclick="renameControlName(this)"
        data-control-type="${escapeHtml(type)}" data-control-id="${escapeHtml(item.id)}"
        data-control-name="${escapeHtml(item.name)}" title="点击修改名称"
        aria-label="修改名称：${escapeHtml(item.name)}"
        class="flex-1 min-w-0 flex items-center gap-1 px-3 py-2 text-sm text-left ${color} hover:text-blue-300 focus:text-blue-300">
        <span class="truncate">${escapeHtml(item.name)}</span>
        <i class="fas fa-pen text-xs text-gray-400 flex-shrink-0" aria-hidden="true"></i>
    </button>`;
}

let _controlRenameBusy = false;

async function renameControlName(button) {
    if (_controlRenameBusy) return;
    _controlRenameBusy = true;
    const { controlType: type, controlId: id, controlName: currentName } = button.dataset;
    try {
        cancelInlineAdd();
        cancelInlineAddService();
        const value = await showPrompt('修改名称', currentName);
        if (value === null) return;
        const name = value.trim();
        if (!name) { showToast('名称不能为空', 'error'); return; }
        if (name === currentName) return;
        if (type === 'service') {
            await apiService.request(`/admin/service-types/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify({ name })
            });
            await loadServiceTypeList();
        } else {
            await apiService.updatePeripheralPreset(id, { name });
            await loadPresetList(type);
        }
        showToast('名称已更新', 'success');
    } catch (err) {
        showToast('名称修改失败: ' + err.message, 'error');
    } finally {
        _controlRenameBusy = false;
    }
}

async function loadPresetList(type) {
    const container = document.getElementById(`preset-list-${type}`);
    if (!container) return;
    try {
        const res  = await apiService.getPeripheralPresets(type);
        const list = (res && res.data) || [];
        _renderPresetRows(type, list, container);
    } catch (_) {
        container.innerHTML = '<div class="text-red-400 text-xs px-3 py-4 text-center">加载失败</div>';
    }
}

function _renderPresetRows(type, list, container) {
    if (!list.length) {
        container.innerHTML = '<div class="text-gray-600 text-xs px-3 py-4 text-center">暂无，点击 + 添加</div>';
        return;
    }
    if (type === 'light') {
        container.innerHTML = list.map(p => {
            const cat = (p.settings && p.settings.song_category) || '';
            return `<div class="group flex items-center border-b border-gray-700/40 hover:bg-gray-700/30 transition">
                ${_controlNameButton(type, p)}
                <div class="w-20 flex-shrink-0 px-1">
                    <select onchange="updateLightCategory('${escapeHtml(p.id)}',this.value)"
                        class="w-full bg-gray-800 text-gray-200 text-xs border-0 focus:outline-none cursor-pointer rounded">
                        ${_categoryOptions(cat)}
                    </select>
                </div>
                <div class="flex gap-1 pr-2 flex-shrink-0">
                    <button onclick="openPresetModal('light','${escapeHtml(p.id)}')" title="详细设置"
                        class="text-blue-400 hover:text-blue-300 text-xs">⚙</button>
                    <button onclick="deletePreset('${escapeHtml(p.id)}','light')"
                        class="text-red-400 hover:text-red-300 text-xs">×</button>
                </div>
            </div>`;
        }).join('');
    } else {
        container.innerHTML = list.map(p =>
            `<div class="group flex items-center border-b border-gray-700/40 hover:bg-gray-700/30 transition">
                ${_controlNameButton(type, p)}
                <div class="flex gap-1 pr-2 flex-shrink-0">
                    <button onclick="openPresetModal('${escapeHtml(type)}','${escapeHtml(p.id)}')" title="详细设置"
                        class="text-blue-400 hover:text-blue-300 text-xs">⚙</button>
                    <button onclick="deletePreset('${escapeHtml(p.id)}','${escapeHtml(type)}')"
                        class="text-red-400 hover:text-red-300 text-xs">×</button>
                </div>
            </div>`
        ).join('');
    }
}

async function updateLightCategory(id, category) {
    try {
        const res = await apiService.getPeripheralPresets('light');
        const preset = (res?.data || []).find(p => p.id === id);
        if (!preset) return;
        const newSettings = Object.assign({}, preset.settings || {});
        if (category) newSettings.song_category = category;
        else delete newSettings.song_category;
        await apiService.updatePeripheralPreset(id, { settings: newSettings });
    } catch (err) {
        typeof showToast === 'function' && showToast('更新失败: ' + err.message, 'error');
    }
}

// ─── 行内添加 ─────────────────────────────────────────────────────────────────

let _inlineAddType = null;

function showInlineAdd(type) {
    cancelInlineAdd();
    _inlineAddType = type;
    const container = document.getElementById(`preset-list-${type}`);
    if (!container) return;

    const ph = { light: '灯光名称', effect: '音效名称', ac: '空调预设名称' }[type];
    const addRow = document.createElement('div');
    addRow.id = 'inline-add-row';
    addRow.className = 'flex items-center gap-1 px-2 py-2 bg-gray-700/50 border-t border-red-800/40';

    const catField = type === 'light'
        ? `<select id="inline-add-cat" class="w-20 flex-shrink-0 px-1 py-1 bg-gray-800 text-gray-200 text-xs rounded border border-gray-600 focus:outline-none">${_categoryOptions('')}</select>`
        : '';

    addRow.innerHTML = `
        <input id="inline-add-name" type="text" placeholder="${ph}..."
            class="flex-1 px-2 py-1 bg-gray-700 text-white text-xs rounded border border-gray-600 focus:outline-none focus:border-red-500">
        ${catField}
        <button onclick="saveInlineAdd()" class="text-green-400 hover:text-green-300 text-lg px-1 leading-none">✓</button>
        <button onclick="cancelInlineAdd()" class="text-red-400 hover:text-red-300 text-lg px-1 leading-none">×</button>`;

    container.appendChild(addRow);
    addRow.querySelector('#inline-add-name')?.focus();
}

function cancelInlineAdd() {
    document.getElementById('inline-add-row')?.remove();
    _inlineAddType = null;
}

async function saveInlineAdd() {
    const type = _inlineAddType;
    if (!type) return;
    const name = document.getElementById('inline-add-name')?.value?.trim();
    if (!name) { typeof showToast === 'function' && showToast('名称不能为空', 'error'); return; }

    const defaults = {
        light:  { ctrlType: 2, code: '1' },
        effect: { mode: 'standard' },
        ac:     { power: true, temp: 26, mode: 'cool', wind: 'low' },
    };
    const settings = Object.assign({}, defaults[type]);
    if (type === 'light') {
        const cat = document.getElementById('inline-add-cat')?.value;
        if (cat) settings.song_category = cat;
    }

    try {
        await apiService.createPeripheralPreset({ presetType: type, name, settings, sortOrder: 0 });
        cancelInlineAdd();
        loadPresetList(type);
    } catch (err) {
        typeof showToast === 'function' && showToast('添加失败: ' + err.message, 'error');
    }
}

// ─── 编辑弹窗 ─────────────────────────────────────────────────────────────────

let _presetEditId   = null;
let _presetEditType = 'light';
let _presetEditSettings = {};

function openPresetModal(type, id) {
    _presetEditType = type;
    _presetEditId   = id || null;
    _presetEditSettings = {};

    const typeNames = { light: '灯光', effect: '音效', ac: '空调' };
    document.getElementById('preset-modal-title').textContent = (id ? '编辑' : '添加') + typeNames[type] + '品类';
    document.getElementById('preset-form-type').value  = type;
    document.getElementById('preset-form-name').value  = '';
    document.getElementById('preset-form-sort').value  = '0';
    _renderSettingsFields(type, {});

    if (id) {
        apiService.getPeripheralPresets(type).then(res => {
            const preset = (res?.data || []).find(p => p.id === id);
            if (!preset) return;
            _presetEditSettings = { ...(preset.settings || {}) };
            document.getElementById('preset-form-name').value = preset.name;
            document.getElementById('preset-form-sort').value = String(preset.sortOrder);
            _renderSettingsFields(type, preset.settings || {});
        });
    }

    document.getElementById('preset-modal').classList.remove('hidden');
    document.getElementById('preset-modal').classList.add('flex');
}

function closePresetModal() {
    document.getElementById('preset-modal')?.classList.replace('flex', 'hidden');
}

function _renderSettingsFields(type, settings) {
    const wrap = document.getElementById('preset-settings-fields');
    if (!wrap) return;
    if (type === 'light') {
        wrap.innerHTML = `
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-xs text-gray-400 mb-1">控制类型</label>
                    <select id="sf-ctrl-type" class="form-input w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none">
                        <option value="2" ${settings.ctrlType == 2 ? 'selected' : ''}>场景灯光</option>
                        <option value="3" ${settings.ctrlType == 3 ? 'selected' : ''}>自动灯光</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs text-gray-400 mb-1">场景码</label>
                    <input id="sf-code" type="text" value="${escapeHtml(String(settings.code ?? '1'))}"
                        placeholder="1柔和 2明亮 8浪漫 98全开 99全关"
                        class="form-input w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none">
                </div>
            </div>`;
    } else if (type === 'effect') {
        wrap.innerHTML = `
            <div>
                <label class="block text-xs text-gray-400 mb-1">音效模式</label>
                <select id="sf-mode" class="form-input w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none">
                    ${['standard','ktv','pop','rock','concert'].map(m =>
                        `<option value="${m}" ${settings.mode===m?'selected':''}>${{standard:'标准',ktv:'KTV',pop:'流行',rock:'摇滚',concert:'音乐会'}[m]}</option>`
                    ).join('')}
                </select>
            </div>`;
    } else if (type === 'ac') {
        wrap.innerHTML = `
            <div class="grid grid-cols-2 gap-3">
                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="block text-xs text-gray-400 mb-1">开关</label>
                        <select id="sf-ac-power" class="form-input w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none">
                            <option value="true"  ${settings.power===true  ? 'selected':''}>开</option>
                            <option value="false" ${settings.power===false ? 'selected':''}>关</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs text-gray-400 mb-1">温度 (℃)</label>
                        <input id="sf-ac-temp" type="number" min="16" max="30" value="${settings.temp ?? 26}"
                            class="form-input w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none">
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="block text-xs text-gray-400 mb-1">模式</label>
                        <select id="sf-ac-mode" class="form-input w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none">
                            ${['cool','heat','auto'].map(m =>
                                `<option value="${m}" ${settings.mode===m?'selected':''}>${{cool:'制冷',heat:'制热',auto:'自动'}[m]}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs text-gray-400 mb-1">风速</label>
                        <select id="sf-ac-wind" class="form-input w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none">
                            ${['low','mid','high'].map(w =>
                                `<option value="${w}" ${settings.wind===w?'selected':''}>${{low:'低风',mid:'中风',high:'高风'}[w]}</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
            </div>`;
    }
}

function _collectSettings(type) {
    if (type === 'light')  return { ctrlType: Number(document.getElementById('sf-ctrl-type')?.value || 2), code: document.getElementById('sf-code')?.value?.trim() || '1' };
    if (type === 'effect') return { mode: document.getElementById('sf-mode')?.value || 'standard' };
    if (type === 'ac')     return { 
        power: document.getElementById('sf-ac-power')?.value === 'true', 
        temp: Number(document.getElementById('sf-ac-temp')?.value || 26), 
        mode: document.getElementById('sf-ac-mode')?.value || 'cool',
        wind: document.getElementById('sf-ac-wind')?.value || 'low'
    };
    return {};
}

async function savePreset() {
    const name = document.getElementById('preset-form-name')?.value?.trim();
    const sort = Number(document.getElementById('preset-form-sort')?.value || 0);
    if (!name) { typeof showToast === 'function' && showToast('名称不能为空', 'error'); return; }

    const payload = {
        name,
        settings: { ..._presetEditSettings, ..._collectSettings(_presetEditType) },
        sortOrder: sort
    };
    try {
        if (_presetEditId) { await apiService.updatePeripheralPreset(_presetEditId, payload); typeof showToast==='function' && showToast('更新成功','success'); }
        else               { await apiService.createPeripheralPreset({ presetType: _presetEditType, ...payload }); typeof showToast==='function' && showToast('添加成功','success'); }
        closePresetModal();
        loadPresetList(_presetEditType);
    } catch (err) { typeof showToast === 'function' && showToast('保存失败: ' + err.message, 'error'); }
}

async function deletePreset(id, type) {
    if (!await showConfirm('确认删除该品类？')) return;
    try {
        await apiService.deletePeripheralPreset(id);
        typeof showToast === 'function' && showToast('删除成功', 'success');
        loadPresetList(type);
    } catch (err) { typeof showToast === 'function' && showToast('删除失败: ' + err.message, 'error'); }
}

// ─── 服务类型管理（第4列）────────────────────────────────────────────────────

async function loadServiceTypeList() {
    const el = document.getElementById('service-type-list');
    if (!el) return;
    try {
        const res = await apiService.request('/admin/service-types');
        const list = (res && res.data) || [];
        if (!list.length) {
            el.innerHTML = '<div class="text-gray-600 text-xs px-3 py-4 text-center">暂无，点击 + 添加</div>';
            return;
        }
        el.innerHTML = list.map(t => `
            <div class="group flex items-center border-b border-gray-700/40 hover:bg-gray-700/30 transition">
                <i class="fas ${escapeHtml(t.icon)} text-emerald-400 w-7 text-center text-xs flex-shrink-0"></i>
                ${_controlNameButton('service', t, t.enabled ? 'text-white' : 'text-gray-500 line-through')}
                <div class="flex gap-1 pr-2 flex-shrink-0">
                    <button onclick="toggleSvcType('${escapeHtml(t.id)}',${t.enabled ? 0 : 1})"
                        class="text-xs ${t.enabled ? 'text-yellow-400 hover:text-yellow-300' : 'text-emerald-400 hover:text-emerald-300'}"
                        title="${t.enabled ? '禁用' : '启用'}">${t.enabled ? '⊘' : '✓'}</button>
                    <button onclick="deleteSvcType('${escapeHtml(t.id)}')"
                        class="text-red-400 hover:text-red-300 text-xs">×</button>
                </div>
            </div>`).join('');
    } catch (_) {
        el.innerHTML = '<div class="text-red-400 text-xs px-3 py-4 text-center">加载失败</div>';
    }
}

let _svcInlineActive = false;

function showInlineAddService() {
    if (_svcInlineActive) return;
    _svcInlineActive = true;
    const el = document.getElementById('service-type-list');
    if (!el) return;
    const row = document.createElement('div');
    row.id = 'svc-inline-add-row';
    row.className = 'flex flex-col gap-1.5 px-2 py-2 bg-gray-700/50 border-t border-emerald-800/40';
    row.innerHTML = `
        <input id="svc-inline-name" type="text" placeholder="服务名称..."
            class="w-full px-2 py-1 bg-gray-700 text-white text-xs rounded border border-gray-600 focus:outline-none focus:border-emerald-500">
        <input id="svc-inline-icon" type="text" placeholder="图标 如 fa-bell"
            class="w-full px-2 py-1 bg-gray-700 text-white text-xs rounded border border-gray-600 focus:outline-none focus:border-emerald-500">
        <div class="flex gap-1 justify-end">
            <button onclick="saveInlineAddService()" class="text-green-400 hover:text-green-300 text-lg leading-none px-1">✓</button>
            <button onclick="cancelInlineAddService()" class="text-red-400 hover:text-red-300 text-lg leading-none px-1">×</button>
        </div>`;
    el.appendChild(row);
    row.querySelector('#svc-inline-name')?.focus();
}

function cancelInlineAddService() {
    document.getElementById('svc-inline-add-row')?.remove();
    _svcInlineActive = false;
}

async function saveInlineAddService() {
    const name = document.getElementById('svc-inline-name')?.value?.trim();
    const icon = document.getElementById('svc-inline-icon')?.value?.trim() || 'fa-concierge-bell';
    if (!name) { typeof showToast === 'function' && showToast('名称不能为空', 'error'); return; }
    try {
        await apiService.request('/admin/service-types', {
            method: 'POST',
            body: JSON.stringify({ name, icon })
        });
        cancelInlineAddService();
        loadServiceTypeList();
    } catch (err) {
        typeof showToast === 'function' && showToast('添加失败', 'error');
    }
}

async function toggleSvcType(id, enabled) {
    try {
        await apiService.request(`/admin/service-types/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ enabled })
        });
        loadServiceTypeList();
    } catch (_) {
        typeof showToast === 'function' && showToast('操作失败', 'error');
    }
}

async function deleteSvcType(id) {
    if (!await showConfirm('确认删除该服务类型？')) return;
    try {
        await apiService.request(`/admin/service-types/${id}`, { method: 'DELETE' });
        typeof showToast === 'function' && showToast('已删除', 'success');
        loadServiceTypeList();
    } catch (_) {
        typeof showToast === 'function' && showToast('删除失败', 'error');
    }
}

// ─── 初始化 ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const bootPeripheralManagement = async () => {
        await loadSongCategories();

        ['light', 'effect', 'ac'].forEach(t => {
            document.getElementById(`preset-add-${t}`)?.addEventListener('click', () => showInlineAdd(t));
        });
        document.getElementById('preset-add-service')?.addEventListener('click', showInlineAddService);

        document.getElementById('preset-modal-close')?.addEventListener('click', closePresetModal);
        document.getElementById('preset-modal-cancel')?.addEventListener('click', closePresetModal);
        document.getElementById('preset-modal-save')?.addEventListener('click', savePreset);
        document.getElementById('preset-modal')?.addEventListener('click', e => {
            if (e.target === e.currentTarget) closePresetModal();
        });

        document.addEventListener('keydown', e => {
            if (_svcInlineActive) {
                if (e.key === 'Enter') saveInlineAddService();
                if (e.key === 'Escape') cancelInlineAddService();
                return;
            }
            if (!_inlineAddType) return;
            if (e.key === 'Enter') saveInlineAdd();
            if (e.key === 'Escape') cancelInlineAdd();
        });
    };

    if (window.__adminServerReady) {
        bootPeripheralManagement();
    } else {
        window.addEventListener('admin-server-ready', () => {
            bootPeripheralManagement();
        }, { once: true });
    }
});

