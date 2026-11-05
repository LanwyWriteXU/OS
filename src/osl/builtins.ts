/**
 * OSL standard library — the bridge between scripts and the OS.
 */
import { Interpreter, NativeObject, NativeFunction, OslErrorValue, isCallable } from './interp';
import type { Host } from './host';
import { getLang, t as translate } from '../i18n';
import {
  normalizePath, joinPath, dirname, basename, extname, splitPath, humanSize, byteLength, type FsNode,
} from '../core/fs';

function fsNodeToMap(n: FsNode): Map<string, any> {
  const m = new Map<string, any>();
  m.set('name', n.name);
  m.set('path', n.path);
  m.set('type', n.type);
  m.set('size', n.type === 'file' ? byteLength(n.content) : 0);
  m.set('mtime', n.mtime);
  m.set('ctime', n.ctime);
  m.set('ext', extname(n.name));
  m.set('mode', n.mode);
  return m;
}

function fromJson(v: any): any {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(fromJson);
  const m = new Map<string, any>();
  for (const [k, val] of Object.entries(v)) m.set(k, fromJson(val));
  return m;
}

function toJson(v: any): any {
  if (v instanceof Map) {
    const o: Record<string, any> = {};
    for (const [k, val] of v) o[String(k)] = toJson(val);
    return o;
  }
  if (Array.isArray(v)) return v.map(toJson);
  if (v === undefined) return null;
  return v;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatTime(ts: number, fmt: string): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(2),
    MMMM: MONTHS[d.getMonth()],
    MMM: MONTHS[d.getMonth()].slice(0, 3),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    dd: pad(d.getDate()),
    d: String(d.getDate()),
    dddd: DAYS[d.getDay()],
    ddd: DAYS[d.getDay()].slice(0, 3),
    HH: pad(h24),
    hh: pad(h12),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    A: h24 < 12 ? 'AM' : 'PM',
  };
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|DD|dddd|ddd|dd|d|HH|hh|mm|ss|A/g, (t) => map[t] ?? t);
}

