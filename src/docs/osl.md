# OSL — the scripting language

OSL (Origin Software Language) is the language the desktop itself is written in.
The shell, every built-in application and every user script run on the same
interpreter: a small, indentation-based, dynamically typed language with
Python-like syntax and a JavaScript-like library.

An OSL file is plain text. You can create one in Files, open it in the IDE and
press Run (or F5), or execute it from another script with sys.runScript.

## 1. Your first program

```osl
# hello.osl
let name = "world"
print("hello, " + name + "!")
```

print writes to the developer console (the Logs app shows sys.log entries, the
IDE shows print output in its OUTPUT panel). Strings can also be interpolated:

```osl
let n = 3
print(f"{n} squared is {n * n}")
```

## 2. Syntax basics

- Comments start with # and run to the end of the line.
- Blocks are introduced by a colon and indented by spaces. Use 4 spaces, be
  consistent — the indentation is the syntax.
- One statement per line. A trailing ; is tolerated but never needed.
- Names are letters, digits and _ and cannot start with a digit.
- Keywords: let var const fn class if elif else while for in return break
  continue pass and or not True False None try catch except finally raise
  import from as self is do

```osl
fn area(w, h):
    if w <= 0 or h <= 0:
        return 0
    return w * h
```

## 3. Values and types

- int — 42, -7, 0
- float — 3.14, 1.0e9
- str — "text", 'text'
- bool — True / False
- None — the absence of a value
- list — [1, 2, 3]
- dict — {"name": "Ada", "age": 36}
- function — fn(x): ... or x => x * 2
- object — an instance of a class

type(v) returns one of the names above ("int", "float", "str", "bool", "None",
"list", "dict", "function", "class", "error", or the class name).

Truthiness: None, False, 0, "" and empty lists/dicts are false, everything
else is true.

## 4. Variables

```osl
let count = 0        # declares / overwrites
var total = 0        # same as let
const LIMIT = 10     # cannot be reassigned (raises on assignment)
```

Variables are scoped to the enclosing function (or to the whole script at top
level). if/while/for bodies share that scope, so a let inside a branch is still
visible after the branch. Loop variables are bound in the same scope.

```osl
if ready:
    let label = "go"
print(label)         # works: same scope
```

Assignment operators: = += -= *= /= %= **=

## 5. Operators

Arithmetic: + - * / // % **

- / always produces a float (7 / 2 is 3.5)
- // is floor division, % is the remainder, ** is power (right associative)

| expression | result | note |
| :--- | ---: | :--- |
| 7 / 2 | 3.5 | float division |
| 7 // 2 | 3 | floor division |
| 7 % 2 | 1 | remainder |
| 2 ** 10 | 1024 | power |
| "a" + "b" | ab | concatenation |
| [1] + [2] | [1, 2] | list concatenation |

Comparison: == != < <= > >=
Logic: and or not (also && || !)
Membership: x in list, "a" in "abc", key in dict
Identity: a is b (reference comparison)

Conditional expressions — two spellings of the same thing:

```osl
let label = "big" if n > 100 else "small"
let same = n > 100 ? "big" : "small"
```

+ concatenates strings and joins lists; it never converts numbers implicitly,
use str(n) for that.

## 6. Strings

```osl
let a = "plain"
let b = 'single quotes work too'
let c = "escapes: \n \t \\ \" "
let d = """triple quotes keep
newlines as they are"""
let e = f"{a} has {len(a)} characters"
```

f-strings evaluate every {expression} inside the braces.

Methods (all return a new value, none mutate):

- upper() / lower() — case
- strip() / lstrip() / rstrip() — trim whitespace
- split(sep) / join(list) — "a,b".split(",") ⇄ ",".join(list)
- replace(a, b) — replaces every occurrence
- startswith(p) / endswith(p) / contains(p) / find(p, from?)
- count(p) / repeat(n) / capitalize() / title()
- slice(start, end) / charAt(i) / padStart(n, c) / padEnd(n, c)
- format(a, b) — replaces successive {} placeholders: "{} + {}".format(1, 2)

