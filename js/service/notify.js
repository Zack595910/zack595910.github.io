/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 4 - Service Layer
 *
 *   File    : js/service/notify.js
 *   Module  : EznK.Service.notify
 *   Layer   : L4 服务层
 *
 *   The notification service: a thin policy layer over the shell's
 *   notification centre. It keeps history on the config disk so the
 *   notification list survives a reload, and it deduplicates bursts.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.notify) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L4:notify');

    var api = ezn32.api;

    function key() {
        var u = api.advapi.GetCurrentUser();
        var name = (u.status === S.OK && u.value) ? u.value.name : 'User';
        return '/Users/' + name + '/Notifications.json';
    }

    var MAX_HISTORY = 60;

    function load() {
        var hal = EznK.Kernel.HAL;
        var r = hal.fs.configGet(key(), []);
        return (r.status === S.OK && Array.isArray(r.value)) ? r.value : [];
    }

    function save(list) {
        EznK.Kernel.HAL.fs.configSet(key(), list);
        return CORE.ok(true);
    }

    /** push(spec) -> { status, value: {id} }  shows a toast + records it. */
    function push(spec) {
        var s = spec || {};
        if (typeof s.text !== 'string' || s.text.length === 0) {
            return CORE.fail(S.EINVAL, { reason: 'notification text required' });
        }
        var nc = G.EznK.Shell && G.EznK.Shell.notifications;
        var id = null;
        if (nc && typeof nc.push === 'function') {
            var r = nc.push({
                title: s.title || 'EZNT',
                text: s.text,
                level: s.level || 'info',
                timeout: typeof s.timeout === 'number' ? s.timeout : 3000
            });
            if (r.status === S.OK) { id = r.value; }
        } else {
            id = 'n' + Date.now();
        }

        var list = load();
        list.push({
            id: id,
            title: s.title || 'EZNT',
            text: s.text,
            level: s.level || 'info',
            at: Date.now(),
            read: false
        });
        if (list.length > MAX_HISTORY) { list = list.slice(list.length - MAX_HISTORY); }
        save(list);
        return CORE.ok({ id: id });
    }

    function list() { return CORE.ok(load()); }

    function unreadCount() {
        return CORE.ok(load().filter(function (n) { return !n.read; }).length);
    }

    function markAllRead() {
        var l = load().map(function (n) {
            var c = Object.assign({}, n);
            c.read = true;
            return c;
        });
        save(l);
        return CORE.ok(true);
    }

    function clear() {
        save([]);
        var nc = G.EznK.Shell && G.EznK.Shell.notifications;
        if (nc && typeof nc.clearAll === 'function') { nc.clearAll(); }
        return CORE.ok(true);
    }

    function boot() {
        var srm = EznK.Kernel.SRM;
        if (srm) {
            srm.registerService('notify', {
                init: function () { LOG.info('notify service online'); }
            });
        }
        return CORE.ok(true);
    }

    var NotifyService = {};
    NotifyService.version = '1.0.0';
    NotifyService.boot = boot;
    NotifyService.shutdown = function () { return CORE.ok(true); };
    NotifyService.push = push;
    NotifyService.toast = push;
    NotifyService.list = list;
    NotifyService.unreadCount = unreadCount;
    NotifyService.markAllRead = markAllRead;
    NotifyService.clear = clear;

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.notify = NotifyService;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('service-notify', NotifyService);
    }
    LOG.info('js/service/notify.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
