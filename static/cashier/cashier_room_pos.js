let cashierRoomsCache = [];
let cashierRoomTypes = [];
let cashierRoomAreas = [];
let cashierActiveType = 'all';
let cashierActiveArea = 'all';
let cashierSelectedRoomId = null;
let cashierContextRoomId = null;
let cashierProductsCache = [];
let cashierCategoriesCache = [];
let cashierPackageConfigsCache = [];
let orderCart = [];
let orderActiveCategory = 'packages';
let checkoutPaymentMethod = 'cash';
let checkoutBill = null;
let checkoutBillLoading = false;
let checkoutBillError = '';
let checkoutBillGeneration = 0;

function resetCheckoutBill() {
    checkoutBillGeneration++;
    checkoutBill = null;
    checkoutBillLoading = false;
    checkoutBillError = '';
    updateCheckoutAvailability();
}

function updateCheckoutAvailability() {
    const button = document.getElementById('checkout-submit');
    if (button) button.disabled = checkoutBillLoading || !checkoutBill || !!window.cashierCheckoutSubmitting;
    const status = document.getElementById('checkout-bill-status');
    if (status) status.textContent = cashierTranslate(checkoutBillLoading ? '正在查询账单，请稍候' : checkoutBillError);
    const retry = document.getElementById('checkout-bill-retry');
    if (retry) retry.classList.toggle('hidden', checkoutBillLoading || !checkoutBillError);
}
let reservationsCache = [];
let membersCache = [];
let customerRefreshVersion = 0;
let editingMemberVersion = 0;
let editingReservationVersion = 0;

function customerRecordId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
}
let currentCashierMemberId = '';
let cashierActiveBillsCache = {};
let cashierRoomClockTimer = null;
let cashierRoomLocalStates = JSON.parse(localStorage.getItem('cashier_room_local_states') || '{}');
let cashierServiceTypesCache = {};
let cashierServiceCallsCache = [];
let cashierCurrentBillingSession = null;

function saveCashierRoomLocalStates() {
    localStorage.setItem('cashier_room_local_states', JSON.stringify(cashierRoomLocalStates));
}

function getRoomKey(room) {
    return room?.id || '';
}

function getActiveReservationForRoom(roomId) {
    const now = Date.now();
    return getReservations().find(item => String(item.room_id) === String(roomId) && item.status !== 'opened' && item.status !== 'cancelled' && (!item.reservation_time || new Date(item.reservation_time).getTime() >= now - 6 * 60 * 60 * 1000));
}

function getCashierRoomState(room) {
    const roomId = getRoomKey(room);
    const override = cashierRoomLocalStates[roomId];
    if (override === 'test') return 'test';
    if (override === 'maintenance') return 'maintenance';
    if (Number(room.status || 0) === 1) return 'using';
    if (Number(room.status || 0) === 2) return 'maintenance';
    if (getActiveReservationForRoom(roomId)) return 'reserved';
    return 'idle';
}

function getCashierRoomStateMeta(state) {
    const map = {
        idle: { text: '空闲', dot: 'text-sky-500', panel: 'from-sky-100 via-blue-100 to-sky-200 text-slate-700', border: 'border-sky-300/80', badge: 'bg-sky-500 text-white' },
        using: { text: '使用', dot: 'text-rose-500', panel: 'from-rose-600 via-red-600 to-rose-800 text-white', border: 'border-rose-300/90', badge: 'bg-white/20 text-white' },
        reserved: { text: '预订', dot: 'text-violet-500', panel: 'from-violet-600 via-fuchsia-600 to-purple-800 text-white', border: 'border-violet-300/90', badge: 'bg-white/20 text-white' },
        maintenance: { text: '维护', dot: 'text-amber-500', panel: 'from-amber-300 via-yellow-300 to-orange-400 text-slate-800', border: 'border-amber-200', badge: 'bg-amber-600 text-white' },
        test: { text: '测试', dot: 'text-cyan-500', panel: 'from-cyan-500 via-teal-500 to-emerald-600 text-white', border: 'border-cyan-200', badge: 'bg-white/20 text-white' }
    };
    return map[state] || map.idle;
}

async function loadCashierRooms(fetchData = true) {
    const container = document.getElementById('cashier-rooms');
    if (!container) return;
    try {
        if (fetchData || cashierRoomsCache.length === 0) {
            const [roomsResp, typesResp, areasResp] = await Promise.all([
                cashierRequest('/rooms'),
                cashierRequest('/rooms/configs/types').catch(() => ({ data: [] })),
                cashierRequest('/rooms/configs/areas').catch(() => ({ data: [] })),
                refreshCustomerData()
            ]);
            await loadCashierServiceCalls();
            cashierRoomsCache = roomsResp.data || [];
            cashierRoomTypes = typesResp.data || [];
            cashierRoomAreas = areasResp.data || [];
            renderCashierRoomTabs();
            renderCashierAreaTabs();
        }

        const keyword = (document.getElementById('cashier-room-search')?.value || '').trim().toLowerCase();
        const rooms = cashierRoomsCache.filter(room => {
            const matchType = cashierActiveType === 'all' || String(room.typeId || '') === String(cashierActiveType);
            const matchArea = cashierActiveArea === 'all' || String(room.areaId || '') === String(cashierActiveArea);
            const text = `${room.name || ''} ${room.id || ''}`.toLowerCase();
            return matchType && matchArea && (!keyword || text.includes(keyword));
        });
        const selectedExists = rooms.some(room => String(getRoomKey(room)) === String(cashierSelectedRoomId));
        if ((!cashierSelectedRoomId || !selectedExists) && rooms.length > 0) {
            cashierSelectedRoomId = getRoomKey(rooms[0]);
            const roomInput = document.getElementById('cashier-room-id');
            if (roomInput) roomInput.value = cashierSelectedRoomId;
        }

        container.innerHTML = rooms.map(renderCashierRoomCard).join('') || '<div class="text-gray-500 col-span-full text-center py-10">暂无房间</div>';
        renderCashierRoomStatusBar();
        if (cashierSelectedRoomId) renderCashierRoomDetails(cashierSelectedRoomId);
        refreshCashierUsingRoomTimes(rooms);
    } catch (error) {
        container.innerHTML = '<div class="text-red-400 col-span-full">加载房间失败</div>';
        console.error('加载收银房间失败:', error);
    }
}

function renderCashierRoomTabs() {
    const box = document.getElementById('cashier-room-type-tabs');
    if (!box) return;
    box.innerHTML = `<button class="px-5 py-2 ${cashierActiveType === 'all' ? 'bg-sky-500 text-white border-sky-300/70' : 'bg-slate-800 text-slate-300 border-slate-600'} text-sm font-bold rounded-xl border shadow-sm hover:bg-sky-500 hover:text-white transition whitespace-nowrap" onclick="setCashierRoomType('all')">全部类型</button>` +
        cashierRoomTypes.map(type => `<button class="px-5 py-2 ${String(cashierActiveType) === String(type.id) ? 'bg-sky-500 text-white border-sky-300/70' : 'bg-slate-800 text-slate-300 border-slate-600'} text-sm font-bold rounded-xl border shadow-sm hover:bg-sky-500 hover:text-white transition whitespace-nowrap" onclick="setCashierRoomType('${escapeHtml(type.id)}')">${escapeHtml(type.name)}</button>`).join('');
}

async function loadCashierServiceCalls() {
    try {
        const [callsResp, serviceTypesResp] = await Promise.all([
            cashierRequest('/admin/service-calls').catch(() => ({ data: [] })),
            cashierRequest('/admin/service-types').catch(() => ({ data: [] }))
        ]);
        cashierServiceCallsCache = callsResp.data || [];
        cashierServiceTypesCache = {};
        (serviceTypesResp.data || []).forEach(type => {
            cashierServiceTypesCache[type.id] = type;
        });
    } catch (_) {
        cashierServiceCallsCache = [];
    }
}

function getCashierRoomServiceCalls(roomId) {
    return cashierServiceCallsCache.filter(call => String(call.roomId) === String(roomId));
}

function getCashierServiceTypeLabel(callType) {
    return cashierServiceTypesCache[callType]?.name || callType || '服务';
}

function addCashierServiceCall(call) {
    if (!call?.id) return;
    cashierServiceCallsCache = cashierServiceCallsCache.filter(item => item.id !== call.id);
    cashierServiceCallsCache.unshift(call);
    loadCashierRooms(false);
    showToast(`${call.roomName || call.roomId || '房间'} 呼叫服务：${getCashierServiceTypeLabel(call.callType)}`);
}

function removeCashierServiceCall(call) {
    if (!call?.id) return;
    cashierServiceCallsCache = cashierServiceCallsCache.filter(item => item.id !== call.id);
    loadCashierRooms(false);
}

async function completeCashierServiceCall(callId) {
    try {
        await cashierRequest(`/admin/service-calls/${encodeURIComponent(callId)}/complete`, { method: 'PUT' });
        removeCashierServiceCall({ id: callId });
        showToast('已标记完成');
    } catch (error) {
        showToast(error.message || '操作失败');
    }
}

function renderCashierAreaTabs() {
    const box = document.getElementById('cashier-room-area-tabs');
    if (!box) return;
    box.innerHTML = `<button class="w-20 py-4 text-xs text-center ${cashierActiveArea === 'all' ? 'bg-sky-500 text-white border-sky-300/60 shadow-lg shadow-sky-900/30' : 'bg-slate-800 text-slate-300 border-slate-600'} border rounded-xl hover:bg-sky-500 hover:text-white transition" onclick="setCashierRoomArea('all')">全部<br>区域</button>` +
        cashierRoomAreas.map(area => `<button class="w-20 py-4 text-xs text-center ${String(cashierActiveArea) === String(area.id) ? 'bg-sky-500 text-white border-sky-300/60 shadow-lg shadow-sky-900/30' : 'bg-slate-800 text-slate-300 border-slate-600'} border rounded-xl hover:bg-sky-500 hover:text-white transition" onclick="setCashierRoomArea('${escapeHtml(area.id)}')">${escapeHtml(area.name)}</button>`).join('');
}

function setCashierRoomType(typeId) {
    cashierActiveType = typeId;
    loadCashierRooms(false);
}

function setCashierRoomArea(areaId) {
    cashierActiveArea = areaId;
    loadCashierRooms(false);
}

function renderCashierRoomCard(room) {
    const roomId = room.id || '';
    const id = escapeHtml(roomId);
    const selected = cashierSelectedRoomId === roomId;
    const state = getCashierRoomState(room);
    const meta = getCashierRoomStateMeta(state);
    const reservation = getActiveReservationForRoom(roomId);
    let borderClass = meta.border;
    if (selected) borderClass = 'border-2 border-orange-300 shadow-[0_0_0_2px_rgba(251,146,60,0.18),0_12px_24px_rgba(0,0,0,0.28)] scale-[1.01] z-10';
    const typeName = cashierRoomTypes.find(t => String(t.id) === String(room.typeId))?.name || '';
    const bill = cashierActiveBillsCache[roomId] || {};
    const serviceCalls = getCashierRoomServiceCalls(roomId);
    if (serviceCalls.length > 0) borderClass = `${borderClass} animate-pulse ring-2 ring-green-500/30`;
    const serviceHtml = serviceCalls.length > 0 ? `
        <div class="mx-2 mb-2 rounded-xl border border-green-500/30 bg-[#1A2233]/95 px-2 py-1.5 text-xs text-green-400 shadow-lg shadow-green-950/10">
            ${serviceCalls.map(call => `<div class="flex items-center justify-between gap-2">
                <span class="truncate">🔔 ${escapeHtml(getCashierServiceTypeLabel(call.callType))}${call.callNote ? ` ${escapeHtml(call.callNote)}` : ''}</span>
                <button onclick="event.stopPropagation();completeCashierServiceCall('${escapeHtml(call.id)}')" class="shrink-0 rounded border border-green-500/35 px-1.5 py-0.5 text-[11px] text-green-400 hover:bg-green-500/10">完成</button>
            </div>`).join('')}
        </div>` : '';
    const roomName = escapeHtml(room.name || id);
    const subInfo = `${escapeHtml(typeName || '未设类型')}${room.capacity ? ` (${escapeHtml(room.capacity)})` : ''}`;
    const startText = bill.startTime ? formatCashierDateTime(bill.startTime).slice(11, 16) : '';
    const extraHtml = reservation ? `
        <div class="truncate">预订：${escapeHtml(reservation.customer_name || '-')}</div>
        <div class="truncate">${escapeHtml(formatCashierDateTime(reservation.reservation_time) || '-')}</div>
        <div class="truncate">${escapeHtml(reservation.marketer_name || '无营销经理')}</div>` : state === 'using' ? `
        <div class="truncate font-bold">开房时间：${escapeHtml(startText || '--:--')}</div>` : `
        <div class="truncate">${state === 'idle' ? '可开房 / 可预订' : state === 'maintenance' ? '维护中 / 可转空闲' : '测试中 / 可转空闲'}</div>
        <div class="truncate opacity-80">${escapeHtml(typeName || '未设置房型')}</div>`;
    return `<div id="cashier-room-card-${id}" class="cashier-room-card min-h-[104px] bg-gradient-to-br ${meta.panel} rounded-xl overflow-hidden cursor-pointer hover:-translate-y-0.5 hover:shadow-2xl transition-all border ${borderClass} flex flex-col relative group select-none shadow-lg" onclick="selectCashierRoom('${id}')" oncontextmenu="showCashierRoomContextMenu(event, '${id}')">
        <div class="cashier-room-card-head px-2.5 pt-2 flex items-center justify-between gap-2">
            <div class="cashier-room-card-name text-xl font-black tracking-wide leading-none truncate">${roomName}</div>
            <div class="cashier-room-card-badge ${meta.badge} rounded-full px-2 py-0.5 text-[11px] font-bold shrink-0">${meta.text}</div>
        </div>
        <div class="cashier-room-card-sub px-2.5 mt-1.5 flex items-center justify-between text-xs font-semibold opacity-95">
            <span class="truncate">${subInfo}</span>
            <span class="opacity-80">${escapeHtml(cashierRoomAreas.find(a => String(a.id) === String(room.areaId))?.name || '')}</span>
        </div>
        <div id="cashier-room-extra-${id}" class="cashier-room-card-extra px-2.5 py-1.5 mt-auto text-xs leading-4 font-medium min-h-[42px]">${extraHtml}</div>
        ${serviceHtml}
        ${selected ? '<div class="absolute inset-1.5 rounded-xl pointer-events-none border border-white/45"></div>' : ''}
    </div>`;
}

