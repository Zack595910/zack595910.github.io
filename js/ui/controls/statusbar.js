/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/controls/statusbar.js
 *   Module  : ezn32.ui.controls.StatusBar
 *   Layer   : Ezn32 UI
 *
 *   A bottom status bar split into named panes. Used by the file manager,
 *   the editor and the MMC console.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.controls && G.ezn32.ui.controls.StatusBar) { return; }

    var CORE = G.EznK.Platform.Core;
    var GDI = ezn32.api.gdi;
    var CTRL = ezn32.ui.Control;
    var RES = ezn32.ui.res;

    var HEIGHT = 22;

    function StatusBar(spec) {
        var s = spec || {};
        CTRL.call(this, {
            x: s.x || 0, y: s.y || 0,
            width: s.width || 400, height: HEIGHT,
            focusable: false,
            id: s.id, tag: s.tag
        });
        this.kind = 'statusbar';
        this.panes = Array.isArray(s.panes) ? s.panes.map(normalizePane) : [{ id: 'main', text: '', flex: 1 }];
    }
    StatusBar.prototype = Object.create(CTRL.prototype);
    StatusBar.prototype.constructor = StatusBar;

    function normalizePane(p) {
        if (typeof p === 'string') { return { id: p, text: '', flex: 1 }; }
        return {
            id: p.id || ('pane' + Math.random().toString(36).slice(2, 7)),
            text: p.text || '',
            width: typeof p.width === 'number' ? p.width : null,
            flex: typeof p.flex === 'number' ? p.flex : 1
        };
    }

    StatusBar.prototype.setPane = function (id, text) {
        for (var i = 0; i < this.panes.length; i++) {
            if (this.panes[i].id === id) {
                this.panes[i].text = String(text === null || text === undefined ? '' : text);
                this.invalidate();
                return true;
            }
        }
        return false;
    };

    StatusBar.prototype.getPane = function (id) {
        for (var i = 0; i < this.panes.length; i++) {
            if (this.panes[i].id === id) { return this.panes[i].text; }
        }
        return null;
    };

    StatusBar.prototype.layout = function () {
        var fixed = 0;
        var flexTotal = 0;
        this.panes.forEach(function (p) {
            if (p.width !== null) { fixed += p.width; } else { flexTotal += p.flex; }
        });
        var available = Math.max(0, this.width - fixed);
        var x = 0;
        return this.panes.map(function (p) {
            var w = (p.width !== null) ? p.width : Math.floor(available * (p.flex / Math.max(1, flexTotal)));
            var out = { pane: p, x: x, w: w };
            x += w;
            return out;
        });
    };

    StatusBar.prototype.onPaint = function (dc) {
        var t = RES.theme().value;
        GDI.FillRect(dc, 0, 0, this.width, this.height, t.surfaceAlt);
        GDI.FillRect(dc, 0, 0, this.width, 1, t.border);
        GDI.SelectObject(dc, RES.font('small'));
        GDI.SetTextColor(dc, t.textSecondary);
        var laid = this.layout();
        for (var i = 0; i < laid.length; i++) {
            var item = laid[i];
            GDI.DrawTextTruncated(dc, item.pane.text, item.x + 6, 5, item.w - 10);
            if (i < laid.length - 1) {
                GDI.DrawLine(dc, item.x + item.w - 1, 4, item.x + item.w - 1, this.height - 4, t.border, 1);
            }
        }
    };

    G.ezn32.ui.controls = G.ezn32.ui.controls || {};
    G.ezn32.ui.controls.StatusBar = StatusBar;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    if (!G.EZNT.ui.controls) { G.EZNT.ui.controls = {}; }
    G.EZNT.ui.controls.StatusBar = StatusBar;
    CORE.createLogger('Ezn32/UI:statusbar').info('controls/statusbar.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
