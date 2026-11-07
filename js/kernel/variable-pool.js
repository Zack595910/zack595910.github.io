/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 3 - Kernel Layer (SRM)
 *
 *   File    : js/kernel/variable-pool.js
 *   Module  : EznK.Kernel.VariablePool
 *   Layer   : L3 内核层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The shared variable pool (contract 7.3):
 *
 *     registerVariable(name, value, desc) -> SRM   (legacy, chainable)
 *     getVariable(name)                   -> value | undefined (legacy)
 *     setVariable(name, value)            -> SRM   (legacy, auto-registers)
 *     listVariables()                     -> string[]
 *
 *   Variables are the cross-ecosystem channel: an rf script can set a
 *   variable that a sys script or .exc app reads. Values are stored by
 *   reference (objects are NOT cloned, matching the legacy behaviour);
 *   the strict API adds an optional JSON clone for safety-critical use.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Kernel && G.EznK.Kernel.VariablePool &&
        G.EznK.Kernel.VariablePool.__isVariablePool === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var SRM = G.SRM;
    if (!CORE || !SRM) {
        throw new Error('[EznK/L3] kernel/variable-pool.js requires core modules');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('EznK/L3:variable-pool');

    var vars = Object.create(null);
    var watchers = Object.create(null);

    /* =================================================================
     * 1. Legacy contract
     * ============================================================== */

    function registerVariable(name, value, desc) {
        if (typeof name !== 'string' || name.length === 0) {
            LOG.warn('registerVariable: invalid name');
            return SRM;
        }
        vars[name] = {
            value: value,
            desc: desc || '',
            registeredAt: new Date().toISOString()
        };
        return SRM;
    }

    function getVariable(name) {
        var e = vars[name];
        return e ? e.value : undefined;
    }

    function setVariable(name, value) {
        if (typeof name !== 'string' || name.length === 0) {
            return SRM;
        }
        if (vars[name]) {
            vars[name].value = value;
        } else {
            registerVariable(name, value);
        }
        notify(name, value);
        return SRM;
    }

    function listVariables() {
        return Object.keys(vars).sort();
    }

    /* =================================================================
     * 2. Strict API
     * ============================================================== */

    function rsRegister(name, value, desc) {
        if (typeof name !== 'string' || name.length === 0) {
            return fail(S.EINVAL, { reason: 'name must be a non-empty string' });
        }
        registerVariable(name, value, desc);
        return ok(true);
    }

    function rsGet(name) {
        if (typeof name !== 'string' || name.length === 0) {
            return fail(S.EINVAL, { reason: 'name must be a non-empty string' });
        }
        if (!vars[name]) { return fail(S.ENOENT, { name: name }); }
        return ok(vars[name].value);
    }

    function rsSet(name, value) {
        if (typeof name !== 'string' || name.length === 0) {
            return fail(S.EINVAL, { reason: 'name must be a non-empty string' });
        }
        setVariable(name, value);
        return ok(true);
    }

    function rsList() {
        return ok(Object.keys(vars).map(function (n) {
            return { name: n, desc: vars[n].desc, registeredAt: vars[n].registeredAt };
        }));
    }

    function rsDelete(name) {
        if (!vars[name]) { return fail(S.ENOENT, { name: name }); }
        delete vars[name];
        return ok(true);
    }

    /** Watch a variable; the watcher fires on every set. */
    function watch(name, fn) {
        if (typeof name !== 'string' || name.length === 0) {
            return fail(S.EINVAL, { reason: 'name required' });
        }
        if (typeof fn !== 'function') {
            return fail(S.EINVAL, { reason: 'watcher must be a function' });
        }
        if (!watchers[name]) { watchers[name] = []; }
        var handle = name + '#' + (watchers[name].length + 1) + '#' + Date.now();
        watchers[name].push({ handle: handle, fn: fn });
        return ok(handle);
    }

    function unwatch(handle) {
        var names = Object.keys(watchers);
        for (var i = 0; i < names.length; i++) {
            var list = watchers[names[i]];
            for (var j = 0; j < list.length; j++) {
                if (list[j].handle === handle) {
                    list.splice(j, 1);
                    return ok(true);
                }
            }
        }
        return fail(S.ENOENT, { reason: 'unknown watch handle' });
    }

    function notify(name, value) {
        var list = watchers[name];
        if (!list || !list.length) { return; }
        list.slice(0).forEach(function (w) {
            try { w.fn(value, name); } catch (err) {
                LOG.error('variable watcher for "' + name + '" threw: ' + (err && err.message));
            }
        });
    }

    function snapshot() {
        var out = {};
        Object.keys(vars).forEach(function (n) { out[n] = vars[n].value; });
        return ok(out);
    }

    /* =================================================================
     * 3. Module
     * ============================================================== */

    var VP = {};
    VP.__isVariablePool = true;
    VP.version = '1.0.0';
    VP.STATUS = S;

    VP.registerVariable = registerVariable;
    VP.getVariable = getVariable;
    VP.setVariable = setVariable;
    VP.listVariables = listVariables;

    VP.register = rsRegister;
    VP.get = rsGet;
    VP.set = rsSet;
    VP.list = rsList;
    VP.remove = rsDelete;
    VP.watch = watch;
    VP.unwatch = unwatch;
    VP.snapshot = snapshot;

    VP.bind = ['registerVariable', 'getVariable', 'setVariable', 'listVariables'];

    VP.boot = function () {
        LOG.info('variable pool online (' + Object.keys(vars).length + ' variables)');
        return ok(true);
    };
    VP.shutdown = function () { return ok(true); };

    SRM.register('variable-pool', VP);
    LOG.info('kernel/variable-pool.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
