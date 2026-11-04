/**
 * OS — Virtual File System
 * An in-memory tree mirrored into IndexedDB. Reads are synchronous so that the
 * OSL interpreter and the shell keep a simple, blocking programming model.
 */

export type NodeType = 'dir' | 'file';

export interface FsNode {
  path: string;
  name: string;
  type: NodeType;
  content: string;
  mtime: number;
  ctime: number;
  mode: string;
}

const DB_NAME = 'os-vfs';
const STORE = 'nodes';
const DB_VERSION = 1;

/* ------------------------------------------------------------------ paths */

export function normalizePath(input: string, cwd = '/'): string {
  let p = (input ?? '').trim();
  if (p === '' || p === '.') p = cwd;
  if (p === '~') p = '/home/user';
  if (p.startsWith('~/')) p = '/home/user/' + p.slice(2);
  if (!p.startsWith('/')) p = cwd.replace(/\/$/, '') + '/' + p;
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return '/' + out.join('/');
}

export function joinPath(...parts: string[]): string {
  const joined = parts.filter((p) => p !== undefined && p !== null && p !== '').join('/');
  return normalizePath(joined.replace(/\/{2,}/g, '/'));
}

export function dirname(p: string): string {
  const n = normalizePath(p);
  if (n === '/') return '/';
  const i = n.lastIndexOf('/');
  return i <= 0 ? '/' : n.slice(0, i);
}

export function basename(p: string): string {
  const n = normalizePath(p);
  if (n === '/') return '/';
  return n.slice(n.lastIndexOf('/') + 1);
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i + 1).toLowerCase();
}

export function splitPath(p: string): string[] {
  const n = normalizePath(p);
  return n === '/' ? [] : n.slice(1).split('/');
}

/* ------------------------------------------------------------------- vfs */

export class Vfs {
  nodes = new Map<string, FsNode>();
  private db: IDBDatabase | null = null;
  private listeners = new Set<() => void>();
  private writeQueue = new Map<string, FsNode>();
  private flushTimer: any = null;

  async init(): Promise<void> {
    this.db = await this.openDb();
    const stored = await this.readAll();
    this.nodes.clear();
    for (const n of stored) this.nodes.set(n.path, n);
    if (this.nodes.size === 0) {
      this.seed();
      await this.flushNow();
    }
    // the root and home tree must always exist
    if (!this.nodes.has('/')) {
      const now = Date.now();
      const root: FsNode = { path: '/', name: '/', type: 'dir', content: '', mtime: now, ctime: now, mode: 'rwxr-xr-x' };
      this.nodes.set('/', root);
      this.queueWrite(root);
    }
    for (const d of ['/home', '/home/user', '/tmp', '/etc']) this.mkdir(d, true, true);
    this.ensureDesktop();
    this.ensureWorkspace();
    this.ensureBasics();
  }

  /** Sample project that the IDE opens on first launch. */
  private ensureWorkspace() {
    const dir = '/home/user/Projects';
    const marker = '/etc/workspace-seed';
    this.mkdir(dir, true, true);
    this.mkdir(`${dir}/lib`, true, true);
    const version = '2';
    if (this.exists(marker) && this.read(marker).trim() === version) return;
    const files: Array<[string, string]> = [
      [`${dir}/app.osl`, WORKSPACE_APP],
      [`${dir}/lib/mathx.osl`, WORKSPACE_LIB],
    ];
    for (const [path, content] of files) if (!this.exists(path)) this.write(path, content);
    this.write(marker, version);
  }

