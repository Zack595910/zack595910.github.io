/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/controls/label.js
 *   Module  : ezn32.ui.controls.Label
 *   Layer   : Ezn32 UI
 *
 *   A static / dynamic text label. Text is ASCII-enforced by the GDI
 *   text primitives: non-ASCII never reaches the screen (rule #10).
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.controls && G.ezn32.ui.controls.Label) { return; }

    var CORE = (G.EznK.Platform.Core);
    var GDI = ezn32.api.gdi;
    var CTRL = ezn32.ui.Control;
    var RES = ezn32.ui.res;

    function Label(spec) {
        var s = spec || {};
        CTRL.call(this, {
            x: s.x, y: s.y,
            width: s.width || 160, height: s.height || RES.METRICS.labelHeight,
            text: s.text || '',
            font: s.font || 'ui',
            align: s.align || 'left',
            id: s.id, tag: s.tag
        });
        this.kind = 'label';
        this.colorKey = s.color || 'text';
        this.enabled = true;   /* labels are never disabled in practice */
        this.focusable = false;
    }
    Label.prototype = Object.create(CTRL.prototype);
    Label.prototype.constructor = Label;

    Label.prototype.onPaint = function (dc) {
        var t = RES.theme().value;
        GDI.SelectObject(dc, RES.font(this.font || 'ui'));
        GDI.SetTextColor(dc, t[this.colorKey] || t.text);
        GDI.SetTextAlign(dc, this.align);
        var x = this.align === 'center' ? Math.round(this.width / 2)
            : (this.align === 'right' ? this.width - 2 : 0);
        if (this.align === 'left') {
            GDI.DrawTextTruncated(dc, this.text, 0, 2, this.width - 2);
        } else {
            GDI.DrawTextTruncated(dc, this.text, x, 2, this.width - 2);
        }
        GDI.SetTextAlign(dc, 'left');
    };

    Label.prototype.onControlMessage = function (msg) {
        if (msg.type === 'click' && this.onClick) {
            try { this.onClick(this); } catch (_) { /* ignore */ }
            return 'clicked';
        }
        return null;
    };

    Label.prototype.setColor = function (key) { this.colorKey = key; this.invalidate(); return this; };
    Label.prototype.setAlign = function (a) { this.align = a; this.invalidate(); return this; };

    G.ezn32.ui.controls = G.ezn32.ui.controls || {};
    G.ezn32.ui.controls.Label = Label;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    if (!G.EZNT.ui.controls) { G.EZNT.ui.controls = {}; }
    G.EZNT.ui.controls.Label = Label;
    CORE.createLogger('Ezn32/UI:label').info('controls/label.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
