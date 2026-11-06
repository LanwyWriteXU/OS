/**
 * System overlays: dialogs and context menus, themselves declared in OML.
 */
import dialogSrc from '../system/dialog.oml?raw';
import menuSrc from '../system/menu.oml?raw';
import { Env, Interpreter, native } from '../osl/interp';
import { UiInstance } from './renderer';
import { t as tr } from '../i18n';
import { iconSvg } from '../ui/icons';
import { basename, dirname, extname } from '../core/fs';
import type { Host, MenuItem } from '../osl/host';

let pointerX = 0;
let pointerY = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
  });
}

export class Overlays {
  constructor(private host: Host) {}

  private hostEl(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'overlay-host';
    document.body.appendChild(el);
    return el;
  }

  alert(message: string, title = 'OS') {
    this.dialog({
      title,
      message,
      icon: 'info',
      isPrompt: false,
      isConfirm: false,
      value: '',
      okText: tr('OK'),
      cancelText: tr('Cancel'),
      onOk: () => {},
    });
  }

  confirm(message: string, onOk: () => void, title = 'Are you sure?') {
    this.dialog({
      title,
      message,
      icon: 'alert',
      isPrompt: false,
      isConfirm: true,
      value: '',
      okText: tr('OK'),
      cancelText: tr('Cancel'),
      onOk,
    });
  }

  prompt(title: string, value: string, onOk: (value: string) => void, message = '') {
    this.dialog({
      title,
      message,
      icon: 'pen',
      isPrompt: true,
      isConfirm: true,
      value,
      placeholder: tr('Enter a value…'),
      okText: tr('OK'),
      cancelText: tr('Cancel'),
      onOk: (v: any) => onOk(String(v ?? '')),
    });
  }

