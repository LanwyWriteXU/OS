# IDE

`ide` 是 1.1 新增的编辑器应用，目标是给出「像 VSCode 那样的 OSL 工作台」，
同时保持整个界面仍然由 OML 描述。

## 布局

```
┌────────────┬──────────────────────────────────────────┐
│ Explorer   │ tabs                          ▶  💾      │
│            ├──────────────────────────────────────────┤
│ lib/       │ ~/Projects/app.osl      Ctrl+S save …    │
│   mathx.osl├──────────────────────────────────────────┤
│ app.osl    │ 1  # app.osl — demo entry for the IDE.    │
│ demo.oml   │ 2  # F5 runs this file, Ctrl+S saves it.  │
│ fib.osl    │ 3                                          │
│ hello.osl  │ ...                                       │
│            ├──────────────────────────────────────────┤
│            │ OUTPUT  运行完成                     🗑  ✕ │
│            │ OSL runtime 1.1 (Origin)                 │
│            │ n=1  double=2  area=3.14                 │
├────────────┴──────────────────────────────────────────┤
│ ~/Projects/app.osl        Ln 1, Col 1    OSL   UTF-8  │
└───────────────────────────────────────────────────────┘
```

- **资源管理器**：`~/Projects` 的真实文件树，目录可折叠，右键可新建、重命名、删除。
- **标签页**：每个文件一个标签，脏数据用圆点标记，`×` 关闭。
- **编辑器**：语法高亮、行号、括号内自动换行关闭、Tab 插入四空格、回车自动续缩进。
- **输出面板**：显示 `print` 输出或错误信息，可折叠、清空。
- **状态栏**：当前文件、光标行列、语言、编码。

## 快捷键

| 快捷键 | 动作 |
| --- | --- |
| `Ctrl + S` | 保存当前文件 |
| `F5` / `Ctrl + Enter` | 运行当前文件 |
| `Ctrl + P` | 快速打开（按文件名搜索） |
| `Ctrl + B` | 折叠 / 展开资源管理器 |
| `Tab` | 插入四个空格 |
| `Enter` | 自动沿用上一行缩进，冒号结尾多缩进一级 |
| `Esc` | 关闭快速打开面板 |
| `Ctrl + Alt + I` | 从桌面任意位置打开 IDE |

## 运行模型

「运行」并不在应用自己的解释器里执行脚本，而是交给内核开一个一次性解释器：

```ts
OS.kernel.runScript(source, path)   // → { ok, output, error }
```

- 每次运行都是全新作用域，不会污染应用自己的变量。
- `print` / `console.log` 被捕获进输出面板。
- `import` 依然可用，相对路径以当前文件所在目录为基准。
- 定时器与界面刷新在脚本运行环境里是空实现，避免脚本卡住 IDE。
- 运行前会自动保存到文件系统，保证磁盘与缓冲区一致。

## 示例工程

首次启动会种下 `~/Projects/app.osl` 与 `~/Projects/lib/mathx.osl`，用来演示模块：

```osl
import "lib/mathx.osl" as mathx
from "lib/mathx.osl" import area

for n in range(1, 6):
    print("n=" + str(n) + "  area=" + str(mathx.round2(area(n))))
```

按 `F5` 可以看到输出；改动 `mathx.osl` 后再次运行即可验证模块缓存之外的行为
（每次运行都是新解释器，模块会重新加载）。

## 实现要点

| 位置 | 作用 |
| --- | --- |
| `src/apps/ide/ide.oml` / `ide.osl` | 界面与全部交互逻辑 |
| `src/ui/highlight.ts` | OSL 词法着色，单次扫描，输出经过转义 |
| `src/oml/widgets.ts` `CodeEditor` | textarea + 高亮层 + 行号槽三层叠加 |
| `src/core/kernel.ts` `runScript` | 隔离解释器与输出捕获 |
| `src/styles/apps.css` `.ide*` / `.code-*` | 布局与配色令牌 |

### 编辑器为什么不是 contenteditable

纯 DOM 的富文本编辑要自己实现光标、选区、撤销、输入法，成本高且容易出 bug。
这里用「透明 textarea 叠在高亮 `<pre>` 上」的经典方案：

- textarea 负责光标、选区、滚动和输入法；
- `<pre>` 只负责上色，两层字体度量完全一致；
- 行号槽通过 `translateY(-scrollTop)` 跟随滚动；
- 输入时重新高亮整篇文档，几十 KB 的脚本完全够用。

## 限制

- 没有多光标、代码折叠、跳转定义、自动补全。
- 高亮是词法级的，不做语义分析（变量名不会着色区分）。
- 没有撤销栈之外的持久化：关闭标签页会丢弃未保存内容（运行/切换会先保存）。
- 一次运行是一个同步过程，长脚本会占用主线程，受 4,000,000 步上限保护。
