# OML — 界面标记

OML（Origin Markup Language）描述应用长什么样。它是一门类似 XML 的小语言：
元素变成 DOM 节点，{表达式} 变成活绑定，事件调用配套 OSL 脚本里的函数。

每个应用都是一对文件：app.oml 负责界面，app.osl 负责行为。脚本先运行，
界面随后挂载，之后每次交互都会触发处理器并重绘一次。

## 1. 根元素

```oml
<Window title="Calculator" icon="app-calc">
  <VBox class="calc">
    ...
  </VBox>
</Window>
```

Window 就是应用窗口。title 是窗口标题（会被翻译），icon 是图标 id（来自
/usr/share/icons 或内置图标集）。每个应用文件的根元素必须是 Window。

## 2. 绑定

花括号里是 OSL 表达式，每次重绘都会重新求值：

```oml
<Label text="{display}"/>
<Button text="{sci ? 'Basic' : 'Scientific'}" onclick="toggleMode()"/>
<Icon name="{it.icon}" size="22"/>
```

绑定可以写在任何属性值里，所以 text、class、style、title、data-* 都能动态。
事件处理器是 OSL 语句而不是表达式：onclick="press('=')"、
onclick="select(it, event)"。

不含花括号的字面量会被当成翻译键：<Label text="Files"/> 会去词库里查 "Files"。
需要动态文本请显式写 t()：text="{t('{0} files', count)}"。

## 3. 条件渲染

if 会挂载/卸载整棵子树。条件变假时元素被移除，它内部的状态也一起消失。

```oml
<VBox class="empty" if="{len(items) == 0}">
  <Label text="Nothing here yet"/>
</VBox>
<Grid class="calc-sci" if="{sci}">
  ...
</Grid>
```

visible 只切换显示，元素（和输入框里的内容）会保留：

```oml
<Input visible="{editing}" bind="draft"/>
```

OML 没有 if/elif/else 结构，用多组互斥条件的 if 来表达分支。

## 4. 列表

```oml
<For each="items" as="it" key="it.id" index="i">
  <Button class="row {it.id == sel ? 'sel' : ''}" onclick="pick(it.id)">
    <Label text="{it.name}"/>
  </Button>
</For>
```

- each —— 列表（或字典），主体按条重复
- as —— 主体里代表当前条的变量名（默认 item）
- index —— 序号（默认 i）
- key —— 身份标识。带 key 时按 key 复用 DOM（输入焦点、滚动位置都能保住）；
  不带 key 则数据一变整表重建 —— 小静态列表无所谓，编辑器类界面会很难用。

## 5. 元素

容器：VBox Column HBox Row Grid Stack Panel Center Scroll Card List
Toolbar StatusBar Div Box Spacer Spring

文本：Label Text Title Subtitle Muted Badge Kbd Divider

控件：Button IconButton Icon Image Input TextArea Select Checkbox Switch
Slider Progress

特殊：Modal（对话框遮罩）、TerminalView（真终端）、CodeEditor（带高亮的文本框）

未知标签会渲染成普通 div，所以写错名字不会炸，只是没有效果。

## 6. 属性速查

布局属性 —— 对应 CSS，纯数字按像素处理：

- gap="8" —— flex 间距
- pad / padding="12 16" —— 内边距（空格分隔）
- px / py —— 只设置水平或垂直内边距
- flex="1" —— 可伸缩；固定宽度侧栏用 flex="0 0 200px"
- align / justify —— flex 对齐（start end center between around evenly stretch）
- wrap="true"
- cols / rows —— Grid 的列/行；cols="3" 或完整 CSS 轨道
- width / height / minw / maxw / minh / maxh
- radius / bg / overflow / z

状态属性：

- if / visible —— 见上一节
- class —— 追加样式类，支持绑定
- style —— 行内样式，支持绑定
- variant —— primary | ghost | danger（追加 .primary/.ghost/.danger）
- disabled="{busy}"

控件属性：

- Button：icon、text、variant
- IconButton：icon、title
- Icon：name、size
- Image：src、alt、visible
- Input：bind、placeholder、type、focus="true"
- TextArea：bind、placeholder、spellcheck
- Select：bind、options="a|b|c" 或 "value:Label|..."
- Checkbox / Switch：bind
- Slider：bind、min、max、step
- Progress：value="0..100"
- CodeEditor：bind、lang="osl" | "oml"
- TerminalView：无属性

双向绑定 bind="变量名"，控件值会写回 OSL 变量并触发重绘：

