/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 1 - Platform Layer
 *
 *   File    : js/platform/storage.js
 *   Module  : EznK.Platform.Storage  (alias: EZNT.Storage)
 *   Layer   : L1 平台层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The Storage Gateway - cross-cutting concern B of the EznK
 *   architecture. It is the ONLY place in EZNT that may touch
 *   browser persistence:
 *
 *       localStorage   -> the configuration disk  (/Config/...)
 *       IndexedDB      -> the system disk         (file tree)
 *
 *   Hard rule #7: no layer above L1 may call localStorage / IndexedDB
 *   directly. A static scan over js/ enforces this at delivery time.
 *
 *   Two disks, as required by section 6:
 *     ?idx  : system disk  - files, IDB, async API
 *     ?ls   : config disk  - settings, LS, synchronous API
 *
 *   Files also expose a SYNCHRONOUS cache-backed API (`fs.readSync`)
 *   because rf/sys scripts and .exc JS blocks cannot await. The async
 *   API is the source of truth; the sync view is a lazily loaded mirror
 *   that writes through to the async layer.
 *
 * ---------------------------------------------------------------------
 * 契约 (CONTRACT)
 * ---------------------------------------------------------------------
 *   1. File API  (系统盘 / IDB / async)    -> Promise<{status,value}>
 *        readFile(path)            -> value: string
 *        writeFile(path, data)     -> value: true
 *        deleteFile(path)          -> value: true
 *        mkdir(path)               -> value: true
 *        listDir(path)             -> value: [entry]
 *        stat(path)                -> value: { type, name, path, size,
 *                                              mode, createdAt, modifiedAt }
 *        exists(path)              -> value: boolean
 *        copy(src, dst)            -> value: true
 *        move(src, dst)            -> value: true
 *        rename(path, newName)     -> value: true
 *        readdirTree(path)         -> value: nested tree
 *
 *      Directory entries carry `type: 'file' | 'dir'`.
 *      IDB stores flat absolute paths; the tree is derived from paths
 *      (decision D3) so a move is one key update, not a subtree rewrite.
 *
 *   2. Config API (配置盘 / LS / sync)      -> {status, value}
 *        config.get(path, fallback)
 *        config.set(path, value)
 *        config.has(path)
 *        config.list(path)         -> child keys
 *        config.delete(path)
 *        config.clear()
 *        config.snapshot() / config.restore(snapshot)
 *
 *      Keys are stored as "eznt.cfg.<path>", values JSON-encoded.
 *
 *   3. Synchronous file views (cache mirror)
 *        fs.readSync(path)  / fs.writeSync(path, data)
 *        fs.listSync(path)  / fs.existsSync(path)
 *        fs.hydrate()       -> Promise, load whole tree into the mirror
 *
 *   4. Degradation
 *        When IndexedDB is unavailable the file disk falls back to
 *        localStorage (namespaced, with a warned flag) so the system
 *        still boots; `storage.info()` reports `degraded: true`.
 *
 *   5. Lifecycle
 *        storage.init() opens the DB and hydrates mirrors.
 *        storage.dispose() closes it and drops every mirror.
 *        Every async call fails with EPOWEROFF after dispose.
 *
 *   6. Path rules (section 6.1)
 *        Absolute, forward slash, no trailing slash, no "." / "..",
 *        system directories capitalized, user file names preserved
 *        verbatim (including non-ASCII user names - only SYSTEM names
 *        are ASCII).
 *
 * ---------------------------------------------------------------------
 * 依赖 (DEPENDENCY)
 * ---------------------------------------------------------------------
 *   platform/core.js (status, result, error, logger). Loaded before.
 *   This module never calls DOM: it is pure persistence.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    /* ---- idempotent guard ----------------------------------------- */
    if (G.EznK && G.EznK.Platform && G.EznK.Platform.Storage &&
        G.EznK.Platform.Storage.__isEZNTStorage === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[EznK/L1] platform/storage.js requires platform/core.js to load first');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var failFrom = CORE.failFrom;
    var asyncOk = CORE.asyncOk;
    var asyncFail = CORE.asyncFail;

    var LOG = CORE.createLogger('EznK/L1:storage');

    /* =================================================================
     * 1. Constants
     * ============================================================== */

    var DB_NAME = 'EZNT_SystemDisk';
    var DB_VERSION = 1;
    var STORE = 'files';
    var CFG_PREFIX = 'eznt.cfg.';
    var LS_FALLBACK_PREFIX = 'eznt.fs.';
    var MAX_PATH = 1024;

    /* Directories created on first boot (section 6.1). */
    var SYSTEM_DIRS = [
        '/System',
        '/System/Kernel',
        '/System/Nt',
        '/System/Api',
        '/System/Ui',
        '/System/Shell',
        '/System/Runtime',
        '/System/Apps',
        '/System/Updates',
        '/Users',
        '/Programs',
        '/Shared',
        '/Temp'
    ];

    /* =================================================================
     * 2. State (single source of truth for this module)
     * ============================================================== */

    var state = {
        db: null,            /* IDBDatabase | null */
        degraded: false,     /* true when using the LS fallback */
        open: false,         /* init() completed */
        closed: false,       /* dispose() called */
        opening: null        /* Promise while opening */
    };

    /* Synchronous mirror: path -> { type, data?, size, createdAt, modifiedAt } */
    var mirror = Object.create(null);
    var mirrorReady = false;

    /* =================================================================
     * 3. Path normalisation (section 6.1)
     * ============================================================== */

    function isString(x) { return typeof x === 'string'; }

    /**
     * normalizePath(p) -> { status, value }
     *   Returns a canonical absolute path: leading '/', no trailing '/',
     *   no empty, '.', or '..' segments. Preserves case of every segment
     *   (user names must not be case-folded).
     */
    function normalizePath(p) {
        if (!isString(p)) {
            return fail(S.EINVAL, { reason: 'path must be a string' });
        }
        if (p.length === 0 || p.length > MAX_PATH) {
            return fail(S.EINVAL, { reason: 'path length out of range' });
        }
        var raw = p.replace(/\\/g, '/');
        if (raw.charAt(0) !== '/') {
            return fail(S.EINVAL, { reason: 'path must be absolute (start with /)' });
        }
        var parts = raw.split('/');
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var seg = parts[i];
            if (seg === '') { continue; }              /* leading or duplicate slash */
            if (seg === '.') { continue; }
            if (seg === '..') {
                return fail(S.EINVAL, { reason: 'path may not contain ".."' });
            }
            if (/[\u0000-\u001F]/.test(seg)) {
                return fail(S.EINVAL, { reason: 'path may not contain control characters' });
            }
            out.push(seg);
        }
        return ok('/' + out.join('/'));
    }

    /** Parent of a canonical path ('/' has parent '/'). */
    function parentOf(path) {
        if (path === '/') { return '/'; }
        var i = path.lastIndexOf('/');
        return i <= 0 ? '/' : path.slice(0, i);
    }

    /** Last segment of a canonical path ('' for root). */
    function baseOf(path) {
        if (path === '/') { return ''; }
        return path.slice(path.lastIndexOf('/') + 1);
    }

    /** Depth: '/' -> 0, '/a' -> 1. */
    function depthOf(path) {
        if (path === '/') { return 0; }
        return path.split('/').length - 1;
    }

    function isUnder(path, dir) {
        if (dir === '/') { return path !== '/'; }
        return path === dir || path.indexOf(dir + '/') === 0;
    }

    /* =================================================================
     * 4. IndexedDB plumbing
     * ============================================================== */

    /** Open (or reuse) the database. Returns Promise<{status,value}>. */
    function openDB() {
        if (state.degraded) { return asyncOk(null); }
        if (state.db) { return asyncOk(state.db); }
        if (state.opening) { return state.opening; }

        var idb = G.indexedDB;
        if (!idb) {
            state.degraded = true;
            LOG.warn('IndexedDB unavailable - falling back to localStorage disk');
            return asyncOk(null);
        }

        state.opening = new Promise(function (resolve) {
            var req;
            try {
                req = idb.open(DB_NAME, DB_VERSION);
            } catch (err) {
                resolve(failFrom(err));
                return;
            }
            req.onupgradeneeded = function (ev) {
                var db = ev.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    var os = db.createObjectStore(STORE, { keyPath: 'path' });
                    os.createIndex('parent', 'parent', { unique: false });
                    os.createIndex('type', 'type', { unique: false });
                }
            };
            req.onsuccess = function () {
                state.db = req.result;
                state.db.onversionchange = function () {
                    try { state.db.close(); } catch (_) { /* ignore */ }
                    state.db = null;
                };
                resolve(ok(state.db));
            };
            req.onerror = function () {
                state.degraded = true;
                LOG.warn('IndexedDB open failed - falling back to localStorage disk');
                resolve(ok(null));
            };
            req.onblocked = function () {
                resolve(fail(S.EBUSY, { reason: 'IndexedDB open blocked by another tab' }));
            };
        }).then(function (r) {
            state.opening = null;
            return r;
        });
        return state.opening;
    }

    /* =================================================================
     * 5. Fallback disk (localStorage) - same record shape as IDB
     * ============================================================== */

    function lsGet(key) {
        try { return G.localStorage.getItem(LS_FALLBACK_PREFIX + encodeURIComponent(key)); }
        catch (_) { return null; }
    }
    function lsSet(key, val) {
        try { G.localStorage.setItem(LS_FALLBACK_PREFIX + encodeURIComponent(key), val); }
        catch (_) { /* quota */ }
    }
    function lsDel(key) {
        try { G.localStorage.removeItem(LS_FALLBACK_PREFIX + encodeURIComponent(key)); }
        catch (_) { /* ignore */ }
    }
    function lsKeysOfStore() {
        var out = [];
        try {
            var ls = G.localStorage;
            for (var i = 0; i < ls.length; i++) {
                var k = ls.key(i);
                if (k && k.indexOf(LS_FALLBACK_PREFIX) === 0) {
                    out.push(decodeURIComponent(k.slice(LS_FALLBACK_PREFIX.length)));
                }
            }
        } catch (_) { /* ignore */ }
        return out;
    }

    /** Record shape shared by both backends. */
    function mkRecord(path, type, data, mode) {
        var now = Date.now();
        return {
            path: path,
            parent: parentOf(path),
            name: baseOf(path),
            type: type,
            data: (type === 'file' ? (data === undefined ? '' : String(data)) : null),
            size: (type === 'file' ? String(data === undefined ? '' : data).length : 0),
            mode: mode || (type === 'dir' ? 'drwxr-xr-x' : 'rw-r--r--'),
            createdAt: now,
            modifiedAt: now
        };
    }

    /* =================================================================
     * 6. Low-level record access (single implementation per backend)
     * ============================================================== */

    /** Get a record by path. IDB read uses the request's own success. */
    function getRecord(path) {
        if (state.degraded) {
            var raw = lsGet(path);
            if (raw === null) { return asyncFail(S.ENOENT, { path: path }); }
            try {
                return asyncOk(JSON.parse(raw));
            } catch (err) {
                return asyncFail(S.EBADIMAGE, { path: path, error: String(err) });
            }
        }
        return openDB().then(function (r) {
            if (r.status !== S.OK) { return r; }
            if (!state.db) { return fail(S.ENOENT, { path: path }); }
            return new Promise(function (resolve) {
                var tx;
                try { tx = state.db.transaction(STORE, 'readonly'); }
                catch (err) { resolve(failFrom(err)); return; }
                var req = tx.objectStore(STORE).get(path);
                req.onsuccess = function () {
                    resolve(req.result === undefined ? fail(S.ENOENT, { path: path }) : ok(req.result));
                };
                req.onerror = function () { resolve(failFrom(req.error)); };
            });
        });
    }

    /** putRecord(record) -> Promise<{status,value:true}> */
    function putRecord(rec) {
        if (state.degraded) {
            lsSet(rec.path, JSON.stringify(rec));
            return asyncOk(true);
        }
        return openDB().then(function (r) {
            if (r.status !== S.OK) { return r; }
            if (!state.db) { lsSet(rec.path, JSON.stringify(rec)); return asyncOk(true); }
            return new Promise(function (resolve) {
                var tx;
                try { tx = state.db.transaction(STORE, 'readwrite'); }
                catch (err) { resolve(failFrom(err)); return; }
                var os = tx.objectStore(STORE);
                var put = os.put(rec);
                put.onerror = function () { /* surfaced by tx.onerror */ };
                tx.oncomplete = function () { resolve(ok(true)); };
                tx.onerror = function (ev) {
                    var e = tx.error || (ev.target && ev.target.error);
                    resolve(fail(e && e.name === 'QuotaExceededError' ? S.ENOSPC : S.EIO,
                        { error: e ? e.name : 'IDB write error' }));
                };
                tx.onabort = function () { resolve(fail(S.EIO, { reason: 'write aborted' })); };
            });
        });
    }

    /** deleteRecord(path) -> Promise<{status,value:true}> */
    function deleteRecord(path) {
        return removeRecords([path]);
    }

    /** removeRecords(paths) -> Promise<{status,value:true}> */
    function removeRecords(paths) {
        if (state.degraded) {
            for (var i = 0; i < paths.length; i++) { lsDel(paths[i]); }
            return asyncOk(true);
        }
        return openDB().then(function (r) {
            if (r.status !== S.OK) { return r; }
            if (!state.db) {
                for (var i = 0; i < paths.length; i++) { lsDel(paths[i]); }
                return asyncOk(true);
            }
            return new Promise(function (resolve) {
                var tx;
                try { tx = state.db.transaction(STORE, 'readwrite'); }
                catch (err) { resolve(failFrom(err)); return; }
                var os = tx.objectStore(STORE);
                for (var i = 0; i < paths.length; i++) { os.delete(paths[i]); }
                tx.oncomplete = function () { resolve(ok(true)); };
                tx.onerror = function () { resolve(fail(S.EIO, { error: tx.error ? tx.error.name : 'delete error' })); };
                tx.onabort = function () { resolve(fail(S.EIO, { reason: 'delete aborted' })); };
            });
        });
    }

    /* =================================================================
     * 7. Mirror (sync view) maintenance
     * ============================================================== */

    function mirrorPut(rec) {
        mirror[rec.path] = {
            type: rec.type,
            data: rec.data,
            size: rec.size,
            mode: rec.mode,
            createdAt: rec.createdAt,
            modifiedAt: rec.modifiedAt
        };
    }

    function mirrorDel(path) {
        var keys = Object.keys(mirror);
        for (var i = 0; i < keys.length; i++) {
            if (isUnder(keys[i], path)) { delete mirror[keys[i]]; }
        }
    }

    /** hydrate() -> Promise<{status, value: number}>  fills the mirror. */
    function hydrate() {
        return loadAll().then(function (r) {
            if (r.status !== S.OK) { return r; }
            mirror = Object.create(null);
            for (var i = 0; i < r.value.length; i++) { mirrorPut(r.value[i]); }
            mirrorReady = true;
            return ok(r.value.length);
        });
    }

    /** loadAll() -> Promise<{status, value: record[]}> */
    function loadAll() {
        if (state.degraded) {
            var lsOut = [];
            var keys = lsKeysOfStore();
            for (var i = 0; i < keys.length; i++) {
                var raw = lsGet(keys[i]);
                if (raw === null) { continue; }
                try { lsOut.push(JSON.parse(raw)); } catch (_) { /* skip */ }
            }
            return asyncOk(lsOut);
        }
        return openDB().then(function (r) {
            if (r.status !== S.OK) { return r; }
            if (!state.db) { return asyncOk([]); }
            return new Promise(function (resolve) {
                var tx;
                try { tx = state.db.transaction(STORE, 'readonly'); }
                catch (err) { resolve(failFrom(err)); return; }
                var req = tx.objectStore(STORE).getAll();
                req.onsuccess = function () { resolve(ok(req.result || [])); };
                req.onerror = function () { resolve(failFrom(req.error)); };
            });
        });
    }

    /* =================================================================
     * 8. File API (async, system disk)
     * ============================================================== */

    function guardOpen() {
        if (state.closed) { return fail(S.EPOWEROFF, { reason: 'storage disposed' }); }
        return ok(true);
    }

    /** readFile(path) -> Promise<{status, value: string}> */
    function readFile(path) {
        var g = guardOpen();
        if (g.status !== S.OK) { return Promise.resolve(g); }
        var np = normalizePath(path);
        if (np.status !== S.OK) { return Promise.resolve(np); }
        return getRecord(np.value).then(function (r) {
            if (r.status !== S.OK) { return r; }
            if (r.value.type === 'dir') {
                return fail(S.EBADF, { reason: 'path is a directory', path: np.value });
            }
            return ok(r.value.data);
        });
    }

    /** writeFile(path, data, opts?) -> Promise<{status,value:true}> */
    function writeFile(path, data, opts) {
        var g = guardOpen();
        if (g.status !== S.OK) { return Promise.resolve(g); }
        var np = normalizePath(path);
        if (np.status !== S.OK) { return Promise.resolve(np); }
        if (np.value === '/') { return asyncFail(S.EACCES, { reason: 'cannot write the root' }); }
        if (data === undefined || data === null) { data = ''; }

        if (typeof data !== 'string') {
            return asyncFail(S.EINVAL, { reason: 'file content must be a string' });
        }

        var o = opts || {};
        return ensureParents(np.value).then(function (pr) {
            if (pr.status !== S.OK) { return pr; }
            return getRecord(np.value);
        }).then(function (er) {
            var existing = (er.status === S.OK) ? er.value : null;
            if (existing && existing.type === 'dir') { return fail(S.EBUSY, { reason: 'path is a directory' }); }
            if (!existing && o.create === false) {
                return fail(S.ENOENT, { reason: 'file does not exist and create:false' });
            }
            if (existing && o.overwrite === false) {
                return fail(S.EEXIST, { reason: 'file exists and overwrite:false' });
            }
            var rec = mkRecord(np.value, 'file', data, existing ? existing.mode : null);
            if (existing) {
                rec.createdAt = existing.createdAt;
                rec.mode = existing.mode;
            }
            mirrorPut(rec);
            return putRecord(rec).then(function (w) {
                return w.status === S.OK ? ok(true, { path: np.value }) : w;
            });
        });
    }

    /** deleteFile(path, opts?) -> Promise<{status,value:true}>
     *  opts.recursive deletes directories and their contents. */
    function deleteFile(path, opts) {
        var g = guardOpen();
        if (g.status !== S.OK) { return Promise.resolve(g); }
        var np = normalizePath(path);
        if (np.status !== S.OK) { return Promise.resolve(np); }
        if (np.value === '/') { return asyncFail(S.EACCES, { reason: 'cannot delete the root' }); }
        var recursive = !!(opts && opts.recursive);

        return getRecord(np.value).then(function (r) {
            if (r.status !== S.OK) { return r; }
            var rec = r.value;
            if (rec.type === 'dir' && !recursive) {
                return listChildren(np.value).then(function (lr) {
                    if (lr.status !== S.OK) { return lr; }
                    if (lr.value.length > 0) {
                        return fail(S.EBUSY, { reason: 'directory is not empty' });
                    }
                    return removeRecords([np.value]);
                });
            }
            if (rec.type === 'dir') {
                return listChildren(np.value, true).then(function (lr) {
                    if (lr.status !== S.OK) { return lr; }
                    var paths = [np.value];
                    for (var i = 0; i < lr.value.length; i++) { paths.push(lr.value[i].path); }
                    /* deepest first */
                    paths.sort(function (a, b) { return depthOf(b) - depthOf(a); });
                    return removeRecords(paths);
                });
            }
            return removeRecords([np.value]);
        }).then(function (d) {
            if (d.status !== S.OK) { return d; }
            mirrorDel(np.value);
            return ok(true);
        });
    }

    /** ensureParents(path) -> Promise<{status,value:true}>  creates dirs. */
    function ensureParents(path) {
        var parent = parentOf(path);
        if (parent === '/') { return asyncOk(true); }
        var segs = parent.split('/').filter(Boolean);
        var built = '';
        var chain = Promise.resolve(ok(true));
        segs.forEach(function (seg) {
            chain = chain.then(function (prev) {
                if (prev.status !== S.OK) { return prev; }
                built += '/' + seg;
                return getRecord(built).then(function (r) {
                    if (r.status === S.OK) {
                        return r.value.type === 'dir' ? ok(true) : fail(S.EEXIST, { reason: built + ' exists as a file' });
                    }
                    var rec = mkRecord(built, 'dir', null);
                    mirrorPut(rec);
                    return putRecord(rec).then(function (w) { return w.status === S.OK ? ok(true) : w; });
                });
            });
        });
        return chain;
    }

    /** mkdir(path) -> Promise<{status,value:true}> */
    function mkdir(path) {
        var g = guardOpen();
        if (g.status !== S.OK) { return Promise.resolve(g); }
        var np = normalizePath(path);
        if (np.status !== S.OK) { return Promise.resolve(np); }
        if (np.value === '/') { return asyncOk(true); }
        return getRecord(np.value).then(function (r) {
            if (r.status === S.OK) {
                return r.value.type === 'dir' ? ok(true) : fail(S.EEXIST, { reason: 'a file exists at path' });
            }
            return ensureParents(np.value).then(function (pr) {
                if (pr.status !== S.OK) { return pr; }
                var rec = mkRecord(np.value, 'dir', null);
                mirrorPut(rec);
                return putRecord(rec).then(function (w) { return w.status === S.OK ? ok(true) : w; });
            });
        });
    }

    /** listChildren(path, recursive) -> Promise<{status, value: entry[]}> */
    function listChildren(path, recursive) {
        return loadAll().then(function (r) {
            if (r.status !== S.OK) { return r; }
            var out = [];
            for (var i = 0; i < r.value.length; i++) {
                var rec = r.value[i];
                if (rec.path === path) { continue; }
                if (recursive) {
                    if (isUnder(rec.path, path)) { out.push(toEntry(rec)); }
                } else if (parentOf(rec.path) === path) {
                    out.push(toEntry(rec));
                }
            }
            out.sort(function (a, b) {
                if (a.type !== b.type) { return a.type === 'dir' ? -1 : 1; }
                return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
            });
            return ok(out);
        });
    }

    function toEntry(rec) {
        return {
            name: rec.name,
            path: rec.path,
            type: rec.type,
            size: rec.size,
            mode: rec.mode,
            createdAt: rec.createdAt,
            modifiedAt: rec.modifiedAt
        };
    }

    /** listDir(path) -> Promise<{status, value: entry[]}> */
    function listDir(path) {
        var g = guardOpen();
        if (g.status !== S.OK) { return Promise.resolve(g); }
        var np = normalizePath(path);
        if (np.status !== S.OK) { return Promise.resolve(np); }
        /* 根目录是虚拟节点：它不存实体记录，但一定存在，
         * 直接列它的子项。否则打开盘符会得到 ENOENT。 */
        if (np.value === '/') {
            return listChildren('/', false);
        }
        return getRecord(np.value).then(function (r) {
            if (r.status !== S.OK) { return r; }
            if (r.value.type !== 'dir') { return fail(S.EBADF, { reason: 'path is a file' }); }
            return listChildren(np.value, false);
        });
    }

    /** stat(path) -> Promise<{status, value: entry}> */
    function stat(path) {
        var g = guardOpen();
        if (g.status !== S.OK) { return Promise.resolve(g); }
        var np = normalizePath(path);
        if (np.status !== S.OK) { return Promise.resolve(np); }
        if (np.value === '/') {
            return asyncOk({
                name: '/', path: '/', type: 'dir', size: 0,
                mode: 'drwxr-xr-x', createdAt: 0, modifiedAt: 0
            });
        }
        return getRecord(np.value).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return ok(toEntry(r.value));
        });
    }

    /** exists(path) -> Promise<{status, value: boolean}> */
    function exists(path) {
        var g = guardOpen();
        if (g.status !== S.OK) { return Promise.resolve(g); }
        var np = normalizePath(path);
        if (np.status !== S.OK) { return Promise.resolve(np); }
        if (np.value === '/') { return asyncOk(true); }
        return getRecord(np.value).then(function (r) {
            if (r.status === S.ENOENT) { return ok(false); }
            if (r.status !== S.OK) { return r; }
            return ok(true);
        });
    }

    /** copy(src, dst) -> Promise<{status,value:true}>  recursive for dirs. */
    function copy(src, dst) {
        var g = guardOpen();
        if (g.status !== S.OK) { return Promise.resolve(g); }
        var a = normalizePath(src);
        var b = normalizePath(dst);
        if (a.status !== S.OK) { return Promise.resolve(a); }
        if (b.status !== S.OK) { return Promise.resolve(b); }
        if (a.value === b.value) { return asyncOk(true); }
        if (isUnder(b.value, a.value)) {
            return asyncFail(S.EINVAL, { reason: 'cannot copy a directory into itself' });
        }
        return stat(a.value).then(function (sr) {
            if (sr.status !== S.OK) { return sr; }
            if (sr.value.type === 'file') {
                return readFile(a.value).then(function (cr) {
                    if (cr.status !== S.OK) { return cr; }
                    return writeFile(b.value, cr.value);
                }).then(function (w) { return w.status === S.OK ? ok(true) : w; });
            }
            return mkdir(b.value).then(function (mr) {
                if (mr.status !== S.OK) { return mr; }
                return listChildren(a.value, true).then(function (lr) {
                    if (lr.status !== S.OK) { return lr; }
                    var chain = Promise.resolve(ok(true));
                    lr.value.forEach(function (entry) {
                        chain = chain.then(function (prev) {
                            if (prev.status !== S.OK) { return prev; }
                            if (entry.type !== 'file') { return prev; }
                            var rel = entry.path.slice(a.value.length);
                            return readFile(entry.path).then(function (cr) {
                                if (cr.status !== S.OK) { return cr; }
                                return writeFile(b.value + rel, cr.value);
                            }).then(function (w) { return w.status === S.OK ? ok(true) : w; });
                        });
                    });
                    return chain;
                });
            });
        });
    }

    /** move(src, dst) -> Promise<{status,value:true}> */
    function move(src, dst) {
        return copy(src, dst).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return deleteFile(src, { recursive: true });
        });
    }

    /** rename(path, newName) -> Promise<{status,value:true}> */
    function rename(path, newName) {
        var np = normalizePath(path);
        if (np.status !== S.OK) { return Promise.resolve(np); }
        if (!isString(newName) || newName.length === 0 || /[\/\\]/.test(newName)) {
            return asyncFail(S.EINVAL, { reason: 'newName must be a bare file name' });
        }
        var target = (parentOf(np.value) === '/' ? '' : parentOf(np.value)) + '/' + newName;
        return move(np.value, target);
    }

    /** readdirTree(path) -> Promise<{status, value: tree}> */
    function readdirTree(path) {
        var np = normalizePath(path === undefined ? '/' : path);
        if (np.status !== S.OK) { return Promise.resolve(np); }
        return listChildren(np.value, true).then(function (r) {
            if (r.status !== S.OK) { return r; }
            var root = { name: np.value, path: np.value, type: 'dir', children: [] };
            var index = Object.create(null);
            index[np.value] = root;
            r.value.forEach(function (e) {
                var node = { name: e.name, path: e.path, type: e.type, size: e.size, children: e.type === 'dir' ? [] : undefined };
                index[e.path] = node;
                var par = index[parentOf(e.path)] || root;
                if (!par.children) { par.children = []; }
                par.children.push(node);
            });
            return ok(root);
        });
    }

    /* =================================================================
     * 9. Synchronous file views (mirror)
     * ============================================================== */

    function readSync(path) {
        var g = guardOpen();
        if (g.status !== S.OK) { return g; }
        var np = normalizePath(path);
        if (np.status !== S.OK) { return np; }
        var rec = mirror[np.value];
        if (!rec) { return fail(S.ENOENT, { path: np.value }); }
        if (rec.type === 'dir') { return fail(S.EBADF, { reason: 'path is a directory' }); }
        return ok(rec.data);
    }

    function writeSync(path, data) {
        var np = normalizePath(path);
        if (np.status !== S.OK) { return np; }
        var rec = mkRecord(np.value, 'file', data, null);
        var existing = mirror[np.value];
        if (existing) { rec.createdAt = existing.createdAt; }
        mirrorPut(rec);
        /* write-through, fire-and-forget by design: the mirror is already
         * authoritative for sync readers, the async layer catches up. */
        var p = putRecord(rec);
        if (p && p.catch) { p.catch(function () { /* logged by txn */ }); }
        return ok(true);
    }

    function listSync(path) {
        var np = normalizePath(path);
        if (np.status !== S.OK) { return np; }
        var out = [];
        var keys = Object.keys(mirror);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (k === np.value) { continue; }
            if (isUnder(k, np.value) && depthOf(k) === depthOf(np.value) + 1) {
                var rec = mirror[k];
                out.push({ name: rec.name || baseOf(k), path: k, type: rec.type, size: rec.size });
            }
        }
        out.sort(function (a, b) {
            if (a.type !== b.type) { return a.type === 'dir' ? -1 : 1; }
            return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
        });
        return ok(out);
    }

    function existsSync(path) {
        var np = normalizePath(path);
        if (np.status !== S.OK) { return np; }
        if (np.value === '/') { return ok(true); }
        return ok(!!mirror[np.value]);
    }

    function statSync(path) {
        var np = normalizePath(path);
        if (np.status !== S.OK) { return np; }
        var rec = mirror[np.value];
        if (!rec) { return fail(S.ENOENT, { path: np.value }); }
        return ok({
            name: rec.name || baseOf(np.value), path: np.value, type: rec.type,
            size: rec.size, mode: rec.mode, createdAt: rec.createdAt, modifiedAt: rec.modifiedAt
        });
    }

    /* =================================================================
     * 10. Config API (synchronous, config disk)
     * ============================================================== */

    function cfgKey(path) {
        var np = normalizePath(path);
        if (np.status !== S.OK) { return np; }
        return ok(CFG_PREFIX + np.value.replace(/^\//, ''));
    }

    function configGet(path, fallback) {
        var k = cfgKey(path);
        if (k.status !== S.OK) { return k; }
        var raw;
        try { raw = G.localStorage.getItem(k.value); }
        catch (err) { return failFrom(err, S.EACCES); }
        if (raw === null) {
            return fallback === undefined
                ? fail(S.ENOENT, { path: path })
                : ok(fallback, { usedFallback: true });
        }
        try {
            return ok(JSON.parse(raw));
        } catch (err) {
            return fail(S.EBADIMAGE, { path: path, error: 'corrupt JSON value' });
        }
    }

    function configSet(path, value) {
        var k = cfgKey(path);
        if (k.status !== S.OK) { return k; }
        if (k.value.length > 0 && /\/$/.test(path)) {
            return fail(S.EINVAL, { reason: 'config path must name a leaf key' });
        }
        var raw;
        try { raw = JSON.stringify(value === undefined ? null : value); }
        catch (err) { return fail(S.EINVAL, { reason: 'value is not JSON-serialisable' }); }
        try {
            G.localStorage.setItem(k.value, raw);
        } catch (err) {
            return fail(S.ENOSPC, { reason: 'localStorage quota exceeded or unavailable' });
        }
        return ok(true);
    }

    function configHas(path) {
        var k = cfgKey(path);
        if (k.status !== S.OK) { return k; }
        try { return ok(G.localStorage.getItem(k.value) !== null); }
        catch (err) { return failFrom(err, S.EACCES); }
    }

    function configDelete(path) {
        var k = cfgKey(path);
        if (k.status !== S.OK) { return k; }
        var has = configHas(path);
        if (has.status !== S.OK) { return has; }
        if (!has.value) { return fail(S.ENOENT, { path: path }); }
        try { G.localStorage.removeItem(k.value); }
        catch (err) { return failFrom(err, S.EACCES); }
        return ok(true);
    }

    function configList(dir) {
        var np = normalizePath(dir === undefined ? '/' : dir);
        if (np.status !== S.OK) { return np; }
        var prefix = CFG_PREFIX + (np.value === '/' ? '' : np.value.replace(/^\//, '') + '/');
        var out = [];
        try {
            var ls = G.localStorage;
            for (var i = 0; i < ls.length; i++) {
                var k = ls.key(i);
                if (!k || k.indexOf(prefix) !== 0) { continue; }
                var rest = k.slice(prefix.length);
                if (rest === '') { continue; }
                out.push(rest.split('/')[0]);
            }
        } catch (err) {
            return failFrom(err, S.EACCES);
        }
        out.sort();
        return ok(out);
    }

    function configClear() {
        try {
            var ls = G.localStorage;
            var doomed = [];
            for (var i = 0; i < ls.length; i++) {
                var k = ls.key(i);
                if (k && k.indexOf(CFG_PREFIX) === 0) { doomed.push(k); }
            }
            for (var j = 0; j < doomed.length; j++) { ls.removeItem(doomed[j]); }
        } catch (err) {
            return failFrom(err, S.EACCES);
        }
        return ok(true);
    }

    function configSnapshot() {
        var out = {};
        try {
            var ls = G.localStorage;
            for (var i = 0; i < ls.length; i++) {
                var k = ls.key(i);
                if (!k || k.indexOf(CFG_PREFIX) !== 0) { continue; }
                out[k] = ls.getItem(k);
            }
        } catch (err) {
            return failFrom(err, S.EACCES);
        }
        return ok(out);
    }

    function configRestore(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') {
            return fail(S.EINVAL, { reason: 'snapshot object required' });
        }
        var c = configClear();
        if (c.status !== S.OK) { return c; }
        try {
            Object.keys(snapshot).forEach(function (k) {
                if (k.indexOf(CFG_PREFIX) !== 0) { return; }
                if (typeof snapshot[k] === 'string') { G.localStorage.setItem(k, snapshot[k]); }
            });
        } catch (err) {
            return fail(S.ENOSPC, { reason: 'restore exceeded quota' });
        }
        return ok(true);
    }

    /* =================================================================
     * 11. Lifecycle
     * ============================================================== */

    /** init(opts?) -> Promise<{status, value: info}> */
    function init(opts) {
        if (state.closed) { return asyncFail(S.EPOWEROFF, { reason: 'disposed' }); }
        if (state.open) { return asyncOk(info().value); }
        var o = opts || {};
        return openDB().then(function (r) {
            if (r.status !== S.OK) { return r; }
            return hydrate().then(function (h) {
                if (h.status !== S.OK) { return h; }
                state.open = true;
                if (!o.skipFactory && !o.preserve) {
                    return ensureFactory().then(function (f) {
                        return f.status === S.OK ? ok(info().value) : f;
                    });
                }
                return ok(info().value);
            });
        });
    }

    /** Build the standard directory tree on first boot. */
    function ensureFactory() {
        var chain = Promise.resolve(ok(true));
        SYSTEM_DIRS.forEach(function (d) {
            chain = chain.then(function (prev) {
                if (prev.status !== S.OK) { return prev; }
                return mkdir(d);
            });
        });
        return chain.then(function (r) {
            if (r.status !== S.OK) { return r; }
            var f = configGet('/System/FirstBoot.json', null);
            if (f.status !== S.OK || f.value === null) {
                configSet('/System/FirstBoot.json', { firstBoot: true, at: Date.now() });
            }
            return ok(true);
        });
    }

    function dispose() {
        state.closed = true;
        state.open = false;
        if (state.db) {
            try { state.db.close(); } catch (_) { /* ignore */ }
            state.db = null;
        }
        mirror = Object.create(null);
        mirrorReady = false;
        LOG.info('storage disposed');
        return ok(true);
    }

    /** info() -> { status, value: { backend, degraded, open, records } } */
    function info() {
        return ok({
            backend: state.degraded ? 'localStorage' : (state.db ? 'indexedDB' : 'none'),
            degraded: state.degraded,
            open: state.open,
            closed: state.closed,
            records: Object.keys(mirror).length,
            mirrorReady: mirrorReady
        });
    }

    /** usage() -> Promise<{status, value:{files, dirs, bytes}}> */
    function usage() {
        return loadAll().then(function (r) {
            if (r.status !== S.OK) { return r; }
            var files = 0, dirs = 0, bytes = 0;
            r.value.forEach(function (rec) {
                if (rec.type === 'dir') { dirs++; } else { files++; bytes += rec.size || 0; }
            });
            return ok({ files: files, dirs: dirs, bytes: bytes });
        });
    }

    /* =================================================================
     * 12. Public handles
     * ============================================================== */

    var Storage = {};

    Storage.__isEZNTStorage = true;
    Storage.version = '1.0.0';
    Storage.STATUS = S;

    /* file disk (async) */
    Storage.readFile = readFile;
    Storage.writeFile = writeFile;
    Storage.deleteFile = deleteFile;
    Storage.mkdir = mkdir;
    Storage.listDir = listDir;
    Storage.stat = stat;
    Storage.exists = exists;
    Storage.copy = copy;
    Storage.move = move;
    Storage.rename = rename;
    Storage.readdirTree = readdirTree;

    /* sync mirror */
    Storage.readSync = readSync;
    Storage.writeSync = writeSync;
    Storage.listSync = listSync;
    Storage.existsSync = existsSync;
    Storage.statSync = statSync;
    Storage.hydrate = hydrate;

    /* config disk (sync) */
    Storage.config = {
        get: configGet,
        set: configSet,
        has: configHas,
        list: configList,
        delete: configDelete,
        clear: configClear,
        snapshot: configSnapshot,
        restore: configRestore
    };

    /* paths */
    Storage.paths = {
        normalize: normalizePath,
        parentOf: parentOf,
        baseOf: baseOf,
        depthOf: depthOf,
        isUnder: isUnder,
        SYSTEM_DIRS: SYSTEM_DIRS.slice(0)
    };

    /* lifecycle */
    Storage.init = init;
    Storage.dispose = dispose;
    Storage.info = info;
    Storage.usage = usage;
    Storage.ensureFactory = ensureFactory;

    /* Test/diagnostics only: raw browser handles are NEVER exported to
     * higher layers; this is a read-only probe kept on the L1 table. */
    Storage._probe = function () {
        return {
            hasIndexedDB: !!G.indexedDB,
            hasLocalStorage: !!G.localStorage,
            degraded: state.degraded
        };
    };

    CORE.attach('Storage', Storage);

    LOG.info('platform/storage.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
