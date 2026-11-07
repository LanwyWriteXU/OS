# OSL — 脚本语言

OSL（Origin Software Language）是这套桌面自己使用的语言。外壳、每个内置应用
和你写的脚本都跑在同一个解释器上：一门缩进式、动态类型、语法像 Python、
库像 JavaScript 的小语言。

OSL 文件就是纯文本。你可以在文件管理器里新建、用 IDE 打开并按 Run（或 F5），
也可以在其他脚本里用 sys.runScript 执行它。

## 1. 第一个程序

```osl
# hello.osl
let name = "world"
print("hello, " + name + "!")
```

print 写到开发控制台（Logs 应用能看到 sys.log，IDE 的 OUTPUT 面板显示 print 输出）。
字符串也可以直接插值：

```osl
let n = 3
print(f"{n} squared is {n * n}")
```

## 2. 基本语法

- 注释用 #，到行尾结束。
- 代码块以冒号开头，用空格缩进。请统一用 4 个空格 —— 缩进就是语法。
- 一行一条语句；行尾写 ; 可以，但没必要。
- 名字由字母、数字和 _ 组成，不能以数字开头。
- 关键字：let var const fn class if elif else while for in return break
  continue pass and or not True False None try catch except finally raise
  import from as self is do

```osl
fn area(w, h):
    if w <= 0 or h <= 0:
        return 0
    return w * h
```

## 3. 值与类型

- int —— 42、-7、0
- float —— 3.14、1.0e9
- str —— "文本"、'文本'
- bool —— True / False
- None —— 表示「没有值」
- list —— [1, 2, 3]
- dict —— {"name": "Ada", "age": 36}
- function —— fn(x): ... 或者 x => x * 2
- object —— 类的实例

type(v) 返回上面这些名字之一（"int"、"float"、"str"、"bool"、"None"、
"list"、"dict"、"function"、"class"、"error"，或者具体类名）。

真假判断：None、False、0、"" 以及空列表/空字典为假，其余为真。

## 4. 变量

```osl
let count = 0        # 声明或覆盖
var total = 0        # 与 let 相同
const LIMIT = 10     # 不能再赋值（赋值会报错）
```

变量的作用域是「所在的函数」（顶层就是整个脚本）。if / while / for 的主体共享
这个作用域，所以在分支里 let 的变量出了分支依然可见；循环变量也定义在同一作用域。

```osl
if ready:
    let label = "go"
print(label)         # 可以访问：同一个作用域
```

复合赋值：= += -= *= /= %= **=

## 5. 运算符

算术：+ - * / // % **

- / 永远得到浮点数（7 / 2 是 3.5）
- // 是整除，% 取余，** 是幂（右结合）

| 表达式 | 结果 | 说明 |
| :--- | ---: | :--- |
| 7 / 2 | 3.5 | 浮点除法 |
| 7 // 2 | 3 | 整除 |
| 7 % 2 | 1 | 取余 |
| 2 ** 10 | 1024 | 幂 |
| "a" + "b" | ab | 字符串拼接 |
| [1] + [2] | [1, 2] | 列表合并 |

比较：== != < <= > >=
逻辑：and or not（也可以写 && || !）
成员：x in list、"a" in "abc"、key in dict
同一性：a is b（比较是否是同一个对象）

条件表达式，两种写法等价：

```osl
let label = "big" if n > 100 else "small"
let same = n > 100 ? "big" : "small"
```

+ 可以拼接字符串、合并列表，但不会自动转换数字，需要 str(n)。

## 6. 字符串

```osl
let a = "plain"
let b = '单引号也可以'
let c = "转义：\n \t \\ \" "
let d = """三引号会保留
换行"""
let e = f"{a} 有 {len(a)} 个字符"
```

f 字符串会计算花括号里的每个表达式。

方法（都返回新值，不修改原字符串）：

- upper() / lower() —— 大小写
- strip() / lstrip() / rstrip() —— 去掉空白
- split(sep) / join(list) —— "a,b".split(",") 与 ",".join(list)
- replace(a, b) —— 替换全部匹配
- startswith(p) / endswith(p) / contains(p) / find(p, from?)
- count(p) / repeat(n) / capitalize() / title()
- slice(start, end) / charAt(i) / padStart(n, c) / padEnd(n, c)
- format(a, b) —— 依次替换 {} 占位符："{} + {}".format(1, 2)

