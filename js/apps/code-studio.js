/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L6 应用层
 *
 *   文件 : js/apps/code-studio.js
 *   模块 : EznK.Apps.codeStudio
 *   层级 : L6 应用层
 *
 *   代码工坊（对应 PTD.html 的 vscode / VS Code Web 窗口）。
 *   左侧文件树、中间编辑器、右侧预览，支持运行各生态脚本：
 *     .py -> Python   .rf -> rf   .kd/.html -> KD   .exc -> EXC
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.codeStudio) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;
    var api = ezn32.api;

    var APP = { id: 'code-studio', displayName: '代码工坊', icon: '💻', width: 900, height: 580 };

    var st = {
        win: null, tree: null, edit: null, status: null,
        path: null, dirty: false
    };

    function rt() { return G.EznK.Runtime || {}; }

    function userDocs() {
        var u = G.EznK.Service.user;
        var cur = u ? u.currentUser().value : null;
        return '/Users/' + (cur ? cur.name : 'User') + '/Documents';
    }

    function refreshTree() {
        if (!st.tree) { return; }
        return api.kernel.FindFiles(userDocs()).then(function (r) {
            var children = [];
            if (r.status === S.OK) {
                children = r.value.map(function (e) {
                    var ext = e.name.lastIndexOf('.') >= 0 ? e.name.slice(e.name.lastIndexOf('.')) : '';
                    return {
                        id: 'file:' + e.path,
                        text: (e.type === 'dir' ? '📁 ' : '📄 ') + e.name,
                        icon: e.type === 'dir' ? '📁' : '📄',
                        data: { path: e.path, type: e.type, ext: ext },
                        children: []
                    };
                });
            }
            st.tree.setRoot({
                id: 'root', text: '📁 我的文档', icon: '📁', expanded: true, children: children
            });
            if (st.win) { st.win.invalidate(); }
            return r;
        });
    }

    function openFile(path) {
        return api.kernel.ReadFileText(path).then(function (r) {
            if (r.status !== S.OK) { return r; }
            st.edit.setValue(r.value);
            st.path = path;
            st.dirty = false;
            updateTitle();
            return r;
        });
    }

    function updateTitle() {
        if (!st.win) { return; }
        var name = st.path ? st.path.split('/').pop() : '未命名';
        st.win.setTitle('代码工坊 - ' + name + (st.dirty ? ' *' : ''));
    }

    function save() {
        if (!st.path) { return Promise.resolve(CORE.fail(S.EINVAL, { reason: '请先选择一个文件' })); }
        return api.kernel.WriteFileText(st.path, st.edit.getValue()).then(function (r) {
            if (r.status === S.OK) {
                st.dirty = false;
                updateTitle();
                if (st.status) { st.status.setPane('main', '已保存 ' + st.path); }
            }
            return r;
        });
    }

    function run() {
        var code = st.edit.getValue();
        var path = st.path || '';
        var dot = path.lastIndexOf('.');
        var ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
        var done = function (r) {
            if (st.status) {
                st.status.setPane('main', r && r.status === S.OK ? '运行完成' : ('运行出错：' + ((r && r.reason) || '')));
            }
            return r;
        };
        if (ext === '.py') {
            var py = rt().python;
            return py ? py.run(code).then(done) : Promise.resolve(CORE.fail(S.ENOSYS, { reason: 'Python 不可用' }));
        }
        if (ext === '.rf') {
            var rf = rt().rf;
            return rf ? rf.runScript(code).then(done) : Promise.resolve(CORE.fail(S.ENOSYS, { reason: 'rf 不可用' }));
        }
        if (ext === '.kd' || ext === '.html') {
            var kd = rt().kd;
            return Promise.resolve(kd ? kd.openSource(code, path.split('/').pop()) : CORE.fail(S.ENOSYS, { reason: 'KD 不可用' }));
        }
        if (ext === '.exc') {
            var exc = rt().exc;
            return exc ? exc.run(code).then(done) : Promise.resolve(CORE.fail(S.ENOSYS, { reason: 'EXC 不可用' }));
        }
        if (st.status) { st.status.setPane('main', '没有可用的运行器：' + (ext || '纯文本')); }
        return Promise.resolve(CORE.fail(S.ENOENT, { reason: 'no runner' }));
    }

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '代码工坊', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '代码工坊', width: APP.width, height: APP.height, icon: APP.icon });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        st.win = win;
        var client = win.client;

        var TOP = 32;
        /* 工具栏 */
        var bar = new ui.Control({ x: 0, y: 0, width: client.width, height: TOP });
        bar.onPaint = function (dc) {
            ezn32.api.gdi.FillRect(dc, 0, 0, bar.width, bar.height, ui.res.theme().value.surfaceAlt);
        };
        client.addChild(bar);
        client.addChild(new ui.controls.Button({
            x: 6, y: 3, width: 90, height: 26, text: '💾 保存',
            onClick: function () { save(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 102, y: 3, width: 90, height: 26, text: '▶ 运行',
            variant: 'primary',
            onClick: function () { run(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 198, y: 3, width: 90, height: 26, text: '🔄 刷新',
            onClick: function () { refreshTree(); }
        }));

        /* 左：文件树 */
        var tree = new ui.controls.TreeView({
            x: 0, y: TOP, width: 210, height: client.height - TOP - 22,
            root: { id: 'root', text: '📁 我的文档', icon: '📁', expanded: true, children: [] },
            onSelect: function (node) {
                if (node.data && node.data.path && node.data.type === 'file') {
                    openFile(node.data.path);
                }
            }
        });
        tree.clipChildren = true;
        client.addChild(tree);
        st.tree = tree;

        /* 右：编辑器 */
        var edit = new ui.controls.Edit({
            x: 214, y: TOP + 2, width: client.width - 218, height: client.height - TOP - 26,
            multiline: true, allowUnicode: true, font: 'mono'
        });
        edit.onChange = function () {
            st.dirty = true;
            updateTitle();
        };
        client.addChild(edit);
        st.edit = edit;

        var sb = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '选择左侧文件开始编辑', flex: 1 }]
        });
        client.addChild(sb);
        st.status = sb;

        refreshTree();
        win.invalidate();
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) {
            r.register({ id: APP.id, name: '代码工坊', icon: APP.icon, category: 'tools', builtin: true,
                exts: ['.txt', '.md', '.py', '.rf', '.kd', '.exc'] });
        }
        return CORE.ok(true);
    }

    var CS = {
        version: '1.0.0', id: APP.id, displayName: '代码工坊', icon: APP.icon,
        open: open, register: register, save: save, run: run, openFile: openFile
    };
    G.EznK.Apps.codeStudio = CS;
    register();
    CORE.createLogger('EznK/L6:studio').info('js/apps/code-studio.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
