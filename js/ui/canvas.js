/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/canvas.js
 *   Module  : EznK.Ui.Canvas  (alias: ezn32.ui.canvas)
 *   Layer   : Ezn32 UI
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   ezn32.ui.canvas - a client-area canvas surface. This is what Ezn32 UI
 *   draws on. It wraps a GDI device context with convenient primitives
 *   (text / rect / line / pixel / roundRect / clip) and owns the canvas
 *   element lifetime.
 *
 *   RULE: every pixel EZNT puts on screen is drawn through this module or
 *   through the canvas it hands out. The DOM is only used to hold the
 *   <canvas> element (via platform DOM); no styled DOM ever renders UI.
 *
 *   A Canvas is created by:
 *     Create(width, height)                 -> offscreen surface
 *     CreateForParent(parentEl, w, h)       -> attached surface
 *
 *   Both return a surface with its own repaint cycle:
 *     begin() / end()  - batching (avoids flicker)
 *     invalidate()     - schedule one repaint on the next frame
 *     setPainter(fn)   - the paint callback
 *
 *   dispose() releases the canvas, its listeners and its frame handle.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.canvas && G.ezn32.ui.canvas.__isUiCanvas === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var GDI = (G.ezn32 && G.ezn32.api && G.ezn32.api.gdi) || null;
    var DOM = (G.EznK && G.EznK.Platform && G.EznK.Platform.DOM) || null;
    var TIME = (G.EznK && G.EznK.Platform && G.EznK.Platform.Time) || null;
    var RES = (G.ezn32 && G.ezn32.ui && G.ezn32.ui.res) || null;
    if (!CORE || !GDI) {
        throw new Error('[Ezn32 UI] js/ui/canvas.js requires platform/core.js and js/api/gdi.js');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('Ezn32/UI:canvas');

    var DPR = (typeof G.devicePixelRatio === 'number' && G.devicePixelRatio > 0) ? G.devicePixelRatio : 1;

    var seq = 0;
    var surfaces = Object.create(null);

    /* =================================================================
     * 1. Surface creation
     * ============================================================== */

    function attachElement(el) {
        if (DPR !== 1) {
            el.style.width = el.width + 'px';
            el.style.height = el.height + 'px';
            el.width = Math.floor(el.width * DPR);
            el.height = Math.floor(el.height * DPR);
        }
    }

    /** Create(width, height) -> { status, value: surface } */
    function Create(width, height) {
        return create(null, width, height);
    }

    /** CreateForParent(parentEl, width, height) -> { status, value: surface } */
    function CreateForParent(parentEl, width, height) {
        if (!parentEl || parentEl.nodeType !== 1) {
            return fail(S.EINVAL, { reason: 'parent element required' });
        }
        return create(parentEl, width, height);
    }

    function create(parent, width, height) {
        if (!DOM) { return fail(S.ENOSYS, { reason: 'DOM gateway not loaded' }); }
        var w = (typeof width === 'number' && width > 0) ? Math.floor(width) : 320;
        var h = (typeof height === 'number' && height > 0) ? Math.floor(height) : 200;
        var created = DOM.create('canvas', {
            styles: { display: 'block', position: 'absolute', left: '0px', top: '0px' }
        }, parent || 'root');
        if (created.status !== S.OK) { return created; }
        var el = created.value;
        el.width = w;
        el.height = h;
        attachElement(el);

        var dcRes = GDI.CreateCompatibleDC(el);
        if (dcRes.status !== S.OK) {
            DOM.remove(el);
            return dcRes;
        }
        var dc = dcRes.value;
        if (DPR !== 1) { dc.ctx.scale(DPR, DPR); }

        seq += 1;
        var surface = {
            __isSurface: true,
            id: 'surface' + seq,
            element: el,
            dc: dc,
            width: w,
            height: h,
            painter: null,
            frameHandle: null,
            disposed: false,
            dirty: false
        };
        /* Bound methods: a surface is handed to other layers, and they must
         * drive its repaint cycle without importing the module functions.
         * One implementation, two access paths. */
        surface.invalidate = function () { return invalidate(surface); };
        surface.paint = function () { return paint(surface); };
        surface.dispose = function () { return dispose(surface); };
        surface.resize = function (nw, nh) { return resize(surface, nw, nh); };
        surfaces[surface.id] = surface;
        return ok(surface);
    }

    /* =================================================================
     * 2. Painting
     * ============================================================== */

    /** setPainter(surface, fn) -> { status, value: surface } */
    function setPainter(surface, fn) {
        if (!surface || !surface.__isSurface) { return fail(S.EINVAL, { reason: 'surface required' }); }
        if (typeof fn !== 'function') { return fail(S.EINVAL, { reason: 'painter must be a function' }); }
        surface.painter = fn;
        invalidate(surface);
        return ok(surface);
    }

    /** invalidate(surface) - schedule one repaint on the next frame. */
    function invalidate(surface) {
        if (!surface || !surface.__isSurface) { return fail(S.EINVAL, { reason: 'surface required' }); }
        if (surface.disposed) { return fail(S.EPOWEROFF, { reason: 'surface disposed' }); }
        if (surface.frameHandle) { return ok(false); }   /* already queued */
        surface.dirty = true;
        if (TIME) {
            var h = TIME.frame(function () {
                surface.frameHandle = null;
                paint(surface);
            });
            if (h.status === S.OK) { surface.frameHandle = h.value; }
        } else {
            paint(surface);
        }
        return ok(true);
    }

    /** paint(surface) - repaint immediately. */
    function paint(surface) {
        if (!surface || !surface.__isSurface || surface.disposed) {
            return fail(S.EINVAL, { reason: 'surface not usable' });
        }
        surface.dirty = false;
        try {
            GDI.Clear(surface.dc);
            if (typeof surface.painter === 'function') {
                surface.painter(surface);
            }
            return ok(true);
        } catch (err) {
            LOG.error('paint failed: ' + (err && err.message));
            return fail(S.EIO, { reason: err && err.message });
        }
    }

    /* =================================================================
     * 3. Convenience primitives (thin wrappers over GDI on this surface)
     * ============================================================== */

    function guard(surface) {
        if (!surface || !surface.__isSurface) { return fail(S.EINVAL, { reason: 'surface required' }); }
        if (surface.disposed) { return fail(S.EPOWEROFF, { reason: 'surface disposed' }); }
        return ok(surface);
    }

    function text(surface, str, x, y, opts) {
        var g = guard(surface); if (g.status !== S.OK) { return g; }
        var o = opts || {};
        var dc = surface.dc;
        var prevColor = dc.textColor;
        if (o.color) { GDI.SetTextColor(dc, o.color); }
        if (o.align) { GDI.SetTextAlign(dc, o.align); }
        if (o.font && RES) { GDI.SelectObject(dc, RES.font(o.font)); }
        var r = o.maxWidth
            ? GDI.DrawTextTruncated(dc, str, x, y, o.maxWidth, o.ellipsis !== false)
            : GDI.DrawText(dc, str, x, y);
        GDI.SetTextColor(dc, prevColor);
        if (o.align) { GDI.SetTextAlign(dc, 'left'); }
        return r;
    }

    function rect(surface, x, y, w, h, color) {
        var g = guard(surface); if (g.status !== S.OK) { return g; }
        return GDI.FillRect(surface.dc, x, y, w, h, color);
    }

    function strokeRect(surface, x, y, w, h, color, lineWidth) {
        var g = guard(surface); if (g.status !== S.OK) { return g; }
        return GDI.DrawRect(surface.dc, x, y, w, h, color, lineWidth);
    }

    function roundRect(surface, x, y, w, h, radius, color, fill) {
        var g = guard(surface); if (g.status !== S.OK) { return g; }
        return GDI.DrawRoundRect(surface.dc, x, y, w, h, radius, color, fill);
    }

    function line(surface, x1, y1, x2, y2, color, lineWidth) {
        var g = guard(surface); if (g.status !== S.OK) { return g; }
        return GDI.DrawLine(surface.dc, x1, y1, x2, y2, color, lineWidth);
    }

    function pixel(surface, x, y, color) {
        var g = guard(surface); if (g.status !== S.OK) { return g; }
        return GDI.DrawPixel(surface.dc, x, y, color);
    }

    function ellipse(surface, x, y, w, h, color, fill) {
        var g = guard(surface); if (g.status !== S.OK) { return g; }
        return GDI.DrawEllipse(surface.dc, x, y, w, h, color, fill);
    }

    function clear(surface, color) {
        var g = guard(surface); if (g.status !== S.OK) { return g; }
        return GDI.Clear(surface.dc, color);
    }

    /** measure(str, fontName) -> { status, value: {width, height} } */
    function measure(str, fontName) {
        if (!RES) { return GDI.MeasureText(str, null); }
        return GDI.MeasureText(str, RES.font(fontName || 'ui'));
    }

    /** resize(surface, width, height) */
    function resize(surface, width, height) {
        var g = guard(surface); if (g.status !== S.OK) { return g; }
        var w = Math.max(1, Math.floor(width));
        var h = Math.max(1, Math.floor(height));
        var el = surface.element;
        var prevW = surface.width;
        if (DPR !== 1) {
            el.style.width = w + 'px';
            el.style.height = h + 'px';
            el.width = Math.floor(w * DPR);
            el.height = Math.floor(h * DPR);
        } else {
            el.width = w;
            el.height = h;
        }
        surface.width = w;
        surface.height = h;
        /* width/height assignment resets the context state (including scale) */
        if (DPR !== 1) { surface.dc.ctx.scale(DPR, DPR); }
        surface.dc.width = w;
        surface.dc.height = h;
        void prevW;
        invalidate(surface);
        return ok(true);
    }

    /** getImageData(surface, x, y, w, h) - used by tests and screenshots. */
    function getImageData(surface, x, y, w, h) {
        var g = guard(surface); if (g.status !== S.OK) { return g; }
        try {
            return ok(surface.dc.ctx.getImageData(x, y, w, h));
        } catch (err) {
            return fail(S.EIO, { reason: err.message });
        }
    }

    /** toDataURL(surface) - snapshot for the backup/lock screen. */
    function toDataURL(surface) {
        var g = guard(surface); if (g.status !== S.OK) { return g; }
        try { return ok(surface.element.toDataURL('image/png')); }
        catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    /* =================================================================
     * 4. Lifecycle
     * ============================================================== */

    /** dispose(surface) -> { status, value: true } */
    function dispose(surface) {
        if (!surface || !surface.__isSurface) { return fail(S.EINVAL, { reason: 'surface required' }); }
        if (surface.disposed) { return fail(S.EPOWEROFF, { reason: 'already disposed' }); }
        if (surface.frameHandle && TIME) { TIME.cancelFrame(surface.frameHandle); }
        surface.frameHandle = null;
        surface.painter = null;
        surface.disposed = true;
        delete surfaces[surface.id];
        if (DOM) { DOM.remove(surface.element); }
        return ok(true);
    }

    /** count() -> number of live surfaces (leak check for tests). */
    function count() {
        return ok(Object.keys(surfaces).length);
    }

    var C = {};
    C.__isUiCanvas = true;
    C.version = '1.0.0';
    C.STATUS = S;
    C.DPR = DPR;

    C.Create = Create;
    C.CreateForParent = CreateForParent;
    C.setPainter = setPainter;
    C.invalidate = invalidate;
    C.paint = paint;

    C.text = text;
    C.rect = rect;
    C.strokeRect = strokeRect;
    C.roundRect = roundRect;
    C.line = line;
    C.pixel = pixel;
    C.ellipse = ellipse;
    C.clear = clear;
    C.measure = measure;
    C.resize = resize;
    C.getImageData = getImageData;
    C.toDataURL = toDataURL;

    C.dispose = dispose;
    C.count = count;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Ui) { G.EznK.Ui = {}; }
    G.EznK.Ui.Canvas = C;
    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.ui) { G.ezn32.ui = {}; }
    G.ezn32.ui.canvas = C;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    G.EZNT.ui.canvas = C;

    LOG.info('js/ui/canvas.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
