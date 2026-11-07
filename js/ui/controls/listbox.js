/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/controls/listbox.js
 *   Module  : ezn32.ui.controls.ListBox
 *   Layer   : Ezn32 UI
 *
 *   A scrollable single-select list. Items are plain objects
 *   { id, text, icon? }. The selected index is the single source of truth;
 *   the item array is owned by the control.
 *
 *   Used by the file manager, the registry editor, the KD store and the
 *   MMC tree panes.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.controls && G.ezn32.ui.controls.ListBox) { return; }

    var CORE = G.EznK.Platform.Core;
    var GDI = ezn32.api.gdi;
    var CTRL = ezn32.ui.Control;
    var RES = ezn32.ui.res;
    var S = CORE.STATUS;

    var ROW_HEIGHT = 22;
    var PAD = 4;

    function ListBox(spec) {
        var s = spec || {};
        CTRL.call(this, {
            x: s.x, y: s.y,
            width: s.width || 220, height: s.height || 180,
            focusable: true,
            id: s.id, tag: s.tag
        });
        this.kind = 'listbox';
        this.items = Array.isArray(s.items) ? s.items.slice(0) : [];
        this.selectedIndex = -1;
        this.scrollTop = 0;
        this.onSelect = typeof s.onSelect === 'function' ? s.onSelect : null;
        this.onActivate = typeof s.onActivate === 'function' ? s.onActivate : null;
        /* 右键回调：ListBox 必须接收它，否则 onContext 永远是 undefined */
        this.onContext = typeof s.onContext === 'function' ? s.onContext : null;
        this.showIcons = s.showIcons !== false;
    }
    ListBox.prototype = Object.create(CTRL.prototype);
    ListBox.prototype.constructor = ListBox;

    ListBox.prototype.visibleRows = function () {
        return Math.max(1, Math.floor((this.height - PAD * 2) / ROW_HEIGHT));
    };

    ListBox.prototype.setItems = function (items) {
        this.items = Array.isArray(items) ? items.slice(0) : [];
        if (this.selectedIndex >= this.items.length) { this.selectedIndex = this.items.length - 1; }
        this.scrollTop = 0;
        this.invalidate();
        return this;
    };

    ListBox.prototype.getSelected = function () {
        return (this.selectedIndex >= 0 && this.selectedIndex < this.items.length)
            ? this.items[this.selectedIndex] : null;
    };

    ListBox.prototype.select = function (index) {
        if (index < 0 || index >= this.items.length) { return null; }
        if (index === this.selectedIndex) { return this.getSelected(); }
        this.selectedIndex = index;
        this.ensureVisible(index);
        this.invalidate();
        var item = this.getSelected();
        if (this.onSelect) {
            try { this.onSelect(item, index, this); } catch (_) { /* ignore */ }
        }
        var s = (G.EznK.Kernel && G.EznK.Kernel.SRM) || G.SRM;
        if (s) { s.emit('ui:select', { id: this.id, index: index }); }
        return item;
    };

    ListBox.prototype.ensureVisible = function (index) {
        var visible = this.visibleRows();
        if (index < this.scrollTop) { this.scrollTop = index; }
        if (index >= this.scrollTop + visible) { this.scrollTop = index - visible + 1; }
        this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, this.items.length - visible)));
    };

    ListBox.prototype.onPaint = function (dc) {
        var t = RES.theme().value;
        GDI.FillRect(dc, 0, 0, this.width, this.height, t.inputBg);
        GDI.DrawRect(dc, 0, 0, this.width, this.height, this.focused ? t.accent : t.inputBorder, 1);

        GDI.SelectObject(dc, RES.font('ui'));
        var visible = this.visibleRows();
        var hasScroll = this.items.length > visible;
        var textW = this.width - PAD * 2 - (hasScroll ? RES.METRICS.scrollbarWidth : 0);

        for (var i = 0; i < visible; i++) {
            var idx = this.scrollTop + i;
            if (idx >= this.items.length) { break; }
            var item = this.items[idx];
            var y = PAD + i * ROW_HEIGHT;
            var selected = idx === this.selectedIndex;

            if (selected) {
                GDI.FillRect(dc, 1, y, this.width - 2, ROW_HEIGHT, this.focused ? t.selectionBg : t.surfaceActive);
            }
            var fg = selected && this.focused ? t.selectionText : (/^\[.*\]$/.test(t.text || '') ? t.text : t.text);
            if (item.disabled) { fg = t.textDisabled; }
            GDI.SetTextColor(dc, fg);

            var x = PAD;
            if (this.showIcons && item.icon) {
                GDI.DrawText(dc, item.icon, x, y + 4);
                x += 26;
            }
            GDI.DrawTextTruncated(dc, item.text || '', x, y + 4, textW - (x - PAD));
        }

        if (this.items.length === 0) {
            GDI.SetTextColor(dc, t.textDisabled);
            GDI.SetTextAlign(dc, 'center');
            GDI.DrawText(dc, '（空）', this.width / 2, this.height / 2 - 6);
            GDI.SetTextAlign(dc, 'left');
        }

        /* scrollbar indicator */
        if (hasScroll) {
            var trackH = this.height - PAD * 2;
            var th = Math.max(16, Math.round(trackH * visible / this.items.length));
            var tp = Math.round((trackH - th) * (this.scrollTop / Math.max(1, this.items.length - visible)));
            GDI.FillRect(dc, this.width - RES.METRICS.scrollbarWidth + 2, PAD + tp,
                RES.METRICS.scrollbarWidth - 4, th, t.scrollThumb);
        }
    };

    ListBox.prototype.indexAt = function (ly) {
        var row = Math.floor((ly - PAD) / ROW_HEIGHT);
        if (row < 0) { return -1; }
        var idx = this.scrollTop + row;
        return idx < this.items.length ? idx : -1;
    };

    ListBox.prototype.onControlMessage = function (msg) {
        var d = msg.data || {};
        var ly = (typeof d.y === 'number') ? d.y : (d.event ? d.event.offsetY - this.absoluteRect().y : null);

        if (msg.type === 'mousedown' || msg.type === 'click') {
            if (ly === null) { return null; }
            var idx = this.indexAt(ly);
            if (idx >= 0) {
                this.focus();
                this.select(idx);
                return 'selected';
            }
            return null;
        }
        if (msg.type === 'contextmenu') {
            if (ly === null) { return null; }
            var ridx = this.indexAt(ly);
            if (ridx >= 0) { this.focus(); this.select(ridx); }
            if (typeof this.onContext === 'function') {
                try {
                    this.onContext(this.getSelected(), ridx, this,
                        { x: d.screenX, y: d.screenY, localX: d.x, localY: d.y });
                } catch (err) {
                    var srm = G.EznK.Kernel && G.EznK.Kernel.SRM;
                    if (srm) { srm.emit('ui:error', { listbox: this.id, error: err && err.message }); }
                }
            }
            return 'context';
        }
        if (msg.type === 'dblclick') {
            if (ly === null) { return null; }
            var idx2 = this.indexAt(ly);
            if (idx2 >= 0) {
                this.select(idx2);
                if (this.onActivate) {
                    try { this.onActivate(this.getSelected(), idx2, this); } catch (_) { /* ignore */ }
                }
                return 'activated';
            }
            return null;
        }
        if (msg.type === 'keydown') {
            var key = d.key;
            if (key === 'ArrowDown') { this.select(Math.min(this.items.length - 1, this.selectedIndex + 1)); return 'down'; }
            if (key === 'ArrowUp') { this.select(Math.max(0, this.selectedIndex - 1)); return 'up'; }
            if (key === 'Home') { this.select(0); return 'home'; }
            if (key === 'End') { this.select(this.items.length - 1); return 'end'; }
            if (key === 'Enter' && this.onActivate) {
                try { this.onActivate(this.getSelected(), this.selectedIndex, this); } catch (_) { /* ignore */ }
                return 'activated';
            }
        }
        if (msg.type === 'wheel') {
            var delta = (d.deltaY || 0) > 0 ? 1 : -1;
            var maxTop = Math.max(0, this.items.length - this.visibleRows());
            this.scrollTop = Math.max(0, Math.min(maxTop, this.scrollTop + delta));
            this.invalidate();
            return 'scrolled';
        }
        return null;
    };

    G.ezn32.ui.controls = G.ezn32.ui.controls || {};
    G.ezn32.ui.controls.ListBox = ListBox;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    if (!G.EZNT.ui.controls) { G.EZNT.ui.controls = {}; }
    G.EZNT.ui.controls.ListBox = ListBox;
    CORE.createLogger('Ezn32/UI:listbox').info('controls/listbox.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
