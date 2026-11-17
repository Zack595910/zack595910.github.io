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

    /**
     * clearAll() - 清空全部通知
     *
     * 之前只清掉浮动 toast，没有清 state.history，所以通知中心里的
     * 历史条目一直在，看起来"点清除没反应"。现在两处都清，并把
     * 清空结果写回配置盘（服务层的 clear）。
     */
    function clearAll() {
        /* 1) 浮动 toast */
        state.toasts.forEach(function (t) { if (t.timer) { TIME.cancel(t.timer); } });
        state.toasts = [];

        /* 2) 历史记录 */
        state.history = [];

        /* 3) 落盘（避免刷新后又冒出来） */
        try {
            var svc = G.EznK.Service && G.EznK.Service.notify;
            if (svc && typeof svc.clear === 'function') { svc.clear(); }
            else if (svc && typeof svc.save === 'function') { svc.save([]); }
        } catch (_) {}

        /* 4) 重绘：通知面板和任务栏徽标都要更新 */
        if (state.surface) { state.surface.invalidate(); }
        if (state.panel && state.panel.invalidate) {
            state.panel.invalidate();
        } else if (state.panel && state.panel.surface && state.panel.surface.invalidate) {
            state.panel.surface.invalidate();
        }
        try {
            var tb = G.EznK.Shell && G.EznK.Shell.taskbar;
            if (tb && typeof tb.invalidate === 'function') { tb.invalidate(); }
        } catch (_) {}

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
        /* 用绝对像素定位而不是 right/bottom：
         * 宿主有 transform 时 fixed 的 right/bottom 会失效，
         * 面板会跑到左上角（0,0），看起来"点了没反应"。 */
        var vw = G.innerWidth || 1280;
        var vh = G.innerHeight || 720;
        var panelH = state.height;
        surf.element.style.position = 'fixed';
        surf.element.style.right = '';
        surf.element.style.bottom = '';
        surf.element.style.left = Math.max(0, vw - PANEL_W) + 'px';
        surf.element.style.top = Math.max(0, vh - taskbarH - panelH) + 'px';
        surf.element.style.zIndex = '95001';
        /* 窗口尺寸变化时跟着贴右下角 */
        state._panelReposition = function () {
            if (!state.panel) { return; }
            var w2 = G.innerWidth || 1280;
            var h2 = G.innerHeight || 720;
            var tb = EznK.Shell.taskbar ? EznK.Shell.taskbar.HEIGHT : 40;
            state.panel.element.style.left = Math.max(0, w2 - PANEL_W) + 'px';
            state.panel.element.style.top = Math.max(0, h2 - tb - state.height) + 'px';
        };
        if (!state._resizeBound && G.addEventListener) {
            state._resizeBound = true;
            G.addEventListener('resize', function () {
                if (state._panelReposition) { state._panelReposition(); }
            });
        }
        /* 通知历史面板需要可点击（关闭按钮），保留默认 pointer-events */
        surf.painter = function (s) { paintPanel(s); };
        surf.invalidate();

        /* 面板点击：点"全部清除"就清空；点其他地方不处理 */
        state.clearHover = false;
        surf.element.style.pointerEvents = 'auto';
        surf.element.addEventListener('mousemove', function (ev) {
            var r = surf.element.getBoundingClientRect();
            var lx = ev.clientX - r.left, ly = ev.clientY - r.top;
            var br = clearBtnRect();
            var hov = lx >= br.x && lx <= br.x + br.w && ly >= br.y && ly <= br.y + br.h;
            if (hov !== state.clearHover) {
                state.clearHover = hov;
                surf.invalidate();
            }
        });
        surf.element.addEventListener('click', function (ev) {
            var r = surf.element.getBoundingClientRect();
            var lx = ev.clientX - r.left, ly = ev.clientY - r.top;
            /* 点"全部清除"按钮 */
            var br = clearBtnRect();
            if (lx >= br.x && lx <= br.x + br.w && ly >= br.y && ly <= br.y + br.h) {
                clearAll();
                close();
                return;
            }
            /* 点面板空白处：关闭面板 */
            if (ly > 40) { close(); }
        });

        state.panel = surf;
        return CORE.ok(true);
    }

    function close() {
        if (state.panel) { CANVAS.dispose(state.panel); }
        state.panel = null;
        return CORE.ok(true);
    }

    /* 面板上的"全部清除"按钮矩形（点击判定用） */
    function clearBtnRect() {
        return { x: PANEL_W - 20 - 76, y: 10, w: 76, h: 22 };
    }

    function paintPanel(surface) {
        var t = RES.theme().value;
        GDI.FillRect(surface.dc, 0, 0, PANEL_W, surface.height, t.surface);
        GDI.DrawRect(surface.dc, 0, 0, PANEL_W, surface.height, t.border, 1);
        GDI.SelectObject(surface.dc, RES.font('title'));
        GDI.SetTextColor(surface.dc, t.text);
        GDI.DrawText(surface.dc, '通知中心', 12, 12);

        /* 全部清除按钮 */
        var br = clearBtnRect();
        var hov = state.clearHover === true;
        GDI.FillRect(surface.dc, br.x, br.y, br.w, br.h,
            hov ? '#E81123' : t.surfaceAlt);
        GDI.DrawRect(surface.dc, br.x, br.y, br.w, br.h, t.border, 1);
        GDI.SelectObject(surface.dc, RES.font('small'));
        GDI.SetTextColor(surface.dc, hov ? '#ffffff' : t.text);
        GDI.SetTextAlign(surface.dc, 'center');
        GDI.DrawText(surface.dc, '🗑 全部清除', br.x, br.y + 4, br.w);
        GDI.SetTextAlign(surface.dc, 'left');

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
