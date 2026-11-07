/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 3 - Kernel Layer (SRM)
 *
 *   File    : js/kernel/service.js
 *   Module  : EznK.Kernel.Service
 *   Layer   : L3 内核层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The kernel service manager (contract 7.3):
 *
 *     registerService(name, service) -> SRM   (legacy, chainable)
 *     startService(name)             -> boolean
 *     stopService(name)              -> boolean
 *     listServices()                 -> {name: {name, service, status}}
 *
 *   ---- LEGACY SEMANTICS ----
 *   registerService stores the service and calls `service.init()` if it
 *   exists; status starts as 'running'. start/stop flip the status flag
 *   and call the optional `start()` / `stop()` hooks.
 *
 *   Contract 7.3 note: the legacy startService/stopService returned a
 *   boolean. They still do. The strict `svc.*` API returns status codes.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Kernel && G.EznK.Kernel.Service &&
        G.EznK.Kernel.Service.__isService === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var SRM = G.SRM;
    if (!CORE || !SRM) {
        throw new Error('[EznK/L3] kernel/service.js requires core modules');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('EznK/L3:service');

    var services = Object.create(null);

    /* =================================================================
     * 1. Legacy contract
     * ============================================================== */

    function registerService(name, service) {
        if (typeof name !== 'string' || name.length === 0) {
            LOG.warn('registerService: invalid name');
            return SRM;
        }
        services[name] = {
            name: name,
            service: service || {},
            status: 'running',
            registeredAt: new Date().toISOString(),
            error: null
        };
        if (service && typeof service.init === 'function') {
            try {
                service.init();
            } catch (err) {
                services[name].error = err && err.message;
                services[name].status = 'failed';
                LOG.error('service init failed: ' + name + ' - ' + (err && err.message));
            }
        }
        LOG.info('service registered: ' + name);
        return SRM;
    }

    function startService(name) {
        var rec = services[name];
        if (!rec) { return false; }
        if (rec.status === 'running') { return true; }
        try {
            if (rec.service && typeof rec.service.start === 'function') {
                rec.service.start();
            }
            rec.status = 'running';
            rec.error = null;
            LOG.info('service started: ' + name);
            return true;
        } catch (err) {
            rec.status = 'failed';
            rec.error = err && err.message;
            LOG.error('service start failed: ' + name + ' - ' + (err && err.message));
            return false;
        }
    }

    function stopService(name) {
        var rec = services[name];
        if (!rec) { return false; }
        try {
            if (rec.service && typeof rec.service.stop === 'function') {
                rec.service.stop();
            }
            rec.status = 'stopped';
            LOG.info('service stopped: ' + name);
            return true;
        } catch (err) {
            rec.error = err && err.message;
            LOG.error('service stop failed: ' + name + ' - ' + (err && err.message));
            return false;
        }
    }

    function listServices() {
        return services;
    }

    /* =================================================================
     * 2. Strict API
     * ============================================================== */

    function rsRegister(name, service) {
        if (typeof name !== 'string' || name.length === 0) {
            return fail(S.EINVAL, { reason: 'name must be a non-empty string' });
        }
        registerService(name, service);
        return ok(true);
    }

    function rsStart(name) {
        if (!services[name]) { return fail(S.ENOENT, { name: name }); }
        return startService(name) ? ok(true) : fail(S.EFAULT, { reason: 'service failed to start', name: name });
    }

    function rsStop(name) {
        if (!services[name]) { return fail(S.ENOENT, { name: name }); }
        return stopService(name) ? ok(true) : fail(S.EFAULT, { reason: 'service failed to stop', name: name });
    }

    function rsList() {
        var out = [];
        Object.keys(services).forEach(function (n) {
            var r = services[n];
            out.push({
                name: n,
                status: r.status,
                registeredAt: r.registeredAt,
                error: r.error,
                hasInit: typeof r.service.init === 'function',
                hasStart: typeof r.service.start === 'function',
                hasStop: typeof r.service.stop === 'function'
            });
        });
        out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        return ok(out);
    }

    function rsStatus(name) {
        var r = services[name];
        if (!r) { return fail(S.ENOENT, { name: name }); }
        return ok(r.status);
    }

    function startAll() {
        var names = Object.keys(services);
        var failed = [];
        names.forEach(function (n) {
            if (!startService(n)) { failed.push(n); }
        });
        return ok({ total: names.length, failed: failed });
    }

    function stopAll() {
        var names = Object.keys(services);
        names.forEach(function (n) { stopService(n); });
        return ok(names.length);
    }

    /* =================================================================
     * 3. Module
     * ============================================================== */

    var Svc = {};
    Svc.__isService = true;
    Svc.version = '1.0.0';
    Svc.STATUS = S;

    Svc.registerService = registerService;
    Svc.startService = startService;
    Svc.stopService = stopService;
    Svc.listServices = listServices;

    Svc.register = rsRegister;
    Svc.start = rsStart;
    Svc.stop = rsStop;
    Svc.list = rsList;
    Svc.status = rsStatus;
    Svc.startAll = startAll;
    Svc.stopAll = stopAll;

    Svc.bind = ['registerService', 'startService', 'stopService', 'listServices'];

    Svc.boot = function () {
        LOG.info('service manager online (' + Object.keys(services).length + ' services)');
        return ok(true);
    };
    Svc.shutdown = function () {
        Object.keys(services).forEach(function (n) {
            var r = services[n];
            if (r.service && typeof r.service.stop === 'function') {
                try { r.service.stop(); } catch (_) { /* ignore */ }
            }
            r.status = 'stopped';
        });
        return ok(true);
    };

    SRM.register('service', Svc);
    LOG.info('kernel/service.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
