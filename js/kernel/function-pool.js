/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 3 - Kernel Layer (SRM)
 *
 *   File    : js/kernel/function-pool.js
 *   Module  : EznK.Kernel.FunctionPool
 *   Layer   : L3 内核层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The system function pool (contract 7.3):
 *
 *     registerFunction(name, fn, desc) -> SRM (legacy, chainable)
 *     call(...)                        -> value | null      (legacy)
 *     listFunctions()                  -> string[]          (legacy)
 *     getFunctionInfo(name)            -> info | null       (legacy)
 *     unregisterFunction(name)         -> SRM               (legacy)
 *     listFunctionsByModule(module)    -> string[]
 *
 *   ---- LEGACY SEMANTICS (exact PTD behaviour) ----
 *   call(module, fn, ...args) and call('module.fn', ...args) both work.
 *   Unknown names return null (never throw). Re-registering warns and
 *   overwrites.
 *
 *   ---- New strict API (fp.*) ----
 *   fp.register / fp.invoke -> Promise<{status,value}> that also awaits
 *   async handlers (used by Ezn32 NT syscall dispatch).
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Kernel && G.EznK.Kernel.FunctionPool &&
        G.EznK.Kernel.FunctionPool.__isFunctionPool === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var SRM = G.SRM;
    if (!CORE || !SRM) {
        throw new Error('[EznK/L3] kernel/function-pool.js requires core modules');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('EznK/L3:function-pool');

    var pool = Object.create(null);

    /* =================================================================
     * 1. Legacy contract
     * ============================================================== */

    /** registerFunction(name, fn, desc) -> SRM */
    function registerFunction(name, fn, desc) {
        if (typeof name !== 'string' || name.length === 0) {
            LOG.warn('registerFunction: invalid name');
            return SRM;
        }
        if (typeof fn !== 'function') {
            LOG.warn('registerFunction: handler is not a function: ' + name);
            return SRM;
        }
        if (pool[name]) {
            LOG.warn('function already exists, overwriting: ' + name);
        }
        pool[name] = {
            fn: fn,
            desc: desc || '',
            registeredAt: new Date().toISOString()
        };
        return SRM;
    }

    /** call() -> value | null  (legacy argument shapes) */
    function call() {
        var args = Array.prototype.slice.call(arguments);
        var funcName = null;
        var callArgs = [];

        if (args.length >= 2 && typeof args[1] === 'string' &&
            pool[args[0] + '.' + args[1]]) {
            funcName = args[0] + '.' + args[1];
            callArgs = args.slice(2);
        } else if (args.length >= 1 && typeof args[0] === 'string' && pool[args[0]]) {
            funcName = args[0];
            callArgs = args.slice(1);
        } else {
            LOG.error('function not found: ' + (args[0] === undefined ? '(none)' : String(args[0])));
            return null;
        }

        var entry = pool[funcName];
        if (!entry) { return null; }
        try {
            return entry.fn.apply(null, callArgs);
        } catch (err) {
            LOG.error('call ' + funcName + ' threw: ' + (err && err.message));
            return null;
        }
    }

    /** listFunctions() -> string[] */
    function listFunctions() {
        return Object.keys(pool).sort();
    }

    /** listFunctionsByModule(module) -> string[] */
    function listFunctionsByModule(moduleName) {
        var prefix = String(moduleName) + '.';
        return Object.keys(pool).filter(function (n) {
            return n.indexOf(prefix) === 0;
        }).sort();
    }

    /** getFunctionInfo(name) -> info | null */
    function getFunctionInfo(name) {
        var e = pool[name];
        if (!e) { return null; }
        return { desc: e.desc, registeredAt: e.registeredAt, arity: e.fn.length };
    }

    /** unregisterFunction(name) -> SRM */
    function unregisterFunction(name) {
        delete pool[name];
        return SRM;
    }

    /* =================================================================
     * 2. Strict API
     * ============================================================== */

    /** fp.register(name, fn, desc) -> { status, value: true } */
    function register(name, fn, desc) {
        if (typeof name !== 'string' || name.length === 0) {
            return fail(S.EINVAL, { reason: 'name must be a non-empty string' });
        }
        if (typeof fn !== 'function') {
            return fail(S.EINVAL, { reason: 'handler must be a function' });
        }
        registerFunction(name, fn, desc);
        return ok(true);
    }

    /** fp.invoke(name, ...args) -> Promise<{status,value}>
     *  Resolves async handlers; wraps throws as EFAULT. */
    function invoke(name) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (typeof name !== 'string' || !pool[name]) {
            return Promise.resolve(fail(S.ENOENT, { reason: 'function not found: ' + name }));
        }
        return Promise.resolve().then(function () {
            return pool[name].fn.apply(null, args);
        }).then(function (v) {
            return ok(v);
        }, function (err) {
            return fail(S.EFAULT, { reason: 'function threw: ' + (err && err.message), function: name });
        });
    }

    /** fp.has(name) -> { status, value: boolean } */
    function has(name) {
        return ok(typeof name === 'string' && !!pool[name]);
    }

    /** fp.count() -> { status, value: number } */
    function count() {
        return ok(Object.keys(pool).length);
    }

    /* =================================================================
     * 3. Module
     * ============================================================== */

    var FP = {};
    FP.__isFunctionPool = true;
    FP.version = '1.0.0';
    FP.STATUS = S;

    FP.registerFunction = registerFunction;
    FP.call = call;
    FP.listFunctions = listFunctions;
    FP.listFunctionsByModule = listFunctionsByModule;
    FP.getFunctionInfo = getFunctionInfo;
    FP.unregisterFunction = unregisterFunction;
    FP.register = register;
    FP.invoke = invoke;
    FP.has = has;
    FP.count = count;

    FP.bind = ['registerFunction', 'call', 'listFunctions', 'listFunctionsByModule',
        'getFunctionInfo', 'unregisterFunction'];

    FP.boot = function () {
        LOG.info('function pool online (' + Object.keys(pool).length + ' functions)');
        return ok(true);
    };
    FP.shutdown = function () { return ok(true); };

    SRM.register('function-pool', FP);
    LOG.info('kernel/function-pool.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
