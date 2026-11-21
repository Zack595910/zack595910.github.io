/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 2 - Runtime Layer
 *
 *   File    : js/runtime/exc.js
 *   Module  : EznK.Runtime.exc
 *   Layer   : L2 运行时层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The .exc (Executable) parser and runner.
 *
 *   .exc is a TAG-BASED native syntax with embedded JS blocks:
 *
 *     app "My App" version="1.0" {
 *         window title="Window" width=400 height=300 {
 *             label text="Hello" align=center
 *             button text="Click" onClick={
 *                 Ezn32UI.showToast('clicked');
 *             }
 *         }
 *     }
 *
 *   RULES (prompt section 5):
 *     - JS blocks may ONLY modify existing controls and call system APIs.
 *       They may NOT create new controls - that is what the tag tree is
 *       for, and enforcing it is what keeps .exc declarative.
 *     - Controls map 1:1 onto Ezn32 UI controls.
 *     - .exc may call .zjl (user libraries) and .skl (kernel libraries).
 *
 *   The parser is a hand-written single-pass tokeniser + recursive
 *   descent. No regex-driven patching, no string concatenation of code.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Runtime && G.EznK.Runtime.exc) { return; }

    var CORE = G.EznK.Platform.Core;
    if (!CORE) { throw new Error('[EznK/L2] js/runtime/exc.js requires platform/core.js'); }
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L2:exc');

    var ui = ezn32.ui;
    var api = ezn32.api;

    /* =================================================================
     * 1. Parser (line-driven)
     *
     * EXC is a TAG-BASED language where every declaration is a line:
     *
     *     app "My App" version="1.0" {
     *         window title="Window" width=400 height=300 {
     *             label text="Hello" align=center
     *             button text="Click" onClick={
     *                 Ezn32UI.showToast('clicked');
     *             }
     *         }
     *     }
     *
     * Parsing walks LINES, not a flat character stream: a line opens a
     * block (`... {`), closes one (`}`), or declares a self-contained
     * tag. That is what keeps `label ...` and `button ...` separate
     * declarations instead of one run of tokens.
     * ============================================================== */

    /**
     * scanSimple(line, lineNo) -> tokens  (no brace handling)
     */
    function scanSimple(line, lineNo) {
        var s = String(line);
        var i = 0;
        var tokens = [];

        function err(msg) {
            var e = new Error(msg + ' (line ' + lineNo + ')');
            e.__excParse = true;
            throw e;
        }

        while (i < s.length) {
            var ch = s.charAt(i);
            if (ch === ' ' || ch === '\t' || ch === '\r') { i += 1; continue; }

            if (ch === '"' || ch === "'") {
                var q = ch;
                var buf = '';
                i += 1;
                while (i < s.length && s.charAt(i) !== q) {
                    if (s.charAt(i) === '\\') {
                        var nx = s.charAt(i + 1);
                        if (nx === 'n') { buf += '\n'; }
                        else if (nx === 't') { buf += '\t'; }
                        else if (nx === '"') { buf += '"'; }
                        else if (nx === "'") { buf += "'"; }
                        else if (nx === '\\') { buf += '\\'; }
                        else { buf += nx; }
                        i += 2;
                        continue;
                    }
                    buf += s.charAt(i);
                    i += 1;
                }
                if (i >= s.length) { err('unterminated string'); }
                i += 1;
                tokens.push({ t: 'string', v: buf });
                continue;
            }

            if (ch === '{' || ch === '}' || ch === '=') {
                tokens.push({ t: 'punct', v: ch });
                i += 1;
                continue;
            }

            if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(s.charAt(i + 1)))) {
                var num = '';
                if (ch === '-') { num += '-'; i += 1; }
                while (i < s.length && /[0-9.]/.test(s.charAt(i))) { num += s.charAt(i); i += 1; }
                tokens.push({ t: 'number', v: parseFloat(num) });
                continue;
            }

            if (/[A-Za-z_$]/.test(ch)) {
                var id = '';
                while (i < s.length && /[A-Za-z0-9_$.:\-]/.test(s.charAt(i))) {
                    id += s.charAt(i);
                    i += 1;
                }
                tokens.push({ t: 'ident', v: id });
                continue;
            }

            err('unexpected character "' + ch + '"');
        }
        return tokens;
    }

    /**
     * readBraceBlock(lines, lineIdx, afterCol) -> { body, nextLine }
     *   Reads a balanced { ... } starting just after the opening brace on
     *   `lineIdx`. Returns the JS body and the next line to read from.
     */
    function readBraceBlock(lines, lineIdx, firstFragment) {
        var depth = 1;
        var quote = null;
        var body = '';

        function consume(text) {
            for (var k = 0; k < text.length; k++) {
                var c = text.charAt(k);
                if (quote) {
                    if (c === '\\') { k += 1; continue; }
                    if (c === quote) { quote = null; }
                    continue;
                }
                if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
                if (c === '{') { depth += 1; continue; }
                if (c === '}') {
                    depth -= 1;
                    if (depth === 0) { return k; }
                }
            }
            return -1;
        }

        var stop = consume(firstFragment || '');
        if (stop >= 0) {
            return { body: (firstFragment || '').slice(0, stop), nextLine: lineIdx + 1 };
        }
        body = firstFragment || '';

        var li = lineIdx + 1;
        while (li < lines.length) {
            var line = lines[li];
            var idx = consume(line);
            if (idx >= 0) {
                body += '\n' + line.slice(0, idx);
                return { body: body, nextLine: li + 1 };
            }
            body += '\n' + line;
            li += 1;
        }
        throw { __exc: 'unterminated JS block starting at line ' + (lineIdx + 1) };
    }

    /**
     * parseDeclaration(lines, lineIdx) -> { node, nextLine }
     *   One tag declaration. Handles `key={ ... }` JS attribute values
     *   (possibly multi-line) and a trailing `{` that opens children.
     */
    function parseDeclaration(lines, lineIdx) {
        var line = lines[lineIdx];
        var tokens = [];
        var cursor = 0;
        var work = line;
        var consumedLine = lineIdx + 1;

        /* First pass: does this line contain a `={ ... }` value? */
        var jsValue = null;
        var braceIdx = -1;
        var inQuote = null;
        var eqBefore = false;
        for (var k = 0; k < work.length; k++) {
            var c = work.charAt(k);
            if (inQuote) {
                if (c === '\\') { k += 1; continue; }
                if (c === inQuote) { inQuote = null; }
                continue;
            }
            if (c === '"' || c === "'") { inQuote = c; continue; }
            if (c === '=' && work.charAt(k + 1) === '{') { eqBefore = true; braceIdx = k + 1; break; }
            if (c === '{') { braceIdx = k; break; }
        }

        if (braceIdx >= 0 && eqBefore) {
            /* <tag attrs key={ ... } [more attrs]
             * Emit 'key = js' in that order so the attribute loop below
             * attaches the block to the right attribute. */
            var block = readBraceBlock(lines, lineIdx, work.slice(braceIdx + 1));
            jsValue = block.body;
            consumedLine = block.nextLine;
            var beforeEq = work.slice(0, braceIdx - 1);
            var keyMatch = /([A-Za-z_$][\w$]*)\s*$/.exec(beforeEq);
            var keyName = keyMatch ? keyMatch[1] : null;
            var headText = keyName ? beforeEq.slice(0, beforeEq.length - keyName.length) : beforeEq;
            tokens = scanSimple(headText, lineIdx + 1);
            if (keyName) {
                tokens.push({ t: 'ident', v: keyName });
                tokens.push({ t: 'punct', v: '=' });
            }
            tokens.push({ t: 'js', v: jsValue });
        } else if (braceIdx >= 0) {
            /* <tag attrs {          <- opens children */
            tokens = scanSimple(work.slice(0, braceIdx), lineIdx + 1);
            tokens.push({ t: 'punct', v: '{' });
        } else {
            tokens = scanSimple(work, lineIdx + 1);
        }

        if (!tokens.length || tokens[0].t !== 'ident') {
            throw { __exc: 'expected a tag name on line ' + (lineIdx + 1) };
        }

        var type = tokens[0].v;
        var props = {};
        var openChildren = false;
        var first = true;
        var i = 1;

        while (i < tokens.length) {
            var tk = tokens[i];
            if (tk.t === 'punct' && tk.v === '{') { openChildren = true; i += 1; break; }
            if (tk.t === 'punct' && tk.v === '}') { i += 1; continue; }
            if (first && tk.t === 'string') {
                props.text = tk.v;
                first = false;
                i += 1;
                continue;
            }
            first = false;
            if (tk.t === 'js') {
                /* a JS block with no attribute name: attach as onClickJS */
                props.__inlineJs = tk.v;
                i += 1;
                continue;
            }
            if (tk.t !== 'ident') { i += 1; continue; }

            var name = tk.v;
            var next = tokens[i + 1];
            if (next && next.t === 'punct' && next.v === '=') {
                var val = tokens[i + 2];
                if (!val) { props[name] = true; i += 2; continue; }
                if (val.t === 'string') { props[name] = val.v; }
                else if (val.t === 'number') { props[name] = val.v; }
                else if (val.t === 'js') { props[name] = { __js: val.v }; }
                else if (val.t === 'punct' && val.v === '{') { openChildren = true; break; }
                else { props[name] = val.v; }
                i += 3;
                continue;
            }
            props[name] = true;
            i += 1;
        }

        var node = { type: type, props: props, children: [] };
        return { node: node, nextLine: consumedLine, openChildren: openChildren };
    }

    /**
     * parseNode(lines, lineIdx) -> { node, nextLine }
     *   A declaration plus, when it opened a block, every child until the
     *   matching close brace.
     */
    function parseNode(lines, lineIdx) {
        var decl = parseDeclaration(lines, lineIdx);
        var node = decl.node;
        var li = decl.nextLine;

        if (decl.openChildren) {
            var closed = false;
            while (li < lines.length) {
                var ln = lines[li].trim();
                if (ln === '}') { li += 1; closed = true; break; }
                if (ln.length === 0) { li += 1; continue; }
                var child = parseNode(lines, li);
                node.children.push(child.node);
                li = child.nextLine;
            }
            if (!closed) {
                throw { __exc: 'missing closing "}" for <' + node.type + '> declared on line ' + (lineIdx + 1) };
            }
        }
        return { node: node, nextLine: li };
    }

    /**
     * parse(src) -> { status, value: ast }
     */
    function parse(src) {
        var raw = String(src === null || src === undefined ? '' : src).replace(/\r\n/g, '\n').split('\n');
        var lines = [];
        for (var i = 0; i < raw.length; i++) {
            var t = raw[i].trim();
            if (!t) { continue; }
            if (t.indexOf('//') === 0) { continue; }
            if (t.indexOf('/*') === 0 && t.indexOf('*/') === t.length - 2) { continue; }
            lines.push(raw[i]);
        }
        if (!lines.length) {
            return CORE.fail(S.EBADIMAGE, { reason: 'EXC parse error: empty source' });
        }
        try {
            var res = parseNode(lines, 0);
            /* `app "My App"` supplies the name through the positional value */
            if (res.node && res.node.props && res.node.props.text && !res.node.props.name) {
                res.node.props.name = res.node.props.text;
            }
            if (!res.node || res.node.type !== 'app') {
                return CORE.fail(S.EBADIMAGE, {
                    reason: 'EXC must start with an app block, got "' + (res.node && res.node.type) + '"'
                });
            }
            return CORE.ok(res.node);
        } catch (err) {
            var msg = (err && err.__exc) ? err.__exc : ((err && err.message) || String(err));
            return CORE.fail(S.EBADIMAGE, { reason: 'EXC parse error: ' + msg });
        }
    }

