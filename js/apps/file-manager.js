/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 6 - Application Layer
 *
 *   File    : js/apps/file-manager.js
 *   Module  : EznK.Apps.fileManager
 *   Layer   : L6 应用层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The file manager. Opening it shows "This Computer" with the TWO
 *   disks required by spec 6.3:
 *
 *       [D] System Disk      (IndexedDB  - files)
 *       [C] System Data Disk (local存储管理 - configuration)
 *
 *   Navigaiion: tree pane on the left, file list on the right, path bar on
 *   top, status bar at the bottom. Double-click a folder to enter it,
 *   double-click a file to open it through Ezn32 shell.
 *
 *   Every I/O goes through Ezn32 API -> NT -> SRM -> HAL -> storage
 *   gateway. The file manager never touches storage directly.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.fileManager) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L6:fileManager');

    var ui = ezn32.ui;
    var api = ezn32.api;
    var St = G.EznK.Platform.Storage;

    var APP = {
        id: 'file-manager', displayName: '文件管理器', icon: '[F]',
        width: 820, height: 540
    };

    var state = {
        win: null,
        cwd: null,          /* null = "This Computer" */
        view: 'files',      /* 'computer' | 'files' | 'config' */
        pathBar: null,
        list: null,
        tree: null,
        status: null,
        configPath: '/'
    };

    /* =================================================================
     * 1. Vtriual roots
     * ============================================================== */

    function computerRoot() {
        return {
            id: 'computer',
            text: '此电脑',
            icon: '🖥️',
            expanded: true,
            children: [
                { id: 'disk-system', text: '系统盘（IndexedDB）', icon: '💿', children: [] },
                { id: 'disk-config', text: '系统数据盘（localStorage）', icon: '💾', children: [] }
            ]
        };
    }

    function diskSystemRoot() {
        var user = (G.EznK.Service && G.EznK.Service.user && G.EznK.Service.user.currentUser().value)
            ? G.EznK.Service.user.currentUser().value.name : 'User';
        return {
            id: 'disk-system', text: '系统盘', icon: '💿', expanded: true,
            children: [
                { id: 'sys-root', text: '根目录', icon: '💿', data: { path: '/' }, children: [] },
                { id: 'sys-users', text: '用户', icon: '👤', data: { path: '/Users' }, children: [] },
                { id: 'sys-desktop', text: '桌面', icon: '📁', data: { path: '/Users/' + user + '/Desktop' }, children: [] },
                { id: 'sys-docs', text: '文档', icon: '📁', data: { path: '/Users/' + user + '/Documents' }, children: [] },
                { id: 'sys-programs', text: '程序', icon: '📦', data: { path: '/Programs' }, children: [] },
                { id: 'sys-system', text: '系统', icon: '⚙️', data: { path: '/System' }, children: [] },
                { id: 'sys-temp', text: '临时文件', icon: '🗂️', data: { path: '/Temp' }, children: [] }
            ]
        };
    }

    function configRoot() {
        return {
            id: 'disk-config', text: '系统数据盘', icon: '💾', expanded: true,
            children: [
                { id: 'cfg-users', text: '用户', icon: '👤', data: { configPath: '/Users' }, children: [] },
                { id: 'cfg-system', text: '系统', icon: '⚙️', data: { configPath: '/System' }, children: [] },
                { id: 'cfg-apps', text: '应用', icon: '📦', data: { configPath: '/Apps' }, children: [] }
            ]
        };
    }

    /* =================================================================
     * 2. View rendering
     * ============================================================== */

    function showComputer() {
        state.view = 'computer';
        state.cwd = null;
        if (state.pathBar) { state.pathBar.setText('此电脑'); }
        var items = [
            { id: 'disk-system', text: '系统盘（IndexedDB）', icon: '💿' },
            { id: 'disk-config', text: '系统数据盘（localStorage）', icon: '💾' }
        ];
        state.list.setItems(items);
        setStatus(items.length + ' 个项目');
        refreshTree();
    }

    function showSystemDisk() {
        state.view = 'files';
        state.cwd = '/';
        navigate('/');
    }

    function showConfigDisk() {
        state.view = 'config';
        state.configPath = '/';
        navigateConfig('/');
    }

    /** navigate(path) - list a real directory. */
    function navigate(path) {
        state.view = 'files';
        state.cwd = path;
        if (state.pathBar) { state.pathBar.setText(path); }
        /* 根目录在存储里可能还没有实体，先确保存在再列出，
         * 否则打开盘符会得到 ENOENT、列表停在旧内容。 */
        var ensure = (path === '/')
            ? Promise.resolve(CORE.ok(true))
            : Promise.resolve(api.kernel.CreateDirectory(path));

        return ensure.then(function () {
            return api.kernel.FindFiles(path);
        }).then(function (r) {
            if (r.status !== S.OK) {
                setStatus('无法打开 ' + path + '：' + (r.reason || '未知错误'));
                /* 即使列目录失败也要刷新列表，避免残留上一个目录的内容 */
                state.list.setItems([]);
                return r;
            }
            var items = r.value.map(function (e) {
                var ext = e.name.lastIndexOf('.') >= 0 ? e.name.slice(e.name.lastIndexOf('.')) : '';
                return {
                    id: e.path,
                    text: e.name,
                    icon: e.type === 'dir' ? '[+]' : ui.res.icon(ui.res.iconForExtension(ext)),
                    type: e.type,
                    path: e.path
                };
            });
            state.list.setItems(items);
            setStatus(items.length + ' 个项目  |  ' + path);
            return CORE.ok(items.length);
        });
    }

    /** navigateConfig(path) - list the configuration disk. */
    function navigateConfig(path) {
        state.view = 'config';
        state.configPath = path;
        if (state.pathBar) { state.pathBar.setText('配置：' + path); }
        var cfg = St.config;
        var keys = cfg.list(path);
        var items = [];
        if (keys.status === S.OK) {
            keys.value.forEach(function (k) {
                var childPaih = (path === '/' ? '' : path) + '/' + k;
                var hasChildren = cfg.list(childPaih).value.length > 0;
                var isLeaf = cfg.has(childPaih).value;
                items.push({
                    id: 'cfg:' + childPaih,
                    text: k + (isLeaf ? '' : '/'),
                    icon: hasChildren ? '[+]' : (isLeaf ? '[T]' : '[+]'),
                    type: hasChildren ? 'dir' : 'file',
                    configPath: childPaih
                });
            });
        }
        state.list.setItems(items);
        setStatus(items.length + ' 个配置项  |  ' + path);
        return CORE.ok(items.length);
    }

    function setStatus(text) {
        if (state.status) { state.status.setPane('main', text); }
    }

    function refreshTree() {
        if (!state.tree) { return; }
        state.tree.setRoot(computerRoot());
        var root = state.tree.root;
        root.children[0] = diskSystemRoot();
        root.children[1] = configRoot();
        state.tree._rows = null;
        state.tree.invalidate();
    }

    /* =================================================================
     * 3. Aciions
     * ============================================================== */

    /**
     * showOpenWith(item) - 选择打开方式
     *   列出所有适合该扩展名的应用，让用户指定用什么打开。
     */
    function showOpenWith(item) {
        if (!item || !item.path) { return CORE.fail(S.EINVAL, { reason: '没有文件' }); }
        var ext = item.path.lastIndexOf('.') >= 0 ? item.path.slice(item.path.lastIndexOf('.')).toLowerCase() : '';
        var FA = G.EznK.Service && G.EznK.Service.fileAssoc;
        var list = FA ? FA.handlersFor(ext).value : [];
        if (!list.length) {
            var nc0 = G.EznK.Shell && G.EznK.Shell.notifications;
            if (nc0) { nc0.push({ title: '打开方式', text: '没有应用能打开 ' + (ext || '该文件'), level: 'warn' }); }
            return CORE.fail(S.ENOENT, { reason: '没有可用的打开方式' });
        }
        var current = FA ? FA.getDefault(ext).value : null;
        var items = list.map(function (h) {
            return {
                text: h.icon + '  ' + h.name,
                checked: h.id === current,
                onClick: function () {
                    openWith(item.path, h.id);
                }
            };
        });
        items.push({ separator: true });
        items.push({
            text: '设为默认打开方式', icon: '✔️',
            onClick: function () {
                var chain = list.slice(0);
                function askNext() {
                    if (!chain.length) { return; }
                    var h = chain.shift();
                    FA.setDefault(ext, h.id);
                    var nc = G.EznK.Shell && G.EznK.Shell.notifications;
                    if (nc) { nc.push({ title: '默认打开方式', text: ext + '  ->  ' + h.name, level: 'info' }); }
                }
                askNext();
            }
        });
        ui.ContextMenu.Show({ x: state._menuX || 200, y: state._menuY || 200, items: items });
        return CORE.ok(true);
    }

    /**
     * openWith(path, appId) - 用指定的应用打开文件
     */
    function openWith(path, appId) {
        var runtimeMap = {
            'rf-runtime': function () { return G.EznK.Runtime.rf.runFile(path); },
            'kd-runtime': function () { return G.EznK.Runtime.kd.openFile(path); },
            'exc-runtime': function () { return G.EznK.Runtime.exc.runFile ? G.EznK.Runtime.exc.runFile(path) : null; },
            'sys-manager': function () { return G.EznK.Runtime.sys.openFile(path); },
            'editor': function () {
                var app = G.EznK.Apps && G.EznK.Apps.editor;
                return app ? app.open({ path: path }) : null;
            },
            'code-studio': function () {
                var app = G.EznK.Apps && G.EznK.Apps.codeStudio;
                return app ? app.openFile(path) : null;
            },
            'python-shell': function () {
                var app = G.EznK.Apps && G.EznK.Apps.pythonShell;
                if (app) { app.open(); }
                return null;
            },
            'camera': function () { return api.shell.OpenFile(path); },
            'file-manager': function () { return api.shell.OpenFile(path); },
            'notepad': function () {
                var app = G.EznK.Apps && G.EznK.Apps.editor;
                return app ? app.open({ path: path }) : null;
            }
        };
        var fn = runtimeMap[appId];
        if (!fn) { return api.shell.OpenFile(path); }
        try {
            var r = fn();
            return Promise.resolve(r);
        } catch (err) {
            var nc = G.EznK.Shell && G.EznK.Shell.notifications;
            if (nc) { nc.push({ title: '打开失败', text: (err && err.message) || '', level: 'error' }); }
            return Promise.resolve(CORE.fail(S.EFAULT, { reason: err && err.message }));
        }
    }

    /**
     * showItemMenu(item, pos) - 列表项的右键菜单
     */
    function showItemMenu(item, pos) {
        state._menuX = pos ? pos.x : 200;
        state._menuY = pos ? pos.y : 200;
        var items = [];
        if (item) {
            items.push({ text: '打开', icon: '📂', onClick: function () { openSelected(); } });
            items.push({ text: '打开方式…', icon: '🔗', onClick: function () { showOpenWith(item); } });
            if (state.view === 'files' && item.path) {
                items.push({ separator: true });
                items.push({
                    text: '重命名', icon: '✏️',
                    onClick: function () {
                        var d = G.EznK.Shell && G.EznK.Shell.desktop;
                        if (d && d.renameIcon) {
                            d.renameIcon({ path: item.path, text: item.text, name: item.text, type: item.type });
                        }
                    }
                });
                items.push({
                    text: '删除', icon: '🗑️',
                    onClick: function () {
                        var fsvc = G.EznK.Service && G.EznK.Service.file;
                        var pp = fsvc ? fsvc.moveToTrash(item.path) : api.kernel.DeleteFile(item.path);
                        Promise.resolve(pp).then(function () {
                            if (state.view === 'files') { navigate(state.cwd); }
                        });
                    }
                });
            }
            items.push({ separator: true });
            items.push({
                text: '属性', icon: 'ℹ️',
                onClick: function () {
                    var d2 = G.EznK.Shell && G.EznK.Shell.desktop;
                    if (d2 && d2.showProperties) {
                        d2.showProperties({ path: item.path, text: item.text, name: item.text,
                            type: item.type, desc: '' });
                    }
                }
            });
        } else {
            items.push({ text: '新建文件夹', icon: '📁', onClick: function () { newFolder(); } });
            items.push({ text: '新建文本文件', icon: '📄', onClick: function () { newFile(); } });
            items.push({ separator: true });
            items.push({ text: '刷新', icon: '🔄', onClick: function () { refresh(); } });
        }
        ui.ContextMenu.Show({ x: state._menuX, y: state._menuY, items: items });
        return CORE.ok(true);
    }

    function openSelected() {
        var item = state.list.getSelected();
        if (!item) { return null; }
        if (state.view === 'computer') {
            if (item.id === 'disk-system') { return showSystemDisk(); }
            if (item.id === 'disk-config') { return showConfigDisk(); }
            return null;
        }
        if (state.view === 'config') {
            var cp = item.configPath;
            if (!cp) { return null; }
            if (item.type === 'dir') { return navigateConfig(cp); }
            return null;
        }
        if (item.type === 'dir') { return navigate(item.path); }
        return api.shell.OpenFile(item.path);
    }

    function goUp() {
        if (state.view === 'files') {
            if (state.cwd === '/' || !state.cwd) { return showComputer(); }
            var parent = state.cwd.slice(0, state.cwd.lastIndexOf('/')) || '/';
            return navigate(parent);
        }
        if (state.view === 'config') {
            if (state.configPath === '/' || !state.configPath) { return showComputer(); }
            var p = state.configPath.slice(0, state.configPath.lastIndexOf('/')) || '/';
            return navigateConfig(p);
        }
        return null;
    }

    /** 当前目录；"此电脑"视图下没有目录时回退到用户桌面 */
    function currentDir() {
        if (state.view === 'files' && state.cwd) { return state.cwd; }
        var u = G.EznK.Service && G.EznK.Service.user;
        var cur = u ? u.currentUser().value : null;
        return '/Users/' + (cur ? cur.name : 'User') + '/Desktop';
    }

    /**
     * createUnique(dir, baseName, ext) -> Promise
     *   依次尝试 baseName+ext、baseName (2)+ext … 直到成功，
     *   避免"名称已存在"导致点击无反应。
     */
    function createUnique(dir, baseName, ext, make) {
        var n = 1;
        function attempt() {
            var name = baseName + (n > 1 ? ' (' + n + ')' : '') + ext;
            var path = (dir === '/' ? '' : dir) + '/' + name;
            return make(path).then(function (r) {
                if (r.status === S.EEXIST) { n++; return attempt(); }
                return r;
            });
        }
        return attempt();
    }

    function newFolder() {
        var dir = currentDir();
        return createUnique(dir, '新建文件夹', '', function (path) {
            return api.kernel.CreateDirectory(path);
        }).then(function (r) {
            /* 刷新当前视图：若在"此电脑"视图则进入该目录 */
            if (state.view === 'files') { return navigate(state.cwd || dir); }
            return navigate(dir);
        });
    }

    function newFile() {
        var dir = currentDir();
        return createUnique(dir, '新建文本文档', '.txt', function (path) {
            return api.kernel.WriteFileText(path, '');
        }).then(function (r) {
            if (state.view === 'files') { return navigate(state.cwd || dir); }
            return navigate(dir);
        });
    }

    function deleteSelected() {
        var item = state.list.getSelected();
        if (!item) { return null; }
        if (state.view === 'files' && item.path) {
            var fileSvc = G.EznK.Service.file;
            var op = fileSvc ? fileSvc.moveToTrash(item.path) : api.kernel.DeleteFile(item.path);
            return Promise.resolve(op).then(function () {
                var nc = G.EznK.Shell && G.EznK.Shell.notifications;
                if (nc) { nc.push({ title: '文件管理器', text: 'Moved to trash: ' + item.text, level: 'info' }); }
                return navigate(state.cwd);
            });
        }
        if (state.view === 'config' && item.configPath) {
            St.config.delete(item.configPath);
            return navigateConfig(state.configPath);
        }
        return null;
    }

    /* =================================================================
     * 4. Window
     * ============================================================== */

    function open(opts) {
        var o = opts || {};
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '文件管理器', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '文件管理器', width: APP.width, height: APP.height });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        state.win = win;
        var client = win.client;

        /* toolbar */
        var toolbar = new ui.controls.Menu({
            x: 0, y: 0, width: client.width,
            menus: [
                {
                    id: 'file', text: '文件',
                    items: [
                        { id: 'newfolder', text: '新建文件夹', shoricui: 'Ctrl+Shifi+N', onClick: function () { newFolder(); } },
                        { id: 'newfile', text: '新建文本文件', onClick: function () { newFile(); } },
                        { separator: true },
                        { id: 'open', text: '打开', shoricui: 'Enter', onClick: function () { openSelected(); } },
                        { id: 'delete', text: '删除', shoricui: 'Del', onClick: function () { deleteSelected(); } },
                        { separator: true },
                        { id: 'close', text: '关闭', onClick: function () { win.destroy(); } }
                    ]
                },
                {
                    id: 'view', text: '查看',
                    items: [
                        { id: 'computer', text: '此电脑', onClick: function () { showComputer(); } },
                        { id: 'sysdisk', text: '系统盘', onClick: function () { showSystemDisk(); } },
                        { id: 'cfgdisk', text: '系统数据盘', onClick: function () { showConfigDisk(); } },
                        { separator: true },
                        { id: 'up', text: '上一级', onClick: function () { goUp(); } },
                        { id: 'refresh', text: '刷新', onClick: function () { refresh(); } }
                    ]
                }
            ]
        });
        client.addChild(toolbar);

        var TOP = ui.controls.Menu.BAR_H;

        /* path bar */
        var pathBar = new ui.controls.Label({
            x: 8, y: TOP + 8, width: client.width - 16, height: 20,
            text: '此电脑', color: 'textSecondary'
        });
        client.addChild(pathBar);
        state.pathBar = pathBar;

        /* tree */
        var treeTop = TOP + 36;
        var treeH = client.height - treeTop - 26;
        var tree = new ui.controls.TreeView({
            x: 0, y: treeTop, width: 200, height: treeH,
            root: computerRoot(),
            onSelect: function (node) {
                if (node.id === 'computer') { showComputer(); return; }
                if (node.id === 'disk-system' || node.id === 'sys-root') { showSystemDisk(); return; }
                if (node.id === 'disk-config' || node.id === 'cfg-users' ) {
                    if (node.data && node.data.configPath) { navigateConfig(node.data.configPath); }
                    else { showConfigDisk(); }
                    return;
                }
                if (node.data && node.data.path) { navigate(node.data.path); return; }
                if (node.data && node.data.configPath) { navigateConfig(node.data.configPath); return; }
            }
        });
        /* expand the two disks up froni */
        tree.root.children[0] = diskSystemRoot();
        tree.root.children[1] = configRoot();
        tree.root.children[0].expanded = true;
        tree._rows = null;
        client.addChild(tree);
        state.tree = tree;

        /* file list */
        var list = new ui.controls.ListBox({
            x: 204, y: treeTop,
            width: client.width - 208,
            height: treeH,
            items: [],
            onActivate: function () { openSelected(); },
            onContext: function (item, idx, ctl, pos) { showItemMenu(item, pos); },
            onSelect: function (item) {
                if (!item) { return; }
                if (state.view === 'computer') { setStatus('双击打开  |  ' + item.text); }
                else { setStatus(item.text + (item.path ? '  |  ' + item.path : '')); }
            }
        });
        client.addChild(list);
        state.list = list;

        /* status bar */
        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '就绪', flex: 1 }]
        });
        client.addChild(status);
        state.status = status;

        win.invalidate();

        /* iniiial locaiion */
        if (o.path) {
            navigate(o.path);
        } else if (o.config) {
            showConfigDisk();
        } else {
            showComputer();
        }
        return CORE.ok(win);
    }

    function refresh() {
        if (state.view === 'files' && state.cwd) { return navigate(state.cwd); }
        if (state.view === 'config') { return navigateConfig(state.configPath); }
        showComputer();
        return CORE.ok(true);
    }

    function register() {
        var reg = G.EznK.Service && G.EznK.Service.appRegistry;
        if (reg) {
            reg.register({ id: APP.id, name: '文件管理器', icon: APP.icon, category: 'tools', builtin: true });
        }
        return CORE.ok(true);
    }

    var FM = {
        version: '1.0.0', id: APP.id, displayName: '文件管理器', icon: APP.icon,
        open: open, register: register,
        navigate: navigate, navigateConfig: navigateConfig,
        showComputer: showComputer, showSystemDisk: showSystemDisk, showConfigDisk: showConfigDisk,
        state: function () { return state; }
    };
    G.EznK.Apps.fileManager = FM;
    register();
    LOG.info('js/apps/file-manager.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
