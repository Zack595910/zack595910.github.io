/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/message.js
 *   Module  : EznK.Ui.Message  (alias: ezn32.ui.msg)
 *   Layer   : Ezn32 UI
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   ezn32.ui.msg - the window message constants and dispatch helpers.
 *   Windows apps receive WM_PAINT / WM_CLICK / ...; EZNT controls
 *   receive the same vocabulary through this module.
 *
 *     WM.CLICK / WM.MOUSE_DOWN / WM.MOUSE_UP / WM.MOUSE_MOVE
 *     WM.KEY_DOWN / WM.KEY_UP / WM.CHAR
 *     WM.PAINT / WM.SIZE / WM.MOVE / WM.FOCUS / WM.BLUR
 *     WM.CLOSE / WM.CREATE / WM.DESTROY
 *     WM.CHANGE  (edit / checkbox / listbox value change)
 *     WM.SELECT / WM.SCROLL / WM.DOUBLE_CLICK / WM.CONTEXT
 *     WM.RESIZE_BEGIN / WM.RESIZE_MOVE / WM.RESIZE_END
 *
 *   dispatch(control, type, data) calls the control's onMessage hook.
 *   bubble(control, type, data) walks up the parent chain so a window
 *   can observe messages from any child.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.msg && G.ezn32.ui.msg.__isUiMessage === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[Ezn32 UI] js/ui/message.js requires platform/core.js');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('Ezn32/UI:msg');

    var WM = Object.freeze({
        CREATE:        'create',
        DESTROY:       'destroy',
        PAINT:         'paint',
        CLICK:         'click',
        DOUBLE_CLICK:  'dblclick',
        MOUSE_DOWN:    'mousedown',
        MOUSE_UP:      'mouseup',
        MOUSE_MOVE:    'mousemove',
        MOUSE_ENTER:   'mouseenter',
        MOUSE_LEAVE:   'mouseleave',
        CONTEXT:       'contextmenu',
        WHEEL:         'wheel',
        KEY_DOWN:      'keydown',
        KEY_UP:        'keyup',
        CHAR:          'char',
        CHANGE:        'change',
        SELECT:        'select',
        SCROLL:        'scroll',
        FOCUS:         'focus',
        BLUR:          'blur',
        SIZE:          'size',
        MOVE:          'move',
        CLOSE:         'close',
        RESIZE_BEGIN:  'resizebegin',
        RESIZE_MOVE:   'resizemove',
        RESIZE_END:    'resizeend',
        ACTIVATE:      'activate',
        DEACTIVATE:    'deactivate'
    });

    /** dispatch(target, type, data) -> { status, value } */
    function dispatch(target, type, data) {
        if (!target) { return fail(S.EINVAL, { reason: 'target required' }); }
        if (typeof type !== 'string' || type.length === 0) {
            return fail(S.EINVAL, { reason: 'message type required' });
        }
        if (typeof target.onMessage !== 'function') {
            return fail(S.ENOSYS, { reason: 'target has no onMessage handler' });
        }
        try {
            var out = target.onMessage({ type: type, data: data });
            return ok(out === undefined ? null : out);
        } catch (err) {
            LOG.error('message handler threw (' + type + '): ' + (err && err.message));
            return fail(S.EFAULT, { reason: err && err.message });
        }
    }

    /** bubble(target, type, data) -> { status, value: {handled, hops} } */
    function bubble(target, type, data) {
        var hops = 0;
        var handled = false;
        var node = target;
        while (node && hops < 64) {
            if (typeof node.onMessage === 'function') {
                var r = dispatch(node, type, data);
                if (r.status === S.OK && r.value !== null && r.value !== false && r.value !== undefined) {
                    handled = true;
                }
            }
            if (node.__stopBubble === true) { break; }
            node = node.parent || null;
            hops += 1;
        }
        return ok({ handled: handled, hops: hops });
    }

    /** isMouse(type) / isKey(type) helpers for control base classes. */
    function isMouse(type) {
        return ['click', 'dblclick', 'mousedown', 'mouseup', 'mousemove',
            'mouseenter', 'mouseleave', 'contextmenu', 'wheel'].indexOf(type) !== -1;
    }
    function isKey(type) {
        return ['keydown', 'keyup', 'char'].indexOf(type) !== -1;
    }

    var M = {};
    M.__isUiMessage = true;
    M.version = '1.0.0';
    M.STATUS = S;
    M.WM = WM;
    M.dispatch = dispatch;
    M.bubble = bubble;
    M.isMouse = isMouse;
    M.isKey = isKey;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Ui) { G.EznK.Ui = {}; }
    G.EznK.Ui.Message = M;
    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.ui) { G.ezn32.ui = {}; }
    G.ezn32.ui.msg = M;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    G.EZNT.ui.msg = M;

    LOG.info('js/ui/message.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
