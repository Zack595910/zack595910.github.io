/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 4 - Service Layer
 *
 *   File    : js/service/window.js
 *   Module  : EznK.Service.window
 *   Layer   : L4 服务层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The window service: the L4 policy layer over Ezn32 UI windows.
 *
 *   It is the ONE place that decides:
 *     - where a new window is placed (cascade, seat-aware)
 *     - how window geometry is remembered per application
 *     - whether a window may open (single-instance apps)
 *     - how windows are restored after a restart
 *
 *   L4 -> L3 -> L2 -> L1: this service talks to Ezn32 API/UI only.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.window) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L4:window');

    var ui = ezn32.ui;
    var api = ezn32.api;

    var CASCADE_STEP = 28;
    var CASCADE_MAX = 8;

    var state = {
        cascadeIndex: 0,
        registry: Object.create(null)   /* appId -> { windows: [id], geometry } */
    };

    /* =================================================================
     * 1. Geometry helpers
     * ============================================================== */

    function desktopSize() {
        var el = G.EznK.Platform.DOM.byId('desktop');
        if (el.status !== S.OK) { return { width: 1280, height: 720 }; }
        return { width: el.value.clientWidth || 1280, height: el.value.clientHeight || 720 };
    }

    /** nextRect(width, height) -> { x, y }  cascaded placement. */
    function nextRect(width, height) {
        var d = desktopSize();
        var taskbar = 40;
        var idx = state.cascadeIndex % CASCADE_MAX;
        state.cascadeIndex += 1;
        var x = 40 + idx * CASCADE_STEP;
        var y = 40 + idx * CASCADE_STEP;
        /* keep inside the work area */
        var maxX = Math.max(0, d.width - width - 20);
        var maxY = Math.max(0, d.height - taskbar - height - 20);
        return { x: Math.min(x, maxX), y: Math.min(y, maxY) };
    }

    /** savedGeometry(appId) - the last geometry used by an app. */
    function savedGeometry(appId) {
        var hal = EznK.Kernel.HAL;
        var user = api.advapi.GetCurrentUser();
        var name = (user.status === S.OK && user.value) ? user.value.name : 'User';
        var key = '/Users/' + name + '/WindowPositions.json';
        var all = hal.fs.configGet(key, null);
        if (all.status !== S.OK || !all.value || !all.value[appId]) { return null; }
        return all.value[appId];
    }

    function rememberGeometry(appId, rect) {
        if (!appId) { return CORE.ok(false); }
        var hal = EznK.Kernel.HAL;
        var user = api.advapi.GetCurrentUser();
        var name = (user.status === S.OK && user.value) ? user.value.name : 'User';
        var key = '/Users/' + name + '/WindowPositions.json';
        var all = hal.fs.configGet(key, null);
        var store = (all.status === S.OK && all.value && typeof all.value === 'object') ? all.value : {};
        store[appId] = rect;
        return hal.fs.configSet(key, store);
    }

    /* =================================================================
     * 2. Open / close
     * ============================================================== */

    /**
     * open(spec) -> { status, value: CtlWindow }
     *   spec: everything ezn32.ui.Window.Create takes, plus:
     *     appId         - identity used for geometry memory
     *     singleInstance - focus the existing window instead of opening
     */
    function open(spec) {
        var s = spec || {};
        var appId = s.appId || null;

        if (appId && s.singleInstance !== false) {
            var existing = findApp(appId);
            if (existing) {
                existing.activate();
                if (existing.minimized) { existing.restore(); }
                return CORE.ok(existing);
            }
        }

        var width = typeof s.width === 'number' ? s.width : 480;
        var height = typeof s.height === 'number' ? s.height : 360;
        var geo = appId ? savedGeometry(appId) : null;
        var pos = (geo && typeof geo.x === 'number')
            ? { x: geo.x, y: geo.y }
            : nextRect(width, height);

        var created = ui.Window.Create({
            id: s.id,
            title: s.title,
            width: geo && geo.width ? geo.width : width,
            height: geo && geo.height ? geo.height : height,
            x: typeof s.x === 'number' ? s.x : pos.x,
            y: typeof s.y === 'number' ? s.y : pos.y,
            icon: s.icon,
            className: s.className,
            closable: s.closable,
            minimizable: s.minimizable,
            maximizable: s.maximizable,
            resizable: s.resizable,
            ecosystem: s.ecosystem,
            owner: s.owner
        });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        if (appId) {
            if (!state.registry[appId]) { state.registry[appId] = { appId: appId, windows: [] }; }
            state.registry[appId].windows.push(win.id);
            win._appId = appId;

            /* remember geometry on close */
            var srm = EznK.Kernel.SRM;
            if (srm) {
                srm.on('window:closed', function (p) {
                    if (p && p.id === win.id) {
                        rememberGeometry(appId, { x: win.x, y: win.y, width: win.width, height: win.height });
                        var rec = state.registry[appId];
                        if (rec) {
                            rec.windows = rec.windows.filter(function (w) { return w !== win.id; });
                        }
                    }
                });
            }
        }
        return CORE.ok(win);
    }

    /** findApp(appId) -> live CtlWindow | null */
    function findApp(appId) {
        var rec = state.registry[appId];
        if (!rec || !rec.windows.length) { return null; }
        for (var i = rec.windows.length - 1; i >= 0; i--) {
            var r = ui.Window.Get(rec.windows[i]);
            if (r.status === S.OK) { return r.value; }
        }
        return null;
    }

    /** close(appId|windowId) -> { status, value: boolean } */
    function close(idOrAppId) {
        var w = ui.Window.Get(idOrAppId);
        if (w.status === S.OK) { return w.value.destroy(); }
        var byApp = findApp(idOrAppId);
        if (byApp) { return byApp.destroy(); }
        return CORE.fail(S.ENOENT, { reason: 'no such window or app: ' + idOrAppId });
    }

    /** closeAll() */
    function closeAll() {
        ui.Window.List().value.forEach(function (w) { w.destroy(); });
        state.registry = Object.create(null);
        state.cascadeIndex = 0;
        return CORE.ok(true);
    }

    /* =================================================================
     * 3. Queries
     * ============================================================== */

    function list() {
        return CORE.ok(ui.Window.List().value.map(function (w) {
            return {
                id: w.id, title: w.title, appId: w._appId || null,
                active: w.active, minimized: w.minimized, maximized: w.maximized,
                x: w.x, y: w.y, width: w.width, height: w.height
            };
        }));
    }

    function count() { return CORE.ok(ui.Window.Count().value); }

    function activeWindow() {
        var list2 = ui.Window.List().value;
        for (var i = 0; i < list2.length; i++) {
            if (list2[i].active && !list2[i].minimized) { return CORE.ok(list2[i]); }
        }
        return CORE.fail(S.ENOENT, { reason: 'no active window' });
    }

    /** focusNext() - alt-tab style cycling. */
    function focusNext() {
        var live = ui.Window.List().value.filter(function (w) { return !w.minimized; });
        if (live.length < 2) {
            if (live.length === 1) { live[0].activate(); }
            return CORE.ok(live.length);
        }
        var idx = -1;
        for (var i = 0; i < live.length; i++) { if (live[i].active) { idx = i; break; } }
        var next = live[(idx + 1 + live.length) % live.length];
        next.activate();
        return CORE.ok(next.id);
    }

    function minimizeAll() {
        var n = 0;
        ui.Window.List().value.forEach(function (w) {
            if (w.minimizable && !w.minimized) { w.minimize(); n += 1; }
        });
        return CORE.ok(n);
    }

    /* =================================================================
     * 4. Lifecycle
     * ============================================================== */

    function boot() {
        var srm = EznK.Kernel.SRM;
        /* a cascade seat per desk session, not per window */
        state.cascadeIndex = 0;
        LOG.info('window service online');
        void srm;
        return CORE.ok(true);
    }

    function shutdown() {
        closeAll();
        return CORE.ok(true);
    }

    var WindowService = {};
    WindowService.version = '1.0.0';
    WindowService.boot = boot;
    WindowService.shutdown = shutdown;

    WindowService.open = open;
    WindowService.close = close;
    WindowService.closeAll = closeAll;
    WindowService.list = list;
    WindowService.count = count;
    WindowService.findApp = findApp;
    WindowService.activeWindow = activeWindow;
    WindowService.focusNext = focusNext;
    WindowService.minimizeAll = minimizeAll;
    WindowService.nextRect = nextRect;
    WindowService.rememberGeometry = rememberGeometry;

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.window = WindowService;

    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('service-window', WindowService);
    }
    LOG.info('js/service/window.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
