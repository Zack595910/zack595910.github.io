/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L5 服务层
 *
 *   文件 : js/service/app-installer.js
 *   模块 : EznK.Service.appInstaller
 *   层级 : L5 服务层
 *
 * ---------------------------------------------------------------------
 * 安装到系统
 * ---------------------------------------------------------------------
 *   把一个脚本文件（.exc/.kd/.rf/.sys）或直接一段源码"打包成系统应用"：
 *
 *     · 复制到 /Programs/<AppName>/main.<ext>
 *     · 写清单 /Programs/<AppName>/manifest.json
 *     · 在 appRegistry 里注册，让它出现在开始菜单和「程序和功能」
 *     · 可选：注册开机自启
 *
 *   卸载时删除目录 + 取消注册 + 移除自启项。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Service && G.EznK.Service.appInstaller) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L5:installer');

    var ROOT = '/Programs';

    function hal() { return G.EznK.Kernel && G.EznK.Kernel.HAL; }
    function reg() { return G.EznK.Service && G.EznK.Service.appRegistry; }
    function startup() { return G.EznK.Service && G.EznK.Service.startup; }
    function K() { return G.ezn32 && G.ezn32.api && G.ezn32.api.kernel; }

    /** 应用 id 规范化：只保留字母数字与连字符 */
    function slug(name) {
        var s = String(name || '').trim();
        s = s.replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '');
        return s || ('app-' + Date.now());
    }

    function appDir(name) { return ROOT + '/' + slug(name); }

    /* =================================================================
     * 1. 运行时分发
     * ============================================================== */

    /** 由扩展名得到 { ecosystem, launcher } */
    function runtimeFor(ext) {
        var e = String(ext || '').toLowerCase();
        var RT = G.EznK.Runtime || {};
        if (e === '.exc') {
            return {
                ext: '.exc', ecosystem: 'exc',
                run: function (path) { return RT.exc && RT.exc.runFile ? RT.exc.runFile(path) : null; }
            };
        }
        if (e === '.kd') {
            return {
                ext: '.kd', ecosystem: 'kd',
                run: function (path) { return RT.kd && RT.kd.openFile ? RT.kd.openFile(path) : null; }
            };
        }
        if (e === '.rf') {
            return {
                ext: '.rf', ecosystem: 'rf',
                run: function (path) { return RT.rf && RT.rf.runFile ? RT.rf.runFile(path) : null; }
            };
        }
        if (e === '.sys') {
            return {
                ext: '.sys', ecosystem: 'sys',
                run: function (path) { return RT.sys && RT.sys.openManager ? RT.sys.openManager(path) : null; }
            };
        }
        return null;
    }

    /* =================================================================
     * 2. 安装
     * ============================================================== */

    /**
     * install(spec) -> Promise<{status, value: app}>
     *   spec: {
     *     name,          应用名（必填）
     *     sourcePath?,   源文件路径（与 source 二选一）
     *     source?,       源码字符串
     *     icon?,         图标字符（默认按扩展名）
     *     description?,
     *     autoStart?     是否同时注册开机自启
     *   }
     */
    function install(spec) {
        var s = spec || {};
        if (typeof s.name !== 'string' || !s.name.trim().length) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: '缺少应用名称' }));
        }
        var k = K();
        if (!k) { return Promise.resolve(CORE.fail(S.ENOSYS, { reason: '内核 API 不可用' })); }

        /* 决定扩展名 */
        var ext = '.exc';
        if (typeof s.sourcePath === 'string' && s.sourcePath.lastIndexOf('.') >= 0) {
            ext = s.sourcePath.slice(s.sourcePath.lastIndexOf('.')).toLowerCase();
        } else if (typeof s.ext === 'string' && s.ext.length) {
            ext = s.ext.charAt(0) === '.' ? s.ext.toLowerCase() : ('.' + s.ext.toLowerCase());
        }
        var rt = runtimeFor(ext);
        if (!rt) {
            return Promise.resolve(CORE.fail(S.EINVAL, { reason: '不支持的脚本类型: ' + ext }));
        }

        var dir = appDir(s.name);
        var mainPath = dir + '/main' + ext;
        var manifestPath = dir + '/manifest.json';

        return Promise.resolve(k.CreateDirectory(dir)).then(function (mk) {
            if (mk.status !== S.OK && mk.status !== S.EEXIST) { return mk; }

            /* 取源码 */
            if (typeof s.source === 'string') {
                return Promise.resolve(k.WriteFileText(mainPath, s.source));
            }
            if (typeof s.sourcePath === 'string') {
                return Promise.resolve(k.ReadFileText(s.sourcePath)).then(function (rd) {
                    if (rd.status !== S.OK) { return rd; }
                    return Promise.resolve(k.WriteFileText(mainPath, rd.value));
                });
            }
            return CORE.fail(S.EINVAL, { reason: '缺少源码或源文件' });
        }).then(function (wr) {
            if (wr.status !== S.OK) { return wr; }

            var appId = 'user-' + slug(s.name);
            var manifest = {
                id: appId,
                name: s.name.trim(),
                icon: s.icon || (rt.ecosystem === 'kd' ? '📦' :
                                 rt.ecosystem === 'rf' ? '📜' :
                                 rt.ecosystem === 'sys' ? '⚡' : '🧩'),
                description: s.description || '',
                ext: ext,
                ecosystem: rt.ecosystem,
                entry: mainPath,
                installedAt: new Date().toISOString(),
                autoStart: s.autoStart === true,
                builtin: false
            };

            return Promise.resolve(k.WriteFileText(manifestPath, JSON.stringify(manifest, null, 2)))
                .then(function (mr) {
                    if (mr.status !== S.OK) { return mr; }

                    /* 注册到应用注册表 */
                    var r = reg();
                    if (r) {
                        r.register({
                            id: appId,
                            name: manifest.name,
                            icon: manifest.icon,
                            category: 'user',
                            builtin: false,
                            description: manifest.description,
                            exts: [ext],
                            installed: true,
                            manifestPath: manifestPath,
                            entry: mainPath,
                            // 启动时按扩展名走对应运行时
                            launcher: function () {
                                var res = rt.run(mainPath);
                                return res || CORE.ok(true);
                            }
                        });
                    }

                    /* 可选：开机自启 */
                    if (manifest.autoStart) {
                        var st = startup();
                        if (st) {
                            st.add({
                                id: 'startup_' + appId,
                                kind: 'script',
                                name: manifest.name,
                                icon: manifest.icon,
                                target: mainPath,
                                delayMs: 1200
                            });
                        }
                    }

                    /* 注册文件关联（可选） */
                    LOG.info('应用已安装: ' + manifest.name + ' -> ' + mainPath);
                    var srm = G.EznK.Kernel && G.EznK.Kernel.SRM;
                    if (srm && srm.emit) { srm.emit('app:installed', { id: appId, name: manifest.name }); }

                    return CORE.ok(manifest);
                });
        });
    }

    /* =================================================================
     * 3. 卸载
     * ============================================================== */

    /** uninstall(appId) -> Promise<{status}> */
    function uninstall(appId) {
        var k = K();
        if (!k) { return Promise.resolve(CORE.fail(S.ENOSYS, { reason: '内核 API 不可用' })); }

        var r = reg();
        var app = r && typeof r.get === 'function' ? r.get(appId).value : null;
        if (!app) {
            return Promise.resolve(CORE.fail(S.ENOENT, { reason: '找不到应用: ' + appId }));
        }
        if (app.builtin === true) {
            return Promise.resolve(CORE.fail(S.EACCES, { reason: '内置应用不能卸载' }));
        }

        /* 移除自启项 */
        var st = startup();
        if (st) {
            try { st.remove('startup_' + appId); } catch (_) {}
        }

        /* 删目录 */
        var dir = app.entry ? app.entry.slice(0, app.entry.lastIndexOf('/')) : appDir(app.name);
        var cleanup = Promise.resolve(CORE.ok(true));
        if (dir && dir.indexOf(ROOT + '/') === 0) {
            cleanup = deleteDirRecursive(k, dir);
        }

        return cleanup.then(function () {
            if (r) { r.unregister(appId); }
            LOG.info('应用已卸载: ' + appId);
            var srm = G.EznK.Kernel && G.EznK.Kernel.SRM;
            if (srm && srm.emit) { srm.emit('app:uninstalled', { id: appId }); }
            return CORE.ok(true);
        });
    }

    /** 递归删除目录 */
    function deleteDirRecursive(k, dir) {
        return Promise.resolve(k.FindFiles(dir)).then(function (ls) {
            if (ls.status !== S.OK) { return CORE.ok(true); }
            var chain = Promise.resolve();
            (ls.value || []).forEach(function (e) {
                chain = chain.then(function () {
                    if (e.type === 'dir') { return deleteDirRecursive(k, e.path); }
                    return Promise.resolve(k.DeleteFile(e.path));
                });
            });
            return chain;
        }).then(function () {
            return Promise.resolve(k.DeleteFile(dir));
        }).then(function () {
            return CORE.ok(true);
        }, function () {
            return CORE.ok(true);
        });
    }

    /* =================================================================
     * 4. 查询
     * ============================================================== */

    /** listInstalled() -> { status, value: manifest[] } */
    function listInstalled() {
        var k = K();
        var r = reg();
        if (!k || !r) { return CORE.ok([]); }
        return Promise.resolve(k.FindFiles(ROOT)).then(function (ls) {
            if (ls.status !== S.OK) { return CORE.ok([]); }
            var dirs = (ls.value || []).filter(function (e) { return e.type === 'dir'; });
            var chain = Promise.resolve([]);
            var results = [];
            dirs.forEach(function (d) {
                chain = chain.then(function () {
                    var mp = d.path + '/manifest.json';
                    return Promise.resolve(k.ReadFileText(mp)).then(function (rd) {
                        if (rd.status === S.OK) {
                            try { results.push(JSON.parse(rd.value)); } catch (_) {}
                        }
                    });
                });
            });
            return chain.then(function () { return CORE.ok(results); });
        }, function () {
            return CORE.ok([]);
        });
    }

    /** 计算某个已安装应用占用的字节数 */
    function sizeOf(app) {
        var k = K();
        if (!k || !app || !app.entry) { return Promise.resolve(0); }
        var dir = app.entry.slice(0, app.entry.lastIndexOf('/'));
        return Promise.resolve(k.FindFiles(dir)).then(function (ls) {
            if (ls.status !== S.OK) { return 0; }
            var total = 0;
            (ls.value || []).forEach(function (e) {
                if (e.type === 'file' && typeof e.size === 'number') { total += e.size; }
            });
            return total;
        }, function () { return 0; });
    }

    var Installer = {
        version: '1.0.0',
        boot: function () { return CORE.ok(true); },
        shutdown: function () { return CORE.ok(true); },
        install: install,
        uninstall: uninstall,
        listInstalled: listInstalled,
        sizeOf: sizeOf,
        slug: slug,
        ROOT: ROOT
    };

    if (!G.EznK.Service) { G.EznK.Service = {}; }
    G.EznK.Service.appInstaller = Installer;
    G.ezn32.api.appInstaller = Installer;

    LOG.info('js/service/app-installer.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
