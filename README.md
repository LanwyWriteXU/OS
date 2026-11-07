# OS 1.1 · Origin

一个跑在浏览器里的玩具桌面系统。窗口管理、文件管理器、编辑器、终端、设置面板
**全部**由两门自制语言写成，宿主的 TypeScript 只负责解释、渲染和系统调用。

| 语言 | 全称 | 干什么 | 类比 |
| --- | --- | --- | --- |
| **OSL** | Origin Software Language | 缩进敏感的脚本语言，所有交互逻辑 | Python |
| **OML** | Origin Markup Language | XML 方言，所有界面结构与布局 | XAML |

界面上没有一个写死的按钮 —— 连任务栏、开始菜单、macOS 菜单栏和 Dock 都是
`shell.oml` 里的标签。想改桌面长什么样，就去改那几千行 OSL/OML，不用碰 TypeScript。

```
宿主 TypeScript   ≈ 9.5k 行   （词法 / 语法 / 解释器 / 渲染器 / VFS / WM）
OSL               ≈ 4.3k 行   （系统外壳 + 17 个应用的全部逻辑）
OML               ≈ 1.4k 行   （全部界面）
CSS               ≈ 2.1k 行   （纯渲染层，不算 OS 源码）
图标               82 个 SVG   （构建期内联进 bundle）
```

---

## 快速开始

```bash
pnpm install        # 或 npm install
pnpm dev            # http://127.0.0.1:5173
pnpm build          # tsc --noEmit && vite build  → dist/
pnpm preview        # http://127.0.0.1:4173
```

首次打开会自动弹出 `welcome.md` 和一条通知。按 `Ctrl + Space` 打开开始菜单，
或 `Ctrl + Alt + T` 开个终端试试 `fastfetch`。

---

## 部署到 GitHub Pages

仓库自带 `.github/workflows/deploy.yml`：push 到 `main` 即构建并发布，不需要
`gh-pages` 分支。

1. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**；
2. push 到 `main`，或在 Actions 页手动 *Run workflow*；
3. 地址形如 `https://<用户名>.github.io/OS/`。

不用改 `base`：`vite.config.ts` 里已经是 `base: './'`，产物引用 `./assets/...`，
子路径和自定义域名根目录都能跑。整个应用没有运行时 `fetch`，图标与 OSL/OML 源码
都在构建时被内联，所以也不依赖额外的静态文件。

---

## 截图

| 桌面（Windows 风格） | 开始菜单 |
| --- | --- |
| ![桌面](docs/screenshots/desktop.jpg) | ![开始菜单](docs/screenshots/start-menu.jpg) |

| 终端 + fastfetch | 文件管理器 |
| --- | --- |
| ![终端](docs/screenshots/terminal.jpg) | ![文件管理器](docs/screenshots/files.jpg) |

| macOS 风格（菜单栏 + Dock） | 浅色主题 |
| --- | --- |
| ![macOS](docs/screenshots/macos.jpg) | ![浅色](docs/screenshots/light.jpg) |

| IDE（语法高亮 + 运行输出） | 应用图标网格 |
| --- | --- |
| ![IDE](docs/screenshots/ide.jpg) | ![图标](docs/screenshots/icons.png) |

![编辑器的文件选择器](docs/screenshots/file-picker.jpg)

---

## 能力清单

### 桌面外壳

- **两套外观，一份 OML**：`body[data-style="win"]` 是任务栏 + 开始菜单，
  `data-style="mac"` 换成菜单栏 + Dock + 交通灯按钮，切换只靠 `if`。
- **窗口管理**：拖拽、八向缩放、边缘吸附（左右半屏 / 最大化）、最大化与还原、
  最小化、z-order、级联摆放；同一应用可开任意多个窗口。
- **窗口动画**：最大化/还原 0.2 s 过渡；最小化时缩小飞向任务栏按钮或 Dock 图标。
- **最小尺寸**：每个应用声明 `minWidth` / `minHeight`，缩到布局极限会停住；
  尺寸变化会触发重绘（计算器就是靠这个在基础/科学模式间切换）。
