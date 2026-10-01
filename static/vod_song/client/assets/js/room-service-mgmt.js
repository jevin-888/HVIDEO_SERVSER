/**
 * 服务铃工具模块
 * 维护待处理服务铃数据，供房间卡片渲染使用，并通过 WebSocket 实时更新卡片徽章。
 */

window._serviceTypes = {};  // { id: { name, icon } }
window._serviceCalls = [];  // 待处理的呼叫记录
let _serviceRefreshTimer = null;

// ─── 工具 ────────────────────────────────────────────────────────────────────

function _elapsed(createdAt) {
    try {
        const diff = Math.floor((Date.now() - new Date(createdAt.replace(' ', 'T')).getTime()) / 1000);
        if (diff < 60) return `${diff}秒前`;
        if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
        return `${Math.floor(diff / 3600)}小时前`;
    } catch { return ''; }
}

function _typeLabel(callType) { return window._serviceTypes[callType]?.name || callType; }
function _typeIcon(callType)  { return window._serviceTypes[callType]?.icon  || 'fa-concierge-bell'; }

// ─── 加载数据 ─────────────────────────────────────────────────────────────────

async function _loadServiceTypesCache() {
    try {
        const res = await apiService.request('/admin/service-types');
        const list = (res && res.data) || [];
        window._serviceTypes = {};
        list.forEach(t => { window._serviceTypes[t.id] = { name: t.name, icon: t.icon }; });
    } catch (_) {}
}

async function loadServiceCalls() {
    try {
        const [callsRes] = await Promise.all([
            apiService.getServiceCalls().catch(() => ({ data: [] })),
            _loadServiceTypesCache(),
        ]);
        window._serviceCalls = (callsRes && callsRes.data) || [];
    } catch (e) {
        console.error('加载服务铃数据失败', e);
    }
}

// ─── 房间卡片徽章刷新 ─────────────────────────────────────────────────────────

/** 刷新指定房间卡片的服务铃徽章 */
function refreshRoomServiceBadge(roomId) {
    const card = document.getElementById(`room-card-${roomId}`);
    if (!card) return;

    const calls = window._serviceCalls.filter(c => c.roomId === roomId);
    const badgeEl = card.querySelector('.room-svc-badge');
    if (!badgeEl) return;

    if (calls.length > 0) {
        card.classList.add('svc-flash', 'border-emerald-500/50');
        badgeEl.className = 'room-svc-badge border-t border-emerald-500/30 bg-emerald-950/40 px-2 py-1.5 flex flex-col gap-1';
        badgeEl.innerHTML = calls.map(c => `
            <div class="flex items-center justify-between gap-1">
                <span class="flex items-center gap-1 text-emerald-300">
                    <i class="fas ${_typeIcon(c.callType)} text-xs"></i>
                    <span>${_typeLabel(c.callType)}</span>
                </span>
                <button onclick="event.stopPropagation();handleComplete('${c.id}')"
                    class="text-xs text-emerald-400 hover:text-white border border-emerald-500/40 hover:bg-emerald-500/20 px-1.5 py-0.5 rounded transition-colors flex-shrink-0">
                    完成
                </button>
            </div>`).join('');
    } else {
        card.classList.remove('svc-flash', 'border-emerald-500/50');
        badgeEl.className = 'room-svc-badge';
        badgeEl.innerHTML = ''; // 移除底部背景和边框
        
        // 当没有服务铃时，中间区域显示 IP
        // 但是 refreshRoomServiceBadge 只负责更新 badgeEl。
        // 我们需要确保 IP 在卡片的 body 区域仍然可见。
        // 在 admin.js 的 createRoomCard 中，IP 已经始终存在于 Body 区域。
        // 所以这里只要清空 badgeEl 即可。
    }
}

// ─── 完成处理 ─────────────────────────────────────────────────────────────────

async function handleComplete(callId) {
    try {
        const call = window._serviceCalls.find(c => c.id === callId);
        await apiService.completeServiceCall(callId);
        window._serviceCalls = window._serviceCalls.filter(c => c.id !== callId);
        if (call) refreshRoomServiceBadge(call.roomId);
        showToast('已标记完成', 'success');
    } catch (e) {
        showToast('操作失败', 'error');
    }
}

// ─── WebSocket 实时推送 ───────────────────────────────────────────────────────

function _initServiceWs() {
    if (!window.WebSocketClient) return;

    window.WebSocketClient.on('service_call_new', (data) => {
        if (!data) return;
        window._serviceCalls.unshift(data);
        refreshRoomServiceBadge(data.roomId);
    });

    window.WebSocketClient.on('service_call_completed', (data) => {
        if (!data?.id) return;
        const call = window._serviceCalls.find(c => c.id === data.id);
        window._serviceCalls = window._serviceCalls.filter(c => c.id !== data.id);
        if (call) refreshRoomServiceBadge(call.roomId);
    });
}

// ─── 自动刷新 ─────────────────────────────────────────────────────────────────

function startServiceRefresh() {
    stopServiceRefresh();
    _serviceRefreshTimer = setInterval(async () => {
        await loadServiceCalls();
        (window.allRoomsCache || []).forEach(r => refreshRoomServiceBadge(r.id));
    }, 15000);
}

function stopServiceRefresh() {
    if (_serviceRefreshTimer) { clearInterval(_serviceRefreshTimer); _serviceRefreshTimer = null; }
}

document.addEventListener('DOMContentLoaded', _initServiceWs);
