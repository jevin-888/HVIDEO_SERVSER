// 全局变量
let currentFilters = { keyword: '', language: '', category: '' };
let currentUser = null;
let currentSection = 'dashboard';
let sidebarCollapsed = false;
let roomTypes = [];
let roomAreas = [];
let activeType = 'all';
let activeArea = 'all';
let contextMenuTargetId = null;
let roomClientPanelCollapsed = true;
let currentBillingSessionId = null;
let iptvStreams = [];
let currentLicenseStatus = null;
let licenseStatusPollingTimer = null;
let loginServerNetwork = {
    configuredHost: '',
    configuredPort: 9898,
    configuredAvailable: false,
};
let loginNetworkSwitching = false;

// DOM 元素
const loginPage = document.getElementById('login-page');
const adminPage = document.getElementById('admin-page');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const adminUsername = document.getElementById('admin-username');
const logoutBtn = document.getElementById('logout-btn');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');
const adminMain = document.getElementById('admin-main');
const pageTitle = document.getElementById('page-title');
const loadingOverlay = document.getElementById('loading-overlay');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const compactSidebarMedia = window.matchMedia('(max-width: 1180px)');

function applySidebarState(collapsed) {
    sidebarCollapsed = collapsed;
    sidebar?.classList.toggle('collapsed', collapsed);
    adminMain?.classList.toggle('expanded', collapsed);

    const compactLayout = compactSidebarMedia.matches;
    document.body.classList.toggle('compact-layout', compactLayout);
    document.body.classList.toggle('sidebar-open', compactLayout && !collapsed);

    const statusBar = document.getElementById('main-status-bar');
    if (statusBar) {
        statusBar.classList.toggle('left-64', !collapsed && !compactLayout);
        statusBar.classList.toggle('left-0', collapsed || compactLayout);
    }

    sidebarToggle?.setAttribute('aria-expanded', String(!collapsed));
}

function initResponsiveLayout() {
    const syncLayout = event => applySidebarState(Boolean(event?.matches ?? compactSidebarMedia.matches));
    syncLayout(compactSidebarMedia);

    if (typeof compactSidebarMedia.addEventListener === 'function') {
        compactSidebarMedia.addEventListener('change', syncLayout);
    } else {
        compactSidebarMedia.addListener(syncLayout);
    }

    sidebarBackdrop?.addEventListener('click', () => applySidebarState(true));
}

// 运行监控相关
let syslogEventSource = null;
let syslogPaused = false;
let syslogAutoScroll = true;
let syslogShowHeartbeat = true;
let syslogFilterKeyword = '';
let syslogFilterLevel = 'INFO';
let serverRestartUnlisten = null;
let settingsServerOperationPending = false;
let settingsServerPort = null;

function appendServerRestartStatus(payload) {
    if (!payload || typeof payload.phase !== 'string' || typeof payload.message !== 'string' || typeof payload.timestamp !== 'number') {
        console.error('Invalid server-restart-status payload:', payload);
        return;
    }

    const phases = new Set(['stopping', 'starting', 'ready', 'failed']);
    if (!phases.has(payload.phase)) {
        console.error('Unknown server restart phase:', payload.phase);
        return;
    }

    const container = document.getElementById('syslog-container');
    if (container) {
        const placeholder = container.firstElementChild;
        if (container.children.length === 1 && placeholder?.classList.contains('italic')) {
            container.innerHTML = '';
        }

        const line = document.createElement('div');
        line.dataset.restartEvent = '1';
        line.className = payload.phase === 'failed'
            ? 'mb-1 break-all px-1 rounded text-red-400 font-bold'
            : payload.phase === 'ready'
                ? 'mb-1 break-all px-1 rounded text-green-300 font-bold'
                : 'mb-1 break-all px-1 rounded text-yellow-300';
        const time = new Date(payload.timestamp).toLocaleString(window.AdminI18n?.locale || 'zh-CN', { hour12: false });
        line.textContent = `${time} [SERVER:${payload.phase.toUpperCase()}] ${payload.message}`;
        container.appendChild(line);
        if (container.children.length > 2000) {
            container.removeChild(container.firstChild);
        }
        if (syslogAutoScroll) {
            container.scrollTop = container.scrollHeight;
        }
    }

    const statusEl = document.getElementById('tauri-server-status');
    if (statusEl) {
        statusEl.textContent = payload.phase === 'ready'
            ? '服务器运行中'
            : payload.phase === 'failed'
                ? '服务器重启失败'
                : '服务器正在重启';
    }
    const messageEl = document.getElementById('tauri-test-msg');
    if (messageEl) {
        messageEl.textContent = payload.message;
        messageEl.classList.toggle('text-red-400', payload.phase === 'failed');
    }
    const restartButton = document.getElementById('tauri-btn-restart');
    if (restartButton) {
        restartButton.disabled = settingsServerOperationPending || payload.phase === 'stopping' || payload.phase === 'starting';
    }

    if (payload.phase === 'ready') {
        showToast(payload.message, 'success');
    } else if (payload.phase === 'failed') {
        showToast(payload.message, 'error');
    }
}

async function setupServerRestartEvents() {
    if (serverRestartUnlisten || !window.__TAURI__?.event?.listen) return;
    try {
        serverRestartUnlisten = await window.__TAURI__.event.listen('server-restart-status', event => {
            appendServerRestartStatus(event.payload);
        });
    } catch (error) {
        console.error('Failed to listen for server restart status:', error);
    }
}

// 导航项
const navItems = document.querySelectorAll('.nav-item');

// 内容部分
const sections = document.querySelectorAll('.section-content');

let loadingTimeoutRef = null;

// 工具函数
function showLoading() {
    if (loadingTimeoutRef) clearTimeout(loadingTimeoutRef);
    loadingTimeoutRef = setTimeout(() => {
        loadingOverlay.classList.remove('hidden');
    }, 200);
}

function hideLoading() {
    if (loadingTimeoutRef) {
        clearTimeout(loadingTimeoutRef);
        loadingTimeoutRef = null;
    }
    loadingOverlay.classList.add('hidden');
}

function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(message, type = 'success', duration = 2500) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = {
        success: '<i class="fas fa-check"></i>',
        error: '<i class="fas fa-times"></i>',
        info: '<i class="fas fa-info"></i>'
    };
    const toast = document.createElement('div');
    toast.className = `admin-toast admin-toast-${type}`;
    toast.innerHTML = `<span class="admin-toast-icon">${icons[type] || icons.info}</span><span class="admin-toast-text">${escapeHtml(String(message))}</span>`;
    container.appendChild(toast);
    const removeToast = () => {
        toast.classList.add('admin-toast-slide-out');
        setTimeout(() => toast.remove(), 300);
    };
    const tid = setTimeout(removeToast, duration);
    toast.addEventListener('click', () => {
        clearTimeout(tid);
        removeToast();
    });
}

function showConfirm(message) {
    return new Promise((resolve) => {
        const container = document.getElementById('confirm-container');
        if (!container) {
            resolve(false);
            return;
        }
        const backdrop = document.createElement('div');
        backdrop.className = 'admin-confirm-backdrop';
        backdrop.innerHTML = `
            <div class="admin-confirm-box">
                <div class="admin-confirm-message">${escapeHtml(String(message))}</div>
                <div class="admin-confirm-btns">
                    <button type="button" class="admin-confirm-btn admin-confirm-cancel">取消</button>
                    <button type="button" class="admin-confirm-btn admin-confirm-ok">确定</button>
                </div>
            </div>
        `;
        const remove = (result) => {
            backdrop.remove();
            resolve(result);
        };
        backdrop.querySelector('.admin-confirm-cancel').addEventListener('click', () => remove(false));
        backdrop.querySelector('.admin-confirm-ok').addEventListener('click', () => remove(true));
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) remove(false);
        });
        container.appendChild(backdrop);
    });
}

function showPrompt(message, defaultValue = '') {
    return new Promise((resolve) => {
        const container = document.getElementById('confirm-container');
        if (!container) {
            resolve(null);
            return;
        }
        const backdrop = document.createElement('div');
        backdrop.className = 'admin-confirm-backdrop';
        backdrop.innerHTML = `
            <div class="admin-prompt-box">
                <div class="admin-confirm-message">${escapeHtml(String(message))}</div>
                <input type="text" class="admin-prompt-input" value="${escapeHtml(String(defaultValue))}" placeholder="">
                <div class="admin-confirm-btns">
                    <button type="button" class="admin-confirm-btn admin-confirm-cancel">取消</button>
                    <button type="button" class="admin-confirm-btn admin-confirm-ok">确定</button>
                </div>
            </div>
        `;
        const box = backdrop.querySelector('.admin-prompt-box');
        const input = backdrop.querySelector('.admin-prompt-input');
        const remove = (result) => {
            backdrop.remove();
            resolve(result);
        };
        backdrop.querySelector('.admin-confirm-cancel').addEventListener('click', () => remove(null));
        backdrop.querySelector('.admin-confirm-ok').addEventListener('click', () => remove(input.value.trim() || null));
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) remove(null);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') remove(input.value.trim() || null);
            if (e.key === 'Escape') remove(null);
        });
        container.appendChild(backdrop);
        input.focus();
    });
}

function showSection(sectionId) {
    // 隐藏所有部分
    sections.forEach(section => {
        section.classList.add('hidden');
    });

    // 切换日志监控：如果切出日志页，关闭连接
    if (currentSection === 'syslogs' && sectionId !== 'syslogs') {
        closeSyslogConnection();
    }

    // 显示选中部分
    const selectedSection = document.getElementById(`${sectionId}-section`);
    if (selectedSection) {
        selectedSection.classList.remove('hidden');
    }

    // 更新当前部分
    currentSection = sectionId;

    // 更新页面标题
    const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
    if (navItem) {
        pageTitle.textContent = window.AdminI18n?.sourceText(navItem.querySelector('span')) ?? navItem.querySelector('span').textContent;
    }

    // 更新导航项状态
    navItems.forEach(item => {
        item.classList.remove('active');
    });
    if (navItem) navItem.classList.add('active');

    // 触发各板块特定初始化
    if (sectionId === 'settings') {
        if (typeof setupSystemSettings === 'function') {
            setupSystemSettings();
        }
        if (typeof loadSettingsServerInfo === 'function') {
            loadSettingsServerInfo();
        }
    } else if (sectionId === 'rooms') {
        setupPadOrderingToggle();
        loadPadOrderingStatus();
    } else if (sectionId === 'syslogs') {
        setupSyslogs();
    } else if (sectionId === 'dicts') {
        window.dictionaryPage?.load();
    }
}

// 实时运行监控逻辑
function closeSyslogConnection() {
    if (!syslogEventSource) return;
    syslogEventSource.onopen = null;
    syslogEventSource.onmessage = null;
    syslogEventSource.onerror = null;
    syslogEventSource.close();
    syslogEventSource = null;
}

function setupSyslogs() {
    const container = document.getElementById('syslog-container');
    const pauseBtn = document.getElementById('syslog-pause-btn');
    const clearBtn = document.getElementById('syslog-clear-btn');
    if (!container) return;

    if (syslogEventSource || settingsServerOperationPending) return;

    const levelFilter = document.getElementById('syslog-level-filter');
    const keywordFilter = document.getElementById('syslog-keyword-filter');
    const heartbeatToggle = document.getElementById('syslog-heartbeat-toggle');

    if (!pauseBtn.dataset.bound) {
        pauseBtn.addEventListener('click', () => {
            syslogPaused = !syslogPaused;
            pauseBtn.innerHTML = syslogPaused ? '<i class="fas fa-play mr-2 text-xs"></i> 继续' : '<i class="fas fa-pause mr-2 text-xs"></i> 暂停';
            if (!syslogPaused) {
                syslogAutoScroll = true;
            }
        });
        clearBtn.addEventListener('click', () => {
            container.innerHTML = '<div class="text-gray-500 italic">日志已清空</div>';
        });
        container.addEventListener('scroll', () => {
            const atBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 40;
            syslogAutoScroll = atBottom;
        });

        // 绑定新过滤器
        if (levelFilter) {
            levelFilter.addEventListener('change', () => {
                syslogFilterLevel = levelFilter.value;
            });
        }
        if (keywordFilter) {
            keywordFilter.addEventListener('input', () => {
                syslogFilterKeyword = keywordFilter.value.trim().toLowerCase();
            });
        }
        if (heartbeatToggle) {
            heartbeatToggle.addEventListener('change', () => {
                syslogShowHeartbeat = heartbeatToggle.checked;
            });
        }

        pauseBtn.dataset.bound = "true";
    }

    const token = localStorage.getItem('admin_token');
    const apiBase = window.apiService && apiService.baseUrl ? apiService.baseUrl : '/api/v1';
    const sseUrl = `${apiBase.replace(/\/$/, '')}/system/logs?token=${encodeURIComponent(token || '')}`;
    syslogEventSource = new EventSource(sseUrl);
    let syslogConnected = false;
    let syslogErrorShown = false;

    const appendSyslogLine = (text, className) => {
        const line = document.createElement('div');
        line.className = className || 'mb-1 break-all hover:bg-white/5 transition-colors px-1 rounded';
        line.innerHTML = text;
        container.appendChild(line);
        if (container.children.length > 2000) {
            container.removeChild(container.firstChild);
        }
        if (syslogAutoScroll) {
            container.scrollTop = container.scrollHeight;
        }
    };

    syslogEventSource.onopen = () => {
        syslogConnected = true;
        syslogErrorShown = false;
        const first = container.firstElementChild;
        if (first && (window.AdminI18n?.sourceText(first) ?? first.textContent).includes('正在连接实时日志流')) {
            container.innerHTML = '';
        }
    };

    syslogEventSource.onmessage = (event) => {
        if (syslogPaused) return;

        const data = event.data;
        if (!syslogConnected || data.includes('Server log monitor connected')) {
            syslogConnected = true;
            const first = container.firstElementChild;
            if (first && (window.AdminI18n?.sourceText(first) ?? first.textContent).includes('正在连接实时日志流')) {
                container.innerHTML = '';
            }
            if (data.includes('Server log monitor connected')) {
                return;
            }
        }
        const lowerData = data.toLowerCase();

        // 1. 心跳过滤
        // 匹配常见的终端心跳或WS心跳标识
        const isHeartbeat = lowerData.includes('heartbeat') || lowerData.includes('[ping]') || lowerData.includes('[pong]');
        if (!syslogShowHeartbeat && isHeartbeat) return;

        // 2. 级别过滤
        if (syslogFilterLevel !== 'ALL') {
             const levels = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'];
             const currentIdx = levels.indexOf(syslogFilterLevel);

             let msgLevel = 'INFO';
             if (data.includes(' ERROR ')) msgLevel = 'ERROR';
             else if (data.includes(' WARN ')) msgLevel = 'WARN';
             else if (data.includes(' INFO ')) msgLevel = 'INFO';
             else if (data.includes(' DEBUG ')) msgLevel = 'DEBUG';
             else if (data.includes(' TRACE ')) msgLevel = 'TRACE';

             const msgIdx = levels.indexOf(msgLevel);
             if (msgIdx < currentIdx) return;
        }

        // 3. 关键字过滤
        if (syslogFilterKeyword && !lowerData.includes(syslogFilterKeyword)) {
            return;
        }

        let html = escapeHtml(data);
        if (html.includes(' INFO ')) {
            html = html.replace(' INFO ', '<span class="text-blue-400"> INFO </span>');
        } else if (html.includes(' WARN ')) {
            html = html.replace(' WARN ', '<span class="text-yellow-500 font-bold"> WARN </span>');
        } else if (html.includes(' ERROR ')) {
            html = html.replace(' ERROR ', '<span class="text-red-500 font-bold"> ERROR </span>');
        } else if (html.includes(' DEBUG ')) {
            html = html.replace(' DEBUG ', '<span class="text-gray-500"> DEBUG </span>');
        }
        appendSyslogLine(html);
    };

    syslogEventSource.onerror = (e) => {
        console.error('Syslog SSE Error:', e);
        syslogConnected = false;
        if (!syslogErrorShown) {
            appendSyslogLine('[监控] 连接中断或认证失败，正在重连...', 'text-red-400 italic mb-1');
            syslogErrorShown = true;
        }
        if (syslogEventSource && syslogEventSource.readyState === EventSource.CLOSED) {
            syslogEventSource = null;
        }
    };
}

const expandedTerminalConnections = new Set();
const selectedTerminalIds = new Set();
let terminalDeletionPending = false;
let terminalConfigProfiles = [];
let terminalConfigSaving = false;

function syncTerminalSelection() {
    const checkboxes = [...document.querySelectorAll('#terminals-table .terminal-select')];
    for (const checkbox of checkboxes) {
        checkbox.checked = selectedTerminalIds.has(checkbox.closest('tr').dataset.terminalId);
        checkbox.disabled = terminalDeletionPending;
    }
    const selectAll = document.getElementById('select-all-terminals');
    if (selectAll) {
        const count = checkboxes.filter(checkbox => checkbox.checked).length;
        selectAll.checked = count > 0 && count === checkboxes.length;
        selectAll.indeterminate = count > 0 && count < checkboxes.length;
        selectAll.disabled = terminalDeletionPending || checkboxes.length === 0;
    }
    const button = document.getElementById('delete-selected-terminals');
    if (button) button.disabled = terminalDeletionPending || selectedTerminalIds.size === 0;
    const count = document.getElementById('terminal-selection-count');
    if (count) count.textContent = `（${selectedTerminalIds.size}）`;
    document.querySelectorAll('.terminal-delete').forEach(button => { button.disabled = terminalDeletionPending; });
    const search = document.getElementById('terminal-search');
    if (search) search.disabled = terminalDeletionPending;
}

document.getElementById('select-all-terminals')?.addEventListener('change', event => {
    document.querySelectorAll('#terminals-table tr[data-terminal-id]').forEach(row => {
        if (event.target.checked) selectedTerminalIds.add(row.dataset.terminalId);
        else selectedTerminalIds.delete(row.dataset.terminalId);
    });
    syncTerminalSelection();
});

document.getElementById('delete-selected-terminals')?.addEventListener('click', () => {
    const terminals = (window.allTerminalsCache || []).filter(terminal => selectedTerminalIds.has(terminal.id));
    deleteTerminals(terminals);
});

async function saveTerminalConfigProfile(terminal, mode) {
    if (terminalConfigSaving || !['template', 'default', 'custom'].includes(mode)) return;
    terminalConfigSaving = true;
    document.querySelectorAll('.terminal-config-mode, .terminal-config-save').forEach(el => { el.disabled = true; });
    try {
        await apiService.captureTerminalConfig(terminal.id, mode);
        showToast(mode === 'template' ? '公共模板已保存，默认终端下次启动时加载'
            : mode === 'custom' ? `自定义配置已保存，${terminal.terminalIp} 下次启动时加载`
            : '已设为默认，下次启动时跟随公共模板', 'success');
    } catch (error) {
        showToast(error.message || '终端配置保存失败', 'error');
    } finally {
        terminalConfigSaving = false;
        await loadTerminals();
    }
}

function terminalHardwareInfo(terminal) {
    try { return JSON.parse(terminal.hardwareInfo || '{}') || {}; }
    catch { return {}; }
}

function renderTerminalConnections(terminal) {
    const connections = Array.isArray(terminal.connections) ? terminal.connections : [];
    const kinds = [['ethernet', '有线网络'], ['wifi', '无线网络']];
    if (connections.some(connection => connection.networkType === 'unknown')) {
        kinds.push(['unknown', '未识别的连接（旧版播放器）']);
    }
    const rows = kinds.map(([kind, label]) => {
        const connection = connections.find(item => item.networkType === kind);
        const online = connection?.onlineStatus === 1;
        const primary = online && connection.ipAddress === terminal.terminalIp;
        const state = !connection ? '<span class="text-gray-500">未上报</span>'
            : `<span class="badge ${online ? 'badge-online' : 'badge-offline'}">${online ? '在线' : '离线'}</span>`;
        return `<tr data-network-type="${kind}">
            <td class="px-4 py-3 text-gray-200">${label}${primary ? ' <span class="text-blue-400 text-xs">当前使用</span>' : ''}</td>
            <td class="px-4 py-3 font-mono">${escapeHtml(connection?.interfaceName || '-')}</td>
            <td class="px-4 py-3 font-mono">${escapeHtml(connection?.ipAddress || '-')}</td>
            <td class="px-4 py-3 font-mono">${escapeHtml(connection?.macAddress || '-')}</td>
            <td class="px-4 py-3">${state}</td>
            <td class="px-4 py-3">${escapeHtml(connection?.lastHeartbeat || '-')}</td>
        </tr>`;
    }).join('');
    return `<td colspan="9" class="px-6 pb-4 pt-1 bg-gray-900">
        <table class="w-full text-left text-sm text-gray-400 divide-y divide-gray-700">
            <caption class="text-left text-gray-400 py-2">网络连接 · 同一设备共用房间和授权名额</caption>
            <thead><tr>${['连接', '网卡', 'IP 地址', '网卡 MAC', '状态', '最后心跳'].map(label => `<th class="px-4 py-2 font-medium">${label}</th>`).join('')}</tr></thead>
            <tbody class="divide-y divide-gray-800">${rows}</tbody>
        </table></td>`;
}

// One row per physical player, with independently observed network connections.
async function loadTerminals(fetchData = true) {
    const terminalsTable = document.getElementById('terminals-table');
    if (!terminalsTable) return;
    try {
        let terminals;
        if (fetchData) {
            showLoading();
            const [response, profiles] = await Promise.all([
                apiService.getTerminals(), apiService.getTerminalConfigProfiles()
            ]);
            terminalConfigProfiles = profiles.data || [];
            terminals = response.data || [];
            window.allTerminalsCache = terminals;
            const ids = new Set(terminals.map(terminal => terminal.id));
            for (const id of expandedTerminalConnections) {
                if (!ids.has(id)) expandedTerminalConnections.delete(id);
            }
        } else {
            terminals = window.allTerminalsCache || [];
        }
        const keyword = (document.getElementById('terminal-search')?.value || '').trim().toLowerCase();
        const filteredTerminals = terminals.filter(terminal => {
            if (!keyword) return true;
            const hardware = terminalHardwareInfo(terminal);
            const connectionValues = (terminal.connections || []).flatMap(connection => [connection.ipAddress, connection.macAddress, connection.interfaceName]);
            return [terminal.id, terminal.serial, hardware.serial, terminal.name, terminal.terminalIp, terminal.macAddress, ...connectionValues]
                .some(value => String(value || '').toLowerCase().includes(keyword));
        });
        // Never keep hidden search results selected for a destructive action.
        const visibleIds = new Set(filteredTerminals.map(terminal => terminal.id));
        for (const id of selectedTerminalIds) {
            if (!visibleIds.has(id)) selectedTerminalIds.delete(id);
        }
        terminalsTable.innerHTML = '';
        if (filteredTerminals.length === 0) {
            terminalsTable.innerHTML = '<tr><td colspan="9" class="px-6 py-8 text-center text-gray-400">暂无符合条件的终端</td></tr>';
            return;
        }
        filteredTerminals.forEach(terminal => {
            const row = document.createElement('tr');
            row.dataset.terminalId = terminal.id;
            const hardware = terminalHardwareInfo(terminal);
            const serial = terminal.serial || hardware.serial || '-';
            const statusBadge = terminal.onlineStatus === 1
                ? '<span class="badge badge-online">在线</span>'
                : '<span class="badge badge-offline">离线</span>';
            row.innerHTML = `<td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300 font-mono">
                    <input type="checkbox" class="terminal-select mr-2" aria-label="选择终端 ${escapeHtml(serial)}">
                    <button type="button" class="terminal-connections-toggle text-blue-400 mr-2 p-1"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>${escapeHtml(serial)}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${escapeHtml(terminal.name || '-')}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300 font-mono">${escapeHtml(terminal.terminalIp || '-')}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300 font-mono">${escapeHtml(terminal.macAddress || '-')}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${escapeHtml(hardware.model || '-')}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">${statusBadge}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${escapeHtml(terminal.lastHeartbeat || '-')}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm"><div class="flex items-center gap-2">
                    <select class="terminal-config-mode bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-100" aria-label="配置属性">
                        <option value="default">默认</option><option value="template">模板</option><option value="custom">自定义</option>
                    </select>
                    <button type="button" class="terminal-config-save text-blue-400 hover:text-blue-300" title="重新下载当前配置到服务器" aria-label="重新保存终端配置"><i class="fas fa-save"></i></button>
                </div></td>
                <td class="px-6 py-4 whitespace-nowrap text-sm"><div class="flex items-center gap-4">
                    <button type="button" class="terminal-settings text-blue-400 hover:text-blue-300" title="设置终端" aria-label="设置终端"><i class="fas fa-cog"></i></button>
                    <button type="button" class="terminal-delete text-red-400 hover:text-red-300" title="删除终端" aria-label="删除终端"><i class="fas fa-trash"></i></button>
                </div></td>`;
            const detail = document.createElement('tr');
            detail.id = `terminal-connections-${terminal.id}`;
            detail.className = 'terminal-connections-detail';
            detail.innerHTML = renderTerminalConnections(terminal);
            const toggle = row.querySelector('.terminal-connections-toggle');
            toggle.setAttribute('aria-controls', detail.id);
            const syncExpanded = () => {
                const expanded = expandedTerminalConnections.has(terminal.id);
                detail.hidden = !expanded;
                toggle.setAttribute('aria-expanded', String(expanded));
                toggle.setAttribute('aria-label', `${expanded ? '收起' : '展开'} ${serial} 的网络连接`);
                toggle.title = expanded ? '收起网络连接' : '查看有线和无线连接';
                toggle.firstElementChild.className = `fas fa-chevron-${expanded ? 'down' : 'right'}`;
            };
            toggle.addEventListener('click', () => {
                if (expandedTerminalConnections.has(terminal.id)) expandedTerminalConnections.delete(terminal.id);
                else expandedTerminalConnections.add(terminal.id);
                syncExpanded();
            });
            row.querySelector('.terminal-settings').addEventListener('click', () => openTerminalSettings(terminal.terminalIp));
            row.querySelector('.terminal-delete').addEventListener('click', () => deleteTerminal(terminal.id, terminal.name));
            row.querySelector('.terminal-select').addEventListener('change', event => {
                if (event.target.checked) selectedTerminalIds.add(terminal.id);
                else selectedTerminalIds.delete(terminal.id);
                syncTerminalSelection();
            });
            const profile = terminalConfigProfiles.find(p => p.terminalId === terminal.id &&
                (p.mode === 'template' || p.sourceIp === terminal.terminalIp));
            const modeSelect = row.querySelector('.terminal-config-mode');
            const saveButton = row.querySelector('.terminal-config-save');
            modeSelect.value = profile?.mode || 'default';
            modeSelect.title = profile ? `已保存：${profile.sourceIp} · ${new Date(profile.updatedAt * 1000).toLocaleString()}`
                : '默认：跟随公共模板；模板：唯一公共配置，选定后其余终端回到默认；自定义：当前 IP 专属配置';
            // Default follows the template; it is never a locked device mode.
            // The server verifies live connectivity when capturing a profile.
            modeSelect.disabled = terminalConfigSaving;
            const templateTaken = terminalConfigProfiles.some(p => p.mode === 'template' && p.terminalId !== terminal.id);
            const templateOption = modeSelect.querySelector('option[value="template"]');
            templateOption.disabled = templateTaken;
            templateOption.title = templateTaken ? '已有模板设备，请先取消原模板后再选择' : '';
            saveButton.disabled = terminalConfigSaving || !profile;
            modeSelect.addEventListener('change', () => saveTerminalConfigProfile(terminal, modeSelect.value));
            saveButton.addEventListener('click', () => saveTerminalConfigProfile(terminal, modeSelect.value));
            syncExpanded();
            terminalsTable.append(row, detail);
        });
    } catch (error) {
        console.error('加载终端失败:', error);
        showToast('加载终端失败，请重试', 'error');
    } finally {
        syncTerminalSelection();
        if (fetchData) hideLoading();
    }
}

// 打开终端调试/配置页面
async function openTerminalSettings(terminalIp) {
    const ip = String(terminalIp || '').trim();
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split('.').some(part => Number(part) > 255)) {
        showToast('该终端没有有效的 IP 地址', 'error');
        return;
    }
    const invoke = getTauriInvoke();
    if (invoke) {
        try {
            await invoke('open_terminal_settings', { terminalIp: ip });
            return;
        } catch (error) {
            const message = String(error?.message || error);
            // 旧桌面程序尚未注册此命令时，使用同页设置面板。
            if (!/command\s+[`'"]?open_terminal_settings[`'"]?\s+not found/i.test(message)) {
                showToast(`打开终端设置失败：${message}`, 'error');
                return;
            }
        }
    }
    const dialog = document.getElementById('terminal-settings-dialog');
    const frame = document.getElementById('terminal-settings-frame');
    document.getElementById('terminal-settings-title').textContent = `终端设置 - ${ip}`;
    frame.src = `http://${ip}/login.html?terminalAutoLogin=1`;
    if (!dialog.open) dialog.showModal();
}

document.getElementById('terminal-settings-dialog')?.addEventListener('close', () => {
    document.getElementById('terminal-settings-frame').src = 'about:blank';
});

const terminalSearchInput = document.getElementById('terminal-search');
if (terminalSearchInput) {
    terminalSearchInput.addEventListener('input', () => loadTerminals(false));
}

