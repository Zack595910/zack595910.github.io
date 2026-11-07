/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L6 应用层
 *
 *   文件 : js/apps/sys-manager.js
 *   模块 : EznK.Apps.sysManager
 *   层级 : L6 应用层
 *
 * ---------------------------------------------------------------------
 * System Control —— 完整对齐 PTD.html 的 sysmanager
 * ---------------------------------------------------------------------
 *   PTD 的 System Control 是一个 .sys 系统级脚本编辑器：
 *     · 菜单栏：文件（新建 / 打开 / 保存 / 另存为 / 关闭）
 *               运行（运行当前脚本 / 安装为系统更新）
 *     · 工具栏：▶ 运行   📦 安装更新   + 标题文字
 *     · 编辑器：等宽字体、多行
 *     · 状态栏：文件名 / 行:列 / ".sys 系统级脚本"
 *     · 快捷键：Ctrl+S 保存、F5 运行
 *
 *   脚本执行通过 EznK.Runtime.sys —— 也就是内核的 sys 生态，
 *   与 PTD 的 `_SYS` 全局对象等价。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.sysManager) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;
    var api = ezn32.api;

    var APP = {
        id: 'sysmanager',
        displayName: 'System Control',
        icon: '⚡',
        width: 800,
        height: 580
    };

    var st = {
        win: null, edit: null, status: null, path: '',
        lineLabel: null, fileLabel: null, statusInfo: null
    };

    var TEMPLATE = [
        '// sys 系统级脚本',
        '// 可用全局变量: _SYS (系统 API)',
        '',
        '_SYS.showToast("Hello from sys!");'
    ].join('\n');

    function rt() { return G.EznK.Runtime && G.EznK.Runtime.sys; }

    function userDocs() {
        var u = G.EznK.Service && G.EznK.Service.user;
        var cur = u ? u.currentUser().value : null;
        return '/Users/' + (cur ? cur.name : 'User') + '/Documents';
    }

    function notify(text, level) {
        var nc = G.EznK.Shell && G.EznK.Shell.notifications;
        if (nc) { nc.push({ title: 'System Control', text: String(text).slice(0, 100), level: level || 'info' }); }
    }

    /* =================================================================
     * 1. 文件操作
     * ============================================================== */

    function newFile() {
        if (st.edit) { st.edit.setValue(TEMPLATE); }
        st.path = '';
        updateStatus();
        notify('已新建脚本');
    }

    function openFile() {
        var dir = userDocs();
        return api.kernel.FindFiles(dir).then(function (r) {
            var sysFiles = [];
            if (r.status === S.OK) {
                sysFiles = r.value.filter(function (e) {
                    return e.type === 'file' && /\.sys$/i.test(e.name);
                });
            }
            if (!sysFiles.length) {
                notify('没有找到 .sys 文件（可在文件管理器中创建）', 'warn');
                return CORE.fail(S.ENOENT, { reason: 'no .sys files' });
            }
            /* 用菜单选择 */
            var items = sysFiles.map(function (f) {
                return {
                    text: '📄  ' + f.name,
                    onClick: function () { loadFile(f.path); }
                };
            });
            ui.ContextMenu.Show({ x: 300, y: 200, items: items });
            return CORE.ok(true);
        });
    }

    function loadFile(path) {
        return api.kernel.ReadFileText(path).then(function (r) {
            if (r.status !== S.OK) {
                notify('打开失败：' + (r.reason || ''), 'error');
                return r;
            }
            if (st.edit) { st.edit.setValue(r.value); }
            st.path = path;
            updateStatus();
            notify('已打开 ' + path.split('/').pop());
            return r;
        });
    }

    function saveFile() {
        if (!st.path) { return saveAs(); }
        return api.kernel.WriteFileText(st.path, st.edit.getValue()).then(function (r) {
            notify(r.status === S.OK ? ('已保存 ' + st.path.split('/').pop()) : ('保存失败：' + r.reason),
                r.status === S.OK ? 'info' : 'error');
            return r;
        });
    }

    function saveAs() {
        var base = userDocs() + '/未命名.sys';
        return api.kernel.WriteFileText(base, st.edit.getValue()).then(function (r) {
            if (r.status === S.OK) {
                st.path = base;
                updateStatus();
                notify('已保存到 ' + base);
            }
            return r;
        });
    }

    /* =================================================================
     * 2. 运行 / 安装
     * ============================================================== */

    function runCurrent() {
        var code = st.edit ? st.edit.getValue() : '';
        var runtime = rt();
        if (!runtime) {
            notify('sys 运行时不可用', 'error');
            return Promise.resolve(CORE.fail(S.ENOSYS, { reason: 'sys runtime missing' }));
        }
        notify('正在运行脚本…');
        return Promise.resolve(runtime.execute(code, { skipChain: true })).then(function (r) {
            if (r.status === S.OK) {
                notify('✅ 脚本执行完成');
            } else {
                notify('❌ 执行失败：' + (r.reason || ''), 'error');
            }
            return r;
        });
    }

    function installUpdate() {
        var code = st.edit ? st.edit.getValue() : '';
        var runtime = rt();
        if (!runtime) {
            notify('sys 运行时不可用', 'error');
            return Promise.resolve(CORE.fail(S.ENOSYS, { reason: 'sys runtime missing' }));
        }
        var name = st.path ? st.path.split('/').pop().replace(/\.sys$/i, '') : '未命名';
        notify('正在安装为系统更新…');
        return Promise.resolve(runtime.installAsUpdate(name, code)).then(function (r) {
            if (r.status === S.OK) {
                notify('📦 已安装为系统更新：' + name);
            } else {
                notify('❌ 安装失败：' + (r.reason || ''), 'error');
            }
            return r;
        });
    }

    /* =================================================================
     * 3. 状态栏
     * ============================================================== */

    function updateStatus() {
        if (st.fileLabel) {
            st.fileLabel.setText(st.path ? st.path.split('/').pop() : '未命名.sys');
        }
        if (st.edit && st.statusInfo) {
            var v = st.edit.getValue() || '';
            var pos = Math.min(st.edit.caret || 0, v.length);
            var before = v.slice(0, pos);
            var lines = before.split('\n');
            st.statusInfo.setText('行: ' + lines.length + ', 列: ' + (lines[lines.length - 1].length + 1));
        }
    }

    /* =================================================================
     * 4. 窗口
     * ============================================================== */

    function open(opts) {
        var o = opts || {};
        if (st.win && !st.win.destroyed) {
            st.win.activate();
            if (o.path) { loadFile(o.path); }
            else if (typeof o.content === 'string' && st.edit) { st.edit.setValue(o.content); }
            return CORE.ok(st.win);
        }

        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: 'System Control', width: APP.width, height: APP.height,
                         icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: 'System Control', width: APP.width, height: APP.height, icon: APP.icon });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        st.win = win;
        var client = win.client;

        var MENU_H = 24, BAR_H = 30, STATUS_H = 22;

        /* ---- 菜单栏 ---- */
        var menu = new ui.controls.Menu({
            x: 0, y: 0, width: client.width,
            menus: [
                {
                    id: 'file', text: '文件',
                    items: [
                        { id: 'new', text: '新建', icon: '📄', onClick: function () { newFile(); } },
                        { id: 'open', text: '打开…', icon: '📂', onClick: function () { openFile(); } },
                        { id: 'save', text: '保存', shortcut: 'Ctrl+S', icon: '💾', onClick: function () { saveFile(); } },
                        { id: 'saveas', text: '另存为…', icon: '📋', onClick: function () { saveAs(); } },
                        { separator: true },
                        { id: 'close', text: '关闭', icon: '✕', onClick: function () { win.destroy(); } }
                    ]
                },
                {
                    id: 'run', text: '运行',
                    items: [
                        { id: 'runcur', text: '运行当前脚本', shortcut: 'F5', icon: '▶', onClick: function () { runCurrent(); } },
                        { id: 'install', text: '安装为系统更新', icon: '📦', onClick: function () { installUpdate(); } }
                    ]
                }
            ]
        });
        client.addChild(menu);

        /* ---- 工具栏 ---- */
        var bar = new ui.Control({ x: 0, y: MENU_H, width: client.width, height: BAR_H });
        bar.onPaint = function (dc) {
            var th = ui.res.theme().value;
            ezn32.api.gdi.FillRect(dc, 0, 0, bar.width, bar.height, th.surfaceAlt);
            ezn32.api.gdi.DrawLine(dc, 0, bar.height - 1, bar.width, bar.height - 1, th.border, 1);
            ezn32.api.gdi.SelectObject(dc, ui.res.font('ui'));
            ezn32.api.gdi.SetTextColor(dc, th.textSecondary);
            ezn32.api.gdi.DrawText(dc, '⚡ System Control - 系统级脚本引擎', 260, 8);
        };
        client.addChild(bar);

        client.addChild(new ui.controls.Button({
            x: 6, y: MENU_H + 3, width: 90, height: 24, text: '▶  运行',
            variant: 'primary',
            onClick: function () { runCurrent(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 102, y: MENU_H + 3, width: 120, height: 24, text: '📦  安装更新',
            onClick: function () { installUpdate(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 228, y: MENU_H + 3, width: 90, height: 24, text: '💾  保存',
            onClick: function () { saveFile(); }
        }));

        /* ---- 编辑器 ---- */
        var edit = new ui.controls.Edit({
            x: 0, y: MENU_H + BAR_H,
            width: client.width,
            height: client.height - MENU_H - BAR_H - STATUS_H,
            multiline: true, allowUnicode: true, font: 'mono'
        });
        client.addChild(edit);
        st.edit = edit;

        edit.onChange = function () { updateStatus(); };
        edit.onEnter = function () { updateStatus(); };

        /* 快捷键 Ctrl+S / F5 */
        var origKey = edit.handleKey.bind(edit);
        edit.handleKey = function (d) {
            if (d.ctrlKey && (d.key === 's' || d.key === 'S')) { saveFile(); return 'save'; }
            if (d.key === 'F5') { runCurrent(); return 'run'; }
            var r = origKey(d);
            updateStatus();
            return r;
        };

        /* ---- 状态栏 ---- */
        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - STATUS_H, width: client.width, height: STATUS_H,
            panes: [
                { id: 'file', text: '未命名.sys', width: 220 },
                { id: 'pos', text: '行: 1, 列: 1', width: 160 },
                { id: 'kind', text: '.sys 系统级脚本', flex: 1 }
            ]
        });
        client.addChild(status);
        st.status = status;

        /* 自适应布局 */
        win._layoutFn = function (cw, ch) {
            menu.width = cw;
            bar.width = cw;
            edit.y = MENU_H + BAR_H;
            edit.width = cw;
            edit.height = Math.max(40, ch - MENU_H - BAR_H - STATUS_H);
            status.y = ch - STATUS_H;
            status.width = cw;
            win.client.invalidate();
        };

        /* 初始内容 */
        if (o.path) {
            loadFile(o.path);
        } else if (typeof o.content === 'string') {
            edit.setValue(o.content);
        } else {
            edit.setValue(TEMPLATE);
        }
        updateStatus();
        win.invalidate();
        setTimeout(function () { if (edit.focus) { edit.focus(); } }, 100);
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) {
            r.register({
                id: APP.id, name: 'System Control', icon: APP.icon,
                category: 'system', builtin: true,
                description: '运行 .sys 系统脚本，无限扩展',
                exts: ['.sys', '.skl']
            });
        }
        return CORE.ok(true);
    }

    var SYS = {
        version: '1.0.0',
        id: APP.id,
        displayName: 'System Control',
        icon: APP.icon,
        open: open,
        register: register,
        newFile: newFile,
        openFile: openFile,
        loadFile: loadFile,
        saveFile: saveFile,
        saveAs: saveAs,
        run: runCurrent,
        install: installUpdate,
        state: function () { return st; }
    };

    G.EznK.Apps.sysManager = SYS;
    register();
    CORE.createLogger('EznK/L6:sysmanager').info('js/apps/sys-manager.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
