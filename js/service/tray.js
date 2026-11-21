/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L5 服务层
 *
 *   文件 : js/service/tray.js
 *   模块 : EznK.Service.tray
 *   层级 : L5 服务层
 *
 * ---------------------------------------------------------------------
 * 系统托盘
 * ---------------------------------------------------------------------
 *   · 应用可以把窗口"收进托盘"，而不是单纯最小化到任务栏
 *   · 每个托盘项：{ id, name, icon, windowId, tooltip, onClick }
 *   · 任务栏左侧托盘区绘制图标，点击时还原窗口 / 调用 onClick
 *   · 右键托盘项：显示窗口 / 隐藏窗口 / 关闭
 *
 *   窗口级 API：
 *     tray.minimizeToTray(win, opts)   收进托盘
 *     tray.restoreFromTray(id)          还原
 *     tray.remove(id)                   移除托盘图标
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.tray) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L5:tray');

    var items = [];      /* { id, name, icon, windowId, tooltip, onClick, hidden } */
    var seq = 0;

    function taskbar() { return G.EznK.Shell && G.EznK.Shell.taskbar; }
    function srm() { return G.EznK.Kernel && G.EznK.Kernel.SRM; }

    function invalidate() {
        var tb = taskbar();
        if (tb && typeof tb.invalidate === 'function') { tb.invalidate(); }
    }

    /* =================================================================
     * 1. 托盘项管理
     * ============================================================== */

    /** list() -> { status, value: item[] } */
    function list() { return CORE.ok(items.slice(0)); }

    /**
     * add(spec) -> { status, value: item }
     *   spec: { id?, name, icon?, windowId?, tooltip?, onClick? }
     */
    function add(spec) {
        var s = spec || {};
        if (typeof s.name !== 'string' || !s.name.length) {
            return CORE.fail(S.EINVAL, { reason: '缺少托盘项名称' });
        }
        var id = s.id || ('tray_' + (++seq) + '_' + Date.now());
        if (items.some(function (it) { return it.id === id; })) {
            return CORE.fail(S.EEXIST, { reason: '托盘项已存在: ' + id });
        }
        var item = {
            id: id,
            name: s.name,
            icon: s.icon || '📦',
            windowId: s.windowId || null,
            tooltip: s.tooltip || s.name,
            onClick: typeof s.onClick === 'function' ? s.onClick : null,
            hidden: true,
            createdAt: Date.now()
        };
        items.push(item);
        invalidate();
        LOG.info('托盘项已添加: ' + item.name);
        return CORE.ok(item);
    }

    /** remove(id) -> { status } */
    function remove(id) {
        var before = items.length;
        items = items.filter(function (it) { return it.id !== id; });
        if (items.length === before) {
            return CORE.fail(S.ENOENT, { reason: '找不到托盘项: ' + id });
        }
        invalidate();
        return CORE.ok(true);
    }

    /** get(id) -> { status, value: item | null } */
    function get(id) {
        var found = items.filter(function (it) { return it.id === id; })[0] || null;
        return CORE.ok(found);
    }

    /** clear() - 清空托盘 */
    function clear() {
        items = [];
        invalidate();
        return CORE.ok(true);
    }

    /* =================================================================
     * 2. 最小化到托盘
     * ============================================================== */

    /**
     * minimizeToTray(win, opts) -> { status, value: item }
     *   把窗口收进托盘：隐藏窗口 + 加一个托盘图标。
     */
    function minimizeToTray(win, opts) {
        if (!win || win.destroyed) {
            return CORE.fail(S.EINVAL, { reason: '窗口无效' });
        }
        var o = opts || {};
        var id = 'tray_win_' + win.id;

        var existing = items.filter(function (it) { return it.id === id; })[0];
        if (existing) { existing.hidden = true; }

        /* 隐藏窗口（不走 minimize，否则任务栏也留按钮） */
        try {
            if (typeof win.hide === 'function') { win.hide(); }
            else {
                win.minimized = true;
                win.visible = false;
                if (win.surface) { win.surface.element.style.display = 'none'; }
            }
        } catch (_) {}
        win._inTray = true;

        if (existing) { invalidate(); return CORE.ok(existing); }

        var added = add({
            id: id,
            name: o.name || win.title || '应用',
            icon: o.icon || win.icon || '📦',
            windowId: win.id,
            tooltip: o.tooltip || (win.title || '应用'),
            onClick: function () { restoreFromTray(id); }
        });
        if (added.status !== S.OK) { return added; }

        var s = srm();
        if (s && s.emit) { s.emit('window:to-tray', { id: win.id, trayId: id }); }
        return added;
    }

    /** restoreFromTray(trayId) -> { status } */
    function restoreFromTray(trayId) {
        var it = items.filter(function (x) { return x.id === trayId; })[0];
        if (!it) { return CORE.fail(S.ENOENT, { reason: '找不到托盘项: ' + trayId }); }

        if (it.windowId) {
            var W = G.ezn32.ui.Window;
            var g = W.Get(it.windowId);
            if (g.status === S.OK && g.value && !g.value.destroyed) {
                var win = g.value;
                win._inTray = false;
                try {
                    if (typeof win.show === 'function') { win.show(); }
                    else {
                        win.minimized = false;
                        win.visible = true;
                        if (win.surface) { win.surface.element.style.display = ''; }
                    }
                    win.activate();
                } catch (_) {}
            } else {
                /* 窗口已不存在 -> 移除托盘项 */
                remove(trayId);
                return CORE.ok(false);
            }
        }
        if (typeof it.onClick === 'function') {
            try { it.onClick(); } catch (err) {
                LOG.error('托盘项 onClick 抛出: ' + (err && err.message));
            }
        }
        remove(trayId);
        return CORE.ok(true);
    }

    /** activate(trayId) - 点击托盘项（供任务栏调用） */
    function activate(trayId) { return restoreFromTray(trayId); }

    /**
     * showMenu(trayId, x, y) - 右键托盘项的菜单
     *   显示窗口 / 隐藏窗口 / 关闭应用
     */
    function showMenu(trayId, x, y) {
        var it = items.filter(function (a) { return a.id === trayId; })[0];
        if (!it) { return CORE.fail(S.ENOENT, { reason: '找不到托盘项' }); }
        var CM = G.ezn32.ui && G.ezn32.ui.ContextMenu;
        if (!CM) { return CORE.fail(S.ENOSYS, { reason: '无上下文菜单' }); }

        var win = null;
        if (it.windowId) {
            var g = G.ezn32.ui.Window.Get(it.windowId);
            if (g.status === S.OK) { win = g.value; }
        }

        var menu = [
            { text: '显示 ' + it.name, icon: '🔍', onClick: function () { restoreFromTray(trayId); } }
        ];
        if (win) {
            menu.push({
                text: '关闭', icon: '✕',
                onClick: function () {
                    try { win.destroy(); } catch (_) {}
                    remove(trayId);
                }
            });
        }
        menu.push({ separator: true });
        menu.push({
            text: '退出托盘', icon: '⏏️',
            onClick: function () {
                if (win) { try { win.destroy(); } catch (_) {} }
                remove(trayId);
            }
        });
        CM.Show({ x: x, y: y, items: menu });
        return CORE.ok(true);
    }

    /* =================================================================
     * 3. 绘制辅助（任务栏调用）
     * ============================================================== */

    /** iconRect(i, startX, size) - 第 i 个托盘图标的矩形 */
    function iconRect(i, startX, size) {
        var sz = size || 22;
        return { x: startX + i * (sz + 6), y: (40 - sz) / 2, w: sz, h: sz };
    }

    /** totalWidth(size) - 整个托盘区需要的宽度 */
    function totalWidth(size) {
        var sz = size || 22;
        return items.length ? (items.length * (sz + 6)) : 0;
    }

    function boot() {
        var s = srm();
        if (s && typeof s.registerService === 'function') {
            s.registerService('tray', { init: function () { LOG.info('tray service online'); } });
        }
        return CORE.ok(true);
    }

    var Tray = {
        version: '1.0.0',
        boot: boot,
        shutdown: function () { clear(); return CORE.ok(true); },
        list: list,
        add: add,
        remove: remove,
        get: get,
        clear: clear,
        minimizeToTray: minimizeToTray,
        restoreFromTray: restoreFromTray,
        activate: activate,
        showMenu: showMenu,
        iconRect: iconRect,
        totalWidth: totalWidth,
        count: function () { return items.length; }
    };

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.tray = Tray;
    G.ezn32.api.tray = Tray;

    LOG.info('js/service/tray.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
