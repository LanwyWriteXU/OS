# 自举开发链路 — OSL in OSL

这份文档是「用 OSL 写一个 OSL 解释器」的完整施工图：从当前基线、必须先改的语言缺陷，
到分阶段产出、验收命令、性能预算和风险。所有数字都是在本仓库实测的，复现命令在
[§2](#2-基线实测可复现)。

配套文档：[AST 契约](osl/07-ast.md)（自举解析器必须产出的节点结构）。

---

## 1. 先定义清楚「自举」

同一个词在这里有四种含义，成本差一个数量级。链路按 L0 → L3 递进，每一级都能独立交付。

| 级别 | 含义 | 宿主还需要负责 | 现状 |
| --- | --- | --- | --- |
| **L0 半自举** | OSL 负责**解析**，TS 仍负责执行 | 词法、语法错误的报错；执行全速 | 未开始 |
| **L1 解释器** | OSL 自己解析 + 自己求值，宿主只提供原语 | VFS、DOM、定时器、渲染 | 未开始 |
| **L2 两级自举** | 用 L1 解释器跑 L1 自己的源码 | 同上 | 未开始 |
| **L3 系统自举** | 窗口管理器、OML 渲染器也搬进 OSL | 只剩 DOM / VFS / 定时器原语 | 未开始 |

**判断**：L0 有实用价值（解析器可替换、可热更新、错误提示可做得更细），L1/L2 是
"能跑通"的技术演示，L3 才是 README 里那句"TS 只负责解释、渲染和系统调用"的完全体，
但代价是桌面明显变卡。**建议按 L0 → L1 → L2 推进，L3 单独立项。**

---

## 2. 基线（实测，可复现）

```bash
pnpm bench                 # = esbuild 打包 devkit + 跑 bench
pnpm devkit tokens         # S1 验收：逐 token 比对
pnpm devkit ast            # S2 验收：逐字段比对
```

一次典型输出（Node 22 / 桌面浏览器量级相当，波动 ±10%）：

```
吞吐   fib(22) 1131 ms / 515,815 步 → 456,116 步/秒
嵌套   21,000 个 AST 节点 628 ms / 414,014 步 → 20 步/节点，33,445 节点/秒
       折算：自举解释器里每解释一个 AST 节点，要多花 20 个外层步
深度   OSL 调用栈实测上限 ≈ 1797（再深宿主抛 RangeError，不是干净报错）
语料   20 个文件 / 4366 行 / 112,132 字符 / 29,309 token / 15,361 AST 节点
预算   前端（全语料）≈ 10.3M 步 ≈ 23.0 s（按 450k 步/秒）
负载   markdown.parse(12516 字符) 164 ms / 179,911 步 → 自举后约 8.0 s（×20）
```

四条结论：

1. **宿主吞吐约 39 万步/秒**。`Interpreter.steps` 是唯一的通用计量单位。
2. **每解释一个 AST 节点，要多花约 20 个外层步**（最小求值器，含一层作用域链；
   完整求值器带 `call`/`if`/`ret` 分发时约 31 步）。这就是自举的税率。
3. **递归深度上限约 1800 层**，超过是宿主 JS 栈的 `RangeError`，不是干净报错。
   `interp.ts:153` 的 `maxDepth = 180` 是保守护栏，不是物理极限。
4. **全语料前端约 23 秒**。一次性成本，可以缓存成 AST 快照，所以可接受；
   但如果每次启动都重算，体验不可接受。

### 语料规模

| 文件 | 行 | 字符 | token | AST 节点 |
| --- | --- | --- | --- | --- |
| `system/shell.osl` | 1407 | 39,897 | 9,972 | 5,196 |
| `system/markdown.osl` | 301 | 8,583 | 2,100 | 1,143 |
| `apps/ide/ide.osl` | 418 | 10,377 | 2,792 | 1,480 |
| `apps/files/files.osl` | 329 | 8,097 | 2,391 | 1,252 |
| 其余 16 个应用 | 1911 | 45,178 | 12,054 | 6,290 |
| **合计** | **4366** | **112,132** | **29,309** | **15,361** |

`nodes / token ≈ 0.52`，`chars / token ≈ 3.83` — 估算前端成本时用这两个比值。

### 预算换算

| 场景 | 原生 | 自举后（×20） | 是否可用 |
| --- | --- | --- | --- |
| 解析单个应用的 `.osl`（≈220 行） | ≈0.5 s | ≈1 s | 可用 |
| 解析全部系统源码（4.4k 行） | ≈1.2 s | ≈23 s | 一次性，需缓存 |
| `markdown.parse` 一篇 12 KB 文档 | 0.16 s | 8.0 s | 勉强，需要进度反馈 |
| 启动 shell（解析 + 顶层执行） | ≈1.3 s | ≈30 s（估算） | 只能当演示 |

估算口径：词法 40 步/字符、解析 200 步/token、求值 ×20。最后一行没有直接测到——
桩宿主会在 `shell.osl:109` 那类 `sys.info()` 调用上炸掉，所以按 `≈400 步/行` 的密度外推。

**这不是"能不能"的问题，是"要不要在每个窗口都付一次"的问题。** 所以 L1 的产品形态应该是
一个独立的 "Interpreter" 应用，而不是替换 `Kernel.open()` 里的解释器。

---

## 3. 前置改造

按阻塞关系排序。P0 不做，后面全是空转。

### P0 — 阻塞项（已完成）

**P0-1 `raise` 带不了值** ✅

- 原位置：`interp.ts` 的 `Raise` 分支——非 `OslErrorValue` 的值会被 `toStr()` 成 message。
- 已做：新增 `throw v` 语句，走 `ThrownSignal` 原样传递，`except e` 绑定 `v` 本身；
  `raise` 行为完全不变（向后兼容）。`throw` 仍会执行 `finally`、仍穿透函数调用；
  逃到最外层时变成 `未捕获的 throw: …` 错误，不会把裸值丢给宿主。
- 语义文档：[osl/04-errors.md](osl/04-errors.md#throw携带任意值)。

**P0-2 上限写死、无法中断** ✅

- 原位置：`Interpreter.maxSteps = 4_000_000` / `maxDepth = 180` 是裸字段，
  `kernel.ts`、`overlay.ts` 六处 `new Interpreter()` 都用默认值。
- 已做：`InterpreterOptions`（`maxSteps` / `maxDepth` / `onTick` / `tickEvery`）作为
  构造函数第二个参数；`eval` 里每 `tickEvery` 步（默认 5 万，约 0.1 s）回调一次，
  回调抛异常即中断；另有 `requestCancel()` 供外部取消，`run()` 开始时自动清除。
- 用法见 [osl/04-errors.md](osl/04-errors.md#执行限制)。

**P0-3 只有行号没有列号** ✅

- 原位置：`Token` 只有 `line`，`OslSyntaxError` 也只有 `line`。
- 已做：`Token.col`（1 基、按字符计）、`OslSyntaxError.col`，词法器与解析器的报错
  全部带上列号：`Unexpected token '}' (line 64, col 12)`。

三项都由 `tests/p0-lang.ts` 覆盖，`pnpm check` 一条命令跑完（含 20 个 `.osl` 的
全语料解析回归，规模必须仍是 4366 行 / 29,309 token / 15,361 节点）。

### P1 — 强烈建议

| 编号 | 问题 | 位置 | 改法 | 收益 |
| --- | --- | --- | --- | --- |
| P1-1 | 没有 `match` | `src/osl/parser.ts:99` | `match x:` + `case "num":`，宿主编译成跳转表 | 求值器主循环省 30%+ 步数 |
| P1-2 | 未知成员静默返回 `None` | `interp.ts:830` | `strict` 开关：未知属性抛错 | 拼错 `node.op` 不再无声失败 |
| P1-3 | `import` 是快照 | `interp.ts:355` | 改成包 Env 的 live proxy，或做循环检测 | 多文件解释器必需 |
| P1-4 | 逐字符 `s[i]` + `ord()` | `interp.ts:896` | 加 `s.codeAt(i)` 或 `str.codes()` | 词法器省 2–3 倍时间 |

P1-3 细节：`import` 走 `Object.fromEntries(modEnv.vars)`，导入瞬间复制。A↔B 循环依赖时
B 永远看不到 A 在 import 之后定义的函数，而且**不报错**。3000 行的解释器拆成三四个
文件时几乎必然踩到。

### P2 — 顺手

| 编号 | 内容 | 说明 |
| --- | --- | --- |
| P2-1 | `assert cond, msg` | conformance 套件必需；当前用 `if not x: throw …` + 测试侧捕获凑合 |
| P2-2 | 参数个数校验（strict） | 现在多传丢弃、少传 `null`（`interp.ts:936`），拼错变量名能静默跑完 |
| P2-3 | 列表推导 | 能把 lexer/parser 代码压掉约 15%，宿主实现成本很低 |
| P2-4 | 修块体 lambda 的位置限制 | 见 [07-ast.md](osl/07-ast.md#已知缺陷)，自举前必须钉住行为 |

### 明确不做

- **正则**。自举时你还得实现 JS 的 `RegExp` 语义，坑放大十倍。手写扫描器才是对的。
- **标准库扩张**（网络、DOM 之类）。凡宿主原生实现的，自举层要么再实现一遍，要么缺席。
- **类/继承继续膨胀**。解释器用不到继承，`class` 只允许方法已经够。

一句话原则：**自举的可行度反比于语言里"依赖宿主的特性"数量**，所以改进应该往
性能、诊断、工具链走，而不是加语法糖。

---

## 4. 阶段路线

每个阶段都有独立验收，做完就能停。

### S0 — 地基 ✅

产出：

- P0-1 / P0-2 / P0-3 落地（见 §3）；
- `docs/osl/07-ast.md`：AST 与 token 契约；
- `tools/osl-devkit.ts`：`bench` / `tokens` / `ast` 三个子命令；
- `tests/p0-lang.ts`：12 项语言验收 + 全语料解析回归；
- `.github/workflows/check.yml`：PR / push 跑 `pnpm check`。

验收：

```bash
pnpm check     # tsc --noEmit + tests/p0-lang.ts（12 项全过）
pnpm bench     # 基线数字可复现
```

退出条件：既有 17 个应用在 P0 改动后行为不变（打开、点击、保存都正常）。

### S1 — 词法器（1–2 天）

- 产出：`src/osl/self/lexer.osl`，约 350 行，导出 `lex(src) -> [{ t, v, line }]`
- 验收：`node .tmp/devkit.cjs tokens` 对 20 个 `.osl` 全部 ✓

必须复刻的边角（按踩坑概率排序）：

1. `\t` 记 4 列；空行与纯注释行**不产生** `INDENT`/`DEDENT`；
2. 括号内抑制 `NEWLINE`（`depth` 计数器），`;` 等价 `NEWLINE`，`\` 续行；
3. f-string 前缀 `f"` / `f'` / 三引号，`value` 保留**原始模板**，不在词法阶段展开；
4. 字符串转义 `\n \t \r \0 \\ \" \' \` \xNN \u{...}`；
5. 数字允许 `_` 分隔、前导 `.5`、指数 `1e9`；
6. 三字符运算符 `**=` 必须在两字符之前匹配（`OPS3` / `OPS2` 顺序敏感）。

### S2 — 解析器（2–3 天）

- 产出：`src/osl/self/parser.osl`，约 700 行，导出 `parse(src) -> Program`
- 建议用**优先级爬升**而不是十层函数下降：帧数少、步数少、嵌套深度上限更高
  （宿主的十层下降在 OSL 里每层约 10 帧，嵌套 80 层括号就会触顶）
- 验收：`node .tmp/devkit.cjs ast` 对 20 个文件全部 ✓（键集合完全一致）

高频坑：

1. `(` 开头的 lambda 回退：需要 try/except + `pos` 回滚（`parser.ts:567`）；
2. 三元两种写法归一成 `Ternary`；
3. `not in` / `is not` 是双 token 组合，`in` / `is` 是 `NAME` 不是 `OP`；
4. 切片 `[a:b]` 两端都可省，缺省是 `null` 而不是 `None` 节点；
5. `fn(x):` 块体 lambda 与 `fn(x) => …` 产出不同节点（`LambdaBlock` vs `Lambda`）；
6. `export` 是空操作，直接解析后面的语句（`parser.ts:145`）。

### S3 — L0 半自举接线（0.5 天）

- 把 `Interpreter` 里的 `parseProgram` 抽成可注入的 `frontEnd`；
- 加开关 `osl.frontEnd = 'ts' | 'osl'`，默认 `ts`；
- IDE 增加"用 OSL 解析"选项，把解析耗时打到输出面板。

验收：切换成 `'osl'` 后 17 个应用照常启动，控制台无报错；解析耗时在 1 s 量级。

**这一步就是 L0 的完整交付**，用户可感知的价值（错误提示带列号、解析器可热改）从这里开始。

### S4 — 求值器（3–5 天）

- 产出：`src/osl/self/interp.osl`（约 1300 行）+ `src/osl/self/stdlib.osl`（约 400 行）
- 结构建议：`Env` / 值类型判定 / `binop` / `call` / `exec` / `eval` 六个部分，
  控制流用 P0-1 的 `throw` 或 ctl 协议，不要用 `raise` + `json.parse`
- 标准库分工：纯计算（`len/str/int/range/sorted/typeof`）用 OSL 写；
  `fs / sys / ui / win` 直接把宿主的 `NativeObject` 透传（现在这条链路是通的）

验收（三层）：

1. **conformance 套件**：`tests/conformance/*.osl` + `.out`，30–50 个小程序覆盖
   作用域、闭包、类、异常、切片、f-string、数字格式化，stdout 逐字节比对；
2. **语料回归**：20 个 `.osl` 在两层解释器下跑出相同结果（无副作用的纯函数部分）；
3. **性能门限**：`bench` 的"步/节点"不超过 35，全语料前端不超过 30 s。

语义细节清单（这些地方不照抄就会"能跑但结果不同"）：

- `if` / `for` / `while` **不开新作用域**，`execBlock` 复用同一个 `Env`；
- `assign` 只改已存在绑定，`set` 才会新建（`interp.ts:69` vs `:79`）；
- 参数默认值在**被调用方**环境求值（`interp.ts:938`）；
- 每次调用都定义 `self`，普通函数里它是 `null`；
- 方法通过 `native(name, (...args) => call(method, args, obj))` 绑定，取一次方法就固定了 `self`；
- `toStr` 对浮点走 `toFixed(10)` 再去尾（`interp.ts:747`），不平移就会在字符串对比里全红；
- `Map` 的键优先于方法名（`interp.ts:832`）。

### S5 — L2 两级自举（1 天）

- 终端加 `osl self`：用 L1 解释器执行 `src/osl/self/interp.osl` 自身，跑 `hello.osl`；
- 输出进度（解析 X%、执行 Y 步），可 Ctrl+C 中断（依赖 P0-2）。

验收：两层嵌套下 `hello.osl` 输出与原生一致；耗时记录在本文档 §2 下方。

这一阶段的产出主要是**证据**，不是工具。截图 + 实测数字进 README。

### S6 — 可选：闭包编译（3–5 天）

把 AST 一次性编译成嵌套的 `fn(env)` 闭包树，执行时每个节点只掉一层，
省掉 tag 分派和字典取字段。目标 5–10 倍，是 L3 的前置条件。

只有在决定做 L3 时才值得投入。

---

## 5. 目录规划

```
src/osl/
  lexer.ts parser.ts interp.ts builtins.ts    宿主实现（保持现状，做基准）
  self/
    lexer.osl        S1
    parser.osl       S2
    interp.osl       S4
    stdlib.osl       S4
    runtime.osl      值类型、fmt、错误对象等公共部分
tools/
  osl-devkit.ts      bench / tokens / ast 三合一
tests/
  p0-lang.ts         S0 语言验收（throw / 中断 / 列号 / 语料回归）
  conformance/       *.osl + *.out（S4）
docs/
  bootstrap.md       本文
  osl/07-ast.md      AST 契约
```

`self/*.osl` 建议**同时**装进 VFS 的 `/usr/share/os/lib/self/`，这样在系统里也能读到、
改到、跑到——和项目"操作系统源码可编辑"的调性一致。

---

## 6. 测试策略

| 层 | 手段 | 命令 | 门限 |
| --- | --- | --- | --- |
| 语言 | `tests/p0-lang.ts`：throw / 中断 / 列号 + 全语料解析回归 | `pnpm check` | 12 项全过 |
| 词法 | `devkit tokens` 逐 token 比对 20 个文件 | `pnpm devkit tokens` | 全部一致 |
| 语法 | `devkit ast` 逐字段比对（键集合敏感） | `pnpm devkit ast` | 全部一致 |
| 语义 | conformance 套件的 stdout 逐字节比对 | 待建 | 100% 通过 |
| 性能 | `devkit bench` 步/节点、前端总耗时 | `pnpm bench` | ≤35 步/节点、≤30 s |

`devkit` 的两个比对子命令在自举源码不存在时只打印提示并正常退出，所以 harness
先于实现落地——S0 已经把它接进 CI（`check.yml`），S1 一提交就开始有真实信号。

---

## 7. 性能路线

| 阶段 | 每节点成本 | 关键手段 |
| --- | --- | --- |
| 当前基线 | 20 步（最小求值器） | — |
| S4 完成 | 25–31 步 | 直白实现，先对后快 |
| + P1-1 `match` | ≈20 步 | 分派从 if 链变跳转表 |
| + 闭包编译（S6） | 5–8 步 | 干掉 tag 分派与字段查找 |
| + AST 快照缓存 | 前端归零 | 按 `path + mtime` 缓存序列化后的 AST |

不做闭包编译的话，L3 没有任何希望：桌面每帧都在跑 OSL，20 倍税率会直接把交互拖垮。

---

## 8. 风险登记

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 宿主 JS 栈 ~1800 层 | 深层嵌套直接 `RangeError`，且丢栈帧 | 自举 `maxDepth = 800`；解析器用优先级爬升压帧数；在 `onTick` 里主动探测深度 |
| 长任务冻 UI | 30 秒白屏 | P0-2 的 `onTick` + 分片执行；必要时上 Worker |
| 语义漂移 | 两层结果不同，且难定位 | AST 契约 + conformance 套件 + 20 文件回归，三闸齐下 |
| 步数上限 | 4M 默认值在自举下几秒就爆 | 自举实例 `2e8`，同时用 wall clock 看门狗 |
| 模块快照 | 拆文件后函数莫名 undefined | P1-3，或严格禁止循环依赖并在加载器里检测 |

---

## 9. 进度

- [x] S0 地基：P0-1 `throw` / P0-2 构造参数与 `onTick` / P0-3 列号
- [x] S0 工具：`devkit` + `tests/p0-lang.ts` 接进 CI（`check.yml`）
- [ ] S1 词法器通过 `tokens` 比对
- [ ] S2 解析器通过 `ast` 比对
- [ ] S3 L0 半自举接线，IDE 可选前端
- [ ] S4 求值器 + conformance 套件
- [ ] S5 L2 两级自举跑通 `hello.osl`
- [ ] S6 闭包编译（决定做 L3 时）
