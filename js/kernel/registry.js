/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 3 - Kernel Layer (SRM)
 *
 *   File    : js/kernel/registry.js
 *   Module  : EznK.Kernel.Registry
 *   Layer   : L3 内核层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The system registry (contract 7.3):
 *
 *     regSet(path, value)  -> { status, value: true }
 *     regGet(path)         -> { status, value: any }   ENOENT when missing
 *     regDelete(path)      -> { status, value: true }
 *     regList(path)        -> { status, value: string[] }
 *
 *   ---- LEGACY SEMANTICS (highest priority, contract 7.3) ----
 *   Old sys scripts call these with backslash paths
 *   ("HKLM\\Software\\EZNT") and expect the old return shapes. To keep
 *   them running unchanged, these four methods return the LEGACY shape
 *   (regSet -> SRM-like, regGet -> raw value or undefined, regDelete ->
 *   boolean, regList -> string[]).
 *
 *   `rs.*` (registry service) below is the strict, status-coded API for
 *   new EZNT code (Windows registry editor, gpedit, backup).
 *
 *   Persistence goes through HAL -> storage gateway (hard rule #7);
 *   nothing here touches localStorage directly.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Kernel && G.EznK.Kernel.Registry &&
        G.EznK.Kernel.Registry.__isRegistry === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var SRM = G.SRM;
    if (!CORE || !SRM) {
        throw new Error('[EznK/L3] kernel/registry.js requires core modules');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('EznK/L3:registry');

    /* HAL is resolved lazily so this module works whatever the load order. */
    function hal() {
        var k = G.EznK && G.EznK.Kernel;
        return (k && k.modules && k.modules.hal) || null;
    }

    var STORE_KEY = '/System/Registry/Registry.json';
    var MAX_DEPTH = 64;

    /* The registry tree: a plain nested object, exactly like the legacy
     * implementation, so key/value semantics stay identical. */
    var tree = {};
    var dirty = false;
    var saveTimer = null;

    /* =================================================================
     * 1. Path handling
     * ============================================================== */

    /** Canonical key path: backslash separated, no leading/trailing. */
    function normalize(path) {
        if (typeof path !== 'string') { return null; }
        var p = path.replace(/\//g, '\\').replace(/\\{2,}/g, '\\');
        p = p.replace(/^\\+/, '').replace(/\\+$/, '');
        if (p.length === 0 || p.length > 1024) { return null; }
        if (p.split('\\').length > MAX_DEPTH) { return null; }
        return p;
    }

    function split(path) {
        return path.length ? path.split('\\') : [];
    }

    /** Navigate to a node; returns { found, node, parent, leaf }. */
    function walk(path) {
        var keys = split(path);
        var node = tree;
        var parent = null;
        for (var i = 0; i < keys.length; i++) {
            if (!node || typeof node !== 'object') {
                return { found: false, node: null, parent: parent, leaf: keys[i] };
            }
            parent = node;
            node = node[keys[i]];
            if (node === undefined) {
                return { found: false, node: null, parent: parent, leaf: keys[i] };
            }
        }
        return { found: true, node: node, parent: parent, leaf: keys.length ? keys[keys.length - 1] : null };
    }

    function isLeafValue(v) {
        return v === null || typeof v !== 'object' || Array.isArray(v);
    }

    /* =================================================================
     * 2. Persistence (through HAL -> storage gateway)
     * ============================================================== */

    function persist() {
        if (!hal()) { return; }
        dirty = true;
        if (saveTimer !== null) { return; }
        saveTimer = setTimeout(function () {
            saveTimer = null;
            flush();
        }, 200);
    }

    function flush() {
        dirty = false;
        if (!hal()) { return Promise.resolve(ok(true)); }
        try {
            return hal().fs.writeFile(STORE_KEY, JSON.stringify(tree)).then(function (r) {
                if (r.status !== S.OK) {
                    LOG.warn('registry persist failed: ' + (r.reason || r.error));
                }
                return r;
            }, function (err) {
                LOG.warn('registry persist failed: ' + err.message);
                return fail(S.EIO);
            });
        } catch (err) {
            return Promise.resolve(fail(S.EIO, { reason: err.message }));
        }
    }

    function load() {
        if (!hal()) { return Promise.resolve(ok({})); }
        return hal().fs.readFile(STORE_KEY).then(function (r) {
            if (r.status !== S.OK) {
                tree = seedDefaults();
                flush();
                return ok(tree);
            }
            try {
                var parsed = JSON.parse(r.value);
                tree = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
            } catch (err) {
                LOG.warn('registry file corrupt, resetting');
                tree = seedDefaults();
                flush();
            }
            return ok(tree);
        });
    }

    /** Factory registry keys installed on first boot. */
    function seedDefaults() {
        return {
            HKLM: {
                Software: {
                    EZNT: {
                        Version: '1.0.0',
                        InstalledAt: new Date().toISOString(),
                        'CurrentUser': ''
                    }
                },
                'System': {
                    'ControlSet001': {
                        'Services': {},
                        'Display': { 'Resolution': { 'Width': 1280, 'Height': 720 } }
                    }
                }
            },
            HKCU: {
                Software: { EZNT: {} },
                'Control Panel': { 'Desktop': { 'Wallpaper': 'default', 'IconSize': 48 } }
            },
            /* HKCR maps a file extension to the APPLICATION ID that opens
             * it - the shell's association table. MIME types live under
             * HKCR\Mime so a KD app can ask for either without ambiguity. */
            HKCR: {
                '.txt': 'editor',
                '.md': 'editor',
                '.py': 'editor',
                '.rf': 'rf-runtime',
                '.sys': 'sys-manager',
                '.exc': 'exc-runtime',
                '.kd': 'kd-runtime',
                '.zjl': 'editor',
                '.skl': 'info',
                '.json': 'editor',
                '.html': 'kd-runtime',
                'Mime': {
                    '.txt': 'text/plain',
                    '.kd': 'application/x-eznt-kd',
                    '.exc': 'application/x-eznt-exc',
                    '.rf': 'application/x-eznt-rf'
                }
            }
        };
    }

    /* =================================================================
     * 3. Strict API (rs.*)
     * ============================================================== */

    function rsSet(path, value) {
        var p = normalize(path);
        if (p === null) { return fail(S.EINVAL, { reason: 'invalid registry path' }); }
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            // 对象写入按树节点合并
            var keys = split(p);
            var node = tree;
            for (var i = 0; i < keys.length; i++) {
                if (!node[keys[i]] || typeof node[keys[i]] !== 'object') {
                    node[keys[i]] = {};
                }
                node = node[keys[i]];
            }
            Object.keys(value).forEach(function (k) { node[k] = value[k]; });
        } else {
            var keys2 = split(p);
            if (keys2.length === 0) {
                if (value && typeof value === 'object') { tree = value; } else { return fail(S.EINVAL, { reason: 'root must be an object' }); }
            } else {
                var cur = tree;
                for (var j = 0; j < keys2.length - 1; j++) {
                    if (!cur[keys2[j]] || typeof cur[keys2[j]] !== 'object') {
                        cur[keys2[j]] = {};
                    }
                    cur = cur[keys2[j]];
                }
                cur[keys2[keys2.length - 1]] = value;
            }
        }
        persist();
        return ok(true);
    }

    function rsGet(path) {
        var p = normalize(path);
        if (p === null) { return fail(S.EINVAL, { reason: 'invalid registry path' }); }
        if (p === '') { return ok(tree); }
        var w = walk(p);
        if (!w.found) { return fail(S.ENOENT, { path: p }); }
        return ok(w.node);
    }

    function rsDelete(path) {
        var p = normalize(path);
        if (p === null || p === '') { return fail(S.EACCES, { reason: 'cannot delete the registry root' }); }
        var w = walk(p);
        if (!w.found) { return fail(S.ENOENT, { path: p }); }
        delete w.parent[w.leaf];
        persist();
        return ok(true);
    }

    function rsList(path) {
        var p = normalize(path === undefined ? '' : path);
        if (p === null) { return fail(S.EINVAL, { reason: 'invalid registry path' }); }
        var node = p === '' ? tree : (function () {
            var w = walk(p);
            return w.found ? w.node : undefined;
        }());
        if (node === undefined) { return fail(S.ENOENT, { path: p }); }
        if (node === null || typeof node !== 'object' || Array.isArray(node)) {
            return ok([]);
        }
        return ok(Object.keys(node).sort());
    }

    /** Tree snapshot for the registry editor / backup. */
    function snapshot() {
        return ok(JSON.parse(JSON.stringify(tree)));
    }

    function restore(snap) {
        if (!snap || typeof snap !== 'object' || Array.isArray(snap)) {
            return fail(S.EINVAL, { reason: 'snapshot object required' });
        }
        tree = JSON.parse(JSON.stringify(snap));
        persist();
        return flush();
    }

    function exportJson() {
        return ok(JSON.stringify(tree, null, 2));
    }

    function importJson(text) {
        if (typeof text !== 'string') { return fail(S.EINVAL, { reason: 'text required' }); }
        try {
            var parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return fail(S.EBADIMAGE, { reason: 'registry JSON must be an object' });
            }
            tree = parsed;
            persist();
            flush();
            return ok(true);
        } catch (err) {
            return fail(S.EBADIMAGE, { reason: 'invalid registry JSON: ' + err.message });
        }
    }

    /* =================================================================
     * 4. Legacy contract methods (exact old shapes)
     * ============================================================== */

    /** regSet(path, value) -> SRM (legacy chainable) */
    function regSet(path, value) {
        var r = rsSet(path, value);
        return r.status === S.OK ? SRM : SRM;
    }

    /** regGet(path) -> value | undefined (legacy) */
    function regGet(path) {
        var r = rsGet(path);
        return r.status === S.OK ? r.value : undefined;
    }

    /** regDelete(path) -> boolean (legacy) */
    function regDelete(path) {
        return rsDelete(path).status === S.OK;
    }

    /** regList(path) -> string[] (legacy) */
    function regList(path) {
        var r = rsList(path);
        return r.status === S.OK ? r.value : [];
    }

    /* =================================================================
     * 5. Module lifecycle
     * ============================================================== */

    var Registry = {};
    Registry.__isRegistry = true;
    Registry.version = '1.0.0';
    Registry.STATUS = S;

    /* strict API */
    Registry.set = rsSet;
    Registry.get = rsGet;
    Registry.delete = rsDelete;
    Registry.list = rsList;
    Registry.snapshot = snapshot;
    Registry.restore = restore;
    Registry.exportJson = exportJson;
    Registry.importJson = importJson;

    /* legacy contract */
    Registry.regSet = regSet;
    Registry.regGet = regGet;
    Registry.regDelete = regDelete;
    Registry.regList = regList;

    Registry.bind = ['regSet', 'regGet', 'regDelete', 'regList'];

    Registry.boot = function () {
        return load().then(function (r) {
            if (r.status !== S.OK) { return r; }
            var n = Object.keys(tree).length;
            LOG.info('registry loaded (' + n + ' hives)');
            return ok(true);
        });
    };

    Registry.shutdown = function () {
        if (saveTimer !== null) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        if (dirty) { return flush(); }
        return ok(true);
    };

    /** tree accessor for internal kernel use (not a public API). */
    Registry._tree = function () { return tree; };

    SRM.register('registry', Registry);
    LOG.info('kernel/registry.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
