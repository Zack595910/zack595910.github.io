/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 1 - Platform Layer
 *
 *   文件    : js/platform/i18n.js
 *   模块    : EznK.Platform.I18n  (别名: EZNT.I18n)
 *   层级    : L1 平台层
 *
 * ---------------------------------------------------------------------
 * 职责
 * ---------------------------------------------------------------------
 *   全系统界面文字的语言表。所有面向用户的文字（窗口标题、按钮、
 *   菜单、对话框、通知、状态栏）都从这里取，不允许在代码里散落
 *   写死的界面文字。
 *
 *   当前支持 zh-CN（默认）与 en（保留）。键名用点分命名：
 *     T('app.fileManager')      -> '文件管理器'
 *     T('menu.file.open')       -> '打开'
 *
 *   RULE 10 例外说明：屏幕文字规则原本要求纯 ASCII，但本项目已由
 *   用户明确要求改为全中文界面，因此本模块提供 isCjkScreen() 供
 *   GDI 层判断是否放行中日韩文字。ASCII 限制仅在 i18n.strictAscii
 *   为 true 时生效（默认 false）。
 * ===================================================================== */

(function (root) {
    'use strict';
    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);
    if (G.EznK && G.EznK.Platform && G.EznK.Platform.I18n && G.EznK.Platform.I18n.__isI18n === true) { return; }

    var CORE = G.EznK.Platform.Core;
    var S = CORE.STATUS;
    var LOG = CORE.createLogger('EznK/L1:i18n');

    /* =================================================================
     * 1. 中文语言表
     * ============================================================== */

    var ZH = {
        /* ---- 通用 ---- */
        'common.ok': '确定',
        'common.cancel': '取消',
        'common.yes': '是',
        'common.no': '否',
        'common.close': '关闭',
        'common.open': '打开',
        'common.save': '保存',
        'common.delete': '删除',
        'common.edit': '编辑',
        'common.rename': '重命名',
        'common.copy': '复制',
        'common.paste': '粘贴',
        'common.cut': '剪切',
        'common.refresh': '刷新',
        'common.search': '搜索',
        'common.loading': '正在加载…',
        'common.ready': '就绪',
        'common.empty': '（空）',
        'common.none': '无',
        'common.back': '返回',
        'common.home': '主页',
        'common.apply': '应用',
        'common.preview': '预览',
        'common.reset': '恢复默认',
        'common.upload': '上传',
        'common.error': '错误',
        'common.warning': '警告',
        'common.info': '提示',
        'common.success': '成功',
        'common.confirm': '确认',
        'common.properties': '属性',
        'common.new': '新建',
        'common.name': '名称',
        'common.type': '类型',
        'common.size': '大小',
        'common.date': '日期',
        'common.items': '个项目',
        'common.cannotOpen': '无法打开',
        'common.noImplementation': '没有可用的程序来打开此项',

        /* ---- 启动 ---- */
        'boot.starting': '正在启动…',
        'boot.storage': '初始化存储',
        'boot.kernel': '启动内核',
        'boot.services': '启动服务',
        'boot.desktop': '加载桌面',
        'boot.ready': '系统就绪',
        'boot.welcome': '欢迎使用 EZNT',
        'boot.failed': '启动失败',

        /* ---- 登录 / 首次设置 ---- */
        'login.title': '登录',
        'login.welcome': '欢迎回来',
        'login.createAccount': '创建您的账户',
        'login.username': '用户名',
        'login.password': '密码',
        'login.signin': '登录',
        'login.create': '创建',
        'login.signout': '退出登录',
        'login.enterToSignin': '按回车登录',
        'login.wrongPassword': '密码错误',
        'login.userNotFound': '用户不存在',
        'login.enterName': '请输入用户名',
        'login.passwordHint': '首次设置的默认密码为 eznt',

        /* ---- 桌面 ---- */
        'desktop.title': '桌面',
        'desktop.rightClickHint': '右键点击可打开菜单',
        'desktop.newFolder': '新建文件夹',
        'desktop.newFile': '新建文本文件',
        'desktop.newShortcut': '创建快捷方式',
        'desktop.refresh': '刷新',
        'desktop.personalize': '个性化',
        'desktop.taskManager': '任务管理器',
        'desktop.controlPanel': '控制面板',
        'desktop.displaySettings': '显示设置',
        'desktop.openTerminal': '打开终端',

        /* ---- 任务栏 / 开始菜单 ---- */
        'taskbar.start': '开始',
        'taskbar.search': '搜索',
        'taskbar.notifications': '通知',
        'taskbar.clock': '时钟',
        'start.allApps': '所有应用',
        'start.pinned': '已固定',
        'start.settings': '设置',
        'start.power': '电源',
        'start.lock': '锁定',
        'start.restart': '重启',
        'start.shutdown': '关机',
        'start.appCount': '个应用',

        /* ---- 窗口 ---- */
        'window.minimize': '最小化',
        'window.maximize': '最大化',
        'window.restore': '还原',
        'window.close': '关闭',

        /* ---- 通知 ---- */
        'notify.center': '通知中心',
        'notify.empty': '暂无通知',
        'notify.clearAll': '全部清除',
        'notify.markRead': '标记为已读',

        /* ---- 应用名 ---- */
        'app.fileManager': '文件管理器',
        'app.editor': '代码编辑器',
        'app.taskManager': '任务管理器',
        'app.storageManager': '存储管理',
        'app.registryEditor': '注册表编辑器',
        'app.gpedit': '组策略',
        'app.mmc': '系统控制台',
        'app.deviceManager': '设备管理器',
        'app.shortcutWizard': '创建快捷方式',
        'app.backupManager': '系统备份',
        'app.about': '关于系统',
        'app.kdStore': 'KD 应用商店',
        'app.controlPanel': '控制面板',
        'app.terminal': '终端',
        'app.sysManager': 'System Control',
        'app.recycleBin': '回收站',
        'app.camera': '摄像头',
        'app.settings': '设置',

        /* ---- 文件管理器 ---- */
        'fm.title': '文件管理器',
        'fm.thisComputer': '此电脑',
        'fm.systemDisk': '系统盘',
        'fm.configDisk': '系统数据盘',
        'fm.systemDiskDesc': '系统盘（IndexedDB）',
        'fm.configDiskDesc': '系统数据盘（localStorage）',
        'fm.newFolder': '新建文件夹',
        'fm.newFile': '新建文件',
        'fm.delete': '删除',
        'fm.up': '上一级',
        'fm.computer': '此电脑',
        'fm.users': '用户',
        'fm.desktop': '桌面',
        'fm.documents': '文档',
        'fm.programs': '程序',
        'fm.system': '系统',
        'fm.temp': '临时文件',
        'fm.configUsers': '用户配置',
        'fm.configSystem': '系统配置',
        'fm.configApps': '应用配置',
        'fm.movedToTrash': '已移到回收站',
        'fm.cannotOpen': '无法打开',
        'fm.itemsCount': '个项目',

        /* ---- 编辑器 ---- */
        'editor.title': '代码编辑器',
        'editor.untitled': '未命名',
        'editor.file': '文件',
        'editor.run': '运行',
        'editor.openFile': '打开文件…',
        'editor.saveAs': '另存为…',
        'editor.runFile': '运行当前文件',
        'editor.pythonStatus': 'Python 环境状态',
        'editor.saved': '已保存',
        'editor.line': '行',
        'editor.col': '列',
        'editor.chars': '字符',
        'editor.pythonFinished': 'Python 运行完成',
        'editor.pythonError': 'Python 出错',
        'editor.rfFinished': 'rf 脚本运行完成',
        'editor.rfError': 'rf 出错',
        'editor.excLaunched': 'EXC 应用已启动',
        'editor.excError': 'EXC 出错',
        'editor.noRunner': '没有对应的运行器',

        /* ---- 任务管理器 ---- */
        'tm.title': '任务管理器',
        'tm.name': '名称',
        'tm.type': '类型',
        'tm.ecosystem': '生态',
        'tm.status': '状态',
        'tm.uptime': '运行时长',
        'tm.endTask': '结束任务',
        'tm.refresh': '刷新',
        'tm.processCount': '个进程',

        /* ---- 存储管理 ---- */
        'sm.title': '存储管理',
        'sm.backend': '存储后端',
        'sm.indexeddb': 'IndexedDB',
        'sm.localstorage': 'localStorage',
        'sm.available': '可用',
        'sm.unavailable': '不可用',
        'sm.records': '记录数',
        'sm.files': '文件',
        'sm.dirs': '目录',
        'sm.totalSize': '总大小',
        'sm.configKeys': '配置项',
        'sm.emptyTrash': '清空回收站',
        'sm.clearBackups': '清除备份',
        'sm.trashEmptied': '回收站已清空',
        'sm.backupsCleared': '备份已清除',

        /* ---- 注册表 ---- */
        'reg.title': '注册表编辑器',
        'reg.name': '名称',
        'reg.value': '值',
        'reg.data': '数据',
        'reg.selectKey': '请选择注册表项',
        'reg.values': '个值',

        /* ---- 组策略 ---- */
        'gp.title': '组策略',
        'gp.desc': '策略用于限制系统和应用可以执行的操作。',
        'gp.resetAll': '全部重置',
        'gp.policies': '条策略',
        'gp.AllowKDInstall': '允许安装 KD 应用',
        'gp.AllowSysExecute': '允许执行 sys 脚本',
        'gp.AllowSysUpdate': '允许安装系统更新',
        'gp.RequireSysPassword': '需要管理员密码',
        'gp.AllowMediaAccess': '允许访问摄像头和麦克风',
        'gp.AllowNetwork': '允许访问网络',
        'gp.AllowExternalScripts': '允许运行外部脚本',
        'gp.LockScreenTimeout': '锁屏超时（秒）',
        'gp.ShowErrorDialogs': '显示错误对话框',
        'gp.RequireRestorePointBeforeRestore': '还原前需要还原点',

        /* ---- 系统控制台 MMC ---- */
        'mmc.title': '系统控制台',
        'mmc.root': '控制台根节点',
        'mmc.selectUnit': '请选择左栏中的一个管理单元',
        'mmc.sysinfo': '系统信息',
        'mmc.processes': '进程',
        'mmc.services': '服务',
        'mmc.kernel': '内核',
        'mmc.phase': '运行阶段',
        'mmc.modules': '已加载模块',
        'mmc.uptime': '运行时长',
        'mmc.service': '服务',

        /* ---- 设备管理器 ---- */
        'dm.title': '设备管理器',
        'dm.kind': '类别',
        'dm.device': '设备',
        'dm.camera': '摄像头',
        'dm.microphone': '麦克风',
        'dm.audioOut': '音频输出',
        'dm.noDevices': '未检测到设备',
        'dm.testCamera': '测试摄像头',
        'dm.beepTest': '声音测试',
        'dm.devices': '个设备',
        'dm.cameraOpened': '摄像头已打开',
        'dm.cameraFailed': '摄像头打开失败',

        /* ---- 快捷方式向导 ---- */
        'scw.title': '创建快捷方式',
        'scw.desc': '在桌面上创建快捷方式',
        'scw.target': '目标',
        'scw.targetHint': '/Users/User/Desktop/hello.rf 或 app:editor',
        'scw.name': '名称',
        'scw.create': '创建',
        'scw.created': '已创建',
        'scw.failed': '创建失败',
        'scw.enterTarget': '请输入目标路径或 app:应用ID',

        /* ---- 备份 ---- */
        'bm.title': '系统备份',
        'bm.view': '查看',
        'bm.actions': '操作',
        'bm.fullBackups': '完整备份',
        'bm.restorePoints': '还原点',
        'bm.createBackup': '创建备份',
        'bm.restoreSelected': '还原所选',
        'bm.refresh': '刷新',
        'bm.backups': '个备份',
        'bm.restorePointCount': '个还原点',
        'bm.creating': '正在创建备份…',
        'bm.saved': '备份已保存',
        'bm.failed': '备份失败',
        'bm.id': '编号',
        'bm.created': '创建时间',

        /* ---- 关于 ---- */
        'about.title': '关于 EZNT',
        'about.subtitle': '生态系统原生技术',
        'about.version': '版本 1.0.0',
        'about.arch': '架构',
        'about.archValue': 'EznK（六层 + 两横切面）',
        'about.kernel': '内核',
        'about.kernelPhase': '内核阶段',
        'about.modules': '已加载模块',
        'about.storage': '存储后端',
        'about.python': 'Python 运行时',
        'about.user': '当前用户',
        'about.footer1': '完全运行在浏览器中',
        'about.footer2': 'MIT 许可证 · 使用 Ezn32 构建',
        'about.close': '关闭',

        /* ---- KD 商店 ---- */
        'kds.title': 'KD 应用商店',
        'kds.installed': '已安装',
        'kds.install': '安装 KD 应用',
        'kds.source': 'HTML 源码',
        'kds.installBtn': '安装',
        'kds.launch': '启动',
        'kds.uninstall': '卸载',
        'kds.installedOk': '已安装',
        'kds.needName': '请填写名称和 HTML 源码',
        'kds.count': '个已安装',
        'kds.launchFailed': '启动失败',

        /* ---- 控制面板（Windows Control） ---- */
        'cp.title': '控制面板',
        'cp.adjust': '调整计算机的设置',
        'cp.allItems': '所有控制面板项',
        'cp.home': '主页',
        'cp.category': '类别',
        'cp.largeIcons': '大图标',
        'cp.smallIcons': '小图标',
        'cp.searchPlaceholder': '搜索控制面板',
        'cp.notFound': '未找到',
        'cp.searchResults': '搜索结果',
        'cp.back': '后退',

        'cp.cat.system': '系统和安全',
        'cp.cat.systemDesc': '查看计算机状态 | 备份和还原',
        'cp.cat.network': '网络和 Internet',
        'cp.cat.networkDesc': '查看网络状态和任务',
        'cp.cat.hardware': '硬件和声音',
        'cp.cat.hardwareDesc': '查看设备和打印机 | 添加设备',
        'cp.cat.programs': '程序',
        'cp.cat.programsDesc': '卸载程序',
        'cp.cat.user': '用户帐户',
        'cp.cat.userDesc': '更改帐户类型',
        'cp.cat.appearance': '外观和个性化',
        'cp.cat.appearanceDesc': '个性化设置',
        'cp.cat.clock': '时钟和区域',
        'cp.cat.clockDesc': '更改日期、时间格式',
        'cp.cat.ease': '轻松使用',
        'cp.cat.easeDesc': '优化视觉显示',

        'cp.item.security': '安全和维护',
        'cp.item.securityDesc': '查看安全状态',
        'cp.item.backup': '备份和还原',
        'cp.item.backupDesc': '备份或还原文件',
        'cp.item.firewall': '防火墙',
        'cp.item.firewallDesc': '配置防火墙',
        'cp.item.network': '网络和共享中心',
        'cp.item.networkDesc': '查看网络状态',
        'cp.item.internet': 'Internet 选项',
        'cp.item.internetDesc': 'Internet 设置',
        'cp.item.sound': '声音',
        'cp.item.soundDesc': '调整音量',
        'cp.item.mouse': '鼠标',
        'cp.item.mouseDesc': '鼠标设置',
        'cp.item.keyboard': '键盘',
        'cp.item.keyboardDesc': '键盘设置',
        'cp.item.power': '电源选项',
        'cp.item.powerDesc': '电源设置',
        'cp.item.programs': '程序和功能',
        'cp.item.programsDesc': '卸载程序',
        'cp.item.user': '用户帐户',
        'cp.item.userDesc': '用户设置',
        'cp.item.personalize': '个性化',
        'cp.item.personalizeDesc': '壁纸 | 颜色 | 屏保',
        'cp.item.date': '日期和时间',
        'cp.item.dateDesc': '日期时间设置',
        'cp.item.ease': '轻松使用',
        'cp.item.easeDesc': '视觉优化',
        'cp.item.storage': '存储空间',
        'cp.item.storageDesc': '存储统计',
        'cp.item.display': '显示',
        'cp.item.displayDesc': '分辨率与缩放',
        'cp.item.theme': '主题',
        'cp.item.themeDesc': '更改整体外观',
        'cp.item.python': 'Python 环境',
        'cp.item.pythonDesc': '安装 Pyodide 运行时',
        'cp.item.fileassoc': '默认打开方式',
        'cp.item.fileassocDesc': '按扩展名设置默认应用',

        /* ---- 个性化 ---- */
        'pers.title': '个性化',
        'pers.desktopBg': '桌面背景颜色',
        'pers.uploadImage': '上传图片壁纸',
        'pers.uploadVideo': '上传视频壁纸',
        'pers.wallpaperChanged': '壁纸已更改',
        'pers.wallpaperUploaded': '图片壁纸已设置',
        'pers.videoUploaded': '视频壁纸已设置',
        'pers.clearWallpaper': '清除壁纸',
        'pers.windowColor': '窗口颜色',
        'pers.restoreDefault': '恢复默认',
        'pers.windowColorChanged': '窗口颜色已更改',
        'pers.screensaver': '屏幕保护程序',
        'pers.screensaverNone': '无',
        'pers.screensaverBubbles': '气泡',
        'pers.screensaverStars': '星空',
        'pers.screensaverMatrix': '代码雨',
        'pers.screensaverClock': '时钟',
        'pers.screensaverApplied': '屏幕保护程序已应用',
        'pers.screensaverTimeout': '等待时间（分钟）',
        'pers.theme': '主题',
        'pers.themeDark': '深色',
        'pers.themeLight': '浅色',
        'pers.themeContrast': '高对比度',
        'pers.apply': '应用',
        'pers.custom': '自定义颜色',
        'pers.imageFailed': '图片读取失败',
        'pers.videoFailed': '视频读取失败',

        /* ---- 安全 ---- */
        'sec.title': '安全和维护',
        'sec.overall': '总体状态',
        'sec.good': '良好',
        'sec.network': '网络防火墙',
        'sec.enabled': '已启用',
        'sec.updates': '系统更新',
        'sec.uptodate': '已是最新',
        'sec.backup': '备份',
        'sec.lastBackup': '上次备份',
        'sec.never': '从未备份',
        'sec.restorePoint': '创建还原点',
        'sec.restorePointCreated': '还原点已创建',

        /* ---- 电源 ---- */
        'power.title': '电源选项',
        'power.plan': '电源计划',
        'power.balanced': '平衡',
        'power.high': '高性能',
        'power.saver': '节能',
        'power.lockNow': '立即锁定',
        'power.sleep': '睡眠',
        'power.restart': '重启',
        'power.shutdown': '关机',

        /* ---- 用户 ---- */
        'user.title': '用户帐户',
        'user.accounts': '用户账户',
        'user.admin': '管理员',
        'user.standard': '标准用户',
        'user.current': '当前用户',
        'user.switch': '切换用户',
        'user.signout': '退出登录',
        'user.count': '个账户',

        /* ---- 日期时间 ---- */
        'dt.title': '日期和时间',
        'dt.current': '当前时间',
        'dt.date': '日期',
        'dt.time': '时间',
        'dt.zone': '时区',

        /* ---- Python 环境 ---- */
        'py.title': 'Python 环境',
        'py.status': '状态',
        'py.notInstalled': '未安装',
        'py.installing': '正在安装',
        'py.ready': '已就绪',
        'py.unavailable': '不可用',
        'py.version': '版本',
        'py.install': '安装 Pyodide 运行时',
        'py.reinstall': '重新安装',
        'py.connecting': '正在连接 CDN…',
        'py.downloading': '正在下载…',
        'py.initializing': '正在初始化 Python 解释器…',
        'py.complete': '安装完成',
        'py.failed': '下载失败，请检查网络',
        'py.speed': '速度',
        'py.offline': '离线状态，无法安装',

        /* ---- 程序 ---- */
        'prog.title': '程序和功能',
        'prog.installed': '已安装的程序',
        'prog.uninstallBtn': '卸载',
        'prog.builtin': '内置',

        /* ---- 显示 ---- */
        'disp.title': '显示',
        'disp.resolution': '分辨率',
        'disp.scale': '缩放',
        'disp.native': '跟随窗口',
        'disp.applied': '显示设置已应用',

        /* ---- 网络 ---- */
        'net.title': '网络和共享中心',
        'net.status': '连接状态',
        'net.online': '已连接',
        'net.offline': '未连接',
        'net.type': '连接类型',
        'net.browser': '浏览器网络',

        /* ---- 声音 ---- */
        'snd.title': '声音',
        'snd.test': '播放测试音',
        'snd.volume': '音量',
        'snd.played': '已播放测试音',

        /* ---- 错误信息 ---- */
        'err.noApp': '没有应用程序与此文件关联',
        'err.fileNotFound': '文件不存在',
        'err.accessDenied': '拒绝访问',
        'err.offline': '当前离线',
        'err.notAvailable': '该功能当前不可用'
    };

    /* =================================================================
     * 2. 语言状态
     * ============================================================== */

    var state = {
        lang: 'zh-CN',
        tables: { 'zh-CN': ZH },
        strictAscii: false     /* 用户要求全中文界面，因此允许 CJK */
    };

    /**
     * T(key, fallback) -> string
     *   取界面文字；缺省时返回 fallback 或键名本身。
     */
    function T(key, fallback) {
        var table = state.tables[state.lang];
        if (table && table[key] !== undefined) { return table[key]; }
        if (state.tables['zh-CN'][key] !== undefined) { return state.tables['zh-CN'][key]; }
        return (fallback === undefined ? key : fallback);
    }

    /** has(key) -> boolean */
    function has(key) {
        var table = state.tables[state.lang];
        return !!(table && table[key] !== undefined);
    }

    /** lang() / setLang(code) */
    function lang() { return CORE.ok(state.lang); }

    function setLang(code) {
        if (!state.tables[code]) {
            return CORE.fail(S.EINVAL, { reason: '不支持的语言: ' + code });
        }
        state.lang = code;
        var srm = G.EznK && G.EznK.Kernel && G.EznK.Kernel.SRM;
        if (srm) { srm.emit('i18n:changed', { lang: code }); }
        return CORE.ok(true);
    }

    /**
     * 是否允许把该字符画到屏幕上。
     *   默认允许 ASCII + 中文（用户要求全中文）+ emoji（图标）。
     */
    function isScreenCharAllowed(ch) {
        if (!ch || ch.length === 0) { return true; }
        var code = ch.codePointAt(0);
        if (code < 0x80) { return code >= 0x20 || code === 9 || code === 10; }
        if (state.strictAscii) { return false; }
        return true;   /* 放行 CJK 与 emoji */
    }

    /** isCjkScreen() -> boolean  界面是否允许非 ASCII 文字 */
    function isCjkScreen() { return CORE.ok(!state.strictAscii); }

    /** setStrictAscii(v) - 仅测试用，恢复 ASCII 严格模式 */
    function setStrictAscii(v) {
        state.strictAscii = v === true;
        return CORE.ok(true);
    }

    /** keys() - 全部键名（测试用） */
    function keys() { return CORE.ok(Object.keys(state.tables[state.lang] || {})); }

    /** missing() - 检查哪些键缺失（开发期自检） */
    function missing(list) {
        return CORE.ok((list || []).filter(function (k) { return !has(k); }));
    }

    var I18n = {};
    I18n.__isI18n = true;
    I18n.version = '1.0.0';
    I18n.STATUS = S;
    I18n.T = T;
    I18n.t = T;
    I18n.has = has;
    I18n.lang = lang;
    I18n.setLang = setLang;
    I18n.isCjkScreen = isCjkScreen;
    I18n.getStrict = function () { return state.strictAscii; };
    I18n.setStrictAscii = setStrictAscii;
    I18n.isScreenCharAllowed = isScreenCharAllowed;
    I18n.keys = keys;
    I18n.missing = missing;

    CORE.attach('I18n', I18n);
    LOG.info('js/platform/i18n.js 已加载（中文语言包 ' + Object.keys(ZH).length + ' 条）');

}(typeof globalThis !== 'undefined' ? globalThis : this));
