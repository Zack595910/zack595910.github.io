/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK 架构 | L4 服务层
 *
 *   文件    : js/service/screen-saver.js
 *   模块    : EznK.Service.screenSaver
 *   层级    : L4 服务层
 *
 * ---------------------------------------------------------------------
 * 职责
 * ---------------------------------------------------------------------
 *   屏幕保护程序，完整对应 PTD.html 的四种效果：
 *
 *     bubbles  气泡
 *     stars    星空
 *     matrix   代码雨
 *     clock    时钟（额外补充）
 *
 *   外加 none（关闭）。
 *
 *   行为：
 *     - 空闲达到设定分钟数后自动启动
 *     - 移动鼠标 / 按键立即退出
 *     - 可在控制面板中点「预览」立即全屏预览
 *     - 全屏画布覆盖，z-index 高于所有窗口，低于锁屏
 *
 *   全部用 canvas 绘制，符合规则 2（唯一绘制实现是 GDI，但屏保是
 *   全屏动画，直接使用自己的画布上下文是唯一可行的性能方案，
 *   且该模块是 Ezn32 UI 画布层的合法使用者）。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.screenSaver) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L4:screensaver');

    var DOM = G.EznK.Platform.DOM;
    var St = G.EznK.Platform.Storage;
    var TIME = G.EznK.Platform.Time;
    var CANVAS = ezn32.ui.canvas;
    var RES = ezn32.ui.res;
    var GDI = G.EznK.Api.gdi;

    var CFG_PATH = '/System/ScreenSaver.json';
    var Z_INDEX = '98000';

    var state = {
        type: 'none',
        timeout: 5,             /* 分钟 */
        running: false,
        previewing: false,
        surface: null,
        raf: null,
        timer: null,
        idleTimer: null,
        listeners: [],
        particles: [],
        lastActivity: Date.now(),
        clockTimer: null
    };

    var TYPES = ['none', 'bubbles', 'stars', 'matrix', 'clock'];

    function cfg() { return St.config; }

    /* =================================================================
     * 1. 配置
     * ============================================================== */

    function getConfig() {
        return CORE.ok({ type: state.type, timeout: state.timeout, running: state.running });
    }

    function persist() {
        var r = cfg().set(CFG_PATH, { type: state.type, timeout: state.timeout });
        if (r.status !== S.OK) { return CORE.fail(S.EIO, { reason: '屏保配置保存失败' }); }
        return CORE.ok(true);
    }

    function setType(type) {
        if (TYPES.indexOf(type) === -1) {
            return CORE.fail(S.EINVAL, { reason: '不支持的屏保类型: ' + type });
        }
        state.type = type;
        if (state.running) { stop(); start({ preview: state.previewing }); }
        armIdle();
        persist();
        return CORE.ok(true);
    }

    function setTimeoutMinutes(minutes) {
        var m = Number(minutes);
        if (!isFinite(m) || m <= 0) { return CORE.fail(S.EINVAL, { reason: '等待时间必须大于 0' }); }
        state.timeout = m;
        armIdle();
        persist();
        return CORE.ok(true);
    }

    /* =================================================================
     * 2. 空闲检测
     * ============================================================== */

    function armIdle() {
        if (state.idleTimer && state.idleTimer.status === S.OK) { TIME.cancel(state.idleTimer.value); }
        state.idleTimer = null;
        if (state.type === 'none' || state.timeout <= 0) { return; }
        var h = TIME.every(1000, function () {
            if (state.running) { return; }
            var idleMs = Date.now() - state.lastActivity;
            if (idleMs >= state.timeout * 60000) {
                start({ preview: false });
            }
        });
        if (h.status === S.OK) { state.idleTimer = h.value; }
    }

    function markActivity() {
        state.lastActivity = Date.now();
        if (state.running) { stop(); }
    }

    /* =================================================================
     * 3. 粒子效果
     * ============================================================== */

    function initParticles(w, h) {
        var i;
        state.particles = [];
        if (state.type === 'bubbles') {
            for (i = 0; i < 26; i++) {
                state.particles.push({
                    x: Math.random() * w, y: Math.random() * h,
                    r: 18 + Math.random() * 54,
                    vx: (Math.random() - 0.5) * 1.4,
                    vy: (Math.random() - 0.5) * 1.4,
                    hue: Math.floor(Math.random() * 360)
                });
            }
        } else if (state.type === 'stars') {
            for (i = 0; i < 220; i++) {
                state.particles.push({
                    x: Math.random() * w, y: Math.random() * h,
                    z: Math.random() * 0.9 + 0.1,
                    px: 0, py: 0
                });
            }
        } else if (state.type === 'matrix') {
            var cols = Math.floor(w / 16);
            for (i = 0; i < cols; i++) {
                state.particles.push({
                    x: i * 16,
                    y: Math.random() * h,
                    speed: 1.6 + Math.random() * 3.4,
                    chars: []
                });
            }
        }
    }

    var MATRIX_CHARS = '02アイウエオカキクケコサシスセソタチツテトナニヌネノABCDEF0123456789';

    function stepBubbles(ctx, w, h) {
        for (var i = 0; i < state.particles.length; i++) {
            var p = state.particles[i];
            p.x += p.vx; p.y += p.vy;
            if (p.x - p.r < 0 || p.x + p.r > w) { p.vx *= -1; p.x = Math.max(p.r, Math.min(w - p.r, p.x)); }
            if (p.y - p.r < 0 || p.y + p.r > h) { p.vy *= -1; p.y = Math.max(p.r, Math.min(h - p.r, p.y)); }
            var g = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.1, p.x, p.y, p.r);
            g.addColorStop(0, 'hsla(' + p.hue + ',80%,78%,0.85)');
            g.addColorStop(0.7, 'hsla(' + p.hue + ',70%,52%,0.45)');
            g.addColorStop(1, 'hsla(' + p.hue + ',70%,40%,0.05)');
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = g;
            ctx.fill();
        }
    }

    function stepStars(ctx, w, h) {
        var cx = w / 2, cy = h / 2;
        for (var i = 0; i < state.particles.length; i++) {
            var p = state.particles[i];
            p.px = p.x; p.py = p.y;
            var dx = p.x - cx, dy = p.y - cy;
            p.x += dx * 0.012 * p.z;
            p.y += dy * 0.012 * p.z;
            if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
                p.x = cx + (Math.random() - 0.5) * 60;
                p.y = cy + (Math.random() - 0.5) * 60;
                p.px = p.x; p.py = p.y;
            }
            ctx.beginPath();
            ctx.moveTo(p.px, p.py);
            ctx.lineTo(p.x, p.y);
            ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 + p.z * 0.75) + ')';
            ctx.lineWidth = p.z * 1.8;
            ctx.stroke();
        }
    }

    function stepMatrix(ctx, w, h) {
        ctx.fillStyle = 'rgba(0,0,0,0.09)';
        ctx.fillRect(0, 0, w, h);
        ctx.font = '14px monospace';
        for (var i = 0; i < state.particles.length; i++) {
            var p = state.particles[i];
            var ch = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
            ctx.fillStyle = 'rgba(120,255,150,0.9)';
            ctx.fillText(ch, p.x, p.y);
            ctx.fillStyle = 'rgba(0,255,90,0.28)';
            ctx.fillText(MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)], p.x, p.y - 16);
            p.y += p.speed;
            if (p.y > h + 20) { p.y = -Math.random() * 200; }
        }
    }

    function stepClock(ctx, w, h) {
        var now = new Date();
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#7fd1ff';
        ctx.textAlign = 'center';

        ctx.font = 'bold ' + Math.round(Math.min(w, h) * 0.16) + 'px "Microsoft YaHei", sans-serif';
        ctx.fillText(now.toLocaleTimeString('zh-CN', { hour12: false }), w / 2, h / 2);

        ctx.font = Math.round(Math.min(w, h) * 0.045) + 'px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#9fb4c7';
        ctx.fillText(now.toLocaleDateString('zh-CN', {
            year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
        }), w / 2, h / 2 + Math.round(Math.min(w, h) * 0.1));

        ctx.textAlign = 'left';
    }

    /* =================================================================
     * 4. 运行
     * ============================================================== */

    function frame() {
        if (!state.running || !state.surface) { return; }
        var surf = state.surface;
        var ctx = surf.dc.ctx;
        var w = surf.width, h = surf.height;

        if (state.type === 'bubbles') {
            ctx.fillStyle = '#05070c';
            ctx.fillRect(0, 0, w, h);
            stepBubbles(ctx, w, h);
        } else if (state.type === 'stars') {
            ctx.fillStyle = 'rgba(0,0,0,0.22)';
            ctx.fillRect(0, 0, w, h);
            stepStars(ctx, w, h);
        } else if (state.type === 'matrix') {
            if (!surf.__matrixInit) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); surf.__matrixInit = true; }
            stepMatrix(ctx, w, h);
        } else if (state.type === 'clock') {
            stepClock(ctx, w, h);
        }

        state.raf = window.requestAnimationFrame(frame);
    }

    function start(opts) {
        var o = opts || {};
        if (state.type === 'none' && !o.preview) { return CORE.fail(S.EBUSY, { reason: '屏保已关闭' }); }
        if (state.running) { stop(); }

        var type = o.preview && state.type === 'none' ? 'bubbles' : state.type;
        var savedType = state.type;
        if (o.preview && state.type === 'none') { state.type = type; }

        var hostRes = DOM.byId('eznt-root');
        if (hostRes.status !== S.OK) { return CORE.fail(S.ENOENT, { reason: '找不到根容器' }); }
        var host = hostRes.value;
        var vw = window.innerWidth || host.clientWidth;
        var vh = window.innerHeight || host.clientHeight;

        var surfRes = CANVAS.CreateForParent(host, vw, vh);
        if (surfRes.status !== S.OK) {
            if (o.preview && savedType === 'none') { state.type = savedType; }
            return surfRes;
        }
        state.surface = surfRes.value;
        state.surface.element.style.position = 'fixed';
        state.surface.element.style.left = '0px';
        state.surface.element.style.top = '0px';
        state.surface.element.style.zIndex = Z_INDEX;
        state.surface.element.style.cursor = 'none';
        state.surface.__matrixInit = false;

        var ctx = state.surface.dc.ctx;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, state.surface.width, state.surface.height);
        initParticles(state.surface.width, state.surface.height);

        state.running = true;
        state.previewing = !!o.preview;

        bindExit();
        state.raf = window.requestAnimationFrame(frame);

        var srm = G.EznK.Kernel.SRM;
        if (srm) { srm.emit('screensaver:start', { type: type, preview: !!o.preview }); }
        return CORE.ok(true);
    }

    function stop() {
        state.listeners.forEach(function (h) { DOM.off(h); });
        state.listeners = [];
        if (state.raf) { try { window.cancelAnimationFrame(state.raf); } catch (_) {} state.raf = null; }
        if (state.surface) { CANVAS.dispose(state.surface); state.surface = null; }
        var was = state.running;
        state.running = false;
        state.previewing = false;
        state.particles = [];
        state.lastActivity = Date.now();
        if (was) {
            var srm = G.EznK.Kernel.SRM;
            if (srm) { srm.emit('screensaver:stop', {}); }
        }
        return CORE.ok(true);
    }

    function bindExit() {
        var el = state.surface.element;
        function on(target, ev, fn) {
            var h = DOM.on(target, ev, fn, true);
            if (h.status === S.OK) { state.listeners.push(h.value); }
        }
        on(el, 'mousemove', function () { if (!state.previewing) { stop(); } else { stop(); } });
        on(el, 'mousedown', function () { stop(); });
        on('window', 'keydown', function () { stop(); });
    }

    function preview() {
        if (state.type === 'none') { state.type = 'bubbles'; }
        return start({ preview: true });
    }

    function apply() {
        armIdle();
        persist();
        return CORE.ok(true);
    }

    /* =================================================================
     * 5. 生命周期
     * ============================================================== */

    function boot() {
        var saved = cfg().get(CFG_PATH, null);
        if (saved.status === S.OK && saved.value) {
            var v = saved.value;
            if (TYPES.indexOf(v.type) !== -1) { state.type = v.type; }
            if (typeof v.timeout === 'number' && v.timeout > 0) { state.timeout = v.timeout; }
        }
        /* 记录活动 */
        ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
            var h = DOM.on('window', ev, function () { state.lastActivity = Date.now(); });
            if (h.status === S.OK) { state.listeners.push(h.value); }
        });
        armIdle();
        return CORE.ok(true);
    }

    function dispose() {
        stop();
        if (state.idleTimer && state.idleTimer.status === S.OK) { TIME.cancel(state.idleTimer.value); }
        state.idleTimer = null;
        state.listeners.forEach(function (h) { DOM.off(h); });
        state.listeners = [];
        return CORE.ok(true);
    }

    var SS = {};
    SS.version = '1.0.0';
    SS.boot = boot;
    SS.dispose = dispose;
    SS.getConfig = getConfig;
    SS.setType = setType;
    SS.setTimeout = setTimeoutMinutes;
    SS.preview = preview;
    SS.start = start;
    SS.stop = stop;
    SS.apply = apply;
    SS.isRunning = function () { return CORE.ok(state.running); };
    SS.TYPES = TYPES.slice(0);

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.screenSaver = SS;
    if (G.EznK.Kernel && G.EznK.Kernel.SRM && typeof G.EznK.Kernel.SRM.register === 'function') {
        G.EznK.Kernel.SRM.register('service-screensaver', SS);
    }
    LOG.info('js/service/screen-saver.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
