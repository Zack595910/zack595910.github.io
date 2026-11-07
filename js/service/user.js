/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 4 - Service Layer
 *
 *   File    : js/service/user.js
 *   Module  : EznK.Service.user
 *   Layer   : L4 服务层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The user service: accounts, authentication, sessions and OOBE.
 *
 *     - users live on the config disk (/System/Users.json)
 *     - the session lives on the config disk (/System/CurrentUser.json)
 *     - passwords are stored as a salted digest, never in clear text
 *     - the first boot with no account runs OOBE (create the first user)
 *
 *   The digest uses SubtleCrypto when available (SHA-256) and falls back
 *   to a deterministic FNV-style hash so the system still works on a
 *   file:// page where SubtleCrypto is unavailable (non-secure context).
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.user) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L4:user');

    var api = ezn32.api;
    var USERS_KEY = '/System/Users.json';
    var SESSION_KEY = '/System/CurrentUser.json';

    function hal() { return EznK.Kernel.HAL; }

    /* =================================================================
     * 1. Password digest
     * ============================================================== */

    function fnv1a(str) {
        var h = 0x811c9dc5;
        for (var i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return h >>> 0;
    }

    function weakDigest(salt, password) {
        var h1 = fnv1a(salt + ':' + password);
        var h2 = fnv1a(password + ':' + salt + ':' + h1);
        return 'fnv$' + h1.toString(16) + h2.toString(16);
    }

    function subtle() {
        return (G.crypto && G.crypto.subtle && typeof G.crypto.subtle.digest === 'function')
            ? G.crypto.subtle : null;
    }

    /** digest(salt, password) -> Promise<string> */
    function digest(salt, password) {
        var s = subtle();
        if (!s) { return Promise.resolve(weakDigest(salt, password)); }
        try {
            var data = new TextEncoder().encode(salt + ':' + password);
            return s.digest('SHA-256', data).then(function (buf) {
                var bytes = new Uint8Array(buf);
                var out = '';
                for (var i = 0; i < bytes.length; i++) {
                    out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
                }
                return 'sha256$' + out;
            }, function () {
                return weakDigest(salt, password);
            });
        } catch (_) {
            return Promise.resolve(weakDigest(salt, password));
        }
    }

    function newSalt() {
        var buf = [];
        for (var i = 0; i < 16; i++) {
            buf.push(Math.floor(Math.random() * 256));
        }
        return buf.map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    }

    /* =================================================================
     * 2. Accounts
     * ============================================================== */

    function loadUsers() {
        var r = hal().fs.configGet(USERS_KEY, null);
        if (r.status !== S.OK || !Array.isArray(r.value)) { return []; }
        return r.value;
    }

    function saveUsers(list) {
        return hal().fs.configSet(USERS_KEY, list);
    }

    /** listUsers() -> { status, value: [{name, admin, createdAt}] } */
    function listUsers() {
        return CORE.ok(loadUsers().map(function (u) {
            return { name: u.name, admin: u.admin === true, createdAt: u.createdAt };
        }));
    }

    function findUser(name) {
        var list = loadUsers();
        for (var i = 0; i < list.length; i++) {
            if (list[i].name.toLowerCase() === String(name).toLowerCase()) { return list[i]; }
        }
        return null;
    }

    /**
     * createUser(spec) -> Promise<{status, value: user}>
     *   spec: { name, password, admin }
     */
    function createUser(spec) {
        var s = spec || {};
        if (typeof s.name !== 'string' || !/^[A-Za-z0-9 _.-]{2,24}$/.test(s.name)) {
            return Promise.resolve(CORE.fail(S.EINVAL, {
                reason: 'user name must be 2-24 ASCII letters, digits, spaces, dot, dash or underscore'
            }));
        }
        if (findUser(s.name)) {
            return Promise.resolve(CORE.fail(S.EEXIST, { reason: 'user already exists' }));
        }
        if (typeof s.password !== 'string' || s.password.length < 1) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'password required' }));
        }
        var salt = newSalt();
        return digest(salt, s.password).then(function (hash) {
            var list = loadUsers();
            var user = {
                name: s.name,
                admin: s.admin === true,
                salt: salt,
                hash: hash,
                createdAt: new Date().toISOString()
            };
            list.push(user);
            saveUsers(list);
            return CORE.ok({ name: user.name, admin: user.admin, createdAt: user.createdAt });
        });
    }

    /** deleteUser(name) - refuses to delete the last account. */
    function deleteUser(name) {
        var list = loadUsers();
        if (list.length <= 1) {
            return CORE.fail(S.EBUSY, { reason: 'cannot delete the last account' });
        }
        var next = list.filter(function (u) { return u.name !== name; });
        if (next.length === list.length) { return CORE.fail(S.ENOENT, { reason: 'no such user' }); }
        saveUsers(next);
        return CORE.ok(true);
    }

    /* =================================================================
     * 3. Session
     * ============================================================== */

    /** logon(name, password) -> Promise<{status, value: user}> */
    function logon(name, password) {
        var u = findUser(name);
        if (!u) { return Promise.resolve(CORE.fail(S.ENOENT, { reason: 'user not found' })); }
        if (!u.hash) {
            /* account created before passwords existed: accept and set one */
            return digest(newSalt(), password || '').then(function () {
                return setSession(u);
            });
        }
        return digest(u.salt, password || '').then(function (hash) {
            if (hash !== u.hash) {
                return CORE.fail(S.EACCES, { reason: 'incorrect password' });
            }
            return setSession(u);
        });
    }

    function setSession(u) {
        hal().fs.configSet(SESSION_KEY, { name: u.name, admin: u.admin === true, at: Date.now() });
        var srm = EznK.Kernel.SRM;
        if (srm) { srm.emit('user:logon', { name: u.name }); }
        return CORE.ok({ name: u.name, admin: u.admin === true });
    }

    /** currentUser() -> { status, value: {name, admin} | null } */
    function currentUser() {
        var r = hal().fs.configGet(SESSION_KEY, null);
        return CORE.ok(r.status === S.OK ? r.value : null);
    }

    /** logout() */
    function logout() {
        hal().fs.configDelete(SESSION_KEY);
        var srm = EznK.Kernel.SRM;
        if (srm) { srm.emit('user:logoff', null); }
        return CORE.ok(true);
    }

    /** hasAnyUser() -> boolean */
    function hasAnyUser() {
        return loadUsers().length > 0;
    }

    /** needsOnboarding() -> boolean */
    function needsOnboarding() {
        return !hasAnyUser();
    }

    /* =================================================================
     * 4. Lifecycle
     * ============================================================== */

    function boot() {
        var srm = EznK.Kernel.SRM;
        var svc = {
            init: function () { LOG.info('user service online'); },
            logon: function (name, password) { return logon(name, password); }
        };
        if (srm) {
            srm.registerService('users', svc);
        }
        return CORE.ok(true);
    }

    function shutdown() { return CORE.ok(true); }

    var UserService = {};
    UserService.version = '1.0.0';
    UserService.boot = boot;
    UserService.shutdown = shutdown;

    UserService.listUsers = listUsers;
    UserService.findUser = findUser;
    UserService.createUser = createUser;
    UserService.deleteUser = deleteUser;
    UserService.logon = logon;
    UserService.currentUser = currentUser;
    UserService.logout = logout;
    UserService.hasAnyUser = hasAnyUser;
    UserService.needsOnboarding = needsOnboarding;
    UserService.digest = digest;

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.user = UserService;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('service-user', UserService);
    }
    LOG.info('js/service/user.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
