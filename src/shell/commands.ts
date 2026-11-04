/**
 * osh — the OS shell. 40+ commands with a POSIX-ish flavour, plus Windows
 * (dir, type, cls, copy…) and macOS (open, pbcopy, say…) aliases.
 */
import { normalizePath, joinPath, dirname, basename, extname, humanSize, byteLength } from '../core/fs';
import type { FsNode } from '../core/fs';
import type { Host } from '../osl/host';
import { formatTime } from '../osl/builtins';

export interface CmdResult {
  out?: string;
  err?: string;
  code?: number;
}

export interface TerminalApi {
  cwd: string;
  host: Host;
  env: Map<string, string>;
  setCwd(p: string): void;
  write(text: string): void;
  print(text: string): void;
  error(text: string): void;
  clear(): void;
  resolve(p: string): string;
  runOsl(path: string, argv: string[]): number;
  history(): string[];
  notify(title: string, body: string, icon?: string): void;
  openApp(id: string, args?: Record<string, any>): void;
}

export interface CmdCtx {
  term: TerminalApi;
  argv: string[];
  stdin: string;
}

export type CommandFn = (ctx: CmdCtx) => CmdResult | Promise<CmdResult>;

export interface CommandDef {
  desc: string;
  usage: string;
  run: CommandFn;
}

/* ------------------------------------------------------------- ansi */

const C = {
  r: '\x1b[0m',
  b: '\x1b[1m',
  d: '\x1b[2m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bcyan: '\x1b[96m',
  bgreen: '\x1b[92m',
  byellow: '\x1b[93m',
  bblue: '\x1b[94m',
  bmagenta: '\x1b[95m',
  bwhite: '\x1b[97m',
};

export const S = C;

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const args: string[] = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags.add(k);
      if (v !== undefined) flags.add(`${k}=${v}`);
    } else if (a.startsWith('-') && a.length > 1 && a !== '-') {
      for (const f of a.slice(1)) flags.add(f);
    } else args.push(a);
  }
  return { flags, args };
}

function readInput(ctx: CmdCtx, paths: string[]): { text: string; err?: string } {
  const { term } = ctx;
  if (paths.length === 0) return { text: ctx.stdin };
  let out = '';
  for (const p of paths) {
    const full = term.resolve(p);
    try {
      const node = term.host.vfs.stat(full);
      if (node.type === 'dir') return { text: '', err: `${p}: Is a directory` };
      out += term.host.vfs.read(full);
    } catch (e: any) {
      return { text: '', err: `${p}: ${e.message}` };
    }
  }
  return { text: out };
}

function fmtMode(node: FsNode): string {
  return (node.type === 'dir' ? 'd' : '-') + node.mode;
}

function fmtDate(ts: number): string {
  return formatTime(ts, 'MMM DD HH:mm');
}

function colorName(node: FsNode): string {
  if (node.type === 'dir') return `${C.bblue}${node.name}${C.r}`;
  if (/\.[a-z0-9]+$/i.test(node.name)) return `${C.bwhite}${node.name}${C.r}`;
  return `${C.bgreen}${node.name}${C.r}`;
}

function walk(vfs: Host['vfs'], dir: string, fn: (n: FsNode) => void) {
  for (const n of vfs.list(dir)) {
    fn(n);
    if (n.type === 'dir') walk(vfs, n.path, fn);
  }
}

/* ----------------------------------------------------------- commands */

const commands: Record<string, CommandDef> = {};

function def(name: string, desc: string, usage: string, run: CommandFn) {
  commands[name] = { desc, usage, run };
}

/* -------- navigation & inspection */

def('help', 'List available commands', 'help [command]', (ctx) => {
  if (ctx.argv[0]) {
    const d = commands[ctx.argv[0]];
    if (!d) return { err: `help: no entry for ${ctx.argv[0]}`, code: 1 };
    return { out: `${C.b}${ctx.argv[0]}${C.r} — ${d.desc}\n\n${C.d}usage:${C.r} ${d.usage}` };
  }
  const names = Object.keys(commands).sort();
  const width = 78;
  let out = `${C.b}OS Shell (osh 1.0)${C.r} — ${names.length} built-in commands\n\n`;
  let line = '';
  for (const n of names) {
    const cell = n.padEnd(13);
    if ((line + cell).length > width) {
      out += line + '\n';
      line = '';
    }
    line += `${C.bcyan}${cell}${C.r}`;
  }
  out += line + '\n\n';
  out += `${C.d}Type 'man <command>' for details. Pipes (|), redirects (> >> <) and && / || work.${C.r}`;
  return { out };
});

def('pwd', 'Print working directory', 'pwd', (ctx) => ({ out: ctx.term.cwd }));

def('cd', 'Change directory', 'cd [path]', (ctx) => {
  const target = ctx.argv[0] ?? '~';
  const path = target === '-' ? ctx.term.env.get('OLDPWD') ?? ctx.term.cwd : ctx.term.resolve(target);
  const vfs = ctx.term.host.vfs;
  if (!vfs.exists(path)) return { err: `cd: no such file or directory: ${target}`, code: 1 };
  if (!vfs.isDir(path)) return { err: `cd: not a directory: ${target}`, code: 1 };
  ctx.term.env.set('OLDPWD', ctx.term.cwd);
  ctx.term.setCwd(path);
  return {};
});

