/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 6 - Application Layer
 *
 *   File    : js/apps/gpedit.js
 *   Module  : EznK.Apps.gpedit
 *   Layer   : L6 应用层
 *
 *   The group policy editor: every kernel policy with its current value
 *   and a toggle. Changes are applied immediately and persisted.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.gpedit) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;

    var APP = { id: 'gpedit', displayName: '组策略', icon: '[P]', width: 640, height: 480 };
    var state = { win: null, host: null, status: null };

    function pol() { return EznK.Kernel.policy; }

    function rebuild() {
        if (!state.host) { return; }
        var host = state.host;
        while (host.children.length) { host.children[0].dispose(); }

        var list = pol().listPolicies().value;
        var y = 8;
        host.addChild(new ui.controls.Label({
            x: 8, y: y, width: host.width - 16, text: '组策略', font: 'uiBold'
        }));
        y += 26;
        host.addChild(new ui.controls.Label({
            x: 8, y: y, width: host.width - 16,
            text: '策略用于限制系统和应用可以执行的操作。',
            color: 'textSecondary', font: 'small'
        }));
        y += 26;

        list.forEach(function (p) {
            var isBool = typeof p.value === 'boolean';
            if (isBool) {
                var cb = new ui.controls.CheckBox({
                    x: 8, y: y, width: host.width - 20, height: 20,
                    text: p.key,
                    checked: p.value
                });
                cb.onChange = function (checked) {
                    pol().setPolicy(p.key, checked);
                    if (state.status) { state.status.setPane('main', p.key + ' = ' + checked); }
                };
                host.addChild(cb);
            } else {
                host.addChild(new ui.controls.Label({
                    x: 8, y: y, width: 260, text: p.key, color: 'textSecondary'
                }));
                host.addChild(new ui.controls.Label({
                    x: 280, y: y, width: host.width - 290, text: String(p.value)
                }));
            }
            y += 26;
        });

        if (state.status) { state.status.setPane('main', list.length + ' 条策略'); }
        if (state.win) { state.win.invalidate(); }
    }

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '组策略', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '组策略', width: APP.width, height: APP.height });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        state.win = win;
        var client = win.client;

        var host = new ui.Control({ x: 0, y: 0, width: client.width, height: client.height - 56 });
        client.addChild(host);
        state.host = host;

        client.addChild(new ui.controls.Button({
            x: 8, y: client.height - 50, width: 140, height: 28, text: '全部重置',
            variant: 'danger',
            onClick: function () {
                pol().resetAll();
                rebuild();
            }
        }));

        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '就绪', flex: 1 }]
        });
        client.addChild(status);
        state.status = status;

        rebuild();
        win.invalidate();
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) { r.register({ id: APP.id, name: '组策略', icon: APP.icon, category: 'system', builtin: true }); }
        return CORE.ok(true);
    }

    var GP = { version: '1.0.0', id: APP.id, displayName: '组策略', icon: APP.icon, open: open, register: register };
    G.EznK.Apps.gpedit = GP;
    register();
    CORE.createLogger('EznK/L6:gpedit').info('js/apps/gpedit.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
