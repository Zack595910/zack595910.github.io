/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 4 - Service Layer
 *
 *   File    : js/service/app-registry.js
 *   Module  : EznK.Service.appRegistry
 *   Layer   : L4 服务层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The application registry: the single catalogue of installed apps.
 *
 *     register(spec)   add/update an app (built-in or installed)
 *     list()           every registered app, sorted by name
 *     get(id)          one app by id
 *     launch(id)       start an app (built-in module or a file entry)
 *     remove(id)       unregister (installed apps only)
 *
 *   Built-in apps register themselves from js/apps/* by calling
 *   register() during load; installed .kd/.exc apps register from the
 *   Program Files area.
 *
 *   launch() resolves in this order:
 *     1. a loaded app module (EznK.Apps[id].open)
 *     2. an entry file -> routed through Ezn32 shell
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.appRegistry) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L4:appRegistry');

    var api = ezn32.api;

    var apps = Object.create(null);

    /* =================================================================
     * 1. Registration
     * ============================================================== */

    function normalize(spec) {
        return {
            id: spec.id,
            name: spec.name || spec.id,
            icon: spec.icon || '[A]',
            category: spec.category || 'other',
            exts: Array.isArray(spec.exts) ? spec.exts.slice(0) : [],
            entry: spec.entry || null,
            builtin: spec.builtin === true,
            description: spec.description || '',
            registeredAt: spec.registeredAt || new Date().toISOString()
        };
    }

    /** register(spec) -> { status, value: app } */
    function register(spec) {
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) {
            return CORE.fail(S.EINVAL, { reason: 'app id required' });
        }
        apps[spec.id] = normalize(spec);
        return CORE.ok(apps[spec.id]);
    }

    /** unregister(id) -> { status, value: boolean } */
    function unregister(id) {
        if (!apps[id]) { return CORE.fail(S.ENOENT, { reason: 'no such app' }); }
        if (apps[id].builtin) { return CORE.fail(S.EACCES, { reason: 'cannot remove a built-in app' }); }
        delete apps[id];
        return CORE.ok(true);
    }

    /* =================================================================
     * 2. Queries
     * ============================================================== */

    function list() {
        return CORE.ok(Object.keys(apps).sort().map(function (k) {
            var a = apps[k];
            return {
                id: a.id, name: a.name, icon: a.icon, category: a.category,
                exts: a.exts.slice(0), entry: a.entry, builtin: a.builtin,
                description: a.description, registeredAt: a.registeredAt
            };
        }));
    }

    function get(id) {
        return apps[id] ? CORE.ok(apps[id]) : CORE.fail(S.ENOENT, { reason: 'no such app: ' + id });
    }

    function exists(id) { return CORE.ok(!!apps[id]); }

    function byExtension(ext) {
        var e = String(ext || '').toLowerCase();
        var found = Object.keys(apps).filter(function (k) {
            return apps[k].exts.indexOf(e) !== -1;
        }).map(function (k) { return apps[k]; });
        return CORE.ok(found);
    }

    function byCategory(cat) {
        return CORE.ok(Object.keys(apps).filter(function (k) {
            return apps[k].category === cat;
        }).map(function (k) { return apps[k]; }));
    }

    /* =================================================================
     * 3. Launch
     * ============================================================== */

    /** launch(id, opts) -> { status, value } | Promise */
    function launch(id, opts) {
        var a = apps[id];
        if (!a) { return CORE.fail(S.ENOENT, { reason: 'no such app: ' + id }); }

        /* 1. built-in implementation already loaded.
         * Apps live under a camelCase key (EznK.Apps.fileManager) while
         * the registry id is kebab-case (file-manager), so look up by the
         * app's own declared id first and by the camel key second. */
        var impl = null;
        var impls = G.EznK.Apps || {};
        if (impls[id] && typeof impls[id].open === 'function') {
            impl = impls[id];
        } else {
            Object.keys(impls).forEach(function (k) {
                var cand = impls[k];
                if (!impl && cand && cand.id === id && typeof cand.open === 'function') {
                    impl = cand;
                }
            });
        }
        if (impl && typeof impl.open === 'function') {
            try {
                return impl.open(opts || {});
            } catch (err) {
                return CORE.fail(S.EFAULT, { reason: 'app threw on open: ' + (err && err.message) });
            }
        }

        /* 2. entry file routed through the shell */
        if (a.entry) {
            return api.shell.ShellExecute(a.entry, opts || {});
        }

        return CORE.fail(S.ENOSYS, { reason: 'app "' + id + '" has no implementation loaded' });
    }

    /* =================================================================
     * 4. Lifecycle
     * ============================================================== */

    function boot() {
        var srm = EznK.Kernel.SRM;
        if (srm) {
            srm.registerService('app-registry', {
                init: function () { LOG.info('application registry online (' + Object.keys(apps).length + ' apps)'); }
            });
        }
        return CORE.ok(true);
    }

    var AppRegistry = {};
    AppRegistry.version = '1.0.0';
    AppRegistry.boot = boot;
    AppRegistry.shutdown = function () { return CORE.ok(true); };

    AppRegistry.register = register;
    AppRegistry.unregister = unregister;
    AppRegistry.list = list;
    AppRegistry.get = get;
    AppRegistry.exists = exists;
    AppRegistry.byExtension = byExtension;
    AppRegistry.byCategory = byCategory;
    AppRegistry.launch = launch;

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.appRegistry = AppRegistry;
    if (!G.EznK.Apps) { G.EznK.Apps = {}; }
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('service-app-registry', AppRegistry);
    }
    LOG.info('js/service/app-registry.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
