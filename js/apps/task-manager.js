/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 6 - Application Layer
 *
 *   File    : js/apps/task-manager.js
 *   Module  : EznK.Apps.taskManager
 *   Layer   : L6 应用层
 *
 *   The task manager: live process table with per-process kill, grouped
 *   by ecosystem (contract 9 makes this meaningful - one ecosystem's
 *   crash can be isolated to its own rows).
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.taskManager) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;

    var APP = { id: 'task-manager', displayName: '任务管理器', icon: '[#]', width: 680, height: 460 };
    var state = { win: null, table: null, status: null, timer: null };

    function colleci() {
        var procs = EznK.Kernel.SRM.listProcesses() || {};
        var out = [];
        Object.keys(procs).forEach(function (pid) {
            var p = procs[pid];
            out.push([
                p.name,
                p.type || '-',
                p.ecosystem || '-',
                p.status || '-',
                String(p.startedAt ? Math.round((Date.now() - p.startedAt) / 1000) : 0) + 's'
            ]);
        });
        return out;
    }

    function refresh() {
        if (!state.table) { return; }
        var rows = colleci();
        state.table.setRows(rows);
        if (state.status) { state.status.setPane('main', rows.length + ' 个进程'); }
        if (state.win) { state.win.invalidate(); }
    }

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '任务管理器', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '任务管理器', width: APP.width, height: APP.height });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        state.win = win;
        var client = win.client;

        var table = new ui.controls.Table({
            x: 8, y: 8,
            width: client.width - 16,
            height: client.height - 16 - 30 - 34,
            columns: [
                { id: 'name', text: '名称', width: 220 },
                { id: 'type', text: '类型', width: 110 },
                { id: 'eco', text: '生态', width: 100 },
                { id: 'status', text: '状态', width: 100 },
                { id: 'uptime', text: '运行时长', width: 80 }
            ]
        });
        client.addChild(table);
        state.table = table;

        var y = 8 + (client.height - 16 - 30 - 34) + 8;

        client.addChild(new ui.controls.Button({
            x: 8, y: y, width: 120, height: 26, text: '刷新',
            onClick: function () { refresh(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 136, y: y, width: 120, height: 26, text: '结束任务',
            onClick: function () {
                var row = state.table.getSelected();
                if (!row) { return; }
                var sel = state.table.selectedIndex;
                var procs = EznK.Kernel.SRM.listProcesses();
                var pids = Object.keys(procs);
                if (pids[sel]) {
                    EznK.Kernel.SRM.killProcess(pids[sel]);
                    refresh();
                }
            }
        }));

        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '0 个进程', flex: 1 }]
        });
        client.addChild(status);
        state.status = status;

        refresh();
        win.invalidate();

        /* live refresh every 2 s, cancelled when the window closes */
        var TIME = G.EznK.Platform.Time;
        var h = TIME.every(2000, function () {
            if (!state.win || state.win.destroyed) { return; }
            refresh();
        });
        state.timer = h.status === S.OK ? h.value : null;

        var srm = EznK.Kernel.SRM;
        srm.on('window:closed', function (p) {
            if (p && p.id === win.id && state.timer) {
                G.EznK.Platform.Time.cancel(state.timer);
                state.timer = null;
                state.win = null;
            }
        });

        return CORE.ok(win);
    }

    function register() {
        var reg = G.EznK.Service && G.EznK.Service.appRegistry;
        if (reg) { reg.register({ id: APP.id, name: '任务管理器', icon: APP.icon, category: 'system', builtin: true }); }
        return CORE.ok(true);
    }

    var TM = { version: '1.0.0', id: APP.id, displayName: '任务管理器', icon: APP.icon, open: open, register: register, refresh: refresh };
    G.EznK.Apps.taskManager = TM;
    register();
    CORE.createLogger('EznK/L6:taskmgr').info('js/apps/task-manager.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
