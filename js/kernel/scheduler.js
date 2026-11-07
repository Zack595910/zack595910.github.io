/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 3 - Kernel Layer (SRM)
 *
 *   File    : js/kernel/scheduler.js
 *   Module  : EznK.Kernel.Scheduler
 *   Layer   : L3 内核层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The task scheduler (contract 7.3):
 *
 *     addScheduledTask(task)   -> { status, value: task }
 *     listScheduledTasks()     -> { status, value: task[] }
 *     removeScheduledTask(id)  -> { status, value: true }
 *     runTaskNow(id)           -> Promise<{status, value}>
 *     pauseTask(id) / resumeTask(id)
 *
 *   Task shape:
 *     { id?, name, action, args?, interval? (ms) | at? (epoch ms) | once? }
 *
 *   - `action` is an SRM function name (SRM.call) or a function.
 *   - `interval` repeats, `at` fires once at an absolute time, `once`
 *     defaults to true when `at` is present.
 *   - Every scheduled task owns exactly one HAL timer handle; removing or
 *     pausing the task cancels it (hard rule #5: no orphan timers).
 *
 *   Persisted through HAL -> storage gateway; runtime timers are rebuilt
 *   on boot so a scheduled task survives a restart.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Kernel && G.EznK.Kernel.Scheduler &&
        G.EznK.Kernel.Scheduler.__isScheduler === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var SRM = G.SRM;
    if (!CORE || !SRM) {
        throw new Error('[EznK/L3] kernel/scheduler.js requires core modules');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('EznK/L3:scheduler');

    /* HAL is resolved lazily so this module works whatever the load order. */
    function hal() {
        var k = G.EznK && G.EznK.Kernel;
        return (k && k.modules && k.modules.hal) || null;
    }
    var STORE_KEY = '/System/ScheduledTasks.json';

    var tasks = Object.create(null);
    var runtimes = Object.create(null);   /* id -> HAL timer handle */
    var seq = 0;
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
        var serialisable = Object.keys(tasks).map(function (id) {
            var t = tasks[id];
            return {
                id: t.id, name: t.name, action: t.action, actionName: t.actionName,
                args: t.args, interval: t.interval, at: t.at, once: t.once,
                paused: t.paused, createdAt: t.createdAt
            };
        });
        return hal().fs.writeFile(STORE_KEY, JSON.stringify(serialisable)).then(function (r) {
            if (r.status !== S.OK) { LOG.warn('scheduler persist failed'); }
            return r;
        });
    }

    function load() {
        if (!hal()) { return Promise.resolve(ok(true)); }
        return hal().fs.readFile(STORE_KEY).then(function (r) {
            if (r.status !== S.OK) { return ok(true); }
            try {
                var parsed = JSON.parse(r.value);
                if (Array.isArray(parsed)) {
                    parsed.forEach(function (t) {
                        if (!t || !t.id || !t.actionName) { return; }
                        tasks[t.id] = Object.assign({}, t, {
                            action: resolveAction(t.actionName),
                            lastRun: null, runCount: 0
                        });
                    });
                    seq = parsed.length;
                }
            } catch (err) {
                LOG.warn('scheduled task file corrupt');
            }
            return ok(true);
        });
    }

    function resolveAction(name) {
        if (typeof name !== 'string') { return null; }
        return function () {
            return SRM.call(name, undefined);
        };
    }

    /* =================================================================
     * 2. Scheduling
     * ============================================================== */

    function arm(id) {
        var t = tasks[id];
        if (!t || t.paused || !hal()) { return; }
        if (runtimes[id]) { hal().time.cancel(runtimes[id]); runtimes[id] = null; }
        if (!t.interval) { return; }

        var h = hal().time.every(t.interval, function () {
            fire(id);
        }, { stopOnError: false });
        if (h && h.status === S.OK) { runtimes[id] = h.value; }
    }

    /** Fire one execution of a task. */
    function fire(id) {
        var t = tasks[id];
        if (!t) { return; }
        t.runCount = (t.runCount || 0) + 1;
        t.lastRun = new Date().toISOString();
        if (t.once && runtimes[id]) {
            hal().time.cancel(runtimes[id]);
            delete runtimes[id];
        }
        var fn = typeof t.action === 'function' ? t.action : (t.actionName ? resolveAction(t.actionName) : null);
        if (!fn) {
            LOG.warn('task ' + id + ' has no runnable action');
            return;
        }
        try {
            var r = t.args !== undefined && t.args !== null
                ? (SRM.call(t.actionName, t.args))
                : (typeof t.action === 'function' ? t.action() : SRM.call(t.actionName));
            if (r && typeof r.then === 'function') {
                r.then(null, function (err) {
                    LOG.error('async task ' + id + ' failed: ' + (err && err.message));
                });
            }
        } catch (err) {
            LOG.error('task ' + id + ' threw: ' + (err && err.message));
        }
        SRM.emit('task:ran', { id: id, name: t.name });
    }

    /* =================================================================
     * 3. API
     * ============================================================== */

    /** addScheduledTask(task) -> { status, value: task } */
    function addScheduledTask(task) {
        if (!task || typeof task !== 'object') {
            return fail(S.EINVAL, { reason: 'task object required' });
        }
        if (typeof task.name !== 'string' || task.name.length === 0) {
            return fail(S.EINVAL, { reason: 'task name required' });
        }
        var actionName = typeof task.action === 'string' ? task.action : null;
        if (actionName) {
            var info = SRM.getFunctionInfo(actionName);
            if (info === null || info === undefined) {
                /* Legacy behaviour: do not fail, just warn - the function
                 * may register later. */
                LOG.warn('scheduled action not yet registered: ' + actionName);
            }
        }
        if (typeof task.action !== 'function' && !actionName) {
            return fail(S.EINVAL, { reason: 'task.action must be a function or a registered SRM function name' });
        }
        if ((!task.interval || typeof task.interval !== 'number') &&
            (!task.at || typeof task.at !== 'number')) {
            return fail(S.EINVAL, { reason: 'task needs interval (ms) or at (epoch ms)' });
        }
        seq += 1;
        var id = task.id || ('task_' + Date.now() + '_' + seq);
        var rec = {
            id: id,
            name: task.name,
            action: typeof task.action === 'function' ? task.action : resolveAction(actionName),
            actionName: actionName,
            args: task.args === undefined ? null : task.args,
            interval: task.interval || null,
            at: task.at || null,
            once: task.once === true || (!task.interval && !!task.at),
            paused: false,
            createdAt: new Date().toISOString(),
            lastRun: null,
            runCount: 0
        };
        tasks[id] = rec;

        if (task.at && !task.interval) {
            var delay = Math.max(0, task.at - Date.now());
            var h = hal() ? hal().time.after(delay, function () { fire(id); delete runtimes[id]; }) : null;
            if (h && h.status === S.OK) { runtimes[id] = h.value; }
        } else {
            arm(id);
        }

        persist();
        LOG.info('scheduled task added: ' + rec.name + ' (' + id + ')');
        return ok(publicTask(id));
    }

    function publicTask(id) {
        var t = tasks[id];
        if (!t) { return null; }
        return {
            id: t.id, name: t.name, actionName: t.actionName, interval: t.interval,
            at: t.at, once: t.once, paused: t.paused, createdAt: t.createdAt,
            lastRun: t.lastRun, runCount: t.runCount,
            armed: !!runtimes[id]
        };
    }

    function listScheduledTasks() {
        var out = Object.keys(tasks).sort().map(function (id) { return publicTask(id); });
        return ok(out);
    }

    function removeScheduledTask(id) {
        if (!tasks[id]) { return fail(S.ENOENT, { id: id }); }
        if (runtimes[id] && hal()) { hal().time.cancel(runtimes[id]); }
        delete runtimes[id];
        delete tasks[id];
        persist();
        return ok(true);
    }

    /** runTaskNow(id) -> Promise<{status, value: any}> */
    function runTaskNow(id) {
        var t = tasks[id];
        if (!t) { return Promise.resolve(fail(S.ENOENT, { id: id })); }
        var fn = typeof t.action === 'function' ? t.action : resolveAction(t.actionName);
        if (!fn) { return Promise.resolve(fail(S.ENOSYS, { reason: 'task has no action' })); }
        return Promise.resolve()
            .then(function () { return fn(t.args); })
            .then(function (v) { return ok(v); })
            .catch(function (err) { return fail(S.EFAULT, { reason: err && err.message }); });
    }

    function pauseTask(id) {
        var t = tasks[id];
        if (!t) { return fail(S.ENOENT, { id: id }); }
        t.paused = true;
        if (runtimes[id] && hal()) { hal().time.cancel(runtimes[id]); }
        delete runtimes[id];
        return ok(true);
    }

    function resumeTask(id) {
        var t = tasks[id];
        if (!t) { return fail(S.ENOENT, { id: id }); }
        t.paused = false;
        arm(id);
        return ok(true);
    }

    /* =================================================================
     * 4. Module
     * ============================================================== */

    var Sch = {};
    Sch.__isScheduler = true;
    Sch.version = '1.0.0';
    Sch.STATUS = S;

    Sch.addScheduledTask = addScheduledTask;
    Sch.listScheduledTasks = listScheduledTasks;
    Sch.removeScheduledTask = removeScheduledTask;
    Sch.runTaskNow = runTaskNow;
    Sch.pauseTask = pauseTask;
    Sch.resumeTask = resumeTask;

    Sch.bind = ['addScheduledTask', 'listScheduledTasks', 'removeScheduledTask'];

    Sch.boot = function () {
        return load().then(function () {
            Object.keys(tasks).forEach(function (id) { arm(id); });
            LOG.info('scheduler online (' + Object.keys(tasks).length + ' tasks)');
            return ok(true);
        });
    };
    Sch.shutdown = function () {
        Object.keys(runtimes).forEach(function (id) {
            if (hal() && runtimes[id]) { hal().time.cancel(runtimes[id]); }
            delete runtimes[id];
        });
        if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
        return dirty ? flush() : ok(true);
    };

    SRM.register('scheduler', Sch);
    LOG.info('kernel/scheduler.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
