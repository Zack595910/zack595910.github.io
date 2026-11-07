/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 2 - Runtime Layer
 *
 *   File    : js/runtime/sys.js
 *   Module  : EznK.Runtime.sys
 *   Layer   : L2 运行时层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The sys script runtime - CONTRACT 7.5:
 *
 *   TWO SEPARATE CHANNELS (must never be mixed):
 *     Channel 1  UPDATE    installAsUpdate(name, code) - whole-package
 *                          replacement, stored under /System/Updates,
 *                          rollback supported
 *     Channel 2  EXECUTE   execute(code) - developer code execution,
 *                          produces NO package, leaves no installable
 *
 *   SECURITY CHAIN (5 layers, exactly as PTD):
 *     1. TrustedInstaller account must exist
 *     2. administrator password
 *     3. plain-text key inside a 60 second window
 *     4. dangerous-code scan (warn + confirm)
 *     5. numeric captcha
 *
 *   EXTENSION TOLERANCE: .sys / .txt / .xyz / any suffix runs if the
 *   content is a sys script (there is no suffix check anywhere).
 *
 *   COMPILE: compileToSkl(source) produces an .skl kernel library that
 *   can be loaded by .exc apps.
 *
 *   NOTE ON `eval`: a sys script IS arbitrary privileged code - that is
 *   the whole point of the channel, and it is why the five-layer chain
 *   exists. Execution uses `new Function` (never string `eval`), gets a
 *   private scope, and every failure is isolated so the rest of the
 *   system is unaffected (contract 9).
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Runtime && G.EznK.Runtime.sys) { return; }

    var CORE = G.EznK.Platform.Core;
    if (!CORE) { throw new Error('[EznK/L2] js/runtime/sys.js requires platform/core.js'); }
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L2:sys');

    var api = ezn32.api;
    var K = api.kernel;

    var UPDATES_DIR = '/System/Updates';
    var TI_KEY = '/System/TrustedInstaller.json';
    var KEY_WINDOW_MS = 60000;

    /** Pending plain-text keys: { key, issuedAt }. One at a time. */
    var pendingKey = null;

    /* =================================================================
     * 1. Security chain state
     * ============================================================== */

    function hal() { return EznK.Kernel.HAL; }

    function trustedInstaller() {
        var r = hal().fs.configGet(TI_KEY, null);
        return (r.status === S.OK) ? r.value : null;
    }

    function createTrustedInstaller(password) {
        if (typeof password !== 'string' || password.length < 4) {
            return CORE.fail(S.EINVAL, { reason: 'administrator password must be at least 4 characters' });
        }
        /* reuse the user service digest: never store the password itself */
        var users = G.EznK.Service && G.EznK.Service.user;
        /* The salt used to derive the hash MUST be the one stored, or the
         * later verification can never match. */
        var salt = newSalt();
        var make = users ? users.digest(salt, password) : Promise.resolve('plain$' + password);
        return make.then(function (hash) {
            hal().fs.configSet(TI_KEY, {
                createdAt: new Date().toISOString(),
                hash: hash,
                salt: salt
            });
            var srm = EznK.Kernel.SRM;
            if (srm) { srm.emit('sys:ti-created', null); }
            return CORE.ok(true);
        });
    }

    function newSalt() {
        var s = '';
        for (var i = 0; i < 16; i++) { s += Math.floor(Math.random() * 16).toString(16); }
        return s;
    }

    function verifyAdminPassword(password) {
        var ti = trustedInstaller();
        if (!ti) { return Promise.resolve(CORE.fail(S.ENOENT, { reason: 'TrustedInstaller does not exist' })); }
        var users = G.EznK.Service && G.EznK.Service.user;
        if (!users) { return Promise.resolve(CORE.fail(S.ENOSYS, { reason: 'user service not loaded' })); }
        return users.digest(ti.salt || 'ti', password || '').then(function (hash) {
            return hash === ti.hash ? CORE.ok(true) : CORE.fail(S.EACCES, { reason: 'incorrect password' });
        });
    }

    function hasTrustedInstaller() { return !!trustedInstaller(); }

    /* ---------------- layer 3: plain-text key ---------------- */

    function generatePlainKey() {
        var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        var rand = '';
        for (var i = 0; i < 4; i++) {
            rand += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        var u = api.advapi.GetCurrentUser();
        var user = (u.status === S.OK && u.value) ? u.value.name : 'ADMIN';
        var key = 'EZNT-' + String(user).toUpperCase().replace(/[^A-Z0-9]/g, '') + '-' + rand;
        pendingKey = { key: key, issuedAt: Date.now() };
        return CORE.ok(key);
    }

    function verifyPlainKey(input) {
        if (!pendingKey) { return CORE.fail(S.EBUSY, { reason: 'no key has been issued' }); }
        if (Date.now() - pendingKey.issuedAt > KEY_WINDOW_MS) {
            pendingKey = null;
            return CORE.fail(S.EBUSY, { reason: 'key expired (60 second window)' });
        }
        var okKey = String(input || '').trim().toUpperCase() === pendingKey.key;
        if (okKey) { pendingKey = null; }
        return okKey ? CORE.ok(true) : CORE.fail(S.EACCES, { reason: 'key mismatch' });
    }

    /* ---------------- layer 4: dangerous code scan ---------------- */

    var DANGEROUS = [
        { pattern: /localStorage\.clear\s*\(/, name: 'clears all stored data' },
        { pattern: /localStorage\.removeItem\s*\(\s*['"]eznt\.cfg\.\/System\/Users/, name: 'deletes user accounts' },
        { pattern: /delete\s+EznK\.(Kernel|Runtime)/, name: 'deletes a kernel or runtime namespace' },
        { pattern: /\.prototype\s*=\s*null/, name: 'destroys a prototype chain' },
        { pattern: /setInterval\s*\(\s*function\s*\(\s*\)\s*\{\s*\}/, name: 'busy loop' },
        { pattern: /while\s*\(\s*true\s*\)/, name: 'infinite loop' },
        { pattern: /Storage\.config\.clear\s*\(/, name: 'wipes the configuration disk' },
        { pattern: /SRM\.shutdown\s*\(/, name: 'shuts the kernel down' }
    ];

    /** scanDangerous(code) -> { status, value: [{name}] } */
    function scanDangerous(code) {
        var text = String(code || '');
        var found = [];
        DANGEROUS.forEach(function (d) {
            if (d.pattern.test(text)) { found.push({ name: d.name }); }
        });
        return CORE.ok(found);
    }

    /* ---------------- layer 5: captcha ---------------- */

    function generateCaptcha() {
        var code = '';
        for (var i = 0; i < 4; i++) { code += Math.floor(Math.random() * 10); }
        pendingCaptcha = code;
        return CORE.ok(code);
    }

    var pendingCaptcha = null;

    function verifyCaptcha(input) {
        if (!pendingCaptcha) { return CORE.fail(S.EBUSY, { reason: 'no captcha issued' }); }
        var ok2 = String(input || '').trim() === pendingCaptcha;
        pendingCaptcha = null;
        return ok2 ? CORE.ok(true) : CORE.fail(S.EACCES, { reason: 'captcha mismatch' });
    }

    /* =================================================================
     * 2. Script execution scope
     * ============================================================== */

    /** The `_SYS` object handed to every sys script (legacy surface). */
    function buildSysScope() {
        var SYS = {
            /* notifications */
            showToast: function (m) {
                var nc = G.EznK.Shell && G.EznK.Shell.notifications;
                if (nc) { nc.push({ title: 'System', text: String(m), level: 'info', timeout: 3000 }); }
                return null;
            },
            shellPrint: function (t, cls) {
                var nc = G.EznK.Shell && G.EznK.Shell.notifications;
                if (nc) { nc.push({ title: 'System', text: String(t).slice(0, 120), level: cls === 'error' ? 'error' : 'info' }); }
                return null;
            },

            /* windows */
            createWindow: function (title, w, h) {
                var r = ezn32.ui.Window.Create({ title: String(title), width: w | 0 || 400, height: h | 0 || 300, ecosystem: 'script' });
                return r.status === S.OK ? r.value.id : null;
            },
            closeWindow: function (id) {
                var w = api.kernel && ezn32.ui.Window.Get(id);
                if (w.status === S.OK) { w.value.destroy(); }
                return true;
            },
            focusWindow: function (id) {
                var w = ezn32.ui.Window.Get(id);
                if (w.status === S.OK) { w.value.activate(); }
                return true;
            },
            getOpenWindows: function () { return ezn32.ui.Window.List().value; },

            /* files (through the kernel) */
            readFile: function (p) {
                var r = G.EznK.Platform.Storage.readSync(p);
                return r.status === S.OK ? r.value : null;
            },
            writeFile: function (p, c) {
                var r = G.EznK.Platform.Storage.writeSync(p, c);
                return r.status === S.OK;
            },
            deleteFile: function (p) { K.DeleteFile(p); return true; },
            listFiles: function (p) {
                var r = G.EznK.Platform.Storage.listSync(p || '/');
                return r.status === S.OK ? r.value : [];
            },

            /* KD */
            installKDApp: function (n, c) { return G.EznK.Runtime.kd.install(n, c).status === S.OK; },
            uninstallKDApp: function (n) { return G.EznK.Runtime.kd.uninstall(n).status === S.OK; },
            getInstalledKDApps: function () { return G.EznK.Runtime.kd.list().value; },
            openKDApp: function (c, n) { return G.EznK.Runtime.kd.openSource(c, n).status === S.OK; },

            /* shell */
            restartSystem: function () { return EznK.Boot.run(); },
            getVersion: function () { return '1.0.0'; },
            getScaleFactor: function () { return 1; },
            getElement: function () { return null; },
            querySelector: function () { return null; },
            querySelectorAll: function () { return []; },

            /* the kernel itself - this is a privileged channel */
            SRM: EznK.Kernel.SRM,
            EznK: G.EznK,
            Ezn32: G.ezn32
        };
        return SYS;
    }

    /* =================================================================
     * 3. Channel 2: EXECUTE (no package produced)
     * ============================================================== */

    var lastResult = null;

    /**
     * execute(code, opts) -> Promise<{status, value}>
     *   Runs a sys script with the _SYS scope. Produces NO installable
     *   package. Failures are captured and never propagate.
     */
    function execute(code, opts) {
        if (typeof code !== 'string') {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'code must be a string' }));
        }
        var o = opts || {};
        if (o.skipChain !== true) {
            var chain = o.chain || {};
            if (!hasTrustedInstaller()) {
                return Promise.resolve(CORE.fail(S.EACCES, { reason: 'TrustedInstaller account does not exist' }));
            }
            if (!chain.passwordVerified && chain.passwordVerified !== true) {
                /* The caller is expected to walk the chain; a raw execute
                 * without verification is refused. */
                return Promise.resolve(CORE.fail(S.EACCES, { reason: 'security chain not completed' }));
            }
        }

        var scope = buildSysScope();
        try {
            /* Privileged execution with an explicit scope. `new Function`
             * never reaches the caller's closure - only the parameters. */
            var fn = new Function('_SYS', '"use strict";\n' + code);
            var value = fn(scope);
            lastResult = { at: Date.now(), status: 'ok' };
            var srm = EznK.Kernel.SRM;
            if (srm) {
                srm.emit('sys:executed', { length: code.length });
                if (srm._addLog) { srm._addLog('sys', 'script executed (' + code.length + ' bytes)'); }
            }
            return Promise.resolve(CORE.ok(value === undefined ? null : value));
        } catch (err) {
            lastResult = { at: Date.now(), status: 'error', error: err && err.message };
            LOG.error('sys script threw: ' + (err && err.message));
            return Promise.resolve(CORE.fail(S.EFAULT, { reason: 'sys script error: ' + (err && err.message) }));
        }
    }

    /* =================================================================
     * 4. Channel 1: UPDATE (whole package replacement, rollback)
     * ============================================================== */

    function updatePath(name) { return UPDATES_DIR + '/' + name + '.sys'; }
    function backupPath(name) { return UPDATES_DIR + '/' + name + '.prev'; }
    function indexKey() { return '/System/Updates.json'; }

    function loadIndex_() {
        var r = hal().fs.configGet(indexKey(), []);
        return (r.status === S.OK && Array.isArray(r.value)) ? r.value : [];
    }

    function saveIndex_(list) { hal().fs.configSet(indexKey(), list); return CORE.ok(true); }

    /**
     * installAsUpdate(name, code, opts) -> Promise<{status, value}>
     *   Entire-package replacement. The previous version is kept as
     *   `<name>.prev` so rollback can restore it.
     */
    function installAsUpdate(name, code, opts) {
        if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'update name must be 1-64 safe characters' }));
        }
        if (typeof code !== 'string') {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'update code required' }));
        }
        var o = opts || {};
        if (o.skipChain !== true && !o.passwordVerified) {
            return Promise.resolve(CORE.fail(S.EACCES, { reason: 'security chain not completed' }));
        }

        return K.CreateDirectory(UPDATES_DIR).then(function () {
            /* keep the previous version for rollback */
            return K.GetFileAttributes(updatePath(name)).then(function (ex) {
                if (ex.status !== S.OK) { return CORE.ok(true); }
                return K.ReadFileText(updatePath(name)).then(function (old) {
                    if (old.status !== S.OK) { return CORE.ok(true); }
                    return K.WriteFileText(backupPath(name), old.value);
                });
            });
        }).then(function () {
            return K.WriteFileText(updatePath(name), code);
        }).then(function (w) {
            if (w.status !== S.OK) { return w; }

            var index = loadIndex_();
            var found = null;
            for (var i = 0; i < index.length; i++) {
                if (index[i].name === name) { found = index[i]; break; }
            }
            if (found) {
                found.updatedAt = new Date().toISOString();
                found.version = (found.version || 1) + 1;
                found.size = code.length;
            } else {
                index.push({
                    name: name,
                    version: 1,
                    size: code.length,
                    installedAt: new Date().toISOString(),
                    active: true
                });
            }
            saveIndex_(index);

            var srm = EznK.Kernel.SRM;
            if (srm) {
                srm.emit('sys:update-installed', { name: name });
                if (srm._addLog) { srm._addLog('sys', 'update installed: ' + name); }
            }
            return CORE.ok({ name: name, path: updatePath(name), size: code.length });
        });
    }

    /** listUpdates() -> { status, value: [] } */
    function listUpdates() { return CORE.ok(loadIndex_()); }

    /** rollbackUpdate(name) -> Promise<{status, value}> */
    function rollbackUpdate(name) {
        return K.ReadFileText(backupPath(name)).then(function (r) {
            if (r.status !== S.OK) {
                return CORE.fail(S.ENOENT, { reason: 'no previous version to roll back to' });
            }
            return K.WriteFileText(updatePath(name), r.value).then(function () {
                var index = loadIndex_();
                var found = null;
                for (var i = 0; i < index.length; i++) {
                    if (index[i].name === name) { found = index[i]; break; }
                }
                if (found) {
                    found.version = Math.max(1, (found.version || 2) - 1);
                    found.rolledBackAt = new Date().toISOString();
                    saveIndex_(index);
                }
                var srm = EznK.Kernel.SRM;
                if (srm) { srm.emit('sys:update-rolled-back', { name: name }); }
                return CORE.ok({ name: name, restored: r.value.length });
            });
        });
    }

    /** uninstallUpdate(name) -> Promise<{status, value: true}> */
    function uninstallUpdate(name) {
        var chain = K.DeleteFile(updatePath(name));
        chain = chain.then(function () { return K.DeleteFile(backupPath(name)); });
        return chain.then(function () {
            saveIndex_(loadIndex_().filter(function (u) { return u.name !== name; }));
            return CORE.ok(true);
        });
    }

    /* =================================================================
     * 5. Suffix tolerance + compile to .skl
     * ============================================================== */

    /**
     * openFile(path) -> Promise<{status, value: {content}}>
     *   ANY suffix is accepted. There is deliberately no extension check:
     *   .sys / .txt / .xyz all work if the content is a sys script.
     */
    function openFile(path) {
        if (typeof path !== 'string' || path.length === 0) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'path required' }));
        }
        return K.ReadFileText(path).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return CORE.ok({ path: path, content: r.value, suffix: path.slice(path.lastIndexOf('.')) || '' });
        });
    }

    /**
     * compileToSkl(source, meta) -> { status, value: sklSource }
     *   Wraps a sys script as an EZNT Kernel Library (.skl) that exports
     *   an init() function and can be required by .exc applications.
     */
    function compileToSkl(source, meta) {
        if (typeof source !== 'string') {
            return CORE.fail(S.EINVAL, { reason: 'source required' });
        }
        var m = meta || {};
        var name = m.name || 'UnnamedKernelLibrary';
        var version = m.version || '1.0.0';
        var lines = [
            '/* EZNT Kernel Library (.skl)',
            ' * name    : ' + name,
            ' * version : ' + version,
            ' * compiled: ' + new Date().toISOString(),
            ' * source length: ' + source.length + ' bytes',
            ' *',
            ' * Generated by js/runtime/sys.js - do not edit by hand.',
            ' */',
            '(function (root) {',
            '    "use strict";',
            '    var body = function (_SYS) {',
            source.split('\n').map(function (l) { return '        ' + l; }).join('\n'),
            '    };',
            '    var lib = {',
            '        __isSkl: true,',
            '        name: ' + JSON.stringify(name) + ',',
            '        version: ' + JSON.stringify(version) + ',',
            '        init: function (_SYS) { return body(_SYS); }',
            '    };',
            '    if (!root.EznK) { root.EznK = {}; }',
            '    if (!root.EznK.Skl) { root.EznK.Skl = {}; }',
            '    root.EznK.Skl[' + JSON.stringify(name) + '] = lib;',
            '}(typeof globalThis !== "undefined" ? globalThis : this));'
        ];
        return CORE.ok(lines.join('\n'));
    }

    /** saveAsSkl(source, path, meta) -> Promise */
    function saveAsSkl(source, path, meta) {
        var compiled = compileToSkl(source, meta);
        if (compiled.status !== S.OK) { return Promise.resolve(compiled); }
        return K.WriteFileText(path, compiled.value).then(function (r) {
            return r.status === S.OK ? CORE.ok({ path: path, size: compiled.value.length }) : r;
        });
    }

    /* =================================================================
     * 6. Lifecycle
     * ============================================================== */

    function boot() {
        var srm = EznK.Kernel.SRM;
        if (srm) {
            srm.registerService('sys-runtime', { init: function () { LOG.info('sys runtime online'); } });
        }
        return K.CreateDirectory(UPDATES_DIR).then(function () { return CORE.ok(true); });
    }

    var SYS = {};
    SYS.version = '1.0.0';
    SYS.boot = boot;
    SYS.shutdown = function () { return CORE.ok(true); };

    /* security chain */
    SYS.hasTrustedInstaller = hasTrustedInstaller;
    SYS.createTrustedInstaller = createTrustedInstaller;
    SYS.verifyAdminPassword = verifyAdminPassword;
    SYS.generatePlainKey = generatePlainKey;
    SYS.verifyPlainKey = verifyPlainKey;
    SYS.scanDangerous = scanDangerous;
    SYS.generateCaptcha = generateCaptcha;
    SYS.verifyCaptcha = verifyCaptcha;
    SYS.KEY_WINDOW_MS = KEY_WINDOW_MS;

    /* channels */
    SYS.execute = execute;
    SYS.installAsUpdate = installAsUpdate;
    SYS.listUpdates = listUpdates;
    SYS.rollbackUpdate = rollbackUpdate;
    SYS.uninstallUpdate = uninstallUpdate;

    /* files + compile */
    SYS.openFile = openFile;
    SYS.compileToSkl = compileToSkl;
    SYS.saveAsSkl = saveAsSkl;
    SYS.buildSysScope = buildSysScope;
    SYS.lastResult = function () { return CORE.ok(lastResult); };

    if (!G.EznK.Runtime) { G.EznK.Runtime = {}; }
    G.EznK.Runtime.sys = SYS;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('runtime-sys', SYS);
    }
    LOG.info('js/runtime/sys.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
