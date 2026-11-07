/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L6 应用层
 *
 *   文件 : js/apps/chat.js
 *   模块 : EznK.Apps.chat
 *   层级 : L6 应用层
 *
 *   聊天室 —— 对应 PTD.html 的 v160chat 窗口。
 *   单机版聊天室：消息保存在系统数据盘，多个窗口/多个用户之间
 *   通过内核消息总线实时同步，可以当作本地即时消息测试床。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Apps && G.EznK.Apps.chat) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var ui = ezn32.ui;
    var St = G.EznK.Platform.Storage;

    var APP = { id: 'chat', displayName: '聊天室', icon: '💬', width: 640, height: 520 };
    var MSG_KEY = '/System/ChatMessages.json';
    var TOPIC = 'chat:message';
    var MAX_MSGS = 200;

    var st = { win: null, list: null, input: null, status: null, messages: [], listener: null };

    function currentName() {
        var u = G.EznK.Service.user;
        var cur = u ? u.currentUser().value : null;
        return cur ? cur.name : '访客';
    }

    function loadMessages() {
        var r = St.config.get(MSG_KEY, []);
        st.messages = (r.status === S.OK && Array.isArray(r.value)) ? r.value : [];
        return st.messages;
    }

    function saveMessages() {
        if (st.messages.length > MAX_MSGS) { st.messages = st.messages.slice(-MAX_MSGS); }
        St.config.set(MSG_KEY, st.messages);
    }

    function renderMessages() {
        if (!st.list) { return; }
        st.list.setItems(st.messages.map(function (m) {
            return {
                id: m.id,
                text: '[' + new Date(m.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) +
                      '] ' + m.from + ':  ' + m.text,
                icon: '💬'
            };
        }));
        /* 滚动到底部 */
        if (st.list.items && st.list.items.length) {
            st.list.selectIndex(st.list.items.length - 1);
        }
        if (st.status) { st.status.setPane('main', st.messages.length + ' 条消息'); }
        if (st.win) { st.win.invalidate(); }
    }

    function send(text) {
        var t = String(text || '').trim();
        if (!t) { return CORE.fail(S.EINVAL, { reason: '消息不能为空' }); }
        var msg = {
            id: 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
            from: currentName(),
            text: t.slice(0, 500),
            at: Date.now()
        };
        st.messages.push(msg);
        saveMessages();
        renderMessages();
        /* 通过内核消息总线广播，其他打开的聊天室窗口实时收到 */
        var srm = G.EznK.Kernel.SRM;
        if (srm) { srm.emit(TOPIC, msg); }
        return CORE.ok(msg);
    }

    function open() {
        var svc = G.EznK.Service && G.EznK.Service.window;
        var created = svc
            ? svc.open({ title: '聊天室', width: APP.width, height: APP.height, icon: APP.icon, appId: APP.id })
            : ui.Window.Create({ title: '聊天室', width: APP.width, height: APP.height, icon: APP.icon });
        if (created.status !== S.OK) { return created; }

        var win = created.value;
        st.win = win;
        var client = win.client;

        var list = new ui.controls.ListBox({
            x: 0, y: 0, width: client.width, height: client.height - 62
        });
        client.addChild(list);
        st.list = list;

        var input = new ui.controls.Edit({
            x: 8, y: client.height - 54, width: client.width - 100, height: 28,
            placeholder: '输入消息后按回车发送…', allowUnicode: true
        });
        input.onEnter = function () {
            var v = input.getValue();
            if (send(v).status === S.OK) { input.setValue(''); }
        };
        client.addChild(input);
        st.input = input;

        client.addChild(new ui.controls.Button({
            x: client.width - 86, y: client.height - 54, width: 78, height: 28,
            text: '发送', variant: 'primary',
            onClick: function () {
                var v = input.getValue();
                if (send(v).status === S.OK) { input.setValue(''); }
            }
        }));

        var sb = new ui.controls.StatusBar({
            x: 0, y: client.height - 22, width: client.width, height: 22,
            panes: [{ id: 'main', text: '就绪', flex: 1 }]
        });
        client.addChild(sb);
        st.status = sb;

        loadMessages();
        renderMessages();

        /* 订阅其他窗口发来的消息 */
        var srm = G.EznK.Kernel.SRM;
        if (srm && typeof srm.on === 'function') {
            var h = srm.on(TOPIC, function (msg) {
                if (!msg || !msg.id) { return; }
                var exists = st.messages.some(function (m) { return m.id === msg.id; });
                if (exists) { return; }
                st.messages.push(msg);
                renderMessages();
            });
            if (h && h.status === S.OK) { st.listener = h.value; }
        }

        win.onDestroy = function () {
            if (st.listener) {
                try { srm.off(st.listener); } catch (_) {}
                st.listener = null;
            }
            st.win = null;
            st.list = null;
        };

        win.invalidate();
        return CORE.ok(win);
    }

    function register() {
        var r = G.EznK.Service && G.EznK.Service.appRegistry;
        if (r) { r.register({ id: APP.id, name: '聊天室', icon: APP.icon, category: 'internet', builtin: true }); }
        return CORE.ok(true);
    }

    var CH = {
        version: '1.0.0', id: APP.id, displayName: '聊天室', icon: APP.icon,
        open: open, register: register, send: send, messages: function () { return CORE.ok(st.messages.slice(0)); }
    };
    G.EznK.Apps.chat = CH;
    register();
    CORE.createLogger('EznK/L6:chat').info('js/apps/chat.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
