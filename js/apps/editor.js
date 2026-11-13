/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 6 - Application Layer
 *
 *   File    : js/apps/editor.js
 *   Module  : EznK.Apps.editor
 *   Layer   : L6 应用层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The code editor. It edits ANY text file and routes "Run" by suffix:
 *
 *       .py          -> python runtime
 *       .rf          -> rf runtime
 *       .kd / .html  -> kd runtime
 *       .exc         -> exc runtime
 *       .zjl         -> library check
 *       anything     -> treated as plain text
 *
 *   The editor is the entry point users reach for most often, so it also
 *   provides New / Open / Save / Save As and a live line:column status.
 *
 *   Text is edited through the Ezn32 UI Edit control. Note: the CONTROL
 *   enforces ASCII for SCREEN text; file CONTENT set through setValue()
 *   keeps the user's bytes when allowUnicode is on (decision D6).
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.editor) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L6:editor');

    var ui = ezn32.ui;
    var api = ezn32.api;
    var St = G.EznK.Platform.Storage;

    var APP = {
        id: 'editor', displayName: 'Editor', icon: '[E]',
        width: 760, height: 540
    };

    var state = {
        win: null,
        path: null,
        dirty: false,
        edit: null,
        status: null,
        title: null
    };

    function rt() { return G.EznK.Runtime || {}; }

    /* =================================================================
     * 1. File operations
     * ============================================================== */

    function setPath(path) {
        state.path = path;
        updateTitle();
        updateStatus();
    }

    function updateTitle() {
        if (!state.win) { return; }
        var name = state.path ? state.path.slice(state.path.lastIndexOf('/') + 1) : '未命名';
        state.win.setTitle((state.dirty ? '* ' : '') + name + '');
        if (state.title) { state.title.setText((state.dirty ? '* ' : '') + name); }
    }

    function updateStatus() {
        if (!state.status || !state.edit) { return; }
        var value = state.edit.getValue();
        var before = value.slice(0, state.edit.caret);
        var lines = before.split('\n');
        var line = lines.length;
        var col = lines[lines.length - 1].length + 1;
        state.status.setPane('pos', '行 ' + line + ', 列 ' + col);
        state.status.setPane('type', state.path ? (state.path.slice(state.path.lastIndexOf('.') + 1) || 'txt') : 'txt');
        state.status.setPane('len', value.length + ' 字符');
    }

    function loadFile(path) {
        return api.kernel.ReadFileText(path).then(function (r) {
            if (r.status !== S.OK) {
                notify('Cannot open ' + path, 'error');
                return r;
            }
            state.edit.setValue(r.value);
            state.dirty = false;
            setPath(path);
            return CORE.ok(true);
        });
    }

    function save() {
        if (!state.path) { return saveAs(); }
        return api.kernel.WriteFileText(state.path, state.edit.getValue()).then(function (r) {
            if (r.status === S.OK) {
                state.dirty = false;
                updateTitle();
                notify('Saved ' + state.path, 'info');
            }
            return r;
        });
    }

    /** saveAs() - 弹出"另存为"独立对话框（Windows 习惯） */
    function saveAs() {
        var FD = G.EznK.Apps && G.EznK.Apps.fileDialog;
        if (!FD) {
            notify('文件对话框不可用', 'error');
            return Promise.resolve(CORE.fail(S.ENOSYS, { reason: 'file dialog missing' }));
        }
        var base = state.path ? state.path.split('/').pop() : '未命名.txt';
        var dir = state.path ? state.path.slice(0, state.path.lastIndexOf('/')) : ('/Users/' + currentUser() + '/Documents');
        FD.saveDialog({
            title: '另存为',
            dir: dir,
            fileName: base,
            filters: ['.txt', '.md', '.rf', '.py', '.js', '.kd', '.sys', '.exc', '.c'],
            onOk: function (path) {
                api.kernel.WriteFileText(path, state.edit.getValue()).then(function (r) {
                    if (r.status === S.OK) {
                        state.dirty = false;
                        setPath(path);
                        notify('已保存 ' + path, 'info');
                    } else {
                        notify('保存失败：' + (r.reason || ''), 'error');
                    }
                });
            }
        });
        return Promise.resolve(CORE.ok(true));
    }

    /** openDialog() - 弹出"打开"独立对话框（Windows 习惯） */
    function openDialog() {
        var FD = G.EznK.Apps && G.EznK.Apps.fileDialog;
        if (!FD) { return CORE.fail(S.ENOSYS, { reason: 'file dialog missing' }); }
        FD.openDialog({
            title: '打开',
            dir: '/Users/' + currentUser() + '/Documents',
            filters: ['.txt', '.md', '.rf', '.py', '.js', '.kd', '.sys', '.exc', '.c'],
            onOk: function (path) { loadFile(path); }
        });
        return CORE.ok(true);
    }

    function currentUser() {
        var u = G.EznK.Service && G.EznK.Service.user;
        var cur = u ? u.currentUser().value : null;
        return cur ? cur.name : 'User';
    }

    function notify(text, level) {
        var nc = G.EznK.Shell && G.EznK.Shell.notifications;
        if (nc) { nc.push({ title: '代码编辑器', text: String(text).slice(0, 100), level: level || 'info', timeout: 2500 }); }
    }

    /* =================================================================
     * 2. Run by suffix
     * ============================================================== */

    function run() {
        if (!state.edit) { return Promise.resolve(CORE.fail(S.ENOSYS, { reason: 'no editor' })); }
        var code = state.edit.getValue();
        var path = state.path || '';
        var dot = path.lastIndexOf('.');
        var ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';

        if (ext === '.py') {
            var py = rt().python;
            if (!py) { notify('Python runtime unavailable', 'error'); return Promise.resolve(CORE.fail(S.ENOSYS, {})); }
            return py.run(code).then(function (r) {
                notify(r.status === S.OK ? 'Python finished' : ('Python error: ' + (r.reason || '')),
                    r.status === S.OK ? 'info' : 'error');
                return r;
            });
        }
        if (ext === '.rf') {
            var rf = rt().rf;
            if (!rf) { notify('rf runtime unavailable', 'error'); return Promise.resolve(CORE.fail(S.ENOSYS, {})); }
            return rf.runScript(code).then(function (r) {
                notify(r.status === S.OK ? 'rf script finished' : ('rf error: ' + (r.reason || '')),
                    r.status === S.OK ? 'info' : 'error');
                return r;
            });
        }
        if (ext === '.kd' || ext === '.html') {
            var kd = rt().kd;
            if (!kd) { notify('KD runtime unavailable', 'error'); return Promise.resolve(CORE.fail(S.ENOSYS, {})); }
            var r = kd.openSource(code, (path.split('/').pop() || 'KD App').replace(/\.(kd|html)$/, ''));
            return Promise.resolve(r);
        }
        if (ext === '.exc') {
            var exc = rt().exc;
            if (!exc) { notify('EXC runtime unavailable', 'error'); return Promise.resolve(CORE.fail(S.ENOSYS, {})); }
            return exc.run(code).then(function (r) {
                notify(r.status === S.OK ? 'EXC launched' : ('EXC error: ' + (r.reason || '')),
                    r.status === S.OK ? 'info' : 'error');
                return r;
            });
        }
        notify('No runner for "' + (ext || 'plain text') + '"', 'error');
        return Promise.resolve(CORE.fail(S.ENOENT, { reason: 'no runner for ' + ext }));
    }

    /** 以 rf 脚本运行（忽略文件扩展名） */
    function runAsRf() {
        var rf = rt().rf;
        if (!rf) { notify('rf 运行时不可用', 'error'); return; }
        var code = state.edit ? state.edit.getValue() : '';
        notify('正在以 rf 脚本运行…');
        Promise.resolve(rf.runScript(code)).then(function (r) {
            notify(r.status === S.OK ? 'rf 脚本运行完成' : ('rf 出错：' + (r.reason || '')),
                r.status === S.OK ? 'info' : 'error');
        });
    }

    /** 以 Python 运行（忽略文件扩展名） */
    function runAsPython() {
        var py = rt().python;
        if (!py) { notify('Python 运行时不可用', 'error'); return; }
        var code = state.edit ? state.edit.getValue() : '';
        notify('正在以 Python 运行…');
        Promise.resolve(py.run(code)).then(function (r) {
            notify(r.status === S.OK ? 'Python 运行完成' : ('Python 出错：' + (r.reason || '')),
                r.status === S.OK ? 'info' : 'error');
        });
    }

    /** 以 KD 应用运行（忽略文件扩展名） */
    function runAsKd() {
        var kd = rt().kd;
        if (!kd) { notify('KD 运行时不可用', 'error'); return; }
        var code = state.edit ? state.edit.getValue() : '';
        var name = state.path ? state.path.split('/').pop() : '未命名';
        Promise.resolve(kd.openSource(code, name)).then(function (r) {
            if (r.status !== S.OK) { notify('KD 启动失败：' + (r.reason || ''), 'error'); }
        });
    }

    /* =================================================================
     * 3. Window
     * ============================================================== */

    function open(opts) {
        var o = opts || {};
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '代码编辑器', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '代码编辑器', width: APP.width, height: APP.height });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        state.win = win;
        var client = win.client;

        var menu = new ui.controls.Menu({
            x: 0, y: 0, width: client.width,
            menus: [
                {
                    id: 'file', text: '文件',
                    items: [
                        { id: 'open', text: '打开…', shortcut: 'Ctrl+O', onClick: function () { openDialog(); } },
                        { id: 'save', text: '保存', shortcut: 'Ctrl+S', onClick: function () { save(); } },
                        { id: 'saveas', text: '另存为…', onClick: function () { saveAs(); } },
                        { separator: true },
                        { id: 'close', text: '关闭', onClick: function () { win.destroy(); } }
                    ]
                },
                {
                    id: 'run', text: '运行',
                    items: [
                        { id: 'runnow', text: '运行当前文件', shortcut: 'F5', onClick: function () { run(); } },
                        { separator: true },
                        { id: 'runrf', text: '以 rf 脚本运行', icon: '📜', onClick: function () { runAsRf(); } },
                        { id: 'runpy', text: '以 Python 运行', icon: '🐍', onClick: function () { runAsPython(); } },
                        { id: 'runkd', text: '以 KD 应用运行', icon: '📦', onClick: function () { runAsKd(); } },
                        { separator: true },
                        { id: 'py', text: 'Python 环境状态', onClick: function () {
                            var py = rt().python;
                            var st = py ? py.status().value : null;
                            notify(st ? ('Python: ' + st.label) : 'Python 不可用', 'info');
                        } }
                    ]
                }
            ]
        });
        client.addChild(menu);

        var TOP = ui.controls.Menu.BAR_H;

        var edit = new ui.controls.Edit({
            x: 8, y: TOP + 8,
            width: client.width - 16,
            height: client.height - TOP - 8 - 26,
            multiline: true,
            allowUnicode: true,
            font: 'mono',
            placeholder: ''
        });
        client.addChild(edit);
        state.edit = edit;

        edit.onChange = function () {
            state.dirty = true;
            updateTitle();
            updateStatus();
        };
        edit.onEnter = function () { updateStatus(); };

        /* keyboard: Ctrl+S saves, F5 runs */
        var originalKey = edit.handleKey.bind(edit);
        edit.handleKey = function (d) {
            if (d.ctrlKey && (d.key === 's' || d.key === 'S')) { save(); return 'save'; }
            if (d.key === 'F5') { run(); return 'run'; }
            var r = originalKey(d);
            updateStatus();
            return r;
        };

        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [
                { id: 'pos', text: '行 1, 列 1', width: 130 },
                { id: 'type', text: 'txt', width: 80 },
                { id: 'len', text: '0 字符', flex: 1 }
            ]
        });
        client.addChild(status);
        state.status = status;

        win.invalidate();

        if (o.path) {
            return loadFile(o.path).then(function () { return CORE.ok(win); });
        }
        state.edit.setValue('');
        state.dirty = false;
        setPath(null);
        return CORE.ok(win);
    }

    function register() {
        var reg = G.EznK.Service && G.EznK.Service.appRegistry;
        if (reg) {
            reg.register({
                id: APP.id, name: 'Editor', icon: APP.icon, category: 'tools', builtin: true,
                exts: ['.txt', '.md', '.py', '.zjl', '.json']
            });
        }
        return CORE.ok(true);
    }

    var Editor = {
        version: '1.0.0', id: APP.id, displayName: 'Editor', icon: APP.icon,
        open: open, register: register,
        save: save, saveAs: saveAs, openDialog: openDialog, run: run, loadFile: loadFile,
        runAsRf: runAsRf, runAsPython: runAsPython, runAsKd: runAsKd,
        state: function () { return state; }
    };
    G.EznK.Apps.editor = Editor;
    register();
    LOG.info('js/apps/editor.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
