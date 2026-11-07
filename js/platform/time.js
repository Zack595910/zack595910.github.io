/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 1 - Platform Layer
 *
 *   File    : js/platform/time.js
 *   Module  : EznK.Platform.Time  (alias: EZNT.Time)
 *   Layer   : L1 平台层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The single clock and timer source of EZNT. Every layer above L1
 *   schedules work through this module. Hard rule #5 ("lifecycle is
 *   explicit - never bet ordering on setTimeout") is enforced here by
 *   making every scheduled callback OWNED and RELEASABLE.
 *
 *   Provides:
 *     - clocks        : now() / perfNow() / date() / uptime() / format()
 *     - timers        : after() / every() / everySafe() -> handles
 *     - daily clock   : wall-clock aligned ticks for taskbar clocks
 *     - animation     : frame() wrapping requestAnimationFrame
 *     - idle/batch    : once(fn) coalesced to the next microtask
 *     - lifecycle     : cancel / clearAll / dispose
 *
 *   rf `wait` and `parallel`, the SRM scheduler, the boot animation and
 *   the taskbar clock all resolve their timing here and nowhere else.
 *
 * ---------------------------------------------------------------------
 * 契约 (CONTRACT)
 * ============================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Platform && G.EznK.Platform.Time &&
        G.EznK.Platform.Time.__isEZNTTime === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[EznK/L1] platform/time.js requires platform/core.js to load first');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var failFrom = CORE.failFrom;
    var LOG = CORE.createLogger('EznK/L1:time');

    /* =================================================================
     * 1. Environment
     * ============================================================== */

    var PERFORMANCE = (typeof G.performance !== 'undefined' && G.performance) ? G.performance : null;
    var TIMEOUT_FN = (typeof G.setTimeout === 'function') ? G.setTimeout.bind(G) : null;
    var CLEAR_TIMEOUT_FN = (typeof G.clearTimeout === 'function') ? G.clearTimeout.bind(G) : null;
    var RAF_FN = (typeof G.requestAnimationFrame === 'function') ? G.requestAnimationFrame.bind(G) : null;
    var CAF_FN = (typeof G.cancelAnimationFrame === 'function') ? G.cancelAnimationFrame.bind(G) : null;

    /** Monotonic-ish origin for uptime(). */
    var BOOT_AT = (PERFORMANCE && PERFORMANCE.now) ? PERFORMANCE.now() : Date.now();

    /* =================================================================
     * 2. Timer registry (single source of truth)
     * ============================================================== */

    var timers = Object.create(null);
    var nextId = 0;
    var disposed = false;

    function allocId() {
        nextId += 1;
        return 't' + nextId;
    }

    function ensureAlive() {
        if (disposed) {
            return fail(S.EPOWEROFF, { reason: 'time module disposed' });
        }
        return ok(true);
    }

    /** Register a scheduled native timer. */
    function register(rec) {
        var id = allocId();
        rec.id = id;
        timers[id] = rec;
        return id;
    }

    /** Forget one timer record (does not clear the native timer). */
    function forget(id) {
        var rec = timers[id];
        if (!rec) { return null; }
        delete timers[id];
        return rec;
    }

    /* =================================================================
     * 3. Clocks
     * ============================================================== */

    /** now() -> { status, value: epoch ms } */
    function now() {
        return ok(Date.now());
    }

    /** perfNow() -> { status, value: high-res ms } */
    function perfNow() {
        if (PERFORMANCE && PERFORMANCE.now) { return ok(PERFORMANCE.now()); }
        return ok(Date.now());
    }

    /** date() -> { status, value: Date }  (a fresh copy, never shared) */
    function date() {
        return ok(new Date());
    }

    /** uptime() -> { status, value: ms since module load } */
    function uptime() {
        var t = (PERFORMANCE && PERFORMANCE.now) ? PERFORMANCE.now() : Date.now();
        return ok(t - BOOT_AT);
    }

    /** A synchronous date/time object for the shell clock. */
    function clock() {
        var d = new Date();
        return ok({
            iso: d.toISOString(),
            epoch: d.getTime(),
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            day: d.getDate(),
            weekday: d.getDay(),
            hours: d.getHours(),
            minutes: d.getMinutes(),
            seconds: d.getSeconds(),
            hhmm: pad(d.getHours()) + ':' + pad(d.getMinutes()),
            hhmmss: pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()),
            ymd: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        });
    }

    function pad(n) {
        return (n < 10 ? '0' : '') + n;
    }

    /** format(template, epochMs?) - tiny ASCII formatter for shell UI.
     *  Tokens: YYYY MM DD hh mm ss MMM (month 1-12) D (day 1-31). */
    function format(template, ts) {
        if (typeof template !== 'string' || template.length === 0) {
            return fail(S.EINVAL, { reason: 'template must be a non-empty string' });
        }
        var d = new Date(typeof ts === 'number' ? ts : Date.now());
        var map = {
            YYYY: String(d.getFullYear()),
            MM: pad(d.getMonth() + 1),
            DD: pad(d.getDate()),
            hh: pad(d.getHours()),
            mm: pad(d.getMinutes()),
            ss: pad(d.getSeconds()),
            MMM: String(d.getMonth() + 1),
            D: String(d.getDate())
        };
        var out = template.replace(/YYYY|MMM|MM|DD|hh|mm|ss|D/g, function (m) { return map[m]; });
        return ok(out);
    }

    /* =================================================================
     * 4. Timers
     * ============================================================== */

    /** after(ms, fn) -> { status, value: handle }  one-shot. */
    function after(ms, fn) {
        var g = ensureAlive();
        if (g.status !== S.OK) { return g; }
        if (typeof fn !== 'function') {
            return fail(S.EINVAL, { reason: 'callback must be a function' });
        }
        if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) {
            return fail(S.EINVAL, { reason: 'ms must be a non-negative number' });
        }
        if (!TIMEOUT_FN) { return fail(S.ENOSYS, { reason: 'no timer source' }); }
        var id;
        var nativeId = TIMEOUT_FN(function () {
            forget(id);
            try { fn(); } catch (err) {
                LOG.error('after() callback threw: ' + (err && err.message));
            }
        }, Math.round(ms));
        id = register({ kind: 'timeout', native: nativeId, fn: fn, ms: ms });
        return ok(id);
    }

    /** every(ms, fn, opts?) -> { status, value: handle }  repeating. */
    function every(ms, fn, opts) {
        var g = ensureAlive();
        if (g.status !== S.OK) { return g; }
        if (typeof fn !== 'function') {
            return fail(S.EINVAL, { reason: 'callback must be a function' });
        }
        if (typeof ms !== 'number' || !isFinite(ms) || ms < 1) {
            return fail(S.EINVAL, { reason: 'ms must be >= 1' });
        }
        if (!TIMEOUT_FN) { return fail(S.ENOSYS, { reason: 'no timer source' }); }
        var o = opts || {};
        var id;
        var nativeId = TIMEOUT_FN(function tick() {
            var rec = timers[id];
            if (!rec) { return; }
            try { fn(); } catch (err) {
                LOG.error('every() callback threw: ' + (err && err.message));
                if (o.stopOnError === true) { cancel(id); return; }
            }
            if (!timers[id]) { return; }
            rec.native = TIMEOUT_FN(tick, Math.round(ms));
        }, Math.round(ms));
        id = register({ kind: 'interval', native: nativeId, fn: fn, ms: ms, options: o });
        return ok(id);
    }

    /** everySafe(ms, fn, opts?) - repeating timer that swallows callback
     *  exceptions and still keeps ticking unless stopOnError:true. */
    function everySafe(ms, fn, opts) {
        var o = Object.assign({}, opts || {}, { stopOnError: false });
        return every(ms, function () {
            try { fn(); } catch (err) {
                LOG.warn('everySafe callback error: ' + (err && err.message));
            }
        }, o);
    }

    /** once(fn) -> { status, value: handle } - run on the next microtask. */
    function once(fn) {
        var g = ensureAlive();
        if (g.status !== S.OK) { return g; }
        if (typeof fn !== 'function') {
            return fail(S.EINVAL, { reason: 'callback must be a function' });
        }
        var id;
        Promise.resolve().then(function () {
            if (!timers[id]) { return; }
            forget(id);
            try { fn(); } catch (err) {
                LOG.error('once() callback threw: ' + (err && err.message));
            }
        });
        id = register({ kind: 'microtask', fn: fn, native: null });
        return ok(id);
    }

    /**
     * alignedTo(periodMs, fn) -> { status, value: handle }
     *   Runs fn at the next wall-clock-ms boundary whose timestamp modulo
     *   periodMs is zero, then keeps re-arming. Used by the taskbar clock
     *   so minute ticks happen at :00 rather than drifting from load time.
     *   The returned handle is registered in the timer table (cancel()).
     */
    function alignedTo(periodMs, fn) {
        var g = ensureAlive();
        if (g.status !== S.OK) { return g; }
        if (typeof periodMs !== 'number' || periodMs < 1) {
            return fail(S.EINVAL, { reason: 'periodMs must be >= 1' });
        }
        if (typeof fn !== 'function') {
            return fail(S.EINVAL, { reason: 'callback must be a function' });
        }
        var id = allocId();
        timers[id] = { kind: 'aligned', native: null, id: id, fn: fn, ms: periodMs, inner: null };
        function arm(toBoundary) {
            if (!timers[id]) { return; }
            var current = Date.now();
            var d = toBoundary ? (periodMs - (current % periodMs)) % periodMs : periodMs;
            if (d === 0) { d = periodMs; }
            var h = after(d, function () {
                if (!timers[id]) { return; }
                try { fn(); } catch (err) {
                    LOG.error('alignedTo callback threw: ' + (err && err.message));
                }
                if (timers[id]) { arm(false); }
            });
            if (h.status === S.OK && timers[id]) {
                timers[id].inner = h.value;
                timers[id].native = h.value;
            }
        }
        arm(true);
        return ok(id);
    }

    /**
     * minuteTick(fn) - ticks at each new minute (00 seconds).
     */
    function minuteTick(fn) {
        return alignedTo(60000, fn);
    }

    /** wait(ms) -> Promise<{status,value:true}>  rf/parallel friendly. */
    function wait(ms) {
        var g = ensureAlive();
        if (g.status !== S.OK) { return Promise.resolve(g); }
        return new Promise(function (resolve) {
            var h = after(ms, function () { resolve(ok(true)); });
            if (h.status !== S.OK) { resolve(h); }
        });
    }

    /** delay(ms) -> Promise<true> - never rejects. */
    function delay(ms) {
        return wait(ms).then(function () { return true; });
    }

    /** cancel(handle) -> { status, value: boolean } */
    function cancel(handle) {
        var id = (typeof handle === 'string') ? handle
            : (handle && typeof handle.value === 'string' ? handle.value : null);
        if (!id) { return fail(S.EINVAL, { reason: 'cancel expects a timer handle' }); }
        var rec = timers[id];
        if (!rec) { return fail(S.ENOENT, { reason: 'unknown or finished timer' }); }
        /* Composite timers (aligned) own an inner after(); cancel it first. */
        if (rec.inner) {
            forget(id);
            var inner = timers[rec.inner];
            if (inner && CLEAR_TIMEOUT_FN && inner.native !== null) {
                CLEAR_TIMEOUT_FN(inner.native);
            }
            forget(rec.inner);
            return ok(true);
        }
        if (CLEAR_TIMEOUT_FN && rec.native !== null && rec.kind !== 'microtask' &&
            rec.kind !== 'frame' && rec.kind !== 'loop') {
            CLEAR_TIMEOUT_FN(rec.native);
        }
        if (CAF_FN && (rec.kind === 'frame' || rec.kind === 'loop') && rec.native !== null) {
            CAF_FN(rec.native);
        }
        forget(id);
        delete frames[id];
        return ok(true);
    }

    /** pause(handle) -> { status, value: { handle, resume } }
     *  Stops the timer but KEEPS its callback and period so it can be
     *  resumed. value.handle is a resume handle (not a live timer);
     *  value.resume() starts it again and returns a new timer handle. */
    function pause(handle) {
        var id = (typeof handle === 'string') ? handle : (handle && handle.value);
        var rec = timers[id];
        if (!rec) { return fail(S.ENOENT, { reason: 'unknown timer' }); }
        var ms = rec.ms;
        var fn = rec.fn;
        var kind = rec.kind;
        var opts = rec.options;
        var c = cancel(id);
        if (c.status !== S.OK) { return c; }
        var resume = function () {
            return kind === 'interval' ? every(ms, fn, opts) : after(ms, fn);
        };
        return ok({ handle: id, resume: resume, kind: kind, ms: ms });
    }

    /** clearAll() -> { status, value: number } */
    function clearAll() {
        var ids = Object.keys(timers);
        for (var i = 0; i < ids.length; i++) { cancel(ids[i]); }
        return ok(ids.length);
    }

    /** pending() -> { status, value: { count, timers:[{id,kind,ms}] } } */
    function pending() {
        var out = [];
        Object.keys(timers).forEach(function (id) {
            var r = timers[id];
            out.push({ id: id, kind: r.kind, ms: r.ms });
        });
        return ok({ count: out.length, timers: out });
    }

    /* =================================================================
     * 5. Animation frames
     * ============================================================== */

    var frames = Object.create(null);

    /** frame(fn) -> { status, value: handle }  requestAnimationFrame once. */
    function frame(fn) {
        var g = ensureAlive();
        if (g.status !== S.OK) { return g; }
        if (typeof fn !== 'function') {
            return fail(S.EINVAL, { reason: 'callback must be a function' });
        }
        if (!RAF_FN) {
            var fallback = after(16, function () { fn(0); });
            return fallback.status === S.OK ? ok(fallback.value) : fallback;
        }
        var id = allocId();
        var nativeId = RAF_FN(function (ts) {
            delete frames[id];
            try { fn(ts || 0); } catch (err) {
                LOG.error('frame() callback threw: ' + (err && err.message));
            }
        });
        frames[id] = { native: nativeId };
        timers[id] = { kind: 'frame', native: nativeId, id: id, fn: fn, ms: 16 };
        return ok(id);
    }

    /** loop(fn) -> { status, value: handle }  repeating frame callback.
     *  fn must return false to stop. The handle is owned by the timer
     *  registry, so cancel(handle) / clearAll() / dispose() all stop it. */
    function loop(fn) {
        var g = ensureAlive();
        if (g.status !== S.OK) { return g; }
        if (typeof fn !== 'function') {
            return fail(S.EINVAL, { reason: 'callback must be a function' });
        }
        var id = allocId();
        timers[id] = { kind: 'loop', native: null, id: id, fn: fn, ms: 16 };
        frames[id] = { native: null };
        function schedule() {
            var nid = RAF_FN
                ? RAF_FN(step)
                : TIMEOUT_FN(function () { step(0); }, 16);
            if (timers[id]) { timers[id].native = nid; }
            if (frames[id]) { frames[id].native = nid; }
        }
        function step(ts) {
            if (!timers[id]) { return; }
            var keep;
            try { keep = fn(ts || 0); } catch (err) {
                LOG.error('loop() callback threw: ' + (err && err.message));
                keep = false;
            }
            if (keep === false || !timers[id]) {
                delete timers[id];
                delete frames[id];
                return;
            }
            schedule();
        }
        schedule();
        return ok(id);
    }

    /** cancelFrame(handle) - alias of cancel for frames. */
    function cancelFrame(handle) {
        var id = (typeof handle === 'string') ? handle : (handle && handle.value);
        if (!id) { return fail(S.EINVAL, { reason: 'cancelFrame expects a handle' }); }
        if (!timers[id] && !frames[id]) { return fail(S.ENOENT, { reason: 'unknown frame' }); }
        if (CAF_FN && frames[id] && frames[id].native !== null) {
            CAF_FN(frames[id].native);
        }
        delete frames[id];
        forget(id);
        return ok(true);
    }

    /* =================================================================
     * 6. Lifecycle
     * ============================================================== */

    function dispose() {
        clearAll();
        frames = Object.create(null);
        disposed = true;
        LOG.info('time disposed');
        return ok(true);
    }

    function isDisposed() {
        return ok(disposed);
    }

    /* =================================================================
     * 7. Public handles
     * ============================================================== */

    var Time = {};

    Time.__isEZNTTime = true;
    Time.version = '1.0.0';
    Time.STATUS = S;

    Time.now = now;
    Time.perfNow = perfNow;
    Time.date = date;
    Time.uptime = uptime;
    Time.clock = clock;
    Time.format = format;

    Time.after = after;
    Time.every = every;
    Time.everySafe = everySafe;
    Time.once = once;
    Time.alignedTo = alignedTo;
    Time.minuteTick = minuteTick;
    Time.wait = wait;
    Time.delay = delay;
    Time.cancel = cancel;
    Time.pause = pause;
    Time.clearAll = clearAll;
    Time.pending = pending;

    Time.frame = frame;
    Time.loop = loop;
    Time.cancelFrame = cancelFrame;

    Time.dispose = dispose;
    Time.isDisposed = isDisposed;

    CORE.attach('Time', Time);
    LOG.info('platform/time.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
