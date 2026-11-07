/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/controls/checkbox.js
 *   Module  : ezn32.ui.controls.CheckBox
 *   Layer   : Ezn32 UI
 *
 *   A check box control: a square indicator plus a label. Clicking either
 *   the box or the label toggles the state and fires onChange.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.controls && G.ezn32.ui.controls.CheckBox) { return; }

    var CORE = G.EznK.Platform.Core;
    var GDI = ezn32.api.gdi;
    var CTRL = ezn32.ui.Control;
    var RES = ezn32.ui.res;

    function CheckBox(spec) {
        var s = spec || {};
        CTRL.call(this, {
            x: s.x, y: s.y,
            width: s.width || 180, height: s.height || 20,
            text: (typeof s.text === 'string') ? s.text : '',
            font: s.font || 'ui',
            focusable: s.enabled !== false,
            id: s.id, tag: s.tag
        });
        this.kind = 'checkbox';
        this.checked = s.checked === true;
        this.onChange = (typeof s.onChange === 'function') ? s.onChange : null;
    }
    CheckBox.prototype = Object.create(CTRL.prototype);
    CheckBox.prototype.constructor = CheckBox;

    CheckBox.prototype.onPaint = function (dc) {
        var t = RES.theme().value;
        var sz = RES.METRICS.checkboxSize;
        var y = Math.round((this.height - sz) / 2);
        GDI.FillRect(dc, 0, y, sz, sz, this.enabled ? t.inputBg : t.surfaceAlt);
        GDI.DrawRect(dc, 0, y, sz, sz, this.enabled ? (this.hover ? t.accent : t.inputBorder) : t.border, 1);
        if (this.checked) {
            GDI.SetTextColor(dc, t.accent);
            GDI.SelectObject(dc, RES.font('uiBold'));
            GDI.SetTextAlign(dc, 'center');
            GDI.DrawText(dc, 'v', sz / 2, y - 1);
            GDI.SetTextAlign(dc, 'left');
        }
        GDI.SelectObject(dc, RES.font(this.font));
        GDI.SetTextColor(dc, this.enabled ? t.text : t.textDisabled);
        GDI.DrawTextTruncated(dc, this.text, sz + 6, Math.round((this.height - 12) / 2) - 1, this.width - sz - 8);
        if (this.focused) {
            GDI.DrawRect(dc, 0, 0, this.width, this.height, t.accent, 1);
        }
    };

    CheckBox.prototype.toggle = function () {
        if (!this.enabled) { return this.checked; }
        this.checked = !this.checked;
        this.invalidate();
        if (this.onChange) {
            try { this.onChange(this.checked, this); } catch (_) { /* ignore */ }
        }
        var s = (G.EznK.Kernel && G.EznK.Kernel.SRM) || G.SRM;
        if (s) { s.emit('ui:change', { id: this.id, kind: 'checkbox', checked: this.checked }); }
        return this.checked;
    };

    CheckBox.prototype.setChecked = function (v) {
        this.checked = v === true;
        this.invalidate();
        return this;
    };

    CheckBox.prototype.onControlMessage = function (msg) {
        if (msg.type === 'click') { this.toggle(); return 'toggled'; }
        if (msg.type === 'keydown' && msg.data && (msg.data.key === ' ' || msg.data.key === 'Enter')) {
            this.toggle();
            return 'toggled';
        }
        return null;
    };

    G.ezn32.ui.controls = G.ezn32.ui.controls || {};
    G.ezn32.ui.controls.CheckBox = CheckBox;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    if (!G.EZNT.ui.controls) { G.EZNT.ui.controls = {}; }
    G.EZNT.ui.controls.CheckBox = CheckBox;
    CORE.createLogger('Ezn32/UI:checkbox').info('controls/checkbox.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