```oml
<Input bind="query" placeholder="Search…" oninput="doSearch()"/>
<Switch bind="notifyMe" onchange="save()"/>
<Slider bind="volume" min="0" max="100" oninput="apply()"/>
```

## 7. 事件

任何 DOM 事件名都可以用，前面加 on。处理器是一条 OSL 语句，里面可以直接用
隐式事件对象 event。

常用：onclick ondblclick onmousedown onmouseup onmousemove onmouseenter
onmouseleave oncontextmenu onwheel oninput onchange onkeydown onkeyup onload

```oml
<Button text="Delete" variant="danger" onclick="remove(sel, event)"/>
<Input onkeydown="onKey(event)"/>
<Div class="stage" onwheel="zoom(event)" onmousedown="panStart(event)"/>
<Image src="{src}" onload="onLoad(event)"/>
```

事件对象字段：

| 字段 | 含义 |
| :--- | :--- |
| type | DOM 事件名 |
| target | 触发事件的元素 |
| x、y | 指针的视口坐标 |
| button | 0 左键、1 中键、2 右键 |
| deltaX、deltaY | 滚轮增量 |
| key、code | 键盘输入 |
| value、checked | 控件的当前值 |
| shift、ctrl、alt、meta | 修饰键 |
| rect | 绑定元素的 {left, top, width, height, right, bottom} |
| dragSource | 拖放时来源元素的 drag-data |
| prevent() | 阻止默认行为 |
| stop() | 阻止冒泡 |

处理器执行完，窗口自动重绘。你不需要（也不能）从 OSL 直接改 DOM：改状态变量，
让绑定去更新界面。

## 8. 样式

优先用类名，外壳已经把视觉语言定义好了。

```oml
<VBox class="ui-card set-card">
  <Label class="set-name" text="Wallpaper"/>
  <Label class="set-desc" text="Pick a picture for the desktop."/>
</VBox>
```

常用类：ui-card、ui-badge、ui-divider、ui-muted、side-item、tile、row、empty、
md（markdown 容器）、md-h1/h2/h3、md-p、md-li、md-code。

一次性的几何位置可以直接写行内样式，也可以绑定：

```oml
<Div class="marquee" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px"/>
```

## 9. 拖放

```oml
<Button draggable="true" drag-data="{item.id}" ondrop="dropOn(item, event)">
```

draggable 让元素变成拖拽源，drag-data 是携带的数据；带 ondrop 的元素会自动
获得 dragover 处理。在 drop 处理器里用 event.dragSource 取数据。

## 10. 常见版式

工具栏 + 可滚动主体：

```oml
<VBox flex="1" class="app">
  <HBox class="bar">
    <Button icon="plus" text="New" onclick="add()"/>
    <Spacer/>
    <Label class="hint" text="{t('{0} items', len(items))}"/>
  </HBox>
  <Scroll class="body" flex="1">
    <For each="items" as="it" key="it.id">...</For>
  </Scroll>
</VBox>
```

侧栏 + 内容：

```oml
<HBox class="split">
  <VBox class="side" width="200">...</VBox>
  <VBox class="main" flex="1">...</VBox>
</HBox>
```

卡片网格：

```oml
<Grid class="tiles" cols="repeat(auto-fill, minmax(108px, 1fr))">
  <For each="entries" as="f">...</For>
</Grid>
```

自己做一个对话框（盖在窗口里）：

```oml
<Modal title="Rename" if="{renaming}">
  <Input bind="draft" focus="true" onkeydown="confirmKey(event)"/>
  <HBox class="modal-actions">
    <Button text="Cancel" onclick="cancel()"/>
    <Button text="OK" variant="primary" onclick="confirm()"/>
  </HBox>
</Modal>
```

## 11. 重绘模型

没有手动改 DOM 这回事。一次重绘会重新求值所有绑定和 if、重建数据变化的 For
列表，并先调用脚本里的 onRefresh 钩子（如果有），让你在绘制前算好派生数据。

```osl
fn onRefresh():
    sci = win.size().get("width") >= 460
```

重绘会合并到下一帧执行，所以一个处理器里调用多次 refresh() 也只画一次。

## 12. 容易踩的坑

- 属性值里的引号要换一种：text="{a == 'x' ? 'y' : 'z'}"。
- 别在绑定里调用有副作用的函数 —— 每次重绘都会执行。
- 不带 key 的 For 会重建行：里面有输入框时每次输入都会丢焦点。
- 绑定抛异常时那一处渲染成空，去 Logs 应用看错误。
- Scroll 套 Scroll 通常意味着内层没有高度：给它 minh 或 maxh。
