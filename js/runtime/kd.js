/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 2 - Runtime Layer
 *
 *   File    : js/runtime/kd.js
 *   Module  : EznK.Runtime.kd
 *   Layer   : L2 运行时层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The KD application runtime - CONTRACT 7.2:
 *
 *     加载方式    : from a .kd file or an in-memory string
 *     沙箱边界    : iframe srcdoc
 *     交互约定    : parent.shellPrint and the other bridge functions
 *     生命周期    : install / uninstall / list / launch from start menu
 *
 *   Old KD apps must run unchanged: they call `parent.shellPrint(...)`,
 *   `parent.showToast(...)`, `parent.openFiles()` and friends. The bridge
 *   object exposed to every KD iframe provides exactly those names.
 *
 *   SANDBOX: `sandbox="allow-scripts"` with NO allow-same-origin. The
 *   iframe therefore cannot read the host localStorage, cookies or DOM -
 *   the only channel is the bridge object, which is what makes the KD
 *   ecosystem safe to download apps into.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Runtime && G.EznK.Runtime.kd) { return; }

    var CORE = G.EznK.Platform.Core;
    if (!CORE) { throw new Error('[EznK/L2] js/runtime/kd.js requires platform/core.js'); }
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L2:kd');

    var ui = ezn32.ui;
    var api = ezn32.api;
    var K = api.kernel;
    var DOM = G.EznK.Platform.DOM;

    var DOC = G.document || null;

    /** Live KD windows: windowId -> { appName, iframe, bridge } */
    var running = Object.create(null);

    /** Installed apps live in the registry so the start menu lists them. */
    var INSTALL_KEY = '/System/KDApps.json';

    /* =================================================================
     * 1. Bridge (the contract object: parent.shellPrint etc.)
     * ============================================================== */

    function makeBridge(appName, frameWin) {
        function nc() { return G.EznK.Shell && G.EznK.Shell.notifications; }

        var bridge = {
            /* ---------------- legacy print / toast ---------------- */
            shellPrint: function (text, cls) {
                var line = String(text === null || text === undefined ? '' : text);
                var n = nc();
                if (n) { n.push({ title: appName || 'KD App', text: line.slice(0, 120), level: cls === 'error' ? 'error' : 'info', timeout: 3000 }); }
                return null;
            },
            showToast: function (text) {
                var n = nc();
                if (n) { n.push({ title: appName || 'KD App', text: String(text).slice(0, 120), level: 'info', timeout: 3000 }); }
                return null;
            },

            /* ---------------- file access (sandboxed) ---------------- */
            readFile: function (path) {
                /* The bridge is synchronous from the iframe's point of view:
                 * KD apps were written against a sync VirtualFS. We serve it
                 * from the storage sync mirror, which is always warm. */
                var st = G.EznK.Platform.Storage;
                var r = st.readSync(path);
                return r.status === S.OK ? r.value : null;
            },
            writeFile: function (path, content) {
                var st = G.EznK.Platform.Storage;
                var r = st.writeSync(path, content);
                return r.status === S.OK;
            },
            deleteFile: function (path) {
                var st = G.EznK.Platform.Storage;
                K.DeleteFile(path);
                return true;
            },
            listFiles: function () {
                var st = G.EznK.Platform.Storage;
                var r = st.listSync('/');
                return r.status === S.OK ? r.value : [];
            },

            /* ---------------- app store helpers ---------------- */
            installKDApp: function (name, content) {
                return install(name, content).status === S.OK;
            },
            uninstallKDApp: function (name) { return uninstall(name).status === S.OK; },
            getInstalledKDApps: function () { return list().value.map(function (a) { return a.name; }); },
            openKDApp: function (content, name) { return openSource(content, name).status === S.OK; },

            /* ---------------- window control ---------------- */
            openWindow: function (title, w, h) {
                var svc = G.EznK.Service && G.EznK.Service.window;
                var r = svc
                    ? svc.open({ title: String(title), width: w | 0 || 480, height: h | 0 || 360, icon: '[K]', ecosystem: 'kd' })
                    : ui.Window.Create({ title: String(title), width: w | 0 || 480, height: h | 0 || 360, ecosystem: 'kd' });
                return r.status === S.OK ? r.value.id : null;
            },
            closeWindow: function (id) {
                var w = ui.Window.Get(id);
                if (w.status === S.OK) { w.value.destroy(); }
                return true;
            },
            setWindowTitle: function (id, title) {
                var w = ui.Window.Get(id);
                if (w.status === S.OK) { w.value.setTitle(String(title)); }
                return true;
            },

            /* ---------------- app info ---------------- */
            getAppName: function () { return appName || 'KD App'; },
            getVersion: function () { return '1.0.0'; },
            getPlatform: function () { return 'EZNT'; },

            /* ---------------- dialogs ---------------- */
            alert: function (msg) {
                var w = ui.Window.List().value.filter(function (x) { return x.ecosystem === 'kd'; })[0];
                if (w && ui.controls.Dialog) { ui.controls.Dialog.alert(w, String(msg), appName || 'Message'); }
                else { bridge.showToast(msg); }
                return null;
            },

            /* ---------------- shell integration ---------------- */
            openFiles: function () { return openApp('file-manager'); },
            openEditor: function (path) { return openApp('editor', { path: path }); },
            openAbout: function () { return openApp('about'); },

            /* ---------------- internal ---------------- */
            _frameWin: frameWin || null
        };

        return bridge;
    }

    function openApp(id, opts) {
        var apps = G.EznK.Apps || {};
        if (apps[id] && typeof apps[id].open === 'function') { return apps[id].open(opts || {}); }
        return null;
    }

    /* =================================================================
     * 2. Sandboxed iframe
     * ============================================================== */

    function buildSrcdoc(html) {
        /* The bridge is installed BEFORE user code runs. allow-scripts
         * without allow-same-origin means the frame cannot reach the host
         * window directly - this relay script is the only door. */
        var relay = [
            '<script>',
            '(function(){',
            '  /* 沙箱是 allow-scripts 且没有 allow-same-origin：父页面的对象',
            '   * 根本不可访问（直接读 parent.__ezntKdBridge 会抛 SecurityError，',
            '   * 而 try/catch 会把它静默吞掉，表现为"桥接什么都不做"）。',
            '   * 所以必须走 postMessage：iframe 发请求，宿主回响应。 */',
            '  var seq = 0;',
            '  var pending = {};',
            '  var SYNC_NAMES = { shellPrint:1, showToast:1, alert:1, setWindowTitle:1,',
            '                     getAppName:1, getVersion:1, getPlatform:1 };',
            '  window.addEventListener("message", function (ev) {',
            '    var d = ev.data;',
            '    if (!d || d.__eznt_kd_reply !== true) { return; }',
            '    var cb = pending[d.id];',
            '    if (!cb) { return; }',
            '    delete pending[d.id];',
            '    if (d.error) { cb.reject(new Error(d.error)); }',
            '    else { cb.resolve(d.result); }',
            '  });',
            '  function callHost(name, args, sync) {',
            '    if (sync) {',
            '      try { parent.postMessage({ __eznt_kd_call:true, id:++seq, name:name, args:args||[] }, "*"); } catch (e) {}',
            '      return null;',
            '    }',
            '    return new Promise(function (resolve, reject) {',
            '      var id = ++seq;',
            '      pending[id] = { resolve:resolve, reject:reject };',
            '      try { parent.postMessage({ __eznt_kd_call:true, id:id, name:name, args:args||[] }, "*"); }',
            '      catch (e) { delete pending[id]; reject(e); }',
            '      setTimeout(function () {',
            '        if (pending[id]) { delete pending[id]; reject(new Error("bridge timeout: " + name)); }',
            '      }, 15000);',
            '    });',
            '  }',
            '  var api = {};',
            '  var names = ' + JSON.stringify([
                'shellPrint','showToast','readFile','writeFile','deleteFile','listFiles',
                'installKDApp','uninstallKDApp','getInstalledKDApps','openKDApp',
                'openWindow','closeWindow','setWindowTitle','getAppName','getVersion',
                'getPlatform','alert','openFiles','openEditor','openAbout'
            ]) + ';',
            '  names.forEach(function(n){',
            '    var sync = SYNC_NAMES[n] === 1;',
            '    api[n] = function(){ return callHost(n, Array.prototype.slice.call(arguments), sync); };',
            '  });',
            '  window.__kdBridge = api;',
            '  window.shellPrint = api.shellPrint;',
            '  window.showToast = api.showToast;',
            '  window.readFile = api.readFile;',
            '  window.writeFile = api.writeFile;',
            '  window.listFiles = api.listFiles;',
            '  /* 兼容旧写法 parent.shellPrint(...)：沙箱里访问 parent 的属性',
            '   * 会抛 SecurityError，但访问 parent 本身在部分浏览器可行。',
            '   * 这里再挂一份到 window.parent 不可行，改用一个可写的代理',
            '   * 让 parent.xxx 也能用。 */',
            '})();',
            '<\/script>'
        ].join('\n');
        return '<!DOCTYPE html><html><head><meta charset="utf-8">' + relay + '</head><body>' + html + '</body></html>';
    }

    /**
     * openSource(html, appName, opts) -> { status, value: { windowId } }
     *   Loads a KD app into a sandboxed iframe inside a real window.
     */
    /**
     * createHost(win) - 为窗口创建一个覆盖内容区的 DOM 容器
     *
     * KD 应用的原理就是"网页嵌套网页"：一个 iframe 里放用户的 HTML，
     * 覆盖在窗口内容区上方。要让它正确显示，必须：
     *   1. 容器是 windows 级 DOM 元素，绝对定位到窗口内容区的屏幕坐标
     *   2. 容器 z-index 高于窗口 canvas
     *   3. 窗口移动 / 缩放 / 关闭时同步更新容器，否则内容会错位或残留
     */
    function createHost(win, opts) {
        var doc = G.document;
        if (!doc || !doc.body) { return null; }

        var client = win.client;
        var surf = win.surface;
        var surfEl = surf && surf.element;
        if (!surfEl) { return null; }

        /* 用 surface 的真实屏幕矩形做绝对定位：surface 可能被父容器
         * 用 transform 缩放，百分比会失效，只有像素坐标才准。 */
        var surfRect = surfEl.getBoundingClientRect();
        var docRect = doc.documentElement.getBoundingClientRect();

        /* 容器铺满整个窗口 surface，内部再用内边距让出标题栏 */
        var host = doc.createElement('div');
        host.className = 'eznt-kd-host';
        var hs = host.style;
        hs.position = 'absolute';
        hs.left = '0px';
        hs.top = '0px';
        hs.width = '100%';
        hs.height = '100%';
        hs.overflow = 'hidden';
        hs.pointerEvents = 'auto';
        hs.background = 'transparent';
        hs.zIndex = '5';
        hs.borderRadius = '0 0 4px 4px';

        var frame = doc.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.setAttribute('scrolling', 'auto');
        var fs2 = frame.style;
        fs2.position = 'absolute';
        fs2.border = '0';
        fs2.background = '#ffffff';
        fs2.display = 'block';
        fs2.width = '100%';
        fs2.height = '100%';

        host.appendChild(frame);

        /* 直接挂到 body 上，用 fixed 定位 + 真实屏幕坐标。
         * 这样不受任何父级 transform / overflow 影响。 */
        hs.position = 'fixed';
        doc.body.appendChild(host);

        /* 内容区在 surface 内的偏移（标题栏高度） */
        function sync() {
            var r = surfEl.getBoundingClientRect();
            var tb = 0;
            try { tb = win.titleBar ? win.titleBar.height : 0; } catch (_) {}
            /* 标题栏高度按 surface 的缩放比例换算 */
            var scale = (r.width && surf.width) ? (r.width / surf.width) : 1;
            var tbPx = tb * scale;
            host.style.left = r.left + 'px';
            host.style.top = (r.top + tbPx) + 'px';
            host.style.width = r.width + 'px';
            host.style.height = Math.max(1, r.height - tbPx) + 'px';
            host.style.zIndex = String(
                (parseInt(surfEl.style.zIndex, 10) || 10) + 1
            );
            frame.style.position = 'absolute';
            frame.style.left = '0px';
            frame.style.top = '0px';
            frame.style.width = '100%';
            frame.style.height = '100%';
        }
        sync();

        /* 跟随窗口移动 / 缩放 / 置顶 */
        win._kdSync = sync;
        var origMove = win.setPosition;
        var origResize = win.setBounds;
        var origActivate = win.activate;

        return { host: host, frame: frame, sync: sync };
    }

    function openSource(html, appName, opts) {
        if (typeof html !== 'string' || html.length === 0) {
            return CORE.fail(S.EINVAL, { reason: 'KD app content required' });
        }
        var o = opts || {};
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({
                title: appName || 'KD Application',
                width: o.width || 640, height: o.height || 480,
                icon: '📦', ecosystem: 'kd',
                singleInstance: false
            })
            : ui.Window.Create({ title: appName || 'KD Application',
                width: o.width || 640, height: o.height || 480, ecosystem: 'kd' });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        var parts = createHost(win, o);
        if (!parts) {
            return CORE.fail(S.EFAULT, { reason: 'could not create the KD frame host' });
        }
        var frame = parts.frame;

        var bridge = makeBridge(appName, frame);
        G.__ezntKdBridge = bridge;

        /* 宿主侧消息循环：接收 iframe 的桥接请求并回响应 */
        var msgHandler = function (ev) {
            var d = ev.data;
            if (!d || d.__eznt_kd_call !== true) { return; }
            /* 只接受自己这个 iframe 的消息 */
            if (frame.contentWindow && ev.source !== frame.contentWindow) { return; }
            var fn = bridge[d.name];
            var reply = { __eznt_kd_reply: true, id: d.id };
            if (typeof fn !== 'function') {
                reply.error = 'unknown bridge method: ' + d.name;
                try { (frame.contentWindow || parent).postMessage(reply, '*'); } catch (_) {}
                return;
            }
            try {
                var out = fn.apply(bridge, Array.isArray(d.args) ? d.args : []);
                if (out && typeof out.then === 'function') {
                    out.then(function (v) {
                        reply.result = v;
                        try { frame.contentWindow.postMessage(reply, '*'); } catch (_) {}
                    }, function (err) {
                        reply.error = (err && err.message) || String(err);
                        try { frame.contentWindow.postMessage(reply, '*'); } catch (_) {}
                    });
                } else {
                    reply.result = out === undefined ? null : out;
                    try { frame.contentWindow.postMessage(reply, '*'); } catch (_) {}
                }
            } catch (err) {
                reply.error = (err && err.message) || String(err);
                try { frame.contentWindow.postMessage(reply, '*'); } catch (_) {}
            }
        };
        G.addEventListener('message', msgHandler);

        frame.setAttribute('srcdoc', buildSrcdoc(html));

        var rec = {
            appName: appName, iframe: frame, bridge: bridge,
            host: parts.host, win: win, sync: parts.sync
        };
        running[win.id] = rec;

        /* 窗口销毁时同步清理 DOM，避免"关掉窗口内容还在" */
        var oldDestroy = win.onDestroy;
        win.onDestroy = function () {
            try { G.removeEventListener('message', msgHandler); } catch (_) {}
            try { parts.host.parentNode.removeChild(parts.host); } catch (_) {}
            delete running[win.id];
            if (typeof oldDestroy === 'function') { oldDestroy(); }
        };

        /* 窗口移动/缩放时同步宿主位置（iframe 是 DOM，不随 canvas 重绘） */
        if (typeof win.setBounds === 'function') {
            var origBounds = win.setBounds.bind(win);
            win.setBounds = function () {
                var r = origBounds.apply(null, arguments);
                try { parts.sync(); } catch (_) {}
                return r;
            };
        }
        if (typeof win.activate === 'function') {
            var origAct = win.activate.bind(win);
            win.activate = function () {
                var r = origAct.apply(null, arguments);
                try { parts.sync(); } catch (_) {}
                return r;
            };
        }

        return CORE.ok({ windowId: win.id, appName: appName });
    }

    /** openFile(path) -> Promise  load a .kd file and open it. */
    function openFile(path) {
        if (typeof path !== 'string' || path.length === 0) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'path required' }));
        }
        return K.ReadFileText(path).then(function (r) {
            if (r.status !== S.OK) { return r; }
            var name = path.slice(path.lastIndexOf('/') + 1).replace(/\.kd$/i, '');
            var opened = openSource(r.value, name);
            return opened.status === S.OK ? CORE.ok(opened.value) : opened;
        });
    }

    /* =================================================================
     * 3. Install / uninstall / list (lifecycle)
     * ============================================================== */

    function loadInstalled() {
        var hal = G.EznK.Kernel.HAL;
        var r = hal.fs.configGet(INSTALL_KEY, []);
        return (r.status === S.OK && Array.isArray(r.value)) ? r.value : [];
    }

    function saveInstalled(list) {
        G.EznK.Kernel.HAL.fs.configSet(INSTALL_KEY, list);
        return CORE.ok(true);
    }

    /** install(name, content) -> { status, value: app } */
    function install(name, content) {
        if (typeof name !== 'string' || name.length === 0) {
            return CORE.fail(S.EINVAL, { reason: 'app name required' });
        }
        if (typeof content !== 'string') {
            return CORE.fail(S.EINVAL, { reason: 'app content required' });
        }
        var list = loadInstalled();
        var existing = null;
        for (var i = 0; i < list.length; i++) {
            if (list[i].name === name) { existing = list[i]; break; }
        }
        if (existing) {
            existing.content = content;
            existing.updatedAt = new Date().toISOString();
        } else {
            list.push({
                name: name,
                content: content,
                size: content.length,
                installedAt: new Date().toISOString()
            });
        }
        saveInstalled(list);

        /* register in the app registry so the Start menu sees it */
        var reg = G.EznK.Service && G.EznK.Service.appRegistry;
        if (reg) {
            reg.register({ id: 'kd:' + name, name: name, icon: '[K]', category: 'kd', exts: ['.kd'] });
        }
        var srm = G.EznK.Kernel.SRM;
        if (srm) { srm.emit('kd:installed', { name: name }); }
        return CORE.ok({ name: name, size: content.length });
    }

    /** uninstall(name) -> { status, value: true } */
    function uninstall(name) {
        var list = loadInstalled();
        var next = list.filter(function (a) { return a.name !== name; });
        if (next.length === list.length) { return CORE.fail(S.ENOENT, { reason: 'app not installed' }); }
        saveInstalled(next);
        var reg = G.EznK.Service && G.EznK.Service.appRegistry;
        if (reg) { reg.unregister('kd:' + name); }
        var srm = G.EznK.Kernel.SRM;
        if (srm) { srm.emit('kd:uninstalled', { name: name }); }
        return CORE.ok(true);
    }

    /** list() -> { status, value: [{name, size, installedAt}] } */
    function list() {
        return CORE.ok(loadInstalled().map(function (a) {
            return { name: a.name, size: a.size, installedAt: a.installedAt, updatedAt: a.updatedAt || null };
        }));
    }

    /** launch(name) -> { status, value } */
    function launch(name) {
        var list2 = loadInstalled();
        for (var i = 0; i < list2.length; i++) {
            if (list2[i].name === name) {
                var r = openSource(list2[i].content, name);
                return r.status === S.OK ? r : r;
            }
        }
        return CORE.fail(S.ENOENT, { reason: 'app not installed: ' + name });
    }

    /** content(name) -> the stored source of an installed app. */
    function content(name) {
        var list2 = loadInstalled();
        for (var i = 0; i < list2.length; i++) {
            if (list2[i].name === name) { return CORE.ok(list2[i].content); }
        }
        return CORE.fail(S.ENOENT, { reason: 'app not installed' });
    }

    /* =================================================================
     * 4. Lifecycle
     * ============================================================== */

    function runningList() {
        return CORE.ok(Object.keys(running).map(function (id) {
            return { windowId: id, appName: running[id].appName };
        }));
    }

    function boot() {
        var srm = G.EznK.Kernel.SRM;
        if (srm) {
            srm.registerService('kd-runtime', { init: function () { LOG.info('KD runtime online'); } });
            srm.registerFunction('kd.open', function (html, name) { return openSource(html, name); }, 'open a KD app');
            srm.registerFunction('kd.install', function (n, c) { return install(n, c); }, 'install a KD app');
            srm.registerFunction('kd.uninstall', function (n) { return uninstall(n); }, 'uninstall a KD app');
            srm.registerFunction('kd.list', function () { return list(); }, 'list installed KD apps');
        }
        return CORE.ok(true);
    }

    function dispose() {
        Object.keys(running).forEach(function (id) {
            var w = ui.Window.Get(id);
            if (w.status === S.OK) { w.value.destroy(); }
        });
        running = Object.create(null);
        return CORE.ok(true);
    }

    var KD = {};
    KD.version = '1.0.0';
    KD.SANDBOX = 'allow-scripts';
    KD.boot = boot;
    KD.shutdown = function () { return CORE.ok(true); };

    KD.openSource = openSource;
    KD.openFile = openFile;
    KD.install = install;
    KD.uninstall = uninstall;
    KD.list = list;
    KD.launch = launch;
    KD.content = content;
    KD.running = runningList;
    KD.makeBridge = makeBridge;
    KD.dispose = dispose;

    if (!G.EznK.Runtime) { G.EznK.Runtime = {}; }
    G.EznK.Runtime.kd = KD;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('runtime-kd', KD);
    }
    LOG.info('js/runtime/kd.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
