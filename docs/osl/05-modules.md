# 多文件：模块

OSL 1.1 支持把代码拆成多个 `.osl` 文件。模块在首次导入时执行一次，结果被缓存。

## 导入语法

```osl
import "lib/mathx.osl" as mathx
from "lib/mathx.osl" import double, area
from "lib/mathx.osl" import double as d
```

- `import "路径" as 名字`：整个模块作为一个命名空间对象绑定到 `名字`，
  用 `名字.member` 访问。
- `from "路径" import a, b`：只绑定指定名字，可 `as` 重命名。
- 省略 `as` 时，`import` 用文件名（去掉扩展名）作为名字。

```osl
import "lib/mathx.osl"          # 绑定到 mathx
print(mathx.double(21))
```

## 路径解析

| 写法 | 解析结果 |
| --- | --- |
| `"lib/mathx.osl"` | 相对当前模块所在目录 |
| `"/home/user/lib/mathx.osl"` | 绝对路径 |
| `"~/lib/mathx.osl"` | `/home/user/lib/mathx.osl` |
| `"lib/mathx"` | 自动补 `.osl` |

主脚本的“当前目录”：

- 应用脚本：`args.path` 所在目录（通常是 `/home/user`）。
- 终端 `osl file.osl`：入口文件所在目录。

## 导出规则

**模块顶层所有 `let` / `const` / `fn` / `class` 都是导出。** `export` 关键字是
可选的显式标记，写了也不会改变行为：

```osl
export fn helper():
    return 1

const VERSION = "1.0"
```

以下划线开头的名字同样会被导出，命名约定上建议视为私有。

## 示例

`~/Projects/lib/mathx.osl`：

```osl
const PI = 3.14159

fn double(n):
    return n * 2

fn area(r):
    return PI * r * r
```

`~/Projects/calc.osl`：

```osl
import "lib/mathx.osl" as mathx
from "lib/mathx.osl" import area

print(mathx.PI)
print(mathx.double(21))
print(area(2))
```

```bash
osl ~/Projects/calc.osl
```

## 缓存与循环导入

- 同一路径的模块只执行一次，后续 `import` 复用同一作用域（单例语义）。
- 模块在执行**之前**就写入缓存，因此循环导入不会无限递归；此时对方可能看到
  一个还没填满的命名空间。
- 模块执行失败会从缓存中移除，下次导入会重新尝试。

## 与宿主的关系

模块从虚拟文件系统读取，解释器通过 `interp.loader(path)` 取得源码：

```ts
interp.loader = (p) => (vfs.exists(p) && !vfs.isDir(p) ? vfs.read(p) : null);
interp.modulePath = '/home/user';
```

因此在应用与终端里，`import` 读取的都是用户在文件管理器里看到的真实文件。

## 限制

- 没有包管理器、没有版本约束、没有 `export default`。
- 模块路径区分大小写。
- 不支持从 `.oml` 导入，也不支持动态 `import(expr)`。
