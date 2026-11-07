/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 API
 *
 *   File    : js/api/kernel.js
 *   Module  : EznK.Api.Kernel  (alias: ezn32.api.kernel)
 *   Layer   : Ezn32 API
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   ezn32.api.kernel - the kernel32.dll equivalent: files, processes,
 *   memory accounting and synchronisation primitives.
 *
 *   Call chain (strict): app -> ezn32.api.kernel -> Ezn32 NT -> SRM -> L1
 *   Every function here goes through Ezn32 NT syscalls. None of them
 *   touches SRM directly and none of them touches L1.
 *
 *   Files keep Windows-like handle semantics on top of NT handles:
 *     CreateFile / OpenFile  -> HANDLE
 *     ReadFile / WriteFile   -> through the HANDLE
 *     CloseHandle
 *   Path-based convenience wrappers (ReadFileText, WriteFileText) build a
 *   handle internally and close it, so application code never leaks.
 *
 *   Memory is ACCOUNTED, not allocated: the browser owns the heap, so
 *   VirtualAlloc tracks a per-owner quota so the task manager can show
 *   real usage and a runaway script can be bounded.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.ezn32 && G.ezn32.api && G.ezn32.api.kernel && G.ezn32.api.kernel.__isApiKernel === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var Ntos = (G.ezn32 && G.ezn32.nt) || null;
    if (!CORE || !Ntos) {
        throw new Error('[Ezn32 API] js/api/kernel.js requires platform/core.js and js/nt/ntos.js');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var LOG = CORE.createLogger('Ezn32/API:kernel');

    function nt(id, args) { return Ntos.syscall(id, args); }

    /* =================================================================
     * 1. File API (handle based)
     * ============================================================== */

    /** CreateFile({ path, content, mode }) -> Promise<{status, value: handle}> */
    function CreateFile(spec) {
        var s = (typeof spec === 'string') ? { path: spec } : (spec || {});
        if (typeof s.path !== 'string' || s.path.length === 0) {
            return Promise.resolve(fail(S.EINVAL, { reason: 'path required' }));
        }
        return nt('NtCreateFile', {
            path: s.path,
            content: s.content === undefined ? '' : s.content,
            mode: s.mode || 'rw',
            owner: s.owner || 'user'
        });
    }

    /** OpenFile({ path, mode='r' }) -> Promise<{status, value: handle}> */
    function OpenFile(spec) {
        var s = (typeof spec === 'string') ? { path: spec } : (spec || {});
        if (typeof s.path !== 'string' || s.path.length === 0) {
            return Promise.resolve(fail(S.EINVAL, { reason: 'path required' }));
        }
        return nt('NtOpenFile', {
            path: s.path,
            mode: s.mode || 'r',
            owner: s.owner || 'user'
        });
    }

    /** Normalise an NT result that may be sync or a Promise into a Promise. */
    function asAsync(r) {
        return (r && typeof r.then === 'function') ? r : Promise.resolve(r);
    }

    /** ReadFile({ handle }) -> Promise<{status, value: string}> */
    function ReadFile(spec) {
        var s = (typeof spec === 'number') ? { handle: spec } : (spec || {});
        if (typeof s.handle !== 'number') {
            return Promise.resolve(fail(S.EINVAL, { reason: 'handle required' }));
        }
        return asAsync(nt('NtReadFile', { handle: s.handle })).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return ok(r.value.data);
        });
    }

    /** WriteFile({ handle, data }) -> Promise<{status, value: number}> */
    function WriteFile(spec) {
        var s = spec || {};
        if (typeof s.handle !== 'number') {
            return Promise.resolve(fail(S.EINVAL, { reason: 'handle required' }));
        }
        if (typeof s.data !== 'string') {
            return Promise.resolve(fail(S.EINVAL, { reason: 'data must be a string' }));
        }
        return asAsync(nt('NtWriteFile', { handle: s.handle, data: s.data })).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return ok(r.value.written);
        });
    }

    /** CloseHandle(handle) -> { status, value: true } */
    function CloseHandle(handle) {
        return asAsync(nt('NtClose', { handle: handle }));
    }

    /** Path convenience wrappers: open -> op -> close, leak-proof. */
    function ReadFileText(path) {
        return asAsync(OpenFile({ path: path, mode: 'r' })).then(function (h) {
            if (h.status !== S.OK) { return h; }
            return ReadFile({ handle: h.value }).then(function (r) {
                CloseHandle(h.value);
                return r;
            }, function (err) {
                CloseHandle(h.value);
                return fail(S.EFAULT, { reason: String(err) });
            });
        });
    }

    /** WriteFileText(path, data) -> Promise<{status, value: number}>
     *  Creates or rewrites the file in one call. Never leaks a handle. */
    function WriteFileText(path, data) {
        if (typeof data !== 'string') {
            return Promise.resolve(fail(S.EINVAL, { reason: 'data must be a string' }));
        }
        return CreateFile({ path: path, content: data, mode: 'rw' }).then(function (h) {
            if (h.status !== S.OK) { return h; }
            CloseHandle(h.value);
            return ok(data.length);
        });
    }

    /** DeleteFile(path) / MoveFile(a,b) / CopyFile(a,b) / CreateDirectory(path)
     *  Every one of these returns a Promise: an NT result may be synchronous
     *  (validation failure) or asynchronous, and callers chain on it. */
    function DeleteFile(path) { return asAsync(nt('NtDeleteFile', { path: path })); }
    function CopyFile(source, target) { return asAsync(nt('NtCopyFile', { source: source, target: target })); }
    function MoveFile(source, target) {
        return CopyFile(source, target).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return DeleteFile(source);
        });
    }
    function RenameFile(path, newName) { return asAsync(nt('NtRenameFile', { path: path, newName: newName })); }
    function CreateDirectory(path) { return asAsync(nt('NtCreateDirectoryObject', { path: path })); }
    function GetFileAttributes(path) { return asAsync(nt('NtQueryAttributesFile', { path: path })); }
    function FindFiles(path) { return asAsync(nt('NtQueryDirectoryFile', { path: path })); }

    /** GetFileSize(path) -> Promise<{status, value: number}> */
    function GetFileSize(path) {
        return asAsync(GetFileAttributes(path)).then(function (r) {
            if (r.status !== S.OK) { return r; }
            return ok(r.value.size);
        });
    }

    /* =================================================================
     * 2. Process API
     * ============================================================== */

    /** CreateProcess({ name, type, ecosystem, owner, onKill }) -> pid */
    function CreateProcess(spec) {
        var s = spec || {};
        if (typeof s.name !== 'string' || s.name.length === 0) {
            return fail(S.EINVAL, { reason: 'process name required' });
        }
        var r = nt('NtCreateProcess', {
            name: s.name,
            type: s.type || 'app',
            ecosystem: s.ecosystem || 'native',
            owner: s.owner || 'user',
            onKill: s.onKill
        });
        if (r.status !== S.OK) { return r; }
        return ok({ pid: r.value, name: s.name });
    }

    /** TerminateProcess(pid) */
    function TerminateProcess(pid) {
        return asAsync(nt('NtTerminateProcess', { pid: pid }));
    }

    /** EnumProcesses() -> array */
    function EnumProcesses() {
        var r = nt('NtQueryInformationProcess', {});
        if (r.status !== S.OK) { return r; }
        var table = r.value || {};
        var out = [];
        Object.keys(table).forEach(function (pid) {
            var p = table[pid];
            out.push({
                pid: p.pid, name: p.name, type: p.type, status: p.status,
                ecosystem: p.ecosystem, startedAt: p.startedAt, startTime: p.startTime
            });
        });
        return ok(out);
    }

    /** GetProcessInfo(pid) */
    function GetProcessInfo(pid) {
        return nt('NtQueryInformationProcess', { pid: pid });
    }

    /* =================================================================
     * 3. Memory accounting (browser owns the heap)
     * ============================================================== */

    var DEFAULT_QUOTA = 64 * 1024 * 1024;   /* 64 MB accounting ceiling */
    var allocs = Object.create(null);       /* id -> {owner, size, at} */
    var used = Object.create(null);         /* owner -> bytes */
    var seq = 0;
    var quota = DEFAULT_QUOTA;

    /** VirtualAlloc({ owner, size }) -> { status, value: {address, size} } */
    function VirtualAlloc(spec) {
        var s = spec || {};
        var owner = s.owner || 'system';
        var size = (typeof s.size === 'number' && s.size > 0) ? Math.floor(s.size) : 0;
        if (size <= 0) { return fail(S.EINVAL, { reason: 'size must be a positive number' }); }
        var cur = used[owner] || 0;
        if (cur + size > quota) {
            return fail(S.ENOMEM, { reason: 'memory quota exceeded', owner: owner, used: cur, quota: quota });
        }
        seq += 1;
        var addr = 0x10000000 + seq * 0x1000;
        allocs[addr] = { owner: owner, size: size, at: Date.now() };
        used[owner] = cur + size;
        return ok({ address: addr, size: size, owner: owner });
    }

    /** VirtualFree(address) -> { status, value: true } */
    function VirtualFree(address) {
        var rec = allocs[address];
        if (!rec) { return fail(S.EINVAL, { reason: 'unknown address' }); }
        used[rec.owner] = Math.max(0, (used[rec.owner] || 0) - rec.size);
        delete allocs[address];
        return ok(true);
    }

    /** GetMemoryInfo() -> { status, value: {quota, used, blocks, heap} } */
    function GetMemoryInfo() {
        var total = 0;
        Object.keys(used).forEach(function (o) { total += used[o]; });
        var heap = (G.performance && G.performance.memory) ? G.performance.memory.usedJSHeapSize : null;
        return ok({
            quota: quota,
            used: total,
            blocks: Object.keys(allocs).length,
            heapBytes: heap,
            byOwner: Object.assign({}, used)
        });
    }

    /** SetMemoryQuota(bytes) */
    function SetMemoryQuota(bytes) {
        if (typeof bytes !== 'number' || bytes < 1024 * 1024) {
            return fail(S.EINVAL, { reason: 'quota must be at least 1 MB' });
        }
        quota = Math.floor(bytes);
        return ok(true);
    }

    /* =================================================================
     * 4. Synchronisation primitives
     *
     *   Browser JS is single-threaded; these are cooperative primitives
     *   built on promises, used by rf `parallel` and KD bridges.
     * ============================================================== */

    /** CriticalSection(fn) -> Promise: serialise async sections. */
    var chain = Promise.resolve();

    function CriticalSection(fn) {
        if (typeof fn !== 'function') {
            return Promise.resolve(fail(S.EINVAL, { reason: 'fn must be a function' }));
        }
        var next = chain.then(function () { return fn(); });
        /* keep the chain alive even when fn rejects */
        chain = next.then(function () { return true; }, function () { return true; });
        return next.then(function (v) { return ok(v); }, function (err) {
            return fail(S.EFAULT, { reason: err && err.message });
        });
    }

    /** CreateMutex(name) -> { status, value: {name, acquire, release} } */
    var mutexes = Object.create(null);

    function CreateMutex(name) {
        if (typeof name !== 'string' || name.length === 0) {
            return fail(S.EINVAL, { reason: 'mutex name required' });
        }
        if (mutexes[name]) {
            return ok(mutexes[name]);
        }
        var queue = [];
        var locked = false;
        var m = {
            name: name,
            acquire: function () {
                return new Promise(function (resolve) {
                    function tryAcquire() {
                        if (!locked) { locked = true; resolve(true); return; }
                        queue.push(tryAcquire);
                    }
                    tryAcquire();
                });
            },
            release: function () {
                var next = queue.shift();
                if (next) { next(); } else { locked = false; }
                return true;
            },
            isLocked: function () { return locked; }
        };
        mutexes[name] = m;
        return ok(m);
    }

    /** Sleep(ms) -> Promise */
    function Sleep(ms) {
        var r = nt('NtDelayExecution', { ms: ms });
        return r && typeof r.then === 'function' ? r : Promise.resolve(r);
    }

    /* =================================================================
     * 5. Public handle
     * ============================================================== */

    var K = {};
    K.__isApiKernel = true;
    K.version = '1.0.0';
    K.STATUS = S;

    K.CreateFile = CreateFile;
    K.OpenFile = OpenFile;
    K.ReadFile = ReadFile;
    K.WriteFile = WriteFile;
    K.CloseHandle = CloseHandle;
    K.ReadFileText = ReadFileText;
    K.WriteFileText = WriteFileText;
    K.DeleteFile = DeleteFile;
    K.CopyFile = CopyFile;
    K.MoveFile = MoveFile;
    K.RenameFile = RenameFile;
    K.CreateDirectory = CreateDirectory;
    K.GetFileAttributes = GetFileAttributes;
    K.FindFiles = FindFiles;
    K.GetFileSize = GetFileSize;

    K.CreateProcess = CreateProcess;
    K.TerminateProcess = TerminateProcess;
    K.EnumProcesses = EnumProcesses;
    K.GetProcessInfo = GetProcessInfo;

    K.VirtualAlloc = VirtualAlloc;
    K.VirtualFree = VirtualFree;
    K.GetMemoryInfo = GetMemoryInfo;
    K.SetMemoryQuota = SetMemoryQuota;

    K.CriticalSection = CriticalSection;
    K.CreateMutex = CreateMutex;
    K.Sleep = Sleep;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Api) { G.EznK.Api = {}; }
    G.EznK.Api.Kernel = K;
    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.api) { G.ezn32.api = {}; }
    G.ezn32.api.kernel = K;
    if (!G.EZNT.api) { G.EZNT.api = {}; }
    G.EZNT.api.kernel = K;
    LOG.info('js/api/kernel.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