function selectCashierRoom(roomId) {
    cashierSelectedRoomId = roomId;
    document.getElementById('cashier-room-id').value = roomId;
    loadCashierRooms(false);
    renderCashierRoomDetails(roomId);
}

function deselectCashierRoom(event) {
    if (event.target.id === 'cashier-rooms-container' || event.target.id === 'cashier-rooms') {
        renderCashierRoomStatusBar();
    }
}

function renderCashierRoomStatusBar() {
    const totalEl = document.getElementById('cashier-stat-total');
    if (!totalEl) return;
    const stats = { idle: 0, using: 0, reserved: 0, maintenance: 0, test: 0 };
    cashierRoomsCache.forEach(room => {
        const state = getCashierRoomState(room);
        if (stats[state] !== undefined) stats[state] += 1;
    });
    totalEl.textContent = cashierRoomsCache.length;
    document.getElementById('cashier-stat-idle').textContent = stats.idle;
    document.getElementById('cashier-stat-using').textContent = stats.using;
    document.getElementById('cashier-stat-reserved').textContent = stats.reserved;
    document.getElementById('cashier-stat-maintenance').textContent = stats.maintenance;
    document.getElementById('cashier-stat-test').textContent = stats.test;
    renderCashierRoomClock();
    startCashierRoomClock();
}

