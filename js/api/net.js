/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 API
 *
 *   File    : js/api/net.js
 *   Module  : EznK.Api.Net  (alias: ezn32.api.net)
 *   Layer   : Ezn32 API
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   ezn32.api.net - the ws2_32.dll equivalent (optional module).
 *
 *     InternetOpen / InternetOpenUrl / InternetReadFile  (WinINet style)
 *     HttpGet / HttpPost                               -> { status, value }
 *     IsOnline                                         -> boolean
 *     LoadScript(url)                                  -> CDN libraries
 *
 *   Network is OPTIONAL in EZNT: the system boots and runs fully offline.
 *   When offline this module returns EIO with reason "offline" so callers
 *   can degrade instead of hanging (KD store, Pyodide, sys updates).
 *
 *   Every call goes through the SRM HAL network facade, i.e.
 *   Ezn32 API -> Ezn32 NT -> SRM(HAL) -> L1 platform/net -> browser.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.ezn32 && G.ezn32.api && G.ezn32.api.net && G.ezn32.api.net.__isApiNet === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[Ezn32 API] js/api/net.js requires platform/core.js');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('Ezn32/API:net');

    function mod(name) {
        var k = G.EznK && G.EznK.Kernel;
        if (!k) { return null; }
        return (k.modules && k.modules[name]) || k[name] || null;
    }

    function offline() {
        return fail(S.EIO, { reason: 'offline: no network connection', offline: true });
    }

    /** IsOnline() -> { status, value: boolean } */
    function IsOnline() {
        var hal = mod('hal');
        if (!hal) { return ok(false); }
        var r = hal.net.isOnline();
        return ok(r.status === S.OK ? !!r.value : false);
    }

    /** HttpGet(url, opts) -> Promise<{status, value: string}> */
    function HttpGet(url, opts) {
        var hal = mod('hal');
        if (!hal) { return Promise.resolve(fail(S.ENOSYS, { reason: 'HAL not loaded' })); }
        if (!IsOnline().value) { return Promise.resolve(offline()); }
        return hal.net.fetchText(url, opts);
    }

    /** HttpGetJson(url, opts) */
    function HttpGetJson(url, opts) {
        var hal = mod('hal');
        if (!hal) { return Promise.resolve(fail(S.ENOSYS, { reason: 'HAL not loaded' })); }
        if (!IsOnline().value) { return Promise.resolve(offline()); }
        return hal.net.fetchJson(url, opts);
    }

    /** HttpPost(url, body, opts) - body is JSON-encoded when an object. */
    function HttpPost(url, body, opts) {
        var hal = mod('hal');
        if (!hal) { return Promise.resolve(fail(S.ENOSYS, { reason: 'HAL not loaded' })); }
        if (!IsOnline().value) { return Promise.resolve(offline()); }
        var payload = body;
        var headers = (opts && opts.headers) ? Object.assign({}, opts.headers) : {};
        if (body !== null && typeof body === 'object' && typeof body !== 'function') {
            payload = JSON.stringify(body);
            headers['Content-Type'] = 'application/json';
        }
        var o = Object.assign({}, opts || {}, { method: 'POST', body: payload, headers: headers });
        return hal.net.fetchText(url, o);
    }

    /** InternetOpen() / InternetOpenUrl(url) / InternetReadFile(handle) */
    var handles = Object.create(null);
    var seq = 0;

    function InternetOpen() {
        seq += 1;
        var id = 'inet_' + seq;
        handles[id] = { id: id, url: null, body: null };
        return ok(id);
    }

    function InternetOpenUrl(handle, url) {
        if (!handles[handle]) { return fail(S.EBADF, { reason: 'invalid internet handle' }); }
        if (typeof url !== 'string' || url.length === 0) {
            return fail(S.EINVAL, { reason: 'url required' });
        }
        handles[handle].url = url;
        return ok(true);
    }

    function InternetReadFile(handle) {
        var h = handles[handle];
        if (!h) { return Promise.resolve(fail(S.EBADF, { reason: 'invalid internet handle' })); }
        if (!h.url) { return Promise.resolve(fail(S.EINVAL, { reason: 'no url opened on this handle' })); }
        return HttpGet(h.url);
    }

    function InternetCloseHandle(handle) {
        if (!handles[handle]) { return fail(S.EBADF, { reason: 'invalid internet handle' }); }
        delete handles[handle];
        return ok(true);
    }

    /** LoadScript(url) - CDN library loader (Pyodide etc). */
    function LoadScript(url, opts) {
        var hal = mod('hal');
        if (!hal) { return Promise.resolve(fail(S.ENOSYS, { reason: 'HAL not loaded' })); }
        if (!IsOnline().value) { return Promise.resolve(offline()); }
        return hal.net.loadScript(url, opts);
    }

    var N = {};
    N.__isApiNet = true;
    N.version = '1.0.0';
    N.STATUS = S;

    N.IsOnline = IsOnline;
    N.HttpGet = HttpGet;
    N.HttpGetJson = HttpGetJson;
    N.HttpPost = HttpPost;
    N.InternetOpen = InternetOpen;
    N.InternetOpenUrl = InternetOpenUrl;
    N.InternetReadFile = InternetReadFile;
    N.InternetCloseHandle = InternetCloseHandle;
    N.LoadScript = LoadScript;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Api) { G.EznK.Api = {}; }
    G.EznK.Api.Net = N;
    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.api) { G.ezn32.api = {}; }
    G.ezn32.api.net = N;
    if (!G.EZNT.api) { G.EZNT.api = {}; }
    G.EZNT.api.net = N;

    LOG.info('js/api/net.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
