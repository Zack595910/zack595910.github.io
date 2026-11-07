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
            '  var HOST_MSG = "__eznt_kd_bridge__";',
            '  var api = {};',
            '  var names = ' + JSON.stringify([
                'shellPrint','showToast','readFile','writeFile','deleteFile','listFiles',
                'installKDApp','uninstallKDApp','getInstalledKDApps','openKDApp',
                'openWindow','closeWindow','setWindowTitle','getAppName','getVersion',
                'getPlatform','alert','openFiles','openEditor','openAbout'
            ]) + ';',
            '  names.forEach(function(n){',
            '    api[n] = function(){',
            '      try {',
            '        return parent.' + '' + 'window.__ezntKdBridge[n].apply(null, arguments);',
            '      } catch(e) { return null; }',
            '    };',
            '  });',
            '  window.__kdBridge = api;',
            '  window.shellPrint = api.shellPrint;',
            '  window.showToast = api.showToast;',
            '})();',
            '<\/script>'
        ].join('\n');
        return '<!DOCTYPE html><html><head><meta charset="utf-8">' + relay + '</head><body>' + html + '</body></html>';
    }

    /**
     * openSource(html, appName, opts) -> { status, value: { windowId } }
     *   Loads a KD app into a sandboxed iframe inside a real window.
     */
    function openSource(html, appName, opts) {
        if (typeof html !== 'string' || html.length === 0) {
            return CORE.fail(S.EINVAL, { reason: 'KD app content required' });
        }
        var o = opts || {};
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({
                title: appName || 'KD Application',
                width: o.width || 600, height: o.height || 450,
                icon: '[K]', ecosystem: 'kd',
                singleInstance: false
            })
            : ui.Window.Create({ title: appName || 'KD Application', width: o.width || 600, height: o.height || 450, ecosystem: 'kd' });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        var client = win.client;

        /* The iframe is a platform DOM element placed inside the client
         * canvas area. KD is HTML by contract, so this is the one place a
         * foreign document is allowed - and it is sandboxed. */
        var frameRes = DOM.create('iframe', {
            styles: {
                position: 'absolute',
                left: '0px',
                top: '0px',
                width: client.width + 'px',
                height: client.height + 'px',
                border: '0px',
                background: '#ffffff'
            }
        }, client.element && client.element.nodeType === 1 ? client.element : 'root');

        /* If the client has no DOM element (pure canvas window), fall back
         * to the window surface element so the frame still appears. */
        if (frameRes.status !== S.OK) {
            return CORE.fail(S.EFAULT, { reason: 'could not create the KD frame host' });
        }
        var frame = frameRes.value;
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('referrerpolicy', 'no-referrer');

        var bridge = makeBridge(appName, frame);
        /* the relay talks  parent.__ezntKdBridge.<fn> */
        G.__ezntKdBridge = bridge;

        frame.setAttribute('srcdoc', buildSrcdoc(html));

        running[win.id] = { appName: appName, iframe: frame, bridge: bridge };

        /* tear down the frame when the window closes */
        var srm = G.EznK.Kernel.SRM;
        if (srm) {
            srm.on('window:closed', function (p) {
                if (p && p.id === win.id && running[win.id]) {
                    try { DOM.remove(frame); } catch (_) { /* ignore */ }
                    delete running[win.id];
                }
            });
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