function renderCashierRoomClock() {
    const selectedEl = document.getElementById('cashier-stat-selected');
    if (!selectedEl) return;
    const now = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    selectedEl.textContent = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 星期${week} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

function startCashierRoomClock() {
    if (cashierRoomClockTimer) return;
    cashierRoomClockTimer = setInterval(renderCashierRoomClock, 1000);
}

async function renderCashierRoomDetails(roomId) {
    const panel = document.getElementById('cashier-room-details-panel');
    const content = document.getElementById('cashier-room-details-content');
    const room = cashierRoomsCache.find(r => String(r.id) === String(roomId));
    if (!panel || !content || !room) return;
    const typeName = cashierRoomTypes.find(t => String(t.id) === String(room.typeId))?.name || '未设置类型';
    const areaName = cashierRoomAreas.find(a => String(a.id) === String(room.areaId))?.name || '未设置区域';
    const state = getCashierRoomState(room);
    const meta = getCashierRoomStateMeta(state);
    const reservation = getActiveReservationForRoom(roomId);
    const serviceCalls = getCashierRoomServiceCalls(roomId);
    const servicePanelHtml = serviceCalls.length > 0 ? `<div class="rounded border border-green-500/30 bg-[#1A2233]/80 p-2 space-y-1">
        ${serviceCalls.map(call => `<div class="flex items-center justify-between gap-2">
            <span class="text-green-400">🔔 ${escapeHtml(getCashierServiceTypeLabel(call.callType))}${call.callNote ? ` ${escapeHtml(call.callNote)}` : ''}</span>
            <button onclick="completeCashierServiceCall('${escapeHtml(call.id)}')" class="rounded border border-green-500/35 px-2 py-1 text-xs text-green-400 hover:bg-green-500/10">完成</button>
        </div>`).join('')}
    </div>` : '';
    const badgeClass = state === 'using' ? 'bg-red-900/60 text-red-300 border border-red-700/60' : state === 'idle' ? 'bg-blue-900/60 text-blue-300 border border-blue-700/60' : state === 'reserved' ? 'bg-purple-900/60 text-purple-300 border border-purple-700/60' : state === 'test' ? 'bg-cyan-900/60 text-cyan-300 border border-cyan-700/60' : 'bg-yellow-900/60 text-yellow-300 border border-yellow-700/60';
    content.innerHTML = `
        <div class="flex border-b border-gray-700 bg-gray-800 sticky top-0 z-10 flex-shrink-0">
            <button class="flex-1 py-3 text-sm font-bold text-white border-b-2 border-blue-500">
                包厢详情
            </button>
            <button onclick="openCheckoutPage()" class="flex-1 py-3 text-sm font-bold text-gray-400 border-b-2 border-transparent hover:text-white">
                点单结账
            </button>
        </div>
        <div class="p-4 flex-1 flex flex-col min-h-0 overflow-hidden">
            <div class="flex items-center justify-between gap-3 mb-3 rounded-lg bg-gray-900/35 px-3 py-2 flex-shrink-0">
                <div class="min-w-0 text-2xl font-extrabold text-white tracking-wide truncate">${escapeHtml(room.name || roomId)}</div>
                <div class="${badgeClass} shrink-0 px-2.5 py-1 rounded-md text-xs font-bold">${meta.text}</div>
            </div>
            <div class="flex-1 flex flex-col min-h-0 text-base text-gray-300 overflow-hidden">
                    <div class="space-y-3 flex-shrink-0">
                    <div class="flex justify-between border-b border-gray-700 pb-2"><span class="text-gray-300">区域</span><span class="text-white font-bold">${escapeHtml(areaName)}</span></div>
                    <div class="flex justify-between border-b border-gray-700 pb-2"><span class="text-gray-300">类型</span><span class="text-white font-bold">${escapeHtml(typeName)}</span></div>
                    ${servicePanelHtml}
                    ${reservation ? `<div class="rounded border border-purple-800/60 bg-purple-900/20 p-2 space-y-1">
                        <div class="flex justify-between"><span>预定人</span><span class="text-purple-200">${escapeHtml(reservation.customer_name || '-')}</span></div>
                        <div class="flex justify-between"><span>联系电话</span><span class="text-purple-200">${escapeHtml(reservation.phone || '-')}</span></div>
                        <div class="flex justify-between"><span>营销经理</span><span class="text-purple-200">${escapeHtml(reservation.marketer_name || '-')}</span></div>
                        <div class="flex justify-between"><span>预定时间</span><span class="text-purple-200">${escapeHtml(formatCashierDateTime(reservation.reservation_time))}</span></div>
                        <div class="flex justify-between"><span>人数/预付</span><span class="text-purple-200">${reservation.people || 1}人 / ${formatMoney(reservation.prepay || 0)}</span></div>
                        ${reservation.remark ? `<div class="text-xs text-gray-400">备注：${escapeHtml(reservation.remark)}</div>` : ''}
                    </div>` : ''}
                    <div class="mt-5 pt-1">
                        <div class="text-sm text-gray-500 mb-2 flex items-center justify-between">
                            <div><span class="text-gray-200">房间计费</span> <span id="cashier-room-rule-inline" class="ml-2 text-[11px] text-blue-300"></span></div>
                            <button onclick="loadRoomBill()" class="text-blue-400 hover:text-white px-1 text-sm">刷新</button>
                        </div>
                        <div id="cashier-room-order-info" class="text-emerald-400 font-bold text-2xl truncate mb-2">
                            正在加载账单...
                        </div>
                        <div id="cashier-room-bill-meta" class="space-y-1 text-sm text-gray-300 mb-4">
                            <div>开始时间：-</div>
                            <div>结束时间：-</div>
                            <div>消费时长：-</div>
                            <div>计费类型：-</div>
                            <div>预定人：-</div>
                            <div>销售经理：-</div>
                            <div>顾客类型：-</div>
                        </div>
                    </div>
                </div>
                <div class="mt-3 pt-3 border-t border-gray-700 flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div class="flex items-center justify-between mb-2 flex-shrink-0">
                        <div class="text-sm font-bold text-gray-100">点单信息</div>
                        <button onclick="openCashierOrderDetailDialog()" class="text-xs text-blue-300 hover:text-white px-1">详情</button>
                    </div>
                    <div class="grid grid-cols-[2.3rem_minmax(3.5rem,1fr)_2.8rem_2.8rem_2.8rem] gap-1 text-[11px] font-semibold text-gray-200 mb-2 items-center w-full">
                        <div class="text-center">时间</div><div>名称</div><div class="text-center">数量</div><div class="text-right">合计</div><div class="text-center">备注</div>
                    </div>
                    <div id="cashier-order-list-${roomId}" class="cashier-scrollbar-hidden space-y-1 flex-1 min-h-0 overflow-y-auto overflow-x-hidden text-xs text-gray-200"></div>
                </div>
            </div>
        </div>
        <div id="cashier-room-total-bar" class="border-t border-gray-700 bg-gray-800 px-5 py-4 text-lg text-gray-200">
            <span class="text-white font-bold">总计：</span><span class="text-emerald-400 font-extrabold ml-2">¥0.00</span>
        </div>`;
    if (state === 'using') await loadRoomBill();
    else renderBillingSession(null);
}

function renderBillingSession(session) {
    const detail = document.getElementById('cashier-room-order-info') || document.getElementById('cashier-bill-detail');
    if (!detail) return;
    const listEl = cashierSelectedRoomId ? document.getElementById(`cashier-order-list-${cashierSelectedRoomId}`) : null;
    const ruleEl = document.getElementById('cashier-room-rule-inline');
    const metaEl = document.getElementById('cashier-room-bill-meta');
    const totalEl = document.getElementById('cashier-room-total-bar');
    if (!session) {
        cashierCurrentBillingSession = null;
        detail.innerHTML = '<span class="text-gray-500">暂无计费</span>';
        if (ruleEl) ruleEl.textContent = '';
        if (metaEl) metaEl.innerHTML = '<div>开始时间：-</div><div>结束时间：-</div><div>消费时长：-</div><div>计费类型：-</div><div>预定人：-</div><div>销售经理：-</div><div>顾客类型：-</div>';
        if (listEl) listEl.innerHTML = '';
        if (totalEl) totalEl.innerHTML = '<span class="text-white font-bold">总计：</span><span class="text-emerald-400 font-extrabold ml-2">¥0.00</span>';
        return;
    }
    cashierCurrentBillingSession = session;
    detail.innerHTML = `<div class="flex items-baseline truncate"><span class="text-emerald-400 font-extrabold">${formatMoney(session.roomAmount)}</span></div>`;
    if (ruleEl) ruleEl.textContent = session.billingRuleLabel ? `规则：${session.billingRuleLabel}` : '';
    const billingModeName = { minute: '计时', buyout: '买断', activity: '活动', member: '会员' }[session.billingMode] || session.billingMode || '-';
    const activeEndTime = session.endTime || getBillingSessionExpectedEndTime(session) || new Date().toISOString();
    const durationText = formatCashierDuration(session.startTime, activeEndTime);
    if (metaEl) metaEl.innerHTML = `
        <div class="grid grid-cols-[5em_1fr]"><span>开始时间：</span><span>${escapeHtml(formatCashierDateTime(session.startTime) || '-')}</span></div>
        <div class="grid grid-cols-[5em_1fr]"><span>结束时间：</span><span>${escapeHtml(formatCashierDateTime(activeEndTime) || '-')}</span></div>
        <div class="grid grid-cols-[5em_1fr]"><span>消费时长：</span><span>${escapeHtml(durationText)}</span></div>
        <div class="grid grid-cols-[5em_1fr]"><span>计费类型：</span><span>${escapeHtml(billingModeName)}</span></div>
        <div class="grid grid-cols-[5em_1fr]"><span>预定人：</span><span>${escapeHtml(currentEmployee?.name || currentEmployee?.employeeNo || '-')}</span></div>
        <div class="grid grid-cols-[5em_1fr]"><span>销售经理：</span><span>-</span></div>
        <div class="grid grid-cols-[5em_1fr]"><span>顾客类型：</span><span>${session.billingMode === 'member' ? '会员' : '散客'}</span></div>`;
    if (listEl) {
        const items = Array.isArray(session.order_items) ? session.order_items : [];
        const paidOrderIds = new Set(items
            .filter(item => Number(item.amount || 0) > 0 || Number(item.price || 0) > 0)
            .map(item => item.orderId)
            .filter(Boolean));
        const orderedItems = [...items].sort((a, b) => {
            if (a.orderId !== b.orderId) return 0;
            const aPaid = Number(a.amount || 0) > 0 || Number(a.price || 0) > 0;
            const bPaid = Number(b.amount || 0) > 0 || Number(b.price || 0) > 0;
            if (aPaid === bPaid) return 0;
            return aPaid ? -1 : 1;
        });
        listEl.innerHTML = orderedItems.length ? orderedItems.map(item => {
            const isDelivery = paidOrderIds.has(item.orderId) && Number(item.amount || 0) <= 0 && Number(item.price || 0) <= 0;
            const isGift = Number(item.amount || 0) <= 0 && Number(item.price || 0) <= 0;
            const isPackageMain = paidOrderIds.has(item.orderId) && !isDelivery;
            return `
            <div class="grid grid-cols-[2.3rem_minmax(3.5rem,1fr)_2.8rem_2.8rem_2.8rem] gap-1 items-center w-full">
                <div class="text-center truncate">${escapeHtml(formatCashierDateTime(item.order_time).slice(11) || '-')}</div>
                <div class="min-w-0">
                    <div class="truncate ${isPackageMain ? 'text-amber-300 font-bold' : ''}">${escapeHtml(item.productName || '-')}</div>
                </div>
                <div class="text-center truncate">${Number(item.quantity || 0)}${escapeHtml(item.unit || '份')}</div>
                <div class="text-right">${formatMoney(item.amount || 0)}</div>
                <div class="text-center ${isDelivery || isGift || isPackageMain ? 'text-amber-300 font-bold' : ''}">${isDelivery ? '配送' : isPackageMain ? '套餐' : isGift ? '赠送' : '-'}</div>
            </div>`;
        }).join('') : '';
    }
    if (totalEl) totalEl.innerHTML = `
        <div class="space-y-1">
            <div class="flex justify-between text-sm font-bold"><span>房费</span><span>${formatMoney(session.roomAmount)}</span></div>
            <div class="flex justify-between text-sm font-bold"><span>点单</span><span>${formatMoney(session.beverageAmount)}</span></div>
            ${Number(session.prepayAmount || 0) > 0 ? `<div class="flex justify-between text-sm font-bold"><span>预收</span><span>${formatMoney(session.prepayAmount)}</span></div>` : ''}
            <div class="flex justify-between items-baseline pt-2"><span class="text-white font-bold">总计：</span><span class="text-emerald-400 font-extrabold text-2xl">${formatMoney((session.roomAmount || 0) + (session.beverageAmount || 0))}</span></div>
        </div>`;
}

function getCashierOrderedBillItems(session) {
    const items = Array.isArray(session?.order_items) ? session.order_items : [];
    const paidOrderIds = new Set(items
        .filter(item => Number(item.amount || 0) > 0 || Number(item.price || 0) > 0)
        .map(item => item.orderId)
        .filter(Boolean));
    return [...items].sort((a, b) => {
        if (a.orderId !== b.orderId) return 0;
        const aPaid = Number(a.amount || 0) > 0 || Number(a.price || 0) > 0;
        const bPaid = Number(b.amount || 0) > 0 || Number(b.price || 0) > 0;
        if (aPaid === bPaid) return 0;
        return aPaid ? -1 : 1;
    }).map(item => {
        const isDelivery = paidOrderIds.has(item.orderId) && Number(item.amount || 0) <= 0 && Number(item.price || 0) <= 0;
        const isGift = Number(item.amount || 0) <= 0 && Number(item.price || 0) <= 0;
        const isPackageMain = paidOrderIds.has(item.orderId) && !isDelivery;
        return {
            ...item,
            cashierRemark: isDelivery ? '配送' : isPackageMain ? '套餐' : isGift ? '赠送' : '-',
            cashierHighlight: isDelivery || isGift || isPackageMain
        };
    });
}

async function openCashierOrderDetailDialog() {
    if (!cashierCurrentBillingSession) return showToast('暂无点单信息');
    const items = getCashierOrderedBillItems(cashierCurrentBillingSession);
    const html = `
        <div class="p-5">
            <div class="bg-gray-900/70 rounded-lg border border-gray-700 overflow-hidden">
                <div class="grid grid-cols-[4rem_minmax(8rem,1fr)_4rem_4rem_6rem_6rem_5rem] gap-3 px-4 py-3 text-sm font-bold text-gray-300 border-b border-gray-700">
                    <div>时间</div><div>名称</div><div class="text-center">数量</div><div class="text-center">单位</div><div class="text-right">单价</div><div class="text-right">合计</div><div class="text-center">备注</div>
                </div>
                <div class="max-h-[60vh] overflow-y-auto divide-y divide-gray-800">
                    ${items.length ? items.map(item => `
                        <div class="grid grid-cols-[4rem_minmax(8rem,1fr)_4rem_4rem_6rem_6rem_5rem] gap-3 px-4 py-3 text-sm text-gray-100 items-center">
                            <div class="truncate">${escapeHtml(formatCashierDateTime(item.order_time).slice(11) || '-')}</div>
                            <div class="truncate ${item.cashierRemark === '套餐' ? 'text-amber-300 font-bold' : ''}">${escapeHtml(item.productName || '-')}</div>
                            <div class="text-center">x${Number(item.quantity || 0)}</div>
                            <div class="text-center">${escapeHtml(item.unit || '份')}</div>
                            <div class="text-right">${formatMoney(item.price || 0)}</div>
                            <div class="text-right font-bold ${Number(item.amount || 0) > 0 ? 'text-amber-300' : 'text-gray-300'}">${formatMoney(item.amount || 0)}</div>
                            <div class="text-center ${item.cashierHighlight ? 'text-amber-300 font-bold' : 'text-gray-400'}">${escapeHtml(item.cashierRemark)}</div>
                        </div>
                    `).join('') : '<div class="p-6 text-center text-gray-500">暂无点单信息</div>'}
                </div>
            </div>
        </div>`;
    await cashierDialog({ title: '点单明细', html, wide: true });
}

function showCashierRoomContextMenu(event, roomId) {
    event.preventDefault();
    event.stopPropagation();
    cashierContextRoomId = roomId;
    selectCashierRoom(roomId);
    const menu = document.getElementById('cashier-room-context-menu');
    if (!menu) return;
    renderCashierContextActions(roomId);
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.classList.remove('hidden');
}

async function handleCashierContextAction(action) {
    const menu = document.getElementById('cashier-room-context-menu');
    if (menu) menu.classList.add('hidden');
    if (!cashierContextRoomId) return;
    selectCashierRoom(cashierContextRoomId);
    if (action === 'open') return openOpenRoomPage();
    if (action === 'reserve') return openReservationForRoom(cashierContextRoomId);
    if (action === 'cancel_reserve') return cancelRoomReservation(cashierContextRoomId);
    if (action === 'maintenance') return setCashierRoomLocalState(cashierContextRoomId, 'maintenance');
    if (action === 'test') return setCashierRoomLocalState(cashierContextRoomId, 'test');
    if (action === 'idle') return setCashierRoomLocalState(cashierContextRoomId, 'idle');
    if (action === 'transfer') return transferCashierRoom();
    if (action === 'order') return openOrderPanel();
    if (action === 'bill') return loadRoomBill();
    if (action === 'pay') return openCheckoutPage();
}

document.addEventListener('click', () => document.getElementById('cashier-room-context-menu')?.classList.add('hidden'));

async function openOrderPanel() {
    const roomId = document.getElementById('cashier-room-id')?.value;
    if (!roomId) return showToast('请先选择房间');
    showCashierSubPage('order');
    const member = getCurrentCashierMember();
    document.getElementById('order-room-title').textContent = member ? `${getSelectedRoomTitle()} / ${member.name}（${member.level}）` : getSelectedRoomTitle();
    orderCart = [];
    await loadOrderPageData();
    renderOrderCart();
}

function showCashierSubPage(page) {
    if (page !== 'checkout') resetCheckoutBill();
    document.querySelectorAll('.cashier-page').forEach(section => section.classList.add('hidden'));
    document.getElementById(`page-${page}`)?.classList.remove('hidden');
}

function backToCashierRooms() {
    if (window.hvideoDesktopReturnToRooms?.()) return;
    showCashierSubPage('cashier');
    loadCashierRooms(true);
}

function getSelectedRoom() {
    const roomId = document.getElementById('cashier-room-id')?.value;
    return cashierRoomsCache.find(r => String(r.id) === String(roomId));
}

function getSelectedRoomTitle() {
    const room = getSelectedRoom();
    const roomId = document.getElementById('cashier-room-id')?.value || '';
    return room ? `${room.name || roomId}` : roomId;
}

function openOpenRoomPage() {
    const roomId = document.getElementById('cashier-room-id')?.value;
    if (!roomId) return showToast('请先选择房间');
    const room = getSelectedRoom();
    const reservation = getActiveReservationForRoom(roomId);
    showCashierSubPage('open-room');
    document.getElementById('open-room-name').textContent = room?.name || roomId;
    document.getElementById('open-room-state').textContent = getCashierRoomStateMeta(getCashierRoomState(room)).text;
    document.getElementById('open-billing-mode').value = 'minute';
    setupOpenTimerOptions();
    document.getElementById('open-timer-hours').value = '0';
    document.getElementById('open-timer-minutes').value = '0';
    document.getElementById('open-timer-reminder').value = '0';
    document.getElementById('open-room-type').textContent = cashierRoomTypes.find(type => String(type.id) === String(room?.typeId))?.name || '-';
    document.getElementById('open-billing-mode').onchange = refreshOpenBillingMode;
    document.getElementById('open-timer-hours').onchange = refreshOpenTimerPreview;
    document.getElementById('open-timer-minutes').onchange = refreshOpenTimerPreview;
    document.getElementById('open-buyout-period').onchange = refreshOpenPricePreview;
    document.getElementById('open-activity-rule').onchange = refreshOpenPricePreview;
    document.getElementById('open-member-no').value = getCurrentCashierMember()?.card_no || '';
    applyOpenMemberNo();
    refreshOpenBillingMode();
    refreshOpenTimePreview();
    setTimeout(refreshOpenTimePreview, 50);
    if (reservation) {
        document.getElementById('open-customer-source').value = '预定';
        document.getElementById('open-marketer-name').value = reservation.marketer_name || '';
        document.getElementById('open-customer-name').value = reservation.customer_name || '';
        document.getElementById('open-customer-phone').value = reservation.phone || '';
        document.getElementById('open-customer-count').value = reservation.people || 1;
        document.getElementById('open-prepay').value = reservation.prepay || 0;
        document.getElementById('open-member-no').value = reservation.member_no || getMemberById(reservation.member_id)?.card_no || '';
        applyOpenMemberNo();
    } else {
        document.getElementById('open-customer-source').value = '散客';
        document.getElementById('open-marketer-name').value = '';
    }
}

function getBillingSessionExpectedEndTime(session) {
    const timerMinutes = Number(session?.timerMinutes || 0);
    if (!timerMinutes || !session?.startTime) return '';
    const start = new Date(session.startTime);
    if (Number.isNaN(start.getTime())) return '';
    return new Date(start.getTime() + timerMinutes * 60000).toISOString();
}

function refreshOpenTimePreview() {
    const now = new Date();
    const currentEl = document.getElementById('open-current-time');
    const endEl = document.getElementById('open-expected-end-time');
    const billingMode = document.getElementById('open-billing-mode')?.value || 'minute';
    const hours = Number(document.getElementById('open-timer-hours')?.value || 0);
    const minutes = Number(document.getElementById('open-timer-minutes')?.value || 0);
    const totalMinutes = billingMode === 'minute' ? hours * 60 + minutes : 0;
    if (currentEl) currentEl.textContent = formatCashierDateTime(now.toISOString()) || '-';
    if (endEl) endEl.textContent = totalMinutes > 0 ? formatCashierDateTime(new Date(now.getTime() + totalMinutes * 60000).toISOString()) : '-';
}

window.refreshOpenTimePreview = refreshOpenTimePreview;

function refreshOpenTimerPreview() {
    refreshOpenTimePreview();
    refreshOpenPricePreview();
}

window.refreshOpenTimerPreview = refreshOpenTimerPreview;

function setupOpenTimerOptions() {
    const hours = document.getElementById('open-timer-hours');
    const minutes = document.getElementById('open-timer-minutes');
    if (hours && !hours.dataset.ready) {
        hours.innerHTML = Array.from({ length: 13 }, (_, i) => `<option value="${i}">${i}小时</option>`).join('');
        hours.dataset.ready = '1';
    }
    if (minutes && !minutes.dataset.ready) {
        minutes.innerHTML = [0, 5, 10, 15, 20, 30, 40, 45, 50].map(item => `<option value="${item}">${item}分钟</option>`).join('');
        minutes.dataset.ready = '1';
    }
}

async function refreshOpenBillingMode() {
    const billingMode = document.getElementById('open-billing-mode')?.value || 'minute';
    const timerRow = document.getElementById('open-timer-row');
    const buyoutRow = document.getElementById('open-buyout-row');
    const activityRow = document.getElementById('open-activity-row');
    if (timerRow) timerRow.classList.toggle('hidden', billingMode !== 'minute');
    if (buyoutRow) buyoutRow.classList.toggle('hidden', billingMode !== 'buyout');
    if (activityRow) activityRow.classList.toggle('hidden', billingMode !== 'activity');
    if (billingMode === 'buyout') await loadOpenBuyoutPeriods();
    if (billingMode === 'activity') await loadOpenActivityRules();
    refreshOpenTimePreview();
    await refreshOpenPricePreview();
}

async function loadOpenBuyoutPeriods() {
    const select = document.getElementById('open-buyout-period');
    const room = getSelectedRoom();
    if (!select) return;
    try {
        const res = await cashierRequest('/admin/billing-settings');
        const settings = {};
        (res.data || []).forEach(item => settings[item.key] = item.value);
        const roomTypeId = room?.typeId;
        const periods = (settings.buyout_periods || []).filter(item => {
            const enabled = item.enabled !== false;
            const itemRoomType = item.room_type_id ?? item.roomTypeId;
            return enabled && (itemRoomType === undefined || itemRoomType === null || itemRoomType === '' || String(itemRoomType) === String(roomTypeId));
        });
        select.innerHTML = periods.length
            ? periods.map((item, index) => `<option value="${index}">${escapeHtml(item.name || `买断${index + 1}`)} - ${Number(item.duration_minutes || 0)}分钟 / ${formatMoney(item.price || 0)}</option>`).join('')
            : '<option value="">该房型暂无买断方案</option>';
    } catch (error) {
        select.innerHTML = '<option value="">买断配置加载失败</option>';
    }
}

async function loadOpenActivityRules() {
    const select = document.getElementById('open-activity-rule');
    const room = getSelectedRoom();
    if (!select) return;
    try {
        const res = await cashierRequest('/admin/billing-settings');
        const settings = {};
        (res.data || []).forEach(item => settings[item.key] = item.value);
        const roomTypeId = room?.typeId;
        const rules = (settings.activity_rules || []).filter(item => {
            const enabled = item.enabled !== false;
            const itemRoomType = item.room_type_id ?? item.roomTypeId;
            return enabled && (itemRoomType === undefined || itemRoomType === null || itemRoomType === '' || String(itemRoomType) === String(roomTypeId));
        });
        select.innerHTML = rules.length
            ? rules.map((item, index) => `<option value="${index}">${escapeHtml(item.name || `活动${index + 1}`)}${item.fixed_price || item.price ? ` - ${formatMoney(item.fixed_price || item.price)}` : item.discount ? ` - ${item.discount}折` : ''}</option>`).join('')
            : '<option value="">该房型暂无活动</option>';
    } catch (error) {
        select.innerHTML = '<option value="">活动配置加载失败</option>';
    }
}

let cashierOpenSubmitting = false;
async function submitOpenRoomPage() {
    if (cashierOpenSubmitting) return;
    const roomId = document.getElementById('cashier-room-id')?.value;
    const memberNo = document.getElementById('open-member-no')?.value.trim() || '';
    const phone = document.getElementById('open-customer-phone')?.value.trim() || '';
    if (!validateExistingMemberNo(memberNo)) return;
    if (!isValidMainlandMobile(phone)) return showToast('请输入正确的 11 位手机号');
    const activeReservation = roomId ? getActiveReservationForRoom(roomId) : null;
    cashierOpenSubmitting = true;
    const buttons = [...document.querySelectorAll('#page-open-room button[onclick="submitOpenRoomPage()"], #page-open-room button[onclick="backToCashierRooms()"]')];
    buttons.forEach(button => button.disabled = true);
    try {
        if (roomId) delete cashierActiveBillsCache[roomId];
        if (!await openBillingSession()) return;
        if (activeReservation) {
            try {
                await cashierRequest(`/admin/reservations/${encodeURIComponent(activeReservation.id)}/opened`, { method: 'POST' });
                await refreshCustomerData();
            } catch (error) { showToast(`房间已开，预定状态更新失败：${error.message}`); }
        }
        backToCashierRooms();
    } finally {
        cashierOpenSubmitting = false;
        buttons.forEach(button => button.disabled = false);
    }
}

async function loadOrderPageData() {
    const [productsResp, categoriesResp, settingsResp] = await Promise.all([
        cashierRequest('/products'),
        cashierRequest('/products/categories').catch(() => ({ data: [] })),
        cashierRequest('/admin/billing-settings').catch(() => ({ data: [] }))
    ]);
    cashierProductsCache = productsResp.data || [];
    cashierCategoriesCache = categoriesResp.data || [];
    const settings = {};
    (settingsResp.data || []).forEach(item => settings[item.key] = item.value);
    cashierPackageConfigsCache = Array.isArray(settings.package_configs) ? settings.package_configs : [];
    orderActiveCategory = cashierPackageConfigsCache.some(item => item.enabled !== false) ? 'packages' : 'all';
    renderOrderCategories();
    renderOrderProducts();
}

function renderOrderCategories() {
    const box = document.getElementById('order-category-tabs');
    if (!box) return;
    const packageTab = cashierPackageConfigsCache.some(item => item.enabled !== false)
        ? `<button onclick="setOrderCategory('packages')" class="${orderActiveCategory === 'packages' ? 'text-yellow-700 font-bold' : 'text-gray-600'} whitespace-nowrap">套餐</button>`
        : '';
    box.innerHTML = packageTab + `<button onclick="setOrderCategory('all')" class="${orderActiveCategory === 'all' ? 'text-yellow-700 font-bold' : 'text-gray-600'} whitespace-nowrap">全部</button>` +
        cashierCategoriesCache.map(cat => `<button onclick="setOrderCategory('${escapeHtml(cat.id)}')" class="${String(orderActiveCategory) === String(cat.id) ? 'text-yellow-700 font-bold' : 'text-gray-600'} whitespace-nowrap">${escapeHtml(cat.name)}</button>`).join('');
}

function setOrderCategory(categoryId) {
    orderActiveCategory = categoryId;
    renderOrderCategories();
    renderOrderProducts();
}

function renderOrderProducts() {
    const grid = document.getElementById('order-product-grid');
    if (!grid) return;
    if (orderActiveCategory === 'packages') {
        renderOrderPackages(grid);
        return;
    }
    const keyword = (document.getElementById('order-product-search')?.value || '').trim().toLowerCase();
    const products = cashierProductsCache.filter(product => {
        const matchCategory = orderActiveCategory === 'all' || String(product.categoryId) === String(orderActiveCategory);
        const matchKeyword = !keyword || `${product.name || ''} ${product.id || ''}`.toLowerCase().includes(keyword);
        return matchCategory && matchKeyword;
    });
    grid.innerHTML = products.map(product => `<button onclick="addProductToOrder('${escapeHtml(product.id)}')" class="text-left border rounded bg-white hover:shadow p-2 flex gap-2">
        <div class="w-16 h-16 bg-gray-100 rounded overflow-hidden shrink-0">${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" class="w-full h-full object-cover">` : ''}</div>
        <div class="min-w-0">
            <div class="font-semibold truncate">${escapeHtml(product.name)}</div>
            <div class="text-xs text-gray-500">库存 ${product.stock}</div>
            <div class="text-red-500 font-bold">${formatMoney(product.price)}</div>
        </div>
    </button>`).join('');
}

function renderOrderPackages(grid) {
    const room = getSelectedRoom();
    const keyword = (document.getElementById('order-product-search')?.value || '').trim().toLowerCase();
    const packages = cashierPackageConfigsCache.map((item, configIndex) => ({ ...item, configIndex })).filter(item => {
        const enabled = item.enabled !== false;
        const roomTypeId = item.room_type_id ?? '';
        const matchRoomType = !roomTypeId || String(roomTypeId) === String(room?.typeId);
        const matchKeyword = !keyword || `${item.name || ''}`.toLowerCase().includes(keyword);
        return enabled && matchRoomType && matchKeyword;
    });
    grid.innerHTML = packages.map((item, index) => {
        const content = (item.items || []).map(row => {
            const product = cashierProductsCache.find(product => String(product.id) === String(row.product_id));
            return `${escapeHtml(product?.name || row.product_id || '商品')} x${Number(row.quantity || 1)}`;
        }).join('、') || '未配置商品';
        return `<button onclick="addPackageToOrder(${item.configIndex})" class="text-left border rounded bg-amber-50 hover:shadow p-3">
            <div class="font-bold text-amber-900 truncate">${escapeHtml(item.name || `套餐${index + 1}`)}</div>
            <div class="text-red-600 font-bold mt-1">${formatMoney(item.price || 0)}</div>
            <div class="text-xs text-gray-600 mt-2 line-clamp-2">包含：${content}</div>
            <div class="text-xs text-amber-700 mt-2">固定套餐，不可拆改</div>
        </button>`;
    }).join('') || '<div class="text-gray-400 col-span-full text-center py-10">暂无可用套餐</div>';
}

function addProductToOrder(productId) {
    const product = cashierProductsCache.find(item => String(item.id) === String(productId));
    if (!product) return;
    const line = orderCart.find(item => String(item.product_id) === String(productId));
    if (line) line.quantity += 1;
    else orderCart.push({ product_id: product.id, name: product.name, price: Number(product.price || 0), quantity: 1 });
    renderOrderCart();
}

function addPackageToOrder(packageIndex) {
    const room = getSelectedRoom();
    const packageItem = cashierPackageConfigsCache[packageIndex];
    const enabled = packageItem?.enabled !== false;
    const roomTypeId = packageItem?.room_type_id ?? '';
    if (!enabled || (roomTypeId && String(roomTypeId) !== String(room?.typeId))) return showToast('该套餐不适用于当前房间');
    if (!packageItem || !Array.isArray(packageItem.items) || packageItem.items.length === 0) return showToast('套餐未配置包含商品');
    orderCart.push({
        package_name: packageItem.name || '未命名套餐',
        package_price: Number(packageItem.price || 0),
        locked: true,
        items: packageItem.items.map(item => {
            const product = cashierProductsCache.find(product => String(product.id) === String(item.product_id));
            return {
                product_id: item.product_id,
                name: product?.name || item.product_id,
                price: Number(product?.price || 0),
                quantity: Number(item.quantity || 1)
            };
        })
    });
    renderOrderCart();
}

function changeOrderQuantity(productId, delta) {
    const line = orderCart.find(item => String(item.product_id) === String(productId));
    if (!line) return;
    line.quantity += delta;
    if (line.quantity <= 0) orderCart = orderCart.filter(item => String(item.product_id) !== String(productId));
    renderOrderCart();
}

function renderOrderCart() {
    const list = document.getElementById('order-cart-list');
    if (!list) return;
    const total = orderCart.reduce((sum, item) => sum + (item.locked ? item.package_price : item.price * item.quantity), 0);
    const count = orderCart.reduce((sum, item) => sum + (item.locked ? 1 : item.quantity), 0);
    list.innerHTML = orderCart.map((item, index) => {
        if (item.locked) {
            const packageItemsHtml = (item.items || []).map(row => `<div class="flex justify-between gap-2">
                <span class="truncate">${escapeHtml(row.name || row.product_id || '商品')}</span>
                <span class="shrink-0">x${Number(row.quantity || 1)}</span>
            </div>`).join('') || '<div class="text-gray-500">未配置配送商品</div>';
            return `<div class="p-4 bg-amber-50 text-amber-950">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                        <div class="font-bold truncate">${escapeHtml(item.package_name || '套餐')}</div>
                        <div class="mt-2 rounded bg-white/70 border border-amber-200 p-2 text-xs text-amber-800 space-y-1">
                            <div class="font-semibold text-amber-900">配送商品</div>
                            ${packageItemsHtml}
                        </div>
                    </div>
                    <button onclick="removeOrderCartLine(${index})" class="text-gray-500 hover:text-red-600 shrink-0">删除</button>
                </div>
                <div class="mt-3 grid grid-cols-3 text-sm font-bold text-center border-t border-amber-200 pt-2">
                    <span>套餐</span>
                    <span>x1</span>
                    <span class="text-red-600">${formatMoney(item.package_price || 0)}</span>
                </div>
            </div>`;
        }
        return `<div class="p-4">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                    <div class="font-bold truncate">${escapeHtml(item.name)}</div>
                    <div class="text-xs text-gray-400 mt-1">单点商品</div>
                </div>
                <button onclick="changeOrderQuantity('${escapeHtml(item.product_id)}', ${-item.quantity})" class="text-gray-400 hover:text-red-400 shrink-0">删除</button>
            </div>
            <div class="mt-3 grid grid-cols-3 items-center text-sm font-bold">
                <div class="text-gray-300">${formatMoney(item.price || 0)}</div>
                <div class="flex items-center justify-center gap-2">
                    <button onclick="changeOrderQuantity('${escapeHtml(item.product_id)}', -1)" class="w-6 h-6 rounded-full bg-yellow-700 text-white">-</button>
                    <span>${Number(item.quantity || 0)}</span>
                    <button onclick="changeOrderQuantity('${escapeHtml(item.product_id)}', 1)" class="w-6 h-6 rounded-full bg-yellow-700 text-white">+</button>
                </div>
                <div class="text-right text-red-400">${formatMoney(item.price * item.quantity)}</div>
            </div>
        </div>`;
    }).join('');
    document.getElementById('order-cart-count').textContent = count;
    document.getElementById('order-cart-total').textContent = formatMoney(total);
}

function removeOrderCartLine(index) {
    orderCart.splice(index, 1);
    renderOrderCart();
}

async function quickAddOrder() {
    const roomId = document.getElementById('cashier-room-id')?.value;
    if (!roomId) return showToast('请先选择房间');
    if (orderCart.length === 0) return showToast('请先选择商品');
    try {
        const normalItems = orderCart
            .filter(item => !item.locked)
            .map(item => ({ productId: item.product_id, quantity: item.quantity }));
        const packages = orderCart
            .filter(item => item.locked)
            .map(item => ({
                packageName: item.package_name,
                packagePrice: item.package_price,
                items: item.items.map(row => ({ productId: row.product_id, quantity: row.quantity }))
            }));
        await cashierRequest('/orders', {
            method: 'POST',
            body: JSON.stringify({ roomId, items: normalItems, packages })
        });
        showToast('点单已提交');
        orderCart = [];
        renderOrderCart();
        backToCashierRooms();
        await loadRoomBill();
    } catch (error) {
        showToast(error.message || '提交点单失败');
    }
}

async function submitOrderPage() {
    await quickAddOrder();
}

async function openCheckoutPage() {
    const roomId = document.getElementById('cashier-room-id')?.value;
    if (!roomId) return showToast('请先选择房间');
    resetCheckoutBill();
    const generation = checkoutBillGeneration;
    await refreshCustomerData();
    if (generation !== checkoutBillGeneration || roomId !== document.getElementById('cashier-room-id')?.value) return;
    const memberSelect = document.getElementById('checkout-member');
    memberSelect.innerHTML = '<option value="">请选择会员</option>' + membersCache.map(member => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.card_no)} / ${escapeHtml(member.name)} / ${formatMoney(member.balance)}</option>`).join('');
    memberSelect.value = currentCashierMemberId;
    document.getElementById('checkout-received').value = '';
    setCheckoutMethod('cash');
    showCashierSubPage('checkout');
    const member = getCurrentCashierMember();
    document.getElementById('checkout-room-title').textContent = member ? `${getSelectedRoomTitle()} / 会员：${member.name}（${member.level}） 余额 ${formatMoney(member.balance)}` : getSelectedRoomTitle();
    await reloadCheckoutBill();
}

