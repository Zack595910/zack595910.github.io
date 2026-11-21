/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L5 服务层
 *
 *   文件 : js/service/startup.js
 *   模块 : EznK.Service.startup
 *   层级 : L5 服务层
 *
 * ---------------------------------------------------------------------
 * 开机自启
 * ---------------------------------------------------------------------
 *   · 自启项存放在 /System/Startup/Items.json
 *   · 每个条目：{ id, kind, name, icon, target, args, delayMs, enabled, createdAt }
 *       kind = 'app'     -> target 是应用 id（走 appRegistry.launch）
 *       kind = 'script'  -> target 是 .exc/.kd/.rf/.sys 文件路径
 *   · boot 完成后按 delayMs 依次拉起
 *   · 注册表同步写 HKLM\Software\EZNT\Startup / HKCU，供注册表编辑器查看
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.startup) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L5:startup');

    var KEY = '/System/Startup/Items.json';
    var REG_KEY = 'HKLM\\Software\\EZNT\\Startup';

    function hal() { return G.EznK.Kernel && G.EznK.Kernel.HAL; }
    function srm() { return G.EznK.Kernel && G.EznK.Kernel.SRM; }

    /* =================================================================
     * 1. 存储
     * ============================================================== */

    function readAll() {
        var h = hal();
        if (!h || !h.fs || typeof h.fs.configGet !== 'function') { return []; }
        var r = h.fs.configGet(KEY, null);
        if (r.status === S.OK && Array.isArray(r.value)) { return r.value; }
        return [];
    }

    function writeAll(list) {
        var h = hal();
        if (!h || !h.fs || typeof h.fs.configSet !== 'function') {
            return CORE.fail(S.EIO, { reason: '存储不可用' });
        }
        var r = h.fs.configSet(KEY, list);
        if (r.status !== S.OK) { return r; }
        syncRegistry(list);
        return CORE.ok(true);
    }

    /** 把自启项同步到注册表，方便在注册表编辑器里查看/管理 */
    function syncRegistry(list) {
        var s = srm();
        if (!s || typeof s.regSet !== 'function') { return; }
        var obj = {};
        (list || []).forEach(function (it) {
            obj[it.id] = {
                Name: it.name,
                Kind: it.kind,
                Target: it.target,
                Enabled: it.enabled !== false,
                DelayMs: it.delayMs || 0
            };
        });
        try { s.regSet(REG_KEY, obj); } catch (_) {}
    }

    /* =================================================================
     * 2. 增删改查
     * ============================================================== */

    /** list() -> { status, value: item[] } */
    function list() { return CORE.ok(readAll()); }

    /** get(id) -> { status, value: item | null } */
    function get(id) {
        var found = readAll().filter(function (it) { return it.id === id; })[0] || null;
        return CORE.ok(found);
    }

    /**
     * add(spec) -> { status, value: item }
     *   spec: { id?, kind, name, icon?, target, args?, delayMs?, enabled? }
     */
    function add(spec) {
        var s = spec || {};
        if (typeof s.target !== 'string' || !s.target.length) {
            return CORE.fail(S.EINVAL, { reason: '缺少启动目标' });
        }
        var kind = s.kind === 'script' ? 'script' : 'app';
        var id = s.id || ('startup_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
        var list = readAll();
        if (list.some(function (it) { return it.id === id; })) {
            return CORE.fail(S.EEXIST, { reason: '自启项已存在: ' + id });
        }
        var item = {
            id: id,
            kind: kind,
            name: s.name || s.target,
            icon: s.icon || (kind === 'app' ? '📦' : '📜'),
            target: s.target,
            args: s.args || null,
            delayMs: Math.max(0, Number(s.delayMs) || 0),
            enabled: s.enabled !== false,
            createdAt: Date.now()
        };
        list.push(item);
        var w = writeAll(list);
        if (w.status !== S.OK) { return w; }
        LOG.info('自启项已添加: ' + item.name);
        return CORE.ok(item);
    }

    /** remove(id) -> { status } */
    function remove(id) {
        var list = readAll();
        var next = list.filter(function (it) { return it.id !== id; });
        if (next.length === list.length) {
            return CORE.fail(S.ENOENT, { reason: '找不到自启项: ' + id });
        }
        var w = writeAll(next);
        if (w.status !== S.OK) { return w; }
        LOG.info('自启项已移除: ' + id);
        return CORE.ok(true);
    }

    /** setEnabled(id, on) -> { status } */
    function setEnabled(id, on) {
        var list = readAll();
        var hit = false;
        list.forEach(function (it) {
            if (it.id === id) { it.enabled = !!on; hit = true; }
        });
        if (!hit) { return CORE.fail(S.ENOENT, { reason: '找不到自启项: ' + id }); }
        return writeAll(list);
    }

    /** toggle(id) -> { status, value: boolean } */
    function toggle(id) {
        var g = get(id);
        if (g.status !== S.OK || !g.value) {
            return CORE.fail(S.ENOENT, { reason: '找不到自启项: ' + id });
        }
        var next = !(g.value.enabled !== false);
        var r = setEnabled(id, next);
        return r.status === S.OK ? CORE.ok(next) : r;
    }

    /** clear() - 移除所有自启项 */
    function clear() {
        return writeAll([]);
    }

    /* =================================================================
     * 3. 启动
     * ============================================================== */

    /** launchItem(item) - 拉起单个自启项 */
    function launchItem(item) {
        if (!item || item.enabled === false) { return Promise.resolve(CORE.ok(false)); }
        var done = function () { return CORE.ok(true); };

        if (item.kind === 'app') {
            var reg = G.EznK.Service && G.EznK.Service.appRegistry;
            if (!reg) { return Promise.resolve(CORE.fail(S.ENOSYS, { reason: '应用注册表不可用' })); }
            try {
                var r = reg.launch(item.target);
                return Promise.resolve(r || CORE.ok(true)).catch(function () { return CORE.ok(true); });
            } catch (err) {
                LOG.error('自启应用失败 ' + item.target + ': ' + (err && err.message));
                return Promise.resolve(CORE.fail(S.EFAULT, { reason: err && err.message }));
            }
        }

        /* script：按扩展名交给对应运行时 */
        var path = item.target;
        var ext = path.lastIndexOf('.') >= 0 ? path.slice(path.lastIndexOf('.')).toLowerCase() : '';
        var RT = G.EznK.Runtime || {};
        var api = G.ezn32 && G.ezn32.api;

        if (ext === '.exc' && RT.exc && RT.exc.runFile) { return Promise.resolve(RT.exc.runFile(path)); }
        if (ext === '.kd' && RT.kd && RT.kd.openFile) { return Promise.resolve(RT.kd.openFile(path)); }
        if (ext === '.rf' && RT.rf && RT.rf.runFile) { return Promise.resolve(RT.rf.runFile(path)); }
        if (ext === '.sys' && RT.sys && RT.sys.openManager) { return Promise.resolve(RT.sys.openManager(path)); }

        if (api && api.shell && api.shell.OpenFile) {
            return Promise.resolve(api.shell.OpenFile(path));
        }
        return Promise.resolve(CORE.fail(S.ENOSYS, { reason: '无法启动 ' + path }));
    }

    /**
     * runAll() - 拉起所有启用的自启项（boot 末尾调用）
     *   按 delayMs 排序，不阻塞 boot。
     */
    function runAll() {
        var items = readAll().filter(function (it) { return it.enabled !== false; });
        if (!items.length) { return CORE.ok(0); }
        items.sort(function (a, b) { return (a.delayMs || 0) - (b.delayMs || 0); });

        items.forEach(function (item) {
            var delay = Math.max(0, Number(item.delayMs) || 0);
            G.setTimeout(function () {
                try {
                    launchItem(item).then(function (r) {
                        if (r && r.status === S.OK) {
                            LOG.info('自启项已启动: ' + item.name);
                        } else {
                            LOG.warn('自启项启动失败: ' + item.name + ' ' + ((r && r.reason) || ''));
                        }
                    });
                } catch (err) {
                    LOG.error('自启项异常 ' + item.name + ': ' + (err && err.message));
                }
            }, delay);
        });
        LOG.info('开机自启：共 ' + items.length + ' 项');
        return CORE.ok(items.length);
    }

    /* =================================================================
     * 4. 生命周期
     * ============================================================== */

    function boot() {
        var s = srm();
        if (s) {
            s.registerService('startup', { init: function () { LOG.info('startup service online'); } });
        }
        return CORE.ok(true);
    }

    var Startup = {
        version: '1.0.0',
        boot: boot,
        shutdown: function () { return CORE.ok(true); },
        list: list,
        get: get,
        add: add,
        remove: remove,
        setEnabled: setEnabled,
        toggle: toggle,
        clear: clear,
        runAll: runAll,
        launchItem: launchItem
    };

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.startup = Startup;
    G.ezn32.api.startup = Startup;

    LOG.info('js/service/startup.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
