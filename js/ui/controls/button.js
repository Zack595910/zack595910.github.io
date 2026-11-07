/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/controls/button.js
 *   Module  : ezn32.ui.controls.Button
 *   Layer   : Ezn32 UI
 *
 * ---------------------------------------------------------------------
 * 职责
 * ============================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.controls && G.ezn32.ui.controls.Button) { return; }

    var CORE = (G.EznK.Platform.Core);
    var GDI = ezn32.api.gdi;
    var CTRL = ezn32.ui.Control;
    var RES = ezn32.ui.res;
    var S = CORE.STATUS;

    function Button(spec) {
        var s = spec || {};
        CTRL.call(this, {
            x: s.x, y: s.y,
            width: s.width || 90, height: s.height || RES.METRICS.buttonHeight,
            text: s.text || 'Button',
            font: s.font || 'ui',
            focusable: s.focusable !== false,
            id: s.id, tag: s.tag
        });
        this.kind = 'button';
        this.onClick = (typeof s.onClick === 'function') ? s.onClick : null;
        this.variant = s.variant || 'default';   /* default | primary | danger */
    }
    Button.prototype = Object.create(CTRL.prototype);
    Button.prototype.constructor = Button;

    Button.prototype.onPaint = function (dc) {
        var t = RES.theme().value;
        var bg, fg;
        if (!this.enabled) {
            bg = t.surfaceAlt; fg = t.textDisabled;
        } else if (this.variant === 'primary') {
            bg = this.pressed ? t.accentHover : t.accent; fg = t.accentText;
        } else if (this.variant === 'danger') {
            bg = this.pressed ? '#C0001A' : t.danger; fg = '#FFFFFF';
        } else {
            bg = this.pressed ? t.surfaceActive : (this.hover ? t.surfaceHover : t.surface);
            fg = t.text;
        }
        GDI.DrawRoundRect(dc, 0, 0, this.width, this.height, 3, t.border, bg);
        if (this.focused) {
            GDI.DrawRect(dc, 1, 1, this.width - 2, this.height - 2, t.accent, 1);
        }
        GDI.SelectObject(dc, RES.font('ui'));
        GDI.SetTextColor(dc, fg);
        GDI.SetTextAlign(dc, 'center');
        GDI.DrawText(dc, this.text, this.width / 2, Math.round((this.height - 12) / 2) - 1);
        GDI.SetTextAlign(dc, 'left');
    };

    Button.prototype.onControlMessage = function (msg) {
        if (msg.type === 'click' || (msg.type === 'mouseup' && this.hover && this.pressed)) {
            this.fire();
            return 'clicked';
        }
        if (msg.type === 'keydown' && msg.data && (msg.data.key === 'Enter' || msg.data.key === ' ')) {
            this.fire();
            return 'clicked';
        }
        return null;
    };

    Button.prototype.fire = function () {
        if (!this.enabled) { return; }
        var s = (G.EznK.Kernel && G.EznK.Kernel.SRM) || G.SRM;
        if (s) { s.emit('ui:button', { id: this.id, text: this.text }); }
        if (this.onClick) {
            try { this.onClick(this); } catch (err) {
                if (s) { s.emit('ui:error', { id: this.id, error: err && err.message }); }
            }
        }
    };

    Button.prototype.setVariant = function (v) { this.variant = v; this.invalidate(); return this; };

    G.ezn32.ui.controls = G.ezn32.ui.controls || {};
    G.ezn32.ui.controls.Button = Button;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    if (!G.EZNT.ui.controls) { G.EZNT.ui.controls = {}; }
    G.EZNT.ui.controls.Button = Button;
    CORE.createLogger('Ezn32/UI:button').info('controls/button.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
