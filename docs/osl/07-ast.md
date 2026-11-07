# OSL AST 契约

`src/osl/parser.ts` 产出的 AST 是**普通对象**：一个 `type` 字段标识节点种类，其余字段
按固定顺序插入。这份文档把字段冻结下来，因为自举解析器（见
[bootstrap.md](../bootstrap.md)）必须产出**结构完全一致**的节点，否则两层解释器
的行为会分叉，而分叉出来的 bug 极难定位。

字段顺序不是审美问题：`json.stringify` 走 `Map` 的插入顺序，顺序错了，缓存键和
快照 diff 全部失效。

> 下面每一行都是从真实解析结果抄下来的，不是手写推测。改动 `parser.ts` 时请同步改这里。

## 顶层

```
Program  { type, body[] }
```

`Program` 没有 `line`。

## Token 流

`lex()` 产出 `{ t, v, line, col }`，自举词法器必须一模一样：

- `col` 从 1 开始，按**字符**计（一个 Tab 算 1 列；缩进宽度计算时 Tab 才算 4）；
- `INDENT` / `DEDENT` 的 `col` 指向该行第一个非空白字符；
- `STRING` 的 `v` 是 `{ s, f }`，`s` 是**未插值**的原始模板；
- `NUMBER` 的 `v` 已经是 number（`_` 分隔符已去掉）。

语法错误里带 `col`：`Unexpected token '}' (line 64, col 12)`。

## 语句节点

| 节点 | 字段（插入顺序） | 备注 |
| --- | --- | --- |
| `VarDecl` | `type, kind, name, value, line` | `kind` 是 `let` / `var` / `const`；无初始值时 `value` 是 `{ type: 'None' }`，**该 `None` 不带 `line`** |
| `Assign` | `type, target, op, value, line` | `op` ∈ `= += -= *= /= %= **=`；`target` 是 `Name` / `Member` / `Index` |
| `ExprStmt` | `type, expr, line` | 单独一行的表达式 |
| `Import` | `type, path, alias, line` | `alias` 为 `null` 时取文件名 |
| `FromImport` | `type, path, names, line` | `names` 是 `[{ name, alias }]`，`alias` 可为 `null` |
| `FuncDecl` | `type, name, params, body, line` | `params` 是 `[{ name, def }]`，`def` 为 `null` 或表达式节点；`line` 是 `fn` 所在行 |
| `ClassDecl` | `type, name, parent, methods, line` | `parent` 为 `null` 或类名字符串；`methods` 里全是 `FuncDecl` |
| `If` | `type, branches, orelse, line` | `branches` 是 `[{ cond, body }]`，`elif` 也在这里；`orelse` 为 `null` 或语句数组 |
| `While` | `type, cond, body, line` | |
| `For` | `type, name, name2, iter, body, line` | **`name2` 只在 `for k, v in …` 时存在**，普通 `for` 完全没有这个键 |
| `Return` | `type, value, line` | 裸 `return` 的 `value` 是 `null` |
| `Break` / `Continue` / `Pass` | `type, line` | |
| `Raise` | `type, value, line` | 抛错误对象 |
| `Throw` | `type, value, line` | 抛**任意值**，`except e` 绑定的就是它；裸 `throw` 的 `value` 是 `{ type: 'None' }`（不带 `line`） |
| `Try` | `type, body, catchName, catchBody, finallyBody, line` | `catchName` 恒存在（默认 `"e"`）；没有对应子句时字段为 `null` |

## 表达式节点

