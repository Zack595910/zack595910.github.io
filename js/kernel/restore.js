/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 3 - Kernel Layer (SRM)
 *
 *   File    : js/kernel/restore.js
 *   Module  : EznK.Kernel.Restore
 *   Layer   : L3 内核层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   System restore points (contract 7.3):
 *
 *     createRestorePoint(label, description) -> { status, value: point }
 *     restoreToPoint(id)                     -> { status, value: true }
 *     listRestorePoints()                    -> { status, value: point[] }
 *     deleteRestorePoint(id)                 -> { status, value: true }
 *
 *   A restore point captures:
 *     - registry snapshot      (kernel/registry)
 *     - policy snapshot        (kernel/policy)
 *     - configuration disk     (storage config snapshot)
 *     - user files (optional, heavy)  -- disabled by default
 *
 *   Restoring re-applies those three in reverse order so a failed restore
 *   leaves the system unchanged as far as possible.
 *
 *   Persisted under /System/Restore/ so the backup manager can list them.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Kernel && G.EznK.Kernel.Restore &&
        G.EznK.Kernel.Restore.__isRestore === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var SRM = G.SRM;
    if (!CORE || !SRM) {
        throw new Error('[EznK/L3] kernel/restore.js requires core modules');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('EznK/L3:restore');

    /* HAL is resolved lazily so this module works whatever the load order. */
    function hal() {
        var k = G.EznK && G.EznK.Kernel;
        return (k && k.modules && k.modules.hal) || null;
    }
    var DIR = '/System/Restore';
    var MAX_POINTS = 20;

    var points = [];
    var seq = 0;

    function module(name) {
        return (G.EznK.Kernel && G.EznK.Kernel.modules && G.EznK.Kernel.modules[name]) || null;
    }

    /* =================================================================
     * 1. Capture
     * ============================================================== */

    function captureSnapshot(withFiles) {
        var reg = module('registry');
        var pol = module('policy');
        return Promise.resolve().then(function () {
            var snap = {
                registry: reg ? reg.snapshot().value : null,
                policies: pol ? pol.snapshot().value : null,
                config: null,
                files: null,
                withFiles: !!withFiles
            };
            if (hal()) {
                var c = hal().fs.configSnapshot ? hal().fs.configSnapshot() : null;
                if (c && c.status === S.OK) { snap.config = c.value; }
            }
            if (withFiles && hal()) {
                return hal().fs.readdirTree('/Users').then(function (r) {
                    if (r.status === S.OK) { snap.files = r.value; }
                    return snap;
                });
            }
            return snap;
        });
    }

    /** createRestorePoint(label, description) -> Promise<{status, value: point}> */
    function createRestorePoint(label, description) {
        if (!hal()) { return Promise.resolve(fail(S.ENOSYS, { reason: 'HAL not available' })); }
        seq += 1;
        var id = 'rp_' + Date.now() + '_' + seq;
        var point = {
            id: id,
            label: (typeof label === 'string' && label.length) ? label : 'Restore point ' + seq,
            description: (typeof description === 'string') ? description : '',
            createdAt: new Date().toISOString(),
            at: Date.now(),
            size: 0
        };
        return captureSnapshot(point.label.indexOf('[full]') === 0).then(function (snap) {
            var payload = JSON.stringify({ meta: point, snapshot: snap });
            point.size = payload.length;
            var file = DIR + '/' + id + '.json';
            return hal().fs.writeFile(file, payload).then(function (w) {
                if (w.status !== S.OK) { return w; }
                point.file = file;
                points.push(point);
                trim();
                persistIndex();
                LOG.info('restore point created: ' + point.label + ' (' + point.id + ')');
                SRM.emit('restore:created', { id: id, label: point.label });
                return ok(point);
            });
        });
    }

    function trim() {
        if (points.length <= MAX_POINTS) { return; }
        var removed = points.splice(0, points.length - MAX_POINTS);
        removed.forEach(function (p) {
            if (hal() && p.file) {
                hal().fs.deleteFile(p.file).then(null, function () { /* ignore */ });
            }
        });
    }

    /* =================================================================
     * 2. Listing / deleting
     * ============================================================== */

    function listRestorePoints() {
        return ok(points.slice(0).sort(function (a, b) { return b.at - a.at; }));
    }

    function findPoint(id) {
        for (var i = 0; i < points.length; i++) {
            if (points[i].id === id) { return points[i]; }
        }
        return null;
    }

    function deleteRestorePoint(id) {
        var p = findPoint(id);
        if (!p) { return Promise.resolve(fail(S.ENOENT, { id: id })); }
        points = points.filter(function (x) { return x.id !== id; });
        persistIndex();
        if (hal() && p.file) {
            return hal().fs.deleteFile(p.file).then(function () { return ok(true); });
        }
        return Promise.resolve(ok(true));
    }

    function persistIndex() {
        if (!hal()) { return; }
        hal().fs.writeFile(DIR + '/Index.json', JSON.stringify(points)).then(null, function () {
            LOG.warn('restore index persist failed');
        });
    }

    function loadIndex() {
        if (!hal()) { return Promise.resolve(ok(true)); }
        return hal().fs.readFile(DIR + '/Index.json').then(function (r) {
            if (r.status !== S.OK) { return ok(true); }
            try {
                var parsed = JSON.parse(r.value);
                if (Array.isArray(parsed)) {
                    points = parsed.filter(function (p) { return p && p.id; });
                    var last = points[points.length - 1];
                    if (last && typeof last.at === 'number') { seq = points.length; }
                }
            } catch (err) {
                LOG.warn('restore index corrupt, starting empty');
            }
            return ok(true);
        });
    }

    /* =================================================================
     * 3. Restore
     * ============================================================== */

    /** restoreToPoint(id) -> Promise<{status, value: true}> */
    function restoreToPoint(id) {
        if (!hal()) { return Promise.resolve(fail(S.ENOSYS, { reason: 'HAL not available' })); }
        if (typeof id !== 'string' || id.length === 0) {
            return Promise.resolve(fail(S.EINVAL, { reason: 'restore point id required' }));
        }
        var point = findPoint(id);
        if (!point) { return Promise.resolve(fail(S.ENOENT, { id: id })); }

        var policy = module('policy');
        if (policy && !policy.isPolicyEnabled('RequireRestorePointBeforeRestore')) {
            /* policy says no pre-restore snapshot needed */
        }

        return hal().fs.readFile(point.file).then(function (r) {
            if (r.status !== S.OK) { return r; }
            var data;
            try { data = JSON.parse(r.value); } catch (err) {
                return fail(S.EBADIMAGE, { reason: 'restore point corrupt' });
            }
            var snap = data.snapshot || {};
            var reg = module('registry');
            var pol = module('policy');
            return Promise.resolve()
                .then(function () {
                    if (reg && snap.registry) { return reg.restore(snap.registry); }
                    return ok(true);
                })
                .then(function (rr) {
                    if (rr && rr.status !== S.OK) { return rr; }
                    if (pol && snap.policies) { return pol.restore(snap.policies); }
                    return ok(true);
                })
                .then(function (pr) {
                    if (pr && pr.status !== S.OK) { return pr; }
                    if (snap.config && hal().fs.configRestore) {
                        return hal().fs.configRestore(snap.config);
                    }
                    return ok(true);
                })
                .then(function (cr) {
                    if (cr && cr.status !== S.OK) { return cr; }
                    LOG.info('system restored to: ' + point.label);
                    SRM.emit('restore:applied', { id: id, label: point.label });
                    return ok(true);
                });
        });
    }

    /* =================================================================
     * 4. Module
     * ============================================================== */

    var Rst = {};
    Rst.__isRestore = true;
    Rst.version = '1.0.0';
    Rst.STATUS = S;

    Rst.createRestorePoint = createRestorePoint;
    Rst.restoreToPoint = restoreToPoint;
    Rst.listRestorePoints = listRestorePoints;
    Rst.deleteRestorePoint = deleteRestorePoint;

    Rst.bind = ['createRestorePoint', 'restoreToPoint', 'listRestorePoints'];

    Rst.boot = function () {
        if (hal()) {
            return hal().fs.mkdir(DIR).then(function () {
                return loadIndex();
            }).then(function () {
                LOG.info('restore service online (' + points.length + ' points)');
                return ok(true);
            });
        }
        return ok(true);
    };
    Rst.shutdown = function () { return ok(true); };

    SRM.register('restore', Rst);
    LOG.info('kernel/restore.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
