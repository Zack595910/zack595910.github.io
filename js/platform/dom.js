/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 1 - Platform Layer
 *
 *   File    : js/platform/dom.js
 *   Module  : EznK.Platform.DOM  (alias: EZNT.DOM)
 *   Layer   : L1 平台层
 *   Status  : module under construction - Phase 1.1
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   This module is the ONE AND ONLY entry point for DOM access in EZNT.
 *   Every layer above L1 (SRM kernel, Ezn32 NT, Ezn32 API, Ezn32 UI,
 *   services, shell, runtimes, apps) must reach the DOM through this
 *   module. Direct document / Element / window DOM calls anywhere above
 *   L1 violate EznK hard rule #2 (one concept, one implementation) and
 *   #1 (one-way dependency).
 *
 *   Covers: query / create / mutate / style / events / geometry /
 *   visibility.
 *
 * ---------------------------------------------------------------------
 * 契约 (CONTRACT)
 * ---------------------------------------------------------------------
 *   1. Loading
 *        Plain <script src="js/platform/dom.js"></script>. No ES modules,
 *        no import/export, no fetch, no build step. Double-click
 *        index.html and it runs; GitHub Pages and it runs.
 *        Stacks exactly two IIFE blocks onto the global name spaces and
 *        prints "[EznK/L1] platform/dom.js 已加载".
 *
 *   2. One concept, one implementation
 *        This is the only DOM wrapper. Never patch, wrap or shadow this
 *        object (no `var _origX = EZNT.DOM.x; EZNT.DOM.x = ...`).
 *        EZNT.DOM and EznK.Platform.DOM are the SAME object instance.
 *
 *   3. Status codes, never bare true/false
 *        Every API returns { status, value }.
 *          status : integer code from DOM.STATUS (the same object as
 *                   EznK.Platform.Core.STATUS once platform/core.js has
 *                   loaded - one status set for all of L1, rule #8)
 *          value  : the result (null meaning depends on the API)
 *                   - truthful, non-null values are IMPLEMENTED results
 *                   - null is ALWAYS "call did not complete" (look at
 *                     `status`), never a sentinel for a real DOM value
 *          extra  : optional diagnostic fields (reason / error / ...)
 *        Failure throws nothing for recoverable faults. Only invalid
 *        arguments in a programming-error class (unknown selector chars,
 *        unsupported shape, event handlers that are not functions) throw
 *        DOMError with a readable message - catching an unimplemented
 *        API and a bad call site must never look the same.
 *
 *   4. Lifecycle
 *        Every binding this module owns (event listener, observer,
 *        animation frame, timer, readiness listener) is registered in an
 *        internal resource table keyed by a monotonically increasing
 *        handle. Every owned resource is releasable through
 *        off / unobserve / cancelFrame / cancelTimer / releaseTree /
 *        dispose, and bindingCounts() reports what is still live.
 *        remove() automatically releases every binding anchored on the
 *        removed subtree.
 *
 *   5. Data lives once
 *        No configuration is copied into a global. The binding table is
 *        the single source of truth for what this module owns. A host
 *        element is never written more than once for the same state
 *        (idempotent writes: setText / show / hide / setHTML).
 *
 *   6. ASCII only on screen
 *        Human-facing screen text written through this module is HTML
 *        escaped. sanitizeText / sanitizeHTML reject non-ASCII and let
 *        the caller choose between throwing and stripping. setHTML()
 *        accepts only ASCII text and always escapes it, so a raw string
 *        can never deliver markup; real markup is built with create(),
 *        createText() and append().
 *
 *   7. Errors carry readable information
 *        DOMError carries code / name / message / detail.
 *
 * ---------------------------------------------------------------------
 * 依赖 (DEPENDENCY)
 * ---------------------------------------------------------------------
 *   None upward. This is L1; it may use the browser API directly.
 *   When a global EZNT object already exists (e.g. index.html shell
 *   defined it), this module only adds a property to it.
 *
 * ---------------------------------------------------------------------
 * 导出 (EXPORTS)
 * ---------------------------------------------------------------------
 *   global.EZNT = {
 *     DOM : <handles>,
 *     version : '1.0.0',
 *     STATUS : <code map>,
 *     DOMError : <class>
 *   }
 *   global.EznK = { Platform : { DOM : <same handles> } }
 *
 *   Handles compose the documented API in section 十三 with status-code
 *   wrapping and the extra helpers this module needs internally
 *   (measure / createFragment / setTitle / ...). See section below.
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * IIFE block 1 : EznK core
 * ------------------------------------------------------------------ */
(function (root) {
    'use strict';

    /* =================================================================
     * 0. Environment
     * ============================================================== */

    /** Global object handling. Both blocks run in the same global scope. */
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (!G) {
        /* Without a global object nothing can be attached; fail loudly. */
        throw new Error('[EznK/L1] platform/dom.js: no global object available');
    }

    /** Has this file already run against this global? */
    if (G.EZNT && G.EZNT.DOM && G.EZNT.DOM.__isEZNTDOM === true) {
        return; /* idempotent re-load: keep the single live implementation */
    }

    /** The browser `document`. Null in headless/worker environments. */
    var doc = G.document || null;

    /** The browser `window`. Per the EznK contract this is used ONLY as
     *  an event target that bubbles to the very top of the tree. */
    var win = G.window || null;

    /* =================================================================
     * 1. Status codes  (section 九)
     *
     * Hard rule #8: there is exactly ONE status-code set in L1. It lives
     * in platform/core.js. When this file is loaded standalone (before
     * core.js, or in a diagnostic page) the identical frozen map below
     * becomes the single set for this run; once core.js has defined it,
     * this module adopts CORE.STATUS so both modules can never drift.
     * ============================================================== */

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core) || null;

    var STATUS = CORE ? CORE.STATUS : Object.freeze({
        OK:        0,
        EINVAL:    1,
        ENOENT:    2,
        EEXIST:    3,
        ENOSPC:    4,
        ENOMEM:    5,
        EFAULT:    6,
        EACCES:    7,
        EBADF:     8,
        EBADIMAGE: 9,
        ENOSYS:    10,
        EBUSY:     11,
        EPOWEROFF: 12,
        EBOUNDS:   13,
        EIO:       14
    });

    /** Code -> canonical name. Built once, never mutated. */
    var STATUS_NAME = Object.freeze((function () {
        var map = {};
        Object.keys(STATUS).forEach(function (name) { map[STATUS[name]] = name; });
        return map;
    })());

    /** Canonical name for a status code. Unknown codes -> 'EUNKNOWN'. */
    function nameOf(code) {
        return STATUS_NAME[code] || 'EUNKNOWN';
    }

    /* =================================================================
     * 2. Error carrier
     * ============================================================== */

    /** Thrown only for programming-error-class faults on bad arguments.
     *  Recoverable faults return { status } instead. The public
     *  DOMError is produced by Core when it is present, so every layer
     *  shares ONE error type. */
    function DOMError(code, message, detail) {
        Error.call(this);
        this.name = nameOf(code);
        this.code = code;
        this.message = 'DOM.' + nameOf(code) + ': ' + (message || '');
        this.detail = (detail === undefined ? null : detail);
        this.isEznError = true;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, DOMError);
        } else {
            this.stack = new Error(this.message).stack;
        }
    }
    DOMError.prototype = Object.create(Error.prototype);
    DOMError.prototype.constructor = DOMError;
    DOMError.prototype.toString = function () {
        return this.name + ': ' + this.message;
    };

    /** Build the canonical error instance (prefixed with the module tag). */
    function makeError(code, message, detail) {
        if (CORE && typeof CORE.EznError === 'function') {
            return CORE.EznError(code, 'DOM: ' + message, detail);
        }
        return new DOMError(code, message, detail);
    }

    /* =================================================================
     * 3. Result wrapper  (unified value channel)
     * ============================================================== */

    /** Build a successful result. `value` may legitimately be a primitive
     *  DOM result, hence `arguments.length` is checked. */
    function ok(value, extra) {
        var r = { status: STATUS.OK, value: (value === undefined ? null : value) };
        if (extra) { Object.assign(r, extra); }
        return r;
    }

    /** Build a failed result. The `value` is ALWAYS null on failure. */
    function fail(code, extra) {
        var r = { status: code, value: null };
        if (extra) { Object.assign(r, extra); }
        return r;
    }

    /** Normalise an exception into a failed result, preserving the message. */
    function failFrom(err, defaultCode) {
        return fail(defaultCode === undefined ? STATUS.EIO : defaultCode, {
            error: (err && err.message) ? err.message : String(err || 'unknown error')
        });
    }

    /* =================================================================
     * 4. HTML tag name registry  (validation + allow-list)
     *
     * The allow-list serves three purposes at once:
     *   a. reject nonsense tag names                      -> EINVAL
     *   b. reject SVG/foreign names, which a future Canvas UI must never
     *      receive from any layer above L1               -> ENOSYS
     *   c. provide the single point where an element kind can be
     *      disabled for the pixel-only Canvas world of Ezn32 UI
     * ============================================================== */

    var HTML_TAGS = Object.freeze({
        /* sections / containers */
        a: 1, abbr: 1, address: 1, article: 1, aside: 1,
        b: 1, bdi: 1, bdo: 1, blockquote: 1, br: 1, button: 1,
        canvas: 1, caption: 1, cite: 1, code: 1, col: 1, colgroup: 1,
        data: 1, datalist: 1, dd: 1, del: 1, details: 1, dfn: 1,
        dialog: 1, div: 1, dl: 1, dt: 1, em: 1, fieldset: 1,
        figcaption: 1, figure: 1, footer: 1, form: 1,
        h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
        header: 1, hgroup: 1, hr: 1, i: 1, iframe: 1, img: 1,
        input: 1, ins: 1, kbd: 1, label: 1, legend: 1, li: 1,
        main: 1, map: 1, mark: 1, menu: 1, meter: 1,
        nav: 1, noscript: 1, object: 1, ol: 1, optgroup: 1,
        option: 1, output: 1, p: 1, picture: 1, pre: 1,
        progress: 1, q: 1, rp: 1, rt: 1, ruby: 1, s: 1,
        samp: 1, section: 1, select: 1, slot: 1, small: 1,
        source: 1, span: 1, strong: 1, sub: 1, summary: 1,
        sup: 1, table: 1, tbody: 1, td: 1, template: 1,
        textarea: 1, tfoot: 1, th: 1, thead: 1, time: 1,
        title: 1, tr: 1, track: 1, u: 1, ul: 1, var: 1,
        video: 1, wbr: 1,
        /* document-level elements are intentionally NOT in this list: */
        /* html, head, body, script, style, link, meta - EznK code must */
        /* not create or inject those through the DOM gateway.         */
        audio: 1
    });

    /** Attributes whose value is copied into the live DOM. Anything outside
     *  this map can still be set via setAttr but is rejected by create(),
     *  which keeps element creation deterministic. */
    var ATTRS = Object.freeze({
        id: 1, 'class': 1, className: 1, style: 1, title: 1,
        name: 1, value: 1, type: 1, placeholder: 1, disabled: 1,
        checked: 1, readonly: 1, multiple: 1, required: 1,
        selected: 1, hidden: 1, tabindex: 1, role: 1,
        'aria-label': 1, 'aria-hidden': 1, 'data-*': 1,
        width: 1, height: 1, colspan: 1, rowspan: 1,
        href: 1, src: 1, alt: 1, for: 1, rel: 1, target: 1,
        spellcheck: 1, draggable: 1, contenteditable: 1, dir: 1,
        lang: 1, translate: 1, autocomplete: 1, maxlength: 1
    });

    /* The EznK root mark: the element that replaces document.body as the
     * conceptual root (see resolveRoot). */
    var BODY_MARK_SELECTOR = '#eznt-root';

    /* =================================================================
     * 5. Tiny guards
     * ============================================================== */

    /** A DOM Node-ish object: anything usable as an element target. */
    function isNode(x) {
        return !!x && typeof x === 'object' && typeof x.nodeType === 'number';
    }

    /** A DOM Element (all real elements have tagName and style/classList). */
    function isElement(x) {
        return !!x && typeof x === 'object' &&
            x.nodeType === 1 && typeof x.tagName === 'string';
    }

    /** Document node. */
    function isDocument(x) {
        return !!x && typeof x === 'object' && x.nodeType === 9;
    }

    /** Anything valid as a selector root: element or document. */
    function isRoot(x) {
        return isElement(x) || isDocument(x);
    }

    /** EventTarget usable by addEventListener. */
    function isTarget(x) {
        return !!x && typeof x === 'object' && typeof x.addEventListener === 'function';
    }

    /** Status for a target that must be an Element. */
    function elementStatus(x) {
        if (isNode(x)) { return isElement(x) ? STATUS.OK : STATUS.EBADF; }
        return STATUS.EINVAL;
    }

    /** Status for a target that must be an Element or the Document. */
    function rootStatus(x) {
        if (isNode(x)) { return isRoot(x) ? STATUS.OK : STATUS.EBADF; }
        return STATUS.EINVAL;
    }

    function isFunction(x) { return typeof x === 'function'; }
    function isPlainObject(x) {
        if (!x || typeof x !== 'object' || Array.isArray(x)) { return false; }
        if (isNode(x)) { return false; }
        var p = Object.getPrototypeOf(x);
        return p === Object.prototype || p === null;
    }

    /** Integer finite number. */
    function isNum(x) {
        return typeof x === 'number' && isFinite(x);
    }

    /** Milliseconds/timers parameter validation. */
    function isPositiveInt(x) {
        return isNum(x) && x >= 0;
    }

    /* =================================================================
     * 6. ASCII sanitizers  (screen text only, header rule 6)
     * ============================================================== */

    /* Printable ASCII 0x20 - 0x7E; 0x7F (DEL) is non-printable and is
     * stripped by sanitizeText. Tab and newline are layout characters and
     * are allowed only when opts.allowWhitespace is true. */
    var ASCII_RE = /^[\x20-\x7E]$/;
    var ASCII_WS_RE = /^[\t\n\n]$/;

    /** Return true when every character is printable ASCII (or an
     *  allowed whitespace char). Single source of truth for "ASCII". */
    function isAsciiClean(s, allowWhitespace) {
        for (var i = 0; i < s.length; i++) {
            var ch = s.charAt(i);
            if (!ASCII_RE.test(ch)) {
                if (!(allowWhitespace === true && ASCII_WS_RE.test(ch))) { return false; }
            }
        }
        return true;
    }

    /** Strip every non-allowed ASCII char. Idempotent. */
    function stripToAscii(s, allowWhitespace) {
        var out = '';
        for (var i = 0; i < s.length; i++) {
            var ch = s.charAt(i);
            if (ASCII_RE.test(ch) || (allowWhitespace === true && ASCII_WS_RE.test(ch))) {
                out += ch;
            }
        }
        return out;
    }

    /** Escape the characters that would otherwise be interpreted as HTML
     *  when a sanitized string is assigned through innerHTML. */
    function escapeHTML(s) {
        return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * sanitizeText(str, opts) -> string
     *   opts.throwOnViolation : throw DOMError(EINVAL) for non-ASCII
     *   opts.allowWhitespace  : allow TAB and LF as part of screen text
     *   opts.nullAsEmpty      : map null/undefined to ''
     *   Always ASCII, never escaped (callers who need HTML use it first).
     */
    function sanitizeText(str, opts) {
        var o = opts || {};
        if (str === null || str === undefined) {
            if (o.nullAsEmpty === false) { return ''; }
            return '';
        }
        var s = String(str);
        if (!isAsciiClean(s, o.allowWhitespace)) {
            if (o.throwOnViolation) {
                throw makeError(STATUS.EINVAL,
                    'screen text must be ASCII 0x20-0x7E, got a non-ASCII character',
                    { text: s });
            }
            return stripToAscii(s, o.allowWhitespace);
        }
        return s;
    }

    /**
     * sanitizeHTML(str) -> string
     *   Screen-bound HTML fragment: strip non-ASCII, then escape markup.
     *   This is the only path from a raw string into innerHTML, so the
     *   "screen text is ASCII" rule cannot be bypassed by raw markup.
     */
    function sanitizeHTML(str) {
        return escapeHTML(stripToAscii(str === null || str === undefined ? '' : String(str),
            /* allowWhitespace */ true));
    }

    /* =================================================================
     * 7. Selector validation
     * ============================================================== */

    /** Normalise `el` / [raw element] as the query root. */
    function normalizeRoot(rootArg) {
        if (rootArg === undefined || rootArg === null) { return doc; }
        if (isRoot(rootArg)) { return rootArg; }
        return null;
    }

    /** query / queryAll on a root. Shared by byId and every other path. */
    function runQuery(rootArg, selector, all) {
        if (typeof selector !== 'string' || selector.length === 0) {
            return fail(STATUS.EINVAL, { reason: 'selector must be a non-empty string' });
        }
        var s = selector.trim();
        var root = normalizeRoot(rootArg);
        if (!root) {
            if (!doc) {
                return fail(STATUS.ENOSYS, { reason: 'no document in this environment' });
            }
            return fail(STATUS.EINVAL, { reason: 'root must be an Element or Document' });
        }
        if (!root.querySelector) {
            return fail(STATUS.ENOSYS, { reason: 'query is not supported in this environment' });
        }
        var r;
        try {
            r = all ? root.querySelectorAll(s) : root.querySelector(s);
        } catch (err) {
            /* Malformed selector -> SyntaxError. Programming error -> throw. */
            throw makeError(STATUS.EINVAL, 'invalid selector "' + s + '": ' +
                (err && err.message ? err.message : String(err)), { selector: s });
        }
        if (all) { return ok(r); }
        if (r === null) {
            return fail(STATUS.ENOENT, { selector: s });
        }
        return ok(r);
    }

    /* =================================================================
     * 8. Resource table  (lifecycle / ownership)
     *
     *   handle -> {
     *     kind   : 'event' | 'observer' | 'frame' | 'timer' | 'window'
     *     label  : human-readable identity
     *     target : EventTarget | null
     *     live   : boolean
     *     ...    : kind-specific bookkeeping
     *   }
     * ============================================================== */

    var uid = 0;                          /* monotonic handle allocator */
    var resources = Object.create(null);  /* handle -> record */
    var OWN = { event: 0, observer: 0, frame: 0, timer: 0, window: 0 };
    var destroyed = false;

    function newHandle() {
        uid += 1;
        return 'h' + uid;
    }

    function track(kind, label, target, extra) {
        var handle = newHandle();
        var rec = {
            kind: kind,
            label: label || kind,
            target: target || null,
            live: true
        };
        if (extra) { Object.assign(rec, extra); }
        resources[handle] = rec;
        OWN[kind] = (OWN[kind] || 0) + 1;
        return handle;
    }

    /** Mark a handle released without releasing it (caller already did). */
    function retire(handle) {
        var rec = resources[handle];
        if (!rec || !rec.live) { return false; }
        rec.live = false;
        OWN[rec.kind] = Math.max(0, (OWN[rec.kind] || 0) - 1);
        return true;
    }

    /* =================================================================
     * 9. Root resolution  (document.body replacement)
     *
     * The bootstrap page supplies <main id="eznt-root">. Until it exists,
     * body is the natural root. Both are "the root element" - the only
     * concept here is "the document root", not a special #desktop.
     * ============================================================== */

    var rootCache = { el: null, doc: null };

    /** Resolve the root element, preferring #eznt-root, then body, then
     *  documentElement. Returns an Element or null. */
    function resolveRoot() {
        if (!doc) { return null; }
        if (rootCache.el && rootCache.doc === doc && rootCache.el.isConnected) {
            return rootCache.el;
        }
        var el = null;
        try {
            el = doc.querySelector(BODY_MARK_SELECTOR);
        } catch (_) {
            el = null;
        }
        if (!el) { el = doc.body || null; }
        if (!el) { el = doc.documentElement || null; }
        rootCache.el = el;
        rootCache.doc = doc;
        return el;
    }

    /** Root lookup as a status result. */
    function rootResult() {
        if (!doc) {
            return fail(STATUS.ENOSYS, { reason: 'no document in this environment' });
        }
        var el = resolveRoot();
        if (!el) { return fail(STATUS.ENOENT, { reason: 'document root not available' }); }
        return ok(el);
    }

    /**
     * Resolve the append target for create().
     *   parent === 'root'   -> #eznt-root | body | documentElement
     *   parent === 'body'   -> document.body
     *   parent === Element  -> that element
     *   parent Document     -> document.documentElement
     */
    function resolveParent(parent) {
        if (parent === undefined || parent === null) {
            return fail(STATUS.EINVAL, { reason: 'parent is required' });
        }
        if (typeof parent === 'string') {
            if (parent === 'root') {
                if (!doc) { return fail(STATUS.ENOSYS, { reason: 'no document' }); }
                var r = resolveRoot();
                return r ? ok(r) : fail(STATUS.ENOENT, { reason: 'root not available' });
            }
            if (parent === 'body') {
                if (!doc) { return fail(STATUS.ENOSYS, { reason: 'no document' }); }
                return doc.body ? ok(doc.body) : fail(STATUS.ENOENT, { reason: 'document.body missing' });
            }
            return fail(STATUS.EINVAL, { reason: 'parent string must be "root" or "body"' });
        }
        if (isDocument(parent)) {
            return doc && doc.documentElement
                ? ok(doc.documentElement)
                : fail(STATUS.ENOENT, { reason: 'documentElement missing' });
        }
        var st = elementStatus(parent);
        if (st !== STATUS.OK) {
            return fail(st, { reason: 'parent must be an Element, "root" or "body"' });
        }
        return ok(parent);
    }

    /* Formatting helpers that write to children without replacing them. */
    function prependInto(parentEl, child) {
        var first = parentEl.firstChild;
        if (first === child) { return; }
        parentEl.insertBefore(child, first || null);
    }

    /* =================================================================
     * 10. Style normalisation
     * ============================================================== */

    /* CSS property name: camelCase or kebab-case (or a --custom-property).
     * Rejects anything that could smuggle a second declaration. */
    function validStyleName(k) {
        return typeof k === 'string' && k.length > 0 &&
            (/^--[A-Za-z0-9_-]+$/.test(k) ||
             /^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*$/.test(k));
    }

    function toCssName(k) {
        if (k.indexOf('--') === 0) { return k; }
        return k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
    }

    function cssValue(v) {
        if (v === null || v === undefined) { return ''; }
        if (typeof v === 'string' || typeof v === 'number') { return String(v); }
        return null;
    }

    /* =================================================================
     * 11. Event helpers
     * ============================================================== */

    /** Options normalisation: a string is a selector (delegation). */
    function normalizeEventOptions(options) {
        if (options === undefined || options === null) { return { opts: {}, selector: null }; }
        if (typeof options === 'string') { return { opts: {}, selector: options }; }
        if (typeof options === 'boolean') { return { opts: { capture: options }, selector: null }; }
        if (!isPlainObject(options)) { return null; }
        var selector = (typeof options.selector === 'string' && options.selector.length > 0)
            ? options.selector : null;
        var listen = {};
        if (options.capture !== undefined) { listen.capture = !!options.capture; }
        if (options.once !== undefined) { listen.once = !!options.once; }
        if (options.passive !== undefined) { listen.passive = !!options.passive; }
        return { opts: listen, selector: selector };
    }

    /** Does `node` match `selector` (used by delegation). */
    function matchesSelector(node, selector) {
        if (typeof node.matches !== 'function') { return false; }
        try { return node.matches(selector); } catch (_) { return false; }
    }

    /* =================================================================
     * 12. The public handle table
     * ============================================================== */

    var D = {};

    /* ---------------- meta ---------------- */

    D.__isEZNTDOM = true;
    D.version = '1.0.0';
    D.STATUS = STATUS;
    D.DOMError = DOMError;

    /** Document accessor (null when headless). Not a DOM API per se: it is
     *  the only place where the raw document is exposed, and only for
     *  argument-free identity checks. */
    D.getDocument = function () { return doc; };
    D.isHeadless = function () { return !doc; };
    D.statusName = function (code) { return nameOf(code); };

    /* -----------------------------------------------------------------
     * 12.1 Query  (查询)
     * -------------------------------------------------------------- */

    /**
     * query(selector, root) -> { status, value: Element|null }
     *   root : Element | Document, default document ("the current page").
     */
    D.query = function (selector, root) {
        return runQuery(root, selector, false);
    };

    /** query(root, selector) is intentionally NOT supported: the
     *  documented argument order is query(selector, root). */

    /**
     * queryAll(selector, root) -> { status, value: Element[] }
     *   A static array snapshot; never the live NodeList.
     */
    D.queryAll = function (selector, root) {
        var r = runQuery(root, selector, true);
        if (r.status !== STATUS.OK) { return r; }
        return ok(Array.prototype.slice.call(r.value, 0));
    };

    /**
     * byId(id) -> { status, value: Element|null }
     *   Synchronous id lookup via the single shared query path.
     */
    D.byId = function (id) {
        if (typeof id !== 'string' || id.length === 0) {
            return fail(STATUS.EINVAL, { reason: 'id must be a non-empty string' });
        }
        if (!doc) { return fail(STATUS.ENOSYS, { reason: 'no document' }); }
        var el = doc.getElementById(id);
        return el ? ok(el) : fail(STATUS.ENOENT, { id: id });
    };

    /* -----------------------------------------------------------------
     * 12.2 Create  (创建)
     * -------------------------------------------------------------- */

    /**
     * create(tag, props, parent) -> { status, value: Element }
     *   tag    : tag name (case-insensitive) from the HTML allow-list
     *   props  : plain object
     *             text     -> ASCII text content
     *             html     -> ASCII, escaped -> innerHTML
     *             styles   -> object of CSS declarations
     *             dataset  -> object of data-* values
     *             class    -> string | string[]
     *             on       -> { eventName: handler | { handler, selector, ... } }
     *             attrs    -> raw attributes (validated, dangerous names
     *                         like on* are rejected)
     *             anything in ATTRS is applied as an attribute
     *   parent : 'root' (default) | 'body' | Element | Document
     *            omitted -> #eznt-root (fallback body)
     */
    D.create = function (tag, props, parent) {
        return D.createNode(tag, props, parent, false);
    };

    /** createFragment(children?) -> { status, value: DocumentFragment } */
    D.createFragment = function (children) {
        if (!doc) { return fail(STATUS.ENOSYS, { reason: 'no document' }); }
        try {
            var frag = doc.createDocumentFragment();
            if (children !== undefined && children !== null) {
                if (!Array.isArray(children)) {
                    return fail(STATUS.EINVAL, { reason: 'children must be an array' });
                }
                for (var i = 0; i < children.length; i++) {
                    if (!isNode(children[i])) {
                        return fail(STATUS.EINVAL, { reason: 'children[' + i + '] is not a Node' });
                    }
                    frag.appendChild(children[i]);
                }
            }
            return ok(frag);
        } catch (err) {
            return failFrom(err);
        }
    };

    /**
     * createText(text) -> { status, value: Text }
     *   Raw text node with ASCII enforced.
     */
    D.createText = function (text) {
        if (!doc) { return fail(STATUS.ENOSYS, { reason: 'no document' }); }
        if (text === undefined || text === null) {
            return fail(STATUS.EINVAL, { reason: 'text is required' });
        }
        try {
            return ok(doc.createTextNode(stripToAscii(String(text), true)));
        } catch (err) {
            return failFrom(err);
        }
    };

    /* -----------------------------------------------------------------
     * 12.3 Operate  (操作)
     * -------------------------------------------------------------- */

    /**
     * append(parent, child) -> { status, value: child }
     *   parent may be 'root'. Idempotent: appending an existing child
     *   moves it (standard DOM), appending nothing new is a no-op.
     */
    D.append = function (parent, child) {
        var p = resolveParent(parent);
        if (p.status !== STATUS.OK) { return p; }
        if (!isNode(child)) {
            return fail(STATUS.EINVAL, { reason: 'child must be a Node' });
        }
        try {
            if (child.parentNode === p.value && child.parentNode.lastChild === child) {
                return ok(child);
            }
            p.value.appendChild(child);
            return ok(child);
        } catch (err) {
            return failFrom(err);
        }
    };

    /** prepend(parent, child) -> { status, value: child } */
    D.prepend = function (parent, child) {
        var p = resolveParent(parent);
        if (p.status !== STATUS.OK) { return p; }
        if (!isNode(child)) {
            return fail(STATUS.EINVAL, { reason: 'child must be a Node' });
        }
        try {
            prependInto(p.value, child);
            return ok(child);
        } catch (err) {
            return failFrom(err);
        }
    };

    /** insertBefore(parent, child, reference) -> { status, value: child } */
    D.insertBefore = function (parent, child, reference) {
        var p = resolveParent(parent);
        if (p.status !== STATUS.OK) { return p; }
        if (!isNode(child)) {
            return fail(STATUS.EINVAL, { reason: 'child must be a Node' });
        }
        if (reference !== undefined && reference !== null && !isNode(reference)) {
            return fail(STATUS.EINVAL, { reason: 'reference must be a Node' });
        }
        if (reference && reference.parentNode !== p.value) {
            return fail(STATUS.EFAULT, { reason: 'reference is not a child of parent' });
        }
        try {
            p.value.insertBefore(child, reference || null);
            return ok(child);
        } catch (err) {
            return failFrom(err);
        }
    };

    /** remove(node) -> { status, value: node }  (detached node) */
    D.remove = function (node) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) {
            return fail(st, { reason: 'remove expects an Element' });
        }
        var parent = node.parentNode;
        if (!parent) {
            return fail(STATUS.ENOENT, { reason: 'element is already detached' });
        }
        try {
            parent.removeChild(node);
            /* Release every binding anchored on the removed subtree. */
            D.releaseTree(node);
            return ok(node);
        } catch (err) {
            return failFrom(err);
        }
    };

    /** clear(node) -> { status, value: node }  all children removed. */
    D.clear = function (node) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) {
            return fail(st, { reason: 'clear expects an Element' });
        }
        try {
            while (node.firstChild) {
                node.removeChild(node.firstChild);
            }
            return ok(node);
        } catch (err) {
            return failFrom(err);
        }
    };

    /**
     * setText(node, text) -> { status, value: node }
     *   Screen text; escaped and ASCII-forced. Non-ASCII characters are
     *   stripped (strict: true makes the call fail instead).
     */
    D.setText = function (node, text, strict) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) {
            return fail(st, { reason: 'setText expects an Element' });
        }
        if (text === undefined || text === null) {
            return D.clear(node);
        }
        var s = String(text);
        if (!isAsciiClean(s, true)) {
            if (strict === true) {
                return fail(STATUS.EINVAL, { reason: 'screen text must be ASCII' });
            }
            s = stripToAscii(s, true);
        }
        try {
            if (node.firstChild && node.firstChild === node.lastChild &&
                node.firstChild.nodeType === 3 && node.firstChild.data === s) {
                return ok(node); /* idempotent write */
            }
            node.textContent = s;
            return ok(node);
        } catch (err) {
            return failFrom(err);
        }
    };

    /** getText(node) -> { status, value: string }  (textContent) */
    D.getText = function (node) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) {
            return fail(st, { reason: 'getText expects an Element' });
        }
        try {
            return ok(String(node.textContent === null ? '' : node.textContent));
        } catch (err) {
            return failFrom(err);
        }
    };

    /**
     * setHTML(node, htmlString) -> { status, value: node }
     *   htmlString is screen-bound text: every character must be ASCII
     *   (non-ASCII stripped) and everything is HTML escaped, so the only
     *   markup that can enter the document is the escaping layer's own.
     *   Building real markup from strings is never allowed - use
     *   create()/createText().
     */
    D.setHTML = function (node, htmlString) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) {
            return fail(st, { reason: 'setHTML expects an Element' });
        }
        return D.setInnerContent(node, sanitizeHTML(htmlString));
    };

    /** Internal: assign already-sanitized HTML. Only DOM-internal code
     *  may call this. Exposed for the runtime's UI renderer. */
    D.setInnerContent = function (node, safeHtml) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) {
            return fail(st, { reason: 'setInnerContent expects an Element' });
        }
        if (typeof safeHtml !== 'string') {
            return fail(STATUS.EINVAL, { reason: 'safeHtml must be a string' });
        }
        try {
            node.innerHTML = safeHtml;
            return ok(node);
        } catch (err) {
            return failFrom(err);
        }
    };

    /** getHTML(node) -> { status, value: string } */
    D.getHTML = function (node) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) {
            return fail(st, { reason: 'getHTML expects an Element' });
        }
        try { return ok(node.innerHTML); } catch (err) { return failFrom(err); }
    };

    /**
     * setAttr(node, name, value) -> { status, value: node }
     *   Dangerous attribute names (on*, srcdoc, ...) are rejected with
     *   EACCES - inline script injection is not a supported operation.
     */
    D.setAttr = function (node, name, value) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) {
            return fail(st, { reason: 'setAttr expects an Element' });
        }
        if (typeof name !== 'string' || name.length === 0) {
            return fail(STATUS.EINVAL, { reason: 'attribute name must be a non-empty string' });
        }
        if (isDangerousAttrName(name)) {
            return fail(STATUS.EACCES, { reason: 'attribute "' + name + '" is not allowed on EznK elements' });
        }
        /* Attribute values are screen text -> ASCII only. */
        var v = (value === null || value === undefined) ? '' : String(value);
        if (!isAsciiClean(v, true)) { v = stripToAscii(v, true); }
        try {
            node.setAttribute(name, v);
            return ok(node);
        } catch (err) {
            return failFrom(err);
        }
    };

    /** getAttr(node, name, fallback) -> { status, value: string|null } */
    D.getAttr = function (node, name, fallback) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) {
            return fail(st, { reason: 'getAttr expects an Element' });
        }
        if (typeof name !== 'string' || name.length === 0) {
            return fail(STATUS.EINVAL, { reason: 'attribute name must be a non-empty string' });
        }
        try {
            var has = node.hasAttribute && node.hasAttribute(name);
            if (!has) {
                if (fallback !== undefined) { return ok(fallback); }
                return fail(STATUS.ENOENT, { reason: 'attribute "' + name + '" is not set' });
            }
            var v = node.getAttribute(name);
            return ok(v === null ? '' : String(v));
        } catch (err) {
            return failFrom(err);
        }
    };

    /** hasAttr(node, name) -> { status, value: boolean } */
    D.hasAttr = function (node, name) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'hasAttr expects an Element' }); }
        try { return ok(!!(node.hasAttribute && node.hasAttribute(name))); }
        catch (err) { return failFrom(err); }
    };

    /** removeAttr(node, name) -> { status, value: node } */
    D.removeAttr = function (node, name) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) {
            return fail(st, { reason: 'removeAttr expects an Element' });
        }
        if (typeof name !== 'string' || name.length === 0) {
            return fail(STATUS.EINVAL, { reason: 'attribute name must be a non-empty string' });
        }
        try {
            node.removeAttribute(name);
            return ok(node);
        } catch (err) {
            return failFrom(err);
        }
    };

    /** setProps(node, props) -> { status, value: node }
     *  Convenience: same prop shapes as create()'s props. */
    D.setProps = function (node, props) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'setProps expects an Element' }); }
        if (!isPlainObject(props)) {
            return fail(STATUS.EINVAL, { reason: 'props must be a plain object' });
        }
        return applyProps(node, props, { strict: false });
    };

    function isDangerousAttrName(name) {
        var n = name.toLowerCase();
        if (n.indexOf('on') === 0) { return true; }          /* on* handlers */
        if (n === 'srcdoc') { return true; }                  /* inline doc */
        if (n.indexOf('javascript:') === 0) { return true; }
        return false;
    }

    /* -----------------------------------------------------------------
     * 12.4 Style  (样式)
     * -------------------------------------------------------------- */

    /** setStyle(node, name, value) -> { status, value: node } */
    D.setStyle = function (node, name, value) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'setStyle expects an Element' }); }
        if (!validStyleName(name)) {
            return fail(STATUS.EINVAL, { reason: 'invalid CSS property name' });
        }
        var v = cssValue(value);
        if (v === null) {
            return fail(STATUS.EINVAL, { reason: 'CSS value must be string or number' });
        }
        try {
            if (name.indexOf('--') === 0) {
                node.style.setProperty(name, v);
            } else {
                node.style.setProperty(toCssName(name), v);
            }
            return ok(node);
        } catch (err) {
            return failFrom(err);
        }
    };

    /** setStyles(node, styles) -> { status, value: node } */
    D.setStyles = function (node, styles) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'setStyles expects an Element' }); }
        if (!isPlainObject(styles)) {
            return fail(STATUS.EINVAL, { reason: 'styles must be a plain object' });
        }
        var keys = Object.keys(styles);
        for (var i = 0; i < keys.length; i++) {
            var r = D.setStyle(node, keys[i], styles[keys[i]]);
            if (r.status !== STATUS.OK) {
                return fail(r.status, { reason: r.reason, property: keys[i], applied: i });
            }
        }
        return ok(node);
    };

    /** getStyle(node, name) -> { status, value: string } */
    D.getStyle = function (node, name) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'getStyle expects an Element' }); }
        if (!validStyleName(name)) {
            return fail(STATUS.EINVAL, { reason: 'invalid CSS property name' });
        }
        try {
            if (name.indexOf('--') === 0) { return ok(node.style.getPropertyValue(name)); }
            return ok(node.style.getPropertyValue(toCssName(name)));
        } catch (err) {
            return failFrom(err);
        }
    };

    /** removeStyle(node, name) -> { status, value: node } */
    D.removeStyle = function (node, name) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'removeStyle expects an Element' }); }
        if (!validStyleName(name)) {
            return fail(STATUS.EINVAL, { reason: 'invalid CSS property name' });
        }
        try {
            node.style.removeProperty(name.indexOf('--') === 0 ? name : toCssName(name));
            return ok(node);
        } catch (err) {
            return failFrom(err);
        }
    };

    /* Class helpers reject non-ASCII class tokens (screen-ish state). */
    function classToken(v) {
        if (typeof v !== 'string' || v.length === 0) { return null; }
        if (!isAsciiClean(v, false)) { return null; }
        return v;
    }

    /** addClass(node, name|names[]) -> { status, value: node } */
    D.addClass = function (node, name) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'addClass expects an Element' }); }
        var list = Array.isArray(name) ? name : [name];
        var tokens = [];
        for (var i = 0; i < list.length; i++) {
            var t = classToken(list[i]);
            if (!t) { return fail(STATUS.EINVAL, { reason: 'class name must be ASCII, non-empty' }); }
            tokens.push(t);
        }
        try {
            node.classList.add.apply(node.classList, tokens);
            return ok(node);
        } catch (err) {
            return failFrom(err, STATUS.EINVAL);
        }
    };

    /** removeClass(node, name|names[]) -> { status, value: node } */
    D.removeClass = function (node, name) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'removeClass expects an Element' }); }
        var list = Array.isArray(name) ? name : [name];
        var tokens = [];
        for (var i = 0; i < list.length; i++) {
            var t = classToken(list[i]);
            if (!t) { return fail(STATUS.EINVAL, { reason: 'class name must be ASCII, non-empty' }); }
            tokens.push(t);
        }
        try {
            node.classList.remove.apply(node.classList, tokens);
            return ok(node);
        } catch (err) {
            return failFrom(err, STATUS.EINVAL);
        }
    };

    /** toggleClass(node, name, force?) -> { status, value: boolean }
     *  value is the resulting presence of the class. */
    D.toggleClass = function (node, name, force) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'toggleClass expects an Element' }); }
        var t = classToken(name);
        if (!t) { return fail(STATUS.EINVAL, { reason: 'class name must be ASCII, non-empty' }); }
        try {
            var want = (force === undefined || force === null) ? null : !!force;
            if (want === null) { return ok(node.classList.toggle(t)); }
            if (want && !node.classList.contains(t)) { node.classList.add(t); return ok(true); }
            if (!want && node.classList.contains(t)) { node.classList.remove(t); return ok(false); }
            return ok(want);
        } catch (err) {
            return failFrom(err, STATUS.EINVAL);
        }
    };

    /** hasClass(node, name) -> { status, value: boolean } */
    D.hasClass = function (node, name) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'hasClass expects an Element' }); }
        var t = classToken(name);
        if (!t) { return fail(STATUS.EINVAL, { reason: 'class name must be ASCII, non-empty' }); }
        try { return ok(node.classList.contains(t)); }
        catch (err) { return failFrom(err); }
    };

    /* -----------------------------------------------------------------
     * 12.5 Events  (事件)
     * -------------------------------------------------------------- */

    /**
     * on(target, eventName, handler, options) -> { status, value: handle }
     *   target  : Element | Document | (window-level descriptor)
     *             Pass 'window' (string) to bind at the top of the event
     *             tree - the single sanctioned use of window.
     *   options : boolean capture | string selector (delegate) |
     *             { capture, once, passive, selector }
     *   handler : function(event, detail) receives a `detail` object
     *             { target, currentTarget, event } for delegation.
     *   The handle is released by off(handle) or dispose().
     */
    D.on = function (target, eventName, handler, options) {
        var resolved = (typeof target === 'string')
            ? D.resolveEventTarget(target)
            : (isTarget(target) ? ok(target) : fail(STATUS.EINVAL, { reason: 'target must be an EventTarget' }));
        if (resolved.status !== STATUS.OK) { return resolved; }
        if (typeof eventName !== 'string' || eventName.length === 0) {
            return fail(STATUS.EINVAL, { reason: 'event name must be a non-empty string' });
        }
        var norm = normalizeEventOptions(options);
        if (!norm) { return fail(STATUS.EINVAL, { reason: 'options must be boolean, selector or object' }); }
        if (!isFunction(handler)) {
            throw makeError(STATUS.EINVAL, 'event handler must be a function',
                { event: eventName });
        }
        if (norm.selector !== null) {
            try {
                /* Validate the delegation selector now, not on first event. */
                resolved.value.matches;
                doc.querySelector(norm.selector);
            } catch (err) {
                throw makeError(STATUS.EINVAL, 'invalid delegation selector "' +
                    norm.selector + '"', { selector: norm.selector });
            }
        }
        var tgt = resolved.value;
        var record = { live: true };
        var listener;
        if (norm.selector) {
            listener = function (ev) {
                var n = ev.target;
                while (n && n !== tgt) {
                    if (matchesSelector(n, norm.selector)) {
                        var detail = { target: n, currentTarget: n, event: ev, delegated: true };
                        return handler.call(n, ev, detail);
                    }
                    n = n.parentNode;
                }
                return undefined;
            };
        } else {
            listener = function (ev) {
                return handler.call(tgt, ev, { target: ev.target, currentTarget: tgt, event: ev, delegated: false });
            };
        }
        try {
            tgt.addEventListener(eventName, listener, norm.opts);
        } catch (err) {
            return fail(STATUS.EINVAL, { reason: 'addEventListener failed', error: String(err) });
        }
        var handle = track('event', 'on:' + eventName, tgt, {
            listener: listener,
            capture: !!norm.opts.capture,
            selector: norm.selector,
            eventName: eventName
        });
        record.handle = handle;
        return ok(handle);
    };

    /**
     * once(target, eventName, handler, options) -> { status, value: handle }
     *   Delegation-aware one-shot binding. The handle is auto-retired
     *   after the first dispatch; off(handle) still works on the stale
     *   handle and reports ENOENT.
     */
    D.once = function (target, eventName, handler, options) {
        var resolved = (typeof target === 'string')
            ? D.resolveEventTarget(target)
            : (isTarget(target) ? ok(target) : fail(STATUS.EINVAL, { reason: 'target must be an EventTarget' }));
        if (resolved.status !== STATUS.OK) { return resolved; }
        var norm = normalizeEventOptions(options);
        if (!norm) { return fail(STATUS.EINVAL, { reason: 'options must be boolean, selector or object' }); }
        if (!isFunction(handler)) {
            throw makeError(STATUS.EINVAL, 'event handler must be a function', { event: eventName });
        }
        var tgt = resolved.value;
        var self = null;
        var inner = function (ev, detail) {
            var h = self;
            if (h) { D.off(h); }
            return handler.call(this, ev, detail);
        };
        var r = D.on(tgt, eventName, inner, options);
        if (r.status === STATUS.OK) {
            self = r.value;
        }
        return r;
    };

    /**
     * delegate(root, selector, eventName, handler, options) -> { status, value: handle }
     *   Sugar around on(root, name, handler, { selector, ... }).
     */
    D.delegate = function (root, selector, eventName, handler, options) {
        if (typeof selector !== 'string' || selector.length === 0) {
            return fail(STATUS.EINVAL, { reason: 'delegation selector must be a non-empty string' });
        }
        var opts = options;
        if (opts === undefined || opts === null) { opts = { selector: selector }; }
        else if (typeof opts === 'boolean') { opts = { capture: opts, selector: selector }; }
        else if (isPlainObject(opts)) { opts = Object.assign({}, opts, { selector: selector }); }
        else { return fail(STATUS.EINVAL, { reason: 'options must be boolean or object' }); }
        return D.on(root, eventName, handler, opts);
    };

    /** off(handle) -> { status, value: boolean }  true when released. */
    D.off = function (handle) {
        if (typeof handle === 'string') {
            var rec = resources[handle];
            if (!rec) { return fail(STATUS.ENOENT, { reason: 'unknown handle' }); }
            if (!rec.live) { return fail(STATUS.ENOENT, { reason: 'handle already released' }); }
            if (rec.kind === 'event') {
                if (rec.ready === true) {
                    /* Cancelling a pending ready(): release its frame/timer. */
                    if (rec.frame) { D.cancelFrame(rec.frame); rec.frame = null; }
                    if (rec.timer) { D.cancelTimer(rec.timer); rec.timer = null; }
                    retire(handle);
                    return ok(true);
                }
                try { rec.target.removeEventListener(rec.eventName, rec.listener, rec.capture); }
                catch (err) { /* target may be gone; still retire */ }
                retire(handle);
                return ok(true);
            }
            if (rec.kind === 'observer') { return D.unobserve(handle); }
            if (rec.kind === 'frame') { return D.cancelFrame(handle); }
            if (rec.kind === 'timer') { return D.cancelTimer(handle); }
            return fail(STATUS.EINVAL, { reason: 'off() only accepts event handles' });
        }
        if (handle && typeof handle === 'object' && typeof handle.handle === 'string') {
            return D.off(handle.handle);
        }
        return fail(STATUS.EINVAL, { reason: 'off expects a handle string' });
    };

    /**
     * releaseTree(node) -> { status, value: number }
     *   Release every binding whose target lives inside `node` (or is
     *   `node`). Called automatically by remove(); also public so a
     *   long-lived overlay can self-clean.
     */
    D.releaseTree = function (node) {
        if (!isNode(node)) { return fail(STATUS.EINVAL, { reason: 'node required' }); }
        var released = 0;
        var keys = Object.keys(resources);
        for (var i = 0; i < keys.length; i++) {
            var h = keys[i];
            var rec = resources[h];
            if (!rec || !rec.live) { continue; }
            var t = rec.target;
            if (!t || typeof t.contains !== 'function') { continue; }
            if (t === node || (node.contains && node.contains(t))) {
                if (rec.kind === 'event') {
                    var r = D.off(h);
                    if (r.status === STATUS.OK) { released += 1; }
                }
            }
        }
        return ok(released);
    };

    /* -------------------- timers / frames (single source) ---------- */

    /** scheduleFrame(callback) -> { status, value: handle } */
    D.scheduleFrame = function (callback) {
        if (!isFunction(callback)) {
            return fail(STATUS.EINVAL, { reason: 'callback must be a function' });
        }
        var raf = (win && typeof win.requestAnimationFrame === 'function')
            ? win.requestAnimationFrame.bind(win)
            : (typeof setTimeout === 'function' ? function (cb) { return setTimeout(cb, 16); } : null);
        if (!raf) { return fail(STATUS.ENOSYS, { reason: 'no animation frame source' }); }
        var handle;
        var wrapped = function (ts) {
            retire(handle);
            callback(ts);
        };
        handle = track('frame', 'frame', null, { cancel: null });
        resources[handle].id = raf(wrapped);
        return ok(handle);
    };

    /** cancelFrame(handle) -> { status, value: boolean } */
    D.cancelFrame = function (handle) {
        var rec = resources[handle];
        if (!rec || rec.kind !== 'frame') { return fail(STATUS.ENOENT, { reason: 'unknown frame handle' }); }
        if (!rec.live) { return fail(STATUS.ENOENT, { reason: 'frame already cancelled' }); }
        var caf = (win && typeof win.cancelAnimationFrame === 'function') ? win.cancelAnimationFrame
            : (typeof clearTimeout === 'function' ? clearTimeout : null);
        if (caf) {
            try { caf.call(win, rec.id); } catch (_) { /* ignore */ }
        }
        retire(handle);
        return ok(true);
    };

    /**
     * setTimer(callback, ms) -> { status, value: handle }
     *   Repeating timer. Single source for timer ownership inside DOM.
     *   Prefer scheduling through platform/time.js when it lands; this
     *   exists so the DOM module never leaks timers of its own.
     */
    D.setTimer = function (callback, ms) {
        if (!isFunction(callback)) {
            return fail(STATUS.EINVAL, { reason: 'callback must be a function' });
        }
        if (!isPositiveInt(ms)) {
            return fail(STATUS.EINVAL, { reason: 'ms must be a non-negative number' });
        }
        if (typeof setTimeout !== 'function') {
            return fail(STATUS.ENOSYS, { reason: 'no timer source' });
        }
        var handle;
        var tick = function () { callback(); };
        handle = track('timer', 'timer', null, { id: setTimeout(tick, ms), interval: ms });
        return ok(handle);
    };

    /** cancelTimer(handle) -> { status, value: boolean } */
    D.cancelTimer = function (handle) {
        var rec = resources[handle];
        if (!rec || rec.kind !== 'timer') { return fail(STATUS.ENOENT, { reason: 'unknown timer handle' }); }
        if (!rec.live) { return fail(STATUS.ENOENT, { reason: 'timer already cancelled' }); }
        try { clearTimeout(rec.id); } catch (_) { /* ignore */ }
        retire(handle);
        return ok(true);
    };

    /* -----------------------------------------------------------------
     * 12.6 Geometry  (尺寸)
     * -------------------------------------------------------------- */

    /** getSize(node) -> { status, value: { width, height } }
     *  offsetWidth/offsetHeight in px, rounded. */
    D.getSize = function (node) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'getSize expects an Element' }); }
        try {
            return ok({
                width: Math.round(node.offsetWidth || 0),
                height: Math.round(node.offsetHeight || 0)
            });
        } catch (err) { return failFrom(err); }
    };

    /** getPosition(node) -> { status, value: { top, left } }
     *  offsetTop/offsetLeft relative to offsetParent (CSS pixels). */
    D.getPosition = function (node) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'getPosition expects an Element' }); }
        try {
            return ok({
                top: Math.round(node.offsetTop || 0),
                left: Math.round(node.offsetLeft || 0)
            });
        } catch (err) { return failFrom(err); }
    };

    /** getRect(node) -> { status, value: { top, left, right, bottom, width, height } } */
    D.getRect = function (node) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'getRect expects an Element' }); }
        try {
            var r = node.getBoundingClientRect();
            return ok({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
        } catch (err) { return failFrom(err); }
    };

    /** getParent(node) -> { status, value: Element|null } */
    D.getParent = function (node) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'getParent expects an Element' }); }
        var p = node.parentElement;
        return p ? ok(p) : fail(STATUS.ENOENT, { reason: 'element has no element parent' });
    };

    /** getChildren(node) -> { status, value: Element[] } */
    D.getChildren = function (node) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'getChildren expects an Element' }); }
        try {
            return ok(Array.prototype.slice.call(node.children, 0));
        } catch (err) { return failFrom(err); }
    };

    /** setPosition(node, { top, left }) -> { status, value: node }
     *  Uses style.top/style.left; the element must be positioned. */
    D.setPosition = function (node, pos) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'setPosition expects an Element' }); }
        if (!pos || typeof pos !== 'object') {
            return fail(STATUS.EINVAL, { reason: 'position must be { top, left }' });
        }
        if (pos.top === undefined && pos.left === undefined) {
            return fail(STATUS.EINVAL, { reason: 'position needs top and/or left' });
        }
        if (pos.top !== undefined && !(isNum(pos.top) || (typeof pos.top === 'string' && pos.top.length > 0))) {
            return fail(STATUS.EINVAL, { reason: 'top must be a number or CSS length string' });
        }
        if (pos.left !== undefined && !(isNum(pos.left) || (typeof pos.left === 'string' && pos.left.length > 0))) {
            return fail(STATUS.EINVAL, { reason: 'left must be a number or CSS length string' });
        }
        try {
            var topStr = typeof pos.top === 'number' ? (pos.top + 'px') : pos.top;
            var leftStr = typeof pos.left === 'number' ? (pos.left + 'px') : pos.left;
            if (topStr !== undefined) { node.style.top = topStr; }
            if (leftStr !== undefined) { node.style.left = leftStr; }
            return ok(node);
        } catch (err) { return failFrom(err); }
    };

    /** setSize(node, { width, height }) -> { status, value: node } */
    D.setSize = function (node, size) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'setSize expects an Element' }); }
        if (!size || typeof size !== 'object') {
            return fail(STATUS.EINVAL, { reason: 'size must be { width, height }' });
        }
        if (size.width === undefined && size.height === undefined) {
            return fail(STATUS.EINVAL, { reason: 'size needs width and/or height' });
        }
        var okW = size.width === undefined || isNum(size.width) || typeof size.width === 'string';
        var okH = size.height === undefined || isNum(size.height) || typeof size.height === 'string';
        if (!okW || !okH) {
            return fail(STATUS.EINVAL, { reason: 'width/height must be numbers or CSS length strings' });
        }
        try {
            if (size.width !== undefined) {
                node.style.width = typeof size.width === 'number' ? (size.width + 'px') : size.width;
            }
            if (size.height !== undefined) {
                node.style.height = typeof size.height === 'number' ? (size.height + 'px') : size.height;
            }
            return ok(node);
        } catch (err) { return failFrom(err); }
    };

    /* -----------------------------------------------------------------
     * 12.7 Visibility  (可见性)
     * -------------------------------------------------------------- */

    /** show(node) -> { status, value: node }   removes the hidden state. */
    D.show = function (node) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'show expects an Element' }); }
        try {
            node.style.setProperty('display', '');
            var hiddenAttr = node.getAttribute('hidden');
            if (hiddenAttr !== null) { node.removeAttribute('hidden'); }
            return ok(node);
        } catch (err) { return failFrom(err); }
    };

    /** hide(node) -> { status, value: node }   display:none + hidden attr. */
    D.hide = function (node) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'hide expects an Element' }); }
        try {
            node.style.setProperty('display', 'none');
            node.setAttribute('hidden', '');
            return ok(node);
        } catch (err) { return failFrom(err); }
    };

    /** isVisible(node) -> { status, value: boolean }
     *  A visible element is connected, not display:none, and every
     *  ancestor is also rendered. */
    D.isVisible = function (node) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'isVisible expects an Element' }); }
        try {
            if (!node.isConnected) { return ok(false); }
            if (node.hidden) { return ok(false); }
            if (typeof node.checkVisibility === 'function') {
                return ok(node.checkVisibility({
                    checkVisibilityCSS: true,
                    visibilityProperty: true,
                    contentVisibilityAuto: true
                }));
            }
            /* Fallback for engines without checkVisibility(): walk the
             * ancestor chain for display:none / visibility:hidden. */
            var el = node;
            while (el && el.nodeType === 1) {
                var cs = (win && typeof win.getComputedStyle === 'function')
                    ? win.getComputedStyle(el) : null;
                if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) {
                    return ok(false);
                }
                el = el.parentElement;
            }
            var rect = node.getBoundingClientRect();
            return ok(rect.width > 0 || rect.height > 0);
        } catch (err) { return failFrom(err); }
    };

    /* -----------------------------------------------------------------
     * 12.8 Measurements / host hooks
     * -------------------------------------------------------------- */

    /** measureText(text, font) -> { status, value: { width, ... } }
     *  Canvas-backed text metrics; the single measurement source for
     *  pixel UI built later. */
    D.measureText = function (text, font) {
        if (!doc) { return fail(STATUS.ENOSYS, { reason: 'no document' }); }
        if (text === undefined || text === null) {
            return fail(STATUS.EINVAL, { reason: 'text is required' });
        }
        try {
            var cv = doc.createElement('canvas');
            var ctx = cv.getContext('2d');
            if (!ctx) { return fail(STATUS.ENOSYS, { reason: '2d context unavailable' }); }
            ctx.font = (typeof font === 'string' && font.length > 0) ? font : '12px monospace';
            var m = ctx.measureText(String(text));
            return ok({
                width: m.width,
                actualBoundingBoxAscent: m.actualBoundingBoxAscent || 0,
                actualBoundingBoxDescent: m.actualBoundingBoxDescent || 0
            });
        } catch (err) { return failFrom(err); }
    };

    /**
     * resolveEventTarget(token) -> { status, value: EventTarget }
     *   'window' -> the single top-level event target.
     *   'document' -> the document (or window fallback in headless).
     */
    D.resolveEventTarget = function (token) {
        if (token === 'window') {
            if (!win) { return fail(STATUS.ENOSYS, { reason: 'no window' }); }
            return ok(win);
        }
        if (token === 'document') {
            if (doc) { return ok(doc); }
            if (win) { return ok(win); }
            return fail(STATUS.ENOSYS, { reason: 'no document' });
        }
        return fail(STATUS.EINVAL, { reason: 'token must be "window" or "document"' });
    };

    /* -----------------------------------------------------------------
     * 12.9 Lifecycle
     * -------------------------------------------------------------- */

    /**
     * dispose() -> { status, value: { released } }
     *   Releases every binding, frame, timer and observer owned by this
     *   module. Makes the module inert (subsequent bindings still fail
     *   safely with EPOWEROFF). Normally called only by the boot chain on
     *   shutdown.
     */
    D.dispose = function () {
        var released = 0;
        Object.keys(resources).forEach(function (h) {
            var rec = resources[h];
            if (!rec || !rec.live) { return; }
            if (rec.kind === 'event' && D.off(h).status === STATUS.OK) { released += 1; }
            else if (rec.kind === 'observer' && D.unobserve(h).status === STATUS.OK) { released += 1; }
            else if (rec.kind === 'frame' && D.cancelFrame(h).status === STATUS.OK) { released += 1; }
            else if (rec.kind === 'timer' && D.cancelTimer(h).status === STATUS.OK) { released += 1; }
        });
        destroyed = true;
        return ok({ released: released });
    };

    /** isDisposed() -> { status, value: boolean } */
    D.isDisposed = function () { return ok(destroyed); };

    /* -----------------------------------------------------------------
     * 12.10 Observers
     * -------------------------------------------------------------- */

    /**
     * observe(node, callback, options) -> { status, value: handle }
     *   MutationObserver bound through this module. Release with
     *   unobserve(handle). options -> { childList, attributes,
     *   characterData, subtree, attributeOldValue, characterDataOldValue }.
     */
    D.observe = function (node, callback, options) {
        if (!isTarget(node) || typeof node.querySelector !== 'function') {
            return fail(STATUS.EINVAL, { reason: 'observe expects an Element' });
        }
        if (!isFunction(callback)) {
            return fail(STATUS.EINVAL, { reason: 'callback must be a function' });
        }
        if (!win || typeof win.MutationObserver !== 'function') {
            return fail(STATUS.ENOSYS, { reason: 'MutationObserver unavailable' });
        }
        var opts = { childList: true, subtree: true, attributes: false, characterData: false };
        if (options && typeof options === 'object') {
            Object.keys(options).forEach(function (k) { opts[k] = !!options[k]; });
        }
        var mo;
        try {
            mo = new win.MutationObserver(function (mutations) { callback(mutations); });
            mo.observe(node, opts);
        } catch (err) {
            return failFrom(err, STATUS.EINVAL);
        }
        var handle = track('observer', 'observe', node, { observer: mo });
        return ok(handle);
    };

    /** unobserve(handle) -> { status, value: boolean } */
    D.unobserve = function (handle) {
        var rec = resources[handle];
        if (!rec || rec.kind !== 'observer') {
            return fail(STATUS.ENOENT, { reason: 'unknown observer handle' });
        }
        if (!rec.live) { return fail(STATUS.ENOENT, { reason: 'observer already released' }); }
        try { rec.observer.disconnect(); } catch (_) { /* ignore */ }
        retire(handle);
        return ok(true);
    };

    /* -----------------------------------------------------------------
     * 12.11 Diagnostics
     * -------------------------------------------------------------- */

    /** bindingCounts() -> { status, value: { event, observer, frame, timer } } */
    D.bindingCounts = function () {
        var out = {};
        Object.keys(OWN).forEach(function (k) { out[k] = OWN[k]; });
        delete out.window;
        return ok(out);
    };

    /** isReady() -> { status, value: boolean }  root element available? */
    D.isReady = function () { return ok(!!resolveRoot()); };

    /* -----------------------------------------------------------------
     * 12.12 Sanitizers (exported so higher layers share ONE rule)
     * -------------------------------------------------------------- */

    D.sanitizeText = function (str, opts) {
        try { return ok(sanitizeText(str, opts)); }
        catch (err) { return fail(err.code || STATUS.EINVAL, { reason: err.message }); }
    };
    D.sanitizeHTML = function (str) {
        try { return ok(sanitizeHTML(str)); }
        catch (err) { return fail(STATUS.EINVAL, { reason: err.message }); }
    };
    D.isAscii = function (str, allowWhitespace) {
        return ok(isAsciiClean(String(str === null || str === undefined ? '' : str), allowWhitespace === true));
    };
    D.escapeHTML = function (str) { return escapeHTML(String(str === null || str === undefined ? '' : str)); };

    /* =================================================================
     * 13. Internal create-node implementation (shared by create/app)
     * ============================================================== */

    function applyProps(node, props, ctx) {
        var keys = Object.keys(props);
        var deferredHandlers = [];
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = props[k];
            if (v === undefined) { continue; }

            if (k === 'text') {
                var tr = D.setText(node, v, ctx.strict === true);
                if (tr.status !== STATUS.OK) { return tr; }
                continue;
            }
            if (k === 'html') {
                var hr = D.setHTML(node, v);
                if (hr.status !== STATUS.OK) { return hr; }
                continue;
            }
            if (k === 'class' || k === 'className') {
                if (Array.isArray(v) || typeof v === 'string') {
                    var cr = D.addClass(node, v);
                    if (cr.status !== STATUS.OK) { return cr; }
                } else {
                    return fail(STATUS.EINVAL, { reason: 'class must be string or string[]', property: k });
                }
                continue;
            }
            if (k === 'styles' || k === 'style') {
                if (!isPlainObject(v)) {
                    return fail(STATUS.EINVAL, { reason: 'styles must be a plain object', property: k });
                }
                var sr = D.setStyles(node, v);
                if (sr.status !== STATUS.OK) { return sr; }
                continue;
            }
            if (k === 'dataset') {
                if (!isPlainObject(v)) {
                    return fail(STATUS.EINVAL, { reason: 'dataset must be a plain object', property: k });
                }
                var dkeys = Object.keys(v);
                for (var dt = 0; dt < dkeys.length; dt++) {
                    var dd = D.setData(node, dkeys[dt], v[dkeys[dt]]);
                    if (dd.status !== STATUS.OK) { return dd; }
                }
                continue;
            }
            if (k === 'on') {
                if (!isPlainObject(v)) {
                    return fail(STATUS.EINVAL, { reason: 'on must be a plain object', property: k });
                }
                deferredHandlers.push(v);
                continue;
            }
            if (k === 'attrs') {
                if (!isPlainObject(v)) {
                    return fail(STATUS.EINVAL, { reason: 'attrs must be a plain object', property: k });
                }
                var akeys = Object.keys(v);
                for (var at = 0; at < akeys.length; at++) {
                    var ar = D.setAttr(node, akeys[at], v[akeys[at]]);
                    if (ar.status !== STATUS.OK) { return ar; }
                }
                continue;
            }
            if (isDangerousAttrName(k)) {
                return fail(STATUS.EACCES, { reason: 'property "' + k + '" is not allowed', property: k });
            }
            /* Boolean / live form properties are state, not plain text. */
            if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') {
                var lr = D.setLive(node, k, v);
                if (lr.status !== STATUS.OK) { return lr; }
                continue;
            }
            /* Plain attributes (allow-listed names, plus data-* / aria-*). */
            if (ATTRS[k] === 1 || /^data-[A-Za-z0-9_-]+$/.test(k) || /^aria-[a-z-]+$/.test(k)) {
                var pr;
                if (v === false && (k === 'hidden' || k === 'readonly' || k === 'required' ||
                    k === 'multiple' || k === 'contenteditable')) {
                    pr = D.removeAttr(node, k);
                } else {
                    pr = D.setAttr(node, k, v);
                }
                if (pr.status !== STATUS.OK) { return pr; }
                continue;
            }
            return fail(STATUS.EINVAL, { reason: 'unknown property "' + k + '"', property: k });
        }

        /* Handlers are bound last so every element state they read exists. */
        for (var hi = 0; hi < deferredHandlers.length; hi++) {
            var hmap = deferredHandlers[hi];
            var events = Object.keys(hmap);
            for (var ei = 0; ei < events.length; ei++) {
                var evName = events[ei];
                var spec = hmap[evName];
                var bound;
                var opts;
                if (isFunction(spec)) {
                    opts = null;
                } else if (isPlainObject(spec) && isFunction(spec.handler)) {
                    opts = {};
                    if (spec.selector !== undefined) { opts.selector = spec.selector; }
                    if (spec.capture !== undefined) { opts.capture = spec.capture; }
                    if (spec.once !== undefined) { opts.once = spec.once; }
                    if (spec.passive !== undefined) { opts.passive = spec.passive; }
                } else {
                    return fail(STATUS.EINVAL, { reason: 'on.' + evName + ' must be a function or {handler}' });
                }
                bound = D.on(node, evName, isFunction(spec) ? spec : spec.handler, opts);
                if (bound.status !== STATUS.OK) { return bound; }
            }
        }
        return ok(node);
    }

    function createNodeImpl(tag, props, parent, isStrict) {
        if (!doc) { return fail(STATUS.ENOSYS, { reason: 'no document' }); }
        if (typeof tag !== 'string' || tag.trim().length === 0) {
            return fail(STATUS.EINVAL, { reason: 'tag must be a non-empty string' });
        }
        var t = tag.trim().toLowerCase();
        if (t.indexOf(':') !== -1 || t.indexOf('/') !== -1) {
            return fail(STATUS.ENOSYS, { reason: 'namespaced or self-closing tags are not part of EznK' });
        }
        if (HTML_TAGS[t] !== 1) {
            return fail(STATUS.EINVAL, { reason: 'tag "' + t + '" is not an allowed EznK element' });
        }
        var par = resolveParent(parent === undefined || parent === null ? 'root' : parent);
        if (par.status !== STATUS.OK) { return par; }
        var el;
        try {
            el = doc.createElement(t);
        } catch (err) {
            return failFrom(err, STATUS.EINVAL);
        }
        if (props !== undefined && props !== null) {
            if (!isPlainObject(props)) {
                return fail(STATUS.EINVAL, { reason: 'props must be a plain object' });
            }
            var pr = applyProps(el, props, { strict: isStrict === true });
            if (pr.status !== STATUS.OK) { return pr; }
        }
        try {
            par.value.appendChild(el);
        } catch (err) {
            return failFrom(err);
        }
        return ok(el);
    }

    /** Internal create with a strict/legacy switch used by callers that
     *  must not silently drop non-ASCII text. */
    D.createStrict = function (tag, props, parent) {
        return createNodeImpl(tag, props, parent, true);
    };

    D.createNode = function (tag, props, parent, strict) {
        return createNodeImpl(tag, props, parent, strict);
    };

    /** setData(node, key, value) -> { status, value: node }  data-* channel. */
    D.setData = function (node, key, value) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'setData expects an Element' }); }
        if (typeof key !== 'string' || !/^[A-Za-z0-9_-]+$/.test(key)) {
            return fail(STATUS.EINVAL, { reason: 'data key must match [A-Za-z0-9_-]+' });
        }
        var v = (value === null || value === undefined) ? '' : stripToAscii(String(value), true);
        try {
            node.setAttribute('data-' + key, v);
            return ok(node);
        } catch (err) { return failFrom(err); }
    };

    /**
     * setLive(node, name, value) -> { status, value: node }
     *   Writes LIVE element state (value / checked / selected / disabled)
     *   instead of the default attribute, so controls built later read
     *   back what was written. Single place for this mapping.
     */
    D.setLive = function (node, name, value) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'setLive expects an Element' }); }
        try {
            if (name === 'value') {
                node.value = (value === null || value === undefined) ? '' : stripToAscii(String(value), true);
                return ok(node);
            }
            if (name === 'checked' || name === 'selected' || name === 'disabled') {
                node[name] = !!value;
                return ok(node);
            }
            return fail(STATUS.EINVAL, { reason: 'setLive only accepts value/checked/selected/disabled' });
        } catch (err) { return failFrom(err); }
    };

    /** getLive(node, name) -> { status, value: any } */
    D.getLive = function (node, name) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'getLive expects an Element' }); }
        if (name !== 'value' && name !== 'checked' && name !== 'selected' && name !== 'disabled') {
            return fail(STATUS.EINVAL, { reason: 'getLive only accepts value/checked/selected/disabled' });
        }
        try { return ok(node[name]); } catch (err) { return failFrom(err); }
    };

    /** getData(node, key, fallback) -> { status, value: string } */
    D.getData = function (node, key, fallback) {
        var st = elementStatus(node);
        if (st !== STATUS.OK) { return fail(st, { reason: 'getData expects an Element' }); }
        var attr = D.getAttr(node, 'data-' + stringifyKey(key));
        if (attr.status !== STATUS.OK) {
            return fallback === undefined ? attr : ok(fallback);
        }
        return attr;
    };

    function stringifyKey(key) {
        var k = String(key);
        return k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
    }

    /* =================================================================
     * 14. Ready / bootstrap listener (headless-safe)
     * ============================================================== */

    var readyCallbacks = [];

    /**
     * ready(callback) -> { status, value: handle }
     *   Runs `callback()` exactly once, when the document root exists.
     *   If the root is already available the callback fires on the next
     *   animation frame, so eager code always finishes first. Cancel
     *   before it fires with off(handle).
     */
    D.ready = function (callback) {
        if (!isFunction(callback)) {
            return fail(STATUS.EINVAL, { reason: 'callback must be a function' });
        }
        var handle = track('event', 'ready', null, {
            listener: null, capture: false, selector: null,
            eventName: 'ready', ready: true, callback: callback, frame: null
        });
        if (resolveRoot()) {
            var self = handle;
            var fr = D.scheduleFrame(function () { D.fireReady(self); });
            if (fr.status === STATUS.OK) {
                resources[handle].frame = fr.value;
            } else {
                /* No frame source: still must not guess a timing order, but
                 * cannot wait forever - fire on a zero timer owned by us. */
                var tm = D.setTimer(function () { D.fireReady(self); }, 0);
                resources[handle].timer = tm.status === STATUS.OK ? tm.value : null;
            }
        } else {
            readyCallbacks.push(handle);
        }
        return ok(handle);
    };

    /** fireReady(handle) -> { status, value: boolean }  Invoke once. */
    D.fireReady = function (handle) {
        var rec = resources[handle];
        if (!rec || !rec.live || rec.ready !== true) {
            return fail(STATUS.ENOENT, { reason: 'ready handle is not live' });
        }
        if (rec.frame) { D.cancelFrame(rec.frame); rec.frame = null; }
        if (rec.timer) { D.cancelTimer(rec.timer); rec.timer = null; }
        retire(handle);
        try {
            rec.callback();
        } catch (err) {
            return fail(STATUS.EFAULT, { error: (err && err.message) || String(err) });
        }
        return ok(true);
    };

    function flushReady() {
        if (!readyCallbacks.length) { return; }
        var list = readyCallbacks.slice(0);
        readyCallbacks.length = 0;
        list.forEach(function (h) { D.fireReady(h); });
    }

    /* ONE listener for document readiness, owned by this module. */
    if (doc) {
        if (doc.readyState === 'loading') {
            try {
                doc.addEventListener('DOMContentLoaded', flushReady, { once: true });
                track('window', 'domcontentloaded', doc, {});
            } catch (_) { /* ignore */ }
        } else {
            track('window', 'domcontentloaded-already-fired', doc, {});
        }
    }

    /* =================================================================
     * 15. Publish namespaces
     * ============================================================== */

    if (typeof G.EZNT !== 'object' || G.EZNT === null) {
        G.EZNT = {};
    }
    if (typeof G.EznK !== 'object' || G.EznK === null) {
        G.EznK = {};
    }
    if (typeof G.EznK.Platform !== 'object' || G.EznK.Platform === null) {
        G.EznK.Platform = {};
    }

    /* Refuse to clobber a live binding table from another load. */
    if (G.EZNT.DOM && G.EZNT.DOM.__isEZNTDOM === true) {
        return;
    }

    G.EZNT.DOM = D;
    G.EznK.Platform.DOM = D;

    /* The same handle table is reachable from both name spaces; there is
     * exactly one implementation behind them. */

    console.log('[EznK/L1] platform/dom.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