def('ls', 'List directory contents', 'ls [-l] [-a] [-h] [path]', (ctx) => {
  const { flags, args } = parseArgs(ctx.argv);
  const target = ctx.term.resolve(args[0] ?? '.');
  const vfs = ctx.term.host.vfs;
  if (!vfs.exists(target)) return { err: `ls: cannot access '${args[0] ?? '.'}': No such file or directory`, code: 1 };
  if (!vfs.isDir(target)) {
    const n = vfs.stat(target);
    return { out: flags.has('l') ? `${fmtMode(n)} ${String(n.mode).padEnd(10)} ${humanSize(byteLength(n.content)).padStart(8)} ${fmtDate(n.mtime)} ${colorName(n)}` : colorName(n) };
  }
  let items = vfs.list(target);
  if (!flags.has('a')) items = items.filter((n) => !n.name.startsWith('.'));
  if (items.length === 0) return {};
  if (flags.has('l')) {
    let out = `${C.d}total ${items.length}${C.r}\n`;
    for (const n of items) {
      const size = n.type === 'file' ? humanSize(byteLength(n.content)) : '—';
      out += `${fmtMode(n)} ${String(n.mode).padEnd(10)} ${size.padStart(8)} ${fmtDate(n.mtime)} ${colorName(n)}\n`;
    }
    return { out: out.trimEnd() };
  }
  const names = items.map((n) => colorName(n));
  if (flags.has('1')) return { out: names.join('\n') };
  // column layout
  const cols = Math.max(1, Math.floor(76 / 22));
  const rows: string[] = [];
  for (let i = 0; i < names.length; i += cols) rows.push(names.slice(i, i + cols).map((s) => s.padEnd(22)).join('').trimEnd());
  return { out: rows.join('\n') };
});

def('tree', 'Display a directory tree', 'tree [-L depth] [path]', (ctx) => {
  const { flags, args } = parseArgs(ctx.argv);
  let maxDepth = 6;
  const lflag = [...flags].find((f) => f.startsWith('L='));
  if (lflag) maxDepth = parseInt(lflag.split('=')[1], 10) || 6;
  const root = ctx.term.resolve(args[0] ?? '.');
  const vfs = ctx.term.host.vfs;
  if (!vfs.isDir(root)) return { err: `tree: not a directory: ${args[0]}`, code: 1 };
  let dirs = 0;
  let files = 0;
  let out = `${C.bblue}${root}${C.r}\n`;
  const rec = (dir: string, prefix: string, depth: number) => {
    if (depth > maxDepth) return;
    const items = vfs.list(dir);
    items.forEach((n, i) => {
      const last = i === items.length - 1;
      out += `${prefix}${last ? '└── ' : '├── '}${n.type === 'dir' ? C.bblue + n.name + C.r : n.name}\n`;
      if (n.type === 'dir') {
        dirs++;
        rec(n.path, prefix + (last ? '    ' : '│   '), depth + 1);
      } else files++;
    });
  };
  rec(root, '', 1);
  out += `\n${C.d}${dirs} directories, ${files} files${C.r}`;
  return { out };
});

def('find', 'Find files by name', 'find [path] -name pattern', (ctx) => {
  const { args } = parseArgs(ctx.argv);
  const root = ctx.term.resolve(args[0] ?? '.');
  const nameIdx = ctx.argv.indexOf('-name');
  const pattern = nameIdx >= 0 ? ctx.argv[nameIdx + 1] : args[1] ?? '*';
  const re = new RegExp('^' + String(pattern).replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  const vfs = ctx.term.host.vfs;
  if (!vfs.exists(root)) return { err: `find: '${args[0]}': No such file or directory`, code: 1 };
  const found: string[] = [];
  walk(vfs, root, (n) => {
    if (re.test(n.name)) found.push(n.path);
  });
  return { out: found.length ? found.join('\n') : '' };
});

def('grep', 'Search text with patterns', 'grep [-i] [-n] [-r] pattern [file…]', (ctx) => {
  const { flags, args } = parseArgs(ctx.argv);
  if (args.length === 0) return { err: 'grep: missing pattern', code: 2 };
  const pattern = args[0];
  const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags.has('i') ? 'gi' : 'g');
  const vfs = ctx.term.host.vfs;
  const out: string[] = [];
  const scan = (label: string, text: string) => {
    text.split('\n').forEach((line, i) => {
      re.lastIndex = 0;
      if (re.test(line)) {
        const body = flags.has('i') ? line : line;
        out.push(`${C.magenta}${label}${C.r}${flags.has('n') ? C.green + (i + 1) + C.r + ':' : ':'}${body}`);
      }
    });
  };
  const paths = args.slice(1);
  if (paths.length === 0) {
    const text = ctx.stdin || '';
    if (!text) return { err: 'grep: no input', code: 2 };
    scan('(stdin)', text);
    return { out: out.join('\n'), code: out.length ? 0 : 1 };
  }
  for (const p of paths) {
    const full = ctx.term.resolve(p);
    if (!vfs.exists(full)) {
      out.push(`${C.red}grep: ${p}: No such file or directory${C.r}`);
      continue;
    }
    if (vfs.isDir(full)) {
      if (!flags.has('r')) continue;
      walk(vfs, full, (n) => {
        if (n.type === 'file') scan(n.path, n.content);
      });
    } else scan(p, vfs.read(full));
  }
  return { out: out.join('\n'), code: out.length ? 0 : 1 };
});