下标与切片：

```osl
let s = "origin"
s[0]        # "o"
s[-1]       # "n"   负数从末尾算
s[0:3]      # "ori"
s[:3]       # 同上
s[3:]       # "gin"
```

字符串不可变：s[0] = "O" 会报错，请构造新字符串。

## 7. 列表

```osl
let xs = [1, 2, 3]
xs.append(4)          # 原地追加
xs.insert(0, 0)
xs.pop()              # 弹出并返回最后一项
xs.remove(2)          # 删除第一个匹配项
xs[1] = 9
len(xs)
xs[1:3]               # 切片，返回新列表
```

方法：append / push / extend / pop / shift / insert / remove / index /
count / sort / reverse / clear / join / slice / map / filter / find / each /
sum / first / last

```osl
let names = ["ada", "linus"]
let upper = map(x => x.upper(), names)
let long = filter(x => len(x) > 3, names)
let total = sum([1, 2, 3])
```

## 8. 字典

字典字面量用花括号，保持插入顺序。

```osl
let user = {"name": "Ada", "age": 36}
user.get("name")        # "Ada"
user.get("mail", "—")   # 取不到时的默认值
user.set("age", 37)
user.has("age")
user.keys()             # ["name", "age"]
user.values()
user.items()            # [["name", "Ada"], ["age", 37]]
user.remove("age")
len(user)
```

键是普通标识符时也可以写成 user.name；键可能不存在时请用 get() —— 点号访问
取不到会返回 null。

用 for k, v in user: 遍历键值对。

## 9. 流程控制

```osl
if score > 90:
    grade = "A"
elif score > 75:
    grade = "B"
else:
    grade = "C"

while tries < 3:
    tries += 1
    if skip:
        continue
    if done:
        break

for item in items:
    print(item)

for key, value in user:
    print(key + " = " + str(value))

for i in range(0, 10, 2):
    print(i)
```

pass 是空语句，用来占位。

## 10. 函数

```osl
fn greet(name, greeting = "hello"):
    return greeting + ", " + name

fn noop():
    pass
```

- 默认参数在调用时求值，调用方可以省略。
- 没有 return 的函数返回 None；只写 return 也返回 None。
- 函数是值：可以传给 map/filter，也可以放进字典。
- 支持递归。
- 匿名函数：x => x * 2、fn(x) => x * 2，或者用缩进块 fn(x): ...
- 函数会记住定义它的作用域（闭包）。

```osl
let counter = fn():
    let n = 0
    return fn():
        n += 1
        return n
```

## 11. 类

```osl
class Shape:
    fn init(name):
        self.name = name

    fn area():
        return 0

    fn describe():
        return self.name + ": " + str(self.area())

class Square extends Shape:
    fn init(side):
        self.side = side

    fn area():
        return self.side * self.side

let sq = Square(4)
print(sq.describe())   # Square: 16
```

方法会自动收到实例 self，不需要手动传。init 是构造函数。extends 指定父类，
子类没定义的方法会回落到父类。

## 12. 错误

```osl
try:
    let data = json.parse(text)
except e:
    print("bad json: " + e.message)
finally:
    busy = False
```

raise ValueError("count must be positive") 抛出错误；catch 与 except 是同一个
意思。捕获到的值有 .message、.type、.line。

内置错误构造器：Error、TypeError、ValueError、RangeError。

raise 只能抛错误，值一律被字符串化。要把一个值原样送到 catch，用 throw：

```osl
try:
    throw {"kind": "ret", "value": 42}
except e:
    print(e.kind)    # ret
    print(e.value)   # 42
```

throw 同样会执行 finally、会穿透函数调用；没被捕获时报「未捕获的 throw」。

## 13. 模块

把代码拆到多个文件，用路径导入。路径是虚拟文件系统路径，相对路径相对于
导入方所在目录。

```osl
# /home/user/Projects/lib/mathx.osl
export fn double(n):
    return n * 2

export let NAME = "mathx"

# /home/user/Projects/app.osl
import "lib/mathx.osl" as mathx
from "lib/mathx.osl" import double, NAME as LIB
print(mathx.double(2), double(4), LIB)
```

所有顶层绑定都可以被导入；export 只是显式标记，写不写都能导入。

