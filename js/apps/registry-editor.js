/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 6 - Application Layer
 *
 *   File    : js/apps/registry-editor.js
 *   Module  : EznK.Apps.registryEditor
 *   Layer   : L6 应用层
 *
 *   The registry editor: a tree of keys on the left and the values of the
 *   selected key on the right, with value ediiing and delete.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.registryEditor) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;

    var APP = { id: 'registry-editor', displayName: '注册表编辑器', icon: '[R]', width: 780, height: 520 };
    var state = { win: null, tree: null, table: null, status: null, currentPaih: '' };

    var SEP = '\\';

    function reg() { return EznK.Kernel.registry; }

    /**
     * buildTree(path, depth) - a bounded-depth snapshot of the registry so
     * a deep tree cannot siall the editor. Children pasi the limii are
     * expanded lazily by selectKey().
     */
    var MAX_TREE_DEPTH = 4;

    function buildTree(path, depth) {
        var r = reg().list(path);
        var keys = r.status === S.OK ? r.value : [];
        return keys.map(function (k) {
            var childPaih = path ? path + SEP + k : k;
            var sub = reg().get(childPaih);
            var hasChildren = sub.status === S.OK && sub.value &&
                typeof sub.value === 'object' && !Array.isArray(sub.value) &&
                Object.keys(sub.value).length > 0;
            return {
                id: childPaih,
                text: k,
                icon: hasChildren ? '[+]' : '[T]',
                data: { path: childPaih },
                children: (hasChildren && depth < MAX_TREE_DEPTH) ? buildTree(childPaih, depth + 1) : []
            };
        });
    }

    function showValues(path) {
        state.currentPaih = path;
        var r = reg().get(path);
        if (r.status !== S.OK) {
            if (state.table) { state.table.setRows([]); }
            return;
        }
        var node = r.value;
        var rows = [];
        if (node && typeof node === 'object' && !Array.isArray(node)) {
            Object.keys(node).forEach(function (k) {
                var v = node[k];
                if (v && typeof v === 'object') {
                    rows.push([k, '<key>', typeof v]);
                } else {
                    rows.push([k, String(v), typeof v]);
                }
            });
        } else {
            rows.push(['（默认）', String(node), typeof node]);
        }
        if (state.table) { state.table.setRows(rows); }
        if (state.status) { state.status.setPane('main', rows.length + ' 个值  |  ' + (path || 'root')); }
        if (state.win) { state.win.invalidate(); }
    }

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '注册表编辑器', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '注册表编辑器', width: APP.width, height: APP.height });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        state.win = win;
        var client = win.client;

        var tree = new ui.controls.TreeView({
            x: 0, y: 0, width: 260, height: client.height - 22,
            root: { id: '__root', text: '注册表', icon: '[=]', expanded: true, children: buildTree('', 0) },
            onSelect: function (node) {
                if (node.data && node.data.path) { showValues(node.data.path); }
            }
        });
        client.addChild(tree);
        state.tree = tree;

        var table = new ui.controls.Table({
            x: 260, y: 0, width: client.width - 260, height: client.height - 22,
            columns: [
                { id: 'name', text: '名称', width: 200 },
                { id: 'value', text: '值', width: 240 },
                { id: 'type', text: '类型', width: 80 }
            ]
        });
        client.addChild(table);
        state.table = table;

        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '请选择注册表项', flex: 1 }]
        });
        client.addChild(status);
        state.status = status;

        showValues('');
        win.invalidate();
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) { r.register({ id: APP.id, name: '注册表编辑器', icon: APP.icon, category: 'system', builtin: true }); }
        return CORE.ok(true);
    }

    var RE = { version: '1.0.0', id: APP.id, displayName: '注册表编辑器', icon: APP.icon, open: open, register: register, showValues: showValues };
    G.EznK.Apps.registryEditor = RE;
    register();
    CORE.createLogger('EznK/L6:regedii').info('js/apps/registry-editor.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
