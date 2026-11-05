# OSL 标准库

所有命名空间都是全局对象，直接使用，不需要 import。

## 全局函数

| 函数 | 说明 |
| --- | --- |
| `print(...)` | 输出到控制台；应用里同时写入开发者控制台 |
| `len(v)` | 字符串/列表/字典/宿主对象的长度 |
| `range(a[, b[, step]])` | 数字序列，返回列表 |
| `str(v)` `int(v)` `float(v)` `bool(v)` | 类型转换 |
| `type(v)` | 类型名，如 `"int"` `"dict"` `"function"` |
| `sum` `min` `max` `abs` `round` | 数值工具（`min`/`max` 接受多个参数或一个列表） |
| `sorted(list[, key])` `reversed(list)` | 返回新列表 |
| `enumerate(list)` | `[[0, v0], [1, v1], …]` |
| `zip(a, b, …)` | 按最短长度配对 |
| `map(fn, list)` `filter(fn, list)` | 函数式工具 |
| `any(list)` `all(list)` | 真值判断 |
| `chr(n)` `ord(s)` | 字符与码点 |
| `eval(src)` | 在**全局作用域**求值一段表达式字符串 |
| `sleep(ms)` | 空实现（主线程不可阻塞），保留是为了兼容旧脚本 |
| `every(ms, fn)` | 定时执行，窗口关闭时自动清理 |
| `after(ms, fn)` | 一次性延迟执行（不随窗口关闭清理） |
| `notify(title, body[, icon])` | 弹出系统通知 |
| `open(path)` | 打开文件（等同 `sys.openPath`） |
| `uuid()` | 随机 id |
| `refresh()` | 请求重绘当前界面 |
| `t(key, ...args)` | 语言包查找，见 `oml/05-i18n.md` |
| `lang()` | 当前界面语言，`"en"` 或 `"zh"` |
| `args` | 应用启动参数（字典，`args.get("path")`） |

### 错误构造器

`Error(msg)` `TypeError(msg)` `ValueError(msg)` `RangeError(msg)`
返回错误对象，配合 `raise` 使用。

## fs — 文件系统

| 方法 | 说明 |
| --- | --- |
| `read(path)` `write(path, text)` `append(path, text)` | 文本读写 |
| `list(path)` | 目录项，每项含 `name path type size mtime ctime ext mode` |
| `mkdir` `remove` `rename(from, to)` `copy(from, to)` | 结构操作 |
| `exists` `isDir` `stat` | 查询 |
| `size(path)` `count(path)` `sizeText(bytes)` | 容量统计 |
| `cwd()` `home()` `normalize(path)` | 路径环境 |
| `readJson` `writeJson` | 与字典互转 |
| `search(root, query[, limit])` | 递归按文件名搜索，返回文件节点列表 |
| `touch(path)` | 创建空文件或刷新 mtime |

`fs.write` 会自动创建父目录；`fs.remove` 递归删除。

## paths — 路径工具

`join` `dirname` `basename` `extname` `normalize` `split` `home` `relative`

`relative("/home/user/a")` 返回 `"~/a"`。

## sys — 系统调用

| 方法 | 说明 |
| --- | --- |
| `open(appId[, args])` | 启动应用，`args` 是字典 |
| `openPath(path)` | 按路径打开（目录 → 文件管理器，`.desktop` → 启动应用） |
| `apps()` | 已安装应用列表（`id name icon`，名称已本地化） |
| `windows()` | 窗口列表（`id appId title icon minimized active maximized`） |
| `focusWindow(id)` `minimizeWindow(id)` `closeWindow(id)` `minimizeAll()` | 窗口控制 |
| `notify(title, body[, icon])` | 通知 |
| `notifications()` `dismissNotification(id)` | 通知管理 |
| `settings()` `setSetting(key, value)` | 读写系统设置 |
| `version()` `uptime()` `info()` `user()` `hostname()` | 系统信息 |
| `recent()` `touchRecent(path)` | 最近文件 |
| `lock()` `power(mode)` `factoryReset()` | 电源与重置 |
| `platform()` `arch()` | 平台描述 |
| `battery()` | 真实电量：`{ supported, level, charging, chargingTime, dischargingTime }` |
| `network()` | 是否在线（`navigator.onLine`） |
| `volume()` `setVolume(n)` `toggleMute()` | 系统音量 0–100 |
| `viewport()` | 工作区尺寸 `{ width, height }` |
| `reloadApps()` | 重新读取 `/etc/apps.json` 并刷新界面 |
| `runScript(source[, path])` | 隔离解释器运行 OSL，返回 `{ ok, output, error }` |
| `log(level, message)` | 写入系统日志（level：`info` `app` `notice` `error` `system`） |
| `logs([limit])` | 读取日志，返回 `{ id, time, level, message }` 列表 |
| `clearLogs()` | 清空日志环形缓冲 |
| `metrics()` | 快照：`windows apps files bytes logs uptime` |

