/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 API
 *
 *   File    : js/api/user.js
 *   Module  : EznK.Api.User  (alias: ezn32.api.user)
 *   Layer   : Ezn32 API
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   ezn32.api.user - the user32.dll equivalent: windows and messages.
 *
 *   This module is the window MANAGER side of Ezn32. It does not paint
 *   pixels (that is Ezn32 UI + GDI); it owns the window registry,
 *   activation, z-order, and the message queue.
 *
 *     CreateWindow(spec)      -> { status, value: windowInfo }
 *     DestroyWindow(wid)      -> { status, value: true }
 *     ShowWindow / HideWindow / SetWindowPos / MoveWindow
 *     ActivateWindow(wid)     -> raises z-order + focus
 *     GetActiveWindow()       -> wid | null
 *     EnumWindows()           -> [windowInfo]
 *     GetWindowRect(wid)      -> { x, y, width, height }
 *
 *   Message model (Windows-like, cooperative):
 *     PostMessage(wid, type, data)  -> queue a message
 *     SendMessage(wid, type, data)  -> dispatch to the window proc now
 *     RegisterWindowClass(name, proc)
 *
 *   Window records live in SRM (so the shell and taskbar can enumerate
 *   them) while pixel rendering belongs to Ezn32 UI. The record here is
 *   the single source of truth for window STATE; UI reads it and paints.
 *
 *   The actual DOM element is created by Ezn32 UI; this layer only knows
 *   about window identity, geometry and lifetime.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.ezn32 && G.ezn32.api && G.ezn32.api.user && G.ezn32.api.user.__isApiUser === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[Ezn32 API] js/api/user.js requires platform/core.js');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('Ezn32/API:user');

    /* Window state: single source of truth for the API layer. */
    var windows = Object.create(null);
    var zOrder = [];          /* wid list, last = topmost */
    var activeId = null;
    var seq = 0;
    var procs = Object.create(null);     /* windowClass -> proc */
    var messages = Object.create(null);  /* wid -> [msg] */

    var MAX_MESSAGES = 500;

    function sr() {
        var k = G.EznK && G.EznK.Kernel;
        return (k && k.SRM) || G.SRM || null;
    }

    /* =================================================================
     * 1. Window class registration
     * ============================================================== */

    /** RegisterWindowClass(name, proc) -> { status, value: true } */
    function RegisterWindowClass(name, proc) {
        if (typeof name !== 'string' || name.length === 0) {
            return fail(S.EINVAL, { reason: 'class name required' });
        }
        if (typeof proc !== 'function') {
            return fail(S.EINVAL, { reason: 'window proc must be a function' });
        }
        procs[name] = proc;
        return ok(true);
    }

    /* =================================================================
     * 2. Window lifecycle
     * ============================================================== */

    /**
     * CreateWindow(spec) -> { status, value: windowInfo }
     *   spec: { id?, title, width, height, x, y, resizable, minimizable,
     *           maximizable, closable, icon, className, owner, ecosystem,
     *           state }
     *   Does NOT create the pixel surface - Ezn32 UI attaches a render
     *   target to `wid` after receiving the 'window:created' event.
     */
    function CreateWindow(spec) {
        var s = spec || {};
        if (typeof s.title !== 'string') {
            return fail(S.EINVAL, { reason: 'title required' });
        }
        seq += 1;
        var wid = s.id && typeof s.id === 'string' ? s.id : ('win_' + seq);
        if (windows[wid]) {
            return fail(S.EEXIST, { reason: 'window id already exists: ' + wid });
        }
        var w = {
            id: wid,
            title: s.title,
            width: numOr(s.width, 480),
            height: numOr(s.height, 360),
            x: numOr(s.x, 60 + (seq % 8) * 28),
            y: numOr(s.y, 60 + (seq % 8) * 28),
            minWidth: numOr(s.minWidth, 160),
            minHeight: numOr(s.minHeight, 100),
            maximized: false,
            minimized: false,
            visible: true,
            resizable: s.resizable !== false,
            minimizable: s.minimizable !== false,
            maximizable: s.maximizable !== false,
            closable: s.closable !== false,
            icon: typeof s.icon === 'string' ? s.icon : '',
            className: typeof s.className === 'string' ? s.className : '',
            owner: s.owner || 'system',
            ecosystem: s.ecosystem || 'native',
            createdAt: Date.now(),
            pid: null,
            modal: s.modal === true
        };
        windows[wid] = w;
        zOrder.push(wid);
        activeId = wid;

        var srm = sr();
        if (srm) {
            w.pid = srm.registerProcess(s.title, 'window', {
                ecosystem: w.ecosystem,
                owner: w.owner,
                windowId: wid
            });
        }
        emit('window:created', { id: wid, title: w.title, ecosystem: w.ecosystem });
        return ok(publicInfo(w));
    }

    function numOr(v, dflt) {
        return (typeof v === 'number' && isFinite(v)) ? v : dflt;
    }

    function publicInfo(w) {
        return {
            id: w.id, title: w.title, width: w.width, height: w.height,
            x: w.x, y: w.y, visible: w.visible, maximized: w.maximized,
            minimized: w.minimized, resizable: w.resizable,
            minimizable: w.minimizable, maximizable: w.maximizable,
            closable: w.closable, icon: w.icon, className: w.className,
            owner: w.owner, ecosystem: w.ecosystem, pid: w.pid,
            modal: w.modal, createdAt: w.createdAt
        };
    }

    /** GetWindow(wid) -> { status, value: record }  (internal use) */
    function GetWindow(wid) {
        var w = windows[wid];
        if (!w) { return fail(S.ENOENT, { reason: 'unknown window', id: wid }); }
        return ok(w);
    }

    /** DestroyWindow(wid) -> { status, value: true } */
    function DestroyWindow(wid) {
        var w = windows[wid];
        if (!w) { return fail(S.ENOENT, { reason: 'unknown window', id: wid }); }
        delete windows[wid];
        var i = zOrder.indexOf(wid);
        if (i >= 0) { zOrder.splice(i, 1); }
        delete messages[wid];
        if (activeId === wid) {
            activeId = zOrder.length ? zOrder[zOrder.length - 1] : null;
        }
        var srm = sr();
        if (srm && w.pid) { srm.killProcess(w.pid); }
        emit('window:destroyed', { id: wid, title: w.title });
        return ok(true);
    }

    /** EnumWindows() -> { status, value: windowInfo[] }  in z-order (bottom first) */
    function EnumWindows() {
        return ok(zOrder.map(function (wid) { return publicInfo(windows[wid]); }));
    }

    /* =================================================================
     * 3. State changes
     * ============================================================== */

    /** ShowWindow(wid) / HideWindow(wid) */
    function ShowWindow(wid) {
        var r = GetWindow(wid);
        if (r.status !== S.OK) { return r; }
        r.value.visible = true;
        emit('window:shown', { id: wid });
        return ok(true);
    }

    function HideWindow(wid) {
        var r = GetWindow(wid);
        if (r.status !== S.OK) { return r; }
        r.value.visible = false;
        emit('window:hidden', { id: wid });
        return ok(true);
    }

    /** MoveWindow(wid, x, y, width?, height?) */
    function MoveWindow(wid, x, y, width, height) {
        var r = GetWindow(wid);
        if (r.status !== S.OK) { return r; }
        var w = r.value;
        if (typeof x === 'number') { w.x = Math.round(x); }
        if (typeof y === 'number') { w.y = Math.round(y); }
        if (typeof width === 'number' && width >= w.minWidth) { w.width = Math.round(width); }
        if (typeof height === 'number' && height >= w.minHeight) { w.height = Math.round(height); }
        emit('window:moved', { id: wid, x: w.x, y: w.y, width: w.width, height: w.height });
        return ok(true);
    }

    /** SetWindowTitle(wid, title) */
    function SetWindowTitle(wid, title) {
        var r = GetWindow(wid);
        if (r.status !== S.OK) { return r; }
        if (typeof title !== 'string') { return fail(S.EINVAL, { reason: 'title must be a string' }); }
        r.value.title = title;
        emit('window:title', { id: wid, title: title });
        return ok(true);
    }

    /** MinimizeWindow / RestoreWindow / MaximizeWindow */
    function MinimizeWindow(wid) {
        var r = GetWindow(wid);
        if (r.status !== S.OK) { return r; }
        if (!r.value.minimizable) { return fail(S.EACCES, { reason: 'window is not minimizable' }); }
        r.value.minimized = true;
        emit('window:minimized', { id: wid });
        return ok(true);
    }

    function RestoreWindow(wid) {
        var r = GetWindow(wid);
        if (r.status !== S.OK) { return r; }
        r.value.minimized = false;
        ActivateWindow(wid);
        emit('window:restored', { id: wid });
        return ok(true);
    }

    function MaximizeWindow(wid) {
        var r = GetWindow(wid);
        if (r.status !== S.OK) { return r; }
        if (!r.value.maximizable) { return fail(S.EACCES, { reason: 'window is not maximizable' }); }
        r.value.maximized = true;
        r.value.minimized = false;
        ActivateWindow(wid);
        emit('window:maximized', { id: wid });
        return ok(true);
    }

    function UnmaximizeWindow(wid) {
        var r = GetWindow(wid);
        if (r.status !== S.OK) { return r; }
        r.value.maximized = false;
        emit('window:unmaximized', { id: wid });
        return ok(true);
    }

    /** ActivateWindow(wid) - raise to top + make active. */
    function ActivateWindow(wid) {
        var r = GetWindow(wid);
        if (r.status !== S.OK) { return r; }
        var i = zOrder.indexOf(wid);
        if (i >= 0) { zOrder.splice(i, 1); }
        zOrder.push(wid);
        activeId = wid;
        emit('window:activated', { id: wid });
        return ok(true);
    }

    function GetActiveWindow() {
        return ok(activeId);
    }

    /** GetWindowRect(wid) */
    function GetWindowRect(wid) {
        var r = GetWindow(wid);
        if (r.status !== S.OK) { return r; }
        var w = r.value;
        return ok({ x: w.x, y: w.y, width: w.width, height: w.height });
    }

    /** GetZOrder() -> wid[] bottom -> top */
    function GetZOrder() {
        return ok(zOrder.slice(0));
    }

    /* =================================================================
     * 4. Messages
     * ============================================================== */

    /** PostMessage(wid, type, data) -> { status, value: true } */
    function PostMessage(wid, type, data) {
        if (!windows[wid]) { return fail(S.ENOENT, { reason: 'unknown window' }); }
        if (typeof type !== 'string' || type.length === 0) {
            return fail(S.EINVAL, { reason: 'message type required' });
        }
        if (!messages[wid]) { messages[wid] = []; }
        messages[wid].push({ type: type, data: data, at: Date.now() });
        if (messages[wid].length > MAX_MESSAGES) {
            messages[wid].splice(0, messages[wid].length - MAX_MESSAGES);
        }
        return ok(true);
    }

    /** SendMessage(wid, type, data) - dispatch now through the class proc. */
    function SendMessage(wid, type, data) {
        var w = windows[wid];
        if (!w) { return fail(S.ENOENT, { reason: 'unknown window' }); }
        var proc = procs[w.className];
        if (!proc) { return fail(S.ENOSYS, { reason: 'no window proc for class "' + w.className + '"' }); }
        try {
            var out = proc({ type: type, data: data, window: publicInfo(w) });
            return ok(out === undefined ? null : out);
        } catch (err) {
            return fail(S.EFAULT, { reason: 'window proc threw: ' + (err && err.message) });
        }
    }

    /** PeekMessage(wid) - pull the oldest queued message. */
    function PeekMessage(wid) {
        var q = messages[wid];
        if (!q || !q.length) { return fail(S.ENOENT, { reason: 'no pending message' }); }
        return ok(q.shift());
    }

    /** DispatchPending(wid) - deliver every queued message through the proc. */
    function DispatchPending(wid) {
        var q = messages[wid];
        if (!q || !q.length) { return ok(0); }
        var list = q.splice(0, q.length);
        var delivered = 0;
        list.forEach(function (m) {
            var r = SendMessage(wid, m.type, m.data);
            if (r.status === S.OK) { delivered += 1; }
        });
        return ok(delivered);
    }

    /* =================================================================
     * 5. Events
     * ============================================================== */

    function emit(topic, payload) {
        var s = sr();
        if (s && typeof s.emit === 'function') {
            try { s.emit(topic, payload); } catch (_) { /* ignore */ }
        }
    }

    /* =================================================================
     * 6. Public handle
     * ============================================================== */

    var U = {};
    U.__isApiUser = true;
    U.version = '1.0.0';
    U.STATUS = S;

    U.RegisterWindowClass = RegisterWindowClass;
    U.CreateWindow = CreateWindow;
    U.DestroyWindow = DestroyWindow;
    U.GetWindow = GetWindow;
    U.EnumWindows = EnumWindows;
    U.ShowWindow = ShowWindow;
    U.HideWindow = HideWindow;
    U.MoveWindow = MoveWindow;
    U.SetWindowTitle = SetWindowTitle;
    U.MinimizeWindow = MinimizeWindow;
    U.RestoreWindow = RestoreWindow;
    U.MaximizeWindow = MaximizeWindow;
    U.UnmaximizeWindow = UnmaximizeWindow;
    U.ActivateWindow = ActivateWindow;
    U.GetActiveWindow = GetActiveWindow;
    U.GetWindowRect = GetWindowRect;
    U.GetZOrder = GetZOrder;

    U.PostMessage = PostMessage;
    U.SendMessage = SendMessage;
    U.PeekMessage = PeekMessage;
    U.DispatchPending = DispatchPending;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Api) { G.EznK.Api = {}; }
    G.EznK.Api.User = U;
    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.api) { G.ezn32.api = {}; }
    G.ezn32.api.user = U;
    if (!G.EZNT.api) { G.EZNT.api = {}; }
    G.EZNT.api.user = U;

    LOG.info('js/api/user.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
