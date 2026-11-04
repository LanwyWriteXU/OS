/**
 * oterm — the terminal emulator. Parses a small shell grammar (pipes,
 * redirects, && / || / ;) and hosts the command set in commands.ts.
 */
import type { Host } from '../osl/host';
import { Interpreter } from '../osl/interp';
import { createBuiltins } from '../osl/builtins';
import { COMMAND_NAMES, getCommand, S, type CmdResult, type TerminalApi } from './commands';
import { basename, normalizePath, dirname, humanSize } from '../core/fs';

interface Stage {
  argv: string[];
  redirectOut?: { path: string; append: boolean };
  redirectIn?: string;
}

interface Job {
  stages: Stage[];
  connector: ';' | '&&' | '||';
}

const HISTORY_KEY = 'os.term.history.v1';

export function mountTerminal(container: HTMLElement, host: Host): Terminal {
  const term = new Terminal(container, host);
  return term;
}

export class Terminal implements TerminalApi {
  cwd = '/home/user';
  host: Host;
  env = new Map<string, string>();
  root: HTMLElement;
  out: HTMLElement;
  input: HTMLInputElement;
  promptEl: HTMLElement;
  busy = false;
  lastCode = 0;
  private historyList: string[] = [];
  private histIndex = -1;

  constructor(container: HTMLElement, host: Host) {
    this.host = host;
    const start = host.args.get('cwd');
    this.cwd = typeof start === 'string' ? normalizePath(start) : '/home/user';
    host.cwd = () => this.cwd;

    this.env.set('USER', host.settings.get('user'));
    this.env.set('HOME', '/home/user');
    this.env.set('PWD', this.cwd);
    this.env.set('SHELL', '/bin/osh');
    this.env.set('TERM', 'xterm-256color');
    this.env.set('PATH', '/bin:/usr/bin:/usr/local/bin');
    this.env.set('HOSTNAME', 'origin');
    this.env.set('LANG', 'en_US.UTF-8');

    try {
      this.historyList = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    } catch {
      this.historyList = [];
    }

    container.innerHTML = '';
    this.root = document.createElement('div');
    this.root.className = 'term';
    this.out = document.createElement('div');
    this.out.className = 'term-out';
    const line = document.createElement('div');
    line.className = 'term-inputline';
    this.promptEl = document.createElement('span');
    this.promptEl.className = 'term-prompt';
    this.input = document.createElement('input');
    this.input.className = 'term-input';
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.setAttribute('autocapitalize', 'off');
    line.append(this.promptEl, this.input);
    this.root.append(this.out, line);
    container.appendChild(this.root);

    this.root.addEventListener('mousedown', (e) => {
      if (!(e.target instanceof HTMLInputElement) && window.getSelection()?.toString() === '') {
        setTimeout(() => this.input.focus(), 0);
      }
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.renderPrompt();
    this.banner();
    setTimeout(() => this.input.focus(), 30);
  }

  /* -------------------------------------------------------------- output */

  write(text: string) {
    const lines = text.split('\n');
    for (const l of lines) this.appendLine(l);
    this.scroll();
  }

  print(text: string) {
    this.write(text);
  }

  error(text: string) {
    for (const l of text.split('\n')) this.appendLine(`${S.red}${l}${S.r}`);
    this.scroll();
  }

  private appendLine(raw: string) {
    const div = document.createElement('div');
    div.className = 'term-line';
    // Block-drawing art (fastfetch logo) needs a tighter line box so the
    // glyphs / background bars stack without gaps, like a real terminal.
    if (/[█▀▄▌▐░▒▓]/.test(raw) || /\x1b\[(4[0-7]|10[0-7])m/.test(raw)) div.classList.add('tight');
    div.innerHTML = ansiToHtml(raw);
    this.out.appendChild(div);
    if (this.out.childElementCount > 3000) this.out.firstElementChild?.remove();
  }

  private scroll() {
    this.out.scrollTop = this.out.scrollHeight;
  }

  clear() {
    this.out.innerHTML = '';
  }

  /* -------------------------------------------------------------- prompt */

  private shortPath(p: string): string {
    if (p === '/home/user') return '~';
    if (p.startsWith('/home/user/')) return '~/' + p.slice(11);
    return p;
  }

  renderPrompt() {
    const user = this.env.get('USER') ?? 'origin';
    this.promptEl.innerHTML =
      `<span class="p-user">${escapeHtml(user)}</span>` +
      `<span class="p-host">@origin</span>` +
      `<span class="p-sign">:</span>` +
      `<span class="p-path">${escapeHtml(this.shortPath(this.cwd))}</span>` +
      `<span class="p-sign">$&nbsp;</span>`;
    this.env.set('PWD', this.cwd);
  }

  private banner() {
    let motd = '';
    try {
      motd = this.host.vfs.read('/etc/motd');
    } catch {
      /* ignore */
    }
    if (motd) this.write(`${S.dim}${motd.trim()}${S.r}`);
    this.write(`${S.dim}────────────────────────────────────────────────────────${S.r}`);
    this.write('');
  }

  /* --------------------------------------------------------------- input */

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.busy) return;
      const line = this.input.value;
      this.input.value = '';
      this.echoCommand(line);
      if (line.trim()) {
        this.pushHistory(line);
        void this.execute(line.trim());
      } else {
        this.renderPrompt();
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.historyList.length) return;
      if (this.histIndex === -1) this.histIndex = this.historyList.length;
      this.histIndex = Math.max(0, this.histIndex - 1);
      this.input.value = this.historyList[this.histIndex] ?? '';
      this.input.setSelectionRange(999, 999);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.histIndex === -1) return;
      this.histIndex = Math.min(this.historyList.length, this.histIndex + 1);
      this.input.value = this.historyList[this.histIndex] ?? '';
      if (this.histIndex >= this.historyList.length) this.histIndex = -1;
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      this.complete();
      return;
    }
    if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      this.write(`${S.dim}^C${S.r}`);
      this.input.value = '';
      this.renderPrompt();
      return;
    }
    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      this.clear();
      this.renderPrompt();
      return;
    }
    if (e.key === 'u' && e.ctrlKey) {
      e.preventDefault();
      this.input.value = '';
    }
  }

  private echoCommand(line: string) {
    const promptHtml = this.promptEl.innerHTML;
    const div = document.createElement('div');
    div.className = 'term-line';
    div.innerHTML = promptHtml + ansiToHtml(escapeHtml(line));
    this.out.appendChild(div);
    this.scroll();
  }

  private pushHistory(line: string) {
    if (this.historyList[this.historyList.length - 1] === line) return;
    this.historyList.push(line);
    if (this.historyList.length > 200) this.historyList.shift();
    this.histIndex = -1;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.historyList));
    } catch {
      /* ignore */
    }
  }

  history(): string[] {
    return [...this.historyList];
  }

  /* ---------------------------------------------------------- completion */

  private complete() {
    const value = this.input.value;
    const parts = value.split(/\s+/);
    const last = parts[parts.length - 1] ?? '';
    let candidates: string[] = [];

    if (parts.length === 1) {
      candidates = COMMAND_NAMES.filter((n) => n.startsWith(last));
    } else {
      const slash = last.lastIndexOf('/');
      const dirPart = slash >= 0 ? last.slice(0, slash + 1) : '';
      const prefix = slash >= 0 ? last.slice(slash + 1) : last;
      const dir = this.resolve(dirPart || '.');
      try {
        candidates = this.host.vfs
          .list(dir)
          .filter((n) => n.name.toLowerCase().startsWith(prefix.toLowerCase()))
          .map((n) => dirPart + n.name + (n.type === 'dir' ? '/' : ''));
      } catch {
        candidates = [];
      }
    }

    if (candidates.length === 0) return;
    if (candidates.length === 1) {
      parts[parts.length - 1] = candidates[0];
      this.input.value = parts.join(' ') + (candidates[0].endsWith('/') ? '' : ' ');
      return;
    }
    const common = candidates.reduce((a, b) => {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return a.slice(0, i);
    });
    if (common.length > last.length) {
      parts[parts.length - 1] = common;
      this.input.value = parts.join(' ');
    }
    this.write(`${S.dim}${candidates.join('   ')}${S.r}`);
    this.renderPrompt();
  }

  /* -------------------------------------------------------------- shell */

  resolve(p: string): string {
    return normalizePath(p, this.cwd);
  }

  setCwd(p: string) {
    this.cwd = normalizePath(p);
    this.env.set('PWD', this.cwd);
    this.renderPrompt();
  }

  notify(title: string, body: string, icon = 'info') {
    this.host.kernel.notify(title, body, icon);
  }

  openApp(id: string, args?: Record<string, any>) {
    this.host.kernel.open(id, args);
  }

  async execute(line: string) {
    this.busy = true;
    this.input.disabled = true;
    try {
      const jobs = this.parse(line);
      let last = 0;
      for (const job of jobs) {
        if (job.connector === '&&' && last !== 0) continue;
        if (job.connector === '||' && last === 0) continue;
        last = await this.runJob(job);
        this.lastCode = last;
      }
    } catch (e: any) {
      this.error(`osh: ${e?.message ?? e}`);
    } finally {
      this.busy = false;
      this.input.disabled = false;
      this.renderPrompt();
      this.scroll();
      this.input.focus();
    }
  }

  private async runJob(job: Job): Promise<number> {
    let stdin = '';
    let result: CmdResult = {};
    const vfs = this.host.vfs;

    for (let i = 0; i < job.stages.length; i++) {
      const stage = job.stages[i];
      if (stage.redirectIn) {
        try {
          stdin = vfs.read(this.resolve(stage.redirectIn));
        } catch (e: any) {
          this.error(`osh: ${stage.redirectIn}: ${e.message}`);
          return 1;
        }
      }
      result = await this.exec(stage.argv, stdin);
      if (i < job.stages.length - 1) stdin = result.out ?? '';
    }

    const out = result.out ?? '';
    const stage = job.stages[job.stages.length - 1];
    if (stage?.redirectOut) {
      const p = this.resolve(stage.redirectOut.path);
      try {
        if (stage.redirectOut.append && vfs.exists(p)) vfs.write(p, vfs.read(p) + out + '\n');
        else vfs.write(p, out + '\n');
      } catch (e: any) {
        this.error(`osh: ${stage.redirectOut.path}: ${e.message}`);
      }
    } else if (out !== '') {
      this.write(out.endsWith('\n') ? out.slice(0, -1) : out);
    }
    if (result.err) this.error(result.err);
    this.scroll();
    return result.code ?? 0;
  }

  private async exec(argv: string[], stdin: string): Promise<CmdResult> {
    if (!argv.length) return { code: 0 };
    const name = argv[0];

    // direct execution of OSL scripts
    if (name.endsWith('.osl') || name.startsWith('./') || name.startsWith('../')) {
      const p = this.resolve(name);
      if (this.host.vfs.exists(p) && !this.host.vfs.isDir(p)) {
        if (p.endsWith('.osl')) {
          const code = this.runOsl(p, argv.slice(1));
          return { code };
        }
        return { err: `osh: ${name}: Permission denied`, code: 126 };
      }
    }

    if (name === 'll') return this.exec(['ls', '-l', ...argv.slice(1)], stdin);
    if (name === 'la') return this.exec(['ls', '-la', ...argv.slice(1)], stdin);
    if (name === 'l') return this.exec(['ls', ...argv.slice(1)], stdin);

    const cmd = getCommand(name);
    if (!cmd) {
      const similar = COMMAND_NAMES.find((n) => n.startsWith(name.slice(0, 2)));
      return {
        err: `osh: command not found: ${name}${similar ? `\n${S.dim}did you mean '${similar}'?${S.r}` : ''}`,
        code: 127,
      };
    }
    try {
      return await cmd.run({ term: this, argv: argv.slice(1), stdin });
    } catch (e: any) {
      return { err: `${name}: ${e?.message ?? e}`, code: 1 };
    }
  }

  runOsl(path: string, argv: string[]): number {
    const vfs = this.host.vfs;
    let src = '';
    try {
      src = vfs.read(path);
    } catch (e: any) {
      this.error(`osl: ${e.message}`);
      return 1;
    }
    const derived: Host = {
      ...this.host,
      cwd: () => this.cwd,
      print: (s: string) => this.print(s),
    };
    const interp = new Interpreter();
    const builtins = createBuiltins(interp, derived);
    const argsMap = new Map<string, any>();
    argsMap.set('path', path);
    argsMap.set('file', basename(path));
    argsMap.set('cwd', this.cwd);
    argsMap.set('argv', argv);
    argsMap.set('n', argv.length);
    builtins.args = argsMap;
    for (const [k, v] of Object.entries(builtins)) interp.globals.define(k, v);
    interp.print = (s: string) => this.print(s);
    // Scripts may import sibling modules — resolve relative to the entry file.
    interp.loader = (p: string) => (vfs.exists(p) && !vfs.isDir(p) ? vfs.read(p) : null);
    try {
      interp.run(src, interp.globals, path);
      return 0;
    } catch (e: any) {
      this.error(`${basename(path)}: ${e?.message ?? e}`);
      return 1;
    }
  }

  /* ------------------------------------------------------- shell parser */

  private parse(line: string): Job[] {
    const toks = this.lex(line);
    const jobs: Job[] = [];
    let stages: Stage[] = [];
    let cur: Stage = { argv: [] };
    let connector: ';' | '&&' | '||' = ';';

    const finishStage = () => {
      if (cur.argv.length || cur.redirectIn || cur.redirectOut) {
        stages.push(cur);
        cur = { argv: [] };
      }
    };
    const finishJob = (next: ';' | '&&' | '||') => {
      finishStage();
      if (stages.length) jobs.push({ stages, connector });
      stages = [];
      connector = next;
    };

    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t === '|') {
        finishStage();
        continue;
      }
      if (t === '&&' || t === '||' || t === ';') {
        finishJob(t);
        continue;
      }
      if (t === '>' || t === '>>') {
        cur.redirectOut = { path: toks[++i] ?? '', append: t === '>>' };
        continue;
      }
      if (t === '<') {
        cur.redirectIn = toks[++i] ?? '';
        continue;
      }
      cur.argv.push(t);
    }
    finishJob(';');
    return jobs;
  }

  private lex(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let has = false;
    let i = 0;
    const expand = (): string => {
      let name = '';
      if (line[i + 1] === '{') {
        const close = line.indexOf('}', i + 2);
        if (close > 0) {
          name = line.slice(i + 2, close);
          i = close + 1;
          return this.env.get(name) ?? '';
        }
      }
      i++;
      while (i < line.length && /[A-Za-z0-9_]/.test(line[i])) name += line[i++];
      i--;
      if (name === '?') return String(this.lastCode);
      return this.env.get(name) ?? '';
    };

    while (i < line.length) {
      const ch = line[i];
      if (ch === "'") {
        i++;
        has = true;
        while (i < line.length && line[i] !== "'") cur += line[i++];
        i++;
        continue;
      }
      if (ch === '"') {
        i++;
        has = true;
        while (i < line.length && line[i] !== '"') {
          if (line[i] === '\\') {
            cur += line[i + 1] ?? '';
            i += 2;
          } else if (line[i] === '$') {
            cur += expand();
            i++;
          } else cur += line[i++];
        }
        i++;
        continue;
      }
      if (ch === '$') {
        cur += expand();
        has = true;
        i++;
        continue;
      }
      if (ch === '~' && cur === '') {
        cur += '/home/user';
        has = true;
        i++;
        continue;
      }
      if (ch === ' ' || ch === '\t') {
        if (cur || has) {
          out.push(cur);
          cur = '';
          has = false;
        }
        i++;
        continue;
      }
      if ('|&;<>'.includes(ch)) {
        if (cur || has) {
          out.push(cur);
          cur = '';
          has = false;
        }
        const three = line.slice(i, i + 3);
        const two = line.slice(i, i + 2);
        if (two === '>>' || two === '&&' || two === '||') {
          out.push(two);
          i += 2;
        } else {
          out.push(ch);
          i++;
        }
        continue;
      }
      if (ch === '\\') {
        cur += line[i + 1] ?? '';
        has = true;
        i += 2;
        continue;
      }
      cur += ch;
      has = true;
      i++;
    }
    if (cur || has) out.push(cur);
    return out;
  }
}

