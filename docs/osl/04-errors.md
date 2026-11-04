# 异常与诊断

## 抛出

```osl
raise "disk full"
raise ValueError("empty name")
raise TypeError("expected a number")
```

- `raise "字符串"` 会被解析为 `type = Error`。
- 如果字符串形如 `"ValueError: 内容"`，类型会被自动识别。
- 四个内建构造器：`Error`、`TypeError`、`ValueError`、`RangeError`。

## 捕获

```osl
try:
    risky()
except e:
    print(e.type)      # "ValueError"
    print(e.message)   # "empty name"
    print(e.line)      # 抛出所在源码行
```

`e` 是一个**错误对象**，不是字符串（1.1 起）。它同时可以当作字符串使用：

```osl
except e:
    print("caught: " + e)    # 输出 e.message
```

可用字段：

| 字段 | 说明 |
| --- | --- |
| `e.type` | 错误类型名 |
| `e.message` | 错误信息（不含栈） |
| `e.line` | 行号，未知时为 `None` |
| `e.frames` | 调用栈帧字符串数组 |

`try` 还支持 `finally`：

```osl
try:
    doWork()
except e:
    print("failed: " + e)
finally:
    refresh()
```

`return` / `break` / `continue` 会穿透 `try`，不会被 `except` 吞掉。

## 栈追踪

未捕获的异常在离开解释器时补上调用栈：

```
ValueError: deep (line 12)
    at inner (line 12)
    at outer (line 15)
    at <main>
```

行号取最近的语句/表达式位置，最多保留 12 帧。应用启动失败时，窗口顶部会显示
完整信息；终端里运行 `osl file.osl` 则打印到终端。

## 常见的运行时错误

| 信息 | 原因 |
| --- | --- |
| `Name 'x' is not defined` | 变量未声明或拼错 |
| `Cannot assign to constant 'x'` | 给 `const` 赋值 |
| `Expected a number but got str` | 把不可解析的字符串用于算术 |
| `X object has no attribute 'y'` | 实例上不存在该字段/方法 |
| `'None' is not callable` | 调用了不存在的成员（常见于拼错方法名） |
| `Execution limit reached — possible infinite loop` | 超过步数上限 |
| `Maximum recursion depth (180) exceeded` | 递归太深 |

## 执行限制

| 限制 | 默认值 | 说明 |
| --- | --- | --- |
| 步数 | 4,000,000 | 每次 `eval` 计数一次，超限即中止 |
| 递归深度 | 180 | 函数调用嵌套层数 |
| 序列化深度 | 8 | OML 的 `For` 数据签名，超过则截断为 `…` |

这些限制保护的是浏览器主线程：一段死循环脚本会以错误结束，而不是把页面卡死。

## 调试

```osl
print(type(value))
console.log("state", value)
ui.toast("reached here", "info")
```

终端里可以直接执行脚本看输出：

```bash
osl ~/Projects/hello.osl
```

窗口内脚本出错时，错误会显示在窗口顶部并可滚动查看，同时打印到浏览器控制台
（前缀 `[OSL:应用 id]`，OML 求值错误前缀 `[OSL]`，并做了 1.5 秒去重）。
