/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 NT Layer
 *
 *   File    : js/nt/handle.js
 *   Module  : EznK.Nt.HandleTable  (alias: EZNT.Nt.handleTable)
 *   Layer   : Ezn32 NT
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The user-mode handle table: the mapping from opaque integer HANDLEs
 *   to kernel objects. Mirrors the Windows model:
 *
 *     handle -> { id, type, rights, object, owner, createdAt, refCount }
 *
 *   Handle values are small integers starting at 0x1000 and are NEVER
 *   reused within a boot, so a stale handle can never silently alias a
 *   new object (that is the classic Windows handle-recycling bug).
 *
 *   Rights are a bit mask (H.GENERIC_READ etc.). Opening an object with
 *   rights the object does not support fails EACCES, which is how the
 *   policy layer enforces read-only application files.
 *
 *   All objects created by Ezn32 API/UI go through this table; handles
 *   are the only way upper layers reference kernel objects.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Nt && G.EznK.Nt.HandleTable && G.EznK.Nt.HandleTable.__isHandleTable === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[Ezn32 NT] js/nt/handle.js requires platform/core.js');
    }

    var S = CORE.STATUS;
    var LOG = CORE.createLogger('Ezn32/NT:handle');

    /* Access rights (Windows-like bit mask). */
    var RIGHTS = Object.freeze({
        GENERIC_READ:        0x80000000,
        GENERIC_WRITE:       0x40000000,
        GENERIC_EXECUTE:     0x20000000,
        GENERIC_ALL:         0x10000000,
        DELETE:              0x00010000,
        READ_CONTROL:        0x00020000,
        SYNCHRONIZE:         0x00100000,
        FILE_READ_DATA:      0x00000001,
        FILE_WRITE_DATA:     0x00000002,
        FILE_APPEND_DATA:    0x00000004,
        FILE_EXECUTE:        0x00000020,
        WINDOW_ALL_ACCESS:   0x001F0000,
        WINDOW_READ_ONLY:    0x00080000,
        PROCESS_ALL:         0x001FFFFF,
        PROCESS_TERMINATE:   0x00000001,
        PROCESS_QUERY:       0x00000400
    });

    var NEXT = 0x1000;
    var table = Object.create(null);
    var byObject = (typeof WeakMap === 'function') ? new WeakMap() : null;
    var owners = Object.create(null);   /* owner -> [handle] */

    /** Kinds of kernel object a handle may reference. */
    var TYPES = ['file', 'window', 'process', 'service', 'registry', 'stream', 'device', 'memory'];

    function isValidType(t) {
        return TYPES.indexOf(t) !== -1;
    }

    /**
     * create(type, object, opts) -> { status, value: handle }
     *   opts: { rights=GENERIC_ALL, owner='system', mode='rw' }
     */
    function create(type, object, opts) {
        if (!isValidType(type)) {
            return CORE.fail(S.EINVAL, { reason: 'unknown handle type: ' + type });
        }
        if (object === undefined || object === null) {
            return CORE.fail(S.EINVAL, { reason: 'handle object required' });
        }
        var o = opts || {};
        var handle = NEXT;
        NEXT += 4;   /* Windows-like stride keeps low bits free */
        var rights = (typeof o.rights === 'number') ? o.rights : RIGHTS.GENERIC_ALL;
        var rec = {
            id: handle,
            type: type,
            rights: rights,
            object: object,
            owner: o.owner || 'system',
            mode: o.mode || 'rw',
            createdAt: Date.now(),
            refCount: 1
        };
        table[handle] = rec;
        if (byObject && typeof object === 'object') { byObject.set(object, handle); }
        if (!owners[rec.owner]) { owners[rec.owner] = []; }
        owners[rec.owner].push(handle);
        return CORE.ok(handle);
    }

    /** resolve(handle) -> { status, value: record } */
    function resolve(handle) {
        if (typeof handle !== 'number') {
            return CORE.fail(S.EINVAL, { reason: 'handle must be a number' });
        }
        var rec = table[handle];
        if (!rec) { return CORE.fail(S.EBADF, { reason: 'invalid handle', handle: handle }); }
        return CORE.ok(rec);
    }

    /** get(handle) -> { status, value: kernel object } */
    function get(handle) {
        var r = resolve(handle);
        if (r.status !== S.OK) { return r; }
        return CORE.ok(r.value.object);
    }

    /** lookupByObject(object) -> { status, value: handle } */
    function lookupByObject(object) {
        if (!byObject || typeof object !== 'object') {
            return CORE.fail(S.EINVAL, { reason: 'object required' });
        }
        var h = byObject.get(object);
        return (h === undefined) ? CORE.fail(S.ENOENT, { reason: 'object has no handle' }) : CORE.ok(h);
    }

    /** checkRights(handle, mask) -> { status, value: true } */
    function checkRights(handle, mask) {
        var r = resolve(handle);
        if (r.status !== S.OK) { return r; }
        var rec = r.value;
        if (rec.mode === 'r' && (mask & 0x3) !== 0 && (mask & RIGHTS.GENERIC_READ) === 0) {
            return CORE.fail(S.EACCES, { reason: 'handle opened read-only', handle: handle });
        }
        if ((rec.rights & mask) === 0 && (rec.rights & RIGHTS.GENERIC_ALL) === 0) {
            return CORE.fail(S.EACCES, { reason: 'access rights not granted', handle: handle });
        }
        return CORE.ok(true);
    }

    /** duplicate(handle, opts) -> { status, value: newHandle } */
    function duplicate(handle, opts) {
        var r = resolve(handle);
        if (r.status !== S.OK) { return r; }
        var o = opts || {};
        var src = r.value;
        return create(src.type, src.object, {
            rights: typeof o.rights === 'number' ? o.rights : src.rights,
            owner: o.owner || src.owner,
            mode: o.mode || src.mode
        });
    }

    /** close(handle) -> { status, value: true }   decrements refCount. */
    function close(handle) {
        var r = resolve(handle);
        if (r.status !== S.OK) { return r; }
        var rec = r.value;
        rec.refCount -= 1;
        if (rec.refCount > 0) { return CORE.ok(true); }
        delete table[handle];
        if (byObject) {
            try { byObject.delete(rec.object); } catch (_) { /* ignore */ }
        }
        var list = owners[rec.owner];
        if (list) {
            var i = list.indexOf(handle);
            if (i >= 0) { list.splice(i, 1); }
        }
        return CORE.ok(true);
    }

    /** closeAllFor(owner) -> { status, value: number }  teardown a process. */
    function closeAllFor(owner) {
        var list = owners[owner];
        if (!list) { return CORE.ok(0); }
        var victims = list.slice(0);
        var n = 0;
        victims.forEach(function (h) {
            var rec = table[h];
            if (!rec) { return; }
            rec.refCount = 1;
            if (close(h).status === S.OK) { n += 1; }
        });
        return CORE.ok(n);
    }

    /** list(filter) -> { status, value: [{id,type,owner,mode}] } */
    function list(filter) {
        var f = filter || {};
        var out = [];
        Object.keys(table).forEach(function (k) {
            var rec = table[Number(k)];
            if (f.type && rec.type !== f.type) { return; }
            if (f.owner && rec.owner !== f.owner) { return; }
            out.push({
                id: rec.id, type: rec.type, owner: rec.owner, mode: rec.mode,
                rights: '0x' + (rec.rights >>> 0).toString(16), createdAt: rec.createdAt
            });
        });
        out.sort(function (a, b) { return a.id - b.id; });
        return CORE.ok(out);
    }

    /** count() -> { status, value: number } */
    function count() {
        return CORE.ok(Object.keys(table).length);
    }

    /** reset() - kernel shutdown; invalidates every handle. */
    function reset() {
        table = Object.create(null);
        owners = Object.create(null);
        if (typeof WeakMap === 'function') { byObject = new WeakMap(); }
        return CORE.ok(true);
    }

    var H = {};
    H.__isHandleTable = true;
    H.version = '1.0.0';
    H.STATUS = S;
    H.RIGHTS = RIGHTS;
    H.TYPES = TYPES.slice(0);

    H.create = create;
    H.resolve = resolve;
    H.get = get;
    H.lookupByObject = lookupByObject;
    H.checkRights = checkRights;
    H.duplicate = duplicate;
    H.close = close;
    H.closeAllFor = closeAllFor;
    H.list = list;
    H.count = count;
    H.reset = reset;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Nt) { G.EznK.Nt = {}; }
    G.EznK.Nt.HandleTable = H;
    if (!G.EZNT.Nt) { G.EZNT.Nt = {}; }
    G.EZNT.Nt.handleTable = H;

    LOG.info('js/nt/handle.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