async function reloadCheckoutBill() {
    if (window.cashierCheckoutSubmitting) return;
    const roomId = document.getElementById('cashier-room-id')?.value;
    if (!roomId) return;
    const generation = ++checkoutBillGeneration;
    const current = () => generation === checkoutBillGeneration
        && roomId === document.getElementById('cashier-room-id')?.value
        && !document.getElementById('page-checkout').classList.contains('hidden');
    checkoutBill = null;
    checkoutBillLoading = true;
    checkoutBillError = '';
    renderCheckoutPage(null);
    updateCheckoutAvailability();
    try {
        const res = await cashierRequest(`/billing/room-bill?roomId=${encodeURIComponent(roomId)}`);
        if (!current()) return;
        const session = res.data;
        if (res.code !== 0 || !session?.id || String(session.roomId) !== String(roomId)) {
            throw new Error('账单数据不完整或房间不匹配，请重试');
        }
        if (session.status !== 'active') throw new Error('账单已结清或不可结账，请返回刷新');
        // Checkout owns this snapshot. Room refreshes must not replace its ID.
        checkoutBill = { ...session };
        renderCheckoutPage(checkoutBill);
    } catch (error) {
        if (!current()) return;
        checkoutBill = null;
        checkoutBillError = error.message || '账单查询失败，请重试';
        renderCheckoutPage(null);
        showToast(checkoutBillError);
    } finally {
        if (current()) {
            checkoutBillLoading = false;
            updateCheckoutAvailability();
        }
    }
}

