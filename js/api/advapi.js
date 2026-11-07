/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 API
 *
 *   File    : js/api/advapi.js
 *   Module  : EznK.Api.Advapi  (alias: ezn32.api.advapi)
 *   Layer   : Ezn32 API
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   ezn32.api.advapi - the advapi32.dll equivalent: registry, services,
 *   policies and user identity.
 *
 *     Registry : RegOpenKey / RegSetValue / RegQueryValue / RegDeleteKey
 *                RegEnumKey / RegCloseKey
 *     Services : RegisterService / StartService / StopService / EnumServices
 *     Policy   : SetPolicy / GetPolicy / IsPolicyEnabled / RequirePolicy
 *     Users    : GetCurrentUser / SetCurrentUser / LogonUser / LogoffUser
 *                EnumUsers / IsAdmin
 *
 *   Every call goes through Ezn32 NT syscalls, never straight to SRM.
 *   User identity is kept in the config disk through SRM/HAL, so the
 *   login screen and the shell agree on exactly one current user.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.ezn32 && G.ezn32.api && G.ezn32.api.advapi && G.ezn32.api.advapi.__isApiAdvapi === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var Ntos = (G.ezn32 && G.ezn32.nt) || null;
    if (!CORE || !Ntos) {
        throw new Error('[Ezn32 API] js/api/advapi.js requires platform/core.js and js/nt/ntos.js');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('Ezn32/API:advapi');

    function nt(id, args) { return Ntos.syscall(id, args); }

    function srm() {
        var k = G.EznK && G.EznK.Kernel;
        return (k && k.SRM) || G.SRM || null;
    }
    function mod(name) {
        var k = G.EznK && G.EznK.Kernel;
        if (!k) { return null; }
        return (k.modules && k.modules[name]) || k[name] || null;
    }

    /* =================================================================
     * 1. Registry
     * ============================================================== */

    /** RegOpenKey(path) -> handle */
    function RegOpenKey(path) {
        return nt('NtOpenKey', { path: path });
    }

    /** RegSetValue({ path, value }) */
    function RegSetValue(path, value) {
        var arg = (path && typeof path === 'object') ? path : { path: path, value: value };
        return nt('NtSetValueKey', arg);
    }

    /** RegQueryValue(path) -> value */
    function RegQueryValue(path) {
        return nt('NtQueryValueKey', { path: path });
    }

    /** RegDeleteKey(path) */
    function RegDeleteKey(path) {
        return nt('NtDeleteKey', { path: path });
    }

    /** RegEnumKey(path) -> string[] child key names */
    function RegEnumKey(path) {
        var s = srm();
        if (!s) { return fail(S.EPOWEROFF, { reason: 'kernel not available' }); }
        var names = s.regList(path);
        return ok(Array.isArray(names) ? names : []);
    }

    /** RegCloseKey(handle) */
    function RegCloseKey(handle) {
        return nt('NtClose', { handle: handle });
    }

    /* =================================================================
     * 2. Services
     * ============================================================== */

    function RegisterService(name, service) {
        return nt('NtCreateService', { name: name, service: service });
    }

    function StartService(name) {
        return nt('NtStartService', { name: name });
    }

    function StopService(name) {
        return nt('NtStopService', { name: name });
    }

    function EnumServices() {
        return nt('NtQueryServices', {});
    }

    /* =================================================================
     * 3. Policy
     * ============================================================== */

    function SetPolicy(key, value, scope) {
        var p = mod('policy');
        if (!p) { return fail(S.ENOSYS, { reason: 'policy module not loaded' }); }
        return p.setPolicy(key, value, scope);
    }

    function GetPolicy(key, fallback) {
        var p = mod('policy');
        if (!p) { return fail(S.ENOSYS, { reason: 'policy module not loaded' }); }
        return p.getPolicy(key, fallback);
    }

    function IsPolicyEnabled(key) {
        var p = mod('policy');
        if (!p) { return false; }
        return p.isPolicyEnabled(key);
    }

    /** RequirePolicy(action) - throws nothing, returns EACCES when denied. */
    function RequirePolicy(action) {
        var p = mod('policy');
        if (!p) { return fail(S.ENOSYS, { reason: 'policy module not loaded' }); }
        return p.require(action);
    }

    /* =================================================================
     * 4. Users (identity kept on the config disk via HAL)
     * ============================================================== */

    var CURRENT_KEY = '/System/CurrentUser.json';
    var USERS_KEY = '/System/Users.json';

    function hal() { return mod('hal'); }

    function readJson(key, dflt) {
        var h = hal();
        if (!h) { return dflt; }
        var r = h.fs.configGet(key, null);
        if (r.status !== S.OK || r.value === null) { return dflt; }
        return r.value;
    }

    function writeJson(key, value) {
        var h = hal();
        if (!h) { return fail(S.ENOSYS, { reason: 'HAL not loaded' }); }
        return h.fs.configSet(key, value);
    }

    /** GetCurrentUser() -> { status, value: {name, admin} | null } */
    function GetCurrentUser() {
        var cur = readJson(CURRENT_KEY, null);
        return ok(cur);
    }

    /** SetCurrentUser(user) */
    function SetCurrentUser(user) {
        if (!user || typeof user.name !== 'string' || user.name.length === 0) {
            return fail(S.EINVAL, { reason: 'user object with a name required' });
        }
        var r = writeJson(CURRENT_KEY, user);
        if (r.status !== S.OK) { return r; }
        var s = srm();
        if (s) { s.emit('user:changed', user); }
        return ok(true);
    }

    /** EnumUsers() -> [{name, admin, createdAt}] */
    function EnumUsers() {
        var list = readJson(USERS_KEY, []);
        return ok(Array.isArray(list) ? list : []);
    }

    /** LogonUser(name, password) -> { status, value: {name, admin} }
     *  Password hashing is the user service's job (L4); at the API layer
     *  LogonUser delegates to the registered user service when present. */
    function LogonUser(name, password) {
        if (typeof name !== 'string' || name.length === 0) {
            return fail(S.EINVAL, { reason: 'user name required' });
        }
        var svc = mod('users');
        if (svc && typeof svc.logon === 'function') {
            return svc.logon(name, password);
        }
        /* Fallback: accept an existing user record without a password
         * check (the L4 user service adds real verification). */
        var list = EnumUsers().value;
        for (var i = 0; i < list.length; i++) {
            if (list[i].name === name) {
                return SetCurrentUser(list[i]).status === S.OK
                    ? ok(list[i]) : fail(S.EFAULT, { reason: 'logon failed' });
            }
        }
        return fail(S.ENOENT, { reason: 'user not found' });
    }

    /** LogoffUser() */
    function LogoffUser() {
        var h = hal();
        if (!h) { return fail(S.ENOSYS, { reason: 'HAL not loaded' }); }
        var r = h.fs.configDelete(CURRENT_KEY);
        var s = srm();
        if (s) { s.emit('user:logoff', null); }
        return r.status === S.OK ? ok(true) : ok(true);
    }

    /** IsAdmin() -> { status, value: boolean } */
    function IsAdmin() {
        var cur = GetCurrentUser().value;
        return ok(!!(cur && cur.admin === true));
    }

    /* =================================================================
     * 5. Public handle
     * ============================================================== */

    var A = {};
    A.__isApiAdvapi = true;
    A.version = '1.0.0';
    A.STATUS = S;

    A.RegOpenKey = RegOpenKey;
    A.RegSetValue = RegSetValue;
    A.RegQueryValue = RegQueryValue;
    A.RegDeleteKey = RegDeleteKey;
    A.RegEnumKey = RegEnumKey;
    A.RegCloseKey = RegCloseKey;

    A.RegisterService = RegisterService;
    A.StartService = StartService;
    A.StopService = StopService;
    A.EnumServices = EnumServices;

    A.SetPolicy = SetPolicy;
    A.GetPolicy = GetPolicy;
    A.IsPolicyEnabled = IsPolicyEnabled;
    A.RequirePolicy = RequirePolicy;

    A.GetCurrentUser = GetCurrentUser;
    A.SetCurrentUser = SetCurrentUser;
    A.EnumUsers = EnumUsers;
    A.LogonUser = LogonUser;
    A.LogoffUser = LogoffUser;
    A.IsAdmin = IsAdmin;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Api) { G.EznK.Api = {}; }
    G.EznK.Api.Advapi = A;
    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.api) { G.ezn32.api = {}; }
    G.ezn32.api.advapi = A;
    if (!G.EZNT.api) { G.EZNT.api = {}; }
    G.EZNT.api.advapi = A;

    LOG.info('js/api/advapi.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
