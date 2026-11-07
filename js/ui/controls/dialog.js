/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/controls/dialog.js
 *   Module  : ezn32.ui.controls.Dialog
 *   Layer   : Ezn32 UI
 *
 *   A modal / non-modal message box. Dialogs are drawn as a centred frame
 *   inside the owning window's surface, so there is no separate DOM layer:
 *   one renderer, one message loop.
 *
 *   Types: info / warning / error / question / prompt
 *   Buttons: OK / OK-Cancel / Yes-No / Yes-No-Cancel
 *
 *   show(win, spec) -> Promise<{ status, value: { button, input } }>
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.controls && G.ezn32.ui.controls.Dialog) { return; }

    var CORE = G.EznK.Platform.Core;
    var GDI = ezn32.api.gdi;
    var CTRL = ezn32.ui.Control;
    var RES = ezn32.ui.res;
    var S = CORE.STATUS;

    var DIALOG_W = 380;
    var DIALOG_H = 160;

    /**
     * A Dialog is a control that renders itself centred in its parent and
     * captures clicks. It is added to the window client and removed when
     * it closes - never registered as a separate window.
     */
    function Dialog(spec) {
        var s = spec || {};
        CTRL.call(this, { x: 0, y: 0, width: DIALOG_W, height: DIALOG_H, focusable: true, id: s.id });
        this.kind = 'dialog';
        this.title = s.title || 'Message';
        this.message = s.message || '';
        this.type = s.type || 'info';
        this.buttons = Array.isArray(s.buttons) ? s.buttons.slice(0) : ['OK'];
        this.prompt = typeof s.prompt === 'string' ? s.prompt : null;
        this.defaultText = typeof s.defaultText === 'string' ? s.defaultText : '';
        this.inputValue = this.defaultText;
        this.result = null;
        this._resolve = null;
        this._promise = null;
        this.buttonRects = [];
    }
    Dialog.prototype = Object.create(CTRL.prototype);
    Dialog.prototype.constructor = Dialog;

    /** Centre the dialog inside the given parent size. */
    Dialog.prototype.centerIn = function (parentW, parentH) {
        this.width = Math.min(DIALOG_W, Math.max(260, parentW - 40));
        this.height = this.prompt !== null ? DIALOG_H + 30 : DIALOG_H;
        this.x = Math.round((parentW - this.width) / 2);
        this.y = Math.round((parentH - this.height) / 2);
        this.layoutButtons();
        return this;
    };

    Dialog.prototype.layoutButtons = function () {
        var bw = 84, bh = 28, gap = 8;
        var total = this.buttons.length * bw + (this.buttons.length - 1) * gap;
        var x = this.width - total - 14;
        var y = this.height - bh - 12;
        this.buttonRects = this.buttons.map(function (label, i) {
            return { label: label, x: x + i * (bw + gap), y: y, w: bw, h: bh };
        });
        return this.buttonRects;
    };

    Dialog.prototype.iconFor = function () {
        if (this.type === 'error') { return 'x'; }
        if (this.type === 'warning') { return '!'; }
        if (this.type === 'question') { return '?'; }
        return 'i';
    };

    Dialog.prototype.colorFor = function (t) {
        if (this.type === 'error') { return t.danger; }
        if (this.type === 'warning') { return t.warning; }
        if (this.type === 'question') { return t.accent; }
        return t.accent;
    };

    Dialog.prototype.onPaint = function (dc) {
        var t = RES.theme().value;
        /* frame */
        GDI.FillRect(dc, 0, 0, this.width, this.height, t.surface);
        GDI.DrawRect(dc, 0, 0, this.width, this.height, t.accent, 1);

        /* title */
        GDI.FillRect(dc, 1, 1, this.width - 2, 26, t.surfaceAlt);
        GDI.SelectObject(dc, RES.font('title'));
        GDI.SetTextColor(dc, t.text);
        GDI.DrawTextTruncated(dc, this.title, 10, 6, this.width - 40);

        /* icon + message */
        GDI.SelectObject(dc, RES.font('uiBold'));
        GDI.SetTextColor(dc, this.colorFor(t));
        GDI.DrawText(dc, this.iconFor(), 14, 40);

        GDI.SelectObject(dc, RES.font('ui'));
        GDI.SetTextColor(dc, t.text);
        var lines = String(this.message).split('\n');
        for (var i = 0; i < Math.min(lines.length, 4); i++) {
            GDI.DrawTextTruncated(dc, lines[i], 34, 42 + i * 16, this.width - 50);
        }

        /* prompt field */
        if (this.prompt !== null) {
            var py = 42 + Math.min(lines.length, 4) * 16 + 6;
            GDI.SetTextColor(dc, t.textSecondary);
            GDI.DrawTextTruncated(dc, this.prompt, 14, py - 16, this.width - 30);
            GDI.FillRect(dc, 14, py, this.width - 28, 24, t.inputBg);
            GDI.DrawRect(dc, 14, py, this.width - 28, 24, t.accent, 1);
            GDI.SetTextColor(dc, t.text);
            GDI.DrawTextTruncated(dc, this.inputValue, 18, py + 5, this.width - 40);
        }

        /* buttons */
        for (var b = 0; b < this.buttonRects.length; b++) {
            var br = this.buttonRects[b];
            var primary = (br.label === 'OK' || br.label === 'Yes' || b === 0);
            var bg = primary ? t.accent : t.surface;
            var fg = primary ? t.accentText : t.text;
            GDI.DrawRoundRect(dc, br.x, br.y, br.w, br.h, 3, t.border, bg);
            GDI.SetTextColor(dc, fg);
            GDI.SetTextAlign(dc, 'center');
            GDI.DrawText(dc, br.label, br.x + br.w / 2, br.y + 8);
            GDI.SetTextAlign(dc, 'left');
        }
    };

    Dialog.prototype.buttonAt = function (x, y) {
        for (var i = 0; i < this.buttonRects.length; i++) {
            var b = this.buttonRects[i];
            if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) { return i; }
        }
        return -1;
    };

    Dialog.prototype.onControlMessage = function (msg) {
        var d = msg.data || {};
        if (msg.type === 'click' || msg.type === 'mousedown') {
            if (typeof d.x !== 'number') { return null; }
            var idx = this.buttonAt(d.x, d.y);
            if (idx >= 0) { this.close(this.buttonRects[idx].label); return 'closed'; }
            return null;
        }
        if (msg.type === 'keydown') {
            if (d.key === 'Escape' && this.buttons.indexOf('Cancel') !== -1) { this.close('Cancel'); return 'closed'; }
            if (d.key === 'Enter') { this.close(this.buttons[0]); return 'closed'; }
        }
        return null;
    };

    Dialog.prototype.close = function (button) {
        if (this.result !== null) { return; }
        this.result = { button: button, input: this.inputValue };
        var r = this._resolve;
        this._resolve = null;
        this.dispose();
        if (r) { r({ status: S.OK, value: this.result }); }
    };

    /* =================================================================
     * Static API
     * ============================================================== */

    /** isOpen(win) - a window owns at most one dialog at a time. */
    function isOpen(win) {
        return !!(win && win._dialog);
    }

    /**
     * show(win, spec) -> Promise<{ status, value: { button, input } }>
     *   Adds a modal dialog to the window's client area.
     */
    function show(win, spec) {
        if (!win || !win.client) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'window required' }));
        }
        if (win._dialog) {
            return Promise.resolve(CORE.fail(S.EBUSY, { reason: 'a dialog is already open' }));
        }
        var dlg = new Dialog(spec);
        dlg._promise = new Promise(function (resolve) { dlg._resolve = resolve; });
        dlg.centerIn(win.client.width, win.client.height);
        win.client.addChild(dlg);
        dlg.owner = win.surface;
        win._dialog = dlg;
        win.surface.invalidate();
        return dlg._promise.then(function (r) {
            win._dialog = null;
            win.surface.invalidate();
            return r;
        });
    }

    /** Convenience: alert / confirm / prompt. */
    function alert(win, message, title, type) {
        return show(win, { title: title || 'Message', message: message, type: type || 'info', buttons: ['OK'] });
    }

    function confirm(win, message, title) {
        return show(win, { title: title || 'Confirm', message: message, type: 'question', buttons: ['Yes', 'No'] })
            .then(function (r) {
                return CORE.ok(r.status === S.OK && r.value && r.value.button === 'Yes');
            });
    }

    function prompt(win, message, defaultValue, title) {
        return show(win, {
            title: title || 'Input',
            message: message,
            type: 'question',
            prompt: 'Enter a value:',
            defaultText: defaultValue || '',
            buttons: ['OK', 'Cancel']
        }).then(function (r) {
            if (r.status !== S.OK || !r.value || r.value.button !== 'OK') {
                return CORE.fail(S.EBUSY, { reason: 'cancelled' });
            }
            return CORE.ok(r.value.input);
        });
    }

    Dialog.show = show;
    Dialog.isOpen = isOpen;
    Dialog.alert = alert;
    Dialog.confirm = confirm;
    Dialog.prompt = prompt;
    Dialog.DIALOG_W = DIALOG_W;
    Dialog.DIALOG_H = DIALOG_H;

    G.ezn32.ui.controls = G.ezn32.ui.controls || {};
    G.ezn32.ui.controls.Dialog = Dialog;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    if (!G.EZNT.ui.controls) { G.EZNT.ui.controls = {}; }
    G.EZNT.ui.controls.Dialog = Dialog;
    CORE.createLogger('Ezn32/UI:dialog').info('controls/dialog.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