function renderCheckoutPage(session) {
    const payable = Number(session?.payableAmount || 0);
    const beverage = Number(session?.beverageAmount || 0);
    const roomAmount = Number(session?.roomAmount || 0);
    const operatorName = currentEmployee?.name || currentEmployee?.employeeNo || session?.operatorEmployeeId || '-';
    const shiftName = session?.shiftName || currentCashierShift || '-';
    window.currentCheckoutPayable = payable;
    updateCheckoutChange();
    document.getElementById('checkout-payable').textContent = formatMoney(payable);
    document.getElementById('checkout-total-left').textContent = formatMoney(payable);
    document.getElementById('checkout-order-amount').textContent = formatMoney(payable);
    document.getElementById('checkout-beverage-amount').textContent = formatMoney(beverage);
    document.getElementById('checkout-room-amount').textContent = formatMoney(roomAmount);
    document.getElementById('checkout-receivable').textContent = formatMoney(payable);
    document.getElementById('checkout-count').textContent = session ? '共计1单' : '共计0单';
    document.getElementById('checkout-items').innerHTML = session ? `<div class="p-3 space-y-1"><div class="font-semibold">房费/点单合计</div><div class="text-sm text-gray-500">${escapeHtml(session.status)}</div><div class="text-sm text-blue-400">计费规则：${escapeHtml(session.billingRuleLabel || '-')}</div><div class="text-sm text-gray-300">收银员：${escapeHtml(operatorName)}</div><div class="text-sm text-gray-300">班次：${escapeHtml(shiftName)}</div><div class="text-right font-bold">${formatMoney(payable)}</div></div>` : '<div class="p-4 text-gray-500">暂无可结账账单</div>';
}

function setCheckoutMethod(method) {
    checkoutPaymentMethod = method;
    document.getElementById('checkout-cash-fields').classList.toggle('hidden', method !== 'cash');
    document.getElementById('checkout-member-field').classList.toggle('hidden', method !== 'member');
    document.querySelectorAll('[data-payment-method]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.paymentMethod === method)));
    const paySelect = document.getElementById('cashier-pay-method');
    if (paySelect) paySelect.value = method === 'member' ? 'cash' : method;
    showToast(`已选择${method}`);
}

async function submitCheckoutPage() {
    if (window.cashierCheckoutSubmitting) return;
    if (checkoutBillLoading) return showToast('正在查询账单，请稍候');
    const session = checkoutBill;
    if (!session || String(session.roomId) !== document.getElementById('cashier-room-id')?.value) {
        return showToast(checkoutBillError || '账单查询失败，请重试');
    }
    setCheckoutMethod(checkoutPaymentMethod);
    if (checkoutPaymentMethod === 'member' && !currentCashierMemberId) return showToast('请选择会员');
    const received = document.getElementById('checkout-received').value;
    if (checkoutPaymentMethod === 'cash' && received !== '' && (!Number.isFinite(Number(received)) || Number(received) < window.currentCheckoutPayable)) return showToast('实收金额不能少于应收金额');
    window.cashierCheckoutSubmitting = true;
    updateCheckoutAvailability();
    try {
        if (!await payBillingSession(session)) return;
        await refreshCustomerData().catch(error => showToast(error.message));
        backToCashierRooms();
    } finally { window.cashierCheckoutSubmitting = false; updateCheckoutAvailability(); }
}

function updateCheckoutChange() {
    const value = document.getElementById('checkout-received').value;
    const change = value === '' ? 0 : Math.max(0, Number(value) - Number(window.currentCheckoutPayable || 0));
    document.getElementById('checkout-change').textContent = formatMoney(change);
}

function enterCheckoutDigit(digit) {
    if (checkoutPaymentMethod !== 'cash') return;
    const input = document.getElementById('checkout-received');
    if (digit === 'clear') input.value = '';
    else if (digit === 'back') input.value = input.value.slice(0, -1);
    else {
        const candidate = input.value + digit;
        if (/^\d{0,9}(\.\d{0,2})?$/.test(candidate)) input.value = candidate;
    }
    updateCheckoutChange();
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.checkout-key').forEach(button => button.addEventListener('click', () => enterCheckoutDigit(button.dataset.key || button.textContent.trim())));
});
document.addEventListener('keydown', event => {
    if (document.getElementById('page-open-room').classList.contains('hidden') || !['Escape', 'F5'].includes(event.key)) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'F5') event.preventDefault(); // Never refresh away an unfinished form.
    if (event.repeat || cashierOpenSubmitting ||
        !document.getElementById('cashier-dialog').classList.contains('hidden') ||
        document.querySelector('.cashier-select-dropdown, .cashier-control-overlay, .cashier-date-picker')) return;
    event.preventDefault();
    if (event.key === 'Escape') backToCashierRooms();
    else void submitOpenRoomPage();
}, true);

document.addEventListener('keydown', event => {
    if (document.getElementById('page-checkout').classList.contains('hidden') || !document.getElementById('cashier-dialog').classList.contains('hidden') || /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName) || event.repeat) return;
    if (event.code === 'Space') { event.preventDefault(); void submitCheckoutPage(); }
    if (event.key === 'Escape') { event.preventDefault(); backToCashierRooms(); }
});

async function legacyPromptOrderPanel() {
    const roomId = document.getElementById('cashier-room-id')?.value;
    if (!roomId) return showToast('请先选择房间');
    if (cashierProductsCache.length === 0) {
        const res = await cashierRequest('/products');
        cashierProductsCache = res.data || [];
    }
    if (cashierProductsCache.length === 0) return showToast('暂无可点商品');
    const productText = cashierProductsCache.map((p, i) => `${i + 1}. ${p.name} ${formatMoney(p.price)} 库存:${p.stock}`).join('\n');
    const index = Number(await cashierPrompt(`请选择点单商品编号：\n${productText}`, '1', '快速点单')) - 1;
    const product = cashierProductsCache[index];
    if (!product) return;
    const quantity = Number(await cashierPrompt('请输入数量', '1', '快速点单'));
    if (!Number.isFinite(quantity) || quantity <= 0) return showToast('数量必须大于 0');
    try {
        await cashierRequest('/orders', {
            method: 'POST',
            body: JSON.stringify({ roomId, items: [{ productId: product.id, quantity }] })
        });
        showToast('点单已添加');
        cashierProductsCache = [];
        await loadRoomBill();
    } catch (error) {
        showToast(error.message || '点单失败');
    }
}


