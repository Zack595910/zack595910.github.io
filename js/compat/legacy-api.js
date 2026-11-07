/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Compatibility Layer
 *
 *   File    : js/compat/legacy-api.js
 *   Module  : EznK.Compat.LegacyApi
 *   Layer   : 兼容层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   CONTRACT 7.4 - the legacy API ecosystem. Every function the old
 *   system exposed must keep its NAME, its PARAMETERS and its BEHAVIOUR.
 *   Old scripts that call `createWindow(...)`, `VirtualFS.readFile(...)`,
 *   `openKDApp(...)` and the rest must run unchanged.
 *
 *   Two surfaces are provided:
 *
 *     1. GLOBAL functions  window.createWindow, window.showToast, ...
 *        exactly as the old single-file system defined them, so any code
 *        pasted from an old script works.
 *
 *     2. LEGACY object     EznK.Compat.legacy.<group>.<fn> for new code
 *        that wants to call through the compatibility layer explicitly.
 *
 *   Each function maps onto the current Ezn32 stack - it never touches
 *   the platform layer directly. That is the whole point of keeping the
 *   compatibility layer inside the architecture instead of as a set of
 *   ad-hoc patches (hard rule #3).
 *
 *   Return shapes follow the OLD functions (void / string / boolean), not
 *   the new { status, value } envelope, because compatibility is the
 *   requirement. `EznK.Compat.legacy.strict.*` exposes the modern,
 *   status-coded variants for new callers.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Compat && G.EznK.Compat.legacy) { return; }

    var CORE = G.EznK.Platform.Core;
    if (!CORE) { throw new Error('[EZNT compat] js/compat/legacy-api.js requires platform/core.js'); }
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EZNT:legacyApi');

    function ui() { return G.ezn32.ui; }
    function api() { return G.ezn32.api; }
    function svc() { return G.EznK.Service || {}; }
    function rt() { return G.EznK.Runtime || {}; }
    function shell() { return G.EznK.Shell || {}; }

    /* =================================================================
     * 1. Windows
     * ============================================================== */

    /**
     * createWindow(id, title, icon, w, h, top, left, body) - legacy order.
     *   The legacy signature is positional and every argument is optional
     *   after the title, so a short call must not fail. Returns the window
     *   OBJECT (the old system did too); use legacy.window.createId() when
     *   a bare id is what you need.
     */
    function createWindow(id, title, icon, w, h, top, left, body) {
        var specId = (typeof id === 'string' && id.length) ? id : undefined;
        var specTitle = (typeof title === 'string' && title.length) ? title : 'Window';

        /* an existing window with this id is activated, never duplicated */
        if (specId) {
            var existing = ui().Window.Get(specId);
            if (existing.status === S.OK) {
                existing.value.activate();
                return existing.value;
            }
        }

        var created = ui().Window.Create({
            id: specId,
            title: specTitle,
            icon: icon,
            width: (typeof w === 'number' && w > 0) ? w : 480,
            height: (typeof h === 'number' && h > 0) ? h : 360,
            x: typeof left === 'number' ? left : 60,
            y: typeof top === 'number' ? top : 60
        });
        if (created.status !== S.OK) { return null; }
        var win = created.value;
        /* legacy `body` was an HTML string; the closest modern equivalent
         * is a label so the text never becomes raw markup on screen. */
        if (typeof body === 'string' && body.length) {
            var plain = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            if (plain) {
                win.addControl(new ui().controls.Label({
                    x: 12, y: 12, width: Math.max(40, win.client.width - 24), text: plain
                }));
            }
        }
        return win;
    }

    /** createId(...) - same as createWindow but returns the window id. */
    function createId(id, title, icon, w, h, top, left, body) {
        var w2 = createWindow(id, title, icon, w, h, top, left, body);
        return w2 ? w2.id : null;
    }

    function closeWindow(id) {
        var w = ui().Window.Get(id);
        if (w.status === S.OK) { w.value.destroy(); return true; }
        return false;
    }

    function focusWindow(id) {
        var w = ui().Window.Get(id);
        if (w.status === S.OK) { w.value.activate(); return true; }
        return false;
    }

    function minimizeWindow(id) {
        var w = ui().Window.Get(id);
        if (w.status === S.OK) { return w.value.minimize().status === S.OK; }
        return false;
    }

    function restoreWindow(id) {
        var w = ui().Window.Get(id);
        if (w.status === S.OK) { return w.value.restore().status === S.OK; }
        return false;
    }

    function toggleMaximize(id) {
        var w = ui().Window.Get(id);
        if (w.status === S.OK) { return w.value.toggleMaximize().status === S.OK; }
        return false;
    }

    function updateWindowTitle(id, title) {
        var w = ui().Window.Get(id);
        if (w.status === S.OK) { w.value.setTitle(String(title)); return true; }
        return false;
    }

    /** openWindows - the legacy global window table. */
    function openWindowsTable() {
        var out = {};
        ui().Window.List().value.forEach(function (w) { out[w.id] = w; });
        return out;
    }

    function getActiveWindowId() {
        var list = ui().Window.List().value;
        for (var i = 0; i < list.length; i++) {
            if (list[i].active) { return list[i].id; }
        }
        return null;
    }

    /* =================================================================
     * 2. VirtualFS (legacy synchronous file API)
     * ============================================================== */

    var VirtualFS = {
        /** readFile(path) -> content | null */
        readFile: function (path) {
            var r = G.EznK.Platform.Storage.readSync(path);
            return r.status === S.OK ? r.value : null;
        },
        /** writeFile(path, content) -> void */
        writeFile: function (path, content) {
            G.EznK.Platform.Storage.writeSync(path, content);
            return null;
        },
        /** deleteFile(path) -> void */
        deleteFile: function (path) {
            api().kernel.DeleteFile(path);
            return null;
        },
        /** listFiles() -> {name: content} map of the root */
        listFiles: function () {
            var r = G.EznK.Platform.Storage.listSync('/');
            var out = {};
            if (r.status === S.OK) {
                r.value.forEach(function (e) {
                    if (e.type === 'file') { out[e.name] = VirtualFS.readFile(e.path); }
                });
            }
            return out;
        },
        /** hideFile(path) - kept for compatibility; files are path-based now */
        hideFile: function (path) {
            var hidden = G.EznK.Platform.Storage.config.get('/System/HiddenFiles.json', []);
            var list = (hidden.status === S.OK && Array.isArray(hidden.value)) ? hidden.value : [];
            if (list.indexOf(path) === -1) { list.push(path); }
            G.EznK.Platform.Storage.config.set('/System/HiddenFiles.json', list);
            return null;
        },
        installKDApp: function (name, content) {
            var kd = rt().kd;
            if (kd) { kd.install(name, content); }
            return null;
        },
        uninstallKDApp: function (name) {
            var kd = rt().kd;
            if (kd) { kd.uninstall(name); }
            return null;
        },
        getInstalledKDApps: function () {
            var kd = rt().kd;
            return kd ? kd.list().value : [];
        },
        refreshStartMenuKD: function () {
            var sm = shell().startMenu;
            if (sm && sm.IsOpen() && sm.IsOpen()) { sm.close(); }
            return null;
        },
        /* legacy virtual folders (kept as plain metadata) */
        createVirtualFolder: function (name) {
            var key = '/System/VirtualFolders.json';
            var cur = G.EznK.Platform.Storage.config.get(key, {});
            var folders = cur.status === S.OK ? cur.value : {};
            if (folders[name]) { return false; }
            folders[name] = { name: name, files: [], time: new Date().toISOString() };
            G.EznK.Platform.Storage.config.set(key, folders);
            return true;
        },
        removeVirtualFolder: function (name) {
            var key = '/System/VirtualFolders.json';
            var cur = G.EznK.Platform.Storage.config.get(key, {});
            var folders = cur.status === S.OK ? cur.value : {};
            delete folders[name];
            G.EznK.Platform.Storage.config.set(key, folders);
            return null;
        },
        getVirtualFolders: function () {
            var cur = G.EznK.Platform.Storage.config.get('/System/VirtualFolders.json', {});
            return cur.status === S.OK ? cur.value : {};
        },
        addFileToFolder: function (folderName, filePath) {
            var key = '/System/VirtualFolders.json';
            var cur = G.EznK.Platform.Storage.config.get(key, {});
            var folders = cur.status === S.OK ? cur.value : {};
            var f = folders[folderName];
            if (!f) { return false; }
            if (f.files.indexOf(filePath) === -1) { f.files.push(filePath); }
            G.EznK.Platform.Storage.config.set(key, folders);
            return true;
        },
        removeFileFromFolder: function (folderName, filePath) {
            var key = '/System/VirtualFolders.json';
            var cur = G.EznK.Platform.Storage.config.get(key, {});
            var folders = cur.status === S.OK ? cur.value : {};
            var f = folders[folderName];
            if (!f) { return false; }
            f.files = f.files.filter(function (p) { return p !== filePath; });
            G.EznK.Platform.Storage.config.set(key, folders);
            return true;
        }
    };

    /* =================================================================
     * 3. Notifications
     * ============================================================== */

    function showToast(message) {
        var nc = shell().notifications;
        if (nc) {
            nc.push({ title: 'EZNT', text: String(message), level: 'info', timeout: 3000 });
        }
        return null;
    }

    function shellPrint(text, className) {
        var nc = shell().notifications;
        if (nc) {
            nc.push({
                title: 'Shell',
                text: String(text === null || text === undefined ? '' : text).slice(0, 120),
                level: className === 'error' ? 'error' : 'info',
                timeout: 3000
            });
        }
        return null;
    }

    /* =================================================================
     * 4. KD apps
     * ============================================================== */

    function openKDApp(content, appName) {
        var kd = rt().kd;
        if (!kd) { return null; }
        var r = kd.openSource(content, appName);
        return r.status === S.OK ? r.value.windowId : null;
    }

    function installKDApp(name, content) {
        var kd = rt().kd;
        if (kd) { kd.install(name, content); }
        return null;
    }

    function uninstallKDApp(name) {
        var kd = rt().kd;
        if (kd) { kd.uninstall(name); }
        return null;
    }

    function getInstalledKDApps() {
        var kd = rt().kd;
        return kd ? kd.list().value : [];
    }

    /* =================================================================
     * 5. Editor / shell / files / control panel
     * ============================================================== */

    function openEditor(path) {
        var apps = G.EznK.Apps || {};
        if (apps.editor && typeof apps.editor.open === 'function') {
            return apps.editor.open({ path: path });
        }
        return null;
    }

    function saveFile() {
        var apps = G.EznK.Apps || {};
        if (apps.editor && typeof apps.editor.save === 'function') { return apps.editor.save(); }
        return null;
    }

    function runEditorCode() {
        var apps = G.EznK.Apps || {};
        if (apps.editor && typeof apps.editor.run === 'function') { return apps.editor.run(); }
        return null;
    }

    function openShell() {
        var apps = G.EznK.Apps || {};
        if (apps.shell && typeof apps.shell.open === 'function') { return apps.shell.open(); }
        return null;
    }

    function executeShellCode(code) {
        var py = rt().python;
        if (py && py.isReady()) { return py.run(code); }
        shellPrint('Python is not installed.', 'error');
        return null;
    }

    function openFiles() {
        var apps = G.EznK.Apps || {};
        if (apps.fileManager && typeof apps.fileManager.open === 'function') { return apps.fileManager.open(); }
        return null;
    }

    function openFileByType(path) {
        return api().shell.OpenFile(path);
    }

    function openControlPanel() {
        var cp = shell().windowsControl;
        if (cp) { return cp.open(); }
        return null;
    }

    function openAbout() {
        var apps = G.EznK.Apps || {};
        if (apps.about && typeof apps.about.open === 'function') { return apps.about.open(); }
        return null;
    }

    function openSysManager() {
        var apps = G.EznK.Apps || {};
        if (apps.sysManager && typeof apps.sysManager.open === 'function') { return apps.sysManager.open(); }
        return openControlPanel();
    }

    function restartSystem() {
        var ba = shell().bootAnimation;
        if (ba) { return ba.restart(); }
        return null;
    }

    function toggleStartMenu() {
        var sm = shell().startMenu;
        if (sm) { return sm.toggle(); }
        return null;
    }

    /* =================================================================
     * 6. Publish the global surface
     * ============================================================== */

    var GLOBALS = {
        /* windows */
        createWindow: createWindow,
        createWindowId: createId,
        closeWindow: closeWindow,
        focusWindow: focusWindow,
        minimizeWindow: minimizeWindow,
        restoreWindow: restoreWindow,
        toggleMaximize: toggleMaximize,
        updateWindowTitle: updateWindowTitle,
        getActiveWindowId: getActiveWindowId,

        /* notifications */
        showToast: showToast,
        shellPrint: shellPrint,

        /* virtual filesystem */
        VirtualFS: VirtualFS,

        /* KD */
        openKDApp: openKDApp,
        installKDApp: installKDApp,
        uninstallKDApp: uninstallKDApp,
        getInstalledKDApps: getInstalledKDApps,

        /* apps */
        openEditor: openEditor,
        saveFile: saveFile,
        runEditorCode: runEditorCode,
        openShell: openShell,
        executeShellCode: executeShellCode,
        openFiles: openFiles,
        openFileByType: openFileByType,
        openControlPanel: openControlPanel,
        openAbout: openAbout,
        openSysManager: openSysManager,

        /* system */
        restartSystem: restartSystem,
        toggleStartMenu: toggleStartMenu
    };

    var installed = [];
    Object.keys(GLOBALS).forEach(function (name) {
        /* never clobber an existing global that something else owns */
        if (G[name] === undefined) {
            G[name] = GLOBALS[name];
            installed.push(name);
        } else {
            /* still expose it through the namespace below */
        }
    });

    /** openWindows - the legacy live table (recomputed accessor). */
    if (G.openWindows === undefined) {
        G.openWindows = openWindowsTable();
    }

    /* =================================================================
     * 7. Strict namespaced API
     * ============================================================== */

    function strict(group) {
        var out = {};
        Object.keys(group).forEach(function (k) {
            var fn = group[k];
            if (typeof fn !== 'function') { out[k] = fn; return; }
            out[k] = function () {
                try {
                    return CORE.ok(fn.apply(null, arguments));
                } catch (err) {
                    return CORE.fail(S.EFAULT, { reason: err && err.message });
                }
            };
        });
        return out;
    }

    var legacy = {
        version: '1.0.0',
        functions: GLOBALS,
        installedGlobals: installed.slice(0),
        window: {
            create: createWindow, createId: createId, close: closeWindow, focus: focusWindow,
            minimize: minimizeWindow, restore: restoreWindow,
            toggleMaximize: toggleMaximize, setTitle: updateWindowTitle,
            active: getActiveWindowId, table: openWindowsTable
        },
        fs: VirtualFS,
        ui: { showToast: showToast, shellPrint: shellPrint },
        kd: {
            open: openKDApp, install: installKDApp, uninstall: uninstallKDApp,
            list: getInstalledKDApps
        },
        apps: {
            editor: openEditor, save: saveFile, run: runEditorCode,
            shell: openShell, exec: executeShellCode, files: openFiles,
            byType: openFileByType, controlPanel: openControlPanel,
            about: openAbout, sysManager: openSysManager
        },
        system: { restart: restartSystem, startMenu: toggleStartMenu }
    };

    legacy.strict = {
        window: strict(legacy.window),
        fs: strict(legacy.fs),
        ui: strict(legacy.ui),
        kd: strict(legacy.kd),
        apps: strict(legacy.apps),
        system: strict(legacy.system)
    };

    /** list() - every legacy function name provided by this layer. */
    function listFunctions() {
        return CORE.ok(Object.keys(GLOBALS).sort());
    }

    function isInstalled(name) {
        return CORE.ok(installed.indexOf(name) !== -1);
    }

    if (!G.EznK.Compat) { G.EznK.Compat = {}; }
    G.EznK.Compat.legacy = legacy;
    if (!G.EZNT.Compat) { G.EZNT.Compat = {}; }
    G.EZNT.Compat.legacyApi = legacy;

    legacy.listFunctions = listFunctions;
    legacy.isInstalled = isInstalled;

    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('compat-legacy-api', {
            version: '1.0.0',
            boot: function () { return CORE.ok(true); },
            listFunctions: listFunctions
        });
    }

    LOG.info('js/compat/legacy-api.js 已加载 (' + installed.length + ' globals)');

}(typeof globalThis !== 'undefined' ? globalThis : this));
