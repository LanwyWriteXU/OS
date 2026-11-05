/**
 * Interfaces shared between the language runtime and the kernel, so that
 * builtins never need to import the kernel implementation directly.
 */
import type { Vfs } from '../core/fs';
import type { SettingsStore } from '../core/settings';

export interface WindowInfo {
  id: number;
  appId: string;
  title: string;
  icon: string;
  minimized: boolean;
  active: boolean;
  maximized: boolean;
}

export interface AppInfo {
  id: string;
  name: string;
  icon: string;
}

export interface MenuItem {
  label?: string;
  icon?: string;
  danger?: boolean;
  sep?: boolean;
  kbd?: string;
}

export interface WindowHandle {
  id: number;
  setTitle(title: string): void;
  close(): void;
  minimize(): void;
  maximize(): void;
  restore(): void;
  toggleMax(): void;
  setSize(w: number, h: number): void;
  move(x: number, y: number): void;
  center(): void;
  toggleFullscreen(): void;
  isFullscreen(): boolean;
  isMaximized(): boolean;
}

export interface UiBridge {
  alert(message: string, title?: string): void;
  confirm(message: string, onOk: any, title?: string): void;
  prompt(title: string, value: string, onOk: any): void;
  toast(message: string, icon?: string): void;
  menu(items: any[], onPick: any, x?: number, y?: number, keep?: boolean): void;
  /** Opens a native image picker; `onPick` receives a data URL or ''. */
  chooseImage(onPick: (dataUrl: string) => void): void;
}

export interface ScriptResult {
  ok: boolean;
  output: string;
  error: string;
}

export interface KernelApi {
  open(appId: string, args?: Record<string, any> | Map<string, any>): void;
  windows(): WindowInfo[];
  focusWindow(id: number): void;
  minimizeWindow(id: number): void;
  closeWindow(id: number): void;
  apps(): AppInfo[];
  notify(title: string, body: string, icon?: string): void;
  recent(): Array<{ name: string; path: string }>;
  touchRecent(path: string): void;
  openPath(path: string): void;
  uptime(): number;
  version(): string;
  notifications(): Array<{ id: number; title: string; body: string; icon: string }>;
  dismissNotification(id: number): void;
  minimizeAll(): void;
  lock(): void;
  power(mode: string): void;
  factoryReset(): void;
  /** Runs OSL source in an isolated interpreter and captures its output. */
  runScript(source: string, path?: string): ScriptResult;
  /** System log ring buffer. */
  log(level: string, message: string): void;
  logs(limit?: number): LogEntry[];
  clearLogs(): void;
  /** Re-reads the VFS language catalogues. */
  reloadI18n(): boolean;
  /** Re-reads /etc/apps.json. */
  reloadApps(): boolean;
  /** Real battery state from the Battery Status API (percent 0–100). */
  battery(): { supported: boolean; level: number; charging: boolean; chargingTime: number; dischargingTime: number };
  storage(): { supported: boolean; usage: number; quota: number };
  network(): boolean;
  volume(): number;
  setVolume(level: number): void;
  toggleMute(): boolean;
}

export interface LogEntry {
  id: number;
  time: number;
  level: string;
  message: string;
}

export interface Host {
  vfs: Vfs;
  settings: SettingsStore;
  kernel: KernelApi;
  window: WindowHandle;
  appId: string;
  args: Map<string, any>;
  ui: UiBridge;
  refresh(): void;
  every(ms: number, fn: any): void;
  print(text: string): void;
  cwd(): string;
}
