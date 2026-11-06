# Building an application

An application is two text files and one registry entry. There is no compiler:
the OSL script runs when the window opens, the OML markup is mounted on top of
it, and the shell repaints whenever state changes.

Read OSL — scripting and OML — interface first if you have not; this chapter is
the practical walkthrough.

## 1. Anatomy

```
/usr/share/apps/hello/
  hello.osl      behaviour: variables, functions, event handlers
  hello.oml      interface: windows, boxes, buttons, bindings
  app.json       metadata, for reference
/usr/share/applications/hello.desktop   launcher entry (content: "hello")
/etc/apps.json                            the app registry
```

The registry entry is what makes an app launchable:

```json
{
  "id": "hello",
  "name": "Hello",
  "icon": "sparkles",
  "width": 560, "height": 470,
  "minWidth": 420, "minHeight": 360
}
```

- id — the folder name and the .desktop content
- name — shown in the start menu (translated when a catalogue entry exists)
- icon — any icon id from /usr/share/icons
- width/height — the size the window opens with
- minWidth/minHeight — the floor the resize handles stop at

## 2. The template app

Hello is a working app you can read end to end: a text field, a counter that
survives a reload, a log list and three buttons. Open it from the start menu,
then open its source with the Edit source button in Language Docs, or from the
IDE.

Its script:

```osl
let name = "world"
let count = 0
let log = []
let file = "/home/user/Documents/hello.json"

if fs.exists(file):
    let saved = fs.readJson(file)
    if saved != None:
        count = saved.get("count", 0)

fn save():
    fs.writeJson(file, {"count": count})

fn bump():
    count += 1
    log.append(t("Clicked") + " ×" + str(count))
    save()
    refresh()

fn greet():
    log.append(t("Hello") + ", " + name + "!")
    refresh()
```

and its markup:

```oml
<Window title="Hello" icon="sparkles">
  <VBox class="hello" pad="16" gap="12">
    <Label class="ui-title" text="Hello, OSL"/>
    <HBox gap="8" align="center">
      <Input bind="name" placeholder="Your name" flex="1"/>
      <Button text="Greet" variant="primary" onclick="greet()"/>
    </HBox>
    <HBox gap="8" align="center">
      <Label text="{t('{0} clicks', count)}" flex="1"/>
      <Button icon="plus" text="Click me" onclick="bump()"/>
    </HBox>
    <Scroll class="hello-log" flex="1">
      <For each="log" as="line">
        <Label class="hello-line" text="{line}"/>
      </For>
    </Scroll>
  </VBox>
</Window>
```

Note how little glue there is: the input writes its value into name through bind,
the label reads count through a binding, and the buttons call functions that
mutate state and repaint.

## 3. Making your own app

1. In Files, copy /usr/share/apps/hello into /usr/share/apps/mynotes.

2. Rename the two source files to mynotes.osl and mynotes.oml.

3. Edit /etc/apps.json (open it in the IDE) and add an entry:

```json
{ "id": "mynotes", "name": "My Notes", "icon": "app-notes",
  "width": 720, "height": 520, "minWidth": 520, "minHeight": 380 }
```

4. Run this once in the IDE to re-read the registry:

```osl
sys.reloadApps()
```

The app now appears in the start menu, in Run, and can be pinned to the taskbar.
A window that is already open keeps the code it started with — close and reopen
it after editing.

## 4. The window

```osl
win.setTitle("My Notes — " + paths.basename(path))
win.size()            # {width, height} of the content area
win.width()           # shortcut
win.minimize()
win.maximize()        # or win.toggleMax()
win.setSize(720, 520)
win.center()
win.toggleFullscreen()
win.close()
```

size() is a normal value: read it in onRefresh to build responsive layouts.

```osl
fn onRefresh():
    compact = win.width() < 620
```

The kernel repaints an app whenever its window is resized, so this switches live
while the user drags the corner. That is exactly how the calculator turns from a
basic keypad into a scientific one.

Always set a minWidth/minHeight that your layout can survive; the window manager
will not resize below it.

## 5. State and storage

Three places to keep data, from cheapest to most durable:

- variables — gone when the window closes
- store.set("key", value) / store.get("key") — survives reloads, per browser
- fs.write / fs.writeJson in a real file — visible in Files, shareable

Prefer a JSON file for anything the user would be sad to lose:

```osl
let dataFile = "/home/user/Documents/mynotes.json"
let notes = fs.exists(dataFile) ? fs.readJson(dataFile) : []

fn save():
    fs.writeJson(dataFile, notes)

fn add(text):
    notes.append({"text": text, "at": time.now()})
    save()
    refresh()
```

Settings that belong to the whole system go through sys.setSetting, and are read
back with sys.settings().get("name").

## 6. Lists and selection

```oml
<Scroll flex="1">
  <For each="notes" as="n" index="i" key="n.at">
    <HBox class="row {i == sel ? 'sel' : ''}" onclick="select(i)">
      <Label text="{n.get('text')}" flex="1"/>
      <IconButton icon="x" title="Delete" onclick="remove(i)"/>
    </HBox>
  </For>
</Scroll>
```

- key keeps rows stable; use a value that does not change (an id or a timestamp)
- keep the selected index in a variable and paint it with a class binding
- the same pattern works for tabs, lists, tables and trees

## 7. Dialogs, menus, notifications

```osl
ui.alert("Saved to " + dataFile, "My Notes")
ui.confirm("Delete this note?", doDelete, "Delete")
ui.prompt("New note", "", createNote)
ui.toast("Saved", "save")
ui.menu([
    {"label": "Open", "id": "open"},
    {"sep": True},
    {"label": "Delete", "id": "delete", "danger": True},
], menuPick, 200, 160)
```

menu items: label, icon, id, danger, sep, kbd, cascade. The callback receives the
item; read the id with item.get("id").

## 8. Icons and translation

Icons are files: drop an SVG into /usr/share/icons/my-icon.svg and reference it by
name. OML literal text and OSL t() strings are message ids — add a line to
/usr/share/i18n/zh.json (or to the catalogue file) and the string follows the UI
language.

```osl
ui.toast(t("{0} notes saved", len(notes)), "save")
```

## 9. Debugging

- print(...) and console.log(...) go to the developer console; the IDE shows them
  in its OUTPUT panel when you run the file.
- sys.log("info", "message") adds an entry to the Logs app.
- A syntax error in the script leaves a red box at the top of the window with the
  stack — read the line number.
- A binding that throws renders empty and logs to the console.
- sys.runScript(source) runs a snippet and returns {ok, output, error}; handy for
  a scratchpad.

## 10. Shipping it

- Desktop icon: create a .desktop file in /home/user/Desktop whose content is the
  app id, or right-click the desktop and pick New shortcut.
- Taskbar: right-click the running app and choose Pin to taskbar.
- Docs: put the app in /usr/share/apps so it is part of the system, or keep it in
  /home/user/Projects and run it from the IDE while developing.

> Remember the repaint model: handlers change variables, and the bindings redraw
> the interface. If something does not update, the variable you changed is not
> the one a binding reads.