## ui — 界面交互

| 方法 | 说明 |
| --- | --- |
| `refresh()` | 同全局 `refresh()` |
| `alert(message[, title])` | 提示框 |
| `confirm(message, onOk[, title])` | 确认框，确定后调用回调 |
| `prompt(title, value, onOk)` | 输入框 |
| `toast(message[, icon])` | 通知气泡 |
| `menu(items, onPick[, x, y])` | 右键菜单。`items` 是字典列表，字段：`label icon id sep danger kbd` |
| `chooseImage(onPick)` | 原生图片选择器，`onPick(dataUrl)` 收到图片的 data URL |

菜单回调收到的是**同一个字典**，可以用 `it.get("id")` 判断选项。

## win — 当前窗口

`setTitle(title)` `close()` `minimize()` `maximize()` `restore()`
`toggleMax()` `setSize(w, h)` `move(x, y)` `center()`
`toggleFullscreen()` `isFullscreen()`
`isMaximized()` `id()`

## time — 时间

| 方法 | 说明 |
| --- | --- |
| `now()` | 毫秒时间戳 |
| `format(ts, fmt)` | 自定义格式化 |
| `parts(ts)` | 字典：`year month day weekday hours minutes seconds daysInMonth timestamp` |
| `make(year, month, day[, h, m])` | 由日历字段构造时间戳，月份从 1 开始 |
| `intl(ts, style)` | 按当前语言格式化。style：`month` `monthYear` `weekday` `weekdayShort` `date` `time` `full` |
| `startOfDay(ts)` `addDays(ts, n)` | 日期运算 |
| `date()` `year()` | 快速取值 |

格式化占位符：`YYYY YY MMMM MMM MM DD dd d dddd ddd HH hh mm ss A`。

## math

`pi` `e` `floor` `ceil` `round(n[, digits])` `abs` `sqrt` `pow` `min` `max`
`random()` `randint(a, b)` `sign`

## json

`parse(text)` → 字典/列表；`stringify(value[, pretty])` → 文本。`JSON` 是同一个
命名空间的别名，两种写法都可以。

```osl
let cfg = json.parse(fs.read("/usr/share/i18n/zh.json"))
print(cfg.get("Files"))
fs.write("/tmp/copy.json", JSON.stringify(cfg, True))
```

## i18n

| 方法 | 说明 |
| --- | --- |
| `catalog([lang])` | 读取语言包并解析成字典（默认当前语言） |
| `reload()` | 重新读取 `/usr/share/i18n/*.json` 并重绘所有窗口 |
| `langs()` | 支持的语言码列表 |

## store / clip / console

- `store.get(key[, default])` `store.set(key, value)` `store.remove(key)`：localStorage。
- `clip.read()` `clip.write(text)`：剪贴板。
- `console.log/warn/error(...)`：写入终端输出。

## 容器方法

**列表**：`append` `push` `extend` `pop` `shift` `insert` `remove` `index`
`count` `sort([fn])` `reverse` `clear` `join` `slice` `map` `filter` `find`
`each` `sum` `first` `last` `contains` `clone` `keys`

**字典**：`get(k[, default])` `set(k, v)` `has` `remove` `keys` `values`
`items` `entries` `merge` `clear` `size` `clone` `each`

**字符串**：`upper` `lower` `strip` `lstrip` `rstrip` `split`
`replace` `startswith` `endswith` `find` `contains` `count` `repeat`
`capitalize` `title` `slice` `join` `format` `padStart` `padEnd`

```osl
print("a,b,c".split(","))            # ["a", "b", "c"]
print([3, 1, 2].sort())              # 原地排序，返回 None
print({"a": 1}.keys())               # ["a"]
```

> 字典的键与内置方法同名时（例如键叫 `keys`），方法优先；此时请用
> `d["keys"]` 取键值。
