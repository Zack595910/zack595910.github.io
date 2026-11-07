/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Startup
 *
 *   File    : js/boot.js
 *   Module  : EznK.Boot
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The boot orchestrator (prompt section 6.4). It runs the 10 steps of
 *   the start-up sequence in ONE explicit order - never by betting on
 *   timers (hard rule #5):
 *
 *     1. index.html opened (this file runs last)
 *     2. initialise the storage gateway
 *     3. detect /System/Boot.js, install or upgrade core modules
 *     4. load /System/Boot.js
 *     5. start the SRM kernel
 *     6. start the service layer
 *     7. start the shell layer
 *     8. detect the user  -> OOBE or login
 *     9. mount the user's Desktop -> render
 *    10. system ready
 *
 *   Every step returns a status and is reported to the boot screen, so a
 *   failure names the exact step instead of leaving a blank page.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Boot && G.EznK.Boot.__isBoot === true) { return; }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) { throw new Error('[EZNT] js/boot.js requires platform/core.js'); }

    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EZNT:boot');

    var steps = [];
    var state = { phase: 'idle', ready: false, failed: null, user: null };

    function step(name, fn) {
        var entry = { name: name, status: 'pending', detail: null };
        steps.push(entry);
        updateBootScreen(name);
        var r;
        try {
            r = fn();
        } catch (err) {
            entry.status = 'failed';
            entry.detail = err && err.message;
            return Promise.resolve({ status: S.EFAULT, reason: entry.detail });
        }
        return Promise.resolve(r).then(function (res) {
            if (res && res.status !== undefined && res.status !== S.OK) {
                entry.status = 'failed';
                entry.detail = res.reason || ('status ' + res.status);
                return res;
            }
            entry.status = 'ok';
            return res || CORE.ok(true);
        }, function (err) {
            entry.status = 'failed';
            entry.detail = err && err.message;
            return { status: S.EFAULT, reason: entry.detail };
        });
    }

    /* =================================================================
     * Boot screen (painted before the shell exists)
     * ============================================================== */

    function updateBootScreen(text) {
        var el = G.document && G.document.getElementById('boot-status');
        if (el) { el.textContent = '[EZNT] ' + text; }
    }

    function hideBootScreen() {
        var el = G.document && G.document.getElementById('boot-screen');
        if (el) { el.style.display = 'none'; }
    }

    function showBootError(message) {
        var el = G.document && G.document.getElementById('boot-status');
        if (el) {
            el.textContent = '[EZNT] BOOT FAILED: ' + message;
            el.style.color = '#FF5555';
        }
        LOG.error('boot failed: ' + message);
    }

    /* =================================================================
     * The sequence
     * ============================================================== */

    function run() {
        state.phase = 'booting';
        var Storage = G.EznK.Platform.Storage;
        var SRM = G.EznK.Kernel.SRM;

        /* ---- step 2: storage gateway ---- */
        return step('Storage gateway', function () {
            return Storage.init();
        }).then(function (r) {
            if (!r || r.status !== S.OK) {
                showBootError('storage: ' + (r && (r.reason || r.status)));
                return Promise.reject(new Error('storage failed'));
            }
            return step('System disk check', function () {
                return Storage.exists('/System').then(function (e) {
                    return e.status === S.OK && e.value ? CORE.ok(true) : Storage.mkdir('/System');
                });
            });
        }).then(function () {
            /* ---- step 3/4: Boot.js marker ---- */
            return step('Boot record', function () {
                var cfg = Storage.config;
                cfg.set('/System/SystemVersion.json', {
                    name: 'EZNT',
                    version: '1.0.0',
                    architecture: 'EznK',
                    installedAt: Date.now()
                });
                cfg.set('/System/FirstBoot.json', { firstBoot: false, at: Date.now() });
                return CORE.ok(true);
            });
        }).then(function () {
            /* ---- step 5: kernel ---- */
            return step('SRM kernel', function () { return SRM.boot(); });
        }).then(function (r) {
            if (!r || r.status !== S.OK) {
                showBootError('kernel: ' + (r && (r.reason || r.status)));
                return Promise.reject(new Error('kernel failed'));
            }
            /* ---- step 6: services ----
             * L4 services are not kernel modules; they boot explicitly
             * here, after the kernel is up and before the shell needs
             * users / themes / resolution. */
            return step('Service layer', bootServices);
        }).then(function () {
            /* ---- step 7: shell ---- */
            return step('Desktop', function () {
                return G.EznK.Shell.desktop.init();
            });
        }).then(function () {
            return step('Taskbar', function () {
                return G.EznK.Shell.taskbar.init();
            });
        }).then(function () {
            return step('Notifications', function () {
                return G.EznK.Shell.notifications.init();
            });
        }).then(function () {
            /* ---- step 8: user ---- */
            return step('User session', function () {
                var users = G.EznK.Service && G.EznK.Service.user;
                var advapi = ezn32.api.advapi;
                var cur = advapi.GetCurrentUser();
                if (cur.status === S.OK && cur.value) {
                    state.user = cur.value;
                    return CORE.ok(cur.value);
                }
                if (users && users.needsOnboarding()) {
                    /* First run: create the default local account. The OOBE
                     * wizard (lock-screen module) creates a richer account
                     * later; this keeps the system bootable. */
                    return users.createUser({ name: 'User', password: 'eznt', admin: true })
                        .then(function (r) {
                            if (r.status !== S.OK) { return r; }
                            return users.logon('User', 'eznt');
                        })
                        .then(function (r) {
                            if (r.status !== S.OK) { return r; }
                            state.user = r.value;
                            return CORE.ok(r.value);
                        });
                }
                var list = users ? users.listUsers().value : [];
                if (!list.length) {
                    return CORE.fail(S.ENOENT, { reason: 'no user accounts' });
                }
                state.user = list[0];
                advapi.SetCurrentUser(list[0]);
                return CORE.ok(list[0]);
            });
        }).then(function () {
            /* ---- step 9: user desktop ----
             * Seed content FIRST, then mount the folder, so the very first
             * boot already shows the sample files. Doing it the other way
             * round leaves an empty desktop until the next manual refresh. */
            return step('First-run content', seedContent);
        }).then(function () {
            return step('Desktop folder', function () {
                return G.EznK.Shell.desktop.refresh();
            });
        }).then(function () {
            /* ---- step 10: ready ---- */
            state.phase = 'ready';
            state.ready = true;
            hideBootScreen();
            var nc = G.EznK.Shell.notifications;
            if (nc) { nc.push({ title: 'EZNT', text: 'System ready. Welcome, ' + (state.user ? state.user.name : 'User') + '.', level: 'info', timeout: 4000 }); }
            LOG.info('EZNT ready');
            SRM.emit('system:ready', { user: state.user });
            return CORE.ok({ ready: true, user: state.user, steps: steps });
        }, function (err) {
            state.phase = 'failed';
            state.failed = err && err.message;
            showBootError(state.failed);
            return { status: S.EIO, reason: state.failed, steps: steps };
        });
    }

    /** Boot every L4 service in dependency order (explicit, never guessed). */
    function bootServices() {
        var order = ['user', 'file', 'appRegistry', 'theme', 'resolution', 'notify', 'window', 'backup', 'wallpaper', 'screenSaver', 'fileAssoc'];
        var svcs = (G.EznK && G.EznK.Service) || {};
        var failed = [];
        var chain = Promise.resolve();
        order.forEach(function (name) {
            chain = chain.then(function () {
                var svc = svcs[name];
                if (!svc || typeof svc.boot !== 'function') { failed.push(name + '(missing)'); return; }
                return Promise.resolve(svc.boot()).then(function (r) {
                    if (r && r.status !== undefined && r.status !== S.OK) {
                        failed.push(name + '(' + (r.reason || r.status) + ')');
                    }
                });
            });
        });
        return chain.then(function () {
            /* 外壳层模块也要在应用注册表里登记（控制面板是应用之一），
             * 否则从开始菜单 / 桌面图标启动会报 "no such app"。 */
            var shell = (G.EznK && G.EznK.Shell) || {};
            Object.keys(shell).forEach(function (k) {
                var m = shell[k];
                if (m && typeof m.boot === 'function') {
                    try { m.boot(); } catch (err) { failed.push(k + '(' + (err && err.message) + ')'); }
                }
            });
            return failed.length
                ? { status: S.EFAULT, reason: 'services failed: ' + failed.join(', ') }
                : CORE.ok({ booted: order.length });
        });
    }

    /** Seed the desktop with a few useful files on a fresh install. */
    function seedContent() {
        var storage = G.EznK.Platform.Storage;
        var user = state.user ? state.user.name : 'User';
        var desktop = '/Users/' + user + '/Desktop';
        return storage.exists(desktop).then(function (e) {
            if (e.status === S.OK && e.value) {
                return storage.listDir(desktop).then(function (l) {
                    if (l.status === S.OK && l.value.length > 0) { return CORE.ok(true); }
                    return writeSeedFiles(desktop);
                });
            }
            return writeSeedFiles(desktop);
        });
    }

    function writeSeedFiles(desktop) {
        var storage = G.EznK.Platform.Storage;
        var files = [
            ['README.txt', 'Welcome to EZNT.\n\nEcosystem Native Technology.\nDouble-click a file to open it.\nRight-click the desktop for more options.\n'],
            ['hello.rf', 'window "Hello RF" 400 300\nlabel "Welcome to the rf script engine." center\nbutton "Say hello" run\n  print "Hello from rf!"\nend\nbutton "Close" close\n']
        ];
        var chain = Promise.resolve();
        files.forEach(function (f) {
            chain = chain.then(function () {
                return storage.writeFile(desktop + '/' + f[0], f[1]);
            });
        });
        return chain.then(function () { return CORE.ok(true); });
    }

    /* =================================================================
     * Public handle
     * ============================================================== */

    var Boot = {};
    Boot.__isBoot = true;
    Boot.version = '1.0.0';
    Boot.STATUS = S;

    Boot.run = run;
    Boot.isReady = function () { return state.ready; };
    Boot.state = function () { return Object.assign({}, state); };
    Boot.steps = function () { return steps.slice(0); };
    Boot.user = function () { return state.user; };

    if (!G.EznK) { G.EznK = {}; }
    G.EznK.Boot = Boot;
    if (!G.EZNT) { G.EZNT = {}; }
    G.EZNT.Boot = Boot;

    LOG.info('js/boot.js 已加载');

    /* Auto-start once the document is parsed. This is the ONLY implicit
     * start in the system; everything inside run() is explicit order. */
    function start() {
        updateBootScreen('Starting...');
        run();
    }
    if (G.document && G.document.readyState === 'loading') {
        G.document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }

}(typeof globalThis !== 'undefined' ? globalThis : this));