async function loadUsers() {
    const usersTable = document.getElementById('users-table');
    if (!usersTable) return;
    try {
        showLoading();
        const data = await apiService.request('/admin/employees');
        const users = data.data || [];
        usersTable.innerHTML = '';
        if (users.length === 0) {
            usersTable.innerHTML = '<tr><td colspan="6" class="px-6 py-8 text-center text-gray-400">暂无员工账号，请添加</td></tr>';
            return;
        }
        const roleMap = { admin: '管理员', cashier: '收银员', waiter: '服务员' };
        users.forEach(u => {
            const statusBadge = Number(u.enabled) === 1
                ? '<span class="badge badge-online">启用</span>'
                : '<span class="badge badge-offline">禁用</span>';
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300 font-mono">${escapeHtml(u.employeeNo)}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-white">${escapeHtml(u.name)}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${escapeHtml(roleMap[u.roleId] || u.roleId)}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm">${statusBadge}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${escapeHtml(u.updatedAt || u.createdAt || '-')}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-500">员工账号</td>
            `;
            usersTable.appendChild(row);
        });
    } catch (error) {
        console.error('加载员工账号失败:', error);
        showToast('加载员工账号失败，请重试', 'error');
    } finally {
        hideLoading();
    }
}
function openAddUserModal() {
    document.getElementById('add-user-client-key').value = '';
    document.getElementById('add-user-client-secret').value = '';
    document.getElementById('add-user-client-name').value = '';
    document.querySelectorAll('input[name="add-user-perm"]').forEach(cb => cb.checked = false);
    document.getElementById('add-user-modal').classList.remove('hidden');
}

function setupUserManagement() {
    const addBtn = document.getElementById('add-user-btn');
    if (addBtn) addBtn.addEventListener('click', openAddUserModal);

    const cancelAdd = document.getElementById('cancel-add-user');
    if (cancelAdd) cancelAdd.addEventListener('click', () => document.getElementById('add-user-modal').classList.add('hidden'));

    const addForm = document.getElementById('add-user-form');
    if (addForm) {
        addForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const employeeNo = (document.getElementById('add-user-client-key').value || '').trim();
            const password = (document.getElementById('add-user-client-secret').value || '');
            const name = (document.getElementById('add-user-client-name').value || '').trim();
            const roleId = document.getElementById('add-user-role')?.value || 'cashier';
            if (!employeeNo || employeeNo.length < 2) {
                showToast('登录账号至少 2 个字符', 'error');
                return;
            }
            if (!name) {
                showToast('请填写员工名称', 'error');
                return;
            }
            if (!password || password.length < 6) {
                showToast('密码至少 6 位', 'error');
                return;
            }
            try {
                showLoading();
                await apiService.request('/admin/employees', {
                    method: 'POST',
                    body: JSON.stringify({ employeeNo, name, password, roleId })
                });
                showToast('员工账号已创建');
                document.getElementById('add-user-modal').classList.add('hidden');
                await loadUsers();
            } catch (err) {
                showToast(err.message || '创建失败', 'error');
            } finally {
                hideLoading();
            }
        });
    }
}

let currentSongDataSource = 'source';

function updateSongDataSourceButtons() {
    const sourceBtn = document.getElementById('song-data-source-source');
    const availableBtn = document.getElementById('song-data-source-available');
    if (!sourceBtn || !availableBtn) return;

    const activeClass = ['bg-blue-600', 'text-white'];
    const inactiveClass = ['text-gray-300', 'hover:text-white'];
    sourceBtn.classList.remove(...activeClass, ...inactiveClass);
    availableBtn.classList.remove(...activeClass, ...inactiveClass);

    if (currentSongDataSource === 'available') {
        availableBtn.classList.add(...activeClass);
        sourceBtn.classList.add(...inactiveClass);
    } else {
        sourceBtn.classList.add(...activeClass);
        availableBtn.classList.add(...inactiveClass);
    }
}

window.switchSongDataSource = function (source) {
    currentSongDataSource = source === 'available' ? 'available' : 'source';
    updateSongDataSourceButtons();
    loadSongs(1);
};

async function loadSongs(page = 1) {
    const songsTable = document.getElementById('songs-table');
    if (!songsTable) return;

    try {
        showLoading();
        const keyword = document.getElementById('song-search')?.value || '';
        const language = document.getElementById('song-language-filter')?.value || '';
        const pageSize = 15;

        const data = await apiService.searchSongDb({
            keyword,
            languageCode: language,
            page,
            pageSize,
            availableOnly: currentSongDataSource === 'available'
        });

        const pagedData = data.data || {};
        const songs = pagedData.items || [];

        songsTable.innerHTML = '';

        if (songs.length === 0) {
            songsTable.innerHTML = '<tr><td colspan="12" class="px-6 py-8 text-center text-gray-400">暂无歌曲数据</td></tr>';
        }

        songs.forEach(song => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300 font-mono">${song.songNo || '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-yellow-500 font-bold">${song.initialKey || '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-white font-medium">${song.songName || '未知'}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${song.singerNames || '未知'}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${formatDictDisplay('language', song.languageCode, song.languageName)}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${formatDictDisplay('classify', song.categoryCode, song.categoryName)}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${formatVideoFileType(song.videoFileType)}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${formatTrack(song.track)}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${song.scoreEnabled ? '是' : '否'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300 max-w-xs truncate" title="${formatSongRelativePath(song)}">${formatSongRelativePath(song) || '-'}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${song.clickTime || 0}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                    <div class="flex space-x-10">
                        <button class="text-blue-400 hover:text-blue-300" onclick="openEditSongModal('${song.songId}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="text-red-400 hover:text-red-300" onclick="deleteSong('${song.songId}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            songsTable.appendChild(row);
        });

        // 更新分页信息
        const total = pagedData.total || 0;
        const totalPages = Math.ceil(total / pageSize);
        const start = total > 0 ? (page - 1) * pageSize + 1 : 0;
        const end = Math.min(page * pageSize, total);

        const startEl = document.getElementById('songs-start');
        const endEl = document.getElementById('songs-end');
        const totalEl = document.getElementById('songs-total');
        if (startEl) startEl.textContent = start.toString();
        if (endEl) endEl.textContent = end.toString();
        if (totalEl) totalEl.textContent = total.toString();

        renderPagination('songs-pagination', page, totalPages, loadSongs);

        const tableScroll = document.getElementById('songs-table-scroll');
        if (tableScroll) tableScroll.scrollTop = 0;
    } catch (error) {
        console.error('加载歌曲失败:', error);
        showToast('加载歌曲失败，请重试', 'error');
    } finally {
        hideLoading();
    }
}

async function loadSingers(page = 1) {
    const singersTable = document.getElementById('singers-table');
    if (!singersTable) {
        console.error('Element #singers-table not found!');
        return;
    }

    try {
        showLoading();
        const keyword = document.getElementById('singer-search')?.value || '';
        const region = document.getElementById('singer-region-filter')?.value || '';
        const sex = document.getElementById('singer-sex-filter')?.value || '';
        const data = await apiService.searchSingerDb({
            keyword,
            regionCode: region,
            sexCode: sex,
            page,
            pageSize: 10
        });
        const pagedData = data.data || {};
        const singers = pagedData.items || [];
        singersTable.innerHTML = '';

        if (singers.length === 0) {
            singersTable.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-center text-gray-400">暂无歌星数据</td></tr>';
        }

        singers.forEach(singer => {
            const row = document.createElement('tr');
            const regionName = getDictName('region', singer.regionCode);
            const sexName = getDictName('sex', singer.sexCode);

            // 头像处理
            const identifier = singer.singerNo || singer.singerId;
            const avatarUrl = `/api/v1/artists/${identifier}/image?t=${new Date().getTime()}`;
            const placeholderSvg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9Ii00IC00IDMyIDMyIiBmaWxsPSJub25lIiBzdHJva2U9IiM5Y2EzYWYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjAgMjF2LTJhNCA0IDAgMCAwLTQtNEg4YTQgNCAwIDAgMC00IDR2MiI+PC9wYXRoPjxjaXJjbGUgY3g9IjEyIiBjeT0iNyIgcj0iNCI+PC9jaXJjbGU+PC9zdmc+';

            row.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300 font-mono">${singer.singerNo || '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-white font-medium">${singer.singerName || '未知'}</td>
                <td class="px-6 py-2 whitespace-nowrap">
                    <img class="w-10 h-10 rounded-full object-cover border border-gray-600 bg-gray-800" src="${avatarUrl}" onerror="this.src='${placeholderSvg}'" alt="头像">
                </td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${escapeHtml(regionName)}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${escapeHtml(sexName)}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${singer.hit || 0}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                    <div class="flex space-x-2">
                        <button class="text-blue-400 hover:text-blue-300" onclick="openEditSingerModal(${singer.singerId})">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="text-red-400 hover:text-red-300" onclick="deleteSinger(${singer.singerId})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            singersTable.appendChild(row);
        });

        // 更新分页信息
        const total = pagedData.total || 0;
        const totalPages = Math.ceil(total / (pagedData.pageSize || 15));
        const start = total > 0 ? (page - 1) * (pagedData.pageSize || 15) + 1 : 0;
        const end = Math.min(page * (pagedData.pageSize || 15), total);

        const startEl = document.getElementById('singers-start');
        const endEl = document.getElementById('singers-end');
        const totalEl = document.getElementById('singers-total');
        if (startEl) startEl.textContent = start.toString();
        if (endEl) endEl.textContent = end.toString();
        if (totalEl) totalEl.textContent = total.toString();

        renderPagination('singers-pagination', page, totalPages, loadSingers);
    } catch (error) {
        console.error('加载歌手失败:', error);
        showToast('加载歌手失败，请重试', 'error');
    } finally {
        hideLoading();
    }
}

// 渲染分页组件
function renderPagination(containerId, currentPage, totalPages, loadFunc) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    if (totalPages <= 1) return;

    // 上一页
    const prevBtn = document.createElement('button');
    prevBtn.className = `px-3 py-1 rounded border ${currentPage === 1 ? 'bg-gray-700 text-gray-500 border-gray-600 cursor-not-allowed' : 'bg-gray-800 text-white border-gray-700 hover:bg-gray-700'}`;
    prevBtn.innerHTML = '<i class="fas fa-chevron-left text-xs"></i>';
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => loadFunc(currentPage - 1);
    container.appendChild(prevBtn);

    // 页码
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.className = `px-3 py-1 rounded border ${i === currentPage ? 'bg-red-600 border-red-600 text-white' : 'bg-gray-800 text-white border-gray-700 hover:bg-gray-700'}`;
        pageBtn.textContent = i;
        pageBtn.onclick = () => loadFunc(i);
        container.appendChild(pageBtn);
    }

    // 下一页
    const nextBtn = document.createElement('button');
    nextBtn.className = `px-3 py-1 rounded border ${currentPage === totalPages ? 'bg-gray-700 text-gray-500 border-gray-600 cursor-not-allowed' : 'bg-gray-800 text-white border-gray-700 hover:bg-gray-700'}`;
    nextBtn.innerHTML = '<i class="fas fa-chevron-right text-xs"></i>';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => loadFunc(currentPage + 1);
    container.appendChild(nextBtn);
}

let songArtistSearchGeneration = 0;
async function loadArtists(keyword = '', selectedSingerNo = '') {
    // 编辑歌曲时按输入远程检索，避免只加载前 100 位歌手。
    const songArtistSelect = document.getElementById('song-artist');
    if (!songArtistSelect) return;
    const generation = ++songArtistSearchGeneration;

    try {
        const data = await apiService.searchSingerDb({ keyword: keyword.trim(), page: 1, pageSize: 30 });
        if (generation !== songArtistSearchGeneration) return;
        const pagedData = data.data || {};
        const singers = pagedData.items || [];

        // 清空现有选项（保留默认选项）
        const defaultOption = songArtistSelect.querySelector('option[value=""]');
        songArtistSelect.innerHTML = '';
        if (defaultOption) songArtistSelect.appendChild(defaultOption);

        // 添加歌手选项
        singers.forEach(singer => {
            const option = document.createElement('option');
            option.value = singer.singerNo || singer.singerId;
            option.setAttribute('translate','no'); option.textContent = singer.singerName;
            songArtistSelect.appendChild(option);
        });
        if (selectedSingerNo && !Array.from(songArtistSelect.options).some(option => option.value === String(selectedSingerNo))) {
            const selected = document.createElement('option');
            selected.value = String(selectedSingerNo);
            selected.setAttribute('translate', 'no');
            selected.textContent = document.getElementById('song-artist-search')?.dataset.selectedName || selectedSingerNo;
            songArtistSelect.appendChild(selected);
        }
        if (selectedSingerNo) songArtistSelect.value = String(selectedSingerNo);
    } catch (error) {
        console.error('加载歌手列表失败:', error);
    }
}

let songArtistSearchTimer;
document.getElementById('song-artist-search')?.addEventListener('input', event => {
    window.clearTimeout(songArtistSearchTimer);
    const selectedNo = document.getElementById('song-artist')?.value || '';
    songArtistSearchTimer = window.setTimeout(() => loadArtists(event.target.value, selectedNo), 220);
});

// 终端管理函数
async function deleteTerminal(terminalId, terminalName) {
    const terminal = (window.allTerminalsCache || []).find(item => item.id === terminalId);
    return deleteTerminals([terminal || { id: terminalId, name: terminalName }]);
}

async function deleteTerminals(terminals) {
    if (terminalDeletionPending || terminals.length === 0) return;
    terminalDeletionPending = true;
    syncTerminalSelection();
    try {
        showLoading();
        const linkedRooms = [];
        for (const terminal of terminals) {
            const response = await apiService.request(`/terminals/${encodeURIComponent(terminal.id)}/rooms`);
            linkedRooms.push(...(response.data || []));
        }
        hideLoading();
        const label = terminal => `${terminal.name || '未命名'}（${terminal.serial || terminal.id}）`;
        let confirmMessage = `确定要删除以下 ${terminals.length} 台终端吗？\n\n`;
        confirmMessage += terminals.slice(0, 20).map(terminal => `• ${label(terminal)}`).join('\n');
        if (terminals.length > 20) confirmMessage += `\n……共 ${terminals.length} 台终端`;
        if (linkedRooms.length > 0) {
            confirmMessage += `\n\n关联的 ${linkedRooms.length} 个房间及其点歌队列也会被删除：\n`;
            confirmMessage += linkedRooms.slice(0, 20).map(room => `• ${getRoomDisplayName(room)}`).join('\n');
            if (linkedRooms.length > 20) confirmMessage += `\n……共 ${linkedRooms.length} 个房间`;
        }
        confirmMessage += '\n\n此操作不可恢复。终端再次注册时可能重新出现在列表中。';
        const confirmed = await showConfirm(confirmMessage);
        if (!confirmed) return;

        showLoading();
        const failures = [];
        let deleted = 0;
        for (const terminal of terminals) {
            try {
                await apiService.deleteTerminal(terminal.id);
                selectedTerminalIds.delete(terminal.id);
                expandedTerminalConnections.delete(terminal.id);
                deleted++;
            } catch (error) {
                selectedTerminalIds.add(terminal.id);
                failures.push(`${label(terminal)}：${error.message || '删除失败'}`);
            }
        }
        await loadTerminals();
        if (deleted > 0 && linkedRooms.length > 0 && typeof loadRooms === 'function') {
            await loadRooms();
        }
        if (failures.length > 0) {
            showToast(`已删除 ${deleted} 台，${failures.length} 台失败；失败项已保留勾选。\n${failures.join('\n')}`, 'error', 10000);
        } else {
            showToast(`已删除 ${deleted} 台终端${linkedRooms.length > 0 ? '及其关联房间和点歌队列' : ''}`, 'success');
        }
    } catch (error) {
        console.error('删除终端失败:', error);
        showToast(error.message || '删除终端失败', 'error');
    } finally {
        terminalDeletionPending = false;
        syncTerminalSelection();
        hideLoading();
    }
}

const PERMANENT_LICENSE_SECONDS = 10 * 365 * 24 * 60 * 60;

function formatLicenseTimestamp(timestamp) {
    if (!timestamp) return '-';
    return new Date(timestamp * 1000).toLocaleString(window.AdminI18n?.locale || 'zh-CN', { hour12: false });
}

function isPermanentLicense(license) {
    const issuedAt = Number(license?.issuedAt);
    const expiresAt = Number(license?.expiresAt);
    return Number.isFinite(issuedAt)
        && Number.isFinite(expiresAt)
        && expiresAt > issuedAt
        && expiresAt - issuedAt >= PERMANENT_LICENSE_SECONDS;
}

function formatLicenseExpiry(license) {
    return isPermanentLicense(license) ? '永久' : formatLicenseTimestamp(license?.expiresAt);
}

function setElementText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function setLicenseBadge(badge, valid, permanent = false) {
    if (!badge) return;
    badge.textContent = valid ? (permanent ? '永久授权' : '已授权') : '未授权';
    badge.className = valid
        ? 'rounded-full bg-green-900/60 px-3 py-1 text-xs text-green-300'
        : 'rounded-full bg-red-900/60 px-3 py-1 text-xs text-red-300';
}

function setLoginEnabled(enabled) {
    [usernameInput, passwordInput, document.getElementById('remember-me')].forEach(element => {
        if (element) element.disabled = !enabled;
    });
    const loginButton = document.getElementById('login-btn');
    if (loginButton) {
        loginButton.disabled = !enabled;
        loginButton.classList.toggle('opacity-50', !enabled);
        loginButton.classList.toggle('cursor-not-allowed', !enabled);
        loginButton.title = enabled ? '' : '请先导入有效的服务器授权文件';
    }
}

const REMEMBER_KEYS = Object.freeze({
    username: 'admin_remembered_username',
    password: 'admin_remembered_password',
    enabled: 'admin_remember_me',
});

function readRememberedLogin() {
    try {
        return {
            username: localStorage.getItem(REMEMBER_KEYS.username) || '',
            password: localStorage.getItem(REMEMBER_KEYS.password) || '',
            enabled: localStorage.getItem(REMEMBER_KEYS.enabled) === 'true',
        };
    } catch (error) {
        console.warn('[Admin] 读取记住的登录信息失败:', error);
        return { username: '', password: '', enabled: false };
    }
}

function saveRememberedLogin(username, password, enabled) {
    try {
        localStorage.setItem(REMEMBER_KEYS.enabled, enabled ? 'true' : 'false');
        if (enabled) {
            localStorage.setItem(REMEMBER_KEYS.username, username);
            localStorage.setItem(REMEMBER_KEYS.password, password);
        } else {
            localStorage.removeItem(REMEMBER_KEYS.username);
            localStorage.removeItem(REMEMBER_KEYS.password);
        }
    } catch (error) {
        console.warn('[Admin] 保存记住的登录信息失败:', error);
    }
}

function renderLicenseStatus(status) {
    currentLicenseStatus = status;
    const sourceLabel = status?.source === 'cloud' ? '云端授权 · 已连接' : status?.source === 'cloud_cache' ? '本地保底 · 已缓存云端授权' : status?.cloudConnected ? '本地授权 · 云端暂无授权' : '本地保底 · 云端未连接';
    setElementText('license-source',sourceLabel);
    setElementText('admin-license-source',sourceLabel);
    const valid = Boolean(status?.valid);
    const license = status?.license;
    const permanent = isPermanentLicense(license);
    const loginLicensePanel = document.getElementById('server-license-panel');
    const loginBadge = document.getElementById('license-status-badge');
    const loginMessage = document.getElementById('license-status-message');
    const loginMachineCode = document.getElementById('license-machine-code');
    const loginDetails = document.getElementById('license-detail-grid');
    const adminDetails = document.getElementById('admin-license-detail-grid');

    if (loginLicensePanel) loginLicensePanel.classList.toggle('hidden', valid);
    if (loginMachineCode) loginMachineCode.value = status?.machineCode || '读取失败';
    if (loginMessage) loginMessage.textContent = status?.message || '无法获取服务器授权状态';
    setLicenseBadge(loginBadge, valid, permanent);
    setLoginEnabled(valid);

    if (loginDetails) {
        loginDetails.classList.toggle('hidden', !license);
        loginDetails.classList.toggle('grid', Boolean(license));
    }
    if (adminDetails) adminDetails.classList.toggle('opacity-60', !license);

    const contact = [license?.venue?.contact, license?.venue?.phone].filter(Boolean).join(' / ') || '-';
    const terminalLimit = license ? `${license.terminalLimit ?? '-'} 点` : '-';
    const expiry = license ? formatLicenseExpiry(license) : '-';

    setElementText('license-venue-name', license?.venue?.name || '-');
    setElementText('license-contact', contact);
    setElementText('license-address', license?.venue?.address || '-');
    setElementText('license-expires-at', expiry);
    setElementText('license-terminal-limit', terminalLimit);
    setElementText('license-id', license?.licenseId || '-');

    setElementText('admin-license-status-message', status?.message || '无法获取服务器授权状态');
    setLicenseBadge(document.getElementById('admin-license-status-badge'), valid, permanent);
    setElementText('admin-license-machine-code', status?.machineCode || '-');
    setElementText('admin-license-venue-name', license?.venue?.name || '-');
    setElementText('admin-license-contact', contact);
    setElementText('admin-license-address', license?.venue?.address || '-');
    setElementText('admin-license-issued-at', license ? formatLicenseTimestamp(license.issuedAt) : '-');
    setElementText('admin-license-expires-at', expiry);
    setElementText('admin-license-terminal-limit', terminalLimit);
    setElementText('admin-license-id', license?.licenseId || '-');
}

async function loadLicenseStatus() {
    try {
        const response = await apiService.getLicenseStatus();
        renderLicenseStatus(response.data);
        return response.data;
    } catch (error) {
        console.error('获取授权状态失败:', error);
        renderLicenseStatus({ valid: false, message: error.message, machineCode: '' });
        return null;
    }
}

function copyTextFallback(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('copy command failed');
}

async function copyLicenseMachineCode() {
    const machineCode = String(currentLicenseStatus?.machineCode || '').trim();
    if (!machineCode) {
        showToast('机器码尚未读取成功', 'error');
        return;
    }

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(machineCode);
        } else {
            copyTextFallback(machineCode);
        }
        showToast('机器码已复制', 'success');
    } catch (error) {
        try {
            copyTextFallback(machineCode);
            showToast('机器码已复制', 'success');
        } catch (fallbackError) {
            console.error('复制机器码失败:', error, fallbackError);
            showToast('复制失败，请手动选择机器码', 'error');
        }
    }
}

function setupLicenseEvents() {
    const copyButton = document.getElementById('copy-license-machine-code');
    const adminCopyButton = document.getElementById('copy-admin-license-machine-code');
    const selectButtons = ['select-license-file', 'select-admin-license-file']
        .map(id => document.getElementById(id)).filter(Boolean);
    const fileInput = document.getElementById('license-file-input');

    if (copyButton) copyButton.onclick = copyLicenseMachineCode;
    if (adminCopyButton) adminCopyButton.onclick = copyLicenseMachineCode;

    if (fileInput) {
        selectButtons.forEach(button => { button.onclick = () => fileInput.click(); });
        fileInput.onchange = async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            selectButtons.forEach(button => { button.disabled = true; });
            fileInput.disabled = true;
            try {
                showLoading();
                const content = await file.text();
                const response = await apiService.importLicense(content);
                renderLicenseStatus(response.data);
                showToast(response.data?.source === 'local' ? '服务器授权已导入并生效' : '本地授权已保存，当前优先使用云端授权', 'success');
            } catch (error) {
                console.error('导入授权失败:', error);
                showToast(error.message || '导入授权失败', 'error');
            } finally {
                fileInput.value = '';
                fileInput.disabled = false;
                selectButtons.forEach(button => { button.disabled = false; });
                hideLoading();
            }
        };
    }
}

// 事件监听器
function renderLoginServerNetwork(options) {
    const select = document.getElementById('login-network-interface');
    const status = document.getElementById('login-network-status');
    if (!select || !status) return;

    const interfaces = Array.isArray(options?.interfaces)
        ? options.interfaces.filter(item => item && isUsableServerIpv4(item.ip))
        : [];
    loginServerNetwork = {
        configuredHost: String(options?.configuredHost || '').trim(),
        configuredPort: Number(options?.configuredPort) || 9898,
        configuredAvailable: Boolean(options?.configuredAvailable),
    };

    select.innerHTML = '';
    if (!loginServerNetwork.configuredAvailable) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '\u8bf7\u9009\u62e9\u670d\u52a1\u5668\u7f51\u5361 IP';
        select.appendChild(placeholder);
    }
    interfaces.forEach(item => {
        const option = document.createElement('option');
        option.value = item.ip;
        option.textContent = item.ip;
        select.appendChild(option);
    });

    if (interfaces.length === 0) {
        select.innerHTML = '<option value="">\u672a\u68c0\u6d4b\u5230\u53ef\u7528 IPv4 \u7f51\u5361</option>';
        select.disabled = true;
        status.textContent = '\u65e0\u53ef\u7528\u7f51\u5361';
        status.className = 'text-xs text-red-400';
        return;
    }

    const configuredExists = interfaces.some(item => item.ip === loginServerNetwork.configuredHost);
    select.value = configuredExists && loginServerNetwork.configuredAvailable
        ? loginServerNetwork.configuredHost
        : '';
    select.disabled = false;
    if (configuredExists && loginServerNetwork.configuredAvailable) {
        status.textContent = `\u5f53\u524d IP\uff1a${loginServerNetwork.configuredHost}`;
        status.className = 'text-xs text-emerald-400';
    } else {
        status.textContent = '\u8bf7\u9009\u62e9\u53ef\u7528 IP\uff0c\u9009\u62e9\u540e\u81ea\u52a8\u5e94\u7528';
        status.className = 'text-xs text-amber-400';
    }
}

async function readLoginServerNetwork() {
    const invoke = getTauriInvoke();
    if (invoke) {
        try {
            return await invoke('get_server_network_options');
        } catch (error) {
            console.warn('Failed to read network adapters through Tauri, trying HTTP API:', error);
        }
    }

    const response = await apiService.getServerInfo();
    const data = response?.data || {};
    const host = String(data.host || '').trim();
    return {
        configuredHost: host,
        configuredPort: Number(data.port) || 9898,
        configuredAvailable: Array.isArray(data.interfaces)
            && data.interfaces.some(item => String(item?.ip || '') === host),
        interfaces: data.interfaces || [],
    };
}

async function refreshLoginServerNetwork() {
    const select = document.getElementById('login-network-interface');
    const status = document.getElementById('login-network-status');
    if (!select || !status) return;

    select.disabled = true;
    status.textContent = '\u6b63\u5728\u8bfb\u53d6\u2026';
    status.className = 'text-xs text-gray-500';
    try {
        renderLoginServerNetwork(await readLoginServerNetwork());
    } catch (error) {
        console.error('Failed to load login server network options:', error);
        select.innerHTML = '<option value="">\u8bfb\u53d6\u7f51\u5361\u5931\u8d25</option>';
        status.textContent = '\u670d\u52a1\u672a\u542f\u52a8\u6216\u914d\u7f6e\u4e0d\u53ef\u7528';
        status.className = 'text-xs text-red-400';
    }
}

async function applyLoginServerNetwork() {
    const select = document.getElementById('login-network-interface');
    const status = document.getElementById('login-network-status');
    const host = String(select?.value || '').trim();
    const port = loginServerNetwork.configuredPort;
    if (!isUsableServerIpv4(host) || loginNetworkSwitching) return;
    if (host === loginServerNetwork.configuredHost && loginServerNetwork.configuredAvailable) {
        status.textContent = `\u5f53\u524d IP\uff1a${host}`;
        status.className = 'text-xs text-emerald-400';
        return;
    }

    const invoke = getTauriInvoke();
    if (!invoke) {
        showToast('\u7f51\u5361\u5207\u6362\u4ec5\u652f\u6301 HVideo Admin \u684c\u9762\u7a0b\u5e8f', 'error');
        return;
    }

    loginNetworkSwitching = true;
    select.disabled = true;
    status.textContent = `\u6b63\u5728\u5e94\u7528 ${host}\u5e76\u91cd\u542f\u670d\u52a1\u2026`;
    status.className = 'text-xs text-amber-400';
    showLoading();
    try {
        apiService.clearToken();
        const result = await invoke('select_server_network', { host, port });
        loginServerNetwork.configuredHost = host;
        loginServerNetwork.configuredAvailable = true;
        status.textContent = `\u5df2\u5e94\u7528 IP\uff1a${host}`;
        status.className = 'text-xs text-emerald-400';
        showToast('\u670d\u52a1\u5668\u7f51\u5361\u5df2\u81ea\u52a8\u5e94\u7528\uff0c\u6b63\u5728\u91cd\u65b0\u8fde\u63a5', 'success');
        const serverUrl = String(result?.serverUrl || '').trim();
        window.setTimeout(() => {
            window.location.replace(serverUrl || window.location.href);
        }, 500);
    } catch (error) {
        console.error('Failed to switch server network interface:', error);
        status.textContent = '\u81ea\u52a8\u5e94\u7528\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9';
        status.className = 'text-xs text-red-400';
        select.value = loginServerNetwork.configuredAvailable
            ? loginServerNetwork.configuredHost
            : '';
        select.disabled = false;
        hideLoading();
    } finally {
        loginNetworkSwitching = false;
    }
}

async function initializeLoginServerNetwork() {
    const select = document.getElementById('login-network-interface');
    if (!select) return;
    if (select.dataset.bound !== 'true') {
        select.dataset.bound = 'true';
        select.addEventListener('change', applyLoginServerNetwork);
    }
    await refreshLoginServerNetwork();
}

function openLoginServerSettings() {
    // Reveal the page before loading settings so one failed widget cannot block navigation.
    loginPage?.classList.add('hidden');
    adminPage?.classList.remove('hidden');

    try {
        showSection('settings');
    } catch (error) {
        console.error('Failed to open server connection settings:', error);
        sections.forEach(section => section.classList.add('hidden'));
        document.getElementById('settings-section')?.classList.remove('hidden');
        if (pageTitle) pageTitle.textContent = '系统设置';
    }

    if (compactSidebarMedia.matches) applySidebarState(true);
    showToast('请在此配置服务器连接地址', 'info');
}

function setupEventListeners() {
    setupLicenseEvents();
    // 登录表单提交
    // 登录页面服务器配置按钮
    const loginSettingsBtn = document.getElementById('open-login-server-settings');
    if (loginSettingsBtn) {
        loginSettingsBtn.onclick = openLoginServerSettings;
    }

    // 监听 API 层的自动回退事件
    if (loginForm) {
        // 页面加载时恢复记住的用户名和密码
        const rememberedLogin = readRememberedLogin();
        const rememberCheckbox = document.getElementById('remember-me');
        if (rememberCheckbox) {
            rememberCheckbox.checked = rememberedLogin.enabled;
            rememberCheckbox.addEventListener('change', () => {
                const enabled = rememberCheckbox.checked;
                saveRememberedLogin(usernameInput.value.trim(), passwordInput.value, enabled);
            });
        }
        if (rememberedLogin.enabled) {
            usernameInput.value = rememberedLogin.username;
            passwordInput.value = rememberedLogin.password;
        }

        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            if (!currentLicenseStatus?.valid) {
                showToast('请先导入有效的服务器授权文件', 'error');
                return;
            }

            const username = usernameInput.value;
            const password = passwordInput.value;
            const rememberCheckbox = document.getElementById('remember-me');
            const shouldRemember = rememberCheckbox?.checked === true;

            try {
                showLoading();
                // 清除旧的 token，避免登录时携带过期 token
                apiService.clearToken();
                const data = await apiService.login(username, password);
                if (shouldRemember) saveRememberedLogin(username, password, true);
                // 暂时简化登录成功的判断逻辑
                if (data) {
                    currentUser = {
                        username: username,
                        role: 'admin'
                    };

                    adminUsername.textContent = username;
                    loginPage.classList.add('hidden');
                    adminPage.classList.remove('hidden');
                    startCloudStatusPolling();

                    // 先初始化服务器地址/网卡信息，再加载依赖服务地址的业务数据
                    if (typeof loadSettingsServerInfo === 'function') {
                        await loadSettingsServerInfo();
                    }

                    // 登录成功后加载数据
                    showSection('dashboard');
                    loadTerminals();
                    loadRooms();
                    loadSongs();
                    loadArtists();
                    updateStatistics();
                    loadRecentActivities();
                } else {
                    showToast('登录失败: ' + (data?.message || '用户名或密码错误'), 'error');
                }
            } catch (error) {
                console.error('登录失败:', error);
                const message = String(error?.message || error || '未知错误');
                const isNetworkError = error instanceof TypeError
                    || /failed to fetch|networkerror|network error|load failed|连接被拒绝|无法连接/i.test(message);
                if (isNetworkError) {
                    showToast('无法连接服务器，请选择正确的服务器网卡 IP；选择后会自动应用并重启', 'error');
                    refreshLoginServerNetwork().catch(refreshError => {
                        console.warn('Failed to refresh login network options:', refreshError);
                    });
                } else {
                    showToast(`登录失败：${message}`, 'error');
                }
            } finally {
                hideLoading();
            }
        });
    }

    // 退出登录
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            showLoading();

            // 清除本地存储的token
            apiService.logout();

            setTimeout(() => {
                currentUser = null;
                adminPage.classList.add('hidden');
                loginPage.classList.remove('hidden');
                hideLoading();
            }, 500);
        });
    }

    // 侧边栏切换：宽屏推开内容，紧凑窗口使用覆盖式抽屉。
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function () {
            applySidebarState(!sidebarCollapsed);
        });
    }

    // 导航项点击
    navItems.forEach(item => {
        item.addEventListener('click', async function (e) {
            e.preventDefault();
            const sectionId = this.getAttribute('data-section');
            showSection(sectionId);
            if (compactSidebarMedia.matches) applySidebarState(true);

            // 只有房间管理才保持服务铃自动刷新，其他页面停止
            if (sectionId !== 'rooms') stopServiceRefresh();

            // 加载对应数据
            switch (sectionId) {
                case 'dashboard':
                    await loadRecentActivities();
                    break;
                case 'terminals':
                    await loadTerminals();
                    break;
                case 'rooms':
                    await loadRooms();
                    startServiceRefresh();
                    break;
                case 'songs':
                    await loadSongs();
                    break;
                case 'artists':
                    await loadSingers();
                    break;
                case 'cloud':
                    await loadCloudStatus();
                    await loadSyncTasks();
                    break;
                case 'streams':
                    await loadIptvStreams();
                    break;
                case 'peripherals':
                    ['light', 'effect', 'ac'].forEach(t => loadPresetList(t));
                    loadServiceTypeList();
                    break;
                case 'logs':
                    await loadOperationLogs();
                    break;
                case 'settings':
                    if (typeof initTauriTest === 'function') initTauriTest();
                    if (typeof setupSystemSettings === 'function') setupSystemSettings();
                    if (typeof loadSettingsServerInfo === 'function') loadSettingsServerInfo();
                    break;
                case 'users':
                    await loadUsers();
                    break;
            }
        });
    });

    // 扫描终端按钮
    const refreshStreamsBtn = document.getElementById('refresh-streams-btn');
    if (refreshStreamsBtn) {
        refreshStreamsBtn.addEventListener('click', refreshIptvStreams);
    }

    const reloadStreamsBtn = document.getElementById('reload-streams-btn');
    if (reloadStreamsBtn) {
        reloadStreamsBtn.addEventListener('click', loadIptvStreams);
    }

    const streamsSearch = document.getElementById('streams-search');
    if (streamsSearch) {
        streamsSearch.addEventListener('input', renderIptvStreams);
    }

    const streamsCategoryFilter = document.getElementById('streams-category-filter');
    if (streamsCategoryFilter) {
        streamsCategoryFilter.addEventListener('change', renderIptvStreams);
    }

    const scanTerminalsBtn = document.getElementById('scan-terminals');
    if (scanTerminalsBtn) {
        scanTerminalsBtn.addEventListener('click', async function () {
            try {
                showLoading();
                const data = await apiService.scanNetwork();
                const ok = data.code === 0;
                const devices = data.data || [];

                if (ok) {
                    showToast('扫描完成，发现 ' + devices.length + ' 个终端', 'success');
                    await loadTerminals();
                } else {
                    showToast('扫描失败: ' + (data.message || '未知错误'), 'error');
                }
            } catch (error) {
                console.error('扫描终端失败:', error);
                showToast('扫描终端失败，请重试', 'error');
            } finally {
                hideLoading();
            }
        });
    }

    // 添加终端按钮
    const addTerminalBtn = document.getElementById('add-terminal');
    if (addTerminalBtn) {
        addTerminalBtn.addEventListener('click', async function () {
            const terminalIp = await showPrompt('请输入已安装 HSVJ 播放器的终端 IP 地址：');
            if (!terminalIp) return;
            const serial = await showPrompt('请输入这台播放器的设备序列号：');
            if (!serial?.trim()) return;
            try {
                showLoading();
                await apiService.registerTerminal({ terminalIp: terminalIp.trim(), serial: serial.trim() });
                showToast('播放器身份验证通过，终端已添加', 'success');
                await loadTerminals();
            } catch (error) {
                showToast(error.message || '未检测到 HSVJ 播放器，终端未添加', 'error');
            } finally {
                hideLoading();
            }
        });
    }

    // 添加房间按钮：使用 HTML onclick，此处不再绑定

    // 添加歌曲按钮
    const addSongBtn = document.getElementById('add-song');
    if (addSongBtn) {
        addSongBtn.addEventListener('click', function () {
            openAddSongModal();
        });
    }

    // 添加歌手按钮
    const addSingerBtn = document.getElementById('add-singer');
    if (addSingerBtn) {
        addSingerBtn.addEventListener('click', function () {
            openAddSingerModal();
        });
    }

    // 用户管理：添加用户、编辑、删除、弹窗
    setupUserManagement();

    // 设置云端同步和日志相关监听器
    setupCloudEventListeners();
    // 系统设置：网卡选择与服务器地址联动
}

async function loadIptvStreams() {
    try {
        showLoading();
        const [statusRes, streamsRes] = await Promise.all([
            apiService.getStreamsStatus().catch(error => ({ code: -1, message: error.message })),
            apiService.getStreams()
        ]);
        const status = statusRes && statusRes.code === 0 ? (statusRes.data || {}) : {};
        iptvStreams = streamsRes && streamsRes.code === 0 && Array.isArray(streamsRes.data) ? streamsRes.data : [];
        updateIptvStatus(status);
        updateIptvCategoryFilter();
        renderIptvStreams();
    } catch (error) {
        console.error('加载直播频道失败:', error);
        showToast(`加载直播频道失败：${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

async function refreshIptvStreams() {
    try {
        showLoading();
        const result = await apiService.refreshStreams();
        if (!result || result.code !== 0) {
            throw new Error(result?.message || '刷新失败');
        }
        showToast('直播源刷新完成', 'success');
        await loadIptvStreams();
    } catch (error) {
        console.error('刷新直播源失败:', error);
        showToast(`刷新直播源失败：${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

function updateIptvStatus(status) {
    const countEl = document.getElementById('streams-count');
    const updatedAtEl = document.getElementById('streams-updated-at');
    const statusEl = document.getElementById('streams-status');
    if (countEl) countEl.textContent = status.channel_count ?? iptvStreams.length;
    if (updatedAtEl) updatedAtEl.textContent = status.updated_at || '-';
    if (statusEl) {
        statusEl.textContent = status.last_error ? '异常' : '正常';
        statusEl.className = `text-lg font-semibold ${status.last_error ? 'text-red-400' : 'text-green-400'}`;
        statusEl.title = status.last_error || '';
    }
}

function updateIptvCategoryFilter() {
    const select = document.getElementById('streams-category-filter');
    if (!select) return;
    const current = select.value;
    const categories = Array.from(new Set(iptvStreams.map(item => item.category || '').filter(Boolean))).sort();
    select.innerHTML = '<option value="">全部分类</option>' + categories.map(category =>
        `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
    ).join('');
    if (categories.includes(current)) select.value = current;
}

function renderIptvStreams() {
    const table = document.getElementById('streams-table');
    if (!table) return;
    const keyword = (document.getElementById('streams-search')?.value || '').trim().toLowerCase();
    const category = document.getElementById('streams-category-filter')?.value || '';
    const filtered = iptvStreams.filter(item => {
        const text = `${item.name || ''} ${item.category || ''} ${item.url || ''}`.toLowerCase();
        const keywordMatch = !keyword || text.includes(keyword);
        const categoryMatch = !category || item.category === category;
        return keywordMatch && categoryMatch;
    });
    if (filtered.length === 0) {
        table.innerHTML = '<tr><td colspan="4" class="px-4 py-8 text-center text-gray-400">暂无直播频道</td></tr>';
        return;
    }
    table.innerHTML = filtered.map(item => `
        <tr class="hover:bg-gray-700/50">
            <td class="px-4 py-3 text-sm text-white font-medium whitespace-nowrap">${escapeHtml(item.name || '-')}</td>
            <td class="px-4 py-3 text-sm text-purple-300 whitespace-nowrap">${escapeHtml(item.category || '未分类')}</td>
            <td class="px-4 py-3 text-sm text-gray-300 max-w-xl truncate" title="${escapeHtml(item.url || '')}">${escapeHtml(item.url || '-')}</td>
            <td class="px-4 py-3 text-sm text-gray-400 max-w-xs truncate" title="${escapeHtml(item.cover || '')}">${escapeHtml(item.cover || '-')}</td>
        </tr>
    `).join('');
}

// 获取仪表盘数据
var syncTaskPage = 1;
var syncTaskPageSize = 20;
var syncTaskRefreshTimer = null;
var syncTaskLoading = false;

async function loadCloudConfig() {
    const message = document.getElementById('cloud-config-message');
    try {
        const { data } = await apiService.getCloudConfig();
        const input = document.getElementById('cloud-download-dir');
        if (!input.dataset.dirty) input.value = data.downloadDir || '';
        renderCloudUpdateMode(data.updateMode);
    } catch (error) { message.textContent = '读取更新设置失败：' + error.message; }
}

async function saveCloudConfig(event) {
    event.preventDefault();
    const button = document.getElementById('save-cloud-config-btn');
    const message = document.getElementById('cloud-config-message');
    const input = document.getElementById('cloud-download-dir');
    const mode = document.getElementById('cloud-update-mode');
    button.disabled = true;
    try {
        const {data} = await apiService.saveCloudConfig({downloadDir: input.value.trim(), updateMode: mode.value});
        input.value = data.downloadDir;
        delete input.dataset.dirty;
        delete mode.dataset.dirty;
        renderCloudUpdateMode(data.updateMode);
        message.textContent = '更新设置已保存并生效。';
        await loadCloudStatus();
    } catch (error) { message.textContent = '保存失败：' + error.message; }
    finally { button.disabled = false; }
}

function renderCloudUpdateMode(value) {
    window.cloudSavedUpdateMode = value === 'auto' ? 'auto' : 'manual';
    const mode = document.getElementById('cloud-update-mode');
    if (mode && !mode.dataset.dirty) mode.value = window.cloudSavedUpdateMode;
    const automatic = (mode?.value || window.cloudSavedUpdateMode) === 'auto';
    const button = document.getElementById('apply-cloud-updates-btn');
    if (button) button.hidden = automatic;
    const hint = document.getElementById('cloud-update-mode-hint');
    const pending = mode?.dataset.dirty ? '保存设置后生效。' : '';
    if (hint) hint.textContent = pending + (automatic
        ? '自动模式：后台每 5 分钟下载更新，需保持服务器运行且授权有效。'
        : '手动模式：点击下载后更新入库。');
}

function startCloudStatusPolling() {
    if (window.cloudStatusTimer) return;
    loadCloudStatus();
    window.cloudStatusTimer = setInterval(() => {
        if (localStorage.getItem('admin_token')) loadCloudStatus();
    }, 30000);
}

async function loadCloudStatus(showResultToast = false) {
    if (window.cloudStatusInFlight) return window.cloudStatusInFlight;
    const icon = document.getElementById('cloud-status-icon');
    const authorization = document.getElementById('cloud-authorization');
    const button = document.getElementById('apply-cloud-updates-btn');
    const packages = document.getElementById('cloud-packages');
    if (!icon || !authorization) return null;
    window.cloudStatusInFlight = (async () => {
        try {
            const { data: status } = await apiService.getCloudStatus();
            const reachable = Boolean(status?.configured && status.reachable);
            const items = Array.isArray(status?.packages) ? status.packages : [];
            window.cloudPackageNames ||= new Map();
            for (const item of items) window.cloudPackageNames.set(String(item.id), String(item.name));
            document.querySelectorAll('[data-cloud-package-id]').forEach(cell => {
                const name = window.cloudPackageNames.get(cell.dataset.cloudPackageId);
                if (name) cell.textContent = name;
            });
            const pending = items.filter(item => !item.installed);
            icon.style.color = reachable ? '#22c55e' : '#ef4444';
            const connectionLabel = reachable ? '云端已连接' : '云端未连接';
            icon.title = connectionLabel;
            icon.setAttribute('aria-label', connectionLabel);
            const grant = status?.authorization;
            const expiry = Number(grant?.expiresAt);
            const expiryText = Number.isFinite(expiry) && expiry > 0
                ? new Date(expiry * 1000).toLocaleString(window.AdminI18n?.locale || 'zh-CN', {hour12:false}) : '';
            authorization.textContent = grant?.enabled && expiryText
                ? `云端更新到期日期：${expiryText}${grant.valid ? '' : '（已到期或服务器授权无效）'}`
                : (grant?.message || '云端更新未授权');
            authorization.style.color = grant?.valid ? '#d1d5db' : '#f87171';
            const directory = document.getElementById('cloud-download-dir');
            if (directory && !directory.dataset.dirty) directory.value = status.downloadDir || '';
            renderCloudUpdateMode(status.updateMode);
            for (const id of ['cloud-download-dir','cloud-update-mode','choose-cloud-directory-btn','save-cloud-config-btn']) {
                const control = document.getElementById(id);
                if (control) control.disabled = Boolean(status.updating);
            }
            if (packages) {
                packages.replaceChildren();
                for (const item of (grant?.valid ? items : [])) {
                    const row = document.createElement('div');
                    row.className = 'rounded border border-gray-700 px-3 py-2';
                    const packageName = document.createElement('span');
                    packageName.setAttribute('translate','no'); packageName.textContent = item.name;
                    row.append(packageName, document.createTextNode(` · 版本 ${item.versionCode} · 歌曲资料 ${item.songCount.toLocaleString()} 条 · 视频 ${item.videoCount} 个 · ${item.installed ? '已更新' : '待更新'}`));
                    packages.appendChild(row);
                }
                if (grant?.valid && !items.length) packages.textContent = status?.updateError || (reachable ? '暂无已发布更新包' : '连接恢复后自动读取更新包');
            }
            if (button) button.textContent = status?.updating ? '正在更新，请查看下方进度' : '下载并更新曲库';
            if (button) button.disabled = !grant?.valid || !reachable || !!status?.updateError || !pending.length || !!status?.updating || !!window.cloudUpdateStarting;
            if (showResultToast) showToast(connectionLabel, reachable ? 'success' : 'error');
            return status;
        } catch (error) {
            icon.style.color = '#ef4444';
            icon.title = '云端未连接';
            icon.setAttribute('aria-label', '云端未连接');
            if (button) button.disabled = true;
            if (packages) packages.textContent = '连接检查失败，稍后自动重试';
            if (showResultToast) showToast(error.message || '无法读取云端状态', 'error');
            return null;
        }
    })();
    try { return await window.cloudStatusInFlight; } finally { window.cloudStatusInFlight = null; }
}

async function applyCloudUpdates() {
    if (window.cloudUpdateStarting) return;
    window.cloudUpdateStarting = true;
    const button = document.getElementById('apply-cloud-updates-btn');
    button.disabled = true;
    try {
        const { data } = await apiService.startCloudUpdates();
        showToast(data?.length ? `已启动 ${data.length} 个更新包，请查看下方任务进度` : '已是最新版本', 'success');
        await loadSyncTasks(true);
    } catch (error) { showToast(error.message || '启动更新失败', 'error'); }
    finally { window.cloudUpdateStarting = false; await loadCloudStatus(); }
}

async function selectNativeDirectories(purpose, initialPath = '') {
    const invoke = getTauriInvoke();
    if (!invoke) {
        showToast('请在服务器电脑的 HVideo Admin 程序中选择文件夹；浏览器中可直接填写服务器路径。', 'warning');
        return null;
    }
    if (window.nativeDirectoryPickerOpen) return null;
    window.nativeDirectoryPickerOpen = true;
    try {
        const paths = await invoke('select_directories', { purpose, initialPath });
        return Array.isArray(paths) && paths.length ? paths : null;
    } catch (error) {
        showToast(error?.message || String(error || '打开 Windows 文件夹选择窗口失败'), 'error');
        return null;
    } finally { window.nativeDirectoryPickerOpen = false; }
}

async function chooseDirectoryForInput(inputId, purpose) {
    const input = document.getElementById(inputId);
    if (!input || input.disabled) return;
    const paths = await selectNativeDirectories(purpose, input.value.trim());
    if (!paths || input.disabled) return;
    input.value = paths.join(';');
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function chooseCloudDirectory() {
    await chooseDirectoryForInput('cloud-download-dir', 'cloudDownload');
}

async function loadSyncTasks(silent = false) {
    const tasksTable = document.getElementById('tasks-table');
    if (!tasksTable || syncTaskLoading) return;
    syncTaskLoading = true;
    const requestedPage = syncTaskPage;
    let refreshDelay = 10000;
    if (syncTaskRefreshTimer) {
        clearTimeout(syncTaskRefreshTimer);
        syncTaskRefreshTimer = null;
    }
    try {
        if (!silent) showLoading();
        const query = { page: requestedPage, pageSize: syncTaskPageSize };
        const response = await apiService.getSyncTasks(query);
        // A page change during a request must not be overwritten by its old response.
        if (requestedPage !== syncTaskPage) { refreshDelay = 0; return; }
        const payload = response.data || {};
        const tasks = Array.isArray(payload.items) ? payload.items : [];
        const total = Number(payload.total || 0);
        const pageSize = Number(payload.pageSize || syncTaskPageSize);
        const pageCount = Math.max(1, Math.ceil(total / pageSize));
        syncTaskPage = Math.min(Number(payload.page || 1), pageCount);
        const pending = Number(payload.pending || 0);
        const running = Number(payload.running || 0);
        const completed = Number(payload.completed || 0);
        const failed = Number(payload.failed || 0);
        document.getElementById('total-tasks').textContent = pending + running + completed + failed;
        document.getElementById('running-tasks').textContent = running;
        document.getElementById('completed-tasks').textContent = completed;
        document.getElementById('failed-tasks').textContent = failed;
        const summary = document.getElementById('sync-task-page-summary');
        if (summary) summary.textContent = `\u7b2c ${syncTaskPage} / ${pageCount} \u9875\uff0c\u5171 ${total} \u6761`;
        const prev = document.getElementById('sync-task-prev-btn');
        const next = document.getElementById('sync-task-next-btn');
        if (prev) prev.disabled = syncTaskPage <= 1;
        if (next) next.disabled = syncTaskPage >= pageCount;

        if (tasks.length === 0) {
            tasksTable.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-center text-gray-400"><i class="fas fa-inbox mr-2"></i> \u6682\u65e0\u540c\u6b65\u4efb\u52a1</td></tr>';
        } else {
            tasksTable.innerHTML = tasks.map(task => {
                const status = Number(task.status);
                const fileSize = Math.max(0, Number(task.fileSize || 0));
                const downloadedSize = Math.max(0, Number(task.downloadedSize || 0));
                const progress = fileSize > 0 ? Math.max(0, Math.min(100, Math.round(downloadedSize / fileSize * 100))) : (status === 2 ? 100 : 0);
                const taskId = String(task.id || '');
                const targetId = String(task.targetId || '');
                const isPackage = task.targetType === 'vodPackage';
                // Use this task's recorded result, never the current catalog's size.
                const recordedCount = isPackage && status === 2
                    ? String(task.errorMessage || '').match(/，已入库视频\s*(\d+)\s*个$/)?.[1]
                    : undefined;
                const updateCount = recordedCount !== undefined && Number.isSafeInteger(Number(recordedCount))
                    ? `${Number(recordedCount).toLocaleString('zh-CN')} 首`
                    : '—';
                const completedName = status === 2
                    ? String(task.errorMessage || '').match(/^更新完成[：:]\s*(.*?)(?:，已入库视频\s*\d+\s*个)?$/)?.[1]
                    : '';
                const targetName = isPackage
                    ? (window.cloudPackageNames?.get(targetId) || completedName || '更新包')
                    : `${task.targetType || '-'}: ${targetId.slice(0, 12)}${targetId.length > 12 ? '...' : ''}`;
                let action = '<span class="text-gray-500">-</span>';
                if (status === 3) action = `<button class="text-blue-400 hover:text-blue-300 trigger-download-btn" data-task-id="${escapeHtml(taskId)}"><i class="fas fa-redo mr-1"></i>\u91cd\u8bd5</button>`;
                else if (status === 1 || status === 0) {
                    const message=String(task.errorMessage || '');
                    const label=message.includes('自动续传') ? '等待自动续传' : message.includes('断点续传') ? '断点续传中' : '执行中';
                    action = `<span class="text-yellow-400" title="${escapeHtml(message)}">${label}</span>`;
                }
                else if (status === 2) action = '<span class="text-green-400">\u5df2\u5b8c\u6210</span>';
                return `<tr>
                    <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300" title="${escapeHtml(taskId)}">${escapeHtml(taskId.slice(0, 8))}${taskId.length > 8 ? '...' : ''}</td>
                    <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${escapeHtml(String(task.taskType || '-'))}</td>
                    <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300"${isPackage ? ` data-cloud-package-id="${escapeHtml(targetId)}"` : ''}>${escapeHtml(targetName)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${updateCount}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm"><div class="w-32"><div class="w-full bg-gray-700 rounded-full h-2"><div class="bg-blue-600 h-2 rounded-full" style="width: ${progress}%"></div></div><span class="text-xs text-gray-400">${progress}%</span></div></td>
                    <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${escapeHtml(String(task.createdAt || '-'))}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm">${action}</td>
                </tr>`;
            }).join('');
        }
        tasksTable.querySelectorAll('.trigger-download-btn').forEach(button => {
            button.addEventListener('click', async function () {
                const taskId = this.dataset.taskId;
                this.disabled = true;
                try {
                    await apiService.triggerDownload(taskId);
                    showToast('\u4e0b\u8f7d\u4efb\u52a1\u5df2\u5f00\u59cb\u91cd\u8bd5', 'success');
                    await loadSyncTasks(true);
                } catch (error) {
                    showToast(error.message || '\u89e6\u53d1\u4e0b\u8f7d\u5931\u8d25', 'error');
                    this.disabled = false;
                }
            });
        });
        if (pending > 0 || running > 0) refreshDelay = 1500;
    } catch (error) {
        console.error('\u52a0\u8f7d\u540c\u6b65\u4efb\u52a1\u5931\u8d25:', error);
        if (!silent) showToast(error.message || '\u52a0\u8f7d\u540c\u6b65\u4efb\u52a1\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5', 'error');
    } finally {
        if (!silent) hideLoading();
        syncTaskLoading = false;
        const visible = () => localStorage.getItem('admin_token') && !document.getElementById('cloud-section')?.classList.contains('hidden');
        if (visible()) syncTaskRefreshTimer = setTimeout(() => {
            syncTaskRefreshTimer = null;
            if (visible()) return loadSyncTasks(true);
        }, refreshDelay);
    }
}

async function loadRecentActivities() {
    const activityLog = document.getElementById('activity-log');
    if (!activityLog) return;

    try {
        const res = await apiService.getActivities(20);
        const items = (res && res.data) ? res.data : [];

        if (items.length === 0) {
            activityLog.innerHTML = `
                <tr>
                    <td colspan="4" class="px-6 py-8 text-center text-gray-400">
                        <i class="fas fa-info-circle mr-2"></i>
                        暂无活动记录
                    </td>
                </tr>
            `;
            return;
        }

        activityLog.innerHTML = items.map(function (item) {
            const time = item.createdAt ? String(item.createdAt).replace('T', ' ').substring(0, 16) : '-';
            const action = escapeHtml(item.actionLabel || item.action || '');
            const type = escapeHtml(item.actorType || '');
            const detail = escapeHtml(item.detail || '');
            return `<tr>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${time}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${action}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${type}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${detail}</td>
            </tr>`;
        }).join('');
    } catch (error) {
        console.error('加载最近活动失败:', error);
        activityLog.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-8 text-center text-gray-400">
                    <i class="fas fa-exclamation-triangle mr-2"></i>
                    加载失败
                </td>
            </tr>
        `;
    }
}

// 加载操作日志
async function loadOperationLogs() {
    const logsTable = document.getElementById('logs-table');
    if (!logsTable) return;

    try {
        const response = await apiService.getActivities(100);
        const keyword = (document.getElementById('log-search')?.value || '').trim().toLowerCase();
        const items = (response?.data || []).filter(item => {
            if (!keyword) return true;
            return [item.id, item.actorName, item.actorType, item.action, item.actionLabel, item.targetType, item.targetId, item.detail]
                .some(value => String(value || '').toLowerCase().includes(keyword));
        });

        if (items.length === 0) {
            logsTable.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-gray-400"><i class="fas fa-info-circle mr-2"></i>暂无操作日志</td></tr>`;
            return;
        }

        logsTable.innerHTML = items.map(item => {
            const time = item.createdAt ? String(item.createdAt).replace('T', ' ').substring(0, 19) : '-';
            const actor = [item.actorName, item.actorType ? `(${item.actorType})` : ''].filter(Boolean).join(' ');
            const target = [item.targetType, item.targetId].filter(Boolean).join(': ');
            const detail = [item.detail, target].filter(Boolean).join(' / ');
            return `<tr>
                <td class="px-6 py-2 text-sm text-gray-300 font-mono">${escapeHtml(item.id || '-')}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${escapeHtml(time)}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${escapeHtml(actor || '-')}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-300">${escapeHtml(item.actionLabel || item.action || '-')}</td>
                <td class="px-6 py-2 text-sm text-gray-300">${escapeHtml(detail || '-')}</td>
            </tr>`;
        }).join('');
    } catch (error) {
        console.error('加载操作日志失败:', error);
        logsTable.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-red-400"><i class="fas fa-exclamation-triangle mr-2"></i>加载操作日志失败</td></tr>`;
    }
}

async function loadSettingsServerInfo() {
    const interfaceEl = document.getElementById('settings-network-interface');
    if (!interfaceEl) return;

    try {
        const res = await apiService.getServerInfo();
        if (!res || res.code !== 0 || !res.data) {
            throw new Error(res?.message || 'server-info returned no data');
        }

        const host = String(res.data.host || '').trim();
        const interfaces = Array.isArray(res.data.interfaces) ? res.data.interfaces : [];
        settingsServerPort = res.data.port;
        renderSettingsNetworkInterfaces(interfaces, host);
    } catch (error) {
        settingsServerPort = null;
        interfaceEl.innerHTML = '<option value="">Unable to read server interfaces</option>';
        showToast('Failed to read server network settings: ' + (error.message || 'network error'), 'error');
    }
}

function renderSettingsNetworkInterfaces(interfaces, configuredHost) {
    const interfaceEl = document.getElementById('settings-network-interface');
    if (!interfaceEl) return;

    const validInterfaces = interfaces.filter(item => item && isUsableServerIpv4(item.ip));
    interfaceEl.innerHTML = validInterfaces
        .map(item => `<option value="${escapeHtml(item.ip)}">${escapeHtml(item.ip)}</option>`)
        .join('');

    const matched = validInterfaces.some(item => String(item.ip) === String(configuredHost));
    if (matched) {
        interfaceEl.value = configuredHost;
    } else {
        interfaceEl.innerHTML = `<option value="${escapeHtml(configuredHost)}">${escapeHtml(configuredHost)}</option>` + interfaceEl.innerHTML;
        interfaceEl.value = configuredHost;
    }
}

function isIpv4Address(value) {
    return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(String(value || '').trim());
}

function isUsableServerIpv4(value) {
    const ip = String(value || '').trim();
    if (!isIpv4Address(ip)) return false;
    if (ip === '127.0.0.1' || ip === '0.0.0.0') return false;
    if (ip.startsWith('169.254.')) return false;
    const first = Number(ip.split('.')[0]);
    if (first >= 224 || ip === '255.255.255.255') return false;
    return true;
}

function readSettingsServerNetwork() {
    const host = String(document.getElementById('settings-network-interface')?.value || '').trim();
    const portText = String(settingsServerPort ?? '').trim();
    const port = Number(portText);
    if (!isUsableServerIpv4(host)) {
        throw new Error('请选择有效的本机 IPv4 网卡');
    }
    if (!/^\d+$/.test(portText) || port < 1 || port > 65535) {
        throw new Error('服务器网络配置未正确加载，请重新加载后再试');
    }
    return { host, port };
}

function setSettingsServerOperationPending(pending) {
    settingsServerOperationPending = pending;
    for (const id of ['settings-save-btn', 'tauri-btn-restart']) {
        const button = document.getElementById(id);
        if (button) button.disabled = pending;
    }
    if (!pending && currentSection === 'syslogs') setupSyslogs();
}

async function restartSettingsServer() {
    closeSyslogConnection();
    const result = await getTauriInvoke()('restart_server');
    const serverUrl = String(result?.serverUrl || '').trim();
    if (!serverUrl) {
        throw new Error('服务器重启未返回连接地址');
    }
    window.location.replace(serverUrl);
    return true;
}

function setupSystemSettings() {
    const saveBtn = document.getElementById('settings-save-btn');
    const resetBtn = document.getElementById('settings-reset-btn');
    const idleSongPathInput = document.getElementById('settings-idle-song-path');
    const idleSongPathStatus = document.getElementById('settings-idle-song-path-status');
    const idleSongPathBrowseBtn = document.getElementById('settings-idle-song-path-browse');
    const idleSongPathScanBtn = document.getElementById('settings-idle-song-path-scan');
    const idleSongScanResult = document.getElementById('settings-idle-song-scan-result');

    if (saveBtn) {
        saveBtn.onclick = async function () {
            if (settingsServerOperationPending) return;
            let leavingPage = false;
            setSettingsServerOperationPending(true);
            showLoading();
            try {
                const { host, port } = readSettingsServerNetwork();

                if (mediaRootInput) {
                    const mediaVal = mediaRootInput.value.trim();
                    await apiService.request('/system/settings/media_root', {
                        method: 'PUT',
                        body: JSON.stringify({ value: mediaVal })
                    });
                    if (mediaRootStatus) {
                        mediaRootStatus.textContent = mediaVal ? 'Saved and active' : 'Cleared';
                        mediaRootStatus.className = 'text-xs mt-1 text-green-400';
                    }
                }
                if (idleSongPathInput) {
                    const idleSongPathVal = resolveIdleSongAbsolutePath(
                        idleSongPathInput.value,
                        mediaRootInput ? mediaRootInput.value : ''
                    );
                    const idleSongPathResult = await apiService.request('/system/settings/idle_song_path', {
                        method: 'PUT',
                        body: JSON.stringify({ value: idleSongPathVal })
                    });
                    const savedIdleSongPath = idleSongPathResult?.data?.value || idleSongPathVal;
                    idleSongPathInput.value = resolveIdleSongAbsolutePath(
                        savedIdleSongPath,
                        mediaRootInput ? mediaRootInput.value : ''
                    );
                    if (idleSongPathStatus) {
                        idleSongPathStatus.textContent = '已保存完整路径并立即生效';
                        idleSongPathStatus.className = 'text-xs mt-2 text-green-400';
                    }
                }

                // Save network last: the desktop proxy reads this address for every new connection.
                const networkResult = await apiService.updateServerNetwork(host, port);
                const restartRequired = networkResult?.data?.restartRequired === true;
                const invoke = getTauriInvoke();
                if (restartRequired && invoke) {
                    showToast('Settings saved; restarting server', 'info');
                    try {
                        leavingPage = await restartSettingsServer();
                    } catch (restartError) {
                        console.error('Server restart failed after settings were saved:', restartError);
                        const restartMessage = restartError?.message || String(restartError || 'unknown error');
                        showToast('Settings saved, but server restart failed: ' + restartMessage, 'error');
                    }
                    return;
                }
                showToast(restartRequired ? 'Settings saved; restart the server to apply them' : 'Settings saved', 'success');
            } catch (e) {
                console.error('Settings save failed:', e);
                showToast('Save failed: ' + (e.message || String(e || 'network error')), 'error');
            } finally {
                if (!leavingPage) setSettingsServerOperationPending(false);
                hideLoading();
            }
        };
    }
    if (resetBtn) {
        resetBtn.onclick = function () {
            loadSettingsServerInfo();
            showToast('Reloaded the active server configuration', 'info');
        };
    }

    // 媒体根目录配置
    const mediaRootInput = document.getElementById('settings-media-root');
    const mediaRootStatus = document.getElementById('settings-media-root-status');

    const loadIdleSongPathSetting = function () {
        if (!idleSongPathInput) return;
        apiService.request('/system/settings/idle_song_path').then(function (res) {
            if (res.code === 0 && res.data) {
                idleSongPathInput.value = resolveIdleSongAbsolutePath(
                    res.data.value || '',
                    mediaRootInput ? mediaRootInput.value : ''
                );
                if (idleSongPathStatus) idleSongPathStatus.textContent = res.data.value ? '当前已配置完整路径' : '未配置，将使用默认路径 YN-song/freesongs';
            }
        }).catch(function () {});
    };

    if (idleSongPathBrowseBtn && idleSongPathInput) {
        idleSongPathBrowseBtn.onclick = function () {
            openMediaDirectoryPicker(idleSongPathInput.value.trim(), async function (path) {
                idleSongPathInput.value = path;
                if (idleSongPathStatus) {
                    idleSongPathStatus.textContent = '正在保存空闲歌曲路径...';
                    idleSongPathStatus.className = 'text-xs mt-2 text-yellow-400';
                }
                try {
                    const result = await apiService.request('/system/settings/idle_song_path', {
                        method: 'PUT',
                        body: JSON.stringify({ value: path })
                    });
                    idleSongPathInput.value = resolveIdleSongAbsolutePath(
                        result?.data?.value || path,
                        mediaRootInput ? mediaRootInput.value : ''
                    );
                    if (idleSongPathStatus) {
                        idleSongPathStatus.textContent = path ? '已保存，立即生效' : '已清空，将使用默认路径 YN-song/freesongs';
                        idleSongPathStatus.className = 'text-xs mt-2 text-green-400';
                    }
                    showToast('空闲歌曲路径已保存', 'success');
                } catch (e) {
                    if (idleSongPathStatus) {
                        idleSongPathStatus.textContent = '保存失败：' + (e.message || '网络异常');
                        idleSongPathStatus.className = 'text-xs mt-2 text-red-400';
                    }
                    showToast('空闲歌曲路径保存失败', 'error');
                }
            });
        };
    }

    if (idleSongPathScanBtn && idleSongScanResult) {
        idleSongPathScanBtn.onclick = async function () {
            idleSongScanResult.classList.remove('hidden');
            idleSongScanResult.innerHTML = '<div class="text-gray-400">正在按当前输入框配置扫描...</div>';
            try {
                const query = {};
                if (mediaRootInput && mediaRootInput.value.trim()) {
                    query.media_root = mediaRootInput.value.trim();
                }
                if (idleSongPathInput && idleSongPathInput.value.trim()) {
                    query.idle_song_path = resolveIdleSongAbsolutePath(
                        idleSongPathInput.value,
                        mediaRootInput ? mediaRootInput.value : ''
                    );
                }
                const res = await apiService.scanIdleMedia(query);
                if (!res || res.code !== 0 || !res.data) {
                    throw new Error(res && res.message ? res.message : '扫描失败');
                }
                const data = res.data;
                const dirs = (data.scanned_dirs || []).map(p => `<div class="font-mono break-all">${p}</div>`).join('') || '<div class="text-yellow-400">未配置媒体根目录</div>';
                const files = (data.files || []).slice(0, 20).map(name => `<div class="font-mono">${name}</div>`).join('');
                idleSongScanResult.innerHTML = `
                    <div>媒体根目录：<span class="font-mono text-indigo-300 break-all">${data.media_root || '未配置'}</span></div>
                    <div>空闲路径：<span class="font-mono text-indigo-300 break-all">${data.idle_song_path || ''}</span></div>
                    <div>实际扫描目录：</div>
                    <div class="pl-2 space-y-1">${dirs}</div>
                    <div>找到视频：<span class="${data.found_count > 0 ? 'text-green-400' : 'text-red-400'} font-semibold">${data.found_count || 0}</span> 个</div>
                    ${files ? `<div class="mt-1 max-h-32 overflow-auto space-y-1">${files}</div>` : '<div class="text-red-400">没有扫描到可播放视频</div>'}
                `;
            } catch (e) {
                idleSongScanResult.innerHTML = `<div class="text-red-400">扫描失败：${e.message || e}</div>`;
            }
        };
    }

    if (mediaRootInput) {
        // 加载当前值
        apiService.request('/system/settings/media_root').then(function (res) {
            if (res.code === 0 && res.data) {
                mediaRootInput.value = res.data.value || '';
                if (mediaRootStatus) mediaRootStatus.textContent = res.data.value ? '当前已配置路径' : '未配置';
                loadIdleSongPathSetting();

            }
        }).catch(function () {
            loadIdleSongPathSetting();
        });

        document.getElementById('settings-media-root-browse')?.addEventListener('click', () =>
            chooseDirectoryForInput('settings-media-root', 'mediaRoots'));
    }

    // 之前的媒体根目录保存按钮逻辑已整合到全局保存按钮中
}

function normalizeMediaRootPath(path) {
    const normalized = String(path || '').trim().replace(/\\/g, '/');
    if (/^[A-Za-z]:\/?$/.test(normalized)) {
        return `${normalized.slice(0, 2)}/`;
    }
    return normalized.replace(/\/+$/g, '');
}

function isWindowsAbsoluteMediaPath(path) {
    return /^[A-Za-z]:[\\/]/.test(String(path || '').trim());
}

function formatWindowsAbsolutePath(path) {
    const normalized = String(path || '').trim().replace(/\\/g, '/');
    if (!isWindowsAbsoluteMediaPath(normalized)) return normalized;
    const drive = normalized.slice(0, 2);
    const parts = normalized.slice(3).split('/').filter(part => part && part !== '.');
    return parts.length ? `${drive}\\${parts.join('\\')}` : `${drive}\\`;
}

function idlePathRelativeToRoot(path, root) {
    const normalizedPath = String(path || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
    const normalizedRoot = normalizeMediaRootPath(root);
    const comparableRoot = normalizedRoot.replace(/\/+$/g, '');
    if (!normalizedPath || !comparableRoot) return null;
    if (normalizedPath.toLowerCase() === comparableRoot.toLowerCase()) return '';
    const prefix = `${comparableRoot}/`;
    return normalizedPath.toLowerCase().startsWith(prefix.toLowerCase())
        ? normalizedPath.slice(prefix.length).replace(/^\/+|\/+$/g, '')
        : null;
}

function buildAbsoluteMediaPath(root, relativePath) {
    const normalizedRoot = normalizeMediaRootPath(root);
    const relative = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const joined = relative
        ? `${normalizedRoot.replace(/\/+$/g, '')}/${relative}`
        : normalizedRoot;
    return isWindowsAbsoluteMediaPath(joined) ? formatWindowsAbsolutePath(joined) : joined;
}

function resolveIdleSongAbsolutePath(path, mediaRootsRaw) {
    const value = String(path || '').trim();
    if (!value) return '';
    if (isWindowsAbsoluteMediaPath(value)) return formatWindowsAbsolutePath(value);
    const roots = String(mediaRootsRaw || '').split(';').map(normalizeMediaRootPath).filter(Boolean);
    const relative = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return roots.length ? buildAbsoluteMediaPath(roots[0], relative) : relative;
}

async function openMediaDirectoryPicker(initialPath, onSelect) {
    const paths = await selectNativeDirectories('idleSongs', initialPath);
    if (!paths) return;
    const roots = document.getElementById('settings-media-root')?.value || '';
    if (!roots.split(';').some(root => root.trim() && idlePathRelativeToRoot(paths[0], root) !== null)) {
        showToast('空闲歌曲文件夹必须位于媒体根目录内，请先配置媒体根目录。', 'warning');
        return;
    }
    await onSelect(paths[0]);
}

function setupCloudEventListeners() {
    // Cloud settings and task pagination
    const cloudDirectory = document.getElementById('cloud-download-dir');
    for (const event of ['input', 'change']) cloudDirectory?.addEventListener(event, () => { cloudDirectory.dataset.dirty = 'true'; });
    const cloudMode = document.getElementById('cloud-update-mode');
    cloudMode?.addEventListener('change', () => { cloudMode.dataset.dirty = 'true'; renderCloudUpdateMode(window.cloudSavedUpdateMode); });
    document.getElementById('cloud-config-form')?.addEventListener('submit', saveCloudConfig);
    document.getElementById('choose-cloud-directory-btn')?.addEventListener('click', chooseCloudDirectory);
    document.getElementById('apply-cloud-updates-btn')?.addEventListener('click', applyCloudUpdates);

    const syncTaskPrevBtn = document.getElementById('sync-task-prev-btn');
    if (syncTaskPrevBtn) {
        syncTaskPrevBtn.addEventListener('click', function () {
            if (syncTaskPage > 1) {
                syncTaskPage -= 1;
                loadSyncTasks();
            }
        });
    }

    const syncTaskNextBtn = document.getElementById('sync-task-next-btn');
    if (syncTaskNextBtn) {
        syncTaskNextBtn.addEventListener('click', function () {
            syncTaskPage += 1;
            loadSyncTasks();
        });
    }
    // 清空日志按钮
    const clearLogsBtn = document.getElementById('clear-logs-btn');
    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', async function () {
            if (!await showConfirm('确定要清空所有操作日志吗？')) return;
            try {
                await apiService.clearActivities();
                await loadOperationLogs();
                showToast('操作日志已清空', 'success');
            } catch (error) {
                console.error('清空操作日志失败:', error);
                showToast(error.message || '清空操作日志失败', 'error');
            }
        });
    }

    // 搜索日志按钮
    const searchLogsBtn = document.getElementById('search-logs-btn');
    if (searchLogsBtn) {
        searchLogsBtn.addEventListener('click', function () {
            loadOperationLogs();
        });
    }
}

// 桌面端（Tauri）测试：仅在存在 __TAURI__ 时显示并绑定按钮
// Tauri v1 的 invoke 在 window.__TAURI__.tauri.invoke
function getTauriInvoke() {
    return window.__TAURI__?.tauri?.invoke
        || window.__TAURI__?.invoke
        || window.__TAURI_INVOKE__
        || null;
}

function initTauriTest() {
    const invoke = getTauriInvoke();
    if (!invoke) return;

    const block = document.getElementById('tauri-test-block');
    const msgEl = document.getElementById('tauri-test-msg');
    if (!block || !msgEl) return;

    block.classList.remove('hidden');

    function showMsg(text, isError) {
        msgEl.classList.remove('hidden');
        msgEl.textContent = text;
        msgEl.className = 'mt-3 text-sm ' + (isError ? 'text-red-400' : 'text-gray-400');
    }

    async function refreshStatus() {
        const statusEl = document.getElementById('tauri-server-status');
        const uptimeEl = document.getElementById('tauri-uptime');
        const urlEl = document.getElementById('tauri-server-url');
        if (!statusEl || !uptimeEl || !urlEl) return;
        try {
            const [status, url] = await Promise.all([
                invoke('get_server_status'),
                invoke('get_server_url'),
            ]);
            statusEl.textContent = status.running ? '运行中' : '已停止';
            statusEl.className = 'text-sm ' + (status.running ? 'text-green-400' : 'text-red-400');
            uptimeEl.textContent = status.uptime_seconds != null ? '运行时长：' + status.uptime_seconds + ' 秒' : '—';
            urlEl.textContent = url || '—';
        } catch (e) {
            statusEl.textContent = '获取失败';
            uptimeEl.textContent = '';
            urlEl.textContent = '';
            showMsg('获取状态失败: ' + (e.message || e), true);
        }
    }

    const btnStatus = document.getElementById('tauri-btn-status');
    const btnLogs = document.getElementById('tauri-btn-logs');
    const btnData = document.getElementById('tauri-btn-data');
    const btnRestart = document.getElementById('tauri-btn-restart');

    if (btnStatus && !btnStatus.dataset.tauriBound) {
        btnStatus.dataset.tauriBound = '1';
        btnStatus.addEventListener('click', async function () {
            showMsg('正在刷新…');
            await refreshStatus();
            showMsg('已刷新');
            setTimeout(function () { msgEl.classList.add('hidden'); }, 2000);
        });
    }
    if (btnLogs && !btnLogs.dataset.tauriBound) {
        btnLogs.dataset.tauriBound = '1';
        btnLogs.addEventListener('click', async function () {
            try {
                const path = await invoke('open_logs_dir');
                showMsg('已打开: ' + path);
            } catch (e) {
                showMsg('打开失败: ' + (e.message || e), true);
            }
        });
    }
    if (btnData && !btnData.dataset.tauriBound) {
        btnData.dataset.tauriBound = '1';
        btnData.addEventListener('click', async function () {
            try {
                const path = await invoke('open_data_dir');
                showMsg('已打开: ' + path);
            } catch (e) {
                showMsg('打开失败: ' + (e.message || e), true);
            }
        });
    }
    if (btnRestart && !btnRestart.dataset.tauriBound) {
        btnRestart.dataset.tauriBound = '1';
        btnRestart.addEventListener('click', async function () {
            if (settingsServerOperationPending) return;
            let leavingPage = false;
            setSettingsServerOperationPending(true);
            try {
                const { host, port } = readSettingsServerNetwork();
                if (!(await showConfirm(`确定应用服务器地址 ${host}:${port} 并重启服务器吗？`))) return;
                showMsg('正在保存网络配置并重启…');
                await apiService.updateServerNetwork(host, port);
                leavingPage = await restartSettingsServer();
            } catch (e) {
                showMsg('重启失败: ' + (e.message || e), true);
            } finally {
                if (!leavingPage) setSettingsServerOperationPending(false);
            }
        });
    }

    var btnRelaunch = document.getElementById('tauri-btn-relaunch');
    if (btnRelaunch && !btnRelaunch.dataset.tauriBound) {
        btnRelaunch.dataset.tauriBound = '1';
        btnRelaunch.addEventListener('click', async function () {
            if (!(await showConfirm('确定要重启整个桌面应用吗？窗口将关闭并重新打开。'))) return;
            try {
                showMsg('正在重启应用…');
                await invoke('relaunch_app');
            } catch (e) {
                showMsg('重启失败: ' + (e.message || e), true);
            }
        });
    }

    refreshStatus();
}

// 刷新系统资源状态 (CPU, 内存, 磁盘)
async function refreshSystemStatus() {
    try {
        const resp = await apiService.getSystemStatus();
        if (resp.code !== 0 || !resp.data) return;

        const data = resp.data;

        // 更新 CPU
        const cpuEl = document.getElementById('cpu-usage');
        const cpuBar = document.getElementById('cpu-bar');
        if (cpuEl) cpuEl.textContent = `${data.cpu_usage.toFixed(1)}%`;
        if (cpuBar) cpuBar.style.width = `${data.cpu_usage}%`;

        // 更新内存
        const memEl = document.getElementById('memory-usage');
        const memBar = document.getElementById('memory-bar');
        if (memEl) memEl.textContent = `${data.memory_usage_percent.toFixed(1)}% (${data.memory_used_mb}MB / ${data.memory_total_mb}MB)`;
        if (memBar) memBar.style.width = `${data.memory_usage_percent}%`;

        // 更新连接数
        const loadEl = document.getElementById('system-load');
        if (loadEl && data.ws_count !== undefined) {
            // 将 "X个连接" 修改为 "00X" 三位补零格式
            loadEl.textContent = String(data.ws_count).padStart(3, '0');
        }

        // 更新磁盘 (支持多磁盘)
        const diskContainer = document.getElementById('disk-info-container');
        if (diskContainer) {
            if (!data.disks || data.disks.length === 0) {
                diskContainer.innerHTML = '<div class="text-sm text-gray-500">未检测到可显示磁盘</div>';
            } else {
                diskContainer.innerHTML = data.disks.map((disk) => {
                    const percent = Math.max(0, Math.min(100, Number(disk.usage_percent || 0)));
                    const color = percent >= 90 ? '#ef4444' : '#3b82f6';
                    const mount = escapeHtml(disk.mount_point || '未知挂载点');
                    const name = escapeHtml(disk.name || '磁盘');
                    const total = Number(disk.total_space_gb || 0).toFixed(1);
                    const free = Number(disk.available_space_gb || 0).toFixed(1);
                    const label = name && name !== '磁盘' ? `${mount} (${name})` : mount;
                    return `
                        <div class="bg-gray-800/70 border border-gray-700 rounded-lg p-3 hover:bg-gray-800 transition min-w-0">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 shrink-0 rounded-md bg-gray-900 border border-gray-700 flex items-center justify-center">
                                    <i class="fas fa-hdd text-xl" style="color:${color}"></i>
                                </div>
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center justify-between gap-2">
                                        <div class="text-white text-xs font-semibold truncate">${label}</div>
                                        <div class="text-[10px] text-gray-400 shrink-0">${percent.toFixed(0)}%</div>
                                    </div>
                                    <div class="w-full bg-gray-700 rounded-sm h-2 mt-2 overflow-hidden">
                                        <div class="h-2 rounded-sm" style="width:${percent}%; background:${color};"></div>
                                    </div>
                                    <div class="text-[10px] text-gray-400 mt-2 truncate">${free} GB 可用 / ${total} GB</div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (error) {
        console.error('刷新系统状态失败:', error);
    }
}

// 更新统计数据
async function updateStatistics() {
    try {
        const [roomsResp, termsResp, statsResp] = await Promise.all([
            window.allRoomsCache ? Promise.resolve({ data: window.allRoomsCache }) : apiService.getRooms().catch(() => ({ data: [] })),
            apiService.getTerminals().catch(() => ({ data: [] })),
            apiService.getSongDbStats().catch(() => ({ data: {} }))
        ]);

        const totalRooms = roomsResp.data ? roomsResp.data.length : 0;
        const onlineTerms = termsResp.data ? termsResp.data.filter(t => t.onlineStatus === 1).length : 0;
        const stats = statsResp.data || {};

        const elRooms = document.getElementById('total-rooms');
        const elTerms = document.getElementById('active-terminals');
        const elSongs = document.getElementById('total-songs');
        const elArtists = document.getElementById('total-artists');

        if (elRooms) elRooms.textContent = totalRooms.toString();
        if (elTerms) elTerms.textContent = onlineTerms.toString();
        if (elSongs) elSongs.textContent = stats.total_songs || 0;
        if (elArtists) elArtists.textContent = stats.total_singers || 0;

        // 刷新系统资源状态
        refreshSystemStatus();

        // 还可以尝试加载字典数据来初始化过滤器
        initFilters();
    } catch (error) {
        console.error('更新统计数据失败:', error);
    }
}

// 字典编码与服务端分组一一对应；名称始终以数据库为准。
const dictMaps = Object.fromEntries(['language', 'region', 'sex', 'track', 'classify'].map(group => [group, Object.create(null)]));

function getDictName(type, code) {
    const value = String(code ?? '').trim();
    return dictMaps[type]?.[value] || value || '未知';
}

function formatDictDisplay(type, code, name) {
    const value = String(code ?? '').trim();
    return escapeHtml(dictMaps[type]?.[value] || String(name ?? '').trim() || value || '未知');
}

function formatTrack(track) {
    return escapeHtml(getDictName('track', track));
}

function formatVideoFileType(videoFileType) {
    const value = String(videoFileType || '').trim();
    if (!value) return '-';
    const names = {
        '0': '未知',
        '1': 'DAT',
        '2': 'MPG',
        '3': 'MP4',
        '4': 'AVI',
        '5': 'VOB',
        '6': 'MKV',
        dat: 'DAT',
        mpg: 'MPG',
        mpeg: 'MPEG',
        hvideo: 'HVIDEO',
        mp4: 'MP4',
        avi: 'AVI',
        vob: 'VOB',
        mkv: 'MKV'
    };
    return names[value] || names[value.toLowerCase()] || value;
}

function formatSongRelativePath(song) {
    const relativePath = String(song?.relativePath || '').trim().replace(/\\/g, '/');
    const fileName = String(song?.fileName || '').trim().replace(/\\/g, '/');
    if (!relativePath) return fileName;
    if (!fileName) return relativePath;
    // 对照后的 relativePath 已含文件名；导入的目录路径才需要补上 fileName。
    // 与服务端 media_path::join_path_and_file 的文件路径规则一致。
    if (/\.(hvideo|mp4|mkv|avi|mov|flv|wmv|m4v|mpg|mpeg|vob|dat|ts)$/i.test(relativePath)) {
        return relativePath;
    }
    return `${relativePath.replace(/\/+$/, '')}/${fileName.replace(/^\/+/, '')}`;
}

function splitSongPathInput(path) {
    const normalized = String(path || '').trim().replace(/\\/g, '/');
    if (!normalized) {
        return { relativePath: '', fileName: '' };
    }
    const index = normalized.lastIndexOf('/');
    if (index < 0) {
        return { relativePath: '', fileName: normalized };
    }
    return {
        relativePath: normalized.slice(0, index + 1),
        fileName: normalized.slice(index + 1)
    };
}

// 后台可查看隐藏项，便于维护已有歌曲；不再使用与数据库不一致的预置名称。
let dictFilterVersion = 0;
async function initFilters() {
    const version = ++dictFilterVersion;
    const targets = {
        language: [['song-language-filter', '全部语言'], ['song-language', '未知']],
        region: [['singer-region-filter', '全部地区'], ['singer-region', '未知']],
        sex: [['singer-sex-filter', '全部性别'], ['singer-sex', '未知']],
        classify: [['song-classify', '未知']],
        track: []
    };
    const groups = Object.keys(targets);
    const results = await Promise.allSettled(groups.map(group => apiService.getSongDbDict(group)));
    if (version !== dictFilterVersion) return;
    results.forEach((result, index) => {
        const group = groups[index];
        if (result.status !== 'fulfilled' || result.value.code !== 0 || !Array.isArray(result.value.data)) {
            console.error(`加载字典 ${group} 失败`, result.reason || result.value);
            return;
        }
        const entries = result.value.data;
        const names = Object.create(null);
        entries.forEach(item => { names[item.dictCode] = item.dictName; });
        dictMaps[group] = names;
        targets[group].forEach(([id, placeholder]) => {
            const select = document.getElementById(id);
            if (!select) return;
            const selected = select.value;
            select.replaceChildren(new Option(placeholder, ''), ...entries.map(item =>
                new Option(`${item.dictName}${item.visible === 0 ? '（隐藏）' : ''}`, item.dictCode)));
            select.value = entries.some(item => item.dictCode === selected) ? selected : '';
        });
    });
}

document.addEventListener('dictionary-changed', () => initFilters());

/**
 * 加载外设预设数据（用于状态栏显示名称）
 */
async function loadPeripheralPresets() {
    try {
        const response = await apiService.getPeripheralPresets();
        if (response.code === 0 && response.data) {
            // 按类型分组存储
            window.peripheralPresets = {
                light: [],
                effect: [],
                ac: []
            };

            response.data.forEach(preset => {
                const settings = typeof preset.settings === 'string'
                    ? JSON.parse(preset.settings)
                    : preset.settings;

                const presetData = {
                    id: preset.id,
                    name: preset.name,
                    code: settings.code || settings.scene || settings.mode,
                    ctrlType: settings.ctrlType
                };

                if (preset.presetType === 'light') {
                    window.peripheralPresets.light.push(presetData);
                } else if (preset.presetType === 'effect') {
                    window.peripheralPresets.effect.push(presetData);
                } else if (preset.presetType === 'ac') {
                    window.peripheralPresets.ac.push(presetData);
                }
            });
        }
    } catch (error) {
        console.warn('[Admin] 加载外设预设数据失败:', error);
        // 失败不影响其他功能，使用默认值
        window.peripheralPresets = { light: [], effect: [], ac: [] };
    }
}

// 初始化
async function init() {
    initResponsiveLayout();
    setupEventListeners();
    setupServerRestartEvents();
    initTauriTest();
    await initializeLoginServerNetwork();

    // 初始化外设状态栏（底部状态栏）
    if (typeof peripheralStatusBar !== 'undefined') {
        peripheralStatusBar.init('peripheral-status-bar');
    }

    // 加载外设预设数据（用于状态栏显示名称）
    loadPeripheralPresets();

    if (!licenseStatusPollingTimer) licenseStatusPollingTimer = setInterval(loadLicenseStatus, 30000);
    const licenseStatus = await loadLicenseStatus();
    if (!licenseStatus?.valid) {
        apiService.clearToken();
        currentUser = null;
        loginPage.classList.remove('hidden');
        adminPage.classList.add('hidden');
        return;
    }

    if (typeof loadSettingsServerInfo === 'function') {
        await loadSettingsServerInfo();
    }

    // 检查是否已登录
    if (localStorage.getItem('admin_token')) {
        // 加载初始数据
        try {
            currentUser = { username: 'admin', role: 'admin' }; // 假定 token 存在即已登录
            document.getElementById('admin-username').textContent = currentUser.username;
            showSection('dashboard');
            loginPage.classList.add('hidden');
            adminPage.classList.remove('hidden');
                    startCloudStatusPolling();
            await loadTerminals();
            await loadRooms();
            await loadSongs();
            await loadArtists();
            await updateStatistics();

            // 每 5 秒刷新一次系统状态
            setInterval(() => {
                if (currentSection === 'dashboard' && !adminPage.classList.contains('hidden')) {
                    refreshSystemStatus();
                }
            }, 5000);
        } catch (error) {
            console.error('初始化数据失败:', error);
            if (error.message.includes('登录') || error.message.includes('Token')) {
                // 如果是认证错误，清除状态并显示登录页
                localStorage.removeItem('admin_token');
                currentUser = null;
                loginPage.classList.remove('hidden');
                adminPage.classList.add('hidden');
                showToast('登录已过期，请重新登录', 'error');
            } else {
                showToast('初始化数据失败，部分功能可能不可用', 'warning');
            }
        }
    }
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
startClock();

// ==================== POS 界面辅助函数 ====================

// 启动时钟
function startClock() {
    const el = document.getElementById('current-system-time');
    if (!el) return;
    setInterval(() => {
        const now = new Date();
        el.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
    }, 1000);
}



// ==================== 房间管理逻辑 (Helpers) ====================

// 打开配置管理弹窗（使用函数便于内联 onclick 调用）
const configModal = document.getElementById('room-config-modal');
const closeConfigModalBtn = document.getElementById('close-room-config-modal');
let roomConfigRevision = 0;
let roomConfigBusy = false;
let roomConfigReturnFocus = null;

function openRoomConfigModal() {
    roomConfigReturnFocus = document.activeElement;
    renderRoomConfigLists();
    configModal.classList.remove('hidden');
    newTypeInput.focus();
    setRoomConfigStatus('正在读取配置...');
    refreshRoomConfigLists().then(refreshed => {
        if (refreshed) setRoomConfigStatus('');
    }).catch(error => setRoomConfigStatus(error.message || '读取失败，请重试', true));
}
window.openRoomConfigModal = openRoomConfigModal;

if (closeConfigModalBtn && configModal) {
    closeConfigModalBtn.addEventListener('click', () => {
        configModal.classList.add('hidden');
        roomConfigReturnFocus?.focus();
    });
    configModal.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeConfigModalBtn.click();
        if (event.key !== 'Tab') return;
        const controls = [...configModal.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
        }
    });
}

// 渲染配置列表
function renderRoomConfigLists() {
    const typesList = document.getElementById('room-types-list');
    const areasList = document.getElementById('room-areas-list');

    if (typesList) {
        typesList.innerHTML = roomTypes.length ? roomTypes.map(t => `
            <li class="config-item"><span class="config-item-name" translate="no">${escapeHtml(t.name)}</span>
                <button type="button" onclick="deleteConfig('type', ${t.id})" class="config-delete" title="删除" aria-label="删除类型：${escapeHtml(t.name)}"><i class="fas fa-trash" aria-hidden="true"></i></button></li>
        `).join('') : '<li class="config-empty">暂无房间类型</li>';
    }

    if (areasList) {
        areasList.innerHTML = roomAreas.length ? roomAreas.map(a => `
            <li class="config-item"><span class="config-item-name" translate="no">${escapeHtml(a.name)}</span>
                <button type="button" onclick="deleteConfig('area', ${a.id})" class="config-delete" title="删除" aria-label="删除区域：${escapeHtml(a.name)}"><i class="fas fa-trash" aria-hidden="true"></i></button></li>
        `).join('') : '<li class="config-empty">暂无房间区域</li>';
    }
    document.getElementById('room-types-count')?.replaceChildren(document.createTextNode(String(roomTypes.length)));
    document.getElementById('room-areas-count')?.replaceChildren(document.createTextNode(String(roomAreas.length)));
}

function setRoomConfigStatus(message, error = false) {
    const status = document.getElementById('room-config-status');
    status.textContent = message;
    status.classList.toggle('config-error', error);
}

function syncRoomConfigViews() {
    window.roomTypes = roomTypes;
    window.roomAreas = roomAreas;
    renderRoomConfigLists();
    renderRoomTabs();
    renderAreaTabs();
    updateRoomModalOptions();
}

function setRoomConfigBusy(busy) {
    roomConfigBusy = busy;
    roomConfigRevision++;
    configModal.setAttribute('aria-busy', String(busy));
    configModal.querySelectorAll('input, .config-delete, .config-add, #reload-room-configs').forEach(control => {
        control.disabled = busy;
    });
}

async function refreshRoomConfigLists() {
    if (roomConfigBusy) return false;
    const revision = ++roomConfigRevision;
    let typesResp, areasResp;
    try {
        [typesResp, areasResp] = await Promise.all([
            apiService.getRoomTypes(),
            apiService.getRoomAreas()
        ]);
    } catch (error) {
        if (revision !== roomConfigRevision) return false;
        throw error;
    }
    if (revision !== roomConfigRevision) return false;
    if (typesResp.code !== 0 || areasResp.code !== 0 || !Array.isArray(typesResp.data) || !Array.isArray(areasResp.data)) {
        throw new Error('房间配置返回格式错误');
    }
    roomTypes = typesResp.data;
    roomAreas = areasResp.data;
    syncRoomConfigViews();
    return true;
}

// 添加配置
const addTypeBtn = document.getElementById('add-room-type-btn');
const newTypeInput = document.getElementById('new-room-type');
const addAreaBtn = document.getElementById('add-room-area-btn');
const newAreaInput = document.getElementById('new-room-area');
async function addRoomConfig(kind) {
    if (roomConfigBusy) return;
    const input = kind === 'type' ? newTypeInput : newAreaInput;
    const name = input.value.trim();
    if (!name) { setRoomConfigStatus('请输入名称', true); input.focus(); return; }
    const items = kind === 'type' ? roomTypes : roomAreas;
    if (items.some(item => item.name === name)) {
        setRoomConfigStatus('该名称已存在', true); input.focus(); return;
    }
    setRoomConfigBusy(true);
    setRoomConfigStatus('正在添加...');
    try {
        const response = kind === 'type' ? await apiService.createRoomType(name) : await apiService.createRoomArea(name);
        if (response?.code !== 0 || !Number.isInteger(response.data?.id)) throw new Error(response?.message || '添加失败');
        if (kind === 'type') roomTypes = [...roomTypes.filter(item => item.id !== response.data.id), response.data];
        else roomAreas = [...roomAreas.filter(item => item.id !== response.data.id), response.data];
        syncRoomConfigViews();
        input.value = '';
        setRoomConfigStatus(`已添加：${name}`);
        document.getElementById(kind === 'type' ? 'room-types-list' : 'room-areas-list').lastElementChild?.scrollIntoView({ block: 'nearest' });
    } catch (error) {
        setRoomConfigStatus(error.message || '添加失败', true);
    } finally {
        setRoomConfigBusy(false);
        input.focus();
    }
}
addTypeBtn?.addEventListener('click', () => addRoomConfig('type'));
addAreaBtn?.addEventListener('click', () => addRoomConfig('area'));
[[newTypeInput, 'type'], [newAreaInput, 'area']].forEach(([input, kind]) => {
    input?.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); addRoomConfig(kind); }
    });
});
document.getElementById('reload-room-configs')?.addEventListener('click', () => {
    setRoomConfigStatus('正在读取配置...');
    refreshRoomConfigLists().then(refreshed => {
        if (refreshed) setRoomConfigStatus('');
    }).catch(error => setRoomConfigStatus(error.message, true));
});

// 删除配置
async function deleteConfig(type, id) {
    if (roomConfigBusy) return;
    if (!(await showConfirm('确定要删除吗？'))) return;
    if (roomConfigBusy) return;
    setRoomConfigBusy(true);
    try {
        const response = type === 'type' ? await apiService.deleteRoomType(id) : await apiService.deleteRoomArea(id);
        if (response?.code !== 0) throw new Error(response?.message || '删除失败');
        if (type === 'type') roomTypes = roomTypes.filter(item => item.id !== id);
        else roomAreas = roomAreas.filter(item => item.id !== id);
        if (type === 'type' && window.activeType == id) window.activeType = 'all';
        if (type === 'area' && window.activeArea == id) window.activeArea = 'all';
        syncRoomConfigViews();
        loadRooms(false);
        setRoomConfigStatus('配置已删除');
    } catch (e) { setRoomConfigStatus(e?.message || '删除失败', true); }
    finally { setRoomConfigBusy(false); }
}

// 更新下拉框
function updateRoomModalOptions() {
    const typeSelect = document.getElementById('edit-room-type');
    const areaSelect = document.getElementById('edit-room-area');

    if (typeSelect) {
        typeSelect.innerHTML = '<option value="">未设置</option>' +
            roomTypes.map(t => `<option translate="no" value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    }
    if (areaSelect) {
        areaSelect.innerHTML = '<option value="">未设置</option>' +
            roomAreas.map(a => `<option translate="no" value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    }
}

// 编辑房间
const editRoomModal = document.getElementById('edit-room-modal');
const editRoomForm = document.getElementById('edit-room-form');
const cancelEditRoomBtn = document.getElementById('cancel-edit-room');

function openEditRoomModal(id) {
    // 假设 rooms 数据已在 loadRooms 中获取，这里可以用 API 获取单个房间详情
    // 为了简化，直接 fetch 详情
    apiService.getRoom(id).then(resp => {
        const room = resp.data;
        document.getElementById('edit-room-id').value = room.id;
        document.getElementById('edit-room-name').value = room.name;
        // 绑定下拉框
        document.getElementById('edit-room-type').value = room.typeId || '';
        document.getElementById('edit-room-area').value = room.areaId || '';
        document.getElementById('edit-room-terminal').value = room.terminalId || '';

        editRoomModal.classList.remove('hidden');
    });
}

if (cancelEditRoomBtn) {
    cancelEditRoomBtn.addEventListener('click', () => {
        editRoomModal.classList.add('hidden');
    });
}

if (editRoomForm) {
    editRoomForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-room-id').value;
        const name = document.getElementById('edit-room-name').value;
        const typeId = document.getElementById('edit-room-type').value;
        const areaId = document.getElementById('edit-room-area').value;
        const terminalId = document.getElementById('edit-room-terminal').value;

        try {
            await apiService.updateRoom(id, {
                name: name.trim(),
                terminalId,
                typeId: typeId ? parseInt(typeId, 10) : null,
                areaId: areaId ? parseInt(areaId, 10) : null
            });
            editRoomModal.classList.add('hidden');
            loadRooms();
        } catch (e) {
            showToast('保存失败: ' + (e.message || '未知错误'), 'error');
        }
    });
}

function clearSelectedRoom() {
    window.selectedRoomId = null;
    roomClientPanelCollapsed = true;

    const panel = document.getElementById('room-details-panel');
    const content = document.getElementById('room-details-content');
    const actions = document.getElementById('room-details-actions');

    if (content) {
        content.innerHTML = `
            <div class="text-center text-gray-500 mt-10">
                <i class="fas fa-mouse-pointer text-3xl mb-2 opacity-30"></i>
                <p>请点击包厢查看详情</p>
            </div>
        `;
    }
    if (actions) {
        actions.querySelectorAll('button').forEach(button => {
            button.disabled = true;
            button.onclick = null;
        });
    }
    if (panel) panel.classList.add('translate-x-full');
    if (typeof peripheralStatusBar !== 'undefined') peripheralStatusBar.clear();
}

async function deleteRoom(id) {
    if (!(await showConfirm('确定要删除房间吗？'))) return;
    try {
        await apiService.deleteRoom(id);
        if (window.selectedRoomId === id) clearSelectedRoom();
        await loadRooms();
    } catch (e) {
        showToast('删除失败', 'error');
    }
}

// 将函数暴露给全局以供 onclick 调用
window.openEditRoomModal = openEditRoomModal;
window.deleteRoom = deleteRoom;
window.deleteConfig = deleteConfig;

// ==================== POS 界面核心逻辑 (追加覆盖) ====================

// 启动时钟
function startClock() {
    const el = document.getElementById('current-system-time');
    if (!el) return;
    setInterval(() => {
        const now = new Date();
        el.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
    }, 1000);
}
startClock();

// 全局状态
window.activeType = 'all';
window.activeArea = 'all';
window.selectedRoomId = null;

// 渲染顶部类型Tabs
function renderRoomTabs() {
    const container = document.getElementById('room-type-tabs');
    if (!container) return;

    const allBtn = container.firstElementChild;
    container.innerHTML = '';
    if (allBtn) {
        container.appendChild(allBtn);
        updateTabStyle(allBtn, window.activeType === 'all');
        allBtn.onclick = () => switchType('all');
    }

    roomTypes.forEach(t => {
        const btn = document.createElement('button');
        btn.textContent = t.name;
        btn.onclick = () => switchType(t.id);
        updateTabStyle(btn, window.activeType == t.id);
        container.appendChild(btn);
    });
}

// 渲染左侧区域Tabs
function renderAreaTabs() {
    const container = document.getElementById('room-area-tabs');
    if (!container) return;

    const allBtn = container.firstElementChild;
    container.innerHTML = '';
    if (allBtn) {
        container.appendChild(allBtn);
        updateAreaTabStyle(allBtn, window.activeArea === 'all');
        allBtn.onclick = () => switchArea('all');
    }

    roomAreas.forEach(a => {
        const btn = document.createElement('button');
        btn.textContent = a.name;
        btn.title = a.name;
        btn.onclick = () => switchArea(a.id);
        updateAreaTabStyle(btn, window.activeArea == a.id);
        container.appendChild(btn);
    });
}

function updateTabStyle(btn, isActive) {
    if (isActive) {
        btn.className = 'px-4 py-1.5 bg-blue-600 text-white text-sm font-bold rounded shadow-sm hover:bg-blue-500 transition whitespace-nowrap active-type-tab';
    } else {
        btn.className = 'px-4 py-1.5 bg-gray-700 text-gray-300 text-sm font-bold rounded shadow-sm hover:bg-gray-600 transition whitespace-nowrap border border-gray-600';
    }
}

function updateAreaTabStyle(btn, isActive) {
    if (isActive) {
        btn.className = 'w-full px-2 py-3 text-xs text-center truncate bg-blue-900/50 text-blue-200 border border-blue-500/50 rounded hover:bg-blue-800/50 transition active-area-tab font-bold';
    } else {
        btn.className = 'w-full px-2 py-3 text-xs text-center truncate bg-gray-800 text-gray-400 border border-gray-700 rounded hover:bg-gray-700 transition';
    }
}

function switchType(typeId) {
    window.activeType = typeId;
    renderRoomTabs();
    loadRooms(false);
}

function switchArea(areaId) {
    window.activeArea = areaId;
    renderAreaTabs();
    loadRooms(false);
}

let padOrderingEnabled = false;
let padOrderingBusy = false;

function renderPadOrderingStatus(state = 'ready') {
    const button = document.getElementById('pad-ordering-toggle');
    const knob = document.getElementById('pad-ordering-toggle-knob');
    const status = document.getElementById('pad-ordering-status');
    if (!button || !knob || !status) return;

    const enabled = padOrderingEnabled === true;
    button.setAttribute('aria-checked', enabled ? 'true' : 'false');
    button.classList.toggle('bg-emerald-600', enabled);
    button.classList.toggle('bg-gray-600', !enabled);
    knob.classList.toggle('translate-x-5', enabled);
    knob.classList.toggle('translate-x-0.5', !enabled);

    if (state === 'loading') {
        button.disabled = true;
        status.textContent = '读取中';
        status.className = 'min-w-[3rem] text-xs text-gray-400 whitespace-nowrap';
    } else if (state === 'saving') {
        button.disabled = true;
        status.textContent = '保存中';
        status.className = 'min-w-[3rem] text-xs text-yellow-400 whitespace-nowrap';
    } else if (state === 'error') {
        button.disabled = true;
        status.textContent = '读取失败';
        status.className = 'min-w-[3rem] text-xs text-red-400 whitespace-nowrap';
    } else {
        button.disabled = false;
        status.textContent = enabled ? '已启用' : '未启用';
        status.className = `min-w-[3rem] text-xs whitespace-nowrap ${enabled ? 'text-emerald-400' : 'text-gray-400'}`;
    }
}

async function loadPadOrderingStatus() {
    if (padOrderingBusy) return;
    padOrderingBusy = true;
    renderPadOrderingStatus('loading');
    try {
        const response = await apiService.getPadOrderingStatus();
        padOrderingEnabled = response?.data?.enabled === true;
        renderPadOrderingStatus('ready');
    } catch (error) {
        console.error('读取PAD点单开关失败:', error);
        renderPadOrderingStatus('error');
        showToast(error.message || '读取PAD点单开关失败', 'error');
    } finally {
        padOrderingBusy = false;
    }
}

async function updatePadOrderingStatus() {
    if (padOrderingBusy) return;
    const previous = padOrderingEnabled;
    const next = !previous;
    padOrderingBusy = true;
    padOrderingEnabled = next;
    renderPadOrderingStatus('saving');
    try {
        const response = await apiService.updatePadOrderingStatus(next);
        padOrderingEnabled = response?.data?.enabled === true;
        renderPadOrderingStatus('ready');
        showToast(`PAD点单已${padOrderingEnabled ? '启用' : '停用'}`, 'success');
    } catch (error) {
        padOrderingEnabled = previous;
        renderPadOrderingStatus('ready');
        showToast(error.message || '保存PAD点单开关失败', 'error');
    } finally {
        padOrderingBusy = false;
    }
}

function setupPadOrderingToggle() {
    const button = document.getElementById('pad-ordering-toggle');
    if (!button || button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', updatePadOrderingStatus);
}

function updateRoomStatusCounts(rooms) {
    const idle = rooms.filter(r => r.status === 0).length;
    const busy = rooms.filter(r => r.status === 1).length;
    const other = rooms.filter(r => r.status === 2).length;

    const elIdle = document.getElementById('status-count-idle');
    const elBusy = document.getElementById('status-count-busy');
    const elOther = document.getElementById('status-count-other');

    if (elIdle) elIdle.textContent = idle;
    if (elBusy) elBusy.textContent = busy;
    if (elOther) elOther.textContent = other;
}


// 这里的 fetchArgs 默认为 true，表示从 API 获取。false 表示仅重绘。
async function loadRooms(fetchData = true) {
    const roomsContainer = document.getElementById('rooms-grid');
    if (!roomsContainer) return;

    try {
        let rooms = [];
        if (fetchData === true || fetchData === undefined) {
            showLoading();
            // 增加获取 Terminals 以显示 IP，同步拉取服务铃数据
            const [roomsResp, , termsResp] = await Promise.all([
                apiService.getRooms(),
                refreshRoomConfigLists().catch(error => showToast(error.message || '读取房间配置失败', 'error')),
                apiService.getTerminals().catch(e => ({ data: [] }))
            ]);
            if (typeof loadServiceCalls === 'function') await loadServiceCalls();
            rooms = roomsResp.data || [];
            window.allTerminalsCache = termsResp.data || [];

            // Cache data globally
            window.allRoomsCache = rooms;

        } else {
            rooms = window.allRoomsCache || [];
        }

        // Filtering
        const roomKeyword = (document.getElementById('room-search')?.value || '').trim().toLowerCase();
        const filteredRooms = rooms.filter(r => {
            const matchType = (window.activeType == null || window.activeType === 'all') || r.typeId == window.activeType;
            const matchArea = (window.activeArea == null || window.activeArea === 'all') || r.areaId == window.activeArea;
            const matchKeyword = !roomKeyword || [r.id, getRoomDisplayName(r), r.terminalId, r.roomIp, r.terminalName]
                .some(value => String(value || '').toLowerCase().includes(roomKeyword));
            return matchType && matchArea && matchKeyword;
        });

        // Update Statistics
        updateRoomStatusCounts(window.allRoomsCache || []);

        roomsContainer.innerHTML = '';
        if (filteredRooms.length === 0) {
            roomsContainer.innerHTML = '<div class="col-span-full py-16 text-center text-gray-400">暂无符合条件的房间</div>';
            return;
        }

        filteredRooms.forEach(room => {
            roomsContainer.appendChild(createRoomCard(room));
        });

    } catch (error) {
        console.error('加载房间失败:', error);
    } finally {
        if (fetchData === true || fetchData === undefined) hideLoading();
    }
}

const roomSearchInput = document.getElementById('room-search');
if (roomSearchInput) {
    roomSearchInput.addEventListener('input', () => loadRooms(false));
}

function getRoomDisplayName(room) {
    const name = String(room.name ?? '');
    const terminalName = String(room.terminalName ?? '').trim();
    // Match the server's automatic name exactly; keep custom names unchanged.
    return terminalName && name === `房间-${terminalName}` ? terminalName : name;
}

function createRoomCard(room) {
    const div = document.createElement('div');
    // Colors
    let headerClass = 'bg-gradient-to-r from-blue-900 to-blue-800 text-blue-100';
    let borderClass = 'border-blue-800';
    let statusIcon = '<i class="fas fa-check-circle text-blue-400"></i>';

    if (room.status === 1) { // In Use
        headerClass = 'bg-gradient-to-r from-red-900 to-red-800 text-red-100';
        borderClass = 'border-red-800 border-2';
        statusIcon = '<i class="fas fa-user text-red-400"></i>';
    } else if (room.status === 2) { // Maintain
        headerClass = 'bg-gradient-to-r from-yellow-900 to-yellow-800 text-yellow-100';
        borderClass = 'border-yellow-700';
        statusIcon = '<i class="fas fa-tools text-yellow-400"></i>';
    } else if (room.status === 3) {
        headerClass = 'bg-gradient-to-r from-cyan-900 to-cyan-800 text-cyan-100';
        borderClass = 'border-cyan-700';
        statusIcon = '<i class="fas fa-vial text-cyan-400"></i>';
    }

    const isSelected = window.selectedRoomId === room.id;
    if (isSelected) {
        borderClass = 'border-2 border-cyan-400 shadow-[0_0_18px_rgba(34,211,238,0.35)] scale-[1.03] z-10';
    }

    const pendingCalls = (window._serviceCalls || []).filter(c => c.roomId === room.id);
    const hasCalls = pendingCalls.length > 0;
    if (hasCalls) borderClass += ' border-emerald-500/50 svc-flash';

    div.id = `room-card-${room.id}`;
    div.className = `bg-gray-800 rounded shadow-lg overflow-hidden cursor-pointer hover:shadow-xl transition-all border ${borderClass} flex flex-col relative group select-none`;

    div.onclick = (e) => {
        e.stopPropagation();
        selectRoom(room.id);
    };
    div.oncontextmenu = (e) => {
        e.preventDefault();
        selectRoom(room.id);
        showRoomContextMenu(e, room.id);
    };

    const typeName = roomTypes.find(t => t.id === room.typeId)?.name || '';
    const ip = room.roomIp || '未绑定';

    const svcBadgeContent = hasCalls ? renderServiceCallItems(pendingCalls) : '';

    div.innerHTML = `
        <!-- Title Bar -->
        <div class="${headerClass} px-2 py-1 flex justify-between items-center text-sm font-bold">
            <span class="truncate" translate="no" title="${escapeHtml(getRoomDisplayName(room))}">${escapeHtml(getRoomDisplayName(room))}</span>
            <span class="text-xs opacity-75" translate="no">${typeName}</span>
        </div>
        <!-- Body -->
        <div class="p-2 flex-col flex justify-between text-xs text-gray-300" style="min-height:72px">
            <div class="flex items-center space-x-1">
                 ${statusIcon}
                 <span class="scale-90 origin-left">${room.status === 1 ? '使用中' : (room.status === 0 ? '空闲' : (room.status === 3 ? '测试' : '维修'))}</span>
            </div>
            <div class="space-y-0.5 mb-2">
                 <div class="text-gray-400 font-mono mt-1 opacity-70" title="${ip}">${ip}</div>
            </div>
        </div>
        <!-- 服务铃徽章 -->
        <div class="room-svc-badge${hasCalls ? ' border-t border-emerald-500/30 bg-emerald-950/40 px-2 py-1.5 flex flex-col gap-1' : ''}">
            ${svcBadgeContent}
        </div>
    `;
    return div;
}

function renderRoomClientConnections(roomId, clients = []) {
    const countEl = document.getElementById(`room-client-count-${roomId}`);
    const listEl = document.getElementById(`room-client-list-${roomId}`);
    const panelEl = document.getElementById(`room-client-panel-${roomId}`);
    const iconEl = document.getElementById('room-client-toggle-icon');
    if (!countEl || !listEl || !panelEl || !iconEl) return;

    countEl.textContent = `(${clients.length})`;
    panelEl.classList.toggle('hidden', roomClientPanelCollapsed);
    iconEl.classList.toggle('rotate-90', !roomClientPanelCollapsed);

    if (!clients.length) {
        listEl.innerHTML = '<div class="text-xs text-gray-500 text-center py-2">暂无连接客户端</div>';
        return;
    }

    listEl.innerHTML = clients.map(client => {
        const typeMap = {
            display: '播放器',
            touch: '触摸屏',
            mobile: '触摸屏',
            phone: '手机',
            admin: '管理端',
            pc: '触摸屏'
        };
        const typeLabel = typeMap[client.clientType] || client.clientType || '未知类型';
        const ip = client.clientIp || '未知IP';
        const connectedAt = client.updatedAt || client.connectedAt || '-';
        const statusText = client.status === 1 ? '已连接' : '未连接';
        return `
            <div class="rounded-lg border border-gray-700 bg-gray-800/70 px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-semibold text-cyan-300 uppercase tracking-wide">${escapeHtml(typeLabel)}</span>
                    <span class="text-[10px] text-gray-500">${escapeHtml(connectedAt)}</span>
                </div>
                <div class="mt-1 flex items-center justify-between gap-3">
                    <div class="font-mono text-xs text-green-400 break-all select-all">${escapeHtml(ip)}</div>
                    <span class="text-[10px] ${client.status === 1 ? 'text-emerald-400' : 'text-gray-500'}">${statusText}</span>
                </div>
            </div>`;
    }).join('');
}

async function loadRoomClientConnections(room) {
    const roomId = room.id;
    const countEl = document.getElementById(`room-client-count-${roomId}`);
    const listEl = document.getElementById(`room-client-list-${roomId}`);
    if (!countEl || !listEl) return;

    try {
        const res = await apiService.getRoomClientConnections({ roomId: room.id });
        const clients = (res && res.data) || [];
        renderRoomClientConnections(roomId, clients);
    } catch (error) {
        console.error('加载房间连接客户端失败:', error, room);
        countEl.textContent = '(加载失败)';
        listEl.innerHTML = '<div class="text-xs text-red-400 text-center py-2">客户端列表加载失败</div>';
    }
}

function toggleRoomClientPanel() {
    const roomId = window.selectedRoomId;
    if (!roomId) return;
    roomClientPanelCollapsed = !roomClientPanelCollapsed;
    const room = (window.allRoomsCache || []).find(r => r.id === roomId);
    if (!room) return;
    loadRoomClientConnections(room);
}

function selectRoom(roomId) {
    if (!roomId) {
        console.warn('[Admin] selectRoom 被调用，但 roomId 为空');
        return;
    }
    window.selectedRoomId = roomId;
    roomClientPanelCollapsed = true;
    loadRooms(false);

    const panel = document.getElementById('room-details-panel');
    const content = document.getElementById('room-details-content');
    const actions = document.getElementById('room-details-actions');

    if (panel) {
        panel.classList.remove('translate-x-full');

        const room = (window.allRoomsCache || []).find(r => r.id === roomId);
        if (room) {
            const typeName = roomTypes.find(t => t.id === room.typeId)?.name || '未设置类型';
            const areaName = roomAreas.find(a => a.id === room.areaId)?.name || '未设置区域';
            const ip = room.roomIp || '未绑定';

            content.innerHTML = `
                <!-- Tab 切换按钮 -->
                <div class="flex border-b border-gray-700 bg-gray-800/50 sticky top-0 z-10 flex-shrink-0">
                    <button class="flex-1 py-3 text-sm font-medium text-white border-b-2 border-blue-500" 
                            id="tab-info" onclick="switchRoomTab('info')">
                        <i class="fas fa-info-circle mr-1"></i> 包厢详情
                    </button>
                    <button class="flex-1 py-3 text-sm font-medium text-gray-400 border-b-2 border-transparent hover:text-white" 
                            id="tab-control" onclick="switchRoomTab('control')">
                        <i class="fas fa-microchip mr-1"></i> 外设控制
                    </button>
                </div>

                <!-- Tab 内容：包厢详情 -->
                <div id="tab-content-info" class="p-4 flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div class="text-center mb-4 flex-shrink-0">
                        <div translate="no" class="text-xl leading-tight font-bold text-white mb-2 break-all" title="${escapeHtml(getRoomDisplayName(room))}">${escapeHtml(getRoomDisplayName(room))}</div>
                        <div class="badge ${room.status === 1 ? 'badge-online' : (room.status === 0 ? 'badge-idle' : 'badge-offline')} inline-block px-3 py-1 rounded text-sm mb-2">
                            ${room.status === 1 ? '使用中' : (room.status === 0 ? '空闲' : (room.status === 3 ? '测试' : '维修'))}
                        </div>
                    </div>
                    
                    <div class="flex-1 flex flex-col min-h-0 text-sm text-gray-300">
                        <div class="space-y-3 flex-shrink-0">
                            <div class="flex justify-between border-b border-gray-700 pb-1"><span>区域</span> <span translate="no" class="text-white">${areaName}</span></div>
                            <div class="flex justify-between border-b border-gray-700 pb-1"><span>类型</span> <span translate="no" class="text-white">${typeName}</span></div>
                            <div class="flex justify-between border-b border-gray-700 pb-1"><span>终端IP</span> <span class="font-mono text-green-400 select-all">${ip}</span></div>

                            <div class="mt-3 rounded-xl border border-gray-700/80 bg-gray-900/50 overflow-hidden">
                                <button type="button"
                                        onclick="toggleRoomClientPanel()"
                                        class="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-800/70 transition-colors">
                                    <span class="flex items-center gap-2 text-xs font-semibold text-gray-300 tracking-wide">
                                        <i class="fas fa-plug text-cyan-400"></i>
                                        连接客户端
                                        <span id="room-client-count-${roomId}" class="text-[10px] text-gray-500">加载中...</span>
                                    </span>
                                    <i id="room-client-toggle-icon" class="fas fa-chevron-right text-gray-500 text-xs transition-transform"></i>
                                </button>
                                <div id="room-client-panel-${roomId}" class="hidden border-t border-gray-700/70 px-3 py-2.5">
                                    <div id="room-client-list-${roomId}" class="space-y-2">
                                        <div class="text-xs text-gray-500 text-center py-2">加载中...</div>
                                    </div>
                                </div>
                            </div>
                            <div class="mt-4 pt-2">
                                <div class="text-xs text-gray-500 mb-1 flex items-center justify-between">
                                    <span>正在播放 (音量:${room.volume || 0})</span>
                                    <div class="flex items-center space-x-2">
                                        <button onclick="handleVolume('${room.id}', -5)" class="text-gray-400 hover:text-white px-1"><i class="fas fa-volume-down"></i></button>
                                        <button onclick="handleVolume('${room.id}', 5)" class="text-gray-400 hover:text-white px-1"><i class="fas fa-volume-up"></i></button>
                                    </div>
                                </div>
                                <div translate="${room.currentSongTitle ? 'no' : 'yes'}" id="room-current-song-${roomId}" class="text-emerald-400 font-bold text-lg truncate mb-3">${room.currentSongTitle || '无'}</div>
                                
                                <!-- 快捷控制按钮组 -->
                                <div class="grid grid-cols-2 gap-2 mb-4">
                                    <button onclick="handleSetMute('${roomId}', ${room.muteStatus === 1 ? 'false' : 'true'})" 
                                            class="flex items-center justify-center gap-2 py-2 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 transition">
                                        <i class="fas ${room.muteStatus === 1 ? 'fa-volume-mute text-red-400' : 'fa-volume-up text-blue-400'}"></i>
                                        <span class="text-xs min-w-[70px] text-center">${room.muteStatus === 1 ? '取消静音' : '静音'}</span>
                                    </button>
                                    <button onclick="handleSwitchTrack('${roomId}')" 
                                            class="flex items-center justify-center gap-2 py-2 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 transition">
                                        <i class="fas fa-sync-alt text-yellow-500"></i>
                                        <span class="text-xs">原伴唱切换</span>
                                    </button>
                                </div>

                                <div class="flex gap-1.5 mb-2">
                                    <button onclick="handlePlay('${roomId}')" class="flex-1 py-1.5 bg-green-900/40 hover:bg-green-800/60 text-green-400 border border-green-800/50 rounded flex flex-col items-center gap-1 transition">
                                        <i class="fas fa-play text-sm"></i><span class="text-[10px]">播放</span>
                                    </button>
                                    <button onclick="handlePause('${roomId}')" class="flex-1 py-1.5 bg-yellow-900/40 hover:bg-yellow-800/60 text-yellow-400 border border-yellow-800/50 rounded flex flex-col items-center gap-1 transition">
                                        <i class="fas fa-pause text-sm"></i><span class="text-[10px]">暂停</span>
                                    </button>
                                    <button onclick="handleReplay('${roomId}')" class="flex-1 py-1.5 bg-blue-900/40 hover:bg-blue-800/60 text-blue-400 border border-blue-800/50 rounded flex flex-col items-center gap-1 transition">
                                        <i class="fas fa-redo text-sm"></i><span class="text-[10px]">重唱</span>
                                    </button>
                                    <button onclick="handleSkip('${roomId}')" class="flex-1 py-1.5 bg-red-900/40 hover:bg-red-800/60 text-red-400 border border-red-800/50 rounded flex flex-col items-center gap-1 transition">
                                        <i class="fas fa-step-forward text-sm"></i><span class="text-[10px]">切歌</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- 已选歌曲队列：根据列表高度自适应显示数量 -->
                        <div class="mt-4 pt-3 border-t border-gray-700 flex-1 flex flex-col min-h-0">
                            <div class="flex items-center justify-between mb-2 flex-shrink-0">
                                <div class="text-xs font-semibold text-gray-400">已选歌曲</div>
                                <div id="queue-count-${roomId}" class="text-xs text-gray-500">加载中...</div>
                            </div>
                            <div id="room-queue-${roomId}" class="space-y-2 flex-1 min-h-0 overflow-y-auto">
                                <div class="text-xs text-gray-500 text-center py-4">加载中...</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tab 内容：外设控制 -->
                <div id="tab-content-control" class="space-y-4 hidden">
                    <!-- 空调控制 -->
                    <div class="bg-gray-900/40 p-3 rounded-lg border border-gray-700/50">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-xs font-semibold text-gray-400 flex items-center">
                                <i class="fas fa-snowflake mr-2 text-blue-400"></i> 空调控制
                            </span>
                            <div class="flex items-center space-x-2">
                                <button onclick="handleControlAc('${roomId}', true)" class="w-8 h-8 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600 hover:text-white transition flex items-center justify-center" title="开启">
                                    <i class="fas fa-power-off text-xs"></i>
                                </button>
                                <button onclick="handleControlAc('${roomId}', false)" class="w-8 h-8 rounded-full bg-gray-700/50 text-gray-400 border border-gray-600 hover:bg-red-600/80 hover:text-white transition flex items-center justify-center" title="关闭">
                                    <i class="fas fa-power-off text-xs"></i>
                                </button>
                            </div>
                        </div>
                        <div class="flex items-center space-x-2">
                            <select id="ac-temp-${roomId}" class="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none">
                                ${Array.from({ length: 15 }, (_, i) => 16 + i).map(t => `<option value="${t}" ${t === 24 ? 'selected' : ''}>${t}℃</option>`).join('')}
                            </select>
                            <button onclick="handleSetAcTemp('${roomId}')" class="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded text-[10px] font-bold">设定</button>
                        </div>
                    </div>

                    <!-- 灯光模式 -->
                    <div class="bg-gray-900/40 p-3 rounded-lg border border-gray-700/50">
                        <span class="text-xs font-semibold text-gray-400 flex items-center mb-2">
                            <i class="fas fa-lightbulb mr-2 text-yellow-400"></i> 灯光模式
                        </span>
                        <div class="grid grid-cols-3 gap-1.5">
                            <button onclick="handleControlLight('${roomId}', 'bright')" class="py-1 px-1 rounded bg-gray-700 text-[10px] text-gray-200 hover:bg-yellow-600 transition border border-gray-600">明亮</button>
                            <button onclick="handleControlLight('${roomId}', 'warm')" class="py-1 px-1 rounded bg-gray-700 text-[10px] text-gray-200 hover:bg-orange-600 transition border border-gray-600">温馨</button>
                            <button onclick="handleControlLight('${roomId}', 'dynamic')" class="py-1 px-1 rounded bg-gray-700 text-[10px] text-gray-200 hover:bg-purple-600 transition border border-gray-600">梦幻</button>
                            <button onclick="handleControlLight('${roomId}', 'standard')" class="py-1 px-1 rounded bg-gray-700 text-[10px] text-gray-200 hover:bg-blue-600 transition border border-gray-600">标准</button>
                            <button onclick="handleControlLight('${roomId}', 'romantic')" class="py-1 px-1 rounded bg-gray-700 text-[10px] text-gray-200 hover:bg-pink-600 transition border border-gray-600">浪漫</button>
                            <button onclick="handleControlLight('${roomId}', 'off')" class="py-1 px-1 rounded bg-gray-700 text-[10px] text-gray-200 hover:bg-red-900 transition border border-gray-600">全关</button>
                        </div>
                    </div>

                    <!-- 专业音效 -->
                    <div class="bg-gray-900/40 p-3 rounded-lg border border-gray-700/50">
                        <span class="text-xs font-semibold text-gray-400 flex items-center mb-2">
                            <i class="fas fa-sliders-h mr-2 text-green-400"></i> 专业音效
                        </span>
                        <div class="grid grid-cols-2 gap-2">
                            <button onclick="handleControlEffect('${roomId}', 'ktv')" class="py-1 px-2 rounded bg-gray-700 text-[10px] text-gray-200 hover:bg-green-600 transition border border-gray-600 flex items-center justify-center">
                                <i class="fas fa-microphone mr-1 opacity-70"></i> KTV模式
                            </button>
                            <button onclick="handleControlEffect('${roomId}', 'concert')" class="py-1 px-2 rounded bg-gray-700 text-[10px] text-gray-200 hover:bg-green-600 transition border border-gray-600 flex items-center justify-center">
                                <i class="fas fa-music mr-1 opacity-70"></i> 音乐会
                            </button>
                            <button onclick="handleControlEffect('${roomId}', 'pop')" class="py-1 px-2 rounded bg-gray-700 text-[10px] text-gray-200 hover:bg-green-600 transition border border-gray-600 flex items-center justify-center">
                                流行
                            </button>
                            <button onclick="handleControlEffect('${roomId}', 'rock')" class="py-1 px-2 rounded bg-gray-700 text-[10px] text-gray-200 hover:bg-green-600 transition border border-gray-600 flex items-center justify-center">
                                摇滚
                            </button>
                        </div>
                    </div>

                    <!-- 氛围特效 -->
                    <div class="flex gap-2">
                        <button onclick="handlePlayAmbiance('${roomId}', 'cheer')" class="flex-1 py-1.5 rounded bg-blue-900/30 text-blue-400 border border-blue-800 text-[10px] hover:bg-blue-800 hover:text-white transition">
                            <i class="fas fa-thumbs-up mr-1"></i> 喝彩
                        </button>
                        <button onclick="handlePlayAmbiance('${roomId}', 'laugh')" class="flex-1 py-1.5 rounded bg-blue-900/30 text-blue-400 border border-blue-800 text-[10px] hover:bg-blue-800 hover:text-white transition">
                            <i class="fas fa-laugh mr-1"></i> 哄笑
                        </button>
                    </div>
                </div>
            `;

            const btns = actions.getElementsByTagName('button');
            Array.from(btns).forEach(b => b.disabled = false);

            // 互斥显示开房/关房
            if (btns[0]) {
                // 如果是在使用中(1)，隐藏开房按钮
                btns[0].classList.toggle('hidden', room.status === 1);
                btns[0].onclick = () => updateRoomStatus(roomId, 1);
            }
            if (btns[1]) {
                // 如果不是在使用中(1)，隐藏关房按钮
                btns[1].classList.toggle('hidden', room.status !== 1);
                btns[1].onclick = () => updateRoomStatus(roomId, 0);
            }
            if (btns[2]) {
                // 如果是在维修中(2)，隐藏维修按钮
                btns[2].classList.toggle('hidden', room.status === 2);
                btns[2].onclick = () => updateRoomStatus(roomId, 2);
            }

            loadRoomClientConnections(room);
            if (btns[3]) {
                // 如果不是在维修中(2)，隐藏取消维修按钮
                btns[3].classList.toggle('hidden', room.status !== 2);
                btns[3].onclick = () => updateRoomStatus(roomId, 0, '取消维修'); // 恢复为空闲
            }
            if (btns[4]) btns[4].onclick = () => openEditRoomModal(roomId);
            if (btns[5]) btns[5].onclick = () => deleteRoom(roomId);

            // 更新底部外设状态栏
            if (typeof peripheralStatusBar !== 'undefined') {
                peripheralStatusBar.updateStatus(room);
            }

            // 加载房间队列
            loadRoomQueue(roomId);
        }
    }
}

// 加载房间队列
async function loadRoomQueue(roomId) {
    const queueContainer = document.getElementById(`room-queue-${roomId}`);
    const queueCount = document.getElementById(`queue-count-${roomId}`);

    if (!queueContainer) {
        return;
    }

    try {
        const data = await apiService.getRoomQueue(roomId);
        const queue = data.data || [];
        // 更新计数
        if (queueCount) {
            queueCount.textContent = `共 ${queue.length} 首`;
        }

        // 渲染队列
        if (queue.length === 0) {
            queueContainer.innerHTML = '<div class="text-xs text-gray-500 text-center py-4">暂无歌曲</div>';
            return;
        }

        // 若「当前歌曲」仍为无且队列有歌，用第一首标题更新显示（与后端补全逻辑一致）
        const currentSongEl = document.getElementById(`room-current-song-${roomId}`);
        if (currentSongEl && queue.length > 0) {
            const currentText = (window.AdminI18n?.sourceText(currentSongEl) ?? currentSongEl.textContent ?? '').trim();
            if (currentText === '无' || !currentText) {
                currentSongEl.translate = !queue[0].songName;
                currentSongEl.textContent = queue[0].songName || '未知';
            }
        }

        const hasPlaying = queue.some((item, i) => item.status === 1);
        queueContainer.innerHTML = queue.map((item, index) => {
            const songName = item.songName || '未知歌曲';
            const singerNames = item.singerNames || '未知歌手';

            // 状态显示逻辑：
            // 1. 第一首且(status=1 或 队列中无人被标为播放中) 显示「播放中」
            // 2. 第二首且status=0 显示「下一曲」
            // 3. 其他歌曲不显示标签
            let statusBadge = '';
            if (index === 0 && (item.status === 1 || !hasPlaying)) {
                statusBadge = '<span class="text-xs text-green-400">播放中</span>';
            } else if (index === 1 && item.status === 0) {
                statusBadge = '<span class="text-xs text-blue-400">下一曲</span>';
            }

            return `
                <div class="flex items-center gap-2 p-2 bg-gray-800/50 rounded text-xs">
                    <div class="text-gray-500 w-6">${index + 1}</div>
                    <div class="flex-1 min-w-0">
                        <div translate="no" class="text-white truncate">${escapeHtml(songName)}</div>
                        <div translate="no" class="text-gray-400 truncate">${escapeHtml(singerNames)}</div>
                    </div>
                    <div class="text-right">
                        ${statusBadge}
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('[loadRoomQueue] 加载房间队列失败:', error);
        queueContainer.innerHTML = '<div class="text-xs text-red-400 text-center py-4">加载失败: ' + error.message + '</div>';
        if (queueCount) {
            queueCount.textContent = '';
        }
    }
}

// ==================== 外设控制处理函数 ====================

async function handleControlAc(roomId, power) {
    try {
        const temp = parseInt(document.getElementById(`ac-temp-${roomId}`)?.value || '24');
        const res = await apiService.controlAc(roomId, { power, temp });
        showToast(`空调已${power ? '开启' : '关闭'}`, 'success');

        if (res && res.data) {
            updateSingleRoomCacheAndUI(res.data);
        } else {
            await refreshRoomStatus(roomId);
        }
    } catch (e) {
        showToast('空调控制失败: ' + e.message, 'error');
    }
}

async function handleSetAcTemp(roomId) {
    try {
        const temp = parseInt(document.getElementById(`ac-temp-${roomId}`)?.value || '24');
        const res = await apiService.controlAc(roomId, { power: true, temp });
        showToast(`空调温度已设定为 ${temp}℃`, 'success');

        if (res && res.data) {
            updateSingleRoomCacheAndUI(res.data);
        } else {
            await refreshRoomStatus(roomId);
        }
    } catch (e) {
        showToast('温度设定失败', 'error');
    }
}

async function handleControlLight(roomId, scene) {
    try {
        const res = await apiService.controlLight(roomId, { scene });
        const sceneMap = { bright: '明亮', warm: '温馨', dynamic: '梦幻', romantic: '浪漫', standard: '标准', off: '全关' };
        showToast(`灯光已切换至 ${sceneMap[scene] || scene}`, 'success');

        if (res && res.data) {
            updateSingleRoomCacheAndUI(res.data);
        } else {
            await refreshRoomStatus(roomId);
        }
    } catch (e) {
        showToast('灯光切换失败', 'error');
    }
}

async function handleControlEffect(roomId, mode) {
    try {
        const res = await apiService.controlEffect(roomId, { mode });
        const modeMap = { ktv: 'KTV', concert: '音乐会', pop: '流行', rock: '摇滚' };
        showToast(`已切换至 ${modeMap[mode] || mode} 音效`, 'success');

        if (res && res.data) {
            updateSingleRoomCacheAndUI(res.data);
        } else {
            await refreshRoomStatus(roomId);
        }
    } catch (e) {
        showToast('音效切换失败', 'error');
    }
}

async function handlePlayAmbiance(roomId, effect) {
    try {
        const res = await apiService.playAmbiance(roomId, { effect });
        const effectMap = { cheer: '喝彩', laugh: '哄笑' };
        showToast(`已播放 ${effectMap[effect] || effect} 特效`, 'success');

        if (res && res.data) {
            updateSingleRoomCacheAndUI(res.data);
        }
    } catch (e) {
        showToast('特效播放失败', 'error');
    }
}

// ==================== 播放控制快捷函数 ====================

async function handleSetMute(roomId, mute) {
    try {
        const res = await apiService.setMute(roomId, mute);
        if (res.code === 0) {
            showToast(mute ? '已静音' : '已取消静音', 'success');
            // 更新缓存
            if (window.allRoomsCache) {
                const room = window.allRoomsCache.find(r => r.id === roomId);
                if (room) room.muteStatus = mute ? 1 : 0;
            }
            refreshRoomStatus(roomId);
        }
    } catch (e) {
        showToast('设置静音失败', 'error');
    }
}

async function handleSwitchTrack(roomId) {
    try {
        // 先获取当前房间状态以确定当前音轨
        const room = (window.allRoomsCache || []).find(r => r.id === roomId);
        const currentMic = room ? (room.micStatus || 0) : 0;
        const nextMic = currentMic === 1 ? 0 : 1; // 切换原伴唱 (1=原唱, 0=伴唱)

        const res = await apiService.switchTrack(roomId, nextMic);
        if (res.code === 0) {
            showToast(`已切换为${nextMic === 1 ? '原唱' : '伴唱'}`, 'success');
            if (room) room.micStatus = nextMic;
            refreshRoomStatus(roomId);
        }
    } catch (e) {
        showToast('切换音轨失败', 'error');
    }
}

async function handlePlay(roomId) {
    try {
        const res = await apiService.play(roomId);
        if (res.code === 0) {
            showToast('已开始播放', 'success');
            refreshRoomStatus(roomId);
        }
    } catch (e) {
        showToast('播放操作失败', 'error');
    }
}

async function handlePause(roomId) {
    try {
        const res = await apiService.pause(roomId);
        if (res.code === 0) {
            showToast('已暂停', 'info');
            refreshRoomStatus(roomId);
        }
    } catch (e) {
        showToast('暂停操作失败', 'error');
    }
}

async function handleReplay(roomId) {
    try {
        const res = await apiService.replay(roomId);
        if (res.code === 0) {
            showToast('已重新开始播放', 'success');
            refreshRoomStatus(roomId);
        }
    } catch (e) {
        showToast('重唱失败', 'error');
    }
}

async function handleSkip(roomId) {
    if (!(await showConfirm('确定要切到下一首吗？'))) return;
    try {
        const res = await apiService.skip(roomId);
        if (res.code === 0) {
            showToast('已切歌', 'success');
            refreshRoomStatus(roomId);
        }
    } catch (e) {
        showToast('切歌失败', 'error');
    }
}

async function handleVolume(roomId, delta) {
    try {
        const room = (window.allRoomsCache || []).find(r => r.id === roomId);
        let currentVol = room ? (room.volume || 0) : 50;
        let newVol = Math.max(0, Math.min(100, currentVol + delta));

        const res = await apiService.setVolume(roomId, newVol);
        if (res.code === 0) {
            showToast(`音量已调整至 ${newVol}`, 'info');
            if (room) room.volume = newVol;
            // 直接更新 UI 上的文本
            const infoTab = document.getElementById('tab-content-info');
            if (infoTab) {
                const volTextElems = Array.from(infoTab.querySelectorAll('span, div')).filter(el => (window.AdminI18n?.sourceText(el) ?? el.textContent).includes('音量:'));
                volTextElems.forEach(el => {
                    if (el.children.length === 0) el.textContent = (window.AdminI18n?.sourceText(el) ?? el.textContent).replace(/音量:\d+/, `音量:${newVol}`);
                });
            }
        }
    } catch (e) {
        showToast('音量控制失败', 'error');
    }
}

// 暴露所有控制函数到全局
window.handleControlAc = handleControlAc;
window.handleSetAcTemp = handleSetAcTemp;
window.handleControlLight = handleControlLight;
window.handleControlEffect = handleControlEffect;
window.handlePlayAmbiance = handlePlayAmbiance;
window.handleSetMute = handleSetMute;
window.handleSwitchTrack = handleSwitchTrack;
window.handlePlay = handlePlay;
window.handlePause = handlePause;
window.handleReplay = handleReplay;
window.handleSkip = handleSkip;
window.handleVolume = handleVolume;
// Tab 切换函数
function switchRoomTab(tabName) {
    // 更新 Tab 按钮样式
    const tabInfo = document.getElementById('tab-info');
    const tabControl = document.getElementById('tab-control');
    const contentInfo = document.getElementById('tab-content-info');
    const contentControl = document.getElementById('tab-content-control');

    if (tabName === 'info') {
        tabInfo.classList.add('text-white', 'border-blue-500');
        tabInfo.classList.remove('text-gray-400', 'border-transparent');
        tabControl.classList.add('text-gray-400', 'border-transparent');
        tabControl.classList.remove('text-white', 'border-blue-500');
        contentInfo.classList.remove('hidden');
        contentControl.classList.add('hidden');
    } else {
        tabControl.classList.add('text-white', 'border-blue-500');
        tabControl.classList.remove('text-gray-400', 'border-transparent');
        tabInfo.classList.add('text-gray-400', 'border-transparent');
        tabInfo.classList.remove('text-white', 'border-blue-500');
        contentControl.classList.remove('hidden');
        contentInfo.classList.add('hidden');
    }
}

// 暴露 Tab 切换函数到全局
window.switchRoomTab = switchRoomTab;

/**
 * 更新缓存中单个房间的数据，并局部触发 UI 更新
 * 用于 API 返回完整房间状态时，避免全量重新加载 loadRooms
 */
async function updateSingleRoomCacheAndUI(roomData) {
    if (!roomData || !roomData.id) {
        console.warn('[updateSingleRoomCacheAndUI] roomData 无效');
        return;
    }
    // 更新全局缓存
    if (window.allRoomsCache) {
        const idx = window.allRoomsCache.findIndex(r => r.id === roomData.id);
        if (idx !== -1) {
            // 保留原有的一些前端扩展字段（如果有）
            const existingRoom = window.allRoomsCache[idx];

            // 合并更新，确保外设状态正确同步
            window.allRoomsCache[idx] = {
                ...existingRoom,
                ...roomData,
                // 确保外设状态字段正确映射
                acState: roomData.ac ? JSON.stringify(roomData.ac) : existingRoom.acState,
                lightState: roomData.light ? JSON.stringify(roomData.light) : existingRoom.lightState,
                effectState: roomData.effect ? JSON.stringify(roomData.effect) : existingRoom.effectState,
                playState: roomData.playState !== undefined ? roomData.playState : existingRoom.playState,
                volume: roomData.volume !== undefined ? roomData.volume : existingRoom.volume,
                muteStatus: roomData.mute !== undefined ? (roomData.mute ? 1 : 0) : existingRoom.muteStatus,
                micStatus: roomData.micStatus !== undefined ? roomData.micStatus : existingRoom.micStatus
            };
        } else {
            // 新房间，需要转换外设状态格式
            const newRoom = {
                ...roomData,
                acState: roomData.ac ? JSON.stringify(roomData.ac) : '{"power":false,"temp":26,"mode":"auto"}',
                lightState: roomData.light ? JSON.stringify(roomData.light) : '{"scene":null,"auto":false}',
                effectState: roomData.effect ? JSON.stringify(roomData.effect) : '{"mode":"standard"}',
                muteStatus: roomData.mute ? 1 : 0
            };
            window.allRoomsCache.push(newRoom);
        }
    }

    // 局部更新房间卡片状态（仅更新状态点和外设详情，不触发全量 loadRooms 以免重绘整个 grid 导致闪烁）
    const roomCard = document.getElementById(`room-card-${roomData.id}`);
    if (roomCard) {
        // 更新在线状态点
        const onlineDot = roomCard.querySelector('.rounded-full[title]');
        if (onlineDot) {
            const online = roomData.terminalOnline === 1;
            onlineDot.className = `w-2 h-2 rounded-full flex-shrink-0 ${online ? 'bg-emerald-400' : 'bg-gray-600'}`;
            onlineDot.title = online ? '在线' : '离线';
        }

        // 更新正在播放信息
        const playingInfo = roomCard.querySelector('.text-xs.truncate.text-emerald-400');
        if (playingInfo) {
            playingInfo.translate = !roomData.currentSongTitle;
            playingInfo.textContent = roomData.currentSongTitle || (roomData.playState === 1 ? '正在播放' : '暂停中');
        }
    }

    // 如果当前选中的是这个房间，更新底部状态栏
    // 如果当前选中的是这个房间，强制重绘右侧详情面板，确保「音量、状态按钮、灯光模式」实时刷新
    if (window.selectedRoomId === roomData.id) {
        if (typeof selectRoom === 'function') {
            // 调用重绘详情逻辑 (注意：selectRoom 内部会调 loadRooms(false) 重刷网格但不重拿数据)
            selectRoom(roomData.id);
        }

        if (typeof peripheralStatusBar !== 'undefined') {
            // 获取更新后的房间数据（包含转换后的外设状态）
            const updatedRoom = window.allRoomsCache ? window.allRoomsCache.find(r => r.id === roomData.id) : null;
            if (updatedRoom) {
                peripheralStatusBar.updateStatus(updatedRoom);
            }
        }
    }
}

// 刷新单个房间状态（用于外设控制后更新）
async function refreshRoomStatus(roomId) {
    try {
        const res = await apiService.getRoom(roomId);
        if (res.code === 0 && res.data) {
            updateSingleRoomCacheAndUI(res.data);

            // 如果该房间正在被详情页查看，强制刷新右侧详情内容
            if (window.selectedRoomId === roomId) {
                selectRoom(roomId);
            }
        }
    } catch (e) {
        console.error('刷新房间状态失败:', e);
    }
}

function deselectRoom(e) {
    if (e.target.id === 'rooms-container' || e.target.id === 'rooms-grid') {
        window.selectedRoomId = null;
        loadRooms(false);
        const panel = document.getElementById('room-details-panel');
        if (panel) panel.classList.add('translate-x-full');

        // 清空外设状态栏
        if (typeof peripheralStatusBar !== 'undefined') {
            peripheralStatusBar.clear();
        }
    }
}

function showRoomContextMenu(e, roomId) {
    window.contextMenuTargetId = roomId;
    const menu = document.getElementById('room-context-menu');
    if (menu) {
        const room = (window.allRoomsCache || []).find(r => r.id === roomId);
        const status = Number(room?.status ?? 0);
        if (status === 2) {
            menu.innerHTML = `
                <a href="#" class="block px-4 py-2 text-gray-200 hover:bg-blue-600 hover:text-white"
                    onclick="handleContextAction('restore')"><i class="fas fa-undo mr-2 w-4"></i> 取消维修</a>
            `;
        } else if (status === 3) {
            menu.innerHTML = `
                <a href="#" class="block px-4 py-2 text-gray-200 hover:bg-blue-600 hover:text-white"
                    onclick="handleContextAction('restore')"><i class="fas fa-undo mr-2 w-4"></i> 取消测试</a>
            `;
        } else {
            menu.innerHTML = `
                <a href="#" class="block px-4 py-2 text-gray-200 hover:bg-blue-600 hover:text-white"
                    onclick="handleContextAction('maintain')"><i class="fas fa-tools mr-2 w-4"></i> 维修</a>
                <a href="#" class="block px-4 py-2 text-gray-200 hover:bg-blue-600 hover:text-white"
                    onclick="handleContextAction('test')"><i class="fas fa-vial mr-2 w-4"></i> 测试</a>
            `;
        }
        menu.classList.remove('hidden');

        let x = e.clientX;
        let y = e.clientY;
        if (x + 160 > window.innerWidth) x -= 160;
        if (y + 150 > window.innerHeight) y -= 150;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
    }
    const closeMenu = () => {
        if (menu) menu.classList.add('hidden');
        document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// 快速更新房间状态
async function updateRoomStatus(roomId, status, actionLabel = null) {
    if (!roomId) {
        console.error('[Admin] updateRoomStatus 失败: roomId 为空');
        showToast('操作失败: 房间标识丢失', 'error');
        return;
    }
    try {
        const actionMap = { 0: '关房', 1: '开房', 2: '设为维修', 3: '设为测试' };

        showLoading();
        // 直接增量更新状态，UpdateRoomRequest 支持可选字段
        await apiService.updateRoom(roomId, { status: status });

        showToast(`${actionLabel || actionMap[status]}成功`, 'success');

        // 重新加载房间列表以便看到状态变化
        await loadRooms(true);

        // 【关键修复】：如果该房间正在被查看，强制刷新右侧详情页的所有显示
        if (window.selectedRoomId === roomId) {
            selectRoom(roomId);
        }
    } catch (error) {
        console.error('更新房间状态失败:', error);
        showToast('操作失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function handleContextAction(action) {
    const id = window.contextMenuTargetId;
    if (!id) return;
    if (action === 'open') updateRoomStatus(id, 1);
    if (action === 'close') updateRoomStatus(id, 0);
    if (action === 'maintain') updateRoomStatus(id, 2);
    if (action === 'test') updateRoomStatus(id, 3);
    if (action === 'restore') updateRoomStatus(id, 0, '取消维修');
    if (action === 'edit') window.openEditRoomModal(id);
    if (action === 'delete') window.deleteRoom(id);
    if (action === 'bind') window.openEditRoomModal(id);
}

// 暴露 context action 给 HTML onclick
window.handleContextAction = handleContextAction;
window.deselectRoom = deselectRoom;
window.updateRoomStatus = updateRoomStatus;

// ==================== 新增房间功能 ====================

const addRoomModal = document.getElementById('add-room-modal');
const addRoomForm = document.getElementById('add-room-form');
const cancelAddRoomBtn = document.getElementById('cancel-add-room');

function openAddRoomModal() {
    const form = document.getElementById('add-room-form');
    const modal = document.getElementById('add-room-modal');
    if (form) form.reset();
    if (typeof updateRoomModalOptions === 'function') updateRoomModalOptions();
    if (modal) modal.classList.remove('hidden');
}

if (cancelAddRoomBtn) {
    cancelAddRoomBtn.addEventListener('click', () => {
        if (addRoomModal) {
            addRoomModal.classList.add('hidden');
        }
    });
}

if (addRoomForm) {
    addRoomForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('add-room-name').value;
        const typeId = document.getElementById('add-room-type').value;
        const areaId = document.getElementById('add-room-area').value;
        const terminalId = document.getElementById('add-room-terminal').value;

        try {
            showLoading();
            await apiService.createRoom({
                name: name.trim(),
                terminalId,
                typeId: typeId ? parseInt(typeId, 10) : null,
                areaId: areaId ? parseInt(areaId, 10) : null
            });

            if (addRoomModal) {
                addRoomModal.classList.add('hidden');
            }

            // 重新加载房间列表
            await loadRooms();
            showToast('房间创建成功', 'success');
        } catch (e) {
            console.error('创建房间失败:', e);
            showToast('创建房间失败: ' + (e.message || '未知错误'), 'error');
        } finally {
            hideLoading();
        }
    });
}

// ==================== 开房/关房功能 ====================



// ==================== 更新终端选择下拉框 ====================

function updateTerminalSelects() {
    const terminals = window.allTerminalsCache || [];
    const assignedTerminalIds = new Set((window.allRoomsCache || []).map(room => room.terminalId));

    const editTerminalSelect = document.getElementById('edit-room-terminal');
    if (editTerminalSelect) {
        const currentValue = editTerminalSelect.value;
        editTerminalSelect.innerHTML = '<option value="">请选择终端</option>' +
            terminals.map(terminal => `<option value="${escapeHtml(terminal.id)}">${escapeHtml(terminal.name || terminal.terminalIp)} (${escapeHtml(terminal.terminalIp)})</option>`).join('');
        editTerminalSelect.value = currentValue;
    }

    const addTerminalSelect = document.getElementById('add-room-terminal');
    if (addTerminalSelect) {
        const availableTerminals = terminals.filter(terminal => !assignedTerminalIds.has(terminal.id));
        const placeholder = availableTerminals.length ? '请选择终端' : '暂无可用终端';
        addTerminalSelect.innerHTML = `<option value="" disabled selected>${placeholder}</option>` +
            availableTerminals.map(terminal => `<option value="${escapeHtml(terminal.id)}">${escapeHtml(terminal.name || terminal.terminalIp)} (${escapeHtml(terminal.terminalIp)})</option>`).join('');
    }
}

// 更新 updateRoomModalOptions 函数以包含终端列表
const originalUpdateRoomModalOptions = updateRoomModalOptions;
function updateRoomModalOptions() {
    // 调用原有的类型和区域更新
    const typeSelect = document.getElementById('edit-room-type');
    const areaSelect = document.getElementById('edit-room-area');
    const addTypeSelect = document.getElementById('add-room-type');
    const addAreaSelect = document.getElementById('add-room-area');

    if (typeSelect) {
        typeSelect.innerHTML = '<option value="">未设置</option>' +
            roomTypes.map(t => `<option translate="no" value="${t.id}">${t.name}</option>`).join('');
    }
    if (areaSelect) {
        areaSelect.innerHTML = '<option value="">未设置</option>' +
            roomAreas.map(a => `<option translate="no" value="${a.id}">${a.name}</option>`).join('');
    }
    if (addTypeSelect) {
        addTypeSelect.innerHTML = '<option value="">未设置</option>' +
            roomTypes.map(t => `<option translate="no" value="${t.id}">${t.name}</option>`).join('');
    }
    if (addAreaSelect) {
        addAreaSelect.innerHTML = '<option value="">未设置</option>' +
            roomAreas.map(a => `<option translate="no" value="${a.id}">${a.name}</option>`).join('');
    }

    // 更新终端列表
    updateTerminalSelects();
}

// 导出到全局
// ==================== 歌曲管理 (CRUD) ====================

const songModal = document.getElementById('song-modal');
const songForm = document.getElementById('song-form');
const cancelSongBtn = document.getElementById('cancel-song-modal');

function setSongVideoFileType(value, path = '') {
    const select = document.getElementById('song-video-file-type');
    select.querySelectorAll('option[data-existing]').forEach(option => option.remove());
    const raw = String(value || '').trim();
    const extension = String(path).split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
    const normalized = raw && raw !== '0' ? formatVideoFileType(raw).toLowerCase() : '';
    const selected = normalized || (['hvideo', 'mp4', 'mkv', 'mpg'].includes(extension) ? extension : '');
    if (selected && !Array.from(select.options).some(option => option.value === selected)) {
        // Preserve existing formats outside the three common editing choices.
        const option = new Option(formatVideoFileType(raw), selected);
        option.dataset.existing = 'true';
        select.add(option);
    }
    select.value = selected;
}

document.getElementById('song-path')?.addEventListener('change', event => {
    const extension = event.target.value.trim().split(/[?#]/)[0].match(/\.(hvideo|mp4|mkv|mpg)$/i)?.[1];
    if (extension) setSongVideoFileType(extension);
});

async function openAddSongModal() {
    if (songForm) songForm.reset();
    setSongVideoFileType('');
    document.getElementById('edit-song-id').value = '';
    const songNoInput = document.getElementById('song-no');
    songNoInput.value = '';
    songNoInput.disabled = false;
    document.getElementById('song-track').value = '3';
    document.getElementById('song-initial').value = '';
    document.getElementById('song-artist-search').value = '';
    document.getElementById('song-artist-search').dataset.selectedName = '';
    document.getElementById('song-score-enabled').value = '0';
    document.getElementById('song-modal-title').textContent = '添加歌曲';

    // 加载选项
    await Promise.all([loadArtists(), initFilters()]);

    if (songModal) songModal.classList.remove('hidden');
}

async function openEditSongModal(id) {
    try {
        showLoading();
        const resp = await apiService.getSongDbSong(id, {
            availableOnly: currentSongDataSource === 'available'
        });
        const song = resp.data;

        if (!song) throw new Error('歌曲不存在');

        document.getElementById('edit-song-id').value = song.songId;
        const songNoInput = document.getElementById('song-no');
        songNoInput.value = song.songNo;
        songNoInput.disabled = true;
        document.getElementById('song-name').value = song.songName || '';
        document.getElementById('song-path').value = formatSongRelativePath(song);
        setSongVideoFileType(song.videoFileType, song.absolutePath || formatSongRelativePath(song));
        document.getElementById('song-initial').value = song.initialKey || '';

        // 加载选项并设置选中项
        const artistSearch = document.getElementById('song-artist-search');
        artistSearch.value = song.primarySingerName || song.primarySingerNo || '';
        artistSearch.dataset.selectedName = song.primarySingerName || '';
        await Promise.all([loadArtists(artistSearch.value, song.primarySingerNo || ''), initFilters()]);

        document.getElementById('song-artist').value = song.primarySingerNo || '';
        document.getElementById('song-language').value = song.languageCode || '';
        document.getElementById('song-classify').value = song.categoryCode || '';
        document.getElementById('song-track').value = (song.track !== undefined && song.track !== null) ? song.track : '3';
        document.getElementById('song-score-enabled').value = song.scoreEnabled ? '1' : '0';

        document.getElementById('song-modal-title').textContent = '编辑歌曲';
        if (songModal) songModal.classList.remove('hidden');
    } catch (e) {
        console.error('获取歌曲详情失败:', e);
        showToast('获取歌曲详情失败', 'error');
    } finally {
        hideLoading();
    }
}

async function deleteSong(id) {
    if (!(await showConfirm('确定要删除这首歌曲吗？'))) return;
    try {
        showLoading();
        await apiService.deleteSongDbSong(id);
        await loadSongs();
        showToast('删除成功', 'success');
        updateStatistics();
    } catch (e) {
        showToast('删除失败', 'error');
    } finally {
        hideLoading();
    }
}

if (cancelSongBtn) {
    cancelSongBtn.onclick = () => songModal.classList.add('hidden');
}

if (songForm) {
    songForm.onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-song-id').value;
        const selectedSingerName = document.getElementById('song-artist').selectedOptions[0]?.textContent || '';
        const data = {
            songName: document.getElementById('song-name').value.trim(),
            primarySingerNo: document.getElementById('song-artist').value,
            primarySingerName: selectedSingerName,
            singerNames: selectedSingerName,
            languageCode: document.getElementById('song-language').value,
            categoryCode: document.getElementById('song-classify').value,
            videoFileType: document.getElementById('song-video-file-type').value,
            ...splitSongPathInput(document.getElementById('song-path').value),
            track: parseInt(document.getElementById('song-track').value || '1'),
            initialKey: document.getElementById('song-initial').value,
            scoreEnabled: Number(document.getElementById('song-score-enabled').value)
        };

        try {
            showLoading();
            if (id) {
                await apiService.updateSongDbSong(id, data);
                showToast('更新歌曲成功', 'success');
            } else {
                data.songNo = document.getElementById('song-no').value.trim();
                await apiService.createSongDbSong(data);
                showToast('创建歌曲成功', 'success');
            }
            songModal.classList.add('hidden');
            loadSongs();
            updateStatistics();
        } catch (e) {
            showToast('保存失败: ' + (e.message || '未知错误'), 'error');
        } finally {
            hideLoading();
        }
    };
}

// ==================== 歌手管理 (CRUD) ====================

const singerModal = document.getElementById('singer-modal');
const singerForm = document.getElementById('singer-form');
const cancelSingerBtn = document.getElementById('cancel-singer-modal');

function openAddSingerModal() {
    if (singerForm) singerForm.reset();
    document.getElementById('edit-singer-id').value = '';
    const singerNoInput = document.getElementById('singer-no');
    singerNoInput.value = '';
    singerNoInput.disabled = false;
    document.getElementById('singer-modal-title').textContent = '添加歌手';
    document.getElementById('singer-image-preview').src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9Ii00IC00IDMyIDMyIiBmaWxsPSJub25lIiBzdHJva2U9IiM5Y2EzYWYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjAgMjF2LTJhNCA0IDAgMCAwLTQtNEg4YTQgNCAwIDAgMC00IDR2MiI+PC9wYXRoPjxjaXJjbGUgY3g9IjEyIiBjeT0iNyIgcj0iNCI+PC9jaXJjbGU+PC9zdmc+';

    // 初始化过滤器以获取地区选项
    initFilters();

    if (singerModal) singerModal.classList.remove('hidden');
}

async function openEditSingerModal(id) {
    try {
        showLoading();
        const resp = await apiService.getSingerDbSinger(id);
        const singer = resp.data;

        if (!singer) throw new Error('歌手不存在');

        document.getElementById('edit-singer-id').value = singer.singerId;
        const singerNoInput = document.getElementById('singer-no');
        singerNoInput.value = singer.singerNo;
        singerNoInput.disabled = true;
        document.getElementById('singer-name').value = singer.singerName || '';

        await initFilters();

        document.getElementById('singer-region').value = singer.regionCode || '';
        document.getElementById('singer-sex').value = singer.sexCode || '0';

        const identifier = singer.singerNo || singer.singerId;
        const avatarUrl = `/api/v1/artists/${identifier}/image?t=${new Date().getTime()}`;
        document.getElementById('singer-image-preview').src = avatarUrl;
        document.getElementById('singer-image').value = ''; // 清空选择的文件


        document.getElementById('singer-modal-title').textContent = '编辑歌手';
        if (singerModal) singerModal.classList.remove('hidden');
    } catch (e) {
        showToast('获取歌手详情失败', 'error');
    } finally {
        hideLoading();
    }
}

async function deleteSinger(id) {
    if (!(await showConfirm('确定要删除这位歌手吗？'))) return;
    try {
        showLoading();
        await apiService.deleteSingerDbSinger(id);
        await loadSingers();
        showToast('删除成功', 'success');
        updateStatistics();
    } catch (e) {
        showToast('删除失败', 'error');
    } finally {
        hideLoading();
    }
}

if (cancelSingerBtn) {
    cancelSingerBtn.onclick = () => singerModal.classList.add('hidden');
}

if (singerForm) {
    // 绑定图片选择预览
    const imageInput = document.getElementById('singer-image');
    if (imageInput) {
        imageInput.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (file) {
                const url = URL.createObjectURL(file);
                document.getElementById('singer-image-preview').src = url;
            }
        });
    }

    singerForm.onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-singer-id').value;
        const data = {
            singerName: document.getElementById('singer-name').value.trim(),
            regionCode: document.getElementById('singer-region').value,
            sexCode: document.getElementById('singer-sex').value
        };

        const imageInput = document.getElementById('singer-image');
        const file = imageInput?.files[0];

        try {
            showLoading();
            let singerId = id;
            if (id) {
                await apiService.updateSingerDbSinger(id, data);
                showToast('更新歌手成功', 'success');
            } else {
                data.singerNo = document.getElementById('singer-no').value.trim();
                const resp = await apiService.createSingerDbSinger(data);
                singerId = resp.data.singerId;
                showToast('创建歌手成功', 'success');
            }

            // 如果选择了图片，则上传
            if (file && singerId) {
                try {
                    await apiService.uploadSingerImage(singerId, file);
                    showToast('图片上传成功', 'success');
                } catch (imgError) {
                    console.error('图片上传失败:', imgError);
                    showToast('图片上传失败', 'error');
                }
            }

            singerModal.classList.add('hidden');
            loadSingers();
            updateStatistics();
        } catch (e) {
            showToast('保存失败: ' + (e.message || '未知错误'), 'error');
        } finally {
            hideLoading();
        }
    };
}

// 导出到全局
window.openAddSongModal = openAddSongModal;
window.openEditSongModal = openEditSongModal;
window.deleteSong = deleteSong;
window.openAddSingerModal = openAddSingerModal;
window.openEditSingerModal = openEditSingerModal;
window.deleteSinger = deleteSinger;
window.updateTerminalSelects = updateTerminalSelects;
window.loadSingers = loadSingers;
window.searchSingers = function () {
    loadSingers(1);
};

// ==================== 搜索功能修复 ====================
(function () {
    const songSearchBtn = document.getElementById('song-search-btn');
    const songSearchInput = document.getElementById('song-search');
    const singerSearchInput = document.getElementById('singer-search');
    const singerSearchBtn = document.getElementById('singer-search-btn');

    // 绑定歌曲搜索回车事件
    if (songSearchInput) {
        songSearchInput.onkeypress = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (typeof window.searchSongs === 'function') {
                    window.searchSongs();
                }
            }
        };
    }

    // 绑定歌手搜索回车事件
    if (singerSearchInput) {
        singerSearchInput.onkeypress = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (typeof window.searchSingers === 'function') {
                    window.searchSingers();
                } else {
                    loadSingers(1);
                }
            }
        };
    }

    // 显式绑定歌手搜索按钮点击事件
    if (singerSearchBtn) {
        singerSearchBtn.addEventListener('click', function (e) {
            e.preventDefault();
            if (typeof window.searchSingers === 'function') {
                window.searchSingers();
            } else {
                loadSingers(1);
            }
        });
    }
})();

// 完全重写搜索函数并暴露给全局
window.searchSongs = function () {
    const searchInput = document.getElementById('song-search');
    const langSelect = document.getElementById('song-language-filter');

    // 更新全局 currentFilters
    if (typeof currentFilters !== 'undefined') {
        currentFilters.keyword = searchInput ? searchInput.value : '';
        currentFilters.language = langSelect ? langSelect.value : '';
    } else {
        console.warn('currentFilters 未定义，尝试直接调用 loadSongs');
    }

    // 调用加载函数
    if (typeof loadSongs === 'function') {
        loadSongs(1);
    } else {
        console.error('loadSongs 函数未定义！');
    }
};

/**
/**
 * 使用共享的 WebSocketClient 初始化后台实时同步
 */
let adminWebSocketInitialized = false; // 防止重复初始化

function initAdminWebSocket() {
    const ws = window.WebSocketClient;
    if (!ws) {
        // console.warn('[AdminWS] 共享 WebSocketClient 未就绪，500ms 后重试...');
        setTimeout(initAdminWebSocket, 500);
        return;
    }

    // 防止重复初始化
    if (adminWebSocketInitialized) {
        return;
    }
    adminWebSocketInitialized = true;

    // 更新 UI 状态
    const updateWsStatus = (isConnected) => {
        const wsStatus = document.getElementById('ws-status');
        if (wsStatus) {
            wsStatus.textContent = isConnected ? '已连接' : '未连接';
            wsStatus.className = isConnected
                ? 'badge badge-online px-2 py-0.5 rounded-full text-[10px]'
                : 'badge badge-offline px-2 py-0.5 rounded-full text-[10px]';
        }
    };

    // 向服务器发送 join_room，使后台能收到指定房间的定向推送（roomStateChanged / command）
    const joinAdminRoom = (roomId) => {
        if (!roomId) return;
        ws.send({ type: 'join_room', roomId: roomId });
        console.log('[AdminWS] 已发送 join_room:', roomId);
    };
    window._adminJoinRoom = joinAdminRoom;

    ws.on('connected', () => {
        console.log('[AdminWS] WebSocket 已连接 (Shared)');
        updateWsStatus(true);
        // 重连后重新加入当前选中的房间
        if (window.selectedRoomId) joinAdminRoom(window.selectedRoomId);
    });

    ws.on('disconnected', () => {
        updateWsStatus(false);
    });

    // 处理房间状态变更消息
    // 服务器推送格式: { type: 'roomStateChanged', roomId, data: { playState, volume, mute, micStatus, ac, light, effect, ... }, timestamp }
    const handleRoomUpdate = (data) => {
        const roomId = data.roomId;
        const stateData = data.data;
        if (!roomId || !stateData || typeof stateData !== 'object') return;

        let room = null;
        if (window.allRoomsCache) {
            room = window.allRoomsCache.find(item => item.id === roomId) || null;
            if (room) {
                if (stateData.status !== undefined) room.status = stateData.status;
                if (stateData.playState !== undefined) room.playState = stateData.playState;
                if (stateData.volume !== undefined) room.volume = stateData.volume;
                if (stateData.musicVolume !== undefined) room.musicVolume = stateData.musicVolume;
                if (stateData.micVolume !== undefined) room.micVolume = stateData.micVolume;
                if (stateData.mute !== undefined) room.muteStatus = stateData.mute ? 1 : 0;
                if (stateData.micStatus !== undefined) room.micStatus = stateData.micStatus;
                if (stateData.currentSongId !== undefined) room.currentSongId = stateData.currentSongId;
                if (stateData.currentSongTitle !== undefined) room.currentSongTitle = stateData.currentSongTitle;
                if (stateData.ac !== undefined) room.acState = JSON.stringify(stateData.ac);
                if (stateData.light !== undefined) room.lightState = JSON.stringify(stateData.light);
                if (stateData.effect !== undefined) room.effectState = JSON.stringify(stateData.effect);
            }
        }

        // WebSocket payload is authoritative; update cache/UI directly and never refetch state here.
        if (room && typeof updateSingleRoomCacheAndUI === 'function') {
            void updateSingleRoomCacheAndUI(room);
        }

        if (window.selectedRoomId === roomId && typeof loadRoomQueue === 'function') {
            loadRoomQueue(roomId);
        }
    };

    ws.on('roomStateChanged', handleRoomUpdate);

    if (ws.onAny) {
        ws.onAny((type, data) => {});
    }

    ws.on('getPlayList', (data) => {
        const targetRoomId = data.roomId;
        if (window.selectedRoomId) {
            if (!targetRoomId || targetRoomId === window.selectedRoomId) {
                loadRoomQueue(window.selectedRoomId);
            }
        }
    });

    // 订阅 playListChanged：点歌/切歌信号，立即刷新当前房间队列
    ws.on('playListChanged', () => {
        if (window.selectedRoomId && typeof loadRoomQueue === 'function') {
            loadRoomQueue(window.selectedRoomId);
        }
    });

    // 订阅 command 事件：即时更新后台 UI（音量/静音/播放状态等）
    ws.on('command', (data) => {
        if (!data || !data.action) return;
        const action = data.action;
        if (window.selectedRoomId && window.allRoomsCache) {
            const room = window.allRoomsCache.find(r => r.id === window.selectedRoomId);
            let peripheralChanged = false;
            if (room) {
                if (action === 'SetVolume' && data.volume != null) {
                    room.volume = Number(data.volume);
                    room.muteStatus = 0;
                } else if (action === 'Mute') {
                    room.muteStatus = 1;
                } else if (action === 'Unmute') {
                    room.muteStatus = 0;
                } else if (action === 'MicOn') {
                    room.micStatus = 1;
                } else if (action === 'MicOff') {
                    room.micStatus = 0;
                } else if (action === 'SwitchTrack' && data.trackId != null) {
                    room.micStatus = Number(data.trackId) === 1 ? 1 : 0;
                } else if (action === 'Play' || action === 'Replay') {
                    room.playState = 1;
                } else if (action === 'Pause') {
                    room.playState = 2;
                } else if (action === 'SetLight' && data.scene != null) {
                    room.lightState = JSON.stringify({ scene: String(data.scene) });
                    peripheralChanged = true;
                } else if (action === 'SetAC') {
                    const current = (() => {
                        try { return JSON.parse(room.acState || '{}'); } catch (_) { return {}; }
                    })();
                    const nextPower = data.power !== undefined
                        ? (data.power === true || data.power === 1 || data.power === '1' || data.power === 'true' || data.power === 'on')
                        : (current.power === true || current.power === 1 || current.power === '1' || current.power === 'true' || current.power === 'on');
                    room.acState = JSON.stringify({
                        power: nextPower,
                        temp: data.temp !== undefined && data.temp !== null ? Number(data.temp) : (current.temp || 26),
                        mode: data.mode != null ? String(data.mode) : (current.mode || 'auto'),
                        wind: data.wind != null ? String(data.wind) : (current.wind || 'low')
                    });
                    peripheralChanged = true;
                } else if (action === 'SetEffect' && data.mode != null) {
                    room.effectState = JSON.stringify({ mode: String(data.mode) });
                    peripheralChanged = true;
                }
                if (peripheralChanged && typeof peripheralStatusBar !== 'undefined') {
                    peripheralStatusBar.updateStatus(room);
                }
            }
        }
        // 刷新右侧详情面板
        if (window.selectedRoomId && typeof selectRoom === 'function') {
            selectRoom(window.selectedRoomId);
        }
    });

    // 名称、连接和在线状态统一使用服务端的 terminals_updated 事件。
    ws.on('terminals_updated', () => {
        if (currentSection === 'terminals') {
            loadTerminals();
        } else if (currentSection === 'rooms') {
            loadRooms();
        } else if (currentSection === 'dashboard') {
            updateStatistics();
        }
    });

    // 监听播放器操作结果
    ws.on('commandResult', (data) => {
        const action = data.action;
        const ok = data.ok === true || data.ok === 1 || data.ok === 'true';
        const msg = data.message || data.error || '';

        const labels = {
            'Play': '播放', 'Pause': '暂停', 'SkipSong': '切歌', 'NextSong': '下一首', 'Replay': '重唱',
            'SwitchTrack': '切换原伴唱', 'SetVolume': '调节音量', 'Mute': '静音', 'Unmute': '取消静音',
            'SetMic': '麦克风', 'ClearQueue': '清空列表',
            'SetAC': '空调控制', 'SetLight': '灯光控制', 'SetEffect': '音效控制',
            'PlayMaterial': '播放素材', 'PlayStream': '播放流媒体', 'StopStream': '停止流媒体',
            'PlayUrl': '播放链接', 'ServiceCall': '服务呼叫'
        };
        const label = labels[action] || action || '操作';

        if (!ok) {
            showToast(`${label}失败${msg ? '：' + msg : ''}`, 'error', 2500);
        } else {
            const silentActions = new Set(['SetVolume', 'Mute', 'Unmute']);
            if (!silentActions.has(action)) {
                showToast(`${label}成功`, 'success', 1500);
            }
        }

        if (window.selectedRoomId) {
            if (typeof loadRoomQueue === 'function') {
                loadRoomQueue(window.selectedRoomId);
            }
            if (typeof refreshRoomStatus === 'function') {
                refreshRoomStatus(window.selectedRoomId);
            }
        }
    });

    // 初始化时如果已经连接，更新一次 UI
    if (ws.getConnectionStatus() === 'connected') {
        updateWsStatus(true);
        if (window.selectedRoomId) joinAdminRoom(window.selectedRoomId);
    }
}

// 启动 WebSocket 同步
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminWebSocket);
} else {
    initAdminWebSocket();
}

// ==================== 歌曲对照功能 ====================
(function () {
    let currentTaskId = null;
    let scanWs = null;
    let scanState = 'idle';
    let scanPollTimer = null;
    let scanTerminalReceived = false;
    let rootsLoading = false;

    function directoryKey(path) {
        const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '') || '/';
        return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
    }

    function scanDirectories() {
        return document.getElementById('scan-directories').value.split(';').map(path => path.trim()).filter(Boolean);
    }

    function syncScanMode() {
        const incremental = document.getElementById('scan-mode').value === 'incremental';
        document.getElementById('scan-drive-panel').classList.toggle('hidden', incremental);
        document.getElementById('scan-directory-panel').classList.toggle('hidden', !incremental);
        document.getElementById('scan-directories').disabled = scanState === 'running' || !incremental;
        document.getElementById('scan-directories-browse').disabled = scanState === 'running' || !incremental;
        syncDriveSelection();
    }

    function syncDriveSelection() {
        const selected = new Set(scanDirectories().map(directoryKey));
        document.querySelectorAll('#scan-drive-list input').forEach(input => {
            input.checked = selected.has(directoryKey(input.value));
            input.disabled = scanState === 'running' || document.getElementById('scan-mode').value === 'incremental';
        });
    }

    async function loadScanRoots() {
        if (rootsLoading) return;
        rootsLoading = true;
        const status = document.getElementById('scan-drive-status');
        status.textContent = '正在读取本地盘符…';
        try {
            const response = await apiService.getScanRoots();
            const list = document.getElementById('scan-drive-list');
            const entries = response.data?.entries || [];
            list.replaceChildren();
            for (const entry of entries) {
                const label = document.createElement('label');
                label.className = 'inline-flex items-center gap-2 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white cursor-pointer';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.className = 'drive-btn w-4 h-4';
                input.value = entry.path;
                input.addEventListener('change', () => {
                    const paths = scanDirectories().filter(path => directoryKey(path) !== directoryKey(input.value));
                    if (input.checked) paths.push(input.value);
                    const field = document.getElementById('scan-directories');
                    field.value = paths.join(';');
                    field.dispatchEvent(new Event('change', {bubbles: true}));
                });
                const caption = document.createElement('span');
                caption.setAttribute('translate', 'no');
                caption.textContent = entry.name || entry.path;
                label.append(input, caption);
                list.appendChild(label);
            }
            syncDriveSelection();
            status.textContent = entries.length ? '' : '未发现可用数据盘。';
        } catch (error) {
            status.textContent = '盘符读取失败，请重新展开重试。';
        } finally { rootsLoading = false; }
    }

    for (const event of ['input', 'change']) {
        document.getElementById('scan-directories')?.addEventListener(event, syncDriveSelection);
    }

    document.getElementById('scan-mode').addEventListener('change', () => {
        document.getElementById('scan-directories').value = '';
        syncScanMode();
        if (document.getElementById('scan-mode').value === 'full') loadScanRoots();
    });
    syncScanMode();

    window.toggleScanPanel = function () {
        const panel = document.getElementById('scan-panel');
        if (!panel) return;
        const wasHidden = panel.classList.contains('hidden');
        if (wasHidden) {
            document.getElementById('song-import-panel')?.classList.add('hidden');
            syncScanMode();
            if (document.getElementById('scan-mode').value === 'full') loadScanRoots();
        }
        panel.classList.toggle('hidden');
    };

    function setUiState(state) {
        scanState = state;
        const startBtn = document.getElementById('scan-start-btn');
        const cancelBtn = document.getElementById('scan-cancel-btn');
        const progressPanel = document.getElementById('scan-progress-panel');
        const resultPanel = document.getElementById('scan-result-panel');
        if (!startBtn) return;

        document.getElementById('scan-mode').disabled = state === 'running';
        document.getElementById('scan-delete-duplicates').disabled = state === 'running';
        syncScanMode();

        if (state === 'running') {
            startBtn.classList.add('hidden');
            cancelBtn.classList.remove('hidden');
            progressPanel.classList.remove('hidden');
            resultPanel.classList.add('hidden');
        } else if (state === 'completed') {
            startBtn.classList.remove('hidden');
            cancelBtn.classList.add('hidden');
            progressPanel.classList.add('hidden');
            resultPanel.classList.remove('hidden');
        } else {
            startBtn.classList.remove('hidden');
            cancelBtn.classList.add('hidden');
            progressPanel.classList.add('hidden');
            resultPanel.classList.add('hidden');
        }
    }

    function updateProgress(data) {
        const pct = Math.min(100, Math.round(data.percentage || 0));
        document.getElementById('scan-progress-bar').style.width = pct + '%';
        document.getElementById('scan-percentage').textContent = pct + '%';
        document.getElementById('scan-count-files').textContent = data.scannedFiles || 0;
        document.getElementById('scan-count-matched').textContent = data.matchedSongs || 0;
        const dirEl = document.getElementById('scan-current-dir');
        if (data.currentDirectory) {
            dirEl.textContent = data.currentDirectory;
            dirEl.title = data.currentDirectory;
        }
    }

    function renderSummary(result) {
        const items = [
            { label: '扫描文件总数', value: result.totalFilesScanned || 0, color: 'text-white' },
            { label: '成功匹配写入', value: result.matchedCount || 0, color: 'text-green-400' },
            { label: 'ID不在库中', value: (result.unmatchedFiles || []).length, color: 'text-yellow-400' },
            { label: '无法提取ID', value: (result.unrecognizedFiles || []).length, color: 'text-red-400' },
            { label: '目录/读取错误', value: (result.errors || []).length, color: 'text-red-400' },
        ];
        const el = document.getElementById('scan-summary');
        el.innerHTML = items.map(i =>
            `<div class="bg-gray-700 rounded p-3 text-center">
                <div class="text-2xl font-bold ${i.color}">${i.value}</div>
                <div class="text-xs text-gray-400 mt-1">${i.label}</div>
            </div>`
        ).join('');
    }

    // 分页渲染，避免一次性渲染大量 DOM 导致卡顿
    const PAGE_SIZE = 100;
    const pageState = {};  // { tabId: { files, renderFn, page } }

    function renderFileList(containerId, files, renderFn) {
        pageState[containerId] = { files: files || [], renderFn, page: 0 };
        renderPage(containerId);
    }

    function renderPage(containerId) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const state = pageState[containerId];
        if (!state || !state.files.length) {
            el.innerHTML = '<p class="text-gray-400 text-sm text-center py-4">无数据</p>';
            return;
        }
        const { files, renderFn, page } = state;
        const start = page * PAGE_SIZE;
        const slice = files.slice(start, start + PAGE_SIZE);
        const rows = slice.map(renderFn).join('');
        const total = files.length;
        const showing = Math.min(start + PAGE_SIZE, total);

        const hasPrev = page > 0;
        const hasNext = showing < total;
        const pagination = (hasPrev || hasNext) ? `
            <tr><td colspan="4" class="pt-2 pb-1">
                <div class="flex items-center justify-between text-xs text-gray-400">
                    <span>显示 ${start + 1}–${showing} / 共 ${total} 条</span>
                    <div class="flex gap-2">
                        ${hasPrev ? `<button onclick="window._scanPage('${containerId}',-1)" class="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded">上一页</button>` : ''}
                        ${hasNext ? `<button onclick="window._scanPage('${containerId}',1)" class="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded">下一页</button>` : ''}
                    </div>
                </div>
            </td></tr>` : '';

        el.innerHTML = `<table class="w-full text-xs text-gray-300">
            <tbody>${rows}${pagination}</tbody>
        </table>`;
    }

    window._scanPage = function (containerId, delta) {
        const state = pageState[containerId];
        if (!state) return;
        const maxPage = Math.ceil(state.files.length / PAGE_SIZE) - 1;
        state.page = Math.max(0, Math.min(maxPage, state.page + delta));
        renderPage(containerId);
        document.getElementById(containerId).scrollTop = 0;
    };

    function renderResult(result) {
        renderSummary(result);

        renderFileList('scan-tab-matched', result.matchedRecords, record =>
            `<tr class="border-b border-gray-700">
                <td class="py-1 pr-3 text-green-400 font-mono whitespace-nowrap">${escapeHtml(record.songId)}</td>
                <td class="py-1 text-gray-300 break-all">${escapeHtml(record.filePath)}</td>
            </tr>`
        );

        renderFileList('scan-tab-unmatched', result.unmatchedFiles, file =>
            `<tr class="border-b border-gray-700">
                <td class="py-1 pr-3 text-yellow-300 font-mono whitespace-nowrap">${file.extractedId != null ? 'ID:' + escapeHtml(file.extractedId) : '—'}</td>
                <td class="py-1 text-gray-300 break-all">${escapeHtml(file.filePath)}</td>
                <td class="py-1 pl-2 text-gray-500 whitespace-nowrap">${escapeHtml(file.reason)}</td>
            </tr>`
        );

        renderFileList('scan-tab-unrecognized', result.unrecognizedFiles, file =>
            `<tr class="border-b border-gray-700">
                <td class="py-1 text-red-300 break-all">${escapeHtml(file.filePath)}</td>
                <td class="py-1 pl-2 text-gray-500">${escapeHtml(file.reason)}</td>
            </tr>`
        );

        renderFileList('scan-tab-duplicates', result.duplicateFiles, duplicate => {
            const deletedFiles = new Set(duplicate.deletedFiles || []);
            const duplicateRows = (duplicate.duplicateFiles || []).map(path => {
                const deleted = deletedFiles.has(path);
                return `<div class="${deleted ? 'text-red-400' : 'text-yellow-400'}">${deleted ? '已删除' : '重复未删除'}: ${escapeHtml(path)}</div>`;
            }).join('');
            return `<tr class="border-b border-gray-700">
                <td class="py-1 pr-2 text-blue-300 font-mono whitespace-nowrap">${escapeHtml(duplicate.songId)}</td>
                <td class="py-1">
                    <div class="text-green-400">保留: ${escapeHtml(duplicate.keptFile)}</div>
                    ${duplicateRows}
                </td>
            </tr>`;
        });

        renderFileList('scan-tab-errors', result.errors, error =>
            `<tr class="border-b border-gray-700">
                <td class="py-1 pr-2 text-red-300 break-all">${escapeHtml(error.filePath)}</td>
                <td class="py-1 pl-2 text-red-400">${escapeHtml(error.error)}</td>
            </tr>`
        );

        const tabs = ['matched', 'unmatched', 'unrecognized', 'duplicates', 'errors'];
        const counts = [
            (result.matchedRecords || []).length,
            (result.unmatchedFiles || []).length,
            (result.unrecognizedFiles || []).length,
            (result.duplicateFiles || []).length,
            (result.errors || []).length,
        ];
        const firstNonEmptyIndex = counts.findIndex(count => count > 0);
        const firstActive = counts[0] > 0 ? 'matched' : (tabs[firstNonEmptyIndex] || 'matched');
        switchScanTab(firstActive);
    }

    function stopScanPolling() {
        if (scanPollTimer) {
            clearInterval(scanPollTimer);
            scanPollTimer = null;
        }
    }

    function finishScanFromMessage(message) {
        scanTerminalReceived = true;
        stopScanPolling();

        if (message.type === 'completed' && message.data) {
            document.getElementById('scan-status-text').textContent = '对照完成';
            document.getElementById('scan-progress-bar').style.width = '100%';
            document.getElementById('scan-percentage').textContent = '100%';
            setUiState('completed');
            renderResult(message.data);
        } else if (message.type === 'cancelled') {
            document.getElementById('scan-status-text').textContent = '已取消';
            setUiState('idle');
            showToast('扫描已取消');
        } else if (message.type === 'error') {
            const errorMessage = message.message || '扫描失败';
            document.getElementById('scan-status-text').textContent = '错误: ' + errorMessage;
            if (message.data) {
                renderResult(message.data);
                setUiState('completed');
            } else {
                setUiState('idle');
            }
            showToast('扫描出错: ' + errorMessage, 'error');
        }
    }

    function connectScanWs(taskId) {
        stopScanPolling();
        scanTerminalReceived = false;
        if (scanWs) {
            scanWs.onclose = null;
            scanWs.onerror = null;
            scanWs.close();
            scanWs = null;
        }

        const socket = new WebSocket(apiService.getScanWsUrl(taskId));
        scanWs = socket;

        socket.onmessage = event => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }

            if (message.type === 'progress' && message.data) {
                updateProgress(message.data);
                document.getElementById('scan-status-text').textContent = '正在扫描匹配...';
                return;
            }

            if (message.type === 'completed' || message.type === 'cancelled' || message.type === 'error') {
                finishScanFromMessage(message);
                socket.close();
                if (scanWs === socket) scanWs = null;
            }
        };

        socket.onerror = () => {
            if (!scanTerminalReceived && scanState === 'running' && currentTaskId === taskId) {
                pollScanProgress(taskId);
            }
        };

        socket.onclose = () => {
            if (scanWs === socket) scanWs = null;
            if (!scanTerminalReceived && scanState === 'running' && currentTaskId === taskId) {
                pollScanProgress(taskId);
            }
        };
    }

    function pollScanProgress(taskId) {
        if (scanPollTimer || scanTerminalReceived || currentTaskId !== taskId) return;

        const checkTask = async () => {
            try {
                const response = await apiService.getScanResult(taskId);
                const task = response.data;
                if (!task || currentTaskId !== taskId) return;

                if (task.progress) updateProgress(task.progress);

                if (task.status === 'completed') {
                    finishScanFromMessage({ type: 'completed', data: task.result });
                } else if (task.status === 'cancelled') {
                    finishScanFromMessage({ type: 'cancelled' });
                } else if (task.status === 'failed') {
                    finishScanFromMessage({
                        type: 'error',
                        message: task.errorMessage || '扫描失败',
                        data: task.result
                    });
                }
            } catch (error) {
                document.getElementById('scan-status-text').textContent = '连接中断，正在重试...';
            }
        };

        scanPollTimer = setInterval(checkTask, 1000);
        checkTask();
    }

    document.addEventListener('song-catalog-imported', async () => {
        // 导入总库后，之前的路径对照结果可能基于旧曲库，必须丢弃并重新扫描。
        const taskId = currentTaskId;
        if (scanState === 'running' && taskId) {
            try {
                await apiService.cancelScan(taskId);
            } catch (error) {
                console.warn('导入完成后取消旧路径对照任务失败:', error);
            }
        }
        window.resetScan();
    });

    window.startScan = async function () {
        if (scanState === 'running') return;
        const incremental = document.getElementById('scan-mode').value === 'incremental';
        const dir = incremental
            ? document.getElementById('scan-directories').value.trim()
            : Array.from(document.querySelectorAll('#scan-drive-list input:checked'), input => input.value).join(';');
        if (!dir) { showToast(incremental ? '请先选择歌曲文件夹' : '请先选择磁盘', 'error'); return; }
        stopScanPolling();
        scanTerminalReceived = false;
        currentTaskId = null;
        const del = document.getElementById('scan-delete-duplicates').checked;

        setUiState('running');
        document.getElementById('scan-status-text').textContent = incremental ? '正在启动增量对照...' : '正在启动全量对照...';
        updateProgress({ percentage: 0, scannedFiles: 0, matchedSongs: 0, currentDirectory: '' });

        try {
            const resp = await apiService.startScan(dir, del, incremental);
            currentTaskId = resp.data && resp.data.taskId;
            if (!currentTaskId) throw new Error('未获取到 taskId');
            connectScanWs(currentTaskId);
        } catch (e) {
            scanTerminalReceived = true;
            setUiState('idle');
            showToast('启动失败: ' + e.message, 'error');
        }
    };

    window.cancelScan = async function () {
        if (!currentTaskId) return;
        try {
            await apiService.cancelScan(currentTaskId);
            showToast('正在取消...');
        } catch (e) {
            showToast('取消失败: ' + e.message, 'error');
        }
    };

    window.resetScan = function () {
        scanTerminalReceived = true;
        stopScanPolling();
        currentTaskId = null;
        document.getElementById('scan-directories').value = '';
        if (scanWs) {
            scanWs.onclose = null;
            scanWs.onerror = null;
            scanWs.close();
            scanWs = null;
        }
        setUiState('idle');
    };

    window.switchScanTab = function (tab) {
        document.querySelectorAll('.scan-tab-btn').forEach(btn => {
            btn.classList.toggle('border-blue-500', btn.dataset.tab === tab);
            btn.classList.toggle('text-white', btn.dataset.tab === tab);
            btn.classList.toggle('text-gray-300', btn.dataset.tab !== tab);
        });
        document.querySelectorAll('.scan-tab-content').forEach(el => {
            el.classList.toggle('hidden', el.id !== 'scan-tab-' + tab);
        });
    };

    // 简易 toast 辅助（使用已有 showToast 或自定义）
    function showToast(msg, type) {
        if (window.showToast) { window.showToast(msg, type); return; }
        if (window.showNotification) { window.showNotification(msg, type === 'error' ? 'error' : 'success'); return; }
        alert(window.AdminI18n?.t(msg) ?? msg);
    }
})();



