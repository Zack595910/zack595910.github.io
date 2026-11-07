/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 2 - Runtime Layer
 *
 *   File    : js/runtime/c2-compat.js
 *   Module  : EznK.Runtime.c2
 *   Layer   : L2 运行时层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The optional C2 compatibility runtime. The C2 ecosystem is the third
 *   of the three parallel ecosystems (Native / Script / Compat) and is
 *   explicitly OPTIONAL - the system is fully functional without it.
 *
 *   C2 programs are JS fragments written against a minimal procedural API
 *   (the "C2 dialect"):
 *
 *       print("hello");
 *       var win = window("Title", 400, 300);
 *       text(win, "line of text");
 *       button(win, "Click me", function () { print("clicked"); });
 *       toast("done");
 *
 *   The runtime exposes those verbs as globals inside a dedicated scope
 *   and maps them onto Ezn32 UI. Because C2 is optional, absent support
 *   degrades to a clear ENOSYS rather than breaking anything else.
 *
 *   ISOLATION (contract 9): a C2 program runs in its own scope with its
 *   own error boundary. A crash terminates only that program.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Runtime && G.EznK.Runtime.c2) { return; }

    var CORE = G.EznK.Platform.Core;
    if (!CORE) { throw new Error('[EznK/L2] js/runtime/c2-compat.js requires platform/core.js'); }
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L2:c2');

    var ui = ezn32.ui;
    var api = ezn32.api;

    var programs = Object.create(null);
    var seq = 0;

    /* =================================================================
     * 1. The C2 verb scope
     * ============================================================== */

    function makeScope(meta) {
        var windows = Object.create(null);
        var output = [];

        function toast(msg) {
            var nc = G.EznK.Shell && G.EznK.Shell.notifications;
            if (nc) { nc.push({ title: meta.name || 'C2', text: String(msg).slice(0, 120), level: 'info', timeout: 2500 }); }
            return null;
        }

        var scope = {
            /* ---- console ---- */
            print: function (msg) {
                var line = String(msg === null || msg === undefined ? '' : msg);
                output.push(line);
                toast(line);
                return null;
            },
            toast: toast,

            /* ---- windows ---- */
            window: function (title, w, h) {
                var r = ui.Window.Create({
                    title: String(title || 'C2 Window'),
                    width: w | 0 || 420, height: h | 0 || 320,
                    ecosystem: 'c2', icon: '[2]', className: 'c2'
                });
                if (r.status !== S.OK) { return null; }
                windows[r.value.id] = r.value;
                return r.value.id;
            },
            closeWindow: function (id) {
                var w = windows[id] || (ui.Window.Get(id).status === S.OK ? ui.Window.Get(id).value : null);
                if (w) { w.destroy(); delete windows[id]; return true; }
                return false;
            },

            /* ---- widgets ---- */
            text: function (winId, str) {
                var w = windows[winId];
                if (!w) { return null; }
                var lbl = new ui.controls.Label({
                    x: 12, y: 12 + (w.client.children.length * 24),
                    width: Math.max(40, w.client.width - 24),
                    text: String(str)
                });
                w.addControl(lbl);
                return lbl.id;
            },
            button: function (winId, label, onClick) {
                var w = windows[winId];
                if (!w) { return null; }
                var btn = new ui.controls.Button({
                    x: 12, y: 12 + (w.client.children.length * 32),
                    width: Math.max(90, String(label).length * 10 + 24),
                    height: 26, text: String(label)
                });
                if (typeof onClick === 'function') { btn.onClick = onClick; }
                w.addControl(btn);
                return btn.id;
            },
            input: function (winId, value) {
                var w = windows[winId];
                if (!w) { return null; }
                var ed = new ui.controls.Edit({
                    x: 12, y: 12 + (w.client.children.length * 34),
                    width: Math.max(120, w.client.width - 24),
                    value: String(value || '')
                });
                w.addControl(ed);
                return ed.id;
            },

            /* ---- files ---- */
            read: function (path) {
                var r = G.EznK.Platform.Storage.readSync(path);
                return r.status === S.OK ? r.value : null;
            },
            write: function (path, data) {
                var r = G.EznK.Platform.Storage.writeSync(path, String(data));
                return r.status === S.OK;
            },

            /* ---- introspection ---- */
            _output: output,
            _windows: windows
        };
        return scope;
    }

    /* =================================================================
     * 2. Execution
     * ============================================================== */

    /**
     * run(code, opts) -> Promise<{status, value: {id, output}}>
     *   Each run gets its own scope; a thrown error is contained.
     */
    function run(code, opts) {
        if (typeof code !== 'string') {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'code must be a string' }));
        }
        var o = opts || {};
        seq += 1;
        var id = 'c2_' + seq;
        var scope = makeScope({ name: o.name });

        programs[id] = { id: id, name: o.name || id, startedAt: Date.now(), scope: scope };

        var names = ['print', 'toast', 'window', 'closeWindow', 'text', 'button', 'input', 'read', 'write'];
        var args = names.concat(['Ezn32']);
        var values = names.map(function (n) { return scope[n]; }).concat([G.ezn32]);

        try {
            var factory = Function.apply(null, args.concat(['"use strict";\n' + code]));
            var fn = factory;
            var ret = fn.apply(null, values);
            var srm = G.EznK.Kernel.SRM;
            if (srm) { srm.emit('c2:ran', { id: id }); }
            return Promise.resolve(CORE.ok({ id: id, result: ret === undefined ? null : ret, output: scope._output }));
        } catch (err) {
            /* isolation: this program failed, nothing else did */
            LOG.error('C2 program ' + id + ' threw: ' + (err && err.message));
            delete programs[id];
            return Promise.resolve(CORE.fail(S.EFAULT, {
                reason: 'C2 program error: ' + (err && err.message),
                isolated: true
            }));
        }
    }

    /** runFile(path) */
    function runFile(path) {
        return api.kernel.ReadFileText(path).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return run(r.value, { name: path });
        });
    }

    /* =================================================================
     * 3. Queries
     * ============================================================== */

    function list() {
        return CORE.ok(Object.keys(programs).map(function (id) {
            return { id: id, name: programs[id].name, startedAt: programs[id].startedAt };
        }));
    }

    function isSupported() { return CORE.ok(true); }

    function dispose() {
        Object.keys(programs).forEach(function (id) {
            var s = programs[id].scope;
            Object.keys(s._windows || {}).forEach(function (wid) {
                var w = ui.Window.Get(wid);
                if (w.status === S.OK) { w.value.destroy(); }
            });
        });
        programs = Object.create(null);
        return CORE.ok(true);
    }

    /* =================================================================
     * 4. Lifecycle
     * ============================================================== */

    function boot() {
        var srm = EznK.Kernel.SRM;
        if (srm) {
            srm.registerService('c2-runtime', { init: function () { LOG.info('C2 compatibility runtime online'); } });
            srm.registerFunction('c2.run', function (c) { return run(c); }, 'run a C2 program');
        }
        return CORE.ok(true);
    }

    var C2 = {};
    C2.version = '1.0.0';
    C2.OPTIONAL = true;
    C2.boot = boot;
    C2.shutdown = function () { return CORE.ok(true); };
    C2.run = run;
    C2.runFile = runFile;
    C2.list = list;
    C2.isSupported = isSupported;
    C2.dispose = dispose;

    if (!G.EznK.Runtime) { G.EznK.Runtime = {}; }
    G.EznK.Runtime.c2 = C2;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('runtime-c2', C2);
    }
    LOG.info('js/runtime/c2-compat.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
