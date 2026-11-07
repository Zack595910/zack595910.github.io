/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L6 应用层
 *
 *   文件 : js/apps/recycle-bin.js
 *   模块 : EznK.Apps.recycleBin
 *   层级 : L6 应用层
 *
 *   回收站 —— 对应 PTD.html 的 trash 窗口。
 *   列出已删除项目，支持还原与永久删除。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.recycleBin) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;

    var APP = { id: 'recycle-bin', displayName: '回收站', icon: '🗑️', width: 700, height: 480 };
    var st = { win: null, table: null, status: null, items: [] };

    function fs() { return G.EznK.Service && G.EznK.Service.file; }

    function load() {
        var f = fs();
        if (!f) { return Promise.resolve(CORE.fail(S.ENOSYS, { reason: '文件服务不可用' })); }
        return Promise.resolve(f.listTrash()).then(function (res) {
            if (res.status !== S.OK) { return res; }
            st.items = res.value || [];
            if (st.table) {
                st.table.setRows(st.items.map(function (it) {
                    return [
                        it.name || String(it.original || '').split('/').pop(),
                        String(it.original || ''),
                        it.at ? new Date(it.at).toLocaleString('zh-CN') : '-'
                    ];
                }));
            }
            if (st.status) { st.status.setPane('main', st.items.length + ' 项'); }
            if (st.win) { st.win.invalidate(); }
            return res;
        });
    }

    function restoreSelected() {
        var f = fs();
        if (!f || !st.table) { return; }
        var idx = st.table.selectedIndex;
        if (idx < 0 || !st.items[idx]) { return; }
        var item = st.items[idx];
        Promise.resolve(f.restoreFromTrash(item.id)).then(function (res) {
            if (st.status) {
                st.status.setPane('main', res && res.status === S.OK ? '已还原' : ('还原失败：' + ((res && res.reason) || '')));
            }
            load();
        });
    }

    function deleteSelected(permanent) {
        var f = fs();
        if (!f || !st.table) { return; }
        var idx = st.table.selectedIndex;
        if (idx < 0 || !st.items[idx]) { return; }
        var item = st.items[idx];
        if (!permanent) { return; }
        var api = ezn32.api;
        Promise.resolve(api.kernel.DeleteFile(item.trashPath)).then(function () {
            /* 从索引里移除该记录 */
            var list = f.listTrash().value.filter(function (x) { return x.id !== item.id; });
            EznK.Kernel.HAL.fs.configSet(f.userRoot() + '/Registry/Trash.json', list);
            load();
        });
    }

    function emptyAll() {
        var f = fs();
        if (!f) { return; }
        f.emptyTrash().then(function (r) {
            if (st.status) { st.status.setPane('main', '已清空回收站：' + (r.value || 0) + ' 项'); }
            load();
        });
    }

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '回收站', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '回收站', width: APP.width, height: APP.height, icon: APP.icon });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        st.win = win;
        var client = win.client;

        var table = new ui.controls.Table({
            x: 0, y: 0, width: client.width, height: client.height - 62,
            columns: [
                { id: 'name', text: '名称', width: 200 },
                { id: 'path', text: '原位置', width: 300 },
                { id: 'when', text: '删除时间', width: 180 }
            ]
        });
        client.addChild(table);
        st.table = table;

        var y = client.height - 54;
        client.addChild(new ui.controls.Button({
            x: 8, y: y, width: 120, height: 28, text: '♻️ 还原',
            variant: 'primary',
            onClick: function () { restoreSelected(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 136, y: y, width: 140, height: 28, text: '🗑️ 永久删除',
            onClick: function () { deleteSelected(true); }
        }));
        client.addChild(new ui.controls.Button({
            x: 284, y: y, width: 150, height: 28, text: '❌ 清空回收站',
            variant: 'danger',
            onClick: function () { emptyAll(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 442, y: y, width: 100, height: 28, text: '🔄 刷新',
            onClick: function () { load(); }
        }));

        var sb = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '正在读取…', flex: 1 }]
        });
        client.addChild(sb);
        st.status = sb;

        load();
        win.invalidate();
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) { r.register({ id: APP.id, name: '回收站', icon: APP.icon, category: 'tools', builtin: true }); }
        return CORE.ok(true);
    }

    var RB = {
        version: '1.0.0', id: APP.id, displayName: '回收站', icon: APP.icon,
        open: open, register: register, load: load, empty: emptyAll
    };
    G.EznK.Apps.recycleBin = RB;
    register();
    CORE.createLogger('EznK/L6:recycle').info('js/apps/recycle-bin.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
