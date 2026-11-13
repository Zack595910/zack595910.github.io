/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L6 应用层
 *
 *   文件 : js/apps/file-dialog.js
 *   模块 : EznK.Apps.fileDialog
 *   层级 : L6 应用层
 *
 * ---------------------------------------------------------------------
 * 文件对话框：打开 / 另存为（对齐 Windows 操作习惯）
 * ---------------------------------------------------------------------
 *   Windows 的"打开"和"另存为"都是独立模态窗口，包含：
 *     · 顶部：位置下拉（快速跳转）+ 导航按钮（上一级 / 桌面 / 文档）
 *     · 中部：文件列表（名称 / 类型 / 大小），单击选中、双击确定
 *     · 底部：文件名输入框 + 文件类型下拉 + 打开/保存 + 取消
 *
 *   用法：
 *     fileDialog.open({  mode: 'open'|'save',
 *                        title, dir, fileName, filters: ['.txt','.rf'],
 *                        onOk: function (path) {} })
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.fileDialog) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;
    var api = ezn32.api;

    function userRoot() {
        var u = G.EznK.Service && G.EznK.Service.user;
        var cur = u ? u.currentUser().value : null;
        return '/Users/' + (cur ? cur.name : 'User');
    }

    var st = { dir: '/', filter: '', selected: null, fileName: '' };

    /**
     * open(opts)
     *   opts.mode     'open' | 'save'
     *   opts.title    窗口标题
     *   opts.dir      起始目录
     *   opts.fileName 起始文件名（另存为用）
     *   opts.filters  扩展名数组，如 ['.txt', '.rf']；空表示全部
     *   opts.onOk     function(path) 选定后回调
     */
    function open(opts) {
        var o = opts || {};
        var mode = o.mode === 'save' ? 'save' : 'open';
        var filters = Array.isArray(o.filters) ? o.filters : [];
        var extFilter = filters.length ? filters : null;

        var startDir = o.dir || (userRoot() + '/Documents');
        st.dir = startDir;
        st.filter = extFilter ? extFilter[0] : '';
        st.selected = null;
        st.fileName = o.fileName || '';

        var winsvc = G.EznK.Service && G.EznK.Service.window;
        var title = o.title || (mode === 'save' ? '另存为' : '打开');
        var created = winsvc
            ? winsvc.open({ title: title, width: 680, height: 480, icon: '📂', modal: true })
            : ui.Window.Create({ title: title, width: 680, height: 480, icon: '📂' });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        var client = win.client;

        var TOPBAR_H = 34;
        var BOTTOM_H = 76;
        var STATUS_H = 22;

        /* ---- 顶部：导航 ---- */
        var top = new ui.Control({ x: 0, y: 0, width: client.width, height: TOPBAR_H });
        top.onPaint = function (dc) {
            var th = ui.res.theme().value;
            ezn32.api.gdi.FillRect(dc, 0, 0, top.width, top.height, th.surfaceAlt);
            ezn32.api.gdi.DrawLine(dc, 0, top.height - 1, top.width, top.height - 1, th.border, 1);
        };
        client.addChild(top);

        client.addChild(new ui.controls.Button({
            x: 8, y: 4, width: 80, height: 26, text: '⬆ 上一级',
            onClick: function () { goUp(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 92, y: 4, width: 80, height: 26, text: '🏠 桌面',
            onClick: function () { navigate(userRoot() + '/Desktop'); }
        }));
        client.addChild(new ui.controls.Button({
            x: 176, y: 4, width: 80, height: 26, text: '📄 文档',
            onClick: function () { navigate(userRoot() + '/Documents'); }
        }));
        client.addChild(new ui.controls.Button({
            x: 260, y: 4, width: 80, height: 26, text: '💿 系统盘',
            onClick: function () { navigate('/'); }
        }));

        var pathLabel = new ui.controls.Label({
            x: 350, y: 8, width: client.width - 358, text: startDir, color: 'textSecondary'
        });
        client.addChild(pathLabel);

        /* ---- 中部：文件列表 ---- */
        var listTop = TOPBAR_H;
        var listH = client.height - TOPBAR_H - BOTTOM_H - STATUS_H;
        var list = new ui.controls.ListBox({
            x: 0, y: listTop, width: client.width, height: listH,
            items: [],
            onSelect: function (item) {
                if (!item) { return; }
                st.selected = item;
                if (item.type === 'file') {
                    nameField.setValue(item.text);
                }
            },
            onActivate: function (item) {
                if (!item) { return; }
                if (item.type === 'dir') { navigate(item.path); return; }
                st.selected = item;
                accept(item.path);
            }
        });
        client.addChild(list);

        /* ---- 底部：文件名 / 类型 / 按钮 ---- */
        var bottomY = client.height - BOTTOM_H - STATUS_H;

        client.addChild(new ui.controls.Label({
            x: 12, y: bottomY + 6, width: 80, text: '文件名:'
        }));
        var nameField = new ui.controls.Edit({
            x: 96, y: bottomY + 4, width: client.width - 120, height: 26
        });
        nameField.setValue(st.fileName);
        nameField.onEnter = function () {
            var v = String(nameField.getValue() || '').trim();
            if (!v) { return; }
            var full = (st.dir === '/' ? '' : st.dir) + '/' + v;
            accept(full);
        };
        client.addChild(nameField);

        client.addChild(new ui.controls.Label({
            x: 12, y: bottomY + 40, width: 80, text: '文件类型:'
        }));
        var typeBtn = new ui.controls.Button({
            x: 96, y: bottomY + 38, width: 220, height: 26,
            text: (extFilter ? ('*' + extFilter[0]) : '所有文件'),
            onClick: function () {
                var opts = [{ t: '所有文件', v: '' }].concat(
                    filters.map(function (f) { return { t: '*' + f, v: f }; }));
                var cm = ui.ContextMenu;
                cm.Show({
                    x: 200, y: 300,
                    items: opts.map(function (op) {
                        return {
                            text: op.t,
                            checked: st.filter === op.v,
                            onClick: function () {
                                st.filter = op.v;
                                typeBtn.setText(op.t);
                                refresh();
                            }
                        };
                    })
                });
            }
        });
        client.addChild(typeBtn);

        client.addChild(new ui.controls.Button({
            x: client.width - 220, y: bottomY + 38, width: 100, height: 28,
            text: mode === 'save' ? '保存' : '打开',
            variant: 'primary',
            onClick: function () {
                if (mode === 'save') {
                    var v = String(nameField.getValue() || '').trim();
                    if (!v) {
                        if (status) { status.setPane('main', '请输入文件名'); }
                        return;
                    }
                    if (st.filter && v.slice(-st.filter.length).toLowerCase() !== st.filter.toLowerCase()) {
                        v += st.filter;
                    }
                    accept((st.dir === '/' ? '' : st.dir) + '/' + v);
                } else {
                    if (st.selected && st.selected.type === 'file') {
                        accept(st.selected.path);
                    } else {
                        var v2 = String(nameField.getValue() || '').trim();
                        if (v2) { accept((st.dir === '/' ? '' : st.dir) + '/' + v2); }
                        else if (status) { status.setPane('main', '请选择一个文件'); }
                    }
                }
            }
        }));
        client.addChild(new ui.controls.Button({
            x: client.width - 112, y: bottomY + 38, width: 100, height: 28,
            text: '取消',
            onClick: function () { close(); }
        }));

        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - STATUS_H, width: client.width, height: STATUS_H,
            panes: [{ id: 'main', text: '就绪', flex: 1 }]
        });
        client.addChild(status);

        /* ---- 行为 ---- */
        function accept(path) {
            var resolved = path;
            /* 没有扩展名且指定了过滤器则补上 */
            if (mode === 'save' && st.filter) {
                var dot = resolved.lastIndexOf('/') >= 0
                    ? resolved.slice(resolved.lastIndexOf('/')).indexOf('.') : resolved.indexOf('.');
                if (dot < 0) { resolved += st.filter; }
            }
            close();
            if (typeof o.onOk === 'function') {
                try { o.onOk(resolved); } catch (err) {
                    var nc = G.EznK.Shell && G.EznK.Shell.notifications;
                    if (nc) { nc.push({ title: '文件对话框', text: err.message, level: 'error' }); }
                }
            }
        }

        function close() {
            if (win && !win.destroyed) { win.destroy(); }
        }

        function goUp() {
            if (st.dir === '/' || !st.dir) { return; }
            var parent = st.dir.slice(0, st.dir.lastIndexOf('/')) || '/';
            navigate(parent);
        }

        function navigate(dir) {
            st.dir = dir;
            pathLabel.setText(dir);
            return api.kernel.FindFiles(dir).then(function (r) {
                if (r.status !== S.OK) {
                    status.setPane('main', '无法打开：' + (r.reason || ''));
                    list.setItems([]);
                    return r;
                }
                var entries = r.value.slice(0);
                /* 目录在前，按名称排序 */
                entries.sort(function (a, b) {
                    if (a.type !== b.type) { return a.type === 'dir' ? -1 : 1; }
                    return a.name.localeCompare(b.name, 'zh-Hans-CN');
                });
                var items = entries.filter(function (e) {
                    if (e.type === 'dir') { return true; }
                    if (!st.filter) { return true; }
                    return e.name.toLowerCase().slice(-st.filter.length) === st.filter.toLowerCase();
                }).map(function (e) {
                    var ext = e.name.lastIndexOf('.') >= 0 ? e.name.slice(e.name.lastIndexOf('.')) : '';
                    var type = e.type === 'dir' ? '文件夹' : (ext || '文件');
                    var size = e.type === 'dir' ? '' : ((e.size || 0) / 1024).toFixed(1) + ' KB';
                    return {
                        id: e.path,
                        text: e.name.padEnd(28) + '  ' + type.padEnd(10) + '  ' + size,
                        icon: e.type === 'dir' ? '📁' : '📄',
                        type: e.type,
                        path: e.path,
                        name: e.name
                    };
                });
                list.setItems(items);
                status.setPane('main', items.length + ' 个项目  |  ' + dir);
                return CORE.ok(items.length);
            });
        }

        /* 自适应 */
        win._layoutFn = function (cw, ch) {
            top.width = cw;
            list.width = cw;
            list.height = Math.max(60, ch - TOPBAR_H - BOTTOM_H - STATUS_H);
            nameField.width = Math.max(120, cw - 120);
            typeBtn.y = ch - BOTTOM_H - STATUS_H + 38;
            pathLabel.width = Math.max(100, cw - 358);
            status.y = ch - STATUS_H;
            status.width = cw;
            win.client.invalidate();
        };

        navigate(st.dir);
        win.invalidate();
        setTimeout(function () { if (nameField.focus) { nameField.focus(); } }, 80);
        return CORE.ok(win);
    }

    var FD = {
        version: '1.0.0',
        open: open,
        openDialog: function (o) { return open(Object.assign({ mode: 'open' }, o || {})); },
        saveDialog: function (o) { return open(Object.assign({ mode: 'save' }, o || {})); },
        state: function () { return st; }
    };

    /* 注册为应用以便开始菜单显示为"文件对话框"（Windows 也有它的位置），
     * 但默认不在开始菜单列出——它由编辑器/文件管理器调用。 */
    var reg = G.EznK.Service && G.EznK.Service.appRegistry;
    if (reg) {
        reg.register({
            id: 'file-dialog', name: '文件对话框', icon: '🚀',
            category: 'system', builtin: true, hidden: true,
            description: '打开 / 另存为对话框'
        });
    }
    G.EznK.Apps.fileDialog = FD;
    CORE.createLogger('EznK/L6:filedialog').info('js/apps/file-dialog.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
