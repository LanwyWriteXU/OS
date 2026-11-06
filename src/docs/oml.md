# OML — the interface markup

OML (Origin Markup Language) describes what an application looks like. It is a
small XML-like dialect: elements become DOM nodes, {expressions} become live
bindings, and events call functions defined in the accompanying OSL script.

Every application is a pair of files: app.oml for the layout and app.osl for the
behaviour. The OSL runs first, the markup is mounted second, and from then on
every event triggers a handler plus a repaint.

## 1. The root element

```oml
<Window title="Calculator" icon="app-calc">
  <VBox class="calc">
    ...
  </VBox>
</Window>
```

Window opens the application window. title is the window caption (translated),
icon is an icon id from /usr/share/icons or the built-in set. The root element
of every app file must be a Window.

## 2. Bindings

Anything in braces is an OSL expression, evaluated on every repaint:

```oml
<Label text="{display}"/>
<Button text="{sci ? 'Basic' : 'Scientific'}" onclick="toggleMode()"/>
<Icon name="{it.icon}" size="22"/>
```

Bindings work inside attribute values, so text, class, style, title and any
data-* attribute can be dynamic. Handlers are OSL statements, not expressions:
onclick="press('=')" or onclick="select(it, event)".

Text that contains no braces is treated as a translation key: <Label text="Files"/>
looks up "Files" in the catalogue. Write dynamic text with t() explicitly:
text="{t('{0} files', count)}".

## 3. Conditional rendering

if mounts and unmounts a subtree. When the condition turns false the element is
removed and its state with it.

```oml
<VBox class="empty" if="{len(items) == 0}">
  <Label text="Nothing here yet"/>
</VBox>
<Grid class="calc-sci" if="{sci}">
  ...
</Grid>
```

visible only toggles display and keeps the element (and its input state) alive:

```oml
<Input visible="{editing}" bind="draft"/>
```

if/elif/else as markup is expressed with several if/if elements, e.g. one per
branch with an exclusive condition.

## 4. Lists

```oml
<For each="items" as="it" key="it.id" index="i">
  <Button class="row {it.id == sel ? 'sel' : ''}" onclick="pick(it.id)">
    <Label text="{it.name}"/>
  </Button>
</For>
```

- each — a list (or dict); the body is repeated per item
- as — the item name inside the body (default: item)
- index — the position (default: i)
- key — identity. With key, rows are reconciled and their DOM survives updates
  (input focus, scroll). Without it the whole list is rebuilt whenever the data
  changes — fine for small static lists, bad for editors.

## 5. Elements

Containers: VBox Column HBox Row Grid Stack Panel Center Scroll Card List
Toolbar StatusBar Div Box Spacer Spring

Text: Label Text Title Subtitle Muted Badge Kbd Divider

Controls: Button IconButton Icon Image Input TextArea Select Checkbox Switch
Slider Progress

Special: Modal (a dialog overlay), TerminalView (a live shell), CodeEditor
(syntax-highlighted textarea)

Any unknown tag renders as a plain div, so you cannot break the layout by
inventing a name — it just will not do anything.

## 6. Attribute reference

Layout attributes — they map to CSS and accept bare numbers as pixels:

- gap="8" — flex gap
- pad / padding="12 16" — padding (space separated)
- px / py — horizontal or vertical padding only
- flex="1" — grow and shrink; flex="0 0 200px" for a fixed rail
- align / justify — flex alignment (start end center between around evenly stretch)
- wrap="true"
- cols / rows — Grid columns/rows; cols="3" or a full CSS track list
- width / height / minw / maxw / minh / maxh
- radius / bg / overflow / z

State attributes:

- if / visible — see above
- class — extra CSS classes; supports bindings
- style — inline CSS; supports bindings
- variant — primary | ghost | danger (adds .primary/.ghost/.danger)
- disabled="{busy}"

Widget attributes:

- Button: icon, text, variant
- IconButton: icon, title
- Icon: name, size
- Image: src, alt, visible (src accepts a data URL or a VFS path resolved by the app)
- Input: bind, placeholder, type, focus="true"
- TextArea: bind, placeholder, spellcheck
- Select: bind, options="a|b|c" or "value:Label|..."
- Checkbox / Switch: bind
- Slider: bind, min, max, step
- Progress: value="0..100"
- CodeEditor: bind, lang="osl" | "oml"
- TerminalView: no attributes

