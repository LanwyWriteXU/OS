/**
 * System settings, persisted in localStorage.
 */
import { setLang } from '../i18n';

export type ThemeMode = 'dark' | 'light';
export type SystemStyle = 'win' | 'mac';
export type UiLang = 'en' | 'zh';

export interface Settings {
  theme: ThemeMode;
  style: SystemStyle;
  accent: string;
  wallpaper: string;
  animations: boolean;
  clock24: boolean;
  user: string;
  lang: UiLang;
}

export const ACCENTS = ['#5aa9ff', '#8b7cff', '#34d399', '#fbbf24', '#fb7185', '#22d3ee'];

export const WALLPAPERS = ['aurora', 'void', 'dune', 'mint', 'sunset', 'graphite', 'nebula', 'forest'];

const DEFAULTS: Settings = {
  theme: 'dark',
  style: 'win',
  accent: '#5aa9ff',
  wallpaper: 'aurora',
  animations: true,
  clock24: true,
  user: 'origin',
  lang: 'en',
};

const KEY = 'os.settings.v1';

export class SettingsStore {
  value: Settings = { ...DEFAULTS };
  private listeners = new Set<(s: Settings) => void>();

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.value = { ...DEFAULTS, ...JSON.parse(raw) };
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
    body.dataset.theme = s.theme;
    body.dataset.style = s.style;
    setLang(s.lang);
    body.classList.toggle('no-anim', !s.animations);
    document.documentElement.style.setProperty('--accent', s.accent);
    document.documentElement.style.setProperty('--accent-2', shade(s.accent, 26));
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
