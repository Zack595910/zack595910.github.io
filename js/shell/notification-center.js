/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | L5 Shell Layer
 *
 *   File    : js/shell/notification-center.js
 *   Module  : EznK.Shell.NotificationCenter
 *   Layer   : L5 外壳层
 *
 *   Toast notifications + the notification history panel. Toasts are
 *   painted on a shared canvas overlay in the bottom-right corner; the
 *   history panel lists past notifications grouped by app.
 *
 *   Every toast owns a timer that is released when it expires or when the
 *   centre is disposed (hard rule #6).
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Shell && G.EznK.Shell.notifications) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L5:notify');

    var ui = ezn32.ui;
    var api = ezn32.api;
    var GDI = api.gdi;
    var RES = ui.res;
    var CANVAS = ui.canvas;
    var DOM = G.EznK.Platform.DOM;
    var TIME = EznK.Platform.Time;

    var TOAST_W = 300;
    var TOAST_H = 62;
    var MAX_TOASTS = 3;
    var HISTORY_MAX = 100;
    var PANEL_W = 340;

    var state = {
        surface: null,
        toasts: [],            /* { id, title, text, level, timer, at } */
        history: [],
        panel: null,
        height: 260,
        listeners: []
    };

    /* =================================================================
     * 1. Toast painting
     * ============================================================== */

    function ensureSurface() {
        if (state.surface) { return CORE.ok(state.surface); }
        var hostRes = DOM.byId('eznt-root');
        if (hostRes.status !== S.OK) { return CORE.fail(S.ENOENT, { reason: 'root not found' }); }
        var w = TOAST_W + 16;
        var h = MAX_TOASTS * (TOAST_H + 8) + 8;
        var surfRes = CANVAS.CreateForParent(hostRes.value, w, h);
        if (surfRes.status !== S.OK) { return surfRes; }
        state.surface = surfRes.value;
        state.surface.element.style.position = 'fixed';
        state.surface.element.style.right = '8px';
        var taskbarH = EznK.Shell.taskbar ? EznK.Shell.taskbar.HEIGHT : 40;
        state.surface.element.style.bottom = (taskbarH + 8) + 'px';
        state.surface.element.style.zIndex = '95000';
        /* 关键：toast 层只是显示，绝不能拦截鼠标事件，否则整个桌面都点不动 */
        state.surface.element.style.pointerEvents = 'none';
        state.surface.painter = function (s) { paintToasts(s); };
        return CORE.ok(state.surface);
    }

    function paintToasts(surface) {
        var t = RES.theme().value;
        GDI.Clear(surface.dc);
        GDI.SelectObject(surface.dc, RES.font('ui'));
        for (var i = 0; i < state.toasts.length && i < MAX_TOASTS; i++) {
            var toast = state.toasts[i];
            var y = 8 + i * (TOAST_H + 8);
            GDI.FillRect(surface.dc, 0, y, TOAST_W, TOAST_H, t.tooltipBg);
            GDI.DrawRect(surface.dc, 0, y, TOAST_W, TOAST_H, t.border, 1);
            /* level bar */
            var color = toast.level === 'error' ? t.danger
                : (toast.level === 'warning' ? t.warning : t.accent);
            GDI.FillRect(surface.dc, 0, y, 4, TOAST_H, color);
            GDI.SetTextColor(surface.dc, t.tooltipText);
            GDI.SelectObject(surface.dc, RES.font('uiBold'));
            GDI.DrawTextTruncated(surface.dc, toast.title || 'EZNT', 14, y + 8, TOAST_W - 28);
            GDI.SelectObject(surface.dc, RES.font('small'));
            GDI.SetTextColor(surface.dc, t.textSecondary);
            GDI.DrawTextTruncated(surface.dc, (toast.text || '').split('\n')[0], 14, y + 30, TOAST_W - 28);
        }
    }

    /* =================================================================
     * 2. Push / clear
     * ============================================================== */

    /**
     * push(spec) -> { status, value: id }
     *   spec: { title, text, level='info', timeout=3000, silent? }
     */
    function push(spec) {
        var s = spec || {};
        var es = ensureSurface();
        if (es.status !== S.OK) { return es; }
        var id = 'toast' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        var toast = {
            id: id,
            title: s.title || 'EZNT',
            text: s.text || '',
            level: s.level || 'info',
            at: Date.now(),
            timer: null
        };
        state.toasts.push(toast);
        while (state.toasts.length > MAX_TOASTS) {
            var old = state.toasts.shift();
            if (old.timer) { TIME.cancel(old.timer); }
        }
        state.history.push({ id: id, title: toast.title, text: toast.text, level: toast.level, at: toast.at });
        if (state.history.length > HISTORY_MAX) { state.history.shift(); }
        state.surface.invalidate();

        var timeout = typeof s.timeout === 'number' ? s.timeout : 3000;
        if (timeout > 0) {
            var h = TIME.after(timeout, function () { remove(id); });
            if (h.status === S.OK) { toast.timer = h.value; }
        }

        var srm = EznK.Kernel.SRM;
        if (srm) { srm.emit('notify:push', { id: id, title: toast.title, level: toast.level }); }
        return CORE.ok(id);
    }

    function remove(id) {
        var idx = -1;
        for (var i = 0; i < state.toasts.length; i++) {
            if (state.toasts[i].id === id) { idx = i; break; }
        }
        if (idx < 0) { return CORE.fail(S.ENOENT, { reason: 'unknown toast' }); }
        var toast = state.toasts[idx];
        if (toast.timer) { TIME.cancel(toast.timer); }
        state.toasts.splice(idx, 1);
        if (state.surface) { state.surface.invalidate(); }
        return CORE.ok(true);
    }

    function clearAll() {
        state.toasts.forEach(function (t) { if (t.timer) { TIME.cancel(t.timer); } });
        state.toasts = [];
        if (state.surface) { state.surface.invalidate(); }
        return CORE.ok(true);
    }

    function unread() {
        return state.history.length;
    }

    function history() {
        return CORE.ok(state.history.slice(0));
    }

    /* =================================================================
     * 3. History panel
     * ============================================================== */

    function toggle() {
        if (state.panel) { return close(); }
        return open();
    }

    function open() {
        var hostRes = DOM.byId('eznt-root');
        if (hostRes.status !== S.OK) { return hostRes; }
        var host = hostRes.value;
        var surfRes = CANVAS.CreateForParent(host, PANEL_W, state.height);
        if (surfRes.status !== S.OK) { return surfRes; }
        var surf = surfRes.value;
        var taskbarH = EznK.Shell.taskbar ? EznK.Shell.taskbar.HEIGHT : 40;
        surf.element.style.position = 'fixed';
        surf.element.style.right = '0px';
        surf.element.style.bottom = taskbarH + 'px';
        surf.element.style.zIndex = '95001';
        /* 通知历史面板需要可点击（关闭按钮），保留默认 pointer-events */
        surf.painter = function (s) { paintPanel(s); };
        surf.invalidate();
        state.panel = surf;
        return CORE.ok(true);
    }

    function close() {
        if (state.panel) { CANVAS.dispose(state.panel); }
        state.panel = null;
        return CORE.ok(true);
    }

    function paintPanel(surface) {
        var t = RES.theme().value;
        GDI.FillRect(surface.dc, 0, 0, PANEL_W, surface.height, t.surface);
        GDI.DrawRect(surface.dc, 0, 0, PANEL_W, surface.height, t.border, 1);
        GDI.SelectObject(surface.dc, RES.font('title'));
        GDI.SetTextColor(surface.dc, t.text);
        GDI.DrawText(surface.dc, '通知中心', 12, 12);

        var list = state.history.slice(-8).reverse();
        GDI.SelectObject(surface.dc, RES.font('small'));
        for (var i = 0; i < list.length; i++) {
            var n = list[i];
            var y = 40 + i * 28;
            if (y + 28 > surface.height) { break; }
            GDI.SetTextColor(surface.dc, t.text);
            GDI.DrawTextTruncated(surface.dc, n.title, 12, y, PANEL_W - 24);
            GDI.SetTextColor(surface.dc, t.textSecondary);
            GDI.DrawTextTruncated(surface.dc, n.text.split('\n')[0], 12, y + 12, PANEL_W - 24);
        }
        if (list.length === 0) {
            GDI.SetTextColor(surface.dc, t.textDisabled);
            GDI.DrawText(surface.dc, '暂无通知', 12, 60);
        }
    }

    /* =================================================================
     * 4. Lifecycle
     * ============================================================== */

    function init() {
        var srm = EznK.Kernel.SRM;
        if (srm) {
            srm.on('notify:push', function () { /* toasts are pushed explicitly */ });
        }
        return CORE.ok(true);
    }

    function dispose() {
        clearAll();
        close();
        if (state.surface) { CANVAS.dispose(state.surface); }
        state.surface = null;
        state.listeners.forEach(function (h) { DOM.off(h); });
        state.listeners = [];
        return CORE.ok(true);
    }

    var NC = {};
    NC.version = '1.0.0';
    NC.init = init;
    NC.push = push;
    NC.toast = push;
    NC.remove = remove;
    NC.clearAll = clearAll;
    NC.unread = unread;
    NC.history = history;
    NC.toggle = toggle;
    NC.open = open;
    NC.close = close;
    NC.dispose = dispose;

    if (!G.EznK.Shell) { G.EznK.Shell = {}; }
    G.EznK.Shell.notifications = NC;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('shell-notifications', NC);
    }
    LOG.info('js/shell/notification-center.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
