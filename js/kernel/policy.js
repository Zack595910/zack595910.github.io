/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 3 - Kernel Layer (SRM)
 *
 *   File    : js/kernel/policy.js
 *   Module  : EznK.Kernel.Policy
 *   Layer   : L3 内核层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   Group policy and permission checks:
 *
 *     setPolicy(key, value, scope) -> { status, value: true }
 *     getPolicy(key, fallback)     -> { status, value }
 *     isPolicyEnabled(key)         -> boolean   (legacy shape)
 *     listPolicies()               -> { status, value: [{key, value}] }
 *     resetPolicy(key) / resetAll()
 *     can(user, action)            -> { status, value: boolean }
 *     require(action)              -> { status }   EACCES when denied
 *
 *   Policies are stored per scope ('machine' | 'user') and persisted
 *   through HAL -> storage gateway (rule #7). Defaults are shipped in
 *   code so the system behaves deterministically on first boot.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Kernel && G.EznK.Kernel.Policy &&
        G.EznK.Kernel.Policy.__isPolicy === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var SRM = G.SRM;
    if (!CORE || !SRM) {
        throw new Error('[EznK/L3] kernel/policy.js requires core modules');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('EznK/L3:policy');

    /* HAL is resolved lazily so this module works whatever the load order. */
    function hal() {
        var k = G.EznK && G.EznK.Kernel;
        return (k && k.modules && k.modules.hal) || null;
    }
    var STORE_KEY = '/System/Policies.json';

    /* Built-in policies with their secure defaults. */
    var DEFAULTS = {
        'AllowKDInstall': true,
        'AllowSysExecute': false,
        'AllowSysUpdate': false,
        'RequireSysPassword': true,
        'AllowMediaAccess': true,
        'AllowNetwork': true,
        'AllowExternalScripts': false,
        'LockScreenTimeout': 0,
        'ShowErrorDialogs': true,
        'RequireRestorePointBeforeRestore': true
    };

    /* Action -> required capability map. */
    var ACTIONS = {
        'sys.execute': 'AllowSysExecute',
        'sys.update': 'AllowSysUpdate',
        'kd.install': 'AllowKDInstall',
        'media.access': 'AllowMediaAccess',
        'net.fetch': 'AllowNetwork',
        'script.external': 'AllowExternalScripts'
    };

    var policies = Object.create(null);
    var dirty = false;
    var saveTimer = null;

    /* =================================================================
     * 1. Persistence
     * ============================================================== */

    function persist() {
        dirty = true;
        if (saveTimer !== null || !hal()) { return; }
        saveTimer = setTimeout(function () {
            saveTimer = null;
            flush();
        }, 200);
    }

    function flush() {
        dirty = false;
        if (!hal()) { return Promise.resolve(ok(true)); }
        return hal().fs.writeFile(STORE_KEY, JSON.stringify(policies)).then(function (r) {
            if (r.status !== S.OK) { LOG.warn('policy persist failed: ' + (r.reason || r.error)); }
            return r;
        }, function (err) {
            LOG.warn('policy persist failed: ' + err.message);
            return fail(S.EIO);
        });
    }

    function load() {
        Object.keys(DEFAULTS).forEach(function (k) {
            policies[k] = { value: DEFAULTS[k], scope: 'machine', custom: false };
        });
        if (!hal()) { return Promise.resolve(ok(true)); }
        return hal().fs.readFile(STORE_KEY).then(function (r) {
            if (r.status !== S.OK) { return ok(true); }
            try {
                var parsed = JSON.parse(r.value);
                if (parsed && typeof parsed === 'object') {
                    Object.keys(parsed).forEach(function (k) {
                        var v = parsed[k];
                        if (v && typeof v === 'object' && 'value' in v) {
                            policies[k] = { value: v.value, scope: v.scope || 'machine', custom: true };
                        }
                    });
                }
            } catch (err) {
                LOG.warn('policy file corrupt, using defaults');
            }
            return ok(true);
        });
    }

    /* =================================================================
     * 2. API
     * ============================================================== */

    function setPolicy(key, value, scope) {
        if (typeof key !== 'string' || key.length === 0) {
            return fail(S.EINVAL, { reason: 'policy key required' });
        }
        policies[key] = {
            value: value,
            scope: scope === 'user' ? 'user' : 'machine',
            custom: true
        };
        persist();
        LOG.info('policy set: ' + key + ' = ' + JSON.stringify(value));
        return ok(true);
    }

    function getPolicy(key, fallback) {
        if (typeof key !== 'string' || key.length === 0) {
            return fail(S.EINVAL, { reason: 'policy key required' });
        }
        var p = policies[key];
        if (!p) {
            return fallback === undefined ? fail(S.ENOENT, { key: key }) : ok(fallback);
        }
        return ok(p.value);
    }

    /** isPolicyEnabled(key) -> boolean (legacy shape) */
    function isPolicyEnabled(key) {
        var r = getPolicy(key, false);
        return r.status === S.OK ? !!r.value : false;
    }

    function listPolicies() {
        var out = [];
        Object.keys(policies).sort().forEach(function (k) {
            out.push({ key: k, value: policies[k].value, scope: policies[k].scope, custom: policies[k].custom });
        });
        return ok(out);
    }

    function resetPolicy(key) {
        if (!(key in DEFAULTS)) { return fail(S.ENOENT, { key: key }); }
        policies[key] = { value: DEFAULTS[key], scope: 'machine', custom: false };
        persist();
        return ok(true);
    }

    function resetAll() {
        policies = Object.create(null);
        Object.keys(DEFAULTS).forEach(function (k) {
            policies[k] = { value: DEFAULTS[k], scope: 'machine', custom: false };
        });
        persist();
        flush();
        return ok(true);
    }

    /** can(action) -> { status, value: boolean } */
    function can(action) {
        if (typeof action !== 'string') { return fail(S.EINVAL, { reason: 'action required' }); }
        var policyKey = ACTIONS[action];
        if (!policyKey) {
            /* Unknown action: allow, but report it so a typo is visible. */
            return ok(true, { unknownAction: true });
        }
        var r = getPolicy(policyKey, DEFAULTS[policyKey]);
        return ok(r.status === S.OK ? !!r.value : false, { policy: policyKey });
    }

    /** require(action) -> { status, value: true }  EACCES when denied. */
    function requirePolicy(action) {
        var r = can(action);
        if (r.status !== S.OK) { return r; }
        if (!r.value) {
            return fail(S.EACCES, { reason: 'policy denies action: ' + action, policy: r.policy });
        }
        return ok(true);
    }

    /** Snapshot for backup / restore. */
    function snapshot() {
        var out = {};
        Object.keys(policies).forEach(function (k) { out[k] = policies[k].value; });
        return ok(out);
    }

    function restore(snap) {
        if (!snap || typeof snap !== 'object') {
            return fail(S.EINVAL, { reason: 'snapshot object required' });
        }
        resetAll();
        Object.keys(snap).forEach(function (k) {
            policies[k] = { value: snap[k], scope: 'machine', custom: true };
        });
        persist();
        flush();
        return ok(true);
    }

    /* =================================================================
     * 3. Module
     * ============================================================== */

    var Pol = {};
    Pol.__isPolicy = true;
    Pol.version = '1.0.0';
    Pol.STATUS = S;
    Pol.DEFAULTS = Object.freeze(Object.assign({}, DEFAULTS));
    Pol.ACTIONS = Object.freeze(Object.assign({}, ACTIONS));

    Pol.setPolicy = setPolicy;
    Pol.getPolicy = getPolicy;
    Pol.isPolicyEnabled = isPolicyEnabled;
    Pol.listPolicies = listPolicies;
    Pol.resetPolicy = resetPolicy;
    Pol.resetAll = resetAll;
    Pol.can = can;
    Pol.require = requirePolicy;
    Pol.snapshot = snapshot;
    Pol.restore = restore;

    Pol.bind = ['setPolicy', 'getPolicy', 'isPolicyEnabled', 'listPolicies'];

    Pol.boot = function () {
        return load().then(function () {
            LOG.info('policy engine online (' + Object.keys(policies).length + ' policies)');
            return ok(true);
        });
    };
    Pol.shutdown = function () {
        if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
        return dirty ? flush() : ok(true);
    };

    SRM.register('policy', Pol);
    LOG.info('kernel/policy.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
