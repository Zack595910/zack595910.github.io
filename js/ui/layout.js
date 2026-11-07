/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | Ezn32 UI
 *
 *   文件 : js/ui/layout.js
 *   模块 : ezn32.ui.layout
 *   层级 : Ezn32 UI
 *
 * ---------------------------------------------------------------------
 * 职责
 * ---------------------------------------------------------------------
 *   自适应布局框架。对齐 PTD.html 的 flex 布局语义：
 *
 *     PTD 的窗口内容是 HTML 的 `display:flex; flex-direction:column;
 *     overflow:auto`，所以窗口一变大变小，里面所有元素自动跟着伸展 /
 *     收缩 / 滚动。EZNT 用 canvas 绘制，没有 CSS 布局，因此需要一套
 *     显式的布局描述来达到同样效果。
 *
 *   每个应用声明一份布局规格（spec），框架负责：
 *     1. 父容器尺寸变化时重新计算每个控件的 x / y / width / height；
 *     2. 支持固定高度、百分比高度、flex 伸缩、贴底；
 *     3. 内容超出容器时自动启用滚动偏移；
 *     4. 应用也可以只声明部分布局，其余控件保持原位。
 *
 *   布局规格格式（每一行是一条水平排列）：
 *
 *     {
 *       rows: [
 *         { id: 'menu',  height: 24,  items: [{ ref: menu, width: 'fill' }] },
 *         { id: 'body',  height: 'flex', items: [
 *              { ref: nav,  width: 158 },
 *              { ref: host, width: 'fill' }
 *         ]},
 *         { id: 'status', height: 22, items: [{ ref: status, width: 'fill' }] }
 *       ]
 *     }
 *
 *   也可以直接给一个控件列表用更简单的形式：
 *     layout.stack(container, [ {ref: a, height: 30}, {ref: b, flex: 1} ])
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.layout) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;

    /* =================================================================
     * 1. 垂直堆叠布局（最常用）
     * ============================================================== */

    /**
     * stack(container, rows, opts) -> 函数
     *   rows: [{ ref, height?, flex?, gap? }]
     *     height : 固定像素高
     *     flex   : 数字，占剩余空间的比例
     *   opts: { width?: number|'fill', gap?: number }
     *
     *   返回一个 layout(width, height) 函数，容器尺寸变化时调用它。
     */
    function stack(container, rows, opts) {
        var o = opts || {};
        return function (width, height) {
            var gap = (typeof o.gap === 'number') ? o.gap : 0;
            var totalGap = gap * Math.max(0, rows.length - 1);
            var used = totalGap;
            var flexTotal = 0;

            rows.forEach(function (r) {
                if (typeof r.height === 'number') { used += r.height; }
                else if (typeof r.flex === 'number') { flexTotal += r.flex; }
            });

            var free = Math.max(0, height - used);
            var y = 0;

            rows.forEach(function (r, i) {
                var h;
                if (typeof r.height === 'number') { h = r.height; }
                else if (typeof r.flex === 'number' && flexTotal > 0) {
                    h = Math.floor(free * (r.flex / flexTotal));
                } else { h = 0; }

                var ref = r.ref;
                if (ref) {
                    var w = (typeof r.width === 'number') ? r.width
                        : (r.width === 'fill' ? width : width);
                    var x = (typeof r.x === 'number') ? r.x : 0;
                    ref.x = x;
                    ref.y = y;
                    ref.width = Math.max(1, w);
                    ref.height = Math.max(1, h);
                    if (typeof ref.onLayout === 'function' && ref !== container) {
                        try { ref.onLayout(ref.width, ref.height); } catch (_) {}
                    }
                }
                y += h + (i < rows.length - 1 ? gap : 0);
            });
        };
    }

    /**
     * columns(container, cols, opts) -> 函数
     *   水平分栏（左中右），每列里再纵向堆叠。
     *   cols: [{ ref?|rows?, width: number|'flex'|'fill', flex? }]
     */
    function columns(container, cols, opts) {
        var o = opts || {};
        return function (width, height) {
            var gap = (typeof o.gap === 'number') ? o.gap : 0;
            var totalGap = gap * Math.max(0, cols.length - 1);
            var fixed = 0, flexTotal = 0;
            cols.forEach(function (c) {
                if (typeof c.width === 'number') { fixed += c.width; }
                else if (typeof c.width === 'number' && c.flex) { flexTotal += c.flex; }
                else if (typeof c.flex === 'number') { flexTotal += c.flex; }
            });
            var free = Math.max(0, width - fixed - totalGap);
            var x = 0;

            cols.forEach(function (c, i) {
                var w;
                if (typeof c.width === 'number') { w = c.width; }
                else if (typeof c.flex === 'number' && flexTotal > 0) {
                    w = Math.floor(free * (c.flex / flexTotal));
                } else { w = free; }

                if (c.ref) {
                    c.ref.x = x; c.ref.y = (typeof c.y === 'number' ? c.y : 0);
                    c.ref.width = Math.max(1, w);
                    c.ref.height = (typeof c.height === 'number') ? c.height : height;
                    if (typeof c.ref.onLayout === 'function') {
                        try { c.ref.onLayout(c.ref.width, c.ref.height); } catch (_) {}
                    }
                }
                if (Array.isArray(c.rows) && c.rows.length) {
                    stack(container, c.rows, { gap: 0 })(w, height);
                    c.rows.forEach(function (r) {
                        if (r.ref) { r.ref.x = x + (typeof r.x === 'number' ? r.x : 0); }
                    });
                }
                x += w + (i < cols.length - 1 ? gap : 0);
            });
        };
    }

    /* =================================================================
     * 2. 通用布局入口
     * ============================================================== */

    /**
     * apply(spec) -> 函数
     *   spec: { rows: [...] }  或 { cols: [...] }
     */
    function apply(spec) {
        var sp = spec || {};
        if (Array.isArray(sp.cols)) { return columns(sp.container, sp.cols, sp); }
        if (Array.isArray(sp.rows)) { return stack(sp.container, sp.rows, sp); }
        return function () {};
    }

    /**
     * bind(window, layoutFn) - 把布局函数挂到窗口上，尺寸变化时自动调用。
     *   这会让窗口 resize / 最大化 / 还原 都触发一次完整重排。
     */
    function bind(win, layoutFn) {
        if (!win || typeof layoutFn !== 'function') { return CORE.fail(S.EINVAL, { reason: '需要窗口与布局函数' }); }
        win._layoutFn = layoutFn;
        win.onResize = function () {
            layoutFn(win.client.width, win.client.height);
            if (win.client) { win.client.invalidate(); }
        };
        /* 立即排一次，保证打开时就是正确布局 */
        layoutFn(win.client.width, win.client.height);
        return CORE.ok(true);
    }

    /**
     * pin(control, edge, offset) - 让控件贴住某条边（贴底状态栏最常用）
     *   edge: 'bottom' | 'right'
     */
    function pin(win, control, edge, offset) {
        if (!win || !control) { return CORE.fail(S.EINVAL, {}); }
        var off = (typeof offset === 'number') ? offset : 0;
        var baseLayout = win._layoutFn || function () {};
        win._layoutFn = function (w, h) {
            baseLayout(w, h);
            if (edge === 'bottom') {
                control.y = h - control.height - off;
                control.width = w;
            } else if (edge === 'right') {
                control.x = w - control.width - off;
            }
        };
        win.onResize = function () {
            win._layoutFn(win.client.width, win.client.height);
            if (win.client) { win.client.invalidate(); }
        };
        return CORE.ok(true);
    }

    /* =================================================================
     * 3. 快捷：让一个控件填满整个客户区（带可选内边距）
     * ============================================================== */

    function fill(win, control, padding) {
        var p = (typeof padding === 'number') ? padding : 0;
        return bind(win, function (w, h) {
            control.x = p;
            control.y = p;
            control.width = Math.max(1, w - p * 2);
            control.height = Math.max(1, h - p * 2);
            if (typeof control.onLayout === 'function') { control.onLayout(control.width, control.height); }
        });
    }

    var L = {};
    L.version = '1.0.0';
    L.stack = stack;
    L.columns = columns;
    L.apply = apply;
    L.bind = bind;
    L.pin = pin;
    L.fill = fill;

    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.ui) { G.ezn32.ui = {}; }
    G.ezn32.ui.layout = L;
    if (!G.EznK.Ui) { G.EznK.Ui = {}; }
    G.EznK.Ui.Layout = L;

    CORE.createLogger('Ezn32/UI:layout').info('js/ui/layout.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