- **任务栏 / Dock**：固定应用可右键添加、拖动排序；同应用多窗口合并为一个按钮
  并显示数量，点击循环切换，悬停弹出预览列表，预览里也能新建窗口。
- **窗口切换器**：`Alt + Tab` 按住浏览、松开切到目标，带预览卡片。
- **桌面即文件系统**：`~/Desktop` 下的文件就是桌面图标，`.desktop` 是快捷方式；
  图标可拖到任意位置，坐标写入 `~/.config/desktop-layout.json`，右键"整理图标"复位；
  网格吸附是个开关，关掉就能随便放。
- **托盘与系统状态**：电量走 `navigator.getBattery()`，音量是可调的系统音量
  （影响通知提示音），托盘面板里直接调。
- **壁纸**：8 套深色壁纸各带浅色版本，也可上传本地图片做自定义壁纸；
  8 种强调色、3 档桌面图标尺寸、3 档字号。
- **通知系统**：右下角堆叠、自动消失、可在托盘里重新唤起。
- **多语言**：English / 简体中文，词条集中在 `src/i18n`，设置面板一键切换；
  语言包本身也写进 VFS，可以用 `/usr/share/i18n` 里的 JSON 改。

### 文件系统

- `VirtualFS` 以内存 `Map<path, FsNode>` 为唯一真相：读同步、写进待写队列，
  40 ms 批量刷进 IndexedDB。刷新页面文件还在。
- 预置 `/etc`、`/home/user/Documents`、`/usr/share`，附带示例 `.osl` / `.oml`。
- `onChange(cb)` 订阅，文件管理器与编辑器据此自动刷新。
- Settings → Storage → Reset 恢复出厂：清 IndexedDB 并重新种入示例文件。

### 终端

- 管道 `|`、重定向 `>` `>>` `<`、`&&` `||` `;`、`$VAR` / `${VAR}` / `~` / `$?` 展开。
- `Ctrl + C` 中断、`↑ ↓` 历史（持久化）、`Tab` 补全命令名与路径、ANSI SGR 配色。
- **78 条内建命令**：

  ```
  help pwd cd ls tree find grep cat head tail wc stat file du df mkdir rmdir
  rm touch cp mv chmod echo sort uniq rev nl cut tee base64 clear cls date cal
  whoami hostname uname ver sw_vers uptime env export unset history which where
  man ps kill seq yes sleep true false sudo exit theme open edit apps notify
  pbcopy pbpaste say osl run dir type copy move del md rd fortune cowsay
  fastfetch neofetch screenfetch
  ```

- `osl <file>` 直接解释执行脚本（`run` 是别名），`open <app>` 启动应用。

### 其他

- **应用注册表**：`/etc/apps.json` 保存应用列表与元数据（名称、图标、窗口尺寸、
  是否隐藏），每个应用目录里还有 `app.json`。改完调 `sys.reloadApps()` 生效。
- **运行窗口**：`Alt + F2`、开始菜单或桌面右键都能打开，按中英文应用名或路径启动，
  带过滤建议，回车运行、Esc 关闭。
- **系统源码全在文件管理器里**：外壳 `/usr/share/os/`，应用 `/usr/share/apps/<id>/`，
  Markdown 库 `/usr/share/os/lib/markdown.osl`，语言包 `/usr/share/i18n/`，
  启动项 `/usr/share/applications/`，图标 `/usr/share/icons/*.svg`
  （SVG 可以直接在图片查看器里打开）。
- **升级不冲掉你的修改**：内核把系统文件装进 VFS，并在 `/etc/system-manifest.json`
  记录内容哈希。启动时哈希仍匹配（说明没动过）就用新 bundle 覆盖，不匹配就保留原样。
  想恢复出厂版本，删掉对应文件再刷新。
- **模块化 OSL**：`import "lib/x.osl" as x` / `from "lib/x.osl" import y`。

---

## 内置应用

