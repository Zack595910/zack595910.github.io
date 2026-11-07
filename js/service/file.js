/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 4 - Service Layer
 *
 *   File    : js/service/file.js
 *   Module  : EznK.Service.file
 *   Layer   : L4 服务层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The file service: user-facing file operations that sit ABOVE raw
 *   storage. It adds what an operating system does and a filesystem does
 *   not:
 *
 *     - trash        delete -> /Users/<u>/Trash, restore, empty
 *     - recent files the Recently Opened list on the config disk
 *     - user folders ensure Desktop/Documents/Settings/Registry/Trash
 *     - open         route a file to its application via the shell
 *     - new file types helpers for .rf / .kd / .sys / .exc
 *
 *   Raw I/O goes through Ezn32 API (which goes through NT -> SRM -> HAL).
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.file) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L4:file');

    var api = ezn32.api;
    var K = api.kernel;
    var shell = api.shell;

    var USER_DIRS = ['Desktop', 'Documents', 'Settings', 'Registry', 'Trash'];
    var RECENT_MAX = 12;

    /* =================================================================
     * 1. Paths
     * ============================================================== */

    function currentUser() {
        var r = api.advapi.GetCurrentUser();
        return (r.status === S.OK && r.value) ? r.value.name : 'User';
    }

    function userRoot() { return '/Users/' + currentUser(); }
    function trashDir() { return userRoot() + '/Trash'; }
    function recentKey() { return userRoot() + '/RecentFiles.json'; }

    /* =================================================================
     * 2. User folders
     * ============================================================== */

    function ensureUserFolders() {
        var chain = Promise.resolve();
        var root = userRoot();
        chain = chain.then(function () { return K.CreateDirectory('/Users'); });
        chain = chain.then(function () { return K.CreateDirectory(root); });
        USER_DIRS.forEach(function (d) {
            chain = chain.then(function () { return K.CreateDirectory(root + '/' + d); });
        });
        return chain.then(function () {
            return CORE.ok({ root: root, dirs: USER_DIRS.slice(0) });
        });
    }

    /** listFolder(path) -> Promise<{status, value: entry[]}> */
    function listFolder(path) {
        return K.FindFiles(path);
    }

    /* =================================================================
     * 3. Trash
     * ============================================================== */

    /**
     * moveToTrash(path) -> Promise<{status, value: {original, trashPath}}>
     *   Moves a file into the user trash, keeping the original path in a
     *   sidecar index so it can be restored.
     */
    function moveToTrash(path) {
        if (typeof path !== 'string' || path.length === 0) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'path required' }));
        }
        var name = path.slice(path.lastIndexOf('/') + 1);
        var stamp = Date.now() + '_' + Math.floor(Math.random() * 1000);
        var target = trashDir() + '/' + stamp + '__' + name;
        return ensureUserFolders().then(function () {
            return K.MoveFile(path, target);
        }).then(function (r) {
            if (r.status !== S.OK) { return r; }
            addTrashRecord({ id: stamp, original: path, trashPath: target, name: name, at: Date.now() });
            return CORE.ok({ original: path, trashPath: target, id: stamp });
        });
    }

    function trashIndexKey() { return userRoot() + '/Registry/Trash.json'; }

    function addTrashRecord(rec) {
        var hal = EznK.Kernel.HAL;
        var cur = hal.fs.configGet(trashIndexKey(), null);
        var list = (cur.status === S.OK && Array.isArray(cur.value)) ? cur.value : [];
        list.push(rec);
        hal.fs.configSet(trashIndexKey(), list);
        return CORE.ok(true);
    }

    /** listTrash() -> { status, value: record[] } */
    function listTrash() {
        var hal = EznK.Kernel.HAL;
        var cur = hal.fs.configGet(trashIndexKey(), []);
        return CORE.ok((cur.status === S.OK && Array.isArray(cur.value)) ? cur.value : []);
    }

    /** restoreFromTrash(id) -> Promise<{status, value: true}> */
    function restoreFromTrash(id) {
        var list = listTrash().value;
        var rec = null;
        for (var i = 0; i < list.length; i++) { if (list[i].id === id) { rec = list[i]; break; } }
        if (!rec) { return Promise.resolve(CORE.fail(S.ENOENT, { reason: 'unknown trash item' })); }
        return K.MoveFile(rec.trashPath, rec.original).then(function (r) {
            if (r.status !== S.OK) { return r; }
            removeTrashRecord(id);
            return CORE.ok(true);
        });
    }

    /** emptyTrash() -> Promise<{status, value: number}> */
    function emptyTrash() {
        var list = listTrash().value;
        var chain = Promise.resolve();
        var removed = 0;
        list.forEach(function (rec) {
            chain = chain.then(function () {
                return K.DeleteFile(rec.trashPath);
            }).then(function (r) {
                if (r && r.status === S.OK) { removed += 1; }
            });
        });
        return chain.then(function () {
            var hal = EznK.Kernel.HAL;
            hal.fs.configSet(trashIndexKey(), []);
            return CORE.ok(removed);
        });
    }

    function removeTrashRecord(id) {
        var list = listTrash().value.filter(function (r) { return r.id !== id; });
        EznK.Kernel.HAL.fs.configSet(trashIndexKey(), list);
        return CORE.ok(true);
    }

    /* =================================================================
     * 4. Recent files
     * ============================================================== */

    function addRecent(path) {
        if (typeof path !== 'string' || path.length === 0) { return CORE.ok(false); }
        var hal = EznK.Kernel.HAL;
        var cur = hal.fs.configGet(recentKey(), null);
        var list = (cur.status === S.OK && Array.isArray(cur.value)) ? cur.value : [];
        list = list.filter(function (p) { return p !== path; });
        list.unshift(path);
        if (list.length > RECENT_MAX) { list = list.slice(0, RECENT_MAX); }
        hal.fs.configSet(recentKey(), list);
        return CORE.ok(true);
    }

    function listRecent() {
        var hal = EznK.Kernel.HAL;
        var cur = hal.fs.configGet(recentKey(), []);
        return CORE.ok((cur.status === S.OK && Array.isArray(cur.value)) ? cur.value : []);
    }

    function clearRecent() {
        EznK.Kernel.HAL.fs.configSet(recentKey(), []);
        return CORE.ok(true);
    }

    /* =================================================================
     * 5. Open
     * ============================================================== */

    /** open(path) - route through the shell and record it as recent. */
    function open(path) {
        if (typeof path !== 'string' || path.length === 0) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'path required' }));
        }
        addRecent(path);
        return shell.ShellExecute(path).then(function (r) {
            if (r.status !== S.OK) {
                /* L4 -> L4 only: report through the notify service, which
                 * owns the surface. The file service never reaches up to
                 * the shell layer (rule 1). */
                var notify = G.EznK.Service && G.EznK.Service.notify;
                if (notify) {
                    notify.push({ title: 'Cannot open file', text: (r.reason || '').slice(0, 80), level: 'error' });
                }
            }
            return r;
        });
    }

    /* =================================================================
     * 6. File creators
     * ============================================================== */

    function createText(path, content) {
        return K.WriteFileText(path, content || '');
    }

    function createFolder(path) { return K.CreateDirectory(path); }

    /** newFile(folder, baseName, ext, content) - unique name inside folder. */
    function newFile(folder, baseName, ext, content) {
        var base = baseName || 'NewFile';
        var suffix = ext ? (ext.charAt(0) === '.' ? ext : '.' + ext) : '';
        var path = folder + '/' + base + suffix;
        return K.GetFileAttributes(path).then(function (r) {
            if (r.status !== S.OK) {
                return K.WriteFileText(path, content || '');
            }
            var n = 2;
            function tryNext() {
                var candidate = folder + '/' + base + ' (' + n + ')' + suffix;
                return K.GetFileAttributes(candidate).then(function (rr) {
                    if (rr.status !== S.OK) { return K.WriteFileText(candidate, content || ''); }
                    n += 1;
                    if (n > 100) { return CORE.fail(S.EBUSY, { reason: 'too many duplicates' }); }
                    return tryNext();
                });
            }
            return tryNext();
        });
    }

    /* =================================================================
     * 7. Lifecycle
     * ============================================================== */

    function boot() {
        return ensureUserFolders().then(function () {
            LOG.info('file service online');
            return CORE.ok(true);
        });
    }

    function shutdown() { return CORE.ok(true); }

    var FileService = {};
    FileService.version = '1.0.0';
    FileService.boot = boot;
    FileService.shutdown = shutdown;

    FileService.currentUser = currentUser;
    FileService.userRoot = userRoot;
    FileService.trashDir = trashDir;
    FileService.ensureUserFolders = ensureUserFolders;
    FileService.listFolder = listFolder;

    FileService.moveToTrash = moveToTrash;
    FileService.listTrash = listTrash;
    FileService.restoreFromTrash = restoreFromTrash;
    FileService.emptyTrash = emptyTrash;

    FileService.addRecent = addRecent;
    FileService.listRecent = listRecent;
    FileService.clearRecent = clearRecent;

    FileService.open = open;
    FileService.createText = createText;
    FileService.createFolder = createFolder;
    FileService.newFile = newFile;
    FileService.USER_DIRS = USER_DIRS.slice(0);

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.file = FileService;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('service-file', FileService);
    }
    LOG.info('js/service/file.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
