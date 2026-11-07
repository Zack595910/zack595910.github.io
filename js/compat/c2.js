/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Compatibility Layer
 *
 *   File    : js/compat/c2.js
 *   Module  : EznK.Compat.c2
 *   Layer   : 兼容层
 *
 *   The C2 compatibility SURFACE: the file with the .c2 extension marker,
 *   the association registration and the globals that a C2 program file
 *   expects. The interpreter itself lives in js/runtime/c2-compat.js; this
 *   file is the compatibility glue that makes `open C2 file` work from the
 *   shell and gives old code the names it used.
 *
 *   Relationship (kept explicit so there is exactly one interpreter):
 *     js/runtime/c2-compat.js  -> the C2 executor (L2 runtime)
 *     js/compat/c2.js          -> the .c2 entry points + globals (compat)
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Compat && G.EznK.Compat.c2) { return; }

    var CORE = G.EznK.Platform.Core;
    if (!CORE) { throw new Error('[EZNT compat] js/compat/c2.js requires platform/core.js'); }
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EZNT:compat-c2');

    var EXT = '.c2';
    var MIME = 'application/x-eznt-c2';

    function runtime() { return G.EznK.Runtime && G.EznK.Runtime.c2; }

    /* =================================================================
     * 1. Entry points
     * ============================================================== */

    /** run(code, opts) -> Promise<{status,value}>  C2 source execution. */
    function run(code, opts) {
        var rt = runtime();
        if (!rt) {
            return Promise.resolve(CORE.fail(S.ENOSYS, {
                reason: 'C2 compatibility runtime is not loaded (it is optional)'
            }));
        }
        return rt.run(code, opts);
    }

    /** openFile(path) -> Promise  load a .c2 file and run it. */
    function openFile(path) {
        var rt = runtime();
        if (!rt) {
            return Promise.resolve(CORE.fail(S.ENOSYS, {
                reason: 'C2 compatibility runtime is not loaded (it is optional)'
            }));
        }
        return rt.runFile(path);
    }

    /** isAvailable() -> { status, value: boolean } */
    function isAvailable() {
        return CORE.ok(!!runtime());
    }

    /* =================================================================
     * 2. Shell association
     * ============================================================== */

    /** registerAssociation() - make .c2 open through the shell. */
    function registerAssociation() {
        var srm = G.EznK.Kernel && G.EznK.Kernel.SRM;
        if (srm) {
            srm.regSet('HKCR\\' + EXT, 'c2-runtime');
            srm.regSet('HKCR\\Mime\\' + EXT, MIME);
        }
        var reg = G.EznK.Service && G.EznK.Service.appRegistry;
        if (reg) {
            reg.register({
                id: 'c2-runtime', name: 'C2 Runtime', icon: '[2]',
                category: 'compat', exts: [EXT], builtin: true,
                description: 'C2 compatibility programs (optional)'
            });
        }
        return CORE.ok(true);
    }

    /* =================================================================
     * 3. Legacy globals
     * ============================================================== */

    var GLOBALS = {
        runC2: run,
        openC2File: openFile,
        c2Available: function () { return isAvailable().value; }
    };

    var installed = [];
    Object.keys(GLOBALS).forEach(function (name) {
        if (G[name] === undefined) {
            G[name] = GLOBALS[name];
            installed.push(name);
        }
    });

    /* =================================================================
     * 4. Public handle
     * ============================================================== */

    var api = {
        version: '1.0.0',
        EXTENSION: EXT,
        MIME: MIME,
        OPTIONAL: true,
        run: run,
        openFile: openFile,
        isAvailable: isAvailable,
        registerAssociation: registerAssociation,
        globals: GLOBALS,
        installedGlobals: installed
    };

    if (!G.EznK.Compat) { G.EznK.Compat = {}; }
    G.EznK.Compat.c2 = api;
    if (!G.EZNT.Compat) { G.EZNT.Compat = {}; }
    G.EZNT.Compat.c2 = api;

    /* Association is registered once the kernel is up; calling it at load
     * time would hit the ENOSYS stubs and silently do nothing. */
    var srmNow = G.EznK.Kernel && G.EznK.Kernel.SRM;
    if (srmNow && typeof srmNow.onBoot === 'function') {
        srmNow.onBoot(function () { registerAssociation(); });
    } else {
        registerAssociation();
    }

    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('compat-c2', {
            version: '1.0.0',
            boot: registerAssociation,
            run: run,
            isAvailable: isAvailable
        });
    }

    LOG.info('js/compat/c2.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
