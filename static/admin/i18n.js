(() => {
    'use strict';
    const catalog = window.AdminTranslations || {};
    const languages = ['zh', 'id', 'vi', 'th', 'en'];
    const locales = {zh:'zh-CN', id:'id-ID', vi:'vi-VN', th:'th-TH', en:'en-US'};
    const textSources = new WeakMap(), attributeSources = new WeakMap();
    const preferenceKey = 'hvideo_admin_language';
    const ignore = 'script,style,textarea,code,pre,[translate="no"],[data-i18n-ignore],#syslog-container,#admin-username,#license-venue-name,#license-contact,#license-address,#license-id,#songs-table td:nth-child(-n+6):not([colspan]),#songs-table td:nth-child(10),#singers-table td:nth-child(-n+2):not([colspan]),#terminals-table td:nth-child(2),#users-table td:nth-child(-n+2):not([colspan]),[data-cloud-package-id],#song-artist option:not([value=""]),#dict-table td:nth-child(3),#streams-table td:not([colspan]),#streams-category-filter option:not([value=""]),#logs-table td:not([colspan])';
    let language = 'zh', revision = 0, saveQueue = Promise.resolve();
    try { language = localStorage.getItem(preferenceKey) || 'zh'; } catch (_) {}
    if (!languages.includes(language)) language = 'zh';
    const invoke = () => window.__TAURI__?.tauri?.invoke || window.__TAURI__?.invoke || window.__TAURI_INVOKE__;
    const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ');
    const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const templates = Object.keys(catalog).filter(k => /\{\d+\}/.test(k)).sort((a,b) => b.replace(/\{\d+\}/g,'').length - a.replace(/\{\d+\}/g,'').length).map(key => {
        const slots = [];
        const parts = key.split(/(\{\d+\})/).map(part => {
            if (/^\{\d+\}$/.test(part)) { slots.push(part); return '(.+?)'; }
            return escapePattern(part);
        });
        return {key, slots, pattern:new RegExp('^'+parts.join('')+'$')};
    });
    function t(value, code = language) {
        const original = String(value ?? ''), key = normalize(original);
        if (code === 'zh' || !key) return original;
        let translated = catalog[key]?.[code];
        if (!translated) for (const entry of templates) {
            const match = key.match(entry.pattern);
            if (match) {
                const slots = Object.fromEntries(entry.slots.map((name,index) => [name,match[index+1]]));
                translated = catalog[entry.key][code].replace(/\{\d+\}/g, name => slots[name] || name);
                break;
            }
        }
        if (!translated) {
            // Only known UI prefixes are translated; embedded names/paths remain untouched.
            const prefix = Object.keys(catalog).find(k => /[：:]$/.test(k) && key.startsWith(k));
            if (prefix) translated = catalog[prefix][code] + key.slice(prefix.length);
        }
        if (!translated && key.startsWith('保存设置后生效。')) translated = t('保存设置后生效。',code) + t(key.slice('保存设置后生效。'.length),code);
        return translated ? original.replace(original.trim(), translated) : original;
    }
    function remembered(value, previous) {
        const source = previous && value === previous.rendered ? previous.source : value;
        return {source, rendered:t(source)};
    }
    function translateNode(node) {
        if (!node.parentElement || node.parentElement.closest(ignore)) return;
        const state = remembered(node.nodeValue, textSources.get(node));
        textSources.set(node, state);
        if (node.nodeValue !== state.rendered) {
            // Option labels must never change their implicit submission values.
            const option = node.parentElement.closest('option');
            if (option && !option.hasAttribute('value')) option.value = option.textContent;
            node.nodeValue = state.rendered;
        }
    }
    function translateElement(element) {
        if (element.closest(ignore)) return;
        const states = attributeSources.get(element) || {};
        for (const name of ['placeholder','title','aria-label','alt']) {
            if (!element.hasAttribute(name)) continue;
            states[name] = remembered(element.getAttribute(name),states[name]);
            if (element.getAttribute(name) !== states[name].rendered) element.setAttribute(name,states[name].rendered);
        }
        attributeSources.set(element,states);
    }
    function translateTree(root) {
        if (root.nodeType === Node.TEXT_NODE) { translateNode(root); return; }
        if (root.nodeType !== Node.ELEMENT_NODE || root.closest(ignore)) return;
        translateElement(root);
        const walker = document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            if (walker.currentNode.nodeType === Node.TEXT_NODE) translateNode(walker.currentNode);
            else translateElement(walker.currentNode);
        }
    }
    const observer = new MutationObserver(records => {
        observer.disconnect();
        const roots = new Set();
        for (const record of records) {
            if (record.type === 'childList') for (const node of record.addedNodes) roots.add(node);
            else roots.add(record.target);
        }
        for (const root of roots) if (root.isConnected) translateTree(root);
        observe();
    });
    function observe() {
        observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label','alt']});
    }
    function apply(code) {
        language = languages.includes(code) ? code : 'zh';
        observer.disconnect();
        document.documentElement.lang = locales[language];
        translateTree(document.body);
        document.title = t('HVideo 服务器管理');
        document.querySelectorAll('[data-admin-language]').forEach(select => {select.value = language;});
        observe();
        document.dispatchEvent(new CustomEvent('admin-language-changed',{detail:{language,locale:locales[language]}}));
    }
    function sourceText(element) {
        if (!element) return '';
        const walker = document.createTreeWalker(element,NodeFilter.SHOW_TEXT); let result='';
        while (walker.nextNode()) result += textSources.get(walker.currentNode)?.source ?? walker.currentNode.nodeValue;
        return result;
    }
    async function setLanguage(code) {
        if (!languages.includes(code)) return;
        revision++; apply(code);
        try { localStorage.setItem(preferenceKey,code); } catch (_) {}
        const nativeInvoke = invoke();
        if (nativeInvoke) {
            saveQueue = saveQueue.catch(()=>{}).then(()=>nativeInvoke('set_admin_language',{language:code}));
            try { await saveQueue; } catch (_) { window.showToast?.(t('保存语言失败'),'error'); }
        }
    }
    window.AdminI18n = {t,setLanguage,sourceText,get language(){return language;},get locale(){return locales[language];}};
    document.querySelectorAll('[data-admin-language]').forEach(select => select.addEventListener('change',()=>setLanguage(select.value)));
    apply(language);
    const nativeInvoke = invoke(), initialRevision = revision;
    if (nativeInvoke) nativeInvoke('get_admin_language').then(code => {
        if (revision === initialRevision && languages.includes(code)) { apply(code); try{localStorage.setItem(preferenceKey,code);}catch(_){} }
    }).catch(()=>{});
})();