def('cat', 'Concatenate and print files', 'cat [file…]', (ctx) => {
  const r = readInput(ctx, ctx.argv);
  if (r.err) return { err: `cat: ${r.err}`, code: 1 };
  return { out: r.text.replace(/\n$/, '') };
});

def('head', 'Print the first lines', 'head [-n N] [file…]', (ctx) => {
  const { args } = parseArgs(ctx.argv);
  let n = 10;
  const i = ctx.argv.indexOf('-n');
  if (i >= 0) n = parseInt(ctx.argv[i + 1], 10) || 10;
  const r = readInput(ctx, args);
  if (r.err) return { err: `head: ${r.err}`, code: 1 };
  return { out: r.text.split('\n').slice(0, n).join('\n') };
});

def('tail', 'Print the last lines', 'tail [-n N] [file…]', (ctx) => {
  const { args } = parseArgs(ctx.argv);
  let n = 10;
  const i = ctx.argv.indexOf('-n');
  if (i >= 0) n = parseInt(ctx.argv[i + 1], 10) || 10;
  const r = readInput(ctx, args);
  if (r.err) return { err: `tail: ${r.err}`, code: 1 };
  const lines = r.text.replace(/\n$/, '').split('\n');
  return { out: lines.slice(-n).join('\n') };
});

def('wc', 'Count lines, words and characters', 'wc [-l] [-w] [-c] [file…]', (ctx) => {
  const { flags, args } = parseArgs(ctx.argv);
  const r = readInput(ctx, args);
  if (r.err) return { err: `wc: ${r.err}`, code: 1 };
  const lines = r.text ? r.text.split('\n').length - (r.text.endsWith('\n') ? 1 : 0) : 0;
  const words = r.text.trim() ? r.text.trim().split(/\s+/).length : 0;
  const chars = r.text.length;
  const showAll = !flags.has('l') && !flags.has('w') && !flags.has('c');
  const parts: string[] = [];
  if (showAll || flags.has('l')) parts.push(String(lines));
  if (showAll || flags.has('w')) parts.push(String(words));
  if (showAll || flags.has('c')) parts.push(String(chars));
  return { out: parts.join(' ') };
});

def('stat', 'Display file status', 'stat <path>', (ctx) => {
  if (!ctx.argv[0]) return { err: 'stat: missing operand', code: 1 };
  const p = ctx.term.resolve(ctx.argv[0]);
  try {
    const n = ctx.term.host.vfs.stat(p);
    return {
      out: [
        `${C.b}  File:${C.r} ${n.path}`,
        `${C.b}  Size:${C.r} ${n.type === 'file' ? byteLength(n.content) : 0}\t${C.b}Type:${C.r} ${n.type === 'dir' ? 'directory' : 'regular file'}`,
        `${C.b}  Mode:${C.r} ${fmtMode(n)}`,
        `${C.b}Access:${C.r} ${new Date(n.mtime).toLocaleString()}`,
        `${C.b} Birth:${C.r} ${new Date(n.ctime).toLocaleString()}`,
      ].join('\n'),
    };
  } catch (e: any) {
    return { err: `stat: ${e.message}`, code: 1 };
  }
});

def('file', 'Identify file type', 'file <path>', (ctx) => {
  if (!ctx.argv[0]) return { err: 'file: missing operand', code: 1 };
  const p = ctx.term.resolve(ctx.argv[0]);
  const n = ctx.term.host.vfs.stat(p);
  if (n.type === 'dir') return { out: `${p}: directory` };
  const ext = extname(n.name);
  const kinds: Record<string, string> = {
    md: 'Markdown document, UTF-8 text',
    txt: 'ASCII text',
    osl: 'OSL source, UTF-8 text',
    oml: 'OML markup, UTF-8 text',
    json: 'JSON data',
    log: 'log file, ASCII text',
    svg: 'SVG image',
  };
  return { out: `${p}: ${kinds[ext] ?? 'UTF-8 Unicode text'}` };
});

def('du', 'Estimate file space usage', 'du [-h] [path]', (ctx) => {
  const target = ctx.term.resolve(ctx.argv[0] ?? '.');
  const vfs = ctx.term.host.vfs;
  if (!vfs.exists(target)) return { err: `du: ${ctx.argv[0]}: No such file or directory`, code: 1 };
  if (vfs.isDir(target)) {
    const items = vfs.list(target).filter((n) => n.type === 'dir');
    let out = '';
    for (const d of items) out += `${humanSize(vfs.sizeOf(d.path)).padStart(8)}\t${d.path}\n`;
    out += `${humanSize(vfs.sizeOf(target)).padStart(8)}\t${target}`;
    return { out };
  }
  return { out: `${humanSize(vfs.sizeOf(target)).padStart(8)}\t${target}` };
});

