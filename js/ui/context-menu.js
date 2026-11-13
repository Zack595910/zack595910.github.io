/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/context-menu.js
 *   Module  : ezn32.ui.ContextMenu
 *   Layer   : Ezn32 UI
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   ezn32.ui.ContextMenu - the ONE AND ONLY context-menu renderer.
 *
 *   SPEC 4.2: "右键菜单（唯一渲染器）". Every right-click menu in EZNT -
 *   desktop, file manager, registry editor, taskbar, editor - is rendered
 *   by this module onto its own canvas overlay. No module is allowed to
 *   build a DOM menu.
 *
 *   A menu is opened at a screen point and is drawn on a dedicated overlay
 *   canvas above everything (z-index 100000). It closes on outside click,
 *   Escape, or item invocation.
 *
 *   Model:
 *     items: [{ id, text, icon?, shortcut?, disabled?, checked?,
 *               separator?, submenu?: [{...}], onClick }]
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.ContextMenu && G.ezn32.ui.ContextMenu.__isContextMenu === true) { return; }

    var CORE = G.EznK.Platform.Core;
    var GDI = ezn32.api.gdi;
    var CANVAS = ezn32.ui.canvas;
    var RES = ezn32.ui.res;
    var DOM = G.EznK.Platform.DOM;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('Ezn32/UI:contextmenu');

    var ITEM_H = 24;
    var SEP_H = 7;
    var MIN_W = 160;
    var PAD = 6;

    var menu = {
        open: false,
        x: 0,
        y: 0,
        width: MIN_W,
        height: 0,
        items: [],
        hover: -1,
        submenu: null,
        subHover: -1,
        overlay: null,
        listeners: []
    };

    /* =================================================================
     * 1. Normalisation
     * ============================================================== */

    function normalize(items) {
        return (items || []).map(function (it) {
            return {
                id: it.id || it.text || '',
                text: it.text || '',
                icon: it.icon || null,
                shortcut: it.shortcut || '',
                disabled: it.disabled === true,
                checked: it.checked === true,
                separator: it.separator === true,
                submenu: Array.isArray(it.submenu) ? normalize(it.submenu) : null,
                onClick: typeof it.onClick === 'function' ? it.onClick : null
            };
        });
    }

    function measure(items) {
        var w = MIN_W;
        items.forEach(function (it) {
            if (it.separator) { return; }
            var m = GDI.MeasureText(it.text + (it.shortcut ? '    ' + it.shortcut : ''), RES.font('ui'));
            var tw = (m.status === S.OK ? m.value.width : it.text.length * 7) + PAD * 2 + 30 +
                (it.submenu ? 20 : 0);
            if (tw > w) { w = tw; }
        });
        return w;
    }

    function measureHeight(items) {
        var h = PAD * 2;
        items.forEach(function (it) { h += it.separator ? SEP_H : ITEM_H; });
        return h;
    }

    /* =================================================================
     * 2. Show / hide
     * ============================================================== */

    /**
     * Show(spec) -> { status, value: { width, height } }
     *   spec: { x, y, items }  x/y are viewport coordinates.
     */
    function Show(spec) {
        var s = spec || {};
        if (!Array.isArray(s.items) || s.items.length === 0) {
            return CORE.fail(S.EINVAL, { reason: 'items array required' });
        }
        Hide();
        var items = normalize(s.items);
        var hostRes = DOM.byId('eznt-root');
        if (hostRes.status !== S.OK) { return hostRes; }
        var host = hostRes.value;

        var w = measure(items);
        var h = measureHeight(items);
        var vw = G.innerWidth || 1280;
        var vh = G.innerHeight || 720;
        var x = Math.min(s.x || 0, Math.max(0, vw - w - 4));
        var y = Math.min(s.y || 0, Math.max(0, vh - h - 4));

        var surfRes = CANVAS.CreateForParent(host, w, h);
        if (surfRes.status !== S.OK) { return surfRes; }
        var surf = surfRes.value;
        surf.element.style.position = 'fixed';
        surf.element.style.left = x + 'px';
        surf.element.style.top = y + 'px';
        surf.element.style.zIndex = '100000';

        menu.open = true;
        menu.x = x;
        menu.y = y;
        menu.width = w;
        menu.height = h;
        menu.items = items;
        menu.hover = -1;
        menu.overlay = surf;
        surf.painter = function (surface) { paint(surface, menu.items, 0, 0, w, h, menu.hover, menu.submenu, menu.subHover); };
        surf.invalidate();

        bindGlobalClose();
        return CORE.ok({ width: w, height: h });
    }

    function Hide() {
        if (menu.submenu && menu.overlay) {
            /* submenu is painted in the same overlay; nothing extra to free */
        }
        menu.submenu = null;
        menu.subHover = -1;
        menu.open = false;
        menu.hover = -1;
        if (menu.overlay) { CANVAS.dispose(menu.overlay); }
        menu.overlay = null;
        menu.items = [];
        unbindGlobalClose();
        return CORE.ok(true);
    }

    function IsOpen() { return menu.open; }

    /* =================================================================
     * 3. Painting
     * ============================================================== */

    function paint(surface, items, ox, oy, w, h, hover, submenu, subHover) {
        var t = RES.theme().value;
        GDI.FillRect(surface.dc, 0, 0, w, h, t.menuBg);
        GDI.DrawRect(surface.dc, 0, 0, w, h, t.menuBorder, 1);
        GDI.SelectObject(surface.dc, RES.font('ui'));

        var y = oy + PAD;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.separator) {
                GDI.DrawLine(surface.dc, ox + 6, y + 3, ox + w - 6, y + 3, t.menuBorder, 1);
                y += SEP_H;
                continue;
            }
            if (i === hover && !it.disabled) {
                GDI.FillRect(surface.dc, ox + 2, y, w - 4, ITEM_H, t.selectionBg);
            }
            if (it.checked) {
                GDI.SetTextColor(surface.dc, t.text);
                GDI.DrawText(surface.dc, 'v', ox + 6, y + 5);
            }
            if (it.icon) {
                GDI.SetTextColor(surface.dc, it.disabled ? t.textDisabled : t.text);
                GDI.DrawText(surface.dc, it.icon, ox + (it.checked ? 20 : 6), y + 5);
            }
            GDI.SetTextColor(surface.dc, it.disabled ? t.textDisabled : t.text);
            GDI.DrawTextTruncated(surface.dc, it.text, ox + PAD + 26, y + 5, w - 90);
            if (it.shortcut) {
                GDI.SetTextColor(surface.dc, t.textSecondary);
                GDI.SetTextAlign(surface.dc, 'right');
                GDI.DrawText(surface.dc, it.shortcut, ox + w - 26, y + 5);
                GDI.SetTextAlign(surface.dc, 'left');
            }
            if (it.submenu) {
                GDI.SetTextColor(surface.dc, t.textSecondary);
                GDI.DrawText(surface.dc, '>', ox + w - 16, y + 5);
            }
            y += ITEM_H;
        }

        /* submenu overlay */
        if (submenu && submenu.items && submenu.items.length) {
            var sw = measure(submenu.items);
            var sh = measureHeight(submenu.items);
            var sx = submenu.x;
            var sy = submenu.y;
            if (sx + sw > (G.innerWidth || 1280)) { sx = ox + 4; }
            if (sy + sh > (G.innerHeight || 720)) { sy = Math.max(0, (G.innerHeight || 720) - sh - 4); }
            GDI.FillRect(surface.dc, sx - ox, sy - oy, sw, sh, t.menuBg);
            GDI.DrawRect(surface.dc, sx - ox, sy - oy, sw, sh, t.menuBorder, 1);
            var sy2 = sy - oy + PAD;
            for (var j = 0; j < submenu.items.length; j++) {
                var sit = submenu.items[j];
                if (sit.separator) {
                    GDI.DrawLine(surface.dc, sx - ox + 6, sy2 + 3, sx - ox + sw - 6, sy2 + 3, t.menuBorder, 1);
                    sy2 += SEP_H;
                    continue;
                }
                if (j === subHover && !sit.disabled) {
                    GDI.FillRect(surface.dc, sx - ox + 2, sy2, sw - 4, ITEM_H, t.selectionBg);
                }
                GDI.SetTextColor(surface.dc, sit.disabled ? t.textDisabled : t.text);
                GDI.DrawTextTruncated(surface.dc, sit.text, sx - ox + PAD + 6, sy2 + 5, sw - PAD * 2 - 10);
                sy2 += ITEM_H;
            }
        }
    }

    /* =================================================================
     * 4. Interaction
     * ============================================================== */

    function itemAt(px, py) {
        if (px < 0 || px >= menu.width) { return -1; }
        var y = PAD;
        for (var i = 0; i < menu.items.length; i++) {
            var it = menu.items[i];
            var h = it.separator ? SEP_H : ITEM_H;
            if (py >= y && py < y + h) { return it.separator ? -1 : i; }
            y += h;
        }
        return -1;
    }

    function bindGlobalClose() {
        if (!DOM) { return; }
        menu.listeners = [];
        var downHandler = function (ev) {
            var el = menu.overlay ? menu.overlay.element : null;
            if (el && el.contains && ev.target !== el) {
                Hide();
            }
        };
        var keyHandler = function (ev) {
            if (ev.key === 'Escape') { Hide(); }
        };
        var h1 = DOM.on('window', 'mousedown', downHandler, true);
        var h2 = DOM.on('window', 'keydown', keyHandler, true);
        if (h1.status === S.OK) { menu.listeners.push(h1.value); }
        if (h2.status === S.OK) { menu.listeners.push(h2.value); }

        /* overlay-local interaction */
        if (menu.overlay) {
            var el2 = menu.overlay.element;
            var mh = DOM.on(el2, 'mousemove', function (ev) {
                var rect = el2.getBoundingClientRect();
                var hov = itemAt(ev.clientX - rect.left, ev.clientY - rect.top);
                if (hov !== menu.hover) {
                    menu.hover = hov;
                    menu.overlay.invalidate();
                }
            });
            if (mh.status === S.OK) { menu.listeners.push(mh.value); }

            var ch = DOM.on(el2, 'click', function (ev) {
                var rect = el2.getBoundingClientRect();
                var idx = itemAt(ev.clientX - rect.left, ev.clientY - rect.top);
                if (idx < 0) { return; }
                var item = menu.items[idx];
                if (item.disabled) { return; }
                if (item.submenu) { return; }
                Hide();
                if (item.onClick) {
                    try { item.onClick(item); } catch (err) {
                        LOG.error('menu item threw: ' + (err && err.message));
                    }
                }
            });
            if (ch.status === S.OK) { menu.listeners.push(ch.value); }
        }
    }

    function unbindGlobalClose() {
        menu.listeners.forEach(function (h) { if (DOM) { DOM.off(h); } });
        menu.listeners = [];
    }

    /* =================================================================
     * 5. Public handle
     * ============================================================== */

    /* Geometry() - 当前菜单的屏幕矩形与布局参数。
     * 供测试和自动化点击精确落到某一项上，避免各脚本各自猜坐标。 */
    function Geometry() {
        if (!menu || !menu.open || !menu.overlay) { return null; }
        return {
            x: menu.x, y: menu.y, w: menu.width, h: menu.height,
            itemHeight: ITEM_H, sepHeight: SEP_H, pad: PAD
        };
    }

    var CM = {
        Geometry: Geometry,};
    CM.__isContextMenu = true;
    CM.version = '1.0.0';
    CM.STATUS = S;

    CM.Show = Show;
    CM.Hide = Hide;
    CM.IsOpen = IsOpen;
    /* Items() - 当前菜单项（调试 / 自动化测试用） */
    CM.Items = function () { return (menu.items || []).slice(0); };

    G.ezn32.ui.ContextMenu = CM;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    G.EZNT.ui.ContextMenu = CM;
    LOG.info('js/ui/context-menu.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
