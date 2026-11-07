/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 API
 *
 *   File    : js/api/gdi.js
 *   Module  : EznK.Api.Gdi  (alias: ezn32.api.gdi)
 *   Layer   : Ezn32 API
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   ezn32.api.gdi - the gdi32.dll equivalent: the pixel drawing toolkit
 *   that Ezn32 UI is built on. Windows uses GDI to paint; EZNT uses this
 *   module to paint to a Canvas 2D context.
 *
 *   A "Device Context" (DC) wraps a canvas context together with its
 *   pen/brush/font state. All Ezn32 UI controls draw through a DC, so
 *   there is exactly one implementation of "draw a button".
 *
 *     gdi.CreateCompatibleDC(canvas)  -> DC  { ctx, width, height, state }
 *     gdi.CreatePen(color, width) / CreateBrush(color) / CreateFont(...)
 *     gdi.SelectObject(dc, obj)       -> previous selection
 *     gdi.SetTextColor / SetBkColor / SetTextAlign
 *     gdi.FillRect / DrawRect / DrawLine / DrawPixel / DrawRoundRect
 *     gdi.DrawText(dc, text, x, y)    -- ASCII-only enforcement
 *     gdi.MeasureText(text, font)     -- through platform measureText
 *     gdi.DrawImage / ClipRect / Clear
 *     gdi.CreateBitmap(w,h)           -- offscreen surface for flicker-free
 *
 *   HARD RULE #10 (ASCII): every text primitive strips or rejects
 *   non-ASCII characters before they can reach the canvas.
 *
 *   This module is the ONLY place that calls a canvas 2d context for
 *   drawing. Ezn32 UI composes it; applications never call it directly.
 *
 *   CHAIN EXCEPTION (documented): text measurement is a pure read-only
 *   platform metric. It uses platform DOM.measureText directly because
 *   measuring must never fail when the kernel is busy, and it creates no
 *   object, opens no handle and touches no persistent state. Every other
 *   GDI call operates on a DC the caller already owns. This is the ONLY
 *   L1 reference in the Ezn32 API layer.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.ezn32 && G.ezn32.api && G.ezn32.api.gdi && G.ezn32.api.gdi.__isApiGdi === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var DOM = (G.EznK && G.EznK.Platform && G.EznK.Platform.DOM) || null;
    if (!CORE) {
        throw new Error('[Ezn32 API] js/api/gdi.js requires platform/core.js');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('Ezn32/API:gdi');

    var DOC = G.document || null;

    /* =================================================================
     * 1. ASCII enforcement (hard rule #10)
     * ============================================================== */

    /**
     * sanitizeScreenText(text)
     *   屏幕文字净化。用户要求全中文界面 + emoji 图标，因此：
     *     - 保留 ASCII 可打印字符
     *     - 保留中文（CJK）
     *     - 保留 emoji
     *     - 去除真正的控制字符（除换行/制表）
     *   若要恢复严格 ASCII，调用 I18n.setStrictAscii(true)。
     */
    function sanitizeScreenText(text) {
        var s = String(text === null || text === undefined ? '' : text);
        var i18n = G.EznK && G.EznK.Platform && G.EznK.Platform.I18n;
        if (i18n && i18n.getStrict && i18n.getStrict() === true) {
            return s.replace(/[^\x20-\x7E]/g, '');
        }
        /* 去掉控制字符（U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+007F） */
        return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    }

    /* 兼容旧名 */
    function asciiOnly(text) { return sanitizeScreenText(text); }

    /* =================================================================
     * 2. GDI objects (pen / brush / font)
     * ============================================================== */

    var objSeq = 0;

    /** CreatePen(color, width) -> { status, value: pen } */
    function CreatePen(color, width) {
        if (typeof color !== 'string' || color.length === 0) {
            return fail(S.EINVAL, { reason: 'color required' });
        }
        objSeq += 1;
        return ok({ kind: 'pen', id: objSeq, color: color, width: (typeof width === 'number' ? width : 1) });
    }

    /** CreateSolidBrush(color) -> { status, value: brush } */
    function CreateSolidBrush(color) {
        if (typeof color !== 'string' || color.length === 0) {
            return fail(S.EINVAL, { reason: 'color required' });
        }
        objSeq += 1;
        return ok({ kind: 'brush', id: objSeq, color: color });
    }

    var CreateBrush = CreateSolidBrush;

    /** CreateFont(opts) -> { status, value: font } */
    function CreateFont(opts) {
        var o = opts || {};
        objSeq += 1;
        return ok({
            kind: 'font',
            id: objSeq,
            family: typeof o.family === 'string' ? o.family : 'monospace',
            size: (typeof o.size === 'number' && o.size > 0) ? o.size : 12,
            weight: (typeof o.weight === 'number') ? o.weight : 400,
            italic: o.italic === true,
            css: (typeof o.css === 'string') ? o.css : null
        });
    }

    /** 默认字体栈：中文优先，emoji 由系统 emoji 字体兜底 */
    var DEFAULT_FAMILY = '"Microsoft YaHei", "PingFang SC", "Segoe UI", "Segoe UI Emoji", sans-serif';

    function fontToCss(font) {
        if (!font) { return '12px ' + DEFAULT_FAMILY; }
        if (font.css) { return font.css; }
        /* font.family 可能是完整的字体栈（含逗号与引号），直接使用 */
        var family = font.family && String(font.family).length ? font.family : DEFAULT_FAMILY;
        return (font.italic ? 'italic ' : '') + font.weight + ' ' + font.size + 'px ' + family;
    }

    /* =================================================================
     * 3. Device context
     * ============================================================== */

    /**
     * CreateCompatibleDC(canvasOrContext) -> { status, value: DC }
     *   DC = { ctx, width, height, pen, brush, font, textColor, bkColor,
     *          align, clip, origin }
     */
    function CreateCompatibleDC(source) {
        var ctx = null;
        var w = 0, h = 0;
        if (!source) { return fail(S.EINVAL, { reason: 'canvas or context required' }); }
        if (typeof source.getContext === 'function') {
            ctx = source.getContext('2d');
            w = source.width;
            h = source.height;
        } else if (typeof source.fillRect === 'function') {
            ctx = source;
            w = (source.canvas && source.canvas.width) || 0;
            h = (source.canvas && source.canvas.height) || 0;
        } else {
            return fail(S.EINVAL, { reason: 'source is not a canvas or 2d context' });
        }
        if (!ctx) { return fail(S.ENOSYS, { reason: '2d context unavailable' }); }
        return ok({
            __isDC: true,
            ctx: ctx,
            width: w,
            height: h,
            pen: { color: '#000000', width: 1 },
            brush: { color: '#FFFFFF' },
            font: { family: 'monospace', size: 12, weight: 400, italic: false },
            textColor: '#000000',
            bkColor: 'transparent',
            align: 'left',
            origin: { x: 0, y: 0 },
            clip: null,
            saved: []
        });
    }

    /** CreateBitmap(width, height) -> { status, value: canvas } */
    function CreateBitmap(width, height) {
        if (!DOC) { return fail(S.ENOSYS, { reason: 'no document' }); }
        if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
            return fail(S.EINVAL, { reason: 'width and height must be positive numbers' });
        }
        var c = DOC.createElement('canvas');
        c.width = Math.floor(width);
        c.height = Math.floor(height);
        return ok(c);
    }

    /** SelectObject(dc, obj) -> { status, value: previous } */
    function SelectObject(dc, obj) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        if (!obj || !obj.kind) { return fail(S.EINVAL, { reason: 'GDI object required' }); }
        var prev = null;
        if (obj.kind === 'pen') { prev = dc.pen; dc.pen = obj; }
        else if (obj.kind === 'brush') { prev = dc.brush; dc.brush = obj; }
        else if (obj.kind === 'font') {
            prev = dc.font;
            dc.font = obj;
            dc.ctx.font = fontToCss(obj);
        }
        else { return fail(S.EINVAL, { reason: 'unknown GDI object kind: ' + obj.kind }); }
        return ok(prev);
    }

    function SetTextColor(dc, color) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        dc.textColor = String(color);
        return ok(true);
    }

    function SetBkColor(dc, color) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        dc.bkColor = String(color);
        return ok(true);
    }

    function SetTextAlign(dc, align) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        if (['left', 'center', 'right'].indexOf(align) === -1) {
            return fail(S.EINVAL, { reason: 'align must be left, center or right' });
        }
        dc.align = align;
        return ok(true);
    }

    /** SetOrigin(dc, x, y) - offset applied to every primitive. */
    function SetOrigin(dc, x, y) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        dc.origin = { x: x || 0, y: y || 0 };
        return ok(true);
    }

    /* =================================================================
     * 4. Drawing primitives
     * ============================================================== */

    function px(dc, x) { return x + dc.origin.x; }
    function py(dc, y) { return y + dc.origin.y; }

    /** Clear(dc, color) */
    function Clear(dc, color) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        try {
            dc.ctx.clearRect(0, 0, dc.width, dc.height);
            if (color) {
                dc.ctx.fillStyle = String(color);
                dc.ctx.fillRect(0, 0, dc.width, dc.height);
            }
            return ok(true);
        } catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    /** FillRect(dc, x, y, w, h, color?) */
    function FillRect(dc, x, y, w, h, color) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        try {
            dc.ctx.fillStyle = color ? String(color) : dc.brush.color;
            dc.ctx.fillRect(px(dc, x), py(dc, y), w, h);
            return ok(true);
        } catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    /** DrawRect(dc, x, y, w, h, color?, lineWidth?) */
    function DrawRect(dc, x, y, w, h, color, lineWidth) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        try {
            dc.ctx.strokeStyle = color ? String(color) : dc.pen.color;
            dc.ctx.lineWidth = (typeof lineWidth === 'number') ? lineWidth : dc.pen.width;
            /* half-pixel offset keeps a 1px line crisp */
            var ox = px(dc, x), oy = py(dc, y);
            var d = (dc.ctx.lineWidth % 2 === 1) ? 0.5 : 0;
            dc.ctx.strokeRect(ox + d, oy + d, w, h);
            return ok(true);
        } catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    /** DrawRoundRect(dc, x, y, w, h, radius, color?, fill?) */
    function DrawRoundRect(dc, x, y, w, h, radius, color, fill) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        try {
            var r = (typeof radius === 'number' && radius >= 0) ? radius : 3;
            var ctx = dc.ctx;
            var ox = px(dc, x), oy = py(dc, y);
            ctx.beginPath();
            ctx.moveTo(ox + r, oy);
            ctx.lineTo(ox + w - r, oy);
            ctx.quadraticCurveTo(ox + w, oy, ox + w, oy + r);
            ctx.lineTo(ox + w, oy + h - r);
            ctx.quadraticCurveTo(ox + w, oy + h, ox + w - r, oy + h);
            ctx.lineTo(ox + r, oy + h);
            ctx.quadraticCurveTo(ox, oy + h, ox, oy + h - r);
            ctx.lineTo(ox, oy + r);
            ctx.quadraticCurveTo(ox, oy, ox + r, oy);
            ctx.closePath();
            if (fill) { ctx.fillStyle = String(fill); ctx.fill(); }
            if (color) {
                ctx.strokeStyle = String(color);
                ctx.stroke();
            }
            return ok(true);
        } catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    /** DrawLine(dc, x1, y1, x2, y2, color?, lineWidth?) */
    function DrawLine(dc, x1, y1, x2, y2, color, lineWidth) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        try {
            var ctx = dc.ctx;
            ctx.beginPath();
            ctx.strokeStyle = color ? String(color) : dc.pen.color;
            ctx.lineWidth = (typeof lineWidth === 'number') ? lineWidth : dc.pen.width;
            ctx.moveTo(px(dc, x1), py(dc, y1));
            ctx.lineTo(px(dc, x2), py(dc, y2));
            ctx.stroke();
            return ok(true);
        } catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    /** DrawPixel(dc, x, y, color?) */
    function DrawPixel(dc, x, y, color) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        try {
            dc.ctx.fillStyle = color ? String(color) : dc.pen.color;
            dc.ctx.fillRect(px(dc, x) | 0, py(dc, y) | 0, 1, 1);
            return ok(true);
        } catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    /** DrawEllipse(dc, x, y, w, h, color?, fill?) */
    function DrawEllipse(dc, x, y, w, h, color, fill) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        try {
            var ctx = dc.ctx;
            ctx.beginPath();
            ctx.ellipse(px(dc, x) + w / 2, py(dc, y) + h / 2, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2);
            if (fill) { ctx.fillStyle = String(fill); ctx.fill(); }
            if (color) { ctx.strokeStyle = String(color); ctx.stroke(); }
            return ok(true);
        } catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    /* =================================================================
     * 5. Text
     * ============================================================== */

    /**
     * DrawText(dc, text, x, y) -> { status, value: {width, height, lines} }
     *   ASCII only (rule #10). Multi-line via \n. Alignment follows
     *   SetTextAlign. Returns the drawn size.
     */
    function DrawText(dc, text, x, y) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        var clean = asciiOnly(text);
        var ctx = dc.ctx;
        try {
            ctx.font = fontToCss(dc.font);
            ctx.textBaseline = 'top';
            var lines = clean.split('\n');
            var maxW = 0;
            var lineH = dc.font.size * 1.35;
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                var w = ctx.measureText(line).width;
                if (w > maxW) { maxW = w; }
                var drawX = px(dc, x);
                if (dc.align === 'center') { drawX = px(dc, x) - w / 2; }
                else if (dc.align === 'right') { drawX = px(dc, x) - w; }
                if (dc.bkColor && dc.bkColor !== 'transparent') {
                    ctx.fillStyle = dc.bkColor;
                    ctx.fillRect(drawX, py(dc, y) + i * lineH, w, lineH);
                }
                ctx.fillStyle = dc.textColor;
                ctx.fillText(line, drawX, py(dc, y) + i * lineH);
            }
            return ok({ width: Math.ceil(maxW), height: Math.ceil(lines.length * lineH), lines: lines.length });
        } catch (err) {
            return fail(S.EIO, { reason: err.message });
        }
    }

    /**
     * DrawTextTruncated(dc, text, x, y, maxWidth, ellipsis=true)
     *   Single-line clipped text with an ASCII ellipsis ("..."). This is
     *   how every window title and list cell is painted.
     */
    function DrawTextTruncated(dc, text, x, y, maxWidth, ellipsis) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        var clean = asciiOnly(text).replace(/\n/g, ' ');
        var ctx = dc.ctx;
        try {
            ctx.font = fontToCss(dc.font);
            var w = ctx.measureText(clean).width;
            if (maxWidth && w > maxWidth) {
                var suffix = ellipsis === false ? '' : '...';
                var cut = clean;
                while (cut.length > 0 && ctx.measureText(cut + suffix).width > maxWidth) {
                    cut = cut.slice(0, -1);
                }
                clean = cut + suffix;
            }
            var drawX = px(dc, x);
            var dw = ctx.measureText(clean).width;
            if (dc.align === 'center') { drawX = px(dc, x) - dw / 2; }
            else if (dc.align === 'right') { drawX = px(dc, x) - dw; }
            ctx.textBaseline = 'top';
            ctx.fillStyle = dc.textColor;
            ctx.fillText(clean, drawX, py(dc, y));
            return ok({ text: clean, width: Math.ceil(dw) });
        } catch (err) {
            return fail(S.EIO, { reason: err.message });
        }
    }

    /** MeasureText(text, font) -> { status, value: {width, height} } */
    function MeasureText(text, font) {
        var clean = asciiOnly(text);
        var css = font ? fontToCss(font) : '12px monospace';
        if (DOM && typeof DOM.measureText === 'function') {
            var r = DOM.measureText(clean, css);
            if (r.status === S.OK) {
                var size = font && font.size ? font.size : 12;
                return ok({ width: Math.ceil(r.value.width), height: Math.ceil(size * 1.35) });
            }
        }
        /* Headless fallback: monospace estimate */
        var size2 = font && font.size ? font.size : 12;
        return ok({ width: clean.length * Math.ceil(size2 * 0.6), height: Math.ceil(size2 * 1.35) });
    }

    /* =================================================================
     * 6. Images / clipping / save-restore
     * ============================================================== */

    /** DrawImage(dc, image, x, y, w?, h?) */
    function DrawImage(dc, image, x, y, w, h) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        if (!image) { return fail(S.EINVAL, { reason: 'image required' }); }
        try {
            if (typeof w === 'number' && typeof h === 'number') {
                dc.ctx.drawImage(image, px(dc, x), py(dc, y), w, h);
            } else {
                dc.ctx.drawImage(image, px(dc, x), py(dc, y));
            }
            return ok(true);
        } catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    /** ClipRect(dc, x, y, w, h) - pushes one saved state; RestoreDC pops it. */
    function ClipRect(dc, x, y, w, h) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        try {
            dc.ctx.save();
            dc.saved.push('clip');
            dc.ctx.beginPath();
            dc.ctx.rect(px(dc, x), py(dc, y), w, h);
            dc.ctx.clip();
            dc.clip = { x: x, y: y, w: w, h: h };
            return ok(true);
        } catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    /** SaveDC(dc) / RestoreDC(dc) - clip + transform stack. */
    function SaveDC(dc) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        try { dc.ctx.save(); dc.saved.push(true); return ok(true); }
        catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    function RestoreDC(dc) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        if (!dc.saved.length) { return fail(S.EBUSY, { reason: 'no saved DC state' }); }
        try { dc.ctx.restore(); dc.saved.pop(); return ok(true); }
        catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    /** GlobalAlpha(dc, alpha) */
    function GlobalAlpha(dc, alpha) {
        if (!dc || !dc.__isDC) { return fail(S.EINVAL, { reason: 'DC required' }); }
        if (typeof alpha !== 'number' || alpha < 0 || alpha > 1) {
            return fail(S.EINVAL, { reason: 'alpha must be 0..1' });
        }
        try { dc.ctx.globalAlpha = alpha; return ok(true); }
        catch (err) { return fail(S.EIO, { reason: err.message }); }
    }

    /* =================================================================
     * 7. Public handle
     * ============================================================== */

    var Gdi = {};
    Gdi.__isApiGdi = true;
    Gdi.version = '1.0.0';
    Gdi.STATUS = S;

    Gdi.asciiOnly = asciiOnly;
    Gdi.sanitizeScreenText = sanitizeScreenText;

    Gdi.CreatePen = CreatePen;
    Gdi.CreateSolidBrush = CreateSolidBrush;
    Gdi.CreateBrush = CreateBrush;
    Gdi.CreateFont = CreateFont;
    Gdi.CreateCompatibleDC = CreateCompatibleDC;
    Gdi.CreateBitmap = CreateBitmap;
    Gdi.SelectObject = SelectObject;
    Gdi.SetTextColor = SetTextColor;
    Gdi.SetBkColor = SetBkColor;
    Gdi.SetTextAlign = SetTextAlign;
    Gdi.SetOrigin = SetOrigin;

    Gdi.Clear = Clear;
    Gdi.FillRect = FillRect;
    Gdi.DrawRect = DrawRect;
    Gdi.DrawRoundRect = DrawRoundRect;
    Gdi.DrawLine = DrawLine;
    Gdi.DrawPixel = DrawPixel;
    Gdi.DrawEllipse = DrawEllipse;

    Gdi.DrawText = DrawText;
    Gdi.DrawTextTruncated = DrawTextTruncated;
    Gdi.MeasureText = MeasureText;

    Gdi.DrawImage = DrawImage;
    Gdi.ClipRect = ClipRect;
    Gdi.SaveDC = SaveDC;
    Gdi.RestoreDC = RestoreDC;
    Gdi.GlobalAlpha = GlobalAlpha;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Api) { G.EznK.Api = {}; }
    G.EznK.Api.Gdi = Gdi;
    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.api) { G.ezn32.api = {}; }
    G.ezn32.api.gdi = Gdi;
    if (!G.EZNT.api) { G.EZNT.api = {}; }
    G.EZNT.api.gdi = Gdi;

    LOG.info('js/api/gdi.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
