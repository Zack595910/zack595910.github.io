/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 2 - Runtime Layer
 *
 *   File    : js/runtime/python.js
 *   Module  : EznK.Runtime.python
 *   Layer   : L2 运行时层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The Python runtime. It follows the PTD scheme exactly:
 *
 *     - Pyodide 0.27.0 loaded lazily from jsDelivr
 *         https://cdn.jsdelivr.net/pyodide/v0.27.0/full/
 *     - NOT loaded at boot: the user installs it from the control panel
 *       (or any app calls ensure()), and only then is ~10 MB fetched.
 *     - After load a tkinter emulator is injected so Python programs that
 *       import tkinter draw real EZNT windows through Ezn32 UI.
 *     - print() / stderr are redirected to the shell output.
 *
 *   Offline behaviour (contract: Python is one of five ecosystems and
 *   must not break the other four): when the CDN is unreachable the
 *   runtime reports UNAVAILABLE with a readable reason and every caller
 *   degrades - the system keeps running.
 *
 *   The tkinter emulator maps Python widgets onto REAL Ezn32 UI controls,
 *   so a tkinter program is a first-class native window, not a simulated
 *   screenshot.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Runtime && G.EznK.Runtime.python) { return; }

    var CORE = G.EznK.Platform.Core;
    if (!CORE) { throw new Error('[EznK/L2] js/runtime/python.js requires platform/core.js'); }
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L2:python');

    var CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/';
    var PYODIDE_VERSION = '0.27.0';

    var state = {
        py: null,
        loading: null,
        ready: false,
        status: 'not-installed',   /* not-installed | installing | ready | unavailable */
        error: null,
        installedAt: null
    };

    /* =================================================================
     * 1. Status
     * ============================================================== */

    function status() {
        return CORE.ok({
            status: state.status,
            ready: state.ready,
            version: PYODIDE_VERSION,
            cdn: CDN,
            error: state.error,
            installedAt: state.installedAt
        });
    }

    function isReady() { return state.ready; }

    /* =================================================================
     * 2. Loading (lazy, through the platform network gateway)
     * ============================================================== */

    /**
     * install(opts) -> Promise<{status, value: info}>
     *   opts.onProgress(loaded, total, phase) is called during download.
     *   Idempotent: concurrent callers share one load, and a previous
     *   failure is remembered so `run()` never silently re-triggers a
     *   multi-megabyte download on every call.
     */
    function install(opts) {
        var o = opts || {};
        if (state.ready) { return Promise.resolve(CORE.ok(status().value)); }
        if (state.loading) { return state.loading; }
        if (state.failedOnce && o.force !== true) {
            return Promise.resolve(CORE.fail(S.ENOSYS, {
                reason: 'Python runtime unavailable: ' + (state.error || 'installation failed earlier'),
                retryable: true
            }));
        }

        state.status = 'installing';
        state.error = null;

        var Net = G.EznK.Platform.Net;
        if (Net && !Net.isOnline().value) {
            state.status = 'unavailable';
            state.error = 'offline';
            return Promise.resolve(CORE.fail(S.EIO, { reason: 'offline: Pyodide needs a network connection' }));
        }

        if (typeof G.loadPyodide !== 'function') {
            /* 带进度的下载：先 fetch 拿字节流读取进度，再注入脚本。
             * 这样控制面板能显示和 PTD 一样的进度条、速度、大小。 */
            var Timeout = G.EznK.Platform.Time;
            var report = function (info) {
                if (typeof o.onProgress === 'function') {
                    try { o.onProgress(info); } catch (_) {}
                }
            };
            report({ phase: 'connect', message: '正在连接 Pyodide CDN...' });

            var fetchWithProgress = function (url) {
                if (typeof fetch !== 'function') {
                    return Promise.resolve({ ok: false, reason: 'fetch unavailable' });
                }
                return fetch(url).then(function (resp) {
                    if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
                    var total = parseInt(resp.headers.get('content-length') || '0', 10);
                    report({ phase: 'download', message: '文件大小: ' + (total / 1048576).toFixed(1) + ' MB' });
                    if (!resp.body || typeof resp.body.getReader !== 'function') {
                        return resp.text();
                    }
                    var reader = resp.body.getReader();
                    var loaded = 0;
                    var chunks = [];
                    var t0 = Date.now();
                    var lastT = t0, lastB = 0;
                    function pump() {
                        return reader.read().then(function (res) {
                            if (res.done) {
                                if (total > 0) {
                                    report({ phase: 'download', percent: 100,
                                        speed: '完成', size: (loaded / 1048576).toFixed(1) + ' MB' });
                                }
                                var all = new Uint8Array(loaded);
                                var off = 0;
                                chunks.forEach(function (c) { all.set(c, off); off += c.length; });
                                return new TextDecoder('utf-8').decode(all);
                            }
                            chunks.push(res.value);
                            loaded += res.value.length;
                            var now = Date.now();
                            var dt = (now - lastT) / 1000;
                            if (dt >= 0.2) {
                                var speed = (loaded - lastB) / dt;
                                var pct = total > 0 ? (loaded / total) * 100 : 0;
                                report({
                                    phase: 'download',
                                    percent: pct,
                                    speed: (speed / 1048576).toFixed(2) + ' MB/s',
                                    size: (loaded / 1048576).toFixed(1) + ' / ' +
                                          (total / 1048576).toFixed(1) + ' MB'
                                });
                                lastT = now; lastB = loaded;
                            }
                            return pump();
                        });
                    }
                    return pump();
                });
            };

            state.loading = fetchWithProgress(CDN + 'pyodide.js')
                .catch(function () { return null; })
                .then(function (code) {
                    if (code) {
                        /* 直接执行已下载的脚本，省掉第二次请求。
                         * 走 DOM 网关创建元素（规则 2：只有 EZNT.DOM 能碰 DOM）。 */
                        try {
                            var DOMg = G.EznK.Platform.DOM;
                            var scRes = DOMg.create('script', { attributes: { type: 'text/javascript' } });
                            if (scRes.status === 0) {
                                scRes.value.textContent = code;
                                var headRes = DOMg.byTag ? DOMg.byTag('head') : null;
                                var head = (headRes && headRes.status === 0 && headRes.value)
                                    ? headRes.value
                                    : G.document.head;
                                DOMg.append(head, scRes.value);
                            }
                        } catch (_) {}
                    }
                    if (typeof G.loadPyodide === 'function') {
                        report({ phase: 'init', message: '正在初始化 Python 解释器...' });
                        return initPyodide(o);
                    }
                    /* 回退：走网关加载脚本 */
                    report({ phase: 'connect', message: '回退到脚本加载方式...' });
                    return Net.loadScript(CDN + 'pyodide.js', { timeout: 45000 });
                })
                .then(function (r) {
                    if (r && r.status !== undefined && r.status !== S.OK) {
                        state.status = 'unavailable';
                        state.error = 'could not load pyodide.js (' + (r.reason || r.status) + ')';
                        return CORE.fail(S.EIO, { reason: state.error });
                    }
                    if (typeof G.loadPyodide !== 'function') {
                        state.status = 'unavailable';
                        state.error = 'pyodide.js did not define loadPyodide';
                        return CORE.fail(S.EIO, { reason: state.error });
                    }
                    if (r && r.status === S.OK && r.value === undefined) {
                        return initPyodide(o);
                    }
                    return r;
                });
            /* Hard ceiling: a CDN that accepts the connection and then
             * stalls must not leave the caller waiting forever. */
            if (Timeout) {
                state.loading = Promise.race([
                    state.loading,
                    new Promise(function (resolve) {
                        Timeout.after(60000, function () {
                            resolve(CORE.fail(S.EBUSY, { reason: 'Pyodide download timed out' }));
                        });
                    })
                ]);
            }
        } else {
            state.loading = initPyodide(o);
        }

        return state.loading.then(function (r) {
            state.loading = null;
            if (r.status === S.OK) {
                state.ready = true;
                state.status = 'ready';
                state.installedAt = Date.now();
                /* announce to the rest of the system */
                var srm = G.EznK.Kernel.SRM;
                if (srm) { srm.emit('python:ready', { version: PYODIDE_VERSION }); }
            } else {
                state.status = 'unavailable';
                state.error = r.reason || 'load failed';
                state.failedOnce = true;
            }
            return r;
        });
    }

    function initPyodide(o) {
        if (typeof G.loadPyodide !== 'function') {
            return Promise.resolve(CORE.fail(S.EIO, { reason: 'loadPyodide global missing after script load' }));
        }
        if (typeof o.onProgress === 'function') {
            try { o.onProgress(0, 0, 'initialising'); } catch (_) { /* ignore */ }
        }
        return Promise.resolve(G.loadPyodide({ indexURL: CDN }))
            .then(function (py) {
                state.py = py;
                return injectTkinter(py).then(function () { return installStdio(py); });
            }).then(function () {
                LOG.info('Python ' + PYODIDE_VERSION + ' ready');
                return CORE.ok(status().value);
            }, function (err) {
                LOG.error('Pyodide init failed: ' + (err && err.message));
                return CORE.fail(S.EIO, { reason: 'Pyodide init failed: ' + (err && err.message) });
            });
    }

    /* =================================================================
     * 3. stdout / stderr -> shell output
     * ============================================================== */

    function shellPrint(text, cls) {
        var nc = G.EznK.Shell && G.EznK.Shell.notifications;
        var line = String(text === null || text === undefined ? '' : text);
        if (nc && line.trim().length) {
            nc.push({ title: 'Python', text: line.slice(0, 120), level: cls === 'error' ? 'error' : 'info', timeout: 2500 });
        }
        return null;
    }

    function installStdio(py) {
        var js = G.EZNT || {};
        js.pythonPrint = shellPrint;
        try {
            py.runPython([
                'import sys',
                'from js import pythonPrint as _pp',
                'class _EZNTStream:',
                '    def write(self, s):',
                '        if s and s.strip():',
                '            _pp(s.rstrip(), "")',
                '    def flush(self):',
                '        pass',
                'sys.stdout = _EZNTStream()',
                'sys.stderr = _EZNTStream()'
            ].join('\n'));
        } catch (err) {
            LOG.warn('stdio redirect failed: ' + (err && err.message));
        }
        return Promise.resolve();
    }

    /* =================================================================
     * 4. tkinter emulator (PTD scheme: Python widget -> Ezn32 UI control)
     * ============================================================== */

    function injectTkinter(py) {
        var bridge = {
            createWindow: function (id, title, w, h) {
                var created = G.ezn32.ui.Window.Create({
                    id: id, title: String(title), width: w | 0 || 400, height: h | 0 || 300,
                    icon: '[P]', ecosystem: 'script', className: 'python-tk'
                });
                return created.status === S.OK ? id : null;
            },
            addWidget: function (winId, kind, text, x, y, w, h) {
                var wr = G.ezn32.ui.Window.Get(winId);
                if (wr.status !== S.OK) { return null; }
                var C = G.ezn32.ui.controls;
                var ctl = null;
                if (kind === 'label') {
                    ctl = new C.Label({ x: x, y: y, width: w || 200, text: String(text) });
                } else if (kind === 'button') {
                    ctl = new C.Button({ x: x, y: y, width: w || 100, height: h || 26, text: String(text) });
                } else if (kind === 'entry') {
                    ctl = new C.Edit({ x: x, y: y, width: w || 180, value: String(text || '') });
                } else if (kind === 'checkbox') {
                    ctl = new C.CheckBox({ x: x, y: y, width: w || 160, text: String(text) });
                } else if (kind === 'listbox') {
                    ctl = new C.ListBox({ x: x, y: y, width: w || 200, height: h || 120 });
                }
                if (!ctl) { return null; }
                wr.value.addControl(ctl);
                return ctl.id;
            },
            setButtonCommand: function (winId, ctlId, callbackName) {
                var wr = G.ezn32.ui.Window.Get(winId);
                if (wr.status !== S.OK) { return false; }
                var ctl = wr.value.client.findById(ctlId);
                if (!ctl) { return false; }
                ctl.onClick = function () {
                    try {
                        var fn = state.py.globals.get(callbackName);
                        if (fn) { fn(); }
                    } catch (err) {
                        LOG.error('tkinter callback error');
                    }
                };
                return true;
            },
            getValue: function (winId, ctlId) {
                var wr = G.ezn32.ui.Window.Get(winId);
                if (wr.status !== S.OK) { return ''; }
                var ctl = wr.value.client.findById(ctlId);
                return ctl && typeof ctl.getValue === 'function' ? ctl.getValue() : '';
            },
            destroy: function (winId) {
                return G.ezn32.ui.Window.Get(winId).status === S.OK
                    ? G.ezn32.ui.Window.Get(winId).value.destroy().status === S.OK
                    : false;
            },
            mainloop: function () { return null; },
            print: shellPrint
        };

        G.EZNT_TK = bridge;

        var pySource = [
            'import sys',
            'from js import EZNT_TK as _TK',
            '',
            'class _Widget:',
            '    def __init__(self, master, kind, text="", w=None, h=None):',
            '        self.master = master',
            '        self._wid = _TK.addWidget(master._id, kind, text, 12, master._next_y(), w, h)',
            '        master._y_advance(34)',
            '    def pack(self, **kw):',
            '        return self',
            '    def grid(self, **kw):',
            '        return self',
            '    def place(self, **kw):',
            '        return self',
            '    def config(self, **kw):',
            '        return self',
            '    def configure(self, **kw):',
            '        return self',
            '',
            'class Label(_Widget):',
            '    def __init__(self, master=None, text="", **kw):',
            '        _Widget.__init__(self, master, "label", text, kw.get("width"))',
            '',
            'class Button(_Widget):',
            '    def __init__(self, master=None, text="", command=None, **kw):',
            '        _Widget.__init__(self, master, "button", text, kw.get("width"), kw.get("height"))',
            '        if command is not None:',
            '            _cb = getattr(command, "__name__", None)',
            '            if _cb:',
            '                _TK.setButtonCommand(master._id, self._wid, _cb)',
            '',
            'class Entry(_Widget):',
            '    def __init__(self, master=None, **kw):',
            '        _Widget.__init__(self, master, "entry", kw.get("text", ""), kw.get("width"))',
            '    def get(self):',
            '        return _TK.getValue(self.master._id, self._wid)',
            '    def insert(self, index, s):',
            '        return None',
            '',
            'class Checkbutton(_Widget):',
            '    def __init__(self, master=None, text="", **kw):',
            '        _Widget.__init__(self, master, "checkbox", text, kw.get("width"))',
            '',
            'class Listbox(_Widget):',
            '    def __init__(self, master=None, **kw):',
            '        _Widget.__init__(self, master, "listbox", "", kw.get("width"), kw.get("height"))',
            '    def insert(self, index, item):',
            '        return None',
            '',
            'class Tk:',
            '    def __init__(self, **kw):',
            '        self._id = None',
            '        self._y = 0',
            '        self._title = "tkinter"',
            '        self._w = 400',
            '        self._h = 300',
            '    def _next_y(self):',
            '        return self._y',
            '    def _y_advance(self, d):',
            '        self._y += d',
            '    def title(self, s=None):',
            '        if s is not None:',
            '            self._title = s',
            '        return self._title',
            '    def geometry(self, g=None):',
            '        try:',
            '            parts = g.split("x")',
            '            self._w = int(parts[0])',
            '            self._h = int(parts[1].split("+")[0])',
            '        except Exception:',
            '            pass',
            '    def configure(self, **kw):',
            '        return None',
            '    def config(self, **kw):',
            '        return None',
            '    def mainloop(self):',
            '        self._id = _TK.createWindow("py_" + str(id(self)), self._title, self._w, self._h)',
            '        return None',
            '    def destroy(self):',
            '        if self._id:',
            '            _TK.destroy(self._id)',
            '    def after(self, ms, fn=None):',
            '        return None',
            '    def update(self):',
            '        return None',
            '    def protocol(self, name, fn):',
            '        return None',
            '',
            'class _TkModule:',
            '    Tk = Tk',
            '    Label = Label',
            '    Button = Button',
            '    Entry = Entry',
            '    Checkbutton = Checkbutton',
            '    Listbox = Listbox',
            '    TkVersion = 8.6',
            '    def mainloop(self):',
            '        return None',
            '',
            'import types',
            'sys.modules["tkinter"] = types.ModuleType("tkinter")',
            'for _n in ["Tk","Label","Button","Entry","Checkbutton","Listbox","TkVersion","mainloop"]:',
            '    setattr(sys.modules["tkinter"], _n, getattr(_TkModule, _n))'
        ].join('\n');

        try {
            py.runPython(pySource);
        } catch (err) {
            LOG.warn('tkinter emulator injection failed: ' + (err && err.message));
            return Promise.resolve();
        }
        return Promise.resolve();
    }

    /* =================================================================
     * 5. Execution
     * ============================================================== */

    /**
     * run(code) -> Promise<{status, value: lastExprResult}>
     *   Never rejects. When Python is not installed the call fails with
     *   ENOSYS and the caller degrades.
     */
    function run(code) {
        if (typeof code !== 'string') {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'code must be a string' }));
        }
        if (!state.ready) {
            return install().then(function (r) {
                if (r.status !== S.OK) {
                    return CORE.fail(S.ENOSYS, { reason: 'Python runtime unavailable: ' + (state.error || 'not installed') });
                }
                return execCode(code);
            });
        }
        return execCode(code);
    }

    function execCode(code) {
        try {
            var out = state.py.runPython(code);
            return Promise.resolve(CORE.ok(out === undefined || out === null ? null : String(out)));
        } catch (err) {
            return Promise.resolve(CORE.fail(S.EFAULT, { reason: String(err && err.message || err) }));
        }
    }

    /** runAsync(code) - awaits top-level await inside Python. */
    function runAsync(code) {
        if (!state.ready) {
            return Promise.resolve(CORE.fail(S.ENOSYS, { reason: 'Python runtime unavailable' }));
        }
        return Promise.resolve(state.py.runPythonAsync(code))
            .then(function (out) { return CORE.ok(out === undefined || out === null ? null : String(out)); },
                function (err) { return CORE.fail(S.EFAULT, { reason: String(err && err.message || err) }); });
    }

    /* =================================================================
     * 6. Lifecycle
     * ============================================================== */

    function boot() {
        var srm = G.EznK.Kernel.SRM;
        if (srm) {
            srm.registerService('python-runtime', {
                init: function () { LOG.info('python runtime stub online (lazy)'); }
            });
            srm.registerFunction('python.run', function (c) { return run(c); }, 'run python code');
            srm.registerFunction('python.install', function () { return install(); }, 'install Pyodide');
        }
        return CORE.ok(true);
    }

    function dispose() {
        state.py = null;
        state.ready = false;
        state.status = 'not-installed';
        return CORE.ok(true);
    }

    var Py = {};
    Py.version = '1.0.0';
    Py.PYODIDE_VERSION = PYODIDE_VERSION;
    Py.CDN = CDN;
    Py.boot = boot;
    Py.shutdown = function () { return CORE.ok(true); };

    Py.status = status;
    Py.isReady = isReady;
    Py.install = install;
    Py.run = run;
    Py.runAsync = runAsync;
    Py.dispose = dispose;
    Py.injectTkinter = function () {
        return state.py ? injectTkinter(state.py) : Promise.resolve();
    };

    if (!G.EznK.Runtime) { G.EznK.Runtime = {}; }
    G.EznK.Runtime.python = Py;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('runtime-python', Py);
    }
    LOG.info('js/runtime/python.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