def('df', 'Report file system usage', 'df [-h]', (ctx) => {
  const vfs = ctx.term.host.vfs;
  const used = vfs.sizeOf('/');
  const total = 8 * 1024 * 1024;
  const pct = Math.min(99, Math.round((used / total) * 100));
  return {
    out: [
      `${C.b}Filesystem      Size    Used   Avail  Use%  Mounted on${C.r}`,
      `osvfs           ${humanSize(total).padStart(5)}  ${humanSize(used).padStart(5)}  ${humanSize(total - used).padStart(5)}  ${String(pct).padStart(3)}%  /`,
      `tmpfs           ${humanSize(1024 * 1024).padStart(5)}  ${'4 KB'.padStart(5)}  ${humanSize(1024 * 1024).padStart(5)}    1%  /tmp`,
    ].join('\n'),
  };
});

/* -------- mutation */

def('mkdir', 'Create directories', 'mkdir [-p] <dir…>', (ctx) => {
  const { flags, args } = parseArgs(ctx.argv);
  if (!args.length) return { err: 'mkdir: missing operand', code: 1 };
  for (const a of args) {
    const p = ctx.term.resolve(a);
    if (ctx.term.host.vfs.exists(p) && !flags.has('p')) return { err: `mkdir: cannot create directory '${a}': File exists`, code: 1 };
    ctx.term.host.vfs.mkdir(p, true);
  }
  return {};
});

def('rmdir', 'Remove empty directories', 'rmdir <dir…>', (ctx) => {
  if (!ctx.argv.length) return { err: 'rmdir: missing operand', code: 1 };
  for (const a of ctx.argv) {
    const p = ctx.term.resolve(a);
    const vfs = ctx.term.host.vfs;
    if (!vfs.exists(p)) return { err: `rmdir: failed to remove '${a}': No such file or directory`, code: 1 };
    if (vfs.list(p).length) return { err: `rmdir: failed to remove '${a}': Directory not empty`, code: 1 };
    vfs.remove(p);
  }
  return {};
});

def('rm', 'Remove files or directories', 'rm [-r] [-f] <path…>', (ctx) => {
  const { flags, args } = parseArgs(ctx.argv);
  if (!args.length) return { err: 'rm: missing operand', code: 1 };
  for (const a of args) {
    const p = ctx.term.resolve(a);
    const vfs = ctx.term.host.vfs;
    if (!vfs.exists(p)) {
      if (flags.has('f')) continue;
      return { err: `rm: cannot remove '${a}': No such file or directory`, code: 1 };
    }
    if (vfs.isDir(p) && vfs.list(p).length && !flags.has('r') && !flags.has('R')) {
      return { err: `rm: cannot remove '${a}': Is a directory`, code: 1 };
    }
    vfs.remove(p);
  }
  return {};
});

def('touch', 'Create empty files / update timestamps', 'touch <file…>', (ctx) => {
  if (!ctx.argv.length) return { err: 'touch: missing file operand', code: 1 };
  for (const a of ctx.argv) {
    const p = ctx.term.resolve(a);
    if (ctx.term.host.vfs.exists(p)) ctx.term.host.vfs.write(p, ctx.term.host.vfs.read(p));
    else ctx.term.host.vfs.write(p, '');
  }
  return {};
});

def('cp', 'Copy files and directories', 'cp [-r] <src> <dst>', (ctx) => {
  const { flags, args } = parseArgs(ctx.argv);
  if (args.length < 2) return { err: 'cp: missing destination file operand', code: 1 };
  const vfs = ctx.term.host.vfs;
  const src = ctx.term.resolve(args[0]);
  let dst = ctx.term.resolve(args[1]);
  if (!vfs.exists(src)) return { err: `cp: cannot stat '${args[0]}': No such file or directory`, code: 1 };
  if (vfs.isDir(src) && !flags.has('r') && !flags.has('R')) return { err: `cp: -r not specified; omitting directory '${args[0]}'`, code: 1 };
  if (vfs.isDir(dst)) dst = joinPath(dst, basename(src));
  if (vfs.exists(dst)) return { err: `cp: '${args[1]}': File exists`, code: 1 };
  vfs.copy(src, dst);
  return {};
});

def('mv', 'Move or rename files', 'mv <src> <dst>', (ctx) => {
  const { args } = parseArgs(ctx.argv);
  if (args.length < 2) return { err: 'mv: missing destination file operand', code: 1 };
  const vfs = ctx.term.host.vfs;
  const src = ctx.term.resolve(args[0]);
  let dst = ctx.term.resolve(args[1]);
  if (!vfs.exists(src)) return { err: `mv: cannot stat '${args[0]}': No such file or directory`, code: 1 };
  if (vfs.isDir(dst)) dst = joinPath(dst, basename(src));
  if (vfs.exists(dst)) return { err: `mv: '${args[1]}': File exists`, code: 1 };
  vfs.rename(src, dst);
  return {};
});

def('chmod', 'Change file mode bits', 'chmod <mode> <path>', (ctx) => {
  if (ctx.argv.length < 2) return { err: 'chmod: missing operand', code: 1 };
  const mode = ctx.argv[0];
  const p = ctx.term.resolve(ctx.argv[1]);
  const n = ctx.term.host.vfs.stat(p);
  const digits = mode.replace(/[^0-7]/g, '');
  if (digits.length === 3) {
    const [u, g, o] = digits.split('').map(Number);
    const rwx = (v: number) => `${v & 4 ? 'r' : '-'}${v & 2 ? 'w' : '-'}${v & 1 ? 'x' : '-'}`;
    n.mode = rwx(u) + rwx(g) + rwx(o);
  }
  return {};
});

