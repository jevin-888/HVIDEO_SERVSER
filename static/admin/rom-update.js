(() => {
    const t = value => window.AdminI18n?.t(value) ?? value;
    const trigger = document.getElementById('update-terminal-rom');
    if (!trigger) return;
    const modal = document.createElement('div');
    modal.id = 'rom-update-modal';
    modal.className = 'fixed inset-0 hidden items-center justify-center bg-black bg-opacity-70 p-4';
    modal.style.zIndex = '10000';
    modal.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="rom-title" class="bg-gray-800 rounded-lg border border-gray-600 w-full text-white flex flex-col" style="max-width:900px;max-height:90vh">
      <div class="flex items-center justify-between p-4 border-b border-gray-700">
        <h3 id="rom-title" class="text-lg font-semibold">ROM 更新</h3>
        <div class="flex gap-3"><button id="rom-refresh" type="button" title="刷新" aria-label="刷新"><i class="fas fa-sync-alt" aria-hidden="true"></i></button><button id="rom-close" type="button" title="关闭" aria-label="关闭"><i class="fas fa-times" aria-hidden="true"></i></button></div>
      </div>
      <div class="p-4 overflow-y-auto space-y-4">
        <div id="rom-message" role="status" class="text-sm text-blue-300"></div>
        <div style="overflow-x:auto"><table class="w-full text-sm"><thead><tr class="text-left text-gray-400"><th class="p-2">版本 / 硬件</th><th class="p-2">大小</th><th class="p-2">状态</th><th class="p-2">操作</th></tr></thead><tbody id="rom-releases"></tbody></table></div>
        <h4 class="font-semibold">设备升级结果</h4><div id="rom-results" class="text-sm space-y-2"></div>
      </div></div>`;
    document.body.appendChild(modal);
    const el = name => modal.querySelector('#rom-' + name);
    let busy = false;
    function textCell(row, value) {
        const td = document.createElement('td'); td.className = 'p-2 border-t border-gray-700 text-gray-100'; td.textContent = value; row.appendChild(td); return td;
    }
    async function refresh() {
        if (busy) return;
        busy = true; el('refresh').disabled = true;
        el('message').textContent = '正在读取 ROM 更新目录...';
        try {
            const response = await apiService.getRomReleases();
            if (response.code !== 0) throw new Error(response.message);
            el('releases').replaceChildren();
            for (const item of response.data.releases) {
                const row = document.createElement('tr');
                textCell(row, item.version_code ? `v${item.version_code} / ${item.hardware}` : item.release_id.slice(0, 12));
                textCell(row, `${(item.image_size / 1024 / 1024).toFixed(1)} MB`);
                textCell(row, item.error || (item.published ? '已发布' : '待发布'));
                const action = document.createElement('button');
                action.type = 'button'; action.className = 'px-3 py-2 bg-gray-700 text-white rounded disabled:opacity-50';
                action.textContent = item.published ? '撤回' : '发布'; action.disabled = !!item.error && !item.published;
                action.dataset.invalid = String(action.disabled);
                action.addEventListener('click', async () => {
                    if (busy) return;
                    if (!item.published && !window.confirm(t(`发布 ROM v${item.version_code}？匹配设备下次启动将自动升级，系统数据将重建，/huoshan 保留。`))) return;
                    busy = true;
                    modal.querySelectorAll('button').forEach(button => { button.disabled = true; });
                    el('message').textContent = item.published ? '正在撤回...' : '正在校验完整 ROM 并发布...';
                    try {
                        const result = await apiService.setRomPublication(item.release_id, !item.published);
                        if (result.code !== 0) throw new Error(result.message);
                        busy = false; await refresh();
                    } catch (error) { el('message').textContent = error.message; }
                    finally {
                        busy = false; el('close').disabled = false; el('refresh').disabled = false;
                        modal.querySelectorAll('#rom-releases button').forEach(button => { button.disabled = button.dataset.invalid === 'true'; });
                        action.disabled = !!item.error && !item.published;
                        el('close').focus();
                    }
                });
                textCell(row, '').appendChild(action); el('releases').appendChild(row);
            }
            el('results').replaceChildren();
            const phases = { succeeded: '升级成功', failed: '升级失败' };
            for (const result of response.data.results) {
                const line = document.createElement('div'); line.className = 'border-t border-gray-700 py-2';
                const name = document.createElement('span'); name.translate = false; name.textContent = `${result.device_id} · v${result.version_code} · `;
                const phase = document.createElement('span'); phase.textContent = phases[result.phase] || result.phase;
                const detail = document.createElement('span'); detail.translate = false; detail.textContent = ` · ${result.message}`;
                line.append(name, phase, detail);
                el('results').appendChild(line);
            }
            if (!response.data.results.length) el('results').textContent = '暂无升级结果';
            el('message').textContent = response.data.releases.length ? '' : 'ROM 更新目录暂无升级包';
        } catch (error) { el('message').textContent = error.message; }
        finally { busy = false; el('refresh').disabled = false; }
    }
    function close() { if (!busy) { modal.classList.add('hidden'); modal.classList.remove('flex'); trigger.focus(); } }
    trigger.addEventListener('click', () => { modal.classList.remove('hidden'); modal.classList.add('flex'); el('close').focus(); refresh(); });
    el('close').addEventListener('click', close);
    el('refresh').addEventListener('click', refresh);
    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') close();
        if (event.key === 'Tab') {
            const buttons = [...modal.querySelectorAll('button:not(:disabled)')];
            if (!buttons.length) { event.preventDefault(); return; }
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
            else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
        }
    });
})();
