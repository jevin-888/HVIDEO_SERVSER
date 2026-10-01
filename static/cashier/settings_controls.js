// Page-owned popovers also work in WebView2 composition mode.
(() => {
    let closeDropdown = null;
    function popup(source, label) {
        closeDropdown?.();
        document.querySelector('.cashier-control-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'cashier-control-overlay';
        const panel = document.createElement('div');
        panel.className = 'cashier-control-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', cashierTranslate(label));
        panel.setAttribute('aria-modal', 'true');
        const close = () => { overlay.remove(); source.focus(); };
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
        overlay.append(panel); document.body.append(overlay);
        return { panel, close };
    }
    function button(text, action) {
        const element = document.createElement('button');
        element.type = 'button'; element.textContent = text; element.onclick = action;
        return element;
    }
    function choose(select) {
        closeDropdown?.();
        const list = document.createElement('div'); list.className = 'cashier-choice-list';
        list.classList.add('cashier-select-dropdown');
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', select.getAttribute('aria-label') || cashierTranslate('请选择'));
        const close = (focus = true) => {
            list.remove(); select.setAttribute('aria-expanded', 'false');
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('scroll', scroll, true);
            window.removeEventListener('resize', resized);
            closeDropdown = null;
            if (focus && select.isConnected) select.focus({ preventScroll: true });
        };
        const outside = event => { if (!list.contains(event.target)) close(false); };
        const scroll = event => { if (!list.contains(event.target)) close(false); };
        const resized = () => close(false);
        closeDropdown = close;
        select.setAttribute('aria-expanded', 'true');
        for (const option of select.options) {
            if (option.hidden || option.parentElement.hidden) continue;
            const item = button(option.textContent, () => {
                select.value = option.value;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true })); close();
            });
            item.disabled = option.disabled || (option.parentElement.tagName === 'OPTGROUP' && option.parentElement.disabled);
            item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected));
            list.append(item);
        }
        document.body.append(list);
        const rect = select.getBoundingClientRect();
        const below = window.innerHeight - rect.bottom - 8;
        const above = rect.top - 8;
        const upward = below < Math.min(list.scrollHeight, 280) && above > below;
        list.style.width = `${Math.min(Math.max(rect.width, 160), window.innerWidth - 16)}px`;
        list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - list.offsetWidth - 8))}px`;
        list.style.maxHeight = `${Math.max(40, Math.min(280, upward ? above : below))}px`;
        if (upward) list.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        else list.style.top = `${rect.bottom + 4}px`;
        list.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key === 'Tab') close(false);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const items = [...list.querySelectorAll('button:not(:disabled)')];
                const current = items.indexOf(document.activeElement);
                const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                    : Math.max(0, Math.min(items.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
                items[index]?.focus();
            }
        });
        (list.querySelector('[aria-selected="true"]:not(:disabled)') || list.querySelector('button:not(:disabled)'))?.focus({ preventScroll: true });
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('scroll', scroll, true);
        window.addEventListener('resize', resized);
    }
    function time(input) {
        const { panel, close } = popup(input, '选择时间');
        let [hour, minute] = (input.value || '00:00').split(':').map(Number);
        const preview = document.createElement('div'); preview.className = 'cashier-time-preview';
        const refresh = () => {
            preview.textContent = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            panel.querySelectorAll('[data-hour]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.hour) === hour)));
            panel.querySelectorAll('[data-minute]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.minute) === minute)));
        };
        panel.append(preview);
        for (const [field, count] of [['hour', 24], ['minute', 60]]) {
            const label = document.createElement('div'); label.textContent = cashierTranslate(field === 'hour' ? '小时' : '分钟'); panel.append(label);
            const grid = document.createElement('div'); grid.className = 'cashier-time-grid';
            for (let n = 0; n < count; n++) {
                const b = button(String(n).padStart(2, '0'), () => { if (field === 'hour') hour = n; else minute = n; refresh(); });
                b.dataset[field] = n; grid.append(b);
            }
            panel.append(grid);
        }
        panel.append(button(cashierTranslate('取消'), close), button(cashierTranslate('确定'), () => {
            input.value = preview.textContent;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true })); close();
        }));
        refresh(); panel.querySelector('[data-hour][aria-pressed="true"]').focus();
    }
    function target(event) {
        const el = event.target.closest('select, input[type="time"]');
        return el && !el.disabled && !el.readOnly && !el.multiple ? el : null;
    }
    document.addEventListener('mousedown', event => { if (target(event)) event.preventDefault(); }, true);
    document.addEventListener('pointerdown', event => { if (target(event)) event.preventDefault(); }, true);
    document.addEventListener('click', event => {
        const el = target(event); if (!el) return;
        event.preventDefault(); el.tagName === 'SELECT' ? choose(el) : time(el);
    }, true);
    document.addEventListener('keydown', event => {
        const el = target(event);
        if (el && ['Enter', ' ', 'ArrowDown'].includes(event.key)) {
            event.preventDefault(); el.tagName === 'SELECT' ? choose(el) : time(el);
        }
    }, true);
    document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = `.cashier-control-overlay{position:fixed;inset:0;z-index:11000;background:#0009;display:flex;align-items:center;justify-content:center}.cashier-control-panel{background:#1e293b;color:#f8fafc;border:1px solid #64748b;border-radius:12px;padding:18px;width:min(540px,94vw);max-height:90vh;overflow:auto;box-shadow:0 15px 50px #0008}.cashier-control-panel button{background:#334155;color:#f8fafc;border:1px solid #64748b;border-radius:6px;padding:8px;margin:2px}.cashier-control-panel button:focus-visible{outline:2px solid #93c5fd}.cashier-control-panel [aria-selected=true],.cashier-control-panel [aria-pressed=true]{background:#1d4ed8;border-color:#93c5fd}.cashier-choice-list{display:flex;flex-direction:column;max-height:65vh;overflow:auto}.cashier-time-grid{display:grid;grid-template-columns:repeat(8,1fr);margin-bottom:12px}.cashier-time-preview{font-size:24px;text-align:center;margin-bottom:12px}input[type=time]{color-scheme:dark}input[type=time]::-webkit-calendar-picker-indicator{opacity:1;filter:brightness(0) invert(1)}`;
        document.head.append(style);
        const dropdownStyle = document.createElement('style');
        dropdownStyle.textContent = `.cashier-select-dropdown{position:fixed;z-index:11000;background:#1e293b;color:#f8fafc;border:1px solid #64748b;border-radius:6px;padding:4px;box-shadow:0 6px 18px #0006;overflow:auto}.cashier-select-dropdown button{flex-shrink:0;text-align:left;padding:8px 10px;border-radius:3px;color:#f8fafc;background:transparent;border:0;white-space:normal;overflow-wrap:anywhere}.cashier-select-dropdown button:hover,.cashier-select-dropdown button:focus-visible{background:#334155;outline:2px solid #93c5fd;outline-offset:-2px}.cashier-select-dropdown [aria-selected=true]{background:#1d4ed8}.cashier-select-dropdown button:disabled{opacity:.45}`;
        document.head.append(dropdownStyle);
        const observer = new MutationObserver(() => setupCashierDatePickers());
        observer.observe(document.body, { childList: true, subtree: true });
    });
})();
