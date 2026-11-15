/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L4 界面层
 *
 *   文件 : js/ui/ime.js
 *   模块 : EznK.Ui.IME
 *   层级 : L4 界面层
 *
 * ---------------------------------------------------------------------
 * 输入法桥接 + 系统剪贴板
 * ---------------------------------------------------------------------
 * 问题：EZNT 的所有控件都画在 <canvas> 上。canvas 不是可编辑元素，
 * 所以移动端的软键盘 / 输入法（IME）永远不会弹出，中文、日文、韩文
 * 都打不进去；浏览器也不会把系统剪贴板接到我们自绘的编辑框上。
 *
 * 解决办法（业界通用做法，VS Code / Google Docs / Figma 都这么做）：
 *   在页面上放一个"几乎看不见"的 <textarea>，把它定位到当前获得
 *   焦点的编辑控件的位置上。用户点击画布时，我们把真实焦点交给这个
 *   textarea：
 *     · 移动端 → 系统认为有输入框获得焦点，软键盘弹出
 *     · 桌面端 → IME 合成事件（compositionstart/update/end）正常触发
 *     · 系统剪贴板 → 浏览器把 Ctrl+V / 长按粘贴交给 textarea，
 *                  我们读它的内容送进控件
 *
 * 两条输入通道互不干扰：
 *   1. 物理键盘：keydown 直接派发给画布上的控件（保持现有行为）
 *   2. IME / 粘贴：textarea 的 input 事件，只把"新插入的文本"送出
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Ui && G.EznK.Ui.IME) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L4:ime');

    var st = {
        el: null,            /* 隐藏 textarea */
        active: null,        /* 当前绑定的控件 */
        composing: false,    /* IME 合成中 */
        lastValue: '',       /* 上一次 textarea 的内容，用于算增量 */
        enabled: true
    };

    /* =================================================================
     * 1. 元素创建
     * ============================================================== */

    function ensureElement() {
        if (st.el) { return st.el; }
        var doc = G.document;
        if (!doc || !doc.body) { return null; }

        var ta = doc.createElement('textarea');
        ta.id = 'eznt-ime-input';
        ta.setAttribute('autocomplete', 'off');
        ta.setAttribute('autocorrect', 'off');
        ta.setAttribute('autocapitalize', 'off');
        ta.setAttribute('spellcheck', 'false');
        ta.setAttribute('aria-hidden', 'true');
        ta.setAttribute('tabindex', '-1');

        /* 关键：元素必须"看起来真实"移动端才弹键盘，
         * 但视觉上完全透明、不占布局。不能用 display:none 或
         * visibility:hidden —— 那样 iOS/Android 不会弹出键盘。 */
        var s = ta.style;
        s.position = 'fixed';
        s.left = '0px';
        s.top = '0px';
        s.width = '1px';
        s.height = '1px';
        s.padding = '0';
        s.border = '0';
        s.margin = '0';
        s.outline = 'none';
        s.resize = 'none';
        s.overflow = 'hidden';
        s.zIndex = '200000';
        s.opacity = '0.01';       /* 几乎透明但仍在渲染树里 */
        s.background = 'transparent';
        s.color = 'transparent';
        s.caretColor = 'transparent';
        s.fontSize = '16px';      /* 小于 16px iOS 会自动放大页面 */
        s.lineHeight = '1';
        s.pointerEvents = 'none';
        s.whiteSpace = 'pre';

        doc.body.appendChild(ta);
        st.el = ta;
        bindElement(ta);
        return ta;
    }

    /* =================================================================
     * 2. 事件绑定
     * ============================================================== */

    function bindElement(ta) {
        /* ---- IME 合成 ---- */
        ta.addEventListener('compositionstart', function () {
            st.composing = true;
            dispatchComposition('compositionstart', '');
        });
        ta.addEventListener('compositionupdate', function (ev) {
            dispatchComposition('compositionupdate', ev.data || '');
        });
        ta.addEventListener('compositionend', function (ev) {
            st.composing = false;
            var data = ev.data || ta.value || '';
            dispatchComposition('compositionend', data);
            /* 合成结束后清空，避免下次误判增量 */
            st.lastValue = '';
            ta.value = '';
        });

        /* ---- 直接输入（粘贴 / 输入法上屏 / 移动端） ---- */
        ta.addEventListener('input', function () {
            /* 合成期间不要重复送字符：compositionupdate 已经送过 */
            if (st.composing) { return; }
            var v = ta.value || '';
            if (!v.length) { return; }
            /* 把整段文本送进控件，然后清空 */
            if (st.active && typeof st.active.dispatch === 'function') {
                st.active.dispatch('char', { text: v, ime: true });
                invalidateActive();
            }
            ta.value = '';
            st.lastValue = '';
        });

        /* ---- 移动端软键盘"完成"键 ---- */
        ta.addEventListener('keydown', function (ev) {
            /* 合成中不拦截，交给输入法 */
            if (st.composing || ev.isComposing) { return; }
            handleWeirdKeys(ev);
        });

        /* ---- 失焦：把自己藏到角落 ---- */
        ta.addEventListener('blur', function () {
            st.composing = false;
        });

        /* ---- 粘贴：把系统剪贴板里的文本送进来 ---- */
        ta.addEventListener('paste', function (ev) {
            var cd = ev.clipboardData || G.clipboardData;
            if (!cd) { return; }
            var text = cd.getData('text/plain');
            if (!text) { return; }
            ev.preventDefault();
            if (st.active && typeof st.active.dispatch === 'function') {
                st.active.dispatch('char', { text: text, paste: true });
                invalidateActive();
            }
            ta.value = '';
        });
    }

    /** 处理 IME 环境下的特殊按键（Enter / Backspace / 方向键 / Ctrl 组合） */
    function handleWeirdKeys(ev) {
        if (!st.active) { return; }
        var key = ev.key;
        /* 纯可打印字符走 input 事件；带修饰键的一律走这里 */
        if (typeof key === 'string' && key.length === 1 &&
            !ev.ctrlKey && !ev.altKey && !ev.metaKey &&
            !ev.isComposing) {
            return;
        }
        /* 单独按 Control / Shift / Alt / Meta 不处理 */
        if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') { return; }
        /* Ctrl+C/V/X/A/Z：直接派发给控件。
         * 焦点在 textarea 上时 canvas 的 keydown 收不到事件，
         * 浏览器也不会把画布上自绘的编辑框当成可复制目标，
         * 所以这些组合键必须由这里转交，否则快捷键完全无效。 */
        if ((ev.ctrlKey || ev.metaKey) && /^[cvxazCVXAZ]$/.test(key)) {
            var h2 = st.active.dispatch('keydown', keyData(ev));
            if (h2) {
                ev.preventDefault();
                invalidateActive();
                return;
            }
        }
        var handled = st.active.dispatch('keydown', keyData(ev));
        if (handled) {
            ev.preventDefault();
            invalidateActive();
        }
    }

    function keyData(ev) {
        return {
            event: ev,
            key: ev.key,
            code: ev.code,
            text: (typeof ev.key === 'string' && ev.key.length === 1) ? ev.key : '',
            ctrlKey: !!ev.ctrlKey,
            shiftKey: !!ev.shiftKey,
            altKey: !!ev.altKey,
            metaKey: !!ev.metaKey
        };
    }

    function dispatchComposition(type, data) {
        if (st.active && typeof st.active.dispatch === 'function') {
            st.active.dispatch(type, { text: data });
            invalidateActive();
        }
    }

    function invalidateActive() {
        if (st.active && typeof st.active.invalidate === 'function') {
            st.active.invalidate();
        }
    }

    /* =================================================================
     * 3. 焦点绑定
     * ============================================================== */

    /**
     * focus(ctl, rect)
     *   ctl  : 需要接收输入的控件（Edit 等）
     *   rect : 控件在视口中的矩形 {left, top, width, height}
     *          用来把 textarea 定位到它上面，让输入法候选框跟着走。
     */
    function focus(ctl, rect) {
        if (!st.enabled) { return CORE.fail(S.ENOSYS, { reason: 'IME disabled' }); }
        var ta = ensureElement();
        if (!ta) { return CORE.fail(S.EIO, { reason: 'no document body' }); }

        st.active = ctl;
        st.lastValue = '';
        ta.value = '';

        if (rect) {
            /* 定位到控件的左下角：移动端候选框通常在光标下方弹出 */
            ta.style.left = Math.round(rect.left) + 'px';
            ta.style.top = Math.round(rect.top + (rect.height || 20)) + 'px';
            ta.style.width = Math.max(1, Math.round(rect.width || 1)) + 'px';
            ta.style.height = '1px';
        }

        try {
            ta.focus({ preventScroll: true });
        } catch (_) {
            try { ta.focus(); } catch (e2) { /* ignore */ }
        }

        /* 让控件的初始内容成为 textarea 的"已存在内容"，
         * 这样后续 input 事件算出的增量才是新增字符。 */
        ta.value = '';
        return CORE.ok(true);
    }

    /** blur() - 交回焦点（用户点了画布别处） */
    function blur() {
        st.active = null;
        st.composing = false;
        st.lastValue = '';
        if (st.el) {
            st.el.value = '';
            if (G.document && G.document.activeElement === st.el) {
                try { st.el.blur(); } catch (_) {}
            }
        }
        return CORE.ok(true);
    }

    /** setCursorPosition(x, y) - 让移动端候选框跟随光标 */
    function setCursorPosition(x, y) {
        if (!st.el) { return CORE.ok(false); }
        st.el.style.left = Math.round(x) + 'px';
        st.el.style.top = Math.round(y) + 'px';
        return CORE.ok(true);
    }

    /* =================================================================
     * 4. 系统剪贴板
     * ============================================================== */

    /**
     * readClipboard() -> Promise<{status, value: string}>
     *   优先用 navigator.clipboard（需要安全上下文 / 用户手势），
     *   失败时退回 execCommand('paste')，再失败退回内存剪贴板。
     */
    function readClipboard() {
        var mem = G.ezn32 && G.ezn32.ui && G.ezn32.ui.__clipboard;

        /* 1. 现代异步 API */
        if (G.navigator && G.navigator.clipboard &&
            typeof G.navigator.clipboard.readText === 'function') {
            return G.navigator.clipboard.readText().then(function (text) {
                if (mem && text) { mem.set(text); }
                return CORE.ok(text || '');
            }).catch(function () {
                return fallbackRead(mem);
            });
        }
        return Promise.resolve(fallbackRead(mem));
    }

    function fallbackRead(mem) {
        var text = mem ? String(mem.get() || '') : '';
        return CORE.ok(text);
    }

    /**
     * writeClipboard(text) -> Promise<{status, value: boolean}>
     */
    function writeClipboard(text) {
        var s = String(text === null || text === undefined ? '' : text);
        var mem = G.ezn32 && G.ezn32.ui && G.ezn32.ui.__clipboard;
        /* 内存剪贴板始终写入：它是应用内 Ctrl+C / Ctrl+V 的可靠后盾，
         * 也是浏览器拒绝系统剪贴板时的回退。 */
        if (mem) { mem.set(s); }

        var sysWrite = function () {
            if (G.navigator && G.navigator.clipboard &&
                typeof G.navigator.clipboard.writeText === 'function') {
                return G.navigator.clipboard.writeText(s).then(function () {
                    return true;
                }).catch(function () { return false; });
            }
            return Promise.resolve(false);
        };

        /* document.execCommand 回退：某些环境下 navigator.clipboard 会
         * "成功"返回但实际不写（无用户手势 / 权限被拒），这里再兜一次。 */
        var execWrite = function () {
            try {
                var doc = G.document;
                if (!doc || !doc.body || typeof doc.execCommand !== 'function') { return false; }
                var ta = doc.createElement('textarea');
                ta.value = s;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                ta.style.top = '0';
                doc.body.appendChild(ta);
                ta.select();
                var ok = false;
                try { ok = doc.execCommand('copy'); } catch (_) { ok = false; }
                doc.body.removeChild(ta);
                return !!ok;
            } catch (_) { return false; }
        };

        return sysWrite().then(function (ok) {
            if (ok) { return CORE.ok(true); }
            return CORE.ok(execWrite());
        });
    }

    /* =================================================================
     * 5. 初始化
     * ============================================================== */

    function isMobile() {
        var ua = G.navigator && G.navigator.userAgent ? G.navigator.userAgent : '';
        if (/Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua)) { return true; }
        /* 触摸屏但可能没有 Mobile 标识（Windows 平板） */
        if (G.navigator && G.navigator.maxTouchPoints > 0 && G.innerWidth <= 1024) { return true; }
        return false;
    }

    function boot() {
        ensureElement();
        LOG.info('IME 桥接已就绪（移动端=' + isMobile() + '）');
        return CORE.ok(true);
    }

    var IME = {
        version: '1.0.0',
        boot: boot,
        focus: focus,
        blur: blur,
        setCursorPosition: setCursorPosition,
        readClipboard: readClipboard,
        writeClipboard: writeClipboard,
        isComposing: function () { return st.composing; },
        isMobile: isMobile,
        element: function () { return st.el; },
        state: function () { return st; }
    };

    if (!G.EznK.Ui) { G.EznK.Ui = {}; }
    G.EznK.Ui.IME = IME;
    if (G.ezn32 && G.ezn32.ui) { G.ezn32.ui.ime = IME; }

    LOG.info('js/ui/ime.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
