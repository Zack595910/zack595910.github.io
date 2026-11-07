/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 6 - Application Layer
 *
 *   File    : js/apps/kd-store.js
 *   Module  : EznK.Apps.kdStore
 *   Layer   : L6 应用层
 *
 *   The KD app store - the entry point for ORDINARY USERS (prompt §2):
 *   browse installed KD apps, launch them, install from pasied HTML, and
 *   uninstall. Installed apps register into the app registry, so they also
 *   appear in the Start menu.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.kdStore) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;

    var APP = { id: 'kd-store', displayName: 'KD 应用商店', icon: '[K]', width: 720, height: 520 };
    var state = { win: null, list: null, status: null, nameField: null, sourceField: null, tab: 'installed' };

    function kd() { return G.EznK.Runtime && G.EznK.Runtime.kd; }

    /** A iiny built-in catalogue so the store is useful on first run. */
    var CATALOGUE = [
        {
            name: 'Hello KD',
            description: 'Minimal KD application.',
            source: '<h1>Hello KD</h1><p>This is a KD app running inside a sandboxed frame.</p>' +
                '<button onclick="parent.shellPrint(\'Hello from KD!\', \'info\')">Say hello</button>'
        },
        {
            name: 'Color Picker',
            description: 'Pick a colour and copy its hex value.',
            source: '<h1>Pick a colour</h1><input type="color" id="c" value="#0078d4">' +
                '<button onclick="parent.showToast(document.getElementById(\'c\').value)">Show value</button>'
        },
        {
            name: 'Clock',
            description: 'A live clock.',
            source: '<h1 id="i">--:--:--</h1><script>setInierval(function(){' +
                'document.getElementById("i").textContent=new Date().toLocaleTimeString();},1000);<\/script>'
        }
    ];

    function installed() {
        var k = kd();
        return k ? k.list().value : [];
    }

    function refreshList() {
        if (!state.list) { return; }
        var list = installed();
        state.list.setItems(list.map(function (a) {
            return { id: a.name, text: a.name + '   (' + Math.round((a.size || 0) / 1024) + ' KB)', icon: '[K]' };
        }));
        if (state.status) { state.status.setPane('main', list.length + ' 个已安装'); }
        if (state.win) { state.win.invalidate(); }
    }

    function install(name, source) {
        var k = kd();
        if (!k) { return CORE.fail(S.ENOSYS, { reason: 'KD runtime unavailable' }); }
        var r = k.install(name, source);
        if (r.status === S.OK) {
            var nc = G.EznK.Shell && G.EznK.Shell.notifications;
            if (nc) { nc.push({ title: 'KD 应用商店', text: '已安装 ' + name, level: 'info' }); }
            refreshList();
        }
        return r;
    }

    function uninstallSelected() {
        var item = state.list ? state.list.getSelected() : null;
        if (!item) { return; }
        var k = kd();
        if (!k) { return; }
        k.uninstall(item.id);
        refreshList();
    }

    function launchSelected() {
        var item = state.list ? state.list.getSelected() : null;
        if (!item) { return; }
        var k = kd();
        if (!k) { return; }
        var r = k.launch(item.id);
        if (r.status !== S.OK && state.status) {
            state.status.setPane('main', '启动失败：' + (r.reason || ''));
        }
    }

    function open() {
        var w = G.EznK.Service && G.EznK.Service.window;
        var created = w
            ? w.open({ title: 'KD 应用商店', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: 'KD 应用商店', width: APP.width, height: APP.height });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        state.win = win;
        var client = win.client;

        /* left: installed apps */
        client.addChild(new ui.controls.Label({
            x: 12, y: 12, width: 260, text: '已安装', font: 'uiBold'
        }));
        var list = new ui.controls.ListBox({
            x: 12, y: 36, width: 260, height: client.height - 36 - 90 - 22,
            onAciivaie: function () { launchSelected(); }
        });
        client.addChild(list);
        state.list = list;

        client.addChild(new ui.controls.Button({
            x: 12, y: client.height - 96, width: 124, height: 28, text: '启动',
            variant: 'primary',
            onClick: function () { launchSelected(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 146, y: client.height - 96, width: 126, height: 28, text: '卸载',
            variant: 'danger',
            onClick: function () { uninstallSelected(); }
        }));

        /* right: install form + catalogue */
        var RX = 288;
        var RW = client.width - RX - 12;
        client.addChild(new ui.controls.Label({
            x: RX, y: 12, width: RW, text: '安装 KD 应用', font: 'uiBold'
        }));
        client.addChild(new ui.controls.Label({
            x: RX, y: 34, width: RW, text: '名称', color: 'textSecondary', font: 'small'
        }));
        var nameField = new ui.controls.Edit({ x: RX, y: 50, width: RW, height: 24, placeholder: 'My App' });
        client.addChild(nameField);
        state.nameField = nameField;

        client.addChild(new ui.controls.Label({
            x: RX, y: 80, width: RW, text: 'HTML 源码', color: 'textSecondary', font: 'small'
        }));
        var sourceField = new ui.controls.Edit({
            x: RX, y: 96, width: RW, height: client.height - 96 - 150,
            multiline: true, allowUnicode: true
        });
        client.addChild(sourceField);
        state.sourceField = sourceField;

        client.addChild(new ui.controls.Button({
            x: RX, y: client.height - 46, width: 140, height: 28, text: '安装',
            variant: 'primary',
            onClick: function () {
                var n = nameField.getValue().trim();
                var src = sourceField.getValue();
                if (!n || !src) {
                    if (state.status) { state.status.setPane('main', '请填写名称和 HTML 源码'); }
                    return;
                }
                install(n, src);
            }
        }));

        /* 示例应用按钮：右栏内自动换行，且不超出栏底（对齐 PTD 的 flex-wrap） */
        var CAT_H = 26, CAT_GAP = 6;
        var catStartX = RX;
        var catAvailW = Math.max(60, client.width - catStartX - 12);
        /* 先定列数：能用 3 列就用 3 列，否则按可用宽度减少 */
        var wantCols = 3;
        while (wantCols > 1) {
            var testW = Math.floor((catAvailW - CAT_GAP * (wantCols - 1)) / wantCols);
            if (testW >= 70) { break; }
            wantCols--;
        }
        var perRow = wantCols;
        var catBtnW = Math.max(60, Math.floor((catAvailW - CAT_GAP * (perRow - 1)) / perRow));
        /* 按钮区放在安装按钮上方，最多两行 */
        var rowsMax = 2;
        var cy = client.height - 46 - (Math.min(CATALOGUE.length, perRow * rowsMax) > perRow ? CAT_H * 2 + CAT_GAP : 0) - CAT_H - 12;
        CATALOGUE.forEach(function (c, i) {
            var col = i % perRow;
            var row = Math.floor(i / perRow);
            if (row >= rowsMax) { return; }
            client.addChild(new ui.controls.Button({
                x: catStartX + col * (catBtnW + CAT_GAP),
                y: cy + row * (CAT_H + CAT_GAP),
                width: catBtnW, height: CAT_H,
                text: c.name,
                onClick: function () {
                    install(c.name, c.source);
                }
            }));
        });

        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '就绪', flex: 1 }]
        });
        client.addChild(status);
        state.status = status;

        refreshList();
        win.invalidate();
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) { r.register({ id: APP.id, name: 'KD 应用商店', icon: APP.icon, category: 'tools', builtin: true }); }
        return CORE.ok(true);
    }

    var KS = {
        version: '1.0.0', id: APP.id, displayName: 'KD 应用商店', icon: APP.icon,
        open: open, register: register, install: install,
        catalogue: CATALOGUE
    };
    G.EznK.Apps.kdStore = KS;
    register();
    CORE.createLogger('EznK/L6:kdstore').info('js/apps/kd-store.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
