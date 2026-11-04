# OML 组件参考

## 布局

| 标签 | 说明 |
| --- | --- |
| `VBox` / `Column` | 纵向排列（`display:flex; flex-direction:column`） |
| `HBox` / `Row` | 横向排列，默认 `gap: 6px` |
| `Grid` | 网格，用 `cols` / `rows` 指定列数或模板 |
| `Stack` | 相对定位容器，子元素层叠 |
| `Center` | 居中容器 |
| `Scroll` | 可滚动容器（`overflow:auto`） |
| `Spacer` | 弹性占位，把两侧元素推开 |
| `Div` / `Box` | 无样式容器，可挂 `class` 与事件 |
| `Card` | 带背景、边框、圆角与内边距的卡片 |

```xml
<Grid cols="4" gap="8">
  <For each="items" as="it"><Button text="{it.name}"/></For>
</Grid>
```

`cols="3"` 会展开为 `repeat(3, minmax(0, 1fr))`；也可以写完整 CSS 模板，
如 `cols="repeat(auto-fill, minmax(108px, 1fr))"`。

## 容器

| 标签 | 说明 |
| --- | --- |
| `Window` | 应用根容器，撑满窗口主体（`width/height:100%`），纵向排列 |
| `Modal` | 遮罩 + 对话框，子节点放进 `.modal-body`；`dismiss="false"` 关闭点遮罩关闭 |
| `Toolbar` | 横向工具条，带下边框 |
| `StatusBar` | 底部状态条，带上边框 |
| `List` | 纵向列表容器 |

```xml
<Modal title="{title}" icon="{icon}">
  <Label text="{message}"/>
  <Input if="{isPrompt}" bind="value"/>
</Modal>
```

## 文本

| 标签 | 说明 |
| --- | --- |
| `Label` / `Text` | 正文，保留换行（`white-space: pre-wrap`） |
| `Title` | 19px 标题 |
| `Subtitle` | 12px 次级标题 |
| `Muted` | 弱化正文 |
| `Kbd` | 键帽样式 |
| `Badge` | 小圆角标签 |

## 控件

| 标签 | 关键属性 |
| --- | --- |
| `Button` | `text` `icon` `variant`(`primary`/`danger`/`ghost`) `disabled` |
| `IconButton` | `icon` `title` `disabled` |
| `Icon` | `name` `size`（图标来自 `src/assets/icons`） |
| `Input` | `bind` `value` `placeholder` `type` `disabled` |
| `TextArea` | `bind` `value` `placeholder` |
| `Select` | `options="value:label|value2:label2"` `bind` |
| `Checkbox` | `bind` `checked` |
| `Switch` | `bind` `checked` |
| `Slider` | `bind` `min` `max` `step` `value` |
| `Progress` | `value`（0–100） |
| `Divider` | 水平分隔线 |
| `TerminalView` | 内嵌终端，无属性 |

```xml
<HBox>
  <Switch bind="clock24" onchange="applyClock()"/>
  <Progress value="{percent}"/>
  <Select options="en:English|zh:简体中文" bind="lang" onchange="setLang()"/>
</HBox>
```

## 逻辑

| 标签 | 说明 |
| --- | --- |
| `For` | 列表渲染，见 [03-bindings.md](03-bindings.md) |

`For` 不是元素，不会产生 DOM，只在父容器里按顺序插入子节点。

## 图标

图标名来自文件名（不含扩展名），例如 `folder.svg` → `name="folder"`。
可用 `iconNames()` 在脚本里枚举（需要宿主暴露）或直接查看目录。

图标以字符串形式内联，渲染时会给渐变/滤镜 id 加唯一后缀，因此同一图标
重复出现不会互相覆盖。

## 事件

`onclick` `ondblclick` `oncontextmenu` `oninput` `onchange` `onkeydown`
`onkeyup` `onmousedown` `onmouseup` `onmouseenter` `onmouseleave` `onfocus`
`onblur` `onsubmit` 等，命名规则是 `on` + 小写事件名。
