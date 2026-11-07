/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 3 - Kernel Layer (SRM)
 *
 *   File    : js/kernel/log.js
 *   Module  : EznK.Kernel.Log
 *   Layer   : L3 内核层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The system log (contract: SRM.getLog / SRM.clearLog).
 *
 *     add(category, level, message, detail?) -> { status, value: entry }
 *     getLog(filter?) -> { status, value: entry[] }   (legacy sig kept)
 *     clearLog() -> { status, value: true }
 *     stats() -> { status, value: {count, byLevel, byCategory} }
 *     tail(n) -> { status, value: entry[] }
 *     setCapacity(n) -> { status, value: true }
 *
 *   Bounded ring buffer (default 2000 entries) so a runaway script cannot
 *   exhaust memory (hard rule #6: every resource is bounded).
 *
 *   Legacy semantics preserved: SRM.getLog(type) filters by category and
 *   each entry keeps { type, message, time } fields.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Kernel && G.EznK.Kernel.Log &&
        G.EznK.Kernel.Log.__isLog === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var SRM = G.SRM;
    if (!CORE || !SRM) {
        throw new Error('[EznK/L3] kernel/log.js requires platform/core.js and kernel/core.js');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('EznK/L3:log');

    var entries = [];
    var capacity = 2000;
    var seq = 0;

    var LEVELS = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };

    function normalizeLevel(level) {
        if (typeof level === 'number') {
            // 兼容数字档位：0..4
            var names = ['debug', 'info', 'warn', 'error', 'fatal'];
            if (level >= 0 && level <= 4) { return names[level]; }
            return 'info';
        }
        if (typeof level === 'string' && LEVELS[level] !== undefined) { return level; }
        return 'info';
    }

    /** add(category, level, message, detail) -> { status, value: entry } */
    function add(category, level, message, detail) {
        if (typeof message !== 'string') {
            return fail(S.EINVAL, { reason: 'message must be a string' });
        }
        seq += 1;
        var lvl = normalizeLevel(level);
        var cat = (typeof category === 'string' && category.length > 0) ? category : 'system';
        var entry = {
            id: seq,
            type: cat,            /* legacy field name */
            category: cat,
            level: lvl,
            message: message,
            detail: (detail === undefined ? null : detail),
            time: Date.now(),
            iso: new Date().toISOString()
        };
        entries.push(entry);
        if (entries.length > capacity) {
            entries.splice(0, entries.length - capacity);
        }
        return ok(entry);
    }

    /** getLog(filter) -> entry[]  (LEGACY contract shape: array, not {status,value})
     *  filter: string (category) | { category, level, since, limit } */
    function getLog(filter) {
        var out = entries;
        if (typeof filter === 'string' && filter.length > 0) {
            out = entries.filter(function (e) { return e.category === filter; });
        } else if (filter && typeof filter === 'object') {
            var f = filter;
            out = entries.filter(function (e) {
                if (f.category && e.category !== f.category) { return false; }
                if (f.level && e.level !== f.level) { return false; }
                if (typeof f.levelBelow === 'string' && LEVELS[f.levelBelow] !== undefined) {
                    if (LEVELS[e.level] < LEVELS[f.levelBelow]) { return false; }
                }
                if (typeof f.since === 'number' && e.time < f.since) { return false; }
                return true;
            });
            if (typeof f.limit === 'number' && f.limit > 0) {
                out = out.slice(Math.max(0, out.length - f.limit));
            }
        }
        return out.slice(0);
    }

    /** logQuery(filter) -> { status, value: entry[] }  (strict API) */
    function logQuery(filter) {
        return ok(getLog(filter));
    }

    /** clearLog() -> true  (LEGACY contract shape) */
    function clearLog() {
        entries.length = 0;
        return true;
    }

    /** tail(n) -> { status, value: entry[] } */
    function tail(n) {
        var k = (typeof n === 'number' && n > 0) ? Math.floor(n) : 10;
        return ok(entries.slice(Math.max(0, entries.length - k)));
    }

    /** stats() -> { status, value: {count, capacity, byLevel, byCategory} } */
    function stats() {
        var byLevel = { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
        var byCategory = Object.create(null);
        entries.forEach(function (e) {
            byLevel[e.level] = (byLevel[e.level] || 0) + 1;
            byCategory[e.category] = (byCategory[e.category] || 0) + 1;
        });
        return ok({ count: entries.length, capacity: capacity, byLevel: byLevel, byCategory: byCategory });
    }

    function setCapacity(n) {
        if (typeof n !== 'number' || n < 10 || n > 100000) {
            return fail(S.EINVAL, { reason: 'capacity must be between 10 and 100000' });
        }
        capacity = Math.floor(n);
        if (entries.length > capacity) {
            entries.splice(0, entries.length - capacity);
        }
        return ok(true);
    }

    /** Legacy-compatible console helpers for modules. */
    var Log = {};
    Log.__isLog = true;
    Log.version = '1.0.0';
    Log.STATUS = S;

    Log.add = add;
    Log.getLog = getLog;
    Log.query = logQuery;
    Log.clearLog = clearLog;
    Log.tail = tail;
    Log.stats = stats;
    Log.setCapacity = setCapacity;
    Log.LEVELS = LEVELS;

    Log.info = function (cat, msg, detail) { return add(cat, 'info', msg, detail); };
    Log.warn = function (cat, msg, detail) { return add(cat, 'warn', msg, detail); };
    Log.error = function (cat, msg, detail) { return add(cat, 'error', msg, detail); };
    Log.debug = function (cat, msg, detail) { return add(cat, 'debug', msg, detail); };

    /** boot hook: record kernel start. */
    Log.boot = function () {
        add('system', 'info', 'SRM log service online');
        return ok(true);
    };
    Log.shutdown = function () {
        return ok(true);
    };

    Log.bind = ['getLog', 'clearLog'];

    SRM.register('log', Log);
    LOG.info('kernel/log.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
