/**
 * System overlays: dialogs and context menus, themselves declared in OML.
 */
import dialogSrc from '../system/dialog.oml?raw';
import menuSrc from '../system/menu.oml?raw';
import { Env, Interpreter, native } from '../osl/interp';
import { UiInstance } from './renderer';
import { t as tr } from '../i18n';
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
}
