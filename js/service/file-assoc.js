/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L4 服务层
 *
 *   文件 : js/service/file-assoc.js
 *   模块 : EznK.Service.fileAssoc
 *   层级 : L4 服务层
 *
 * ---------------------------------------------------------------------
 * 职责
 * ---------------------------------------------------------------------
 *   文件类型关联（默认打开方式）。
 *
 *   数据存在注册表 HKCR 下，与老系统保持完全一致：
 *     HKCR\.txt          -> 'editor'        扩展名 -> 应用 ID
 *     HKCR\Mime\.txt     -> 'text/plain'    扩展名 -> MIME
 *
 *   任何应用 / 脚本都可以通过这里的 API 读写关联，
 *   也可以通过 SetDefault 改变某个扩展名的默认打开方式。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.fileAssoc) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L4:fileassoc');

    /** 内置的候选打开方式（供设置界面下拉选择） */
    var HANDLERS = [
        { id: 'editor',       name: '代码编辑器',  icon: '📝', exts: ['.txt', '.md', '.json', '.log', '.py', '.js'] },
        { id: 'code-studio',  name: '代码工坊',    icon: '💻', exts: ['.txt', '.md', '.py', '.rf', '.kd', '.exc'] },
        { id: 'file-manager', name: '文件管理器',  icon: '📁', exts: ['*'] },
        { id: 'python-shell', name: 'Python 终端', icon: '🐍', exts: ['.py'] },
        { id: 'rf-runtime',   name: 'rf 运行时',   icon: '📜', exts: ['.rf'] },
        { id: 'kd-runtime',   name: 'KD 运行时',   icon: '📦', exts: ['.kd', '.html'] },
        { id: 'exc-runtime',  name: 'EXC 运行时',  icon: '⚙️', exts: ['.exc'] },
        { id: 'sys-manager',  name: '系统脚本',    icon: '🛠️', exts: ['.sys', '.skl'] },
        { id: 'camera',       name: '图片查看',    icon: '📷', exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] },
        { id: 'notepad',      name: '文本查看',    icon: '📄', exts: ['.txt', '.log', '.ini', '.cfg'] }
    ];

    var MIME_BY_EXT = {
        '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
        '.py': 'text/x-python', '.js': 'application/javascript',
        '.rf': 'application/x-eznt-rf', '.kd': 'application/x-eznt-kd',
        '.exc': 'application/x-eznt-exc', '.sys': 'application/x-eznt-sys',
        '.skl': 'application/x-eznt-skl', '.zjl': 'application/x-eznt-zjl',
        '.c2': 'application/x-eznt-c2',
        '.html': 'text/html', '.css': 'text/css',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4', '.webm': 'video/webm'
    };

    function srm() { return G.EznK.Kernel && G.EznK.Kernel.SRM; }

    function normExt(ext) {
        var e = String(ext || '').toLowerCase().trim();
        if (!e) { return ''; }
        if (e.charAt(0) !== '.') { e = '.' + e; }
        return e;
    }

    /* =================================================================
     * 1. 读取
     * ============================================================== */

    /** getDefault(ext) -> { status, value: appId | 'unknown' } */
    function getDefault(ext) {
        var e = normExt(ext);
        if (!e) { return CORE.fail(S.EINVAL, { reason: '需要扩展名' }); }
        var s = srm();
        if (!s) { return CORE.fail(S.ENOSYS, { reason: '内核未就绪' }); }
        var v = s.regGet('HKCR\\' + e);
        return CORE.ok(v === undefined || v === null ? 'unknown' : v);
    }

    /** setDefault(ext, appId) -> { status, value: true } */
    function setDefault(ext, appId) {
        var e = normExt(ext);
        if (!e) { return CORE.fail(S.EINVAL, { reason: '需要扩展名' }); }
        if (typeof appId !== 'string' || !appId) {
            return CORE.fail(S.EINVAL, { reason: '需要应用 ID' });
        }
        var s = srm();
        if (!s) { return CORE.fail(S.ENOSYS, { reason: '内核未就绪' }); }
        s.regSet('HKCR\\' + e, appId);
        /* MIME 也一并维护，保证 KD 应用查询 MIME 时一致 */
        if (MIME_BY_EXT[e]) { s.regSet('HKCR\\Mime\\' + e, MIME_BY_EXT[e]); }
        if (s.emit) { s.emit('fileassoc:changed', { ext: e, appId: appId }); }
        LOG.info('文件关联：' + e + ' -> ' + appId);
        return CORE.ok(true);
    }

    /** clearDefault(ext) -> 恢复为 unknown */
    function clearDefault(ext) {
        var e = normExt(ext);
        var s = srm();
        if (!s) { return CORE.fail(S.ENOSYS, { reason: '内核未就绪' }); }
        s.regDelete('HKCR\\' + e);
        return CORE.ok(true);
    }

    /** getMime(ext) -> string */
    function getMime(ext) {
        var e = normExt(ext);
        var s = srm();
        if (s) {
            var v = s.regGet('HKCR\\Mime\\' + e);
            if (v) { return CORE.ok(v); }
        }
        return CORE.ok(MIME_BY_EXT[e] || 'application/octet-stream');
    }

    /** list() -> [{ ext, appId, appName, appIcon, mime }] */
    function list() {
        var s = srm();
        var out = [];
        if (!s) { return CORE.ok(out); }
        var hkcr = s.regGet('HKCR');
        if (!hkcr || typeof hkcr !== 'object') { return CORE.ok(out); }

        Object.keys(hkcr).forEach(function (k) {
            if (k.charAt(0) !== '.') { return; }
            var appId = hkcr[k];
            var h = handlerById(appId);
            out.push({
                ext: k,
                appId: appId,
                appName: h ? h.name : appId,
                appIcon: h ? h.icon : '❓',
                mime: (MIME_BY_EXT[k] || 'application/octet-stream')
            });
        });
        out.sort(function (a, b) { return a.ext < b.ext ? -1 : 1; });
        return CORE.ok(out);
    }

    function handlerById(id) {
        for (var i = 0; i < HANDLERS.length; i++) {
            if (HANDLERS[i].id === id) { return HANDLERS[i]; }
        }
        return null;
    }

    /** handlers() -> 可选打开方式列表 */
    function handlers() { return CORE.ok(HANDLERS.slice(0)); }

    /**
     * handlersFor(ext) -> 适合该扩展名的打开方式（按推荐顺序）
     *   总是把 file-manager 放在最后作为兜底。
     */
    function handlersFor(ext) {
        var e = normExt(ext);
        var fit = [];
        var fallback = [];
        HANDLERS.forEach(function (h) {
            if (h.exts.indexOf(e) !== -1) { fit.push(h); }
            else if (h.exts.indexOf('*') !== -1) { fallback.push(h); }
        });
        return CORE.ok(fit.concat(fallback));
    }

    /** register(ext, appId, mime) - 供应用自注册关联 */
    function register(ext, appId, mime) {
        var e = normExt(ext);
        var s = srm();
        if (!s) { return CORE.fail(S.ENOSYS, { reason: '内核未就绪' }); }
        s.regSet('HKCR\\' + e, appId);
        if (mime) { s.regSet('HKCR\\Mime\\' + e, mime); }
        return CORE.ok(true);
    }

    /** boot() - 补齐默认关联（幂等，不覆盖用户已改的） */
    function boot() {
        var s = srm();
        if (!s) { return CORE.ok(true); }
        var seed = {
            '.txt': 'editor',
            '.md': 'editor',
            '.json': 'editor',
            '.log': 'editor',
            '.py': 'editor',
            '.js': 'editor',
            '.css': 'editor',
            '.html': 'kd-runtime',
            '.rf': 'rf-runtime',
            '.kd': 'kd-runtime',
            '.exc': 'exc-runtime',
            '.sys': 'sys-manager',
            '.skl': 'sys-manager',
            '.zjl': 'editor',
            '.c2': 'c2-runtime',
            '.png': 'camera',
            '.jpg': 'camera',
            '.jpeg': 'camera',
            '.gif': 'camera',
            '.webp': 'camera',
            '.svg': 'camera'
        };
        Object.keys(seed).forEach(function (ext) {
            if (s.regGet('HKCR\\' + ext) === undefined) {
                s.regSet('HKCR\\' + ext, seed[ext]);
            }
            if (MIME_BY_EXT[ext] && s.regGet('HKCR\\Mime\\' + ext) === undefined) {
                s.regSet('HKCR\\Mime\\' + ext, MIME_BY_EXT[ext]);
            }
        });
        return CORE.ok(true);
    }

    var FA = {};
    FA.version = '1.0.0';
    FA.boot = boot;
    FA.shutdown = function () { return CORE.ok(true); };
    FA.getDefault = getDefault;
    FA.setDefault = setDefault;
    FA.clearDefault = clearDefault;
    FA.getMime = getMime;
    FA.list = list;
    FA.handlers = handlers;
    FA.handlersFor = handlersFor;
    FA.register = register;
    FA.HANDLERS = HANDLERS.slice(0);
    FA.MIME_BY_EXT = MIME_BY_EXT;

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.fileAssoc = FA;
    if (G.EznK.Kernel && G.EznK.Kernel.SRM && typeof G.EznK.Kernel.SRM.register === 'function') {
        G.EznK.Kernel.SRM.register('service-fileassoc', FA);
    }
    LOG.info('js/service/file-assoc.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
