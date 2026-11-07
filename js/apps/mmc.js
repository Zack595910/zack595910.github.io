/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L6 应用层
 *
 *   文件 : js/apps/mmc.js
 *   模块 : EznK.Apps.mmc
 *   层级 : L6 应用层
 *
 *   系统控制台：管理单元注册表 + 双栏控制台。
 *   单元通过 registerUnit 注册，出现在左栏树中。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.mmc) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;

    var APP = { id: 'mmc', displayName: '系统控制台', icon: '🖥️', width: 800, height: 540 };

    var units = Object.create(null);
    var state = { win: null, tree: null, host: null, active: null, status: null };

    function registerUnit(unit) {
        if (!unit || typeof unit.id !== 'string') {
            return CORE.fail(S.EINVAL, { reason: '缺少单元 id' });
        }
        units[unit.id] = {
            id: unit.id,
            name: unit.name || unit.id,
            icon: unit.icon || '🔧',
            render: typeof unit.render === 'function' ? unit.render : null
        };
        if (state.tree) { refreshTree(); }
        return CORE.ok(units[unit.id]);
    }

    function refreshTree() {
        if (!state.tree) { return; }
        var ids = Object.keys(units);
        state.tree.setRoot({
            id: '__mmc', text: '控制台根节点', icon: '🖥️', expanded: true,
            children: ids.map(function (id) {
                return { id: 'unit:' + id, text: units[id].name, icon: units[id].icon, children: [] };
            })
        });
        if (state.win) { state.win.invalidate(); }
    }

    function select(unitId) {
        var unit = units[unitId];
        if (!unit) { return CORE.fail(S.ENOENT, { reason: '未知单元: ' + unitId }); }
        state.active = unitId;
        if (!state.host) { return CORE.fail(S.ENOENT, { reason: '控制台未打开' }); }

        while (state.host.children.length) { state.host.children[0].dispose(); }

        if (unit.render) {
            try { unit.render(state.host); }
            catch (err) {
                state.host.addChild(new ui.controls.Label({
                    x: 12, y: 12, width: 400,
                    text: '单元加载失败: ' + (err && err.message), color: 'textSecondary'
                }));
            }
        } else {
            state.host.addChild(new ui.controls.Label({ x: 12, y: 12, width: 400, text: unit.name }));
        }
        if (state.status) { state.status.setPane('main', unit.name); }
        if (state.win) { state.win.invalidate(); }
        return CORE.ok(true);
    }

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '系统控制台', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '系统控制台', width: APP.width, height: APP.height, icon: APP.icon });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        state.win = win;
        var client = win.client;

        var tree = new ui.controls.TreeView({
            x: 0, y: 0, width: 220, height: client.height - 22,
            root: { id: '__mmc', text: '控制台根节点', icon: '🖥️', expanded: true, children: [] },
            onSelect: function (node) {
                if (node.id.indexOf('unit:') === 0) { select(node.id.slice(5)); }
            }
        });
        client.addChild(tree);
        state.tree = tree;

        var host = new ui.Control({ x: 220, y: 0, width: client.width - 220, height: client.height - 22 });
        host.onPaint = function (dc) {
            ezn32.api.gdi.FillRect(dc, 0, 0, host.width, host.height, ui.res.theme().value.windowBody);
        };
        client.addChild(host);
        state.host = host;

        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '请选择左栏中的一个管理单元', flex: 1 }]
        });
        client.addChild(status);
        state.status = status;

        refreshTree();
        win.invalidate();
        return CORE.ok(win);
    }

    registerUnit({
        id: 'system', name: '系统信息', icon: 'ℹ️',
        render: function (host) {
            var info = EznK.Kernel.SRM.info().value;
            var rows = [
                ['内核', info.name + ' v' + info.version],
                ['运行阶段', info.phase],
                ['已加载模块', String(info.modules)],
                ['启动步骤', String(info.bootSeq)],
                ['运行时长', Math.round((info.uptime || 0) / 1000) + ' 秒']
            ];
            var h = new ui.Control({ x: 0, y: 0, width: host.width, height: rows.length * 24 + 10 });
            h.onPaint = function (dc) {
                var t = ui.res.theme().value;
                ezn32.api.gdi.SelectObject(dc, ui.res.font('ui'));
                rows.forEach(function (r, i) {
                    ezn32.api.gdi.SetTextColor(dc, t.textSecondary);
                    ezn32.api.gdi.DrawTextTruncated(dc, r[0], 14, i * 24 + 6, 140);
                    ezn32.api.gdi.SetTextColor(dc, t.text);
                    ezn32.api.gdi.DrawTextTruncated(dc, r[1], 170, i * 24 + 6, host.width - 190);
                });
            };
            host.addChild(h);
        }
    });

    registerUnit({
        id: 'processes', name: '进程', icon: '📊',
        render: function (host) {
            var procs = EznK.Kernel.SRM.listProcesses() || {};
            var rows = Object.keys(procs).map(function (pid) {
                var p = procs[pid];
                return [p.name, p.type || '-', p.ecosystem || '-', p.status || '-'];
            });
            host.addChild(new ui.controls.Table({
                x: 8, y: 8, width: host.width - 16, height: host.height - 16,
                columns: [
                    { id: 'name', text: '名称', width: 220 },
                    { id: 'type', text: '类型', width: 140 },
                    { id: 'eco', text: '生态', width: 120 },
                    { id: 'status', text: '状态', width: 100 }
                ],
                rows: rows
            }));
        }
    });

    registerUnit({
        id: 'services', name: '服务', icon: '🔧',
        render: function (host) {
            var svcs = EznK.Kernel.SRM.listServices() || {};
            var rows = Object.keys(svcs).map(function (n) {
                return [n, svcs[n].status || '-'];
            });
            host.addChild(new ui.controls.Table({
                x: 8, y: 8, width: host.width - 16, height: host.height - 16,
                columns: [
                    { id: 'name', text: '服务', width: 260 },
                    { id: 'status', text: '状态', width: 120 }
                ],
                rows: rows
            }));
        }
    });

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) { r.register({ id: APP.id, name: '系统控制台', icon: APP.icon, category: 'system', builtin: true }); }
        return CORE.ok(true);
    }

    var MMC = {
        version: '1.0.0', id: APP.id, displayName: '系统控制台', icon: APP.icon,
        open: open, register: register, registerUnit: registerUnit, select: select,
        units: function () { return CORE.ok(Object.keys(units).map(function (k) { return units[k]; })); }
    };
    G.EznK.Apps.mmc = MMC;
    register();
    CORE.createLogger('EznK/L6:mmc').info('js/apps/mmc.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
