/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 3 - Kernel Layer (SRM)
 *
 *   File    : js/kernel/hal.js
 *   Module  : EznK.Kernel.HAL  (alias: SRM.hal)
 *   Layer   : L3 内核层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The Hardware Abstraction Layer: the ONLY kernel module that is
 *   allowed to talk to the L1 platform layer (hard rule #1:
 *   SRM -> L1 -> browser). Every other kernel module commands I/O
 *   through HAL, so when a future port replaces the browser with a
 *   native host, only this file changes.
 *
 *   HAL does not re-implement L1. It is a thin, capability-checked
 *   façade over platform/core, dom, storage, time, net, media:
 *
 *     hal.fs.*        persistence through the storage gateway
 *     hal.dom.*       interface for the UI layer (never UI pixels)
 *     hal.time.*      clocks and timers for the scheduler
 *     hal.net.*       network for updates / store
 *     hal.media.*     camera / mic / print / speech
 *     hal.env.*       environment facts (headless, online, screen)
 *
 *   Every function returns {status, value} (async ones resolve with it).
 *   NONE of these calls may throw.
 *
 * ---------------------------------------------------------------------
 * 硬规矩
 * ============================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.SRM && G.SRM.hal && G.SRM.hal.__isHAL === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[EznK/L3] kernel/hal.js requires platform/core.js to load first');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var asyncFail = CORE.asyncFail;
    var LOG = CORE.createLogger('EznK/L3:hal');

    /* =================================================================
     * 1. Platform accessors
     * ============================================================== */

    function plat(name) {
        return (G.EznK && G.EznK.Platform && G.EznK.Platform[name]) || null;
    }

    function need(name) {
        var p = plat(name);
        if (!p) {
            return fail(S.ENOSYS, { reason: 'platform module "' + name + '" is not loaded', layer: 'L1' });
        }
        return ok(p);
    }

    /** Lazily resolved platform handles (data lives in one place). */
    var P = {};

    function refresh() {
        P.core = plat('Core');
        P.dom = plat('DOM');
        P.storage = plat('Storage');
        P.time = plat('Time');
        P.net = plat('Net');
        P.media = plat('Media');
        return ok(true);
    }
    refresh();

    /* =================================================================
     * 2. Filesystem facade (through the storage gateway)
     * ============================================================== */

    var fs = {
        readFile: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return Promise.resolve(p); }
            return p.value.readFile(path);
        },
        writeFile: function (path, data, opts) {
            var p = need('Storage');
            if (p.status !== S.OK) { return Promise.resolve(p); }
            return p.value.writeFile(path, data, opts);
        },
        deleteFile: function (path, opts) {
            var p = need('Storage');
            if (p.status !== S.OK) { return Promise.resolve(p); }
            return p.value.deleteFile(path, opts);
        },
        mkdir: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return Promise.resolve(p); }
            return p.value.mkdir(path);
        },
        listDir: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return Promise.resolve(p); }
            return p.value.listDir(path);
        },
        stat: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return Promise.resolve(p); }
            return p.value.stat(path);
        },
        exists: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return Promise.resolve(p); }
            return p.value.exists(path);
        },
        copy: function (a, b) {
            var p = need('Storage');
            if (p.status !== S.OK) { return Promise.resolve(p); }
            return p.value.copy(a, b);
        },
        move: function (a, b) {
            var p = need('Storage');
            if (p.status !== S.OK) { return Promise.resolve(p); }
            return p.value.move(a, b);
        },
        rename: function (a, b) {
            var p = need('Storage');
            if (p.status !== S.OK) { return Promise.resolve(p); }
            return p.value.rename(a, b);
        },
        readdirTree: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return Promise.resolve(p); }
            return p.value.readdirTree(path);
        },
        /* sync views for scripts */
        readSync: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.readSync(path);
        },
        writeSync: function (path, data) {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.writeSync(path, data);
        },
        listSync: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.listSync(path);
        },
        existsSync: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.existsSync(path);
        },
        statSync: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.statSync(path);
        },
        /* config disk */
        configGet: function (path, fb) {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.config.get(path, fb);
        },
        configSet: function (path, v) {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.config.set(path, v);
        },
        configDelete: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.config.delete(path);
        },
        configList: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.config.list(path);
        },
        configHas: function (path) {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.config.has(path);
        },
        configSnapshot: function () {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.config.snapshot();
        },
        configRestore: function (snap) {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.config.restore(snap);
        },
        configClear: function () {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.config.clear();
        },
        usage: function () {
            var p = need('Storage');
            if (p.status !== S.OK) { return Promise.resolve(p); }
            return p.value.usage();
        },
        paths: function () {
            var p = need('Storage');
            if (p.status !== S.OK) { return p; }
            return p.value.paths;
        }
    };

    /* =================================================================
     * 3. Time facade
     * ============================================================== */

    var time = {
        now: function () {
            var p = need('Time');
            return p.status !== S.OK ? p : p.value.now();
        },
        clock: function () {
            var p = need('Time');
            return p.status !== S.OK ? p : p.value.clock();
        },
        after: function (ms, fn) {
            var p = need('Time');
            return p.status !== S.OK ? p : p.value.after(ms, fn);
        },
        every: function (ms, fn, opts) {
            var p = need('Time');
            return p.status !== S.OK ? p : p.value.every(ms, fn, opts);
        },
        cancel: function (h) {
            var p = need('Time');
            return p.status !== S.OK ? p : p.value.cancel(h);
        },
        wait: function (ms) {
            var p = need('Time');
            return p.status !== S.OK ? Promise.resolve(p) : p.value.wait(ms);
        },
        frame: function (fn) {
            var p = need('Time');
            return p.status !== S.OK ? p : p.value.frame(fn);
        },
        cancelFrame: function (h) {
            var p = need('Time');
            return p.status !== S.OK ? p : p.value.cancelFrame(h);
        },
        format: function (tpl, ts) {
            var p = need('Time');
            return p.status !== S.OK ? p : p.value.format(tpl, ts);
        }
    };

    /* =================================================================
     * 4. Network facade
     * ============================================================== */

    var net = {
        isOnline: function () {
            var p = need('Net');
            return p.status !== S.OK ? p : p.value.isOnline();
        },
        fetchText: function (url, opts) {
            var p = need('Net');
            return p.status !== S.OK ? Promise.resolve(p) : p.value.fetchText(url, opts);
        },
        fetchJson: function (url, opts) {
            var p = need('Net');
            return p.status !== S.OK ? Promise.resolve(p) : p.value.fetchJson(url, opts);
        },
        fetchBlob: function (url, opts) {
            var p = need('Net');
            return p.status !== S.OK ? Promise.resolve(p) : p.value.fetchBlob(url, opts);
        },
        loadScript: function (src, opts) {
            var p = need('Net');
            return p.status !== S.OK ? Promise.resolve(p) : p.value.loadScript(src, opts);
        }
    };

    /* =================================================================
     * 5. Media facade
     * ============================================================== */

    var media = {
        camera: function (o) {
            var p = need('Media');
            return p.status !== S.OK ? Promise.resolve(p) : p.value.camera(o);
        },
        mic: function (o) {
            var p = need('Media');
            return p.status !== S.OK ? Promise.resolve(p) : p.value.mic(o);
        },
        stopStream: function (ref) {
            var p = need('Media');
            return p.status !== S.OK ? p : p.value.stopStream(ref);
        },
        capturePhoto: function (ref, o) {
            var p = need('Media');
            return p.status !== S.OK ? Promise.resolve(p) : p.value.capturePhoto(ref, o);
        },
        speak: function (t, o) {
            var p = need('Media');
            return p.status !== S.OK ? Promise.resolve(p) : p.value.speak(t, o);
        },
        print: function (html) {
            var p = need('Media');
            return p.status !== S.OK ? Promise.resolve(p) : p.value.print(html);
        },
        beep: function (f, ms, o) {
            var p = need('Media');
            return p.status !== S.OK ? p : p.value.beep(f, ms, o);
        },
        listDevices: function () {
            var p = need('Media');
            return p.status !== S.OK ? Promise.resolve(p) : p.value.listDevices();
        }
    };

    /* =================================================================
     * 6. DOM facade (for the UI layer only)
     *
     * HAL never draws. It exposes the raw DOM gateway to L4/L5 so the
     * UI layer has a kernel-sanctioned path, keeping the call chain
     *   UI -> HAL -> L1 -> browser
     * instead of reaching up. UI layers must still render through
     * Ezn32 UI, not through this facade directly.
     * ============================================================== */

    var dom = {
        query: function (sel, root) {
            var p = need('DOM');
            return p.status !== S.OK ? p : p.value.query(sel, root);
        },
        byId: function (id) {
            var p = need('DOM');
            return p.status !== S.OK ? p : p.value.byId(id);
        },
        create: function (tag, props, parent) {
            var p = need('DOM');
            return p.status !== S.OK ? p : p.value.create(tag, props, parent);
        },
        setText: function (el, t) {
            var p = need('DOM');
            return p.status !== S.OK ? p : p.value.setText(el, t);
        },
        on: function (el, ev, fn, o) {
            var p = need('DOM');
            return p.status !== S.OK ? p : p.value.on(el, ev, fn, o);
        },
        off: function (h) {
            var p = need('DOM');
            return p.status !== S.OK ? p : p.value.off(h);
        },
        measureText: function (t, font) {
            var p = need('DOM');
            return p.status !== S.OK ? p : p.value.measureText(t, font);
        },
        isReady: function () {
            var p = need('DOM');
            return p.status !== S.OK ? p : p.value.isReady();
        },
        ready: function (fn) {
            var p = need('DOM');
            return p.status !== S.OK ? p : p.value.ready(fn);
        },
        gateway: function () {
            return need('DOM');
        }
    };

    /* =================================================================
     * 7. Environment facts
     * ============================================================== */

    function env() {
        var screen = (G.screen && G.screen.width) ? { width: G.screen.width, height: G.screen.height } : { width: 0, height: 0 };
        var dom = plat('DOM');
        return ok({
            userAgent: (G.navigator && G.navigator.userAgent) ? G.navigator.userAgent : '',
            platform: (G.navigator && G.navigator.platform) ? G.navigator.platform : '',
            language: (G.navigator && G.navigator.language) ? G.navigator.language : 'en',
            online: !!(G.navigator && G.navigator.onLine !== false),
            headless: dom ? dom.isHeadless() : true,
            screen: screen,
            devicePixelRatio: G.devicePixelRatio || 1,
            hardwareConcurrency: (G.navigator && G.navigator.hardwareConcurrency) || 1,
            hasIndexedDB: !!G.indexedDB,
            hasLocalStorage: !!G.localStorage,
            hasSpeech: !!(G.speechSynthesis)
        });
    }

    /** capabilities() -> { status, value: {fs, dom, time, net, media} } */
    function capabilities() {
        return ok({
            fs: !!P.storage,
            dom: !!P.dom,
            time: !!P.time,
            net: !!P.net,
            media: !!P.media
        });
    }

    /** boot-check every L1 module the kernel needs. */
    function probe() {
        refresh();
        var caps = capabilities().value;
        var missing = Object.keys(caps).filter(function (k) { return !caps[k]; });
        if (missing.length) {
            return fail(S.ENOSYS, { reason: 'missing platform modules: ' + missing.join(', '), missing: missing });
        }
        return ok(caps);
    }

    /* =================================================================
     * 8. Public handles
     * ============================================================== */

    var HAL = {};
    HAL.__isHAL = true;
    HAL.version = '1.0.0';
    HAL.STATUS = S;
    HAL.namespace = 'HAL';

    HAL.fs = fs;
    HAL.time = time;
    HAL.net = net;
    HAL.media = media;
    HAL.dom = dom;

    HAL.env = env;
    HAL.capabilities = capabilities;
    HAL.probe = probe;
    HAL.refresh = refresh;

    LOG.info('kernel/hal.js 已加载');

    /* Register with the kernel when core exists (normal load order:
     * core.js -> hal.js). Falls back to the namespace tables otherwise. */
    if (G.SRM && typeof G.SRM.register === 'function') {
        G.SRM.register('hal', HAL);
        G.SRM.hal = HAL;
    } else {
        if (!G.EznK.Kernel) { G.EznK.Kernel = { modules: Object.create(null) }; }
        if (!G.EznK.Kernel.modules) { G.EznK.Kernel.modules = Object.create(null); }
        G.EznK.Kernel.modules.hal = HAL;
        G.EznK.Kernel.HAL = HAL;
    }

}(typeof globalThis !== 'undefined' ? globalThis : this));
