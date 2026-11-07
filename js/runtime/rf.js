/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 2 - Runtime Layer
 *
 *   File    : js/runtime/rf.js
 *   Module  : EznK.Runtime.rf
 *   Layer   : L2 运行时层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The rf script interpreter - CONTRACT 7.1 (highest priority).
 *
 *   Command set (must be complete):
 *     window / label / button / print / python / msg / ask / input /
 *     set / close / wait / if / menu / menuitem / menusep / canvas /
 *     draw / send / parallel / end
 *
 *   ---- LEGACY SYNTAX (must stay byte-for-byte compatible) ----
 *     window "Title" 400 300
 *     label "text" [center|left]
 *     button "text" run        <- opens a block
 *     button "text" close
 *     print "text"
 *     python "code"
 *     msg "title" "content"
 *     ask "title" "content" -> varname
 *     input "prompt" -> varname
 *     set var = value
 *     close
 *     wait 1000                <- milliseconds
 *     if var == "value" then   <- opens a block
 *     menu "File"
 *     menuitem "Open" run|close|print|msg [arg]
 *     menusep
 *     canvas 480 300
 *     draw                     <- opens a block
 *     end                      <- closes any block
 *
 *   ---- NEW IN EZNT (superset, old scripts unaffected) ----
 *     send "channel"          broadcast on a channel
 *     send "channel" "text"   send text to a channel
 *     parallel                starts a block that runs concurrently
 *     end                     closes it
 *
 *   ---- SEMANTICS THAT MUST NOT CHANGE ----
 *     wait   is ASYNCHRONOUS: it yields, it never busy-spins
 *     parallel executes its block concurrently with the main flow
 *     send   delivers through the kernel message bus (topic channel)
 *
 *   RENDERING: an rf window is a real Ezn32 UI window; label/button/
 *   canvas are real controls. rf never draws DOM.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Runtime && G.EznK.Runtime.rf) { return; }

    var CORE = G.EznK.Platform.Core;
    if (!CORE) { throw new Error('[EznK/L2] js/runtime/rf.js requires platform/core.js'); }
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L2:rf');

    var ui = ezn32.ui;
    var api = ezn32.api;
    var K = api.kernel;
    var TIME = G.EznK.Platform.Time;

    /* =================================================================
     * 1. Lexer / parser
     * ============================================================== */

    /**
     * parseLine(line) -> { cmd, args } | null
     *   Mirrors the legacy regular expressions exactly, so old scripts
     *   parse identically. Additional commands are appended below them.
     */
    function parseLine(line) {
        var m;

        m = line.match(/^window\s+"([^"]*)"\s+(\d+)\s+(\d+)/);
        if (m) { return { cmd: 'window', args: [m[1], parseInt(m[2], 10), parseInt(m[3], 10)] }; }

        m = line.match(/^label\s+"([^"]*)"\s*(center|left)?/);
        if (m) { return { cmd: 'label', args: [m[1], m[2] || 'left'] }; }

        m = line.match(/^button\s+"([^"]*)"\s+(run|close)/);
        if (m) { return { cmd: 'button', args: [m[1], m[2]] }; }

        m = line.match(/^print\s+"([^"]*)"/);
        if (m) { return { cmd: 'print', args: [m[1]] }; }

        m = line.match(/^python\s+"([^"]*)"/);
        if (m) { return { cmd: 'python', args: [m[1]] }; }

        m = line.match(/^msg\s+"([^"]*)"\s+"([^"]*)"/);
        if (m) { return { cmd: 'msg', args: [m[1], m[2]] }; }

        m = line.match(/^ask\s+"([^"]*)"\s+"([^"]*)"\s*->\s*(\w+)/);
        if (m) { return { cmd: 'ask', args: [m[1], m[2], m[3]] }; }

        m = line.match(/^input\s+"([^"]*)"\s*->\s*(\w+)/);
        if (m) { return { cmd: 'input', args: [m[1], m[2]] }; }

        m = line.match(/^set\s+(\w+)\s*=\s*(.+)/);
        if (m) { return { cmd: 'set', args: [m[1], m[2].replace(/"/g, '').trim()] }; }

        if (line === 'close') { return { cmd: 'close', args: [] }; }

        m = line.match(/^wait\s+(\d+)/);
        if (m) { return { cmd: 'wait', args: [parseInt(m[1], 10)] }; }

        m = line.match(/^if\s+(\w+)\s*==\s*"([^"]*)"\s*then/);
        if (m) { return { cmd: 'if', args: [m[1], m[2]] }; }

        m = line.match(/^menu\s+"([^"]*)"/);
        if (m) { return { cmd: 'menu', args: [m[1]] }; }

        m = line.match(/^menuitem\s+"([^"]*)"\s+(run|close|print|msg)\s*(.*)/);
        if (m) { return { cmd: 'menuitem', args: [m[1], m[2], m[3] || ''] }; }

        if (line === 'menusep') { return { cmd: 'menusep', args: [] }; }

        m = line.match(/^canvas\s+(\d+)\s+(\d+)/);
        if (m) { return { cmd: 'canvas', args: [parseInt(m[1], 10), parseInt(m[2], 10)] }; }

        if (line.trim() === 'draw') { return { cmd: 'draw', args: [] }; }

        /* ---- new rim commands (do not shadow legacy patterns) ---- */
        if (line === 'parallel') { return { cmd: 'parallel', args: [] }; }

        m = line.match(/^send\s+"([^"]*)"\s*(?:"([^"]*)")?/);
        if (m) { return { cmd: 'send', args: [m[1], m[2] === undefined ? null : m[2]] }; }

        return null;
    }

    /**
     * parseBlock(lines, startIndex) -> { lines, next }
     *   Collects lines until a matching `end`, honouring nesting depth of
     *   block-opening commands (button..run, if..then, draw, parallel).
     */
    var BLOCK_OPENERS = ['button', 'if', 'draw', 'parallel'];

    function opensBlock(cmd) {
        if (!cmd) { return false; }
        if (cmd.cmd === 'button') { return cmd.args[1] === 'run'; }
        return BLOCK_OPENERS.indexOf(cmd.cmd) !== -1 && cmd.cmd !== 'button';
    }

    /**
     * parseScript(code) -> command[]   (legacy top-level shape)
     */
    function parseScript(code) {
        var lines = String(code).split('\n');
        var commands = [];
        var i = 0;
        while (i < lines.length) {
            var line = lines[i].trim();
            if (!line || line.indexOf('//') === 0) { i += 1; continue; }
            var parts = parseLine(line);
            if (!parts) { i += 1; continue; }
            if (parts.cmd === 'end') { i += 1; continue; }

            if (opensBlock(parts)) {
                i += 1;
                var depth = 1;
                var blockLines = [];
                while (i < lines.length) {
                    var bline = lines[i].trim();
                    var bp = parseLine(bline);
                    if (bline === 'end') {
                        depth -= 1;
                        if (depth === 0) { break; }
                        blockLines.push(bline);
                        i += 1;
                        continue;
                    }
                    if (opensBlock(bp)) { depth += 1; }
                    blockLines.push(bline);
                    i += 1;
                }
                parts.block = blockLines;
            }
            commands.push(parts);
            i += 1;
        }
        return commands;
    }

    /* =================================================================
     * 2. Execution context
     * ============================================================== */

    /**
     * A context is one running script: its variables, its current window,
     * its menu model and its cancellation flag. Parallel branches share
     * the variables of their parent so `set` is visible to both.
     */
    function Context(code, opts) {
        this.id = 'rf_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        this.vars = {};
        this.windowId = null;
        this.win = null;
        this.menuItems = [];
        this.cancelled = false;
        this.opts = opts || {};
        this.buttons = [];
        this.output = [];          /* print() lines, for headless testing */
        this.depth = 0;
        this.parent = null;
    }

    Context.prototype.checkCancel = function () {
        if (this.cancelled) { throw { __rfCancel: true }; }
    };

    /* =================================================================
     * 3. Output
     * ============================================================== */

    function printLine(ctx, text, cls) {
        var line = String(text);
        ctx.output.push({ text: line, cls: cls || '' });
        var nc = G.EznK.Shell && G.EznK.Shell.notifications;
        /* legacy `print` wrote to the shell console; a toast is the
         * closest equivalent and is visible without opening a window */
        if (ctx.windowId) {
            var w = ui.Window.Get(ctx.windowId);
            if (w.status === S.OK) {
                var lbl = new ui.controls.Label({
                    x: 12,
                    y: 12 + ctx.output.length * 18,
                    width: w.value.client.width - 24,
                    text: line
                });
                w.value.addControl(lbl);
                return;
            }
        }
        if (nc) { nc.push({ title: 'rf', text: line, level: cls === 'error' ? 'error' : 'info', timeout: 2500 }); }
    }

    /* =================================================================
     * 4. Command execution
     * ============================================================== */

    /**
     * run(commands, ctx) -> Promise<{status, value: ctx}>
     *   Sequential execution; `wait` yields, `parallel` forks.
     *
     *   The loop is driven step-by-step so `close` inside a block really
     *   stops the remaining commands: a pre-built forEach chain would
     *   already have queued them before the cancel flag is set.
     */
    function run(commands, ctx) {
        var idx = 0;
        function step() {
            if (idx >= commands.length) { return Promise.resolve(); }
            if (ctx.cancelled) { throw { __rfCancel: true }; }
            var cmd = commands[idx];
            idx += 1;
            return Promise.resolve(exec(cmd, ctx, commands, idx - 1)).then(step);
        }
        return Promise.resolve().then(step).then(function () {
            /* Legacy behaviour: the menu bar is attached after the script
             * has declared every menu / menuitem for this window. */
            renderMenu(ctx);
            return CORE.ok(ctx);
        }, function (err) {
            if (err && err.__rfCancel) {
                return CORE.fail(S.EPOWEROFF, { reason: 'rf script cancelled' });
            }
            LOG.error('rf script error: ' + (err && (err.stack || err.message || err)));
            return CORE.fail(S.EFAULT, { reason: 'rf runtime error: ' + (err && err.message ? err.message : String(err)) });
        });
    }

    function exec(cmd, ctx, all, index) {
        void all; void index;
        switch (cmd.cmd) {

            /* ---------------- window ---------------- */
            case 'window':
                return createWindow(cmd, ctx);

            /* ---------------- content ---------------- */
            case 'menu':
                ctx.menuItems.push({ type: 'menu', label: cmd.args[0], items: [] });
                return null;

            case 'menuitem':
                if (ctx.menuItems.length > 0 && ctx.menuItems[ctx.menuItems.length - 1].type === 'menu') {
                    ctx.menuItems[ctx.menuItems.length - 1].items.push({
                        label: cmd.args[0],
                        action: cmd.args[1],
                        arg: cmd.args[2]
                    });
                }
                return null;

            case 'menusep':
                if (ctx.menuItems.length > 0 && ctx.menuItems[ctx.menuItems.length - 1].type === 'menu') {
                    ctx.menuItems[ctx.menuItems.length - 1].items.push({ separator: true });
                }
                return null;

            case 'label':
                return addWidget(ctx, 'label', cmd.args);

            case 'button':
                return addWidget(ctx, 'button', cmd.args, cmd.block);

            case 'canvas':
                return addWidget(ctx, 'canvas', cmd.args);

            case 'draw':
                return addWidget(ctx, 'draw', [], cmd.block);
            /* ---------------- output ---------------- */
            case 'print':
                printLine(ctx, cmd.args[0], '');
                return null;

            case 'python':
                return runPython(ctx, cmd.args[0]);

            case 'msg':
                return showMsg(ctx, cmd.args[0], cmd.args[1]);

            case 'ask':
                return ask(ctx, cmd.args[0], cmd.args[1], cmd.args[2]);

            case 'input':
                return askInput(ctx, cmd.args[0], cmd.args[1]);

            /* ---------------- state ---------------- */
            case 'set':
                ctx.vars[cmd.args[0]] = cmd.args[1];
                return null;

            case 'close':
                return doClose(ctx);

            /* ---------------- timing ---------------- */
            case 'wait':
                return TIME.wait(cmd.args[0]);

            /* ---------------- control flow ---------------- */
            case 'if':
                var value = ctx.vars[cmd.args[0]] || '';
                if (String(value) === cmd.args[1] && cmd.block) {
                    var sub = parseScript(cmd.block.join('\n'));
                    return run(sub, ctx);
                }
                return null;

            /* ---------------- concurrency (new) ---------------- */
            case 'parallel':
                if (!cmd.block) { return null; }
                var pctx = new Context('', ctx.opts);
                pctx.vars = ctx.vars;         /* shared variable table */
                pctx.parent = ctx;
                pctx.windowId = ctx.windowId;
                pctx.win = ctx.win;
                var subCmds = parseScript(cmd.block.join('\n'));
                /* fire and continue: parallel must not block the main flow */
                run(subCmds, pctx).then(null, function (e) {
                    LOG.warn('parallel branch error: ' + (e && e.reason));
                });
                return null;

            /* ---------------- messaging (new) ---------------- */
            case 'send':
                return doSend(ctx, cmd.args[0], cmd.args[1]);

            default:
                return null;
        }
    }

    /* =================================================================
     * 5. Window & widgets
     * ============================================================== */

    function createWindow(cmd, ctx) {
        var title = cmd.args[0];
        var w = cmd.args[1] || 400;
        var h = cmd.args[2] || 300;
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: title, width: w, height: h, icon: '[R]', ecosystem: 'script', appId: 'rf:' + title })
            : ui.Window.Create({ title: title, width: w, height: h, icon: '[R]', ecosystem: 'script' });
        if (created.status !== S.OK) {
            LOG.error('rf window create failed: ' + created.reason);
            return null;
        }
        ctx.win = created.value;
        ctx.windowId = ctx.win.id;
        ctx.menuItems = [];
        return null;
    }

    /**
     * renderMenu(ctx) - attach the rf menu model to the live window as a
     * real Ezn32 UI menu control. Legacy behaviour: the menu bar appears
     * at the top of the client area once all menus are declared.
     */
    function renderMenu(ctx) {
        if (!ctx.win || !ctx.menuItems.length) { return; }
        if (ctx._menuControl) { return; }   /* one menu bar per window */
        var self = ctx;
        var menus = ctx.menuItems.map(function (m) {
            return {
                id: m.label,
                text: m.label,
                items: m.items.map(function (it) {
                    if (it.separator) { return { separator: true, text: '' }; }
                    return {
                        id: it.label,
                        text: it.label,
                        onClick: function () {
                            if (it.action === 'close') { doClose(self); return; }
                            if (it.action === 'print') { printLine(self, it.arg, ''); return; }
                            if (it.action === 'msg') { showMsg(self, it.label, it.arg); return; }
                        }
                    };
                })
            };
        });
        var bar = new ui.controls.Menu({
            x: 0, y: 0,
            width: Math.max(80, ctx.win.client.width),
            menus: menus
        });
        /* shift existing controls down to make room for the bar */
        ctx.win.client.children.forEach(function (c) {
            if (c !== bar) { c.y += ui.controls.Menu.BAR_H; }
        });
        ctx.win.addControl(bar);
        ctx._menuControl = bar;
    }

    function addWidget(ctx, type, args, block) {        if (!ctx.win) { return null; }
        var client = ctx.win.client;

        if (type === 'label') {
            var text = args[0];
            var align = args[1] || 'left';
            var lbl = new ui.controls.Label({
                x: 12,
                y: 12 + ctx.nextY(),
                width: Math.max(40, client.width - 24),
                height: 18,
                text: text,
                align: align === 'center' ? 'center' : 'left'
            });
            ctx.win.addControl(lbl);
            return null;
        }

        if (type === 'button') {
            var btext = args[0];
            var action = args[1];
            var self = ctx;
            var btn = new ui.controls.Button({
                x: 12,
                y: 12 + ctx.nextY(),
                width: Math.max(90, Math.min(200, btext.length * 10 + 24)),
                height: 26,
                text: btext,
                onClick: function () {
                    if (action === 'close') {
                        doClose(self);
                        return;
                    }
                    if (action === 'run' && block) {
                        if (self.cancelled) { return; }
                        var subCmds = parseScript(block.join('\n'));
                        run(subCmds, self);
                    }
                }
            });
            ctx.win.addControl(btn);
            ctx.buttons.push(btn);
            return null;
        }

        if (type === 'canvas') {
            var cw = args[0] || 200;
            var ch = args[1] || 120;
            var y = 12 + ctx.nextY();
            var surf = ui.canvas.Create(null, cw, ch);
            /* rf canvas: a canvas surface positioned inside the window.
             * The `draw` block paints it through the Ezn32 UI canvas API. */
            var holder = new ui.Control({ x: 12, y: y, width: cw, height: ch });
            holder.onPaint = function (dc) {
                var img = surf.value && !surf.value.disposed ? surf.value.element : null;
                if (img) { ezn32.api.gdi.DrawImage(dc, img, 0, 0, cw, ch); }
            };
            ctx.win.addControl(holder);
            ctx._canvas = surf.value;
            ctx.advanceY(ch + 8);
            return null;
        }

        if (type === 'draw') {
            if (!block || !ctx._canvas) { return null; }
            /* The draw block is raw JS that the legacy runtime executed with
             * `new Function`. We keep that behaviour (scripts rely on it)
             * but expose the canvas through a per-script element so
             * document.getElementById("rf-canvas") keeps working. */
            try {
                var scriptContent = block.join('\n');
                var cv = ctx._canvas.element;
                cv.id = 'rf-canvas';
                /* Drawing goes through the GDI device context that the
                 * canvas surface already owns (rule 2: one implementation).
                 * The legacy `getContext("2d")` call in old rf scripts is
                 * served by handing back that same context. */
                var surfaceDc = ctx._canvas.dc;
                var compatCtx = surfaceDc.ctx;
                if (!cv.__ezntCtxShim) {
                    cv.__ezntCtxShim = true;
                    var nativeGetContext = cv.getContext.bind(cv);
                    cv.getContext = function (kind, opts) {
                        if (kind === '2d') { return compatCtx; }
                        return nativeGetContext(kind, opts);
                    };
                }
                var fn = new Function('canvas', 'ctx', 'EZNT', 'Ezn32', scriptContent);
                fn(cv, compatCtx, G.EZNT, G.ezn32);
            } catch (err) {
                printLine(ctx, 'RF Draw Error: ' + (err && err.message), 'error');
            }
            return null;
        }

        return null;
    }

    /* vertical cursor helper for rf widget stacking */
    Context.prototype.nextY = function () {
        if (this._y === undefined) { this._y = 0; }
        var y = this._y;
        this._y += 34;
        return y;
    };
    Context.prototype.advanceY = function (h) {
        if (this._y === undefined) { this._y = 0; }
        this._y += h;
    };

    /* =================================================================
     * 6. Dialog commands
     * ============================================================== */

    function showMsg(ctx, title, content) {
        var win = ctx.win;
        if (win && ui.controls.Dialog) {
            ui.controls.Dialog.alert(win, content, title, 'info');
            return null;
        }
        var nc = G.EznK.Shell && G.EznK.Shell.notifications;
        if (nc) { nc.push({ title: title, text: content, level: 'info', timeout: 3500 }); }
        return null;
    }

    function ask(ctx, title, content, varName) {
        var win = ctx.win;
        if (win && ui.controls.Dialog) {
            return ui.controls.Dialog.confirm(win, content, title).then(function (r) {
                ctx.vars[varName] = (r.status === S.OK && r.value) ? 'yes' : 'no';
                return null;
            });
        }
        ctx.vars[varName] = 'no';
        return null;
    }

    function askInput(ctx, promptText, varName) {
        var win = ctx.win;
        if (win && ui.controls.Dialog) {
            return ui.controls.Dialog.prompt(win, promptText).then(function (r) {
                if (r.status === S.OK) { ctx.vars[varName] = r.value; }
                return null;
            });
        }
        ctx.vars[varName] = '';
        return null;
    }

    /* =================================================================
     * 7. Close / messaging / python
     * ============================================================== */

    function doClose(ctx) {
        if (ctx.win) {
            ctx.win.destroy();
            ctx.win = null;
            ctx.windowId = null;
        }
        ctx.cancelled = true;
        return null;
    }

    function doSend(ctx, channel, text) {
        var msg = G.EznK.Kernel.message;
        if (!msg) { return null; }
        var payload = text === null || text === undefined
            ? { from: ctx.id, value: ctx.vars['last'] || null }
            : { from: ctx.id, text: text };
        msg.publish(channel, payload);
        ctx.vars['last'] = text;
        return null;
    }

    function runPython(ctx, code) {
        var py = G.EznK.Runtime && G.EznK.Runtime.python;
        if (!py) {
            printLine(ctx, 'Python runtime is not available.', 'error');
            return null;
        }
        return py.run(code).then(function (r) {
            if (r.status !== S.OK) {
                printLine(ctx, 'Python error: ' + (r.reason || r.value), 'error');
            } else if (r.value !== null && r.value !== undefined && r.value !== '') {
                printLine(ctx, String(r.value));
            }
            return null;
        });
    }

    /* =================================================================
     * 8. Public API
     * ============================================================== */

    /**
     * runScript(code, opts) -> Promise<{status, value: ctx}>
     *   opts.headless - do not create windows (used by tests)
     */
    function runScript(code, opts) {
        if (typeof code !== 'string') {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'script code must be a string' }));
        }
        var ctx = new Context(code, opts || {});
        var commands = parseScript(code);
        return run(commands, ctx);
    }

    /** runFile(path) -> Promise  load a .rf file and run it. */
    function runFile(path) {
        if (typeof path !== 'string' || path.length === 0) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'path required' }));
        }
        return K.ReadFileText(path).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return runScript(r.value, { path: path });
        });
    }

    /** parse(code) -> command[]  exposed for tests and tooling. */
    function parse(code) {
        return CORE.ok(parseScript(code));
    }

    function boot() {
        var srm = G.EznK.Kernel.SRM;
        if (srm) {
            srm.registerService('rf-runtime', {
                init: function () { LOG.info('rf runtime online'); }
            });
            srm.registerFunction('rf.run', function (code) { return runScript(code); }, 'run rf source');
            srm.registerFunction('rf.runFile', function (p) { return runFile(p); }, 'run rf file');
        }
        return CORE.ok(true);
    }

    var RF = {};
    RF.version = '1.0.0';
    RF.boot = boot;
    RF.shutdown = function () { return CORE.ok(true); };

    RF.runScript = runScript;
    RF.runFile = runFile;
    RF.parse = parse;
    RF.parseLine = parseLine;
    RF.Context = Context;

    if (!G.EznK.Runtime) { G.EznK.Runtime = {}; }
    G.EznK.Runtime.rf = RF;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('runtime-rf', RF);
    }
    LOG.info('js/runtime/rf.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
