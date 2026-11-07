/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L6 应用层
 *
 *   文件 : js/apps/camera.js
 *   模块 : EznK.Apps.camera
 *   层级 : L6 应用层
 *
 *   摄像头 —— 对应 PTD.html 的 srm_camera 窗口。
 *   实时预览、拍照、保存到文档目录、停止。
 *   通过 Ezn32 Platform.Media 访问设备（唯一媒体入口）。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.camera) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;
    var media = G.EznK.Platform.Media;
    var Time = G.EznK.Platform.Time;

    var APP = { id: 'camera', displayName: '摄像头', icon: '📷', width: 720, height: 560 };

    var st = {
        win: null, preview: null, status: null,
        streamId: null, timer: null, lastShot: null, frameEl: null
    };

    function stopCamera() {
        if (st.timer && st.timer.status === S.OK) { Time.cancel(st.timer.value); st.timer = null; }
        if (st.streamId) {
            media.stopStream(st.streamId);
            st.streamId = null;
        }
        if (st.frameEl) { st.frameEl.src = ''; }
        if (st.status) { st.status.setPane('main', '摄像头已停止'); }
    }

    function startCamera() {
        if (st.status) { st.status.setPane('main', '正在请求摄像头权限…'); }
        media.camera({ timeout: 10000 }).then(function (r) {
            if (r.status !== S.OK) {
                if (st.status) { st.status.setPane('main', '无法打开摄像头：' + (r.reason || '未授权或没有设备')); }
                return;
            }
            var stream = r.value;
            st.streamId = stream.id;
            if (st.frameEl && stream.element) {
                st.frameEl.srcObject = stream.element;
                var pr = st.frameEl.play();
                if (pr && pr.catch) { pr.catch(function () {}); }
            }
            if (st.status) { st.status.setPane('main', '摄像头运行中'); }
        });
    }

    function takePhoto() {
        if (!st.streamId) {
            if (st.status) { st.status.setPane('main', '请先开启摄像头'); }
            return Promise.resolve(CORE.fail(S.ENOSPC, { reason: '摄像头未开启' }));
        }
        return Promise.resolve(media.grabFrame(st.streamId)).then(function (r) {
            if (r.status !== S.OK) {
                if (st.status) { st.status.setPane('main', '拍照失败：' + (r.reason || '')); }
                return r;
            }
            st.lastShot = r.value;
            if (st.preview) { st.preview.invalidate(); }

            var user = G.EznK.Service.user;
            var cur = user ? user.currentUser().value : null;
            var dir = '/Users/' + (cur ? cur.name : 'User') + '/Documents';
            var name = dir + '/photo-' + Date.now() + '.png';
            var api = ezn32.api;
            var dataUrl = r.value && r.value.dataUrl;
            if (!dataUrl) {
                if (st.status) { st.status.setPane('main', '已拍照（未取得图像数据）'); }
                return CORE.ok(true);
            }
            return api.kernel.WriteFileText(name, dataUrl).then(function (w) {
                var nc = G.EznK.Shell && G.EznK.Shell.notifications;
                if (w.status === S.OK) {
                    if (st.status) { st.status.setPane('main', '已保存：' + name); }
                    if (nc) { nc.push({ title: '📷 摄像头', text: '照片已保存', level: 'info' }); }
                } else {
                    if (st.status) { st.status.setPane('main', '保存失败：' + (w.reason || '')); }
                }
                return w;
            });
        });
    }

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '摄像头', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '摄像头', width: APP.width, height: APP.height, icon: APP.icon });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        st.win = win;
        var client = win.client;

        /* 预览区：用一个隐藏的 <video> 承载真实画面，画布负责取帧显示 */
        var prev = new ui.Control({ x: 8, y: 8, width: client.width - 16, height: client.height - 76 });
        prev.clipChildren = true;
        prev.onPaint = function (dc) {
            var gdi = ezn32.api.gdi;
            gdi.FillRect(dc, 0, 0, prev.width, prev.height, '#000000');
            if (st.frameEl) {
                try {
                    if (st.frameEl.readyState >= 2) {
                        dc.ctx.drawImage(st.frameEl, 0, 0, prev.width, prev.height);
                    }
                } catch (_) {}
            } else {
                gdi.SelectObject(dc, ui.res.font('iconHuge'));
                gdi.SetTextColor(dc, '#666666');
                gdi.SetTextAlign(dc, 'center');
                gdi.DrawText(dc, '📷', 0, prev.height / 2 - 20, prev.width);
                gdi.SelectObject(dc, ui.res.font('ui'));
                gdi.DrawText(dc, '点击「开启摄像头」授权后显示画面', 0, prev.height / 2 + 20, prev.width);
                gdi.SetTextAlign(dc, 'left');
            }
        };
        client.addChild(prev);
        st.preview = prev;

        /* 隐藏 video 元素作为视频源 */
        var DOM = G.EznK.Platform.DOM;
        var v = DOM.create('video', {
            style: { display: 'none' },
            attributes: { autoplay: 'autoplay', playsinline: 'playsinline', muted: 'muted' }
        });
        if (v.status === S.OK) {
            st.frameEl = v.value;
            DOM.append(client.width ? document.body : document.body, st.frameEl);
        }

        /* 实时刷新预览画布 */
        var loop = Time.every(66, function () {
            if (!st.win || st.win.destroyed) { return; }
            if (st.streamId) { prev.invalidate(); }
        });
        st.timer = loop.status === S.OK ? loop.value : null;

        var y = client.height - 60;
        client.addChild(new ui.controls.Button({
            x: 8, y: y, width: 120, height: 30, text: '📷 开启摄像头',
            variant: 'primary',
            onClick: function () { startCamera(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 136, y: y, width: 110, height: 30, text: '📸 拍照',
            onClick: function () { takePhoto(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 254, y: y, width: 110, height: 30, text: '⏹ 停止',
            variant: 'danger',
            onClick: function () { stopCamera(); prev.invalidate(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 372, y: y, width: 120, height: 30, text: '🔍 设备列表',
            onClick: function () {
                media.listDevices().then(function (r) {
                    var d = r.status === S.OK ? r.value : { video: [] };
                    st.status.setPane('main', '可用摄像头：' + (d.video.length || 0) + ' 个');
                });
            }
        }));

        var sb = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '就绪 —— 点击「开启摄像头」开始', flex: 1 }]
        });
        client.addChild(sb);
        st.status = sb;

        win.onDestroy = function () { stopCamera(); };

        win.invalidate();
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) { r.register({ id: APP.id, name: '摄像头', icon: APP.icon, category: 'hardware', builtin: true }); }
        return CORE.ok(true);
    }

    var CAM = {
        version: '1.0.0', id: APP.id, displayName: '摄像头', icon: APP.icon,
        open: open, register: register, start: startCamera, stop: stopCamera, takePhoto: takePhoto
    };
    G.EznK.Apps.camera = CAM;
    register();
    CORE.createLogger('EznK/L6:camera').info('js/apps/camera.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
