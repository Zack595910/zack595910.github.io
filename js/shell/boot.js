/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | L5 Shell Layer
 *
 *   File    : js/shell/boot.js
 *   Module  : EznK.Shell.bootAnimation
 *   Layer   : L5 外壳层
 *
 *   The boot animation and the shutdown / restart / sign-out sequences.
 *   js/boot.js performs the actual start-up steps; this module owns the
 *   VISUAL side (the splash) plus the power transitions the Start menu
 *   offers.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Shell && G.EznK.Shell.bootAnimation) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L5:bootanim');

    var ui = ezn32.ui;
    var GDI = ezn32.api.gdi;
    var RES = ui.res;
    var CANVAS = ui.canvas;
    var DOM = G.EznK.Platform.DOM;
    var TIME = G.EznK.Platform.Time;

    var state = {
        surface: null,
        progress: 0,
        phase: '',
        spinner: 0,
        frame: null
    };

    var SPINNER = ['|', '/', '-', '\\'];

    function paint(surface) {
        var t = RES.theme().value;
        var ctx = surface.dc.ctx;
        if (ctx && ctx.createLinearGradient) {
            var g = ctx.createLinearGradient(0, 0, 0, surface.height);
            g.addColorStop(0, t.desktopGradientStart || '#0078D4');
            g.addColorStop(1, t.desktopGradientEnd || '#004E8C');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, surface.width, surface.height);
        } else {
            GDI.FillRect(surface.dc, 0, 0, surface.width, surface.height, '#0078D4');
        }
        var cx = surface.width / 2;
        var cy = surface.height / 2;
        GDI.SetTextAlign(surface.dc, 'center');
        GDI.SelectObject(surface.dc, RES.font('monoBig'));
        GDI.SetTextColor(surface.dc, '#FFFFFF');
        GDI.DrawText(surface.dc, 'EZNT', cx, cy - 40);

        GDI.SelectObject(surface.dc, RES.font('small'));
        GDI.SetTextColor(surface.dc, 'rgba(255,255,255,0.8)');
        GDI.DrawText(surface.dc, SPINNER[state.spinner % SPINNER.length] + '  ' + (state.phase || 'Starting'), cx, cy);

        /* progress bar */
        var bw = 220;
        var bx = Math.round(cx - bw / 2);
        var by = cy + 24;
        GDI.FillRect(surface.dc, bx, by, bw, 3, 'rgba(255,255,255,0.25)');
        GDI.FillRect(surface.dc, bx, by, Math.round(bw * Math.max(0, Math.min(1, state.progress))), 3, '#FFFFFF');
        GDI.SetTextAlign(surface.dc, 'left');
    }

    /** show() - display the splash. */
    function show() {
        if (state.surface) { return CORE.ok(true); }
        var hostRes = DOM.byId('eznt-root');
        if (hostRes.status !== S.OK) { return hostRes; }
        var host = hostRes.value;
        var surfRes = CANVAS.CreateForParent(host, host.clientWidth || 1280, host.clientHeight || 720);
        if (surfRes.status !== S.OK) { return surfRes; }
        state.surface = surfRes.value;
        state.surface.element.style.position = 'fixed';
        state.surface.element.style.left = '0px';
        state.surface.element.style.top = '0px';
        state.surface.element.style.zIndex = '99500';
        state.surface.painter = function (s) { paint(s); };
        state.progress = 0.1;
        state.phase = 'Starting';
        state.surface.invalidate();

        var h = TIME.every(120, function () {
            state.spinner += 1;
            if (state.surface) { state.surface.invalidate(); }
        });
        state.frame = h.status === S.OK ? h.value : null;
        return CORE.ok(true);
    }

    function setProgress(value, phase) {
        state.progress = typeof value === 'number' ? value : state.progress;
        if (typeof phase === 'string') { state.phase = phase; }
        if (state.surface) { state.surface.invalidate(); }
        return CORE.ok(true);
    }

    function hide() {
        if (state.frame) { TIME.cancel(state.frame); state.frame = null; }
        if (state.surface) { CANVAS.dispose(state.surface); }
        state.surface = null;
        return CORE.ok(true);
    }

    /* =================================================================
     * Power transitions
     * ============================================================== */

    /** signOut() - lock the screen and show the login. */
    function signOut() {
        var users = G.EznK.Service && G.EznK.Service.user;
        var windows = G.EznK.Service && G.EznK.Service.window;
        if (windows) { windows.closeAll(); }
        if (users) { users.logout(); }
        var lock = G.EznK.Shell && G.EznK.Shell.lockScreen;
        if (lock) { return lock.show('login'); }
        return Promise.resolve(CORE.fail(S.ENOSYS, { reason: 'lock screen unavailable' }));
    }

    /** restart() - tear the shell down and boot again. */
    function restart() {
        var windows = G.EznK.Service && G.EznK.Service.window;
        if (windows) { windows.closeAll(); }
        G.EznK.Platform.Storage.config.set('/System/FirstBoot.json', { firstBoot: false, restartedAt: Date.now() });
        show();
        setProgress(0.5, 'Restarting');
        return Promise.resolve(EznK.Boot.run()).then(function (r) {
            setProgress(1, 'Ready');
            hide();
            return r;
        });
    }

    /** shutdown() - close everything and stop the kernel. */
    function shutdown() {
        var windows = G.EznK.Service && G.EznK.Service.window;
        if (windows) { windows.closeAll(); }
        ui.Desktop.Destroy();
        if (G.EznK.Shell.taskbar && G.EznK.Shell.taskbar.dispose) { G.EznK.Shell.taskbar.dispose(); }
        EznK.Kernel.SRM.shutdown();
        show();
        setProgress(0, 'System halted');
        return CORE.ok(true);
    }

    function boot() {
        LOG.info('boot animation ready');
        return CORE.ok(true);
    }

    var BootAnim = {};
    BootAnim.version = '1.0.0';
    BootAnim.boot = boot;
    BootAnim.show = show;
    BootAnim.hide = hide;
    BootAnim.setProgress = setProgress;
    BootAnim.signOut = signOut;
    BootAnim.restart = restart;
    BootAnim.shutdown = shutdown;

    if (!G.EznK.Shell) { G.EznK.Shell = {}; }
    G.EznK.Shell.bootAnimation = BootAnim;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('shell-boot', BootAnim);
    }
    LOG.info('js/shell/boot.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
