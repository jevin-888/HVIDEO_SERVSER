// Admin API and installation status share one camelCase contract.
(() => {
    const trigger = document.getElementById('update-terminal-app');
    if (!trigger) return;
    const modal = document.createElement('div');
    modal.id = 'app-update-modal';
    modal.className = 'fixed inset-0 hidden items-center justify-center bg-black bg-opacity-70 p-4';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
        <div role="dialog" aria-modal="true" aria-labelledby="app-update-title" class="bg-gray-800 rounded-lg border border-gray-600 shadow-xl w-full text-white flex flex-col" style="max-width:800px;max-height:90vh">
            <div class="flex items-center justify-between p-4 border-b border-gray-700">
                <h3 id="app-update-title" class="text-lg font-semibold">APP 更新</h3>
                <button type="button" id="app-update-close" aria-label="关闭 APP 更新" class="text-gray-400 hover:text-white text-2xl">×</button>
            </div>
            <div class="p-4 overflow-y-auto space-y-4">
                <p class="text-sm text-gray-400">选择 APK 和目标设备，覆盖安装并保留应用数据。设备需开启网络 ADB 并授权服务器连接。</p>
                <fieldset id="app-update-fields" class="space-y-4">
                    <div>
                        <label for="app-update-file" class="block text-sm mb-2">APP 安装包（.apk，最大 300 MB）</label>
                        <input id="app-update-file" type="file" accept=".apk,application/vnd.android.package-archive" class="w-full text-sm bg-gray-700 rounded p-2">
                        <p id="app-update-file-info" class="text-xs text-gray-400 mt-1">尚未选择安装包</p>
                    </div>
                    <div class="flex items-center gap-3">
                        <label class="text-sm"><input id="app-update-select-all" type="checkbox"> 全选在线设备</label>
                        <span id="app-update-selected" class="text-sm text-gray-400">已选 0 台</span>
                    </div>
                    <div id="app-update-devices" class="border border-gray-600 rounded overflow-y-auto" style="max-height:230px"></div>
                    <div>
                        <label class="text-sm flex items-center gap-2"><input id="app-update-allow-downgrade" type="checkbox"> 允许降级安装（保留应用数据）</label>
                        <p class="text-xs text-gray-400 mt-1">安装较低版本时勾选。需要设备系统支持，且安装包签名一致；系统拒绝时显示失败原因。</p>
                    </div>
                </fieldset>
                <p id="app-update-message" role="status" aria-live="polite" class="text-sm text-blue-300"></p>
                <div id="app-update-results" class="space-y-2"></div>
            </div>
            <div class="p-4 border-t border-gray-700 flex justify-end gap-3">
                <button type="button" id="app-update-retry" class="hidden bg-gray-700 hover:bg-gray-600 rounded px-4 py-2">重新获取状态</button>
                <button type="button" id="app-update-start" class="bg-blue-600 hover:bg-blue-500 rounded px-4 py-2 disabled:opacity-50" disabled>开始安装</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    const el = id => modal.querySelector(`#app-update-${id}`);
    let devices = [];
    let task = null;
    let timer = null;
    let generation = 0;
    let uploading = false;
    let ready = false;
    const selected = () => [...el('devices').querySelectorAll('input:checked')].map(input => input.value);
    const running = () => task?.status === 'running';
    const message = text => { el('message').textContent = text; };

    function updateControls() {
        const count = selected().length;
        el('selected').textContent = `已选 ${count} 台`;
        const online = devices.filter(device => device.onlineStatus === 1).length;
        el('select-all').checked = online > 0 && count === online;
        el('select-all').indeterminate = count > 0 && count < online;
        el('fields').disabled = !ready || uploading || running();
        el('start').disabled = !ready || uploading || running() || count === 0 || count > 50 || !el('file').files[0];
        el('start').textContent = uploading ? '正在上传…' : running() ? '安装中…' : '开始安装';
        el('close').disabled = uploading;
    }

    function parts(element, values) {
        element.replaceChildren(...values.map(value => {
            const span = document.createElement('span');
            if (typeof value === 'object') { span.translate = false; span.textContent = value.raw; }
            else span.textContent = value;
            return span;
        }));
    }

    function renderDevices() {
        const list = el('devices');
        list.replaceChildren();
        if (!devices.length) { list.textContent = '暂无设备，请先在设备管理中扫描或添加终端。'; return; }
        for (const device of devices) {
            const label = document.createElement('label');
            label.className = 'flex items-center gap-3 px-3 py-2 border-b border-gray-700 text-sm';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = device.id;
            input.disabled = device.onlineStatus !== 1;
            input.addEventListener('change', updateControls);
            const text = document.createElement('span');
            parts(text, [device.name ? {raw:device.name} : '未命名设备', ' · ', {raw:device.terminalIp}, ' · ', device.softwareVer ? {raw:device.softwareVer} : '版本未知', ' · ', device.onlineStatus === 1 ? '在线' : '离线']);
            if (input.disabled) label.classList.add('text-gray-500');
            label.append(input, text);
            list.append(label);
        }
    }

    function renderTask() {
        el('results').replaceChildren();
        if (!task) { updateControls(); return; }
        const labels = { queued: '等待', connecting: '连接中', installing: '安装中', succeeded: '成功', failed: '失败' };
        for (const device of task.devices) {
            const row = document.createElement('div');
            row.className = 'rounded bg-gray-900 p-3 text-sm';
            const title = document.createElement('div');
            title.className = device.status === 'failed' ? 'text-red-400' : device.status === 'succeeded' ? 'text-green-400' : 'text-blue-300';
            parts(title, [{raw:`${device.name} (${device.terminalIp})`}, ' · ', labels[device.status] || device.status]);
            const detail = document.createElement('p');
            detail.className = 'text-gray-400 text-xs mt-1 whitespace-pre-wrap break-words';
            detail.textContent = device.message;
            row.append(title, detail);
            el('results').append(row);
        }
        const succeeded = task.devices.filter(device => device.status === 'succeeded').length;
        const failed = task.devices.filter(device => device.status === 'failed').length;
        if (running()) el('allow-downgrade').checked = task.allowDowngrade === true;
        parts(el('message'), [{raw:task.fileName}, ' · ', task.allowDowngrade ? '允许降级' : '普通更新', ' · ', running() ? '正在安装，可关闭窗口，任务继续执行' : '任务已结束', ' · ', `成功 ${succeeded} / 失败 ${failed} / 共 ${task.devices.length} 台`]);
        updateControls();
    }

    async function poll(version) {
        if (version !== generation || !running()) return;
        try {
            const response = await apiService.getAppUpdate(task.taskId);
            if (version !== generation) return;
            task = response.data;
            renderTask();
            if (running()) timer = setTimeout(() => poll(version), 1500);
        } catch (error) {
            if (version !== generation) return;
            message(`无法获取安装结果：${error.message}。任务可能仍在执行，请重新获取状态。`);
            ready = false;
            el('retry').classList.remove('hidden');
            updateControls();
        }
    }

    async function refresh() {
        clearTimeout(timer);
        const version = ++generation;
        ready = false;
        updateControls();
        el('retry').classList.add('hidden');
        message('正在获取设备和安装任务…');
        try {
            const [terminals, latest] = await Promise.all([apiService.getTerminals(), apiService.getLatestAppUpdate()]);
            if (version !== generation) return;
            devices = terminals.data || [];
            task = latest.data;
            ready = true;
            renderDevices();
            message('请选择安装包和设备，最多同时选择 50 台。');
            renderTask();
            if (running()) timer = setTimeout(() => poll(version), 1500);
        } catch (error) {
            if (version !== generation) return;
            message(error.message || '加载失败，请重试');
            el('retry').classList.remove('hidden');
        }
    }

    trigger.addEventListener('click', () => {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        el('close').focus();
        refresh();
    });
    function close() {
        if (uploading) return;
        ++generation;
        clearTimeout(timer);
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        trigger.focus();
    }
    el('close').addEventListener('click', close);
    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') close();
        if (event.key === 'Tab') {
            const focusable = [...modal.querySelectorAll('button, input')].filter(node => !node.disabled && node.getClientRects().length);
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
    });
    el('retry').addEventListener('click', refresh);
    el('select-all').addEventListener('change', () => {
        for (const input of el('devices').querySelectorAll('input:not(:disabled)')) input.checked = el('select-all').checked;
        updateControls();
    });
    el('file').addEventListener('change', () => {
        const file = el('file').files[0];
        el('file-info').textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : '尚未选择安装包';
        if (!task) message('请选择安装包和设备，最多同时选择 50 台。');
        updateControls();
    });
    el('start').addEventListener('click', async () => {
        if (!ready || uploading || running()) return;
        const apk = el('file').files[0];
        const ids = selected();
        if (!apk || !/\.apk$/i.test(apk.name) || apk.size === 0 || apk.size > 300 * 1024 * 1024) {
            message('请选择非空的 .apk 文件，最大 300 MB。'); return;
        }
        if (!ids.length || ids.length > 50) { message('请选择 1–50 台在线设备。'); return; }
        uploading = true;
        updateControls();
        el('results').replaceChildren();
        message(`正在上传 ${apk.name}，完成后将安装到 ${ids.length} 台设备，请保持页面打开…`);
        try {
            const response = await apiService.startAppUpdate(apk, ids, el('allow-downgrade').checked);
            task = response.data;
            el('file').value = '';
            el('file-info').textContent = '尚未选择安装包';
            renderTask();
            timer = setTimeout(() => poll(generation), 500);
        } catch (error) {
            // A lost HTTP response does not prove the server failed to start the job.
            ready = false;
            message(`${error.message}。请重新获取状态，确认任务是否已启动。`);
            el('retry').classList.remove('hidden');
        } finally {
            uploading = false;
            updateControls();
        }
    });
})();
