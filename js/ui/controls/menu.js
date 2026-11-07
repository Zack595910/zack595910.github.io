/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/controls/menu.js
 *   Module  : ezn32.ui.controls.Menu
 *   Layer   : Ezn32 UI
 *
 *   A menu bar with drop-down menus and items / separators / check items.
 *   The menu bar is a control inside the client area; the drop-down is
 *   painted by the same DC (it overlaps content, so the menu requests a
 *   full window repaint while open).
 *
 *   Model:
 *     { id, text, items: [{ id, text, shortcut, checked, separator,
 *                           disabled, onClick }] }
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.controls && G.ezn32.ui.controls.Menu) { return; }

    var CORE = G.EznK.Platform.Core;
    var GDI = ezn32.api.gdi;
    var CTRL = ezn32.ui.Control;
    var RES = ezn32.ui.res;

    var BAR_H = 24;
    var ITEM_H = 24;
    var SEP_H = 7;
    var MENU_W = 200;

    function Menu(spec) {
        var s = spec || {};
        CTRL.call(this, {
            x: s.x || 0, y: s.y || 0,
            width: s.width || 400, height: BAR_H,
            focusable: false,
            id: s.id, tag: s.tag
        });
        this.kind = 'menu';
        this.menus = Array.isArray(s.menus) ? s.menus.map(normalizeMenu) : [];
        this.openIndex = -1;
        this.hoverItem = -1;
    }
    Menu.prototype = Object.create(CTRL.prototype);
    Menu.prototype.constructor = Menu;

    function normalizeMenu(m) {
        return {
            id: m.id || m.text,
            text: m.text || '',
            items: (m.items || []).map(function (it) {
                return {
                    id: it.id || it.text,
                    text: it.text || '',
                    shortcut: it.shortcut || '',
                    checked: it.checked === true,
                    separator: it.separator === true,
                    disabled: it.disabled === true,
                    onClick: typeof it.onClick === 'function' ? it.onClick : null
                };
            })
        };
    }

    Menu.prototype.setMenus = function (menus) {
        this.menus = (menus || []).map(normalizeMenu);
        this.openIndex = -1;
        this.invalidate();
        return this;
    };

    Menu.prototype.menuRect = function (index) {
        var x = 4;
        var w = 4;
        for (var i = 0; i < this.menus.length; i++) {
            var tw = menuTextWidth(this.menus[i].text);
            if (i === index) { return { x: x, y: 0, w: tw, h: BAR_H }; }
            x += tw + 12;
            w += tw + 12;
        }
        void w;
        return null;
    };

    function menuTextWidth(text) {
        var m = GDI.MeasureText(text, RES.font('ui'));
        return m.status === CORE.STATUS.OK ? m.value.width + 16 : text.length * 7 + 16;
    }

    Menu.prototype.dropdownRect = function (index) {
        var r = this.menuRect(index);
        if (!r) { return null; }
        var items = this.menus[index].items;
        var h = 4;
        items.forEach(function (it) { h += it.separator ? SEP_H : ITEM_H; });
        return { x: r.x, y: BAR_H, w: MENU_W, h: h };
    };

    /**
     * syncDropdownHeight()
     *   下拉菜单绘制在控件边界之外：打开时把自身高度撑到下拉底部，
     *   这样 (a) 父容器不会裁剪掉它，(b) hitTestTree 也能够在
     *   下拉区域内命中本控件。关闭时恢复为条高。
     */
    Menu.prototype.syncDropdownHeight = function () {
        if (this.openIndex < 0) {
            this._baseHeight = this._baseHeight || this.height;
            this.height = this._baseHeight;
            this.renderLast = false;
            return;
        }
        var rect = this.dropdownRect(this.openIndex);
        if (!rect) { return; }
        this._baseHeight = this._baseHeight || this.height;
        this.height = rect.y + rect.h + 2;
        /* 让父容器把本控件放到最后绘制，避免被 TreeView / ListBox 盖住 */
        this.renderLast = true;
    };

    Menu.prototype.onPaint = function (dc) {
        var t = RES.theme().value;
        GDI.FillRect(dc, 0, 0, this.width, BAR_H, t.surfaceAlt);
        GDI.SelectObject(dc, RES.font('ui'));
        var x = 4;
        for (var i = 0; i < this.menus.length; i++) {
            var tw = menuTextWidth(this.menus[i].text);
            if (i === this.openIndex) {
                GDI.FillRect(dc, x, 2, tw, BAR_H - 4, t.surfaceHover);
            }
            GDI.SetTextColor(dc, t.text);
            GDI.DrawText(dc, this.menus[i].text, x + 8, 5);
            x += tw + 12;
        }

        if (this.openIndex < 0) { return; }
        var rect = this.dropdownRect(this.openIndex);
        if (!rect) { return; }
        GDI.FillRect(dc, rect.x, rect.y, rect.w, rect.h, t.menuBg);
        GDI.DrawRect(dc, rect.x, rect.y, rect.w, rect.h, t.menuBorder, 1);

        var items = this.menus[this.openIndex].items;
        var y = rect.y + 2;
        for (var j = 0; j < items.length; j++) {
            var it = items[j];
            if (it.separator) {
                GDI.DrawLine(dc, rect.x + 6, y + 3, rect.x + rect.w - 6, y + 3, t.menuBorder, 1);
                y += SEP_H;
                continue;
            }
            if (j === this.hoverItem && !it.disabled) {
                GDI.FillRect(dc, rect.x + 2, y, rect.w - 4, ITEM_H, t.selectionBg);
            }
            GDI.SetTextColor(dc, it.disabled ? t.textDisabled : t.text);
            if (it.checked) { GDI.DrawText(dc, 'v', rect.x + 6, y + 5); }
            GDI.DrawTextTruncated(dc, it.text, rect.x + 24, y + 5, rect.w - 90);
            if (it.shortcut) {
                GDI.SetTextColor(dc, it.disabled ? t.textDisabled : t.textSecondary);
                GDI.SetTextAlign(dc, 'right');
                GDI.DrawText(dc, it.shortcut, rect.x + rect.w - 8, y + 5);
                GDI.SetTextAlign(dc, 'left');
            }
            y += ITEM_H;
        }
    };

    Menu.prototype.itemAt = function (px, py) {
        if (this.openIndex < 0) { return -1; }
        var rect = this.dropdownRect(this.openIndex);
        if (!rect) { return -1; }
        if (px < rect.x || px >= rect.x + rect.w) { return -1; }
        if (px < rect.x || px >= rect.x + rect.w || py < rect.y || py >= rect.y + rect.h) { return -1; }
        var items = this.menus[this.openIndex].items;
        var y = rect.y + 2;
        for (var i = 0; i < items.length; i++) {
            var h = items[i].separator ? SEP_H : ITEM_H;
            if (py >= y && py < y + h) { return items[i].separator ? -1 : i; }
            y += h;
        }
        return -1;
    };

    Menu.prototype.close = function () {
        if (this.openIndex === -1) { return; }
        this.openIndex = -1;
        this.hoverItem = -1;
        /* 延迟一帧再缩回高度：否则同一次点击的 mouseup 会落在缩小后的
         * 控件边界之外，导致命中失败、状态错乱。 */
        var self = this;
        if (this._shrinkTimer) { clearTimeout(this._shrinkTimer); }
        this._shrinkTimer = setTimeout(function () {
            self._shrinkTimer = null;
            self.syncDropdownHeight();
            self.invalidate();
        }, 0);
        this.hoverItem = -1;
        this.invalidate();
    };

    Menu.prototype.onControlMessage = function (msg) {
        var d = msg.data || {};
        var px = d.x;
        var py = d.y;
        if (typeof px !== 'number' || typeof py !== 'number') { return null; }

        /* 只处理 mousedown：window 层现在也会派发 click，
         * 两者都处理会导致"按下打开、抬起又关掉"。 */
        if (msg.type === 'mousedown') {
            /* click on the bar? */
            if (py < BAR_H) {
                var x = 4;
                for (var i = 0; i < this.menus.length; i++) {
                    var tw = menuTextWidth(this.menus[i].text);
                    if (px >= x && px < x + tw + 12) {
                        this.openIndex = (this.openIndex === i) ? -1 : i;
                        this.hoverItem = -1;
                        /* 下拉菜单画在本控件边界之外，因此必须：
                         *  a) 让父容器知道本控件需要"最后绘制"（盖住兄弟控件）
                         *  b) 临时把自身高度撑到下拉底部，避免被裁剪/命中失败 */
                        this.syncDropdownHeight();
                        this.invalidate();
                        return 'open';
                    }
                    x += tw + 12;
                }
                this.close();
                return 'close';
            }
            var idx = this.itemAt(px, py);
            if (idx >= 0) {
                var item = this.menus[this.openIndex].items[idx];
                if (item.disabled) { return null; }
                /* 注意：必须在 close() 之前取出 item —— close() 会把高度
                 * 缩回条高，之后 mouseup 就命中不到本控件了。 */
                this.close();
                if (item.onClick) {
                    try { item.onClick(item, this); } catch (err) {
                        var srm = G.EznK.Kernel && G.EznK.Kernel.SRM;
                        if (srm) { srm.emit('ui:error', { menu: item.text, error: err && err.message }); }
                    }
                }
                return 'invoked';
            }
            this.close();
            return 'close';
        }

        if (msg.type === 'mousemove') {
            var hi = this.itemAt(px, py);
            if (hi !== this.hoverItem) {
                this.hoverItem = hi;
                this.invalidate();
            }
            return null;
        }
        return null;
    };

    Menu.prototype.setItemChecked = function (menuId, itemId, checked) {
        for (var i = 0; i < this.menus.length; i++) {
            if (this.menus[i].id !== menuId) { continue; }
            for (var j = 0; j < this.menus[i].items.length; j++) {
                if (this.menus[i].items[j].id === itemId) {
                    this.menus[i].items[j].checked = checked === true;
                    this.invalidate();
                    return true;
                }
            }
        }
        return false;
    };

    Menu.BAR_H = BAR_H;
    G.ezn32.ui.controls = G.ezn32.ui.controls || {};
    G.ezn32.ui.controls.Menu = Menu;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    if (!G.EZNT.ui.controls) { G.EZNT.ui.controls = {}; }
    G.EZNT.ui.controls.Menu = Menu;
    CORE.createLogger('Ezn32/UI:menu').info('controls/menu.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
