// Dedicated dictionary maintenance. One API method per server operation.
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    if (!$('dicts-section')) return;
    const groupNames = Object.assign(Object.create(null), {
        classify: '歌曲分类', language: '语种', track: '声道', region: '歌手地区', sex: '歌手类型',
        light: '灯光', soundEffect: '音效', genreDetail: '细分曲风', vocalForm: '演唱形式',
        theme: '主题', scene: '场景', mood: '情绪', contentType: '内容类型', musicVersion: '音乐版本',
        collection: '专题', musicMarket: '音乐市场', publicSongClassify: '公播分类',
        publicSongLight: '公播灯光', publicSongVol: '公播音量', selectedSongVol: '点播音量', ac: '空调',
        songEntryPage: '点歌默认页'
    });
    const entryPageNames = Object.freeze({ song: '歌名', singer: '歌星', indonesian: '印尼歌曲' });
    let items = [], selectedGroup = '', busy = false, loading = false, editing = null;
    let loaded = false;
    let loadPromise = null;
    const message = (id, text = '', kind = '') => {
        $(id).textContent = text;
        $(id).dataset.kind = kind;
    };
    const groupLabel = group => groupNames[group] ? `${groupNames[group]} (${group})` : group;
    function controls() {
        ['dict-refresh', 'dict-add', 'dict-open-import', 'dict-export-all'].forEach(id => { $(id).disabled = busy || loading; });
        $('dict-export-group').disabled = busy || loading || !selectedGroup;
        $('dict-editor-fields').disabled = busy;
        $('dict-import-fields').disabled = busy;
        $('dict-save').disabled = busy;
        $('dict-import-submit').disabled = busy;
        $('dict-entry-page-select').disabled = busy || loading || !loaded;
        $('dict-entry-page-save').disabled = busy || loading || !loaded;
        document.querySelectorAll('[data-dict-close], #dict-table button').forEach(el => { el.disabled = busy || loading; });
    }
    function render() {
        const keyword = $('dict-search').value.trim().toLocaleLowerCase();
        const visible = $('dict-visible-filter').value;
        const filtered = items.filter(item => (!selectedGroup || item.dictGroup === selectedGroup)
            && (visible === '' || String(item.visible ?? 1) === visible)
            && (!keyword || [item.dictGroup, groupNames[item.dictGroup], item.dictCode, item.dictName]
                .some(value => String(value ?? '').toLocaleLowerCase().includes(keyword))));
        const fragment = document.createDocumentFragment();
        for (const item of filtered) {
            const row = document.createElement('tr');
            row.dataset.dictGroup = item.dictGroup;
            row.dataset.dictCode = item.dictCode;
            const group = document.createElement('td');
            group.textContent = groupNames[item.dictGroup] || item.dictGroup;
            if (groupNames[item.dictGroup]) {
                const code = document.createElement('small'); code.textContent = item.dictGroup; group.append(code);
            }
            row.append(group);
            for (const value of [item.dictCode, item.dictName, item.sortOrder ?? 0]) {
                const cell = document.createElement('td'); cell.setAttribute('translate','no'); cell.textContent = String(value ?? ''); row.append(cell);
            }
            const stateCell = document.createElement('td'), badge = document.createElement('span');
            badge.className = `dict-badge${item.visible === 0 ? ' is-hidden' : ''}`;
            badge.textContent = item.visible === 0 ? '隐藏' : '显示'; stateCell.append(badge); row.append(stateCell);
            const actions = document.createElement('td');
            const rowActions = item.dictGroup === 'songEntryPage'
                ? [['edit', '配置']] : [['edit', '编辑'], ['delete', '删除']];
            for (const [action, label] of rowActions) {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'dict-row-action';
                button.dataset.action = action; button.textContent = label;
                button.setAttribute('aria-label', `${label} ${item.dictGroup}/${item.dictCode}`);
                actions.append(button);
            }
            row.append(actions); fragment.append(row);
        }
        if (!filtered.length) {
            const row = document.createElement('tr'), cell = document.createElement('td');
            cell.colSpan = 6; cell.className = 'dict-empty'; cell.textContent = loading ? '正在加载字典…' : '没有匹配的字典项';
            row.append(cell); fragment.append(row);
        }
        $('dict-table').replaceChildren(fragment);
        $('dict-count').textContent = `显示 ${filtered.length.toLocaleString()} / ${items.length.toLocaleString()} 条`;
        controls();
    }
    function populateGroups() {
        const groups = [...new Set(items.map(item => item.dictGroup))].sort();
        $('dict-group-filter').replaceChildren(new Option('全部分组', ''), ...groups.map(group => new Option(groupLabel(group), group)));
        if (!groups.includes(selectedGroup)) selectedGroup = '';
        $('dict-group-filter').value = selectedGroup;
        $('dict-group-options').replaceChildren(...[...new Set([...groups, ...Object.keys(groupNames)])].sort().map(group => new Option(groupLabel(group), group)));
        $('dict-summary').textContent = `共 ${groups.length} 个分组、${items.length.toLocaleString()} 条字典，含隐藏项`;
    }
    async function load() {
        if (loadPromise) return loadPromise;
        loadPromise = (async () => {
            loading = true; controls();
            message('dict-message', '正在加载字典…');
            try {
                const response = await apiService.getSongDbDicts();
                if (response.code !== 0 || !Array.isArray(response.data)) throw new Error('字典数据格式错误');
                items = response.data;
                loaded = true;
                const entryPage = items.find(item => item.dictGroup === 'songEntryPage');
                const page = entryPage?.dictCode ?? 'song';
                if (!Object.hasOwn(entryPageNames, page)) throw new Error('点歌默认页配置无效');
                $('dict-entry-page-select').value = page;
                populateGroups();
                message('dict-message');
                return true;
            } catch (error) {
                items = [];
                loaded = false;
                $('dict-summary').textContent = '字典加载失败';
                message('dict-message', `${error.message}，可点击“刷新”重试。`, 'error');
                return false;
            } finally {
                loading = false; render();
            }
        })();
        try { return await loadPromise; } finally { loadPromise = null; }
    }
    function openEditor(item = null) {
        if (busy || loading) return;
        if ((item?.dictGroup ?? selectedGroup) === 'songEntryPage') {
            focusEntryPage();
            return;
        }
        editing = item;
        $('dict-editor-form').reset();
        $('dict-editor-title').textContent = item ? '编辑字典项' : '新增字典项';
        $('dict-edit-group').value = item?.dictGroup ?? selectedGroup;
        $('dict-edit-code').value = item?.dictCode ?? '';
        $('dict-edit-name').value = item?.dictName ?? '';
        $('dict-edit-sort').value = item?.sortOrder ?? 0;
        $('dict-edit-visible').value = item?.visible ?? 1;
        $('dict-edit-group').readOnly = Boolean(item); $('dict-edit-code').readOnly = Boolean(item);
        message('dict-editor-message');
        $('dict-editor').showModal();
        $(item ? 'dict-edit-name' : 'dict-edit-group').focus();
    }
    async function afterWrite(text) {
        const refreshed = await load();
        if (refreshed) message('dict-message', text);
        document.dispatchEvent(new CustomEvent('dictionary-changed'));
        if (typeof showToast === 'function') showToast(text, 'success');
    }
    function focusEntryPage() {
        $('dict-entry-page-select').scrollIntoView({ block: 'center' });
        $('dict-entry-page-select').focus();
        message('dict-entry-page-message', '选择默认显示的页面，然后点击“保存设置”。');
    }
    $('dict-entry-page-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || loading || !loaded) return;
        const page = $('dict-entry-page-select').value;
        if (!Object.hasOwn(entryPageNames, page)) return;
        busy = true; controls(); message('dict-entry-page-message', '正在保存…');
        try {
            const response = await apiService.upsertSongDbDict('songEntryPage', {
                dictCode: page, dictName: entryPageNames[page], visible: 1, sortOrder: 0
            });
            if (response.code !== 0 || response.data?.dictGroup !== 'songEntryPage'
                || response.data?.dictCode !== page) {
                throw new Error(response.message || '保存点歌默认页失败');
            }
            await afterWrite('点歌默认页已保存');
            message('dict-entry-page-message', `已设为“${entryPageNames[page]}”，PAD 下次点击点歌时生效。`);
        } catch (error) { message('dict-entry-page-message', error.message, 'error'); }
        finally { busy = false; controls(); }
    });
    $('dict-editor-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || !$('dict-editor-form').reportValidity()) return;
        const group = $('dict-edit-group').value.trim();
        if (group === 'songEntryPage') {
            $('dict-editor').close(); focusEntryPage(); return;
        }
        const payload = {
            dictCode: $('dict-edit-code').value.trim(), dictName: $('dict-edit-name').value.trim(),
            sortOrder: Number($('dict-edit-sort').value), visible: Number($('dict-edit-visible').value)
        };
        if (!payload.dictCode || !payload.dictName) { message('dict-editor-message', '编码和名称不能为空。', 'error'); return; }
        if (!editing && items.some(item => item.dictGroup === group && item.dictCode === payload.dictCode)) {
            message('dict-editor-message', '该分组和编码已存在，请从列表编辑。', 'error'); return;
        }
        busy = true; controls(); message('dict-editor-message', '正在保存…');
        try {
            const response = await apiService.upsertSongDbDict(group, payload);
            if (response.code !== 0) throw new Error(response.message || '保存字典失败');
            $('dict-editor').close();
            await afterWrite('字典项已保存');
        } catch (error) { message('dict-editor-message', error.message, 'error'); }
        finally { busy = false; controls(); }
    });
    $('dict-table').addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button || busy || loading) return;
        const row = button.closest('tr');
        const item = items.find(item => item.dictGroup === row.dataset.dictGroup && item.dictCode === row.dataset.dictCode);
        if (!item) return;
        if (button.dataset.action === 'edit') { openEditor(item); return; }
        busy = true; controls();
        try {
            const confirmed = await showConfirm(`删除“${item.dictName}” (${item.dictGroup}/${item.dictCode})？已被歌曲或歌星引用的字典项无法删除。`);
            if (!confirmed) return;
            const response = await apiService.deleteSongDbDict(item.dictGroup, item.dictCode);
            if (response.code !== 0) throw new Error(response.message || '删除字典失败');
            await afterWrite('字典项已删除');
        } catch (error) { message('dict-message', error.message, 'error'); }
        finally { busy = false; controls(); }
    });
    async function exportFile(group) {
        if (busy || loading) return;
        busy = true; controls(); message('dict-message', '正在生成 XLSX…');
        try {
            const blob = await apiService.exportSongDbDicts(group);
            const url = URL.createObjectURL(blob), anchor = document.createElement('a');
            anchor.href = url; anchor.download = group ? `歌曲字典_${group}.xlsx` : '歌曲字典.xlsx';
            document.body.append(anchor); anchor.click(); anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            message('dict-message', group ? `已导出 ${groupLabel(group)} 的全部条目（含隐藏项）。` : '全部字典已导出（含隐藏项）。');
        } catch (error) { message('dict-message', error.message, 'error'); }
        finally { busy = false; controls(); }
    }
    $('dict-open-import').addEventListener('click', () => {
        $('dict-import-form').reset(); message('dict-import-message'); $('dict-import-dialog').showModal();
    });
    $('dict-import-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        const file = $('dict-import-file').files[0];
        if (!file || !/\.xlsx$/i.test(file.name)) { message('dict-import-message', '请选择 .xlsx 字典表。', 'error'); return; }
        if (!file.size || file.size > 5 * 1024 * 1024) { message('dict-import-message', '文件不能为空且不能超过 5 MB。', 'error'); return; }
        busy = true; controls(); message('dict-import-message', '正在校验并导入，请稍候…');
        try {
            const response = await apiService.importSongDbDicts(file);
            const result = response.data;
            if (response.code !== 0 || !result || !['totalCount', 'insertedCount', 'updatedCount', 'unchangedCount'].every(key => Number.isInteger(result[key]) && result[key] >= 0)
                || result.totalCount !== result.insertedCount + result.updatedCount + result.unchangedCount) {
                throw new Error('未收到有效的导入结果，请刷新列表核对。');
            }
            const text = `导入完成：共 ${result.totalCount} 条，新增 ${result.insertedCount}，更新 ${result.updatedCount}，未变化 ${result.unchangedCount}。`;
            $('dict-import-file').value = '';
            message('dict-import-message', text);
            await afterWrite(text);
        } catch (error) { message('dict-import-message', error.message, 'error'); }
        finally { busy = false; controls(); }
    });
    $('dict-refresh').addEventListener('click', () => { if (!busy) load(); });
    $('dict-add').addEventListener('click', () => openEditor());
    $('dict-export-all').addEventListener('click', () => exportFile(''));
    $('dict-export-group').addEventListener('click', () => exportFile(selectedGroup));
    $('dict-group-filter').addEventListener('change', () => { selectedGroup = $('dict-group-filter').value; render(); });
    $('dict-search').addEventListener('input', render);
    $('dict-visible-filter').addEventListener('change', render);
    document.querySelectorAll('[data-dict-close]').forEach(button => button.addEventListener('click', () => { if (!busy) $(button.dataset.dictClose).close(); }));
    ['dict-editor', 'dict-import-dialog'].forEach(id => $(id).addEventListener('cancel', event => { if (busy) event.preventDefault(); }));
    window.dictionaryPage = {
        load,
        open(group = '') {
            selectedGroup = group;
            $('dict-search').value = ''; $('dict-visible-filter').value = '';
            showSection('dicts');
        }
    };
})();
