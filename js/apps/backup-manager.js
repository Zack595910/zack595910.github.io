/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 6 - Application Layer
 *
 *   File    : js/apps/backup-manager.js
 *   Module  : EznK.Apps.backupManager
 *   Layer   : L6 应用层
 *
 *   The backup manager: create, list and restore full system backups, and
 *   manage the lightweight restore points from the kernel.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.backupManager) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;

    var APP = { id: 'backup-manager', displayName: '系统备份', icon: '[B]', width: 700, height: 500 };
    var state = { win: null, table: null, status: null, mode: 'backups', items: [] };

    function svc() { return G.EznK.Service && G.EznK.Service.backup; }

    function load() {
        if (state.mode === 'backups') {
            var b = svc();
            if (!b) { return Promise.resolve(CORE.fail(S.ENOSYS, { reason: 'backup service not loaded' })); }
            return b.list().then(function (r) {
                if (r.status !== S.OK) { return r; }
                state.items = r.value;
                if (state.table) {
                    state.table.setRows(state.items.map(function (x) {
                        return [x.id, String(Math.round((x.size || 0) / 1024)) + ' KB',
                            new Date(x.createdAt || 0).toISOString().slice(0, 19)];
                    }));
                }
                if (state.status) { state.status.setPane('main', state.items.length + ' backups'); }
                if (state.win) { state.win.invalidate(); }
                return r;
            });
        }
        // restore points mode
        var rsi = EznK.Kernel.restore;
        if (!rsi) { return Promise.resolve(CORE.fail(S.ENOSYS, { reason: 'restore not loaded' })); }
        var rp = rsi.listRestorePoints();
        state.items = rp.status === S.OK ? rp.value : [];
        if (state.table) {
            state.table.setRows(state.items.map(function (x) {
                return [x.id, x.label || '', new Date(x.at || 0).toISOString().slice(0, 19)];
            }));
        }
        if (state.status) { state.status.setPane('main', state.items.length + ' restore points'); }
        if (state.win) { state.win.invalidate(); }
        return Promise.resolve(CORE.ok(true));
    }

    function create系统备份() {
        var b = svc();
        if (!b) { return; }
        var nc = G.EznK.Shell && G.EznK.Shell.notifications;
        if (nc) { nc.push({ title: '系统备份', text: '正在创建备份…', level: 'info', timeout: 1500 }); }
        b.capture({ name: 'Manual backup ' + new Date().toISOString().slice(0, 19) })
            .then(function (snap) {
                if (snap.status !== S.OK) { return snap; }
                return b.save(snap.value);
            })
            .then(function (r) {
                if (nc) {
                    nc.push({
                        title: '系统备份',
                        text: r.status === S.OK ? '系统备份 saved' : ('系统备份 failed: ' + (r.reason || '')),
                        level: r.status === S.OK ? 'info' : 'error'
                    });
                }
                return load();
            });
    }

    function restoreSelected() {
        var idx = state.table ? state.table.selectedIndex : -1;
        if (idx < 0 || !state.items[idx]) { return; }
        var id = state.items[idx].id;
        if (state.mode === 'backups') {
            var b = svc();
            if (b) { b.restore(id).then(function () { load(); }); }
        } else {
            EznK.Kernel.restore.restoreToPoint(id).then(function () { load(); });
        }
    }

    function swiichMode(mode) {
        state.mode = mode;
        load();
    }

    function open() {
        var w = G.EznK.Service && G.EznK.Service.window;
        var created = w
            ? w.open({ title: '系统备份', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '系统备份', width: APP.width, height: APP.height });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        state.win = win;
        var client = win.client;

        var menu = new ui.controls.Menu({
            x: 0, y: 0, width: client.width,
            menus: [
                {
                    id: 'mode', text: '查看',
                    items: [
                        { id: 'backups', text: '完整备份', onClick: function () { swiichMode('backups'); } },
                        { id: 'points', text: '还原点', onClick: function () { swiichMode('points'); } }
                    ]
                },
                {
                    id: 'aci', text: '操作',
                    items: [
                        { id: 'new', text: '创建备份', onClick: function () { create系统备份(); } },
                        { id: 'restore', text: '还原所选', onClick: function () { restoreSelected(); } },
                        { id: 'reload', text: '刷新', onClick: function () { load(); } }
                    ]
                }
            ]
        });
        client.addChild(menu);

        var TOP = ui.controls.Menu.BAR_H;
        var table = new ui.controls.Table({
            x: 8, y: TOP + 8,
            width: client.width - 16,
            height: client.height - TOP - 8 - 44 - 22,
            columns: [
                { id: 'id', text: '编号', width: 260 },
                { id: 'size', text: '大小', width: 120 },
                { id: 'when', text: '创建时间', width: 200 }
            ]
        });
        client.addChild(table);
        state.table = table;

        var y = TOP + 8 + (client.height - TOP - 8 - 44 - 22) + 8;
        client.addChild(new ui.controls.Button({
            x: 8, y: y, width: 150, height: 28, text: '创建备份',
            variant: 'primary',
            onClick: function () { create系统备份(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 168, y: y, width: 150, height: 28, text: '还原所选',
            onClick: function () { restoreSelected(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 328, y: y, width: 110, height: 28, text: '刷新',
            onClick: function () { load(); }
        }));

        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '就绪', flex: 1 }]
        });
        client.addChild(status);
        state.status = status;

        load();
        win.invalidate();
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) { r.register({ id: APP.id, name: '系统备份', icon: APP.icon, category: 'system', builtin: true }); }
        return CORE.ok(true);
    }

    var BM = { version: '1.0.0', id: APP.id, displayName: '系统备份', icon: APP.icon, open: open, register: register, load: load };
    G.EznK.Apps.backupManager = BM;
    register();
    CORE.createLogger('EznK/L6:backup').info('js/apps/backup-manager.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