function getReservations() {
    return reservationsCache;
}

async function refreshCustomerData() {
    const version = ++customerRefreshVersion;
    const [members, reservations] = await Promise.all([
        cashierRequest('/admin/members'), cashierRequest('/admin/reservations')
    ]);
    if (version !== customerRefreshVersion) return;
    membersCache = members.data || [];
    reservationsCache = reservations.data || [];
}

let legacyImportBusy = false;
async function importLegacyCustomers() {
    if (legacyImportBusy) return;
    let members, reservations;
    try {
        members = JSON.parse(localStorage.getItem('cashier_members') || '[]');
        reservations = JSON.parse(localStorage.getItem('cashier_reservations') || '[]');
        if (!Array.isArray(members) || !Array.isArray(reservations)) throw new Error();
    } catch (_) { return showToast('本浏览器旧数据格式错误，未修改原数据'); }
    if (!members.length && !reservations.length) return showToast('本浏览器没有旧数据，请在原先使用的浏览器中打开此页导入');
    if (!await cashierConfirm(`将本浏览器 ${members.length} 条会员、${reservations.length} 条预定导入当前服务器。重复或冲突记录不会覆盖，原本地数据保留。`, '导入旧数据')) return;
    legacyImportBusy = true;
    let imported = 0;
    const failures = [];
    try {
        for (const row of members) {
            const item = { id: row.id, card_no: row.card_no || row.id, name: row.name || '', phone: row.phone || '',
                level: row.level || '普通会员', birthday: row.birthday || '', balance: Number(row.balance || 0),
                points: Number(row.points || 0), remark: row.remark || '', version: 0 };
            try { await cashierRequest('/admin/members', { method: 'POST', body: JSON.stringify(item) }); imported++; }
            catch (error) { failures.push(`会员 ${item.card_no}：${error.message}`); }
        }
        for (const row of reservations) {
            const item = { id: row.id, room_id: row.room_id || '', room_name: row.room_name || '', room_ip: row.room_ip || '',
                reservation_time: String(row.reservation_time || '').slice(0,16), member_id: row.member_id || '', member_no: row.member_no || '',
                marketer_id: row.marketer_id || '', marketer_name: row.marketer_name || '', customer_name: row.customer_name || '',
                phone: row.phone || '', people: Number(row.people || 1), prepay: Number(row.prepay || 0), remark: row.remark || '',
                status: row.status || 'reserved', version: 0 };
            try { await cashierRequest('/admin/reservations', { method: 'POST', body: JSON.stringify(item) }); imported++; }
            catch (error) { failures.push(`预定 ${item.id}：${error.message}`); }
        }
        await refreshCustomerData(); renderMembers(); renderReservations();
        await cashierDialog({ title: '导入结果', message: `成功 ${imported} 条，未导入 ${failures.length} 条。原本地数据保留。\n${failures.join('\n')}` });
    } catch (error) { showToast(error.message); }
    finally { legacyImportBusy = false; }
}

async function loadReservations() {
    if (cashierRoomsCache.length === 0) {
        await loadCashierRooms(true);
    }
    try { await refreshCustomerData(); }
    catch (error) {
        document.getElementById('reservation-table').innerHTML = `<tr><td colspan="9" class="py-8 text-red-400">${escapeHtml(error.message)}</td></tr>`;
        return;
    }
    renderReservationRoomOptions();
    await renderReservationMarketerOptions();
    setupReservationForm();
    if (!document.getElementById('reservation-time')?.value) {
        document.getElementById('reservation-time').value = currentDateTimeLocalValue();
    }
    renderReservations();
}

function renderReservationRoomOptions() {
    const select = document.getElementById('reservation-room-id');
    if (!select) return;
    select.disabled = false;
    select.innerHTML = '<option value="">请选择包厢</option>' + cashierRoomsCache.filter(room => getCashierRoomState(room) === 'idle').map(room => {
        const id = room.id;
        return `<option value="${escapeHtml(id)}">${escapeHtml(room.name || id)}</option>`;
    }).join('');
}

function setupReservationForm() {
    const form = document.getElementById('reservation-form');
    if (!form || form.dataset.bound) return;
    form.addEventListener('submit', saveReservationForm);
    form.dataset.bound = '1';
}

function currentDateTimeLocalValue() {
    const now = new Date();
    now.setSeconds(0, 0);
    const offsetDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return offsetDate.toISOString().slice(0, 16);
}

function isValidMainlandMobile(value) {
    return !value || /^1[3-9]\d{9}$/.test(value);
}

function isValidMemberNo(value) {
    return !value || /^[A-Za-z0-9_-]{3,32}$/.test(value);
}

function validateExistingMemberNo(memberNo) {
    if (!memberNo) return true;
    if (!isValidMemberNo(memberNo)) {
        showToast('会员号只能包含字母、数字、-、_，长度 3-32 位');
        return false;
    }
    if (!getMemberByCardNo(memberNo)) {
        showToast('会员号不存在，请先在会员管理中登记');
        return false;
    }
    return true;
}

function resetReservationForm() {
    editingReservationVersion = 0;
    document.getElementById('reservation-id').value = '';
    document.getElementById('reservation-member-no').value = '';
    document.getElementById('reservation-marketer-id').value = '';
    document.getElementById('reservation-room-id').disabled = false;
    renderReservationRoomOptions();
    document.getElementById('reservation-room-id').value = '';
    document.getElementById('reservation-time').value = currentDateTimeLocalValue();
    document.getElementById('reservation-customer-name').value = '';
    document.getElementById('reservation-phone').value = '';
    document.getElementById('reservation-people').value = '1';
    document.getElementById('reservation-prepay').value = '0';
    document.getElementById('reservation-remark').value = '';
}

async function saveReservationForm(event) {
    event.preventDefault();
    if (event.target.dataset.saving) return;
    const existingId = document.getElementById('reservation-id').value;
    const id = existingId || `res_${customerRecordId()}`;
    const roomId = document.getElementById('reservation-room-id').value;
    const room = cashierRoomsCache.find(item => String(item.id || item.room_ip || item.terminal_id) === String(roomId));
    const editingSameReservation = getReservations().some(item => item.id === id && String(item.room_id) === String(roomId));
    if (room && getCashierRoomState(room) !== 'idle' && !editingSameReservation) return showToast('只有空闲房间可以预定');
    const marketerId = document.getElementById('reservation-marketer-id').value;
    const memberNo = document.getElementById('reservation-member-no').value.trim();
    const phone = document.getElementById('reservation-phone').value.trim();
    if (!validateExistingMemberNo(memberNo)) return;
    if (!isValidMainlandMobile(phone)) return showToast('请输入正确的 11 位手机号');
    const marketer = window.cashierEmployeesCache?.find(item => String(item.id) === String(marketerId));
    const item = {
        id,
        room_id: roomId,
        room_name: room?.name || roomId,
        room_ip: room?.room_ip || room?.terminal_ip || roomId,
        reservation_time: document.getElementById('reservation-time').value,
        member_id: getMemberByCardNo(memberNo)?.id || '',
        member_no: memberNo,
        marketer_id: marketerId,
        marketer_name: marketer?.name || '',
        customer_name: document.getElementById('reservation-customer-name').value.trim(),
        phone,
        people: Number(document.getElementById('reservation-people').value || 1),
        prepay: Number(document.getElementById('reservation-prepay').value || 0),
        remark: document.getElementById('reservation-remark').value.trim(),
        status: 'reserved',
        version: editingReservationVersion
    };
    event.target.dataset.saving = '1';
    try {
        await cashierRequest(existingId ? `/admin/reservations/${encodeURIComponent(id)}` : '/admin/reservations', {
            method: existingId ? 'PUT' : 'POST', body: JSON.stringify(item)
        });
        await refreshCustomerData();
        renderReservations();
        loadCashierRooms(false);
        resetReservationForm();
        showToast('预定已保存到服务器');
    } catch (error) { showToast(error.message || '保存预定失败'); }
    finally { delete event.target.dataset.saving; }
}

function renderReservations() {
    const table = document.getElementById('reservation-table');
    if (!table) return;
    const keyword = (document.getElementById('reservation-search')?.value || '').trim().toLowerCase();
    const rows = getReservations().filter(item => {
        const text = `${item.room_name || ''} ${item.customer_name || ''} ${item.phone || ''}`.toLowerCase();
        return !keyword || text.includes(keyword);
    });
    table.innerHTML = rows.map(item => `<tr class="border-b border-gray-800 text-gray-300">
        <td class="py-2">${escapeHtml(item.room_name)}</td>
        <td class="py-2">${escapeHtml(formatCashierDateTime(item.reservation_time))}</td>
        <td class="py-2">${escapeHtml(item.customer_name)}</td>
        <td class="py-2">${escapeHtml(item.phone || '-')}</td>
        <td class="py-2">${escapeHtml(item.marketer_name || '-')}</td>
        <td class="py-2">${item.people || 1}</td>
        <td class="py-2">${formatMoney(item.prepay)}</td>
        <td class="py-2">${({opened:'已开房',cancelled:'已取消',reserved:'已预定'})[item.status] || '-'}</td>
        <td class="py-2 space-x-1">
            ${item.status === 'reserved' ? `
            <button onclick="editReservation('${escapeHtml(item.id)}')" class="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-xs">编辑</button>
            <button onclick="openReservationRoom('${escapeHtml(item.id)}')" class="bg-green-700 hover:bg-green-600 px-2 py-1 rounded text-xs">转开房</button>
            <button onclick="cancelReservation('${escapeHtml(item.id)}')" class="bg-red-700 hover:bg-red-600 px-2 py-1 rounded text-xs">取消</button>
            ` : ''}
        </td>
    </tr>`).join('') || '<tr><td colspan="9" class="py-8 text-center text-gray-500">暂无预定</td></tr>';
}

function editReservation(id) {
    const item = getReservations().find(row => row.id === id);
    if (!item) return;
    editingReservationVersion = item.version;
    document.getElementById('reservation-id').value = item.id;
    if (![...document.getElementById('reservation-room-id').options].some(option => option.value === item.room_id)) {
        document.getElementById('reservation-room-id').innerHTML += `<option value="${escapeHtml(item.room_id)}">${escapeHtml(item.room_name || item.room_id)}</option>`;
    }
    document.getElementById('reservation-room-id').value = item.room_id;
    document.getElementById('reservation-room-id').disabled = true;
    document.getElementById('reservation-time').value = item.reservation_time || '';
    document.getElementById('reservation-member-no').value = item.member_no || getMemberById(item.member_id)?.card_no || '';
    document.getElementById('reservation-marketer-id').value = item.marketer_id || '';
    document.getElementById('reservation-customer-name').value = item.customer_name || '';
    document.getElementById('reservation-phone').value = item.phone || '';
    document.getElementById('reservation-people').value = item.people || 1;
    document.getElementById('reservation-prepay').value = item.prepay || 0;
    document.getElementById('reservation-remark').value = item.remark || '';
}