/* -------- text processing */

def('echo', 'Print arguments', 'echo [-n] [text…]', (ctx) => {
  const { flags, args } = parseArgs(ctx.argv);
  return { out: args.join(' ') + (flags.has('n') ? '' : '') };
});

def('sort', 'Sort lines of text', 'sort [-r] [-u] [file]', (ctx) => {
  const { flags, args } = parseArgs(ctx.argv);
  const r = readInput(ctx, args);
  if (r.err) return { err: `sort: ${r.err}`, code: 1 };
  let lines = r.text.replace(/\n$/, '').split('\n');
  lines.sort((a, b) => a.localeCompare(b));
  if (flags.has('r')) lines.reverse();
  if (flags.has('u')) lines = [...new Set(lines)];
  return { out: lines.join('\n') };
});

def('uniq', 'Filter adjacent duplicate lines', 'uniq [file]', (ctx) => {
  const r = readInput(ctx, ctx.argv);
  if (r.err) return { err: `uniq: ${r.err}`, code: 1 };
  const out: string[] = [];
  for (const line of r.text.replace(/\n$/, '').split('\n')) if (out[out.length - 1] !== line) out.push(line);
  return { out: out.join('\n') };
});

def('rev', 'Reverse each line', 'rev [file]', (ctx) => {
  const r = readInput(ctx, ctx.argv);
  if (r.err) return { err: r.err, code: 1 };
  return { out: r.text.replace(/\n$/, '').split('\n').map((l) => l.split('').reverse().join('')).join('\n') };
});

