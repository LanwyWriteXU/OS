/**
 * OWM — the Origin Window Manager.
 * Drag, 8-way resize, edge snapping, maximize / restore, minimize, z-order.
 */
import type { WindowInfo } from '../osl/host';
import { iconSvg } from '../ui/icons';
import { t } from '../i18n';

export interface ManagedWindow extends WindowInfo {
  fullscreen: boolean;
  el: HTMLElement;
  bar: HTMLElement;
  body: HTMLElement;
  titleEl: HTMLElement;
  iconEl: HTMLElement;
  rect: { left: number; top: number; width: number; height: number };
  restoreRect: { left: number; top: number; width: number; height: number } | null;
  animTimer?: number;
  minimizing?: boolean;
  onClose?: () => void;
}

interface OpenOptions {
  appId: string;
  title: string;
  icon: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
}

const MIN_W = 380;
const MIN_H = 260;

export class WindowManager {
  layer!: HTMLElement;
  windows: ManagedWindow[] = [];
  activeId = 0;
  onChange: (() => void) | null = null;
  /**
   * Where a window should shrink to when minimised. The shell supplies this so
   * the animation can aim at the real taskbar button / dock icon.
   */
  minimizeResolver: ((w: ManagedWindow) => { x: number; y: number } | null) | null = null;
  private z = 100;
  private seq = 0;
  private snapEl: HTMLElement;
  private snapTarget: string | null = null;
  private cascade = 0;

  constructor() {
    this.snapEl = document.createElement('div');
    this.snapEl.className = 'snap-preview';
  }

  attach(layer: HTMLElement) {
    this.layer = layer;
    layer.appendChild(this.snapEl);
    new ResizeObserver(() => this.relayout()).observe(layer);
  }

  list(): WindowInfo[] {
    return this.windows.map((w) => ({
      id: w.id,
      appId: w.appId,
      title: w.title,
      icon: w.icon,
      minimized: w.minimized,
      active: w.id === this.activeId,
      maximized: w.maximized,
    }));
  }

  get(id: number): ManagedWindow | undefined {
    return this.windows.find((w) => w.id === id);
  }

  open(opts: OpenOptions): ManagedWindow {
    const rect = this.layer.getBoundingClientRect();
    const width = Math.min(opts.width, rect.width - 40);
    const height = Math.min(opts.height, rect.height - 40);
    const offset = (this.cascade++ % 7) * 26;
    const left = opts.x ?? Math.max(12, Math.round((rect.width - width) / 2) + offset - 60);
    const top = opts.y ?? Math.max(12, Math.round((rect.height - height) / 2) + offset - 50);

    const el = document.createElement('div');
    el.className = 'win opening';
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.setAttribute('role', 'dialog');
    el.innerHTML = `
      <div class="win-bar">
        <span class="win-icon"></span>
        <span class="win-title"></span>
        <div class="win-btns">
          <button class="win-btn min" title="${t('Minimize')}" aria-label="${t('Minimize')}">${iconSvg('minus')}</button>
          <button class="win-btn max" title="${t('Maximize')}" aria-label="${t('Maximize')}">${iconSvg('square')}</button>
          <button class="win-btn close" title="${t('Close')}" aria-label="${t('Close')}">${iconSvg('x')}</button>
        </div>
      </div>
      <div class="win-body"></div>
      <div class="rz rz-n"></div><div class="rz rz-s"></div><div class="rz rz-e"></div><div class="rz rz-w"></div>
      <div class="rz rz-ne"></div><div class="rz rz-nw"></div><div class="rz rz-se"></div><div class="rz rz-sw"></div>
    `;
    this.layer.appendChild(el);

    const w: ManagedWindow = {
      id: ++this.seq,
      appId: opts.appId,
      title: opts.title,
      icon: opts.icon,
      minimized: false,
      active: true,
      maximized: false,
      fullscreen: false,
      el,
      bar: el.querySelector('.win-bar') as HTMLElement,
      body: el.querySelector('.win-body') as HTMLElement,
      titleEl: el.querySelector('.win-title') as HTMLElement,
      iconEl: el.querySelector('.win-icon') as HTMLElement,
      rect: { left, top, width, height },
      restoreRect: null,
    };
    this.windows.push(w);
    this.setIcon(w, opts.icon);
    this.setTitle(w, opts.title);
    this.focus(w);

    el.addEventListener('animationend', () => el.classList.remove('opening'), { once: true });
    this.wire(w);
    this.onChange?.();
    return w;
  }