async function cancelReservation(id) {
    if (!await cashierConfirm('确认取消该预定？', '取消预定')) return;
    try {
        await cashierRequest(`/admin/reservations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refreshCustomerData();
        renderReservations();
        loadCashierRooms(false);
    } catch (error) { showToast(error.message || '取消失败'); }
}

function openReservationRoom(id) {
    const item = getReservations().find(row => row.id === id);
    if (!item) return;
    cashierSelectedRoomId = item.room_id;
    currentCashierMemberId = item.member_id || '';
    document.getElementById('cashier-room-id').value = item.room_id;
    openOpenRoomPage();
    setTimeout(() => {
        document.getElementById('open-customer-name').value = item.customer_name || '';
        document.getElementById('open-customer-phone').value = item.phone || '';
        document.getElementById('open-customer-count').value = item.people || 1;
        document.getElementById('open-prepay').value = item.prepay || 0;
    }, 0);
}

function getMembers() {
    return membersCache;
}

async function loadMembers() {
    setupMemberForm();
    try { await refreshCustomerData(); renderMembers(); }
    catch (error) { document.getElementById('member-table').innerHTML = `<tr><td colspan="8" class="py-8 text-red-400">${escapeHtml(error.message)}</td></tr>`; }
}

function setupMemberForm() {
    const form = document.getElementById('member-form');
    if (!form || form.dataset.bound) return;
    form.addEventListener('submit', saveMemberForm);
    form.dataset.bound = '1';
}

function resetMemberForm() {
    editingMemberVersion = 0;
    document.getElementById('member-id').value = '';
    document.getElementById('member-card-no').value = `VIP${Date.now().toString().slice(-8)}`;
    document.getElementById('member-name').value = '';
    document.getElementById('member-phone').value = '';
    document.getElementById('member-level').value = '普通会员';
    document.getElementById('member-birthday').value = '';
    document.getElementById('member-balance').value = '0';
    document.getElementById('member-balance').disabled = false;
    document.getElementById('member-points').value = '0';
    document.getElementById('member-points').disabled = false;
    document.getElementById('member-remark').value = '';
}

async function saveMemberForm(event) {
    event.preventDefault();
    if (event.target.dataset.saving) return;
    const existingId = document.getElementById('member-id').value;
    const id = existingId || `mem_${customerRecordId()}`;
    const item = {
        id,
        card_no: document.getElementById('member-card-no').value.trim(),
        name: document.getElementById('member-name').value.trim(),
        phone: document.getElementById('member-phone').value.trim(),
        level: document.getElementById('member-level').value,
        birthday: document.getElementById('member-birthday').value,
        balance: Number(document.getElementById('member-balance').value || 0),
        points: Number(document.getElementById('member-points').value || 0),
        remark: document.getElementById('member-remark').value.trim(),
        version: editingMemberVersion
    };
    const list = getMembers();
    const duplicatedPhone = list.some(row => row.id !== id && row.phone === item.phone);
    if (duplicatedPhone) return showToast('手机号已存在');
    const duplicatedCard = list.some(row => row.id !== id && row.card_no === item.card_no);
    if (duplicatedCard) return showToast('会员卡号已存在');
    event.target.dataset.saving = '1';
    try {
        await cashierRequest(existingId ? `/admin/members/${encodeURIComponent(id)}` : '/admin/members', {
            method: existingId ? 'PUT' : 'POST', body: JSON.stringify(item)
        });
        await refreshCustomerData();
        renderMembers();
        resetMemberForm();
        showToast('会员已保存到服务器');
    } catch (error) { showToast(error.message || '保存会员失败'); }
    finally { delete event.target.dataset.saving; }
}

function renderMembers() {
    const table = document.getElementById('member-table');
    if (!table) return;
    const keyword = (document.getElementById('member-search')?.value || '').trim().toLowerCase();
    const rows = getMembers().filter(item => {
        const text = `${item.card_no || ''} ${item.name || ''} ${item.phone || ''} ${item.level || ''}`.toLowerCase();
        return !keyword || text.includes(keyword);
    });
    table.innerHTML = rows.map(item => `<tr class="border-b border-gray-800 text-gray-300">
        <td class="py-2 text-blue-400 font-mono">${escapeHtml(item.card_no || item.id)}</td>
        <td class="py-2">${escapeHtml(item.name)}<div class="text-xs text-gray-500">${escapeHtml(item.id)}</div></td>
        <td class="py-2">${escapeHtml(item.phone)}</td>
        <td class="py-2"><span class="text-blue-400">${escapeHtml(item.level)}</span></td>
        <td class="py-2 text-green-400">${formatMoney(item.balance)}</td>
        <td class="py-2 text-yellow-400">${Number(item.points || 0)}</td>
        <td class="py-2">${escapeHtml(item.birthday || '-')}</td>
        <td class="py-2 space-x-1">
            <button onclick="editMember('${escapeHtml(item.id)}')" class="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-xs">编辑</button>
            <button onclick="rechargeMember('${escapeHtml(item.id)}')" class="bg-green-700 hover:bg-green-600 px-2 py-1 rounded text-xs">充值</button>
            <button onclick="deductMember('${escapeHtml(item.id)}')" class="bg-orange-700 hover:bg-orange-600 px-2 py-1 rounded text-xs">扣费</button>
            <button onclick="deleteMember('${escapeHtml(item.id)}')" class="bg-red-700 hover:bg-red-600 px-2 py-1 rounded text-xs">删除</button>
        </td>
    </tr>`).join('') || '<tr><td colspan="8" class="py-8 text-center text-gray-500">暂无会员</td></tr>';
}

function editMember(id) {
    const item = getMembers().find(row => row.id === id);
    if (!item) return;
    editingMemberVersion = item.version;
    document.getElementById('member-id').value = item.id;
    document.getElementById('member-card-no').value = item.card_no || item.id;
    document.getElementById('member-name').value = item.name || '';
    document.getElementById('member-phone').value = item.phone || '';
    document.getElementById('member-level').value = item.level || '普通会员';
    document.getElementById('member-birthday').value = item.birthday || '';
    document.getElementById('member-balance').value = item.balance || 0;
    document.getElementById('member-balance').disabled = true;
    document.getElementById('member-points').value = item.points || 0;
    document.getElementById('member-points').disabled = true;
    document.getElementById('member-remark').value = item.remark || '';
}

async function updateMemberAmount(id, balanceDelta, pointsDelta = 0) {
    await cashierRequest(`/admin/members/${encodeURIComponent(id)}/balance`, {
        method: 'POST', body: JSON.stringify({ request_id: customerRecordId(), balance_delta: balanceDelta, points_delta: pointsDelta })
    });
    await refreshCustomerData();
    renderMembers();
}

async function rechargeMember(id) {
    const amount = Number(await cashierPrompt('请输入充值金额', '100', '会员充值'));
    if (!Number.isFinite(amount) || amount <= 0) return;
    try { await updateMemberAmount(id, amount, Math.floor(amount)); showToast('充值完成'); }
    catch (error) { showToast(error.message || '充值失败'); }
}

async function deductMember(id) {
    const amount = Number(await cashierPrompt('请输入扣费金额', '10', '会员扣费'));
    if (!Number.isFinite(amount) || amount <= 0) return;
    try { await updateMemberAmount(id, -amount, 0); showToast('扣费完成'); }
    catch (error) { showToast(error.message || '扣费失败'); }
}

async function deleteMember(id) {
    if (!await cashierConfirm('确认删除该会员？', '删除会员')) return;
    try {
        await cashierRequest(`/admin/members/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refreshCustomerData(); renderMembers();
    } catch (error) { showToast(error.message || '删除失败'); }
}

function renderMemberSelect(selectId, selectedId = '') {
    const select = document.getElementById(selectId);
    if (!select) return;
    const members = getMembers();
    select.innerHTML = '<option value="">散客/不关联</option>' + members.map(member => `<option value="${escapeHtml(member.id)}" ${String(member.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(member.card_no || member.id)} ${escapeHtml(member.name)} ${escapeHtml(member.phone)}（${escapeHtml(member.level)} / ${formatMoney(member.balance)}）</option>`).join('');
}

function getMemberById(id) {
    return getMembers().find(member => String(member.id) === String(id));
}

function getCurrentCashierMember() {
    return getMemberById(currentCashierMemberId);
}

function getMemberServiceText(member) {
    if (!member) return '';
    const level = member.level || '普通会员';
    const policy = {
        '普通会员': '普通会员价，正常服务',
        '银卡会员': '银卡会员价，优先安排服务',
        '金卡会员': '金卡会员价，优先包厢和营销服务',
        'VIP会员': 'VIP会员价，优先服务和专属体验'
    };
    return policy[level] || `${level}服务`;
}

function applyOpenMemberNo() {
    const memberNo = document.getElementById('open-member-no')?.value || '';
    const member = getMemberByCardNo(memberNo);
    currentCashierMemberId = member?.id || '';
    if (!member) {
        document.getElementById('open-customer-type').value = '散客';
        document.getElementById('open-member-service-tip').textContent = '输入会员号后自动匹配会员级别和服务体验';
        refreshOpenPricePreview();
        return;
    }
    document.getElementById('open-customer-type').value = '会员';
    document.getElementById('open-billing-mode').value = 'member';
    document.getElementById('open-customer-name').value = member.name || '';
    document.getElementById('open-customer-phone').value = member.phone || '';
    document.getElementById('open-member-service-tip').textContent = `${member.card_no || ''} / ${member.level || '普通会员'}：${getMemberServiceText(member)}`;
    refreshOpenPricePreview();
}

async function refreshOpenPricePreview() {
    const previewEl = document.getElementById('open-price-preview');
    const ruleEl = document.getElementById('open-price-rule');
    const roomId = document.getElementById('cashier-room-id')?.value;
    const billingMode = document.getElementById('open-billing-mode')?.value || 'minute';
    if (!previewEl || !roomId) return;
    previewEl.textContent = '正在匹配...';
    if (ruleEl) ruleEl.textContent = '';
    try {
        const res = await cashierRequest(`/billing/price-preview?roomId=${encodeURIComponent(roomId)}&billingMode=${encodeURIComponent(billingMode)}`);
        const data = res.data || {};
        previewEl.textContent = `${formatMoney(data.hourly_price)} / 小时`;
        if (ruleEl) ruleEl.textContent = data.description || `${data.rule_label || '-'}，金额 ${formatMoney(data.roomAmount)}`;
    } catch (error) {
        previewEl.textContent = '未匹配到价格';
        if (ruleEl) ruleEl.textContent = error.message || '请检查后台基础设置';
    }
}

function applyReservationMember() {
    const memberId = document.getElementById('reservation-member-id')?.value || '';
    const member = getMemberById(memberId);
    if (!member) return;
    document.getElementById('reservation-customer-name').value = member.name || '';
    document.getElementById('reservation-phone').value = member.phone || '';
}

function renderCashierContextActions(roomId) {
    const box = document.getElementById('cashier-room-context-actions');
    const room = cashierRoomsCache.find(r => String(getRoomKey(r)) === String(roomId));
    if (!box || !room) return;
    const state = getCashierRoomState(room);
    const item = (action, label, cls) => `<a href="#" class="block px-4 py-2 text-gray-200 ${cls}" onclick="handleCashierContextAction('${action}')">${label}</a>`;
    let actions = [];
    if (state === 'idle') actions = [
        item('open', '开房', 'hover:bg-green-600 hover:text-white'),
        ...(employeeCanAccessModule('reservation') ? [item('reserve', '预定', 'hover:bg-purple-600 hover:text-white')] : []),
        item('maintenance', '维护', 'hover:bg-yellow-600 hover:text-white'),
        item('test', '测试', 'hover:bg-cyan-600 hover:text-white')
    ];
    if (state === 'reserved') actions = [
        item('open', '开房', 'hover:bg-green-600 hover:text-white'),
        ...(employeeCanAccessModule('reservation') ? [item('reserve', '查看/修改预定', 'hover:bg-purple-600 hover:text-white'), item('cancel_reserve', '取消预定', 'hover:bg-red-600 hover:text-white')] : [])
    ];
    if (state === 'using') actions = [
        item('order', '点单', 'hover:bg-purple-600 hover:text-white'),
        item('transfer', '转房/换房', 'hover:bg-cyan-600 hover:text-white'),
        item('bill', '查看账单', 'hover:bg-blue-600 hover:text-white'),
        item('pay', '结账', 'hover:bg-red-600 hover:text-white')
    ];
    if (state === 'maintenance' || state === 'test') actions = [
        item('idle', '转为空闲', 'hover:bg-blue-600 hover:text-white')
    ];
    box.innerHTML = actions.join('');
}

function setCashierRoomLocalState(roomId, state) {
    if (state === 'idle') delete cashierRoomLocalStates[roomId];
    else cashierRoomLocalStates[roomId] = state;
    saveCashierRoomLocalStates();
    loadCashierRooms(false);
    renderCashierRoomDetails(roomId);
}

function openReservationForRoom(roomId) {
    if (!employeeCanAccessModule('reservation')) return showToast('当前账号未授权预定管理');
    const room = cashierRoomsCache.find(r => String(getRoomKey(r)) === String(roomId));
    const reservation = getActiveReservationForRoom(roomId);
    if (room && getCashierRoomState(room) !== 'idle' && !reservation) return showToast('只有空闲房间可以预定');
    showPage('reservation');
    setTimeout(() => {
        if (reservation) editReservation(reservation.id);
        else {
            resetReservationForm();
            const select = document.getElementById('reservation-room-id');
            const id = room ? getRoomKey(room) : roomId;
            select.innerHTML = `<option value="${escapeHtml(id)}">${escapeHtml(room?.name || id)}</option>`;
            select.value = id;
            select.disabled = true;
        }
    }, 0);
}

function cancelRoomReservation(roomId) {
    const reservation = getActiveReservationForRoom(roomId);
    if (!reservation) return showToast('该房间没有有效预定');
    cancelReservation(reservation.id);
    loadCashierRooms(false);
}

async function transferCashierRoom() {
    const fromRoomId = document.getElementById('cashier-room-id')?.value;
    const fromRoom = getSelectedRoom();
    if (!fromRoomId || !fromRoom) return showToast('请先选择使用中的房间');
    const targets = cashierRoomsCache.filter(room => getCashierRoomState(room) === 'idle' && String(getRoomKey(room)) !== String(fromRoomId));
    if (targets.length === 0) return showToast('没有可转入的空闲房间');
    const text = targets.map((room, index) => `${index + 1}. ${room.name || getRoomKey(room)}`).join('\n');
    const index = Number(await cashierPrompt(`请选择目标房间：\n${text}`, '1', '转房/换房')) - 1;
    const target = targets[index];
    if (!target) return;
    const targetRoomId = getRoomKey(target);
    try {
        const bill = await cashierRequest(`/billing/room-bill?roomId=${encodeURIComponent(fromRoomId)}`);
        await cashierRequest(`/billing/sessions/${encodeURIComponent(bill.data.id)}/transfer`, {
            method: 'POST',
            body: JSON.stringify({ targetRoomId })
        });
        cashierSelectedRoomId = targetRoomId;
        document.getElementById('cashier-room-id').value = targetRoomId;
        showToast(`已转入${target.name || targetRoomId}`);
        await loadCashierRooms(true);
        await loadRoomBill();
    } catch (error) {
        showToast(error.message || '转房失败');
    }
}

let employeeRolesCache = [];
let employeesCache = [];
let editingEmployeeId = null;
let employeeFormRevision = 0;

async function loadEmployees() {
    const firstLoad = !document.getElementById('employee-form')?.dataset.bound;
    setupEmployeeForm();
    await loadEmployeeRoles();
    if (firstLoad) await resetEmployeeForm();
    await renderEmployees();
}

async function loadEmployeeRoles() {
    const choices = document.getElementById('employee-role');
    if (!choices) return;
    try {
        const res = await cashierRequest('/admin/employee-roles');
        const roleOrder = ['admin', 'cashier', 'marketer', 'warehouse', 'finance', 'consultant', 'production'];
        employeeRolesCache = res.data || [];
        const selectableRoles = employeeRolesCache.filter(role => roleOrder.includes(role.id)).sort((a, b) => roleOrder.indexOf(a.id) - roleOrder.indexOf(b.id));
        const selected = getEmployeeRole();
        choices.innerHTML = selectableRoles.map(role => `<label class="employee-role-option"><input type="radio" name="employee-role" value="${escapeHtml(role.id)}" required><span>${escapeHtml(role.name)}</span></label>`).join('');
        setEmployeeRole(selectableRoles.some(role => role.id === selected) ? selected : 'cashier');
        lockEmployeeAdminRole();
    } catch (error) {
        choices.textContent = '角色加载失败，请刷新';
        showToast(error.message || '加载角色失败');
    }
}

function getEmployeeRole() {
    return document.querySelector('input[name="employee-role"]:checked')?.value || '';
}

function setEmployeeRole(roleId) {
    document.querySelectorAll('input[name="employee-role"]').forEach(input => {
        input.checked = input.value === roleId;
    });
}

function setupEmployeeForm() {
    const form = document.getElementById('employee-form');
    if (!form || form.dataset.bound) return;
    const permissions = document.getElementById('employee-module-permissions');
    if (permissions && !permissions.dataset.ready) {
        permissions.innerHTML = CASHIER_MODULES.map(([id, label]) => `<label class="flex items-center gap-2"><input type="checkbox" name="employee-module" value="${id}" checked class="accent-red-600">${label}</label>`).join('');
        permissions.dataset.ready = '1';
    }
    document.getElementById('employee-table').addEventListener('click', event => {
        const button = event.target.closest('button[data-employee-action]');
        if (!button) return;
        if (button.dataset.employeeAction === 'edit') editEmployee(button.dataset.employeeId);
        if (button.dataset.employeeAction === 'delete') deleteEmployee(button.dataset.employeeId);
    });
    form.addEventListener('submit', saveEmployeeForm);
    form.dataset.bound = '1';
}

function lockEmployeeAdminRole() {
    const admin = employeesCache.find(item => item.id === editingEmployeeId)?.roleId === 'admin';
    document.querySelectorAll('input[name="employee-role"]').forEach(input => {
        input.disabled = admin || (!employeeIsAdmin() && input.value === 'admin');
    });
}

async function resetEmployeeForm(force = false) {
    if (!force && document.getElementById('employee-form').dataset.saving) return;
    editingEmployeeId = null;
    const revision = ++employeeFormRevision;
    document.getElementById('employee-form-title').textContent = '新增人员';
    document.getElementById('employee-no').value = '';
    document.getElementById('employee-name').value = '';
    const password = document.getElementById('employee-password');
    password.value = ''; password.required = true; password.placeholder = '4–8 位数字或字母';
    setEmployeeRole('cashier');
    lockEmployeeAdminRole();
    document.querySelectorAll('input[name="employee-module"]').forEach(input => { input.checked = true; input.disabled = false; });
    try {
        const res = await cashierRequest('/admin/employees/next-number');
        if (revision === employeeFormRevision) document.getElementById('employee-no').value = res.data.employeeNo;
    } catch (error) { showToast(error.message || '工号预览失败，请重试'); }
}

function editEmployee(id) {
    if (document.getElementById('employee-form').dataset.saving) return;
    const item = employeesCache.find(row => row.id === id);
    if (!item) return;
    editingEmployeeId = id; employeeFormRevision++;
    document.getElementById('employee-form-title').textContent = `编辑人员 · ${item.employeeNo}`;
    document.getElementById('employee-no').value = item.employeeNo;
    document.getElementById('employee-name').value = item.name;
    const password = document.getElementById('employee-password');
    password.value = ''; password.required = false; password.placeholder = '留空不修改';
    setEmployeeRole(item.roleId);
    lockEmployeeAdminRole();
    const allowed = employeeModules(item);
    document.querySelectorAll('input[name="employee-module"]').forEach(input => {
        input.checked = item.roleId === 'admin' || allowed.includes(input.value);
        input.disabled = item.roleId === 'admin';
    });
}

async function saveEmployeeForm(event) {
    event.preventDefault();
    const form = document.getElementById('employee-form');
    if (form.dataset.saving) return;
    if (!getEmployeeRole()) return showToast('请先选择角色');
    const password = document.getElementById('employee-password').value;
    if ((!editingEmployeeId || password) && !/^[A-Za-z0-9]{4,8}$/.test(password)) return showToast('密码必须为 4–8 位数字或字母');
    form.dataset.saving = '1';
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
        const payload = {
            name: document.getElementById('employee-name').value.trim(),
            roleId: getEmployeeRole(), password,
            modulePermissions: [...document.querySelectorAll('input[name="employee-module"]:checked')].map(input => input.value)
        };
        if (!editingEmployeeId) payload.employeeNo = '';
        const path = editingEmployeeId ? `/admin/employees/${encodeURIComponent(editingEmployeeId)}` : '/admin/employees';
        const res = await cashierRequest(path, { method: editingEmployeeId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
        showToast(`人员档案已保存，工号 ${res.data.employeeNo}`);
        await renderEmployees();
        await resetEmployeeForm(true);
    } catch (error) {
        showToast(error.message || '保存人员失败');
    } finally {
        delete form.dataset.saving;
        submit.disabled = false;
    }
}

async function deleteEmployee(id) {
    if (document.getElementById('employee-form').dataset.saving) return;
    const item = employeesCache.find(row => row.id === id);
    if (!item || item.roleId === 'admin') return;
    if (!await cashierConfirm(`确认删除员工 ${item.name}（${item.employeeNo}）？`, '删除员工')) return;
    try {
        await cashierRequest(`/admin/employees/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (editingEmployeeId === id) await resetEmployeeForm();
        await renderEmployees();
        showToast('员工已删除');
    } catch (error) { showToast(error.message || '删除员工失败'); }
}

async function renderEmployees() {
    const table = document.getElementById('employee-table');
    if (!table) return;
    try {
        const res = await cashierRequest('/admin/employees');
        employeesCache = res.data || [];
        const roleName = id => employeeRolesCache.find(role => String(role.id) === String(id))?.name || id || '-';
        table.innerHTML = employeesCache.map(item => `<tr class="border-b border-gray-800 text-gray-300">
            <td class="py-2 font-mono text-blue-300">${escapeHtml(item.employeeNo)}</td>
            <td class="py-2 text-white">${escapeHtml(item.name)}</td>
            <td class="py-2">${escapeHtml(roleName(item.roleId))}</td>
            <td class="py-2">${Number(item.enabled) === 1 ? '<span class="text-green-400">启用</span>' : '<span class="text-red-400">禁用</span>'}</td>
            <td class="py-2 text-gray-500">${escapeHtml(item.createdAt || '-')}</td>
            <td class="py-2 whitespace-nowrap">${item.roleId !== 'admin' || employeeIsAdmin() ? `<button type="button" data-employee-action="edit" data-employee-id="${escapeHtml(item.id)}" class="bg-blue-700 px-2 py-1 rounded text-xs">编辑</button>` : ''}
            ${item.roleId === 'admin' ? '<span class="text-xs text-gray-500 ml-2">管理员不可删除</span>' : `<button type="button" data-employee-action="delete" data-employee-id="${escapeHtml(item.id)}" class="bg-red-700 px-2 py-1 rounded text-xs ml-2">删除</button>`}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="py-8 text-center text-gray-500">暂无人员档案</td></tr>';
    } catch (error) {
        table.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-red-400">${escapeHtml(error.message || '加载人员失败')}</td></tr>`;
    }
}

async function renderReservationMarketerOptions() {
    const select = document.getElementById('reservation-marketer-id');
    if (!select) return;
    try {
        const res = await cashierRequest('/admin/employees');
        window.cashierEmployeesCache = res.data || [];
        select.innerHTML = '<option value="">不指定</option>' + window.cashierEmployeesCache.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}（${escapeHtml(item.employeeNo)}）</option>`).join('');
    } catch (error) {
        window.cashierEmployeesCache = [];
        select.innerHTML = '<option value="">不指定</option>';
    }
}

function getMemberByCardNo(cardNo) {
    const value = String(cardNo || '').trim().toLowerCase();
    if (!value) return null;
    return getMembers().find(member => String(member.card_no || '').toLowerCase() === value || String(member.phone || '').toLowerCase() === value) || null;
}

function applyReservationMemberNo() {
    const input = document.getElementById('reservation-member-no');
    const member = getMemberByCardNo(input?.value);
    if (!member) return;
    currentCashierMemberId = member.id;
    document.getElementById('reservation-customer-name').value = member.name || '';
    document.getElementById('reservation-phone').value = member.phone || '';
    showToast(`${member.level || '普通会员'}：${getMemberServiceText(member)}`);
}

async function refreshCashierUsingRoomTimes(rooms) {
    const usingRooms = rooms.filter(room => getCashierRoomState(room) === 'using');
    await Promise.all(usingRooms.map(async room => {
        const roomId = getRoomKey(room);
        if (!roomId || cashierActiveBillsCache[roomId]) return;
        const res = await cashierRequest(`/billing/room-bill?roomId=${encodeURIComponent(roomId)}`).catch(() => null);
        if (res?.data) cashierActiveBillsCache[roomId] = res.data;
    }));
    usingRooms.forEach(room => {
        const roomId = getRoomKey(room);
        const el = document.getElementById(`cashier-room-extra-${roomId}`);
        const bill = cashierActiveBillsCache[roomId];
        if (el && bill?.startTime) {
            const startText = formatCashierDateTime(bill.startTime).slice(11, 16);
            el.innerHTML = `<div class="truncate font-bold">开房时间：${escapeHtml(startText || '--:--')}</div>`;
        }
    });
}

function formatCashierDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatCashierDuration(startValue, endValue) {
    if (!startValue || !endValue) return '-';
    const start = new Date(startValue);
    const end = new Date(endValue);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return '-';
    const totalMinutes = Math.floor((end.getTime() - start.getTime()) / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}小时${minutes}分钟`;
    return `${minutes}分钟`;
}
