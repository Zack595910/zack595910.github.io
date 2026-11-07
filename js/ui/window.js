/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/window.js
 *   Module  : EznK.Ui.Window  (alias: ezn32.ui.Window)
 *   Layer   : Ezn32 UI
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The window object: the topmost container of Ezn32 UI. It owns the
 *   surface, the container control, the title bar, the border, the resize
 *   grips and the drag / resize interaction state machine.
 *
 *   Windows are PIXEL-DRAWN: title bar, close / minimize / maximize
 *   buttons, border and grips are painted by this module on a canvas.
 *   There is no CSS window chrome anywhere in EZNT.
 *
 *   Creation path (strictly one-way):
 *     ezn32.ui.Window.Create(spec)
 *        -> ezn32.api.user.CreateWindow(spec)      (state + process)
 *        -> ui/canvas.CreateForParent(desktop)     (surface)
 *        -> Container control + TitleBar + ClientArea
 *
 *   Interactions:
 *     drag title bar  -> move
 *     drag edge/corner-> resize (8 grips)
 *     double-click    -> maximize / restore
 *     close button    -> destroy
 *
 *   Lifecycle: destroy() releases the surface, disposes the control tree,
 *   and calls ezn32.api.user.DestroyWindow (which kills the process and
 *   closes every handle the window owns).
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.Window && G.ezn32.ui.Window.__isUiWindow === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var GDI = (G.ezn32.api && G.ezn32.api.gdi) || null;
    var USER = (G.ezn32.api && G.ezn32.api.user) || null;
    var CANVAS = (G.ezn32.ui && G.ezn32.ui.canvas) || null;
    var CONTROL = (G.ezn32.ui && G.ezn32.ui.Control) || null;
    var RES = (G.ezn32.ui && G.ezn32.ui.res) || null;
    var MSG = (G.ezn32.ui && G.ezn32.ui.msg) || null;
    var DOM = (G.EznK && G.EznK.Platform && G.EznK.Platform.DOM) || null;
    if (!CORE || !GDI || !USER || !CANVAS || !CONTROL) {
        throw new Error('[Ezn32 UI] js/ui/window.js requires core, gdi, canvas, control and user api');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('Ezn32/UI:window');

    var M = RES ? RES.METRICS : {
        titlebarHeight: 28, borderWidth: 1, buttonHeight: 26,
        padding: 8, gap: 6
    };

    /* =================================================================
     * 1. Window registry (single source of truth for live windows)
     * ============================================================== */

    var live = Object.create(null);
    var desktopHost = null;
    var seq = 0;

    /** setDesktop(hostElement) - the parent element for window canvases. */
    function setDesktop(el) {
        if (!el || el.nodeType !== 1) { return fail(S.EINVAL, { reason: 'desktop element required' }); }
        desktopHost = el;
        return ok(true);
    }

    function desktopElement() {
        if (desktopHost) { return ok(desktopHost); }
        if (!DOM) { return fail(S.ENOSYS, { reason: 'DOM gateway not loaded' }); }
        var r = DOM.byId('desktop');
        if (r.status === S.OK) { desktopHost = r.value; }
        return r;
    }

    /* =================================================================
     * 2. Container controls
     * ============================================================== */

    /** The window root control: paints the frame, hosts the client area. */
    function WindowRoot() {
        CONTROL.call(this, { width: 480, height: 360 });
        this.kind = 'window-root';
    }
    WindowRoot.prototype = Object.create(CONTROL.prototype);
    WindowRoot.prototype.constructor = WindowRoot;

    /** Title bar control: paints the caption, icon and buttons. */
    function TitleBar(win) {
        CONTROL.call(this, {
            width: win.width,
            height: M.titlebarHeight,
            x: 0,
            y: 0
        });
        this.kind = 'titlebar';
        this.win = win;
        this.buttons = [];       /* { kind:'close'|'min'|'max', x, y, w, h, hover } */
        this.dragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.buildButtons();
    }
    TitleBar.prototype = Object.create(CONTROL.prototype);
    TitleBar.prototype.constructor = TitleBar;

    TitleBar.prototype.buildButtons = function () {
        var bs = 30;
        var h = this.height;
        var x = this.width;
        this.buttons = [];
        if (this.win.closable !== false) {
            x -= bs;
            this.buttons.push({ kind: 'close', x: x, y: 0, w: bs, h: h });
        }
        if (this.win.maximizable !== false) {
            x -= bs;
            this.buttons.push({ kind: 'max', x: x, y: 0, w: bs, h: h });
        }
        if (this.win.minimizable !== false) {
            x -= bs;
            this.buttons.push({ kind: 'min', x: x, y: 0, w: bs, h: h });
        }
        return this.buttons;
    };

    TitleBar.prototype.onPaint = function (dc) {
        var t = RES ? RES.theme().value : null;
        var active = this.win.active;
        var bg = active
            ? (t ? t.titleActive : '#0078D4')
            : (t ? t.titleInactive : '#3C3C3C');
        var fg = active
            ? (t ? t.titleTextActive : '#FFFFFF')
            : (t ? t.titleTextInactive : '#B0B0B0');

        GDI.FillRect(dc, 0, 0, this.width, this.height, bg);

        /* icon */
        var iconText = this.win.icon || '[W]';
        GDI.SelectObject(dc, RES ? RES.font('title') : null);
        GDI.SetTextColor(dc, fg);
        GDI.DrawText(dc, iconText, 8, 7);

        /* caption (ASCII enforced by gdi.DrawText) */
        var iconW = GDI.MeasureText(iconText, RES ? RES.font('title') : null).value.width;
        var captionMax = this.width - iconW - 16 - this.buttons.length * 30 - 8;
        GDI.DrawTextTruncated(dc, this.win.title || '', 8 + iconW + 6, 7, Math.max(20, captionMax));

        /* buttons */
        var self = this;
        this.buttons.forEach(function (b) {
            var hover = self.hover && self.hoverButton === b.kind;
            if (b.kind === 'close' && hover) {
                GDI.FillRect(dc, b.x, b.y, b.w, b.h, '#E81123');
            } else if (hover) {
                GDI.FillRect(dc, b.x, b.y, b.w, b.h, 'rgba(255,255,255,0.18)');
            }
            GDI.SetTextColor(dc, hover && b.kind === 'close' ? '#FFFFFF' : fg);
            GDI.SetTextAlign(dc, 'center');
            /* 与 PTD.html 一致：─ 最小化、□ 最大化（还原为 ❐）、✕ 关闭。
             * 用较大的字号并垂直居中，让图标清晰可见。 */
            var glyph;
            if (b.kind === 'close') { glyph = '✕'; }
            else if (b.kind === 'min') { glyph = '─'; }
            else { glyph = self.win.maximized ? '❐' : '□'; }
            GDI.SelectObject(dc, RES.font('titleGlyph'));
            var gy = b.y + Math.round((b.h - RES.font('titleGlyph').size) / 2) - 1;
            GDI.DrawText(dc, glyph, b.x + Math.round(b.w / 2), gy, b.w);
            GDI.SetTextAlign(dc, 'left');
        });
    };

    TitleBar.prototype.onControlMessage = function (msg) {
        var self = this;
        var ev = msg.data && msg.data.event;
        if (msg.type === 'mousemove') {
            var lx = (ev ? ev.offsetX : (msg.data && msg.data.x)) || 0;
            var ly = (ev ? ev.offsetY : (msg.data && msg.data.y)) || 0;
            var hit = null;
            this.buttons.forEach(function (b) {
                if (lx >= b.x && lx < b.x + b.w && ly >= b.y && ly < b.y + b.h) { hit = b.kind; }
            });
            if (hit !== this.hoverButton) {
                this.hoverButton = hit;
                this.invalidate();
            }
            return null;
        }
        if (msg.type === 'mousedown') {
            var mx = (ev ? ev.offsetX : (msg.data && msg.data.x)) || 0;
            var my = (ev ? ev.offsetY : (msg.data && msg.data.y)) || 0;
            for (var i = 0; i < this.buttons.length; i++) {
                var b = this.buttons[i];
                if (mx >= b.x && mx < b.x + b.w && my >= b.y && my < b.y + b.h) {
                    if (b.kind === 'close') { this.win.destroy(); }
                    else if (b.kind === 'min') { this.win.minimize(); }
                    else if (b.kind === 'max') { this.win.toggleMaximize(); }
                    return 'button';
                }
            }
            /* begin drag */
            this.dragging = true;
            this.win.beginDrag(ev);
            return 'drag';
        }
        if (msg.type === 'mouseup') {
            if (this.dragging) {
                this.dragging = false;
                this.win.endDrag();
            }
            return null;
        }
        if (msg.type === 'dblclick') {
            this.win.toggleMaximize();
            return 'maximize';
        }
        void self;
        return null;
    };

    /** Client area control: the parent for user controls. */
    function ClientArea(win) {
        CONTROL.call(this, {
            x: 0,
            y: M.titlebarHeight,
            width: win.width - M.borderWidth * 2,
            height: win.height - M.titlebarHeight - M.borderWidth
        });
        this.kind = 'client';
        this.win = win;
    }
    ClientArea.prototype = Object.create(CONTROL.prototype);
    ClientArea.prototype.constructor = ClientArea;

    ClientArea.prototype.onPaint = function (dc) {
        var t = RES ? RES.theme().value : null;
        GDI.FillRect(dc, 0, 0, this.width, this.height, t ? t.windowBody : '#202020');
    };

    /* =================================================================
     * 3. Window object
     * ============================================================== */

    function CtlWindow(spec) {
        var s = spec || {};
        this.__isWindow = true;
        this.id = s.id || null;
        this.title = typeof s.title === 'string' ? s.title : 'Window';
        this.icon = typeof s.icon === 'string' ? s.icon : '[W]';
        this.width = num(s.width, 480);
        this.height = num(s.height, 360);
        this.x = num(s.x, 60);
        this.y = num(s.y, 60);
        this.closable = s.closable !== false;
        this.minimizable = s.minimizable !== false;
        this.maximizable = s.maximizable !== false;
        this.resizable = s.resizable !== false;
        this.ecosystem = s.ecosystem || 'native';
        this.owner = s.owner || 'system';
        this.className = s.className || '';

        this.active = false;
        this.minimized = false;
        this.maximized = false;
        this.visible = true;
        this.created = false;
        this.destroyed = false;

        this.preMax = null;
        this.surface = null;
        this.root = null;
        this.titleBar = null;
        this.client = null;

        this.dragging = false;
        this.dragStart = null;
        this.resizing = false;
        this.resizeGrip = null;
        this.resizeStart = null;

        this.api = null;    /* the ezn32.api.user window record */
    }

    function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v) : d; }

    /**
     * Create(spec) -> { status, value: CtlWindow }
     *   spec intentionally mirrors ezn32.api.user.CreateWindow.
     */
    function Create(spec) {
        var s = spec || {};
        var w = new CtlWindow(s);
        seq += 1;

        /* 1) window state + kernel process through Ezn32 API */
        var apiRes = USER.CreateWindow({
            id: s.id,
            title: w.title,
            width: w.width,
            height: w.height,
            x: w.x,
            y: w.y,
            closable: w.closable,
            minimizable: w.minimizable,
            maximizable: w.maximizable,
            resizable: w.resizable,
            icon: w.icon,
            className: w.className,
            owner: w.owner,
            ecosystem: w.ecosystem
        });
        if (apiRes.status !== S.OK) { return apiRes; }
        w.api = apiRes.value;
        w.id = apiRes.value.id;

        /* 2) surface on the desktop */
        var hostRes = desktopElement();
        if (hostRes.status !== S.OK) {
            USER.DestroyWindow(w.id);
            return fail(S.ENOENT, { reason: 'desktop element not available' });
        }
        var surfRes = CANVAS.CreateForParent(hostRes.value, w.width, w.height);
        if (surfRes.status !== S.OK) {
            USER.DestroyWindow(w.id);
            return surfRes;
        }
        w.surface = surfRes.value;
        w.surface.element.style.position = 'absolute';
        w.surface.element.style.left = w.x + 'px';
        w.surface.element.style.top = w.y + 'px';
        w.surface.element.style.zIndex = String(10 + Object.keys(live).length);
        /* 画布必须能接收键盘事件（编辑框输入、方向键导航都依赖于此） */
        w.surface.element.setAttribute('tabindex', '0');
        w.surface.element.style.outline = 'none';

        /* 3) control tree */
        w.root = new WindowRoot();
        /* 根控件的 owner 必须是本窗口的画布，否则整棵控件树的
         * invalidate() 都无处可去（子控件从父控件继承 owner），
         * 表现为"控件状态变了但界面不重绘"。 */
        w.root.owner = w.surface;
        w.root.kind = 'window-root';
        w.root.width = w.width;
        w.root.height = w.height;
        w.titleBar = new TitleBar(w);
        w.client = new ClientArea(w);
        w.root.addChild(w.titleBar);
        w.root.addChild(w.client);

        /* 4) painter */
        w.surface.painter = function (surface) { paintWindow(w, surface.dc); };

        /* 5) pointer routing on the canvas element */
        bindSurfaceEvents(w);

        live[w.id] = w;
        w.created = true;
        w.activate();
        w.surface.invalidate();
        return ok(w);
    }

    /* =================================================================
     * 4. Painting
     * ============================================================== */

    function paintWindow(w, dc) {
        var t = RES ? RES.theme().value : null;
        GDI.Clear(dc);
        /* frame */
        GDI.FillRect(dc, 0, 0, w.width, w.height, t ? t.windowBorder : '#1A1A1A');
        /* body */
        GDI.FillRect(dc, M.borderWidth, M.titlebarHeight - 1,
            w.width - M.borderWidth * 2, w.height - M.titlebarHeight - M.borderWidth + 1,
            t ? t.windowBody : '#202020');
        /* controls */
        w.root.paint(dc);
    }

    /* =================================================================
     * 5. Input routing
     * ============================================================== */

    var listeners = Object.create(null);

    function bindSurfaceEvents(w) {
        var el = w.surface.element;
        if (!DOM) { return; }
        listeners[w.id] = [];

        function on(evName, fn) {
            var h = DOM.on(el, evName, fn);
            if (h.status === S.OK) { listeners[w.id].push(h.value); }
        }

        on('mousedown', function (ev) {
            var p = localPoint(w, ev);
            w.activate();
            /* 右键：派发 contextmenu 给命中的控件（列表、表格、桌面等用它弹菜单） */
            if (ev.button === 2) {
                var rcTarget = w.root.hitTestTree(p.x, p.y);
                if (rcTarget) {
                    rcTarget.dispatch('contextmenu', { event: ev, x: p.x, y: p.y,
                        screenX: ev.clientX, screenY: ev.clientY });
                    w.surface.invalidate();
                }
                return;
            }
            /* 记录按下的控件，抬起时比对才能判定为一次 click */
            w._downTarget = w.root.hitTestTree(p.x, p.y);
            routeDown(w, p, ev);
            /* 若进入了拖拽/调整状态，立刻把后续 move/up 提到 window 上 */
            if (w.dragging || w.resizing) { ensureCapture(); }
        });

        /* 阻止浏览器自带右键菜单，让 canvas 内的右键菜单生效 */
        on('contextmenu', function (ev) {
            ev.preventDefault();
        });
        on('mousemove', function (ev) {
            var p = localPoint(w, ev);
            if (w.dragging) { moveDrag(w, ev); return; }
            if (w.resizing) { moveResize(w, ev); return; }
            routeMove(w, p, ev);
        });

        /* -----------------------------------------------------------------
         * 拖拽 / 调整大小期间把 move+up 提升到 window 上。
         *
         * 为什么必须这样：鼠标一旦移出窗口画布的 DOM 边界，浏览器就不再
         * 向画布派发 mousemove/mouseup，拖拽会立刻断掉 —— 这正是"调大小
         * 没反应 / 一拖就停"的根源。捕获阶段挂在 window 上才能全程跟踪。
         * -------------------------------------------------------------- */
        var dragCapture = null;
        function ensureCapture() {
            if (dragCapture) { return; }
            dragCapture = { move: null, up: null };
            dragCapture.move = function (ev) {
                if (w.dragging) { moveDrag(w, ev); }
                else if (w.resizing) { moveResize(w, ev); }
            };
            dragCapture.up = function (ev) {
                if (w.dragging) { w.endDrag(); }
                if (w.resizing) { endResize(w); }
                releaseCapture();
            };
            DOM.on('window', 'mousemove', dragCapture.move, true);
            DOM.on('window', 'mouseup', dragCapture.up, true);
            DOM.on('blur', 'blur', dragCapture.up, false);
        }
        function releaseCapture() {
            if (!dragCapture) { return; }
            DOM.off(dragCapture.move);
            DOM.off(dragCapture.up);
            dragCapture = null;
        }
        w._ensureDragCapture = ensureCapture;
        w._releaseDragCapture = releaseCapture;
        /* 双击检测：浏览器原生 dblclick 依赖两次 click 的时序，
         * 自动化输入（CDP）与触屏都可能拿不到。这里在 mouseup 里
         * 自己做基于时间与位置的判定，保证双击一定可用。 */
        var lastClickAt = 0;
        var lastClickPt = { x: -999, y: -999 };
        var DBL_MS = 500;
        var DBL_DIST = 8;

        on('mouseup', function (ev) {
            var wasDragging = !!w.dragging;
            var wasResizing = !!w.resizing;
            if (w.dragging) { w.endDrag(); }
            if (w.resizing) { endResize(w); }
            var p = localPoint(w, ev);
            w.root.dispatch('mouseup', { event: ev, x: p.x, y: p.y });
            dispatchTree(w, 'mouseup', { event: ev, x: p.x, y: p.y });

            /* 派发 click：按下与抬起在同一个控件上才算一次点击。
             * ListBox / Table / TreeView / CheckBox 都依赖 click 事件，
             * 以前 window 层从不派发它，这些控件因此"点了没反应"。 */
            if (!wasDragging && !wasResizing && w._downTarget) {
                var upTarget = w.root.hitTestTree(p.x, p.y);
                if (upTarget && upTarget === w._downTarget) {
                    var clicked = upTarget.dispatch('click', { event: ev, x: p.x, y: p.y });
                    if (clicked) { w.surface.invalidate(); }

                    /* 双击判定：同一控件、短时间内、位置接近 */
                    var now = Date.now();
                    var near = Math.abs(p.x - lastClickPt.x) <= DBL_DIST &&
                               Math.abs(p.y - lastClickPt.y) <= DBL_DIST;
                    if (near && (now - lastClickAt) <= DBL_MS && upTarget === w._lastClickTarget) {
                        var dblHandled = upTarget.dispatch('dblclick', { event: ev, x: p.x, y: p.y });
                        if (dblHandled) { w.surface.invalidate(); }
                        lastClickAt = 0;   /* 防止三击被当成第二次双击 */
                    } else {
                        lastClickAt = now;
                        lastClickPt = { x: p.x, y: p.y };
                        w._lastClickTarget = upTarget;
                    }
                }
                w._downTarget = null;
            }
        });
        on('dblclick', function (ev) {
            var p = localPoint(w, ev);
            var target = w.root.hitTestTree(p.x, p.y);
            if (target) {
                var handled = target.dispatch('dblclick', { event: ev, x: p.x, y: p.y });
                if (handled) { w.surface.invalidate(); }
            }
        });
        on('wheel', function (ev) {
            var p = localPoint(w, ev);
            dispatchTree(w, 'wheel', { event: ev, x: p.x, y: p.y, deltaY: ev.deltaY });
        });
        on('mouseleave', function () {
            /* 鼠标离开整个窗口：向整条 hover 链派发 mouseleave 并清空 */
            var chain = w._hoverChain || [];
            for (var i = 0; i < chain.length; i++) {
                chain[i].dispatch('mouseleave', {});
            }
            w._hoverChain = [];
            dispatchTree(w, 'mouseleave', {});
            w.surface.invalidate();
        });

        /* -----------------------------------------------------------------
         * 键盘事件
         *   发给窗口内**当前聚焦的控件**（Edit / ListBox / Table / TreeView /
         *   Button 都可能需要键盘）。找不到聚焦控件时发给窗口根，
         *   让窗口级快捷键（Esc 关闭菜单等）仍然生效。
         * -------------------------------------------------------------- */
        function focusedControl() {
            var found = null;
            (function walk(c) {
                if (found) { return; }
                if (c.focused && !c.disposed && c.visible) { found = c; return; }
                for (var i = 0; i < (c.children || []).length; i++) {
                    walk(c.children[i]);
                    if (found) { return; }
                }
            })(w.root);
            return found;
        }

        function keyData(ev) {
            return {
                event: ev,
                key: ev.key,
                code: ev.code,
                text: (typeof ev.key === 'string' && ev.key.length === 1) ? ev.key : '',
                ctrlKey: !!ev.ctrlKey,
                altKey: !!ev.altKey,
                shiftKey: !!ev.shiftKey,
                metaKey: !!ev.metaKey,
                repeat: !!ev.repeat
            };
        }

        on('keydown', function (ev) {
            if (w.minimized) { return; }
            var target = focusedControl() || w.root;
            var handled = target.dispatch('keydown', keyData(ev));

            /* Backspace / Tab / 方向键会滚动页面，输入框获得焦点时必须拦下 */
            if (handled && (ev.key === 'Backspace' || ev.key === 'Tab' ||
                    ev.key === 'ArrowUp' || ev.key === 'ArrowDown' ||
                    ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' ||
                    ev.key === ' ')) {
                ev.preventDefault();
            }
            if (handled) { w.surface.invalidate(); }
        });

        on('keypress', function (ev) {
            if (w.minimized) { return; }
            var target = focusedControl();
            if (!target) { return; }
            /* 可打印字符走 'char'，让 Edit 插入文本 */
            if (typeof ev.key === 'string' && ev.key.length === 1) {
                var handled = target.dispatch('char', { event: ev, text: ev.key });
                if (handled) { w.surface.invalidate(); }
            }
        });

        on('keyup', function (ev) {
            if (w.minimized) { return; }
            var target = focusedControl();
            if (target) { target.dispatch('keyup', { event: ev, key: ev.key }); }
        });
    }

    function localPoint(w, ev) {
        var rect = w.surface.element.getBoundingClientRect();
        return {
            x: Math.round(ev.clientX - rect.left),
            y: Math.round(ev.clientY - rect.top)
        };
    }

    function dispatchTree(w, type, data) {
        var target = w.root.hitTestTree(data.x, data.y);
        if (!target) { return null; }
        var out = target.dispatch(type, data);
        if (out) { w.surface.invalidate(); }
        return out;
    }

    function routeDown(w, p, ev) {
        /* resize grips first: they live on the window edge */
        if (w.resizable && !w.maximized) {
            var grip = gripAt(w, p.x, p.y);
            if (grip) {
                w.resizing = true;
                w.resizeGrip = grip;
                w.resizeStart = { x: ev.clientX, y: ev.clientY, width: w.width, height: w.height, wx: w.x, wy: w.y };
                return;
            }
        }
        var target = w.root.hitTestTree(p.x, p.y);
        if (!target) { return; }
        target.dispatch('mousedown', { event: ev, x: p.x, y: p.y });
        w.surface.invalidate();
    }

    function routeMove(w, p, ev) {
        var target = w.root.hitTestTree(p.x, p.y);

        /* -----------------------------------------------------------------
         * 鼠标进入/离开跟踪
         *   按钮的点击判定依赖 (hover && pressed)，因此必须在命中变化时
         *   显式派发 mouseenter / mouseleave，否则 hover 永远为 false，
         *   按钮就"点了没反应"。这里同时处理整条祖先链，保证嵌套控件
         *   （内容区里的按钮）也能正确获得 enter/leave。
         * -------------------------------------------------------------- */
        var prev = w._hoverChain || [];
        var chain = [];
        var walk = target;
        while (walk) { chain.unshift(walk); walk = walk.parent; }

        /* 离开：在 prev 中但不在 chain 中的控件 */
        for (var i = 0; i < prev.length; i++) {
            if (chain.indexOf(prev[i]) === -1) {
                prev[i].dispatch('mouseleave', { event: ev, x: p.x, y: p.y });
            }
        }
        /* 进入：在 chain 中但不在 prev 中的控件 */
        for (var j = 0; j < chain.length; j++) {
            if (prev.indexOf(chain[j]) === -1) {
                chain[j].dispatch('mouseenter', { event: ev, x: p.x, y: p.y });
            }
        }
        w._hoverChain = chain;

        if (target) {
            target.dispatch('mousemove', { event: ev, x: p.x, y: p.y });
            /* 光标由目标控件决定 */
            if (target.cursor) { w.surface.element.style.cursor = RES ? RES.cursor(target.cursor) : target.cursor; }
        } else {
            w.surface.element.style.cursor = 'default';
        }

        /* hover cursor for grips */
        if (w.resizable && !w.maximized) {
            var grip = gripAt(w, p.x, p.y);
            w.surface.element.style.cursor = grip ? (RES ? RES.cursor(GRIP_CURSOR[grip] || 'default') : 'default') : 'default';
        } else {
            w.surface.element.style.cursor = 'default';
        }
    }

    var GRIP_CURSOR = {
        n: 'resizeNS', s: 'resizeNS',
        e: 'resizeEW', w: 'resizeEW',
        nw: 'resizeNWSE', se: 'resizeNWSE',
        ne: 'resizeNESW', sw: 'resizeNESW'
    };

    function gripAt(w, x, y) {
        var g = 6;
        var onL = x <= g;
        var onR = x >= w.width - g;
        var onT = y <= g;
        var onB = y >= w.height - g;
        if (onT && onL) { return 'nw'; }
        if (onT && onR) { return 'ne'; }
        if (onB && onL) { return 'sw'; }
        if (onB && onR) { return 'se'; }
        if (onT) { return 'n'; }
        if (onB) { return 's'; }
        if (onL) { return 'w'; }
        if (onR) { return 'e'; }
        return null;
    }

    /* =================================================================
     * 6. Drag / resize / state
     * ============================================================== */

    CtlWindow.prototype.activate = function () {
        try { if (this.surface && this.surface.element.focus) { this.surface.element.focus({ preventScroll: true }); } } catch (_) {}
        var ids = Object.keys(live);
        ids.forEach(function (id) {
            var w = live[id];
            if (w !== this) {
                w.active = false;
                if (w.surface) { w.surface.invalidate(); }
            }
        });
        this.active = true;
        if (this.surface) {
            this.surface.element.style.zIndex = String(10 + ids.length + 1);
        }
        if (this.api) { USER.ActivateWindow(this.id); }
        if (this.surface) { this.surface.invalidate(); }
        return ok(true);
    };

    CtlWindow.prototype.beginDrag = function (ev) {
        if (this.maximized) { return; }
        this.dragging = true;
        this.dragStart = { mx: ev.clientX, my: ev.clientY, wx: this.x, wy: this.y };
    };

    CtlWindow.prototype.endDrag = function () {
        this.dragging = false;
        this.dragStart = null;
        if (this.surface) { this.surface.invalidate(); }
    };

    function moveDrag(w, ev) {
        if (!w.dragStart) { return; }
        w.x = Math.max(0, w.dragStart.wx + (ev.clientX - w.dragStart.mx));
        w.y = Math.max(0, w.dragStart.wy + (ev.clientY - w.dragStart.my));
        w.surface.element.style.left = w.x + 'px';
        w.surface.element.style.top = w.y + 'px';
        USER.MoveWindow(w.id, w.x, w.y);
    }

    function moveResize(w, ev) {
        var st = w.resizeStart;
        if (!st) { return; }
        var dx = ev.clientX - st.x;
        var dy = ev.clientY - st.y;
        var minW = 200;
        var minH = 120;
        var g = w.resizeGrip;
        var nx = st.wx, ny = st.wy, nw = st.width, nh = st.height;

        if (g.indexOf('e') >= 0) { nw = Math.max(minW, st.width + dx); }
        if (g.indexOf('s') >= 0) { nh = Math.max(minH, st.height + dy); }
        if (g.indexOf('w') >= 0) {
            nw = Math.max(minW, st.width - dx);
            nx = st.wx + (st.width - nw);
        }
        if (g.indexOf('n') >= 0) {
            nh = Math.max(minH, st.height - dy);
            ny = st.wy + (st.height - nh);
        }
        applyGeometry(w, nx, ny, nw, nh);
    }

    function endResize(w) {
        w.resizing = false;
        w.resizeGrip = null;
        w.resizeStart = null;
        USER.MoveWindow(w.id, w.x, w.y, w.width, w.height);
        if (w.surface) { w.surface.invalidate(); }
    }

    /**
     * applyGeometry(w, x, y, width, height)
     *   设置窗口几何并**正确地**让内容自适应。
     *
     *   顺序至关重要：
     *     1. 在改尺寸之前记录旧客户区尺寸（即自适应基准）；
     *     2. 改窗口、客户区尺寸；
     *     3. 用「旧尺寸 -> 新尺寸」驱动自适应布局。
     *   如果顺序反了，基准就等于新尺寸，布局不会发生任何变化 ——
     *   这正是之前"调整尺寸后内容不动 / 错位"的原因。
     */
    function applyGeometry(w, x, y, width, height) {
        /* 1) 记录旧客户区尺寸（基准） */
        var oldCW = w.client ? w.client.width : 0;
        var oldCH = w.client ? w.client.height : 0;
        w._alPrevW = w.width;
        w._alPrevH = w.height;

        /* 2) 改几何 */
        w.x = Math.max(0, Math.round(x));
        w.y = Math.max(0, Math.round(y));
        w.width = Math.round(width);
        w.height = Math.round(height);
        if (w.surface) {
            w.surface.element.style.left = w.x + 'px';
            w.surface.element.style.top = w.y + 'px';
            CANVAS.resize(w.surface, w.width, w.height);
        }
        if (w.root) {
            w.root.width = w.width;
            w.root.height = w.height;
        }
        if (w.titleBar) {
            w.titleBar.width = w.width - M.borderWidth * 2;
            w.titleBar.buildButtons();
        }
        if (w.client) {
            w.client.width = Math.max(1, w.width - M.borderWidth * 2);
            w.client.height = Math.max(1, w.height - M.titlebarHeight - M.borderWidth);
        }

        /* 3) 自适应布局：用旧尺寸 -> 新尺寸驱动 */
        var newCW = w.client ? w.client.width : 0;
        var newCH = w.client ? w.client.height : 0;
        var resized = (oldCW !== newCW || oldCH !== newCH);

        if (resized && w.client) {
            /* 3a) 智能自适应（应用未声明自己的布局时使用） */
            var AF = G.ezn32 && G.ezn32.ui && G.ezn32.ui.autofit;
            if (AF) {
                try {
                    if (!w._autofitInfo) {
                        /* 首次：以旧尺寸为基准建立锚定表 */
                        AF.capture(w, oldCW, oldCH);
                    }
                    AF.applyTo(w, oldCW, oldCH, newCW, newCH);
                } catch (err) {
                    LOG.error('autofit failed for ' + w.id + ': ' + (err && err.message));
                }
            }
            /* 3b) 应用自己声明的布局优先 */
            if (typeof w._layoutFn === 'function') {
                try { w._layoutFn(newCW, newCH); } catch (_) {}
            }
        }

        /* 4) 通知应用级钩子 */
        if (resized && typeof w.onResize === 'function') {
            try { w.onResize(newCW, newCH); }
            catch (err) { LOG.error('onResize threw in ' + w.id + ': ' + (err && err.message)); }
        }
        if (w.surface && resized) { w.surface.invalidate(); }

        var srmGeo = (G.EznK.Kernel && G.EznK.Kernel.SRM) || G.SRM;
        if (srmGeo && srmGeo.emit && resized) {
            srmGeo.emit('window:resized', { id: w.id, width: w.width, height: w.height });
        }
    }

    /**
     * setBounds(x, y, width, height)
     *   一次性设置位置与尺寸（应用需要程序化摆放窗口时使用）。
     *   这是 applyGeometry 的公开入口，保证与拖拽调整走同一条路径。
     */
    CtlWindow.prototype.setBounds = function (x, y, width, height) {
        applyGeometry(this,
            typeof x === 'number' ? x : this.x,
            typeof y === 'number' ? y : this.y,
            typeof width === 'number' ? width : this.width,
            typeof height === 'number' ? height : this.height);
        if (this.surface) { this.surface.invalidate(); }
        return ok({ x: this.x, y: this.y, width: this.width, height: this.height });
    };

    CtlWindow.prototype.setTitle = function (t) {
        if (typeof t !== 'string') { return fail(S.EINVAL, { reason: 'title must be a string' }); }
        this.title = t;
        USER.SetWindowTitle(this.id, t);
        if (this.surface) { this.surface.invalidate(); }
        return ok(true);
    };

    CtlWindow.prototype.minimize = function () {
        this.minimized = true;
        this.visible = false;
        if (this.surface) { this.surface.element.style.display = 'none'; }
        USER.MinimizeWindow(this.id);
        var s = (G.EznK.Kernel && G.EznK.Kernel.SRM) || G.SRM;
        if (s) { s.emit('window:minimized', { id: this.id }); }
        return ok(true);
    };

    CtlWindow.prototype.restore = function () {
        this.minimized = false;
        this.visible = true;
        if (this.surface) { this.surface.element.style.display = 'block'; }
        USER.RestoreWindow(this.id);
        this.activate();
        return ok(true);
    };

    CtlWindow.prototype.toggleMaximize = function () {
        if (!this.resizable) { return fail(S.EACCES, { reason: 'window is not resizable' }); }
        if (this.maximized) {
            if (this.preMax) {
                applyGeometry(this, this.preMax.x, this.preMax.y, this.preMax.width, this.preMax.height);
            }
            this.maximized = false;
            USER.UnmaximizeWindow(this.id);
        } else {
            this.preMax = { x: this.x, y: this.y, width: this.width, height: this.height };
            var host = desktopElement();
            var W = host.status === S.OK ? host.value.clientWidth : 1280;
            var H = host.status === S.OK ? host.value.clientHeight : 720;
            applyGeometry(this, 0, 0, W, H);
            this.maximized = true;
            USER.MaximizeWindow(this.id);
        }
        if (this.surface) { this.surface.invalidate(); }
        return ok(true);
    };

    /** Client area control - the parent for application controls. */
    CtlWindow.prototype.getClient = function () { return this.client; };

    /** Add a control to the client area. */
    CtlWindow.prototype.addControl = function (ctl) {
        if (!ctl || ctl.__isControl !== true) {
            return fail(S.EINVAL, { reason: 'not a control' });
        }
        this.client.addChild(ctl);
        ctl.owner = this.surface;
        return ok(ctl);
    };

    /** invalidate() - used by controls when they need a repaint. */
    CtlWindow.prototype.invalidate = function () {
        if (this.surface) { this.surface.invalidate(); }
    };

    CtlWindow.prototype.destroy = function () {
        if (this.destroyed) { return ok(true); }
        this.destroyed = true;
        delete live[this.id];
        var hs = listeners[this.id] || [];
        hs.forEach(function (h) { if (DOM) { DOM.off(h); } });
        delete listeners[this.id];
        if (this.root) { this.root.dispose(); }
        if (this.surface) { CANVAS.dispose(this.surface); }
        USER.DestroyWindow(this.id);
        var s = (G.EznK.Kernel && G.EznK.Kernel.SRM) || G.SRM;
        if (s) { s.emit('window:closed', { id: this.id }); }
        return ok(true);
    };

    /* =================================================================
     * 7. Registry queries
     * ============================================================== */

    function Get(id) {
        var w = live[id];
        return w ? ok(w) : fail(S.ENOENT, { reason: 'unknown window', id: id });
    }

    function List() {
        return ok(Object.keys(live).map(function (id) { return live[id]; }));
    }

    function Count() {
        return ok(Object.keys(live).length);
    }

    function DestroyAll() {
        Object.keys(live).forEach(function (id) { live[id].destroy(); });
        return ok(true);
    }

    /* =================================================================
     * 8. Public handle
     * ============================================================== */

    var W = {};
    W.__isUiWindow = true;
    W.version = '1.0.0';
    W.STATUS = S;

    W.Create = Create;
    W.Get = Get;
    W.List = List;
    W.Count = Count;
    W.DestroyAll = DestroyAll;
    W.setDesktop = setDesktop;
    W.METRICS = M;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Ui) { G.EznK.Ui = {}; }
    G.EznK.Ui.Window = W;
    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.ui) { G.ezn32.ui = {}; }
    G.ezn32.ui.Window = W;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    G.EZNT.ui.Window = W;

    LOG.info('js/ui/window.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