Two-way binding, bind="name", writes the widget value back into an OSL variable
and repaints:

```oml
<Input bind="query" placeholder="Search…" oninput="doSearch()"/>
<Switch bind="notifyMe" onchange="save()"/>
<Slider bind="volume" min="0" max="100" oninput="apply()"/>
```

## 7. Events

Any DOM event name works: prefix it with on. The handler receives the OSL
statement with an implicit event object available as event.

Common: onclick ondblclick onmousedown onmouseup onmousemove onmouseenter
onmouseleave oncontextmenu onwheel oninput onchange onkeydown onkeyup onload

```oml
<Button text="Delete" variant="danger" onclick="remove(sel, event)"/>
<Input onkeydown="onKey(event)"/>
<Div class="stage" onwheel="zoom(event)" onmousedown="panStart(event)"/>
<Image src="{src}" onload="onLoad(event)"/>
```

The event object:

| field | meaning |
| :--- | :--- |
| type | the DOM event name |
| target | the element that fired it |
| x, y | pointer position in viewport pixels |
| button | 0 left, 1 middle, 2 right |
| deltaX, deltaY | wheel deltas |
| key, code | keyboard input |
| value, checked | current control value |
| shift, ctrl, alt, meta | modifier keys |
| rect | {left, top, width, height, right, bottom} of the bound element |
| dragSource | payload of the dragged element on drop |
| prevent() | preventDefault |
| stop() | stopPropagation |

Handlers run, then the window repaints automatically. You never touch the DOM
from OSL: change variables and let the bindings do the work.

## 8. Styling

Prefer classes; the shell already defines the visual language.

```oml
<VBox class="ui-card set-card">
  <Label class="set-name" text="Wallpaper"/>
  <Label class="set-desc" text="Pick a picture for the desktop."/>
</VBox>
```

Useful existing classes: ui-card, ui-badge, ui-divider, ui-muted, side-item,
tile, row, empty, md (markdown), md-h1/h2/h3, md-p, md-li, md-code.

Inline style is fine for one-off geometry, and it can be bound:

```oml
<Div class="marquee" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px"/>
```

## 9. Drag and drop

```oml
<Button draggable="true" drag-data="{item.id}" ondrop="dropOn(item, event)">
```

draggable makes the element a drag source and drag-data is the payload; an
element with ondrop also gets an automatic dragover handler. In the drop
handler, event.dragSource holds the payload.

## 10. Layout recipes

Toolbar over a scrolling body:

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

Sidebar plus content:

```oml
<HBox class="split">
  <VBox class="side" width="200">...</VBox>
  <VBox class="main" flex="1">...</VBox>
</HBox>
```

Card grid:

```oml
<Grid class="tiles" cols="repeat(auto-fill, minmax(108px, 1fr))">
  <For each="entries" as="f">...</For>
</Grid>
```

A dialog of your own (inside the window):

```oml
<Modal title="Rename" if="{renaming}">
  <Input bind="draft" focus="true" onkeydown="confirmKey(event)"/>
  <HBox class="modal-actions">
    <Button text="Cancel" onclick="cancel()"/>
    <Button text="OK" variant="primary" onclick="confirm()"/>
  </HBox>
</Modal>
```

## 11. The refresh model

There is no manual DOM update. A repaint re-evaluates every binding and every if,
rebuilds For lists whose data changed, and calls the script's onRefresh hook
first (if defined) so you can derive data before it is drawn.

```osl
fn onRefresh():
    sci = win.size().get("width") >= 460
```

Repaints are scheduled on the next animation frame, so calling refresh() several
times in one handler costs one paint.

## 12. Pitfalls

- Attribute values with quotes need the other quote style: text="{a == 'x' ? 'y' : 'z'}".
- Do not put function calls with side effects into bindings — they run on every
  repaint.
- For without key rebuilds rows: text inputs inside lose focus on every change.
- A binding that throws renders empty; check the Logs app for the error.
- Nesting Scroll inside Scroll usually means one of them has no height: give the
  inner one minh or maxh.
