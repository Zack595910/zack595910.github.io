/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 API
 *
 *   File    : js/api/shell.js
 *   Module  : EznK.Api.Shell  (alias: ezn32.api.shell)
 *   Layer   : Ezn32 API
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   ezn32.api.shell - the shell32.dll equivalent: shell integration,
 *   "open this file", "launch this app", toast notifications.
 *
 *     ShellExecute(path, verb?)  -> launches an app / opens a file by type
 *     OpenFile(path)             -> ShellExecute "open"
 *     RegisterApplication(spec)  -> app registry entry (id, name, exts...)
 *     EnumApplications()         -> installed applications
 *     LaunchApplication(id)      -> start a registered app
 *     ShowNotification(text, opts) -> toast via the notify service
 *     GetFileType(path)          -> extension -> handler id
 *
 *   The shell does NOT know how to render .exc / .kd / .rf files. It asks
 *   the application registry (L4 service) which handler owns the type,
 *   then asks the runtime (L2) to run it. This module is the routing
 *   layer, which is why it sits in Ezn32 API.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.ezn32 && G.ezn32.api && G.ezn32.api.shell && G.ezn32.api.shell.__isApiShell === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[Ezn32 API] js/api/shell.js requires platform/core.js');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('Ezn32/API:shell');

    function srm() {
        var k = G.EznK && G.EznK.Kernel;
        return (k && k.SRM) || G.SRM || null;
    }
    function mod(name) {
        var k = G.EznK && G.EznK.Kernel;
        if (!k) { return null; }
        return (k.modules && k.modules[name]) || k[name] || null;
    }
    function svc(name) {
        var k = G.EznK && G.EznK.Service;
        return (k && k[name]) || null;
    }

    /* =================================================================
     * 1. File type mapping
     * ============================================================== */

    /** Built-in extension -> handler table (HKCR mirrors this). */
    var DEFAULT_TYPES = {
        '.txt': 'editor',
        '.md': 'editor',
        '.py': 'editor',
        '.rf': 'rf-runtime',
        '.sys': 'sys-manager',
        '.exc': 'exc-runtime',
        '.kd': 'kd-runtime',
        '.zjl': 'editor',
        '.skl': 'info',
        '.json': 'editor',
        '.html': 'kd-runtime',
        '.png': 'viewer',
        '.jpg': 'viewer',
        '.bmp': 'viewer'
    };

    /** GetFileType(path) -> { status, value: handlerId }
     *  Resolution order (registry first, so the user can re-associate):
     *    1. HKCR\<ext>          -> application id
     *    2. DEFAULT_TYPES[ext]  -> built-in application id
     *    3. 'unknown'           -> no association */
    function GetFileType(path) {
        if (typeof path !== 'string' || path.length === 0) {
            return fail(S.EINVAL, { reason: 'path required' });
        }
        var dot = path.lastIndexOf('.');
        if (dot < 0) { return ok('unknown'); }
        var ext = path.slice(dot).toLowerCase();
        var s = srm();
        if (s) {
            var registered = s.regGet('HKCR\\' + ext);
            if (typeof registered === 'string' && registered.length > 0) {
                return ok(registered);
            }
        }
        return ok(DEFAULT_TYPES[ext] || 'unknown');
    }

    /** GetMimeType(path) -> { status, value: mime } */
    function GetMimeType(path) {
        if (typeof path !== 'string' || path.length === 0) {
            return fail(S.EINVAL, { reason: 'path required' });
        }
        var dot = path.lastIndexOf('.');
        var ext = dot < 0 ? '' : path.slice(dot).toLowerCase();
        var s = srm();
        if (s) {
            var mime = s.regGet('HKCR\\Mime\\' + ext);
            if (typeof mime === 'string' && mime.length > 0) { return ok(mime); }
        }
        return ok('application/octet-stream');
    }

    /* =================================================================
     * 2. Application registry (delegates to the L4 app-registry service)
     * ============================================================== */

    var localApps = Object.create(null);   /* fallback when L4 is absent */

    /** RegisterApplication(spec) -> { status, value: app } */
    function RegisterApplication(spec) {
        var s = spec || {};
        if (typeof s.id !== 'string' || s.id.length === 0) {
            return fail(S.EINVAL, { reason: 'application id required' });
        }
        var registry = svc('appRegistry') || mod('app-registry');
        if (registry && typeof registry.register === 'function') {
            return registry.register(s);
        }
        localApps[s.id] = {
            id: s.id,
            name: s.name || s.id,
            exts: Array.isArray(s.exts) ? s.exts.slice(0) : [],
            entry: s.entry || null,
            icon: s.icon || '',
            category: s.category || 'other',
            builtin: s.builtin === true
        };
        return ok(localApps[s.id]);
    }

    /** EnumApplications() -> { status, value: app[] } */
    function EnumApplications() {
        var registry = svc('appRegistry') || mod('app-registry');
        if (registry && typeof registry.list === 'function') {
            return registry.list();
        }
        return ok(Object.keys(localApps).map(function (k) { return localApps[k]; }));
    }

    /** LaunchApplication(id, opts) -> { status, value } */
    function LaunchApplication(id, opts) {
        var registry = svc('appRegistry') || mod('app-registry');
        if (registry && typeof registry.launch === 'function') {
            return registry.launch(id, opts);
        }
        var app = localApps[id];
        if (!app) { return fail(S.ENOENT, { reason: 'application not registered: ' + id }); }
        return fail(S.ENOSYS, { reason: 'no launcher available for ' + id, app: app });
    }

    /* =================================================================
     * 3. ShellExecute
     * ============================================================== */

    /**
     * ShellExecute(path, opts) -> Promise<{status, value}>
     *   Routes by file type:
     *     .rf   -> rf runtime
     *     .kd   -> kd runtime (sandbox iframe)
     *     .exc  -> exc runtime
     *     .sys  -> sys manager
     *     text  -> editor
     *     unknown -> fail ENOENT with the type so the UI can say "no
     *                application is associated"
     */
    function ShellExecute(path, opts) {
        var o = opts || {};
        if (typeof path !== 'string' || path.length === 0) {
            return Promise.resolve(fail(S.EINVAL, { reason: 'path required' }));
        }
        /* 目录：交给文件管理器打开（PTD 同样行为）。
         * 目录没有扩展名，GetFileType 会返回 unknown，必须在这里先分流。
         * GetFileAttributes 是异步的，所以整条路径改成 Promise 链。 */
        var K = G.ezn32.api.kernel;
        var fmApp = G.EznK && G.EznK.Apps && G.EznK.Apps.fileManager;

        var attrRes = (K && typeof K.GetFileAttributes === 'function')
            ? Promise.resolve(K.GetFileAttributes(path))
            : Promise.resolve(null);

        return attrRes.then(function (attr) {
            if (attr && attr.status === S.OK && attr.value &&
                (attr.value.type === 'dir' || attr.value.directory === true ||
                 attr.value.isDirectory === true)) {
                if (fmApp && typeof fmApp.open === 'function') {
                    return fmApp.open({ path: path });
                }
                return fail(S.ENOSYS, { reason: 'file manager not available' });
            }

            var type = GetFileType(path);
        if (type.status !== S.OK) { return Promise.resolve(type); }
        var handler = type.value;
        var rt = G.EznK && G.EznK.Runtime;

        function needRuntime(name, fn) {
            if (!rt || typeof rt[name][fn] !== 'function') {
                return Promise.resolve(fail(S.ENOSYS, {
                    reason: 'runtime "' + name + '" not loaded', handler: handler
                }));
            }
            return rt[name][fn](path, o);
        }

        switch (handler) {
            case 'rf-runtime':
                return needRuntime('rf', 'runFile');
            case 'kd-runtime':
                return needRuntime('kd', 'openFile');
            case 'exc-runtime':
                return needRuntime('exc', 'runFile');
            case 'sys-manager':
                return needRuntime('sys', 'openManager');
            case 'editor':
                var apps = G.EznK && G.EznK.Apps;
                if (apps && apps.editor && typeof apps.editor.open === 'function') {
                    return Promise.resolve(apps.editor.open(path));
                }
                return Promise.resolve(fail(S.ENOSYS, { reason: 'editor not available' }));
            default:
                return Promise.resolve(fail(S.ENOENT, {
                    reason: 'no application is associated with ' + path,
                    handler: handler
                }));
            }
        });
    }

    function OpenFile(path) {
        return ShellExecute(path, { verb: 'open' });
    }

    /* =================================================================
     * 4. Notifications
     * ============================================================== */

    /** ShowNotification(text, opts) -> { status, value } */
    function ShowNotification(text, opts) {
        var o = opts || {};
        if (typeof text !== 'string' || text.length === 0) {
            return fail(S.EINVAL, { reason: 'notification text required' });
        }
        var notify = svc('notify') || mod('notify');
        if (notify && typeof notify.push === 'function') {
            return notify.push({
                title: o.title || 'EZNT',
                text: text,
                level: o.level || 'info',
                timeout: typeof o.timeout === 'number' ? o.timeout : 3000
            });
        }
        /* Fallback: kernel event so the shell can show it when it loads. */
        var s = srm();
        if (s) { s.emit('notify:push', { title: o.title || 'EZNT', text: text, level: o.level || 'info' }); }
        return ok({ queued: true });
    }

    /* =================================================================
     * 5. Public handle
     * ============================================================== */

    var Sh = {};
    Sh.__isApiShell = true;
    Sh.version = '1.0.0';
    Sh.STATUS = S;
    Sh.DEFAULT_TYPES = Object.freeze(Object.assign({}, DEFAULT_TYPES));

    Sh.GetFileType = GetFileType;
    Sh.GetMimeType = GetMimeType;
    Sh.RegisterApplication = RegisterApplication;
    Sh.EnumApplications = EnumApplications;
    Sh.LaunchApplication = LaunchApplication;
    Sh.ShellExecute = ShellExecute;
    Sh.OpenFile = OpenFile;
    Sh.ShowNotification = ShowNotification;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Api) { G.EznK.Api = {}; }
    G.EznK.Api.Shell = Sh;
    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.api) { G.ezn32.api = {}; }
    G.ezn32.api.shell = Sh;
    if (!G.EZNT.api) { G.EZNT.api = {}; }
    G.EZNT.api.shell = Sh;

    LOG.info('js/api/shell.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
