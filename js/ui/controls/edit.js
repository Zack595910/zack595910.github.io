/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/controls/edit.js
 *   Module  : ezn32.ui.controls.Edit
 *   Layer   : Ezn32 UI
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   A text editor control: single-line and multi-line. This is the control
 *   the .exc `<edit>`, the file editor, the code editor and the KD console
 *   all use.
 *
 *   Supported:
 *     - typing, backspace, delete, arrow keys, home/end
 *     - Ctrl+A / Ctrl+C / Ctrl+V (through the kernel clipboard)
 *     - selection by drag; caret rendering
 *     - single-line scroll (horizontal) and multi-line scroll (vertical)
 *     - placeholder text (ASCII)
 *     - read-only mode
 *
 *   Text is ALWAYS ASCII on screen (rule #10): input events are filtered
 *   and the value is stripped. The raw user string is kept only when
 *   `allowUnicode` is explicitly set for user file content.
 *
 *   The value is the single source of truth; the caret is derived.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.controls && G.ezn32.ui.controls.Edit) { return; }

    var CORE = (G.EznK.Platform.Core);
    var GDI = ezn32.api.gdi;
    var CTRL = ezn32.ui.Control;
    var RES = ezn32.ui.res;
    var S = CORE.STATUS;

    /* Kernel clipboard (one place, shared by every control). */
    var clipboard = '';
    if (!G.ezn32.ui.__clipboard) {
        G.ezn32.ui.__clipboard = {
            get: function () { return clipboard; },
            set: function (v) { clipboard = String(v); return true; }
        };
    }

    function Edit(spec) {
        var s = spec || {};
        CTRL.call(this, {
            x: s.x, y: s.y,
            width: s.width || 200,
            height: s.height || RES.METRICS.editHeight,
            text: (typeof s.text === 'string') ? s.text : '',
            font: s.font || 'ui',
            focusable: s.readOnly !== true,
            id: s.id, tag: s.tag
        });
        this.kind = 'edit';
        this.value = (typeof (s.value !== undefined ? s.value : s.text) === 'string')
            ? String(s.value !== undefined ? s.value : s.text) : '';
        this.multiline = s.multiline === true;
        this.readOnly = s.readOnly === true;
        this.placeholder = typeof s.placeholder === 'string' ? s.placeholder : '';
        this.allowUnicode = s.allowUnicode === true;
        this.caret = this.value.length;
        this.selStart = this.caret;
        this.selEnd = this.caret;
        this.scrollTop = 0;
        this.scrollLeft = 0;
        this.lineHeight = 16;
        this.caretVisible = true;
        this._caretTimer = null;
        this.onChange = typeof s.onChange === 'function' ? s.onChange : null;
        this.onEnter = typeof s.onEnter === 'function' ? s.onEnter : null;
    }
    Edit.prototype = Object.create(CTRL.prototype);
    Edit.prototype.constructor = Edit;

    /* ---------------- text helpers ---------------- */

    Edit.prototype.sanitize = function (str) {
        if (this.allowUnicode) { return String(str); }
        return String(str).replace(/[^\x20-\x7E\n\t]/g, '');
    };

    Edit.prototype.lines = function () {
        return this.value.split('\n');
    };

    Edit.prototype.syncCaret = function () {
        this.caret = Math.max(0, Math.min(this.caret, this.value.length));
        this.clampScroll();
    };

    Edit.prototype.clampScroll = function () {
        var lines = this.lines();
        var visible = Math.floor((this.height - 4) / this.lineHeight);
        var maxTop = Math.max(0, lines.length - visible);
        this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxTop));
        var row = this.value.slice(0, this.caret).split('\n').length - 1;
        if (row < this.scrollTop) { this.scrollTop = row; }
        if (row >= this.scrollTop + visible) { this.scrollTop = row - visible + 1; }
    };

    Edit.prototype.posToOffset = function (row, col) {
        var lines = this.lines();
        var r = Math.max(0, Math.min(row, lines.length - 1));
        var c = Math.max(0, Math.min(col, lines[r].length));
        var off = 0;
        for (var i = 0; i < r; i++) { off += lines[i].length + 1; }
        return off + c;
    };

    Edit.prototype.offsetToPos = function (off) {
        var before = this.value.slice(0, off);
        var lines = before.split('\n');
        return { row: lines.length - 1, col: lines[lines.length - 1].length };
    };

    /* ---------------- painting ---------------- */

    Edit.prototype.onPaint = function (dc) {
        var t = RES.theme().value;
        var font = RES.font(this.font);
        GDI.SelectObject(dc, font);
        GDI.FillRect(dc, 0, 0, this.width, this.height, this.readOnly ? t.surfaceAlt : t.inputBg);
        var border = this.focused ? t.accent : t.inputBorder;
        GDI.DrawRect(dc, 0, 0, this.width, this.height, border, 1);

        /* selection highlight */
        if (this.selStart !== this.selEnd) {
            this.paintSelection(dc);
        }

        var lines = this.lines();
        var visible = Math.floor((this.height - 4) / this.lineHeight);
        GDI.SetTextColor(dc, t.text);
        for (var i = 0; i < visible; i++) {
            var idx = this.scrollTop + i;
            if (idx >= lines.length) { break; }
            var line = lines[idx];
            var y = 2 + i * this.lineHeight;
            var x = 4 - (this.multiline ? 0 : this.scrollLeft);
            GDI.DrawTextTruncated(dc, line, x, y + 1, this.width - 8);
        }

        /* placeholder */
        if (!this.value && this.placeholder && !this.focused) {
            GDI.SetTextColor(dc, t.textDisabled);
            GDI.DrawTextTruncated(dc, this.placeholder, 4, 3, this.width - 8);
        }

        /* caret */
        if (this.focused && this.caretVisible) {
            var pos = this.offsetToPos(this.caret);
            var caretY = 2 + (pos.row - this.scrollTop) * this.lineHeight;
            var textW = this.measureLine(lines[pos.row] || '');
            var caretX = 4 + textW;
            GDI.FillRect(dc, caretX, caretY + 1, 1, this.lineHeight - 2, t.text);
        }
    };

    Edit.prototype.measureLine = function (line) {
        var m = GDI.MeasureText(line, RES.font(this.font));
        return m.status === S.OK ? m.value.width : line.length * 7;
    };

    Edit.prototype.paintSelection = function (dc) {
        var t = RES.theme().value;
        var from = Math.min(this.selStart, this.selEnd);
        var to = Math.max(this.selStart, this.selEnd);
        var start = this.offsetToPos(from);
        var end = this.offsetToPos(to);
        var lines = this.lines();
        for (var row = start.row; row <= end.row; row++) {
            if (row < this.scrollTop) { continue; }
            var visRow = row - this.scrollTop;
            if (visRow * this.lineHeight + this.lineHeight > this.height) { break; }
            var line = lines[row] || '';
            var c0 = (row === start.row) ? start.col : 0;
            var c1 = (row === end.row) ? end.col : line.length;
            if (c0 === c1 && start.row !== end.row) {
                /* empty line inside a selection: show a thin band */
                if (row === start.row || row === end.row) { continue; }
            }
            var x0 = 4 + this.measureLine(line.slice(0, c0));
            var x1 = 4 + this.measureLine(line.slice(0, c1));
            GDI.FillRect(dc, x0, 2 + visRow * this.lineHeight, Math.max(1, x1 - x0), this.lineHeight, t.selectionBg);
        }
    };

    /* ---------------- editing operations ---------------- */

    Edit.prototype.getSelected = function () {
        var from = Math.min(this.selStart, this.selEnd);
        var to = Math.max(this.selStart, this.selEnd);
        return this.value.slice(from, to);
    };

    Edit.prototype.deleteSelection = function () {
        if (this.readOnly) { return false; }
        if (this.selStart === this.selEnd) { return false; }
        var from = Math.min(this.selStart, this.selEnd);
        var to = Math.max(this.selStart, this.selEnd);
        this.value = this.value.slice(0, from) + this.value.slice(to);
        this.caret = from;
        this.selStart = this.selEnd = from;
        return true;
    };

    Edit.prototype.insert = function (str) {
        if (this.readOnly) { return false; }
        var clean = this.sanitize(str);
        if (!this.multiline) { clean = clean.replace(/\n/g, ''); }
        this.deleteSelection();
        this.value = this.value.slice(0, this.caret) + clean + this.value.slice(this.caret);
        this.caret += clean.length;
        this.selStart = this.selEnd = this.caret;
        this.syncCaret();
        this.fireChange();
        return true;
    };

    Edit.prototype.fireChange = function () {
        this.invalidate();
        if (this.onChange) {
            try { this.onChange(this.value, this); } catch (_) { /* ignore */ }
        }
        var s = (G.EznK.Kernel && G.EznK.Kernel.SRM) || G.SRM;
        if (s) { s.emit('ui:change', { id: this.id, kind: 'edit' }); }
    };

    Edit.prototype.setValue = function (v) {
        this.value = this.sanitize(v === null || v === undefined ? '' : String(v));
        this.caret = this.value.length;
        this.selStart = this.selEnd = this.caret;
        this.syncCaret();
        this.invalidate();
        return this.value;
    };

    Edit.prototype.getValue = function () { return this.value; };

    Edit.prototype.selectAll = function () {
        this.selStart = 0;
        this.selEnd = this.value.length;
        this.caret = this.value.length;
        this.invalidate();
        return true;
    };

    /* ---------------- keyboard ---------------- */

    Edit.prototype.onControlMessage = function (msg) {
        var self = this;
        if (msg.type === 'focus') {
            this.focused = true;
            this.startCaret();
            this.invalidate();
            return 'focus';
        }
        if (msg.type === 'blur') {
            this.stopCaret();
            this.invalidate();
            return 'blur';
        }
        if (msg.type === 'keydown') {
            var d = msg.data || {};
            return this.handleKey(d);
        }
        if (msg.type === 'char') {
            var d2 = msg.data || {};
            if (typeof d2.text === 'string' && d2.text.length > 0) {
                this.insert(d2.text);
                return 'inserted';
            }
        }
        if (msg.type === 'click' || msg.type === 'mousedown') {
            var x = (msg.data && typeof msg.data.x === 'number') ? msg.data.x : -this.x;
            var y = (msg.data && typeof msg.data.y === 'number') ? msg.data.y : -this.y;
            var row = this.multiline ? Math.floor((y - 2) / this.lineHeight) + this.scrollTop : 0;
            var line = (this.lines()[row] || '');
            var col = this.columnAt(line, x - 4 + this.scrollLeft);
            var off = this.multiline ? this.posToOffset(row, col) : Math.min(col, this.value.length);
            this.caret = this.selStart = this.selEnd = off;
            this.syncCaret();
            this.focus();
            this.invalidate();
            return 'caret';
        }
        void self;
        return null;
    };

    Edit.prototype.columnAt = function (line, px) {
        var best = 0;
        var bestW = 1e9;
        for (var i = 0; i <= line.length; i++) {
            var w = this.measureLine(line.slice(0, i));
            var diff = Math.abs(w - px);
            if (diff < bestW) { bestW = diff; best = i; }
        }
        return best;
    };

    Edit.prototype.handleKey = function (d) {
        var key = d.key;
        var ctrl = d.ctrlKey === true;
        var shift = d.shiftKey === true;

        if (ctrl && (key === 'a' || key === 'A')) { this.selectAll(); return 'selectAll'; }
        if (ctrl && (key === 'c' || key === 'C')) {
            G.ezn32.ui.__clipboard.set(this.getSelected() || this.value);
            return 'copy';
        }
        if (ctrl && (key === 'x' || key === 'X')) {
            G.ezn32.ui.__clipboard.set(this.getSelected());
            this.deleteSelection();
            this.fireChange();
            return 'cut';
        }
        if (ctrl && (key === 'v' || key === 'V')) {
            this.insert(G.ezn32.ui.__clipboard.get());
            return 'paste';
        }

        if (key === 'Backspace') {
            if (this.readOnly) { return null; }
            if (this.selStart !== this.selEnd) { this.deleteSelection(); }
            else if (this.caret > 0) {
                this.value = this.value.slice(0, this.caret - 1) + this.value.slice(this.caret);
                this.caret -= 1;
                this.selStart = this.selEnd = this.caret;
            }
            this.syncCaret();
            this.fireChange();
            return 'backspace';
        }
        if (key === 'Delete') {
            if (this.readOnly) { return null; }
            if (this.selStart !== this.selEnd) { this.deleteSelection(); }
            else if (this.caret < this.value.length) {
                this.value = this.value.slice(0, this.caret) + this.value.slice(this.caret + 1);
            }
            this.syncCaret();
            this.fireChange();
            return 'delete';
        }
        if (key === 'ArrowLeft') {
            this.caret = shift ? this.caret - 1 : Math.min(this.selStart, this.selEnd) - 0;
            this.caret = Math.max(0, this.caret);
            if (shift) { this.selEnd = this.caret; } else { this.selStart = this.selEnd = this.caret; }
            this.syncCaret();
            this.invalidate();
            return 'left';
        }
        if (key === 'ArrowRight') {
            this.caret = Math.min(this.value.length, this.caret + 1);
            if (shift) { this.selEnd = this.caret; } else { this.selStart = this.selEnd = this.caret; }
            this.syncCaret();
            this.invalidate();
            return 'right';
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
            if (!this.multiline) { return null; }
            var pos = this.offsetToPos(this.caret);
            var row = pos.row + (key === 'ArrowUp' ? -1 : 1);
            var lines = this.lines();
            if (row >= 0 && row < lines.length) {
                this.caret = this.posToOffset(row, pos.col);
                this.selStart = this.selEnd = this.caret;
                this.syncCaret();
                this.invalidate();
            }
            return 'vertical';
        }
        if (key === 'Home') {
            var p0 = this.offsetToPos(this.caret);
            this.caret = this.posToOffset(p0.row, 0);
            this.selStart = this.selEnd = this.caret;
            this.syncCaret();
            this.invalidate();
            return 'home';
        }
        if (key === 'End') {
            var p1 = this.offsetToPos(this.caret);
            this.caret = this.posToOffset(p1.row, this.lines()[p1.row].length);
            this.selStart = this.selEnd = this.caret;
            this.syncCaret();
            this.invalidate();
            return 'end';
        }
        if (key === 'Enter') {
            if (this.multiline) {
                this.insert('\n');
                return 'newline';
            }
            if (this.onEnter) {
                try { this.onEnter(this.value, this); } catch (_) { /* ignore */ }
            }
            return 'enter';
        }
        if (key === 'Tab') { return 'tab'; }
        return null;
    };

    /* ---------------- caret blink ---------------- */

    Edit.prototype.startCaret = function () {
        var self = this;
        this.stopCaret();
        this.caretVisible = true;
        var TIME = G.EznK.Platform.Time;
        if (TIME) {
            this._caretTimer = TIME.every(530, function () {
                self.caretVisible = !self.caretVisible;
                self.invalidate();
            });
        }
    };

    Edit.prototype.stopCaret = function () {
        var TIME = G.EznK.Platform.Time;
        if (this._caretTimer && TIME) {
            var r = this._caretTimer;
            if (r && r.status === S.OK) { TIME.cancel(r.value); }
        }
        this._caretTimer = null;
        this.caretVisible = false;
    };

    Edit.prototype.onDispose = function () {
        this.stopCaret();
    };

    G.ezn32.ui.controls = G.ezn32.ui.controls || {};
    G.ezn32.ui.controls.Edit = Edit;
    G.ezn32.ui.controls.CLIPBOARD = G.ezn32.ui.__clipboard;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    if (!G.EZNT.ui.controls) { G.EZNT.ui.controls = {}; }
    G.EZNT.ui.controls.Edit = Edit;
    CORE.createLogger('Ezn32/UI:edit').info('controls/edit.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