  setTitle(w: ManagedWindow, title: string) {
    w.title = title;
    w.titleEl.textContent = title;
  }

  setIcon(w: ManagedWindow, name: string) {
    w.icon = name;
    w.iconEl.innerHTML = iconSvg(name);
    const svg = w.iconEl.firstElementChild as SVGElement | null;
    if (svg) {
      svg.setAttribute('width', '17');
      svg.setAttribute('height', '17');
    }
  }

  /** Screen-space transform that shrinks the window onto `target`. */
  private ghostTransform(w: ManagedWindow, target: { x: number; y: number }) {
    const r = w.rect;
    const scale = Math.max(0.05, Math.min(0.22, 46 / Math.max(r.width, r.height)));
    const dx = target.x - (r.left + r.width / 2);
    const dy = target.y - (r.top + r.height / 2);
    return `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${scale})`;
  }

  focus(w: ManagedWindow | number) {
    const win = typeof w === 'number' ? this.get(w) : w;
    if (!win) return;
    if (win.minimized) {
      win.minimized = false;
      win.el.classList.remove('minimized');
      // Fly back out of the taskbar button / dock icon it shrank into.
      const target = this.minimizeResolver?.(win) ?? null;
      if (target && !win.fullscreen) {
        win.el.classList.add('restoring');
        win.el.style.transformOrigin = '50% 50%';
        win.el.style.transform = this.ghostTransform(win, target);
        win.el.style.opacity = '0';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            win.el.style.transform = '';
            win.el.style.opacity = '';
          });
        });
        window.setTimeout(() => {
          win.el.classList.remove('restoring');
          win.el.style.transform = '';
          win.el.style.opacity = '';
          win.el.style.transformOrigin = '';
        }, 280);
      }
    }
    this.activeId = win.id;
    win.el.style.zIndex = String(++this.z);
    for (const other of this.windows) other.el.classList.toggle('focused', other.id === win.id);
    this.onChange?.();
  }

  minimize(w: ManagedWindow) {
    if (w.minimized || w.minimizing) return;
    const target = w.fullscreen ? null : this.minimizeResolver?.(w) ?? null;
    if (target) {
      // Animate towards the target button, then hide once the ghost lands.
      w.minimizing = true;
      w.el.classList.add('minimizing');
      w.el.style.transformOrigin = '50% 50%';
      w.el.style.transform = this.ghostTransform(w, target);
      w.el.style.opacity = '0';
      w.el.style.pointerEvents = 'none';
      window.setTimeout(() => {
        w.minimizing = false;
        w.minimized = true;
        w.el.classList.remove('minimizing');
        w.el.classList.add('minimized');
        w.el.style.transform = '';
        w.el.style.opacity = '';
        w.el.style.pointerEvents = '';
        w.el.style.transformOrigin = '';
        this.onChange?.();
      }, 200);
    } else {
      w.minimized = true;
      w.el.classList.add('minimized');
    }
    if (this.activeId === w.id) {
      const next = this.windows.filter((x) => !x.minimized && !x.minimizing && x.id !== w.id).pop();
      this.activeId = next?.id ?? 0;
      if (next) this.focus(next);
    }
    this.onChange?.();
  }

  toggleMinimize(id: number) {
    const w = this.get(id);
    if (!w) return;
    if (w.minimized) this.focus(w);
    else if (this.activeId === w.id) this.minimize(w);
    else this.focus(w);
  }

  /** Runs a geometry change with a short transition instead of a jump. */
  private animate(w: ManagedWindow) {
    if (!w.el) return;
    w.el.classList.add('animating');
    void w.el.offsetWidth;
    if (w.animTimer) clearTimeout(w.animTimer);
    w.animTimer = window.setTimeout(() => w.el.classList.remove('animating'), 240);
  }

  maximize(w: ManagedWindow) {
    if (w.maximized) return;
    w.restoreRect = { ...w.rect };
    const r = this.layer.getBoundingClientRect();
    this.animate(w);
    w.rect = { left: 0, top: 0, width: r.width, height: r.height };
    w.maximized = true;
    w.el.classList.add('maximized');
    this.apply(w);
    this.onChange?.();
  }

  restore(w: ManagedWindow) {
    if (!w.maximized) return;
    this.animate(w);
    w.maximized = false;
    w.el.classList.remove('maximized');
    if (w.restoreRect) w.rect = { ...w.restoreRect };
    this.apply(w);
    this.onChange?.();
  }

  toggleMax(w: ManagedWindow) {
    if (w.maximized) this.restore(w);
    else this.maximize(w);
  }

  /** macOS-style full screen: covers the whole viewport, hides shell chrome. */
  enterFullscreen(w: ManagedWindow) {
    if (w.fullscreen) return;
    if (!w.maximized) w.restoreRect = { ...w.rect };
    w.fullscreen = true;
    w.el.classList.add('fullscreen');
    document.body.classList.add('in-fullscreen');
    this.focus(w);
    this.onChange?.();
  }

  exitFullscreen(w: ManagedWindow) {
    if (!w.fullscreen) return;
    this.animate(w);
    w.fullscreen = false;
    w.el.classList.remove('fullscreen');
    document.body.classList.remove('in-fullscreen');
    if (!w.maximized) {
      const r = this.layer.getBoundingClientRect();
      const width = Math.min(w.restoreRect?.width ?? w.rect.width, r.width);
      const height = Math.min(w.restoreRect?.height ?? w.rect.height, r.height);
      w.rect = {
        left: Math.round((r.width - width) / 2),
        top: Math.round((r.height - height) / 2),
        width,
        height,
      };
    }
    this.apply(w);
    this.onChange?.();
  }

  toggleFullscreen(w: ManagedWindow) {
    if (w.fullscreen) this.exitFullscreen(w);
    else this.enterFullscreen(w);
  }

  /** Esc handler: leaves full screen if any window is using it. */
  exitFullscreenActive(): boolean {
    const w = this.windows.find((x) => x.fullscreen);
    if (!w) return false;
    this.exitFullscreen(w);
    return true;
  }

  close(w: ManagedWindow) {
    w.el.classList.add('closing');
    w.onClose?.();
    setTimeout(() => {
      w.el.remove();
      this.windows = this.windows.filter((x) => x.id !== w.id);
      if (this.activeId === w.id) {
        const next = [...this.windows].filter((x) => !x.minimized).pop();
        this.activeId = 0;
        if (next) this.focus(next);
      }
      this.onChange?.();
    }, 130);
  }

  closeAll() {
    for (const w of [...this.windows]) this.close(w);
  }

  setSize(w: ManagedWindow, width: number, height: number) {
    this.animate(w);
    const r = this.layer.getBoundingClientRect();
    w.rect.width = Math.max(MIN_W, Math.min(width, r.width));
    w.rect.height = Math.max(MIN_H, Math.min(height, r.height));
    this.apply(w);
  }

  /** Moves a window, keeping at least a sliver on screen. */
  move(w: ManagedWindow, left: number, top: number) {
    if (w.maximized) return;
    const r = this.layer.getBoundingClientRect();
    w.rect.left = Math.max(-w.rect.width + 90, Math.min(left, r.width - 90));
    w.rect.top = Math.max(0, Math.min(top, r.height - 40));
    this.apply(w);
  }

  /** Centres a window inside the work area. */
  center(w: ManagedWindow) {
    if (w.maximized) return;
    const r = this.layer.getBoundingClientRect();
    this.move(w, Math.round((r.width - w.rect.width) / 2), Math.round((r.height - w.rect.height) / 2));
  }

  /* ------------------------------------------------------------- internals */

  private apply(w: ManagedWindow) {
    w.el.style.left = `${w.rect.left}px`;
    w.el.style.top = `${w.rect.top}px`;
    w.el.style.width = `${w.rect.width}px`;
    w.el.style.height = `${w.rect.height}px`;
  }

  private relayout() {
    if (!this.layer) return;
    const r = this.layer.getBoundingClientRect();
    for (const w of this.windows) {
      if (w.maximized) {
        w.rect = { left: 0, top: 0, width: r.width, height: r.height };
        this.apply(w);
      } else {
        w.rect.width = Math.min(w.rect.width, r.width - 8);
        w.rect.height = Math.min(w.rect.height, r.height - 8);
        w.rect.left = Math.max(0, Math.min(w.rect.left, r.width - 80));
        w.rect.top = Math.max(0, Math.min(w.rect.top, r.height - 60));
        this.apply(w);
      }
    }
  }

  private wire(w: ManagedWindow) {
    (w.el.querySelector('.win-btn.close') as HTMLElement).addEventListener('click', (e) => {
      e.stopPropagation();
      this.close(w);
    });
    (w.el.querySelector('.win-btn.min') as HTMLElement).addEventListener('click', (e) => {
      e.stopPropagation();
      this.minimize(w);
    });
    (w.el.querySelector('.win-btn.max') as HTMLElement).addEventListener('click', (e) => {
      e.stopPropagation();
      // macOS: the green light enters full screen; Windows: maximise.
      if (w.fullscreen || document.body.dataset.style === 'mac') this.toggleFullscreen(w);
      else this.toggleMax(w);
    });

    w.el.addEventListener('pointerdown', () => this.focus(w), true);

    w.bar.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.win-btn')) return;
      if (w.fullscreen) this.exitFullscreen(w);
      else this.toggleMax(w);
    });

    w.bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.win-btn')) return;
      this.focus(w);
      if (w.fullscreen) return;
      let startX = e.clientX;
      let startY = e.clientY;
      let baseLeft = w.rect.left;
      let baseTop = w.rect.top;
      let wasMax = w.maximized;
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        let dx = ev.clientX - startX;
        let dy = ev.clientY - startY;
        if (!moved) {
          if (Math.abs(dx) + Math.abs(dy) <= 3) return;
          moved = true;
          // Only un-maximise once the pointer really starts dragging: a plain
          // click on a maximised title bar must not shrink the window.
          if (wasMax) {
            const layerR = this.layer.getBoundingClientRect();
            const ratio = (ev.clientX - layerR.left) / Math.max(1, w.rect.width);
            this.restore(w);
            baseLeft = ev.clientX - layerR.left - w.rect.width * ratio;
            baseTop = Math.max(0, ev.clientY - layerR.top - 16);
            startX = ev.clientX;
            startY = ev.clientY;
            w.rect.left = baseLeft;
            w.rect.top = baseTop;
            this.apply(w);
            wasMax = false;
            dx = 0;
            dy = 0;
          }
        }
        const r = this.layer.getBoundingClientRect();
        w.rect.left = Math.max(-w.rect.width + 90, Math.min(baseLeft + dx, r.width - 90));
        // Keep the whole window inside the work area: dragging down to the
        // taskbar used to slide the window under the clipped layer where it
        // silently disappeared.
        const maxTop = Math.max(0, r.height - w.rect.height);
        w.rect.top = Math.max(0, Math.min(baseTop + dy, maxTop));
        this.apply(w);
        this.snapTarget = this.detectSnap(ev, r, w);
        this.renderSnap(r);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        this.snapEl.style.display = 'none';
        if (moved && this.snapTarget) this.applySnap(w, this.snapTarget);
        this.snapTarget = null;
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    for (const handle of Array.from(w.el.querySelectorAll('.rz'))) {
      const dir = (handle.className.split('rz-')[1] ?? '') as string;
      handle.addEventListener('pointerdown', (e) => {
        const ev = e as PointerEvent;
        if (ev.button !== 0) return;
        ev.preventDefault();
        this.focus(w);
        const startX = ev.clientX;
        const startY = ev.clientY;
        const start = { ...w.rect };
        const onMove = (me: PointerEvent) => {
          const dx = me.clientX - startX;
          const dy = me.clientY - startY;
          let { left, top, width, height } = start;
          if (dir.includes('e')) width = Math.max(MIN_W, start.width + dx);
          if (dir.includes('s')) height = Math.max(MIN_H, start.height + dy);
          if (dir.includes('w')) {
            width = Math.max(MIN_W, start.width - dx);
            left = start.left + (start.width - width);
          }
          if (dir.includes('n')) {
            height = Math.max(MIN_H, start.height - dy);
            top = start.top + (start.height - height);
          }
          w.rect = { left, top, width, height };
          this.apply(w);
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }
  }

  private detectSnap(e: PointerEvent, r: DOMRect, w: ManagedWindow): string | null {
    if (w.maximized) return null;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const hot = 10;
    if (y < hot) return 'top';
    if (x < hot) return 'left';
    if (x > r.width - hot) return 'right';
    if (y > r.height - hot) return 'bottom';
    return null;
  }

  private renderSnap(r: DOMRect) {
    if (!this.snapTarget) {
      this.snapEl.style.display = 'none';
      return;
    }
    const pad = 6;
    const half = { w: (r.width - pad * 3) / 2, h: r.height - pad * 2 };
    let box = { left: pad, top: pad, width: half.w, height: half.h };
    if (this.snapTarget === 'right') box = { left: pad * 2 + half.w, top: pad, width: half.w, height: half.h };
    if (this.snapTarget === 'top') box = { left: pad, top: pad, width: r.width - pad * 2, height: r.height - pad * 2 };
    if (this.snapTarget === 'bottom') box = { left: pad, top: r.height / 2, width: r.width - pad * 2, height: r.height / 2 - pad };
    this.snapEl.style.display = 'block';
    this.snapEl.style.left = `${box.left}px`;
    this.snapEl.style.top = `${box.top}px`;
    this.snapEl.style.width = `${box.width}px`;
    this.snapEl.style.height = `${box.height}px`;
  }

  private applySnap(w: ManagedWindow, target: string) {
    const r = this.layer.getBoundingClientRect();
    const pad = 6;
    if (target === 'top') {
      this.maximize(w);
      return;
    }
    w.maximized = false;
    w.el.classList.remove('maximized');
    if (target === 'left') w.rect = { left: pad, top: pad, width: (r.width - pad * 3) / 2, height: r.height - pad * 2 };
    if (target === 'right') w.rect = { left: (r.width - pad * 3) / 2 + pad * 2, top: pad, width: (r.width - pad * 3) / 2, height: r.height - pad * 2 };
    if (target === 'bottom') w.rect = { left: pad, top: r.height / 2, width: r.width - pad * 2, height: r.height / 2 - pad };
    w.el.classList.add('snapped');
    this.apply(w);
    this.onChange?.();
  }

  cycle(back = false) {
    const visible = this.windows.filter((w) => !w.minimized);
    if (visible.length < 2) return;
    const idx = visible.findIndex((w) => w.id === this.activeId);
    const next = visible[(idx + (back ? -1 : 1) + visible.length) % visible.length];
    this.focus(next);
  }

  minimizeAll() {
    for (const w of this.windows) if (!w.minimized) {
      w.minimized = true;
      w.el.classList.add('minimized');
    }
    this.activeId = 0;
    this.onChange?.();
  }
}