| 节点 | 字段（插入顺序） | 备注 |
| --- | --- | --- |
| `Num` | `type, value, line` | 词法阶段已去掉 `_` 分隔符并转成数字 |
| `Str` | `type, value, f, line` | **`value` 保留原始模板**，`f` 只表示它是不是 f-string；插值发生在求值期 |
| `Bool` | `type, value, line` | |
| `None` | `type, line` | 源码里写的 `None` 带 `line`；`VarDecl` 内部补的那个不带 |
| `Name` | `type, name, line` | |
| `List` | `type, items, line` | |
| `Dict` | `type, pairs, line` | `pairs` 是 `[{ k, v }]`；空字典是 `pairs: []` |
| `Lambda` | `type, params, defaults, body, line` | 箭头函数体是**单个表达式** |
| `LambdaBlock` | `type, params, defaults, body, line` | `fn(x):` 形式，`body` 是语句数组 |
| `Unary` | `type, op, arg, line` | `op` ∈ `not` / `-` / `+` |
| `Ternary` | `type, cond, a, b, line` | `a if c else b` 与 `c ? a : b` 产出同一个节点 |
| `Bin` | `type, op, l, r, line` | `line` 取**运算符**所在行；`op` ∈ `+ - * / // % ** == != < <= > >= and or in notin is isnot` |
| `Call` | `type, callee, args, line` | `line` 取 `(` 所在行 |
| `Member` | `type, obj, name, line` | `line` 取 `.` 所在行 |
| `Index` | `type, obj, index, line` | `line` 取 `[` 所在行 |
| `Slice` | `type, obj, start, end, line` | 缺省端点是 `null`，不是 `None` 节点 |

## 字段存在性：`null` ≠ 缺失

这是自举解析器最容易踩的一条。三个地方是**可缺省键**：

- `For.name2` —— 只在解包写法里出现；
- `Lambda.defaults` —— 只有 `fn(x) => …` 这条产生式会写 `defaults`；
  单参数箭头 `x => …` 和括号箭头 `(x, y) => …` 都不带这个键。

其余位置一律写 `null` 占位，不能省。`tools/osl-devkit.ts ast` 的比对器会把
「键集合不一致」单独报出来，就是防这个。

## 一个真实样例

```json
{"type":"For","name":"k","name2":"v","iter":{"type":"Name","name":"d","line":22},"body":[{"type":"Pass","line":23}],"line":22}
{"type":"Try","body":[…],"catchName":"e","catchBody":[…],"finallyBody":null,"line":25}
{"type":"Assign","target":{"type":"Name","name":"q2","line":39},"op":"=","value":{"type":"Lambda","params":["x","y"],"body":{"type":"Name","name":"x","line":39},"line":39},"line":39}
{"type":"Assign","target":{"type":"Name","name":"q1","line":38},"op":"=","value":{"type":"Lambda","params":["x"],"defaults":[null],"body":{…},"line":38},"line":38}
```

注意 `q1`（`fn(x) => x * 2`）有 `defaults`，`q2`（`(x, y) => x`）没有。

## 行的来源

自举解析器必须复刻这些取行规则，否则报错位置会整体偏移：

- `Bin` / `Unary` / `Ternary`：运算符（`Ternary` 取条件左侧）所在行；
- `Call` / `Member` / `Index` / `Slice`：`(` / `.` / `[` 所在行；
- `If` / `While` / `For` / `Try` / `ClassDecl` / `FuncDecl` / `VarDecl` / `Import`：关键字所在行；
- `Assign` / `ExprStmt` / `Return`：语句起始行。

## 已知缺陷

**块体匿名函数不能出现在语句中间。** `fn(x):` 后面跟缩进块时会吃掉块尾的 `NEWLINE`，
于是 `endStatement()` 看到下一条语句的 `NAME` 就报
`Unexpected token`：

```osl
q3 = fn(x):
    return x
let p = 1          # ← 这里报错
```

块体 lambda 目前只能出现在块的最后一条语句位置（`return fn():` 那类收尾写法）。
自举解析器如果要"照抄现状"，就得把这条限制一起抄过去——更好的选择是在
`parseBlock()` 返回时补一个 `NEWLINE`，把这里修掉再自举。修之前请先补一条
conformance 用例，免得两层实现各自跑偏。

## 与自举实现的比对方式

```bash
./node_modules/.bin/esbuild tools/osl-devkit.ts --bundle --platform=node \
  --format=cjs --outfile=.tmp/devkit.cjs
node .tmp/devkit.cjs ast      # 宿主 parse 与 src/osl/self/parser.osl 逐字段对比
node .tmp/devkit.cjs tokens   # 只比 token 流，S1 阶段的验收
```

比对规则：数组按长度与元素逐个比；对象要求**键集合完全相等**（多一个少一个都算错），
再逐键递归；基础值用 `!==`。第一个不一致处打印 JSON 路径，例如
`$.body[3].value.name2: 自举多出、宿主没有`。
