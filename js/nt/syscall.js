/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 NT Layer
 *
 *   File    : js/nt/syscall.js
 *   Module  : EznK.Nt.Syscall  (alias: EZNT.Nt.syscall)
 *   Layer   : Ezn32 NT
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The unified system-call entry point and the NT syscall table.
 *
 *     syscall(id, args)  -> Promise<{status, value}> | {status, value}
 *     register(id, fn, meta)
 *     has(id) / list() / count()
 *
 *   The CALL CHAIN is strictly one-way (prompt section 4.4):
 *
 *     app -> Ezn32 API / Ezn32 UI -> Ezn32 NT -> SRM -> L1 -> browser
 *
 *   A syscall implementation NEVER touches the platform layer directly.
 *   It resolves an SRM method (SRM.call / SRM.regGet / SRM.registerProcess
 *   ...) or an SRM kernel module, so every operation runs through the
 *   kernel. This file is the enforcement point: the syscall table is the
 *   ONLY way Ezn32 API reaches below Ezn32 NT.
 *
 *   Call ids follow the Nt* vocabulary (Nt* / Zw* naming):
 *     'NtCreateFile', 'NtWriteFile', 'NtReadFile', 'NtClose', ...
 *
 *   Return value is always the EznK shape. Async syscalls return a
 *   Promise; callers must be able to await. `decorate` adds ntStatus.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Nt && G.EznK.Nt.Syscall && G.EznK.Nt.Syscall.__isSyscall === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[Ezn32 NT] js/nt/syscall.js requires platform/core.js');
    }

    var NT = (G.EznK && G.EznK.Nt) || {};
    var Status = NT.Status;
    if (!Status) {
        throw new Error('[Ezn32 NT] js/nt/syscall.js requires js/nt/status.js first');
    }

    var S = CORE.STATUS;
    var LOG = CORE.createLogger('Ezn32/NT:syscall');

    var table = Object.create(null);
    var callLog = [];
    var stats = { calls: 0, ok: 0, failed: 0, lastId: null };

    function decorate(r) {
        return Status.decorate(r);
    }

    function sr() {
        var k = G.EznK && G.EznK.Kernel;
        return (k && k.SRM) || G.SRM || null;
    }

    /* =================================================================
     * 1. Registration
     * ============================================================== */

    /**
     * register(id, fn, meta) -> { status, value: true }
     *   fn may be sync or async. It receives the args object and must
     *   return an EznK result or a Promise of one.
     */
    function register(id, fn, meta) {
        if (typeof id !== 'string' || id.length === 0) {
            return CORE.fail(S.EINVAL, { reason: 'syscall id required' });
        }
        if (typeof fn !== 'function') {
            return CORE.fail(S.EINVAL, { reason: 'syscall handler must be a function' });
        }
        if (table[id]) {
            return CORE.fail(S.EEXIST, { reason: 'syscall already registered: ' + id });
        }
        table[id] = { fn: fn, meta: meta || {} };
        return CORE.ok(true);
    }

    function has(id) {
        return CORE.ok(typeof id === 'string' && !!table[id]);
    }

    function list() {
        return CORE.ok(Object.keys(table).sort().map(function (id) {
            return { id: id, desc: table[id].meta.desc || '' };
        }));
    }

    function count() {
        return CORE.ok(Object.keys(table).length);
    }

    /* =================================================================
     * 2. Dispatch
     * ============================================================== */

    /** Record a call for the Ezn32 NT monitor (bounded). */
    function record(id, result) {
        stats.calls += 1;
        stats.lastId = id;
        if (result && result.status === S.OK) { stats.ok += 1; } else { stats.failed += 1; }
        callLog.push({
            id: id,
            status: result ? result.status : S.EFAULT,
            at: Date.now()
        });
        if (callLog.length > 200) { callLog.shift(); }
    }

    /**
     * syscall(id, args) -> { status, value } | Promise<{status,value}>
     *   Sync handlers return synchronously; async handlers return a
     *   Promise. Both paths are decorated with ntStatus.
     *
     *   If the kernel is not running, returns EPOWEROFF - a syscall can
     *   never execute against a stopped kernel.
     */
    function syscall(id, args) {
        if (typeof id !== 'string' || id.length === 0) {
            return decorate(CORE.fail(S.EINVAL, { reason: 'syscall id required' }));
        }
        var entry = table[id];
        if (!entry) {
            var missing = decorate(CORE.fail(S.ENOSYS, { reason: 'unknown syscall: ' + id, syscall: id }));
            record(id, missing);
            return missing;
        }
        var a = args || {};

        var srm = sr();
        if (srm && typeof srm.isRunning === 'function') {
            var run = srm.isRunning();
            if (run && run.status === S.OK && run.value === false) {
                var off = decorate(CORE.fail(S.EPOWEROFF, { reason: 'kernel is not running', syscall: id }));
                record(id, off);
                return off;
            }
        }

        var out;
        try {
            out = entry.fn(a);
        } catch (err) {
            out = decorate(CORE.fail(S.EFAULT, {
                reason: 'syscall ' + id + ' threw: ' + (err && err.message),
                syscall: id
            }));
            record(id, out);
            return out;
        }

        if (out && typeof out.then === 'function') {
            return out.then(function (r) {
                var d = decorate(CORE.isResult(r) ? r : CORE.ok(r));
                record(id, d);
                return d;
            }, function (err) {
                var d = decorate(CORE.fail(S.EFAULT, {
                    reason: 'syscall ' + id + ' rejected: ' + (err && err.message),
                    syscall: id
                }));
                record(id, d);
                return d;
            });
        }

        var res = decorate(CORE.isResult(out) ? out : CORE.ok(out));
        record(id, res);
        return res;
    }

    /** stats() -> { status, value: {...} } */
    function statsInfo() {
        return CORE.ok({
            registered: Object.keys(table).length,
            calls: stats.calls,
            ok: stats.ok,
            failed: stats.failed,
            last: stats.lastId
        });
    }

    /** recent(n) -> { status, value: [{id,status,at}] } */
    function recent(n) {
        var k = (typeof n === 'number' && n > 0) ? n : 20;
        return CORE.ok(callLog.slice(Math.max(0, callLog.length - k)));
    }

    /** reset() - kernel shutdown. */
    function resetStats() {
        stats = { calls: 0, ok: 0, failed: 0, lastId: null };
        callLog = [];
        return CORE.ok(true);
    }

    /* =================================================================
     * 3. Public handle
     * ============================================================== */

    var Sys = {};
    Sys.__isSyscall = true;
    Sys.version = '1.0.0';
    Sys.STATUS = S;

    Sys.register = register;
    Sys.has = has;
    Sys.list = list;
    Sys.count = count;
    Sys.syscall = syscall;
    Sys.stats = statsInfo;
    Sys.recent = recent;
    Sys.resetStats = resetStats;
    Sys.status = Status;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Nt) { G.EznK.Nt = {}; }
    G.EznK.Nt.Syscall = Sys;
    if (!G.EZNT.Nt) { G.EZNT.Nt = {}; }
    G.EZNT.Nt.syscall = Sys;

    LOG.info('js/nt/syscall.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
