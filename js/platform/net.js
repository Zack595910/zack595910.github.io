/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 1 - Platform Layer
 *
 *   File    : js/platform/net.js
 *   Module  : EznK.Platform.Net  (alias: EZNT.Net)
 *   Layer   : L1 平台层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The only network entry point of EZNT. Every fetch-based capability
 *   (Pyodide load, KD store downloads, sys update downloads, C2 module
 *   fetching) resolves through this module.
 *
 *   Provides:
 *     - fetchJson(url, opts)   -> {status, value: parsed}
 *     - fetchText(url, opts)   -> {status, value: string}
 *     - fetchBlob(url, opts)   -> {status, value: Blob}
 *     - fetchArrayBuffer(url)  -> {status, value: ArrayBuffer}
 *     - loadScript(url)        -> injects a <script src> and resolves on load
 *     - loadStyle(url)         -> injects <link rel=stylesheet>
 *     - isOnline() / onStatus  -> navigator.onLine + online/offline events
 *     - request(url, opts)     -> generic, with timeout / retry / abort
 *
 *   All calls return {status, value} promises (never reject). Aborted
 *   requests return EBUSY; a timeout returns EBUSY with reason
 *   "timeout"; network failures return EIO with the browser message.
 *
 * ---------------------------------------------------------------------
 * 契典 (CONTRACT)
 * ============================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Platform && G.EznK.Platform.Net &&
        G.EznK.Platform.Net.__isEZNTNet === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[EznK/L1] platform/net.js requires platform/core.js to load first');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var asyncFail = CORE.asyncFail;
    var LOG = CORE.createLogger('EznK/L1:net');

    var DOC = G.document || null;
    var DEFAULT_TIMEOUT = 30000;

    /* Track injected resources so dispose() can remove them. */
    var injected = [];

    /* =================================================================
     * 1. Core request
     * ============================================================== */

    /**
     * request(url, opts) -> Promise<{status, value: Response}>
     *   opts: { method='GET', headers={}, body, timeout=DEFAULT, retry=0,
     *           retryDelay=300, signal, mode, cache }
     */
    function request(url, opts) {
        var o = opts || {};
        if (typeof url !== 'string' || url.length === 0) {
            return asyncFail(S.EINVAL, { reason: 'url must be a non-empty string' });
        }
        if (typeof G.fetch !== 'function') {
            return asyncFail(S.ENOSYS, { reason: 'fetch unavailable in this environment' });
        }
        var triesLeft = Math.max(0, (typeof o.retry === 'number' ? o.retry : 0));
        var timeout = (typeof o.timeout === 'number' && o.timeout > 0) ? o.timeout : DEFAULT_TIMEOUT;
        var retryDelay = typeof o.retryDelay === 'number' ? o.retryDelay : 300;

        function attempt(n) {
            var controller = (typeof G.AbortController === 'function') ? new G.AbortController() : null;
            var timer = null;
            var aborted = false;
            if (o.signal && controller) {
                if (o.signal.aborted) { return asyncFail(S.EBUSY, { reason: 'aborted before start' }); }
                o.signal.addEventListener('abort', function () {
                    aborted = true;
                    try { controller.abort(); } catch (_) { /* ignore */ }
                }, { once: true });
            }
            if (controller) {
                timer = G.setTimeout(function () {
                    aborted = true;
                    try { controller.abort(); } catch (_) { /* ignore */ }
                }, timeout);
            }
            var init = {
                method: o.method || 'GET',
                headers: o.headers || {},
                mode: o.mode || 'cors',
                cache: o.cache || 'default',
                credentials: o.credentials || 'same-origin'
            };
            if (o.body !== undefined && o.body !== null) { init.body = o.body; }
            if (controller) { init.signal = controller.signal; }

            return G.fetch(url, init).then(function (res) {
                if (timer) { G.clearTimeout(timer); }
                if (!res.ok) {
                    if (n < triesLeft) {
                        return new Promise(function (res2) {
                            G.setTimeout(function () { res2(attempt(n + 1)); }, retryDelay);
                        });
                    }
                    return fail(S.EIO, {
                        reason: 'HTTP ' + res.status + ' ' + res.statusText,
                        httpStatus: res.status,
                        url: url
                    });
                }
                return ok(res);
            }, function (err) {
                if (timer) { G.clearTimeout(timer); }
                var isAbort = aborted || (err && err.name === 'AbortError');
                if (isAbort) {
                    return fail(S.EBUSY, { reason: aborted ? 'aborted or timed out' : 'aborted', url: url });
                }
                if (n < triesLeft) {
                    return new Promise(function (res) {
                        G.setTimeout(function () { res(attempt(n + 1)); }, retryDelay);
                    });
                }
                return fail(S.EIO, { reason: 'network error: ' + (err && err.message ? err.message : String(err)), url: url });
            });
        }

        return attempt(0);
    }

    /* =================================================================
     * 2. Typed helpers
     * ============================================================== */

    function checkUrl(url, opts) {
        if (typeof url !== 'string' || url.length === 0) {
            return asyncFail(S.EINVAL, { reason: 'url must be a non-empty string' });
        }
        return null;
    }

    /** fetchJson(url, opts) -> Promise<{status, value: any}> */
    function fetchJson(url, opts) {
        var bad = checkUrl(url, opts);
        if (bad) { return bad; }
        return request(url, opts).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return r.value.text().then(function (text) {
                try {
                    return ok(JSON.parse(text));
                } catch (err) {
                    return fail(S.EBADIMAGE, { reason: 'response is not valid JSON', url: url });
                }
            }, function (err) {
                return fail(S.EIO, { reason: 'failed to read response body: ' + err.message });
            });
        });
    }

    /** fetchText(url, opts) -> Promise<{status, value: string}> */
    function fetchText(url, opts) {
        var bad = checkUrl(url, opts);
        if (bad) { return bad; }
        return request(url, opts).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return r.value.text().then(function (t) { return ok(t); },
                function (err) { return fail(S.EIO, { reason: 'read error: ' + err.message }); });
        });
    }

    /** fetchBlob(url, opts) -> Promise<{status, value: Blob}> */
    function fetchBlob(url, opts) {
        var bad = checkUrl(url, opts);
        if (bad) { return bad; }
        return request(url, opts).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return r.value.blob().then(function (b) { return ok(b); },
                function (err) { return fail(S.EIO, { reason: 'read error: ' + err.message }); });
        });
    }

    /** fetchArrayBuffer(url, opts) -> Promise<{status, value: ArrayBuffer}> */
    function fetchArrayBuffer(url, opts) {
        var bad = checkUrl(url, opts);
        if (bad) { return bad; }
        return request(url, opts).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return r.value.arrayBuffer().then(function (b) { return ok(b); },
                function (err) { return fail(S.EIO, { reason: 'read error: ' + err.message }); });
        });
    }

    /* =================================================================
     * 3. Script / style loading
     * ============================================================== */

    /**
     * loadScript(src, opts) -> Promise<{status, value: HTMLScriptElement}>
     *   Used for Pyodide and other CDN libraries. Tracks the element so
     *   dispose() can remove it. opts.timeout default 30s.
     */
    function loadScript(src, opts) {
        if (!DOC) { return asyncFail(S.ENOSYS, { reason: 'no document' }); }
        if (typeof src !== 'string' || src.length === 0) {
            return asyncFail(S.EINVAL, { reason: 'src required' });
        }
        var o = opts || {};
        var timeout = (typeof o.timeout === 'number' && o.timeout > 0) ? o.timeout : DEFAULT_TIMEOUT;
        return new Promise(function (resolve) {
            var el = DOC.createElement('script');
            el.src = src;
            if (o.async === false) { el.async = false; }
            if (o.id) { el.id = o.id; }
            var timer = G.setTimeout(function () {
                cleanup();
                resolve(fail(S.EBUSY, { reason: 'script load timed out', src: src }));
            }, timeout);
            function cleanup() {
                G.clearTimeout(timer);
                el.onload = null;
                el.onerror = null;
            }
            el.onload = function () {
                cleanup();
                injected.push(el);
                resolve(ok(el));
            };
            el.onerror = function () {
                cleanup();
                try { el.remove(); } catch (_) { /* ignore */ }
                resolve(fail(S.EIO, { reason: 'script failed to load', src: src }));
            };
            var parent = o.parent || DOC.head || DOC.documentElement;
            parent.appendChild(el);
        });
    }

    /** loadStyle(href, opts) -> Promise<{status, value: HTMLLinkElement}> */
    function loadStyle(href, opts) {
        if (!DOC) { return asyncFail(S.ENOSYS, { reason: 'no document' }); }
        if (typeof href !== 'string' || href.length === 0) {
            return asyncFail(S.EINVAL, { reason: 'href required' });
        }
        var o = opts || {};
        var timeout = (typeof o.timeout === 'number' && o.timeout > 0) ? o.timeout : DEFAULT_TIMEOUT;
        return new Promise(function (resolve) {
            var el = DOC.createElement('link');
            el.rel = 'stylesheet';
            el.href = href;
            if (o.id) { el.id = o.id; }
            var timer = G.setTimeout(function () {
                cleanup();
                resolve(fail(S.EBUSY, { reason: 'style load timed out', href: href }));
            }, timeout);
            function cleanup() {
                G.clearTimeout(timer);
                el.onload = null;
                el.onerror = null;
            }
            el.onload = function () {
                cleanup();
                injected.push(el);
                resolve(ok(el));
            };
            el.onerror = function () {
                cleanup();
                try { el.remove(); } catch (_) { /* ignore */ }
                resolve(fail(S.EIO, { reason: 'style failed to load', href: href }));
            };
            var parent = o.parent || DOC.head || DOC.documentElement;
            parent.appendChild(el);
        });
    }

    /* =================================================================
     * 4. Connectivity
     * ============================================================== */

    var onlineListeners = [];
    var navOnline = (typeof G.navigator !== 'undefined' && G.navigator)
        ? (G.navigator.onLine !== false) : true;

    function isOnline() {
        return ok(navOnline);
    }

    /** onStatus(fn) -> { status, value: handle }  fn(online:boolean) */
    function onStatus(fn) {
        if (typeof fn !== 'function') {
            return fail(S.EINVAL, { reason: 'callback must be a function' });
        }
        if (typeof G.addEventListener !== 'function') {
            return fail(S.ENOSYS, { reason: 'no event target' });
        }
        var handle = 'net' + (onlineListeners.length + 1) + '_' + Date.now();
        var rec = { handle: handle, fn: fn };
        onlineListeners.push(rec);
        var onUp = function () { navOnline = true; safeCall(fn, true); };
        var onDown = function () { navOnline = false; safeCall(fn, false); };
        G.addEventListener('online', onUp);
        G.addEventListener('offline', onDown);
        rec.off = function () {
            G.removeEventListener('online', onUp);
            G.removeEventListener('offline', onDown);
        };
        return ok(handle);
    }

    function safeCall(fn, v) {
        try { fn(v); } catch (err) {
            LOG.error('net status callback threw: ' + (err && err.message));
        }
    }

    /** offStatus(handle) -> { status, value: boolean } */
    function offStatus(handle) {
        for (var i = 0; i < onlineListeners.length; i++) {
            if (onlineListeners[i].handle === handle) {
                onlineListeners[i].off();
                onlineListeners.splice(i, 1);
                return ok(true);
            }
        }
        return fail(S.ENOENT, { reason: 'unknown status handle' });
    }

    /* =================================================================
     * 5. Lifecycle
     * ============================================================== */

    function dispose() {
        for (var i = 0; i < injected.length; i++) {
            try { injected[i].remove(); } catch (_) { /* ignore */ }
        }
        injected = [];
        onlineListeners.forEach(function (r) { r.off(); });
        onlineListeners = [];
        LOG.info('net disposed');
        return ok(true);
    }

    /* =================================================================
     * 6. Public handles
     * ============================================================== */

    var Net = {};
    Net.__isEZNTNet = true;
    Net.version = '1.0.0';
    Net.STATUS = S;

    Net.request = request;
    Net.fetchJson = fetchJson;
    Net.fetchText = fetchText;
    Net.fetchBlob = fetchBlob;
    Net.fetchArrayBuffer = fetchArrayBuffer;
    Net.loadScript = loadScript;
    Net.loadStyle = loadStyle;
    Net.isOnline = isOnline;
    Net.onStatus = onStatus;
    Net.offStatus = offStatus;
    Net.dispose = dispose;

    CORE.attach('Net', Net);
    LOG.info('platform/net.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
