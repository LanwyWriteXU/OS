# 布局与样式

OML 只提供少量布局属性，其余交给 CSS 类。这样组件语义保持干净，视觉细节集中
在 `src/styles`。

## 布局属性

| 属性 | CSS 结果 | 说明 |
| --- | --- | --- |
| `gap` | `gap` | 子元素间距，纯数字自动补 `px` |
| `pad` / `padding` | `padding` | 支持 `pad="8 12"` |
| `px` / `py` | 左右 / 上下内边距 | |
| `flex` | `flex` | `flex="1"` 展开为 `1 1 0%` |
| `align` | `align-items` | `start end center stretch baseline` 等简写 |
| `justify` | `justify-content` | `between around evenly` 等简写 |
| `wrap` | `flex-wrap` | `wrap="true"` |
| `cols` / `rows` | `grid-template-*` | 数字会展开成 `repeat(n, minmax(0,1fr))` |
| `width` `height` `minw` `maxw` `minh` `maxh` | 对应尺寸 | 数字补 `px`，`100%` 等原样 |
| `radius` `bg` `overflow` `z` | 对应 CSS | |

```xml
<HBox pad="10 14" gap="8" align="center">
  <Label text="标题" flex="1"/>
  <Button text="确定" variant="primary"/>
</HBox>
```

`HBox` 默认 `gap: 6px`，这是为了避免相邻按钮贴在一起；需要紧凑排列时显式写
`gap="0"` 或用自有类覆盖。

## class 与 variant

```xml
<Button class="side-item {active ? 'active' : ''}" text="外观"/>
<Button variant="primary" text="保存"/>
<Button variant="danger" text="删除"/>
<Button variant="ghost" text="取消"/>
```

- `class` 会追加到组件初始类名之后，支持插值，可用来做选中态。
- `variant` 只会加一个类名：`primary` / `danger` / `ghost`。

## style

```xml
<Div style="left:{menuX}px"/>
<Label style="width:auto;flex:1;text-align:left"/>
```

内联样式与元素初始样式合并；含插值时每次刷新重新计算。样式表优先使用
CSS 变量，不要在 OML 里硬编码颜色。

## 设计令牌

`src/styles/base.css` 定义了主题变量，随 `body[data-theme]` 切换：

| 变量 | 用途 |
| --- | --- |
| `--bg` `--surface` `--surface-2` `--surface-3` | 背景层级 |
| `--text` `--muted` | 文字 |
| `--border` `--border-strong` | 边框 |
| `--hover` `--active` | 交互态 |
| `--accent` `--accent-2` | 强调色（设置面板可改） |
| `--radius` `--radius-sm` | 圆角 |
| `--shadow` `--shadow-sm` | 阴影 |
| `--font` `--mono` | 字体 |

```css
.my-badge {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
}
```

## 全局外观开关

`body` 上有两个属性由设置驱动：

- `data-theme="dark|light"`
- `data-style="win|mac"`

样式可以据此切换窗口装饰，例如：

```css
body[data-style="mac"] .win-btn { border-radius: 50%; }
```

壁纸通过 `.wall-<名称>` 类实现，`<VBox class="shell wall-{wallpaper}">` 一行
即可切换。

## 常用类

| 类 | 用途 |
| --- | --- |
| `ui-card` | 卡片容器 |
| `side-item` | 侧栏条目（选中态加 `active`） |
| `seg` | 分段控件容器，内部按钮加 `on` 表示选中 |
| `set-row` / `set-info` / `set-name` / `set-desc` | 设置项排版 |
| `empty` | 空状态 |
| `ui-muted` | 弱化文字 |
| `tile` / `row` | 文件管理器的网格项与列表行 |

## 排版约定

- 设置类的行使用 `<HBox class="set-row">`，左信息区 `flex="1"`，右侧控件固定宽度。
- 工具条使用 `<HBox class="editor-bar">` 之类的专用类，高度与内边距已在 CSS 中统一。
- 按钮组放在 `HBox` 里即可获得 6px 间距；需要贴合的分段控件用 `.seg`。
