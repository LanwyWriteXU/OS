/**
 * i18n — the desktop's message catalogue.
 *
 * English strings double as message ids, so markup can stay readable:
 *   <Label text="Files"/>  ->  lookup("Files")
 * Anything not present in the active catalogue is returned unchanged.
 *
 * Dynamic values never go through the catalogue implicitly: use `t()` from
 * OSL when a string is built at runtime.
 */

import zhData from './zh.json';

export type Lang = 'en' | 'zh';

export interface LangInfo {
  id: Lang;
  label: string;
  native: string;
}

export const LANGS: LangInfo[] = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'zh', label: 'Chinese', native: '简体中文' },
];

const zh: Record<string, string> = zhData as Record<string, string>;
const en: Record<string, string> = Object.fromEntries(Object.keys(zh).map((k) => [k, k]));

export const CATALOGUES: Record<Lang, Record<string, string>> = {
  en,
  zh,
};

/** Replaces a catalogue at runtime (used by the VFS-backed language files). */
export function setCatalog(lang: Lang, entries: Record<string, string>) {
  CATALOGUES[lang] = entries ?? {};
}

/** Live catalogue for a language (do not mutate directly). */
export function catalogFor(lang: Lang): Record<string, string> {
  return CATALOGUES[lang];
}

/** Current catalogue serialised as JSON, exactly as stored in /usr/share/i18n. */
export function catalogJson(lang: Lang): string {
  return JSON.stringify(CATALOGUES[lang], null, 2);
}

let current: Lang = 'en';

export function setLang(lang: string) {
  current = lang === 'zh' ? 'zh' : 'en';
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
    document.documentElement.dataset.lang = current;
  }
}

export function getLang(): Lang {
  return current;
}

/**
 * Translate a message id. Arguments fill `{0}`, `{1}`, … placeholders.
 */
export function t(key: string, ...args: any[]): string {
  if (key === null || key === undefined) return '';
  const raw = String(key);
  const table = CATALOGUES[current];
  let out = table[raw] ?? raw;
  if (args.length) {
    out = out.replace(/\{(\d+)\}/g, (m, i) => {
      const v = args[Number(i)];
      return v === undefined || v === null ? '' : String(v);
    });
  }
  return out;
}

/** Catalogue used by the renderer for literal markup text. */
export const autoT = t;

export function availableLangs(): LangInfo[] {
  return LANGS;
}