export function createBuiltins(interp: Interpreter, host: Host): Record<string, any> {
  const vfs = host.vfs;
  const resolve = (p: any): string => normalizePath(String(p ?? '.'), host.cwd());

  const fs = {
    read: (p: any) => vfs.read(resolve(p)),
    write: (p: any, content: any) => {
      vfs.write(resolve(p), String(content ?? ''));
      return true;
    },
    append: (p: any, content: any) => {
      vfs.append(resolve(p), String(content ?? ''));
      return true;
    },
    list: (p: any) => vfs.list(resolve(p)).map(fsNodeToMap),
    mkdir: (p: any) => {
      vfs.mkdir(resolve(p));
      return true;
    },
    remove: (p: any) => {
      vfs.remove(resolve(p));
      return true;
    },
    rename: (from: any, to: any) => {
      vfs.rename(resolve(from), resolve(to));
      return true;
    },
    copy: (from: any, to: any) => {
      vfs.copy(resolve(from), resolve(to));
      return true;
    },
    exists: (p: any) => vfs.exists(resolve(p)),
    isDir: (p: any) => vfs.isDir(resolve(p)),
    stat: (p: any) => fsNodeToMap(vfs.stat(resolve(p))),
    size: (p: any) => vfs.sizeOf(resolve(p)),
    count: (p: any) => vfs.countFiles(resolve(p)),
    home: () => '/home/user',
    cwd: () => host.cwd(),
    normalize: (p: any) => normalizePath(String(p), host.cwd()),
    sizeText: (bytes: any) => humanSize(Number(bytes) || 0),
    readJson: (p: any) => fromJson(JSON.parse(vfs.read(resolve(p)))),
    writeJson: (p: any, value: any) => {
      vfs.write(resolve(p), JSON.stringify(toJson(value), null, 2));
      return true;
    },
    touch: (p: any) => {
      const path = resolve(p);
      if (vfs.exists(path)) vfs.write(path, vfs.isDir(path) ? '' : vfs.read(path));
      else vfs.write(path, '');
      return true;
    },
    /** Recursive filename search under `root`. Returns file nodes. */
    search: (root: any, query: any, limit: any = 50) => {
      const base = resolve(root);
      const needle = String(query ?? '').toLowerCase();
      const max = Math.max(1, Number(limit) || 50);
      const out: any[] = [];
      const walk = (dir: string) => {
        if (out.length >= max) return;
        let items: FsNode[];
        try {
          items = vfs.list(dir);
        } catch {
          return;
        }
        for (const n of items) {
          if (out.length >= max) return;
          if (n.name.startsWith('.')) continue;
          if (n.type === 'dir') walk(n.path);
          else if (!needle || n.name.toLowerCase().includes(needle)) out.push(fsNodeToMap(n));
        }
      };
      walk(base);
      return out;
    },
  };

  const paths = {
    join: (...parts: any[]) => joinPath(...parts.map((p) => String(p))),
    dirname: (p: any) => dirname(resolve(p)),
    basename: (p: any) => basename(String(p)),
    extname: (p: any) => extname(String(p)),
    normalize: (p: any) => normalizePath(String(p), host.cwd()),
    split: (p: any) => splitPath(resolve(p)),
    home: () => '/home/user',
    relative: (p: any) => {
      const abs = resolve(p);
      const home = '/home/user';
      return abs.startsWith(home) ? '~' + abs.slice(home.length) : abs;
    },
  };

  const sys = {
    open: (appId: any, args: any = null) => {
      host.kernel.open(String(appId), args instanceof Map ? args : undefined);
      return true;
    },
    openPath: (p: any) => {
      host.kernel.openPath(resolve(p));
      return true;
    },
    apps: () => host.kernel.apps().map((a) => {
      const m = new Map();
      m.set('id', a.id);
      m.set('name', a.name);
      m.set('icon', a.icon);
      return m;
    }),
    windows: () => host.kernel.windows().map((w) => {
      const m = new Map();
      m.set('id', w.id);
      m.set('appId', w.appId);
      m.set('title', w.title);
      m.set('icon', w.icon);
      m.set('minimized', w.minimized);
      m.set('active', w.active);
      m.set('maximized', w.maximized);
      return m;
    }),
    focusWindow: (id: any) => host.kernel.focusWindow(Number(id)),
    minimizeWindow: (id: any) => host.kernel.minimizeWindow(Number(id)),
    closeWindow: (id: any) => host.kernel.closeWindow(Number(id)),
    notify: (title: any, body: any, icon: any = 'info') => {
      host.kernel.notify(String(title), String(body), String(icon));
      return true;
    },
    settings: () => {
      const m = new Map<string, any>();
      for (const [k, v] of Object.entries(host.settings.value)) m.set(k, v);
      return m;
    },
    setSetting: (key: any, value: any) => {
      host.settings.set(key as any, value);
      return true;
    },
    version: () => host.kernel.version(),
    uptime: () => host.kernel.uptime(),
    user: () => host.settings.get('user'),
    hostname: () => 'origin',
    touchRecent: (p: any) => {
      host.kernel.touchRecent(resolve(p));
      return true;
    },
    recent: () => host.kernel.recent().map((r) => {
      const m = new Map();
      m.set('name', r.name);
      m.set('path', r.path);
      return m;
    }),
    platform: () => 'OS 1.0 (Origin)',
    arch: () => 'oml-runtime',
    info: () => {
      const m = new Map<string, any>();
      m.set('cores', navigator.hardwareConcurrency || 4);
      m.set('resolution', `${window.screen.width} × ${window.screen.height}`);
      const mem = (performance as any).memory;
      const used = mem ? Math.round(mem.usedJSHeapSize / 1048576) : 96;
      m.set('memory', `${used} MiB / 512 MiB`);
      m.set('language', navigator.language || 'en-US');
      m.set('platform', navigator.platform || 'origin');
      m.set('files', vfs.countFiles('/'));
      m.set('size', vfs.sizeOf('/'));
      m.set('uptime', host.kernel.uptime());
      m.set('userAgent', navigator.userAgent);
      return m;
    },
    factoryReset: () => {
      host.kernel.factoryReset();
      return true;
    },
    notifications: () => host.kernel.notifications().map((n) => {
      const m = new Map<string, any>();
      m.set('id', n.id);
      m.set('title', n.title);
      m.set('body', n.body);
      m.set('icon', n.icon);
      return m;
    }),
    dismissNotification: (id: any) => host.kernel.dismissNotification(Number(id)),
    minimizeAll: () => {
      host.kernel.minimizeAll();
      return true;
    },
    lock: () => {
      host.kernel.lock();
      return true;
    },
    power: (mode: any) => {
      host.kernel.power(String(mode ?? 'off'));
      return true;
    },
    /** Runs OSL in an isolated interpreter: { ok, output, error }. */
    runScript: (source: any, p: any = null) => {
      const res = host.kernel.runScript(String(source ?? ''), p ? resolve(p) : undefined);
      const m = new Map<string, any>();
      m.set('ok', res.ok);
      m.set('output', res.output);
      m.set('error', res.error);
      return m;
    },
    log: (level: any, message: any) => {
      host.kernel.log(String(level ?? 'info'), String(message ?? ''));
      return true;
    },
    logs: (limit: any = 200) => host.kernel.logs(Number(limit)).map((e) => {
      const m = new Map<string, any>();
      m.set('id', e.id);
      m.set('time', e.time);
      m.set('level', e.level);
      m.set('message', e.message);
      return m;
    }),
    clearLogs: () => {
      host.kernel.clearLogs();
      return true;
    },
    /** Live battery state: { supported, level, charging, chargingTime, dischargingTime }. */
    battery: () => {
      const b = host.kernel.battery();
      const m = new Map<string, any>();
      m.set('supported', b.supported);
      m.set('level', b.level);
      m.set('charging', b.charging);
      m.set('chargingTime', b.chargingTime);
      m.set('dischargingTime', b.dischargingTime);
      return m;
    },
    network: () => host.kernel.network(),
    storage: () => {
      const st = host.kernel.storage();
      const m = new Map<string, any>();
      m.set('supported', st.supported);
      m.set('usage', st.usage);
      m.set('quota', st.quota);
      return m;
    },
    reloadApps: () => {
      host.kernel.reloadApps();
      return true;
    },
    volume: () => host.kernel.volume(),
    setVolume: (level: any) => {
      host.kernel.setVolume(Number(level));
      return true;
    },
    toggleMute: () => host.kernel.toggleMute(),
    /** Size of the window layer, useful for laying out desktop icons. */
    viewport: () => {
      const el = document.querySelector('#window-layer') as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      const m = new Map<string, any>();
      m.set('width', Math.round(r?.width ?? window.innerWidth));
      m.set('height', Math.round(r?.height ?? window.innerHeight));
      return m;
    },
    /** Snapshot of window / storage / log counters. */
    metrics: () => {
      const m = new Map<string, any>();
      m.set('windows', host.kernel.windows().length);
      m.set('apps', host.kernel.apps().length);
      m.set('files', vfs.countFiles('/'));
      m.set('bytes', vfs.sizeOf('/'));
      m.set('logs', host.kernel.logs(1).length === 0 ? 0 : host.kernel.logs(1000).length);
      m.set('uptime', host.kernel.uptime());
      return m;
    },
  };

  const ui = {
    refresh: () => {
      host.refresh();
      return true;
    },
    alert: (message: any, title: any = 'OS') => {
      host.ui.alert(String(message), String(title));
      return true;
    },
    confirm: (message: any, onOk: any, title: any = 'OS') => {
      host.ui.confirm(
        String(message),
        () => {
          if (isCallable(onOk)) interp.callFunction(onOk, []);
        },
        String(title),
      );
      return true;
    },
    prompt: (title: any, value: any, onOk: any) => {
      host.ui.prompt(String(title), String(value ?? ''), (value: string) => {
        if (isCallable(onOk)) interp.callFunction(onOk, [value]);
      });
      return true;
    },
    toast: (message: any, icon: any = 'check') => {
      host.ui.toast(String(message), String(icon));
      return true;
    },
    menu: (items: any, onPick: any, x: any = null, y: any = null, keep: any = false) => {
      const list = Array.isArray(items) ? items : [];
      host.ui.menu(
        list,
        (item: any) => {
          if (isCallable(onPick)) interp.callFunction(onPick, [item]);
        },
        x === null ? undefined : Number(x),
        y === null ? undefined : Number(y),
        !!keep,
      );
      return true;
    },
    chooseImage: (onPick: any) => {
      host.ui.chooseImage((dataUrl: string) => {
        if (isCallable(onPick)) interp.callFunction(onPick, [dataUrl]);
      });
      return true;
    },
  };

  const win = {
    setTitle: (t: any) => {
      host.window.setTitle(String(t));
      return true;
    },
    close: () => {
      host.window.close();
      return true;
    },
    minimize: () => {
      host.window.minimize();
      return true;
    },
    maximize: () => {
      host.window.maximize();
      return true;
    },
    restore: () => {
      host.window.restore();
      return true;
    },
    toggleMax: () => {
      host.window.toggleMax();
      return true;
    },
    setSize: (w: any, h: any) => {
      host.window.setSize(Number(w), Number(h));
      return true;
    },
    move: (x: any, y: any) => {
      host.window.move(Number(x), Number(y));
      return true;
    },
    center: () => {
      host.window.center();
      return true;
    },
    toggleFullscreen: () => {
      host.window.toggleFullscreen();
      return true;
    },
    isFullscreen: () => host.window.isFullscreen(),
    isMaximized: () => host.window.isMaximized(),
    id: () => host.window.id,
  };

  const time = {
    now: () => Date.now(),
    format: (ts: any = Date.now(), fmt: any = 'YYYY-MM-DD HH:mm:ss') => formatTime(Number(ts), String(fmt)),
    date: () => new Date().toDateString(),
    year: () => new Date().getFullYear(),
    /** Calendar-friendly decomposition of a timestamp. */
    parts: (ts: any = Date.now()): Map<string, any> => {
      const d = new Date(Number(ts));
      const m = new Map<string, any>();
      m.set('year', d.getFullYear());
      m.set('month', d.getMonth() + 1);
      m.set('day', d.getDate());
      m.set('weekday', d.getDay());
      m.set('hours', d.getHours());
      m.set('minutes', d.getMinutes());
      m.set('seconds', d.getSeconds());
      m.set('daysInMonth', new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
      m.set('timestamp', d.getTime());
      return m;
    },
    /** Builds a timestamp from calendar fields (month is 1-based). */
    make: (year: any, month: any, day: any = 1, hours: any = 0, minutes: any = 0) =>
      new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes)).getTime(),
    /** Locale-aware formatting driven by the UI language setting. */
    intl: (ts: any = Date.now(), style: any = 'date'): string => {
      const locale = getLang() === 'zh' ? 'zh-CN' : 'en-US';
      const d = new Date(Number(ts));
      const options: Record<string, Intl.DateTimeFormatOptions> = {
        month: { month: 'long' },
        monthYear: { month: 'long', year: 'numeric' },
        weekday: { weekday: 'long' },
        weekdayShort: { weekday: 'short' },
        date: { year: 'numeric', month: 'short', day: 'numeric' },
        time: { hour: '2-digit', minute: '2-digit' },
        full: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' },
      };
      try {
        return new Intl.DateTimeFormat(locale, options[String(style)] ?? options.date).format(d);
      } catch {
        return d.toDateString();
      }
    },
    startOfDay: (ts: any = Date.now()) => {
      const d = new Date(Number(ts));
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    },
    addDays: (ts: any, days: any) => {
      const d = new Date(Number(ts));
      d.setDate(d.getDate() + Number(days));
      return d.getTime();
    },
  };

  const math = {
    pi: Math.PI,
    e: Math.E,
    floor: (n: any) => Math.floor(Number(n)),
    ceil: (n: any) => Math.ceil(Number(n)),
    round: (n: any, digits: any = 0) => {
      const f = Math.pow(10, Number(digits));
      return Math.round(Number(n) * f) / f;
    },
    abs: (n: any) => Math.abs(Number(n)),
    sqrt: (n: any) => Math.sqrt(Number(n)),
    pow: (a: any, b: any) => Math.pow(Number(a), Number(b)),
    min: (...a: any[]) => Math.min(...a.map(Number)),
    max: (...a: any[]) => Math.max(...a.map(Number)),
    random: () => Math.random(),
    randint: (a: any, b: any) => Math.floor(Math.random() * (Number(b) - Number(a) + 1)) + Number(a),
    sign: (n: any) => Math.sign(Number(n)),
  };

  const json = {
    parse: (s: any) => fromJson(JSON.parse(String(s))),
    stringify: (v: any, pretty: any = false) => JSON.stringify(toJson(v), null, pretty ? 2 : 0),
  };

  const i18n = {
    /** Re-reads /usr/share/i18n/*.json and repaints every window. */
    reload: () => {
      host.kernel.reloadI18n();
      return true;
    },
    /** Parsed catalogue for a language (defaults to the active one). */
    catalog: (lang: any = null) => {
      const code = String(lang ?? host.settings.get('lang'));
      const p = resolve(`/usr/share/i18n/${code}.json`);
      if (!vfs.exists(p)) return new Map<string, any>();
      try {
        return fromJson(JSON.parse(vfs.read(p)));
      } catch (e) {
        throw new Error(`invalid i18n catalogue: ${(e as Error).message}`);
      }
    },
    langs: () => ['en', 'zh'],
  };

  const store = {
    get: (key: any, def: any = null) => {
      try {
        const raw = localStorage.getItem('os.store.' + String(key));
        return raw === null ? def : fromJson(JSON.parse(raw));
      } catch {
        return def;
      }
    },
    set: (key: any, value: any) => {
      try {
        localStorage.setItem('os.store.' + String(key), JSON.stringify(toJson(value)));
      } catch {
        /* ignore */
      }
      return true;
    },
    remove: (key: any) => {
      localStorage.removeItem('os.store.' + String(key));
      return true;
    },
  };

  const clip = {
    read: () => (globalThis as any).__osClipboard ?? '',
    write: (text: any) => {
      const s = String(text ?? '');
      (globalThis as any).__osClipboard = s;
      try {
        void navigator.clipboard?.writeText(s);
      } catch {
        /* ignore */
      }
      return true;
    },
  };

  const imports: Record<string, any> = {
    fs: new NativeObject('fs', fs),
    paths: new NativeObject('paths', paths),
    sys: new NativeObject('sys', sys),
    ui: new NativeObject('ui', ui),
    win: new NativeObject('win', win),
    time: new NativeObject('time', time),
    math: new NativeObject('math', math),
    json: new NativeObject('json', json),
    JSON: new NativeObject('JSON', json),
    i18n: new NativeObject('i18n', i18n),
    store: new NativeObject('store', store),
    clip: new NativeObject('clip', clip),
    console: new NativeObject('console', {
      log: (...a: any[]) => host.print(a.map((x) => interp.toStr(x)).join(' ')),
      warn: (...a: any[]) => host.print(a.map((x) => interp.toStr(x)).join(' ')),
      error: (...a: any[]) => host.print(a.map((x) => interp.toStr(x)).join(' ')),
    }),
  };

  /* ------------------------------------------------------------- globals */

  const globals: Record<string, any> = {
    ...imports,
    args: host.args,

    /** Message catalogue lookup. `t("Files")`, or `t("{0} items", n)`. */
    t: (key: any, ...rest: any[]) => translate(String(key), ...rest),
    lang: () => getLang(),

    /* Typed error constructors — `raise ValueError("empty")`. */
    Error: (message: any = '') => new OslErrorValue('Error', String(message)),
    TypeError: (message: any = '') => new OslErrorValue('TypeError', String(message)),
    ValueError: (message: any = '') => new OslErrorValue('ValueError', String(message)),
    RangeError: (message: any = '') => new OslErrorValue('RangeError', String(message)),

    refresh: () => {
      host.refresh();
      return true;
    },
    print: (...args: any[]) => {
      host.print(args.map((a) => interp.toStr(a)).join(' '));
      return null;
    },
    len: (v: any) => {
      if (typeof v === 'string') return v.length;
      if (Array.isArray(v)) return v.length;
      if (v instanceof Map) return v.size;
      if (v instanceof NativeObject) return Object.keys(v.obj).length;
      if (v === null) return 0;
      throw new Error(`len() is not defined for ${interp.typeOf(v)}`);
    },
    range: (a: any, b: any = null, step: any = null) => {
      let start = 0;
      let end = Number(a);
      let inc = 1;
      if (b !== null) {
        start = Number(a);
        end = Number(b);
      }
      if (step !== null) inc = Number(step);
      if (inc === 0) throw new Error('range() step cannot be zero');
      const out: number[] = [];
      if (inc > 0) for (let i = start; i < end && out.length < 200000; i += inc) out.push(i);
      else for (let i = start; i > end && out.length < 200000; i += inc) out.push(i);
      return out;
    },
    str: (v: any) => interp.toStr(v),
    int: (v: any) => {
      const n = parseInt(String(v), 10);
      return Number.isFinite(n) ? n : 0;
    },
    float: (v: any) => {
      const n = parseFloat(String(v));
      return Number.isFinite(n) ? n : 0;
    },
    bool: (v: any) => interp.truthy(v),
    type: (v: any) => interp.typeOf(v),
    sum: (list: any[]) => (Array.isArray(list) ? list.reduce((a, b) => a + interp.num(b), 0) : 0),
    min: (...args: any[]) => {
      const arr = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      return arr.reduce((a: any, b: any) => (interp.num(b) < interp.num(a) ? b : a));
    },
    max: (...args: any[]) => {
      const arr = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      return arr.reduce((a: any, b: any) => (interp.num(b) > interp.num(a) ? b : a));
    },
    abs: (n: any) => Math.abs(Number(n)),
    round: (n: any, digits: any = 0) => {
      const f = Math.pow(10, Number(digits));
      return Math.round(Number(n) * f) / f;
    },
    sorted: (list: any, keyFn: any = null) => {
      const arr = [...interp.iterable(list)];
      arr.sort((a, b) => {
        const av = keyFn ? interp.callFunction(keyFn, [a]) : a;
        const bv = keyFn ? interp.callFunction(keyFn, [b]) : b;
        if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv);
        return Number(av) - Number(bv);
      });
      return arr;
    },
    reversed: (list: any) => [...interp.iterable(list)].reverse(),
    enumerate: (list: any) => interp.iterable(list).map((v, i) => [i, v]),
    zip: (...lists: any[]) => {
      const arrs = lists.map((l) => interp.iterable(l));
      const n = Math.min(...arrs.map((a) => a.length));
      return Array.from({ length: n }, (_, i) => arrs.map((a) => a[i]));
    },
    map: (fn: any, list: any) => interp.iterable(list).map((v, i) => interp.callFunction(fn, [v, i])),
    filter: (fn: any, list: any) => interp.iterable(list).filter((v, i) => interp.truthy(interp.callFunction(fn, [v, i]))),
    any: (list: any) => interp.iterable(list).some((v) => interp.truthy(v)),
    all: (list: any) => interp.iterable(list).every((v) => interp.truthy(v)),
    chr: (n: any) => String.fromCharCode(Number(n)),
    ord: (s: any) => String(s).charCodeAt(0),
    eval: (src: any) => interp.evalExpression(String(src), interp.globals),
    sleep: (_ms: any) => null,
    every: (ms: any, fn: any) => {
      host.every(Number(ms), fn);
      return true;
    },
    /** One-shot timer: `after(180, hidePreview)`. */
    after: (ms: any, fn: any) => {
      setTimeout(() => {
        if (!isCallable(fn)) return;
        try {
          interp.callFunction(fn, []);
        } catch (e) {
          console.error('[OSL:after]', e);
        }
      }, Number(ms));
      return true;
    },
    notify: (title: any, body: any, icon: any = 'info') => {
      host.kernel.notify(String(title), String(body), String(icon));
      return true;
    },
    open: (p: any) => {
      host.kernel.openPath(resolve(p));
      return true;
    },
    uuid: () => Math.random().toString(36).slice(2, 10),
  };

  // Wrap every plain function so the interpreter can call it.
  for (const [k, v] of Object.entries(globals)) {
    if (typeof v === 'function') globals[k] = new NativeFunction(k, v as any);
  }

  return globals;
}

export { isCallable };
