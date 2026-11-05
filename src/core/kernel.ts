/**
 * The kernel: boots the shell, hosts applications, owns notifications and
 * implements the syscall surface exposed to OSL.
 */
import shellOml from '../system/shell.oml?raw';
import shellOsl from '../system/shell.osl?raw';
import dialogOml from '../system/dialog.oml?raw';
import menuOml from '../system/menu.oml?raw';
import { Vfs, basename } from './fs';
import { SettingsStore } from './settings';
import { WindowManager, type ManagedWindow } from './wm';
import { Overlays } from '../oml/overlay';
import { UiInstance } from '../oml/renderer';
import { Interpreter } from '../osl/interp';
import { createBuiltins, formatTime } from '../osl/builtins';
import type { Host, KernelApi, WindowHandle, WindowInfo, AppInfo, UiBridge } from '../osl/host';
import { APPS, getApp, type AppDef } from '../apps/registry';
import { iconSvg } from '../ui/icons';
import { t as tr, setCatalog, catalogJson, catalogFor, type Lang } from '../i18n';

interface AppInstance {
  win: ManagedWindow;
  interp: Interpreter;
  ui: UiInstance;
  timers: any[];
}

interface Notification {
  id: number;
  title: string;
  body: string;
  icon: string;
}

const RECENT_KEY = 'os.recent.v1';

export class Kernel implements KernelApi {
  wm = new WindowManager();
  overlays!: Overlays;
  shellUi: UiInstance | null = null;
  shellInterp: Interpreter | null = null;
  shellHost!: Host;
  instances = new Map<number, AppInstance>();
  private notifs: Notification[] = [];
  private notifSeq = 0;
  private logEntries: Array<{ id: number; time: number; level: string; message: string }> = [];
  private logSeq = 0;
  private recentList: Array<{ name: string; path: string }> = [];
  private bootTime = Date.now();
  private root!: HTMLElement;
  private lockEl: HTMLElement | null = null;
  private sysHost!: Host;
  private batteryState = {
    supported: false,
    level: 100,
    charging: false,
    chargingTime: -1,
    dischargingTime: -1,
  };
  private online = true;
  private audioCtx: AudioContext | null = null;
  /** Metadata loaded from /etc/apps.json (name, icon, size, hidden). */
  private appMeta = new Map<string, any>();
  /** Real IndexedDB quota/usage, read once at boot (bytes). */
  private storageQuota = { supported: false, usage: 0, quota: 0 };

  constructor(public vfs: Vfs, public settings: SettingsStore) {
    this.loadRecent();
    this.overlays = new Overlays(this.makeSystemHost());
    this.vfs.onChange(() => {
      for (const inst of this.instances.values()) inst.ui.scheduleRefresh();
    });
    this.wm.onChange = () => this.shellUi?.scheduleRefresh();
    // Re-render every open window when a setting changes (theme, language…).
    this.settings.onChange(() => {
      for (const inst of this.instances.values()) inst.ui.scheduleRefresh();
      this.shellUi?.scheduleRefresh();
    });
    this.wm.minimizeResolver = (w) => {
      // Prefer the window's own button; fall back to the pinned app button so
      // the first minimisation into the dock still has somewhere to fly to.
      const el =
        (this.root?.querySelector(`[data-win="${w.id}"]`) as HTMLElement | null) ??
        (this.root?.querySelector(`[data-app="${w.appId}"]`) as HTMLElement | null);
      const box = el?.getBoundingClientRect();
      if (!box || !box.width) return null;
      // The window layer clips at the work area edge, so aim a few pixels
      // inside it: the ghost then appears to sink behind the taskbar/dock.
      const layer = this.wm.layer?.getBoundingClientRect();
      const y = Math.min(box.top + box.height / 2, (layer?.bottom ?? box.bottom) - 6);
      return { x: box.left + box.width / 2, y };
    };
    this.initBattery();
    this.initStorage();
    this.online = typeof navigator === 'undefined' ? true : navigator.onLine;
    window.addEventListener('online', () => {
      this.online = true;
      this.shellUi?.scheduleRefresh();
    });
    window.addEventListener('offline', () => {
      this.online = false;
      this.shellUi?.scheduleRefresh();
    });
  }

  /* -------------------------------------------------------------- sensors */

