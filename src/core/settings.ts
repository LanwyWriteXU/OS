/**
 * System settings, persisted in localStorage.
 */
import { setLang } from '../i18n';

export type ThemeMode = 'dark' | 'light';
export type SystemStyle = 'win' | 'mac';
export type UiLang = 'en' | 'zh';
export type WeekStart = 'sun' | 'mon';

export interface Settings {
  theme: ThemeMode;
  style: SystemStyle;
  accent: string;
  wallpaper: string;
  animations: boolean;
  clock24: boolean;
  clockSeconds: boolean;
  user: string;
  lang: UiLang;
  /* desktop */
  deskIconSize: number;
  deskSnap: boolean;
  taskbarTop: boolean;
  transparency: boolean;
  /* files */
  showHidden: boolean;
  /* text */
  termFont: number;
  codeFont: number;
  /* calendar */
  weekStart: WeekStart;
  /* notifications */
  notifications: boolean;
  /* sound */
  volume: number;
  muted: boolean;
  /* shell */
  pinned: string[];
  dockPinned: string[];
  /* wallpaper upload (data URL kept in the VFS, path stored here) */
  wallpaperPath: string;
}

export const ACCENTS = ['#5aa9ff', '#8b7cff', '#34d399', '#fbbf24', '#fb7185', '#22d3ee', '#f472b6', '#a3e635'];

export const WALLPAPERS = ['aurora', 'void', 'dune', 'mint', 'sunset', 'graphite', 'nebula', 'forest'];

export const DESK_ICON_SIZES = [36, 44, 52];
export const TEXT_SIZES = [11.5, 12.5, 14];

const DEFAULTS: Settings = {
  theme: 'dark',
  style: 'win',
  accent: '#5aa9ff',
  wallpaper: 'aurora',
  animations: true,
  clock24: true,
  clockSeconds: false,
  user: 'Admin',
  lang: 'en',
  deskIconSize: 44,
  deskSnap: true,
  taskbarTop: false,
  transparency: true,
  showHidden: false,
  termFont: 12.5,
  codeFont: 12.5,
  weekStart: 'sun',
  notifications: true,
  volume: 62,
  muted: false,
  pinned: ['files', 'terminal', 'ide', 'notes', 'settings'],
  dockPinned: ['files', 'terminal', 'ide', 'notes', 'tasks', 'settings'],
  wallpaperPath: '',
};

const KEY = 'os.settings.v1';

export class SettingsStore {
  value: Settings = { ...DEFAULTS };
  private listeners = new Set<(s: Settings) => void>();

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.value = { ...DEFAULTS, ...JSON.parse(raw) };
      // 1.0 shipped with a lowercase default account name; rename only that
      // legacy value so a deliberately chosen name is never touched.
      if (this.value.user === 'origin') this.value.user = 'Admin';
      // Arrays can arrive as null from older builds.
      if (!Array.isArray(this.value.pinned)) this.value.pinned = [...DEFAULTS.pinned];
      if (!Array.isArray(this.value.dockPinned)) this.value.dockPinned = [...DEFAULTS.dockPinned];
      // Editor/Preview merged into Notes — drop them from any saved lists.
      this.value.pinned = this.value.pinned.filter((id) => id !== 'editor' && id !== 'preview');
      this.value.dockPinned = this.value.dockPinned.filter((id) => id !== 'editor' && id !== 'preview');
    } catch {
      this.value = { ...DEFAULTS };
    }
    this.apply();
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* storage may be unavailable */
    }
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.value[key];
  }

  set<K extends keyof Settings>(key: K, val: Settings[K]) {
    this.value[key] = val;
    this.save();
    this.apply();
    for (const fn of this.listeners) fn(this.value);
  }

  patch(patch: Partial<Settings>) {
    this.value = { ...this.value, ...patch };
    this.save();
    this.apply();
    for (const fn of this.listeners) fn(this.value);
  }

  onChange(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply() {
    const s = this.value;
    const body = document.body;
    const root = document.documentElement;
    body.dataset.theme = s.theme;
    body.dataset.style = s.style;
    body.dataset.taskbar = s.taskbarTop ? 'top' : 'bottom';
    setLang(s.lang);
    body.classList.toggle('no-anim', !s.animations);
    body.classList.toggle('no-blur', !s.transparency);
    root.style.setProperty('--accent', s.accent);
    root.style.setProperty('--accent-2', shade(s.accent, 26));
    root.style.setProperty('--desk-icon', `${s.deskIconSize}px`);
    root.style.setProperty('--term-font', `${s.termFont}px`);
    root.style.setProperty('--code-font', `${s.codeFont}px`);
  }
}

export function shade(hex: string, amount: number): string {
  const c = hex.replace('#', '');
  const num = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  let r = (num >> 16) + amount;
  let g = ((num >> 8) & 0xff) + amount;
  let b = (num & 0xff) + amount;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export const settings = new SettingsStore();
