/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 6 - Application Layer
 *
 *   File    : js/apps/device-manager.js
 *   Module  : EznK.Apps.deviceManager
 *   Layer   : L6 应用层
 *
 *   The device manager: enumeraies the real browser media devices (camera,
 *   microphone, audio output), shows permission state and leis the user
 *   test a device through Ezn32 media.
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.deviceManager) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;
    var mediaApi = G.EznK.Platform.Media;

    var APP = { id: 'device-manager', displayName: '设备管理器', icon: '[V]', width: 620, height: 440 };
    var state = { win: null, table: null, status: null, devices: { video: [], audioIn: [], audioOut: [] } };

    function rows() {
        var out = [];
        var d = state.devices;
        d.video.forEach(function (v) { out.push(['摄像头', v.label || '(unnamed)']); });
        d.audioIn.forEach(function (v) { out.push(['麦克风', v.label || '(unnamed)']); });
        d.audioOut.forEach(function (v) { out.push(['音频输出', v.label || '(unnamed)']); });
        if (!out.length) { out.push(['（无设备）', 'None reporied by the browser']); }
        return out;
    }

    function load() {
        var r = mediaApi.listDevices();
        return Promise.resolve(r).then(function (res) {
            if (res.status === S.OK) { state.devices = res.value; }
            if (state.table) { state.table.setRows(rows()); }
            if (state.status) {
                state.status.setPane('main',
                    (state.devices.video.length + state.devices.audioIn.length + state.devices.audioOut.length) +
                    ' 个设备');
            }
            if (state.win) { state.win.invalidate(); }
            return res;
        });
    }

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '设备管理器', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '设备管理器', width: APP.width, height: APP.height });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        state.win = win;
        var client = win.client;

        var table = new ui.controls.Table({
            x: 8, y: 8, width: client.width - 16, height: client.height - 16 - 40 - 22,
            columns: [
                { id: 'kind', text: '类别', width: 160 },
                { id: 'name', text: '设备', width: 400 }
            ]
        });
        client.addChild(table);
        state.table = table;

        var y = 8 + (client.height - 16 - 40 - 22) + 8;
        client.addChild(new ui.controls.Button({
            x: 8, y: y, width: 130, height: 28, text: '刷新',
            onClick: function () { load(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 148, y: y, width: 150, height: 28, text: '测试摄像头',
            onClick: function () {
                mediaApi.camera({ timeout: 4000 }).then(function (r) {
                    if (state.status) {
                        state.status.setPane('main', r.status === S.OK
                            ? 'Camera opened'
                            : ('Camera failed: ' + (r.reason || 'unavailable')));
                    }
                    if (r.status === S.OK) { mediaApi.stopStream(r.value.id); }
                });
            }
        }));
        client.addChild(new ui.controls.Button({
            x: 308, y: y, width: 150, height: 28, text: '声音测试',
            onClick: function () { mediaApi.beep(660, 120); }
        }));

        var status = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '正在扫描…', flex: 1 }]
        });
        client.addChild(status);
        state.status = status;

        load();
        win.invalidate();
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) { r.register({ id: APP.id, name: '设备管理器', icon: APP.icon, category: 'system', builtin: true }); }
        return CORE.ok(true);
    }

    var DM = { version: '1.0.0', id: APP.id, displayName: '设备管理器', icon: APP.icon, open: open, register: register, load: load };
    G.EznK.Apps.deviceManager = DM;
    register();
    CORE.createLogger('EznK/L6:device').info('js/apps/device-manager.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