// ==================== 歌曲总库 Excel 导入 ====================
(function () {
    const MAX_IMPORT_SIZE = 512 * 1024 * 1024;
    let selectedFile = null;
    let currentImportTaskId = null;
    let importPollTimer = null;
    let importRunning = false;

    function element(id) {
        return document.getElementById(id);
    }

    function notify(message, type = 'success') {
        if (window.showToast) {
            window.showToast(message, type);
        } else if (window.showNotification) {
            window.showNotification(message, type);
        } else {
            alert(window.AdminI18n?.t(message) ?? message);
        }
    }

    function formatFileSize(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
    }

    function stopImportPolling() {
        if (importPollTimer) {
            clearInterval(importPollTimer);
            importPollTimer = null;
        }
    }

    function setImportControls(running) {
        importRunning = running;
        const input = element('song-import-file');
        const button = element('song-import-start-btn');
        if (input) input.disabled = running;
        if (button) button.disabled = running || !selectedFile;
    }

    function setImportMessage(message, type) {
        const box = element('song-import-message');
        if (!box) return;
        if (!message) {
            box.classList.add('hidden');
            box.textContent = '';
            return;
        }
        box.className = 'text-xs rounded border p-2 break-all';
        box.textContent = message;
        if (type === 'error') {
            box.classList.add('border-red-700', 'bg-red-950', 'text-red-300');
        } else if (type === 'warning') {
            box.classList.add('border-yellow-700', 'bg-yellow-950', 'text-yellow-300');
        } else {
            box.classList.add('border-emerald-700', 'bg-emerald-950', 'text-emerald-300');
        }
    }

    function renderImportTask(task) {
        if (!task) return;
        const total = Math.max(0, Number(task.totalCount || 0));
        const processed = Math.max(0, Number(task.processedCount || 0));
        const percent = total > 0 ? Math.min(100, Math.round(processed / total * 100)) : 0;
        const statusMap = {
            pending: '文件已上传，等待导入...',
            running: `正在导入第 ${Number(task.currentRow || 0)} 行...`,
            completed: '歌曲数据导入完成',
            failed: '歌曲数据导入失败'
        };
        const status = String(task.status || 'pending');

        element('song-import-progress-panel')?.classList.remove('hidden');
        if (element('song-import-progress-bar')) element('song-import-progress-bar').style.width = `${status === 'completed' ? 100 : percent}%`;
        if (element('song-import-percentage')) element('song-import-percentage').textContent = `${status === 'completed' ? 100 : percent}%`;
        if (element('song-import-status')) element('song-import-status').textContent = statusMap[status] || status;
        if (element('song-import-total')) element('song-import-total').textContent = total.toLocaleString();
        if (element('song-import-processed')) element('song-import-processed').textContent = processed.toLocaleString();
        if (element('song-import-inserted')) element('song-import-inserted').textContent = Number(task.insertedCount || 0).toLocaleString();
        if (element('song-import-updated')) element('song-import-updated').textContent = Number(task.updatedCount || 0).toLocaleString();
        if (element('song-import-skipped')) element('song-import-skipped').textContent = Number(task.skippedCount || 0).toLocaleString();
        if (element('song-import-failed')) element('song-import-failed').textContent = Number(task.failedCount || 0).toLocaleString();

        const nextButton = element('song-import-next-btn');
        if (nextButton) {
            nextButton.classList.toggle('hidden', status !== 'completed');
            nextButton.classList.toggle('flex', status === 'completed');
        }

        if (status === 'failed') {
            setImportMessage(task.errorMessage || '导入失败，请检查文件格式后重试。', 'error');
        } else if (status === 'completed' && task.errorMessage) {
            setImportMessage(task.errorMessage, 'warning');
        } else if (status === 'completed') {
            setImportMessage('总曲库已经更新；旧路径对照结果已清空，请重新执行本地视频路径对照。', 'success');
        } else {
            setImportMessage('', 'success');
        }
    }

    async function finishImport(task) {
        stopImportPolling();
        currentImportTaskId = null;
        setImportControls(false);
        renderImportTask(task);
        if (task.status === 'completed') {
            document.dispatchEvent(new CustomEvent('song-catalog-imported'));
            notify(`导入完成：新增 ${Number(task.insertedCount || 0).toLocaleString()}，更新 ${Number(task.updatedCount || 0).toLocaleString()}；请重新执行路径对照`, 'success');
            if (typeof loadSongs === 'function') await loadSongs(1);
            if (typeof updateStatistics === 'function') await updateStatistics();
        } else {
            notify(task.errorMessage || '歌曲数据导入失败', 'error');
        }
    }

    function pollImportTask(taskId) {
        stopImportPolling();
        currentImportTaskId = taskId;
        setImportControls(true);
        const check = async () => {
            try {
                const response = await apiService.getSongImportTask(taskId);
                const task = response.data;
                if (!task || currentImportTaskId !== taskId) return;
                renderImportTask(task);
                if (task.status === 'completed' || task.status === 'failed') {
                    await finishImport(task);
                }
            } catch (error) {
                if (element('song-import-status')) element('song-import-status').textContent = '进度连接中断，正在重试...';
            }
        };
        importPollTimer = setInterval(check, 1000);
        check();
    }

    function validateSelectedFile(file) {
        if (!file) return '请选择 XLSX 文件';
        if (!/\.xlsx$/i.test(file.name)) return '只允许导入 .xlsx 文件';
        if (file.size <= 0) return '文件为空，无法导入';
        if (file.size > MAX_IMPORT_SIZE) return '文件超过 512 MB，无法导入';
        return '';
    }

    window.toggleSongImportPanel = function () {
        const panel = element('song-import-panel');
        if (!panel) return;
        const opening = panel.classList.contains('hidden');
        panel.classList.toggle('hidden');
        if (opening) {
            const scanPanel = element('scan-panel');
            if (scanPanel && !scanPanel.classList.contains('hidden')) window.toggleScanPanel();
        }
    };

    window.startSongCatalogImport = async function () {
        if (importRunning) return;
        const validationError = validateSelectedFile(selectedFile);
        if (validationError) {
            notify(validationError, 'error');
            return;
        }

        setImportControls(true);
        element('song-import-progress-panel')?.classList.remove('hidden');
        if (element('song-import-status')) element('song-import-status').textContent = '正在上传文件...';
        if (element('song-import-progress-bar')) element('song-import-progress-bar').style.width = '0%';
        if (element('song-import-percentage')) element('song-import-percentage').textContent = '0%';
        setImportMessage('', 'success');

        try {
            const response = await apiService.importSongCatalog(selectedFile);
            const task = response.data;
            if (!task || !task.taskId) throw new Error('服务器未返回 taskId');
            renderImportTask(task);
            pollImportTask(task.taskId);
        } catch (error) {
            setImportControls(false);
            setImportMessage(error.message || '上传失败', 'error');
            if (element('song-import-status')) element('song-import-status').textContent = '上传失败';
            notify(error.message || '上传失败', 'error');
        }
    };

    window.openSongPathMatchStep = function () {
        const importPanel = element('song-import-panel');
        if (importPanel) importPanel.classList.add('hidden');
        const scanPanel = element('scan-panel');
        if (scanPanel && scanPanel.classList.contains('hidden')) window.toggleScanPanel();
        element('btn-toggle-scan')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    async function restoreActiveImport() {
        try {
            const response = await apiService.getActiveSongImport();
            const task = response.data;
            if (!task || !task.taskId) return;
            const panel = element('song-import-panel');
            if (panel) panel.classList.remove('hidden');
            renderImportTask(task);
            pollImportTask(task.taskId);
        } catch (error) {
            console.warn('恢复歌曲导入任务失败:', error);
        }
    }

    function initializeSongImport() {
        const input = element('song-import-file');
        if (!input) return;
        input.addEventListener('change', () => {
            const file = input.files && input.files[0] ? input.files[0] : null;
            const validationError = validateSelectedFile(file);
            selectedFile = validationError ? null : file;
            const info = element('song-import-file-info');
            if (info) {
                info.textContent = file
                    ? `${file.name}（${formatFileSize(file.size)}）${validationError ? `：${validationError}` : ''}`
                    : '尚未选择文件';
                info.className = `mt-2 text-xs break-all ${validationError && file ? 'text-red-400' : selectedFile ? 'text-emerald-300' : 'text-gray-500'}`;
            }
            setImportControls(importRunning);
            if (validationError && file) notify(validationError, 'error');
        });
        restoreActiveImport();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSongImport);
    } else {
        initializeSongImport();
    }
})();

