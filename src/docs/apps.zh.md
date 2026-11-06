# 开发一个小软件

一个应用 = 两个文本文件 + 一条注册表记录。没有编译步骤：窗口打开时 OSL 脚本先跑，
OML 界面随后挂载，状态一变外壳就重绘。

如果还没读过「OSL — 脚本语言」和「OML — 界面标记」，建议先看那两章；这一章讲怎么真的做出来。

## 1. 应用的结构

```
/usr/share/apps/hello/
  hello.osl      行为：变量、函数、事件处理器
  hello.oml      界面：窗口、容器、按钮、绑定
  app.json       元数据（供参考）
/usr/share/applications/hello.desktop   启动项（内容就是 "hello"）
/etc/apps.json                           应用注册表
```

真正让它能被启动的是注册表里的那条记录：

```json
{
  "id": "hello",
  "name": "Hello",
  "icon": "sparkles",
  "width": 560, "height": 470,
  "minWidth": 420, "minHeight": 360
}
```

- id —— 目录名，也是 .desktop 文件里的内容
- name —— 开始菜单里显示的名字（词库里有对应条目就会翻译）
- icon —— /usr/share/icons 里的任意图标 id
- width/height —— 窗口打开时的尺寸
- minWidth/minHeight —— 拖拽缩小的下限，窗口管理器不会越过它

## 2. 模板应用

Hello 是一个可以通读的完整应用：一个输入框、一个关窗也不丢的计数器、一个日志列表
和三个按钮。从开始菜单打开它，再用语言文档里的「编辑源文件」，或者直接在 IDE 里看源码。

它的脚本：

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

它的界面：

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

可以看到几乎没有「胶水代码」：输入框通过 bind 把值写进 name，标签通过绑定读 count，
按钮调用函数改状态，然后重绘。

## 3. 做自己的应用

1. 在文件管理器里把 /usr/share/apps/hello 复制成 /usr/share/apps/mynotes。

2. 把两个源文件改名为 mynotes.osl 和 mynotes.oml。

3. 用 IDE 打开 /etc/apps.json，加一条记录：

```json
{ "id": "mynotes", "name": "My Notes", "icon": "app-notes",
  "width": 720, "height": 520, "minWidth": 520, "minHeight": 380 }
```

4. 在 IDE 里运行一次，让注册表重新加载：

```osl
sys.reloadApps()
```

应用就会出现在开始菜单、Run 里，也可以固定到任务栏。已经打开的窗口仍然跑旧代码，
改完请关掉重开。

## 4. 窗口

```osl
win.setTitle("My Notes — " + paths.basename(path))
win.size()            # {width, height} 内容区尺寸
win.width()           # 简写
win.minimize()
win.maximize()        # 或 win.toggleMax()
win.setSize(720, 520)
win.center()
win.toggleFullscreen()
win.close()
```

size() 就是一个普通值：在 onRefresh 里读它就能写自适应布局。

```osl
fn onRefresh():
    compact = win.width() < 620
```

用户拖动窗口边缘时内核会重绘应用，所以这个判断是实时生效的 —— 计算器从基础键盘
变成科学键盘就是这么做的。

一定要给应用设置布局能承受的 minWidth/minHeight，窗口管理器不会缩到比它更小。

## 5. 状态与持久化

三个存数据的地方，从最轻到最持久：

- 变量 —— 窗口关掉就没了
- store.set("key", value) / store.get("key") —— 刷新浏览器也还在
- fs.write / fs.writeJson 写真实文件 —— 文件管理器里看得见，能分享

用户会在意的东西请写 JSON 文件：

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

属于整个系统的设置走 sys.setSetting，读取用 sys.settings().get("名字")。

## 6. 列表与选中

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

- key 让行保持稳定，请用不会变的值（id 或时间戳）
- 选中项用一个变量记录，靠 class 绑定画出来
- 同样的模式适用于标签页、列表、表格、树

## 7. 对话框、菜单、通知

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

菜单项字段：label、icon、id、danger、sep、kbd、cascade。回调收到的是菜单项本身，
用 item.get("id") 取出动作。

## 8. 图标与翻译

图标就是文件：把 SVG 放进 /usr/share/icons/my-icon.svg，然后按名字引用。OML 里的
字面文本和 OSL 里的 t() 字符串都是消息 id —— 往 /usr/share/i18n/zh.json（或词库文件）
里加一行，界面语言切换时就会跟着变。

```osl
ui.toast(t("{0} notes saved", len(notes)), "save")
```

## 9. 调试

- print(...) 和 console.log(...) 输出到开发者控制台；IDE 运行文件时会在 OUTPUT 面板里显示。
- sys.log("info", "message") 往 Logs 应用里写一条。
- 脚本语法错误时窗口顶部会出现红框和调用栈，看行号。
- 绑定抛异常时那一处渲染为空，控制台里有记录。
- sys.runScript(源码) 会执行一段代码并返回 {ok, output, error}，适合当草稿纸。

## 10. 发布

- 桌面图标：在 /home/user/Desktop 新建一个 .desktop 文件，内容写应用 id；或者桌面右键「新建快捷方式」。
- 任务栏：右键正在运行的应用，选「固定到任务栏」。
- 文档：放进 /usr/share/apps 就等于装进系统；开发阶段也可以放在 /home/user/Projects，从 IDE 里跑。

> 记住重绘模型：处理器只改变量，绑定负责重画界面。如果界面没更新，多半是你改的变量
> 并不是绑定在读的那个。