  private initBattery() {
    const nav = navigator as any;
    if (typeof nav.getBattery !== 'function') return;
    nav
      .getBattery()
      .then((battery: any) => {
        const sync = () => {
          this.batteryState = {
            supported: true,
            level: Math.round(Number(battery.level) * 100),
            charging: !!battery.charging,
            chargingTime: Number(battery.chargingTime ?? -1),
            dischargingTime: Number(battery.dischargingTime ?? -1),
          };
          this.shellUi?.scheduleRefresh();
        };
        sync();
        for (const ev of ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange']) {
          battery.addEventListener?.(ev, sync);
        }
      })
      .catch(() => {
        /* Battery Status API unavailable — keep the conservative defaults. */
      });
  }

  battery() {
    return { ...this.batteryState };
  }

  network(): boolean {
    return this.online;
  }

  private initStorage() {
    const nav = navigator as any;
    if (typeof nav.storage?.estimate !== 'function') return;
    nav.storage
      .estimate()
      .then((est: any) => {
        this.storageQuota = {
          supported: true,
          usage: Number(est.usage ?? 0),
          quota: Number(est.quota ?? 0),
        };
        this.shellUi?.scheduleRefresh();
      })
      .catch(() => {
        /* Storage Manager unavailable. */
      });
  }

  /** Real IndexedDB quota/usage: { supported, usage, quota } in bytes. */
  storage(): { supported: boolean; usage: number; quota: number } {
    return { ...this.storageQuota };
  }

  volume(): number {
    return this.settings.get('muted') ? 0 : this.settings.get('volume');
  }

  setVolume(level: number) {
    const v = Math.max(0, Math.min(100, Math.round(level)));
    this.settings.patch({ volume: v, muted: v === 0 ? true : false });
  }

  toggleMute(): boolean {
    const muted = !this.settings.get('muted');
    this.settings.patch({ muted });
    return muted;
  }

