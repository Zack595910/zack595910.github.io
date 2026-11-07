/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | Ezn32 UI
 *
 *   文件 : js/ui/autolayout.js
 *   模块 : ezn32.ui.autolayout
 *   层级 : Ezn32 UI
 *
 * ---------------------------------------------------------------------
 * 职责
 * ---------------------------------------------------------------------
 *   自动自适应引擎。对齐 PTD.html 的 flex/百分比布局语义。
 *
 *   问题：应用里大量使用 `width: client.width - 16`、`y: client.height - 22`
 *   这样的表达式，它们在创建时计算一次，窗口变大变小后就不再正确。
 *
 *   方案：在所有控件创建时记录一份"几何配方"（recipe）——原始表达式用
 *   到的基准宽高与常量差值。窗口尺寸变化时，用新的宽高重新求值，
 *   得到新坐标。这样：
 *
 *     width: client.width - 16    -> 新宽 = 新 cw - 16
 *     y: client.height - 22       -> 新 y = 新 ch - 22
 *     width: client.width * 0.5   -> 新宽 = 新 cw * 0.5
 *     width: 200                  -> 保持 200
 *
 *   规则：向右/向下延伸的控件跟随右/下边；贴右/贴底的同样跟随。
 *   这与 CSS 的 flex 与 calc(100% - Npx) 行为一致。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.autolayout) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('Ezn32/UI:autolayout');

    var registry = [];   /* [{ win, baseW, baseH, items:[{ctl, rx, ry, rw, rh}] }] */

    /**
     * 把一个数值表达式编码成"配方"，之后可以用新的基准求值。
     *   value      实际算出的值
     *   baseW/baseH 计算时的基准宽高
     *   expr       'w' | 'h' | 'fixed'
     */
    function makeRecipe(value, base, kind) {
        return { value: value, base: base, kind: kind };
    }

    function evalRecipe(r, newBase) {
        if (r.kind === 'fixed') { return r.value; }
        /* 记录时 value = base - delta（或 base * ratio），反推 delta / ratio */
        var delta = r.base - r.value;
        return newBase - delta;
    }

    /**
     * capture(win, baseW, baseH)
     *   为窗口客户区的所有子控件记录几何配方。
     *   必须在所有控件创建完成之后调用。
     */
    function capture(win, baseW, baseH) {
        if (!win || !win.client) { return CORE.fail(S.EINVAL, { reason: '需要窗口' }); }
        var bw = (typeof baseW === 'number') ? baseW : win.client.width;
        var bh = (typeof baseH === 'number') ? baseH : win.client.height;

        var items = [];
        win.client.children.forEach(function (c) {
            if (!c || c.disposed) { return; }
            items.push({
                ctl: c,
                x: c.x, y: c.y, w: c.width, h: c.height
            });
        });

        /* 移除同一窗口的旧记录 */
        for (var i = registry.length - 1; i >= 0; i--) {
            if (registry[i].win === win) { registry.splice(i, 1); }
        }
        registry.push({ win: win, baseW: bw, baseH: bh, items: items });

        applyTo(win, bw, bh, bw, bh);
        return CORE.ok(items.length);
    }

    /**
     * applyTo(win, fromW, fromH, toW, toH)
     *   按 from -> to 的尺寸变化重排控件。
     *
     *   规则（与 PTD 的 flex / calc 语义一致）：
     *     - 宽度接近客户区宽度的控件：跟随新的宽度（保持左右内边距）
     *     - 右边界接近客户区右边的控件：跟随右边
     *     - 竖直位置贴近底部的控件：贴底
     *     - 高度接近客户区高度且是主内容区：跟随高度
     *     - 其余固定尺寸控件保持原样
     */
    function applyTo(win, fromW, fromH, toW, toH, entry) {
        var ent = entry;
        if (!ent) {
            for (var k = 0; k < registry.length; k++) {
                if (registry[k].win === win) { ent = registry[k]; break; }
            }
        }
        if (!ent) { return CORE.fail(S.ENOENT, { reason: '未捕获布局' }); }

        var dw = toW - fromW;
        var dh = toH - fromH;

        ent.items.forEach(function (it) {
            var c = it.ctl;
            if (!c || c.disposed) { return; }

            var oldRight = it.x + it.w;
            var oldBottom = it.y + it.h;

            /* ---- 水平 ---- */
            var spansWidth = (it.w >= fromW - 24 && it.x <= 24);   /* 通栏 */
            var nearRight = (oldRight >= fromW - 32);              /* 贴右 */
            var isFullish = (it.w > fromW * 0.6);

            if (spansWidth) {
                c.width = Math.max(1, toW - (fromW - it.w));
                c.x = it.x;
            } else if (nearRight && !isFullish) {
                c.x = Math.max(0, it.x + dw);
                c.width = it.w;
            } else if (isFullish) {
                c.width = Math.max(1, it.w + dw);
                c.x = it.x;
            } else {
                c.x = it.x;
                c.width = it.w;
            }

            /* ---- 垂直 ---- */
            var nearBottom = (oldBottom >= fromH - 28);
            var spansHeight = (it.h >= fromH - 40 && it.y <= 40);

            if (nearBottom && !spansHeight) {
                /* 贴底（状态栏、底部按钮行） */
                c.y = Math.max(0, it.y + dh);
                c.height = it.h;
            } else if (spansHeight) {
                /* 主内容区：跟随高度 */
                c.height = Math.max(1, it.h + dh);
                c.y = it.y;
            } else if (it.h > fromH * 0.55) {
                c.height = Math.max(1, it.h + dh);
                c.y = it.y;
            } else {
                c.y = it.y;
                c.height = it.h;
            }

            /* 不能超出客户区 */
            if (c.x + c.width > toW) { c.width = Math.max(1, toW - c.x); }
            if (c.y + c.height > toH) {
                c.height = Math.max(1, toH - c.y);
            }
            if (c.y < 0) { c.y = 0; }

            c.invalidate();
            if (typeof c.onLayout === 'function') {
                try { c.onLayout(c.width, c.height); } catch (_) {}
            }
        });

        return CORE.ok(true);
    }

    /**
     * auto(win) - 一步完成：记录当前几何，并挂上自动重排。
     *   在应用 open() 的最后调用。
     */
    function auto(win) {
        if (!win || !win.client) { return CORE.fail(S.EINVAL, { reason: '需要窗口' }); }
        var baseW = win.client.width;
        var baseH = win.client.height;

        capture(win, baseW, baseH);

        var prev = win.onResize;
        var lastW = baseW, lastH = baseH;

        win.onResize = function (cw, ch) {
            if (cw === lastW && ch === lastH) { return; }
            applyTo(win, lastW, lastH, cw, ch);
            lastW = cw;
            lastH = ch;
            if (typeof prev === 'function') {
                try { prev(cw, ch); } catch (_) {}
            }
            if (win.client) { win.client.invalidate(); }
        };

        return CORE.ok(true);
    }

    function forget(win) {
        for (var i = registry.length - 1; i >= 0; i--) {
            if (registry[i].win === win) { registry.splice(i, 1); }
        }
        return CORE.ok(true);
    }

    var A = {};
    A.version = '1.0.0';
    A.capture = capture;
    A.applyTo = applyTo;
    A.auto = auto;
    A.forget = forget;
    A.registryCount = function () { return registry.length; };

    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.ui) { G.ezn32.ui = {}; }
    G.ezn32.ui.autolayout = A;
    if (!G.EznK.Ui) { G.EznK.Ui = {}; }
    G.EznK.Ui.AutoLayout = A;

    LOG.info('js/ui/autolayout.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
