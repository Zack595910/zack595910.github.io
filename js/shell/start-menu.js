/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK 架构 | L5 外壳层
 *
 *   文件    : js/shell/start-menu.js
 *   模块    : EznK.Shell.startMenu
 *   层级    : L5 外壳层
 *
 *   开始菜单：锚定在任务栏"开始"按钮上方的画布浮层。
 *   列出所有已注册应用，使用 emoji 图标与中文名称。
 *   全部通过 Ezn32 UI 绘制，不使用 DOM。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Shell && G.EznK.Shell.startMenu && G.EznK.Shell.startMenu.version === '2.0.0') { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L5:startmenu');

    var ui = ezn32.ui;
    var api = ezn32.api;
    var GDI = api.gdi;
    var RES = ui.res;
    var CANVAS = ui.canvas;
    var DOM = G.EznK.Platform.DOM;
    var I18N = G.EznK.Platform.I18n;

    function T(k, f) { return I18N ? I18N.T(k, f) : (f || k); }

    var W = 340;
    var ROW_H = 38;
    var HEADER_H = 52;
    var FOOTER_H = 36;

    var state = {
        open: false,
        surface: null,
        items: [],
        hover: -1,
        listeners: [],
        scroll: 0
    };

    /* 应用 emoji 图标表 */
    var APP_ICONS = {
        'file-manager': '📁',
        'editor': '📝',
        'task-manager': '📊',
        'storage-manager': '💿',
        'registry-editor': '🗂️',
        'gpedit': '📋',
        'mmc': '🖥️',
        'device-manager': '🖨️',
        'shortcut-wizard': '🔗',
        'backup-manager': '💾',
        'about': 'ℹ️',
        'kd-store': '📦',
        'control-panel': '⚙️',
        'python-shell': '🐍',
        'camera': '📷',
        'recycle-bin': '🗑️',
        'chat': '💬',
        'code-studio': '💻',
        'sysmanager': '⚡',
        'file-dialog': '🚀',
        'mmc': '📋',
        'settings': '⚙️'
    };

    /* 应用中文名表 */
    var APP_NAMES = {
        'file-manager': '文件管理器',
        'editor': '代码编辑器',
        'task-manager': '任务管理器',
        'storage-manager': '存储管理',
        'registry-editor': '注册表编辑器',
        'gpedit': '组策略',
        'mmc': '系统控制台',
        'device-manager': '设备管理器',
        'shortcut-wizard': '创建快捷方式',
        'backup-manager': '系统备份',
        'about': '关于系统',
        'kd-store': 'KD 应用商店',
        'control-panel': '控制面板',
        'python-shell': 'Python 终端',
        'camera': '摄像头',
        'recycle-bin': '回收站',
        'chat': '聊天室',
        'code-studio': '代码工坊',
        'sysmanager': 'System Control',
        'file-dialog': '文件对话框',
        'mmc': '系统控制台',
        'settings': '设置'
    };

    var EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

    function iconFor(id, fallback) {
        if (APP_ICONS[id]) { return APP_ICONS[id]; }
        var raw = String(fallback || '');
        if (EMOJI_RE.test(raw)) { return raw; }
        return '🚀';
    }

    function nameFor(id, fallback) {
        if (APP_NAMES[id]) { return APP_NAMES[id]; }
        var raw = String(fallback || '');
        if (/^[A-Za-z][A-Za-z0-9 ]*$/.test(raw)) { return raw; }
        return raw || id;
    }

    /* =================================================================
     * 1. 应用清单
     * ============================================================== */

    function collectApps() {
        var seen = Object.create(null);
        var list = [];

        function add(id, name, icon) {
            if (!id || seen[id]) { return; }
            seen[id] = true;
            list.push({ id: id, name: name, icon: icon });
        }

        /* 注册表是权威来源 */
        var reg = G.EznK.Service && G.EznK.Service.appRegistry;
        if (reg) {
            reg.list().value.filter(function (a) { return !a.hidden; }).forEach(function (a) {
                if (a.id === 'c2-runtime') { return; }
                add(a.id, nameFor(a.id, a.name), iconFor(a.id, a.icon));
            });
        }

        /* 补齐只有模块但未注册的 */
        var apps = Object.keys(G.EznK.Apps || {}).map(function (k) {
            return G.EznK.Apps[k];
        }).reduce(function (acc, mod) {
            if (mod && typeof mod.open === 'function') {
                acc[mod.id || mod.displayName || ''] = mod;
            }
            return acc;
        }, {});
        Object.keys(apps).forEach(function (k) {
            var mod = apps[k];
            if (!mod || typeof mod.open !== 'function') { return; }
            var id = mod.id || k;
            if (seen[id]) { return; }
            add(id, nameFor(id, mod.displayName || k), iconFor(id, mod.icon));
        });

        list.sort(function (a, b) {
            try { return a.name.localeCompare(b.name, 'zh-Hans-CN'); }
            catch (e) { return a.name < b.name ? -1 : 1; }
        });
        return list;
    }

    /* =================================================================
     * 2. 绘制
     * ============================================================== */

    function paint(surface) {
        var t = RES.theme().value;
        GDI.FillRect(surface.dc, 0, 0, W, surface.height, t.surface);
        GDI.DrawRect(surface.dc, 0, 0, W, surface.height, t.border, 1);

        /* 顶部 */
        GDI.FillRect(surface.dc, 1, 1, W - 2, HEADER_H, t.surfaceAlt);
        GDI.SelectObject(surface.dc, RES.font('iconLarge'));
        GDI.SetTextColor(surface.dc, t.text);
        GDI.DrawText(surface.dc, '🖥️', 14, 8);

        GDI.SelectObject(surface.dc, RES.font('title'));
        GDI.SetTextColor(surface.dc, t.text);
        GDI.DrawText(surface.dc, 'EZNT', 58, 12);

        var user = api.advapi.GetCurrentUser();
        var uname = (user.status === S.OK && user.value) ? user.value.name : '用户';
        GDI.SelectObject(surface.dc, RES.font('small'));
        GDI.SetTextColor(surface.dc, t.textSecondary);
        GDI.DrawTextTruncated(surface.dc, uname, 58, 30, W - 80);

        /* 应用行 */
        var listTop = HEADER_H + 6;
        var listBottom = surface.height - FOOTER_H;
        var visibleRows = Math.max(1, Math.floor((listBottom - listTop) / ROW_H));
        var maxScroll = Math.max(0, state.items.length - visibleRows);
        if (state.scroll > maxScroll) { state.scroll = maxScroll; }
        if (state.scroll < 0) { state.scroll = 0; }

        for (var vi = 0; vi < visibleRows; vi++) {
            var i = state.scroll + vi;
            if (i >= state.items.length) { break; }
            var it = state.items[i];
            var y = listTop + vi * ROW_H;

            if (i === state.hover) {
                GDI.FillRect(surface.dc, 4, y, W - 8, ROW_H - 2, t.surfaceHover);
            }

            GDI.SelectObject(surface.dc, RES.font('iconLarge'));
            GDI.SetTextColor(surface.dc, t.text);
            GDI.DrawText(surface.dc, it.icon, 14, y + 3);

            GDI.SelectObject(surface.dc, RES.font('ui'));
            GDI.SetTextColor(surface.dc, t.text);
            GDI.DrawTextTruncated(surface.dc, it.name, 58, y + 12, W - 78);
        }

        /* 底部 */
        var fy = surface.height - FOOTER_H;
        GDI.FillRect(surface.dc, 1, fy, W - 2, FOOTER_H - 1, t.surfaceAlt);
        GDI.SelectObject(surface.dc, RES.font('ui'));
        GDI.SetTextColor(surface.dc, t.text);
        GDI.DrawText(surface.dc, '⚙️', 14, fy + 10);
        GDI.DrawText(surface.dc, '设置', 46, fy + 12);

        GDI.SetTextAlign(surface.dc, 'right');
        GDI.DrawText(surface.dc, '电源  ⏻', W - 16, fy + 12);
        GDI.SetTextAlign(surface.dc, 'left');
    }

    /* =================================================================
     * 3. 打开 / 关闭
     * ============================================================== */

    function open() {
        if (state.open) { return CORE.ok(true); }
        var hostRes = DOM.byId('eznt-root');
        if (hostRes.status !== S.OK) { return hostRes; }
        var host = hostRes.value;

        state.items = collectApps();
        state.scroll = 0;
        /* 菜单要尽量完整显示所有应用：先按内容算高度，
         * 只有超出可视区域时才收缩（此时才需要滚动）。 */
        var wantH = HEADER_H + 6 + state.items.length * ROW_H + FOOTER_H + 10;
        var availH = host.clientHeight - 44;   /* 上方只留任务栏高度 + 4px */
        var h = Math.max(180, Math.min(availH, wantH));
        /* 高度必须是整行数，否则最后一行会被截掉一半 */
        var usable = h - HEADER_H - 6 - FOOTER_H;
        var rowsFit = Math.max(1, Math.floor(usable / ROW_H));
        h = HEADER_H + 6 + Math.min(rowsFit, state.items.length) * ROW_H + FOOTER_H;
        state.visibleRows = Math.min(rowsFit, state.items.length);

        var surfRes = CANVAS.CreateForParent(host, W, h);
        if (surfRes.status !== S.OK) { return surfRes; }
        state.surface = surfRes.value;
        var taskbarH = (G.EznK.Shell && G.EznK.Shell.taskbar) ? G.EznK.Shell.taskbar.HEIGHT : 40;
        state.surface.element.style.position = 'fixed';
        state.surface.element.style.left = '4px';
        state.surface.element.style.top = '6px';
        state.surface.element.style.zIndex = '90001';
        state.surface.painter = function (s) { paint(s); };
        state.surface.invalidate();
        state.open = true;

        if (G.EznK.Shell.taskbar) { G.EznK.Shell.taskbar.setStartOpen(true); }
        bindEvents();
        return CORE.ok(true);
    }

    function close() {
        if (!state.open) { return CORE.ok(true); }
        state.listeners.forEach(function (h) { DOM.off(h); });
        state.listeners = [];
        if (state.surface) { CANVAS.dispose(state.surface); }
        state.surface = null;
        state.open = false;
        state.hover = -1;
        if (G.EznK.Shell.taskbar) { G.EznK.Shell.taskbar.setStartOpen(false); }
        return CORE.ok(true);
    }

    function toggle() { return state.open ? close() : open(); }

    /** 客户端 y 坐标 -> 应用行索引（-1 表示不是应用行） */
    function itemAt(clientY) {
        var r = state.surface ? state.surface.element.getBoundingClientRect() : null;
        if (!r) { return -1; }
        var ly = clientY - r.top;
        var listTop = HEADER_H + 6;
        var listBottom = r.height - FOOTER_H;
        if (ly < listTop || ly > listBottom) { return -1; }
        var vi = Math.floor((ly - listTop) / ROW_H);
        var idx = state.scroll + vi;
        if (idx < 0 || idx >= state.items.length) { return -1; }
        return idx;
    }

    /** 客户端 y 坐标 -> 该行的屏幕中心 y（测试与自动化用） */
    function rowScreenY(index) {
        var r = state.surface ? state.surface.element.getBoundingClientRect() : null;
        if (!r) { return -1; }
        var vi = index - state.scroll;
        if (vi < 0) { return -1; }
        return Math.round(r.top + HEADER_H + 6 + vi * ROW_H + ROW_H / 2);
    }

    /** scrollTo(index) - 把某一项滚动到可视区域内 */
    function scrollTo(index) {
        if (!state.surface) { return CORE.fail(S.ENOENT, { reason: '菜单未打开' }); }
        var r = state.surface.element.getBoundingClientRect();
        var listTop = HEADER_H + 6;
        var listBottom = r.height - FOOTER_H;
        var vis = Math.max(1, Math.floor((listBottom - listTop) / ROW_H));
        var maxScroll = Math.max(0, state.items.length - vis);
        if (index < state.scroll) { state.scroll = Math.max(0, index); }
        else if (index >= state.scroll + vis) { state.scroll = Math.min(maxScroll, index - vis + 1); }
        state.surface.invalidate();
        return CORE.ok(state.scroll);
    }

    function launchItem(it) {
        if (!it) { return CORE.fail(S.ENOENT, { reason: '没有这一项' }); }
        close();
        var apps = G.EznK.Apps || {};
        var mod = apps[it.id];
        if (!mod) {
            Object.keys(apps).forEach(function (k) {
                if (apps[k] && apps[k].id === it.id && typeof apps[k].open === 'function') { mod = apps[k]; }
            });
        }
        if (mod && typeof mod.open === 'function') {
            try { return CORE.ok(mod.open({})); }
            catch (err) { return CORE.fail(S.EFAULT, { reason: '启动失败: ' + (err && err.message) }); }
        }
        var reg = G.EznK.Service && G.EznK.Service.appRegistry;
        if (reg) { return reg.launch(it.id); }
        return CORE.fail(S.ENOSYS, { reason: '找不到应用: ' + it.id });
    }

    function bindEvents() {
        var el = state.surface.element;
        function on(ev, fn) { var h = DOM.on(el, ev, fn); if (h.status === S.OK) { state.listeners.push(h.value); } }

        on('mousemove', function (ev) {
            var idx = itemAt(ev.clientY);
            if (idx !== state.hover) {
                state.hover = idx;
                el.style.cursor = idx >= 0 ? 'pointer' : 'default';
                state.surface.invalidate();
            }
        });

        on('wheel', function (ev) {
            ev.preventDefault();
            var delta = ev.deltaY > 0 ? 1 : -1;
            var listTop = HEADER_H + 6;
            var listBottom = el.getBoundingClientRect().height - FOOTER_H;
            var visibleRows = Math.max(1, Math.floor((listBottom - listTop) / ROW_H));
            var maxScroll = Math.max(0, state.items.length - visibleRows);
            var next = Math.max(0, Math.min(maxScroll, state.scroll + delta));
            if (next !== state.scroll) {
                state.scroll = next;
                state.hover = -1;
                state.surface.invalidate();
            }
        });

        on('click', function (ev) {
            var idx = itemAt(ev.clientY);
            if (idx >= 0) { launchItem(state.items[idx]); return; }

            var r = el.getBoundingClientRect();
            var ly = ev.clientY - r.top;
            if (ly > r.height - FOOTER_H) {
                var lx = ev.clientX - r.left;
                close();
                if (lx > W / 2) {
                    var ba = G.EznK.Shell.bootAnimation;
                    if (ba) { ba.restart(); }
                } else {
                    var cp = G.EznK.Apps.controlPanel;
                    if (cp) { cp.open(); }
                }
            }
        });

        var outside = DOM.on('window', 'mousedown', function (ev) {
            if (el.contains && ev.target !== el) {
                var tb = G.EznK.Shell.taskbar;
                var tbEl = tb && tb._surfaceEl;
                if (tbEl && tbEl.contains && tbEl.contains(ev.target)) { return; }
                close();
            }
        }, true);
        if (outside.status === S.OK) { state.listeners.push(outside.value); }
    }

    function IsOpen() { return state.open; }
    function Items() { return CORE.ok(state.items.slice(0)); }

    var SM = {};
    SM.version = '2.0.0';
    SM.open = open;
    SM.close = close;
    SM.toggle = toggle;
    SM.IsOpen = IsOpen;
    SM.items = Items;
    SM.itemAt = itemAt;
    SM.rowScreenY = rowScreenY;
    SM.scrollTo = scrollTo;
    SM.launchItem = launchItem;
    SM.WIDTH = W;
    SM.HEADER_H = HEADER_H;
    SM.ROW_H = ROW_H;
    SM.FOOTER_H = FOOTER_H;

    if (!G.EznK.Shell) { G.EznK.Shell = {}; }
    G.EznK.Shell.startMenu = SM;
    if (G.EznK.Kernel && G.EznK.Kernel.SRM && typeof G.EznK.Kernel.SRM.register === 'function') {
        G.EznK.Kernel.SRM.register('shell-startmenu', SM);
    }
    LOG.info('js/shell/start-menu.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
