/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 4 - Service Layer
 *
 *   File    : js/service/resolution.js
 *   Module  : EznK.Service.resolution
 *   Layer   : L4 服务层
 *
 *   The display service: logical resolution and UI scaling. EZNT renders
 *   its shell at a virtual resolution and scales the whole stage, which is
 *   how a 1280x720 desktop fits a smaller browser window without the UI
 *   breaking.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.resolution) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L4:resolution');

    var KEY = '/System/Resolution.json';
    var SCALE_KEY = '/System/Scale.json';

    var PRESETS = [
        { id: '1024x600', width: 1024, height: 600 },
        { id: '1280x720', width: 1280, height: 720 },
        { id: '1366x768', width: 1366, height: 768 },
        { id: '1600x900', width: 1600, height: 900 },
        { id: '1920x1080', width: 1920, height: 1080 },
        { id: 'native', width: 0, height: 0 }
    ];

    var state = { width: 0, height: 0, scale: 1, mode: 'native' };

    function logicalSize() {
        var dom = G.EznK.Platform.DOM;
        var el = dom.byId('eznt-root');
        var w = el.status === S.OK ? el.value.clientWidth : 1280;
        var h = el.status === S.OK ? el.value.clientHeight : 720;
        return { width: w, height: h };
    }

    /** get() -> { status, value: {mode, width, height, scale, presets} } */
    function get() {
        var hal = EznK.Kernel.HAL;
        var cfg = hal.fs.configGet(KEY, null);
        var mode = (cfg.status === S.OK && cfg.value && cfg.value.mode) ? cfg.value.mode : 'native';
        var sc = hal.fs.configGet(SCALE_KEY, null);
        var scale = (sc.status === S.OK && sc.value && typeof sc.value.scale === 'number') ? sc.value.scale : 1;
        return CORE.ok({
            mode: mode,
            width: state.width,
            height: state.height,
            scale: scale,
            presets: PRESETS.slice(0)
        });
    }

    /** setMode(mode) -> { status, value: true } */
    function setMode(mode) {
        var found = null;
        for (var i = 0; i < PRESETS.length; i++) {
            if (PRESETS[i].id === mode) { found = PRESETS[i]; break; }
        }
        if (!found) { return CORE.fail(S.EINVAL, { reason: 'unknown resolution mode: ' + mode }); }
        var hal = EznK.Kernel.HAL;
        hal.fs.configSet(KEY, { mode: mode });
        apply();
        return CORE.ok(true);
    }

    /** setScale(scale) -> { status, value: true } */
    function setScale(scale) {
        if (typeof scale !== 'number' || scale < 0.5 || scale > 3) {
            return CORE.fail(S.EINVAL, { reason: 'scale must be between 0.5 and 3' });
        }
        var hal = EznK.Kernel.HAL;
        hal.fs.configSet(SCALE_KEY, { scale: scale });
        apply();
        return CORE.ok(true);
    }

    /** apply() - recompute the logical size and tell the shell to relayout. */
    function apply() {
        var hal = EznK.Kernel.HAL;
        var cfg = hal.fs.configGet(KEY, null);
        var mode = (cfg.status === S.OK && cfg.value && cfg.value.mode) ? cfg.value.mode : 'native';
        var sc = hal.fs.configGet(SCALE_KEY, null);
        var scale = (sc.status === S.OK && sc.value && typeof sc.value.scale === 'number') ? sc.value.scale : 1;

        var phys = logicalSize();
        var target = null;
        for (var i = 0; i < PRESETS.length; i++) {
            if (PRESETS[i].id === mode) { target = PRESETS[i]; break; }
        }
        var w = phys.width;
        var h = phys.height;
        if (target && target.width > 0) {
            /* fit the chosen resolution inside the real viewport */
            var ratio = Math.min(phys.width / target.width, phys.height / target.height);
            w = Math.round(target.width * ratio);
            h = Math.round(target.height * ratio);
        }
        state.width = Math.round(w * scale);
        state.height = Math.round(h * scale);
        state.scale = scale;
        state.mode = mode;

        var srm = EznK.Kernel.SRM;
        if (srm) { srm.emit('resolution:changed', { width: state.width, height: state.height, scale: scale }); }

        /* relayout shell surfaces */
        var shell = G.EznK.Shell;
        if (shell) {
            if (shell.desktop && shell.desktop.resize) { shell.desktop.resize(); }
            if (shell.taskbar && shell.taskbar.Resize) { shell.taskbar.Resize(); }
            if (ezn32 && ezn32.ui && ezn32.ui.Desktop) { ezn32.ui.Desktop.Resize(); }
        }
        return CORE.ok(true);
    }

    function boot() {
        apply();
        var srm = EznK.Kernel.SRM;
        if (srm) {
            srm.registerService('resolution', {
                init: function () { LOG.info('resolution service online'); }
            });
        }
        /* follow real window resizes */
        var dom = G.EznK.Platform.DOM;
        var TIME = G.EznK.Platform.Time;
        var pending = null;
        dom.on('window', 'resize', function () {
            if (pending) { TIME.cancel(pending); }
            var h = TIME.after(120, function () {
                pending = null;
                apply();
            });
            if (h.status === S.OK) { pending = h.value; }
        });
        return CORE.ok(true);
    }

    var ResolutionService = {};
    ResolutionService.version = '1.0.0';
    ResolutionService.boot = boot;
    ResolutionService.shutdown = function () { return CORE.ok(true); };
    ResolutionService.get = get;
    ResolutionService.setMode = setMode;
    ResolutionService.setScale = setScale;
    ResolutionService.apply = apply;
    ResolutionService.PRESETS = PRESETS.slice(0);

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.resolution = ResolutionService;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('service-resolution', ResolutionService);
    }
    LOG.info('js/service/resolution.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
