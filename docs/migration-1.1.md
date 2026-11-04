# 从 1.0 升级到 1.1

1.1 修掉了一批语言层面的设计缺陷。多数脚本无需改动，但下面几条属于行为变化，
升级时请对照检查。

## 破坏性变化

### 1. `=` 不再隐式创建变量

```osl
# 1.0：合法，悄悄创建全局变量
# 1.1：抛 Name 'x' is not defined
x = 1

# 正确写法
let x = 1
x = 2
```

影响：任何“第一次赋值即声明”的写法。典型场景是函数里忘了 `let`：

```osl
fn f():
    counter = 0      # 1.1 会报错，请改成 let counter = 0
```

### 2. `const` 真正不可变

```osl
const LIMIT = 10
LIMIT = 20           # 1.1：Cannot assign to constant 'LIMIT'
```

### 3. `except e:` 绑定错误对象而不是字符串

```osl
except e:
    print("caught: " + e)   # 仍然可用，e 会字符串化为 message
    print(e.type)           # 新增：错误类型
    print(e.message)        # 新增
```

依赖 `e` 是字符串的代码（例如直接 `len(e)`）需要改成 `len(e.message)`。

### 4. `None + 数字` 会抛错

```osl
let total = None
total + 1            # 1.0 返回 None，1.1 抛 Cannot add None to a number
```

请显式给初值：`let total = 0`。

### 5. `if` 是真正的挂载/卸载

```xml
<Panel if="{open}">…</Panel>
```

条件为假时子树从 DOM 移除，其内部状态（输入内容、滚动位置）会丢失。
需要保留状态请改用 `visible="{open}"`。

### 6. 桌面图标来自文件系统

1.0 的桌面图标由 `shell.osl` 里写死的应用列表生成；1.1 改为读取
`/home/user/Desktop`：

- 每一项是一个真实文件或目录；
- `*.desktop` 文件是快捷方式，内容为应用 id（例如 `terminal`）；
- 右键可以新建快捷方式、重命名、复制、删除。

旧版本写入的 `deskApps` 变量已不存在，自定义过桌面逻辑的脚本需要迁移到
`deskIcons`。

### 7. 右键菜单回调收到的是字典

1.0 的 `ui.menu` 在宿主侧重建菜单项时丢掉了 `id` 字段，导致
`it.get("id")` 永远报错，菜单项点击无反应。1.1 保留全部字段，并把菜单项作为
OSL 字典传递：

```osl
fn pick(it):
    let id = it.get("id")     # 现在可用
```

## 新增能力（不破坏兼容）

| 能力 | 说明 |
| --- | --- |
| `import` / `from ... import` | 多文件模块，见 `osl/05-modules.md` |
| 小写字面量 | `true` `false` `nil` `null` 与 `True` `False` `None` 等价 |
| 块体匿名函数 | `fn(a):` 加缩进，返回函数 |
| `class A extends B` | 继承真正生效（此前语法被解析后丢弃） |
| 错误栈 | 未捕获异常附带调用栈帧 |
| `<For key="…">` | 列表增量更新，保留行内焦点与滚动 |
| 多语言 | `t()` / 自动翻译 / 设置项 `lang` |
| `time.parts` `time.make` `time.intl` | 日历与本地化时间 |
| 新应用 | Notes、Calendar、Monitor |

## 自检清单

1. 搜索 `osl` 目录下所有“未声明就赋值”的变量。
2. 搜索依赖 `except e` 为字符串的代码。
3. 检查所有 `if` 条件面板是否真的希望卸载（否则改 `visible`）。
4. 如果自定义过桌面，迁移到 `deskIcons`。
5. 跑一遍 `npm run build`，确认类型检查通过。