系统自带一个共享库：/usr/share/os/lib/markdown.osl。便签、预览和语言文档都导入它
把 Markdown 变成块列表：

```osl
import "/usr/share/os/lib/markdown.osl" as md
let blocks = md.parse(text)
```

## 14. 标准库

全局函数：

- len(v) —— 字符串、列表、字典或对象的长度
- range(a, b?, step?) —— 数字列表
- str(v) / int(v) / float(v) / bool(v) / type(v)
- sum / min / max / abs / round(n, digits?)
- sorted(list, keyFn?) / reversed(list)
- enumerate(list) —— [[0, x], [1, y], ...]
- zip(a, b, ...) —— 成对组合
- map(fn, list) / filter(fn, list) / any(list) / all(list)
- chr(n) / ord(s)
- eval(src) —— 计算一段 OSL 表达式字符串并返回结果
- uuid() —— 随机 id
- print(...) —— 控制台输出
- notify(title, body, icon?) —— 桌面通知
- open(path) —— 用默认应用打开文件或目录
- every(ms, fn) —— 每隔一段时间重复执行，立即返回
- after(ms, fn) —— 过一段时间执行一次
- sleep(ms) —— 为了兼容保留，实际什么都不做
- t(key, ...) —— 翻译消息 id；t("{0} items", n)
- lang() —— 当前界面语言（"en" 或 "zh"）
- refresh() —— 重绘当前窗口
- args —— sys.open 传进来的启动参数（Map）

命名空间（每个都是带方法的对象）：

fs —— read write append list mkdir remove rename copy exists isDir stat size
count sizeText readJson writeJson touch search home cwd normalize

paths —— join dirname basename extname normalize split home relative

sys —— open openPath apps windows focusWindow minimizeWindow closeWindow
notify settings setSetting viewport metrics info version uptime user hostname
battery network storage volume setVolume toggleMute lock power factoryReset
recent touchRecent runScript log logs clearLogs reloadApps

ui —— alert confirm prompt toast menu chooseImage refresh

win —— setTitle close minimize maximize restore toggleMax setSize move center
toggleFullscreen isFullscreen isMaximized size width height id

time —— now format date year parts make intl startOfDay addDays

math —— pi e floor ceil round abs sqrt pow min max random randint sign sin cos
tan asin acos atan log log10 exp fact

json —— parse stringify

i18n —— reload catalog langs

store —— get set remove（基于 localStorage，刷新后还在）

clip —— read write（文本剪贴板）

console —— log warn error（都走 print）

## 15. 常用写法

读写文件：

```osl
if fs.exists("/home/user/Notes/todo.md"):
    let text = fs.read("/home/user/Notes/todo.md")
fs.write("/home/user/Notes/todo.md", text + "\n- new item")
```

用 JSON 存状态：

```osl
let state = fs.exists(path) ? fs.readJson(path) : {"count": 0}
state.set("count", state.get("count") + 1)
fs.writeJson(path, state)
```

定时器：

```osl
let ticks = 0
every(1000, fn():
    ticks += 1
    refresh()
)
after(2000, fn(): ui.toast("两秒过去了"))
```

对话框与菜单：

```osl
ui.confirm("Delete everything?", doDelete, "Delete")
ui.prompt("Your name", "Ada", saveName)
ui.menu([{"label": "Open", "id": "open"}, {"sep": True},
         {"label": "Delete", "id": "del", "danger": True}], onPick, 100, 100)
ui.toast("Saved", "save")
```

打开别的窗口：

```osl
sys.open("notes", {"path": "/home/user/Documents/welcome.md"})
sys.open("files", {"path": "/home/user/Pictures"})
```

## 16. 容易踩的坑

- 缩进是语法。tab 和空格混用会直接打断代码块。
- 没有块级作用域：if 里 let 的变量出了 if 依然存在。
- 字符串不会自动转换：1 + "1" 会报错，请写 str(1) + "1"。
- 不要空转等待。sleep() 什么都不做，请改用 after() 和 every()。
- 字典的点号取值在键不存在时返回 null，需要默认值就用 get()。
- 长时间循环会卡住整个桌面 —— 解释器是单线程的。
- 应用脚本在窗口打开时只运行一次；状态保存在变量里，关窗即消失。