17 个应用，每个都是一对 `.oml` + `.osl`，可在文件管理器里直接打开改。

| 应用 | 说明 |
| --- | --- |
| **Files** | 文件管理器，侧栏直达系统源码、图标、文档；支持新建 / 重命名 / 删除 |
| **Terminal** | 上面那套 shell |
| **Editor** | 纯文本编辑器，`Ctrl + S` 保存，带文件选择器 |
| **IDE** | 编辑器 + 语法高亮 + 运行输出面板，可跑 OSL 脚本 |
| **Notes** | Markdown 便签，与 Preview、Docs 共用同一个渲染器 |
| **Tasks** | 待办清单 |
| **Calendar** | 月历视图 |
| **Clock** | 计时器 / 秒表 |
| **Preview** | Markdown / 文本预览（由其他应用调起，默认不进启动器） |
| **Image Viewer** | 看图片和 SVG，系统图标目录里的 SVG 直接用它打开 |
| **Language Docs** | OSL / OML 完整参考：左侧章节目录、顶部跨章节搜索、中英双语切换 |
| **Monitor** | 运行状态面板 |
| **Logs** | 系统日志 |
| **Settings** | 主题、外观风格、强调色、壁纸、语言、字体、桌面网格、任务栏位置、通知、音量、存储重置 |
| **Calculator** | 窗口变宽自动切到科学模式 |
| **About** | 版本与致谢 |
| **Run** | 快速启动器（隐藏应用） |

**模板应用**：`/usr/share/apps/hello` 是最小可跑应用（输入框、计数器、日志）。
复制改名 → 在 `/etc/apps.json` 加一条 → `sys.reloadApps()`，就出现在开始菜单里。

---

## OSL 速览

缩进敏感（4 空格或 Tab），`#` 注释，语句不写分号。

```osl
let name = "origin"
let count = 0
count += 1
let ok = True and not False
let text = f"{name} has {count} file"
```

运算符：`+ - * / % **`、`== != < <= > >=`、`and or not`（也可 `&& || !`）、
`in` / `not in`、`is` / `is not`、两种三元 `a if cond else b` 与 `cond ? a : b`、
索引与切片 `lst[1:3]`。

```osl
fn greet(who, punct = "!"):
    return "hello " + who + punct

fn counter():
    let n = 0
    return fn():          # 匿名函数，也可写 x => x * 2
        n += 1
        return n

class Point:
    fn init(x, y):        # 构造函数，self 自动注入
        self.x = x
        self.y = y

    fn length():
        return math.sqrt(self.x * self.x + self.y * self.y)

try:
    raise "disk full"
except e:
    print("caught: " + e)
finally:
    print("done")

for key, value in {"a": 1, "b": 2}:
    print(key + "=" + str(value))
```

**全局函数**：`print len range str int float bool type sum min max abs round sorted
reversed enumerate zip map filter any all chr ord eval sleep every notify open
uuid refresh`

**标准库**

| 命名空间 | 方法 |
| --- | --- |
| `fs` | `read write append list mkdir remove rename copy exists isDir stat size count cwd home normalize sizeText readJson writeJson touch` |
| `paths` | `join dirname basename extname normalize split home relative` |
| `sys` | `open openPath apps windows focusWindow minimizeWindow closeWindow notify settings setSetting version uptime user hostname touchRecent recent platform arch info factoryReset notifications dismissNotification minimizeAll lock power` |
| `ui` | `refresh alert confirm prompt toast menu` |
| `win` | `setTitle close minimize maximize restore toggleMax setSize isMaximized id` |
| `time` | `now format date year`（占位符 `YYYY YY MMMM MMM MM DD dd d dddd ddd HH hh mm ss A`） |
| `math` | `pi e floor ceil round abs sqrt pow min max random randint sign` |
| `json` | `parse stringify` |
| `store` | `get set remove`（localStorage） |
| `clip` | `read write` |
| `console` | `log warn error`（写入终端） |

---

## OML 速览