  private dialog(opts: {
    title: string;
    message: string;
    icon: string;
    isPrompt: boolean;
    isConfirm: boolean;
    value: string;
    placeholder?: string;
    okText: string;
    cancelText: string;
    onOk: (v: any) => void;
  }) {
    const container = this.hostEl();
    const interp = new Interpreter();
    const env = new Env(interp.globals);
    const ui = new UiInstance(container, interp, this.host);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      container.remove();
      document.removeEventListener('keydown', onKey);
    };
    const ok = () => {
      const value = env.has('value') ? env.get('value') : '';
      close();
      opts.onOk(value);
    };
    const cancel = () => close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        ok();
      }
    };

    env.define('title', opts.title);
    env.define('message', opts.message);
    env.define('icon', opts.icon);
    env.define('isPrompt', opts.isPrompt);
    env.define('isConfirm', opts.isConfirm);
    env.define('value', opts.value);
    env.define('placeholder', opts.placeholder ?? '');
    env.define('okText', opts.okText);
    env.define('cancelText', opts.cancelText);
    env.define('ok', native('ok', ok));
    env.define('cancel', native('cancel', cancel));
    env.define('onKey', native('onKey', (evt: any) => {
      if (evt?.key === 'Enter') ok();
      if (evt?.key === 'Escape') cancel();
    }));

    ui.mount(dialogSrc, env);
    document.addEventListener('keydown', onKey);
    container.addEventListener('dismiss', cancel as any);
    requestAnimationFrame(() => {
      const input = container.querySelector('input') as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  menu(items: any[], onPick: (item: any) => void, x?: number, y?: number, keep = false) {
    // Only one context menu may be open at a time, unless a cascading
    // sub-menu opts to keep its parent (keep = true).
    if (!keep) {
      for (const old of Array.from(document.querySelectorAll('.overlay-host'))) {
        if (old.querySelector('.ctx-menu')) old.remove();
      }
    }
    const container = this.hostEl();
    const interp = new Interpreter();
    const env = new Env(interp.globals);
    const ui = new UiInstance(container, interp, this.host);
    // Menu payloads cross the OSL ↔ host boundary. Keep them as OSL-native
    // dicts (Maps) and preserve every field — dropping `id` here used to make
    // every context-menu entry a no-op.
    const list: any[] = items.map((it) => {
      const src: Record<string, any> = it instanceof Map ? Object.fromEntries(it) : (it ?? {});
      const entry = new Map<string, any>();
      entry.set('label', src.label ?? '');
      entry.set('icon', src.icon ?? null);
      entry.set('danger', !!src.danger);
      entry.set('sep', !!src.sep);
      entry.set('kbd', src.kbd ?? null);
      if (src.cascade) entry.set('cascade', true);
      if (src.id !== undefined) entry.set('id', src.id);
      if (src.action !== undefined) entry.set('action', src.action);
      if (src.disabled !== undefined) entry.set('disabled', !!src.disabled);
      return entry;
    });

    let px = x ?? pointerX;
    let py = y ?? pointerY;
    const estH = 12 + list.length * 32;
    px = Math.min(px, window.innerWidth - 230);
    py = Math.min(py, window.innerHeight - estH - 10);
    px = Math.max(8, px);
    py = Math.max(8, py);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      container.remove();
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', onKey);
    };
    const pick = (it: any) => {
      // A cascading item keeps its parent open so the sub-menu can nest.
      const cascade = it instanceof Map ? it.get('cascade') === true : false;
      if (!cascade) close();
      onPick(it);
    };
    const outside = (e: MouseEvent) => {
      if (!container.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    env.define('items', list);
    env.define('x', px);
    env.define('y', py);
    env.define('pick', native('pick', pick));
    ui.mount(menuSrc, env);

    setTimeout(() => {
      document.addEventListener('mousedown', outside, true);
      document.addEventListener('keydown', onKey);
    }, 0);
  }

  /* --------------------------------------------------------- image picker */

  private static IMAGE_RE = /\.(png|jpe?g|jfif|gif|webp|bmp|svg|avif|ico)$/i;

  /** Turns an image file in the VFS into something an <img> can render. */
  imageDataUrl(path: string): string {
    try {
      if (!this.host.vfs.exists(path) || this.host.vfs.isDir(path)) return '';
      const raw = this.host.vfs.read(path);
      if (/^data:image\//i.test(raw)) return raw;
      if (extname(path) === 'svg') return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(raw);
      return '';
    } catch {
      return '';
    }
  }

  /**
   * Image picker that browses the OS file system, not the browser's native
   * file dialog. Calls back with a data URL, or '' when the user cancels.
   */
  pickImage(onPick: (dataUrl: string) => void, start = '/home/user/Pictures') {
    const vfs = this.host.vfs;
    const IMAGE_RE = Overlays.IMAGE_RE;
    let cwd = vfs.exists(start) && vfs.isDir(start) ? start : '/home/user';
    let selected = '';

    const mask = document.createElement('div');
    mask.className = 'os-picker-mask';
    const card = document.createElement('div');
    card.className = 'os-picker';

    const head = document.createElement('div');
    head.className = 'os-picker-head';
    const headIcon = document.createElement('span');
    headIcon.className = 'os-picker-ico';
    headIcon.innerHTML = iconSvg('image');
    const crumb = document.createElement('div');
    crumb.className = 'os-picker-path';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'os-picker-x';
    closeBtn.title = tr('Cancel');
    closeBtn.innerHTML = iconSvg('x');
    head.append(headIcon, crumb, closeBtn);

    const body = document.createElement('div');
    body.className = 'os-picker-body';
    const side = document.createElement('div');
    side.className = 'os-picker-side';
    const list = document.createElement('div');
    list.className = 'os-picker-list';
    body.append(side, list);

    const foot = document.createElement('div');
    foot.className = 'os-picker-foot';
    const hint = document.createElement('span');
    hint.className = 'os-picker-hint';
    hint.textContent = tr('Choose an image');
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'ui-btn os-picker-import';
    importBtn.innerHTML = `<span class="btn-icon">${iconSvg('download')}</span><span class="btn-text">${tr('Import from computer…')}</span>`;
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ui-btn';
    cancelBtn.textContent = tr('Cancel');
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'ui-btn primary';
    okBtn.textContent = tr('Open');
    foot.append(hint, importBtn, cancelBtn, okBtn);

    card.append(head, body, foot);
    mask.append(card);

    const places: Array<[string, string, string]> = [
      ['home', tr('Home'), '/home/user'],
      ['monitor', tr('Desktop'), '/home/user/Desktop'],
      ['file-text', tr('Documents'), '/home/user/Documents'],
      ['download', tr('Downloads'), '/home/user/Downloads'],
      ['image', tr('Pictures'), '/home/user/Pictures'],
    ];
    for (const [icon, label, p] of places) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'os-picker-place';
      b.dataset.path = p;
      b.innerHTML = `<span class="os-picker-place-ico">${iconSvg(icon)}</span><span class="os-picker-place-name"></span>`;
      (b.lastElementChild as HTMLElement).textContent = label;
      b.addEventListener('click', () => {
        if (!vfs.exists(p)) return;
        cwd = p;
        selected = '';
        render();
      });
      side.append(b);
    }

    const render = () => {
      crumb.textContent = cwd;
      for (const b of Array.from(side.querySelectorAll<HTMLElement>('.os-picker-place'))) {
        b.classList.toggle('on', b.dataset.path === cwd);
      }
      okBtn.disabled = selected === '';
      list.innerHTML = '';

      let nodes: any[] = [];
      try {
        nodes = vfs.list(cwd);
      } catch {
        nodes = [];
      }
      const dirs = nodes.filter((n) => n.type === 'dir');
      const imgs = nodes.filter((n) => n.type === 'file' && IMAGE_RE.test(n.name));

      const row = (opts: { icon: string; name: string; sub?: string; path?: string; thumb?: string }) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'os-picker-row';
        if (opts.path) el.dataset.path = opts.path;
        const ico = document.createElement('span');
        ico.className = 'os-picker-row-ico';
        if (opts.thumb) ico.style.backgroundImage = `url("${opts.thumb}")`;
        else ico.innerHTML = iconSvg(opts.icon);
        const nm = document.createElement('span');
        nm.className = 'os-picker-row-name';
        nm.textContent = opts.name;
        el.append(ico, nm);
        if (opts.sub) {
          const sub = document.createElement('span');
          sub.className = 'os-picker-row-sub';
          sub.textContent = opts.sub;
          el.append(sub);
        }
        return el;
      };

      if (cwd !== '/') {
        const up = row({ icon: 'arrow-up', name: '..', path: dirname(cwd) });
        up.addEventListener('click', () => {
          cwd = dirname(cwd);
          selected = '';
          render();
        });
        list.append(up);
      }

      for (const d of dirs) {
        const el = row({ icon: 'folder', name: d.name, path: d.path });
        el.addEventListener('click', () => {
          cwd = d.path;
          selected = '';
          render();
        });
        list.append(el);
      }

      for (const f of imgs) {
        const el = row({ icon: 'image', name: f.name, path: f.path, thumb: this.imageDataUrl(f.path) });
        el.classList.toggle('sel', selected === f.path);
        el.addEventListener('click', () => {
          for (const n of Array.from(list.querySelectorAll('.os-picker-row'))) n.classList.remove('sel');
          el.classList.add('sel');
          selected = f.path;
          okBtn.disabled = false;
        });
        el.addEventListener('dblclick', () => finish(f.path));
        list.append(el);
      }

      if (dirs.length === 0 && imgs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'os-picker-empty';
        empty.textContent = tr('No images in this folder');
        list.append(empty);
      }
    };

    const close = () => {
      mask.remove();
      document.removeEventListener('keydown', onKey);
    };
    const finish = (p: string) => {
      close();
      onPick(p ? this.imageDataUrl(p) : '');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        onPick('');
      } else if (e.key === 'Enter' && selected) {
        e.preventDefault();
        finish(selected);
      }
    };

    closeBtn.addEventListener('click', () => {
      close();
      onPick('');
    });
    cancelBtn.addEventListener('click', () => {
      close();
      onPick('');
    });
    okBtn.addEventListener('click', () => {
      if (selected) finish(selected);
    });
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) {
        close();
        onPick('');
      }
    });

    // Explicit import path: a fresh file system has no pictures yet, so the
    // picker can pull one in from the host without becoming the host dialog.
    importBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      const done = () => input.remove();
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) {
          done();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const data = String(reader.result ?? '');
          if (!/^data:image\//i.test(data)) {
            done();
            return;
          }
          const ext = extname(file.name) || 'png';
          const stem = basename(file.name).replace(/\.[^.]+$/, '') || 'image';
          let target = `/home/user/Pictures/${stem}.${ext}`;
          let i = 2;
          while (vfs.exists(target)) target = `/home/user/Pictures/${stem} (${i++}).${ext}`;
          vfs.write(target, data);
          done();
          cwd = '/home/user/Pictures';
          selected = target;
          render();
        };
        reader.onerror = done;
        reader.readAsDataURL(file);
      });
      document.body.appendChild(input);
      input.click();
    });

    document.body.append(mask);
    document.addEventListener('keydown', onKey);
    render();
  }
}
