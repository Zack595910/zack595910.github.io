/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | L5 Shell Layer
 *
 *   File    : js/shell/lock-screen.js
 *   Module  : EznK.Shell.lockScreen
 *   Layer   : L5 外壳层
 *
 *   The lock / login screen, and the first-run OOBE wizard.
 *
 *   Boot flow (prompt 6.4 step 8):
 *     no accounts  -> OOBE (create the first user)
 *     accounts     -> lock screen (pick a user, enter a password)
 *
 *   Painted full-screen on its own canvas above everything; ASCII only.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Shell && G.EznK.Shell.lockScreen) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L5:lock');

    var ui = ezn32.ui;
    var GDI = ezn32.api.gdi;
    var RES = ui.res;
    var CANVAS = ui.canvas;
    var DOM = G.EznK.Platform.DOM;

    var state = {
        surface: null,
        mode: null,          /* 'oobe' | 'login' | null */
        users: [],
        selected: 0,
        password: '',
        error: '',
        listeners: [],
        resolve: null,
        time: ''
    };

    var FIELD_W = 260;
    var FIELD_H = 30;

    function userService() { return G.EznK.Service && G.EznK.Service.user; }

    /* =================================================================
     * 1. Painting
     * ============================================================== */

    function layout(surface) {
        var cx = surface.width / 2;
        return {
            cx: cx,
            titleY: Math.round(surface.height * 0.22),
            fieldX: Math.round(cx - FIELD_W / 2),
            fieldY: Math.round(surface.height * 0.42),
            buttonY: Math.round(surface.height * 0.42) + FIELD_H + 16
        };
    }

    function paint(surface) {
        var t = RES.theme().value;
        var L = layout(surface);
        var ctx = surface.dc.ctx;

        /* background gradient */
        if (ctx && ctx.createLinearGradient) {
            var g = ctx.createLinearGradient(0, 0, surface.width, surface.height);
            g.addColorStop(0, '#0B3D6E');
            g.addColorStop(1, '#001B33');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, surface.width, surface.height);
        } else {
            GDI.FillRect(surface.dc, 0, 0, surface.width, surface.height, '#0B3D6E');
        }

        GDI.SetTextAlign(surface.dc, 'center');
        GDI.SelectObject(surface.dc, RES.font('monoBig'));
        GDI.SetTextColor(surface.dc, '#FFFFFF');
        GDI.DrawText(surface.dc, 'EZNT', L.cx, L.titleY);

        GDI.SelectObject(surface.dc, RES.font('small'));
        GDI.SetTextColor(surface.dc, 'rgba(255,255,255,0.65)');
        GDI.DrawText(surface.dc, state.time || '', L.cx, L.titleY + 30);

        if (state.mode === 'oobe') {
            GDI.SelectObject(surface.dc, RES.font('ui'));
            GDI.SetTextColor(surface.dc, '#FFFFFF');
            GDI.DrawText(surface.dc, '欢迎。请创建您的账户。', L.cx, L.fieldY - 40);
            GDI.SetTextColor(surface.dc, 'rgba(255,255,255,0.7)');
            GDI.SetTextAlign(surface.dc, 'left');
            GDI.DrawText(surface.dc, '用户名', L.fieldX, L.fieldY - 18);
            GDI.DrawText(surface.dc, '密码', L.fieldX, L.fieldY + 52);
            GDI.SetTextAlign(surface.dc, 'center');
        } else if (state.mode === 'login') {
            var user = state.users[state.selected];
            GDI.SelectObject(surface.dc, RES.font('ui'));
            GDI.SetTextColor(surface.dc, '#FFFFFF');
            GDI.DrawText(surface.dc, user ? user.name : '登录', L.cx, L.fieldY - 40);
            GDI.SetTextColor(surface.dc, 'rgba(255,255,255,0.7)');
            GDI.DrawText(surface.dc, '按回车登录', L.cx, L.fieldY - 20);
        }

        /* password / name field */
        GDI.FillRect(surface.dc, L.fieldX, L.fieldY, FIELD_W, FIELD_H, 'rgba(0,0,0,0.35)');
        GDI.DrawRect(surface.dc, L.fieldX, L.fieldY, FIELD_W, FIELD_H, 'rgba(255,255,255,0.5)', 1);
        GDI.SetTextColor(surface.dc, '#FFFFFF');
        GDI.SelectObject(surface.dc, RES.font('ui'));
        GDI.SetTextAlign(surface.dc, 'left');
        var shown = state.mode === 'oobe' ? state.userName || '' : new Array(state.password.length + 1).join('*');
        GDI.DrawTextTruncated(surface.dc, shown || (state.mode === 'oobe' ? '' : '密码'), L.fieldX + 8, L.fieldY + 9, FIELD_W - 16);

        /* button */
        var bw = 120;
        var bx = Math.round(L.cx - bw / 2);
        GDI.FillRect(surface.dc, bx, L.buttonY, bw, 30, t.accent);
        GDI.SetTextColor(surface.dc, '#FFFFFF');
        GDI.DrawText(surface.dc, state.mode === 'oobe' ? '创建' : '登录', bx + bw / 2, L.buttonY + 8);

        /* error */
        if (state.error) {
            GDI.SetTextColor(surface.dc, '#FF7070');
            GDI.DrawTextTruncated(surface.dc, state.error, L.fieldX, L.buttonY + 42, FIELD_W);
        }
        GDI.SetTextAlign(surface.dc, 'left');
    }

    function invalidate() {
        if (state.surface) { state.surface.invalidate(); }
    }

    /* =================================================================
     * 2. Show / hide
     * ============================================================== */

    function ensureSurface() {
        if (state.surface) { return CORE.ok(state.surface); }
        var hostRes = DOM.byId('eznt-root');
        if (hostRes.status !== S.OK) { return CORE.fail(S.ENOENT, { reason: 'root not found' }); }
        var host = hostRes.value;
        var surfRes = CANVAS.CreateForParent(host, host.clientWidth || 1280, host.clientHeight || 720);
        if (surfRes.status !== S.OK) { return surfRes; }
        state.surface = surfRes.value;
        state.surface.element.style.position = 'fixed';
        state.surface.element.style.left = '0px';
        state.surface.element.style.top = '0px';
        state.surface.element.style.zIndex = '99000';
        state.surface.painter = function (s) { paint(s); };
        bindEvents();
        return CORE.ok(state.surface);
    }

    /**
     * show(mode) -> Promise<{status, value: user}>
     *   mode 'oobe' | 'login'. Resolves when the user is signed in.
     */
    function show(mode) {
        var es = ensureSurface();
        if (es.status !== S.OK) { return Promise.resolve(es); }
        state.mode = mode;
        state.password = '';
        state.userName = '';
        state.error = '';
        var users = userService();
        state.users = users ? users.listUsers().value : [];
        state.selected = 0;
        tickClock();
        invalidate();
        return new Promise(function (resolve) { state.resolve = resolve; });
    }

    function hide() {
        if (state.surface) { CANVAS.dispose(state.surface); }
        state.surface = null;
        state.listeners.forEach(function (h) { DOM.off(h); });
        state.listeners = [];
        state.mode = null;
        return CORE.ok(true);
    }

    function tickClock() {
        var TIME = G.EznK.Platform.Time;
        var c = TIME.clock();
        if (c.status === S.OK) {
            state.time = c.value.ymd + '  ' + c.value.hhmm;
        }
        if (!state._clock) {
            var h = TIME.alignedTo(30000, function () {
                var cc = TIME.clock();
                if (cc.status === S.OK) { state.time = cc.value.ymd + '  ' + cc.value.hhmm; }
                invalidate();
            });
            state._clock = h.status === S.OK ? h.value : null;
        }
    }

    /* =================================================================
     * 3. Input
     * ============================================================== */

    function bindEvents() {
        var el = state.surface.element;
        function on(ev, fn) { var h = DOM.on(el, ev, fn); if (h.status === S.OK) { state.listeners.push(h.value); } }

        on('keydown', function (ev) {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                submit();
                return;
            }
            if (ev.key === 'Backspace') {
                if (state.mode === 'oobe') {
                    state.userName = (state.userName || '').slice(0, -1);
                } else {
                    state.password = state.password.slice(0, -1);
                }
                invalidate();
                return;
            }
            if (ev.key === 'Tab' && state.mode === 'oobe') { return; }
        });

        /* character input via the platform: keydown carries the key */
        on('keypress', function (ev) {
            var ch = ev.key;
            if (!ch || ch.length !== 1) { return; }
            if (!/^[\x20-\x7E]$/.test(ch)) { return; }
            if (state.mode === 'oobe') {
                state.userName = (state.userName || '') + ch;
            } else {
                state.password += ch;
            }
            invalidate();
        });

        /* clicking the button submits */
        on('click', function (ev) {
            var r = el.getBoundingClientRect();
            var L = layout(state.surface);
            var x = ev.clientX - r.left;
            var y = ev.clientY - r.top;
            if (x >= L.cx - 60 && x <= L.cx + 60 && y >= L.buttonY && y <= L.buttonY + 30) {
                submit();
            }
        });
    }

    function submit() {
        var users = userService();
        if (!users) {
            state.error = 'user service unavailable';
            invalidate();
            return;
        }
        var done;
        if (state.mode === 'oobe') {
            var name = (state.userName || '').trim();
            if (!name) { state.error = 'Enter a user name.'; invalidate(); return; }
            done = users.createUser({ name: name, password: 'eznt', admin: true })
                .then(function (r) {
                    if (r.status !== S.OK) { return r; }
                    return users.logon(name, 'eznt');
                });
        } else {
            var user = state.users[state.selected];
            if (!user) { state.error = 'No account selected.'; invalidate(); return; }
            done = users.logon(user.name, state.password);
        }
        Promise.resolve(done).then(function (r) {
            if (r.status !== S.OK) {
                state.error = (r.reason || 'sign in failed').slice(0, 60);
                state.password = '';
                invalidate();
                return;
            }
            var cb = state.resolve;
            state.resolve = null;
            hide();
            if (cb) { cb(CORE.ok(r.value)); }
        });
    }

    function isShowing() { return state.mode !== null; }

    /* =================================================================
     * 4. Lifecycle
     * ============================================================== */

    function boot() {
        LOG.info('lock screen ready');
        return CORE.ok(true);
    }

    function dispose() {
        if (state._clock) { G.EznK.Platform.Time.cancel(state._clock); }
        hide();
        return CORE.ok(true);
    }

    var Lock = {};
    Lock.version = '1.0.0';
    Lock.boot = boot;
    Lock.show = show;
    Lock.hide = hide;
    Lock.isShowing = isShowing;
    Lock.dispose = dispose;

    if (!G.EznK.Shell) { G.EznK.Shell = {}; }
    G.EznK.Shell.lockScreen = Lock;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('shell-lock', Lock);
    }
    LOG.info('js/shell/lock-screen.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
