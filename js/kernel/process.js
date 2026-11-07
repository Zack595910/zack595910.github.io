/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 3 - Kernel Layer (SRM)
 *
 *   File    : js/kernel/process.js
 *   Module  : EznK.Kernel.Process
 *   Layer   : L3 内核层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The process table (contract 7.3):
 *
 *     registerProcess(name, type, info) -> pid (string)  (legacy)
 *     killProcess(pid)                  -> boolean       (legacy)
 *     listProcesses()                   -> {pid: proc}   (legacy)
 *     getProcess(pid)                   -> proc | null
 *     listProcessesByType(type)         -> {pid: proc}
 *
 *   ---- LEGACY SEMANTICS (exact PTD behaviour) ----
 *   pid = 'proc_' + Date.now() + '_' + random. The returned object has
 *   pid/name/type/info/startTime/status. listProcesses returns the live
 *   table object itself (callers copy it).
 *
 *   The strict API (proc.*) adds owner tracking, exit codes and a kill
 *   callback so the task manager can terminate a window cleanly.
 *
 *   生态隔离 (hard rule #9): processes are tagged with an ecosystem
 *   ('native' | 'script' | 'kd' | 'c2') so one ecosystem's crash can be
 *   isolated to its own subtree.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Kernel && G.EznK.Kernel.Process &&
        G.EznK.Kernel.Process.__isProcess === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var SRM = G.SRM;
    if (!CORE || !SRM) {
        throw new Error('[EznK/L3] kernel/process.js requires core modules');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('EznK/L3:process');

    var table = Object.create(null);
    var killHandlers = Object.create(null);
    var seq = 0;

    var ECOSYSTEMS = ['native', 'script', 'kd', 'c2', 'system'];

    /* =================================================================
     * 1. Legacy contract
     * ============================================================== */

    function makePid() {
        seq += 1;
        return 'proc_' + Date.now() + '_' + Math.floor(Math.random() * 10000) + '_' + seq;
    }

    /** registerProcess(name, type, info) -> pid  (legacy) */
    function registerProcess(name, type, info) {
        var pid = makePid();
        table[pid] = {
            pid: pid,
            name: String(name === undefined ? 'unnamed' : name),
            type: type || 'unknown',
            info: info || {},
            startTime: new Date().toISOString(),
            startedAt: Date.now(),
            status: 'running',
            ecosystem: (info && info.ecosystem) || 'native',
            owner: (info && info.owner) || null,
            exitCode: null
        };
        LOG.info('process started: ' + table[pid].name + ' (' + table[pid].type + ') pid=' + pid);
        emitSafely('process:start', { pid: pid, name: table[pid].name, type: table[pid].type });
        return pid;
    }

    /** killProcess(pid) -> boolean  (legacy) */
    function killProcess(pid) {
        var proc = table[pid];
        if (!proc) { return false; }
        proc.status = 'killed';
        proc.exitCode = -1;
        var handlers = killHandlers[pid];
        if (handlers) {
            handlers.forEach(function (fn) {
                try { fn(proc); } catch (err) {
                    LOG.error('kill handler for ' + pid + ' threw: ' + (err && err.message));
                }
            });
            delete killHandlers[pid];
        }
        delete table[pid];
        LOG.info('process killed: ' + proc.name + ' pid=' + pid);
        emitSafely('process:exit', { pid: pid, name: proc.name, type: proc.type, reason: 'killed' });
        return true;
    }

    /** listProcesses() -> {pid: proc}  (live table, legacy) */
    function listProcesses() {
        return table;
    }

    function getProcess(pid) {
        return table[pid] || null;
    }

    function listProcessesByType(type) {
        var out = {};
        Object.keys(table).forEach(function (pid) {
            if (table[pid].type === type) { out[pid] = table[pid]; }
        });
        return out;
    }

    /* =================================================================
     * 2. Strict API
     * ============================================================== */

    function rsSpawn(spec) {
        if (!spec || typeof spec !== 'object') {
            return fail(S.EINVAL, { reason: 'process spec object required' });
        }
        if (typeof spec.name !== 'string' || spec.name.length === 0) {
            return fail(S.EINVAL, { reason: 'process name required' });
        }
        var eco = spec.ecosystem || 'native';
        if (ECOSYSTEMS.indexOf(eco) === -1) {
            return fail(S.EINVAL, { reason: 'unknown ecosystem: ' + eco, allowed: ECOSYSTEMS.slice(0) });
        }
        var pid = registerProcess(spec.name, spec.type || 'app', {
            ecosystem: eco,
            owner: spec.owner || null,
            args: spec.args || null,
            windowId: spec.windowId || null
        });
        if (typeof spec.onKill === 'function') {
            killHandlers[pid] = [spec.onKill];
        }
        return ok(pid);
    }

    function rsKill(pid) {
        if (typeof pid !== 'string') { return fail(S.EINVAL, { reason: 'pid required' }); }
        if (!table[pid]) { return fail(S.ENOENT, { pid: pid }); }
        killProcess(pid);
        return ok(true);
    }

    function rsList(filter) {
        var f = filter || {};
        var out = [];
        Object.keys(table).forEach(function (pid) {
            var p = table[pid];
            if (f.ecosystem && p.ecosystem !== f.ecosystem) { return; }
            if (f.type && p.type !== f.type) { return; }
            if (f.status && p.status !== f.status) { return; }
            out.push({
                pid: p.pid, name: p.name, type: p.type, ecosystem: p.ecosystem,
                status: p.status, startedAt: p.startedAt, startTime: p.startTime,
                owner: p.owner, exitCode: p.exitCode
            });
        });
        out.sort(function (a, b) { return a.startedAt - b.startedAt; });
        return ok(out);
    }

    /** rsDetail(pid) -> { status, value: proc-copy } */
    function rsDetail(pid) {
        var p = table[pid];
        if (!p) { return fail(S.ENOENT, { pid: pid }); }
        return ok({
            pid: p.pid, name: p.name, type: p.type, ecosystem: p.ecosystem,
            status: p.status, startedAt: p.startedAt, startTime: p.startTime,
            info: p.info, owner: p.owner, exitCode: p.exitCode
        });
    }

    /** Exit a process normally (task finished) - not an error path. */
    function rsExit(pid, code) {
        var p = table[pid];
        if (!p) { return fail(S.ENOENT, { pid: pid }); }
        var handlers = killHandlers[pid];
        delete killHandlers[pid];
        p.status = 'exited';
        p.exitCode = (typeof code === 'number' ? code : 0);
        delete table[pid];
        if (handlers) {
            handlers.forEach(function (fn) { try { fn(p); } catch (_) { /* ignore */ } });
        }
        emitSafely('process:exit', { pid: pid, name: p.name, type: p.type, reason: 'exited', code: p.exitCode });
        return ok(true);
    }

    /** Bind a cleanup callback to a live process. */
    function onKill(pid, fn) {
        if (!table[pid]) { return fail(S.ENOENT, { pid: pid }); }
        if (typeof fn !== 'function') { return fail(S.EINVAL, { reason: 'handler must be a function' }); }
        if (!killHandlers[pid]) { killHandlers[pid] = []; }
        killHandlers[pid].push(fn);
        return ok(true);
    }

    /** Terminate every process of one ecosystem (crash isolation). */
    function killEcosystem(eco) {
        var victims = Object.keys(table).filter(function (pid) {
            return table[pid].ecosystem === eco;
        });
        victims.forEach(killProcess);
        LOG.warn('ecosystem "' + eco + '" isolated: ' + victims.length + ' processes terminated');
        return ok(victims.length);
    }

    /** Counters for the task manager. */
    function stats() {
        var byEco = {};
        var byStatus = {};
        Object.keys(table).forEach(function (pid) {
            var p = table[pid];
            byEco[p.ecosystem] = (byEco[p.ecosystem] || 0) + 1;
            byStatus[p.status] = (byStatus[p.status] || 0) + 1;
        });
        return ok({ total: Object.keys(table).length, byEcosystem: byEco, byStatus: byStatus });
    }

    function emitSafely(topic, payload) {
        try {
            if (typeof SRM.emit === 'function') { SRM.emit(topic, payload); }
        } catch (_) { /* ignore bus errors */ }
    }

    /* =================================================================
     * 3. Module
     * ============================================================== */

    var Proc = {};
    Proc.__isProcess = true;
    Proc.version = '1.0.0';
    Proc.STATUS = S;
    Proc.ECOSYSTEMS = ECOSYSTEMS.slice(0);

    Proc.registerProcess = registerProcess;
    Proc.killProcess = killProcess;
    Proc.listProcesses = listProcesses;
    Proc.getProcess = getProcess;
    Proc.listProcessesByType = listProcessesByType;

    Proc.spawn = rsSpawn;
    Proc.kill = rsKill;
    Proc.list = rsList;
    Proc.detail = rsDetail;
    Proc.exit = rsExit;
    Proc.onKill = onKill;
    Proc.killEcosystem = killEcosystem;
    Proc.stats = stats;

    Proc.bind = ['registerProcess', 'killProcess', 'listProcesses', 'getProcess', 'listProcessesByType'];

    Proc.boot = function () {
        LOG.info('process table online');
        return ok(true);
    };
    Proc.shutdown = function () {
        var pids = Object.keys(table);
        pids.forEach(killProcess);
        return ok(true);
    };

    SRM.register('process', Proc);
    LOG.info('kernel/process.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
