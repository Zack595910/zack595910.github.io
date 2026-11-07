/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK 架构 | L4 服务层
 *
 *   文件    : js/service/wallpaper.js
 *   模块    : EznK.Service.wallpaper
 *   层级    : L4 服务层
 *
 * ---------------------------------------------------------------------
 * 职责
 * ---------------------------------------------------------------------
 *   桌面壁纸。支持 PTD.html 的三种壁纸形态：
 *
 *     1. 纯色       mode = 'color'
 *     2. 图片壁纸   mode = 'image'   （通过 <input type=file> 上传）
 *     3. 视频壁纸   mode = 'video'   （通过 <input type=file> 上传，
 *                                      <video> 元素自动循环静音播放）
 *
 *   配置通过存储网关持久化到系统数据盘：
 *     /System/Wallpaper.json  ->  { mode, color, dataUrl, name }
 *
 *   图片/视频数据以 dataURL 形式保存；为避免撑爆 localStorage，
 *   超过 BUDGET 字节的内容只在本次会话生效并给出提示。
 *
 *   视频层用 DOM 元素承载 —— 这是唯一合理的做法，因为 canvas 无法
 *   逐帧绘制整段视频。它由 EznK.Platform.DOM 统一创建（规则 2），
 *   并保证只有一层、可释放（规则 6）。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.wallpaper) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L4:wallpaper');

    var DOM = G.EznK.Platform.DOM;
    var St = G.EznK.Platform.Storage;

    var CFG_PATH = '/System/Wallpaper.json';
    var BUDGET = 2 * 1024 * 1024;      /* 2 MB 以内持久化 */

    var DEFAULT_COLOR = '#0078D4';

    var state = {
        mode: 'color',
        color: DEFAULT_COLOR,
        dataUrl: null,
        name: '',
        videoEl: null,
        overlayEl: null,
        listeners: []
    };

    function cfg() { return St.config; }

    function getConfig() {
        return CORE.ok({
            mode: state.mode,
            color: state.color,
            name: state.name,
            hasData: !!state.dataUrl,
            bytes: state.dataUrl ? state.dataUrl.length : 0
        });
    }

    /* =================================================================
     * 1. 桌面层
     * ============================================================== */

    /** 找到桌面 canvas 的容器，壁纸层插在它下面 */
    function desktopHost() {
        var r = DOM.byId('desktop');
        if (r.status !== S.OK) { return null; }
        return r.value;
    }

    function ensureOverlay() {
        if (state.overlayEl) { return state.overlayEl; }
        var host = desktopHost();
        if (!host) { return null; }
        var el = DOM.create('div', {
            id: 'eznt-wallpaper',
            style: {
                position: 'absolute',
                left: '0px', top: '0px',
                width: '100%', height: '100%',
                zIndex: '0',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                pointerEvents: 'none',
                overflow: 'hidden'
            }
        });
        if (el.status !== S.OK) { return null; }
        state.overlayEl = el.value;
        DOM.append(host, state.overlayEl);
        return state.overlayEl;
    }

    function removeVideo() {
        if (state.videoEl) {
            try { state.videoEl.pause(); } catch (_) {}
            try { state.videoEl.removeAttribute('src'); state.videoEl.load(); } catch (_) {}
            DOM.remove(state.videoEl);
            state.videoEl = null;
        }
    }

    /** apply() - 把当前配置渲染到桌面 */
    function apply() {
        var el = ensureOverlay();
        if (!el) { return CORE.fail(S.ENOENT, { reason: '找不到桌面容器' }); }

        removeVideo();

        if (state.mode === 'video' && state.dataUrl) {
            el.style.background = 'transparent';
            el.style.backgroundImage = 'none';
            var v = DOM.create('video', {
                style: {
                    position: 'absolute',
                    left: '0px', top: '0px',
                    width: '100%', height: '100%',
                    objectFit: 'cover',
                    pointerEvents: 'none'
                },
                attributes: { muted: 'muted', loop: 'loop', autoplay: 'autoplay', playsinline: 'playsinline' }
            });
            if (v.status === S.OK) {
                state.videoEl = v.value;
                state.videoEl.src = state.dataUrl;
                state.videoEl.muted = true;
                state.videoEl.loop = true;
                DOM.append(el, state.videoEl);
                var pr = state.videoEl.play();
                if (pr && pr.catch) { pr.catch(function () {}); }
            }
        } else if (state.mode === 'image' && state.dataUrl) {
            el.style.backgroundImage = 'url("' + state.dataUrl + '")';
        } else {
            el.style.backgroundImage = 'none';
            el.style.background = state.color;
        }

        var srm = G.EznK.Kernel.SRM;
        if (srm) { srm.emit('wallpaper:changed', { mode: state.mode, color: state.color }); }
        return CORE.ok(true);
    }

    /* =================================================================
     * 2. 设置
     * ============================================================== */

    function persist() {
        var r = cfg().set(CFG_PATH, {
            mode: state.mode,
            color: state.color,
            name: state.name,
            dataUrl: (state.dataUrl && state.dataUrl.length <= BUDGET) ? state.dataUrl : null
        });
        if (r.status !== S.OK) {
            return CORE.fail(S.EIO, { reason: '壁纸配置保存失败（可能超出存储配额）' });
        }
        return CORE.ok(true);
    }

    function setColor(color) {
        if (typeof color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
            return CORE.fail(S.EINVAL, { reason: '颜色格式错误' });
        }
        state.mode = 'color';
        state.color = color;
        state.dataUrl = null;
        state.name = '';
        apply();
        persist();
        return CORE.ok(true);
    }

    function setImage(dataUrl, name) {
        if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0) {
            return CORE.fail(S.EINVAL, { reason: '不是有效的图片数据' });
        }
        state.mode = 'image';
        state.dataUrl = dataUrl;
        state.name = name || 'image';
        apply();
        var p = persist();
        if (dataUrl.length > BUDGET) {
            return CORE.fail(S.ENOSPC, { reason: '图片较大（' + Math.round(dataUrl.length / 1024) + ' KB），本次会话生效但重启后不会保留' });
        }
        return p;
    }

    function setVideo(dataUrl, name) {
        if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:video/') !== 0) {
            return CORE.fail(S.EINVAL, { reason: '不是有效的视频数据' });
        }
        state.mode = 'video';
        state.dataUrl = dataUrl;
        state.name = name || 'video';
        apply();
        var p = persist();
        if (dataUrl.length > BUDGET) {
            return CORE.fail(S.ENOSPC, { reason: '视频较大（' + Math.round(dataUrl.length / 1024) + ' KB），本次会话生效但重启后不会保留' });
        }
        return p;
    }

    /* =================================================================
     * 3. 文件选择
     * ============================================================== */

    function pick(kind) {
        return new Promise(function (resolve) {
            var input = DOM.create('input', {
                attributes: { type: 'file', accept: kind === 'video' ? 'video/*' : 'image/*' }
            });
            if (input.status !== S.OK) {
                resolve(CORE.fail(S.EFAULT, { reason: '无法创建文件选择器' }));
                return;
            }
            var el = input.value;

            function finish(res) {
                DOM.remove(el);
                resolve(res);
            }

            el.addEventListener('change', function () {
                if (!el.files || !el.files.length) { finish(CORE.fail(S.EINVAL, { reason: '未选择文件' })); return; }
                var file = el.files[0];
                var reader = new FileReader();
                reader.onload = function (e) {
                    finish(CORE.ok({ dataUrl: e.target.result, name: file.name, size: file.size, type: file.type }));
                };
                reader.onerror = function () { finish(CORE.fail(S.EIO, { reason: '文件读取失败' })); };
                reader.readAsDataURL(file);
            });

            el.addEventListener('cancel', function () {
                finish(CORE.fail(S.EINVAL, { reason: '已取消' }));
            });

            DOM.append(desktopHost() || document.body, el);
            el.style.display = 'none';
            el.click();
        });
    }

    function pickImage() {
        return pick('image').then(function (r) {
            if (r.status !== S.OK) { return r; }
            var res = setImage(r.value.dataUrl, r.value.name);
            if (res.status !== S.OK && res.status === S.ENOSPC) { return CORE.ok(true); }
            return res;
        });
    }

    function pickVideo() {
        return pick('video').then(function (r) {
            if (r.status !== S.OK) { return r; }
            var res = setVideo(r.value.dataUrl, r.value.name);
            if (res.status !== S.OK && res.status === S.ENOSPC) { return CORE.ok(true); }
            return res;
        });
    }

    /* =================================================================
     * 4. 生命周期
     * ============================================================== */

    function boot() {
        var saved = cfg().get(CFG_PATH, null);
        if (saved.status === S.OK && saved.value) {
            var v = saved.value;
            state.mode = v.mode || 'color';
            state.color = v.color || DEFAULT_COLOR;
            state.name = v.name || '';
            state.dataUrl = v.dataUrl || null;
            if (!state.dataUrl && (state.mode === 'image' || state.mode === 'video')) {
                state.mode = 'color';     /* 数据没留住，退回纯色 */
            }
        }
        apply();
        return CORE.ok(true);
    }

    function dispose() {
        state.listeners.forEach(function (h) { DOM.off(h); });
        state.listeners = [];
        removeVideo();
        if (state.overlayEl) { DOM.remove(state.overlayEl); state.overlayEl = null; }
        return CORE.ok(true);
    }

    var W = {};
    W.version = '1.0.0';
    W.boot = boot;
    W.dispose = dispose;
    W.apply = apply;
    W.getConfig = getConfig;
    W.setColor = setColor;
    W.setImage = setImage;
    W.setVideo = setVideo;
    W.pickImage = pickImage;
    W.pickVideo = pickVideo;
    W.DEFAULT_COLOR = DEFAULT_COLOR;

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.wallpaper = W;
    if (G.EznK.Kernel && G.EznK.Kernel.SRM && typeof G.EznK.Kernel.SRM.register === 'function') {
        G.EznK.Kernel.SRM.register('service-wallpaper', W);
    }
    LOG.info('js/service/wallpaper.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