  /** Short two-tone chime whose loudness follows the system volume. */
  chime(kind: 'notice' | 'error' = 'notice') {
    const vol = this.volume();
    if (vol <= 0) return;
    try {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.audioCtx ??= new Ctor();
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') void ctx.resume();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime((vol / 100) * 0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      gain.connect(ctx.destination);
      const base = kind === 'error' ? 392 : 660;
      for (const [i, freq] of [base, base * 1.5].entries()) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(now + i * 0.09);
        osc.stop(now + 0.3 + i * 0.09);
      }
    } catch {
      /* audio is a nicety; never let it break a notification */
    }
  }

  /* --------------------------------------------------------------- boot */

  async boot(root: HTMLElement) {
    this.root = root;
    this.seedSystemFiles();
    this.loadCatalogs();
    this.loadAppRegistry();
    const interp = new Interpreter();
    this.shellInterp = interp;
    const host = this.makeSystemHost();
    host.appId = 'shell';
    host.refresh = () => this.shellUi?.scheduleRefresh();
    host.every = (ms: number, fn: any) => {
      setInterval(() => {
        try {
          interp.callFunction(fn, []);
        } catch (e) {
          console.error('[OSL:shell:every]', e);
        }
      }, ms);
    };
    host.print = (s: string) => console.log('[OSL:shell]', s);
    this.shellHost = host;

    const builtins = createBuiltins(interp, host);
    for (const [k, v] of Object.entries(builtins)) interp.globals.define(k, v);
    interp.loader = (p: string) => (this.vfs.exists(p) && !this.vfs.isDir(p) ? this.vfs.read(p) : null);
    interp.modulePath = '/home/user';

    // The shell is editable too: /usr/share/os/shell.osl overrides the bundle.
    const shellOslSrc = this.vfs.exists('/usr/share/os/shell.osl') ? this.vfs.read('/usr/share/os/shell.osl') : shellOsl;
    const shellOmlSrc = this.vfs.exists('/usr/share/os/shell.oml') ? this.vfs.read('/usr/share/os/shell.oml') : shellOml;
    try {
      interp.run(shellOslSrc, interp.globals);
    } catch (e: any) {
      console.error('[OSL:shell]', e);
      this.notify('Shell error', String(e?.message ?? e), 'alert');
    }

    this.shellUi = new UiInstance(root, interp, host);
    this.shellUi.onBeforeRefresh = () => {
      try {
        interp.callByName('onRefresh');
      } catch (e) {
        console.error('[OSL:shell:onRefresh]', e);
      }
    };
    try {
      this.shellUi.mount(shellOmlSrc, interp.globals);
    } catch (e: any) {
      console.error('[OML:shell]', e);
      root.innerHTML = `<div class="fatal">Failed to mount the shell: ${escapeHtml(String(e?.message ?? e))}</div>`;
      return;
    }

    const layer = root.querySelector('#window-layer') as HTMLElement | null;
    if (layer) this.wm.attach(layer);
    this.installShortcuts();
    this.installFileDrop();
    this.log('system', `boot ${this.version()}`);
  }

  /* -------------------------------------------------------- drag & drop */

  /**
   * Dragging files from the host computer onto the desktop imports them into
   * ~/Downloads. Small text files are stored as text; anything else becomes a
   * data URL so images and binaries survive the round-trip.
   */
  private installFileDrop() {
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      for (const file of Array.from(files)) {
        this.importFile(file);
      }
    });
  }

  private importFile(file: File) {
    const name = file.name || 'drop.bin';
    const target = `/home/user/Downloads/${name}`;
    const isText = /\.(txt|md|osl|oml|json|log|csv|tsv|html|css|js|ts|sh|py|xml|yml|yaml)$/i.test(name);
    const finish = (content: string) => {
      this.vfs.write(target, content);
      this.notify(tr('Imported'), `${name} → ~/Downloads`, 'download');
    };
    if (isText && file.size < 1024 * 1024) {
      const reader = new FileReader();
      reader.onload = () => finish(String(reader.result ?? ''));
      reader.onerror = () => this.notify(tr('Import failed'), name, 'alert');
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => finish(String(reader.result ?? ''));
      reader.onerror = () => this.notify(tr('Import failed'), name, 'alert');
      reader.readAsDataURL(file);
    }
  }

  /* ------------------------------------------------------------ windows */

  open(appId: string, rawArgs?: Record<string, any> | Map<string, any>) {
    const app = getApp(appId);
    if (!app) {
      this.notify('OS', `Unknown application: ${appId}`, 'alert');
      return;
    }
    const meta = this.metaFor(app);
    const win = this.wm.open({
      appId: app.id,
      title: tr(meta.name),
      icon: meta.icon,
      width: meta.width,
      height: meta.height,
    });

    const args = new Map<string, any>();
    if (rawArgs instanceof Map) for (const [k, v] of rawArgs) args.set(k, v);
    else if (rawArgs) for (const [k, v] of Object.entries(rawArgs)) args.set(k, v);

    const interp = new Interpreter();
    let ui: UiInstance;
    const timers: any[] = [];

    const host: Host = {
      vfs: this.vfs,
      settings: this.settings,
      kernel: this,
      window: this.makeWindowHandle(win),
      appId: app.id,
      args,
      ui: this.uiBridge(),
      refresh: () => ui?.scheduleRefresh(),
      every: (ms: number, fn: any) => {
        const id = setInterval(() => {
          try {
            interp.callFunction(fn, []);
          } catch (e) {
            console.error(`[OSL:${app.id}:every]`, e);
          }
        }, ms);
        timers.push(id);
      },
      print: (s: string) => console.log(`[OSL:${app.id}]`, s),
      cwd: () => '/home/user',
    };

    const builtins = createBuiltins(interp, host);
    for (const [k, v] of Object.entries(builtins)) interp.globals.define(k, v);
    interp.print = (s: string) => console.log(`[OSL:${app.id}]`, s);
    interp.loader = (p: string) => (this.vfs.exists(p) && !this.vfs.isDir(p) ? this.vfs.read(p) : null);
    interp.modulePath = String(args.get('path') ?? '/home/user');

    ui = new UiInstance(win.body, interp, host);
    const inst: AppInstance = { win, interp, ui, timers };
    this.instances.set(win.id, inst);
    win.onClose = () => {
      this.instances.delete(win.id);
      for (const t of timers) clearInterval(t);
      this.log('app', `close ${app.id}`);
    };
    this.log('app', `open ${app.id}`);

    // Prefer the editable copy in the VFS so edits made in Files take effect;
    // fall back to the bundled source if the file was removed.
    const oslPath = `/usr/share/apps/${app.id}/${app.id}.osl`;
    const omlPath = `/usr/share/apps/${app.id}/${app.id}.oml`;
    const oslSrc = this.vfs.exists(oslPath) ? this.vfs.read(oslPath) : app.osl;
    const omlSrc = this.vfs.exists(omlPath) ? this.vfs.read(omlPath) : app.oml;

    try {
      interp.run(oslSrc, interp.globals);
    } catch (e: any) {
      console.error(`[OSL:${app.id}]`, e);
      this.showAppError(win, e);
    }

    ui.onBeforeRefresh = () => {
      if (!interp.globals.has('onRefresh')) return;
      try {
        interp.callByName('onRefresh');
      } catch (e) {
        ui.reportError(e, 'onRefresh');
      }
    };

    try {
      ui.mount(omlSrc, interp.globals);
    } catch (e: any) {
      console.error(`[OML:${app.id}]`, e);
      this.showAppError(win, e);
    }

    this.shellUi?.scheduleRefresh();
  }

  private showAppError(win: ManagedWindow, err: any) {
    this.log('error', String(err?.message ?? err));
    const box = document.createElement('div');
    box.className = 'app-error';
    box.innerHTML = `<b>Script error</b><pre>${escapeHtml(String(err?.stack ?? err?.message ?? err))}</pre>`;
    win.body.prepend(box);
  }

  windows(): WindowInfo[] {
    return this.wm.list();
  }

  focusWindow(id: number) {
    this.wm.focus(id);
  }

  minimizeWindow(id: number) {
    const w = this.wm.get(id);
    if (w) this.wm.minimize(w);
  }

  closeWindow(id: number) {
    const w = this.wm.get(id);
    if (w) this.wm.close(w);
  }

  minimizeAll() {
    this.wm.minimizeAll();
  }

  apps(): AppInfo[] {
    return APPS.filter((a) => !this.metaFor(a).hidden).map((a) => {
      const meta = this.metaFor(a);
      return { id: a.id, name: tr(meta.name), icon: meta.icon };
    });
  }

  /** Merged static app definition + /etc/apps.json overrides. */
  private metaFor(app: AppDef) {
    const m = this.appMeta.get(app.id) ?? {};
    return {
      name: typeof m.name === 'string' && m.name ? m.name : app.name,
      icon: typeof m.icon === 'string' && m.icon ? m.icon : app.icon,
      width: Number(m.width) > 0 ? Number(m.width) : app.width,
      height: Number(m.height) > 0 ? Number(m.height) : app.height,
      hidden: m.hidden === undefined ? !!app.hidden : !!m.hidden,
    };
  }

  /** Reads /etc/apps.json, the editable application registry. */
  private loadAppRegistry() {
    this.appMeta.clear();
    const p = '/etc/apps.json';
    if (!this.vfs.exists(p)) return;
    try {
      const data = JSON.parse(this.vfs.read(p));
      const list = Array.isArray(data) ? data : data?.apps;
      if (Array.isArray(list)) {
        for (const entry of list) {
          if (entry && typeof entry.id === 'string') this.appMeta.set(entry.id, entry);
        }
      }
    } catch (e: any) {
      this.log('error', `apps.json: ${e?.message ?? e}`);
    }
  }

  /** OSL `sys.reloadApps()`: re-reads the registry and repaints the shell. */
  reloadApps() {
    this.loadAppRegistry();
    for (const inst of this.instances.values()) inst.ui.scheduleRefresh();
    this.shellUi?.scheduleRefresh();
    return true;
  }

  /* --------------------------------------------------------------- script */

  /**
   * Runs OSL source in a throw-away interpreter and captures its output.
   * Used by the IDE's Run button and by tooling that needs a sandboxed run.
   */
  runScript(source: string, path = '/home/user/unnamed.osl') {
    const lines: string[] = [];
    const interp = new Interpreter();
    const base = this.makeSystemHost();
    const host: Host = { ...base, print: (s: string) => lines.push(String(s)) };
    const builtins = createBuiltins(interp, host);
    for (const [k, v] of Object.entries(builtins)) interp.globals.define(k, v);
    interp.print = (s: string) => lines.push(String(s));
    // Scripts may import modules from the virtual file system.
    interp.loader = (p: string) => (this.vfs.exists(p) && !this.vfs.isDir(p) ? this.vfs.read(p) : null);
    try {
      interp.run(source, interp.globals, path);
      return { ok: true, output: lines.join('\n'), error: '' };
    } catch (e: any) {
      const error = String(e?.message ?? e);
      this.log('error', error.split('\n')[0]);
      return { ok: false, output: lines.join('\n'), error };
    }
  }

  /* --------------------------------------------------------------- logging */

  log(level: string, message: string) {
    this.logEntries.push({ id: ++this.logSeq, time: Date.now(), level, message: String(message) });
    if (this.logEntries.length > 400) this.logEntries.splice(0, this.logEntries.length - 400);
  }

  logs(limit = 200) {
    return this.logEntries.slice(-Math.max(1, limit));
  }

  clearLogs() {
    this.logEntries = [];
  }

  /* ------------------------------------------------------- notifications */

  notify(title: string, body: string, icon = 'info') {
    this.log('notice', `${title}: ${body}`);
    if (!this.settings.get('notifications')) return;
    const id = ++this.notifSeq;
    this.notifs.push({ id, title, body, icon });
    if (this.notifs.length > 4) this.notifs.shift();
    this.chime(icon === 'alert' || icon === 'error' ? 'error' : 'notice');
    this.shellUi?.scheduleRefresh();
    setTimeout(() => this.dismissNotification(id), 5600);
  }

  notifications() {
    return this.notifs.map((n) => ({ ...n }));
  }

  dismissNotification(id: number) {
    const before = this.notifs.length;
    this.notifs = this.notifs.filter((n) => n.id !== id);
    if (this.notifs.length !== before) this.shellUi?.scheduleRefresh();
  }

  /* -------------------------------------------------------------- recent */

  private loadRecent() {
    try {
      this.recentList = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    } catch {
      this.recentList = [];
    }
  }

  touchRecent(path: string) {
    this.recentList = this.recentList.filter((r) => r.path !== path);
    this.recentList.unshift({ name: basename(path), path });
    this.recentList = this.recentList.slice(0, 8);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recentList));
    } catch {
      /* ignore */
    }
    this.shellUi?.scheduleRefresh();
  }

  recent() {
    return [...this.recentList];
  }

  openPath(path: string) {
    if (!this.vfs.exists(path)) {
      this.notify('OS', `No such file: ${path}`, 'alert');
      return;
    }
    if (this.vfs.isDir(path)) {
      this.open('files', { path });
      return;
    }
    // A .desktop file is a shortcut: its content is an application id.
    if (/\.desktop$/i.test(path)) {
      const appId = this.vfs.read(path).trim();
      if (getApp(appId)) {
        this.open(appId);
        return;
      }
      this.notify('OS', `Broken shortcut: ${path}`, 'alert');
      return;
    }
    this.touchRecent(path);
    this.open('notes', { path });
  }

  /* --------------------------------------------------------------- system */

  uptime() {
    return Date.now() - this.bootTime;
  }

  version() {
    return '1.1 (Origin)';
  }

  lock() {
    if (this.lockEl) return;
    const el = document.createElement('div');
    el.className = 'lock-screen';
    // Reuse the desktop wallpaper behind a frosted veil, like Windows/macOS.
    const shell = document.querySelector('.shell') as HTMLElement | null;
    const bg = shell ? getComputedStyle(shell).backgroundImage : '';
    if (bg && bg !== 'none') {
      el.style.backgroundImage = bg;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
    }
    const veil = document.createElement('div');
    veil.className = 'lock-veil';
    const time = document.createElement('div');
    time.className = 'lock-time';
    const date = document.createElement('div');
    date.className = 'lock-date';
    const user = document.createElement('div');
    user.className = 'lock-user';
    const avatar = document.createElement('div');
    avatar.className = 'lock-avatar';
    avatar.textContent = String(this.settings.get('user') ?? 'origin').slice(0, 1).toUpperCase();
    const name = document.createElement('div');
    name.className = 'lock-name';
    name.textContent = this.settings.get('user') ?? 'origin';
    user.append(avatar, name);
    const hint = document.createElement('div');
    hint.className = 'lock-hint';
    hint.textContent = 'Click anywhere or press any key to unlock';
    el.append(veil, time, date, user, hint);
    document.body.appendChild(el);
    this.lockEl = el;

    const update = () => {
      time.textContent = formatTime(Date.now(), this.settings.get('clock24') ? 'HH:mm' : 'hh:mm');
      date.textContent = formatTime(Date.now(), 'dddd, MMMM d');
    };
    update();
    const timer = setInterval(update, 1000);

    const unlock = () => {
      clearInterval(timer);
      el.remove();
      this.lockEl = null;
      document.removeEventListener('keydown', unlock);
      el.removeEventListener('click', unlock);
    };
    setTimeout(() => {
      document.addEventListener('keydown', unlock);
      el.addEventListener('click', unlock);
    }, 250);
  }

  power(mode: string) {
    const el = document.createElement('div');
    el.className = 'lock-screen';
    el.innerHTML = `
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <circle cx="31" cy="33" r="16" stroke="#5aa9ff" stroke-width="6"/>
        <circle cx="46" cy="18" r="5" fill="#8b7cff"/>
      </svg>
      <div style="font-size:15px;letter-spacing:.1em;color:#8b98b8">${mode === 'off' ? 'SHUTTING DOWN' : 'RESTARTING'}</div>
      <div style="font-size:11px;color:#4d5a75">${mode === 'off' ? 'Click to power on again' : 'Back in a moment…'}</div>
    `;
    document.body.appendChild(el);
    if (mode === 'off') {
      setTimeout(() => {
        el.addEventListener('click', () => location.reload());
      }, 1400);
    } else {
      setTimeout(() => location.reload(), 1500);
    }
  }

  factoryReset() {
    void this.vfs.reset().then(() => {
      this.notify('OS', 'File system restored to factory defaults.', 'check');
      setTimeout(() => location.reload(), 900);
    });
  }

  /* ---------------------------------------------------------------- hosts */

  private uiBridge(): UiBridge {
    return {
      alert: (message, title) => this.overlays.alert(message, title),
      confirm: (message, onOk, title) => this.overlays.confirm(message, onOk, title),
      prompt: (title, value, onOk) => this.overlays.prompt(title, value, onOk),
      toast: (message, icon) => this.notify('OS', message, icon ?? 'check'),
      menu: (items, onPick, x, y, keep) => this.overlays.menu(items, onPick, x, y, keep),
      chooseImage: (onPick) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (!file) {
            input.remove();
            onPick('');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            input.remove();
            onPick(String(reader.result ?? ''));
          };
          reader.onerror = () => {
            input.remove();
            onPick('');
          };
          reader.readAsDataURL(file);
        });
        document.body.appendChild(input);
        input.click();
      },
    };
  }

  /**
   * Mirrors the system sources into the VFS so Files can browse them:
   * app sources, the shell itself, dialogs and the language catalogues.
   */
  private seedSystemFiles() {
    const marker = '/etc/apps-seed';
    const version = '7';
    if (this.vfs.exists(marker) && this.vfs.read(marker).trim() === version) return;
    for (const d of [
      '/usr',
      '/usr/share',
      '/usr/share/applications',
      '/usr/share/apps',
      '/usr/share/os',
      '/usr/share/i18n',
    ]) {
      this.vfs.mkdir(d, true, true);
    }
    for (const app of APPS) {
      const dir = `/usr/share/apps/${app.id}`;
      this.vfs.mkdir(dir, true, true);
      this.vfs.write(`${dir}/${app.id}.osl`, app.osl);
      this.vfs.write(`${dir}/${app.id}.oml`, app.oml);
      this.vfs.write(
        `${dir}/app.json`,
        JSON.stringify(
          { id: app.id, name: app.name, icon: app.icon, width: app.width, height: app.height, hidden: !!app.hidden },
          null,
          2,
        ),
      );
      this.vfs.write(`/usr/share/applications/${app.id}.desktop`, `${app.id}\n`);
    }
    // The editable app registry. Kept if it already exists so user edits survive.
    if (!this.vfs.exists('/etc/apps.json')) {
      this.vfs.write(
        '/etc/apps.json',
        JSON.stringify(
          {
            version: 1,
            note: 'Application registry. name/icon/width/height/hidden can be overridden; call sys.reloadApps() after editing.',
            apps: APPS.map((a) => ({
              id: a.id,
              name: a.name,
              icon: a.icon,
              width: a.width,
              height: a.height,
              hidden: !!a.hidden,
            })),
          },
          null,
          2,
        ),
      );
    }
    this.vfs.write(
      '/usr/share/apps/README.md',
      `# System applications\n\nEvery built-in app lives here as a pair of files://n//n- \`<app>.oml\` — the interface, described in OML\n- \`<app>.osl\` — the behaviour, written in OSL\n\nLaunch entries live in \`/usr/share/applications/*.desktop\`.\nEditing these copies does not change the running apps; copy them into\n\`~/Projects\` to experiment.\n`,
    );
    // The shell is just another pair of OSL/OML files.
    this.vfs.write('/usr/share/os/shell.osl', shellOsl);
    this.vfs.write('/usr/share/os/shell.oml', shellOml);
    this.vfs.write('/usr/share/os/dialog.oml', dialogOml);
    this.vfs.write('/usr/share/os/menu.oml', menuOml);
    this.vfs.write(
      '/usr/share/os/README.md',
      `# System sources\n\n- \`shell.osl\` / \`shell.oml\` — the desktop, taskbar and dock\n- \`dialog.oml\` / \`menu.oml\` — dialogs and context menus\n- \`/usr/share/apps/<id>/\` — one folder per application\n- \`/usr/share/i18n/*.json\` — UI translations\n\nUse \`i18n.reload()\` in OSL to re-read the catalogues after editing them.\n`,
    );
    // Never clobber translations a user may have edited by hand.
    for (const lang of ['en', 'zh'] as Lang[]) {
      const p = `/usr/share/i18n/${lang}.json`;
      if (!this.vfs.exists(p)) this.vfs.write(p, catalogJson(lang));
    }
    this.vfs.write(marker, version);
  }

  /** Loads /usr/share/i18n/*.json over the bundled catalogues. */
  private loadCatalogs() {
    for (const lang of ['en', 'zh'] as Lang[]) {
      const p = `/usr/share/i18n/${lang}.json`;
      if (!this.vfs.exists(p)) continue;
      try {
        const data = JSON.parse(this.vfs.read(p));
        // Merge over the bundled catalogue: installs created before a new key
        // was added still get the new translation instead of the raw English id.
        if (data && typeof data === 'object' && !Array.isArray(data)) setCatalog(lang, { ...catalogFor(lang), ...data });
      } catch (e: any) {
        this.log('error', `i18n ${lang}: ${e?.message ?? e}`);
      }
    }
  }

  /** OSL `i18n.reload()`: re-reads the VFS catalogues and repaints the UI. */
  reloadI18n() {
    this.loadCatalogs();
    for (const inst of this.instances.values()) inst.ui.scheduleRefresh();
    this.shellUi?.scheduleRefresh();
    return true;
  }

  private makeWindowHandle(win: ManagedWindow): WindowHandle {
    return {
      id: win.id,
      setTitle: (t) => this.wm.setTitle(win, t),
      close: () => this.wm.close(win),
      minimize: () => this.wm.minimize(win),
      maximize: () => this.wm.maximize(win),
      restore: () => this.wm.restore(win),
      toggleMax: () => this.wm.toggleMax(win),
      setSize: (w, h) => this.wm.setSize(win, w, h),
      move: (x, y) => this.wm.move(win, x, y),
      center: () => this.wm.center(win),
      toggleFullscreen: () => this.wm.toggleFullscreen(win),
      isFullscreen: () => win.fullscreen,
      isMaximized: () => win.maximized,
    };
  }

  private makeSystemHost(): Host {
    const dummy: WindowHandle = {
      id: 0,
      setTitle: () => {},
      close: () => {},
      minimize: () => {},
      maximize: () => {},
      restore: () => {},
      toggleMax: () => {},
      setSize: () => {},
      move: () => {},
      center: () => {},
      toggleFullscreen: () => {},
      isFullscreen: () => false,
      isMaximized: () => false,
    };
    const host: Host = {
      vfs: this.vfs,
      settings: this.settings,
      kernel: this,
      window: dummy,
      appId: 'system',
      args: new Map(),
      ui: {
        alert: (m, t) => this.overlays.alert(m, t),
        confirm: (m, cb, t) => this.overlays.confirm(m, cb, t),
        prompt: (t, v, cb) => this.overlays.prompt(t, v, cb),
        toast: (m, i) => this.notify('OS', m, i),
        menu: (items, cb, x, y, keep) => this.overlays.menu(items, cb, x, y, keep),
        chooseImage: (onPick) => this.uiBridge().chooseImage(onPick),
      },
      refresh: () => {},
      every: () => {},
      print: (s) => console.log('[OSL:system]', s),
      cwd: () => '/home/user',
    };
    this.sysHost = host;
    return host;
  }

  /* ------------------------------------------------------------ shortcuts */

  private installShortcuts() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;

      if (e.altKey && e.key === 'Tab') {
        e.preventDefault();
        this.cycleWithSwitcher(e.shiftKey);
        return;
      }
      if (e.altKey && e.key === 'F4') {
        e.preventDefault();
        if (this.wm.activeId) this.closeWindow(this.wm.activeId);
        return;
      }
      if (mod && e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        this.open('terminal');
        return;
      }
      if (mod && e.altKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        this.open('ide');
        return;
      }
      if (e.altKey && e.key === 'F2') {
        e.preventDefault();
        this.open('run');
        return;
      }
      if (mod && e.code === 'Space' && !typing) {
        e.preventDefault();
        this.toggleStart();
        return;
      }
      if (mod && !e.shiftKey && (e.key === 'w' || e.key === 'W') && !typing) {
        e.preventDefault();
        if (this.wm.activeId) this.closeWindow(this.wm.activeId);
        return;
      }
      if (e.key === 'Escape') {
        try {
          this.shellInterp?.callByName('closeMenus');
        } catch {
          /* ignore */
        }
        this.wm.exitFullscreenActive();
      }
    });

    window.addEventListener('resize', () => this.shellUi?.scheduleRefresh());
  }

  /* -------------------------------------------------- alt-tab switcher */

  private switcherEl: HTMLElement | null = null;
  private switcherList: ManagedWindow[] = [];
  private switcherIndex = 0;

  /** Alt+Tab: hold Alt to browse, release to commit (Windows/macOS style). */
  private cycleWithSwitcher(back: boolean) {
    const visible = this.wm.windows.filter((w) => !w.minimized);
    if (visible.length < 2) {
      this.wm.cycle(back);
      return;
    }
    if (!this.switcherEl) {
      this.switcherList = visible;
      const idx = visible.findIndex((w) => w.id === this.wm.activeId);
      const step = back ? -1 : 1;
      this.switcherIndex = (idx + step + visible.length) % visible.length;
      this.mountSwitcher();
      window.addEventListener('keyup', this.onSwitcherKeyUp);
      return;
    }
    const step = (back ? -1 : 1) * 1;
    this.switcherIndex = (this.switcherIndex + step + this.switcherList.length) % this.switcherList.length;
    this.paintSwitcher();
  }

  private onSwitcherKeyUp = (e: KeyboardEvent) => {
    if (!this.switcherEl) return;
    if (e.key === 'Alt' || e.key === 'Meta') this.commitSwitcher();
  };

  private mountSwitcher() {
    const el = document.createElement('div');
    el.className = 'switcher';
    el.innerHTML = this.switcherList
      .map((w, i) => {
        const title = (w.title || 'Window').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return `<div class="sw-item${i === this.switcherIndex ? ' active' : ''}" data-i="${i}">
          ${iconSvg(w.icon || 'app-about')}<span>${title}</span></div>`;
      })
      .join('');
    el.addEventListener('mousedown', (ev) => {
      const item = (ev.target as HTMLElement).closest('.sw-item') as HTMLElement | null;
      if (item) this.switcherIndex = Number(item.dataset.i);
      this.commitSwitcher();
    });
    document.body.appendChild(el);
    this.switcherEl = el;
  }

  private paintSwitcher() {
    if (!this.switcherEl) return;
    const items = this.switcherEl.querySelectorAll('.sw-item');
    items.forEach((n, i) => n.classList.toggle('active', i === this.switcherIndex));
  }

  private commitSwitcher() {
    const target = this.switcherList[this.switcherIndex];
    window.removeEventListener('keyup', this.onSwitcherKeyUp);
    this.switcherEl?.remove();
    this.switcherEl = null;
    this.switcherList = [];
    if (target) this.wm.focus(target);
  }

  private toggleStart() {
    try {
      this.shellInterp?.callByName('toggleStart');
    } catch (e) {
      console.error(e);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function appIcon(name: string): string {
  return iconSvg(name);
}