Indexing and slicing:

```osl
let s = "origin"
s[0]        # "o"
s[-1]       # "n"   (negative counts from the end)
s[0:3]      # "ori"
s[:3]       # same
s[3:]       # "gin"
```

Strings are immutable: s[0] = "O" is an error, build a new string instead.

## 7. Lists

```osl
let xs = [1, 2, 3]
xs.append(4)          # in place
xs.insert(0, 0)
xs.pop()              # removes and returns the last item
xs.remove(2)          # removes the first match
xs[1] = 9
len(xs)
xs[1:3]               # slice, returns a new list
```

Methods: append / push / extend / pop / shift / insert / remove / index /
count / sort / reverse / clear / join / slice / map / filter / find / each /
sum / first / last

```osl
let names = ["ada", "linus"]
let upper = map(x => x.upper(), names)
let long = filter(x => len(x) > 3, names)
let total = sum([1, 2, 3])
```

## 8. Dicts

A dict literal is written with braces; it is an insertion-ordered map.

```osl
let user = {"name": "Ada", "age": 36}
user.get("name")        # "Ada"
user.get("mail", "—")   # default value
user.set("age", 37)
user.has("age")
user.keys()             # ["name", "age"]
user.values()
user.items()            # [["name", "Ada"], ["age", 37]]
user.remove("age")
len(user)
```

You can also read a key with dot syntax when the key is a plain identifier:
user.name. Prefer get() when the key may be missing — dot access returns null.

Iterate with for k, v in user: to unpack entries.

## 9. Control flow

```osl
if score > 90:
    grade = "A"
elif score > 75:
    grade = "B"
else:
    grade = "C"

while tries < 3:
    tries += 1
    if skip:
        continue
    if done:
        break

for item in items:
    print(item)

for key, value in user:
    print(key + " = " + str(value))

for i in range(0, 10, 2):
    print(i)
```

pass is a no-op statement for an empty body.

## 10. Functions

```osl
fn greet(name, greeting = "hello"):
    return greeting + ", " + name

fn noop():
    pass
```

- Defaults are evaluated at call time and may be omitted by the caller.
- A function without return yields None; return with no value also yields None.
- Functions are values: pass them to map/filter, store them in dicts.
- Recursion is supported.
- Lambdas: x => x * 2, fn(x) => x * 2, or a block form fn(x): ... indented.
- Functions capture the scope they were defined in (closures).

```osl
let counter = fn():
    let n = 0
    return fn():
        n += 1
        return n
```

## 11. Classes

```osl
class Shape:
    fn init(name):
        self.name = name

    fn area():
        return 0

    fn describe():
        return self.name + ": " + str(self.area())

class Square extends Shape:
    fn init(side):
        self.side = side

    fn area():
        return self.side * self.side

let sq = Square(4)
print(sq.describe())   # Square: 16
```

Methods receive the instance as self automatically; you never pass it. init is
the constructor. extends sets the parent class; methods fall back to the parent
when the child does not define them.

## 12. Errors

```osl
try:
    let data = json.parse(text)
except e:
    print("bad json: " + e.message)
finally:
    busy = False
```

raise ValueError("count must be positive") throws; catch and except are
synonyms. The caught value has .message, .type and .line.

Built-in error constructors: Error, TypeError, ValueError, RangeError.

## 13. Modules

Split code across files and import them by path. The path is a VFS path and
resolves relatives against the importing file.

```osl
# /home/user/Projects/lib/mathx.osl
export fn double(n):
    return n * 2

export let NAME = "mathx"

# /home/user/Projects/app.osl
import "lib/mathx.osl" as mathx
from "lib/mathx.osl" import double, NAME as LIB
print(mathx.double(2), double(4), LIB)
```

Every top-level binding can be imported; export is an optional marker that
documents intent.