XML 方言，标签即组件，属性即参数；`{...}` 里是 OSL 表达式，每次刷新重新求值。

```xml
<Window title="Demo" icon="app-about">
  <VBox class="demo" gap="10" pad="16">
    <Title text="Hello, OML"/>
    <Label text="You have clicked {count} times"/>
    <HBox gap="8">
      <Button icon="plus" text="Add" onclick="count += 1" variant="primary"/>
      <Button text="Reset" onclick="reset()"/>
    </HBox>
    <Divider/>
    <For each="items" as="item" index="i">
      <HBox class="row" onclick="pick(i)">
        <Icon name="{item.icon}" size="18"/>
        <Label text="{item.name}" flex="1"/>
      </HBox>
    </For>
  </VBox>
</Window>
```

| 分组 | 标签 |
| --- | --- |
| 布局 | `VBox` `HBox` `Grid` `Stack` `Center` `Scroll` `Spacer` `Div` |
| 容器 | `Card` `Window` `Modal` `Toolbar` `StatusBar` `List` |
| 文本 | `Label` `Title` `Subtitle` `Muted` `Kbd` `Badge` |
| 控件 | `Button` `IconButton` `Icon` `Input` `TextArea` `Select` `Checkbox` `Switch` `Slider` `Progress` |
| 逻辑 | `For` |
| 专用 | `TerminalView` |

**关键属性**

| 属性 | 说明 |
| --- | --- |
| `text` / `title` | 文本，支持 `{表达式}` 插值 |
| `icon` / `name` | 图标名，对应 `assets/icons/*.svg` |
| `class` / `style` / `variant` | 样式（`primary` `danger` `ghost`） |
| `if` / `visible` | 条件显示 |
| `<For each as index>` | 列表渲染，按数据签名增量重建 |
| `onclick` `oninput` `onchange` `onkeydown` `ondblclick` `oncontextmenu` … | 事件；`event` 提供 `key value checked x y shift ctrl meta alt prevent stop target` |
| `bind` | 双向绑定，配合 `Input` / `TextArea` / `Switch` / `Slider` / `Select` |
| `flex` `gap` `pad` `px` `py` `cols` `rows` `align` `justify` `wrap` `width` `height` `minw` `maxw` `minh` `maxh` `radius` `bg` `overflow` `z` | 布局 |

**刷新模型**：任何事件先跑 OSL 处理函数，然后在 `requestAnimationFrame` 里做一次
全量刷新，所有 `{}` 重新求值；`For` 只在数据签名变化时重建 DOM。简单、可预测。

---

## 快捷键

| 快捷键 | 动作 |
| --- | --- |
| `Alt + Tab` / `Alt + Shift + Tab` | 窗口切换器（按住浏览，松开切换） |
| `Alt + F4` / `Ctrl + W` | 关闭当前窗口 |
| `Alt + F2` | 运行窗口 |
| `Ctrl + Space` | 开始菜单 / Spotlight |
| `Ctrl + Alt + T` | 新终端 |
| `Ctrl + Alt + I` | 打开 IDE |
| `Ctrl + S` | 编辑器保存 |
| `Ctrl + L` | 文件管理器编辑路径；终端清屏 |
| `Esc` | 关闭菜单 / 对话框 |

---

## 目录结构

```
src/
  osl/            OSL 语言实现
    lexer.ts        缩进敏感分词（INDENT / DEDENT）
    parser.ts       递归下降 → AST
    interp.ts       树遍历解释器（作用域、闭包、类、异常、切片）
    builtins.ts     fs / paths / sys / ui / win / time / math / json / store / clip
    host.ts         宿主能力接口
  oml/            OML 实现
    parser.ts       XML 方言解析（属性、自闭合、注释、实体）
    widgets.ts      标签 → DOM 组件 + 布局属性
    renderer.ts     UiInstance：挂载、绑定、For、全量刷新
    overlay.ts      对话框与右键菜单（本身也是 OML）
  core/
    fs.ts           VirtualFS（内存 Map + IndexedDB 镜像）
    wm.ts           OWM 窗口管理器（含最小化动画目标解析）
    kernel.ts       内核：启动 shell、托管应用、通知、快捷键
    settings.ts     主题 / 壁纸 / 强调色 / 用户
    manifest.ts     系统文件哈希清单（升级不冲掉本地修改）
  system/         shell.oml / shell.osl / dialog.oml / menu.oml
  apps/<app>/     17 对 .oml + .osl
  i18n/           语言包（英文原文为键，中文词条在 zh.json）
  shell/          commands.ts（78 条命令）+ terminal.ts（解析、作业控制、ANSI → HTML）
  styles/         base / shell / apps / terminal
  assets/icons/   82 个内联 SVG
docs/             语言与应用文档、截图
```

