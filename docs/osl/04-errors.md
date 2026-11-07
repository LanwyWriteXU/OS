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

## throw：携带任意值

`raise` 只能抛错误：任何值都会被转成错误对象。需要**原样传递一个值**时用 `throw`，
它主要用于非局部跳转（解释器里实现 `return` 就是这么做的）：

```osl
try:
    throw {"kind": "ret", "value": 42}
except e:
    print(e.kind)      # ret
    print(e.value)     # 42
```

| 语句 | `except e` 里的 `e` |
| --- | --- |
| `raise x` | 错误对象：`e.type` / `e.message` / `e.line` / `e.frames` |
| `throw v` | **就是 `v` 本身**，不做任何包装 |

`throw` 同样会被 `finally` 拦一道，也照样穿透函数调用；没被捕获时会变成一条
`未捕获的 throw: …` 错误，而不是把裸值丢给宿主。

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

宿主侧可以按实例调整这两条上限，并挂一个进度钩子（长任务靠它来报进度或中断）：

```ts
const interp = new Interpreter({}, {
  maxSteps: 200_000_000,
  maxDepth: 800,
  tickEvery: 50_000,                      // 每约 0.1 秒一次
  onTick: (steps, line) => {
    if (tooLong()) throw new Error("超时");
  },
});
interp.requestCancel();                   // 下一个 tick 抛「执行已取消」
```

`onTick` 里抛出的任何异常都会中止本次执行；`requestCancel()` 适合绑定一个取消按钮。
`run()` 开始时会自动清掉取消标记。

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
