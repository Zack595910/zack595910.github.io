/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/controls/treeview.js
 *   Module  : ezn32.ui.controls.TreeView
 *   Layer   : Ezn32 UI
 *
 *   A collapsible tree. Used by the file manager sidebar, the registry
 *   editor, the MMC console and the device manager.
 *
 *   Model: a node is { id, text, icon?, children: [], expanded: bool,
 *   data? }. The tree keeps the flat visible-row cache derived from the
 *   model, so painting and hit testing share one traversal.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.controls && G.ezn32.ui.controls.TreeView) { return; }

    var CORE = G.EznK.Platform.Core;
    var GDI = ezn32.api.gdi;
    var CTRL = ezn32.ui.Control;
    var RES = ezn32.ui.res;

    var ROW_H = 22;
    var INDENT = 16;

    function TreeView(spec) {
        var s = spec || {};
        CTRL.call(this, {
            x: s.x || 0, y: s.y || 0,
            width: s.width || 220, height: s.height || 240,
            focusable: true,
            id: s.id, tag: s.tag
        });
        this.kind = 'treeview';
        this.root = normalizeNode(s.root || { id: 'root', text: '/', children: [], expanded: true });
        this.selectedId = null;
        this.scrollTop = 0;
        this._rows = null;
        this.onSelect = typeof s.onSelect === 'function' ? s.onSelect : null;
        this.onContext = typeof s.onContext === 'function' ? s.onContext : null;
        this.onExpand = typeof s.onExpand === 'function' ? s.onExpand : null;
    }
    TreeView.prototype = Object.create(CTRL.prototype);
    TreeView.prototype.constructor = TreeView;

    function normalizeNode(n) {
        return {
            id: n.id !== undefined ? n.id : (n.text || '') + Math.random().toString(36).slice(2, 6),
            text: n.text || '',
            icon: n.icon || null,
            expanded: n.expanded === true,
            data: n.data === undefined ? null : n.data,
            children: (n.children || []).map(normalizeNode)
        };
    }

    TreeView.prototype.setRoot = function (rootObj) {
        this.root = normalizeNode(rootObj || { id: 'root', text: '/' });
        this.selectedId = null;
        this.scrollTop = 0;
        this._rows = null;
        this.invalidate();
        return this;
    };

    /** rows() - flat visible rows [{node, depth}] derived from the model. */
    TreeView.prototype.rows = function () {
        if (this._rows) { return this._rows; }
        var out = [];
        function walk(node, depth) {
            out.push({ node: node, depth: depth });
            if (node.expanded) {
                for (var i = 0; i < node.children.length; i++) {
                    walk(node.children[i], depth + 1);
                }
            }
        }
        walk(this.root, 0);
        this._rows = out;
        return out;
    };

    TreeView.prototype.findNode = function (id) {
        var rows = this.rows();
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].node.id === id) { return rows[i]; }
        }
        /* also search collapsed subtrees */
        var found = null;
        (function walk(n) {
            if (found) { return; }
            if (n.id === id) { found = n; return; }
            n.children.forEach(walk);
        })(this.root);
        return found ? { node: found, depth: 0 } : null;
    };

    TreeView.prototype.visibleRows = function () {
        return Math.max(1, Math.floor((this.height - 6) / ROW_H));
    };

    TreeView.prototype.select = function (id) {
        var hit = this.findNode(id);
        if (!hit) { return null; }
        this.selectedId = id;
        this.ensureVisible(id);
        this.invalidate();
        if (this.onSelect) { try { this.onSelect(hit.node, this); } catch (_) { /* ignore */ } }
        return hit.node;
    };

    TreeView.prototype.ensureVisible = function (id) {
        var rows = this.rows();
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].node.id === id) {
                var visible = this.visibleRows();
                if (i < this.scrollTop) { this.scrollTop = i; }
                if (i >= this.scrollTop + visible) { this.scrollTop = i - visible + 1; }
                return;
            }
        }
    };

    TreeView.prototype.toggle = function (id) {
        var hit = this.findNode(id);
        if (!hit || !hit.node.children.length) { return false; }
        hit.node.expanded = !hit.node.expanded;
        this._rows = null;
        this.invalidate();
        if (this.onExpand) {
            try { this.onExpand(hit.node, hit.node.expanded, this); } catch (_) { /* ignore */ }
        }
        return hit.node.expanded;
    };

    TreeView.prototype.onPaint = function (dc) {
        var t = RES.theme().value;
        GDI.FillRect(dc, 0, 0, this.width, this.height, t.inputBg);
        GDI.DrawRect(dc, 0, 0, this.width, this.height, this.focused ? t.accent : t.inputBorder, 1);
        GDI.SelectObject(dc, RES.font('ui'));

        var rows = this.rows();
        var visible = this.visibleRows();
        for (var i = 0; i < visible; i++) {
            var idx = this.scrollTop + i;
            if (idx >= rows.length) { break; }
            var row = rows[idx];
            var y = 3 + i * ROW_H;
            var x = 4 + row.depth * INDENT;
            var selected = row.node.id === this.selectedId;

            if (selected) {
                GDI.FillRect(dc, 1, y, this.width - 2, ROW_H, this.focused ? t.selectionBg : t.surfaceActive);
            }

            /* expander */
            if (row.node.children.length > 0) {
                GDI.SetTextColor(dc, t.textSecondary);
                GDI.DrawText(dc, row.node.expanded ? '-' : '+', x, y + 4);
            }
            x += INDENT;

            if (row.node.icon) {
                GDI.SetTextColor(dc, t.text);
                GDI.DrawText(dc, row.node.icon, x, y + 4);
                x += 26;
            }

            GDI.SetTextColor(dc, selected && this.focused ? t.selectionText : t.text);
            GDI.DrawTextTruncated(dc, row.node.text, x, y + 4, this.width - x - 6);
        }
    };

    TreeView.prototype.rowAt = function (ly) {
        if (ly < 3) { return null; }
        var idx = Math.floor((ly - 3) / ROW_H);
        var rows = this.rows();
        var real = this.scrollTop + idx;
        return (real >= 0 && real < rows.length) ? rows[real] : null;
    };

    TreeView.prototype.onControlMessage = function (msg) {
        if (msg.type === 'contextmenu') {
            var d0 = msg.data || {};
            var ly0 = (typeof d0.y === 'number') ? d0.y : null;
            var row0 = (ly0 !== null && this.rowAt) ? this.rowAt(ly0) : null;
            if (typeof this.onContext === 'function') {
                try { this.onContext(row0 ? row0.node : null, row0, this,
                    { x: d0.screenX, y: d0.screenY, localX: d0.x, localY: d0.y }); } catch (_) {}
            }
            return 'context';
        }
        var d = msg.data || {};
        var ly = (typeof d.y === 'number') ? d.y : null;
        var lx = (typeof d.x === 'number') ? d.x : null;

        if ((msg.type === 'mousedown' || msg.type === 'click') && ly !== null) {
            var hit = this.rowAt(ly);
            if (!hit) { return null; }
            this.focus();
            /* click on the expander zone toggles */
            var expanderX = 4 + hit.depth * INDENT;
            if (lx !== null && lx >= expanderX - 2 && lx <= expanderX + 10 && hit.node.children.length > 0) {
                this.toggle(hit.node.id);
                return 'toggled';
            }
            this.select(hit.node.id);
            return 'selected';
        }
        if (msg.type === 'dblclick' && ly !== null) {
            var h2 = this.rowAt(ly);
            if (h2 && h2.node.children.length) {
                this.toggle(h2.node.id);
                return 'toggled';
            }
            return null;
        }
        if (msg.type === 'keydown') {
            var rows = this.rows();
            var cur = -1;
            for (var i = 0; i < rows.length; i++) { if (rows[i].node.id === this.selectedId) { cur = i; break; } }
            if (d.key === 'ArrowDown' && cur < rows.length - 1) { this.select(rows[cur + 1].node.id); return 'down'; }
            if (d.key === 'ArrowUp' && cur > 0) { this.select(rows[cur - 1].node.id); return 'up'; }
            if (d.key === 'ArrowRight' && cur >= 0) { this.toggle(rows[cur].node.id); return 'expand'; }
            if (d.key === 'ArrowLeft' && cur >= 0) { this.toggle(rows[cur].node.id); return 'collapse'; }
        }
        if (msg.type === 'wheel') {
            var maxTop = Math.max(0, this.rows().length - this.visibleRows());
            this.scrollTop = Math.max(0, Math.min(maxTop, this.scrollTop + ((d.deltaY || 0) > 0 ? 1 : -1)));
            this.invalidate();
            return 'scrolled';
        }
        return null;
    };

    G.ezn32.ui.controls = G.ezn32.ui.controls || {};
    G.ezn32.ui.controls.TreeView = TreeView;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    if (!G.EZNT.ui.controls) { G.EZNT.ui.controls = {}; }
    G.EZNT.ui.controls.TreeView = TreeView;
    CORE.createLogger('Ezn32/UI:treeview').info('controls/treeview.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
