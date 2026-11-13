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

    /** 弹出输入框（注册表编辑器内部用） */
    function askText(title, initial, onOk) {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: title, width: 420, height: 170, icon: '✏️' })
            : ui.Window.Create({ title: title, width: 420, height: 170 });
        if (created.status !== S.OK) { return; }
        var win = created.value;
        var client = win.client;

        client.addChild(new ui.controls.Label({
            x: 16, y: 14, width: client.width - 32, text: title + '：'
        }));
        var field = new ui.controls.Edit({
            x: 16, y: 42, width: client.width - 32, height: 26
        });
        field.setValue(initial || '');
        client.addChild(field);

        var sb = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '按回车确认', flex: 1 }]
        });
        client.addChild(sb);

        function ok() {
            var v = String(field.getValue() || '').trim();
            if (!v) { sb.setPane('main', '名称不能为空'); return; }
            win.destroy();
            onOk(v);
        }
        field.onEnter = ok;
        client.addChild(new ui.controls.Button({
            x: client.width - 200, y: client.height - 56, width: 88, height: 28,
            text: '确定', variant: 'primary', onClick: ok
        }));
        client.addChild(new ui.controls.Button({
            x: client.width - 104, y: client.height - 56, width: 88, height: 28,
            text: '取消', onClick: function () { win.destroy(); }
        }));

        win.invalidate();
        setTimeout(function () { if (field.focus) { field.focus(); } }, 80);
    }

    /** 新建注册表项（子键） */
    function promptNewKey() {
        var parent = state.currentPath || '';
        if (!parent) { notify('请先选择一个项'); return; }
        askText('新建项', '', function (name) {
            var path = parent ? (parent + SEP + name) : name;
            var r = reg().set(path, {});
            if (r.status === S.OK) {
                notify('已创建项：' + name);
                refreshTree();
                showValues(parent);
            } else {
                notify('创建失败：' + (r.reason || ''), 'error');
            }
        });
    }

    /** 新建值 */
    function promptNewValue() {
        var path = state.currentPath || '';
        if (!path) { notify('请先选择一个项'); return; }
        askText('新建值名称', '', function (name) {
            askText('值数据（' + name + '）', '', function (data) {
                var r = reg().set(path + SEP + name, data);
                if (r.status === S.OK) {
                    notify('已创建值：' + name);
                    showValues(path);
                } else {
                    notify('创建失败：' + (r.reason || ''), 'error');
                }
            });
        });
    }

    /** 删除选中的值或项 */
    function deleteSelected() {
        var path = state.currentPath || '';
        var idx = state.table ? state.table.selectedIndex : -1;
        if (idx < 0) { notify('请先选择要删除的内容'); return; }
        var rows = state.table.rows || [];
        var row = rows[idx];
        if (!row) { return; }
        var name = row[0];
        var target = path ? (path + SEP + name) : name;
        var r = reg().delete(target);
        if (r.status === S.OK) {
            notify('已删除：' + name);
            refreshTree();
            showValues(path);
        } else {
            notify('删除失败：' + (r.reason || ''), 'error');
        }
    }

    /** 通知（应用内提示） */
    function notify(text, level) {
        var nc = G.EznK.Shell && G.EznK.Shell.notifications;
        if (nc) {
            nc.push({ title: '注册表编辑器', text: String(text).slice(0, 100),
                level: level || 'info', timeout: 2500 });
        }
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

        /* 自适应：工具栏按钮在窄窗口下换行，表格跟随尺寸 */
        win._layoutFn = function (cw, ch) {
            var btns = [];
            win.client.children.forEach(function (c) {
                if (c.constructor && c.constructor.name === 'Button') { btns.push(c); }
            });
            /* 按钮从左到右排，一行放不下就换到下一行 */
            var x = 268, y = 4, BAR = 34;
            var btnH = 26, gap = 8;
            btns.forEach(function (btn) {
                if (x + btn.width > cw - 8) { x = 268; y += btnH + gap; }
                btn.x = x; btn.y = y;
                x += btn.width + gap;
            });
            var barH = y + btnH + 4;
            win.client.children.forEach(function (c) {
                if (c.constructor && c.constructor.name === 'Table') {
                    c.y = barH;
                    c.height = Math.max(60, ch - barH - 22);
                    c.width = Math.max(120, cw - 268);
                }
                if (c.constructor && c.constructor.name === 'Control') {
                    c.width = Math.max(60, cw - 260);
                    c.height = barH;
                }
            });
            win.client.invalidate();
        };



        /* ---- 工具栏：新建键 / 新建值 / 删除（Windows 注册表编辑器习惯） ---- */
        var BAR_H = 34;
        var bar = new ui.Control({ x: 260, y: 0, width: client.width - 260, height: BAR_H });
        bar.onPaint = function (dc) {
            var th = ui.res.theme().value;
            ezn32.api.gdi.FillRect(dc, 0, 0, bar.width, bar.height, th.surfaceAlt);
            ezn32.api.gdi.DrawLine(dc, 0, bar.height - 1, bar.width, bar.height - 1, th.border, 1);
        };

        client.addChild(new ui.controls.Button({
            x: 268, y: 4, width: 110, height: 26, text: '📁 新建项',
            onClick: function () { promptNewKey(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 386, y: 4, width: 130, height: 26, text: '📝 新建值',
            onClick: function () { promptNewValue(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 524, y: 4, width: 100, height: 26, text: '🗑 删除',
            variant: 'danger',
            onClick: function () { deleteSelected(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 632, y: 4, width: 100, height: 26, text: '🔄 刷新',
            onClick: function () {
                refreshTree();
                if (state.currentPath !== null) { showValues(state.currentPath); }
            }
        }));

        /* 表格下移，给工具栏让位 */
        table.y = BAR_H;
        table.height = Math.max(60, client.height - BAR_H - 22);

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

    var RE = { version: '1.1.0', id: APP.id, displayName: '注册表编辑器', icon: APP.icon, open: open, register: register, showValues: showValues, refreshTree: function () { }, newKey: promptNewKey, newValue: promptNewValue, del: deleteSelected };
    G.EznK.Apps.registryEditor = RE;
    register();
    CORE.createLogger('EznK/L6:regedit').info('js/apps/registry-editor.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
