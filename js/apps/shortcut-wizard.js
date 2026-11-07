/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L6 应用层
 *
 *   文件 : js/apps/shortcut-wizard.js
 *   模块 : EznK.Apps.shortcutWizard
 *   层级 : L6 应用层
 *
 *   创建快捷方式：为文件、文件夹或已注册应用在桌面创建快捷方式。
 *   快捷方式是一个 JSON 描述文件，扩展名 .lnk，存放在用户桌面目录，
 *   双击时由外壳解析。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.shortcutWizard) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;
    var api = ezn32.api;

    var APP = { id: 'shortcut-wizard', displayName: '创建快捷方式', icon: '🔗', width: 560, height: 360 };
    var state = { win: null, nameField: null, targetField: null, status: null };

    var LNK_EXT = '.lnk';

    function desktopDir() {
        var u = G.EznK.Service && G.EznK.Service.user;
        var cur = u ? u.currentUser().value : null;
        var name = cur ? cur.name : 'User';
        return '/Users/' + name + '/Desktop';
    }

    /** create(target, name, kind) -> Promise */
    function create(target, name, kind) {
        if (typeof target !== 'string' || target.length === 0) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: '请填写目标路径' }));
        }
        var label = String(name || target.split('/').pop() || '快捷方式');
        var path = desktopDir() + '/' + label + LNK_EXT;
        var body = JSON.stringify({
            __isShortcut: true,
            name: label,
            target: target,
            kind: kind || 'file',
            createdAt: new Date().toISOString()
        }, null, 2);
        return api.kernel.WriteFileText(path, body).then(function (r) {
            if (r.status === S.OK) {
                var nc = G.EznK.Shell && G.EznK.Shell.notifications;
                if (nc) { nc.push({ title: '创建快捷方式', text: '已创建 ' + label, level: 'info' }); }
                var desktop = G.EznK.Shell && G.EznK.Shell.desktop;
                if (desktop) { desktop.refresh(); }
            }
            return r;
        });
    }

    /** resolve(path) -> { status, value: { target, kind, name } } */
    function resolveShortcut(path) {
        return api.kernel.ReadFileText(path).then(function (r) {
            if (r.status !== S.OK) { return r; }
            try {
                var d = JSON.parse(r.value);
                if (!d || !d.__isShortcut) {
                    return CORE.fail(S.EBADIMAGE, { reason: '不是快捷方式文件' });
                }
                return CORE.ok({ target: d.target, kind: d.kind, name: d.name });
            } catch (err) {
                return CORE.fail(S.EBADIMAGE, { reason: '快捷方式已损坏' });
            }
        });
    }

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '创建快捷方式', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '创建快捷方式', width: APP.width, height: APP.height, icon: APP.icon });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        state.win = win;
        var client = win.client;

        client.addChild(new ui.controls.Label({
            x: 12, y: 16, width: client.width - 24,
            text: '🔗  在桌面上创建快捷方式', font: 'uiBold'
        }));

        client.addChild(new ui.controls.Label({ x: 12, y: 54, width: 90, text: '目标' }));
        var target = new ui.controls.Edit({
            x: 110, y: 52, width: client.width - 126, height: 24,
            placeholder: '/Users/User/Desktop/hello.rf  或  app:editor'
        });
        client.addChild(target);
        state.targetField = target;

        client.addChild(new ui.controls.Label({ x: 12, y: 92, width: 90, text: '名称' }));
        var name = new ui.controls.Edit({
            x: 110, y: 90, width: client.width - 126, height: 24,
            placeholder: '我的快捷方式'
        });
        client.addChild(name);
        state.nameField = name;

        client.addChild(new ui.controls.Button({
            x: 110, y: 132, width: 130, height: 28, text: '创建',
            variant: 'primary',
            onClick: function () {
                var t = target.getValue();
                var n = name.getValue() || (t.split('/').pop() || '快捷方式');
                var kind = t.indexOf('app:') === 0 ? 'app' : 'file';
                create(t, n, kind).then(function (r) {
                    if (state.status) {
                        state.status.setPane('main', r.status === S.OK ? ('已创建：' + n) : ('失败：' + (r.reason || '')));
                    }
                });
            }
        }));
        client.addChild(new ui.controls.Button({
            x: 250, y: 132, width: 100, height: 28, text: '关闭',
            onClick: function () { win.destroy(); }
        }));

        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '请输入目标路径或 app:应用ID', flex: 1 }]
        });
        client.addChild(status);
        state.status = status;

        win.invalidate();
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) { r.register({ id: APP.id, name: '创建快捷方式', icon: APP.icon, category: 'tools', builtin: true }); }
        return CORE.ok(true);
    }

    var SW = {
        version: '1.0.0', id: APP.id, displayName: '创建快捷方式', icon: APP.icon,
        open: open, register: register, create: create, resolve: resolveShortcut,
        EXTENSION: LNK_EXT
    };
    G.EznK.Apps.shortcutWizard = SW;
    register();
    CORE.createLogger('EznK/L6:shortcut').info('js/apps/shortcut-wizard.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
