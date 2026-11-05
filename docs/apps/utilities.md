# 系统小应用与设置项

这一组应用都很小，但都在真实读写文件系统与系统状态。

## Tasks（任务）

- 数据文件：`~/Documents/tasks.json`，用 `fs.readJson` / `fs.writeJson` 读写。
- 支持新增、勾选完成、删除、清除已完成；三个筛选：待办 / 全部 / 已完成。
- 每行右侧的圆点表示优先级（`high` 红、`normal` 强调色、`low` 灰）。
- 回车即可添加，无需点按钮。

```osl
items.append({"id": seq, "title": title, "done": False, "priority": "normal"})
fs.writeJson(file, items)
```

## Clock（时钟）

- 左侧是纯 CSS 画的表盘：12 个刻度 + 三根指针，用 `transform: rotate(deg)` 驱动。
- 右侧数字时间、本地化日期、秒表。
- `every(200, tick)` 每秒刷新 5 次；秒表基于时间戳差值，不累加定时器误差。

## Preview（Markdown 预览）

- 列出 `~/Documents` 下的 `.md` / `.txt`。
- 词法级 Markdown：`#`/`##`/`###` 标题、`-` 列表、`---` 分隔线、``` 代码块。
- 行内的 `**` 与 `` ` `` 会被去掉（OML 的 Label 不支持行内混排样式）。
- 默认打开 `welcome.md`。

## Logs（系统日志）

内核维护一个 400 条的环形缓冲，记录：

| 级别 | 来源 |
| --- | --- |
| `system` | 启动 |
| `app` | 应用打开 / 关闭 |
| `error` | 应用脚本异常、`runScript` 失败 |
| `notice` | 系统通知 |

应用可以自己写日志：`sys.log("info", "hello")`。

## 桌面与窗口交互

- **桌面图标可拖到任意位置**，坐标写入 `~/.config/desktop-layout.json`，刷新后保持。
  图标是绝对定位的，`mousedown` 记录抓取偏移、`mousemove` 更新坐标、`mouseup` 落盘。
  网格吸附是一个开关（设置项 `deskSnap`）：开启时图标按 `图标宽+46 / 图标高+54`
  的步长对齐，关闭后可以随意摆放。右键「对齐到网格」可切换，开启的瞬间会把现有图标
  吸到网格；关闭后恢复之前保存的自由坐标（因为网格只是显示层，文件里的坐标没有改）。
  「整理图标」清空布局回到自动排列。
- **Windows 任务栏**：固定应用来自设置项 `pinned`。右键开始菜单里的应用可以
  「固定到任务栏 / 取消固定」，右键任务栏按钮可以关闭窗口或新建窗口。
  同一应用的多个窗口合并成一个按钮，右上角显示窗口数量；点击在窗口之间循环，
  只有单窗口时点击当前窗口才会最小化；中键点击任务栏/Dock 图标直接新建窗口。
  固定按钮可以直接拖动排序。
- **macOS Dock**：固定项来自 `dockPinned`，右键图标可「保留在程序坞 / 移除」；
  最小化的窗口会作为独立条目出现在 Dock 右侧，点击恢复，右键可关闭；
  未固定但正在运行的应用也会临时出现在 Dock 里，同样可重新固定。
- **系统源码**：`/usr/share/os/` 是外壳自身的 OSL/OML，`/usr/share/apps/<id>/`
  是每个应用的源码，`/usr/share/i18n/*.json` 是语言包，文件管理器侧栏都有入口。
- **窗口预览**：鼠标停在任务栏/Dock 的分组按钮上，会弹出该应用所有窗口的列表；
  点击条目切换，`+` 新建窗口。移开鼠标 180ms 后自动收起。
- **运行窗口**：`Alt + F2`、开始菜单右栏「运行…」或桌面右键「运行…」打开。
  输入应用名（本地化名称或 id）会列出应用，输入路径会列出文件夹；回车执行，
  ↑/↓ 选择，Esc 关闭。
- **应用注册表**：`/etc/apps.json` 是应用清单，每个条目可覆盖
  `name / icon / width / height / hidden`；每个应用目录下还有 `app.json` 清单。
  编辑后运行 `sys.reloadApps()`（或从控制台调用 `kernel.reloadApps()`）即可生效，
  刷新页面也会重新加载。
- **托盘面板**：电量来自 `navigator.getBattery()`（含充电状态），网络来自
  `navigator.onLine`，音量滑块会写入设置并影响通知提示音。
- **双击标题栏**最大化 / 恢复；最大化与恢复有 0.2 秒过渡。
- **macOS 绿灯**进入真正的全屏（隐藏菜单栏、Dock、任务栏），再点一次或按
  `Esc` 退出；Windows 风格下最大化按钮仍是最大化。
- **macOS 红绿灯**悬停时显示 ×、−、+ 符号，颜色不再被 hover 规则覆盖。
- 文件管理器：`Ctrl + L` 或双击面包屑切换为可编辑路径，回车跳转、`Esc` 取消。

## 新增的系统 API

```osl
sys.runScript(code, "/home/user/test.osl")   # → { ok, output, error }
sys.log("info", "custom event")
let rows = sys.logs(50)                      # [{ id, time, level, message }]
sys.clearLogs()
let m = sys.metrics()                        # { windows, apps, files, bytes, logs, uptime }
let b = sys.battery()                        # { supported, level, charging, … }
sys.network()                                # 在线状态
sys.volume() / sys.setVolume(40)             # 系统音量 0–100
sys.toggleMute()
sys.viewport()                               # { width, height } 工作区尺寸
ui.chooseImage(fn(dataUrl): …)                # 原生图片选择器

let hits = fs.search("/home/user", "osl", 20)  # 递归按文件名搜索

win.move(120, 80)
win.center()
```

## 设置项一览

| 分类 | 设置 | 存储键 | 影响 |
| --- | --- | --- | --- |
| 外观 | 主题 | `theme` | `body[data-theme]` |
| 外观 | 强调色 | `accent` | `--accent` |
| 外观 | 壁纸 | `wallpaper` | `.wall-*` 类 |
| 外观 | 界面语言 | `lang` | 词条切换 |
| 外观 | 系统风格 | `style` | `body[data-style]` |
| 桌面 | 图标大小 | `deskIconSize` | 桌面图标尺寸（36/44/52） |
| 桌面 | 任务栏位置 | `taskbarTop` | `body[data-taskbar]` |
| 桌面 | 透明效果 | `transparency` | `body.no-blur` |
| 桌面 | 窗口动画 | `animations` | `body.no-anim` |
| 时钟 | 24 小时制 | `clock24` | 任务栏时钟 |
| 时钟 | 显示秒 | `clockSeconds` | 任务栏时钟 |
| 时钟 | 每周起始日 | `weekStart` | 日历首列 |
| 文件 | 显示隐藏文件 | `showHidden` | Files、IDE |
| 文字 | 终端字号 | `termFont` | `--term-font` |
| 文字 | 编辑器字号 | `codeFont` | `--code-font` |
| 通知 | 桌面通知 | `notifications` | `kernel.notify` |

设置写入 `localStorage` 的 `os.settings.v1`，缺失字段自动回落到默认值。
