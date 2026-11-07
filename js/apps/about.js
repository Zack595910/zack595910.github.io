/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 6 - Application Layer
 *
 *   File    : js/apps/about.js
 *   Module  : EznK.Apps.about
 *   Layer   : L6 应用层
 *
 *   The About window: system identity, architecture, runtime availability
 *   and licences. ASCII only.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.about) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;

    var APP = {
        id: 'about',
        displayName: '关于系统',
        icon: '[i]',
        width: 460,
        height: 420
    };

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '关于系统', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '关于系统', width: APP.width, height: APP.height });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        var client = win.client;
        var cx = client.width / 2;

        function line(text, y, color, font, align) {
            client.addChild(new ui.controls.Label({
                x: 12, y: y, width: client.width - 24,
                text: text, color: color || 'text', font: font || 'ui',
                align: align || 'center'
            }));
        }

        line('EZNT', 18, 'text', 'monoBig');
        line('生态系统原生技术', 52, 'textSecondary');
        line('版本 1.0.0', 72, 'textSecondary', 'small');

        client.addChild(new ui.controls.Label({
            x: 24, y: 104, width: client.width - 48, height: 1, text: ''
        }));
        ezn32.api.gdi.DrawLine(win.surface.dc, 24, 104, client.width - 24, 104, ui.res.color('border'), 1);

        var y = 122;
        var info = EznK.Kernel.SRM.info();
        var storage = G.EznK.Platform.Storage.info().value;
        var py = G.EznK.Runtime && G.EznK.Runtime.python ? G.EznK.Runtime.python.status().value : null;

        var rows = [
            ['架构', 'EznK（六层 + 两横切面）'],
            ['内核', 'SRM v' + (info.status === S.OK ? info.value.version : '?')],
            ['内核阶段', info.status === S.OK ? info.value.phase : '未知'],
            ['已加载模块', String(info.status === S.OK ? info.value.modules : 0)],
            ['存储管理 backend', storage.backend + (storage.degraded ? ' (degraded)' : '')],
            ['Python 运行时', py ? py.status : '不可用'],
            ['当前用户', (function () {
                var u = G.EznK.Service && G.EznK.Service.user;
                var cur = u ? u.currentUser().value : null;
                return cur ? cur.name : 'none';
            })()]
        ];

        var host = new ui.Control({ x: 0, y: y, width: client.width, height: rows.length * 24 + 10 });
        host.onPaint = function (dc) {
            var i = ui.res.theme().value;
            ezn32.api.gdi.SelectObject(dc, ui.res.font('ui'));
            for (var i = 0; i < rows.length; i++) {
                ezn32.api.gdi.SetTextColor(dc, i.textSecondary);
                ezn32.api.gdi.DrawTextTruncated(dc, rows[i][0], 24, i * 24 + 4, 130);
                ezn32.api.gdi.SetTextColor(dc, i.text);
                ezn32.api.gdi.DrawTextTruncated(dc, rows[i][1], 160, i * 24 + 4, client.width - 184);
            }
        };
        client.addChild(host);

        var footerY = y + rows.length * 24 + 20;
        line('完全运行在浏览器中。', footerY, 'textSecondary', 'small');
        line('MIT 许可证 · 使用 Ezn32 构建', footerY + 18, 'textSecondary', 'small');

        client.addChild(new ui.controls.Button({
            x: Math.round(cx - 50), y: footerY + 44, width: 100, height: 28,
            text: '关闭',
            onClick: function () { win.destroy(); }
        }));

        win.invalidate();
        return CORE.ok(win);
    }

    function register() {
        var reg = G.EznK.Service && G.EznK.Service.appRegistry;
        if (reg) {
            reg.register({ id: APP.id, name: '关于系统', icon: APP.icon, category: 'system', builtin: true });
        }
        return CORE.ok(true);
    }

    var About = { version: '1.0.0', id: APP.id, displayName: '关于系统', icon: APP.icon, open: open, register: register };
    G.EznK.Apps.about = About;
    register();
    CORE.createLogger('EznK/L6:about').info('js/apps/about.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
