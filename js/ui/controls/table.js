/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/controls/table.js
 *   Module  : ezn32.ui.controls.Table
 *   Layer   : Ezn32 UI
 *
 *   A scrollable multi-column table with a header row, row selection and
 *   per-column width / alignment. Used by the task manager, storage
 *   manager, device manager and the registry editor.
 *
 *   Model:
 *     columns: [{ id, text, width, align }]
 *     rows:    [[cell, cell, ...], ...]  or [{ id, cells:[...] }]
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.controls && G.ezn32.ui.controls.Table) { return; }

    var CORE = G.EznK.Platform.Core;
    var GDI = ezn32.api.gdi;
    var CTRL = ezn32.ui.Control;
    var RES = ezn32.ui.res;

    var HEADER_H = 26;
    var ROW_H = 22;

    function Table(spec) {
        var s = spec || {};
        CTRL.call(this, {
            x: s.x || 0, y: s.y || 0,
            width: s.width || 400, height: s.height || 200,
            focusable: true,
            id: s.id, tag: s.tag
        });
        this.kind = 'table';
        this.columns = Array.isArray(s.columns) ? s.columns.map(normalizeCol) : [];
        this.rows = [];
        this.selectedIndex = -1;
        this.scrollTop = 0;
        this.onSelect = typeof s.onSelect === 'function' ? s.onSelect : null;
        this.onActivate = typeof s.onActivate === 'function' ? s.onActivate : null;
        this.onContext = typeof s.onContext === 'function' ? s.onContext : null;
        if (s.rows) { this.setRows(s.rows); }
    }
    Table.prototype = Object.create(CTRL.prototype);
    Table.prototype.constructor = Table;

    function normalizeCol(c) {
        return {
            id: c.id || c.text,
            text: c.text || '',
            width: typeof c.width === 'number' ? c.width : 100,
            align: c.align || 'left'
        };
    }

    Table.prototype.setColumns = function (cols) {
        this.columns = (cols || []).map(normalizeCol);
        this.invalidate();
        return this;
    };

    Table.prototype.setRows = function (rows) {
        var self = this;
        this.rows = (rows || []).map(function (r, i) {
            if (Array.isArray(r)) { return { id: 'r' + i, cells: r }; }
            return { id: r.id !== undefined ? r.id : ('r' + i), cells: r.cells || [] };
        });
        if (this.selectedIndex >= this.rows.length) { this.selectedIndex = this.rows.length - 1; }
        void self;
        this.invalidate();
        return this;
    };

    Table.prototype.visibleRows = function () {
        return Math.max(1, Math.floor((this.height - HEADER_H) / ROW_H));
    };

    Table.prototype.colX = function (index) {
        var x = 0;
        for (var i = 0; i < index && i < this.columns.length; i++) { x += this.columns[i].width; }
        return x;
    };

    Table.prototype.onPaint = function (dc) {
        var t = RES.theme().value;
        GDI.FillRect(dc, 0, 0, this.width, this.height, t.inputBg);
        GDI.FillRect(dc, 0, 0, this.width, HEADER_H, t.surfaceAlt);
        GDI.DrawLine(dc, 0, HEADER_H - 1, this.width, HEADER_H - 1, t.border, 1);

        GDI.SelectObject(dc, RES.font('uiBold'));
        GDI.SetTextColor(dc, t.textSecondary);
        for (var c = 0; c < this.columns.length; c++) {
            var col = this.columns[c];
            var cx = this.colX(c);
            GDI.SetTextAlign(dc, col.align);
            var tx = col.align === 'right' ? cx + col.width - 6 : (col.align === 'center' ? cx + col.width / 2 : cx + 6);
            GDI.DrawTextTruncated(dc, col.text, tx, 6, col.width - 10);
            GDI.SetTextAlign(dc, 'left');
            if (c < this.columns.length - 1) {
                GDI.DrawLine(dc, cx + col.width - 1, 4, cx + col.width - 1, HEADER_H - 5, t.border, 1);
            }
        }

        GDI.SelectObject(dc, RES.font('ui'));
        var visible = this.visibleRows();
        for (var i = 0; i < visible; i++) {
            var idx = this.scrollTop + i;
            if (idx >= this.rows.length) { break; }
            var row = this.rows[idx];
            var y = HEADER_H + i * ROW_H;
            if (idx === this.selectedIndex) {
                GDI.FillRect(dc, 0, y, this.width, ROW_H, this.focused ? t.selectionBg : t.surfaceActive);
            }
            var fg = (idx === this.selectedIndex && this.focused) ? t.selectionText : t.text;
            GDI.SetTextColor(dc, fg);
            for (var c2 = 0; c2 < this.columns.length; c2++) {
                var col2 = this.columns[c2];
                var ccx = this.colX(c2);
                var val = row.cells[c2];
                var str = (val === null || val === undefined) ? '' : String(val);
                GDI.SetTextAlign(dc, col2.align);
                var x2 = col2.align === 'right' ? ccx + col2.width - 6 : (col2.align === 'center' ? ccx + col2.width / 2 : ccx + 6);
                GDI.DrawTextTruncated(dc, str, x2, y + 5, col2.width - 10);
                GDI.SetTextAlign(dc, 'left');
            }
        }

        if (this.rows.length === 0) {
            GDI.SetTextColor(dc, t.textDisabled);
            GDI.SetTextAlign(dc, 'center');
            GDI.DrawText(dc, '（无数据）', this.width / 2, HEADER_H + 20);
            GDI.SetTextAlign(dc, 'left');
        }

        GDI.DrawRect(dc, 0, 0, this.width, this.height, this.focused ? t.accent : t.border, 1);
    };

    Table.prototype.indexAt = function (ly) {
        if (ly < HEADER_H) { return -1; }
        var row = Math.floor((ly - HEADER_H) / ROW_H);
        var idx = this.scrollTop + row;
        return idx < this.rows.length ? idx : -1;
    };

    Table.prototype.select = function (index) {
        if (index < 0 || index >= this.rows.length) { return null; }
        this.selectedIndex = index;
        this.ensureVisible(index);
        this.invalidate();
        var row = this.rows[index];
        if (this.onSelect) { try { this.onSelect(row, index, this); } catch (_) { /* ignore */ } }
        return row;
    };

    Table.prototype.ensureVisible = function (index) {
        var visible = this.visibleRows();
        if (index < this.scrollTop) { this.scrollTop = index; }
        if (index >= this.scrollTop + visible) { this.scrollTop = index - visible + 1; }
        this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, this.rows.length - visible)));
    };

    Table.prototype.getSelected = function () {
        return (this.selectedIndex >= 0 && this.selectedIndex < this.rows.length)
            ? this.rows[this.selectedIndex] : null;
    };

    Table.prototype.onControlMessage = function (msg) {
        var d = msg.data || {};
        var ly = (typeof d.y === 'number') ? d.y : null;
        if (msg.type === 'mousedown' || msg.type === 'click') {
            if (ly === null) { return null; }
            var idx = this.indexAt(ly);
            if (idx >= 0) { this.focus(); this.select(idx); return 'selected'; }
            return null;
        }
        if (msg.type === 'contextmenu') {
            if (ly === null) { return null; }
            var cidx = this.indexAt(ly);
            if (cidx >= 0) { this.focus(); this.select(cidx); }
            if (typeof this.onContext === 'function') {
                try { this.onContext(this.getSelected(), cidx, this,
                    { x: d.screenX, y: d.screenY, localX: d.x, localY: d.y }); } catch (_) {}
            }
            return 'context';
        }
        if (msg.type === 'dblclick' && ly !== null) {
            var idx2 = this.indexAt(ly);
            if (idx2 >= 0 && this.onActivate) {
                try { this.onActivate(this.rows[idx2], idx2, this); } catch (_) { /* ignore */ }
                return 'activated';
            }
            return null;
        }
        if (msg.type === 'keydown') {
            var key = d.key;
            if (key === 'ArrowDown') { this.select(Math.min(this.rows.length - 1, this.selectedIndex + 1)); return 'down'; }
            if (key === 'ArrowUp') { this.select(Math.max(0, this.selectedIndex - 1)); return 'up'; }
        }
        if (msg.type === 'wheel') {
            var maxTop = Math.max(0, this.rows.length - this.visibleRows());
            this.scrollTop = Math.max(0, Math.min(maxTop, this.scrollTop + ((d.deltaY || 0) > 0 ? 1 : -1)));
            this.invalidate();
            return 'scrolled';
        }
        return null;
    };

    G.ezn32.ui.controls = G.ezn32.ui.controls || {};
    G.ezn32.ui.controls.Table = Table;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    if (!G.EZNT.ui.controls) { G.EZNT.ui.controls = {}; }
    G.EZNT.ui.controls.Table = Table;
    CORE.createLogger('Ezn32/UI:table').info('controls/table.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
