/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L2 运行时层
 *
 *   文件 : js/runtime/exc-scope.js
 *   模块 : EznK.Runtime.excScope
 *   层级 : L2 运行时层
 *
 * ---------------------------------------------------------------------
 * EXC 作用域扩展 —— 提供给 .exc 应用的运行时能力
 * ---------------------------------------------------------------------
 * 本模块只负责"造对象"，不负责解析/构建控件。
 * exc.js 在跑 JS 代码块时从这里取作用域。
 *
 *   makeScope(env) -> {
 *     Ezn32UI, Ezn32, SRM, app, window, controls,
 *     Net,    // 网络（含 getBinary/download/abort/abortable）
 *     Timer,  // after / every / clear
 *     Store,  // 本地键值存储
 *     Dialog, // confirm / alert / prompt
 *     Clipboard,
 *     Notify,
 *     Console,
 *     Util,   // format 等小工具
 *     state,  // 双向绑定用的数据对象
 *     when    // 条件显隐登记
 *   }
 *
 *   env: { appName, win, ctx, requestRender }
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Runtime && G.EznK.Runtime.excScope) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L2:excScope');

    function makeScope(env) {
        var e = env || {};
        var appName = e.appName || 'Application';
        var win = e.win || null;
        var ctx = e.ctx || {};
        var requestRender = typeof e.requestRender === 'function' ? e.requestRender : function () {};

        var P = G.EznK.Platform || {};
        var NetPlatform = P.Net;

        /* =============================================================
         * 1. 统一的失败对象（Promise.reject 用）
         * ============================================================= */
        function fail(msg, code) {
            var err = new Error(msg || 'operation failed');
            err.ezntCode = code || S.EIO;
            return err;
        }
        function unwrap(promiseResult, what) {
            return promiseResult.then(function (r) {
                if (!r || r.status !== S.OK) {
                    throw fail((r && r.reason) || (what + ' 失败'), r ? r.status : S.EIO);
                }
                return r.value;
            });
        }

        /* =============================================================
         * 2. Net —— 网络能力（对齐平台层新接口）
         * ============================================================= */
        var Net = {
            version: '2.0.0',

            isOnline: function () {
                if (!NetPlatform) { return false; }
                try {
                    var r = NetPlatform.isOnline();
                    return !!(r && r.value);
                } catch (_) {
                    return G.navigator ? G.navigator.onLine !== false : true;
                }
            },

            /** getText(url, opts) -> Promise<string> */
            getText: function (url, opts) {
                if (!NetPlatform) { return Promise.reject(fail('网络层不可用')); }
                return unwrap(NetPlatform.fetchText(url, opts || {}), '网络请求');
            },

            /** get(url, opts) -> Promise<string> 别名 */
            get: function (url, opts) { return Net.getText(url, opts); },

            /** getJSON(url, opts) -> Promise<object> */
            getJSON: function (url, opts) {
                if (!NetPlatform) { return Promise.reject(fail('网络层不可用')); }
                return unwrap(NetPlatform.fetchJson(url, opts || {}), '获取 JSON');
            },

            /** post(url, body, opts) -> Promise<string> */
            post: function (url, body, opts) {
                if (!NetPlatform) { return Promise.reject(fail('网络层不可用')); }
                var o = {};
                if (opts) { Object.keys(opts).forEach(function (k) { o[k] = opts[k]; }); }
                o.method = 'POST';
                o.body = (typeof body === 'string') ? body : String(body === undefined ? '' : body);
                return unwrap(NetPlatform.fetchText(url, o), 'POST 请求');
            },

            /** postJSON(url, data, opts) -> Promise<object> */
            postJSON: function (url, data, opts) {
                if (!NetPlatform) { return Promise.reject(fail('网络层不可用')); }
                var o = {};
                if (opts) { Object.keys(opts).forEach(function (k) { o[k] = opts[k]; }); }
                o.method = 'POST';
                o.body = JSON.stringify(data === undefined ? {} : data);
                var h = {};
                if (o.headers) { Object.keys(o.headers).forEach(function (k) { h[k] = o.headers[k]; }); }
                if (!h['Content-Type'] && !h['content-type']) { h['Content-Type'] = 'application/json'; }
                o.headers = h;
                return unwrap(NetPlatform.fetchJson(url, o), 'POST JSON');
            },

            /** getBinary(url, opts) -> Promise<{data, contentType, size, url}> */
            getBinary: function (url, opts) {
                if (!NetPlatform || typeof NetPlatform.getBinary !== 'function') {
                    return Promise.reject(fail('平台层不支持 getBinary'));
                }
                return unwrap(NetPlatform.getBinary(url, opts || {}), '下载二进制');
            },

            /** head(url, opts) -> Promise<{ok, status, headers, url, contentType, size}> */
            head: function (url, opts) {
                if (!NetPlatform || typeof NetPlatform.head !== 'function') {
                    return Promise.reject(fail('平台层不支持 head'));
                }
                return unwrap(NetPlatform.head(url, opts || {}), 'HEAD 请求');
            },

            /**
             * download(url, opts) -> Promise<{data, contentType, size, url}>
             *   opts.onProgress({phase, loaded, total, percent, speed})
             */
            download: function (url, opts) {
                if (!NetPlatform || typeof NetPlatform.download !== 'function') {
                    return Promise.reject(fail('平台层不支持 download'));
                }
                return unwrap(NetPlatform.download(url, opts || {}), '下载');
            },

            /** request(url, opts) -> Promise<{ok, status, text, json, headers}> */
            request: function (url, opts) {
                if (!NetPlatform) { return Promise.reject(fail('网络层不可用')); }
                var o = opts || {};
                return NetPlatform.request(url, o).then(function (r) {
                    if (r.status !== S.OK) { throw fail(r.reason || '请求失败', r.status); }
                    var res = r.value;
                    return res.text().then(function (text) {
                        var headers = {};
                        try { res.headers.forEach(function (v, k) { headers[k] = v; }); } catch (_) {}
                        var parsed = null;
                        try { parsed = JSON.parse(text); } catch (_) {}
                        return {
                            ok: res.ok, status: res.status, url: res.url || url,
                            text: text, json: parsed, headers: headers
                        };
                    });
                });
            },

            /** abortable() -> { signal, abort }  用于取消在途请求 */
            abortable: function () {
                if (!NetPlatform || typeof NetPlatform.abortable !== 'function') {
                    return { signal: null, abort: function () {} };
                }
                return NetPlatform.abortable();
            },

            /** abort(signal) */
            abort: function (signal) {
                if (!NetPlatform || typeof NetPlatform.abort !== 'function') { return false; }
                var r = NetPlatform.abort(signal);
                return !!(r && r.status === S.OK);
            },

            /** refs - 资源引用计数（内核类应用用） */
            refs: (NetPlatform && NetPlatform.refs) ? NetPlatform.refs : null
        };

        /* =============================================================
         * 3. Timer —— 定时器（绑定到窗口，关闭时自动清理）
         * ============================================================= */
        var timers = [];
        var timerSeq = 0;

        function clearTimer(id) {
            for (var i = 0; i < timers.length; i++) {
                if (timers[i].id === id) {
                    if (timers[i].handle) {
                        try { G.clearTimeout(timers[i].handle); } catch (_) {}
                        try { G.clearInterval(timers[i].handle); } catch (_) {}
                    }
                    timers.splice(i, 1);
                    return true;
                }
            }
            return false;
        }
        function clearAllTimers() {
            timers.slice(0).forEach(function (t) { clearTimer(t.id); });
        }

        var Timer = {
            /** after(ms, fn) -> id   只执行一次 */
            after: function (ms, fn) {
                if (typeof fn !== 'function') { return null; }
                var id = 'tmr_' + (++timerSeq);
                var handle = G.setTimeout(function () {
                    clearTimer(id);
                    try { fn(); } catch (err) {
                        LOG.error('Timer.after 回调抛出: ' + (err && err.message));
                    }
                }, Math.max(0, Number(ms) || 0));
                timers.push({ id: id, handle: handle, kind: 'timeout' });
                return id;
            },
            /** every(ms, fn) -> id   周期性执行 */
            every: function (ms, fn) {
                if (typeof fn !== 'function') { return null; }
                var id = 'tmr_' + (++timerSeq);
                var handle = G.setInterval(function () {
                    try { fn(); } catch (err) {
                        LOG.error('Timer.every 回调抛出: ' + (err && err.message));
                    }
                }, Math.max(16, Number(ms) || 1000));
                timers.push({ id: id, handle: handle, kind: 'interval' });
                return id;
            },
            /** clear(id) */
            clear: function (id) { return clearTimer(id); },
            /** clearAll() */
            clearAll: function () { clearAllTimers(); return true; },
            /** count() - 当前活跃定时器数（调试用） */
            count: function () { return timers.length; }
        };

        /* =============================================================
         * 4. Store —— 本地键值存储（每应用独立命名空间）
         * ============================================================= */
        var hal = G.EznK.Kernel && G.EznK.Kernel.HAL;
        var storeKey = '/Users/User/Apps/' + encodeURIComponent(appName) + '/Store.json';

        function readStore() {
            if (!hal || !hal.fs || typeof hal.fs.configGet !== 'function') { return {}; }
            var r = hal.fs.configGet(storeKey, null);
            if (r.status === S.OK && r.value && typeof r.value === 'object') { return r.value; }
            return {};
        }
        function writeStore(obj) {
            if (!hal || !hal.fs || typeof hal.fs.configSet !== 'function') { return false; }
            var r = hal.fs.configSet(storeKey, obj);
            return r.status === S.OK;
        }

        var Store = {
            /** get(key, dflt) */
            get: function (key, dflt) {
                var o = readStore();
                return Object.prototype.hasOwnProperty.call(o, key) ? o[key]
                    : (dflt === undefined ? null : dflt);
            },
            /** set(key, val) */
            set: function (key, val) {
                var o = readStore();
                try { o[key] = val; } catch (_) { return false; }
                return writeStore(o);
            },
            /** has(key) */
            has: function (key) {
                var o = readStore();
                return Object.prototype.hasOwnProperty.call(o, key);
            },
            /** remove(key) */
            remove: function (key) {
                var o = readStore();
                delete o[key];
                return writeStore(o);
            },
            /** clear() */
            clear: function () { return writeStore({}); },
            /** keys() */
            keys: function () { return Object.keys(readStore()); },
            /** all() */
            all: function () { return readStore(); }
        };

        /* =============================================================
         * 5. Dialog —— 模态对话框
         * ============================================================= */
        function notifyUser(text, level) {
            var nc = G.EznK.Shell && G.EznK.Shell.notifications;
            if (nc) {
                nc.push({ title: appName, text: String(text).slice(0, 140),
                    level: level || 'info', timeout: 3500 });
            }
        }

        /**
         * 简易输入对话框：一个窗口 + Edit + 确定/取消
         *   opts: { title, message, value, onOk(text), onCancel() }
         */
        function promptBox(opts) {
            var o = opts || {};
            var title = o.title || '输入';
            var svc = G.EznK.Service && G.EznK.Service.window;
            var created = svc
                ? svc.open({ title: title, width: 420, height: 190, icon: '✏️' })
                : ui.Window.Create({ title: title, width: 420, height: 190 });
            if (created.status !== S.OK) { return false; }
            var w2 = created.value;
            var client = w2.client;

            var ui = G.ezn32.ui;
            client.addChild(new ui.controls.Label({
                x: 16, y: 10, width: client.width - 32,
                text: o.message || '请输入内容：'
            }));
            var field = new ui.controls.Edit({
                x: 16, y: 38, width: client.width - 32, height: 26
            });
            field.setValue(o.value || '');
            client.addChild(field);

            function finish(val) {
                if (w2 && !w2.destroyed) { w2.destroy(); }
                if (val === null) {
                    if (typeof o.onCancel === 'function') {
                        try { o.onCancel(); } catch (_) {}
                    }
                } else if (typeof o.onOk === 'function') {
                    try { o.onOk(val); } catch (_) {}
                }
            }
            field.onEnter = function () { finish(String(field.getValue() || '')); };

            client.addChild(new ui.controls.Button({
                x: client.width - 200, y: 78, width: 88, height: 28,
                text: '确定', variant: 'primary',
                onClick: function () { finish(String(field.getValue() || '')); }
            }));
            client.addChild(new ui.controls.Button({
                x: client.width - 104, y: 78, width: 88, height: 28,
                text: '取消', onClick: function () { finish(null); }
            }));
            w2.invalidate();
            G.setTimeout(function () { try { field.focus(); } catch (_) {} }, 80);
            return true;
        }

        var Dialog = {
            /** alert(message) */
            alert: function (message) {
                notifyUser(message, 'info');
                return true;
            },
            /** confirm(message, onOk) - 简易确认：用两个按钮的对话框 */
            confirm: function (message, onOk, onCancel) {
                var svc = G.EznK.Service && G.EznK.Service.window;
                var created = svc
                    ? svc.open({ title: '确认', width: 400, height: 170, icon: '❓' })
                    : ui.Window.Create({ title: '确认', width: 400, height: 170 });
                if (created.status !== S.OK) { return false; }
                var w2 = created.value;
                var client = w2.client;
                var ui = G.ezn32.ui;

                var lbl = new ui.controls.Label({
                    x: 16, y: 16, width: client.width - 32, height: 40,
                    text: String(message || '')
                });
                client.addChild(lbl);

                function done(ok) {
                    if (w2 && !w2.destroyed) { w2.destroy(); }
                    if (ok && typeof onOk === 'function') { try { onOk(); } catch (_) {} }
                    if (!ok && typeof onCancel === 'function') { try { onCancel(); } catch (_) {} }
                }
                client.addChild(new ui.controls.Button({
                    x: client.width - 200, y: 78, width: 88, height: 28,
                    text: '确定', variant: 'primary',
                    onClick: function () { done(true); }
                }));
                client.addChild(new ui.controls.Button({
                    x: client.width - 104, y: 78, width: 88, height: 28,
                    text: '取消', onClick: function () { done(false); }
                }));
                w2.invalidate();
                return true;
            },
            /** prompt(opts) */
            prompt: promptBox
        };

        /* =============================================================
         * 6. Clipboard / Notify / Console
         * ============================================================= */
        var Clipboard = {
            copy: function (text) {
                var s = String(text === null || text === undefined ? '' : text);
                try {
                    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.__clipboard) {
                        G.ezn32.ui.__clipboard.set(s);
                    }
                    var IME = G.EznK.Ui && G.EznK.Ui.IME;
                    if (IME && typeof IME.writeClipboard === 'function') {
                        IME.writeClipboard(s);
                    }
                    return true;
                } catch (_) { return false; }
            },
            paste: function () {
                try {
                    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.__clipboard) {
                        return String(G.ezn32.ui.__clipboard.get() || '');
                    }
                } catch (_) {}
                return '';
            }
        };

        var Notify = {
            push: function (text, level) {
                notifyUser(text, level || 'info');
                return true;
            },
            info: function (text) { return Notify.push(text, 'info'); },
            warn: function (text) { return Notify.push(text, 'warn'); },
            error: function (text) { return Notify.push(text, 'error'); }
        };

        var Console = {
            log: function () {
                var args = Array.prototype.slice.call(arguments).map(String).join(' ');
                LOG.info('[' + appName + '] ' + args);
                return true;
            },
            warn: function () {
                var args = Array.prototype.slice.call(arguments).map(String).join(' ');
                LOG.warn('[' + appName + '] ' + args);
                return true;
            },
            error: function () {
                var args = Array.prototype.slice.call(arguments).map(String).join(' ');
                LOG.error('[' + appName + '] ' + args);
                return true;
            }
        };

        /* =============================================================
         * 7. Util —— 小工具
         * ============================================================= */
        var Util = {
            /** pad(n, w) - 左侧补零 */
            pad: function (n, w) {
                var s = String(n);
                while (s.length < (w || 2)) { s = '0' + s; }
                return s;
            },
            /** formatTime(date, pattern) - 简单时间格式化 */
            formatTime: function (d, pattern) {
                var now = d instanceof Date ? d : new Date(d === undefined ? Date.now() : d);
                var p = pattern || 'HH:mm:ss';
                return p
                    .replace(/YYYY/g, String(now.getFullYear()))
                    .replace(/MM/g, Util.pad(now.getMonth() + 1))
                    .replace(/DD/g, Util.pad(now.getDate()))
                    .replace(/HH/g, Util.pad(now.getHours()))
                    .replace(/mm/g, Util.pad(now.getMinutes()))
                    .replace(/ss/g, Util.pad(now.getSeconds()));
            },
            /** bytes(n) - 人类可读的字节数 */
            bytes: function (n) {
                var v = Number(n) || 0;
                var units = ['B', 'KB', 'MB', 'GB'];
                var i = 0;
                while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
                return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
            },
            /** clamp(v, min, max) */
            clamp: function (v, mn, mx) { return Math.max(mn, Math.min(mx, v)); },
            /** escape(s) - 基础 HTML 转义（拼接时防注入） */
            escape: function (s) {
                return String(s === null || s === undefined ? '' : s)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            }
        };

        /* =============================================================
         * 8. state —— 双向绑定数据对象
         *    对 state 的任何赋值都会触发一次重绘（如果登记了 render）
         * ============================================================= */
        var rawState = {};
        var stateProxy = null;
        try {
            stateProxy = new Proxy(rawState, {
                set: function (target, key, val) {
                    target[key] = val;
                    try { requestRender(); } catch (_) {}
                    return true;
                },
                get: function (target, key) {
                    return target[key];
                },
                has: function (target, key) { return key in target; },
                deleteProperty: function (target, key) {
                    delete target[key];
                    try { requestRender(); } catch (_) {}
                    return true;
                }
            });
        } catch (_) {
            /* 不支持 Proxy 的环境退化为普通对象 */
            stateProxy = rawState;
        }

        return {
            appName: appName,
            win: win,
            ctx: ctx,
            Net: Net,
            Timer: Timer,
            Store: Store,
            Dialog: Dialog,
            Clipboard: Clipboard,
            Notify: Notify,
            Console: Console,
            Util: Util,
            state: stateProxy,
            /* 窗口关闭时统一清理 */
            _dispose: function () {
                clearAllTimers();
            },
            _timers: timers
        };
    }

    var ExcScope = {
        version: '1.0.0',
        makeScope: makeScope
    };

    if (!G.EznK.Runtime) { G.EznK.Runtime = {}; }
    G.EznK.Runtime.excScope = ExcScope;

    LOG.info('js/runtime/exc-scope.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
