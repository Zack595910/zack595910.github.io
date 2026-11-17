/* =====================================================================
 * EZNT - 生态系统原生技术
 * EznK 架构 | L1 平台层
 *
 *   文件 : js/platform/version.js
 *   模块 : EznK.Platform.Version
 *   层级 : L1 平台层
 *
 * ---------------------------------------------------------------------
 * 版本号单一来源
 * ---------------------------------------------------------------------
 * 全系统只在这里定义版本号，其他模块一律从这里读，不再各自写死，
 * 避免"关于系统显示 1.0.0、任务管理器显示 1.0.1"这类不一致。
 *
 *   版本格式 : MAJOR.MINOR.PATCH   例 1.3.2
 *   Build    : 构建日期 YYYYMMDD    例 20260214
 *   Release  : 交付批次号           例 7
 *
 *   完整标识 : EZNT 1.3.2 (Build 20260214, Release 7)
 *
 * ---------------------------------------------------------------------
 * 升级规则（本项目约定）
 * ---------------------------------------------------------------------
 *   PATCH +1  (x.y.Z)   小问题修复：单个 bug、文案、样式、单个控件行为
 *   MINOR +1  (x.Y.0)   功能新增或较大改动：新应用、新运行时、多文件重构
 *   MAJOR +1  (X.0.0)   架构级变更：分层调整、协议不兼容、存储格式变更
 *
 *   每次交付都必须同时更新 BUILD（当天日期）与 RELEASE（+1）。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Platform && G.EznK.Platform.Version) { return; }

    var CORE = G.EznK.Platform.Core;

    /* ---------------- 版本三元组 ---------------- */
    var MAJOR = 1;
    var MINOR = 8;
    var PATCH = 0;

    /* ---------------- 构建信息 ---------------- */
    /* BUILD 用当天日期：每次交付手动更新为当天 YYYYMMDD */
    var BUILD = '20261117';
    /* RELEASE 每交付一次 +1 */
    var RELEASE = 17;

    var NAME = 'EZNT';
    var CODENAME = 'Ecosystem Native Technology';
    var ARCH = 'EznK';
    var API = 'Ezn32';
    var KERNEL = 'SRM';

    function pad2(n) { return n < 10 ? ('0' + n) : String(n); }

    /** 当天日期 YYYYMMDD */
    function today() {
        var d = new Date();
        return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate());
    }

    /** 语义版本 x.y.z */
    function semver() { return MAJOR + '.' + MINOR + '.' + PATCH; }

    /** 完整标识：EZNT 1.3.0 (Build 20260214, Release 7) */
    function full() {
        return NAME + ' ' + semver() + ' (Build ' + BUILD + ', Release ' + RELEASE + ')';
    }

    /** 短标识：1.3.0+20260214.r7 */
    function short() {
        return semver() + '+' + BUILD + '.r' + RELEASE;
    }

    /** 结构化信息 */
    function info() {
        return {
            name: NAME,
            version: semver(),
            major: MAJOR, minor: MINOR, patch: PATCH,
            build: BUILD,
            release: RELEASE,
            codename: CODENAME,
            arch: ARCH,
            api: API,
            kernel: KERNEL,
            full: full(),
            short: short(),
            builtToday: BUILD === today()
        };
    }

    /**
     * bump(kind) - 按规则计算下一个版本号（不写文件，仅供工具/脚本使用）
     *   'patch' | 'minor' | 'major'
     */
    function bump(kind) {
        var mj = MAJOR, mn = MINOR, pt = PATCH;
        if (kind === 'major') { mj += 1; mn = 0; pt = 0; }
        else if (kind === 'minor') { mn += 1; pt = 0; }
        else { pt += 1; }
        return { version: mj + '.' + mn + '.' + pt,
                 build: today(),
                 release: RELEASE + 1 };
    }

    var Version = {
        name: NAME,
        major: MAJOR, minor: MINOR, patch: PATCH,
        build: BUILD, release: RELEASE,
        codename: CODENAME, arch: ARCH, api: API, kernel: KERNEL,
        semver: semver,
        full: full,
        short: short,
        info: info,
        bump: bump,
        today: today
    };

    if (!G.EznK.Platform) { G.EznK.Platform = {}; }
    G.EznK.Platform.Version = Version;

    CORE.createLogger('EznK/L1:version').info('js/platform/version.js 已加载 ' + short());

}(typeof globalThis !== 'undefined' ? globalThis : this));
