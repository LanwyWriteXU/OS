# OSL 语法

## 语句与缩进

```osl
let a = 1
if a > 0:
    print("positive")
else:
    print("non-positive")
```

- 冒号后必须换行并缩进（也可写单行体：`if a > 0: print("yes")`）。
- 缩进可以用 4 个空格或 Tab，但同一次增加/减少必须一致，否则报
  `Inconsistent indentation`。
- 括号内换行不产生语句边界，长表达式可以自由折行：

```osl
let items = [
    "a",
    "b",
]
```

## 字面量

```osl
let n = 42
let f = 3.14
let big = 1_000_000
let exp = 1.5e3
let s1 = "double"
let s2 = 'single'
let multi = """第一行
第二行"""
let hashes = ["a", 1, True, None]
let dict = {"name": "origin", "version": 1.1, 42: "answer"}
```

`f"..."` 是插值字符串，`{表达式}` 会被求值：

```osl
let name = "origin"
print(f"hello {name}, {1 + 2}")     # hello origin, 3
print("literal {braces}")           # 原样输出
print(f"escaped {{brace}}")         # escaped {brace}
```

## 运算符

优先级从高到低：

| 级别 | 运算符 |
| --- | --- |
| 1 | `()` `[]` `.` 调用 `f(x)` |
| 2 | `**`（右结合） |
| 3 | 一元 `-` `+` `not` `!` |
| 4 | `*` `/` `//` `%` |
| 5 | `+` `-` |
| 6 | `<` `<=` `>` `>=` `in` `not in` `is` `is not` |
| 7 | `and` `&&` |
| 8 | `or` `\|\|` |
| 9 | 三元 `a if cond else b`、`cond ? a : b` |

赋值：`=` `+=` `-=` `*=` `/=` `%=` `**=`。

`and` / `or` 是短路求值，并返回**操作数本身**（与 Python 一致）：

```osl
let label = name or "anonymous"    # name 为空字符串时取后者
```

## 控制流

```osl
if score >= 90:
    grade = "A"
elif score >= 80:
    grade = "B"
else:
    grade = "C"

while n < 10:
    n += 1

for i in range(3):
    print(i)

for key, value in {"a": 1, "b": 2}:
    print(key + "=" + str(value))

for index, item in enumerate(items):
    print(str(index) + ": " + item)

for i in range(10):
    if i == 3:
        continue
    if i == 6:
        break
```

- `for` 每次迭代都会复制一份可迭代对象，循环中修改原列表不会影响本次遍历。
- 循环变量写在外层作用域，循环结束后仍然可见（与 Python 相同）。
- `for` 的闭包捕获是**晚绑定**：循环里创建的匿名函数都看到最后一次的值。
  需要固定值请在循环体内 `let v = i` 后再捕获。

## 索引与切片

```osl
let xs = [10, 20, 30, 40]
print(xs[0])        # 10
print(xs[-1])       # 40
print(xs[1:3])      # [20, 30]
print("origin"[0])  # o
print("origin"[1:4])# rig
```

越界时列表返回 `None`，字符串返回 `""`。`xs[10] = 1` 静默忽略（不扩容）。

## 表达式语句与赋值目标

```osl
obj.field = 1
dict["key"] = 2
list[0] += 5
obj.count += 1
```

赋值目标只求值一次：`nextObj().count += 1` 中 `nextObj()` 只调用一次。

## 语句分隔

同一行可以用分号分隔多条语句：

```osl
let a = 1; let b = 2; print(a + b)
```

## 不支持的东西

- 模块级的 `import` 以外，没有 `with`、`async/await`、装饰器、生成器。
- 没有 `del`、`assert`、`global`/`nonlocal`。
- 没有位运算。
- `switch` 用 `if/elif` 表达。