The system ships one shared library of its own: /usr/share/os/lib/markdown.osl.
Notes, Preview and the manual all import it to turn Markdown into blocks:

```osl
import "/usr/share/os/lib/markdown.osl" as md
let blocks = md.parse(text)
```

## 14. Standard library

Global functions:

- len(v) — length of a string, list, dict or object
- range(a, b?, step?) — list of numbers
- str(v) / int(v) / float(v) / bool(v) / type(v)
- sum / min / max / abs / round(n, digits?)
- sorted(list, keyFn?) / reversed(list)
- enumerate(list) — [[0, x], [1, y], ...]
- zip(a, b, ...) — pairs
- map(fn, list) / filter(fn, list) / any(list) / all(list)
- chr(n) / ord(s)
- eval(src) — evaluates an OSL expression string and returns its value
- uuid() — random id
- print(...) — console output
- notify(title, body, icon?) — desktop notification
- open(path) — open a file or folder with the default app
- every(ms, fn) — repeats fn forever, returns immediately
- after(ms, fn) — runs fn once, later
- sleep(ms) — accepted for compatibility, does nothing
- t(key, ...) — translate a message id; t("{0} items", n)
- lang() — the active UI language ("en" or "zh")
- refresh() — repaints the current window
- args — the Map of launch arguments passed to sys.open

Namespaces (each is a value with methods):

fs — read write append list mkdir remove rename copy exists isDir stat size
count sizeText readJson writeJson touch search home cwd normalize

paths — join dirname basename extname normalize split home relative

sys — open openPath apps windows focusWindow minimizeWindow closeWindow
notify settings setSetting viewport metrics info version uptime user hostname
battery network storage volume setVolume toggleMute lock power factoryReset
recent touchRecent runScript log logs clearLogs reloadApps

ui — alert confirm prompt toast menu chooseImage refresh

win — setTitle close minimize maximize restore toggleMax setSize move center
toggleFullscreen isFullscreen isMaximized size width height id

time — now format date year parts make intl startOfDay addDays

math — pi e floor ceil round abs sqrt pow min max random randint sign sin cos
tan asin acos atan log log10 exp fact

json — parse stringify

i18n — reload catalog langs

store — get set remove (localStorage-backed, survives reloads)

clip — read write (text clipboard)

console — log warn error (all go to print)

## 15. Recipes

Read and write a file:

```osl
if fs.exists("/home/user/Notes/todo.md"):
    let text = fs.read("/home/user/Notes/todo.md")
fs.write("/home/user/Notes/todo.md", text + "\n- new item")
```

JSON state:

```osl
let state = fs.exists(path) ? fs.readJson(path) : {"count": 0}
state.set("count", state.get("count") + 1)
fs.writeJson(path, state)
```

Timers:

```osl
let ticks = 0
every(1000, fn():
    ticks += 1
    refresh()
)
after(2000, fn(): ui.toast("two seconds passed"))
```

Dialogs and menus:

```osl
ui.confirm("Delete everything?", doDelete, "Delete")
ui.prompt("Your name", "Ada", saveName)
ui.menu([{"label": "Open", "id": "open"}, {"sep": True},
         {"label": "Delete", "id": "del", "danger": True}], onPick, 100, 100)
ui.toast("Saved", "save")
```

Open another window:

```osl
sys.open("notes", {"path": "/home/user/Documents/welcome.md"})
sys.open("files", {"path": "/home/user/Pictures"})
```

## 16. Gotchas

- Indentation is significant. Mixing tabs and spaces breaks the block.
- There is no block scope: a let inside an if survives the if.
- Strings do not auto-convert: 1 + "1" is an error, use str(1) + "1".
- Never busy-wait. sleep() does nothing: use after() and every() instead.
- Dot access on a dict returns null for a missing key; use get() with a default.
- Long loops freeze the whole desktop — the interpreter is single threaded.
- An app script runs once when the window opens; state lives in variables
  until the window is closed.
