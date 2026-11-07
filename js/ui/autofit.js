/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | Ezn32 UI
 *
 *   文件 : js/ui/autofit.js
 *   模块 : ezn32.ui.autofit
 *   层级 : Ezn32 UI
 *
 * ---------------------------------------------------------------------
 * 职责
 * ---------------------------------------------------------------------
 *   智能自适应。对齐 PTD.html 的 flex 布局语义：
 *   PTD 的窗口内容是 `display:flex; flex-direction:column; overflow:auto`，
 *   窗口一变，所有元素自动伸展 / 收缩 / 滚动。
 *
 *   做法：应用在 open() 结束时调用 autofit(win)，
 *   它会在窗口**第一次**调整尺寸时记录每个控件的"锚定方式"：
 *
 *     ANCHOR_L  x 固定（左边不动）
 *     ANCHOR_R  右边界固定  -> x = newW - (baseW - x - w)
 *     ANCHOR_T  y 固定（上边不动）
 *     ANCHOR_B  下边界固定  -> y = newH - (baseH - y - h)
 *     STRETCH_W 宽度跟随客户区宽度变化
 *     STRETCH_H 高度跟随客户区高度变化
 *
 *   判定规则（与 CSS 行为一致）：
 *     - 宽度 > 基准 60% 且 x < 40           -> 通栏，两个方向都跟随
 *     - 右边界离基准右边 < 40px（且不是通栏） -> 右锚定
 *     - 下边界离基准下边 < 40px（且不是通栏） -> 下锚定
 *     - 高度 > 基准 50%（主内容区）          -> 高度跟随
 *
 *   这样无论是"窗口放大"还是"窗口缩小"，控件都留在正确位置。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.autofit) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('Ezn32/UI:autofit');

    var EDGE = 40;      /* 贴边判定阈值 */

    /**
     * analyze(ctl, baseW, baseH) -> 锚定描述
     */
    function analyze(ctl, baseW, baseH) {
        var x = ctl.x || 0, y = ctl.y || 0;
        var w = ctl.width || 0, h = ctl.height || 0;
        var right = x + w;
        var bottom = y + h;

        var spansW = (w >= baseW * 0.6);
        var spansH = (h >= baseH * 0.5);

        var anchorRight = !spansW && (baseW - right) <= EDGE && (baseW - right) >= 0;
        var anchorBottom = !spansH && (baseH - bottom) <= EDGE && (baseH - bottom) >= 0;

        return {
            baseW: baseW, baseH: baseH,
            x: x, y: y, w: w, h: h,
            stretchW: spansW,
            stretchH: spansH,
            anchorRight: anchorRight,
            anchorBottom: anchorBottom,
            /* 通栏的元素如果上下都不贴边，宽度也跟随（状态栏等） */
            followW: spansW,
            followH: spansH
        };
    }

    /**
     * resolve(a, newW, newH) -> { x, y, w, h }
     */
    function resolve(a, newW, newH) {
        var dw = newW - a.baseW;
        var dh = newH - a.baseH;

        var x = a.x, y = a.y, w = a.w, h = a.h;

        /* ---- 宽度 ---- */
        if (a.followW) {
            w = Math.max(1, a.w + dw);
        }

        /* ---- 高度 ---- */
        if (a.followH) {
            h = Math.max(1, a.h + dh);
        }

        /* ---- 右锚定：保持与右边的距离 ---- */
        if (a.anchorRight) {
            x = a.baseW - (a.baseW - a.x - a.w) - w + dw;
            x = a.x + dw;
        }

        /* ---- 下锚定：保持与下边的距离 ---- */
        if (a.anchorBottom) {
            y = a.y + dh;
        }

        /* ---- 兜底：绝不超出客户区 ---- */
        if (x + w > newW) {
            if (a.followW) { w = Math.max(1, newW - x); }
            else if (x >= newW) { x = Math.max(0, newW - w); }
        }
        if (y + h > newH) {
            if (a.followH) { h = Math.max(1, newH - y); }
            else if (y >= newH) { y = Math.max(0, newH - h); }
        }
        if (x < 0) { x = 0; }
        if (y < 0) { y = 0; }

        return { x: x, y: y, w: w, h: h };
    }

    /**
     * autofit(win) -> { status, value }
     *   为窗口挂上智能自适应。必须在所有控件添加完成之后调用
     *   （应用的 open() 末尾）。
     */
    function autofit(win) {
        if (!win || !win.client) { return CORE.fail(S.EINVAL, { reason: '需要窗口' }); }

        /* 基准：创建时的客户区尺寸 */
        var baseW = win.client.width;
        var baseH = win.client.height;

        /* 立即记录每个控件的锚定方式 */
        var anchors = [];
        win.client.children.forEach(function (c) {
            if (!c || c.disposed) { return; }
            anchors.push({ ctl: c, a: analyze(c, baseW, baseH) });
        });

        var prevW = baseW, prevH = baseH;

        win._layoutFn = function (cw, ch) {
            if (cw === prevW && ch === prevH) { return; }

            anchors.forEach(function (it) {
                var c = it.ctl;
                if (!c || c.disposed) { return; }
                /* 以最新尺寸重新求解；基准保持不变，保证多次 resize 不漂移 */
                var g = resolve(it.a, cw, ch);
                c.x = g.x;
                c.y = g.y;
                c.width = g.w;
                c.height = g.h;
                c.invalidate();
                if (typeof c.onLayout === 'function') {
                    try { c.onLayout(c.width, c.height); } catch (_) {}
                }
            });

            prevW = cw;
            prevH = ch;
            win.client.invalidate();
        };

        win._autofitInfo = { baseW: baseW, baseH: baseH, count: anchors.length };
        return CORE.ok(anchors.length);
    }

    /**
     * reanalyze(win) - 内容变化后重新记录锚定（例如列表重新生成控件）
     */
    function reanalyze(win) {
        if (!win || !win.client) { return CORE.fail(S.EINVAL, {}); }
        return autofit(win);
    }

    /**
     * capture(win, baseW, baseH)
     *   以给定尺寸为基准记录所有子控件的锚定方式。
     */
    function capture(win, baseW, baseH) {
        if (!win || !win.client) { return CORE.fail(S.EINVAL, { reason: '需要窗口' }); }
        var bw = (typeof baseW === 'number' && baseW > 0) ? baseW : win.client.width;
        var bh = (typeof baseH === 'number' && baseH > 0) ? baseH : win.client.height;
        var anchors = [];
        win.client.children.forEach(function (c) {
            if (!c || c.disposed) { return; }
            anchors.push({ ctl: c, a: analyze(c, bw, bh) });
        });
        win._autofitInfo = { baseW: bw, baseH: bh, anchors: anchors };
        return CORE.ok(anchors.length);
    }

    /**
     * applyTo(win, fromW, fromH, toW, toH)
     *   按 from -> to 的尺寸变化重排控件。基准始终是 capture 时的尺寸，
     *   因此连续多次 resize 不会累积漂移。
     */
    function applyTo(win, fromW, fromH, toW, toH) {
        var info = win && win._autofitInfo;
        if (!info) { return CORE.fail(S.ENOENT, { reason: '未捕获锚定表' }); }
        info.anchors.forEach(function (it) {
            var c = it.ctl;
            if (!c || c.disposed) { return; }
            var g = resolve(it.a, toW, toH);
            c.x = g.x;
            c.y = g.y;
            c.width = g.w;
            c.height = g.h;
            c.invalidate();
            if (typeof c.onLayout === 'function') {
                try { c.onLayout(c.width, c.height); } catch (_) {}
            }
        });
        if (win.client) { win.client.invalidate(); }
        return CORE.ok(true);
    }

    /**
     * verify(win) -> { status, value: { ok, clientW, clientH, overflows[] } }
     *   自检：检查是否有控件超出客户区。诊断与测试都用它，
     *   保证判定逻辑只有一处实现。
     */
    /**
     * trace(win) - 返回每个控件的实际与期望位置，用于诊断
     */
    function trace(win) {
        var w = win || (G.ezn32 && G.ezn32.ui && G.ezn32.ui.Window
            ? G.ezn32.ui.Window.List().value[0] : null);
        if (!w || !w.client) { return CORE.ok([]); }
        var info = w._autofitInfo;
        var rows = [];
        w.client.children.forEach(function (c) {
            var a = null;
            if (info) {
                info.anchors.forEach(function (it) { if (it.ctl === c) { a = it.a; } });
            }
            rows.push({
                name: c.constructor.name,
                actual: { x: c.x, y: c.y, w: c.width, h: c.height },
                base: a ? { x: a.x, y: a.y, w: a.w, h: a.h, baseW: a.baseW, baseH: a.baseH,
                            anchorBottom: a.anchorBottom, followH: a.followH } : null,
                expected: a ? resolve(a, w.client.width, w.client.height) : null
            });
        });
        return CORE.ok(rows);
    }

    function verify(win) {
        var w = win || (G.ezn32 && G.ezn32.ui && G.ezn32.ui.Window
            ? G.ezn32.ui.Window.List().value[0] : null);
        if (!w || !w.client) { return CORE.ok({ ok: true, empty: true }); }
        var cw = w.client.width, ch = w.client.height;
        var over = [];
        (function walk(c, ox, oy, isRoot) {
            /* 根（client 自身）的坐标是相对 window.root 的，含标题栏偏移，
             * 不能计入子控件的累积 —— 子控件坐标本来就是相对 client 的。 */
            var ax = isRoot ? 0 : ox + (c.x || 0);
            var ay = isRoot ? 0 : oy + (c.y || 0);
            if (!isRoot && c.width > 0 && c.height > 0) {
                var overR = ax + c.width > cw + 2;
                var overB = ay + c.height > ch + 2;
                if (overR || overB) {
                    over.push({
                        name: c.constructor.name,
                        x: Math.round(ax), y: Math.round(ay),
                        w: Math.round(c.width), h: Math.round(c.height),
                        bottom: Math.round(ay + c.height),
                        right: Math.round(ax + c.width),
                        overRight: overR, overBottom: overB
                    });
                }
            }
            (c.children || []).forEach(function (k) { walk(k, ax, ay, false); });
        })(w.client, 0, 0, true);
        return CORE.ok({ ok: over.length === 0, clientW: cw, clientH: ch, overflows: over.slice(0, 8) });
    }

    var AF = {};
    AF.version = '1.0.0';
    AF.autofit = autofit;
    AF.capture = capture;
    AF.applyTo = applyTo;
    AF.verify = verify;
    AF.trace = trace;
    AF.reanalyze = reanalyze;
    AF.analyze = analyze;
    AF.resolve = resolve;

    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.ui) { G.ezn32.ui = {}; }
    G.ezn32.ui.autofit = AF;
    if (!G.EznK.Ui) { G.EznK.Ui = {}; }
    G.EznK.Ui.AutoFit = AF;

    LOG.info('js/ui/autofit.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