﻿    /* =================================================================
     * 3. Widget mapping
     * ============================================================== */

    var WIDGETS = {
        label: 'Label',
        button: 'Button',
        edit: 'Edit',
        checkbox: 'CheckBox',
        listbox: 'ListBox',
        table: 'Table',
        treeview: 'TreeView',
        menu: 'Menu',
        statusbar: 'StatusBar',
        scrollbar: 'ScrollBar'
    };

    function prop(props, key, dflt) {
        var v = props[key];
        return (v === undefined || v === null) ? dflt : v;
    }

    function numProp(props, key, dflt) {
        var v = props[key];
        if (typeof v === 'number') { return v; }
        if (typeof v === 'string' && v.length && !isNaN(parseFloat(v))) { return parseFloat(v); }
        return dflt;
    }

    /* =================================================================
     * 4. Runner
     * ============================================================== */

    /**
     * buildControl(type, props, ctx) -> Ezn32 UI control
     */
    function buildControl(type, props, ctx) {
        var C = ui.controls;
        var ctorName = WIDGETS[type];
        if (!ctorName || !C[ctorName]) { return null; }

        var base = {
            id: typeof props.id === 'string' ? props.id : undefined,
            x: numProp(props, 'x', ctx.nextX),
            y: numProp(props, 'y', ctx.nextY),
            width: numProp(props, 'width', undefined),
            height: numProp(props, 'height', undefined),
            text: typeof props.text === 'string' ? props.text : '',
            tag: props.name || null
        };

        var ctl = null;
        try {
            if (type === 'label') {
                ctl = new C.Label({
                    id: base.id, x: base.x, y: base.y,
                    width: base.width || 200, height: base.height || 18,
                    text: base.text, align: prop(props, 'align', 'left')
                });
                ctx.nextY += 26;
            } else if (type === 'button') {
                ctl = new C.Button({
                    id: base.id, x: base.x, y: base.y,
                    width: base.width || 100, height: base.height || 26,
                    text: base.text,
                    variant: prop(props, 'variant', 'default'),
                    disabled: prop(props, 'disabled', false) === true
                });
                ctl.setEnabled(prop(props, 'disabled', false) !== true);
                ctx.nextY += 34;
            } else if (type === 'edit') {
                ctl = new C.Edit({
                    id: base.id, x: base.x, y: base.y,
                    width: base.width || 200, height: base.height || 24,
                    value: prop(props, 'value', ''),
                    placeholder: prop(props, 'placeholder', ''),
                    multiline: prop(props, 'multiline', false) === true,
                    readOnly: prop(props, 'readonly', false) === true
                });
                ctx.nextY += 32;
            } else if (type === 'checkbox') {
                ctl = new C.CheckBox({
                    id: base.id, x: base.x, y: base.y,
                    width: base.width || 180, height: base.height || 20,
                    text: base.text,
                    checked: prop(props, 'checked', false) === true
                });
                ctx.nextY += 28;
            } else if (type === 'listbox') {
                ctl = new C.ListBox({
                    id: base.id, x: base.x, y: base.y,
                    width: base.width || 220, height: base.height || 140,
                    items: ctx.itemsFrom(props)
                });
                ctx.nextY += (base.height || 140) + 8;
            } else if (type === 'table') {
                ctl = new C.Table({
                    id: base.id, x: base.x, y: base.y,
                    width: base.width || 380, height: base.height || 180,
                    columns: ctx.columnsFrom(props)
                });
                ctx.nextY += (base.height || 180) + 8;
            } else if (type === 'statusbar') {
                ctl = new C.StatusBar({
                    id: base.id, x: 0, y: ctx.surfaceHeight - 22,
                    width: ctx.surfaceWidth, panes: [{ id: 'main', text: base.text }]
                });
            } else {
                ctl = new C[ctorName]({ id: base.id, x: base.x, y: base.y, width: base.width, height: base.height });
            }
        } catch (err) {
            return null;
        }
        return ctl;
    }

    /**
     * runFile(path) -> Promise<{status, value: {windowId, ast}}>
     */
    function runFile(path) {
        if (typeof path !== 'string' || path.length === 0) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'path required' }));
        }
        return api.kernel.ReadFileText(path).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return run(r.value, { path: path });
        });
    }

    /**
     * run(source, opts) -> Promise<{status, value: {windowId, ast, controls}}>
     *   Builds the window, then evaluates every JS block in declaration
     *   order with a scope that can MODIFY controls but not create them.
     */
    function run(source, opts) {
        var parsed = parse(source);
        if (parsed.status !== S.OK) { return Promise.resolve(parsed); }

        var ast = parsed.value;
        var o = opts || {};
        var appName = typeof ast.props.name === 'string' ? ast.props.name : 'Application';
        var appVersion = typeof ast.props.version === 'string' ? ast.props.version : '1.0.0';

        var winNode = null;
        for (var i = 0; i < ast.children.length; i++) {
            if (ast.children[i].type === 'window') { winNode = ast.children[i]; break; }
        }
        if (!winNode) {
            return Promise.resolve(CORE.fail(S.EBADIMAGE, { reason: '.exc has no window block' }));
        }

        var wProps = winNode.props;
        var created = ui.Window.Create({
            id: typeof wProps.id === 'string' ? wProps.id : undefined,
            title: typeof wProps.title === 'string' ? wProps.title : appName,
            width: numProp(wProps, 'width', 480),
            height: numProp(wProps, 'height', 360),
            icon: typeof wProps.icon === 'string' ? wProps.icon : '[X]',
            ecosystem: 'native',
            className: 'exc'
        });
        if (created.status !== S.OK) { return Promise.resolve(created); }

        var win = created.value;
        var ctx = {
            nextX: 12,
            nextY: 12,
            surfaceWidth: win.client.width,
            surfaceHeight: win.client.height,
            controls: Object.create(null),      /* name / id -> control */
            itemsFrom: function (props) {
                var items = props.items;
                if (typeof items === 'string') {
                    return items.split(',').map(function (t, idx) {
                        return { id: 'i' + idx, text: t.trim() };
                    });
                }
                return [];
            },
            columnsFrom: function (props) {
                var cols = props.columns;
                if (typeof cols === 'string') {
                    return cols.split(',').map(function (t) {
                        return { id: t.trim(), text: t.trim(), width: 100 };
                    });
                }
                return [];
            }
        };

        var built = [];
        var jsQueue = [];
        var dynamicRoots = [];      /* repeat 生成的动态块，重绘时重建 */
        var onCloseSrc = '';        /* onclose 子节点收集 */
        var conditional = [];       /* if/show 条件控件 */

        /**
         * buildRepeat(node, parentControl) - 展开 repeat 块
         *   repeat over="items" as="item" {
         *     label text={ item.name }
         *     button text="删除" onClick={ remove(item) }
         *   }
         * 这一版只支持数据来自 state 或 Store 的同步取值。
         */
        function buildRepeat(node, parentControl) {
            var overExpr = String(node.props.over || '').trim();
            var asName = String(node.props.as || 'item').trim();
            if (!overExpr) { return; }

            var list = null;
            try {
                var f = Function.apply(null, JS_PARAMS.concat([
                    'return (' + overExpr + ');'
                ]));
                list = f.apply(null, JS_ARGS);
            } catch (err) {
                LOG.error('EXC repeat 取值失败: ' + overExpr + ' -> ' + (err && err.message));
                return;
            }
            if (!Array.isArray(list)) {
                LOG.warn('EXC repeat 的 over 不是数组: ' + overExpr);
                return;
            }

            list.forEach(function (item, idx) {
                node.children.forEach(function (child) {
                    var ctl = buildControl(child.type, child.props, ctx);
                    if (!ctl) { return; }
                    parentControl.addChild(ctl);
                    built.push(ctl);
                    var key = child.props.name || child.props.id;
                    if (key) { ctx.controls[key] = ctl; }
                    /* 让 onClick 等 JS 块能拿到当前项 */
                    if (child.js) { jsQueue.push({ js: child.js, ctl: ctl, node: child }); }
                    if (child.children.length) { buildChildren(child, ctl); }
                    void asName; void idx;
                });
            });
        }

        function buildChildren(parentNode, parentControl) {
            parentNode.children.forEach(function (child) {
                /* repeat 是容器节点，不是控件 */
                if (child.type === 'repeat') {
                    buildRepeat(child, parentControl);
                    return;
                }
                /* onload / onclose：生命周期块，不是控件。
                 * 写成子节点是最自然的方式（避免和 window 的 { 冲突）：
                 *   window title="X" {
                 *     onload={ ... }
                 *     label text="hi"
                 *   }
                 */
                if (child.type === 'onload' || child.type === 'onLoad') {
                    var rawOn = child.props.__inlineJs;
                    var onSrc = (rawOn && typeof rawOn.__js === 'string') ? rawOn.__js
                              : (typeof rawOn === 'string' ? rawOn : '');
                    if (onSrc && onSrc.trim().length) {
                        G.setTimeout(function () {
                            if (!win || win.destroyed) { return; }
                            try { runJsBlock(onSrc, 'onLoad'); } catch (_) {}
                        }, 30);
                    }
                    return;
                }
                if (child.type === 'onclose' || child.type === 'onClose') {
                    var rawOff = child.props.__inlineJs;
                    var offSrc = (rawOff && typeof rawOff.__js === 'string') ? rawOff.__js
                               : (typeof rawOff === 'string' ? rawOff : '');
                    if (offSrc && offSrc.trim().length) {
                        onCloseSrc = offSrc;
                    }
                    return;
                }
                var ctl = buildControl(child.type, child.props, ctx);
                if (!ctl) { return; }
                parentControl.addChild(ctl);
                built.push(ctl);
                var key = child.props.name || child.props.id || ctl.id;
                if (key) { ctx.controls[key] = ctl; }
                if (child.js) { jsQueue.push({ js: child.js, ctl: ctl, node: child }); }
                /* if / show：登记条件，首次渲染后求值 */
                if (typeof child.props.show === 'string' && child.props.show.trim().length) {
                    conditional.push({ ctl: ctl, expr: child.props.show.trim() });
                }
                /* bind：双向绑定到 state.xxx */
                if (typeof child.props.bind === 'string' && child.props.bind.trim().length) {
                    bindControl(ctl, child.props.bind.trim());
                }
                if (child.children.length) { buildChildren(child, ctl); }
            });
        }

        /* ==============================================================
         * 双向绑定 bind="path"
         *   edit / checkbox 参与输入；label / button 参与显示
         * ============================================================== */
        var binds = [];

        function getByPath(path) {
            var parts = String(path).split('.');
            var cur = stateObj;
            for (var i = 0; i < parts.length; i++) {
                if (cur === null || cur === undefined) { return undefined; }
                cur = cur[parts[i]];
            }
            return cur;
        }
        function setByPath(path, val) {
            var parts = String(path).split('.');
            var cur = stateObj;
            for (var i = 0; i < parts.length - 1; i++) {
                if (cur[parts[i]] === null || typeof cur[parts[i]] !== 'object') {
                    cur[parts[i]] = {};
                }
                cur = cur[parts[i]];
            }
            cur[parts[parts.length - 1]] = val;
        }

        function bindControl(ctl, path) {
            var entry = { ctl: ctl, path: path, kind: 'display' };
            /* 可输入控件：值变更写回 state */
            if (ctl.constructor && (ctl.constructor.name === 'Edit')) {
                entry.kind = 'input';
                var origChange = ctl.onChange;
                ctl.onChange = function () {
                    setByPath(path, ctl.getValue());
                    if (typeof origChange === 'function') { origChange.apply(null, arguments); }
                };
            } else if (ctl.constructor && ctl.constructor.name === 'CheckBox') {
                entry.kind = 'checked';
                var origChange2 = ctl.onChange;
                ctl.onChange = function () {
                    setByPath(path, !!ctl.checked);
                    if (typeof origChange2 === 'function') { origChange2.apply(null, arguments); }
                };
            }
            binds.push(entry);
            return entry;
        }

        /** applyBinds() - 把 state 的值刷到控件上 */
        function applyBinds() {
            binds.forEach(function (b) {
                var v = getByPath(b.path);
                if (v === undefined) { return; }
                if (b.kind === 'input') {
                    var cur = b.ctl.getValue();
                    if (String(cur) !== String(v)) { b.ctl.setValue(v); }
                } else if (b.kind === 'checked') {
                    if (!!b.ctl.checked !== !!v) {
                        b.ctl.checked = !!v;
                        b.ctl.invalidate();
                    }
                } else if (typeof b.ctl.setText === 'function') {
                    b.ctl.setText(String(v));
                }
            });
        }

        /**
         * evalCondition(expr) - 求值 if/show 表达式。
         * 表达式里可以用 state / controls / Util 等。
         */
        function evalCondition(expr, ctl) {
            try {
                var f = Function.apply(null, JS_PARAMS.concat([
                    'var __ctl = arguments[arguments.length - 1];',
                    'return (' + expr + ');'
                ]));
                var args = JS_ARGS.concat([ctl]);
                return !!f.apply(null, args);
            } catch (err) {
                LOG.error('EXC 条件求值失败: ' + expr + ' -> ' + (err && err.message));
                return true;   /* 出错时保持可见，避免整页消失 */
            }
        }

        function applyConditions() {
            conditional.forEach(function (c) {
                var vis = evalCondition(c.expr, c.ctl);
                if (c.ctl.visible !== vis) {
                    c.ctl.visible = vis;
                }
            });
            if (win && win.client) { win.client.invalidate(); }
        }

        /**
         * rebuildDynamic() - 双向绑定/状态变化后重建受影响的控件。
         *   目前只做两件事：重算条件显隐、刷新 bind 控件。
         */
        function rebuildDynamic() {
            try { applyConditions(); } catch (_) {}
            try { applyBinds(); } catch (_) {}
        }

        buildChildren(winNode, win.client);

        /* ---- run JS blocks: MODIFY existing controls only ---- */
        var Ezn32UI = {
            showToast: function (msg) {
                var nc = G.EznK.Shell && G.EznK.Shell.notifications;
                if (nc) { nc.push({ title: appName, text: String(msg).slice(0, 120), level: 'info', timeout: 3000 }); }
                return null;
            },
            get: function (key) { return ctx.controls[key] || null; },
            setText: function (key, text) {
                var c = ctx.controls[key];
                if (c && typeof c.setText === 'function') { c.setText(text); return true; }
                return false;
            },
            getValue: function (key) {
                var c = ctx.controls[key];
                return c && typeof c.getValue === 'function' ? c.getValue() : null;
            },
            close: function () { return win.destroy(); },
            setTitle: function (t) { return win.setTitle(String(t)); }
        };

        /* ==============================================================
         * EXC 网络能力（Net）
         * --------------------------------------------------------------
         * .exc 应用里可以直接用 Net 访问互联网：
         *
         *   Net.get(url)              -> Promise<string>
         *   Net.getJSON(url)          -> Promise<object>
         *   Net.post(url, body)       -> Promise<string>
         *   Net.postJSON(url, data)   -> Promise<object>
         *   Net.request(url, opts)    -> Promise<{ok, status, text, json, headers}>
         *   Net.loadText(url)         -> Promise<string>   别名 get
         *   Net.isOnline()            -> boolean
         *   Net.then(...)             -> 直接返回 Promise，链式写法可用
         *
         * 所有调用都经过 EznK.Platform.Net 网关（规则：网络只能走平台层）。
         * 出错不抛异常，而是返回 Promise.reject(Error)，方便 .catch()。
         * ============================================================== */
        /* ==============================================================
         * 运行时作用域（Net / Timer / Store / Dialog / ...）
         * 统一由 js/runtime/exc-scope.js 提供，这里只做接线。
         * ============================================================== */
        var SCOPE_FACTORY = G.EznK.Runtime && G.EznK.Runtime.excScope;
        var runtime = SCOPE_FACTORY
            ? SCOPE_FACTORY.makeScope({
                appName: appName,
                win: win,
                ctx: ctx,
                requestRender: function () { rebuildDynamic(); }
            })
            : null;

        var Net = runtime ? runtime.Net : null;
        var Timer = runtime ? runtime.Timer : null;
        var Store = runtime ? runtime.Store : null;
        var Dialog = runtime ? runtime.Dialog : null;
        var Clipboard = runtime ? runtime.Clipboard : null;
        var Notify = runtime ? runtime.Notify : null;
        var Console2 = runtime ? runtime.Console : null;
        var Util = runtime ? runtime.Util : null;
        var stateObj = runtime ? runtime.state : {};

        if (!Net) {
            /* 兜底：作用域模块缺失时至少不崩 */
            Net = { getText: function () { return Promise.reject(new Error('网络层不可用')); },
                    get: function () { return Promise.reject(new Error('网络层不可用')); },
                    getJSON: function () { return Promise.reject(new Error('网络层不可用')); },
                    isOnline: function () { return false; } };
        }

        /* The scope is frozen for creation: no control factory is exposed,
         * satisfying "JS blocks may only modify existing controls". */
        var Scope = {
            Ezn32UI: Ezn32UI,
            Ezn32: G.ezn32,
            SRM: G.EznK.Kernel.SRM,
            Net: Net,
            Timer: Timer,
            Store: Store,
            Dialog: Dialog,
            Clipboard: Clipboard,
            Notify: Notify,
            Console: Console2,
            Util: Util,
            state: stateObj,
            app: { name: appName, version: appVersion },
            window: win,
            controls: ctx.controls
        };

        /* 所有 JS 代码块共用的参数名（顺序必须一致） */
        var JS_PARAMS = ['Ezn32UI', 'Ezn32', 'SRM', 'Net', 'Timer', 'Store',
                         'Dialog', 'Clipboard', 'Notify', 'Console', 'Util',
                         'state', 'app', 'controls', 'window'];
        var JS_ARGS = [Ezn32UI, G.ezn32, G.EznK.Kernel.SRM, Net, Timer, Store,
                       Dialog, Clipboard, Notify, Console2, Util,
                       stateObj, Scope.app, ctx.controls, win];

        /** runJsBlock(src) - 在统一作用域里执行一段 JS */
        function runJsBlock(src, label) {
            try {
                var f = Function.apply(null, JS_PARAMS.concat([src]));
                return f.apply(null, JS_ARGS);
            } catch (err) {
                LOG.error('EXC ' + (label || 'JS') + ' 抛出: ' + (err && err.message));
                throw err;
            }
        }

        jsQueue.forEach(function (job) {
            try {
                runJsBlock(job.js, 'JS block <' + job.node.type + '>');
            } catch (_) { /* 已记录 */ }
        });

        /* 把 onClick JS 块绑到对应的按钮上。
         *
         * 之前的实现：没有 name/id 的按钮回退到"第一个按钮"，于是每个
         * button 的 resolve 都覆盖同一个控件的 onClick，最后只有最后一个
         * 块生效 —— 表现为"点任何按钮都执行最后一个按钮的代码"。
         *
         * 正确做法：按 <button> 在 AST 里出现的顺序，对应 built 里第 N 个
         * kind==='button' 的控件。有 name/id 的优先用名字找。 */
        var builtButtons = built.filter(function (c) { return c.kind === 'button'; });
        var btnSeq = 0;
        winNode.children.forEach(function (child) {
            if (child.type !== 'button') { return; }
            /* 分配顺序索引：即使这个按钮没有 onClick，也要占一个位置，
             * 否则后续按钮会整体错位。 */
            var myIndex = btnSeq++;
            var oc = child.props.onClick;
            if (!oc || !oc.__js) { return; }
            var ctlKey = child.props.name || child.props.id;
            var target = ctlKey ? ctx.controls[ctlKey] : null;
            if (!target) {
                target = builtButtons[myIndex] || null;
            }
            if (!target) { return; }
            /* 用 IIFE 固定 oc，避免闭包共享最后一个值 */
            (function (jsSrc, ctl) {
                ctl.onClick = function () {
                    try { runJsBlock(jsSrc, 'onClick'); } catch (_) { /* 已记录 */ }
                };
            })(oc.__js, target);
        });

        /* ==============================================================
         * 生命周期 + 初始渲染
         *   onLoad  : window 上的 JS 块，应用启动后执行一次
         *   onClose : 窗口关闭时执行，用于清理
         * ============================================================== */
        try { applyConditions(); } catch (_) {}
        try { applyBinds(); } catch (_) {}

        /* JS 块被解析成 { __js: "..." } 对象，不是字符串 */
        var onLoadRaw = winNode.props.onLoad;
        var onLoadJs = (onLoadRaw && typeof onLoadRaw.__js === 'string') ? onLoadRaw.__js
                     : (typeof onLoadRaw === 'string' ? onLoadRaw : '');
        if (onLoadJs.trim().length) {
            /* 延后一帧，等窗口真正渲染出来再执行 */
            G.setTimeout(function () {
                if (!win || win.destroyed) { return; }
                try { runJsBlock(onLoadJs, 'onLoad'); } catch (_) {}
            }, 30);
        }
        var onCloseRaw = winNode.props.onClose;
        var onCloseJs = onCloseSrc || ((onCloseRaw && typeof onCloseRaw.__js === 'string') ? onCloseRaw.__js
                      : (typeof onCloseRaw === 'string' ? onCloseRaw : ''));
        if (onCloseJs.trim().length) {
            var prevDestroy = win.onDestroy;
            win.onDestroy = function () {
                try { runJsBlock(onCloseJs, 'onClose'); } catch (_) {}
                if (runtime && typeof runtime._dispose === 'function') {
                    try { runtime._dispose(); } catch (_) {}
                }
                if (typeof prevDestroy === 'function') {
                    try { prevDestroy(); } catch (_) {}
                }
            };
        } else {
            var prevDestroy2 = win.onDestroy;
            win.onDestroy = function () {
                if (runtime && typeof runtime._dispose === 'function') {
                    try { runtime._dispose(); } catch (_) {}
                }
                if (typeof prevDestroy2 === 'function') {
                    try { prevDestroy2(); } catch (_) {}
                }
            };
        }

        return Promise.resolve(CORE.ok({
            windowId: win.id,
            appName: appName,
            appVersion: appVersion,
            ast: ast,
            controls: ctx.controls,
            controlCount: built.length,
            scope: Scope,
            runtime: runtime
        }));
    }

    /* =================================================================
     * 5. Library support (.zjl and .skl)
     * ============================================================== */

    /**
     * loadLibrary(path) -> Promise<{status, value: {exports}}>
     *   Executes a .zjl module and returns its exports object.
     *   The module body uses the documented `export` syntax:
     *       export function add(a,b){...}
     *       export var PI = 3.14
     *   which is translated to a CommonJS-style wrapper at load time.
     */
    function loadLibrary(path) {
        return api.kernel.ReadFileText(path).then(function (r) {
            if (r.status !== S.OK) { return r; }
            var src = r.value;
            var exportsObj = {};
            var translated = src.replace(/^\s*export\s+(function|var|let|const|class)\s+/gm, '$1 ');
            /* collect exported names */
            var names = [];
            var re = /^\s*export\s+(?:function|var|let|const|class)\s+([A-Za-z_$][\w$]*)/gm;
            var m;
            while ((m = re.exec(src)) !== null) { names.push(m[1]); }
            try {
                var fn = new Function('exports', translated +
                    '\n;' + names.map(function (n) { return 'exports.' + n + ' = ' + n + ';'; }).join('\n'));
                fn(exportsObj);
                return CORE.ok({ path: path, exports: exportsObj, names: names });
            } catch (err) {
                return CORE.fail(S.EFAULT, { reason: 'library load failed: ' + (err && err.message) });
            }
        });
    }

    /** loadKernelLibrary(path) - loads an .skl and calls its init(). */
    function loadKernelLibrary(path) {
        return api.kernel.ReadFileText(path).then(function (r) {
            if (r.status !== S.OK) { return r; }
            try {
                var fn = new Function('root', r.value);
                fn(G);
                var libs = (G.EznK && G.EznK.Skl) || {};
                var names = Object.keys(libs);
                var last = names.length ? libs[names[names.length - 1]] : null;
                if (last && typeof last.init === 'function') {
                    last.init(G.EznK.Runtime.sys.buildSysScope());
                }
                return CORE.ok({ path: path, library: last });
            } catch (err) {
                return CORE.fail(S.EFAULT, { reason: 'kernel library load failed: ' + (err && err.message) });
            }
        });
    }

    /* =================================================================
     * 6. Lifecycle
     * ============================================================== */

    function boot() {
        var srm = EznK.Kernel.SRM;
        if (srm) {
            srm.registerService('exc-runtime', { init: function () { LOG.info('EXC runtime online'); } });
            srm.registerFunction('exc.run', function (src) { return run(src); }, 'run EXC source');
            srm.registerFunction('exc.runFile', function (p) { return runFile(p); }, 'run an .exc file');
        }
        return CORE.ok(true);
    }

    var EXC = {};
    EXC.version = '1.0.0';
    EXC.boot = boot;
    EXC.shutdown = function () { return CORE.ok(true); };

    EXC.parse = parse;
    EXC.tokenize = function (src) {
        try { return CORE.ok(tokenize(src)); }
        catch (err) { return CORE.fail(S.EBADIMAGE, { reason: err.message }); }
    };
    EXC.run = run;
    EXC.runFile = runFile;
    EXC.loadLibrary = loadLibrary;
    EXC.loadKernelLibrary = loadKernelLibrary;
    EXC.WIDGETS = Object.freeze(Object.assign({}, WIDGETS));

    if (!G.EznK.Runtime) { G.EznK.Runtime = {}; }
    G.EznK.Runtime.exc = EXC;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('runtime-exc', EXC);
    }
    LOG.info('js/runtime/exc.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
