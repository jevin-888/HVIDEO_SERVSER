// Embedded cashier modules share the native session, without persisting tokens.
window.hvideoDesktop = new URLSearchParams(location.search).get('desktop') === '1'
    && !!window.chrome?.webview;

if (window.hvideoDesktop) {
    document.documentElement.classList.add('cashier-desktop');
    const style = document.createElement('style');
    style.textContent = `
        .cashier-desktop #cashier-login,
        .cashier-desktop #cashier-app > aside { display: none !important; }
        .cashier-desktop #cashier-app > main { min-width: 0; padding: 12px; }
        .cashier-desktop body { background: #0d1628; }
    `;
    document.head.appendChild(style);

    const modules = new Set(['reservation', 'member', 'warehouse', 'finance', 'base-settings', 'system']);
    let connected = false;
    let activeModule = null;
    let readyTimer = null;
    let activeAction = null;
    const send = type => window.chrome.webview.postMessage({ type, version: 1 });

    const actionMessage = (type, id, message) => window.chrome.webview.postMessage({ type, version: 1, id, message });
    window.hvideoDesktopCancelAction = () => {
        resetCheckoutBill();
        activeAction = null;
        document.getElementById('desktop-bill-preview')?.remove();
        return true;
    };
    window.hvideoDesktopReturnToRooms = () => {
        if (activeAction == null) return false;
        const id = activeAction;
        window.hvideoDesktopCancelAction();
        actionMessage('cashierReturn', id);
        return true;
    };
    window.hvideoDesktopCashierAction = request => {
        if (!connected || !employeeCanAccessModule('cashier') || !request
            || !Number.isInteger(request.id)
            || !['open', 'print', 'order', 'checkout', 'desk', 'room'].includes(request.action)
            || (request.action !== 'desk' && !request.roomId)) return false;
        window.hvideoDesktopCancelAction();
        activeModule = null;
        activeAction = request.id;
        void (async () => {
            try {
                if (request.action === 'desk') {
                    showCashierSubPage('checkout-desk');
                    await loadCheckoutDesk();
                } else {
                    // Fetch current server data before selecting the exact native room.
                    // Do not use a previous room's bill or silently select the first room.
                    const [rooms, types, areas] = await Promise.all([
                        cashierRequest('/rooms'), cashierRequest('/rooms/configs/types'),
                        cashierRequest('/rooms/configs/areas'), refreshCustomerData()
                    ]);
                    if (activeAction !== request.id) return;
                    cashierRoomsCache = rooms.data || [];
                    cashierRoomTypes = types.data || [];
                    cashierRoomAreas = areas.data || [];
                    const room = cashierRoomsCache.find(room => String(room.id) === String(request.roomId));
                    if (!room) throw new Error('房间不存在，请返回刷新');
                    cashierSelectedRoomId = String(room.id);
                    document.getElementById('cashier-room-id').value = cashierSelectedRoomId;
                    window.currentBillingSessionId = null;
                    cashierCurrentBillingSession = null;
                    currentCashierMemberId = '';
                    if (request.action === 'room') {
                        cashierActiveType = 'all'; cashierActiveArea = 'all';
                        document.getElementById('cashier-room-search').value = '';
                        showCashierSubPage('cashier');
                        renderCashierRoomTabs(); renderCashierAreaTabs();
                        await loadCashierRooms(false);
                        await loadRoomBill();
                    }
                    if (request.action === 'open') openOpenRoomPage();
                    if (request.action === 'order') await openOrderPanel();
                    if (request.action === 'checkout') { setCheckoutMethod('cash'); await openCheckoutPage(); }
                    if (request.action === 'print') await printRoomBill();
                }
                if (activeAction === request.id) actionMessage('cashierActionReady', request.id);
            } catch (error) {
                if (activeAction === request.id) actionMessage('cashierActionError', request.id, error.message || '业务页面加载失败');
            }
        })();
        return true;
    };

    // WebView2 disallows popups. Print the same receipt in an in-page frame.
    window.hvideoDesktopPrintBill = html => {
        document.getElementById('desktop-bill-preview')?.remove();
        const preview = document.createElement('div');
        preview.id = 'desktop-bill-preview';
        preview.style.cssText = 'position:fixed;inset:0;z-index:9998;background:#0d1628;display:flex;flex-direction:column;padding:16px;gap:12px';
        const toolbar = document.createElement('div');
        const print = document.createElement('button');
        print.textContent = cashierTranslate('打印账单');
        print.className = 'bg-blue-700 text-white px-5 py-2 rounded';
        const close = document.createElement('button');
        close.textContent = cashierTranslate('关闭');
        close.className = 'bg-gray-700 text-white px-5 py-2 rounded ml-3';
        const frame = document.createElement('iframe');
        frame.title = cashierTranslate('打印账单');
        frame.style.cssText = 'flex:1;width:100%;background:white;border:0';
        frame.srcdoc = html;
        print.disabled = true;
        frame.onload = () => { print.disabled = false; };
        print.onclick = () => { frame.contentWindow.focus(); frame.contentWindow.print(); };
        close.onclick = () => { preview.remove(); window.hvideoDesktopReturnToRooms(); };
        toolbar.append(print, close); preview.append(toolbar, frame); document.body.append(preview);
    };

    window.hvideoDesktopShowModule = module => {
        if (!connected || !modules.has(module) || !employeeCanAccessModule(module)) return false;
        window.hvideoDesktopCancelAction();
        if (activeModule === module) return true;
        showPage(module);
        activeModule = module;
        return true;
    };

    window.hvideoDesktopConnect = session => {
        if (!session || typeof session.token !== 'string' || !session.token
            || !session.employee || (session.module != null && !modules.has(session.module))) return false;
        window.hvideoDesktopCancelAction();
        apiService.token = session.token;
        currentEmployee = session.employee;
        window.hvideoSetLanguage?.(session.language || 'zh');
        activeModule = null;
        document.querySelectorAll('.cashier-page').forEach(page => page.classList.add('hidden'));
        currentCashierShift = session.shiftName || '白班';
        connected = true;
        clearInterval(readyTimer);
        document.getElementById('cashier-login').classList.add('hidden');
        document.getElementById('cashier-app').classList.remove('hidden');
        document.getElementById('cashier-employee-name').textContent = currentEmployee.name || currentEmployee.employeeNo;
        startCashierRealtimeSync();
        if (session.module != null) {
            window.hvideoDesktopShowModule(session.module);
        } else {
            document.querySelectorAll('.cashier-page').forEach(page => page.classList.add('hidden'));
        }
        return true;
    };

    window.hvideoDesktopExpired = () => {
        window.hvideoDesktopCancelAction();
        connected = false;
        activeModule = null;
        currentEmployee = null;
        apiService.token = null;
        document.getElementById('cashier-app').classList.add('hidden');
        send('sessionExpired');
    };

    document.addEventListener('DOMContentLoaded', () => {
        send('ready');
        let attempts = 0;
        readyTimer = setInterval(() => {
            if (connected || ++attempts >= 50) return clearInterval(readyTimer);
            send('ready');
        }, 400);
    });
}
