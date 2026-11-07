/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 4 - Service Layer
 *
 *   File    : js/service/backup.js
 *   Module  : EznK.Service.backup
 *   Layer   : L4 服务层
 *
 *   The backup service: full system snapshots (files + registry +
 *   policies + config) as a single JSON document that can be exported,
 *   stored on the system disk, and restored.
 *
 *   It is deliberately separate from kernel/restore.js:
 *     - restore.js  = lightweight settings restore points (kernel level)
 *     - backup.js   = full user-data export / import (service level)
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.backup) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L4:backup');

    var api = ezn32.api;
    var store = G.EznK.Platform.Storage;

    var DIR = '/System/Backups';

    function currentUser() {
        var u = api.advapi.GetCurrentUser();
        return (u.status === S.OK && u.value) ? u.value.name : 'User';
    }

    /* =================================================================
     * 1. Capture / restore
     * ============================================================== */

    /** capture(opts) -> Promise<{status, value: snapshot}> */
    function capture(opts) {
        var o = opts || {};
        return Promise.resolve().then(function () {
            var snap = {
                meta: {
                    id: 'bk_' + Date.now(),
                    name: o.name || ('Backup ' + new Date().toISOString().slice(0, 19)),
                    user: currentUser(),
                    createdAt: new Date().toISOString(),
                    version: '1.0.0'
                },
                registry: null,
                policies: null,
                config: null,
                files: null
            };
            var reg = EznK.Kernel.registry;
            if (reg && reg.snapshot) { snap.registry = reg.snapshot().value; }
            var pol = EznK.Kernel.policy;
            if (pol && pol.snapshot) { snap.policies = pol.snapshot().value; }
            var cfg = EznK.Kernel.HAL.fs.configSnapshot();
            if (cfg.status === S.OK) { snap.config = cfg.value; }
            return snap;
        }).then(function (snap) {
            if (o.includeFiles === false) { return CORE.ok(snap); }
            return store.readdirTree('/Users/' + snap.meta.user).then(function (r) {
                if (r.status === S.OK) { snap.files = r.value; }
                return CORE.ok(snap);
            });
        });
    }

    /** save(snapshot) -> Promise<{status, value: {path, size}}> */
    function save(snapshot) {
        if (!snapshot || !snapshot.meta) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: 'snapshot object required' }));
        }
        var path = DIR + '/' + snapshot.meta.id + '.json';
        var text = JSON.stringify(snapshot);
        return store.mkdir(DIR).then(function () {
            return store.writeFile(path, text);
        }).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return CORE.ok({ path: path, size: text.length, id: snapshot.meta.id });
        });
    }

    /** list() -> Promise<{status, value: [{id, name, path, size, createdAt}]}> */
    function list() {
        return store.listDir(DIR).then(function (r) {
            if (r.status !== S.OK) { return CORE.ok([]); }
            var out = r.value.filter(function (e) { return /\.json$/.test(e.name); })
                .map(function (e) {
                    return { id: e.name.replace(/\.json$/, ''), name: e.name, path: e.path, size: e.size, createdAt: e.createdAt };
                });
            return CORE.ok(out);
        });
    }

    /** load(id) -> Promise<{status, value: snapshot}> */
    function load(id) {
        return store.readFile(DIR + '/' + id + '.json').then(function (r) {
            if (r.status !== S.OK) { return r; }
            try { return CORE.ok(JSON.parse(r.value)); }
            catch (err) { return CORE.fail(S.EBADIMAGE, { reason: 'backup is corrupt' }); }
        });
    }

    /** restore(id) -> Promise<{status, value: true}> */
    function restore(id) {
        return load(id).then(function (r) {
            if (r.status !== S.OK) { return r; }
            var snap = r.value;
            var reg = EznK.Kernel.registry;
            var pol = EznK.Kernel.policy;
            return Promise.resolve()
                .then(function () {
                    if (reg && snap.registry) { return reg.restore(snap.registry); }
                    return CORE.ok(true);
                })
                .then(function (rr) {
                    if (rr && rr.status !== S.OK) { return rr; }
                    if (pol && snap.policies) { return pol.restore(snap.policies); }
                    return CORE.ok(true);
                })
                .then(function (pr) {
                    if (pr && pr.status !== S.OK) { return pr; }
                    if (snap.config) { return EznK.Kernel.HAL.fs.configRestore(snap.config); }
                    return CORE.ok(true);
                })
                .then(function (cr) {
                    if (cr && cr.status !== S.OK) { return cr; }
                    LOG.info('backup restored: ' + id);
                    var srm = EznK.Kernel.SRM;
                    if (srm) { srm.emit('backup:restored', { id: id }); }
                    return CORE.ok(true);
                });
        });
    }

    function remove(id) {
        return store.deleteFile(DIR + '/' + id + '.json');
    }

    /** exportJson(id) -> Promise<{status, value: string}> */
    function exportJson(id) {
        return store.readFile(DIR + '/' + id + '.json');
    }

    /** importJson(text) -> Promise<{status, value: {id}}> */
    function importJson(text) {
        var snap;
        try { snap = JSON.parse(text); }
        catch (err) { return Promise.resolve(CORE.fail(S.EBADIMAGE, { reason: 'invalid backup JSON' })); }
        if (!snap || !snap.meta) {
            return Promise.resolve(CORE.fail(S.EBADIMAGE, { reason: 'missing backup metadata' }));
        }
        return save(snap);
    }

    function boot() {
        var srm = EznK.Kernel.SRM;
        if (srm) {
            srm.registerService('backup', { init: function () { LOG.info('backup service online'); } });
        }
        return store.mkdir(DIR).then(function () { return CORE.ok(true); });
    }

    var BackupService = {};
    BackupService.version = '1.0.0';
    BackupService.boot = boot;
    BackupService.shutdown = function () { return CORE.ok(true); };
    BackupService.capture = capture;
    BackupService.save = save;
    BackupService.list = list;
    BackupService.load = load;
    BackupService.restore = restore;
    BackupService.remove = remove;
    BackupService.exportJson = exportJson;
    BackupService.importJson = importJson;
    BackupService.DIR = DIR;

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.backup = BackupService;
    if (EznK.Kernel.SRM && typeof EznK.Kernel.SRM.register === 'function') {
        EznK.Kernel.SRM.register('service-backup', BackupService);
    }
    LOG.info('js/service/backup.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