// ==================== 歌星总库 Excel 导入与图片对照 ====================
(function () {
    const MAX_IMPORT_SIZE = 512 * 1024 * 1024;
    const IMAGE_MATCH_TASK_KEY = 'singer_image_match_task_id';
    let selectedImportFile = null;
    let currentImportTaskId = null;
    let importPollTimer = null;
    let importRunning = false;
    let currentImageMatchTaskId = null;
    let imageMatchPollTimer = null;
    let imageMatchRunning = false;

    function element(id) {
        return document.getElementById(id);
    }

    function notify(message, type = 'success') {
        if (window.showToast) {
            window.showToast(message, type);
        } else if (window.showNotification) {
            window.showNotification(message, type);
        } else {
            alert(window.AdminI18n?.t(message) ?? message);
        }
    }

    function formatFileSize(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
    }

    function stopImportPolling() {
        if (importPollTimer) {
            clearInterval(importPollTimer);
            importPollTimer = null;
        }
    }

    function stopImageMatchPolling() {
        if (imageMatchPollTimer) {
            clearInterval(imageMatchPollTimer);
            imageMatchPollTimer = null;
        }
    }

    function setImportControls(running) {
        importRunning = running;
        const input = element('singer-import-file');
        const button = element('singer-import-start-btn');
        if (input) input.disabled = running;
        if (button) button.disabled = running || !selectedImportFile;
    }

    function setImportMessage(message, type) {
        const box = element('singer-import-message');
        if (!box) return;
        if (!message) {
            box.className = 'hidden';
            box.textContent = '';
            return;
        }
        box.className = 'text-xs rounded border p-2 break-all';
        box.textContent = message;
        if (type === 'error') {
            box.classList.add('border-red-700', 'bg-red-950', 'text-red-300');
        } else if (type === 'warning') {
            box.classList.add('border-yellow-700', 'bg-yellow-950', 'text-yellow-300');
        } else {
            box.classList.add('border-emerald-700', 'bg-emerald-950', 'text-emerald-300');
        }
    }

    function renderImportTask(task) {
        if (!task) return;
        const total = Math.max(0, Number(task.totalCount || 0));
        const processed = Math.max(0, Number(task.processedCount || 0));
        const percent = total > 0 ? Math.min(100, Math.round(processed / total * 100)) : 0;
        const status = String(task.status || 'pending');
        const statusMap = {
            pending: '文件已上传，等待导入...',
            running: `正在导入第 ${Number(task.currentRow || 0).toLocaleString()} 行...`,
            completed: '歌星数据导入完成',
            failed: '歌星数据导入失败'
        };

        element('singer-import-progress-panel')?.classList.remove('hidden');
        if (element('singer-import-progress-bar')) element('singer-import-progress-bar').style.width = `${status === 'completed' ? 100 : percent}%`;
        if (element('singer-import-percentage')) element('singer-import-percentage').textContent = `${status === 'completed' ? 100 : percent}%`;
        if (element('singer-import-status')) element('singer-import-status').textContent = statusMap[status] || status;
        if (element('singer-import-total')) element('singer-import-total').textContent = total.toLocaleString();
        if (element('singer-import-processed')) element('singer-import-processed').textContent = processed.toLocaleString();
        if (element('singer-import-inserted')) element('singer-import-inserted').textContent = Number(task.insertedCount || 0).toLocaleString();
        if (element('singer-import-updated')) element('singer-import-updated').textContent = Number(task.updatedCount || 0).toLocaleString();
        if (element('singer-import-skipped')) element('singer-import-skipped').textContent = Number(task.skippedCount || 0).toLocaleString();
        if (element('singer-import-failed')) element('singer-import-failed').textContent = Number(task.failedCount || 0).toLocaleString();

        const nextButton = element('singer-import-next-btn');
        if (nextButton) {
            nextButton.classList.toggle('hidden', status !== 'completed');
            nextButton.classList.toggle('flex', status === 'completed');
        }

        if (status === 'failed') {
            setImportMessage(task.errorMessage || '导入失败，请检查 XLSX 字段和数据格式。', 'error');
        } else if (status === 'completed' && task.errorMessage) {
            setImportMessage(task.errorMessage, 'warning');
        } else if (status === 'completed') {
            setImportMessage('歌星库已经更新，请继续执行本地图片对照。', 'success');
        } else {
            setImportMessage('', 'success');
        }
    }

    async function finishImport(task) {
        stopImportPolling();
        currentImportTaskId = null;
        setImportControls(false);
        renderImportTask(task);
        if (task.status === 'completed') {
            document.dispatchEvent(new CustomEvent('singer-catalog-imported'));
            notify(`歌星导入完成：新增 ${Number(task.insertedCount || 0).toLocaleString()}，更新 ${Number(task.updatedCount || 0).toLocaleString()}`, 'success');
            if (typeof loadSingers === 'function') await loadSingers(1);
            if (typeof loadArtists === 'function') await loadArtists();
            if (typeof updateStatistics === 'function') await updateStatistics();
        } else {
            notify(task.errorMessage || '歌星数据导入失败', 'error');
        }
    }

    function pollImportTask(taskId) {
        stopImportPolling();
        currentImportTaskId = taskId;
        setImportControls(true);
        const check = async () => {
            try {
                const response = await apiService.getSingerImportTask(taskId);
                const task = response.data;
                if (!task || currentImportTaskId !== taskId) return;
                renderImportTask(task);
                if (task.status === 'completed' || task.status === 'failed') {
                    await finishImport(task);
                }
            } catch (error) {
                if (element('singer-import-status')) element('singer-import-status').textContent = '进度连接中断，正在重试...';
            }
        };
        importPollTimer = setInterval(check, 1000);
        check();
    }

    function validateImportFile(file) {
        if (!file) return '请选择 XLSX 文件';
        if (!/\.xlsx$/i.test(file.name)) return '只允许导入 .xlsx 文件';
        if (file.size <= 0) return '文件为空，无法导入';
        if (file.size > MAX_IMPORT_SIZE) return '文件超过 512 MB，无法导入';
        return '';
    }

    window.toggleSingerImportPanel = function () {
        const panel = element('singer-import-panel');
        if (!panel) return;
        const opening = panel.classList.contains('hidden');
        panel.classList.toggle('hidden');
        if (opening) element('singer-image-match-panel')?.classList.add('hidden');
    };

    window.startSingerCatalogImport = async function () {
        if (importRunning) return;
        const validationError = validateImportFile(selectedImportFile);
        if (validationError) {
            notify(validationError, 'error');
            return;
        }

        setImportControls(true);
        element('singer-import-progress-panel')?.classList.remove('hidden');
        if (element('singer-import-status')) element('singer-import-status').textContent = '正在上传文件...';
        if (element('singer-import-progress-bar')) element('singer-import-progress-bar').style.width = '0%';
        if (element('singer-import-percentage')) element('singer-import-percentage').textContent = '0%';
        setImportMessage('', 'success');

        try {
            const response = await apiService.importSingerCatalog(selectedImportFile);
            const task = response.data;
            if (!task || !task.taskId) throw new Error('服务器未返回 taskId');
            renderImportTask(task);
            pollImportTask(task.taskId);
        } catch (error) {
            setImportControls(false);
            setImportMessage(error.message || '上传失败', 'error');
            if (element('singer-import-status')) element('singer-import-status').textContent = '上传失败';
            notify(error.message || '上传失败', 'error');
        }
    };

    window.openSingerImageMatchStep = function () {
        element('singer-import-panel')?.classList.add('hidden');
        const matchPanel = element('singer-image-match-panel');
        if (matchPanel?.classList.contains('hidden')) window.toggleSingerImageMatchPanel();
        element('btn-toggle-singer-image-match')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    async function restoreActiveImport() {
        try {
            const response = await apiService.getActiveSingerImport();
            const task = response.data;
            if (!task || !task.taskId) return;
            element('singer-import-panel')?.classList.remove('hidden');
            element('singer-image-match-panel')?.classList.add('hidden');
            renderImportTask(task);
            pollImportTask(task.taskId);
        } catch (error) {
            console.warn('恢复歌星导入任务失败:', error);
        }
    }

    function setImageMatchControls(running) {
        imageMatchRunning = running;
        const directory = element('singer-image-match-directory');
        const overwrite = element('singer-image-match-overwrite');
        const startButton = element('singer-image-match-start-btn');
        const cancelButton = element('singer-image-match-cancel-btn');
        if (directory) directory.disabled = running;
        if (overwrite) overwrite.disabled = running;
        if (element('singer-image-directory-browse')) element('singer-image-directory-browse').disabled = running;
        if (startButton) {
            startButton.classList.toggle('hidden', running);
            startButton.classList.toggle('flex', !running);
        }
        if (cancelButton) {
            cancelButton.classList.toggle('hidden', !running);
            cancelButton.classList.toggle('flex', running);
        }
    }

    function renderImageMatchProgress(progress) {
        const safeProgress = progress || {};
        const percentage = Math.max(0, Math.min(100, Math.round(Number(safeProgress.percentage || 0))));
        element('singer-image-match-progress-panel')?.classList.remove('hidden');
        if (element('singer-image-match-progress-bar')) element('singer-image-match-progress-bar').style.width = `${percentage}%`;
        if (element('singer-image-match-percentage')) element('singer-image-match-percentage').textContent = `${percentage}%`;
        if (element('singer-image-match-scanned')) element('singer-image-match-scanned').textContent = Number(safeProgress.scannedFiles || 0).toLocaleString();
        if (element('singer-image-match-matched')) element('singer-image-match-matched').textContent = Number(safeProgress.matchedSingers || 0).toLocaleString();
        if (element('singer-image-match-copied')) element('singer-image-match-copied').textContent = Number(safeProgress.copiedImages || 0).toLocaleString();
        if (element('singer-image-match-current-directory')) element('singer-image-match-current-directory').textContent = safeProgress.currentDirectory || '—';
    }

    function addResultCard(container, label, value, colorClass) {
        const card = document.createElement('div');
        card.className = 'rounded bg-gray-800 px-2 py-2 text-gray-400';
        const number = document.createElement('span');
        number.className = `block font-mono mt-1 ${colorClass}`;
        number.textContent = Number(value || 0).toLocaleString();
        card.append(document.createTextNode(label), number);
        container.appendChild(card);
    }

    function renderImageMatchDetails(result) {
        const details = element('singer-image-match-details');
        if (!details) return;
        details.replaceChildren();
        const unmatched = Array.isArray(result?.unmatchedFiles) ? result.unmatchedFiles : [];
        const errors = Array.isArray(result?.errors) ? result.errors : [];
        if (!unmatched.length && !errors.length) {
            details.classList.add('hidden');
            return;
        }
        details.classList.remove('hidden');
        if (unmatched.length) {
            const title = document.createElement('div');
            title.className = 'font-semibold text-yellow-300 mb-1';
            title.textContent = `未匹配文件（最多显示 ${unmatched.length} 条）`;
            details.appendChild(title);
            unmatched.forEach(path => {
                const line = document.createElement('div');
                line.className = 'font-mono text-gray-400 break-all mb-1';
                line.textContent = String(path);
                details.appendChild(line);
            });
        }
        if (errors.length) {
            const title = document.createElement('div');
            title.className = 'font-semibold text-red-300 mt-3 mb-1';
            title.textContent = `复制错误（最多显示 ${errors.length} 条）`;
            details.appendChild(title);
            errors.forEach(item => {
                const line = document.createElement('div');
                line.className = 'font-mono text-red-400 break-all mb-1';
                line.textContent = `${item.filePath || ''}: ${item.error || '未知错误'}`;
                details.appendChild(line);
            });
        }
    }

    function renderImageMatchResult(task) {
        const result = task?.result || {};
        const summary = element('singer-image-match-summary');
        if (summary) {
            summary.replaceChildren();
            addResultCard(summary, '扫描图片', result.totalFilesScanned, 'text-white');
            addResultCard(summary, '匹配歌星', result.matchedCount, 'text-green-400');
            addResultCard(summary, '复制图片', result.copiedCount, 'text-blue-400');
            addResultCard(summary, '未匹配图片', result.unmatchedCount, 'text-yellow-400');
            addResultCard(summary, '缺少图片歌星', result.missingSingerCount, 'text-orange-400');
            addResultCard(summary, '错误', Array.isArray(result.errors) ? result.errors.length : 0, 'text-red-400');
        }
        renderImageMatchDetails(result);
        element('singer-image-match-result-panel')?.classList.remove('hidden');
    }

    async function finishImageMatch(task) {
        stopImageMatchPolling();
        currentImageMatchTaskId = null;
        sessionStorage.removeItem(IMAGE_MATCH_TASK_KEY);
        setImageMatchControls(false);
        renderImageMatchProgress(task.progress);
        const status = String(task.status || 'failed');
        if (status === 'completed') {
            if (element('singer-image-match-status')) element('singer-image-match-status').textContent = '歌星图片对照完成';
            if (element('singer-image-match-progress-bar')) element('singer-image-match-progress-bar').style.width = '100%';
            if (element('singer-image-match-percentage')) element('singer-image-match-percentage').textContent = '100%';
            renderImageMatchResult(task);
            notify(`图片对照完成：匹配 ${Number(task.result?.matchedCount || 0).toLocaleString()}，复制 ${Number(task.result?.copiedCount || 0).toLocaleString()}`, 'success');
            if (typeof loadSingers === 'function') await loadSingers(1);
        } else if (status === 'cancelled') {
            if (element('singer-image-match-status')) element('singer-image-match-status').textContent = '图片对照已取消';
            notify('歌星图片对照已取消', 'warning');
        } else {
            const message = task.errorMessage || '歌星图片对照失败';
            if (element('singer-image-match-status')) element('singer-image-match-status').textContent = message;
            if (task.result) renderImageMatchResult(task);
            notify(message, 'error');
        }
    }

    function pollImageMatchTask(taskId) {
        stopImageMatchPolling();
        currentImageMatchTaskId = taskId;
        sessionStorage.setItem(IMAGE_MATCH_TASK_KEY, taskId);
        setImageMatchControls(true);
        const check = async () => {
            try {
                const response = await apiService.getSingerImageMatchResult(taskId);
                const task = response.data;
                if (!task || currentImageMatchTaskId !== taskId) return;
                renderImageMatchProgress(task.progress);
                if (element('singer-image-match-status')) {
                    element('singer-image-match-status').textContent = task.progress?.currentDirectory || '正在扫描图片...';
                }
                if (task.status !== 'running') await finishImageMatch(task);
            } catch (error) {
                if (element('singer-image-match-status')) element('singer-image-match-status').textContent = '进度连接中断，正在重试...';
            }
        };
        imageMatchPollTimer = setInterval(check, 1000);
        check();
    }

    window.toggleSingerImageMatchPanel = function () {
        const panel = element('singer-image-match-panel');
        if (!panel) return;
        const opening = panel.classList.contains('hidden');
        panel.classList.toggle('hidden');
        if (opening) {
            element('singer-import-panel')?.classList.add('hidden');
        }
    };

    window.startSingerImageMatch = async function () {
        if (imageMatchRunning) return;
        const directory = element('singer-image-match-directory')?.value.trim() || '';
        if (!directory) {
            notify('请选择或输入歌星图片目录', 'error');
            return;
        }
        const overwrite = Boolean(element('singer-image-match-overwrite')?.checked);
        stopImageMatchPolling();
        currentImageMatchTaskId = null;
        element('singer-image-match-result-panel')?.classList.add('hidden');
        element('singer-image-match-details')?.classList.add('hidden');
        setImageMatchControls(true);
        renderImageMatchProgress({ percentage: 0, scannedFiles: 0, matchedSingers: 0, copiedImages: 0, currentDirectory: '正在启动...' });
        if (element('singer-image-match-status')) element('singer-image-match-status').textContent = '正在启动...';
        try {
            const response = await apiService.startSingerImageMatch(directory, overwrite);
            const task = response.data;
            if (!task || !task.taskId) throw new Error('服务器未返回 taskId');
            pollImageMatchTask(task.taskId);
        } catch (error) {
            setImageMatchControls(false);
            if (element('singer-image-match-status')) element('singer-image-match-status').textContent = '启动失败';
            notify(error.message || '启动图片对照失败', 'error');
        }
    };

    window.cancelSingerImageMatch = async function () {
        if (!currentImageMatchTaskId) return;
        try {
            await apiService.cancelSingerImageMatch(currentImageMatchTaskId);
            if (element('singer-image-match-status')) element('singer-image-match-status').textContent = '正在取消...';
        } catch (error) {
            notify(error.message || '取消失败', 'error');
        }
    };

    window.resetSingerImageMatch = function () {
        stopImageMatchPolling();
        currentImageMatchTaskId = null;
        sessionStorage.removeItem(IMAGE_MATCH_TASK_KEY);
        setImageMatchControls(false);
        element('singer-image-match-progress-panel')?.classList.add('hidden');
        element('singer-image-match-result-panel')?.classList.add('hidden');
        element('singer-image-match-details')?.classList.add('hidden');
        if (element('singer-image-match-progress-bar')) element('singer-image-match-progress-bar').style.width = '0%';
        if (element('singer-image-match-percentage')) element('singer-image-match-percentage').textContent = '0%';
    };

    async function restoreImageMatchTask() {
        const taskId = sessionStorage.getItem(IMAGE_MATCH_TASK_KEY);
        if (!taskId) return;
        try {
            const response = await apiService.getSingerImageMatchResult(taskId);
            const task = response.data;
            if (!task) throw new Error('任务不存在');
            element('singer-image-match-panel')?.classList.remove('hidden');
            if (element('singer-image-match-directory')) element('singer-image-match-directory').value = task.directory || '';
            if (element('singer-image-match-overwrite')) element('singer-image-match-overwrite').checked = Boolean(task.overwrite);
            renderImageMatchProgress(task.progress);
            if (task.status === 'running') {
                pollImageMatchTask(taskId);
            } else {
                await finishImageMatch(task);
            }
        } catch (error) {
            sessionStorage.removeItem(IMAGE_MATCH_TASK_KEY);
        }
    }

    document.addEventListener('singer-catalog-imported', async () => {
        const taskId = currentImageMatchTaskId;
        if (imageMatchRunning && taskId) {
            try {
                await apiService.cancelSingerImageMatch(taskId);
            } catch (error) {
                console.warn('歌星导入完成后取消旧图片对照任务失败:', error);
            }
        }
        window.resetSingerImageMatch();
    });

    function initializeSingerBatchTools() {
        const input = element('singer-import-file');
        if (!input) return;
        input.addEventListener('change', () => {
            const file = input.files?.[0] || null;
            const validationError = validateImportFile(file);
            selectedImportFile = validationError ? null : file;
            const info = element('singer-import-file-info');
            if (info) {
                info.textContent = file
                    ? `${file.name}（${formatFileSize(file.size)}）${validationError ? `：${validationError}` : ''}`
                    : '尚未选择文件';
                info.className = `mt-2 text-xs break-all ${validationError && file ? 'text-red-400' : selectedImportFile ? 'text-emerald-300' : 'text-gray-500'}`;
            }
            setImportControls(importRunning);
            if (validationError && file) notify(validationError, 'error');
        });
        restoreActiveImport();
        restoreImageMatchTask();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSingerBatchTools);
    } else {
        initializeSingerBatchTools();
    }
})();
