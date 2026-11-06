/**
 * System file manifest.
 *
 * The OS ships its own sources (shell, apps, docs, icons) inside the file
 * system so they can be read and edited from Files. That creates a staleness
 * trap: a copy written by an older bundle shadows the newer one baked into the
 * build, and the app keeps running yesterday's code.
 *
 * The manifest records a hash of everything the system installed. On boot:
 *
 * - file missing            → write it
 * - same content            → nothing to do
 * - hash still matches ours  → the user never touched it, so upgrade it
 * - hash differs from ours   → edited by hand, leave it alone
 */
import type { Vfs } from './fs';

/** FNV-1a over UTF-16 — cheap, stable, good enough to spot edits. */
export function contentHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const MANIFEST_PATH = '/etc/system-manifest.json';

export class SystemManifest {
  private hashes = new Map<string, number>();

  constructor(private vfs: Vfs) {}

  load() {
    this.hashes.clear();
    if (!this.vfs.exists(MANIFEST_PATH)) return;
    try {
      const data = JSON.parse(this.vfs.read(MANIFEST_PATH));
      for (const [k, v] of Object.entries(data?.files ?? {})) {
        const n = Number(v);
        if (Number.isFinite(n)) this.hashes.set(k, n);
      }
    } catch {
      /* a corrupt manifest only costs us one forced refresh */
    }
  }

  save() {
    if (this.hashes.size === 0) return;
    const files: Record<string, number> = {};
    for (const [k, v] of this.hashes) files[k] = v;
    this.vfs.write(MANIFEST_PATH, JSON.stringify({ version: 1, files }, null, 2));
  }

  /** True when the file on disk is exactly what the user was given. */
  isPristine(path: string): boolean {
    if (!this.vfs.exists(path)) return false;
    const known = this.hashes.get(path);
    if (known === undefined) return false;
    return known === contentHash(this.vfs.read(path));
  }

  /** Installs a system-owned file, never clobbering a local edit. */
  install(path: string, content: string, force = false): 'created' | 'updated' | 'kept' | 'same' {
    const exists = this.vfs.exists(path);
    if (exists) {
      const current = this.vfs.read(path);
      if (current === content) {
        this.hashes.set(path, contentHash(content));
        return 'same';
      }
      // `force` is the one-time pass after a seed-version bump.
      if (!force && !this.isPristine(path)) return 'kept';
      this.vfs.write(path, content);
      this.hashes.set(path, contentHash(content));
      return 'updated';
    }
    this.vfs.write(path, content);
    this.hashes.set(path, contentHash(content));
    return 'created';
  }

  forget(path: string) {
    this.hashes.delete(path);
  }
}
