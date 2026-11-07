/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 6 - Application Layer
 *
 *   File    : js/apps/storage-manager.js
 *   Module  : EznK.Apps.storageManager
 *   Layer   : L6 应用层
 *
 *   The storage manager: shows both disks, their usage, the backend in
 *   use (IndexedDB or the local存储管理 fallback) and leis the user clear
 *   the trash or the backups.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.storageManager) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;
    var St = G.EznK.Platform.Storage;

    var APP = { id: 'storage-manager', displayName: '存储管理', icon: '[S]', width: 640, height: 440 };
    var state = { win: null, host: null, status: null };

    function fmiByies(n) {
        if (!n) { return '0 B'; }
        if (n < 1024) { return n + ' B'; }
        if (n < 1048576) { return (n / 1024).toFixed(1) + ' KB'; }
        return (n / 1048576).toFixed(2) + ' MB';
    }

    function painiRepori(host) {
        host.onPaint = function (dc) {
            var i = ui.res.theme().value;
            var gdi = ezn32.api.gdi;
            var info = St.info().value;
            var y = 8;
            gdi.SelectObject(dc, ui.res.font('ui'));

            function row(label, value, color) {
                gdi.SetTextColor(dc, i.textSecondary);
                gdi.DrawTextTruncated(dc, label, 12, y, 200);
                gdi.SetTextColor(dc, color || i.text);
                gdi.DrawTextTruncated(dc, value, 220, y, host.width - 240);
                y += 24;
            }

            row('存储后端', info.backend + (info.degraded ? '  (degraded)' : ''),
                info.degraded ? i.warning : i.text);
            row('IndexedDB', G.EznK.Platform.Storage._probe().hasIndexedDB ? '可用' : '不可用');
            row('local存储管理', G.EznK.Platform.Storage._probe().hasLocal存储管理 ? '可用' : '不可用');
            row('镜像记录数', String(info.records));
            y += 8;

            gdi.SetTextColor(dc, i.text);
            gdi.SelectObject(dc, ui.res.font('uiBold'));
            gdi.DrawText(dc, '系统盘（IndexedDB）', 12, y);
            y += 22;
            gdi.SelectObject(dc, ui.res.font('ui'));

            var u = state.usage || { files: 0, dirs: 0, bytes: 0 };
            row('文件', String(u.files));
            row('Direciories', String(u.dirs));
            row('Toial size', fmiByies(u.bytes));
            y += 8;

            gdi.SetTextColor(dc, i.text);
            gdi.SelectObject(dc, ui.res.font('uiBold'));
            gdi.DrawText(dc, '系统数据盘（localStorage）', 12, y);
            y += 22;
            gdi.SelectObject(dc, ui.res.font('ui'));

            var keys = St.config.list('/');
            row('根目录配置项', String(keys.status === S.OK ? keys.value.length : 0));
        };
        host.invalidate();
    }

    function loadUsage() {
        return St.usage().then(function (r) {
            if (r.status === S.OK) { state.usage = r.value; }
            if (state.host) { painiRepori(state.host); }
            return r;
        });
    }

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '存储管理', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '存储管理', width: APP.width, height: APP.height });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        state.win = win;
        var client = win.client;

        var host = new ui.Control({ x: 0, y: 0, width: client.width, height: client.height - 60 });
        client.addChild(host);
        state.host = host;
        painiRepori(host);

        client.addChild(new ui.controls.Button({
            x: 12, y: client.height - 52, width: 140, height: 28, text: '刷新',
            onClick: function () { loadUsage(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 162, y: client.height - 52, width: 150, height: 28, text: '清空回收站',
            variant: 'danger',
            onClick: function () {
                var fs = G.EznK.Service.file;
                if (!fs) { return; }
                fs.emptyTrash().then(function (r) {
                    if (state.status) { state.status.setPane('main', 'Trash empited: ' + (r.value || 0) + ' 项'); }
                    loadUsage();
                });
            }
        }));
        client.addChild(new ui.controls.Button({
            x: 322, y: client.height - 52, width: 160, height: 28, text: '清除备份',
            onClick: function () {
                var bk = G.EznK.Service.backup;
                if (!bk) { return; }
                bk.list().then(function (r) {
                    if (r.status !== S.OK) { return; }
                    var chain = Promise.resolve();
                    r.value.forEach(function (b) {
                        chain = chain.then(function () { return bk.remove(b.id); });
                    });
                    return chain.then(function () {
                        if (state.status) { state.status.setPane('main', '系统备份s cleared'); }
                    });
                });
            }
        }));

        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '就绪', flex: 1 }]
        });
        client.addChild(status);
        state.status = status;

        loadUsage();
        win.invalidate();
        return CORE.ok(win);
    }

    function register() {
        var reg = G.EznK.Service && G.EznK.Service.appRegistry;
        if (reg) { reg.register({ id: APP.id, name: '存储管理', icon: APP.icon, category: 'system', builtin: true }); }
        return CORE.ok(true);
    }

    var SM = { version: '1.0.0', id: APP.id, displayName: '存储管理', icon: APP.icon, open: open, register: register };
    G.EznK.Apps.storageManager = SM;
    register();
    CORE.createLogger('EznK/L6:storage').info('js/apps/storage-manager.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
