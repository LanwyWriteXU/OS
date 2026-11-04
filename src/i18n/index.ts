/**
 * i18n — the desktop's message catalogue.
 *
 * English strings double as message ids, so markup can stay readable:
 *   <Label text="Files"/>  ->  lookup("Files")
 * Anything not present in the active catalogue is returned unchanged.
 *
 * Dynamic values never go through the catalogue implicitly: use `t()` from
 * OSL when a string is built at runtime.
 */

export type Lang = 'en' | 'zh';

export interface LangInfo {
  id: Lang;
  label: string;
  native: string;
}

export const LANGS: LangInfo[] = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'zh', label: 'Chinese', native: '简体中文' },
];

const zh: Record<string, string> = {
  /* ---------------------------------------------------------- app names */
  Files: '文件',
  Terminal: '终端',
  Editor: '编辑器',
  Settings: '设置',
  Calculator: '计算器',
  About: '关于',
  'About OS': '关于本系统',
  Notes: '便签',
  Calendar: '日历',
  Monitor: '系统监视器',
  'System Monitor': '系统监视器',

  /* --------------------------------------------------------------- shell */
  'Search apps and files': '搜索应用和文件',
  'Search…': '搜索…',
  Pinned: '已固定',
  'All apps': '所有应用',
  Recent: '最近使用',
  Places: '位置',
  Home: '主目录',
  Desktop: '桌面',
  Documents: '文档',
  Downloads: '下载',
  Pictures: '图片',
  Music: '音乐',
  Projects: '项目',
  System: '系统',
  'Show desktop': '显示桌面',
  File: '文件',
  View: '视图',
  Help: '帮助',
  Lock: '锁定',
  'Lock Screen': '锁定屏幕',
  Power: '电源',
  Restart: '重启',
  'Shut Down': '关机',
  'Shut down': '关机',
  'About This OS': '关于本系统',
  'System Settings…': '系统设置…',
  'Toggle Light / Dark': '切换深色 / 浅色',
  'New Terminal Window': '新建终端窗口',
  'New Editor Window': '新建编辑器窗口',
  'New File Manager Window': '新建文件管理器窗口',
  'Close Window': '关闭窗口',
  'Grid Wallpaper': '网格壁纸',
  'Windows Style': 'Windows 风格',
  'macOS Style': 'macOS 风格',
  'Minimize All': '最小化全部',
  'Welcome Guide': '欢迎指南',
  'Keyboard Shortcuts': '键盘快捷键',
  'Keyboard shortcuts': '键盘快捷键',
  'New folder': '新建文件夹',
  'New file': '新建文件',
  'Open Terminal': '打开终端',
  'Change wallpaper': '更换壁纸',
  'Display settings': '显示设置',
  'Refresh desktop': '刷新桌面',
  'Wi-Fi: connected': 'Wi-Fi：已连接',
  'Volume: 62%': '音量：62%',
  'Battery: 82%': '电池：82%',
  'All settings': '所有设置',
  'Theme: ': '主题：',
  'This PC': '此电脑',
  'Open': '打开',
  'Open in Files': '在文件中打开',
  'Set as wallpaper': '设为壁纸',
  'Rename': '重命名',
  'Delete': '删除',
  'Copy path': '复制路径',
  'Path copied': '路径已复制',
  'Already exists: ': '已存在：',
  'Created ': '已创建 ',
  'Nothing selected': '未选择任何内容',
  'Refreshed': '已刷新',
  'Delete file': '删除文件',
  'Delete folder': '删除文件夹',
  'Item': '项目',
  'Untitled': '未命名',
  'Select wallpaper': '选择壁纸',
  'Desktop icons': '桌面图标',

  /* ------------------------------------------------------------ settings */
  Appearance: '外观',
  Storage: '存储',
  Wallpaper: '壁纸',
  Theme: '主题',
  'Light or dark surfaces across the whole system.': '全系统使用浅色或深色界面。',
  Dark: '深色',
  Light: '浅色',
  'Accent colour': '强调色',
  'Used for highlights, buttons and focus rings.': '用于高亮、按钮和焦点环。',
  'System style': '系统风格',
  'Windows-style taskbar or a macOS menu bar and dock.': 'Windows 风格任务栏，或 macOS 风格菜单栏与程序坞。',
  'Window animations': '窗口动画',
  'Fade and scale effects when windows open.': '窗口打开时的淡入与缩放效果。',
  '24-hour clock': '24 小时制',
  'Show the taskbar clock in 24-hour format.': '任务栏时钟使用 24 小时格式。',
  User: '用户',
  'System information': '系统信息',
  Developer: '开发者',
  'OSL and OML are interpreted at runtime. Open the welcome guide to read the language reference.':
    'OSL 与 OML 在运行时解释执行。打开欢迎指南阅读语言参考。',
  'Open guide': '打开指南',
  'Sample script': '示例脚本',
  'Every file you create is stored in the browser and survives a reload.':
    '你创建的每个文件都保存在浏览器中，刷新后依然存在。',
  'Factory reset': '恢复出厂设置',
  'Restore the original file tree and remove all user files. Settings are kept.':
    '恢复初始文件树并删除所有用户文件，系统设置会保留。',
  'Reset file system': '重置文件系统',
  'Reset the whole file system to its original state?\nAll of your files will be deleted.':
    '将整个文件系统恢复到初始状态？\n所有文件都会被删除。',
  'User name': '用户名',
  Language: '语言',
  'Interface language': '界面语言',
  'Choose the language used by the desktop and built-in apps.': '选择桌面与内置应用使用的语言。',
  '{0} files · {1} used of 8 MB': '{0} 个文件 · 已用 {1} / 8 MB',
  '{0}%': '{0}%',

  /* --------------------------------------------------------------- files */
  'Quick access': '快速访问',
  Back: '后退',
  Forward: '前进',
  Up: '上一级',
  Refresh: '刷新',
  'Toggle view': '切换视图',
  Name: '名称',
  Size: '大小',
  Modified: '修改时间',
  'Double-click to open · Right-click for actions': '双击打开 · 右键查看更多操作',
  'This folder is empty': '这个文件夹是空的',
  'New': '新建',
  Save: '保存',
  Duplicate: '创建副本',
  '{0} items': '{0} 项',
  '{0} items in this folder': '此文件夹中有 {0} 项',
  'Delete "{0}"?\nThis cannot be undone.': '删除“{0}”？\n此操作无法撤销。',
  'Delete "{0}" and everything inside it?': '删除“{0}”及其中的全部内容？',

  /* -------------------------------------------------------------- editor */
  'Unsaved changes': '未保存的更改',
  Saved: '已保存',
  '{0} words · {1} lines · {2} chars': '{0} 词 · {1} 行 · {2} 字符',
  'Choose a text file to open': '选择一个文本文件打开',
  Close: '关闭',
  Cancel: '取消',
  OK: '确定',
  'Enter a value…': '输入内容…',
  'Search': '搜索',

  /* --------------------------------------------------------------- about */
  Version: '版本',
  Kernel: '内核',
  Shell: '外壳',
  Languages: '语言',
  'Window manager': '窗口管理器',
  'File system': '文件系统',
  Uptime: '运行时间',
  Processor: '处理器',
  Display: '显示器',
  Memory: '内存',
  Renderer: '渲染器',
  '{0} virtual cores': '{0} 个虚拟核心',
  '{0} files · {1}': '{0} 个文件 · {1}',
  'A toy desktop environment built with two small languages: OSL for behaviour, OML for every pixel of the interface.':
    '一个用两门自制语言搭起来的玩具桌面：OSL 负责行为，OML 描述界面的每一个像素。',
  'Check updates': '检查更新',
  'Welcome to OS': '欢迎使用 OS',

  /* --------------------------------------------------------------- notes */
  'New note': '新建便签',
  'No notes yet': '还没有便签',
  'Write something…': '写点什么…',
  'Delete note': '删除便签',
  'Note name': '便签名称',
  '{0} notes': '{0} 条便签',
  'All notes are plain Markdown files in ~/Documents/Notes.':
    '所有便签都是 ~/Documents/Notes 里的 Markdown 文件。',
  'Untitled note': '未命名便签',

  /* ------------------------------------------------------------ calendar */
  Today: '今天',
  Month: '月',
  Week: '周',
  '{0} events': '{0} 个日程',
  'No events today': '今天没有日程',

  /* ------------------------------------------------------------- monitor */
  Processes: '进程',
  'Open windows': '打开的窗口',
  'No windows open': '没有打开的窗口',
  Focus: '切换',
  End: '结束',
  'End process': '结束进程',
  '{0} windows': '{0} 个窗口',
  'Storage used': '存储占用',
  'System load': '系统负载',
  'Refresh rate': '刷新间隔',
  'Every second': '每秒',
  'Uptime {0}': '已运行 {0}',

  /* --------------------------------------------------------- menu / misc */
  'Open with Editor': '用编辑器打开',
  'New shortcut': '新建快捷方式',
  'Create shortcut': '创建快捷方式',
  'Application': '应用',
  'Remove from desktop': '从桌面移除',
  'Sort icons': '整理图标',
  running: '运行中',
  minimized: '已最小化',
  Start: '开始',
  Minimize: '最小化',
  Maximize: '最大化',
  'Previous month': '上个月',
  'Next month': '下个月',
  'Deleted ': '已删除 ',
  '{0} apps installed': '{0} 个应用',
  '{0} · {1} files': '{0} · {1} 个文件',
  '{0} days': '{0} 天',
  '{0} words · {1} chars': '{0} 词 · {1} 字符',
  /* --------------------------------------------------------------- ide */
  IDE: 'IDE',
  Explorer: '资源管理器',
  'No file open': '未打开文件',
  'Go to file': '快速打开文件',
  'Search files by name': '按名称搜索文件',
  'No matching files': '没有匹配的文件',
  Finished: '运行完成',
  Failed: '运行失败',
  'Finished with no output': '运行完成（无输出）',
  Output: '输出',
  Run: '运行',
  Clear: '清空',
  'Close panel': '关闭面板',
  'Run (F5)': '运行 (F5)',
  'Save (Ctrl+S)': '保存 (Ctrl+S)',
  'Ctrl+S save · F5 run · Ctrl+P open': 'Ctrl+S 保存 · F5 运行 · Ctrl+P 快速打开',
  'Notes written here are plain files.': '这里写下的都是普通文件。',
  'Press Ctrl+Space for the start menu, or open Terminal and run fastfetch.':
    '按 Ctrl+Space 打开开始菜单，或打开终端运行 fastfetch。',
  'Welcome back. Ctrl+Alt+T opens a terminal.': '欢迎回来。Ctrl+Alt+T 可以打开终端。',
};

const CATALOGUES: Record<Lang, Record<string, string>> = {
  en: {},
  zh,
};

let current: Lang = 'en';

export function setLang(lang: string) {
  current = lang === 'zh' ? 'zh' : 'en';
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
    document.documentElement.dataset.lang = current;
  }
}

export function getLang(): Lang {
  return current;
}

/**
 * Translate a message id. Arguments fill `{0}`, `{1}`, … placeholders.
 */
export function t(key: string, ...args: any[]): string {
  if (key === null || key === undefined) return '';
  const raw = String(key);
  const table = CATALOGUES[current];
  let out = table[raw] ?? raw;
  if (args.length) {
    out = out.replace(/\{(\d+)\}/g, (m, i) => {
      const v = args[Number(i)];
      return v === undefined || v === null ? '' : String(v);
    });
  }
  return out;
}

/** Catalogue used by the renderer for literal markup text. */
export const autoT = t;

export function availableLangs(): LangInfo[] {
  return LANGS;
}
