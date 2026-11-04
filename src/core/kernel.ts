/**
 * The kernel: boots the shell, hosts applications, owns notifications and
 * implements the syscall surface exposed to OSL.
 */
import shellOml from '../system/shell.oml?raw';
import shellOsl from '../system/shell.osl?raw';
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
import { t as tr } from '../i18n';

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
  private recentList: Array<{ name: string; path: string }> = [];
  private bootTime = Date.now();
  private root!: HTMLElement;
  private lockEl: HTMLElement | null = null;
  private sysHost!: Host;

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
  }

  /* --------------------------------------------------------------- boot */

  async boot(root: HTMLElement) {
    this.root = root;
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

    try {
      interp.run(shellOsl, interp.globals);
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
      this.shellUi.mount(shellOml, interp.globals);
    } catch (e: any) {
      console.error('[OML:shell]', e);
      root.innerHTML = `<div class="fatal">Failed to mount the shell: ${escapeHtml(String(e?.message ?? e))}</div>`;
      return;
    }

    const layer = root.querySelector('#window-layer') as HTMLElement | null;
    if (layer) this.wm.attach(layer);
    this.installShortcuts();
  }

  /* ------------------------------------------------------------ windows */

  open(appId: string, rawArgs?: Record<string, any> | Map<string, any>) {
    const app = getApp(appId);
    if (!app) {
      this.notify('OS', `Unknown application: ${appId}`, 'alert');
      return;
    }
    const win = this.wm.open({
      appId: app.id,
      title: tr(app.name),
      icon: app.icon,
      width: app.width,
      height: app.height,
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
    };

    try {
      interp.run(app.osl, interp.globals);
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
      ui.mount(app.oml, interp.globals);
    } catch (e: any) {
      console.error(`[OML:${app.id}]`, e);
      this.showAppError(win, e);
    }

    this.shellUi?.scheduleRefresh();
  }

  private showAppError(win: ManagedWindow, err: any) {
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
    return APPS.map((a) => ({ id: a.id, name: tr(a.name), icon: a.icon }));
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
      return { ok: false, output: lines.join('\n'), error: String(e?.message ?? e) };
    }
  }

  /* ------------------------------------------------------- notifications */

  notify(title: string, body: string, icon = 'info') {
    const id = ++this.notifSeq;
    this.notifs.push({ id, title, body, icon });
    if (this.notifs.length > 4) this.notifs.shift();
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
    this.open('editor', { path });
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
      menu: (items, onPick, x, y) => this.overlays.menu(items, onPick, x, y),
    };
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
        menu: (items, cb, x, y) => this.overlays.menu(items, cb, x, y),
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
