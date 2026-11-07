/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 3 - Kernel Layer (SRM)
 *
 *   File    : js/kernel/message.js
 *   Module  : EznK.Kernel.Message
 *   Layer   : L3 内核层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The message bus (contract 7.3):
 *
 *     sendMessage(toPid, data)   -> SRM  (legacy, chainable)
 *     broadcast(data)            -> SRM  (legacy)
 *     onMessage(pid, callback)   -> SRM  (legacy, subscribe)
 *     getMessages(pid)           -> array
 *     clearMessages(pid)         -> SRM
 *
 *   ---- LEGACY SEMANTICS ----
 *   sendMessage queues {from:'system', data, time} on the target pid and
 *   invokes every listener registered for that pid. broadcast fans out to
 *   every live process.
 *
 *   ---- TOPIC CHANNEL (for rf `send` / ecosystem isolation) ----
 *   publish(topic, data) / subscribe(topic, fn) deliver to subscribers
 *   without needing a pid. Different from the kernel EventBus: this
 *   channel carries PROCESS messages and honours the process table.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Kernel && G.EznK.Kernel.Message &&
        G.EznK.Kernel.Message.__isMessage === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var SRM = G.SRM;
    if (!CORE || !SRM) {
        throw new Error('[EznK/L3] kernel/message.js requires core modules');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('EznK/L3:message');

    var queues = Object.create(null);      /* pid -> [msg] */
    var listeners = Object.create(null);   /* pid -> [fn] */
    var topics = Object.create(null);      /* topic -> [fn] */
    var MAX_QUEUE = 500;

    /* =================================================================
     * 1. Legacy contract
     * ============================================================== */

    function sendMessage(toPid, data) {
        if (typeof toPid !== 'string' || toPid.length === 0) {
            LOG.warn('sendMessage: invalid pid');
            return SRM;
        }
        if (!queues[toPid]) { queues[toPid] = []; }
        var envelope = {
            from: 'system',
            data: data,
            time: new Date().toISOString(),
            at: Date.now()
        };
        queues[toPid].push(envelope);
        if (queues[toPid].length > MAX_QUEUE) {
            queues[toPid].splice(0, queues[toPid].length - MAX_QUEUE);
        }
        notifyPid(toPid, data, envelope);
        return SRM;
    }

    function broadcast(data) {
        var procs = SRM.listProcesses() || {};
        Object.keys(procs).forEach(function (pid) {
            sendMessage(pid, data);
        });
        return SRM;
    }

    function onMessage(pid, callback) {
        if (typeof pid !== 'string' || pid.length === 0) {
            LOG.warn('onMessage: invalid pid');
            return SRM;
        }
        if (typeof callback !== 'function') {
            LOG.warn('onMessage: callback must be a function');
            return SRM;
        }
        if (!listeners[pid]) { listeners[pid] = []; }
        listeners[pid].push(callback);
        return SRM;
    }

    function getMessages(pid) {
        return (queues[pid] || []).slice(0);
    }

    function clearMessages(pid) {
        queues[pid] = [];
        return SRM;
    }

    function notifyPid(pid, data, envelope) {
        var list = listeners[pid];
        if (!list || !list.length) { return; }
        list.slice(0).forEach(function (fn) {
            try {
                fn(data, envelope);
            } catch (err) {
                LOG.error('message listener for ' + pid + ' threw: ' + (err && err.message));
            }
        });
    }

    /* =================================================================
     * 2. Topic channel
     * ============================================================== */

    /** publish(topic, data) -> { status, value: {delivered} } */
    function publish(topic, data) {
        if (typeof topic !== 'string' || topic.length === 0) {
            return fail(S.EINVAL, { reason: 'topic must be a non-empty string' });
        }
        var list = topics[topic];
        if (!list || !list.length) { return ok({ delivered: 0 }); }
        var errors = 0;
        list.slice(0).forEach(function (rec) {
            try {
                rec.fn(data, { topic: topic });
            } catch (err) {
                errors += 1;
                LOG.error('topic listener "' + topic + '" threw: ' + (err && err.message));
            }
        });
        return ok({ delivered: list.length, errors: errors });
    }

    /** subscribe(topic, fn) -> { status, value: handle } */
    function subscribe(topic, fn) {
        if (typeof topic !== 'string' || topic.length === 0) {
            return fail(S.EINVAL, { reason: 'topic must be a non-empty string' });
        }
        if (typeof fn !== 'function') {
            return fail(S.EINVAL, { reason: 'handler must be a function' });
        }
        if (!topics[topic]) { topics[topic] = []; }
        var handle = topic + '#' + (topics[topic].length + 1) + '#' + Date.now();
        topics[topic].push({ handle: handle, fn: fn });
        return ok(handle);
    }

    /** unsubscribe(handle) -> { status, value: boolean } */
    function unsubscribe(handle) {
        var names = Object.keys(topics);
        for (var i = 0; i < names.length; i++) {
            var list = topics[names[i]];
            for (var j = 0; j < list.length; j++) {
                if (list[j].handle === handle) {
                    list.splice(j, 1);
                    return ok(true);
                }
            }
        }
        return fail(S.ENOENT, { reason: 'unknown subscription handle' });
    }

    /** Receive one message synchronously (pull model for rf `wait(send)`). */
    function receive(pid) {
        var q = queues[pid];
        if (!q || !q.length) { return fail(S.ENOENT, { reason: 'no pending message', pid: pid }); }
        return ok(q.shift());
    }

    function stats() {
        var pids = Object.keys(queues);
        var total = pids.reduce(function (n, pid) { return n + queues[pid].length; }, 0);
        return ok({
            queues: pids.length,
            pending: total,
            listeners: Object.keys(listeners).length,
            topics: Object.keys(topics).length
        });
    }

    /** Strict send with status result. */
    function rsSend(toPid, data) {
        if (typeof toPid !== 'string' || toPid.length === 0) {
            return fail(S.EINVAL, { reason: 'pid must be a non-empty string' });
        }
        sendMessage(toPid, data);
        return ok(true);
    }

    /* =================================================================
     * 3. Module
     * ============================================================== */

    var Msg = {};
    Msg.__isMessage = true;
    Msg.version = '1.0.0';
    Msg.STATUS = S;

    Msg.sendMessage = sendMessage;
    Msg.broadcast = broadcast;
    Msg.onMessage = onMessage;
    Msg.getMessages = getMessages;
    Msg.clearMessages = clearMessages;

    Msg.publish = publish;
    Msg.subscribe = subscribe;
    Msg.unsubscribe = unsubscribe;
    Msg.receive = receive;
    Msg.send = rsSend;
    Msg.stats = stats;

    Msg.bind = ['sendMessage', 'broadcast', 'onMessage', 'getMessages', 'clearMessages'];

    Msg.boot = function () {
        LOG.info('message bus online');
        return ok(true);
    };
    Msg.shutdown = function () {
        queues = Object.create(null);
        listeners = Object.create(null);
        topics = Object.create(null);
        return ok(true);
    };

    SRM.register('message', Msg);
    LOG.info('kernel/message.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
