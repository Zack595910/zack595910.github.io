/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/controls/scrollbar.js
 *   Module  : ezn32.ui.controls.ScrollBar
 *   Layer   : Ezn32 UI
 *
 *   Vertical / horizontal scroll bar with a draggable thumb, arrow buttons
 *   and page clicks. Used by ListBox, TreeView, Table and the editor.
 *
 *   The scroll model is normalized: value in [0, 1] over the content
 *   extent, so the owner control owns its own units and the scroll bar
 *   stays dumb.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.controls && G.ezn32.ui.controls.ScrollBar) { return; }

    var CORE = G.EznK.Platform.Core;
    var GDI = ezn32.api.gdi;
    var CTRL = ezn32.ui.Control;
    var RES = ezn32.ui.res;
    var S = CORE.STATUS;

    function ScrollBar(spec) {
        var s = spec || {};
        var vertical = s.vertical !== false;
        CTRL.call(this, {
            x: s.x, y: s.y,
            width: vertical ? RES.METRICS.scrollbarWidth : (s.width || 120),
            height: vertical ? (s.height || 120) : RES.METRICS.scrollbarWidth,
            focusable: false,
            id: s.id, tag: s.tag
        });
        this.kind = 'scrollbar';
        this.vertical = vertical;
        this.value = typeof s.value === 'number' ? clamp01(s.value) : 0;   /* 0..1 */
        this.pageSize = typeof s.pageSize === 'number' ? clamp01(s.pageSize) : 0.2;
        this.onScroll = typeof s.onScroll === 'function' ? s.onScroll : null;
        this.dragging = false;
        this.dragOffset = 0;
    }
    ScrollBar.prototype = Object.create(CTRL.prototype);
    ScrollBar.prototype.constructor = ScrollBar;

    function clamp01(v) { return Math.max(0, Math.min(1, v)); }

    ScrollBar.prototype.trackLength = function () {
        return (this.vertical ? this.height : this.width) - 24;   /* two arrows */
    };

    ScrollBar.prototype.thumbLength = function () {
        var track = this.trackLength();
        return Math.max(16, Math.round(track * clamp01(this.pageSize)));
    };

    ScrollBar.prototype.thumbPos = function () {
        var track = this.trackLength();
        var th = this.thumbLength();
        return 12 + Math.round((track - th) * clamp01(this.value));
    };

    ScrollBar.prototype.onPaint = function (dc) {
        var t = RES.theme().value;
        GDI.FillRect(dc, 0, 0, this.width, this.height, t.scrollTrack);
        /* arrow buttons */
        GDI.SetTextColor(dc, t.textSecondary);
        GDI.SelectObject(dc, RES.font('small'));
        GDI.SetTextAlign(dc, 'center');
        if (this.vertical) {
            GDI.DrawText(dc, '^', this.width / 2, 0);
            GDI.DrawText(dc, 'v', this.width / 2, this.height - 12);
        } else {
            GDI.DrawText(dc, '<', 2, 0);
            GDI.DrawText(dc, '>', this.width - 10, 0);
        }
        GDI.SetTextAlign(dc, 'left');
        /* thumb */
        var p = this.thumbPos();
        var th = this.thumbLength();
        var thumbColor = this.dragging ? t.accent : (this.hover ? t.scrollThumb : t.border);
        if (this.vertical) {
            GDI.FillRect(dc, 2, p, this.width - 4, th, thumbColor);
        } else {
            GDI.FillRect(dc, p, 2, th, this.height - 4, thumbColor);
        }
    };

    ScrollBar.prototype.setValue = function (v) {
        var nv = clamp01(v);
        if (nv === this.value) { return nv; }
        this.value = nv;
        this.invalidate();
        if (this.onScroll) {
            try { this.onScroll(this.value, this); } catch (_) { /* ignore */ }
        }
        return this.value;
    };

    ScrollBar.prototype.setPageSize = function (p) {
        this.pageSize = clamp01(p);
        this.invalidate();
        return this;
    };

    ScrollBar.prototype.hitThumb = function (lpos) {
        var p = this.thumbPos();
        var th = this.thumbLength();
        return lpos >= p && lpos < p + th;
    };

    ScrollBar.prototype.onControlMessage = function (msg) {
        var d = msg.data || {};
        var local = this.vertical ? d.y : d.x;
        if (typeof local !== 'number') {
            local = this.vertical ? d.event && d.event.offsetY : d.event && d.event.offsetX;
        }
        if (typeof local !== 'number') { return null; }

        var total = this.vertical ? this.height : this.width;
        if (msg.type === 'mousedown') {
            if (local < 12) { this.setValue(this.value - this.pageSize); return 'pageUp'; }
            if (local >= total - 12) { this.setValue(this.value + this.pageSize); return 'pageDown'; }
            if (this.hitThumb(local)) {
                this.dragging = true;
                this.dragOffset = local - this.thumbPos();
                return 'thumbDown';
            }
            /* page click */
            var newVal = (local - 12) / Math.max(1, this.trackLength() - this.thumbLength());
            this.setValue(newVal);
            return 'pageJump';
        }
        if (msg.type === 'mousemove' && this.dragging) {
            var pos = local - this.dragOffset - 12;
            var track = Math.max(1, this.trackLength() - this.thumbLength());
            this.setValue(pos / track);
            return 'dragging';
        }
        if (msg.type === 'mouseup') {
            if (this.dragging) { this.dragging = false; this.invalidate(); return 'thumbUp'; }
            return null;
        }
        if (msg.type === 'wheel') {
            this.setValue(this.value + (d.deltaY > 0 ? this.pageSize : -this.pageSize));
            return 'wheel';
        }
        return null;
    };

    G.ezn32.ui.controls = G.ezn32.ui.controls || {};
    G.ezn32.ui.controls.ScrollBar = ScrollBar;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    if (!G.EZNT.ui.controls) { G.EZNT.ui.controls = {}; }
    G.EZNT.ui.controls.ScrollBar = ScrollBar;
    CORE.createLogger('Ezn32/UI:scrollbar').info('controls/scrollbar.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
