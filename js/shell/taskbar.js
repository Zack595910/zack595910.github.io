/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | L5 Shell Layer
 *
 *   File    : js/shell/taskbar.js
 *   Module  : EznK.Shell.Taskbar
 *   Layer   : L5 外壳层
 *
 *   The bottom task bar: Start button, window buttons, clock and the
 *   notification tray. Painted on its own full-width canvas at the bottom
 *   of the screen; window surfaces stack above the desktop but below the
 *   taskbar's z-index.
 *
 *   L5 -> Ezn32 UI (canvas/gdi). The taskbar owns no DOM.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Shell && G.EznK.Shell.taskbar) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L5:taskbar');

    var ui = ezn32.ui;
    var api = ezn32.api;
    var GDI = api.gdi;
    var RES = ui.res;
    var CANVAS = ui.canvas;
    var DOM = G.EznK.Platform.DOM;

    var state = {
        surface: null,
        height: RES.METRICS.taskbarHeight,
        buttons: [],          /* { id, title, icon, x, w, active, minimized } */
        startRect: null,
        trayRect: null,
        clockRect: null,
        startOpen: false,
        clock: '',
        userRect: null,
        hover: null,
        listeners: []
    };

    /* =================================================================
     * 1. Layout
     * ============================================================== */

    function layout(surface) {
        var h = state.height;
        var startW = 76;
        state.startRect = { x: 0, y: 0, w: startW, h: h };

        var clockW = 90;
        var trayW = 90;
        var userW = 128;
        state.clockRect = { x: surface.width - clockW - 8, y: 0, w: clockW, h: h };
        state.trayRect = { x: surface.width - clockW - trayW - 12, y: 0, w: trayW, h: h };
        /* 用户按钮：时钟左侧，显示当前用户，点开是用户菜单 */
        state.userRect = { x: surface.width - clockW - trayW - userW - 18, y: 0, w: userW, h: h };

        var avail = surface.width - startW - clockW - trayW - userW - 60;
        var list = ui.Window.List().value;
        var bw = Math.min(180, Math.max(120, list.length ? Math.floor(avail / Math.max(1, list.length)) - 4 : 150));

        state.buttons = list.map(function (w, i) {
            return {
                id: w.id,
                title: w.title,
                icon: w.icon,
                x: startW + 8 + i * (bw + 4),
                w: bw,
                h: h - 8,
                active: w.active === true,
                minimized: w.minimized === true
            };
        });
    }

    /* =================================================================
     * 2. Painting
     * ============================================================== */

    function paint(surface) {
        var t = RES.theme().value;
        layout(surface);
        var h = state.height;

        GDI.FillRect(surface.dc, 0, 0, surface.width, h, t.taskbar);
        GDI.DrawLine(surface.dc, 0, 0, surface.width, 0, t.border, 1);

        /* Start button */
        var sr = state.startRect;
        var startHover = state.hover === 'start';
        if (state.startOpen || startHover) {
            GDI.FillRect(surface.dc, sr.x + 2, sr.y + 4, sr.w - 4, sr.h - 8, t.taskbarHover);
        }
        GDI.SelectObject(surface.dc, RES.font('iconLarge'));
        GDI.SetTextColor(surface.dc, t.taskbarText);
        GDI.DrawText(surface.dc, '⊞', sr.x + 10, 8);
        GDI.SelectObject(surface.dc, RES.font('ui'));
        GDI.DrawText(surface.dc, '开始', sr.x + 36, 14);

        /* window buttons */
        GDI.SelectObject(surface.dc, RES.font('ui'));
        state.buttons.forEach(function (b) {
            var hovered = state.hover === b.id;
            var bg = b.active ? t.taskbarActive : (hovered ? t.taskbarHover : null);
            if (bg) { GDI.FillRect(surface.dc, b.x, 4, b.w, b.h, bg); }
            if (b.active) {
                GDI.FillRect(surface.dc, b.x, 2, b.w, 3, t.accent);
            }
            GDI.SetTextColor(surface.dc, t.taskbarText);
            GDI.SelectObject(surface.dc, RES.font('icon'));
            GDI.DrawText(surface.dc, b.icon || '🪟', b.x + 6, 12);
            GDI.SelectObject(surface.dc, RES.font('ui'));
            GDI.DrawTextTruncated(surface.dc, b.title, b.x + 28, 13, b.w - 34);
        });

        /* 用户按钮 */
        var ur = state.userRect;
        var userName = '';
        try {
            var advapi = ezn32.api.advapi;
            var cu = advapi.GetCurrentUser();
            userName = (cu.status === S.OK && cu.value) ? cu.value.name : '';
        } catch (_) { userName = ''; }
        if (ur && userName) {
            if (state.hover === 'user') { GDI.FillRect(surface.dc, ur.x, 4, ur.w, ur.h - 8, t.taskbarHover); }
            GDI.SetTextColor(surface.dc, t.taskbarText);
            GDI.SelectObject(surface.dc, RES.font('icon'));
            GDI.DrawText(surface.dc, '👤', ur.x + 8, 12);
            GDI.SelectObject(surface.dc, RES.font('ui'));
            GDI.DrawTextTruncated(surface.dc, userName, ur.x + 30, 13, ur.w - 36);
        }

        /* tray */
        var tr = state.trayRect;
        GDI.SetTextColor(surface.dc, t.taskbarText);
        GDI.SetTextAlign(surface.dc, 'center');
        GDI.DrawText(surface.dc, '⌃', tr.x + tr.w / 2, 12);

        /* clock */
        var cr = state.clockRect;
        GDI.SetTextColor(surface.dc, t.taskbarText);
        GDI.DrawText(surface.dc, state.clock, cr.x + cr.w / 2, 13);

        /* notification badge for unread notifications */
        var notif = EznK.Shell && EznK.Shell.notifications;
        if (notif && typeof notif.unread === 'function') {
            var n = notif.unread();
            if (n > 0) {
                GDI.FillRect(surface.dc, tr.x + tr.w - 14, 8, 14, 14, t.danger);
                GDI.SetTextColor(surface.dc, '#FFFFFF');
                GDI.SelectObject(surface.dc, RES.font('small'));
                GDI.DrawText(surface.dc, String(Math.min(9, n)), tr.x + tr.w - 7, 9);
            }
        }
        GDI.SetTextAlign(surface.dc, 'left');
    }

    function invalidate() {
        if (state.surface) { state.surface.invalidate(); }
    }

    /* =================================================================
     * 3. Interaction
     * ============================================================== */

    function bindEvents() {
        var el = state.surface.element;
        function on(ev, fn) { var h = DOM.on(el, ev, fn); if (h.status === S.OK) { state.listeners.push(h.value); } }

        on('mousemove', function (ev) {
            var r = el.getBoundingClientRect();
            var x = ev.clientX - r.left;
            var y = ev.clientY - r.top;
            var hoverline = null;
            if (state.startRect && x < state.startRect.w) { hoverline = 'start'; }
            else {
                for (var i = 0; i < state.buttons.length; i++) {
                    var b = state.buttons[i];
                    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) { hoverline = b.id; break; }
                }
            }
            if (hoverline !== state.hover) {
                state.hover = hoverline;
                el.style.cursor = hoverline ? 'pointer' : 'default';
                invalidate();
            }
        });

        on('click', function (ev) {
            var r = el.getBoundingClientRect();
            var x = ev.clientX - r.left;
            if (state.startRect && x < state.startRect.w) {
                if (EznK.Shell && EznK.Shell.startMenu) {
                    EznK.Shell.startMenu.toggle();
                }
                return;
            }
            for (var i = 0; i < state.buttons.length; i++) {
                var b = state.buttons[i];
                if (x >= b.x && x < b.x + b.w) {
                    var w = ui.Window.Get(b.id);
                    if (w.status === S.OK) {
                        if (w.value.minimized) { w.value.restore(); }
                        else if (w.value.active) { w.value.minimize(); }
                        else { w.value.activate(); }
                    }
                    invalidate();
                    return;
                }
            }
            if (state.userRect && x >= state.userRect.x && x < state.userRect.x + state.userRect.w) {
                showUserMenu();
                return;
            }
            if (state.clockRect && x >= state.clockRect.x) {
                if (EznK.Shell && EznK.Shell.notifications) { EznK.Shell.notifications.toggle(); }
            }
        });
    }

    /* =================================================================
     * 3b. 用户菜单（锁定 / 切换用户 / 退出登录 / 重启 / 关机）
     * ============================================================== */

    function showUserMenu() {
        var cm = ui.ContextMenu;
        if (!cm) { return; }

        var user = null;
        try {
            var cu = ezn32.api.advapi.GetCurrentUser();
            user = (cu.status === S.OK) ? cu.value : null;
        } catch (_) {}

        var items = [];

        /* 用户名标题（不可点） */
        items.push({ text: (user ? user.name : '用户') + (user && user.admin ? '（管理员）' : ''), icon: '👤', disabled: true });
        items.push({ separator: true });

        items.push({
            text: '🔒  锁定',
            onClick: function () {
                var ls = G.EznK.Shell && G.EznK.Shell.lockScreen;
                if (ls) { ls.show('lock'); }
            }
        });

        items.push({
            text: '🔄  切换用户',
            onClick: function () {
                var ls = G.EznK.Shell && G.EznK.Shell.lockScreen;
                if (ls) { ls.show('login'); }
            }
        });

        items.push({
            text: '🚪  退出登录',
            onClick: function () {
                var ba = G.EznK.Shell && G.EznK.Shell.bootAnimation;
                if (ba && ba.signOut) { ba.signOut(); }
                else {
                    var us = G.EznK.Service && G.EznK.Service.user;
                    if (us) { us.logout(); }
                    var ls = G.EznK.Shell && G.EznK.Shell.lockScreen;
                    if (ls) { ls.show('login'); }
                }
            }
        });

        items.push({ separator: true });

        items.push({
            text: '⚙️  控制面板',
            onClick: function () {
                var cp = G.EznK.Apps && G.EznK.Apps.controlPanel;
                if (cp) { cp.open('personalize'); }
            }
        });

        items.push({
            text: '👤  用户帐户',
            onClick: function () {
                var cp = G.EznK.Apps && G.EznK.Apps.controlPanel;
                if (cp) { cp.open('user'); }
            }
        });

        items.push({ separator: true });

        items.push({
            text: '↻  重启',
            onClick: function () {
                var ba = G.EznK.Shell && G.EznK.Shell.bootAnimation;
                if (ba && ba.restart) { ba.restart(); }
            }
        });

        items.push({
            text: '⏻  关机',
            onClick: function () {
                var ba = G.EznK.Shell && G.EznK.Shell.bootAnimation;
                if (ba && ba.shutdown) { ba.shutdown(); }
            }
        });

        var r = state.surface.element.getBoundingClientRect();
        cm.Show({
            x: Math.round(r.left + state.userRect.x),
            y: Math.round(r.top - 8),
            items: items
        });
    }

    /* =================================================================
     * 4. Init
     * ============================================================== */

    function init() {
        var hostRes = DOM.byId('eznt-root');
        if (hostRes.status !== S.OK) { return CORE.fail(S.ENOENT, { reason: 'root not found' }); }
        var host = hostRes.value;
        var w = host.clientWidth || 1280;

        var surfRes = CANVAS.CreateForParent(host, w, state.height);
        if (surfRes.status !== S.OK) { return surfRes; }
        state.surface = surfRes.value;
        state.surface.element.style.position = 'fixed';
        state.surface.element.style.left = '0px';
        state.surface.element.style.top = (host.clientHeight - state.height) + 'px';
        state.surface.element.style.zIndex = '90000';
        state.surface.painter = function (s) { paint(s); };
        state._surfaceEl = state.surface.element;

        bindEvents();
        bindWindowEvents();
        tick();
        invalidate();
        return CORE.ok(true);
    }

    function bindWindowEvents() {
        var srm = EznK.Kernel.SRM;
        if (!srm) { return; }
        srm.on('window:created', invalidate);
        srm.on('window:closed', invalidate);
        srm.on('window:activated', invalidate);
        srm.on('window:minimized', invalidate);
        srm.on('window:restored', invalidate);
        srm.on('window:title', invalidate);
        srm.on('notify:push', invalidate);
    }

    function tick() {
        var TIME = EznK.Platform.Time;
        var c = TIME.clock();
        if (c.status === S.OK) { state.clock = c.value.hhmm; }
        invalidate();
        /* align the clock to the next minute boundary */
        var h = TIME.alignedTo(1000, function () {
            var cc = TIME.clock();
            if (cc.status === S.OK && cc.value.hhmm !== state.clock) {
                state.clock = cc.value.hhmm;
                invalidate();
            }
        });
        state._clockHandle = h.status === S.OK ? h.value : null;
    }

    function setStartOpen(open) {
        state.startOpen = open === true;
        invalidate();
        return CORE.ok(true);
    }

    function Resize() {
        if (!state.surface) { return CORE.fail(S.ENOENT, { reason: 'taskbar not created' }); }
        var hostRes = DOM.byId('eznt-root');
        if (hostRes.status !== S.OK) { return hostRes; }
        var host = hostRes.value;
        state.surface.element.style.top = (host.clientHeight - state.height) + 'px';
        return CANVAS.resize(state.surface, host.clientWidth, state.height);
    }

    function dispose() {
        state.listeners.forEach(function (h) { DOM.off(h); });
        state.listeners = [];
        if (state._clockHandle) { EznK.Platform.Time.cancel(state._clockHandle); }
        if (state.surface) { CANVAS.dispose(state.surface); }
        state.surface = null;
        return CORE.ok(true);
    }

    var Taskbar = {};
    Taskbar.version = '1.0.0';
    Taskbar.init = init;
    Taskbar.invalidate = invalidate;
    Taskbar.setStartOpen = setStartOpen;
    Taskbar.Resize = Resize;
    Taskbar.dispose = dispose;
    Taskbar.HEIGHT = RES.METRICS.taskbarHeight;
    /* 供开始菜单判断"点击是否在任务栏内" */
    Object.defineProperty(Taskbar, '_surfaceEl', {
        get: function () { return state._surfaceEl || null; }
    });

    if (!G.EznK.Shell) { G.EznK.Shell = {}; }
    G.EznK.Shell.taskbar = Taskbar;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('shell-taskbar', Taskbar);
    }
    LOG.info('js/shell/taskbar.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
