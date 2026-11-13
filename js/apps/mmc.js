/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L6 应用层
 *
 *   文件 : js/apps/mmc.js
 *   模块 : EznK.Apps.mmc
 *   层级 : L6 应用层
 *
 * ---------------------------------------------------------------------
 * 系统控制台 —— 还原 PTD.html 的 SRM 控制台（srm_mmc）
 * ---------------------------------------------------------------------
 *   PTD 的 MMC 是「管理工具」左栏 + 内容区右栏的双栏控制台，
 *   管理单元通过 SRM.registerMMCUnit({ id, name, icon, render }) 注册。
 *
 *   这里还原同样结构与全部管理单元：
 *     📊 任务管理器   进程列表 + 结束进程
 *     ℹ️ 系统信息     内核版本、运行阶段、模块
 *     🔧 服务管理     启动 / 停止服务
 *     📜 事件日志     内核日志
 *     💾 存储信息     磁盘用量与文件统计
 *     🔌 设备信息     媒体设备
 *     🔑 注册表概览   各根键的键值数量
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;
    var api = ezn32.api;
    var GDI = api.gdi;
    var RES = ui.res;

    var APP = { id: 'mmc', displayName: '系统控制台', icon: '📋', width: 800, height: 560 };

    var units = [];
    var st = { win: null, navList: null, host: null, status: null, active: null };

    /* =================================================================
     * 1. 管理单元注册（兼容 PTD 的 SRM.registerMMCUnit）
     * ============================================================== */

    function registerUnit(unit) {
        if (!unit || typeof unit.id !== 'string') {
            return CORE.fail(S.EINVAL, { reason: '缺少单元 id' });
        }
        for (var i = 0; i < units.length; i++) {
            if (units[i].id === unit.id) { units[i] = unit; if (st.navList) { refreshNav(); } return CORE.ok(unit); }
        }
        units.push(unit);
        if (st.navList) { refreshNav(); }
        return CORE.ok(unit);
    }

    function refreshNav() {
        if (!st.navList) { return; }
        st.navList.setItems(units.map(function (u) {
            return { id: u.id, text: u.icon + '  ' + u.name, icon: u.icon };
        }));
        if (st.win) { st.win.invalidate(); }
    }

    function select(unitId) {
        var unit = null;
        for (var i = 0; i < units.length; i++) {
            if (units[i].id === unitId) { unit = units[i]; break; }
        }
        if (!unit) { return CORE.fail(S.ENOENT, { reason: '未知单元: ' + unitId }); }
        st.active = unitId;
        if (!st.host) { return CORE.fail(S.ENOENT, { reason: '控制台未打开' }); }

        while (st.host.children.length) { st.host.children[0].dispose(); }
        try {
            unit.render(st.host);
        } catch (err) {
            st.host.addChild(new ui.controls.Label({
                x: 12, y: 12, width: 400, text: '单元加载失败：' + (err && err.message), color: 'textSecondary'
            }));
        }
        if (st.status) { st.status.setPane('main', unit.name); }
        if (st.win) { st.win.invalidate(); }
        return CORE.ok(true);
    }

    /* =================================================================
     * 2. 内置管理单元
     * ============================================================== */

    /* ---- 任务管理器 ---- */
    registerUnit({
        id: 'taskmgr', name: '任务管理器', icon: '📊',
        render: function (host) {
            host.addChild(new ui.controls.Label({
                x: 12, y: 10, width: host.width - 24, text: '📊  任务管理器', font: 'uiBold'
            }));

            var table = new ui.controls.Table({
                x: 12, y: 36, width: Math.max(120, host.width - 24), height: Math.max(120, host.height - 100),
                columns: [
                    { id: 'pid', text: '进程 ID', width: 200 },
                    { id: 'name', text: '名称', width: 200 },
                    { id: 'type', text: '类型', width: 100 },
                    { id: 'eco', text: '生态', width: 100 },
                    { id: 'status', text: '状态', width: 100 }
                ]
            });
            host.addChild(table);

            var pids = [];
            function load() {
                var procs = EznK.Kernel.SRM.listProcesses() || {};
                pids = Object.keys(procs);
                table.setRows(pids.map(function (pid) {
                    var p = procs[pid];
                    return [pid, p.name || '-', p.type || '-', p.ecosystem || '-', p.status || '-'];
                }));
                host.invalidate();
            }
            load();

            host.addChild(new ui.controls.Button({
                x: 12, y: host.height - 52, width: 130, height: 26, text: '🔄  刷新',
                onClick: function () { load(); }
            }));
            host.addChild(new ui.controls.Button({
                x: 150, y: host.height - 52, width: 150, height: 26, text: '❌  结束进程',
                variant: 'danger',
                onClick: function () {
                    var idx = table.selectedIndex;
                    var nc = G.EznK.Shell && G.EznK.Shell.notifications;
                    if (idx < 0 || !pids[idx]) {
                        if (nc) { nc.push({ title: '任务管理器', text: '请先选中一个进程', level: 'warn' }); }
                        return;
                    }
                    var killed = EznK.Kernel.SRM.killProcess(pids[idx]);
                    if (nc) {
                        nc.push({ title: '任务管理器', text: killed ? '已结束进程' : '无法结束该进程',
                            level: killed ? 'info' : 'warn' });
                    }
                    load();
                }
            }));
        }
    });

    /* ---- 系统信息 ---- */
    registerUnit({
        id: 'sysinfo', name: '系统信息', icon: 'ℹ️',
        render: function (host) {
            var info = EznK.Kernel.SRM.info().value;
            var storage = G.EznK.Platform.Storage.info().value;
            var py = G.EznK.Runtime && G.EznK.Runtime.python ? G.EznK.Runtime.python.status().value : null;
            var rows = [
                ['操作系统', 'EZNT 生态系统原生技术'],
                ['版本', '1.0.0'],
                ['架构', 'EznK（六层 + 两横切面）'],
                ['内核', info.name + ' v' + info.version],
                ['运行阶段', info.phase],
                ['已加载模块', String(info.modules)],
                ['启动步骤', String(info.bootSeq) + ' / 11'],
                ['运行时长', Math.round((info.uptime || 0) / 1000) + ' 秒'],
                ['存储后端', storage.backend + (storage.degraded ? '（降级）' : '')],
                ['Python 运行时', py ? py.status : '未安装'],
                ['处理器', 'EznK 虚拟 CPU']
            ];
            var h = new ui.Control({ x: 0, y: 0, width: host.width, height: rows.length * 26 + 40 });
            h.onPaint = function (dc) {
                var th = RES.theme().value;
                GDI.SelectObject(dc, RES.font('uiBold'));
                GDI.SetTextColor(dc, th.text);
                GDI.DrawText(dc, 'ℹ️  系统信息', 12, 10);
                GDI.SelectObject(dc, RES.font('ui'));
                rows.forEach(function (r, i) {
                    var y = 40 + i * 26;
                    GDI.SetTextColor(dc, th.textSecondary);
                    GDI.DrawTextTruncated(dc, r[0], 12, y, 150);
                    GDI.SetTextColor(dc, th.text);
                    GDI.DrawTextTruncated(dc, String(r[1]), 172, y, Math.max(80, h.width - 190));
                });
            };
            host.addChild(h);
        }
    });

    /* ---- 服务管理 ---- */
    registerUnit({
        id: 'services', name: '服务管理', icon: '🔧',
        render: function (host) {
            host.addChild(new ui.controls.Label({
                x: 12, y: 10, width: host.width - 24, text: '🔧  服务管理', font: 'uiBold'
            }));
            var table = new ui.controls.Table({
                x: 12, y: 36, width: Math.max(120, host.width - 24), height: Math.max(120, host.height - 100),
                columns: [
                    { id: 'name', text: '服务名', width: 200 },
                    { id: 'status', text: '状态', width: 120 }
                ]
            });
            host.addChild(table);
            var names = [];
            function load() {
                var svcs = EznK.Kernel.SRM.listServices() || {};
                names = Object.keys(svcs);
                table.setRows(names.map(function (n) { return [n, svcs[n].status || '-']; }));
                host.invalidate();
            }
            load();
            host.addChild(new ui.controls.Button({
                x: 12, y: host.height - 52, width: 120, height: 26, text: '▶  启动',
                onClick: function () {
                    var i = table.selectedIndex;
                    if (i >= 0 && names[i]) { EznK.Kernel.SRM.startService(names[i]); load(); }
                }
            }));
            host.addChild(new ui.controls.Button({
                x: 142, y: host.height - 52, width: 120, height: 26, text: '⏹  停止',
                onClick: function () {
                    var i = table.selectedIndex;
                    if (i >= 0 && names[i]) { EznK.Kernel.SRM.stopService(names[i]); load(); }
                }
            }));
            host.addChild(new ui.controls.Button({
                x: 272, y: host.height - 52, width: 120, height: 26, text: '🔄  刷新',
                onClick: function () { load(); }
            }));
        }
    });

    /* ---- 事件日志 ---- */
    registerUnit({
        id: 'eventlog', name: '事件日志', icon: '📜',
        render: function (host) {
            host.addChild(new ui.controls.Label({
                x: 12, y: 10, width: host.width - 24, text: '📜  事件日志', font: 'uiBold'
            }));
            var log = new ui.Control({ x: 12, y: 36, width: Math.max(120, host.width - 24), height: Math.max(120, host.height - 100) });
            log.clipChildren = true;
            var scrollTop = 0;
            log.onPaint = function (dc) {
                var th = RES.theme().value;
                GDI.FillRect(dc, 0, 0, log.width, log.height, '#0c0c0c');
                GDI.DrawRect(dc, 0, 0, log.width, log.height, th.border, 1);
                var entries = EznK.Kernel.SRM.getLog() || [];
                GDI.SelectObject(dc, RES.font('small'));
                var lineH = 16;
                var maxLines = Math.max(1, Math.floor((log.height - 8) / lineH));
                var start = Math.max(0, entries.length - maxLines - scrollTop);
                var shown = entries.slice(start, start + maxLines);
                shown.forEach(function (e, i) {
                    var color = e.level === 'error' ? '#ff6b6b' : e.level === 'warn' ? '#ffd166' : '#d0d0d0';
                    GDI.SetTextColor(dc, color);
                    GDI.DrawTextTruncated(dc,
                        '[' + (e.level || 'info') + '] ' + (e.category || '') + ': ' + (e.message || ''),
                        6, 4 + i * lineH, log.width - 12);
                });
            };
            log.onControlMessage = function (msg) {
                if (msg.type === 'wheel') {
                    var d = msg.data || {};
                    var entries = EznK.Kernel.SRM.getLog() || [];
                    scrollTop = Math.max(0, Math.min(entries.length, scrollTop + ((d.deltaY || 0) > 0 ? 3 : -3)));
                    log.invalidate();
                    return 'scroll';
                }
                return null;
            };
            host.addChild(log);
            host.addChild(new ui.controls.Button({
                x: 12, y: host.height - 52, width: 120, height: 26, text: '🔄  刷新',
                onClick: function () { log.invalidate(); }
            }));
            host.addChild(new ui.controls.Button({
                x: 142, y: host.height - 52, width: 140, height: 26, text: '🗑  清空日志',
                variant: 'danger',
                onClick: function () { EznK.Kernel.SRM.clearLog(); log.invalidate(); }
            }));
        }
    });

    /* ---- 存储信息 ---- */
    registerUnit({
        id: 'storage', name: '存储信息', icon: '💾',
        render: function (host) {
            host.addChild(new ui.controls.Label({
                x: 12, y: 10, width: host.width - 24, text: '💾  存储信息', font: 'uiBold'
            }));
            var info = G.EznK.Platform.Storage.info().value;
            var probe = G.EznK.Platform.Storage._probe ? G.EznK.Platform.Storage._probe() : { hasIndexedDB: false, hasLocalStorage: false };
            var box = new ui.Control({ x: 12, y: 36, width: Math.max(120, host.width - 24), height: 140 });
            box.onPaint = function (dc) {
                var th = RES.theme().value;
                GDI.SelectObject(dc, RES.font('ui'));
                var rows = [
                    ['存储后端', info.backend + (info.degraded ? '（降级）' : '')],
                    ['记录数', String(info.records)],
                    ['IndexedDB', probe.hasIndexedDB ? '可用' : '不可用'],
                    ['localStorage', probe.hasLocalStorage ? '可用' : '不可用']
                ];
                rows.forEach(function (r, i) {
                    GDI.SetTextColor(dc, th.textSecondary);
                    GDI.DrawTextTruncated(dc, r[0], 0, i * 26, 140);
                    GDI.SetTextColor(dc, th.text);
                    GDI.DrawTextTruncated(dc, r[1], 150, i * 26, Math.max(80, box.width - 160));
                });
            };
            host.addChild(box);

            G.EznK.Platform.Storage.usage().then(function (r) {
                if (r.status !== S.OK || !host) { return; }
                var u = r.value;
                var box2 = new ui.Control({ x: 12, y: 186, width: Math.max(120, host.width - 24), height: 110 });
                box2.onPaint = function (dc) {
                    var th = RES.theme().value;
                    GDI.SelectObject(dc, RES.font('ui'));
                    var rows = [
                        ['文件数', String(u.files)],
                        ['目录数', String(u.dirs)],
                        ['总大小', (u.bytes / 1024).toFixed(1) + ' KB']
                    ];
                    rows.forEach(function (r2, i) {
                        GDI.SetTextColor(dc, th.textSecondary);
                        GDI.DrawTextTruncated(dc, r2[0], 0, i * 26, 140);
                        GDI.SetTextColor(dc, th.text);
                        GDI.DrawTextTruncated(dc, r2[1], 150, i * 26, Math.max(80, box2.width - 160));
                    });
                };
                host.addChild(box2);
            });
        }
    });

    /* ---- 设备信息 ---- */
    registerUnit({
        id: 'devices', name: '设备信息', icon: '🔌',
        render: function (host) {
            host.addChild(new ui.controls.Label({
                x: 12, y: 10, width: host.width - 24, text: '🔌  设备信息', font: 'uiBold'
            }));
            var devices = { video: [], audioIn: [], audioOut: [] };
            var box = new ui.Control({ x: 12, y: 36, width: Math.max(120, host.width - 24), height: 180 });
            box.onPaint = function (dc) {
                var th = RES.theme().value;
                GDI.SelectObject(dc, RES.font('ui'));
                var lines = [];
                (devices.video || []).forEach(function (d) { lines.push('📷  摄像头：' + (d.label || '（未命名）')); });
                (devices.audioIn || []).forEach(function (d) { lines.push('🎤  麦克风：' + (d.label || '（未命名）')); });
                (devices.audioOut || []).forEach(function (d) { lines.push('🔊  音频输出：' + (d.label || '（未命名）')); });
                if (!lines.length) { lines.push('（未检测到设备，点击"扫描设备"）'); }
                lines.forEach(function (l, i) {
                    GDI.SetTextColor(dc, th.text);
                    GDI.DrawTextTruncated(dc, l, 0, i * 24, box.width);
                });
            };
            host.addChild(box);
            host.addChild(new ui.controls.Button({
                x: 12, y: host.height - 52, width: 140, height: 26, text: '🔍  扫描设备',
                onClick: function () {
                    var media = G.EznK.Platform.Media;
                    if (!media) { return; }
                    Promise.resolve(media.listDevices()).then(function (r) {
                        if (r.status === S.OK) { devices = r.value; }
                        box.invalidate();
                    });
                }
            }));
        }
    });

    /* ---- 注册表概览 ---- */
    registerUnit({
        id: 'registry', name: '注册表概览', icon: '🔑',
        render: function (host) {
            host.addChild(new ui.controls.Label({
                x: 12, y: 10, width: host.width - 24, text: '🔑  注册表概览', font: 'uiBold'
            }));
            var table = new ui.controls.Table({
                x: 12, y: 36, width: Math.max(120, host.width - 24), height: Math.max(120, host.height - 90),
                columns: [
                    { id: 'root', text: '根键', width: 180 },
                    { id: 'desc', text: '说明', width: 220 },
                    { id: 'keys', text: '子键数', width: 100 }
                ]
            });
            var srm = EznK.Kernel.SRM;
            var ROOTS = [
                ['HKCR', '文件关联类'],
                ['HKCU', '当前用户设置'],
                ['HKLM', '系统全局设置'],
                ['HKU', '所有用户'],
                ['HKCC', '当前硬件配置']
            ];
            table.setRows(ROOTS.map(function (r) {
                var v = srm.regGet(r[0]);
                var n = (v && typeof v === 'object') ? Object.keys(v).length : 0;
                return [r[0], r[1], String(n)];
            }));
            host.addChild(table);
            host.addChild(new ui.controls.Button({
                x: 12, y: host.height - 46, width: 170, height: 26, text: '🗂  打开注册表编辑器',
                onClick: function () {
                    var re = G.EznK.Apps.registryEditor;
                    if (re) { re.open(); }
                }
            }));
        }
    });

    /* =================================================================
     * 3. 窗口
     * ============================================================== */

    function open() {
        if (st.win && !st.win.destroyed) {
            st.win.activate();
            return CORE.ok(st.win);
        }

        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '系统控制台', width: APP.width, height: APP.height,
                         icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '系统控制台', width: APP.width, height: APP.height, icon: APP.icon });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        st.win = win;
        var client = win.client;

        var NAV_W = 200;
        var HEAD = 26;

        var navHead = new ui.Control({ x: 0, y: 0, width: NAV_W, height: HEAD });
        navHead.onPaint = function (dc) {
            var th = RES.theme().value;
            GDI.FillRect(dc, 0, 0, navHead.width, navHead.height, th.surfaceAlt);
            GDI.SelectObject(dc, RES.font('uiBold'));
            GDI.SetTextColor(dc, th.accent);
            GDI.DrawText(dc, '📋  管理工具', 12, 6);
        };
        client.addChild(navHead);

        var nav = new ui.controls.ListBox({
            x: 0, y: HEAD, width: NAV_W, height: Math.max(60, client.height - HEAD - 22),
            items: [],
            onSelect: function (item) { if (item) { select(item.id); } }
        });
        client.addChild(nav);
        st.navList = nav;

        var host = new ui.Control({
            x: NAV_W, y: 0, width: Math.max(120, client.width - NAV_W), height: Math.max(60, client.height - 22)
        });
        host.clipChildren = true;
        host.onPaint = function (dc) {
            GDI.FillRect(dc, 0, 0, host.width, host.height, RES.theme().value.windowBody);
        };
        client.addChild(host);
        st.host = host;

        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '请选择左侧管理工具', flex: 1 }]
        });
        client.addChild(status);
        st.status = status;

        win._layoutFn = function (cw, ch) {
            navHead.width = NAV_W;
            nav.height = Math.max(60, ch - HEAD - 22);
            host.x = NAV_W;
            host.width = Math.max(120, cw - NAV_W);
            host.height = Math.max(60, ch - 22);
            status.y = ch - 22;
            status.width = cw;
            /* 内容区里的控件也要按新尺寸重排（之前漏了这一步，
             * 导致缩小窗口时表格与按钮跑到边界外）。 */
            relayoutHost(host);
            win.client.invalidate();
        };

        /** 按 host 当前尺寸重排其内部控件 */
        function relayoutHost(h) {
            var hw = h.width, hh = h.height;
            h.children.forEach(function (c) {
                var name = c.constructor && c.constructor.name;
                if (name === 'Label') {
                    c.width = Math.max(60, hw - 24);
                } else if (name === 'Table') {
                    c.width = Math.max(120, hw - 24);
                    c.height = Math.max(60, hh - 100);
                } else if (name === 'Button') {
                    c.y = hh - 52;
                } else if (name === 'Control') {
                    /* 自绘面板：按位置判断是哪个 */
                    c.width = Math.max(80, hw - 24);
                    if (c.y >= 150) { c.height = Math.max(60, hh - c.y - 60); }
                    else if (c.y > 0) { c.height = Math.max(60, hh - c.y - 100); }
                }
            });
            h.invalidate();
        }

        win.onDestroy = function () {
            st.win = null;
            st.navList = null;
            st.host = null;
            st.status = null;
        };

        refreshNav();
        win.invalidate();

        setTimeout(function () { select('taskmgr'); }, 80);
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) {
            r.register({ id: APP.id, name: '系统控制台', icon: APP.icon, category: 'system', builtin: true });
        }
        return CORE.ok(true);
    }

    var MMC = {
        version: '2.0.0',
        id: APP.id,
        displayName: '系统控制台',
        icon: APP.icon,
        open: open,
        register: register,
        registerUnit: registerUnit,
        select: select,
        state: function () { return st; },
        units: function () { return CORE.ok(units.slice(0)); }
    };

    G.EznK.Apps.mmc = MMC;

    /* PTD 兼容：SRM.registerMMCUnit / SRM.openMMC */
    if (G.SRM) {
        G.SRM.registerMMCUnit = registerUnit;
        G.SRM.openMMC = function () { return open(); };
    }

    register();
    CORE.createLogger('EznK/L6:mmc').info('js/apps/mmc.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