/* --------------------------------------------------------------- helpers */

const ANSI_RE = /\x1b\[([0-9;]*)m/g;

export function ansiToHtml(input: string): string {
  let html = '';
  let last = 0;
  const state = { fg: '', bg: '', bold: false, dim: false, under: false };
  const wrap = (text: string) => {
    if (!text) return '';
    const cls = [state.fg, state.bg, state.bold ? 'ab' : '', state.dim ? 'ad' : '', state.under ? 'au' : ''].filter(Boolean).join(' ');
    return cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text);
  };
  ANSI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANSI_RE.exec(input))) {
    html += wrap(input.slice(last, m.index));
    last = ANSI_RE.lastIndex;
    const codes = (m[1] || '0').split(';').filter((x) => x !== '').map(Number);
    if (!codes.length) codes.push(0);
    for (const c of codes) {
      if (c === 0) {
        state.fg = '';
        state.bg = '';
        state.bold = false;
        state.dim = false;
        state.under = false;
      } else if (c === 1) state.bold = true;
      else if (c === 2) state.dim = true;
      else if (c === 4) state.under = true;
      else if (c === 22) {
        state.bold = false;
        state.dim = false;
      } else if (c === 24) state.under = false;
      else if (c >= 30 && c <= 37) state.fg = 'a' + (c - 30);
      else if (c >= 90 && c <= 97) state.fg = 'a' + (c - 90 + 8);
      else if (c === 39) state.fg = '';
      else if (c >= 40 && c <= 47) state.bg = 'b' + (c - 40);
      else if (c >= 100 && c <= 107) state.bg = 'ba' + (c - 100);
      else if (c === 49) state.bg = '';
    }
  }
  html += wrap(input.slice(last));
  // drop any other escape sequences
  return html.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
