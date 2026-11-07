/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L5 外壳层
 *
 *   文件 : js/shell/desktop.js
 *   模块 : EznK.Shell.desktop
 *   层级 : L5 外壳层
 *
 * ---------------------------------------------------------------------
 * 职责
 * ---------------------------------------------------------------------
 *   外壳桌面：把 ezn32.ui.Desktop 接到真实的用户桌面目录、持久化图标位置、
 *   桌面右键菜单、窗口管理器，并注入 **系统图标**（与 PTD.html 一致）。
 *
 *   桌面图标分两类：
 *     1. 系统图标 —— 固定位置，指向内置应用（代码编辑器 / Python 终端 /
 *        文件管理 / 代码工坊 / 控制面板 / 关于系统 / 系统控制 / 回收站 …）
 *     2. 用户文件 —— 来自 /Users/<用户>/Desktop 目录，可移动、可重命名
 *
 *   系统图标位置沿用 PTD 的布局：
 *     左侧一列：20,20 / 20,120 / 20,220 / 20,320 / 20,420 / 20,520
 *     右侧一列：20,20 / 20,120 / 20,220
 *     右下角  ：回收站
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L5:desktop');

    var ui = G.ezn32.ui;
    var api = G.ezn32.api;

    function T(k, f) {
        var I = G.EznK.Platform.I18n;
        return I ? I.T(k, f) : (f || k);
    }

    var POSITIONS_KEY = '/DesktopIcons.json';

    /* =================================================================
     * 1. 系统图标（与 PTD.html 布局一致）
     * ============================================================== */

    var SYSTEM_ICONS = [
        /* ---- 左侧一列 ---- */
        { id: 'sys-editor',   icon: '📝', title: '代码编辑器', desc: '编写和运行代码', side: 'left', row: 0, app: 'editor' },
        { id: 'sys-pyshell',  icon: '🐍', title: 'Python 终端', desc: '交互式 Python 命令行', side: 'left', row: 1, app: 'python-shell' },
        { id: 'sys-files',    icon: '📁', title: '文件管理', desc: '管理文件和文件夹', side: 'left', row: 2, app: 'file-manager' },
        { id: 'sys-studio',   icon: '💻', title: '代码工坊', desc: '编辑并运行脚本', side: 'left', row: 3, app: 'code-studio' },
        { id: 'sys-control',  icon: '⚙️', title: '控制面板', desc: '系统设置与个性化', side: 'left', row: 4, app: 'control-panel' },

        /* ---- 右侧一列 ---- */
        { id: 'sys-about',    icon: 'ℹ️', title: '关于系统', desc: '查看版本和系统信息', side: 'right', row: 0, app: 'about' },
        { id: 'sys-tasks',    icon: '📊', title: '任务管理器', desc: '查看运行中的进程', side: 'right', row: 1, app: 'task-manager' },
        { id: 'sys-camera',   icon: '📷', title: '摄像头', desc: '拍照并保存', side: 'right', row: 2, app: 'camera' },
        { id: 'sys-chat',     icon: '💬', title: '聊天室', desc: '本地即时消息', side: 'right', row: 3, app: 'chat' },
        { id: 'sys-sysmanager', icon: '⚡', title: 'System Control', desc: '运行 .sys 系统脚本', side: 'right', row: 4, app: 'sysmanager' },

        /* ---- 右下角 ---- */
        { id: 'sys-trash',    icon: '🗑️', title: '回收站', desc: '已删除的文件', side: 'bottom-right', row: 0, app: 'recycle-bin' }
    ];

    var ICON_W = 84;
    var ICON_H = 92;
    var PAD_X = 20;
    var PAD_Y = 20;
    var TASKBAR_H = 40;

    /* =================================================================
     * 2. 图标位置持久化
     * ============================================================== */

    function currentUserName() {
        var r = api.advapi.GetCurrentUser();
        return (r.status === S.OK && r.value) ? r.value.name : 'User';
    }

    function positionsKey() {
        return '/Users/' + currentUserName() + POSITIONS_KEY;
    }

    function loadPositions() {
        var hal = G.EznK.Kernel.HAL;
        var r = hal.fs.configGet(positionsKey(), null);
        if (r.status === S.OK && r.value && typeof r.value === 'object') {
            ui.Desktop.ApplyPositions(r.value);
        }
        return CORE.ok(true);
    }

    function savePositions(list) {
        return G.EznK.Kernel.HAL.fs.configSet(positionsKey(), list);
    }

    /* =================================================================
     * 3. 系统图标定位
     * ============================================================== */

    function systemIconPosition(ic) {
        var vw = window.innerWidth || 1280;
        var vh = (window.innerHeight || 720) - TASKBAR_H;

        if (ic.side === 'left') {
            return { x: PAD_X, y: PAD_Y + ic.row * ICON_H };
        }
        if (ic.side === 'right') {
            return { x: vw - ICON_W - PAD_X, y: PAD_Y + ic.row * ICON_H };
        }
        /* 右下角 */
        return { x: vw - ICON_W - PAD_X, y: vh - ICON_H - PAD_Y };
    }

    /** 生成系统图标的完整描述（供 Desktop 渲染） */
    function buildSystemIcons() {
        return SYSTEM_ICONS.map(function (ic) {
            var p = systemIconPosition(ic);
            return {
                id: ic.id,
                name: ic.title,
                text: ic.title,
                icon: ic.icon,
                type: 'system',
                systemId: ic.id,
                appId: ic.app,
                desc: ic.desc,
                path: null,
                x: p.x,
                y: p.y
            };
        });
    }

    /* =================================================================
     * 4. 桌面内容
     * ============================================================== */

    function desktopFolder() {
        return '/Users/' + currentUserName() + '/Desktop';
    }

    /** refresh() -> Promise  重新载入桌面图标（系统图标 + 用户文件） */
    function refresh() {
        var folder = desktopFolder();
        return api.kernel.CreateDirectory(folder).then(function () {
            return ui.Desktop.LoadFromFolder(folder);
        }).then(function (r) {
            if (r.status !== S.OK) { return r; }
            /* 注入系统图标 */
            var sys = buildSystemIcons();
            if (ui.Desktop.SetSystemIcons) {
                ui.Desktop.SetSystemIcons(sys);
            }
            loadPositions();
            return CORE.ok(ui.Desktop.IconPositions().length);
        });
    }

    /* =================================================================
     * 5. 图标操作
     * ============================================================== */

    function openIcon(icon) {
        if (!icon) { return CORE.fail(S.EINVAL, { reason: '没有图标' }); }

        /* 系统图标 -> 通过应用注册表启动 */
        if (icon.type === 'system' && icon.appId) {
            var reg = G.EznK.Service && G.EznK.Service.appRegistry;
            if (reg) {
                var r = reg.launch(icon.appId);
                return r || CORE.ok(true);
            }
            var apps = G.EznK.Apps || {};
            var mod = null;
            Object.keys(apps).forEach(function (k) {
                if (apps[k] && apps[k].id === icon.appId) { mod = apps[k]; }
            });
            if (mod && mod.open) { return CORE.ok(mod.open({})); }
            return CORE.fail(S.ENOSYS, { reason: '找不到应用: ' + icon.appId });
        }

        /* 用户文件 -> 交给 shell 按扩展名打开 */
        if (icon.path) {
            return api.shell.OpenFile(icon.path);
        }
        return CORE.fail(S.ENOENT, { reason: '图标没有可执行目标' });
    }

    /** 重命名：弹出一个输入对话框，成功后重命名文件 */
    function renameIcon(icon) {
        if (!icon || !icon.path) {
            return CORE.fail(S.EINVAL, { reason: '系统图标不能重命名' });
        }
        var oldName = String(icon.path).split('/').pop();

        return new Promise(function (resolve) {
            var winsvc = G.EznK.Service && G.EznK.Service.window;
            var created = winsvc
                ? winsvc.open({ title: '重命名', width: 420, height: 180, icon: '✏️' })
                : ui.Window.Create({ title: '重命名', width: 420, height: 180, icon: '✏️' });
            if (created.status !== S.OK) { resolve(created); return; }

            var win = created.value;
            var client = win.client;

            client.addChild(new ui.controls.Label({
                x: 16, y: 16, width: client.width - 32, text: '请输入新的名称：'
            }));

            var field = new ui.controls.Edit({
                x: 16, y: 44, width: client.width - 32, height: 26
            });
            field.setValue(oldName);
            client.addChild(field);

            var status = new ui.controls.StatusBar({
                x: 0, y: client.height - 22, width: client.width, height: 22,
                panes: [{ id: 'main', text: '按回车确认，或点击"确定"', flex: 1 }]
            });
            client.addChild(status);

            function doRename() {
                var newName = String(field.getValue() || '').trim();
                if (!newName || newName === oldName) {
                    status.setPane('main', '名称没有变化');
                    return;
                }
                if (/[\\/:*?"<>|]/.test(newName)) {
                    status.setPane('main', '名称不能包含 \\ / : * ? " < > |');
                    return;
                }
                var dir = String(icon.path).slice(0, String(icon.path).lastIndexOf('/'));
                var newPath = dir + '/' + newName;

                api.kernel.RenameFile(icon.path, newPath).then(function (r) {
                    if (r.status === S.OK) {
                        win.destroy();
                        refresh().then(function () { resolve(CORE.ok(true)); });
                    } else {
                        status.setPane('main', '重命名失败：' + (r.reason || ''));
                    }
                });
            }

            field.onEnter = doRename;

            client.addChild(new ui.controls.Button({
                x: client.width - 200, y: client.height - 58, width: 88, height: 28,
                text: '确定', variant: 'primary', onClick: doRename
            }));
            client.addChild(new ui.controls.Button({
                x: client.width - 104, y: client.height - 58, width: 88, height: 28,
                text: '取消', onClick: function () { win.destroy(); resolve(CORE.fail(S.EBUSY, { reason: '已取消' })); }
            }));

            win.onDestroy = function () { if (!win.__done) { resolve(CORE.fail(S.EBUSY, { reason: '已取消' })); } };
            win.invalidate();
            setTimeout(function () { if (field.focus) { field.focus(); } }, 80);
        });
    }

    function deleteIcon(icon) {
        if (!icon || !icon.path) {
            return CORE.fail(S.EINVAL, { reason: '系统图标不能删除' });
        }
        var fileSvc = G.EznK.Service && G.EznK.Service.file;
        var p = fileSvc ? fileSvc.moveToTrash(icon.path) : api.kernel.DeleteFile(icon.path);
        return Promise.resolve(p).then(function (r) {
            var nc = G.EznK.Shell && G.EznK.Shell.notifications;
            if (nc && r.status === S.OK) {
                nc.push({ title: '桌面', text: '已移到回收站', level: 'info', timeout: 2000 });
            }
            return refresh();
        });
    }

    function showProperties(icon) {
        if (!icon) { return CORE.fail(S.EINVAL, {}); }
        var winsvc = G.EznK.Service && G.EznK.Service.window;
        var created = winsvc
            ? winsvc.open({ title: '属性', width: 420, height: 260, icon: 'ℹ️' })
            : ui.Window.Create({ title: '属性', width: 420, height: 260, icon: 'ℹ️' });
        if (created.status !== S.OK) { return created; }
        var win = created.value;
        var client = win.client;

        var rows = [
            ['名称', icon.text || icon.name || '-'],
            ['类型', icon.type === 'system' ? '系统图标' : (icon.type === 'dir' ? '文件夹' : '文件')],
            ['位置', icon.path || '（内置）'],
            ['目标应用', icon.appId || '-'],
            ['说明', icon.desc || '-']
        ];
        var h = new ui.Control({ x: 0, y: 0, width: client.width, height: rows.length * 26 + 16 });
        h.onPaint = function (dc) {
            var t = ui.res.theme().value;
            var gdi = api.gdi;
            gdi.SelectObject(dc, ui.res.font('uiLarge') || ui.res.font('ui'));
            rows.forEach(function (r, i) {
                gdi.SetTextColor(dc, t.textSecondary);
                gdi.DrawTextTruncated(dc, r[0], 16, 12 + i * 26, 100);
                gdi.SetTextColor(dc, t.text);
                gdi.DrawTextTruncated(dc, String(r[1]), 124, 12 + i * 26, client.width - 140);
            });
        };
        client.addChild(h);
        client.addChild(new ui.controls.Button({
            x: client.width - 104, y: client.height - 42, width: 88, height: 28,
            text: '关闭', onClick: function () { win.destroy(); }
        }));
        win.invalidate();
        return CORE.ok(win);
    }

    /* =================================================================
     * 6. 右键菜单
     * ============================================================== */

    function showContextMenu(payload) {
        var items = [];
        var icon = payload && payload.icon;

        if (icon) {
            /* ---- 图标右键 ---- */
            if (icon.type === 'system') {
                items.push({
                    text: '打开', icon: '📂',
                    onClick: function () { openIcon(icon); }
                });
                items.push({ separator: true });
                items.push({
                    text: '属性', icon: 'ℹ️',
                    onClick: function () { showProperties(icon); }
                });
            } else {
                items.push({
                    text: '打开', icon: '📂',
                    onClick: function () { openIcon(icon); }
                });
                items.push({
                    text: '重命名', icon: '✏️',
                    onClick: function () { renameIcon(icon); }
                });
                items.push({
                    text: '删除', icon: '🗑️',
                    onClick: function () { deleteIcon(icon); }
                });
                items.push({ separator: true });
                items.push({
                    text: '属性', icon: 'ℹ️',
                    onClick: function () { showProperties(icon); }
                });
            }
        } else {
            /* ---- 桌面右键 ---- */
            items.push({
                text: '新建文件夹', icon: '📁',
                onClick: function () {
                    var base = desktopFolder();
                    var n = 1;
                    function attempt() {
                        var name = '新建文件夹' + (n > 1 ? ' (' + n + ')' : '');
                        return api.kernel.CreateDirectory(base + '/' + name).then(function (r) {
                            if (r.status === S.EEXIST) { n++; return attempt(); }
                            return refresh();
                        });
                    }
                    attempt();
                }
            });
            items.push({
                text: '新建文本文件', icon: '📄',
                onClick: function () {
                    var base = desktopFolder();
                    var n = 1;
                    function attempt() {
                        var name = '新建文本文档' + (n > 1 ? ' (' + n + ')' : '') + '.txt';
                        return api.kernel.WriteFileText(base + '/' + name, '').then(function (r) {
                            if (r.status === S.EEXIST) { n++; return attempt(); }
                            return refresh();
                        });
                    }
                    attempt();
                }
            });
            items.push({ separator: true });
            items.push({
                text: '刷新', icon: '🔄',
                onClick: function () { refresh(); }
            });
            items.push({ separator: true });
            items.push({
                text: '个性化', icon: '🎨',
                onClick: function () {
                    var cp = G.EznK.Apps && G.EznK.Apps.controlPanel;
                    if (cp) { cp.open('personalize'); }
                }
            });
            items.push({
                text: '任务管理器', icon: '📊',
                onClick: function () {
                    var reg = G.EznK.Service && G.EznK.Service.appRegistry;
                    if (reg) { reg.launch('task-manager'); }
                }
            });
            items.push({ separator: true });
            items.push({
                text: '屏幕保护程序', icon: '💫',
                onClick: function () {
                    var ss = G.EznK.Service.screenSaver;
                    if (ss) { ss.preview(); }
                }
            });
        }

        var cm = ui.ContextMenu;
        var sr = desktopSurfaceRect();
        cm.Show({
            x: (payload.x || 0) + sr.left,
            y: (payload.y || 0) + sr.top,
            items: items
        });
    }

    function desktopSurfaceRect() {
        var el = ui.Desktop.SurfaceElement ? ui.Desktop.SurfaceElement() : null;
        if (el && el.getBoundingClientRect) { return el.getBoundingClientRect(); }
        return { left: 0, top: 0 };
    }

    /* =================================================================
     * 7. 生命周期
     * ============================================================== */

    function init() {
        var r = ui.Desktop.Create({
            onOpen: function (icon) { openIcon(icon); },
            onContext: showContextMenu
        });
        if (r.status !== S.OK) { return Promise.resolve(r); }

        return refresh().then(function (res) {
            LOG.info('桌面已就绪（' + (res.value || 0) + ' 个图标）');
            return CORE.ok(true);
        });
    }

    function dispose() {
        ui.Desktop.Destroy();
        return CORE.ok(true);
    }

    var Desktop = {};
    Desktop.version = '2.0.0';
    Desktop.init = init;
    Desktop.refresh = refresh;
    Desktop.openIcon = openIcon;
    Desktop.renameIcon = renameIcon;
    Desktop.deleteIcon = deleteIcon;
    Desktop.showProperties = showProperties;
    Desktop.savePositions = savePositions;
    Desktop.loadPositions = loadPositions;
    Desktop.showContextMenu = showContextMenu;
    Desktop.SYSTEM_ICONS = SYSTEM_ICONS.slice(0);
    Desktop.dispose = dispose;

    if (!G.EznK.Shell) { G.EznK.Shell = {}; }
    G.EznK.Shell.desktop = Desktop;

    var srm = G.EznK.Kernel.SRM;
    if (srm && typeof srm.register === 'function') {
        srm.register('shell-desktop', Desktop);
    }

    LOG.info('js/shell/desktop.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
