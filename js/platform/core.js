/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 1 - Platform Layer
 *
 *   File    : js/platform/core.js
 *   Module  : EznK.Platform.Core  (alias: EZNT.Platform.Core)
 *   Layer   : L1 平台层（共享契约）
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The shared contract of every L1 module: one identity object, one
 *   status-code set, one result wrapper, one error type, one logger.
 *
 *   hard rule #8 (unified status codes) and #2 (one concept, one
 *   implementation) fail the moment two modules invent their own
 *   `{status,value}` shape. This file is that single shape.
 *
 *   It owns NO browser capability of its own. It never reads/writes
 *   storage, never touches timers, never renders. It is pure contract.
 *
 * ---------------------------------------------------------------------
 * 契约 (CONTRACT)
 * ---------------------------------------------------------------------
 *   1. Idempotent. Loading twice returns the existing Core.
 *   2. attach(name, handles) lets a module bind its table to Core with
 *      an assertion that the load order above it exists. Returns
 *      { status, value } and is how `platform/storage.js` proves
 *      `dom.js` loaded first.
 *   3. `ok` / `fail` never throw. Reserved codes are validated so a
 *      module cannot invent status 999.
 *   4. `asyncOk` / `asyncFail` are Promise producers for the async
 *      channel (files). Callers always receive {status,value}.
 *   5. `log` wraps console with a per-module tag and an in-memory ring
 *      buffer that `dump()` exposes for diagnosis.
 *
 * ---------------------------------------------------------------------
 * 依赖 (DEPENDENCY)
 * ---------------------------------------------------------------------
 *   None. This is the lowest L1 file and loads before every L1 module.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    /* ---- idempotent guard ----------------------------------------- */
    if (G.EznK && G.EznK.Platform && G.EznK.Platform.Core &&
        G.EznK.Platform.Core.__isEZNTCore === true) {
        return;
    }

    /* =================================================================
     * 1. Status codes (section 九) - the ONE definition for all layers
     * ============================================================== */

    var STATUS = Object.freeze({
        OK:        0,
        EINVAL:    1,
        ENOENT:    2,
        EEXIST:    3,
        ENOSPC:    4,
        ENOMEM:    5,
        EFAULT:    6,
        EACCES:    7,
        EBADF:     8,
        EBADIMAGE: 9,
        ENOSYS:    10,
        EBUSY:     11,
        EPOWEROFF: 12,
        EBOUNDS:   13,
        EIO:       14
    });

    var STATUS_NAME = Object.freeze((function () {
        var m = {};
        Object.keys(STATUS).forEach(function (k) { m[STATUS[k]] = k; });
        return m;
    })());

    function nameOf(code) {
        return STATUS_NAME[code] || 'EUNKNOWN';
    }

    function isStatus(code) {
        return typeof code === 'number' && STATUS_NAME[code] !== undefined;
    }

    /* =================================================================
     * 2. Result wrappers
     * ============================================================== */

    /** Success: { status: 0, value }. */
    function ok(value, extra) {
        var r = { status: STATUS.OK, value: value === undefined ? null : value };
        if (extra) { Object.assign(r, extra); }
        return r;
    }

    /** Failure: { status, value: null } - value is never truthy on failure. */
    function fail(code, extra) {
        if (!isStatus(code) || code === STATUS.OK) {
            throw new Error('[EznK/L1] Core.fail needs a non-OK reserved status, got: ' + code);
        }
        var r = { status: code, value: null };
        if (extra) { Object.assign(r, extra); }
        return r;
    }

    /** Turn a thrown error into a failed result, keeping the message. */
    function failFrom(err, code) {
        return fail(code === undefined ? STATUS.EIO : code, {
            error: (err && err.message) ? err.message : String(err || 'unknown error')
        });
    }

    /** Async success. Always resolves (never rejects) with a result. */
    function asyncOk(value, extra) {
        return Promise.resolve(ok(value, extra));
    }

    /** Async failure. Always resolves (never rejects) with a result. */
    function asyncFail(code, extra) {
        return Promise.resolve(fail(code, extra));
    }

    /** Run a value-producing function and wrap outcome as a result. */
    function attempt(fn, defaultCode) {
        try {
            return ok(fn());
        } catch (err) {
            return failFrom(err, defaultCode);
        }
    }

    /** Run an async function and wrap outcome as a result (never rejects). */
    function attemptAsync(fn, defaultCode) {
        return Promise.resolve()
            .then(fn)
            .then(function (v) { return ok(v); })
            .catch(function (e) { return failFrom(e, defaultCode); });
    }

    /** Type guards shared by all L1 modules. */
    function isResult(x) {
        return !!x && typeof x === 'object' && typeof x.status === 'number' &&
            Object.prototype.hasOwnProperty.call(x, 'value');
    }

    function isFunction(x) { return typeof x === 'function'; }
    function isString(x) { return typeof x === 'string'; }
    function isPlainObject(x) {
        if (!x || typeof x !== 'object' || Array.isArray(x)) { return false; }
        var p = Object.getPrototypeOf(x);
        return p === Object.prototype || p === null;
    }

    /* =================================================================
     * 3. Error carrier
     * ============================================================== */

    function EznError(code, message, detail) {
        /* Must work with or without `new` (makeError calls it directly and
         * the module is strict mode, where an unbound `this` is undefined). */
        var self = (this instanceof EznError) ? this : Object.create(EznError.prototype);
        Error.call(self);
        self.name = '[' + nameOf(code) + ']';
        self.code = code;
        self.message = '[' + nameOf(code) + '] ' + (message || '');
        self.detail = (detail === undefined ? null : detail);
        self.isEznError = true;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(self, EznError);
        } else {
            self.stack = new Error(self.message).stack;
        }
        return self;
    }
    EznError.prototype = Object.create(Error.prototype);
    EznError.prototype.constructor = EznError;
    EznError.prototype.toString = function () {
        return this.name + ': ' + this.message;
    };

    function isEznError(x) {
        return !!x && x.isEznError === true;
    }

    /* =================================================================
     * 4. Load-order assertion
     * ============================================================== */

    /** Assert that a named module table exists before this module binds. */
    function requirePlatform(name) {
        var plat = (G.EznK && G.EznK.Platform) || {};
        var t = plat[name];
        if (!t) {
            return fail(STATUS.ENOENT, {
                reason: 'platform module "' + name + '" must be loaded first',
                layer: 'L1'
            });
        }
        return ok(t);
    }

    /** Attach a module table to three walkable namespaces:
     *    EznK.Platform.<name>   (canonical)
     *    EZNT.Platform.<name>   (walkable alias)
     *    EZNT.<name>            (short alias, e.g. EZNT.Storage)  */
    function attach(name, handles) {
        if (!isString(name) || name.length === 0) {
            return fail(STATUS.EINVAL, { reason: 'module name required' });
        }
        if (!handles || typeof handles !== 'object') {
            return fail(STATUS.EINVAL, { reason: 'handles object required' });
        }
        if (typeof G.EZNT !== 'object' || G.EZNT === null) { G.EZNT = {}; }
        if (typeof G.EznK !== 'object' || G.EznK === null) { G.EznK = {}; }
        if (typeof G.EznK.Platform !== 'object' || G.EznK.Platform === null) { G.EznK.Platform = {}; }
        if (!G.EZNT.Platform) { G.EZNT.Platform = {}; }
        if (G.EznK.Platform[name] && G.EznK.Platform[name] !== handles) {
            return fail(STATUS.EEXIST, { reason: 'platform module "' + name + '" already loaded' });
        }
        G.EznK.Platform[name] = handles;
        G.EZNT.Platform[name] = handles;
        G.EZNT[name] = handles;
        return ok(handles);
    }

    /* =================================================================
     * 5. Logger (per-module tag + ring buffer)
     * ============================================================== */

    var LOG_RING = [];
    var LOG_MAX = 500;

    function pushLog(level, tag, message) {
        var entry = {
            level: level,
            tag: tag,
            message: String(message),
            time: (typeof performance !== 'undefined' && performance.now)
                ? Math.round(performance.now()) : Date.now()
        };
        LOG_RING.push(entry);
        if (LOG_RING.length > LOG_MAX) { LOG_RING.shift(); }
        return entry;
    }

    /** Create a tagged logger: log('x') -> console + ring. */
    function createLogger(tag) {
        function out(level) {
            return function () {
                var msg = Array.prototype.join.call(arguments, ' ');
                pushLog(level, tag, msg);
                var c = G.console;
                if (!c) { return; }
                var line = '[' + tag + '] ' + msg;
                if (level === 'error' && c.error) { c.error(line); }
                else if (level === 'warn' && c.warn) { c.warn(line); }
                else if (c.log) { c.log(line); }
            };
        }
        return {
            tag: tag,
            log: out('info'),
            info: out('info'),
            warn: out('warn'),
            error: out('error')
        };
    }

    /** Read the ring buffer (optionally filtered by tag). */
    function dumpLog(tag) {
        if (!tag) { return LOG_RING.slice(0); }
        return LOG_RING.filter(function (e) { return e.tag === tag; });
    }

    function clearLog() {
        LOG_RING.length = 0;
        return ok(true);
    }

    /* =================================================================
     * 6. Public handles
     * ============================================================== */

    var Core = {};

    Core.__isEZNTCore = true;
    Core.version = '1.0.0';

    Core.STATUS = STATUS;
    Core.statusName = nameOf;
    Core.isStatus = isStatus;

    Core.ok = ok;
    Core.fail = fail;
    Core.failFrom = failFrom;
    Core.asyncOk = asyncOk;
    Core.asyncFail = asyncFail;
    Core.attempt = attempt;
    Core.attemptAsync = attemptAsync;

    Core.isResult = isResult;
    Core.isFunction = isFunction;
    Core.isString = isString;
    Core.isPlainObject = isPlainObject;

    Core.EznError = EznError;
    Core.DOMError = EznError; /* DOMError is built from the same carrier */
    Core.isEznError = isEznError;

    Core.requirePlatform = requirePlatform;
    Core.attach = attach;

    Core.createLogger = createLogger;
    Core.dumpLog = dumpLog;
    Core.clearLog = clearLog;

    /* =================================================================
     * 7. Publish
     * ============================================================== */

    if (typeof G.EZNT !== 'object' || G.EZNT === null) { G.EZNT = {}; }
    if (typeof G.EznK !== 'object' || G.EznK === null) { G.EznK = {}; }
    if (typeof G.EznK.Platform !== 'object' || G.EznK.Platform === null) { G.EznK.Platform = {}; }
    if (!G.EZNT.Platform) { G.EZNT.Platform = {}; }

    G.EznK.Platform.Core = Core;
    G.EZNT.Platform.Core = Core;

    G.console.log('[EznK/L1] platform/core.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
