/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 4 - Service Layer
 *
 *   File    : js/service/theme.js
 *   Module  : EznK.Service.theme
 *   Layer   : L4 服务层
 *
 *   The theme service: persists the user's theme choice and broadcasts it
 *   to every surface (desktop, taskbar, windows repaint themselves because
 *   they read res.theme() at paint time).
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.theme) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L4:theme');

    var ui = ezn32.ui;
    var api = ezn32.api;

    function key() {
        var u = api.advapi.GetCurrentUser();
        var name = (u.status === S.OK && u.value) ? u.value.name : 'User';
        return '/Users/' + name + '/Theme.json';
    }

    var systemKey = '/System/Theme.json';

    /** get() -> { status, value: { name, names } } */
    function get() {
        var hal = EznK.Kernel.HAL;
        var cfg = hal.fs.configGet(systemKey, null);
        var name = (cfg.status === S.OK && cfg.value && cfg.value.name) ? cfg.value.name : 'default';
        return CORE.ok({ name: name, names: ui.res.themeNames().value });
    }

    /** set(name) -> { status, value: true }  applies + persists + repaints. */
    function set(name) {
        var r = ui.res.setTheme(name);
        if (r.status !== S.OK) { return r; }
        var hal = EznK.Kernel.HAL;
        hal.fs.configSet(systemKey, { name: name });
        hal.fs.configSet(key(), { name: name });
        repaintAll();
        return CORE.ok(true);
    }

    /** applySaved() - restore the persisted theme at boot. */
    function applySaved() {
        var hal = EznK.Kernel.HAL;
        var u = api.advapi.GetCurrentUser();
        var name = (u.status === S.OK && u.value) ? u.value.name : 'User';
        var userCfg = hal.fs.configGet('/Users/' + name + '/Theme.json', null);
        var sysCfg = hal.fs.configGet(systemKey, null);
        var chosen = (userCfg.status === S.OK && userCfg.value && userCfg.value.name) ? userCfg.value.name
            : ((sysCfg.status === S.OK && sysCfg.value && sysCfg.value.name) ? sysCfg.value.name : 'default');
        var r = ui.res.setTheme(chosen);
        if (r.status !== S.OK) { ui.res.setTheme('default'); }
        repaintAll();
        return CORE.ok(chosen);
    }

    function repaintAll() {
        ui.Desktop.invalidate();
        if (G.EznK.Shell && G.EznK.Shell.taskbar) { G.EznK.Shell.taskbar.invalidate(); }
        ui.Window.List().value.forEach(function (w) { w.invalidate(); });
    }

    function boot() {
        applySaved();
        var srm = EznK.Kernel.SRM;
        if (srm) {
            srm.registerService('theme', {
                init: function () { LOG.info('theme service online'); }
            });
        }
        return CORE.ok(true);
    }

    var ThemeService = {};
    ThemeService.version = '1.0.0';
    ThemeService.boot = boot;
    ThemeService.shutdown = function () { return CORE.ok(true); };
    ThemeService.get = get;
    ThemeService.set = set;
    ThemeService.applySaved = applySaved;
    ThemeService.repaintAll = repaintAll;

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.theme = ThemeService;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('service-theme', ThemeService);
    }
    LOG.info('js/service/theme.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
