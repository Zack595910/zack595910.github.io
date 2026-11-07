/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/control.js
 *   Module  : EznK.Ui.Control  (alias: ezn32.ui.Control)
 *   Layer   : Ezn32 UI
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The Control base class. EVERY control in Ezn32 UI derives from it
 *   (Button, Edit, Label, ListBox, CheckBox, Menu, ScrollBar, StatusBar,
 *   Dialog, TreeView, Table). Hard rule #2 "one concept, one
 *   implementation" is enforced here: layout, hit testing, focus, painting
 *   dispatch, message dispatch, invalidation and disposal all live in this
 *   one class and are inherited - never re-implemented per control.
 *
 *   A Control owns:
 *     geometry   x, y, width, height   (client pixels, parent-relative)
 *     state      enabled, visible, focusable, focused, hover, pressed
 *     style      font, colors (resolved from the active theme)
 *     tree       parent, children[]
 *     paint      paint(dc)  - subclass draws itself
 *     messages   onMessage(msg) - subclass reacts
 *
 *   Subclasses only override `onPaint(dc)` and `onMessage(msg)`.
 *
 *   Coordinate model: (x, y) is relative to the parent control's origin.
 *   AbsoluteHitTest walks the tree, so a control never needs to know its
 *   absolute screen position.
 *
 *   Lifecycle: create -> addChild -> layout -> paint; remove() detaches
 *   from the parent and calls dispose() which releases children, timers
 *   and listeners.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.Control && G.ezn32.ui.Control.__isControl === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var GDI = (G.ezn32 && G.ezn32.api && G.ezn32.api.gdi) || null;
    var RES = (G.ezn32 && G.ezn32.ui && G.ezn32.ui.res) || null;
    var MSG = (G.ezn32 && G.ezn32.ui && G.ezn32.ui.msg) || null;
    if (!CORE || !GDI) {
        throw new Error('[Ezn32 UI] js/ui/control.js requires platform/core.js and js/api/gdi.js');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('Ezn32/UI:control');

    var seq = 0;

    /* =================================================================
     * 1. Construction
     * ============================================================== */

    function num(v, dflt) {
        return (typeof v === 'number' && isFinite(v)) ? Math.round(v) : dflt;
    }

    /**
     * new Control(spec)
     *   spec: { x, y, width, height, id, text, enabled, visible,
     *           focusable, parent, font, align, padding }
     */
    function Control(spec) {
        var s = spec || {};
        seq += 1;
        this.__isControl = true;
        this.kind = 'control';
        this.id = (typeof s.id === 'string' && s.id.length > 0) ? s.id : ('ctl' + seq);

        /* geometry (parent-relative) */
        this.x = num(s.x, 0);
        this.y = num(s.y, 0);
        this.width = num(s.width, 80);
        this.height = num(s.height, 24);

        /* state */
        this.enabled = s.enabled !== false;
        this.visible = s.visible !== false;
        this.focusable = s.focusable === true;
        this.focused = false;
        this.hover = false;
        this.pressed = false;

        /* style */
        this.font = s.font || 'ui';
        this.align = s.align || 'left';
        this.padding = num(s.padding, 4);
        this.text = (typeof s.text === 'string') ? s.text : '';
        this.tag = s.tag || null;

        /* tree */
        this.parent = null;
        this.children = [];
        this.disposed = false;

        /* owner surface, set by the Window when the control is attached */
        this.owner = null;

        if (s.parent) { this.parent = s.parent; }

        /* subclass hook */
        if (typeof this.onCreate === 'function') {
            try { this.onCreate(); } catch (err) {
                LOG.error('onCreate threw for ' + this.id + ': ' + (err && err.message));
            }
        }
    }

    /* =================================================================
     * 2. Tree
     * ============================================================== */

    /** addChild(child) -> { status, value: child } */
    Control.prototype.addChild = function (child) {
        if (!child || child.__isControl !== true) {
            return fail(S.EINVAL, { reason: 'not a control' });
        }
        if (this.disposed) { return fail(S.EPOWEROFF, { reason: 'parent disposed' }); }
        if (child.parent && child.parent !== this) {
            child.parent.removeChild(child);
        }
        child.parent = this;
        child.owner = this.owner;
        this.children.push(child);
        this.invalidate();
        return ok(child);
    };

    /** removeChild(child) */
    Control.prototype.removeChild = function (child) {
        var i = this.children.indexOf(child);
        if (i < 0) { return fail(S.ENOENT, { reason: 'not a child' }); }
        this.children.splice(i, 1);
        child.parent = null;
        child.owner = null;
        this.invalidate();
        return ok(true);
    };

    /** every(fn) - depth-first walk. */
    Control.prototype.each = function (fn) {
        for (var i = 0; i < this.children.length; i++) {
            var c = this.children[i];
            fn(c);
            c.each(fn);
        }
        return this;
    };

    /** findById(id) -> control | null */
    Control.prototype.findById = function (id) {
        if (this.id === id) { return this; }
        for (var i = 0; i < this.children.length; i++) {
            var found = this.children[i].findById(id);
            if (found) { return found; }
        }
        return null;
    };

    /* =================================================================
     * 3. Geometry
     * ============================================================== */

    /** setBounds(x, y, width, height) */
    Control.prototype.setBounds = function (x, y, width, height) {
        if (typeof x === 'number') { this.x = Math.round(x); }
        if (typeof y === 'number') { this.y = Math.round(y); }
        if (typeof width === 'number') { this.width = Math.max(0, Math.round(width)); }
        if (typeof height === 'number') { this.height = Math.max(0, Math.round(height)); }
        this.invalidate();
        return this;
    };

    /** absoluteRect() -> { x, y, width, height } in surface coordinates. */
    Control.prototype.absoluteRect = function () {
        var x = this.x;
        var y = this.y;
        var p = this.parent;
        while (p) {
            x += p.x;
            y += p.y;
            p = p.parent;
        }
        return { x: x, y: y, width: this.width, height: this.height };
    };

    /** hitTest(localX, localY) -> boolean  (relative to this control) */
    Control.prototype.hitTest = function (lx, ly) {
        return this.visible && this.enabled &&
            lx >= 0 && ly >= 0 && lx < this.width && ly < this.height;
    };

    /**
     * hitTestTree(lx, ly) -> topmost control under a parent-relative point.
     *   renderLast 的子控件（展开下拉的菜单栏）绘制在最上层，
     *   因此命中测试也必须优先它们 —— 与 paint 的顺序严格一致。
     */
    Control.prototype.hitTestTree = function (lx, ly) {
        /* 第一遍：只查 renderLast 的子控件 */
        for (var k = this.children.length - 1; k >= 0; k--) {
            var top = this.children[k];
            if (!top.visible || !top.renderLast) { continue; }
            var hitTop = top.hitTestTree(lx - top.x, ly - top.y);
            if (hitTop) { return hitTop; }
        }
        /* 第二遍：普通子控件，自后向前 */
        for (var i = this.children.length - 1; i >= 0; i--) {
            var c = this.children[i];
            if (!c.visible || c.renderLast) { continue; }
            var found = c.hitTestTree(lx - c.x, ly - c.y);
            if (found) { return found; }
        }
        if (this.hitTest(lx, ly)) { return this; }
        return null;
    };

    /**
     * absolutePosition() -> { x, y }
     *   本控件在窗口坐标系（根控件坐标系）中的绝对位置。
     *   绘制用的是同样的累加方式（paint 里 absX = prevOrigin + this.x），
     *   因此两者始终一致 —— 这是"点击不位移"的根本保证。
     */
    Control.prototype.absolutePosition = function () {
        var x = 0, y = 0, n = this;
        while (n && n !== n.parent) {
            x += n.x || 0;
            y += n.y || 0;
            n = n.parent;
        }
        if (n) { x += n.x || 0; y += n.y || 0; }
        return { x: x, y: y };
    };

    /**
     * toLocal(x, y) -> { x, y }
     *   把窗口坐标系里的点转换成相对于本控件的坐标。
     *   所有 onMessage 收到的 x/y 都必须是本地坐标，控件才能直接用
     *   (x < this.width) 这类判断，也才能与自己的绘制坐标对齐。
     */
    Control.prototype.toLocal = function (x, y) {
        var a = this.absolutePosition();
        return { x: x - a.x, y: y - a.y };
    };

    /**
     * dispatch(msgType, data)
     *   用窗口坐标派发一条消息给本控件，内部自动换算成本地坐标。
     *   窗口层（window.js）统一走这个入口，控件作者不必关心坐标空间。
     */
    Control.prototype.dispatch = function (type, data) {
        var d = data || {};
        var local = (typeof d.x === 'number' && typeof d.y === 'number')
            ? this.toLocal(d.x, d.y)
            : { x: 0, y: 0 };
        var payload = {};
        for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) { payload[k] = d[k]; } }
        payload.x = local.x;
        payload.y = local.y;
        /* 保留窗口坐标，供需要绝对位置的控件使用 */
        payload.rootX = d.x;
        payload.rootY = d.y;
        return this.onMessage({ type: type, data: payload });
    };

    /* =================================================================
     * 3b. Layout（自适应布局）
     * ============================================================== */

    /**
     * layout(width, height)
     *   父容器尺寸变化时调用，子控件据此重新安排自己的位置和大小。
     *   默认实现什么都不做；容器型控件（窗口客户区、分栏面板等）
     *   会覆盖它。这与 PTD 里 flex 布局 + 100% 尺寸的语义一致：
     *   父容器变了，子元素跟着变。
     */
    Control.prototype.layout = function (width, height) {
        this.width = width;
        this.height = height;
        if (typeof this.onLayout === 'function') {
            try { this.onLayout(width, height); } catch (err) {
                LOG.error('onLayout threw in ' + this.id + ': ' + (err && err.message));
            }
        }
        return this;
    };

    /**
     * relayout(width, height)
     *   递归地把新尺寸传给整棵子树。
     *   容器通过实现了 onLayout 的钩子把自己的子控件摆好；
     *   没有 onLayout 的普通控件只会被裁剪到新尺寸。
     */
    Control.prototype.relayout = function (width, height) {
        this.layout(width, height);
        for (var i = 0; i < this.children.length; i++) {
            var c = this.children[i];
            if (!c.visible || c.disposed) { continue; }
            /* 容器自己负责让子控件适配；未被 onLayout 重新定位的
             * 子控件保持原样（可能被裁剪，这是正确行为）。 */
            if (typeof c.onLayout === 'function') {
                c.relayout(c.width, c.height);
            } else {
                c.relayout(c.width, c.height);
            }
        }
        this.invalidate();
        return this;
    };

    /* =================================================================
     * 4. Focus
     * ============================================================== */

    Control.prototype.focus = function () {
        if (!this.focusable) { return fail(S.EACCES, { reason: 'control is not focusable' }); }
        if (this.focused) { return ok(true); }
        this.focused = true;
        if (this.onFocus) { this.onFocus(); }
        this.invalidate();
        this.post(MSG ? MSG.WM.FOCUS : 'focus', null);
        return ok(true);
    };

    Control.prototype.blur = function () {
        if (!this.focused) { return ok(true); }
        this.focused = false;
        if (this.onBlur) { this.onBlur(); }
        this.invalidate();
        this.post(MSG ? MSG.WM.BLUR : 'blur', null);
        return ok(true);
    };

    /** focusNext(dir=1) - tab order traversal inside the owning window. */
    Control.prototype.focusNext = function (dir) {
        var rootCtl = this.topLevel();
        if (!rootCtl) { return fail(S.ENOENT, { reason: 'no window root' }); }
        var list = [];
        rootCtl.each(function (c) { if (c.focusable && c.visible && c.enabled) { list.push(c); } });
        if (!list.length) { return fail(S.ENOENT, { reason: 'no focusable control' }); }
        var idx = list.indexOf(this);
        var step = (dir === -1) ? -1 : 1;
        var next = list[(idx + step + list.length) % list.length];
        return next.focus();
    };

    /** topLevel() - the outermost control (the window root). */
    Control.prototype.topLevel = function () {
        var n = this;
        while (n.parent) { n = n.parent; }
        return n;
    };

    /* =================================================================
     * 5. State
     * ============================================================== */

    Control.prototype.setEnabled = function (v) {
        this.enabled = v !== false;
        this.invalidate();
        return this;
    };

    Control.prototype.setVisible = function (v) {
        this.visible = v !== false;
        this.invalidate();
        return this;
    };

    Control.prototype.setText = function (t) {
        this.text = (t === null || t === undefined) ? '' : String(t);
        this.invalidate();
        return this;
    };

    Control.prototype.setTextWidth = function () { return this.text; };

    /** invalidate() - ask the owning surface to repaint. */
    Control.prototype.invalidate = function () {
        if (this.owner && typeof this.owner.invalidate === 'function') {
            this.owner.invalidate();
        }
        return this;
    };

    /* =================================================================
     * 6. Painting
     * ============================================================== */

    /**
     * paint(dc) - draws this control and then its children.
     *   The transform is applied from the control's own origin so a
     *   subclass always paints in local coordinates.
     */
    Control.prototype.paint = function (dc) {
        if (!this.visible || this.disposed) { return; }
        GDI.SaveDC(dc);

        /* 关键：SetOrigin 是"赋值"而不是"累加"，嵌套布局必须自己把
         * 父级原点算进来，否则子控件会丢失父容器的偏移。 */
        var prevOrigin = dc.origin || { x: 0, y: 0 };
        var absX = prevOrigin.x + (this.x || 0);
        var absY = prevOrigin.y + (this.y || 0);

        /* clipChildren：子控件不得画到父控件边界之外。
         * 必须在 SetOrigin 之前裁剪 —— ClipRect 内部按当前原点换算。 */
        if (this.clipChildren) {
            GDI.ClipRect(dc, absX, absY, this.width, this.height);
        }

        GDI.SetOrigin(dc, absX, absY);
        try {
            if (typeof this.onPaint === 'function') { this.onPaint(dc); }
            /* 分成两批绘制：普通子控件先画，标记了 renderLast 的（例如
             * 展开下拉的菜单栏）最后画，这样它画到边界之外的下拉菜单
             * 不会被同级控件盖住。 */
            var deferred = [];
            for (var i = 0; i < this.children.length; i++) {
                var ch = this.children[i];
                if (ch.renderLast) { deferred.push(ch); } else { ch.paint(dc); }
            }
            for (var j = 0; j < deferred.length; j++) { deferred[j].paint(dc); }
        } catch (err) {
            LOG.error('paint threw in ' + this.id + ': ' + (err && err.message));
        }
        GDI.SetOrigin(dc, prevOrigin.x, prevOrigin.y);
        GDI.RestoreDC(dc);
    };

    /* =================================================================
     * 7. Messages
     * ============================================================== */

    /** post(type, data) - dispatch to this control's onMessage. */
    Control.prototype.post = function (type, data) {
        return this.onMessage({ type: type, data: data });
    };

    /** onMessage(msg) - default handler; subclasses override. */
    Control.prototype.onMessage = function (msg) {
        if (this.disposed || !this.enabled) { return null; }

        /* -----------------------------------------------------------------
         * 通用悬停 / 按下状态机。
         *
         * 关键顺序：子类（Button 等）需要知道"抬起鼠标时我是否处于按下
         * 状态"才能判定为一次点击。因此必须先把消息交给 onControlMessage，
         * 之后再复位 pressed —— 否则子类看到的 pressed 永远是 false，
         * 就会表现为"按钮点了没反应"。
         * -------------------------------------------------------------- */
        var wasPressed = this.pressed;
        var isPressedMsg = (msg.type === 'mouseup');

        if (msg.type === 'mouseenter') { this.hover = true; this.invalidate(); }
        else if (msg.type === 'mouseleave') { this.hover = false; this.pressed = false; this.invalidate(); }
        else if (msg.type === 'mousedown') { if (this.focusable) { this.focus(); } this.pressed = true; this.invalidate(); }

        var out = null;
        if (typeof this.onControlMessage === 'function') {
            /* 抬起时先把"是否按下过"告诉子类 */
            if (isPressedMsg) { this.pressed = wasPressed; }
            out = this.onControlMessage(msg);
        }

        if (isPressedMsg) { this.pressed = false; this.invalidate(); }
        return out;
    };

    /** bubbleToParent(type, data) - let the window observe the message. */
    Control.prototype.bubbleToParent = function (type, data) {
        if (MSG && this.parent) { return MSG.bubble(this.parent, type, data); }
        return ok(null);
    };

    /* =================================================================
     * 8. Lifecycle
     * ============================================================== */

    /** dispose() - releases children, then this control. */
    Control.prototype.dispose = function () {
        if (this.disposed) { return ok(true); }
        for (var i = 0; i < this.children.length; i++) {
            try { this.children[i].dispose(); } catch (_) { /* keep going */ }
        }
        this.children = [];
        this.disposed = true;
        if (typeof this.onDispose === 'function') {
            try { this.onDispose(); } catch (err) {
                LOG.error('onDispose threw in ' + this.id + ': ' + (err && err.message));
            }
        }
        if (this.parent) {
            var p = this.parent;
            this.parent = null;
            p.removeChild(this);
        }
        return ok(true);
    };

    /** remove() - detach + dispose. */
    Control.prototype.remove = function () {
        return this.dispose();
    };

    /* =================================================================
     * 9. Static helpers used by every control
     * ============================================================== */

    /** Resolve a theme colour with a fallback (shared by every subclass). */
    Control.color = function (key, fallback) {
        if (RES) {
            var c = RES.color(key);
            if (c) { return c; }
        }
        return fallback || '#888888';
    };

    /** Resolve a font name into a GDI font object. */
    Control.font = function (name) {
        return RES ? RES.font(name) : null;
    };

    /** Draw a themed filled rect. */
    Control.fill = function (dc, x, y, w, h, themeKey, fallback) {
        return GDI.FillRect(dc, x, y, w, h, Control.color(themeKey, fallback));
    };

    /** Draw themed text. */
    Control.text = function (dc, str, x, y, themeKey, fontName, fallback) {
        if (fontName) {
            var f = Control.font(fontName);
            if (f) { GDI.SelectObject(dc, f); }
        }
        GDI.SetTextColor(dc, Control.color(themeKey || 'text', fallback));
        return GDI.DrawText(dc, str, x, y);
    };

    /** Draw themed text truncated to maxWidth. */
    Control.textTruncated = function (dc, str, x, y, maxWidth, themeKey, fontName, fallback) {
        if (fontName) {
            var f = Control.font(fontName);
            if (f) { GDI.SelectObject(dc, f); }
        }
        GDI.SetTextColor(dc, Control.color(themeKey || 'text', fallback));
        return GDI.DrawTextTruncated(dc, str, x, y, maxWidth);
    };

    Control.seq = function () { return seq; };

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Ui) { G.EznK.Ui = {}; }
    G.EznK.Ui.Control = Control;
    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.ui) { G.ezn32.ui = {}; }
    G.ezn32.ui.Control = Control;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    G.EZNT.ui.Control = Control;

    LOG.info('js/ui/control.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
