/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L6 应用层
 *
 *   文件 : js/apps/python-shell.js
 *   模块 : EznK.Apps.pythonShell
 *   层级 : L6 应用层
 *
 *   Python Shell —— 对应 PTD.html 的 shell 窗口。
 *   交互式 Python 终端：输入代码、回车执行、显示输出。
 *   Python 环境未安装时提示一键安装。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.pythonShell) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;

    var APP = { id: 'python-shell', displayName: 'Python 终端', icon: '🐍', width: 720, height: 480 };
    var st = { win: null, output: null, input: null, status: null, lines: [], history: [], histIdx: -1 };

    function py() { return G.EznK.Runtime && G.EznK.Runtime.python; }

    /** 该行是否含中文（中文用 ui 字体渲染，等宽字体的中文会重叠） */
    function hasCJK(s) {
        return /[\u3400-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/.test(String(s));
    }

    function renderOutput() {
        if (!st.output) { return; }
        st.output.invalidate();
    }

    function append(text, kind) {
        st.lines.push({ text: String(text), kind: kind || 'out' });
        if (st.lines.length > 500) { st.lines.shift(); }
        renderOutput();
    }

    function prompt() {
        var ready = py() && py().isReady();
        return ready ? '>>> ' : '（Python 未安装）>>> ';
    }

    function runLine(src) {
        if (!src.trim()) { return; }
        append(prompt() + src, 'in');
        st.history.push(src);
        st.histIdx = st.history.length;
        var p = py();
        if (!p) { append('Python 运行时不可用', 'err'); return; }
        if (!p.isReady()) {
            append('Python 尚未安装。请到「控制面板 → 程序 → Python 环境」安装，或在此按"安装"。', 'err');
            return;
        }
        var beforeCount = st.lines.length;
        p.run(src).then(function (r) {
            if (r.status !== S.OK) {
                append(String(r.reason || '执行失败'), 'err');
                return;
            }
            var v = r.value;
            /* print 的输出已经通过 sink 实时写入终端，这里只处理表达式返回值。
             * 不再因为返回 null 就显示"（无输出）"，否则 print 之后会多一行废话。 */
            var viaSink = st.lines.length > beforeCount;
            if ((v === null || v === undefined || v === '') && !viaSink) {
                append('（无输出）', 'dim');
            } else if (v !== null && v !== undefined && v !== '') {
                append(String(v), 'out');
            }
        });
    }

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: 'Python 终端', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: 'Python 终端', width: APP.width, height: APP.height, icon: APP.icon });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        st.win = win;
        var client = win.client;

        /* 输出区：自绘多行文本 */
        var out = new ui.Control({ x: 0, y: 0, width: client.width, height: client.height - 96 });
        out.clipChildren = true;
        out.onPaint = function (dc) {
            var t = ui.res.theme().value;
            var gdi = ezn32.api.gdi;
            gdi.FillRect(dc, 0, 0, out.width, out.height, '#0c0c0c');
            gdi.SelectObject(dc, hasCJK(L.text) ? ui.res.font('ui') : ui.res.font('mono'));
            var lineH = 17;
            var maxLines = Math.floor((out.height - 10) / lineH);
            var start = Math.max(0, st.lines.length - maxLines);
            for (var i = start; i < st.lines.length; i++) {
                var L = st.lines[i];
                var color = L.kind === 'in' ? '#7fd1ff'
                    : L.kind === 'err' ? '#ff6b6b'
                    : L.kind === 'dim' ? '#777777' : '#d8d8d8';
                gdi.SetTextColor(dc, color);
                var y = 6 + (i - start) * lineH;
                String(L.text).split('\n').forEach(function (part, k) {
                    gdi.DrawTextTruncated(dc, part, 8, y + k * lineH, out.width - 16);
                });
            }
        };
        client.addChild(out);
        st.output = out;

        /* 输入区 */
        client.addChild(new ui.controls.Label({
            x: 8, y: client.height - 88, width: 40, text: '>>>',
            color: 'textSecondary', font: 'mono'
        }));
        var inp = new ui.controls.Edit({
            x: 44, y: client.height - 92, width: client.width - 52, height: 26,
            font: 'mono', allowUnicode: true
        });
        inp.onEnter = function () {
            var v = inp.getValue();
            inp.setValue('');
            runLine(v);
        };
        client.addChild(inp);
        st.input = inp;

        client.addChild(new ui.controls.Button({
            x: 8, y: client.height - 58, width: 100, height: 26, text: '▶  运行',
            variant: 'primary',
            onClick: function () {
                var v = inp.getValue();
                inp.setValue('');
                runLine(v);
            }
        }));
        client.addChild(new ui.controls.Button({
            x: 114, y: client.height - 58, width: 100, height: 26, text: '🗑  清屏',
            onClick: function () { st.lines = []; renderOutput(); }
        }));
        client.addChild(new ui.controls.Button({
            x: 220, y: client.height - 58, width: 130, height: 26, text: '🐍  安装 Python',
            onClick: function () {
                var p = py();
                if (!p) { return; }
                append('正在安装 Python 运行环境…', 'dim');
                p.install().then(function (r) {
                    append(r.status === S.OK ? 'Python 环境已就绪。' : ('安装失败：' + (r.reason || '')),
                        r.status === S.OK ? 'out' : 'err');
                });
            }
        }));

        var sb = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 18,
            panes: [{ id: 'main', text: py() && py().isReady() ? 'Python 已就绪' : 'Python 未安装', flex: 1 }]
        });
        client.addChild(sb);
        st.status = sb;

        append('EZNT Python 终端 —— 输入 Python 代码后按回车执行。', 'dim');
        append('示例：  print("你好，EZNT")     1 + 2     import math; math.pi', 'dim');
        append('', 'dim');

        /* 自适应布局：输出区跟随高度，输入/按钮行与状态栏贴底 */
        win._layoutFn = function (cw, ch) {
            out.width = cw;
            out.height = Math.max(40, ch - 96);
            inp.y = ch - 92;
            inp.width = Math.max(80, cw - 52);
            var btnY = ch - 58;
            win.client.children.forEach(function (c) {
                if (c.constructor && c.constructor.name === 'Label') {
                    if (String(c.text || '') === '>>>') { c.y = ch - 88; }
                }
            });
            if (st.status) { st.status.y = ch - 22; st.status.width = cw; }
            /* 三个按钮 */
            var bi = 0;
            var bx = [8, 114, 220];
            win.client.children.forEach(function (c) {
                if (c.constructor && c.constructor.name === 'Button') {
                    c.y = btnY;
                    c.x = bx[bi] !== undefined ? bx[bi] : (bx[2] + 140);
                    bi++;
                }
            });
            win.client.invalidate();
        };

        /* 注册 stdout/stderr 接收器：Python 的 print 直接显示在终端里 */
        var unregister = null;
        try {
            var pysvc = py();
            if (pysvc && typeof pysvc.registerSink === 'function') {
                unregister = pysvc.registerSink(function (line, cls) {
                    st.lines.push({ text: String(line), kind: cls === 'error' ? 'err' : 'out' });
                    if (st.lines.length > 500) { st.lines.shift(); }
                    renderOutput();
                });
            }
        } catch (_) {}

        var oldDestroy = win.onDestroy;
        win.onDestroy = function () {
            if (typeof unregister === 'function') { unregister(); }
            if (typeof oldDestroy === 'function') { oldDestroy(); }
            if (st.win === win) { st.win = null; }
        };

        win.invalidate();
        setTimeout(function () { if (inp.focus) { inp.focus(); } }, 100);
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) {
            r.register({ id: APP.id, name: 'Python 终端', icon: APP.icon, category: 'tools', builtin: true, exts: ['.py'] });
        }
        return CORE.ok(true);
    }

    var PS = {
        version: '1.0.0', id: APP.id, displayName: 'Python 终端', icon: APP.icon,
        open: open, register: register, runLine: runLine,
        state: function () { return st; }
    };
    G.EznK.Apps.pythonShell = PS;
    register();
    CORE.createLogger('EznK/L6:pyshell').info('js/apps/python-shell.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
