/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 NT Layer
 *
 *   File    : js/nt/status.js
 *   Module  : EznK.Nt.Status  (alias: EZNT.Nt.status)
 *   Layer   : Ezn32 NT
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The NTSTATUS equivalent for Ezn32 NT. It maps the 15 EznK status
 *   codes (section 九) to NT-style severity / names / user-facing ASCII
 *   messages, and provides the one place that converts between codes.
 *
 *   Section 九 names stay canonical (OK, EINVAL, ...); the NT layer adds
 *   NTSTATUS-style aliases so code written against a Windows mental
 *   model reads naturally:
 *
 *     STATUS_SUCCESS          = 0x00000000  (OK)
 *     STATUS_INVALID_PARAMETER= 0xC000000D  (EINVAL)
 *     STATUS_OBJECT_NAME_NOT_FOUND = 0xC0000034 (ENOENT)
 *     ...
 *
 *   `toNt(code)` and `fromNt(nt)` are the only converters. Every Ezn32
 *   NT syscall returns the EznK shape { status, value } where `status` is
 *   the small integer code; `ntStatus` on the result carries the NT value
 *   for diagnostics.
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Nt && G.EznK.Nt.Status && G.EznK.Nt.Status.__isNtStatus === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[Ezn32 NT] js/nt/status.js requires platform/core.js');
    }

    var S = CORE.STATUS;
    var LOG = CORE.createLogger('Ezn32/NT:status');

    /* Canonical table: EznK code -> NT facts. */
    var TABLE = [
        { code: S.OK,        nt: 0x00000000, ntName: 'STATUS_SUCCESS',          ntSeverity: 0, message: 'success' },
        { code: S.EINVAL,    nt: 0xC000000D, ntName: 'STATUS_INVALID_PARAMETER', ntSeverity: 3, message: 'invalid parameter' },
        { code: S.ENOENT,    nt: 0xC0000034, ntName: 'STATUS_OBJECT_NAME_NOT_FOUND', ntSeverity: 3, message: 'object not found' },
        { code: S.EEXIST,    nt: 0xC0000035, ntName: 'STATUS_OBJECT_NAME_COLLISION', ntSeverity: 3, message: 'object already exists' },
        { code: S.ENOSPC,    nt: 0xC000007F, ntName: 'STATUS_DISK_FULL',        ntSeverity: 3, message: 'disk full' },
        { code: S.ENOMEM,    nt: 0xC0000017, ntName: 'STATUS_NO_MEMORY',        ntSeverity: 3, message: 'out of memory' },
        { code: S.EFAULT,    nt: 0xC0000005, ntName: 'STATUS_ACCESS_VIOLATION', ntSeverity: 3, message: 'internal fault' },
        { code: S.EACCES,    nt: 0xC0000022, ntName: 'STATUS_ACCESS_DENIED',    ntSeverity: 3, message: 'access denied' },
        { code: S.EBADF,     nt: 0xC0000008, ntName: 'STATUS_INVALID_HANDLE',   ntSeverity: 3, message: 'invalid handle' },
        { code: S.EBADIMAGE, nt: 0xC000007B, ntName: 'STATUS_INVALID_IMAGE_FORMAT', ntSeverity: 3, message: 'invalid image' },
        { code: S.ENOSYS,    nt: 0xC00000BB, ntName: 'STATUS_NOT_SUPPORTED',    ntSeverity: 3, message: 'not supported' },
        { code: S.EBUSY,     nt: 0xC0000043, ntName: 'STATUS_SHARING_VIOLATION', ntSeverity: 3, message: 'resource busy' },
        { code: S.EPOWEROFF, nt: 0xC0000135, ntName: 'STATUS_DLL_NOT_FOUND',    ntSeverity: 3, message: 'subsystem not present (kernel stopped)' },
        { code: S.EBOUNDS,   nt: 0xC000008C, ntName: 'STATUS_ARRAY_BOUNDS_EXCEEDED', ntSeverity: 3, message: 'array bounds exceeded' },
        { code: S.EIO,       nt: 0xC0000185, ntName: 'STATUS_IO_DEVICE_ERROR',  ntSeverity: 3, message: 'device I/O error' }
    ];

    var BY_CODE = Object.create(null);
    var BY_NT = Object.create(null);
    TABLE.forEach(function (e) {
        BY_CODE[e.code] = e;
        BY_NT[e.nt] = e;
    });

    /** toNt(code) -> { status, value: { nt, name, severity, message } } */
    function toNt(code) {
        var e = BY_CODE[code];
        if (!e) {
            return CORE.fail(S.EINVAL, { reason: 'unknown EznK status code: ' + code });
        }
        return CORE.ok({ nt: e.nt, name: e.ntName, severity: e.severity, message: e.message });
    }

    /** fromNt(nt) -> { status, value: EznK code } */
    function fromNt(nt) {
        var e = BY_NT[nt >>> 0];
        if (!e) {
            return CORE.fail(S.EINVAL, { reason: 'unknown NTSTATUS: 0x' + (nt >>> 0).toString(16) });
        }
        return CORE.ok(e.code);
    }

    /** ntName(code) -> string */
    function ntName(code) {
        var e = BY_CODE[code];
        return e ? e.ntName : 'STATUS_UNKNOWN';
    }

    /** message(code) -> ASCII user-facing text (separate from reason) */
    function message(code) {
        var e = BY_CODE[code];
        return e ? e.message : 'unknown error';
    }

    /** isSuccess(code) -> boolean */
    function isSuccess(code) {
        return code === S.OK;
    }

    /** isError(code) -> boolean */
    function isError(code) {
        return typeof code === 'number' && code !== S.OK;
    }

    /** decorate(result) - attach ntStatus/ntName for diagnostics. */
    function decorate(result) {
        if (!CORE.isResult(result)) { return result; }
        var e = BY_CODE[result.status];
        if (e) {
            result.ntStatus = e.nt;
            result.ntName = e.ntName;
        }
        return result;
    }

    /** failure(code, reason, extra) - NT-flavoured fail with nt fields. */
    function failure(code, reason, extra) {
        var r = CORE.fail(code, extra);
        r.reason = reason || message(code);
        return decorate(r);
    }

    /** success(value, extra) */
    function success(value, extra) {
        return decorate(CORE.ok(value, extra));
    }

    /** ASCII-safe reason text: never let a non-ASCII name reach a dialog. */
    function asciiReason(text) {
        var s = String(text === null || text === undefined ? '' : text);
        return s.replace(/[^\x20-\x7E\n\t]/g, '?');
    }

    function table() {
        return CORE.ok(TABLE.map(function (e) {
            return { code: e.code, name: CORE.statusName(e.code), nt: e.nt, ntName: e.ntName, message: e.message };
        }));
    }

    var Status = {};
    Status.__isNtStatus = true;
    Status.version = '1.0.0';
    Status.STATUS = S;

    Status.toNt = toNt;
    Status.fromNt = fromNt;
    Status.ntName = ntName;
    Status.message = message;
    Status.isSuccess = isSuccess;
    Status.isError = isError;
    Status.decorate = decorate;
    Status.failure = failure;
    Status.success = success;
    Status.asciiReason = asciiReason;
    Status.table = table;

    /* NTSTATUS-style constants for callers who prefer that vocabulary. */
    Status.NT = Object.freeze((function () {
        var out = {};
        TABLE.forEach(function (e) { out[e.ntName] = e.nt; });
        return out;
    })());

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Nt) { G.EznK.Nt = {}; }
    G.EznK.Nt.Status = Status;
    if (!G.EZNT.Nt) { G.EZNT.Nt = {}; }
    G.EZNT.Nt.status = Status;

    LOG.info('js/nt/status.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