def('nl', 'Number lines', 'nl [file]', (ctx) => {
  const r = readInput(ctx, ctx.argv);
  if (r.err) return { err: r.err, code: 1 };
  return { out: r.text.replace(/\n$/, '').split('\n').map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n') };
});

def('cut', 'Cut columns from each line', 'cut -d X -f N [file]', (ctx) => {
  const { args } = parseArgs(ctx.argv);
  const di = ctx.argv.indexOf('-d');
  const fi = ctx.argv.indexOf('-f');
  const delim = di >= 0 ? ctx.argv[di + 1] : '\t';
  const field = fi >= 0 ? parseInt(ctx.argv[fi + 1], 10) : 1;
  const r = readInput(ctx, args);
  if (r.err) return { err: r.err, code: 1 };
  return { out: r.text.replace(/\n$/, '').split('\n').map((l) => l.split(delim)[field - 1] ?? '').join('\n') };
});

def('tee', 'Copy stdin to a file and stdout', 'tee <file>', (ctx) => {
  if (!ctx.argv[0]) return { err: 'tee: missing operand', code: 1 };
  const p = ctx.term.resolve(ctx.argv[0]);
  ctx.term.host.vfs.write(p, ctx.stdin);
  return { out: ctx.stdin.replace(/\n$/, '') };
});

def('base64', 'Encode standard input', 'base64 [file]', (ctx) => {
  const r = readInput(ctx, ctx.argv);
  if (r.err) return { err: r.err, code: 1 };
  try {
    return { out: btoa(unescape(encodeURIComponent(r.text))) };
  } catch {
    return { err: 'base64: input contains binary data', code: 1 };
  }
});

/* -------- system */

def('clear', 'Clear the terminal', 'clear', (ctx) => {
  ctx.term.clear();
  return {};
});

def('cls', 'Clear the terminal (Windows)', 'cls', (ctx) => {
  ctx.term.clear();
  return {};
});

def('date', 'Show the current date/time', 'date [+format]', (ctx) => {
  if (ctx.argv[0]?.startsWith('+')) {
    const fmt = ctx.argv[0].slice(1).replace(/%Y/g, 'YYYY').replace(/%m/g, 'MM').replace(/%d/g, 'DD').replace(/%H/g, 'HH').replace(/%M/g, 'mm').replace(/%S/g, 'ss');
    return { out: formatTime(Date.now(), fmt) };
  }
  return { out: new Date().toString() };
});

def('cal', 'Display a calendar', 'cal', () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const start = (first.getDay() + 6) % 7;
  const title = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month]} ${year}`;
  let out = `${C.b}${title.padStart(Math.floor((20 + title.length) / 2))}${C.r}\n`;
  out += `${C.d}Mo Tu We Th Fr Sa Su${C.r}\n`;
  let line = '   '.repeat(start);
  for (let d = 1; d <= days; d++) {
    const isToday = d === now.getDate();
    line += (isToday ? `${C.b}${C.bcyan}` : '') + String(d).padStart(2) + (isToday ? C.r : '') + ' ';
    if ((start + d) % 7 === 0) {
      out += line + '\n';
      line = '';
    }
  }
  if (line.trim()) out += line + '\n';
  return { out: out.trimEnd() };
});

def('whoami', 'Print the current user', 'whoami', (ctx) => ({ out: ctx.term.env.get('USER') ?? 'origin' }));
def('hostname', 'Print the host name', 'hostname', () => ({ out: 'origin' }));
def('uname', 'Print system information', 'uname [-a]', (ctx) => {
  const { flags } = parseArgs(ctx.argv);
  if (flags.has('a')) return { out: 'OS origin 1.0.0-osk #1 SMP PREEMPT origin x86_64 oml' };
  return { out: 'OS' };
});
def('ver', 'Print the OS version (Windows)', 'ver', () => ({ out: 'OS [Version 1.0.2601]' }));
def('sw_vers', 'Print the OS version (macOS)', 'sw_vers', () => ({
  out: ['ProductName:\t\tOS', 'ProductVersion:\t1.0', 'BuildVersion:\t\tOrigin'].join('\n'),
}));

def('uptime', 'Show system uptime', 'uptime', (ctx) => {
  const ms = ctx.term.host.kernel.uptime();
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const time = formatTime(Date.now(), 'HH:mm');
  return { out: ` ${time}  up ${h > 0 ? `${h} hours, ` : ''}${m} mins,  1 user,  load average: 0.12, 0.08, 0.04` };
});

def('env', 'Print environment variables', 'env', (ctx) => ({
  out: [...ctx.term.env.entries()].map(([k, v]) => `${k}=${v}`).join('\n'),
}));

def('export', 'Set an environment variable', 'export KEY=value', (ctx) => {
  const pair = ctx.argv[0] ?? '';
  const eq = pair.indexOf('=');
  if (eq < 0) return { err: 'export: usage: export KEY=value', code: 1 };
  ctx.term.env.set(pair.slice(0, eq), pair.slice(eq + 1));
  return {};
});

def('unset', 'Remove an environment variable', 'unset KEY', (ctx) => {
  if (ctx.argv[0]) ctx.term.env.delete(ctx.argv[0]);
  return {};
});

def('history', 'Show command history', 'history', (ctx) => ({
  out: ctx.term.history().map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n'),
}));

def('which', 'Locate a command', 'which <command>', (ctx) => {
  if (!ctx.argv[0]) return { err: 'which: missing argument', code: 1 };
  return commands[ctx.argv[0]] ? { out: `/bin/${ctx.argv[0]}` } : { err: `which: no ${ctx.argv[0]} in (/bin:/usr/bin)`, code: 1 };
});

def('where', 'Locate a command (Windows)', 'where <command>', (ctx) => {
  if (!ctx.argv[0]) return { err: 'where: missing argument', code: 1 };
  return commands[ctx.argv[0]] ? { out: `C:\\OS\\System32\\${ctx.argv[0]}.exe` } : { err: `INFO: Could not find files for the given pattern.`, code: 1 };
});

def('man', 'Show the manual for a command', 'man <command>', (ctx) => {
  const name = ctx.argv[0];
  const d = name ? commands[name] : null;
  if (!d) return { err: `No manual entry for ${name ?? ''}`, code: 1 };
  return {
    out: `${C.b}${name.toUpperCase()}${C.r}(1)\n\n${C.b}NAME${C.r}\n    ${name} — ${d.desc}\n\n${C.b}SYNOPSIS${C.r}\n    ${d.usage}\n\n${C.b}DESCRIPTION${C.r}\n    Part of the OS shell (osh 1.0). Runs in the origin virtual machine.\n`,
  };
});

def('ps', 'Report running processes', 'ps [aux]', (ctx) => {
  const wins = ctx.term.host.kernel.windows();
  const rows = [
    `${C.b}  PID  PPID  STAT  TIME  COMMAND${C.r}`,
    `    1     0  Ss    0:01  /sbin/init`,
    `   42     1  S     0:00  oml-compositor`,
    `   77     1  S     0:02  osk --daemon`,
    `  120     1  Ss    0:00  osh`,
  ];
  for (const w of wins) rows.push(`${String(300 + w.id).padStart(5)}   120  ${w.minimized ? 'T' : 'S'}     0:0${(w.id % 9) + 1}  ${w.appId} (${w.title.slice(0, 24)})`);
  rows.push(`  ${String(900 + wins.length).padStart(5)}   120  R     0:00  ps`);
  return { out: rows.join('\n') };
});

def('kill', 'Terminate a process', 'kill [-9] <pid>', (ctx) => {
  const { args } = parseArgs(ctx.argv);
  const pid = parseInt(args[0] ?? '', 10);
  if (!pid) return { err: 'kill: usage: kill [-9] pid', code: 1 };
  const id = pid - 300;
  const win = ctx.term.host.kernel.windows().find((w) => w.id === id);
  if (win) {
    ctx.term.host.kernel.closeWindow(id);
    return { out: '' };
  }
  if ([1, 42, 77, 120].includes(pid)) return { err: `kill: (${pid}) - Operation not permitted`, code: 1 };
  return { err: `kill: (${pid}) - No such process`, code: 1 };
});

def('seq', 'Print a sequence of numbers', 'seq [start] end [step]', (ctx) => {
  const nums = ctx.argv.map(Number);
  if (nums.some(isNaN)) return { err: 'seq: invalid argument', code: 1 };
  let [start, end, step] = [1, nums[0] ?? 1, 1];
  if (nums.length === 2) [start, end] = nums;
  if (nums.length >= 3) [start, end, step] = nums;
  const out: string[] = [];
  if (step > 0) for (let i = start; i <= end && out.length < 5000; i += step) out.push(String(i));
  else for (let i = start; i >= end && out.length < 5000; i += step) out.push(String(i));
  return { out: out.join('\n') };
});

def('yes', 'Print a string repeatedly', 'yes [text]', (ctx) => {
  const text = ctx.argv.join(' ') || 'y';
  return { out: Array.from({ length: 24 }, () => text).join('\n') + `\n${C.d}… (output truncated)${C.r}` };
});

def('sleep', 'Delay for a number of seconds', 'sleep <seconds>', async (ctx) => {
  const s = Math.min(10, Math.max(0, Number(ctx.argv[0]) || 0));
  await new Promise((r) => setTimeout(r, s * 1000));
  return {};
});

def('true', 'Do nothing, successfully', 'true', () => ({ code: 0 }));
def('false', 'Do nothing, unsuccessfully', 'false', () => ({ code: 1 }));

def('sudo', 'Execute as superuser', 'sudo <command>', () => ({
  err: `${C.red}origin is not in the sudoers file. This incident has been reported.${C.r}`,
  code: 1,
}));

def('exit', 'Close the terminal', 'exit [code]', (ctx) => {
  setTimeout(() => ctx.term.host.window.close(), 60);
  return { out: 'logout' };
});

def('theme', 'Switch theme / system style', 'theme [dark|light|win|mac]', (ctx) => {
  const arg = (ctx.argv[0] ?? '').toLowerCase();
  const s = ctx.term.host.settings;
  if (arg === 'dark' || arg === 'light') s.set('theme', arg as any);
  else if (arg === 'win' || arg === 'mac') s.set('style', arg as any);
  else return { out: `theme: ${s.get('theme')} · ${s.get('style')}\nusage: theme [dark|light|win|mac]` };
  return { out: `theme set to ${s.get('theme')} / ${s.get('style')}` };
});

def('open', 'Open an app or a file', 'open <app|path> [path]', (ctx) => {
  const target = ctx.argv[0];
  if (!target) return { err: 'open: missing argument', code: 1 };
  const apps = ctx.term.host.kernel.apps();
  if (apps.some((a) => a.id === target)) {
    ctx.term.host.kernel.open(target);
    return { out: `opening ${target}…` };
  }
  const p = ctx.term.resolve(target);
  if (ctx.term.host.vfs.exists(p)) {
    if (ctx.term.host.vfs.isDir(p)) ctx.term.host.kernel.open('files', { path: p });
    else ctx.term.host.kernel.openPath(p);
    return { out: `opening ${p}…` };
  }
  return { err: `open: ${target}: no such application or file`, code: 1 };
});

def('edit', 'Open a file in the editor', 'edit <file>', (ctx) => {
  if (!ctx.argv[0]) return { err: 'edit: missing file operand', code: 1 };
  const p = ctx.term.resolve(ctx.argv[0]);
  ctx.term.host.kernel.open('editor', { path: p });
  return {};
});

def('apps', 'List installed applications', 'apps', (ctx) => {
  const list = ctx.term.host.kernel.apps();
  const out = list.map((a) => `${C.bcyan}${a.id.padEnd(12)}${C.r}${a.name}`).join('\n');
  return { out: `${C.b}Installed applications${C.r}\n${out}` };
});

def('notify', 'Send a desktop notification', 'notify <title> [body]', (ctx) => {
  const title = ctx.argv[0] ?? 'Notification';
  const body = ctx.argv.slice(1).join(' ') || 'Hello from osh';
  ctx.term.notify(title, body, 'info');
  return { out: 'notification sent' };
});

def('pbcopy', 'Copy stdin to the clipboard (macOS)', 'pbcopy', (ctx) => {
  (globalThis as any).__osClipboard = ctx.stdin;
  try {
    void navigator.clipboard?.writeText(ctx.stdin);
  } catch {
    /* ignore */
  }
  return { out: '' };
});

def('pbpaste', 'Paste the clipboard (macOS)', 'pbpaste', () => ({ out: (globalThis as any).__osClipboard ?? '' }));

def('say', 'Speak text (macOS)', 'say <text>', (ctx) => {
  const text = ctx.argv.join(' ');
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    speechSynthesis.speak(u);
  }
  return { out: `say: ${text}` };
});

/* -------- OSL */

def('osl', 'Run an OSL program', 'osl <file.osl> [args…]', (ctx) => {
  if (!ctx.argv[0]) return { err: 'osl: usage: osl <file.osl>', code: 1 };
  const p = ctx.term.resolve(ctx.argv[0]);
  if (!ctx.term.host.vfs.exists(p)) return { err: `osl: ${ctx.argv[0]}: No such file`, code: 1 };
  const code = ctx.term.runOsl(p, ctx.argv.slice(1));
  return { code };
});

def('run', 'Run an OSL program', 'run <file.osl>', (ctx) => commands['osl'].run(ctx));

/* -------- Windows / macOS aliases */

def('dir', 'List directory contents (Windows)', 'dir [path]', (ctx) => commands['ls'].run({ ...ctx, argv: ['-l', ...ctx.argv] }));
def('type', 'Print a file (Windows)', 'type <file>', (ctx) => commands['cat'].run(ctx));
def('copy', 'Copy files (Windows)', 'copy <src> <dst>', (ctx) => commands['cp'].run(ctx));
def('move', 'Move files (Windows)', 'move <src> <dst>', (ctx) => commands['mv'].run(ctx));
def('del', 'Delete files (Windows)', 'del <path>', (ctx) => commands['rm'].run(ctx));
def('md', 'Create a directory (Windows)', 'md <dir>', (ctx) => commands['mkdir'].run(ctx));
def('rd', 'Remove a directory (Windows)', 'rd <dir>', (ctx) => commands['rmdir'].run(ctx));

/* -------- fun */

def('fortune', 'Print a random aphorism', 'fortune', () => {
  const quotes = [
    'Simplicity is prerequisite for reliability. — Dijkstra',
    'A language that does not affect the way you think is not worth knowing.',
    'Everything should be made as simple as possible, but not simpler.',
    'The best way to predict the future is to invent it.',
    'Programs must be written for people to read, and only incidentally for machines to execute.',
    'There are two hard things in computer science: cache invalidation, naming things, and off-by-one errors.',
    'Any sufficiently advanced bug is indistinguishable from a feature.',
  ];
  return { out: `${C.bmagenta}${quotes[Math.floor(Math.random() * quotes.length)]}${C.r}` };
});

def('cowsay', 'A cow says your text', 'cowsay <text>', (ctx) => {
  const text = ctx.argv.join(' ') || 'OS is a toy, and that is fine.';
  const line = '─'.repeat(text.length + 2);
  return {
    out: ` ${line}\n< ${text} >\n ${line}\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||`,
  };
});

def('fastfetch', 'Display system information', 'fastfetch [--logo none]', (ctx) => {
  const host = ctx.term.host;
  const s = host.settings;
  const vfs = host.vfs;
  const mins = Math.max(0, Math.floor(host.kernel.uptime() / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const theme = s.get('theme') === 'dark' ? 'Dark' : 'Light';
  const style = s.get('style') === 'win' ? 'Windows' : 'macOS';
  const files = vfs.countFiles('/');
  const size = humanSize(vfs.sizeOf('/'));
  const cores = navigator.hardwareConcurrency || 4;
  const res = `${window.screen.width}x${window.screen.height}`;
  const mem = (performance as any).memory;
  const used = mem ? Math.round(mem.usedJSHeapSize / 1048576) : 96;

  // Logo: painted with background-coloured spaces instead of block glyphs.
  // Spaces tile perfectly (no inter-glyph seams), so it reads like real
  // terminal art. 5×6 bitmaps for "O" and "S", joined with a one-column gap.
  const ART_O = ['.###.', '#...#', '#...#', '#...#', '#...#', '.###.'];
  const ART_S = ['.####', '#....', '#....', '.###.', '....#', '####.'];
  const ART_W = 12;
  const artBg = ['\x1b[106m', '\x1b[106m', '\x1b[104m', '\x1b[104m', '\x1b[105m', '\x1b[105m'];
  const logo: string[] = [];
  for (let y = 0; y < ART_O.length; y++) {
    const row = ' ' + ART_O[y] + ' ' + ART_S[y];
    let line = '';
    for (let x = 0; x < row.length; ) {
      if (row[x] === '#') {
        let n = 0;
        while (row[x + n] === '#') n++;
        line += `${artBg[y]}${' '.repeat(n)}${C.r}`;
        x += n;
      } else {
        line += ' ';
        x++;
      }
    }
    logo.push(line);
  }
  const info = [
    `${C.bgreen}${s.get('user')}@${C.bgreen}origin${C.r}`,
    `${C.d}──────────────────────${C.r}`,
    `${C.bcyan}OS${C.r}         OS 1.0 "Origin" x86_64`,
    `${C.bcyan}Host${C.r}       Origin Virtual Machine`,
    `${C.bcyan}Kernel${C.r}     osk 1.0.0 (oml-runtime)`,
    `${C.bcyan}Uptime${C.r}     ${h > 0 ? `${h} hour${h > 1 ? 's' : ''}, ` : ''}${m} min${m === 1 ? '' : 's'}`,
    `${C.bcyan}Shell${C.r}      osh 1.0`,
    `${C.bcyan}DE${C.r}         OML Shell 1.0`,
    `${C.bcyan}WM${C.r}         OWM (${style} chrome)`,
    `${C.bcyan}Terminal${C.r}   oterm`,
    `${C.bcyan}CPU${C.r}        ${cores} × Virtual Core @ 3.2 GHz`,
    `${C.bcyan}Memory${C.r}     ${used} MiB / 512 MiB`,
    `${C.bcyan}Disk${C.r}       ${files} files · ${size}`,
    `${C.bcyan}Resolution${C.r} ${res}`,
    `${C.bcyan}Theme${C.r}      ${theme} · ${style}`,
    `${C.bcyan}Locale${C.r}     en_US.UTF-8`,
  ];
  let out = '\n';
  const rows = Math.max(logo.length, info.length);
  for (let i = 0; i < rows; i++) {
    const l = logo[i] ?? ' '.repeat(ART_W);
    out += `${l}  ${info[i] ?? ''}\n`;
  }
  out += `\n${C.d}   OSL 1.0 · OML 1.0 · IndexedDB VFS${C.r}\n`;
  return { out };
});

def('neofetch', 'Display system information', 'neofetch', (ctx) => commands['fastfetch'].run(ctx));
def('screenfetch', 'Display system information', 'screenfetch', (ctx) => commands['fastfetch'].run(ctx));

/* ------------------------------------------------------------- exports */

export const COMMANDS = commands;
export const COMMAND_NAMES = Object.keys(commands).sort();

export function getCommand(name: string): CommandDef | undefined {
  return commands[name];
}
