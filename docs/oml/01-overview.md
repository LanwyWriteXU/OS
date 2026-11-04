# OML 概览

OML（Origin Markup Language）是一门 XML 方言：标签是组件，属性是参数，
`{...}` 里是 OSL 表达式。

```xml
<Window title="Demo" icon="app-about">
  <VBox pad="18" gap="12">
    <Title text="Hello, OML"/>
    <Label text="You clicked {count} times"/>
    <HBox>
      <Button icon="plus" text="Add" variant="primary" onclick="count += 1"/>
      <Button text="Reset" onclick="reset()"/>
    </HBox>
  </VBox>
</Window>
```

## 文档结构

- 必须有且只有一个根元素（通常是 `<Window>`）。
- 支持 `<!-- 注释 -->`、自闭合 `<Icon/>`、`&amp;` `&#x4e2d;` 等实体。
- 属性值可以用双引号、单引号，或不加引号（不含空白的简单值）。
- 没有命名空间、没有 DTD 校验、没有 `<script>`。

## 挂载与刷新

```
mount(源码, 作用域)
  ├─ parseOml      一次性解析成元素树
  ├─ mountElement  为每个标签创建 DOM 骨架
  └─ 收集 update 函数：属性绑定、文本插值、可见性

refresh()
  ├─ 运行 onRefresh()（若脚本定义）
  ├─ 重新求值全部绑定
  ├─ For 列表按 key 增量更新
  └─ 一个 rAF 内合并多次请求
```

触发刷新的事件源：

- 任意 `on*` 事件处理函数执行完毕
- 脚本调用 `refresh()` / `ui.refresh()`
- 文件系统变更、系统设置变更、窗口增删
- shell 的 1 秒时钟

这是一套**全量刷新**模型：脚本只改变量，不用关心哪些绑定依赖它。代价是
每次刷新都会重算所有 `{...}`，因此绑定里不要写昂贵逻辑；需要缓存的值请在
`onRefresh()` 里算好存进变量。

## 表达式求值

- 属性值整体是 `{expr}` 时，取表达式结果（保持原始类型）。
- 属性值里混有文本时（`"共 {n} 项"`），做字符串插值。
- `on*` 事件的值是一段**语句块**，可写多行，用 `;` 或换行分隔。
- 求值错误不会中断整棵树，而是记录到 `ui.errors` 并打印控制台（同一消息
  1.5 秒内只打印一次）。

## 字面量文本就是消息 id

没有 `{}` 的文本会被当作翻译键：

```xml
<Label text="Files"/>          <!-- 中文环境显示「文件」 -->
<Label text="{appName}"/>      <!-- 动态值不翻译 -->
```

详见 [05-i18n.md](05-i18n.md)。

## 组件即 DOM

每个标签在 `src/oml/widgets.ts` 里映射到一段 DOM 骨架，例如 `Button` 会创建
`<button class="ui-btn"><span class="btn-icon"></span><span class="btn-text"></span></button>`。
子节点被追加到组件的 children host（`Modal` 是 `.modal-body`，其余是元素本身）。

未知标签不会崩溃：控制台给出警告，并渲染成 `<div class="oml-标签名">`。
