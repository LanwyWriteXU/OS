# OS 语言与平台文档

这个目录记录 OS 1.1 中两门自制语言以及围绕它们构建的平台能力。
代码即事实：文档描述的行为都能在 `src/osl`、`src/oml` 与 `src/i18n` 中找到对应实现。

## OSL — Origin Software Language

驱动所有交互逻辑的缩进敏感脚本语言，语法接近 Python。

| 文档 | 内容 |
| --- | --- |
| [osl/01-overview.md](osl/01-overview.md) | 执行模型、值类型、真值规则、相等与转换 |
| [osl/02-syntax.md](osl/02-syntax.md) | 词法、字面量、运算符、控制流 |
| [osl/03-functions.md](osl/03-functions.md) | 函数、闭包、类与继承、作用域规则 |
| [osl/04-errors.md](osl/04-errors.md) | 异常、类型化错误、栈追踪、执行限制 |
| [osl/05-modules.md](osl/05-modules.md) | 多文件：import / from、解析规则、缓存 |
| [osl/06-stdlib.md](osl/06-stdlib.md) | 全局函数与标准库命名空间 |

## OML — Origin Markup Language

描述界面的 XML 方言，属性值是 OSL 表达式，界面上没有一个硬编码控件。

| 文档 | 内容 |
| --- | --- |
| [oml/01-overview.md](oml/01-overview.md) | 文档模型、挂载与刷新、表达式求值 |
| [oml/02-widgets.md](oml/02-widgets.md) | 全部标签与关键属性 |
| [oml/03-bindings.md](oml/03-bindings.md) | 插值、事件、双向绑定、For、if/visible |
| [oml/04-styling.md](oml/04-styling.md) | 布局属性、class/variant、设计令牌 |
| [oml/05-i18n.md](oml/05-i18n.md) | 多语言机制与新增语言的步骤 |

## 应用

| 文档 | 内容 |
| --- | --- |
| [apps/ide.md](apps/ide.md) | IDE：布局、快捷键、运行模型与实现 |
| [apps/utilities.md](apps/utilities.md) | Tasks、Clock、Preview、Logs 与系统设置项 |

## 其他

- [migration-1.1.md](migration-1.1.md) — 从 1.0 升级到 1.1 的行为变化清单
- [screenshots/](screenshots/) — 界面截图
