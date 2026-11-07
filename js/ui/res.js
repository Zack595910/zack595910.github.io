/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Ezn32 UI
 *
 *   File    : js/ui/res.js
 *   Module  : EznK.Ui.Res  (alias: ezn32.ui.res)
 *   Layer   : Ezn32 UI
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   ezn32.ui.res - the shared UI resources: fonts, ASCII icons, cursor
 *   names, colours and metrics. ONE place defines what a window frame
 *   looks like, so every surface (window, menu, taskbar, dialog) agrees.
 *
 *   HARD RULE #10: icons are ASCII pixel art, fonts are monospace ASCII
 *   fonts. No emoji ever reaches the screen - PTD used emoji everywhere
 *   and that is exactly the "screen text is not ASCII" violation.
 *
 *   Theme colours follow a Windows-10-like dark/light pair. The theme
 *   service (L4) swaps the active theme by calling res.setTheme().
 * ===================================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.ezn32 && G.ezn32.ui && G.ezn32.ui.res && G.ezn32.ui.res.__isUiRes === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    var GDI = (G.ezn32 && G.ezn32.api && G.ezn32.api.gdi) || null;
    if (!CORE) {
        throw new Error('[Ezn32 UI] js/ui/res.js requires platform/core.js');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var LOG = CORE.createLogger('Ezn32/UI:res');

    /* =================================================================
     * 1. Fonts
     * ============================================================== */

    /* 中文字体优先：微软雅黑 -> 苹方 -> sans-serif，emoji 由系统 emoji 字体渲染 */
    var CN_FAMILY = '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif';
    var MONO_FAMILY = '"Cascadia Code", Consolas, "Microsoft YaHei", monospace';

    var FONTS = Object.freeze({
        ui:      { family: CN_FAMILY, size: 12, weight: 400 },
        uiBold:  { family: CN_FAMILY, size: 12, weight: 700 },
        title:   { family: CN_FAMILY, size: 12, weight: 700 },
        small:   { family: CN_FAMILY, size: 11, weight: 400 },
        mono:    { family: MONO_FAMILY, size: 12, weight: 400 },
        monoBig: { family: MONO_FAMILY, size: 14, weight: 400 },
        titleGlyph: { family: '"Segoe UI", "Microsoft YaHei", sans-serif', size: 14, weight: 400 },
        icon:    { family: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif', size: 16, weight: 400 },
        iconSmall: { family: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif', size: 12, weight: 400 },
        iconLarge: { family: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif', size: 30, weight: 400 },
        iconDesktop: { family: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif', size: 36, weight: 400 },
        iconHuge: { family: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif', size: 44, weight: 400 }
    });

    /** font(name) -> font object for gdi.CreateFont / SelectObject */
    function font(name) {
        var f = FONTS[name] || FONTS.ui;
        return GDI ? GDI.CreateFont(f).value : null;
    }

    /** fontCss(name) -> 'bold 12px "Consolas", monospace' */
    function fontCss(name) {
        var f = FONTS[name] || FONTS.ui;
        return (f.weight >= 600 ? 'bold ' : '') + f.size + 'px ' + f.family;
    }

    /* =================================================================
     * 2. Metrics (every dimension the UI uses)
     * ============================================================== */

    var METRICS = Object.freeze({
        titlebarHeight: 28,
        borderWidth: 1,
        taskbarHeight: 40,
        /* 对齐 PTD：.icon-img 48x48，emoji 字号 36px，标签宽 80px */
        iconSize: 48,
        iconGlyphSize: 36,
        desktopIconWidth: 80,
        iconLarge: 48,
        buttonHeight: 26,
        buttonMinWidth: 72,
        editHeight: 24,
        labelHeight: 18,
        checkboxSize: 14,
        scrollbarWidth: 12,
        menuHeight: 22,
        menuItemHeight: 24,
        dialogButtonWidth: 80,
        padding: 8,
        gap: 6,
        desktopGridSize: 100,
        desktopIconLabelWidth: 80
    });

    /* =================================================================
     * 3. Themes
     * ============================================================== */

    var THEMES = {
        default: {
            name: 'default',
            desktop: '#0078D4',
            desktopGradientStart: '#0078D4',
            desktopGradientEnd: '#004E8C',
            titleActive: '#0078D4',
            titleInactive: '#3C3C3C',
            titleTextActive: '#FFFFFF',
            titleTextInactive: '#B0B0B0',
            windowBody: '#202020',
            windowBorder: '#1A1A1A',
            windowShadow: 'rgba(0,0,0,0.45)',
            taskbar: '#111111',
            taskbarHover: '#2A2A2A',
            taskbarActive: '#0078D4',
            taskbarText: '#FFFFFF',
            surface: '#2B2B2B',
            surfaceAlt: '#252525',
            surfaceHover: '#3A3A3A',
            surfaceActive: '#454545',
            border: '#3C3C3C',
            text: '#F0F0F0',
            textSecondary: '#A0A0A0',
            textDisabled: '#606060',
            accent: '#0078D4',
            accentHover: '#1E8CE8',
            accentText: '#FFFFFF',
            danger: '#E81123',
            success: '#27AE60',
            warning: '#F39C12',
            inputBg: '#1A1A1A',
            inputBorder: '#4A4A4A',
            selectionBg: '#0078D4',
            selectionText: '#FFFFFF',
            menuBg: '#2B2B2B',
            menuBorder: '#4A4A4A',
            scrollTrack: '#1A1A1A',
            scrollThumb: '#4A4A4A',
            tooltipBg: '#3A3A3A',
            tooltipText: '#F0F0F0'
        },
        light: {
            name: 'light',
            desktop: '#0078D4',
            desktopGradientStart: '#0A8AE8',
            desktopGradientEnd: '#004E8C',
            titleActive: '#0078D4',
            titleInactive: '#CCCCCC',
            titleTextActive: '#FFFFFF',
            titleTextInactive: '#333333',
            windowBody: '#FFFFFF',
            windowBorder: '#C0C0C0',
            windowShadow: 'rgba(0,0,0,0.30)',
            taskbar: '#F0F0F0',
            taskbarHover: '#E0E0E0',
            taskbarActive: '#0078D4',
            taskbarText: '#1A1A1A',
            surface: '#FFFFFF',
            surfaceAlt: '#F5F5F5',
            surfaceHover: '#E8E8E8',
            surfaceActive: '#DCDCDC',
            border: '#C8C8C8',
            text: '#1A1A1A',
            textSecondary: '#666666',
            textDisabled: '#A0A0A0',
            accent: '#0078D4',
            accentHover: '#1E8CE8',
            accentText: '#FFFFFF',
            danger: '#E81123',
            success: '#27AE60',
            warning: '#F39C12',
            inputBg: '#FFFFFF',
            inputBorder: '#A0A0A0',
            selectionBg: '#0078D4',
            selectionText: '#FFFFFF',
            menuBg: '#F8F8F8',
            menuBorder: '#B0B0B0',
            scrollTrack: '#F0F0F0',
            scrollThumb: '#B0B0B0',
            tooltipBg: '#2B2B2B',
            tooltipText: '#F0F0F0'
        },
        highContrast: {
            name: 'highContrast',
            desktop: '#000000',
            desktopGradientStart: '#000000',
            desktopGradientEnd: '#000000',
            titleActive: '#FFFFFF',
            titleInactive: '#808080',
            titleTextActive: '#000000',
            titleTextInactive: '#000000',
            windowBody: '#000000',
            windowBorder: '#FFFFFF',
            windowShadow: 'rgba(0,0,0,0)',
            taskbar: '#000000',
            taskbarHover: '#333333',
            taskbarActive: '#FFFFFF',
            taskbarText: '#FFFFFF',
            surface: '#000000',
            surfaceAlt: '#111111',
            surfaceHover: '#333333',
            surfaceActive: '#444444',
            border: '#FFFFFF',
            text: '#FFFFFF',
            textSecondary: '#C0C0C0',
            textDisabled: '#808080',
            accent: '#FFFF00',
            accentHover: '#FFFF66',
            accentText: '#000000',
            danger: '#FF0000',
            success: '#00FF00',
            warning: '#FFFF00',
            inputBg: '#000000',
            inputBorder: '#FFFFFF',
            selectionBg: '#FFFF00',
            selectionText: '#000000',
            menuBg: '#000000',
            menuBorder: '#FFFFFF',
            scrollTrack: '#000000',
            scrollThumb: '#FFFFFF',
            tooltipBg: '#FFFFFF',
            tooltipText: '#000000'
        }
    };

    var activeTheme = 'default';

    /** theme() -> active theme object (read-only copy) */
    function theme() {
        return ok(THEMES[activeTheme] || THEMES.default);
    }

    /** themeNames() -> string[] */
    function themeNames() {
        return ok(Object.keys(THEMES));
    }

    /** setTheme(name) -> { status, value: true } */
    function setTheme(name) {
        if (typeof name !== 'string' || !THEMES[name]) {
            return CORE.fail(S.EINVAL, { reason: 'unknown theme: ' + name, available: Object.keys(THEMES) });
        }
        activeTheme = name;
        var s = (G.EznK && G.EznK.Kernel && G.EznK.Kernel.SRM) || G.SRM;
        if (s && typeof s.emit === 'function') {
            s.emit('theme:changed', { name: name });
        }
        return ok(true);
    }

    /** color(key) -> hex string from the active theme */
    function color(key) {
        var t = THEMES[activeTheme] || THEMES.default;
        return t[key] !== undefined ? t[key] : '#FF00FF';
    }

    /* =================================================================
     * 4. Icons (ASCII pixel art, rule #10)
     *
     *   Each icon is a small ASCII glyph string drawn with the mono font.
     *   No emoji, no non-ASCII glyphs, ever.
     * ============================================================== */

    var ICONS = Object.freeze({
        /* ---- 文件与目录 ---- */
        folder:      '📁',
        folderOpen:  '📂',
        file:        '📄',
        text:        '📝',
        image:       '🖼️',
        video:       '🎬',
        audio:       '🎵',
        archive:     '🗜️',
        json:        '🧾',

        /* ---- 代码与脚本 ---- */
        python:      '🐍',
        rf:          '📜',
        exc:         '⚙️',
        kd:          '📦',
        sys:         '🛠️',
        zjl:         '📚',
        skl:         '🧩',

        /* ---- 磁盘与设备 ---- */
        drive:       '💿',
        disk:        '💾',
        computer:    '🖥️',
        trash:       '🗑️',
        printer:     '🖨️',
        camera:      '📷',
        microphone:  '🎤',
        speaker:     '🔊',
        usb:         '🔌',
        network:     '🌐',

        /* ---- 系统与界面 ---- */
        window:      '🪟',
        app:         '🚀',
        settings:    '⚙️',
        search:      '🔍',
        power:       '🔌',
        user:        '👤',
        users:       '👥',
        lock:        '🔒',
        unlock:      '🔓',
        shield:      '🛡️',
        fire:        '🔥',
        palette:     '🎨',
        clock:       '🕐',
        calendar:    '📅',
        access:      '♿',
        package:     '📦',
        backup:      '💾',
        restore:     '♻️',
        registry:    '🗂️',
        policy:      '📋',
        console:     '🖥️',
        process:     '📊',
        service:     '🔧',
        storage:     '💿',
        display:     '🖼️',
        monitor:     '🖥️',
        theme:       '🎨',
        info:        'ℹ️',
        warning:     '⚠️',
        error:       '❌',
        success:     '✅',
        help:        '❓',
        close:       '❌',
        minimize:    '➖',
        maximize:    '⬜',
        restoreWin:  '🔲',
        chevronDown: '⬇️',
        chevronUp:   '⬆️',
        chevronRight:'➡️',
        check:       '✔️',
        arrowLeft:   '⬅️',
        arrowRight:  '➡️',
        arrowUp:     '⬆️',
        arrowDown:   '⬇️',
        star:        '⭐',
        heart:       '❤️',
        edit:        '✏️',
        delete:      '🗑️',
        refresh:     '🔄',
        save:        '💾',
        upload:      '📤',
        download:    '📥',
        plus:        '➕',
        minus:       '➖',
        menu:        '📋',
        grid:        '🔲',
        list:        '📋',
        home:        '🏠',
        back:        '⬅️',
        forward:     '➡️',
        pythonEnv:   '🐍',
        wallpaper:   '🖼️',
        screensaver: '💫',
        volume:      '🔊',
        wifi:        '📶',
        battery:     '🔋',
        fire:        '🔥',
        bug:         '🐛',
        terminal:    '⌨️',
        editor:      '📝',
        explorer:    '📁'
    });

    /** icon(name) -> ASCII glyph */
    function icon(name) {
        return ICONS[name] !== undefined ? ICONS[name] : ICONS.file;
    }

    /** iconForExtension(ext) -> icon name */
    function iconForExtension(ext) {
        var e = String(ext || '').toLowerCase();
        if (e === '.txt' || e === '.md') { return 'text'; }
        if (e === '.py') { return 'python'; }
        if (e === '.rf') { return 'rf'; }
        if (e === '.exc') { return 'exc'; }
        if (e === '.kd' || e === '.html') { return 'kd'; }
        if (e === '.sys') { return 'sys'; }
        if (e === '.zjl') { return 'zjl'; }
        if (e === '.skl') { return 'skl'; }
        return 'file';
    }

    /* =================================================================
     * 5. Cursors
     * ============================================================== */

    var CURSORS = Object.freeze({
        default: 'default',
        pointer: 'pointer',
        text: 'text',
        move: 'move',
        grab: 'grab',
        grabbing: 'grabbing',
        resizeNS: 'ns-resize',
        resizeEW: 'ew-resize',
        resizeNWSE: 'nwse-resize',
        resizeNESW: 'nesw-resize',
        notAllowed: 'not-allowed',
        wait: 'wait',
        crosshair: 'crosshair'
    });

    function cursor(name) {
        return CURSORS[name] !== undefined ? CURSORS[name] : CURSORS.default;
    }

    /* =================================================================
     * 6. Public handle
     * ============================================================== */

    var R = {};
    R.__isUiRes = true;
    R.version = '1.0.0';
    R.STATUS = S;

    R.FONTS = FONTS;
    R.METRICS = METRICS;
    R.ICONS = ICONS;
    R.CURSORS = CURSORS;

    R.font = font;
    R.fontCss = fontCss;
    R.theme = theme;
    R.themeNames = themeNames;
    R.setTheme = setTheme;
    R.color = color;
    R.icons = icon;
    R.icon = icon;
    R.iconForExtension = iconForExtension;
    R.cursor = cursor;

    if (!G.EZNT || typeof G.EZNT !== 'object') { G.EZNT = {}; }
    if (!G.EznK) { G.EznK = {}; }
    if (!G.EznK.Ui) { G.EznK.Ui = {}; }
    G.EznK.Ui.Res = R;
    if (!G.ezn32) { G.ezn32 = {}; }
    if (!G.ezn32.ui) { G.ezn32.ui = {}; }
    G.ezn32.ui.res = R;
    if (!G.EZNT.ui) { G.EZNT.ui = {}; }
    G.EZNT.ui.res = R;

    LOG.info('js/ui/res.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