  /**
   * The desktop is a normal folder. Its contents — including `.desktop`
   * shortcut files — are what the shell renders as icons.
   */
  private ensureDesktop() {
    const dir = '/home/user/Desktop';
    this.mkdir(dir, true, true);
    const marker = '/etc/desktop-seed';
    const version = '4';
    if (this.exists(marker) && this.read(marker).trim() === version) return;
    const shortcuts: Array<[string, string]> = [
      ['Files.desktop', 'files'],
      ['Terminal.desktop', 'terminal'],
      ['Editor.desktop', 'editor'],
      ['IDE.desktop', 'ide'],
      ['Notes.desktop', 'notes'],
      ['Settings.desktop', 'settings'],
    ];
    for (const [name, id] of shortcuts) {
      const p = `${dir}/${name}`;
      if (!this.exists(p)) this.write(p, id);
    }
    if (!this.exists(`${dir}/Read me.md`)) this.write(`${dir}/Read me.md`, DESKTOP_README);
    this.write(marker, version);
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'path' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private readAll(): Promise<FsNode[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve([]);
      const tx = this.db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as FsNode[]);
      req.onerror = () => reject(req.error);
    });
  }

  private queueWrite(node: FsNode) {
    this.writeQueue.set(node.path, node);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, 40);
  }

  private queueDelete(path: string) {
    if (!this.db) return;
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(path);
  }

  async flushNow(): Promise<void> {
    if (!this.db || this.writeQueue.size === 0) return;
    const items = [...this.writeQueue.values()];
    this.writeQueue.clear();
    await new Promise<void>((resolve) => {
      const tx = this.db!.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const n of items) store.put(n);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /* ------------------------------------------------------------- queries */

  get(path: string): FsNode | undefined {
    return this.nodes.get(normalizePath(path));
  }

  exists(path: string): boolean {
    return this.nodes.has(normalizePath(path));
  }

  isDir(path: string): boolean {
    return this.get(path)?.type === 'dir';
  }

  stat(path: string): FsNode {
    const n = this.get(path);
    if (!n) throw new Error(`No such file or directory: ${path}`);
    return n;
  }

  read(path: string): string {
    const n = this.stat(path);
    if (n.type === 'dir') throw new Error(`Is a directory: ${path}`);
    return n.content;
  }

  list(path: string): FsNode[] {
    const dir = normalizePath(path);
    const n = this.stat(dir);
    if (n.type !== 'dir') throw new Error(`Not a directory: ${path}`);
    const prefix = dir === '/' ? '/' : dir + '/';
    const out: FsNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.path === dir) continue;
      if (!node.path.startsWith(prefix)) continue;
      if (node.path.slice(prefix.length).includes('/')) continue;
      out.push(node);
    }
    out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh') : a.type === 'dir' ? -1 : 1));
    return out;
  }

  sizeOf(path: string): number {
    const p = normalizePath(path);
    const n = this.stat(p);
    if (n.type === 'file') return byteLength(n.content);
    let total = 0;
    const prefix = p === '/' ? '/' : p + '/';
    for (const node of this.nodes.values()) if (node.type === 'file' && node.path.startsWith(prefix)) total += byteLength(node.content);
    return total;
  }

  countFiles(path: string): number {
    const p = normalizePath(path);
    const prefix = p === '/' ? '/' : p + '/';
    let c = 0;
    for (const node of this.nodes.values()) if (node.type === 'file' && node.path.startsWith(prefix)) c++;
    return c;
  }

  /* ------------------------------------------------------------ mutation */

  write(path: string, content: string): FsNode {
    const p = normalizePath(path);
    const parent = dirname(p);
    if (!this.exists(parent)) this.mkdir(parent, true, true);
    const now = Date.now();
    const existing = this.nodes.get(p);
    const node: FsNode = {
      path: p,
      name: basename(p),
      type: 'file',
      content: content ?? '',
      mtime: now,
      ctime: existing?.ctime ?? now,
      mode: existing?.mode ?? 'rw-r--r--',
    };
    this.nodes.set(p, node);
    this.queueWrite(node);
    this.emit();
    return node;
  }

  append(path: string, content: string): FsNode {
    const prev = this.exists(path) ? this.read(path) : '';
    return this.write(path, prev + content);
  }

  mkdir(path: string, recursive = true, silent = false): void {
    let p = normalizePath(path);
    if (this.nodes.has(p)) return;
    const parts = splitPath(p);
    let cur = '';
    for (const seg of parts) {
      cur += '/' + seg;
      if (this.nodes.has(cur)) continue;
      if (!recursive) throw new Error(`No such file or directory: ${cur}`);
      const now = Date.now();
      const node: FsNode = { path: cur, name: seg, type: 'dir', content: '', mtime: now, ctime: now, mode: 'rwxr-xr-x' };
      this.nodes.set(cur, node);
      this.queueWrite(node);
    }
    if (!silent) this.emit();
  }

  remove(path: string): void {
    const p = normalizePath(path);
    if (p === '/') throw new Error('Cannot remove /');
    if (!this.nodes.has(p)) throw new Error(`No such file or directory: ${path}`);
    const prefix = p + '/';
    for (const key of [...this.nodes.keys()]) {
      if (key === p || key.startsWith(prefix)) {
        this.nodes.delete(key);
        this.queueDelete(key);
      }
    }
    this.emit();
  }

  rename(from: string, to: string): void {
    const src = normalizePath(from);
    const dst = normalizePath(to);
    if (!this.exists(src)) throw new Error(`No such file or directory: ${from}`);
    if (this.exists(dst)) throw new Error(`Target exists: ${to}`);
    const parent = dirname(dst);
    if (!this.exists(parent)) this.mkdir(parent, true, true);

    const moving: FsNode[] = [];
    const prefix = src + '/';
    for (const n of this.nodes.values()) if (n.path === src || n.path.startsWith(prefix)) moving.push(n);

    for (const n of moving) {
      const newPath = dst + n.path.slice(src.length);
      this.nodes.delete(n.path);
      this.queueDelete(n.path);
      const copy: FsNode = { ...n, path: newPath, name: basename(newPath), mtime: Date.now() };
      this.nodes.set(newPath, copy);
      this.queueWrite(copy);
    }
    this.emit();
  }

  copy(from: string, to: string): void {
    const src = normalizePath(from);
    const dst = normalizePath(to);
    const n = this.stat(src);
    if (n.type === 'file') {
      this.write(dst, n.content);
      return;
    }
    this.mkdir(dst);
    const prefix = src + '/';
    for (const child of this.nodes.values()) {
      if (!child.path.startsWith(prefix)) continue;
      const target = dst + child.path.slice(src.length);
      if (child.type === 'dir') this.mkdir(target);
      else this.write(target, child.content);
    }
  }

  /* --------------------------------------------------------------- seed */

  private seed() {
    const dirs = [
      '/', '/home', '/home/user', '/home/user/Desktop', '/home/user/Documents', '/home/user/Downloads',
      '/home/user/Pictures', '/home/user/Music', '/home/user/Projects', '/home/user/.config', '/tmp', '/etc',
    ];
    for (const d of dirs) this.mkdir(d, true, true);
    // Route through write() so the nodes enter the IndexedDB write queue;
    // setting this.nodes directly left the stock files out of storage.
    for (const [p, content] of seedFiles()) this.write(p, content);
  }

  /** Restores the stock demo files for installs created before 1.1. */
  private ensureBasics() {
    const marker = '/etc/basics-seed';
    const version = '1';
    if (this.exists(marker) && this.read(marker).trim() === version) return;
    for (const [p, content] of seedFiles()) if (!this.exists(p)) this.write(p, content);
    this.write(marker, version);
  }

  async reset(): Promise<void> {
    this.nodes.clear();
    this.seed();
    this.ensureDesktop();
    this.ensureWorkspace();
    if (this.db) {
      await new Promise<void>((resolve) => {
        const tx = this.db!.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    await this.flushNow();
    this.emit();
  }
}

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ seeds */


function seedFiles(): Array<[string, string]> {
  return [
    ['/etc/os-release', `NAME="OS"\nVERSION="1.1 (Origin)"\nID=os\nPRETTY_NAME="OS 1.1 Origin"\nHOME_URL="os://about"\n`],
    ['/etc/motd', `Welcome to OS 1.1 "Origin"\nA toy desktop built with OSL and OML.\n\nType \`help\` for commands, \`fastfetch\` for system info.\n`],
    ['/home/user/Documents/welcome.md', WELCOME_DOC],
    ['/home/user/Documents/notes.txt', `Scratch notes\n=============\n\n- OSL = Origin Software Language (Python-flavoured)\n- OML = Origin Markup Language (XAML-flavoured)\n- Every pixel of this desktop is described by .oml files.\n- The file system lives in IndexedDB and survives reloads.\n\nTry in Terminal:\n  ls ~/Projects\n  cat ~/Projects/hello.osl\n  osl ~/Projects/hello.osl\n  fastfetch\n`],
    ['/home/user/Projects/hello.osl', HELLO_OSL],
    ['/home/user/Projects/demo.oml', DEMO_OML],
    ['/home/user/Projects/fib.osl', FIB_OSL],
    ['/home/user/Downloads/OS-1.1-release-notes.md', RELEASE_NOTES],
    ['/home/user/Pictures/readme.txt', 'Drop images here.\nThe editor opens text files; the file manager previews metadata.\n'],
  ];
}

const WORKSPACE_APP = `# app.osl — demo entry for the IDE.
# F5 runs this file, Ctrl+S saves it.

import "lib/mathx.osl" as mathx
from "lib/mathx.osl" import area

print("OSL runtime " + sys.version())

for n in range(1, 6):
    let twice = mathx.double(n)
    print("n=" + str(n) + "  double=" + str(twice) + "  area=" + str(math.round(area(n), 2)))

let names = ["Files", "Terminal", "IDE"]
print("apps: " + ", ".join(names))
`;

const WORKSPACE_LIB = `# mathx.osl — a tiny module shared by app.osl.

const PI = 3.14159265

fn double(n):
    return n * 2

fn area(r):
    return PI * r * r
`;

const DESKTOP_README = `Desktop
=======

Everything on the desktop is a file in /home/user/Desktop.

* \`.desktop\` files are shortcuts — the file content is an application id,
  for example \`terminal\` or \`notes\`.
* Drag-free reorganising: rename, duplicate or delete them from the
  right-click menu, exactly like real files.
* Right-click the wallpaper to create a new shortcut, folder or file.
`;

const WELCOME_DOC = `# Welcome to OS 1.1 "Origin"

OS is a toy desktop environment that runs entirely in your browser. It is not a
mock-up: the window manager, the file manager, the editor, the terminal and the
settings panel are all declared in **OML** and driven by **OSL** scripts.

## The two languages

### OSL — Origin Software Language

A small, Python-flavoured language. It is indentation based and Turing complete:
it has variables, closures, classes, loops, recursion, exceptions and a standard
library that can touch the file system, open windows and show dialogs.

\`\`\`python
fn fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

for i in range(10):
    print("fib(" + str(i) + ") = " + str(fib(i)))
\`\`\`

### OML — Origin Markup Language

An XML dialect for describing interfaces. Attributes are evaluated by OSL:

\`\`\`xml
<Window title="Hello" width="420" height="240">
  <VBox pad="20" gap="12">
    <Label text="What is your name?"/>
    <Input bind="name" placeholder="Type here"/>
    <Button text="{greeting}" variant="primary" onclick="greet()"/>
  </VBox>
</Window>
\`\`\`

Bindings use \`{expression}\`, events use \`onclick="statements"\`, and every
element below a \`<For>\` gets fresh variables.

## Things to try

1. Open **Terminal** and run \`fastfetch\`.
2. Run an OSL program: \`osl ~/Projects/hello.osl\`.
3. Open **Files**, create a folder, then open a text file in **Editor**.
4. Switch to the macOS look in **Settings → Appearance → System style**.
5. Reload the page — your files are still here (IndexedDB).

## Keyboard

| Shortcut | Action |
| --- | --- |
| Alt + Tab | Switch windows |
| Alt + F4 / Ctrl + W | Close window |
| Ctrl + Alt + T | New terminal |
| Ctrl + Space | Start menu / Spotlight |
| Ctrl + S | Save (Editor) |

Enjoy exploring. Everything you see is editable — the sources live in
\`src/system\` and \`src/apps\`.
`;

const HELLO_OSL = `# hello.osl — your first OSL program
# Run it with:  osl hello.osl

fn fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print("Hello from OSL!")
print("")

let total = 0
for i in range(12):
    let value = fib(i)
    total += value
    print("  fib(" + str(i) + ") = " + str(value))

print("")
print("sum = " + str(total))

let langs = ["OSL", "OML"]
langs.append("IndexedDB")
print("stack: " + ", ".join(langs))
`;

const FIB_OSL = `# Iterative + recursive Fibonacci, to prove the loop constructs work.

fn fib_iter(n):
    let a = 0
    let b = 1
    let i = 0
    while i < n:
        let t = a + b
        a = b
        b = t
        i += 1
    return a

let results = []
for i in range(0, 20, 2):
    results.append(fib_iter(i))

print(results)
print("max = " + str(max(results)))
`;

const DEMO_OML = `<!-- demo.oml — a minimal OML document.
     The kernel can mount this file as a window content. -->
<Window title="OML Demo" width="440" height="300">
  <VBox pad="20" gap="12">
    <Title text="Hello, OML"/>
    <Label text="This window is described by markup, not by TypeScript."/>
    <Input bind="name" placeholder="Your name"/>
    <Button text="Say hello" variant="primary" onclick="greet()"/>
    <Label text="{message}" class="ui-muted"/>
  </VBox>
</Window>
`;

const RELEASE_NOTES = `OS 1.1 "Origin" — release notes
================================

Highlights
----------
* IDE: explorer, tabs, syntax highlighting, quick open and a run panel.
* OSL 1.1: real declarations, const, error objects with stack traces,
  multi-file modules (import / from), class inheritance.
* OML 1.1: if mounts and unmounts, keyed <For> lists, literal text i18n.
* Chinese and English UI, switchable from Settings > Appearance.
* Desktop icons are files: .desktop shortcuts live in ~/Desktop.
* New apps: Notes, Calendar, Monitor.

Known limitations
-----------------
* Files are text only (no binary uploads yet).
* The terminal is not a real TTY; full-screen curses apps are not supported.
* OSL runs on the UI thread, so a runaway loop is stopped by a step limit.
`;
