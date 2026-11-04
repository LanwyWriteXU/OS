# 绑定、事件与列表

## 插值

```xml
<Label text="共 {count} 个文件"/>
<Label text="{title}"/>
<Icon name="{item.icon}" size="18"/>
```

- `{expr}` 会被求值并按 OSL 的字符串化规则拼接。
- `{{` 与 `}}` 表示字面量花括号：

```xml
<Label text="模板写作 {{name}}"/>
```

- 嵌套花括号、字符串里的花括号都能正确匹配：

```xml
<Label text="{t('{0} 项', count)}"/>
```

## 属性绑定

| 属性 | 行为 |
| --- | --- |
| `text` | 内容；`Button` 写入 `.btn-text`，其余写入元素本身 |
| `class` | 与初始 class 合并，可含插值 |
| `style` | 与初始内联样式合并，每次刷新重算 |
| `title` / `placeholder` | 提示文本 / 占位符 |
| `if` | 条件为假时**卸载**整个子树 |
| `visible` | 条件为假时设 `hidden`，元素仍在 DOM 中 |
| `disabled` | 布尔，置灰控件 |
| `value` / `checked` | 单向回填控件状态 |
| `bind` | 双向绑定到变量 |
| 其他 | 没有特殊语义的静态属性直接 `setAttribute` |

### if 与 visible 的区别

```xml
<Modal if="{open}">…</Modal>        <!-- 关闭时不占资源，状态丢失 -->
<Panel visible="{expanded}">…</Panel> <!-- 只是隐藏，保留状态与滚动位置 -->
```

`if` 为假的子树不会被求值、不会绑定事件，适合弹窗、分页；`visible` 适合
需要保留输入内容或滚动位置的场景。

## 事件

```xml
<Button onclick="count += 1"/>
<Button onclick="removeItem(item.id); refresh()"/>
<Input oninput="doSearch()" onkeydown="onKey(event)"/>
```

事件属性的值是**语句块**，不是表达式；多条语句用换行或 `;` 分隔。

`event` 对象可用字段：

| 字段 | 说明 |
| --- | --- |
| `type` | 事件名 |
| `key` `code` | 键盘事件 |
| `value` `checked` | 目标控件的值 |
| `x` `y` | 视口坐标（`clientX/clientY`） |
| `shift` `ctrl` `meta` `alt` | 修饰键 |
| `target` | DOM 元素，可调用 `closest(selector)` |
| `prevent()` `stop()` | 阻止默认行为 / 阻止冒泡 |

事件处理完成后会自动调度一次刷新，不需要手动 `refresh()`。

## 双向绑定

```xml
<Input bind="query" oninput="doSearch()"/>
<TextArea bind="text"/>
<Switch bind="animations" onchange="applyAnimations()"/>
<Slider bind="volume" min="0" max="100"/>
```

`bind` 要求变量已经用 `let` 声明。绑定会同时做两件事：控件变化时写回变量，
刷新时把变量的值回填到控件（值相同则不触碰，避免打断输入）。

## For 列表

```xml
<For each="items" as="item" index="i">
  <HBox class="row" onclick="pick(i)">
    <Icon name="{item.icon}" size="18"/>
    <Label text="{item.name}" flex="1"/>
  </HBox>
</For>
```

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| `each` | `[]` | 表达式，列表或字典（字典遍历值） |
| `as` | `item` | 每一项的变量名 |
| `index` | `i` | 下标变量名 |
| `key` | 无 | 唯一标识表达式，例如 `item.id` |

### 为什么要写 key

带 `key` 时，刷新采用**增量对齐**：

- 相同的 key 复用原有 DOM，只更新绑定；
- 新增 key 只创建新行；
- 消失的 key 移除对应节点。

这样列表里的输入框不会在每次刷新时丢失焦点，滚动位置也不会跳动。

```xml
<For each="entries" as="f" key="f.path">
  <Input bind="f.note"/>
</For>
```

不带 `key` 时按数据签名（序列化结果）判断是否重建整表，数据一变就整体重建，
适合纯展示列表。

key 的值会被转成字符串，必须唯一；重复 key 会导致行被覆盖。

## 文本节点

```xml
<Label>
  第一行
  第二行
</Label>
```

文本节点包含换行时会被 `trim()`，不包含换行时原样保留。因此格式化缩进不会
在界面上留下多余空格，但也意味着不能在纯空白文本节点里表达刻意的前导空格。
需要精确控制请用 `text` 属性。

## 常见错误

| 现象 | 原因 |
| --- | --- |
| `Name 'x' is not defined` | 绑定里用了未声明的变量 |
| 列表每帧重建 | 缺少 `key`，或 `each` 每次返回新结构 |
| 输入框输入时光标跳动 | 在 `For` 中缺少 `key` |
| 隐藏的面板仍在跑逻辑 | 用了 `visible` 而不是 `if` |
