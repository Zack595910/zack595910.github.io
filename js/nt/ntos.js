/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 NT Layer
 *
 *   File    : js/nt/ntos.js
 *   Module  : EznK.Nt.Ntos  (alias: EZNT.Nt.Ntos)
 *   Layer   : Ezn32 NT
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The Nt* system call implementations - the equivalent of the ntdll
 *   syscall stubs. Every one of them:
 *
 *     1. validates arguments        -> EINVAL
 *     2. checks the kernel is up    -> EPOWEROFF  (handled by syscall.js)
 *     3. resolves an object through the handle table (where applicable)
 *     4. performs the operation through SRM ONLY
 *     5. returns { status, value }
 *
 *   NOT ONE of these functions touches window.*, document.*, localStorage
 *   or fetch directly. They call SRM.* / SRM kernel modules, which call
 *   HAL, which calls L1. That is the enforced call chain.
 *
 *   Syscall groups:
 *     Filesystem   NtCreateFile NtOpenFile NtReadFile NtWriteFile
 *                  NtDeleteFile NtQueryAttributesFile NtQueryDirectoryFile
 *                  NtCreateDirectoryObject NtCopyFile NtRenameFile
 *     Process      NtCreateProcess NtTerminateProcess NtQueryInformationProcess
 *     Object       NtClose NtDuplicateObject NtQueryObject
 *     Registry     NtOpenKey NtSetValueKey NtQueryValueKey NtDeleteKey
 *     Services     NtCreateService NtStartService NtStopService NtQueryServices
 *     System       NtQuerySystemInformation NtShutdownSystem NtCreateRestorePoint
 *                  NtRestoreSystem NtScheduleTask NtEmitEvent
 *     Messaging    NtSendMessage NtBroadcast
 *     Time         NtDelayExecution NtQueryTime
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Nt && G.EznK.Nt.Ntos && G.EznK.Nt.Ntos.__isNtos === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var NT = (G.EznK && G.EznK.Nt) || {};
    if (!CORE || !NT.Syscall || !NT.HandleTable || !NT.Status) {
        throw new Error('[Ezn32 NT] js/nt/ntos.js requires status.js, handle.js and syscall.js');
    }

    var S = CORE.STATUS;
    var SC = NT.Syscall;
    var H = NT.HandleTable;
    var Status = NT.Status;
    var RIGHTS = H.RIGHTS;
    var LOG = CORE.createLogger('Ezn32/NT:ntos');

    var ok = Status.success;
    var bad = Status.failure;

    function srm() {
        var k = G.EznK && G.EznK.Kernel;
        return (k && k.SRM) || G.SRM;
    }

    /** Get an SRM kernel module by name (kebab or camel). */
    function mod(name) {
        var k = G.EznK && G.EznK.Kernel;
        if (!k) { return null; }
        return (k.modules && k.modules[name]) || k[name] || null;
    }

    /**
     * Kernel-backed file I/O. The kernel's filesystem entry point is the
     * HAL fs facade (HAL is an SRM module), so Ezn32 NT -> SRM(HAL) -> L1.
     * When a later service layer registers richer SRM functions they are
     * preferred, but NT must work on its own.
     */
    var fs = {
        read: function (path) {
            var hal = mod('hal');
            if (!hal) { return Promise.resolve(bad(S.ENOSYS, 'HAL not loaded')); }
            return hal.fs.readFile(path);
        },
        write: function (path, data) {
            var hal = mod('hal');
            if (!hal) { return Promise.resolve(bad(S.ENOSYS, 'HAL not loaded')); }
            return hal.fs.writeFile(path, data);
        },
        remove: function (path) {
            var hal = mod('hal');
            if (!hal) { return Promise.resolve(bad(S.ENOSYS, 'HAL not loaded')); }
            return hal.fs.deleteFile(path);
        },
        stat: function (path) {
            var hal = mod('hal');
            if (!hal) { return Promise.resolve(bad(S.ENOSYS, 'HAL not loaded')); }
            return hal.fs.stat(path);
        },
        list: function (path) {
            var hal = mod('hal');
            if (!hal) { return Promise.resolve(bad(S.ENOSYS, 'HAL not loaded')); }
            return hal.fs.listDir(path);
        },
        mkdir: function (path) {
            var hal = mod('hal');
            if (!hal) { return Promise.resolve(bad(S.ENOSYS, 'HAL not loaded')); }
            return hal.fs.mkdir(path);
        },
        copy: function (a, b) {
            var hal = mod('hal');
            if (!hal) { return Promise.resolve(bad(S.ENOSYS, 'HAL not loaded')); }
            return hal.fs.copy(a, b);
        },
        rename: function (path, name) {
            var hal = mod('hal');
            if (!hal) { return Promise.resolve(bad(S.ENOSYS, 'HAL not loaded')); }
            return hal.fs.rename(path, name);
        }
    };

    /* =================================================================
     * 1. Filesystem syscalls
     * ============================================================== */

    function reqPath(a) {
        return (typeof a.path === 'string' && a.path.length > 0) ? null
            : bad(S.EINVAL, 'path required');
    }

    /** NtCreateFile({ path, content, mode }) -> handle */
    function NtCreateFile(a) {
        var e = reqPath(a); if (e) { return e; }
        var content = a.content === undefined || a.content === null ? '' : a.content;
        if (typeof content !== 'string') { return bad(S.EINVAL, 'content must be a string'); }
        return fs.write(a.path, content).then(function (r) {
            if (!CORE.isResult(r)) { return bad(S.EFAULT, 'file write returned no status'); }
            if (r.status !== S.OK) { return Status.decorate(r); }
            return H.create('file', { path: a.path }, {
                rights: RIGHTS.GENERIC_ALL,
                owner: a.owner || 'system',
                mode: a.mode || 'rw'
            });
        });
    }

    /** NtOpenFile({ path, mode='r' }) -> handle */
    function NtOpenFile(a) {
        var e = reqPath(a); if (e) { return e; }
        return fs.stat(a.path).then(function (st) {
            if (!CORE.isResult(st)) { return bad(S.EFAULT, 'file stat failed'); }
            if (st.status !== S.OK) { return Status.decorate(st); }
            var isDir = st.value && st.value.type === 'dir';
            return H.create('file', { path: a.path, isDir: !!isDir }, {
                rights: a.mode === 'r' ? RIGHTS.GENERIC_READ : RIGHTS.GENERIC_ALL,
                owner: a.owner || 'system',
                mode: a.mode === 'w' ? 'rw' : 'r'
            });
        });
    }

    /** Read a file through a handle: NtReadFile({ handle }) */
    function NtReadFile(a) {
        var r = H.resolve(a.handle);
        if (r.status !== S.OK) { return Status.decorate(r); }
        var rec = r.value;
        if (rec.type !== 'file') { return bad(S.EBADF, 'handle is not a file'); }
        var check = H.checkRights(a.handle, RIGHTS.GENERIC_READ);
        if (check.status !== S.OK) { return Status.decorate(check); }
        return fs.read(rec.object.path).then(function (out) {
            if (!CORE.isResult(out)) { return bad(S.EFAULT, 'file read failed'); }
            if (out.status !== S.OK) { return Status.decorate(out); }
            return ok({ data: out.value, length: out.value.length });
        });
    }

    /** NtWriteFile({ handle, data }) */
    function NtWriteFile(a) {
        var r = H.resolve(a.handle);
        if (r.status !== S.OK) { return Status.decorate(r); }
        var rec = r.value;
        if (rec.type !== 'file') { return bad(S.EBADF, 'handle is not a file'); }
        if (typeof a.data !== 'string') { return bad(S.EINVAL, 'data must be a string'); }
        if (rec.mode === 'r') { return bad(S.EACCES, 'handle opened read-only'); }
        return fs.write(rec.object.path, a.data).then(function (out) {
            if (!CORE.isResult(out)) { return bad(S.EFAULT, 'file write failed'); }
            return out.status === S.OK ? ok({ written: a.data.length }) : Status.decorate(out);
        });
    }

    /** NtDeleteFile({ path }) */
    function NtDeleteFile(a) {
        var e = reqPath(a); if (e) { return e; }
        return fs.remove(a.path).then(function (out) {
            return CORE.isResult(out) ? Status.decorate(out) : bad(S.EFAULT, 'file delete failed');
        });
    }

    /** NtQueryAttributesFile({ path }) */
    function NtQueryAttributesFile(a) {
        var e = reqPath(a); if (e) { return e; }
        return fs.stat(a.path).then(function (out) {
            return CORE.isResult(out) ? Status.decorate(out) : bad(S.EFAULT, 'file stat failed');
        });
    }

    /** NtQueryDirectoryFile({ path }) */
    function NtQueryDirectoryFile(a) {
        var e = reqPath(a); if (e) { return e; }
        return fs.list(a.path).then(function (out) {
            return CORE.isResult(out) ? Status.decorate(out) : bad(S.EFAULT, 'file list failed');
        });
    }

    /** NtCreateDirectoryObject({ path }) */
    function NtCreateDirectoryObject(a) {
        var e = reqPath(a); if (e) { return e; }
        return fs.mkdir(a.path).then(function (out) {
            return CORE.isResult(out) ? Status.decorate(out) : bad(S.EFAULT, 'file mkdir failed');
        });
    }

    /** NtCopyFile({ source, target }) */
    function NtCopyFile(a) {
        if (typeof a.source !== 'string' || typeof a.target !== 'string') {
            return bad(S.EINVAL, 'source and target required');
        }
        return fs.copy(a.source, a.target).then(function (out) {
            return CORE.isResult(out) ? Status.decorate(out) : bad(S.EFAULT, 'file copy failed');
        });
    }

    /** NtRenameFile({ path, newName }) */
    function NtRenameFile(a) {
        if (typeof a.path !== 'string' || typeof a.newName !== 'string') {
            return bad(S.EINVAL, 'path and newName required');
        }
        return fs.rename(a.path, a.newName).then(function (out) {
            return CORE.isResult(out) ? Status.decorate(out) : bad(S.EFAULT, 'file rename failed');
        });
    }

    /* =================================================================
     * 2. Process syscalls
     * ============================================================== */

    /** NtCreateProcess({ name, type, ecosystem, owner, onKill }) -> pid */
    function NtCreateProcess(a) {
        if (typeof a.name !== 'string' || a.name.length === 0) {
            return bad(S.EINVAL, 'process name required');
        }
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        var pid = s.registerProcess(a.name, a.type || 'app', {
            ecosystem: a.ecosystem || 'native',
            owner: a.owner || 'system',
            info: a.info || null
        });
        if (typeof pid !== 'string') { return bad(S.EFAULT, 'process registration failed'); }
        var procMod = mod('process');
        if (procMod && typeof a.onKill === 'function') {
            procMod.onKill(pid, a.onKill);
        }
        return ok(pid);
    }

    /** NtTerminateProcess({ pid }) */
    function NtTerminateProcess(a) {
        if (typeof a.pid !== 'string') { return bad(S.EINVAL, 'pid required'); }
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        var killed = s.killProcess(a.pid);
        return killed === true ? ok(true) : bad(S.ENOENT, 'process not found');
    }

    /** NtQueryInformationProcess({ pid } | {}) */
    function NtQueryInformationProcess(a) {
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        if (typeof a.pid === 'string') {
            var p = s.getProcess(a.pid);
            return p ? ok(p) : bad(S.ENOENT, 'process not found');
        }
        return ok(s.listProcesses());
    }

    /* =================================================================
     * 3. Object syscalls
     * ============================================================== */

    /** NtClose({ handle }) */
    function NtClose(a) {
        var r = H.close(a.handle);
        return Status.decorate(r);
    }

    /** NtDuplicateObject({ handle, rights }) */
    function NtDuplicateObject(a) {
        var r = H.duplicate(a.handle, { rights: a.rights });
        return Status.decorate(r);
    }

    /** NtQueryObject({ handle }) */
    function NtQueryObject(a) {
        var r = H.resolve(a.handle);
        if (r.status !== S.OK) { return Status.decorate(r); }
        var rec = r.value;
        return ok({
            id: rec.id, type: rec.type, owner: rec.owner, mode: rec.mode,
            rights: '0x' + (rec.rights >>> 0).toString(16), createdAt: rec.createdAt
        });
    }

    /* =================================================================
     * 4. Registry syscalls
     * ============================================================== */

    /** NtOpenKey({ path }) */
    function NtOpenKey(a) {
        if (typeof a.path !== 'string') { return bad(S.EINVAL, 'path required'); }
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        var v = s.regGet(a.path);
        if (v === undefined) { return bad(S.ENOENT, 'registry key not found'); }
        return H.create('registry', { path: a.path, value: v }, { owner: a.owner || 'system' });
    }

    /** NtSetValueKey({ path, value }) */
    function NtSetValueKey(a) {
        if (typeof a.path !== 'string') { return bad(S.EINVAL, 'path required'); }
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        s.regSet(a.path, a.value === undefined ? null : a.value);
        return ok(true);
    }

    /** NtQueryValueKey({ path }) */
    function NtQueryValueKey(a) {
        if (typeof a.path !== 'string') { return bad(S.EINVAL, 'path required'); }
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        var v = s.regGet(a.path);
        if (v === undefined) { return bad(S.ENOENT, 'registry key not found'); }
        return ok(v);
    }

    /** NtDeleteKey({ path }) */
    function NtDeleteKey(a) {
        if (typeof a.path !== 'string') { return bad(S.EINVAL, 'path required'); }
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        var deleted = s.regDelete(a.path);
        return deleted === true ? ok(true) : bad(S.ENOENT, 'registry key not found');
    }

    /* =================================================================
     * 5. Service syscalls
     * ============================================================== */

    /** NtCreateService({ name, service }) */
    function NtCreateService(a) {
        if (typeof a.name !== 'string' || a.name.length === 0) {
            return bad(S.EINVAL, 'service name required');
        }
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        s.registerService(a.name, a.service || {});
        return ok(true);
    }

    /** NtStartService({ name }) */
    function NtStartService(a) {
        if (typeof a.name !== 'string') { return bad(S.EINVAL, 'service name required'); }
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        return s.startService(a.name) === true ? ok(true) : bad(S.ENOENT, 'service not found or failed to start');
    }

    /** NtStopService({ name }) */
    function NtStopService(a) {
        if (typeof a.name !== 'string') { return bad(S.EINVAL, 'service name required'); }
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        return s.stopService(a.name) === true ? ok(true) : bad(S.ENOENT, 'service not found or failed to stop');
    }

    /** NtQueryServices() */
    function NtQueryServices() {
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        return ok(s.listServices());
    }

    /* =================================================================
     * 6. System syscalls
     * ============================================================== */

    /** NtQuerySystemInformation() */
    function NtQuerySystemInformation() {
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        var info = s.info();
        return ok(info.status === S.OK ? info.value : null);
    }

    /** NtShutdownSystem({ reboot }) */
    function NtShutdownSystem(a) {
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        if (a && a.reboot === true) {
            return Promise.resolve(s.restart()).then(function (r) { return Status.decorate(r); });
        }
        var r = s.shutdown();
        return Status.decorate(r);
    }

    /** NtCreateRestorePoint({ label, description }) */
    function NtCreateRestorePoint(a) {
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        return Promise.resolve(s.createRestorePoint(a.label, a.description)).then(function (r) {
            return Status.decorate(r);
        });
    }

    /** NtRestoreSystem({ id }) */
    function NtRestoreSystem(a) {
        if (typeof a.id !== 'string') { return bad(S.EINVAL, 'restore point id required'); }
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        return Promise.resolve(s.restoreToPoint(a.id)).then(function (r) { return Status.decorate(r); });
    }

    /** NtScheduleTask({ name, action, interval, at }) */
    function NtScheduleTask(a) {
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        var r = s.addScheduledTask({
            name: a.name, action: a.action, args: a.args,
            interval: a.interval, at: a.at, once: a.once
        });
        return Status.decorate(r);
    }

    /** NtEmitEvent({ topic, payload }) - kernel event bus */
    function NtEmitEvent(a) {
        if (typeof a.topic !== 'string') { return bad(S.EINVAL, 'topic required'); }
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        return Status.decorate(s.emit(a.topic, a.payload));
    }

    /* =================================================================
     * 7. Messaging syscalls
     * ============================================================== */

    /** NtSendMessage({ pid, data }) */
    function NtSendMessage(a) {
        if (typeof a.pid !== 'string') { return bad(S.EINVAL, 'pid required'); }
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        s.sendMessage(a.pid, a.data);
        return ok(true);
    }

    /** NtBroadcast({ data }) */
    function NtBroadcast(a) {
        var s = srm();
        if (!s) { return bad(S.EPOWEROFF, 'kernel not available'); }
        s.broadcast(a.data);
        return ok(true);
    }

    /* =================================================================
     * 8. Time syscalls
     * ============================================================== */

    /** NtDelayExecution({ ms }) */
    function NtDelayExecution(a) {
        if (typeof a.ms !== 'number' || a.ms < 0) { return bad(S.EINVAL, 'ms must be >= 0'); }
        var hal = mod('hal');
        if (!hal) { return bad(S.ENOSYS, 'HAL not loaded'); }
        return Promise.resolve(hal.time.wait(a.ms)).then(function (r) { return Status.decorate(r); });
    }

    /** NtQueryTime() */
    function NtQueryTime() {
        var hal = mod('hal');
        if (!hal) { return bad(S.ENOSYS, 'HAL not loaded'); }
        var c = hal.time.clock();
        return Status.decorate(c);
    }

    /* =================================================================
     * 9. Registration
     * ============================================================== */

    var REGISTRATIONS = [
        ['NtCreateFile', NtCreateFile, 'create a file'],
        ['NtOpenFile', NtOpenFile, 'open a file'],
        ['NtReadFile', NtReadFile, 'read a file'],
        ['NtWriteFile', NtWriteFile, 'write a file'],
        ['NtDeleteFile', NtDeleteFile, 'delete a file'],
        ['NtQueryAttributesFile', NtQueryAttributesFile, 'stat a file'],
        ['NtQueryDirectoryFile', NtQueryDirectoryFile, 'list a directory'],
        ['NtCreateDirectoryObject', NtCreateDirectoryObject, 'create a directory'],
        ['NtCopyFile', NtCopyFile, 'copy a file'],
        ['NtRenameFile', NtRenameFile, 'rename a file'],
        ['NtCreateProcess', NtCreateProcess, 'create a process'],
        ['NtTerminateProcess', NtTerminateProcess, 'terminate a process'],
        ['NtQueryInformationProcess', NtQueryInformationProcess, 'query a process'],
        ['NtClose', NtClose, 'close a handle'],
        ['NtDuplicateObject', NtDuplicateObject, 'duplicate a handle'],
        ['NtQueryObject', NtQueryObject, 'query a handle'],
        ['NtOpenKey', NtOpenKey, 'open a registry key'],
        ['NtSetValueKey', NtSetValueKey, 'write a registry value'],
        ['NtQueryValueKey', NtQueryValueKey, 'read a registry value'],
        ['NtDeleteKey', NtDeleteKey, 'delete a registry key'],
        ['NtCreateService', NtCreateService, 'create a service'],
        ['NtStartService', NtStartService, 'start a service'],
        ['NtStopService', NtStopService, 'stop a service'],
        ['NtQueryServices', NtQueryServices, 'list services'],
        ['NtQuerySystemInformation', NtQuerySystemInformation, 'query the kernel'],
        ['NtShutdownSystem', NtShutdownSystem, 'shut the system down'],
        ['NtCreateRestorePoint', NtCreateRestorePoint, 'create a restore point'],
        ['NtRestoreSystem', NtRestoreSystem, 'restore the system'],
        ['NtScheduleTask', NtScheduleTask, 'schedule a task'],
        ['NtEmitEvent', NtEmitEvent, 'emit a kernel event'],
        ['NtSendMessage', NtSendMessage, 'send a process message'],
        ['NtBroadcast', NtBroadcast, 'broadcast a message'],
        ['NtDelayExecution', NtDelayExecution, 'wait'],
        ['NtQueryTime', NtQueryTime, 'query the clock']
    ];

    var registered = 0;
    REGISTRATIONS.forEach(function (r) {
        if (SC.register(r[0], r[1], { desc: r[2] }).status === S.OK) { registered += 1; }
    });

    /* Zw* aliases (Windows kernel-mode naming) */
    REGISTRATIONS.forEach(function (r) {
        var zwName = 'Zw' + r[0].slice(2);
        if (!SC.has(zwName).value) {
            SC.register(zwName, r[1], { desc: r[2] + ' (Zw alias)' });
            registered += 1;
        }
    });

    /* =================================================================
     * 10. Public handle
     * ============================================================== */

    var Ntos = {};
    Ntos.__isNtos = true;
    Ntos.version = '1.0.0';
    Ntos.STATUS = S;
    Ntos.registered = registered;

    /* expose every Nt* / Zw* stub as ezn32.nt.NtXxx */
    REGISTRATIONS.forEach(function (r) {
        Ntos[r[0]] = r[1];
        Ntos['Zw' + r[0].slice(2)] = r[1];
    });

    Ntos.syscall = SC.syscall;
    Ntos.list = SC.list;
    Ntos.has = SC.has;
    Ntos.stats = SC.stats;
    Ntos.handleTable = H;
    Ntos.status = Status;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Nt) { G.EznK.Nt = {}; }
    G.EznK.Nt.Ntos = Ntos;
    if (!G.EZNT.Nt) { G.EZNT.Nt = {}; }
    G.EZNT.Nt.Ntos = Ntos;

    /* Ezn32 NT namespace: ezn32.nt */
    if (!G.ezn32) { G.ezn32 = {}; }
    G.ezn32.nt = Ntos;

    LOG.info('js/nt/ntos.js 已加载 (' + registered + ' syscalls)');

}(typeof globalThis !== 'undefined' ? globalThis : this));
