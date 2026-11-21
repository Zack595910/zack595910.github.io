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

        /* 托盘图标区：在用户按钮左侧，收进托盘的应用图标排在这里 */
        var traySvc = G.EznK.Service && G.EznK.Service.tray;
        var trayCount = traySvc ? traySvc.count() : 0;
        var iconSize = 22;
        var trayIconsW = trayCount ? (trayCount * (iconSize + 6) + 8) : 0;
        state.trayIconsRect = {
            x: state.userRect.x - trayIconsW,
            y: 0,
            w: trayIconsW,
            h: h
        };
        state.trayIcons = [];
        if (traySvc && trayCount) {
            var list2 = traySvc.list().value;
            var sx = state.trayIconsRect.x + 4;
            list2.forEach(function (it, i) {
                state.trayIcons.push({
                    id: it.id,
                    icon: it.icon,
                    name: it.name,
                    rect: { x: sx + i * (iconSize + 6), y: (h - iconSize) / 2,
                            w: iconSize, h: iconSize }
                });
            });
        }

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
        /* 托盘图标 */
        if (state.trayIcons && state.trayIcons.length) {
            state.trayIcons.forEach(function (it) {
                var r = it.rect;
                if (state.hover === 'tray:' + it.id) {
                    GDI.FillRect(surface.dc, r.x, r.y, r.w, r.h, t.surfaceHover);
                }
                GDI.SelectObject(surface.dc, RES.font('ui'));
                GDI.SetTextColor(surface.dc, t.text);
                GDI.SetTextAlign(surface.dc, 'center');
                GDI.DrawText(surface.dc, it.icon, r.x, r.y + 2, r.w);
                GDI.SetTextAlign(surface.dc, 'left');
            });
        }

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
            if (state.trayIcons && state.trayIcons.length) {
                for (var thi = 0; thi < state.trayIcons.length; thi++) {
                    if (inRect(x, y, state.trayIcons[thi].rect)) {
                        hoverline = 'tray:' + state.trayIcons[thi].id;
                        break;
                    }
                }
            }
            if (!hoverline && state.startRect && x < state.startRect.w) { hoverline = 'start'; }
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
            /* y 之前没定义，导致后面 inRect(x, y, ...) 永远失败 ——
             * 点击时钟/托盘全部没反应。 */
            var y = ev.clientY - r.top;
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
            /* 托盘图标：点击还原窗口 */
            if (state.trayIcons && state.trayIcons.length) {
                for (var ti = 0; ti < state.trayIcons.length; ti++) {
                    var tit = state.trayIcons[ti];
                    if (inRect(x, y, tit.rect)) {
                        var traySvc = G.EznK.Service && G.EznK.Service.tray;
                        if (traySvc) { traySvc.activate(tit.id); }
                        return;
                    }
                }
            }
            /* 托盘（通知图标）：点击开关通知中心 */
            if (state.trayRect && inRect(x, y, state.trayRect)) {
                if (EznK.Shell && EznK.Shell.notifications) { EznK.Shell.notifications.toggle(); }
                return;
            }
            /* 时钟：点击弹出时钟面板 */
            if (state.clockRect && inRect(x, y, state.clockRect)) {
                toggleClockPanel();
                return;
            }
        });

        /* ---- 右键：托盘图标弹菜单 ---- */
        on('contextmenu', function (ev) {
            var r2 = el.getBoundingClientRect();
            var cx = ev.clientX - r2.left;
            var cy = ev.clientY - r2.top;
            if (state.trayIcons && state.trayIcons.length) {
                for (var ri = 0; ri < state.trayIcons.length; ri++) {
                    if (inRect(cx, cy, state.trayIcons[ri].rect)) {
                        var ts = G.EznK.Service && G.EznK.Service.tray;
                        if (ts) { ts.showMenu(state.trayIcons[ri].id, ev.clientX, ev.clientY); }
                        if (ev.preventDefault) { ev.preventDefault(); }
                        return;
                    }
                }
            }
            if (ev.preventDefault) { ev.preventDefault(); }
        });
    }

    /** inRect(x, y, rect) - 点是否落在矩形内 */
    function inRect(x, y, r) {
        return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }

    /* =================================================================
     * 3c. 时钟面板
     *     PTD 的托盘时钟：点击显示一个大时钟 + 电子时间 + 日期。
     * ============================================================== */

    var clockState = { panel: null, timer: null };

    function toggleClockPanel() {
        if (clockState.panel) { closeClockPanel(); return; }
        openClockPanel();
    }

    function closeClockPanel() {
        if (clockState.timer) { clearInterval(clockState.timer); clockState.timer = null; }
        if (clockState.panel) {
            try { CANVAS.dispose(clockState.panel); } catch (_) {}
            clockState.panel = null;
        }
    }

    function openClockPanel() {
        var hostRes = DOM.byId('eznt-root');
        if (hostRes.status !== S.OK) { return; }
        var W = 300, H = 300;
        var surfRes = CANVAS.CreateForParent(hostRes.value, W, H);
        if (surfRes.status !== S.OK) { return; }
        var surf = surfRes.value;

        var vw = G.innerWidth || 1280;
        var vh = G.innerHeight || 720;
        var taskH = state.surface ? state.surface.height : 40;
        surf.element.style.position = 'fixed';
        surf.element.style.left = Math.max(0, vw - W) + 'px';
        surf.element.style.top = Math.max(0, vh - taskH - H) + 'px';
        surf.element.style.zIndex = '96000';
        surf.element.style.pointerEvents = 'auto';

        function paintClock(s) {
            var th = RES.theme().value;
            var now = new Date();
            GDI.FillRect(s.dc, 0, 0, W, H, th.surface);
            GDI.DrawRect(s.dc, 0, 0, W, H, th.border, 1);

            /* --- 模拟大时钟 --- */
            var cx = W / 2, cy = 100, R = 72;
            GDI.FillRect(s.dc, cx - R, cy - R, R * 2, R * 2, th.surfaceAlt);
            GDI.DrawRect(s.dc, cx - R, cy - R, R * 2, R * 2, th.accent || th.border, 2);

            /* 12 个刻度 */
            var i, ang;
            for (i = 0; i < 12; i++) {
                ang = (i / 12) * Math.PI * 2;
                var tx = cx + Math.sin(ang) * (R - 12);
                var ty = cy - Math.cos(ang) * (R - 12);
                GDI.FillRect(s.dc, Math.round(tx) - 1, Math.round(ty) - 1, 3, 3, th.textSecondary);
            }

            var hh = now.getHours() % 12, mm = now.getMinutes(), ss = now.getSeconds();
            var hAng = ((hh + mm / 60) / 12) * Math.PI * 2;
            var mAng = ((mm + ss / 60) / 60) * Math.PI * 2;
            var sAng = (ss / 60) * Math.PI * 2;

            /* 时针 */
            line(s.dc, cx, cy, cx + Math.sin(hAng) * (R * 0.5), cy - Math.cos(hAng) * (R * 0.5), th.text, 4);
            /* 分针 */
            line(s.dc, cx, cy, cx + Math.sin(mAng) * (R * 0.72), cy - Math.cos(mAng) * (R * 0.72), th.text, 3);
            /* 秒针 */
            line(s.dc, cx, cy, cx + Math.sin(sAng) * (R * 0.8), cy - Math.cos(sAng) * (R * 0.8), th.accent || '#E81123', 2);

            /* 中心点 */
            GDI.FillRect(s.dc, cx - 4, cy - 4, 8, 8, th.accent || th.text);

            /* --- 电子时间（HH:MM:SS，等宽、大字号） --- */
            var hh2 = String(now.getHours()).padStart(2, '0');
            var mi2 = String(now.getMinutes()).padStart(2, '0');
            var se2 = String(now.getSeconds()).padStart(2, '0');
            var timeStr = hh2 + ':' + mi2 + ':' + se2;
            GDI.SelectObject(s.dc, RES.font('iconLarge'));
            GDI.SetTextColor(s.dc, th.text);
            GDI.SetTextAlign(s.dc, 'left');
            GDI.DrawText(s.dc, timeStr, 16, 196, W - 32);

            /* --- 日期 --- */
            var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            var dateStr = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' +
                          now.getDate() + '日  ' + WEEK[now.getDay()];
            GDI.SelectObject(s.dc, RES.font('ui'));
            GDI.SetTextColor(s.dc, th.textSecondary);
            GDI.DrawText(s.dc, dateStr, 16, 240, W - 32);

            /* --- 提示 --- */
            GDI.SelectObject(s.dc, RES.font('small'));
            GDI.SetTextColor(s.dc, th.textDisabled);
            GDI.DrawText(s.dc, '点击面板关闭', 16, 270, W - 32);
        }

        function line(dc, x1, y1, x2, y2, color, w) {
            /* 用一串小方块画线，避免依赖 GDI 是否提供 DrawLine */
            var steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
            steps = Math.max(1, Math.round(steps));
            for (var k = 0; k <= steps; k++) {
                var px = x1 + (x2 - x1) * (k / steps);
                var py = y1 + (y2 - y1) * (k / steps);
                GDI.FillRect(dc, Math.round(px) - w / 2, Math.round(py) - w / 2, w, w, color);
            }
        }

        surf.painter = function (s) { paintClock(s); };
        surf.element.addEventListener('click', function () { closeClockPanel(); });
        surf.invalidate();

        clockState.panel = surf;
        clockState.timer = setInterval(function () {
            if (clockState.panel) { clockState.panel.invalidate(); }
        }, 1000);
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
    /* 状态与时钟面板：供桌面/测试读取托盘、时钟、用户区域位置 */
    Taskbar.state = function () { return state; };
    Taskbar.openClock = openClockPanel;
    Taskbar.closeClock = closeClockPanel;
    Taskbar.toggleClock = toggleClockPanel;
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
