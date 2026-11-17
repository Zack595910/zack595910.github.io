/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/desktop.js
 *   Module  : ezn32.ui.Desktop
 *   Layer   : Ezn32 UI
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   ezn32.ui.Desktop - the ONE AND ONLY desktop renderer of EZNT.
 *
 *   The desktop is a full-screen canvas that paints:
 *     - the wallpaper (theme gradient)
 *     - the desktop icon grid (folders / files / shortcuts)
 *     - the selection rectangle and drag feedback
 *     - window canvases are separate surfaces stacked above it
 *
 *   Desktop icons come from the user's Desktop folder through
 *   ezn32.api.kernel file APIs; their positions live on the config disk
 *   through the theme/desktop service.
 *
 *   SPEC 4.2: "桌面、右键菜单、窗口、控件库全部通过 Ezn32 UI. rf / KD / sys
 *   需要控件时，只能调 Ezn32 UI，不能自己画 DOM." - this module is the
 *   single place that decides what the desktop looks like.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.Desktop && G.ezn32.ui.Desktop.__isUiDesktop === true) { return; }

    var CORE = G.EznK.Platform.Core;
    var GDI = ezn32.api.gdi;
    var K = ezn32.api.kernel;
    var SHELL = ezn32.api.shell;
    var CANVAS = ezn32.ui.canvas;
    var RES = ezn32.ui.res;
    var WINDOW = ezn32.ui.Window;
    var DOM = G.EznK.Platform.DOM;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('Ezn32/UI:desktop');

    var state = {
        scale: 1,           /* 桌面图标缩放因子（小屏时自动缩小） */
        surface: null,
        icons: [],
        selected: -1,
        hovered: -1,
        dragging: null,
        marquee: null,
        created: false,
        onOpen: null,
        onContext: null
    };

    var listeners = [];

    /* =================================================================
     * 1. Creation
     * ============================================================== */

    /** Create(opts) -> { status, value: surface } */
    function Create(opts) {
        var o = opts || {};
        if (state.created) { return CORE.ok(state.surface); }
        var hostRes = DOM.byId('desktop');
        if (hostRes.status !== S.OK) {
            return CORE.fail(S.ENOENT, { reason: '#desktop element not found' });
        }
        var host = hostRes.value;
        var w = host.clientWidth || 1280;
        var h = host.clientHeight || 720;

        var surfRes = CANVAS.CreateForParent(host, w, h);
        if (surfRes.status !== S.OK) { return surfRes; }
        state.surface = surfRes.value;
        state.surface.element.style.zIndex = '1';
        state.surface.painter = function (surface) { paint(surface); };

        if (typeof o.onOpen === 'function') { state.onOpen = o.onOpen; }
        if (typeof o.onContext === 'function') { state.onContext = o.onContext; }

        WINDOW.setDesktop(host);
        bindEvents();
        state.created = true;
        state.surface.invalidate();
        return CORE.ok(state.surface);
    }

    /* =================================================================
     * 2. Icons model
     * ============================================================== */

    /**
     * SetIcons(icons) -> { status, value: number }
     *   icon: { id, name, path?, type:'file'|'dir'|'app', icon?, x, y }
     */
    function SetIcons(icons) {
        if (!Array.isArray(icons)) { return CORE.fail(S.EINVAL, { reason: 'icons array required' }); }
        var grid = RES.METRICS.desktopGridSize;
        state.icons = icons.map(function (ic, i) {
            return {
                id: ic.id || ('icon' + i),
                name: ic.name || 'item',
                path: ic.path || null,
                type: ic.type || 'file',
                icon: ic.icon || defaultIcon(ic),
                x: typeof ic.x === 'number' ? ic.x : 16,
                y: typeof ic.y === 'number' ? ic.y : 16 + i * grid,
                appId: ic.appId || null
            };
        });
        state.selected = -1;
        state.hovered = -1;
        invalidate();
        return CORE.ok(state.icons.length);
    }

    function defaultIcon(ic) {
        if (ic.type === 'dir') { return RES.icon('folder'); }
        if (ic.type === 'app') { return RES.icon('app'); }
        if (ic.path) {
            var dot = ic.path.lastIndexOf('.');
            if (dot >= 0) { return RES.icon(RES.iconForExtension(ic.path.slice(dot))); }
        }
        return RES.icon('file');
    }

    /**
     * DesktopGrid() -> { perCol, maxCols, grid, originX, originY, width, height }
     *   根据桌面画布的实际尺寸计算一列能放多少个图标、最多几列。
     *   任务栏高度从桌面元素的 clientHeight 里已经扣掉了。
     */
    function DesktopGrid() {
        var grid = RES.METRICS.desktopGridSize || 100;
        var iconH = RES.METRICS.iconSize || 48;
        var ORIGIN_X = 130;
        var ORIGIN_Y = 20;
        var BOTTOM_PAD = 12;
        var RIGHT_PAD = 12;

        /* 可用尺寸：优先用真实桌面画布，退回到 window */
        var vw = 1280, vh = 720;
        try {
            var el = SurfaceElement();
            if (el) { vw = el.clientWidth || vw; vh = el.clientHeight || vh; }
        } catch (_) {}
        if (!vw) { vw = G.innerWidth || 1280; }
        if (!vh) { vh = (G.innerHeight || 720); }

        /* 一列能放几个：可用高度去掉上下留白后按网格高整除 */
        var usableH = Math.max(grid, vh - ORIGIN_Y - BOTTOM_PAD);
        var perCol = Math.max(1, Math.floor(usableH / grid));

        /* 最多几列：从 ORIGIN_X 到右边留白之间按网格宽整除 */
        var usableW = Math.max(grid, vw - ORIGIN_X - RIGHT_PAD);
        var maxCols = Math.max(1, Math.floor(usableW / grid));

        /* 自动缩放：如果单列放不下常见的系统图标数量（按 6 个算），
         * 就按比例缩小整个网格，保证图标能完整显示。 */
        var wantRows = 6;
        var needH = wantRows * grid;
        var haveH = Math.max(grid, vh - ORIGIN_Y - BOTTOM_PAD);
        var autoScale = needH > haveH ? Math.max(0.55, haveH / needH) : 1;

        return {
            perCol: perCol,
            maxCols: maxCols,
            grid: grid,
            gridScaled: grid * autoScale,
            autoScale: autoScale,
            originX: ORIGIN_X,
            originY: ORIGIN_Y,
            width: vw,
            height: vh,
            iconH: iconH,
            capacity: perCol * maxCols
        };
    }

    /**
     * RelayoutDesktop() - 按当前屏幕尺寸重新排列用户文件图标。
     *   窗口大小变化（桌面缩放、浏览器窗口改变）后调用，保证图标
     *   不会跑到屏幕外。系统图标位置由外壳用 systemIconPosition 计算，
     *   这里只重排非系统图标。
     */
    function RelayoutDesktop() {
        var cap = DesktopGrid();
        state.scale = cap.autoScale;
        var grid = cap.gridScaled;
        var iconH = RES.METRICS.iconSize || 48;
        var count = 0;

        /* 1) 用户文件：从系统图标右侧开始网状排布。
         * 容量不足时压缩步距（最多压到 60%），保证所有图标都留在屏内。 */
        var users = state.icons.filter(function (ic) { return ic.type !== 'system'; });
        var need = users.length;
        var cols = cap.maxCols;
        var rows = cap.perCol;
        var stepX = grid, stepY = grid;
        if (need > cols * rows) {
            /* 需要更多格子：先加列，再加行，最后压步距 */
            var wantCols = Math.ceil(need / rows);
            if (wantCols > cols) {
                var availW = Math.max(grid, cap.width - cap.originX - 12);
                stepX = Math.max(grid * 0.6, availW / wantCols);
                cols = Math.max(1, Math.floor(availW / stepX));
                var wantRows = Math.ceil(need / cols);
                if (wantRows > rows) {
                    /* 第 n 行底边 = originY + (n-1)*stepY + ICON_H 必须 <= height。
                     * 所以 stepY <= (height - originY - ICON_H) / (n-1)。
                     * 这里用的 ICON_H 是布局网格高度（含文字标签），
                     * 不是图标本体高度。 */
                    var labelH = grid;                 /* 图标 + 标签的完整高度 */
                    var padB = 8;
                    var maxBottom = cap.height - padB - labelH;
                    var span = Math.max(0, maxBottom - cap.originY);
                    var wantRowsN = Math.max(1, wantRows);
                    stepY = wantRowsN > 1 ? (span / (wantRowsN - 1)) : grid;
                    stepY = Math.min(grid, Math.max(24, stepY));
                    rows = wantRowsN;
                }
            }
        }
        users.forEach(function (ic, i) {
            var col = Math.floor(i / rows);
            var row = i % rows;
            ic.x = cap.originX + col * stepX;
            ic.y = cap.originY + row * stepY;
            count++;
        });

        /* 2) 系统图标：左右各占一列。
         *
         * 之前行数不够时会向右/左"开新列"（x += grid），新列正好压进
         * 用户文件区（x=130）或越过回收站，导致图标重叠。
         * 正确做法：一列内压缩行距，把图标全部塞进这一列。
         */
        var systems = state.icons.filter(function (ic) { return ic.type === 'system'; });
        /* 按 side 分组。没有 side 的按 row/顺序均分：前一半左列，后一半右列。 */
        var left = [], right = [];
        systems.forEach(function (ic, i) {
            var sd = ic.side;
            if (sd === 'right' || sd === 'bottom') { right.push(ic); }
            else if (sd === 'left') { left.push(ic); }
            else {
                /* 没有 side 信息：一半一半分，保证不会全堆在一列 */
                if (i < Math.ceil(systems.length / 2)) { left.push(ic); }
                else { right.push(ic); }
            }
        });

        var iconW = (RES.METRICS.desktopIconWidth || 84) * cap.autoScale;
        var topPad = 20;
        var bottomPad = 8;
        var labelH = grid;                       /* 图标 + 标签的完整高度（已含缩放） */
        var maxBottom = cap.height - bottomPad - labelH;

        function layoutColumn(list, xFn) {
            if (!list.length) { return; }
            var n = list.length;
            /* 步距下限 = 图标+标签实际高度，保证绝不重叠。
             * 空间不足时优先压缩到 labelH，仍不够就允许贴到底边，
             * 由绘制层负责把超出的图标裁掉（总比互相压住强）。 */
            var span = Math.max(labelH, maxBottom - topPad);
            var step = grid;
            if (n > 1) {
                step = Math.max(labelH, Math.min(grid, span / (n - 1)));
            }
            list.forEach(function (ic, i) {
                ic.x = xFn(1);
                ic.y = topPad + i * step;
                count++;
            });
        }

        layoutColumn(left, function () { return 20; });
        layoutColumn(right, function (scale) {
            /* 右侧列按缩放后的宽度贴右边 */
            var w2 = iconW * (scale || 1);
            return Math.max(20, cap.width - w2 - 20);
        });

        invalidate();
        emit('desktop:relayout', { count: count, perCol: cap.perCol, rowsFit: rowsFit });
        return CORE.ok(count);
    }

    /** LoadFromFolder(path) - populate icons from a real directory. */
    function LoadFromFolder(path) {
        return K.FindFiles(path).then(function (r) {
            if (r.status !== S.OK) { return r; }
            var grid = RES.METRICS.desktopGridSize;
            /* 用户文件从系统图标列的右侧开始排布，避免重叠 */
            var ORIGIN_X = 130;
            var ORIGIN_Y = 20;

            /* 按桌面实际大小计算每列能放几个图标。
             * 之前这里写死 /6，屏幕高度不够时第 5、6 个会掉到任务栏下面，
             * 列数多了也会顶出右边界。 */
            var cap = DesktopGrid();
            var perCol = cap.perCol;
            var maxCols = Math.max(1, cap.maxCols);
            var maxIcons = perCol * maxCols;

            var list = r.value.slice(0, maxIcons).map(function (e, i) {
                var col = Math.floor(i / perCol);
                var row = i % perCol;
                return {
                    id: e.path,
                    name: e.name,
                    path: e.path,
                    type: e.type === 'dir' ? 'dir' : 'file',
                    x: ORIGIN_X + col * grid,
                    y: ORIGIN_Y + row * grid
                };
            });
            SetIcons(list);
            return CORE.ok(list.length);
        });
    }

    /** AddIcon(icon) -> { status, value: icon } */
    function AddIcon(icon) {
        var list = state.icons.slice(0);
        list.push(icon);
        SetIcons(list);
        return CORE.ok(state.icons[state.icons.length - 1]);
    }

    /**
     * SetSystemIcons(list) - 注入/替换外壳提供的系统图标。
     *   系统图标放在最前面，并且不参与"从文件夹载入"的清空逻辑；
     *   它们的位置由外壳计算好后传进来（x/y）。
     */
    function SetSystemIcons(list) {
        if (!Array.isArray(list)) { return CORE.fail(S.EINVAL, { reason: '需要图标数组' }); }
        /* 保留已有的非系统图标（用户文件） */
        var users = state.icons.filter(function (ic) { return ic.type !== 'system'; });
        var systems = list.map(function (ic) {
            return {
                id: ic.id,
                name: ic.name || ic.text || ic.id,
                text: ic.text || ic.name || ic.id,
                icon: ic.icon || '📄',
                desc: ic.desc || '',
                type: 'system',
                systemId: ic.systemId || ic.id,
                appId: ic.appId || null,
                side: ic.side || 'left',
                row: typeof ic.row === 'number' ? ic.row : 0,
                path: null,
                x: ic.x,
                y: ic.y
            };
        });
        SetIcons(systems.concat(users));
        return CORE.ok(state.icons.length);
    }

    /** SurfaceElement() - 桌面画布的 DOM 元素（右键菜单定位用） */
    function SurfaceElement() {
        return state.surface ? state.surface.element : null;
    }

    /** GetIcon(id) -> icon | null */
    function GetIcon(id) {
        for (var i = 0; i < state.icons.length; i++) {
            if (state.icons[i].id === id) { return state.icons[i]; }
        }
        return null;
    }

    /** IconPositions() - for persistence by the desktop service. */
    function IconPositions() {
        /* 返回完整信息：只给 id/x/y 会让调用方（重排、测试、外壳）
         * 拿不到 name 和 type，无法区分系统图标与用户文件。 */
        return state.icons.map(function (ic) {
            return {
                id: ic.id,
                name: ic.name || ic.text || ic.id,
                text: ic.text || ic.name || ic.id,
                type: ic.type || (ic.systemId ? 'system' : 'file'),
                side: ic.side || null,
                path: ic.path || null,
                x: ic.x,
                y: ic.y
            };
        });
    }

    /** ApplyPositions(list) - restore persisted positions. */
    function ApplyPositions(list) {
        if (!Array.isArray(list)) { return CORE.fail(S.EINVAL, { reason: 'positions array required' }); }
        list.forEach(function (p) {
            var ic = GetIcon(p.id);
            if (ic && typeof p.x === 'number' && typeof p.y === 'number') {
                ic.x = p.x;
                ic.y = p.y;
            }
        });
        invalidate();
        return CORE.ok(true);
    }

    /* =================================================================
     * 3. Painting
     * ============================================================== */

    /**
     * wrapLabel(text, maxWidth, maxLines) -> string[]
     *   按真实像素宽度折行：优先在空格处断，中文按单字断。
     *   最后一行为超出时加省略号。
     */
    function wrapLabel(text, maxWidth, maxLines) {
        var s = String(text || '');
        if (!s) { return ['']; }
        /* 含空格的名字（英文）优先按词折行，保证单词不被打断 */
        if (s.indexOf(' ') > 0) {
            var words = s.split(' ');
            var ln = [];
            var cur2 = '';
            for (var wi = 0; wi < words.length; wi++) {
                var test2 = cur2 ? (cur2 + ' ' + words[wi]) : words[wi];
                if (test2.length > 8 && cur2) { ln.push(cur2); cur2 = words[wi]; }
                else { cur2 = test2; }
            }
            if (cur2) { ln.push(cur2); }
            if (ln.length <= maxLines) { return ln; }
        }
        var measure = function (str) {
            var m = ezn32.api.gdi.MeasureText ? ezn32.api.gdi.MeasureText(null, str) : null;
            /* MeasureText 需要 DC；退化为按字号估算 */
            var per = 12;
            var w = 0;
            for (var i2 = 0; i2 < str.length; i2++) {
                var code = str.charCodeAt(i2);
                w += (code > 0x2E80) ? per : Math.round(per * 0.62);
            }
            return w;
        };

        var lines = [];
        var cur = '';
        /* 优先在空格处断行（英文单词不拆开），中文按单字断行 */
        var lastSpace = -1;
        for (var i = 0; i < s.length; i++) {
            var ch = s.charAt(i);
            var test = cur + ch;
            if (measure(test) > maxWidth && cur.length) {
                if (lastSpace > 0) {
                    /* 回退到最后一个空格处断行 */
                    lines.push(cur.slice(0, lastSpace));
                    cur = cur.slice(lastSpace + 1) + ch;
                } else {
                    lines.push(cur);
                    cur = ch;
                }
                lastSpace = -1;
                if (lines.length === maxLines - 1) { break; }
            } else {
                cur = test;
                if (ch === ' ') { lastSpace = cur.length - 1; }
            }
        }
        if (cur.length) { lines.push(cur); }

        /* 超出行数则截断加省略号 */
        if (lines.length > maxLines) {
            lines = lines.slice(0, maxLines);
            lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
        } else if (lines.length === maxLines && measure(lines[lines.length - 1]) > maxWidth) {
            lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + '…';
        }
        return lines;
    }

    function paint(surface) {
        var t = RES.theme().value;
        /* wallpaper */
        var ctx = surface.dc.ctx;
        if (ctx && ctx.createLinearGradient) {
            var g = ctx.createLinearGradient(0, 0, surface.width, surface.height);
            g.addColorStop(0, t.desktopGradientStart || t.desktop);
            g.addColorStop(1, t.desktopGradientEnd || t.desktop);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, surface.width, surface.height);
        } else {
            GDI.FillRect(surface.dc, 0, 0, surface.width, surface.height, t.desktop);
        }

        /* icons —— 按 state.scale 缩放（小屏自动变小，避免重叠/越界） */
        var SC = state.scale || 1;
        var iconSize = Math.round(RES.METRICS.iconSize * SC);
        var labelW = Math.round(RES.METRICS.desktopIconLabelWidth * SC);
        GDI.SelectObject(surface.dc, RES.font('ui'));

        for (var i = 0; i < state.icons.length; i++) {
            var ic = state.icons[i];
            var sel = i === state.selected;
            var hover = i === state.hovered;

            var boxH = iconSize + 42;
            if (sel) {
                GDI.FillRect(surface.dc, ic.x - 4, ic.y - 4, labelW + 8, boxH, 'rgba(0,120,212,0.55)');
                GDI.DrawRect(surface.dc, ic.x - 4, ic.y - 4, labelW + 8, boxH, t.accent, 1);
            } else if (hover) {
                GDI.FillRect(surface.dc, ic.x - 4, ic.y - 4, labelW + 8, boxH, 'rgba(255,255,255,0.12)');
            }

            /* 图标 emoji：PTD 用 36px 字号、48px 容器，垂直居中 */
            var glyphFont = RES.font('iconDesktop') || RES.font('iconLarge');
            var glyphH = glyphFont.size;
            var glyphY = ic.y + Math.max(0, Math.round((iconSize - glyphH) / 2)) + 2;
            GDI.SelectObject(surface.dc, glyphFont);
            GDI.SetTextColor(surface.dc, '#FFFFFF');
            GDI.SetTextAlign(surface.dc, 'center');
            GDI.DrawText(surface.dc, ic.icon, ic.x + labelW / 2, glyphY, labelW);
            GDI.SetTextAlign(surface.dc, 'left');

            /* 名称：PTD 是 12px、居中、最多两行 */
            GDI.SelectObject(surface.dc, RES.font('ui'));
            GDI.SetTextColor(surface.dc, '#FFFFFF');
            GDI.SetTextAlign(surface.dc, 'center');
            var nameY = ic.y + iconSize + 6;
            var nm = String(ic.name || '');
            /* 用真实字宽测量，按空格 / 中文字符边界折行（对齐 PTD 的
               word-wrap: break-word），最多两行，超出用省略号。 */
            var lines = wrapLabel(nm, labelW + 8, 2);
            for (var li = 0; li < lines.length; li++) {
                GDI.DrawTextTruncated(surface.dc, lines[li],
                    ic.x + labelW / 2, nameY + li * 15, labelW);
            }
            GDI.SetTextAlign(surface.dc, 'left');
        }

        /* marquee selection */
        if (state.marquee) {
            var m = state.marquee;
            GDI.DrawRect(surface.dc, Math.min(m.x0, m.x1), Math.min(m.y0, m.y1),
                Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0), t.accent, 1);
        }

        /* empty-desktop hint */
        if (state.icons.length === 0) {
            GDI.SetTextColor(surface.dc, 'rgba(255,255,255,0.45)');
            GDI.SelectObject(surface.dc, RES.font('ui'));
            GDI.SetTextAlign(surface.dc, 'center');
            GDI.DrawText(surface.dc, '右键点击可打开菜单', surface.width / 2, surface.height / 2 - 8);
            GDI.SetTextAlign(surface.dc, 'left');
        }
    }

    function invalidate() {
        if (state.surface) { state.surface.invalidate(); }
    }

    /* =================================================================
     * 4. Hit testing
     * ============================================================== */

    function iconAt(x, y) {
        var iconSize = RES.METRICS.iconSize;
        var labelW = RES.METRICS.desktopIconLabelWidth;
        for (var i = state.icons.length - 1; i >= 0; i--) {
            var ic = state.icons[i];
            if (x >= ic.x - 4 && x < ic.x + labelW + 4 &&
                y >= ic.y - 4 && y < ic.y + iconSize + 30) {
                return i;
            }
        }
        return -1;
    }

    /* =================================================================
     * 5. Events
     * ============================================================== */

    function bindEvents() {
        var el = state.surface.element;
        function on(ev, fn) {
            var h = DOM.on(el, ev, fn);
            if (h.status === S.OK) { listeners.push(h.value); }
        }

        on('mousedown', function (ev) {
            var rect = el.getBoundingClientRect();
            var x = ev.clientX - rect.left;
            var y = ev.clientY - rect.top;
            var idx = iconAt(x, y);
            if (idx >= 0) {
                state.selected = idx;
                state.dragging = { index: idx, ox: x - state.icons[idx].x, oy: y - state.icons[idx].y, moved: false };
            } else {
                state.selected = -1;
                state.marquee = { x0: x, y0: y, x1: x, y1: y };
            }
            invalidate();
        });

        on('mousemove', function (ev) {
            var rect = el.getBoundingClientRect();
            var x = ev.clientX - rect.left;
            var y = ev.clientY - rect.top;
            if (state.dragging) {
                var ic = state.icons[state.dragging.index];
                if (ic) {
                    ic.x = Math.max(0, x - state.dragging.ox);
                    ic.y = Math.max(0, y - state.dragging.oy);
                    state.dragging.moved = true;
                    invalidate();
                }
                return;
            }
            if (state.marquee) {
                state.marquee.x1 = x;
                state.marquee.y1 = y;
                invalidate();
                return;
            }
            var hov = iconAt(x, y);
            if (hov !== state.hovered) {
                state.hovered = hov;
                invalidate();
            }
        });

        on('mouseup', function () {
            if (state.dragging) {
                state.dragging = null;
                emit('desktop:iconMoved', { positions: IconPositions() });
            }
            if (state.marquee) {
                state.marquee = null;
            }
            invalidate();
        });

        on('dblclick', function (ev) {
            var rect = el.getBoundingClientRect();
            var idx = iconAt(ev.clientX - rect.left, ev.clientY - rect.top);
            if (idx >= 0) { openIcon(idx); }
        });

        on('contextmenu', function (ev) {
            if (ev.preventDefault) { ev.preventDefault(); }
            var rect = el.getBoundingClientRect();
            var x = ev.clientX - rect.left;
            var y = ev.clientY - rect.top;
            var idx = iconAt(x, y);
            if (idx >= 0) { state.selected = idx; }
            if (state.onContext) {
                state.onContext({ x: x, y: y, index: idx, icon: idx >= 0 ? state.icons[idx] : null });
            }
            invalidate();
        });
    }

    function openIcon(index) {
        var ic = state.icons[index];
        if (!ic) { return CORE.fail(S.ENOENT, { reason: 'no icon at index' }); }
        /* 二选一，不能都执行：
         *   · 有 appId 的系统图标 -> 只启动应用
         *   · 用户文件（有 path）  -> 只交给外壳按关联打开
         * 之前先调 onOpen 再判 appId，其中 onOpen 内部已经会打开文件，
         * 于是同一次双击打开了两个窗口（一个空白、一个有内容）。 */
        if (ic.appId) {
            if (state.onOpen) {
                try { state.onOpen(ic); } catch (_) { /* ignore */ }
            }
            return SHELL.LaunchApplication(ic.appId);
        }
        if (state.onOpen) {
            try { return state.onOpen(ic); } catch (_) { /* ignore */ }
        }
        if (ic.path) {
            return SHELL.OpenFile(ic.path);
        }
        return CORE.ok(true);
    }

    function emit(topic, payload) {
        var s = (G.EznK.Kernel && G.EznK.Kernel.SRM) || G.SRM;
        if (s && typeof s.emit === 'function') { s.emit(topic, payload); }
    }

    /* =================================================================
     * 6. Lifecycle + queries
     * ============================================================== */

    function Get() { return state.surface; }
    function IsCreated() { return state.created; }
    function Selected() { return state.selected >= 0 ? state.icons[state.selected] : null; }

    function Resize() {
        if (!state.surface) { return CORE.fail(S.ENOENT, { reason: 'desktop not created' }); }
        var hostRes = DOM.byId('desktop');
        if (hostRes.status !== S.OK) { return hostRes; }
        var host = hostRes.value;
        return CANVAS.resize(state.surface, host.clientWidth, host.clientHeight);
    }

    function Destroy() {
        listeners.forEach(function (h) { DOM.off(h); });
        listeners = [];
        if (state.surface) { CANVAS.dispose(state.surface); }
        state.surface = null;
        state.created = false;
        state.icons = [];
        state.selected = -1;
        return CORE.ok(true);
    }

    var D = {};
    D.__isUiDesktop = true;
    D.version = '1.0.0';
    D.STATUS = S;

    D.Create = Create;
    D.SetIcons = SetIcons;
    D.AddIcon = AddIcon;
    D.GetIcon = GetIcon;
    D.LoadFromFolder = LoadFromFolder;
    D.DesktopGrid = DesktopGrid;
    D.RelayoutDesktop = RelayoutDesktop;
    D.IconPositions = IconPositions;
    D.ApplyPositions = ApplyPositions;
    D.SetSystemIcons = SetSystemIcons;
    D.SurfaceElement = SurfaceElement;
    D.Selected = Selected;
    D.Get = Get;
    D.IsCreated = IsCreated;
    D.Resize = Resize;
    D.Destroy = Destroy;
    D.invalidate = invalidate;

    G.ezn32.ui.Desktop = D;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    G.EZNT.ui.Desktop = D;
    LOG.info('js/ui/desktop.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
