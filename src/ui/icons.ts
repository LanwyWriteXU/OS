/**
 * SVG icon registry. All icons are hand-written vector files in
 * src/assets/icons/*.svg — no emoji, no icon fonts, no external requests.
 */
const modules = import.meta.glob('../assets/icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const ICONS: Record<string, string> = {};

/** Inline SVGs share one document, so gradient/filter ids must be unique. */
function namespaceIds(svg: string, key: string): string {
  const ids = Array.from(svg.matchAll(/id="([^"]+)"/g)).map((m) => m[1]);
  let out = svg;
  for (const id of ids) {
    out = out.split(`id="${id}"`).join(`id="${id}-${key}"`);
    out = out.split(`url(#${id})`).join(`url(#${id}-${key})`);
  }
  return out;
}

for (const [path, content] of Object.entries(modules)) {
  const name = path.split('/').pop()!.replace(/\.svg$/, '');
  ICONS[name] = content;
}

let iconUid = 0;

export function hasIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

export function iconSvg(name: string): string {
  const raw = ICONS[name] ?? ICONS['file'] ?? '';
  return namespaceIds(raw, `v${++iconUid}`);
}

/** Returns an inline <span> wrapper holding the SVG, sized in px. */
export function icon(name: string, size = 18, cls = ''): HTMLElement {
  const el = document.createElement('span');
  el.className = 'ui-icon ' + cls;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.display = 'inline-flex';
  el.style.flex = 'none';
  el.innerHTML = iconSvg(name);
  const svg = el.firstElementChild as SVGElement | null;
  if (svg) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.style.width = '100%';
    svg.style.height = '100%';
  }
  return el;
}

export function setIcon(host: HTMLElement, name: string, size?: number) {
  const fresh = icon(name, size ?? parseInt(host.style.width || '18', 10));
  host.innerHTML = fresh.innerHTML;
}

export function iconNames(): string[] {
  return Object.keys(ICONS).sort();
}

/** Maps a file name to a sensible icon name. */
export function fileIcon(name: string, isDir = false): string {
  if (isDir) return 'folder';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  switch (ext) {
    case 'osl':
    case 'py':
    case 'js':
    case 'ts':
    case 'json':
    case 'css':
    case 'html':
      return 'code';
    case 'oml':
    case 'xml':
      return 'layers';
    case 'md':
    case 'txt':
    case 'log':
      return 'file-text';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return 'image';
    case 'sh':
      return 'terminal';
    case 'desktop':
      return 'apps';
    default:
      return 'file';
  }
}