## 启动链路

```
main.ts
  ├─ SettingsStore.load()       读 localStorage
  ├─ Vfs.init()                 挂 IndexedDB，种下初始目录树
  ├─ Kernel.boot()
  │    ├─ Interpreter 跑 shell.osl   → tickClock / launch / menuItems…
  │    ├─ UiInstance 挂 shell.oml    → 生成桌面 DOM
  │    └─ installShortcuts()          → Alt+Tab / Alt+F4 / Ctrl+Alt+T…
  └─ 首次运行打开 welcome.md 并弹通知
```

`Kernel.open(appId)` 为每个窗口新建一套 `Interpreter` + `UiInstance`，
所以两个编辑器窗口的 `path`、`text` 变量互不干扰。

---

## 定制

**给应用换图标**：把 `my-icon.svg` 丢进 `/usr/share/icons/`，在 `/etc/apps.json`
或 `/usr/share/apps/<id>/app.json` 里把 `icon` 改成 `my-icon`，
调 `sys.reloadApps()` 或刷新页面。`/usr/share/icons` 优先于内置图标；
内置图标归系统所有、升级时会被刷新，自定义请用新文件名。

**加一个应用**：复制 `/usr/share/apps/hello` → 改名 → 写 `.oml` / `.osl` →
在 `/etc/apps.json` 里加一条 → `sys.reloadApps()`。

**改语言包**：编辑 `/usr/share/i18n/zh.json`（OSL 里 `json.parse(fs.read(...))`
读、改完 `i18n.reload()`），或直接改 `src/i18n/zh.json` 后重新构建。

---

## 设计取舍

- **每个窗口一个解释器**：变量天然隔离，`window.OS.kernel.instances` 里每个窗口
  持有自己的 `Interpreter` 与 `UiInstance`。
- **全量刷新而不是依赖追踪**：玩具系统的数据量小，"改一个变量 → 界面更新"的心智
  模型最简单；`For` 用序列化签名避免每帧重建 DOM。
- **图标内联 SVG**：每个图标用 `namespaceIds()` 给渐变 id 加唯一后缀，同一页面
  重复出现同一图标也不会互相覆盖（早期"桌面图标空白"的根因）。
- **VFS 同步内存 + 异步镜像**：OSL 是同步语言，读路径必须同步；写路径批量落盘，
  兼顾简单与持久化。
- **系统源码装进 VFS + 哈希清单**：让"操作系统"真的能被打开、修改、恢复，
  同时升级不会覆盖用户改过的文件。

---

## 已知边界

- 没有真实进程调度：`every(ms, fn)` 基于 `setInterval`，`sleep` 会阻塞该窗口的解释器。
- 解释器有步数上限与递归深度保护，死循环会报 `Execution limit reached` 而不是冻结页面。
- 终端没有备用屏幕缓冲，`vim` 一类全屏 TUI 跑不了。
- 只有 English / 简体中文两套语言包。

---

## 文档

完整语言参考（执行模型、语法、闭包与类、错误、模块、标准库、OML 组件与绑定、
应用实现说明）见 **[docs/](docs/README.md)**。系统内也有同样内容的
**Language Docs** 应用，可以直接在桌面里查。

## License

[MIT](LICENSE) © 2026 Cyberexplorer
