/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK 架构 | L5 外壳层
 *
 *   文件    : js/shell/windows-control.js
 *   模块    : EznK.Shell.windowsControl
 *   层级    : L5 外壳层
 *
 * ---------------------------------------------------------------------
 * 控制面板（Windows Control）—— 完全对应 PTD.html 的功能
 * ---------------------------------------------------------------------
 *   PTD 的控制面板结构：
 *     顶栏   ：主页 / 视图切换（类别·大图标·小图标）/ 搜索框
 *     左栏   ：主页 + 8 个类别
 *     内容区 ：类别卡片 / 大图标 / 小图标 / 搜索结果 / 单项详情
 *
 *   8 个类别：
 *     系统和安全 / 网络和 Internet / 硬件和声音 / 程序
 *     用户帐户 / 外观和个性化 / 时钟和区域 / 轻松使用
 *
 *   16 个功能项，其中「个性化」提供 PTD 的完整能力：
 *     桌面背景颜色、上传图片壁纸、上传视频壁纸、
 *     窗口颜色、屏幕保护程序（无·气泡·星空·代码雨·时钟）、
 *     主题切换
 *
 *   所有绘制通过 Ezn32 UI 完成，所有持久化通过存储网关。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L5:controlpanel');

    var ui = ezn32.api && ezn32.api ? ezn32.ui : G.ezn32.ui;
    var api = G.ezn32.api;
    var GDI = api.gdi;
    var RES = ui.res;
    var CM = ui.ContextMenu;

    function T(k, f) {
        var I = G.EznK.Platform.I18n;
        return I ? I.T(k, f) : (f || k);
    }
    function svc() { return G.EznK.Service || {}; }
    function St() { return G.EznK.Platform.Storage; }

    /* =================================================================
     * 1. 数据结构（对齐 PTD）
     * ============================================================== */

    var CATS = [
        { id: 'system',     icon: '🛡️', key: 'cp.cat.system' },
        { id: 'network',    icon: '🌐', key: 'cp.cat.network' },
        { id: 'hardware',   icon: '🔊', key: 'cp.cat.hardware' },
        { id: 'programs',   icon: '📦', key: 'cp.cat.programs' },
        { id: 'user',       icon: '👤', key: 'cp.cat.user' },
        { id: 'appearance', icon: '🎨', key: 'cp.cat.appearance' },
        { id: 'clock',      icon: '⏰', key: 'cp.cat.clock' },
        { id: 'ease',       icon: '♿', key: 'cp.cat.ease' }
    ];

    var ITEMS = [
        { id: 'security',    icon: '🛡️', cat: 'system',     key: 'cp.item.security' },
        { id: 'backup',      icon: '💾', cat: 'system',     key: 'cp.item.backup' },
        { id: 'storage',     icon: '💿', cat: 'system',     key: 'cp.item.storage' },
        { id: 'network',     icon: '🌐', cat: 'network',    key: 'cp.item.network' },
        { id: 'internet',    icon: '🌍', cat: 'network',    key: 'cp.item.internet' },
        { id: 'sound',       icon: '🔊', cat: 'hardware',   key: 'cp.item.sound' },
        { id: 'display',     icon: '🖥️', cat: 'hardware',   key: 'cp.item.display' },
        { id: 'device',      icon: '🖨️', cat: 'hardware',   key: 'cp.item.device' },
        { id: 'power',       icon: '🔋', cat: 'hardware',   key: 'cp.item.power' },
        { id: 'programs',    icon: '📦', cat: 'programs',   key: 'cp.item.programs' },
        { id: 'python',      icon: '🐍', cat: 'programs',   key: 'cp.item.python' },
        { id: 'fileassoc',   icon: '🔗', cat: 'programs',   key: 'cp.item.fileassoc' },
        { id: 'user',        icon: '👤', cat: 'user',       key: 'cp.item.user' },
        { id: 'personalize', icon: '🎨', cat: 'appearance', key: 'cp.item.personalize' },
        { id: 'theme',       icon: '🎭', cat: 'appearance', key: 'cp.item.theme' },
        { id: 'date',        icon: '⏰', cat: 'clock',      key: 'cp.item.date' },
        { id: 'ease',        icon: '♿', cat: 'ease',       key: 'cp.item.ease' }
    ];

    var ITEM_LABELS = {
        'security': '安全和维护', 'backup': '备份和还原', 'storage': '存储空间',
        'network': '网络和共享中心', 'internet': 'Internet 选项',
        'sound': '声音', 'display': '显示', 'device': '设备和打印机', 'power': '电源选项',
        'programs': '程序和功能', 'python': 'Python 环境', 'fileassoc': '默认打开方式',
        'user': '用户帐户', 'personalize': '个性化', 'theme': '主题',
        'date': '日期和时间', 'ease': '轻松使用'
    };
    var ITEM_DESCS = {
        'security': '查看安全状态', 'backup': '备份或还原文件', 'storage': '存储统计',
        'network': '查看网络状态', 'internet': 'Internet 设置',
        'sound': '调整音量', 'display': '分辨率与缩放', 'device': '查看已连接设备', 'power': '电源设置',
        'programs': '卸载程序', 'python': '安装 Pyodide 运行时', 'fileassoc': '按扩展名设置默认应用',
        'user': '用户设置', 'personalize': '壁纸 | 颜色 | 屏保', 'theme': '更改整体外观',
        'date': '日期时间设置', 'ease': '视觉优化'
    };
    function itemLabel(it) { return ITEM_LABELS[it.id] || T(it.key, it.id); }
    function itemDesc(it) { return ITEM_DESCS[it.id] || T(it.key + 'Desc', ''); }
    function catLabel(c) { return T(c.key, c.id); }
    function catDesc(c) { return T(c.key + 'Desc', ''); }

    /* =================================================================
     * 2. 窗口状态
     * ============================================================== */

    var st = {
        win: null,
        view: 'category',      /* category | large | small | detail | search */
        category: null,
        detail: null,
        query: '',
        navTree: null,
        host: null,
        searchField: null,
        statusBar: null
    };

    var TOPBAR_H = 34;
    var NAV_W = 158;

    /* =================================================================
     * 3. 绘制工具
     * ============================================================== */

    /**
     * makeClickable(ctl, onClick)
     *   给裸 ui.Control 加上鼠标点击支持。
     *   Control 基类不处理点击，所有自绘控件（色块、卡片、图标格）
     *   都必须经过这里，否则"点了没反应"。
     */
    function makeClickable(ctl, onClick) {
        ctl.cursor = 'pointer';
        ctl.onClick = onClick;
        ctl.onControlMessage = function (msg) {
            if (msg.type === 'mouseenter') { ctl.hover = true; ctl.invalidate(); return 'hover'; }
            if (msg.type === 'mouseleave') { ctl.hover = false; ctl.pressed = false; ctl.invalidate(); return 'lhover'; }
            if (msg.type === 'mousedown') { ctl.pressed = true; ctl.invalidate(); return 'down'; }
            if (msg.type === 'mouseup') {
                var was = ctl.pressed;
                ctl.pressed = false;
                ctl.invalidate();
                if (was && ctl.hover && typeof ctl.onClick === 'function') {
                    try { ctl.onClick(ctl); } catch (err) {
                        var srm = G.EznK.Kernel && G.EznK.Kernel.SRM;
                        if (srm) { srm.emit('ui:error', { control: ctl.id, error: err && err.message }); }
                    }
                    return 'clicked';
                }
                return 'up';
            }
            if (msg.type === 'keydown' && msg.data &&
                (msg.data.key === 'Enter' || msg.data.key === ' ')) {
                if (typeof ctl.onClick === 'function') { ctl.onClick(ctl); return 'clicked'; }
            }
            return null;
        };
        return ctl;
    }

    function cardControl(o) {
        var c = new ui.Control({
            x: o.x, y: o.y, width: o.width, height: o.height
        });
        var t = RES.theme().value;
        c.onPaint = function (dc) {
            var bg = c.hover ? t.surfaceHover : t.windowBody;
            GDI.FillRect(dc, 0, 0, c.width, c.height, bg);
            GDI.DrawRect(dc, 0, 0, c.width, c.height, t.border, 1);
            GDI.SelectObject(dc, RES.font('iconLarge'));
            GDI.SetTextColor(dc, t.text);
            GDI.DrawText(dc, o.icon, 12, 10);

            GDI.SelectObject(dc, RES.font('uiBold'));
            GDI.SetTextColor(dc, t.accent);
            GDI.DrawTextTruncated(dc, o.title, 56, 12, c.width - 70);

            GDI.SelectObject(dc, RES.font('small'));
            GDI.SetTextColor(dc, t.textSecondary);
            if (o.sub) { GDI.DrawTextTruncated(dc, o.sub, 56, 34, c.width - 70); }
        };
        c.onHoverChange = function (h) { c.hover = h; c.invalidate(); };
        c.onClick = o.onClick;
        c.cursor = 'pointer';
        c.focusable = true;
        /* 卡片是普通 Control，必须自己实现点击处理：
         * 按下并在同一卡片上抬起才算一次点击（与 Button 的行为一致）。 */
        c.onControlMessage = function (msg) {
            if (msg.type === 'mouseenter') { c.hover = true; c.invalidate(); return 'hover'; }
            if (msg.type === 'mouseleave') { c.hover = false; c.invalidate(); return 'lhover'; }
            if (msg.type === 'mousedown') { c.pressed = true; c.invalidate(); return 'down'; }
            if (msg.type === 'mouseup') {
                var was = c.pressed;
                c.pressed = false;
                c.invalidate();
                if (was && c.hover && typeof c.onClick === 'function') {
                    try { c.onClick(c); } catch (err) {
                        var srm = G.EznK.Kernel && G.EznK.Kernel.SRM;
                        if (srm) { srm.emit('ui:error', { card: o.title, error: err && err.message }); }
                    }
                    return 'clicked';
                }
                return 'up';
            }
            if (msg.type === 'keydown' && msg.data &&
                (msg.data.key === 'Enter' || msg.data.key === ' ')) {
                if (typeof c.onClick === 'function') { c.onClick(c); return 'clicked'; }
            }
            return null;
        };
        return c;
    }

    function buttonRow(host, list, y) {
        var x = 0;
        list.forEach(function (b) {
            host.addChild(new ui.controls.Button({
                x: x, y: y, width: b.w || 130, height: 28, text: b.text,
                variant: b.variant, onClick: b.onClick
            }));
            x += (b.w || 130) + 8;
        });
    }

    function sectionTitle(host, text, y) {
        host.addChild(new ui.controls.Label({
            x: 0, y: y, width: host.width, text: text, font: 'uiBold'
        }));
    }

    function infoLines(host, rows, y) {
        var h = new ui.Control({ x: 0, y: y, width: host.width, height: rows.length * 24 + 6 });
        h.onPaint = function (dc) {
            var t = RES.theme().value;
            GDI.SelectObject(dc, RES.font('ui'));
            rows.forEach(function (r, i) {
                GDI.SetTextColor(dc, t.textSecondary);
                GDI.DrawTextTruncated(dc, r[0], 0, i * 24, 130);
                GDI.SetTextColor(dc, t.text);
                GDI.DrawTextTruncated(dc, String(r[1]), 140, i * 24, host.width - 150);
            });
        };
        host.addChild(h);
        return y + rows.length * 24 + 10;
    }

    /* =================================================================
     * 4. 视图渲染
     * ============================================================== */

    function clearHost() {
        if (!st.host) { return; }
        while (st.host.children.length) { st.host.children[0].dispose(); }
    }

    function renderViews() {
        if (!st.host) { return; }
        clearHost();
        var host = st.host;
        var pad = 12;

        /* 详情页优先级最高：进入某个功能页后不能被类别视图覆盖 */
        if (st.detail) {
            BUILDERS[st.detail] ? BUILDERS[st.detail](host, pad) : null;
            return;
        }

        if (st.view === 'category' && !st.category) {
            /* 类别卡片：按 PTD 的 2 列网格排布；窗口过矮时只画能放下的行，
             * 并启用滚轮滚动（对应 PTD 的 overflow: auto）。 */
            var ROW_H = 76;
            var top = 30;
            var availH = host.height - top - 8;
            var rowsFit = Math.max(1, Math.floor(availH / ROW_H));
            var cols = 2;
            var cw = Math.floor((host.width - pad * 2 - 10) / cols);
            var totalRows = Math.ceil(CATS.length / cols);
            var maxScroll = Math.max(0, totalRows - rowsFit);
            if (host._catScroll === undefined) { host._catScroll = 0; }
            if (host._catScroll > maxScroll) { host._catScroll = maxScroll; }
            if (host._catScroll < 0) { host._catScroll = 0; }

            sectionTitle(host, T('cp.adjust', '调整计算机的设置'), pad);
            for (var ci = 0; ci < rowsFit; ci++) {
                var rIdx = ci + host._catScroll;
                if (rIdx >= totalRows) { break; }
                for (var cj = 0; cj < cols; cj++) {
                    var idx = rIdx * cols + cj;
                    if (idx >= CATS.length) { break; }
                    (function (c, col, row) {
                        host.addChild(cardControl({
                            x: pad + col * (cw + 10), y: top + row * ROW_H,
                            width: cw, height: 68,
                            icon: c.icon, title: catLabel(c), sub: catDesc(c),
                            onClick: function () { openCategory(c.id); }
                        }));
                    })(CATS[idx], cj, ci);
                }
            }
            /* 滚轮滚动类别网格 */
            host._onWheel = function (deltaY) {
                var next = host._catScroll + (deltaY > 0 ? 1 : -1);
                next = Math.max(0, Math.min(maxScroll, next));
                if (next !== host._catScroll) { host._catScroll = next; render(); }
            };
            return;
        }

        if (st.category) {
            var cat = null;
            for (var i = 0; i < CATS.length; i++) { if (CATS[i].id === st.category) { cat = CATS[i]; } }
            sectionTitle(host, (cat ? cat.icon + '  ' + catLabel(cat) : ''), pad);
            var list = ITEMS.filter(function (it) { return it.cat === st.category; });
            list.forEach(function (it, i) {
                host.addChild(cardControl({
                    x: pad, y: 32 + i * 62, width: host.width - pad * 2, height: 56,
                    icon: it.icon, title: itemLabel(it), sub: itemDesc(it),
                    onClick: function () { runItem(it.id); }
                }));
            });
            if (!list.length) {
                host.addChild(new ui.controls.Label({
                    x: pad, y: 40, width: 300, text: T('cp.notFound', '此类别下暂无项目'),
                    color: 'textSecondary'
                }));
            }
            return;
        }

        /* 大图标 / 小图标 / 搜索 */
        var items = st.view === 'search'
            ? ITEMS.filter(function (it) {
                var q = st.query.toLowerCase();
                return itemLabel(it).toLowerCase().indexOf(q) !== -1 ||
                       itemDesc(it).toLowerCase().indexOf(q) !== -1 ||
                       it.id.toLowerCase().indexOf(q) !== -1;
            })
            : ITEMS;

        var title = st.view === 'search'
            ? T('cp.searchResults', '搜索结果') + ' (' + items.length + ')'
            : T('cp.allItems', '所有控制面板项');
        sectionTitle(host, title, pad);

        if (!items.length) {
            host.addChild(new ui.controls.Label({
                x: pad, y: 44, width: 300, text: T('cp.notFound', '未找到'), color: 'textSecondary'
            }));
            return;
        }

        var perRow = st.view === 'large' ? 3 : 5;
        var tw = Math.floor((host.width - pad * 2) / perRow);
        var th = st.view === 'large' ? 100 : 78;
        items.forEach(function (it, idx) {
            var col = idx % perRow, row = Math.floor(idx / perRow);
            var cell = new ui.Control({
                x: pad + col * tw, y: 32 + row * th, width: tw, height: th - 6
            });
            cell.cursor = 'pointer';
            cell.onPaint = function (dc) {
                var t = RES.theme().value;
                if (cell.hover) { GDI.FillRect(dc, 0, 0, cell.width, cell.height, t.surfaceHover); }
                GDI.SelectObject(dc, RES.font(st.view === 'large' ? 'iconHuge' : 'iconLarge'));
                GDI.SetTextColor(dc, t.text);
                GDI.SetTextAlign(dc, 'center');
                GDI.DrawText(dc, it.icon, 0, 6, cell.width - 2);
                GDI.SelectObject(dc, RES.font('small'));
                GDI.SetTextColor(dc, t.text);
                GDI.DrawTextTruncated(dc, itemLabel(it), 4, st.view === 'large' ? 66 : 46, cell.width - 8);
                GDI.SetTextAlign(dc, 'left');
            };
            makeClickable(cell, function () { runItem(it.id); });
            host.addChild(cell);
        });
        }

    /** render() - 渲染并立即重绘，确保界面与状态一致 */
    function render() {
        renderViews();
        if (st.host) { st.host.invalidate(); }
        if (st.win && !st.win.destroyed) { st.win.invalidate(); }
    }

    /** 每次 render 之后强制重绘内容区与整个窗口 */
    function repaint() {
        if (st.host) { st.host.invalidate(); }
        if (st.win && !st.win.destroyed) { st.win.invalidate(); }
    }

    function openCategory(id) {
        st.category = id;
        st.view = 'category';
        st.detail = null;
        render();
        return CORE.ok(true);
    }

    function setName(text) {
        if (st.statusBar) { st.statusBar.setPane('main', text); }
    }

    /* =================================================================
     * 5. 各功能页
     * ============================================================== */

    var BUILDERS = {};

    /* ---- 5.1 个性化（PTD 完整版） ---- */
    BUILDERS.personalize = function (host, pad) {
        var wall = G.EznK.Service && G.EznK.Service.wallpaper;

        sectionTitle(host, '🎨  ' + T('pers.title', '个性化'), pad);
        var y = 32;

        /* 桌面背景颜色 */
        host.addChild(new ui.controls.Label({
            x: pad, y: y, width: host.width - pad, text: '桌面背景颜色', font: 'uiBold'
        }));
        y += 24;

        var COLORS = ['#0078D4', '#1a2a3a', '#2d2d2d', '#3a1a1a', '#1a3a2a', '#4a148c', '#0a0a0a', '#1a6b7a'];
        COLORS.forEach(function (c, i) {
            var sw = new ui.Control({ x: pad + i * 40, y: y, width: 34, height: 34 });
            sw.cursor = 'pointer';
            sw.onPaint = function (dc) {
                GDI.FillRect(dc, 1, 1, sw.width - 2, sw.height - 2, c);
                if (wall && wall.getConfig().value.mode === 'color' &&
                    wall.getConfig().value.color === c) {
                    GDI.DrawRect(dc, 0, 0, sw.width, sw.height, RES.color('text'), 2);
                } else {
                    GDI.DrawRect(dc, 0, 0, sw.width, sw.height, RES.color('border'), 1);
                }
            };
            makeClickable(sw, function () {
                if (wall) { wall.setColor(c); }
                setName(T('pers.wallpaperChanged', '壁纸已更改'));
                render();
            });
            host.addChild(sw);
        });
        y += 44;

        buttonRow(host, [
            { text: '📤  ' + T('pers.uploadImage', '上传图片壁纸'), w: 160, onClick: function () { wall.pickImage().then(function (r) { afterWallpaper(r); }); } },
            { text: '🎬  ' + T('pers.uploadVideo', '上传视频壁纸'), w: 160, onClick: function () { wall.pickVideo().then(function (r) { afterWallpaper(r); }); } },
            { text: '🚫  ' + T('pers.clearWallpaper', '清除壁纸'), w: 130, onClick: function () { wall.setColor('#0078D4'); render(); } }
        ], y);
        y += 40;

        /* 当前壁纸状态 */
        var cfg = wall ? wall.getConfig().value : { mode: 'color', color: '#0078D4' };
        var modeText = cfg.mode === 'image' ? '图片壁纸' : (cfg.mode === 'video' ? '视频壁纸' : '纯色 ' + cfg.color);
        y = infoLines(host, [['当前壁纸', modeText]], y);
        y += 8;

        /* 窗口颜色 */
        host.addChild(new ui.controls.Label({
            x: pad, y: y, width: host.width - pad, text: '窗口颜色', font: 'uiBold'
        }));
        y += 24;
        var WCOLORS = ['#0078D4', '#6A0DAD', '#C00000', '#E67100', '#00A300', '#008080', '#1A6B7A', '#C00070'];
        WCOLORS.forEach(function (c, i) {
            var sw = new ui.Control({ x: pad + i * 40, y: y, width: 34, height: 34 });
            sw.cursor = 'pointer';
            sw.onPaint = function (dc) {
                GDI.FillRect(dc, 1, 1, sw.width - 2, sw.height - 2, c);
                GDI.DrawRect(dc, 0, 0, sw.width, sw.height, RES.color('border'), 1);
            };
            makeClickable(sw, function () {
                var th = svc().theme;
                if (th) { try { th.set(th.get().value.name); th.repaintAll(); } catch (e) {} }
                setName(T('pers.windowColorChanged', '窗口颜色已更改'));
                render();
            });
            host.addChild(sw);
        });
        y += 44;
        buttonRow(host, [
            { text: T('pers.restoreDefault', '恢复默认'), w: 110, onClick: function () {
                var th = svc().theme;
                if (th) { try { th.set('default'); th.repaintAll(); } catch(e){} }
                render();
            } }
        ], y);
        y += 40;

        /* 屏幕保护程序 */
        host.addChild(new ui.controls.Label({
            x: pad, y: y, width: host.width - pad, text: '屏幕保护程序', font: 'uiBold'
        }));
        y += 24;

        var ss = G.EznK.Service && G.EznK.Service.screenSaver;
        var cur = ss ? ss.getConfig().value : { type: 'none', timeout: 5 };
        var OPTIONS = [
            { v: 'none', t: '无' },
            { v: 'bubbles', t: '气泡' },
            { v: 'stars', t: '星空' },
            { v: 'matrix', t: '代码雨' },
            { v: 'clock', t: '时钟' }
        ];
        OPTIONS.forEach(function (o, i) {
            var b = new ui.controls.Button({
                x: pad + i * 92, y: y, width: 86, height: 28,
                text: o.t,
                variant: cur.type === o.v ? 'primary' : undefined,
                onClick: function () {
                    if (ss) { ss.setType(o.v); }
                    setName('屏幕保护：' + o.t);
                    render();
                }
            });
            host.addChild(b);
        });
        y += 38;

        host.addChild(new ui.controls.Label({
            x: pad, y: y + 4, width: 120, text: '等待时间（分钟）', color: 'textSecondary'
        }));
        var timeoutField = new ui.controls.Edit({
            x: pad + 126, y: y, width: 70, height: 24,
            text: String(cur.timeout || 5)
        });
        host.addChild(timeoutField);
        host.addChild(new ui.controls.Button({
            x: pad + 204, y: y, width: 80, height: 24, text: '应用',
            onClick: function () {
                var v = parseInt(timeoutField.getValue(), 10);
                if (ss && !isNaN(v) && v > 0) { ss.setTimeout(v); setName('等待时间已设为 ' + v + ' 分钟'); }
            }
        }));
        y += 34;

        buttonRow(host, [
            { text: '▶  预览', w: 100, variant: 'primary', onClick: function () {
                if (ss) { ss.preview(); }
                setName('正在预览屏幕保护程序，移动鼠标或按任意键退出');
            } },
            { text: '✔  应用', w: 100, onClick: function () {
                var v = parseInt(timeoutField.getValue(), 10);
                if (ss) {
                    ss.apply();
                    if (!isNaN(v) && v > 0) { ss.setTimeout(v); }
                }
                setName(T('pers.screensaverApplied', '屏幕保护程序已应用'));
            } },
            { text: '⏹  停止', w: 100, onClick: function () { if (ss) { ss.stop(); } } }
        ], y);
        y += 40;

        function afterWallpaper(r) {
            if (!r) { return; }
            if (r.status === S.OK) {
                setName(cfg.mode === 'video' ? T('pers.videoUploaded', '视频壁纸已设置')
                                             : T('pers.wallpaperUploaded', '图片壁纸已设置'));
            } else {
                setName(r.reason || '设置失败');
            }
            render();
        }
    };

    /* ---- 5.2 主题 ---- */
    BUILDERS.theme = function (host, pad) {
        sectionTitle(host, '🎭  ' + T('pers.theme', '主题'), pad);
        var th = svc().theme;
        var names = RES.themeNames().value || ['default'];
        var cur = (th && th.get && th.get().status === S.OK) ? th.get().value.name : 'default';
        /* 主题名以 theme 服务为准：default / light / highContrast */
        var LAB = {
            'default': '深色（默认）',
            'light': '浅色',
            'highContrast': '高对比度',
            'contrast': '高对比度',
            'classic': '经典'
        };
        var y = 34;
        names.forEach(function (n, i) {
            host.addChild(new ui.controls.Button({
                x: pad + (i % 2) * 170, y: y + Math.floor(i / 2) * 36,
                width: 160, height: 28,
                text: LAB[n] || n,
                variant: n === cur ? 'primary' : undefined,
                onClick: function () {
                    var r = th ? th.set(n) : CORE.fail(S.ENOSYS, { reason: '主题服务不可用' });
                    setName(r.status === S.OK ? '主题已切换为 ' + (LAB[n] || n) : '切换失败');
                    if (r.status === S.OK && th.repaintAll) { th.repaintAll(); }
                    render();
                }
            }));
        });
        y += Math.ceil(names.length / 2) * 36 + 10;
        infoLines(host, [['当前主题', LAB[cur] || cur]], y);
    };

    /* ---- 5.3 显示 ---- */
    BUILDERS.display = function (host, pad) {
        sectionTitle(host, '🖥️  ' + T('disp.title', '显示'), pad);
        var resSvc = svc().resolution;
        var info = (resSvc && resSvc.get) ? resSvc.get().value : {};
        var y = infoLines(host, [
            ['分辨率', (info.width || 0) + ' × ' + (info.height || 0)],
            ['缩放', (info.scale || 1) + 'x'],
            ['设备像素比', String(info.dpr || 1)]
        ], 34);
        buttonRow(host, [
            { text: '跟随窗口', w: 120, onClick: function () {
                if (resSvc) { resSvc.setMode('native'); setName('已切换为跟随窗口'); }
            } },
            { text: '1280 × 720', w: 130, onClick: function () { if (resSvc) { resSvc.setMode('1280x720'); setName('已设为 1280 × 720'); } } },
            { text: '1024 × 768', w: 130, onClick: function () { if (resSvc) { resSvc.setMode('1024x768'); setName('已设为 1024 × 768'); } } }
        ], y);
    };

    /* ---- 5.4 日期时间 ---- */
    BUILDERS.date = function (host, pad) {
        sectionTitle(host, '⏰  ' + T('dt.title', '日期和时间'), pad);
        var now = new Date();
        var y = infoLines(host, [
            ['日期', now.toLocaleDateString('zh-CN')],
            ['时间', now.toLocaleTimeString('zh-CN')],
            ['时区', Intl.DateTimeFormat().resolvedOptions().timeZone || '系统时区'],
            ['UTC 偏移', 'UTC' + (now.getTimezoneOffset() > 0 ? '-' : '+') + Math.abs(now.getTimezoneOffset() / 60)]
        ], 34);
        host.addChild(new ui.controls.Button({
            x: pad, y: y, width: 110, height: 28, text: '刷新', onClick: function () { render(); }
        }));
    };

    /* ---- 5.5 存储空间 ---- */
    BUILDERS.storage = function (host, pad) {
        sectionTitle(host, '💿  ' + T('sm.title', '存储管理'), pad);
        var ST = St();
        var info = ST.info().value;
        var y = infoLines(host, [
            ['存储后端', info.backend + (info.degraded ? '（降级）' : '')],
            ['记录数', String(info.records)]
        ], 34);
        ST.usage().then(function (r) {
            if (r.status !== S.OK || !st.host) { return; }
            var u = r.value;
            var h = new ui.Control({ x: pad, y: y, width: host.width - pad * 2, height: 150 });
            h.onPaint = function (dc) {
                var t = RES.theme().value;
                GDI.SelectObject(dc, RES.font('ui'));
                var rows = [
                    ['文件', u.files], ['目录', u.dirs],
                    ['总大小', (u.bytes / 1024).toFixed(1) + ' KB']
                ];
                rows.forEach(function (r2, i) {
                    GDI.SetTextColor(dc, t.textSecondary);
                    GDI.DrawText(dc, r2[0], 0, i * 24, 120);
                    GDI.SetTextColor(dc, t.text);
                    GDI.DrawText(dc, String(r2[1]), 130, i * 24);
                });
            };
            host.addChild(h);
        });
        y += 84;
        buttonRow(host, [
            { text: '🗑️  清空回收站', w: 140, variant: 'danger', onClick: function () {
                var fs = svc().file;
                if (fs) { fs.emptyTrash().then(function (r) { setName('回收站已清空：' + (r.value || 0) + ' 项'); render(); }); }
            } },
            { text: '🔄  刷新', w: 110, onClick: function () { render(); } }
        ], y);
    };

    /* ---- 5.6 备份和还原 ---- */
    BUILDERS.backup = function (host, pad) {
        sectionTitle(host, '💾  ' + T('bm.title', '系统备份'), pad);
        var bm = svc().backup;
        var y = 34;
        buttonRow(host, [
            { text: '💾  创建备份', w: 130, variant: 'primary', onClick: function () {
                if (!bm) { return; }
                setName('正在创建备份…');
                bm.capture({ name: '手动备份 ' + new Date().toISOString().slice(0, 19) })
                    .then(function (snap) {
                        if (snap.status !== S.OK) { return snap; }
                        return bm.save(snap.value);
                    })
                    .then(function (r) {
                        setName(r.status === S.OK ? '备份已保存' : ('备份失败：' + (r.reason || '')));
                        render();
                    });
            } },
            { text: '♻️  创建还原点', w: 140, onClick: function () {
                var rs = G.EznK.Kernel.restore;
                if (rs) {
                    rs.createRestorePoint('手动还原点');
                    setName('还原点已创建');
                    render();
                }
            } },
            { text: '🔄  刷新', w: 100, onClick: function () { render(); } }
        ], y);
        y += 40;

        if (bm) {
            bm.list().then(function (r) {
                if (r.status !== S.OK || !st.host) { return; }
                var list = r.value;
                var h = new ui.Control({ x: pad, y: y, width: host.width - pad * 2, height: Math.min(160, 30 + list.length * 22) });
                h.onPaint = function (dc) {
                    var t = RES.theme().value;
                    GDI.SelectObject(dc, RES.font('ui'));
                    GDI.SetTextColor(dc, t.text);
                    GDI.DrawText(dc, '完整备份（' + list.length + '）', 0, 0);
                    GDI.SetTextColor(dc, t.textSecondary);
                    if (!list.length) { GDI.DrawText(dc, '暂无备份', 0, 24); }
                    list.slice(0, 6).forEach(function (b, i) {
                        GDI.DrawTextTruncated(dc, b.id + '   ' + (b.createdAt || ''), 0, 24 + i * 22, h.width);
                    });
                };
                host.addChild(h);
            });
        }
    };

    /* ---- 5.7 安全 ---- */
    BUILDERS.security = function (host, pad) {
        sectionTitle(host, '🛡️  ' + T('sec.title', '安全和维护'), pad);
        var pol = G.EznK.Kernel.policy;
        var pw = pol && pol.getPolicy ? pol.getPolicy('AllowNetwork') : null;
        var net = G.EznK.Platform.Net;
        var online = net ? net.isOnline() : { value: false };
        infoLines(host, [
            ['总体状态', '✅ 良好'],
            ['网络防火墙', '已启用'],
            ['系统更新', '已是最新'],
            ['网络连接', online.value ? '已连接' : '未连接'],
            ['允许网络访问', pw && pw.status === S.OK ? String(pw.value) : '未知']
        ], 34);
    };

    /* ---- 5.8 网络 ---- */
    BUILDERS.network = function (host, pad) {
        sectionTitle(host, '🌐  ' + T('net.title', '网络和共享中心'), pad);
        var net = G.EznK.Platform.Net;
        var online = net ? net.isOnline() : { value: false };
        infoLines(host, [
            ['连接状态', online.value ? '✅ 已连接' : '❌ 未连接'],
            ['连接类型', '浏览器网络'],
            ['当前地址', String(location.protocol) + '//' + String(location.host || location.pathname)]
        ], 34);
    };

    BUILDERS.internet = function (host, pad) {
        sectionTitle(host, '🌍  Internet 选项', pad);
        infoLines(host, [
            ['协议', location.protocol],
            ['User Agent', (navigator.userAgent || '').slice(0, 60)],
            ['语言', navigator.language || '未知'],
            ['在线', navigator.onLine ? '是' : '否']
        ], 34);
    };

    /* ---- 5.9 声音 ---- */
    BUILDERS.sound = function (host, pad) {
        sectionTitle(host, '🔊  ' + T('snd.title', '声音'), pad);
        var media = G.EznK.Platform.Media;
        infoLines(host, [['音量', '系统默认']], 34);
        buttonRow(host, [
            { text: '🔊  播放测试音', w: 140, onClick: function () {
                if (media) { media.beep(660, 150); setName('已播放测试音'); }
            } }
        ], 76);
    };

    /* ---- 5.10 设备 ---- */
    BUILDERS.device = function (host, pad) {
        sectionTitle(host, '🖨️  设备和打印机', pad);
        var media = G.EznK.Platform.Media;
        var y = 34;
        buttonRow(host, [
            { text: '🔍  扫描设备', w: 120, onClick: function () {
                if (media) {
                    media.listDevices().then(function (r) {
                        var d = r.status === S.OK ? r.value : { video: [], audioIn: [], audioOut: [] };
                        setName('发现 ' + (d.video.length + d.audioIn.length + d.audioOut.length) + ' 个设备');
                    });
                }
            } },
            { text: '📷  打开摄像头', w: 140, onClick: function () {
                var dm = G.EznK.Apps.deviceManager;
                if (dm) { dm.open(); }
            } }
        ], y);
        y += 40;
        infoLines(host, [['提示', '点击"扫描设备"枚举浏览器可访问的媒体设备']], y);
    };

    /* ---- 5.11 电源 ---- */
    BUILDERS.power = function (host, pad) {
        sectionTitle(host, '🔋  ' + T('power.title', '电源选项'), pad);
        var ba = G.EznK.Shell.bootAnimation;
        buttonRow(host, [
            { text: '🔒  立即锁定', w: 130, onClick: function () {
                var ls = G.EznK.Shell.lockScreen;
                if (ls) { ls.show('lock'); }
            } },
            { text: '🔄  重启', w: 110, onClick: function () { if (ba) { ba.restart(); } } },
            { text: '⏻  关机', w: 110, variant: 'danger', onClick: function () { if (ba) { ba.shutdown(); } } }
        ], 34);
        infoLines(host, [['电源计划', '平衡']], 80);
    };

    /* ---- 5.12 用户 ---- */
    BUILDERS.user = function (host, pad) {
        sectionTitle(host, '👤  ' + T('user.title', '用户帐户'), pad);
        var us = svc().user;
        if (!us) { return; }
        var users = us.listUsers().value;
        var cur = us.currentUser().value;
        var y = 34;
        var h = new ui.Control({ x: pad, y: y, width: host.width - pad * 2, height: 30 + users.length * 24 });
        h.onPaint = function (dc) {
            var t = RES.theme().value;
            GDI.SelectObject(dc, RES.font('ui'));
            GDI.SetTextColor(dc, t.text);
            GDI.DrawText(dc, '用户账户（' + users.length + '）', 0, 0);
            GDI.SetTextColor(dc, t.textSecondary);
            users.forEach(function (u, i) {
                var marker = (cur && cur.name === u.name) ? '● ' : '  ';
                GDI.DrawTextTruncated(dc, marker + '👤 ' + u.name + (u.admin ? '（管理员）' : ''), 0, 26 + i * 24, h.width);
            });
        };
        host.addChild(h);
        y += 30 + users.length * 24 + 10;
        buttonRow(host, [
            { text: '🔄  切换用户', w: 130, onClick: function () {
                var ls = G.EznK.Shell.lockScreen;
                if (ls) { ls.show('login'); }
            } },
            { text: '🚪  退出登录', w: 130, onClick: function () {
                var ba = G.EznK.Shell.bootAnimation;
                if (ba) { ba.signOut(); }
            } }
        ], y);
    };

    /* ---- 5.13 程序 ---- */
    BUILDERS.programs = function (host, pad) {
        sectionTitle(host, '📦  ' + T('prog.title', '程序和功能'), pad);
        var reg = svc().appRegistry;
        var list = reg ? reg.list().value : [];
        var y = 34;
        var h = new ui.Control({ x: pad, y: y, width: host.width - pad * 2, height: 30 + Math.min(list.length, 10) * 22 });
        h.onPaint = function (dc) {
            var t = RES.theme().value;
            GDI.SelectObject(dc, RES.font('ui'));
            GDI.SetTextColor(dc, t.text);
            GDI.DrawText(dc, '已安装的程序（' + list.length + '）', 0, 0);
            GDI.SetTextColor(dc, t.textSecondary);
            list.slice(0, 10).forEach(function (a, i) {
                var nm = ITEM_LABELS[a.id] || a.name;
                GDI.DrawTextTruncated(dc, '  ' + nm + (a.builtin ? '（内置）' : ''), 0, 26 + i * 22, h.width);
            });
        };
        host.addChild(h);
    };

    /* ---- 5.14 Python 环境（带 PTD 同款进度条） ---- */
    BUILDERS.python = function (host, pad) {
        sectionTitle(host, '🐍  ' + T('py.title', 'Python 环境'), pad);
        var py = G.EznK.Runtime && G.EznK.Runtime.python;
        var s = py ? py.status().value : { status: 'unavailable', ready: false };
        var LAB = {
            'ready': '✅ 已就绪',
            'installing': '⏳ 正在安装',
            'downloading': '📥 正在下载',
            'unavailable': '未安装',
            'not-installed': '未安装',
            'failed': '❌ 安装失败'
        };
        function labelOf(v) { return LAB[v] || '未安装'; }

        var y = 34;
        /* ---- 状态行 ---- */
        var statusLine = new ui.controls.Label({
            x: pad, y: y, width: host.width - pad * 2,
            text: '状态：' + labelOf(s.status) +
                  '        版本：Pyodide ' + (s.version || '0.27.0'),
            color: s.ready ? 'accent' : 'text'
        });
        host.addChild(statusLine);
        y += 26;

        /* ---- 进度条 ---- */
        var prog = {
            visible: false, percent: 0, speed: '', size: '', phase: '',
            lines: []
        };
        var barH = 22;
        var bar = new ui.Control({ x: pad, y: y, width: host.width - pad * 2, height: barH });
        bar.onPaint = function (dc) {
            var th = RES.theme().value;
            GDI.FillRect(dc, 0, 0, bar.width, bar.height, th.surfaceAlt);
            GDI.DrawRect(dc, 0, 0, bar.width, bar.height, th.border, 1);
            if (prog.percent > 0) {
                var w = Math.round((bar.width - 2) * Math.min(1, prog.percent / 100));
                if (w > 0) { GDI.FillRect(dc, 1, 1, w, bar.height - 2, th.accent); }
            }
            GDI.SelectObject(dc, RES.font('small'));
            GDI.SetTextColor(dc, th.text);
            GDI.SetTextAlign(dc, 'center');
            GDI.DrawText(dc, Math.round(prog.percent) + '%', 0, 5, bar.width);
            GDI.SetTextAlign(dc, 'left');
        };
        bar.visible = true;
        host.addChild(bar);
        y += barH + 4;

        /* ---- 速度 / 大小 / 日志 ---- */
        var stats = new ui.controls.Label({
            x: pad, y: y, width: host.width - pad * 2, height: 18,
            text: s.ready ? '已安装完成' : '', color: 'textSecondary', font: 'small'
        });
        host.addChild(stats);
        y += 22;

        var logBox = new ui.Control({ x: pad, y: y, width: host.width - pad * 2, height: 110 });
        logBox.clipChildren = true;
        logBox.onPaint = function (dc) {
            var th = RES.theme().value;
            GDI.FillRect(dc, 0, 0, logBox.width, logBox.height, '#0c0c0c');
            GDI.DrawRect(dc, 0, 0, logBox.width, logBox.height, th.border, 1);
            GDI.SelectObject(dc, RES.font('small'));
            var maxLines = Math.floor((logBox.height - 8) / 15);
            var lines = prog.lines.slice(-maxLines);
            for (var i = 0; i < lines.length; i++) {
                GDI.SetTextColor(dc, lines[i].indexOf('❌') === 0 ? '#ff6b6b'
                    : lines[i].indexOf('✅') === 0 ? '#6bff9e' : '#d0d0d0');
                GDI.DrawTextTruncated(dc, lines[i], 6, 4 + i * 15, logBox.width - 12);
            }
        };
        host.addChild(logBox);
        y += logBox.height + 8;

        function log(msg) {
            var time = new Date().toLocaleTimeString('zh-CN');
            prog.lines.push('[' + time + '] ' + msg);
            if (prog.lines.length > 200) { prog.lines.shift(); }
            logBox.invalidate();
        }
        function setPercent(p, speed, size) {
            prog.percent = p;
            prog.speed = speed || '';
            prog.size = size || '';
            bar.invalidate();
            stats.setText(prog.speed ? ('速度：' + prog.speed + '    大小：' + prog.size) : '');
        }

        /* ---- 安装按钮 ---- */
        var installBtn = new ui.controls.Button({
            x: pad, y: y, width: 200, height: 28,
            text: s.ready ? '重新安装 Pyodide 运行时' : '安装 Pyodide 运行时',
            variant: 'primary',
            onClick: function () {
                if (!py) {
                    log('❌ Python 运行时模块未加载');
                    return;
                }
                installBtn.enabled = false;
                bar.visible = true;
                bar.invalidate();
                setPercent(0);
                log('🚀 正在连接 Pyodide CDN...');
                statusLine.setText('状态：正在安装     版本：Pyodide 0.27.0');

                py.install({
                    onProgress: function (info) {
                        if (!info) { return; }
                        if (info.phase) {
                            log(info.phase === 'connect' ? '📡 正在连接...'
                                : info.phase === 'download' ? '📥 开始下载...'
                                : info.phase === 'init' ? '⚙️ 正在初始化 Python 解释器...'
                                : info.phase);
                        }
                        if (typeof info.percent === 'number') {
                            setPercent(info.percent, info.speed, info.size);
                        }
                        if (info.message) { log(info.message); }
                    }
                }).then(function (r) {
                    installBtn.enabled = true;
                    if (r.status === S.OK) {
                        setPercent(100);
                        log('✅ 安装完成！');
                        statusLine.setText('状态：已就绪     版本：Pyodide 0.27.0');
                        installBtn.setText('重新安装 Pyodide 运行时');
                        var nc = G.EznK.Shell && G.EznK.Shell.notifications;
                        if (nc) { nc.push({ title: '🎉 Python 环境已就绪', text: '可以运行 .py 脚本了', level: 'info' }); }
                    } else {
                        log('❌ 下载失败: ' + (r.reason || '未知错误'));
                        log('💡 请检查网络连接后重试');
                        setPercent(0);
                        statusLine.setText('状态：安装失败     版本：Pyodide 0.27.0');
                    }
                });
            }
        });
        host.addChild(installBtn);
        y += 36;

        host.addChild(new ui.controls.Button({
            x: pad + 208, y: y - 36, width: 100, height: 28, text: '刷新',
            onClick: function () { render(); }
        }));

        if (s.ready) {
            prog.percent = 100;
            prog.lines.push('[已完成] Python 环境已就绪');
        } else {
            log('提示：安装需要联网，约 10 MB');
        }
    };

    /* ---- 5.14b 默认打开方式（文件关联） ---- */
    BUILDERS.fileassoc = function (host, pad) {
        sectionTitle(host, '🔗  默认打开方式', pad);
        var FA = svc().fileAssoc;
        if (!FA) {
            host.addChild(new ui.controls.Label({
                x: pad, y: 40, width: 400, text: '文件关联服务未加载', color: 'textSecondary'
            }));
            return;
        }

        var y = 34;
        host.addChild(new ui.controls.Label({
            x: pad, y: y, width: host.width - pad * 2,
            text: '为每种文件类型选择打开它的应用。修改后立即生效。',
            color: 'textSecondary', font: 'small'
        }));
        y += 26;

        /* 新扩展名输入 + 应用选择 */
        host.addChild(new ui.controls.Label({ x: pad, y: y + 4, width: 80, text: '扩展名' }));
        var extField = new ui.controls.Edit({
            x: pad + 84, y: y, width: 100, height: 26, placeholder: '.log'
        });
        host.addChild(extField);

        host.addChild(new ui.controls.Label({ x: pad + 196, y: y + 4, width: 80, text: '默认应用' }));
        var handlerList = FA.handlers().value;
        var curHandler = 0;
        var handlerBtn = new ui.controls.Button({
            x: pad + 280, y: y, width: 180, height: 26,
            text: handlerList[0].icon + '  ' + handlerList[0].name,
            onClick: function () {
                curHandler = (curHandler + 1) % handlerList.length;
                var h = handlerList[curHandler];
                handlerBtn.setText(h.icon + '  ' + h.name);
            }
        });
        host.addChild(handlerBtn);

        var statusRef = { box: null };
        host.addChild(new ui.controls.Button({
            x: pad + 468, y: y, width: 110, height: 26, text: '设为默认',
            variant: 'primary',
            onClick: function () {
                var ext = extField.getValue();
                if (!ext) {
                    if (statusRef.box) { statusRef.box.setPane('main', '请填写扩展名，例如 .log'); }
                    return;
                }
                var h = handlerList[curHandler];
                var r = FA.setDefault(ext, h.id);
                if (statusRef.box) {
                    statusRef.box.setPane('main', r.status === S.OK
                        ? ('已设置：' + ext + '  ->  ' + h.name)
                        : ('设置失败：' + (r.reason || '')));
                }
                render();
            }
        }));
        y += 38;

        /* 现有关联列表：用 ListBox（绘制与命中都已验证） */
        var rows = FA.list().value;
        var listH = Math.max(140, Math.min(y + 40 + rows.length * 22, host.height - 50) - y);
        var assocList = new ui.controls.ListBox({
            x: pad, y: y, width: host.width - pad * 2, height: listH,
            items: rows.map(function (r) {
                return {
                    id: r.ext,
                    text: r.ext + '     ' + r.appIcon + ' ' + r.appName + '     ' + r.mime,
                    icon: r.appIcon,
                    ext: r.ext,
                    appId: r.appId,
                    appName: r.appName
                };
            }),
            onActivate: function (item) {
                if (!item) { return; }
                /* 双击：在适合该扩展名的应用之间轮换 */
                var fits = FA.handlersFor(item.ext).value;
                if (!fits.length) { return; }
                var cur = -1;
                for (var i = 0; i < fits.length; i++) { if (fits[i].id === item.appId) { cur = i; } }
                var next = fits[(cur + 1) % fits.length];
                FA.setDefault(item.ext, next.id);
                if (statusRef.box) {
                    statusRef.box.setPane('main', '已设置：' + item.ext + '  ->  ' + next.name);
                }
                render();
            },
            onSelect: function (item) {
                if (item && statusRef.box) {
                    statusRef.box.setPane('main', item.ext + ' 当前由「' + item.appName + '」打开（双击可切换）');
                }
            }
        });
        host.addChild(assocList);

        /* 状态栏在窗口底部，这里只给个提示 */
        var hint = new ui.controls.Label({
            x: pad, y: host.height - 24, width: host.width - pad * 2,
            text: '提示：点击下方任意一行可改它的默认应用；也可用上方的"设为默认"新增关联。',
            color: 'textSecondary', font: 'small'
        });
        host.addChild(hint);

        function rect() { return { left: 0, top: 0 }; }
    };

    /* ---- 5.15 轻松使用 ---- */
    BUILDERS.ease = function (host, pad) {
        sectionTitle(host, '♿  ' + T('cp.cat.ease', '轻松使用'), pad);
        infoLines(host, [
            ['界面文字', '全中文'],
            ['图标', 'Emoji 彩色图标'],
            ['高对比度', '可在"主题"中切换']
        ], 34);
        buttonRow(host, [
            { text: '🎭  切换高对比度', w: 160, onClick: function () {
                var th = svc().theme;
                if (th) { var curName = (th.get().value || {}).name; th.set(curName === 'highContrast' ? 'default' : 'highContrast'); th.repaintAll(); render(); }
            } }
        ], 130);
    };

    /* =================================================================
     * 6. 项目分发
     * ============================================================== */

    function runItem(id) {
        var known = BUILDERS[id];
        if (known) {
            st.detail = id;
            st.category = null;
            st.view = 'detail';
            render();
            return CORE.ok(true);
        }
        /* 转发到独立应用 */
        var route = {
            'network': 'network', 'internet': 'internet',
            'device': 'device', 'power': 'power', 'user': 'user',
            'programs': 'programs', 'python': 'python',
            'security': 'security', 'backup': 'backup', 'storage': 'storage',
            'display': 'display', 'date': 'date', 'ease': 'ease',
            'personalize': 'personalize', 'theme': 'theme', 'sound': 'sound'
        };
        if (route[id] && BUILDERS[id]) {
            st.detail = id;
            st.view = 'detail';
            render();
            return CORE.ok(true);
        }
        return CORE.fail(S.ENOSYS, { reason: '该项暂无实现: ' + id });
    }

    function home() {
        st.category = null;
        st.detail = null;
        st.view = 'category';
        st.query = '';
        if (st.searchField) { st.searchField.setValue(''); }
        render();
        return CORE.ok(true);
    }

    function setView(v) {
        st.view = v;
        st.category = null;
        st.detail = null;
        render();
        return CORE.ok(true);
    }

    function search(q) {
        st.query = String(q || '');
        st.category = null;
        st.detail = null;
        st.view = st.query ? 'search' : 'category';
        render();
        return CORE.ok(true);
    }

    /* =================================================================
     * 7. 窗口
     * ============================================================== */

    function buildTopBar(win, client) {
        var bar = new ui.Control({ x: 0, y: 0, width: client.width, height: TOPBAR_H });
        bar.onPaint = function (dc) {
            var t = RES.theme().value;
            GDI.FillRect(dc, 0, 0, bar.width, bar.height, t.surfaceAlt);
        };
        client.addChild(bar);

        client.addChild(new ui.controls.Button({
            x: 8, y: 4, width: 84, height: 26, text: '🏠  主页',
            onClick: function () { home(); }
        }));

        var views = [
            { v: 'category', t: '类别' }, { v: 'large', t: '大图标' }, { v: 'small', t: '小图标' }
        ];
        views.forEach(function (o, i) {
            client.addChild(new ui.controls.Button({
                x: 100 + i * 74, y: 4, width: 70, height: 26, text: o.t,
                variant: st.view === o.v ? 'primary' : undefined,
                onClick: function () { setView(o.v); }
            }));
        });

        var sf = new ui.controls.Edit({
            x: 330, y: 4, width: Math.max(120, client.width - 344), height: 26,
            placeholder: '搜索控制面板'
        });
        sf.onChange = function () { search(sf.getValue()); };
        client.addChild(sf);
        st.searchField = sf;
    }

    function open(pane) {
        /* 单实例：已打开就激活。窗口被外部销毁时要能重新创建，
         * 因此这里同时检查 destroyed 与是否仍在窗口列表里。 */
        if (st.win && !st.win.destroyed) {
            var stillOpen = false;
            try {
                stillOpen = ui.Window.List().value.some(function (w) { return w.id === st.win.id; });
            } catch (_) { stillOpen = false; }
            if (stillOpen) {
                st.win.activate();
                if (pane) { runItem(pane); }
                return CORE.ok(st.win);
            }
        }
        /* 旧窗口已不在列表中，清理状态后重建 */
        st.win = null;
        st.host = null;
        st.navTree = null;
        st.statusBar = null;
        st.searchField = null;
        st.view = 'category';
        st.category = null;
        st.detail = null;

        var created;
        var winsvc = svc().window;
        if (winsvc) {
            created = winsvc.open({
                title: T('cp.title', '控制面板'), width: 820, height: 560,
                icon: '⚙️', appId: 'control-panel'
            });
        } else {
            created = ui.Window.Create({ title: T('cp.title', '控制面板'), width: 820, height: 560, icon: '⚙️' });
        }
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        st.win = win;
        var client = win.client;

        buildTopBar(win, client);

        /* 左栏导航 */
        var navY = TOPBAR_H + 4;
        var navH = client.height - navY - 24;
        var nav = new ui.controls.ListBox({
            x: 0, y: navY, width: NAV_W, height: navH,
            items: [{ id: '__home', text: '🏠  控制面板主页', icon: '🏠' }].concat(
                CATS.map(function (c) { return { id: c.id, text: c.icon + '  ' + catLabel(c), icon: c.icon }; })
            ),
            onSelect: function (item) {
                if (!item) { return; }
                if (item.id === '__home') { home(); } else { openCategory(item.id); }
            }
        });
        nav.clipChildren = true;
        client.addChild(nav);
        st.navTree = nav;

        /* 内容区 */
        var host = new ui.Control({
            x: NAV_W + 4, y: navY, width: client.width - NAV_W - 8, height: navH
        });
        host.clipChildren = true;
        host.name = 'controlPanelHost';
        host.onPaint = function (dc) {
            GDI.FillRect(dc, 0, 0, host.width, host.height, RES.theme().value.windowBody);
        };
        client.addChild(host);
        st.host = host;

        /* 状态栏 */
        var sb = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '就绪', flex: 1 }]
        });
        client.addChild(sb);
        st.statusBar = sb;

        /* 窗口尺寸变化时重新摆放导航栏、内容区与状态栏（对齐 PTD 的
         * flex 布局：左栏固定宽、内容区自适应、状态栏贴底）。 */
        win.onResize = function () {
            var cw = win.client.width;
            var ch = win.client.height;
            /* 顶栏所有子控件按新宽度重排（搜索框在右端） */
            var top = null;
            win.client.children.forEach(function (c, i) {
                if (i === 0) { top = c; }
            });
            if (top) { top.width = cw; top.invalidate(); }
            /* 顶栏内的按钮与搜索框：按 PTD 的 flex 规则重新摆位 */
            if (win.client.children[3]) {
                /* 搜索框是第 4 个添加的控件 */
                var sf = null;
                win.client.children.forEach(function (c) {
                    if (c.constructor && c.constructor.name === 'Edit') { sf = c; }
                });
                if (sf) {
                    sf.x = 330;
                    sf.width = Math.max(120, cw - 344);
                    sf.invalidate();
                }
            }
            var navY = TOPBAR_H + 4;
            var navH = ch - navY - 24;
            if (st.navTree) {
                st.navTree.x = 0; st.navTree.y = navY;
                st.navTree.width = NAV_W; st.navTree.height = navH;
                st.navTree.invalidate();
            }
            if (st.host) {
                st.host.x = NAV_W + 4; st.host.y = navY;
                st.host.width = cw - NAV_W - 8;
                st.host.height = navH;
                st.host.invalidate();
            }
            if (st.statusBar) {
                st.statusBar.y = ch - 22;
                st.statusBar.width = cw;
                st.statusBar.invalidate();
            }
            /* 顶栏搜索框跟随宽度 */
            if (st.searchField) {
                st.searchField.width = Math.max(120, cw - 344);
                st.searchField.invalidate();
            }
            render();
        };

        win.onDestroy = function () {
            st.win = null;
            st.host = null;
            st.navTree = null;
            st.statusBar = null;
            st.searchField = null;
        };

        if (pane) { runItem(pane); } else { render(); }
        win.invalidate();
        return CORE.ok(win);
    }

    function close() {
        if (st.win && !st.win.destroyed) { st.win.destroy(); }
        return CORE.ok(true);
    }

    /* =================================================================
     * 8. 注册
     * ============================================================== */

    function boot() {
        var reg = svc().appRegistry;
        if (reg) {
            reg.register({
                id: 'control-panel', name: '控制面板', icon: '⚙️',
                category: 'system', builtin: true, description: '系统设置'
            });
        }
        return CORE.ok(true);
    }

    var CP = {};
    CP.version = '2.0.0';
    CP.id = 'control-panel';
    CP.displayName = '控制面板';
    CP.icon = '⚙️';
    CP.boot = boot;
    CP.open = open;
    CP.close = close;
    CP.home = home;
    CP.setView = setView;
    CP.search = search;
    CP.openCategory = openCategory;
    CP.runItem = runItem;
    CP.CATS = CATS;
    CP.ITEMS = ITEMS;
    CP.builders = BUILDERS;
    CP.state = function () { return st; };

    if (!G.EznK.Shell) { G.EznK.Shell = {}; }
    G.EznK.Shell.windowsControl = CP;
    if (!G.EznK.Apps) { G.EznK.Apps = {}; }
    G.EznK.Apps.controlPanel = CP;
    if (G.EznK.Kernel && G.EznK.Kernel.SRM && typeof G.EznK.Kernel.SRM.register === 'function') {
        G.EznK.Kernel.SRM.register('shell-control', CP);
    }
    LOG.info('js/shell/windows-control.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
