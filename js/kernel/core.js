/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 3 - Kernel Layer (SRM)
 *
 *   File    : js/kernel/core.js
 *   Module  : SRM  (global.SRM + EznK.Kernel.SRM)
 *   Layer   : L3 内核层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The System Resource Manager kernel object. It is the single attach
 *   point of L3 and owns:
 *
 *     - lifecycle           boot() / shutdown() / isRunning()
 *     - module registry     every kernel module registers itself here
 *     - the public SRM.* surface required by contract 7.3
 *     - event bus (EventBus cross-cutting concern A)
 *
 *   Contract 7.3 (highest priority) fixes these names and semantics;
 *   legacy sys scripts call them unchanged:
 *
 *     registerFunction / call / listFunctions
 *     registerVariable / getVariable / setVariable
 *     registerProcess / killProcess / listProcesses
 *     sendMessage / broadcast / onMessage
 *     registerService / startService / stopService
 *     regSet / regGet / regDelete / regList
 *     getLog / clearLog
 *     createRestorePoint / restoreToPoint
 *     addScheduledTask
 *
 *   Every one of them is implemented in its own module
 *   (function-pool.js, variable-pool.js, ...) and bound here. If a
 *   module is missing the method still exists and returns ENOSYS, so an
 *   incomplete load can never produce a TypeError in a legacy script.
 *
 * ---------------------------------------------------------------------
 * 硬规矩
 * ============================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.SRM && G.SRM.__isSRM === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[EznK/L3] kernel/core.js requires platform/core.js to load first');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('EznK/L3:Srm');

    /* =================================================================
     * 1. Namespaces
     * ============================================================== */

    if (typeof G.EznK !== 'object' || G.EznK === null) { G.EznK = {}; }
    if (!G.EznK.Kernel) { G.EznK.Kernel = {}; }
    if (!G.EznK.Kernel.modules) { G.EznK.Kernel.modules = Object.create(null); }

    var MODULES = G.EznK.Kernel.modules;

    /* =================================================================
     * 2. Kernel state (single source of truth)
     * ============================================================== */

    var state = {
        version: '1.0.0',
        name: 'SRM',
        fullName: 'System Resource Manager',
        phase: 'created',      /* created -> booting -> running -> stopping -> stopped */
        bootAt: 0,
        bootSeq: 0,
        modulesLoaded: 0
    };

    var bootListeners = [];
    var shutdownListeners = [];

    /* =================================================================
     * 3. Module registration
     * ============================================================== */

    /** Turn a kebab module name into the camel namespace key:
     *  'function-pool' -> 'FunctionPool', 'hal' -> 'Hal'.
     *  A module may declare its own preferred key with table.namespace. */
    function camelKey(name) {
        return name.split('-').map(function (p) {
            return p.charAt(0).toUpperCase() + p.slice(1);
        }).join('');
    }

    /**
     * SRM.registerModule(name, table) -> { status, value: table }
     *   Called by each kernel module file at load time. Mounts the table
     *   at EznK.Kernel.<CamelName> and EznK.Kernel.modules.<name> so both
     *   spellings work ('function-pool' and 'FunctionPool').
     *
     *   table.bind = ['fnA','fnB', ...] lists SRM.* method names this
     *   module owns.
     */
    function registerModule(name, table) {
        if (typeof name !== 'string' || name.length === 0) {
            return fail(S.EINVAL, { reason: 'module name required' });
        }
        if (!table || typeof table !== 'object') {
            return fail(S.EINVAL, { reason: 'module table required' });
        }
        if (MODULES[name] && MODULES[name] !== table) {
            return fail(S.EEXIST, { reason: 'kernel module "' + name + '" already registered' });
        }
        MODULES[name] = table;
        G.EznK.Kernel[name] = table;
        G.EznK.Kernel[table.namespace || camelKey(name)] = table;
        state.modulesLoaded += 1;
        LOG.info('module registered: ' + name + ' (v' + (table.version || '?') + ')');
        return ok(table);
    }

    /** SRM.module(name) -> { status, value: table } */
    function getModule(name) {
        var t = MODULES[name];
        return t ? ok(t) : fail(S.ENOENT, { reason: 'kernel module "' + name + '" not loaded' });
    }

    /** SRM.listModules() -> { status, value: string[] } */
    function listModules() {
        return ok(Object.keys(MODULES).sort());
    }

    /* =================================================================
     * 4. ENOSYS stubs (contract surface present even when incomplete)
     * ============================================================== */

    function stub(method) {
        return function () {
            return fail(S.ENOSYS, {
                reason: 'SRM.' + method + ' is not available (kernel module not loaded)',
                method: method
            });
        };
    }

    /* =================================================================
     * 5. EventBus (cross-cutting concern A)
     *
     *   Cross-layer communication goes through events. The bus lives in
     *   the kernel because every layer has to reach it, and it is
     *   synchronous so a handler cannot silently miss an event.
     * ============================================================== */

    var bus = {
        handlers: Object.create(null),
        nextId: 0
    };

    /** on(topic, fn) -> { status, value: handle } */
    function on(topic, fn) {
        if (typeof topic !== 'string' || topic.length === 0) {
            return fail(S.EINVAL, { reason: 'topic must be a non-empty string' });
        }
        if (typeof fn !== 'function') {
            return fail(S.EINVAL, { reason: 'handler must be a function' });
        }
        bus.nextId += 1;
        var handle = 'ev' + bus.nextId;
        if (!bus.handlers[topic]) { bus.handlers[topic] = []; }
        bus.handlers[topic].push({ handle: handle, fn: fn });
        return ok(handle);
    }

    /** once(topic, fn) -> { status, value: handle } */
    function once(topic, fn) {
        var h = on(topic, function () {
            off(h.value);
            return fn.apply(null, arguments);
        });
        return h;
    }

    /** off(handle) -> { status, value: boolean } */
    function off(handle) {
        if (typeof handle !== 'string') {
            return fail(S.EINVAL, { reason: 'handle required' });
        }
        var topics = Object.keys(bus.handlers);
        for (var i = 0; i < topics.length; i++) {
            var list = bus.handlers[topics[i]];
            for (var j = 0; j < list.length; j++) {
                if (list[j].handle === handle) {
                    list.splice(j, 1);
                    return ok(true);
                }
            }
        }
        return fail(S.ENOENT, { reason: 'unknown event handle' });
    }

    /** emit(topic, payload) -> { status, value: {delivered, errors} } */
    function emit(topic, payload) {
        if (typeof topic !== 'string' || topic.length === 0) {
            return fail(S.EINVAL, { reason: 'topic must be a non-empty string' });
        }
        var list = bus.handlers[topic];
        if (!list || list.length === 0) {
            return ok({ delivered: 0, errors: 0 });
        }
        var snapshot = list.slice(0);
        var errors = 0;
        for (var i = 0; i < snapshot.length; i++) {
            try {
                snapshot[i].fn(payload, { topic: topic, handle: snapshot[i].handle });
            } catch (err) {
                errors += 1;
                LOG.error('event handler for "' + topic + '" threw: ' + (err && err.message));
            }
        }
        return ok({ delivered: snapshot.length, errors: errors });
    }

    /** subscribe alias kept for readability */
    function topics() {
        return ok(Object.keys(bus.handlers).map(function (t) {
            return { topic: t, handlers: bus.handlers[t].length };
        }));
    }

    /* =================================================================
     * 6. Lifecycle
     * ============================================================== */

    /**
     * SRM.boot() -> Promise<{status, value: info}>
     *   Probes HAL (L1 reachable), runs every module's boot hook in
     *   dependency order, then flips the kernel to running.
     */
    function boot() {
        if (state.phase === 'running') {
            return Promise.resolve(ok(info().value));
        }
        if (state.phase === 'booting') {
            return fail(S.EBUSY, { reason: 'kernel is booting' });
        }
        state.phase = 'booting';
        state.bootAt = Date.now();
        state.bootSeq += 1;

        var hal = MODULES.hal;
        if (hal && typeof hal.probe === 'function') {
            var p = hal.probe();
            if (p.status !== S.OK) {
                state.phase = 'created';
                return Promise.resolve(fail(S.ENOSYS, {
                    reason: 'kernel cannot boot: ' + (p.reason || 'platform incomplete'),
                    detail: p
                }));
            }
        }

        var order = bootOrder();
        var chain = Promise.resolve(ok(true));
        order.forEach(function (name) {
            chain = chain.then(function (prev) {
                if (prev.status !== S.OK) { return prev; }
                var mod = MODULES[name];
                if (!mod || typeof mod.boot !== 'function') { return ok(true); }
                var r;
                try {
                    r = mod.boot();
                } catch (err) {
                    return fail(S.EFAULT, { reason: 'module ' + name + ' boot threw: ' + (err && err.message) });
                }
                return r && typeof r.then === 'function' ? r : Promise.resolve(r);
            });
        });

        return chain.then(function (r) {
            if (r.status !== S.OK) {
                state.phase = 'created';
                return r;
            }
            state.phase = 'running';
            LOG.info('SRM running (modules=' + state.modulesLoaded + ')');
            bootListeners.slice(0).forEach(function (fn) {
                try { fn(info().value); } catch (err) { LOG.error('boot listener threw: ' + err.message); }
            });
            emit('kernel:booted', info().value);
            return ok(info().value);
        });
    }

    /** Boot order - explicit, never inferred (hard rule #5). */
    function bootOrder() {
        return [
            'hal', 'log', 'registry', 'variable-pool', 'function-pool',
            'process', 'message', 'service', 'policy', 'restore', 'scheduler'
        ];
    }

    /** SRM.shutdown() -> { status, value: true } */
    function shutdown() {
        if (state.phase !== 'running' && state.phase !== 'booting') {
            return fail(S.EBUSY, { reason: 'kernel is not running' });
        }
        state.phase = 'stopping';
        var reversed = bootOrder().reverse();
        var errors = [];
        reversed.forEach(function (name) {
            var mod = MODULES[name];
            if (!mod || typeof mod.shutdown !== 'function') { return; }
            try {
                var r = mod.shutdown();
                if (r && r.status !== undefined && r.status !== S.OK) {
                    errors.push({ module: name, status: r.status });
                }
            } catch (err) {
                errors.push({ module: name, error: err && err.message });
            }
        });
        state.phase = 'stopped';
        emit('kernel:shutdown', { errors: errors.length });
        shutdownListeners.slice(0).forEach(function (fn) {
            try { fn(); } catch (err) { LOG.error('shutdown listener threw: ' + err.message); }
        });
        LOG.info('SRM stopped');
        return ok(true, errors.length ? { errors: errors } : undefined);
    }

    /** SRM.restart() -> Promise<{status, value: info}> */
    function restart() {
        shutdown();
        state.phase = 'created';
        return boot();
    }

    function isRunning() {
        return ok(state.phase === 'running');
    }

    function onBoot(fn) {
        if (typeof fn !== 'function') { return fail(S.EINVAL, { reason: 'listener must be a function' }); }
        bootListeners.push(fn);
        if (state.phase === 'running') {
            try { fn(info().value); } catch (err) { LOG.error('boot listener threw: ' + err.message); }
        }
        return ok(true);
    }

    function onShutdown(fn) {
        if (typeof fn !== 'function') { return fail(S.EINVAL, { reason: 'listener must be a function' }); }
        shutdownListeners.push(fn);
        return ok(true);
    }

    function info() {
        return ok({
            name: state.fullName,
            version: state.version,
            phase: state.phase,
            bootAt: state.bootAt,
            bootSeq: state.bootSeq,
            modules: Object.keys(MODULES).length,
            uptime: state.bootAt ? Date.now() - state.bootAt : 0
        });
    }

    /* =================================================================
     * 7. The SRM object (contract 7.3 surface)
     * ============================================================== */

    var SRM = {};

    SRM.__isSRM = true;
    SRM.version = state.version;
    SRM.name = state.name;
    SRM.fullName = state.fullName;
    SRM.STATUS = S;

    /* lifecycle */
    SRM.boot = boot;
    SRM.shutdown = shutdown;
    SRM.restart = restart;
    SRM.isRunning = isRunning;
    SRM.info = info;
    SRM.onBoot = onBoot;
    SRM.onShutdown = onShutdown;

    /* module registry */
    SRM.registerModule = registerModule;
    SRM.register = register;
    SRM.bindMethods = bindMethods;
    SRM.module = getModule;
    SRM.listModules = listModules;

    /* event bus */
    SRM.on = on;
    SRM.once = once;
    SRM.off = off;
    SRM.emit = emit;
    SRM.topics = topics;

    /* every contract method exists from the first millisecond; modules
     * overwrite their own methods during registration. */
    var CONTRACT = [
        'registerFunction', 'call', 'listFunctions', 'unregisterFunction', 'getFunctionInfo',
        'registerVariable', 'getVariable', 'setVariable', 'listVariables',
        'registerProcess', 'killProcess', 'listProcesses', 'getProcess',
        'sendMessage', 'broadcast', 'onMessage', 'getMessages', 'clearMessages',
        'registerService', 'startService', 'stopService', 'listServices',
        'regSet', 'regGet', 'regDelete', 'regList',
        'getLog', 'clearLog',
        'createRestorePoint', 'restoreToPoint', 'listRestorePoints',
        'addScheduledTask', 'listScheduledTasks', 'removeScheduledTask',
        'setPolicy', 'getPolicy', 'isPolicyEnabled', 'listPolicies',
        'getInfo'
    ];
    CONTRACT.forEach(function (m) {
        SRM[m] = stub(m);
    });

    /* SRM.getInfo must work before modules bind. */
    SRM.getInfo = function () { return info().value; };

    /** Bind a module's exported methods onto SRM.* */
    function bindMethods(table) {
        if (!table || !Array.isArray(table.bind)) { return ok(0); }
        var bound = 0;
        table.bind.forEach(function (name) {
            if (typeof table[name] === 'function') {
                SRM[name] = table[name];
                bound += 1;
            }
        });
        return ok(bound);
    }

    /** registerModuleAndBind - the normal path for a kernel module file. */
    function register(name, table) {
        var r = registerModule(name, table);
        if (r.status !== S.OK) { return r; }
        bindMethods(table);
        return r;
    }

    /* attach HAL immediately when present (it may load before core) */
    var hal = MODULES.hal || (G.EznK.Kernel && G.EznK.Kernel.HAL);
    if (hal) { SRM.hal = hal; }

    /* =================================================================
     * 8. Publish
     * ============================================================== */

    G.SRM = SRM;
    G.EznK.Kernel.SRM = SRM;
    G.EznK.Srm = SRM;

    LOG.info('kernel/core.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
