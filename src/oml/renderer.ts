/**
 * OML renderer — mounts markup into DOM with reactive bindings.
 *
 * Refresh model: every UI event runs its OSL handler and then schedules a
 * refresh. A refresh re-evaluates all `{...}` bindings and rebuilds <For>
 * lists whose source data changed. This keeps the programming model simple
 * (scripts just mutate variables) while staying fast enough for a toy OS.
 */
import { parseOml, OElement, ONode } from './parser';
import { Env, Interpreter, NativeObject } from '../osl/interp';
import { createWidget, applyLayout, LAYOUT_ATTRS, setIconSlot, type WidgetBuild } from './widgets';
import { iconSvg } from '../ui/icons';
import { autoT } from '../i18n';
import type { Host } from '../osl/host';

interface Mounted {
  update(): void;
  /** Releases nodes mounted lazily (conditionals, lists) and their subtrees. */
  dispose?(): void;
  /**
   * The nodes this mount currently owns, in document order.
   *
   * A list row has to reorder its children when the underlying data is
   * reshuffled, and an `if` branch replaces its subtree while the layout is
   * live. Reading the nodes lazily is what keeps those two in sync — a snapshot
   * taken at mount time would resurrect detached nodes on the next reorder.
   */
  nodes?(): ChildNode[];
}

const staticNoop: Mounted = { update() {}, dispose() {} };

function serialize(v: any, depth = 0): string {
  if (depth > 8) return '…';
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[' + v.map((x) => serialize(x, depth + 1)).join(',') + ']';
  if (v instanceof Map) {
    const parts: string[] = [];
    for (const [k, val] of v) parts.push(serialize(k, depth + 1) + ':' + serialize(val, depth + 1));
    return '{' + parts.join(',') + '}';
  }
  if (v instanceof NativeObject) return 'obj';
  return String(v);
}

export class UiInstance {
  rootEnv!: Env;
  private root: Mounted | null = null;
  private raf = 0;
  /** Payload of the element currently being dragged (see drag-data). */
  private dragPayload = '';
  private lastErrors = new Map<string, number>();
  onBeforeRefresh?: () => void;
  errors: string[] = [];

  constructor(public container: HTMLElement, public interp: Interpreter, public host: Host) {}

  mount(source: string, env: Env) {
    this.rootEnv = env;
    const ast = parseOml(source);
    this.container.innerHTML = '';
    this.root = this.mountNode(ast, this.container, env);
    this.refresh();
  }

  refresh() {
    if (this.onBeforeRefresh) {
      try {
        this.onBeforeRefresh();
      } catch (e) {
        this.reportError(e, 'onRefresh');
      }
    }
    this.interp.reset();
    try {
      this.root?.update();
    } catch (e) {
      this.reportError(e, 'refresh');
    }
  }

  scheduleRefresh() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.refresh();
    });
  }

  eval(src: string, env: Env): any {
    return this.interp.evalExpression(src, env);
  }

  /** Accepts both `{expr}` (attribute style) and bare `expr`. */
  evalBinding(raw: string, env: Env): any {
    const src = raw.trim();
    if (src.startsWith('{') && src.endsWith('}')) {
      const inner = src.slice(1, -1).trim();
      return inner ? this.interp.evalExpression(inner, env) : null;
    }
    return this.interp.evalExpression(src, env);
  }

  truthy(v: any): boolean {
    return this.interp.truthy(v);
  }

  interpolate(tpl: string, env: Env): string {
    let out = '';
    let i = 0;
    while (i < tpl.length) {
      const c = tpl[i];
      if (c === '{' && tpl[i + 1] === '{') {
        out += '{';
        i += 2;
        continue;
      }
      if (c === '}' && tpl[i + 1] === '}') {
        out += '}';
        i += 2;
        continue;
      }
      if (c === '{') {
        let depth = 0;
        let j = i;
        let quote = '';
        for (; j < tpl.length; j++) {
          const ch = tpl[j];
          if (quote) {
            if (ch === quote) quote = '';
            continue;
          }
          if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
          }
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) break;
          }
        }
        if (j >= tpl.length) {
          out += c;
          i++;
          continue;
        }
        const src = tpl.slice(i + 1, j).trim();
        if (src) {
          try {
            out += this.interp.toStr(this.interp.evalExpression(src, env));
          } catch (e) {
            this.reportError(e, src);
          }
        }
        i = j + 1;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  reportError(err: any, context = '') {
    const msg = `${err?.message ?? err}${context ? `  [${context}]` : ''}`;
    const now = Date.now();
    const last = this.lastErrors.get(msg) ?? 0;
    this.errors.push(msg);
    if (now - last > 1500) {
      console.error('[OSL]', msg);
      this.lastErrors.set(msg, now);
    }
  }

  /* --------------------------------------------------------------- mount */

  /** Literal markup text is treated as a message id and translated. */
  private renderText(tpl: string, env: Env): string {
    return tpl.includes('{') ? this.interpolate(tpl, env) : autoT(tpl);
  }

  private mountNode(node: ONode, parent: Node, env: Env): Mounted {
    if (!('tag' in node)) {
      const raw = node.text;
      const text = raw.includes('\n') ? raw.trim() : raw;
      if (!text) return staticNoop;
      const tn = document.createTextNode('');
      parent.appendChild(tn);
      return { update: () => (tn.nodeValue = this.renderText(text, env)) };
    }
    if (node.tag === 'For') return this.mountFor(node, parent, env);
    if (node.attrs.if !== undefined) return this.mountIf(node, parent, env);
    return this.mountElement(node, parent, env);
  }

  /**
   * `if` mounts and unmounts its subtree (state, listeners and cost go away),
   * while `visible` only toggles `hidden` and keeps the element alive.
   */
  private mountIf(node: OElement, parent: Node, env: Env): Mounted {
    const anchor = document.createComment('if');
    parent.appendChild(anchor);
    const attrs = { ...node.attrs };
    delete attrs.if;
    const bare: OElement = { tag: node.tag, attrs, children: node.children, line: node.line };
    let mounted: Mounted | null = null;
    let nodes: ChildNode[] = [];

    const unmount = () => {
      if (!mounted) return;
      mounted.dispose?.();
      for (const n of nodes) n.remove();
      nodes = [];
      mounted = null;
    };

    return {
      update: () => {
        let on = false;
        try {
          on = this.truthy(this.evalBinding(node.attrs.if!, env));
        } catch (e) {
          this.reportError(e, `if=${node.attrs.if}`);
        }
        if (on && !mounted) {
          const frag = document.createDocumentFragment();
          const m = this.mountElement(bare, frag, env);
          nodes = Array.from(frag.childNodes);
          // The anchor may live inside a fragment that has since been moved
          // into the document, so resolve the real parent at update time.
          const host = anchor.parentNode;
          if (host) host.insertBefore(frag, anchor);
          mounted = m;
        } else if (!on && mounted) {
          unmount();
        }
        if (mounted) mounted.update();
      },
      nodes: () => [...nodes, anchor],
      dispose: () => {
        unmount();
        anchor.remove();
      },
    };
  }

  private mountElement(node: OElement, parent: Node, env: Env): Mounted {
    const attrs = node.attrs;
    const build = createWidget(node.tag, attrs, this);
    if (!build) return staticNoop;
    const el = build.el;
    parent.appendChild(el);

    const updates: Array<() => void> = [];

    if (attrs.class) {
      if (attrs.class.includes('{')) {
        const base = el.className;
        updates.push(() => (el.className = `${base} ${this.interpolate(attrs.class, env)}`.trim()));
      } else {
        el.className = `${el.className} ${attrs.class}`.trim();
      }
    }
    if (attrs.variant) el.classList.add(attrs.variant);
    if (attrs.style) {
      if (attrs.style.includes('{')) {
        const base = el.getAttribute('style') ?? '';
        updates.push(() => el.setAttribute('style', `${base} ${this.interpolate(attrs.style, env)}`));
      } else {
        el.setAttribute('style', (el.getAttribute('style') ?? '') + attrs.style);
      }
    }

    for (const [name, raw] of Object.entries(attrs)) {
      if (name === 'class' || name === 'style' || name === 'variant') continue;

      if (name === 'visible') {
        updates.push(() => {
          el.hidden = !this.truthy(this.evalBinding(raw, env));
        });
        continue;
      }
      if (name === 'if') continue;

      if (name === 'focus') {
        // A focus binding moves the caret (and scrolls the element into view
        // inside its nearest scroll container) when it turns true. Tracking the
        // last value keeps a plain refresh from stealing focus again, which is
        // what makes "jump to section" work from OSL without touching the DOM.
        let wasOn = false;
        updates.push(() => {
          let on = true;
          try {
            on = raw.includes('{') ? this.truthy(this.evalBinding(raw, env)) : true;
          } catch (e) {
            this.reportError(e, `focus=${raw}`);
            return;
          }
          if (on === wasOn) return;
          wasOn = on;
          if (!on) return;
          requestAnimationFrame(() => {
            try {
              (el as HTMLElement).focus({ preventScroll: false });
            } catch {
              /* ignore */
            }
          });
        });
        continue;
      }

      if (name === 'draggable') {
        const on = raw.includes('{') ? this.truthy(this.evalBinding(raw, env)) : raw === 'true';
        el.draggable = on;
        continue;
      }

      if (name === 'drag-data') {
        el.addEventListener('dragstart', (ev) => {
          try {
            this.dragPayload = this.interp.toStr(this.evalBinding(raw, env));
          } catch (e) {
            this.reportError(e, `drag-data=${raw}`);
          }
          if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', this.dragPayload);
          }
          el.classList.add('dragging');
        });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));
        continue;
      }

      if (name.startsWith('on') && name.length > 2) {
        this.bindEvent(el, name.slice(2).toLowerCase(), raw, env);
        continue;
      }

      if (name === 'icon' || (name === 'name' && build.kind === 'icon')) {
        if (build.kind === 'window') continue;
        const sizeAttr = attrs.size;
        const sizeOf = (fallback: number) => {
          if (sizeAttr === undefined) return fallback;
          const n = Number(this.evalBinding(sizeAttr, env));
          return Number.isFinite(n) && n > 0 ? n : fallback;
        };
        updates.push(() => {
          const iconName = this.interpolate(raw, env);
          if (build.kind === 'icon') {
            const size = sizeOf(18);
            // Only touch the DOM when the glyph or size really changed:
            // recreating the <svg> on every refresh cancelled clicks and
            // double-clicks aimed at the icon inside a button.
            const key = `${iconName}@${size}`;
            if (el.dataset.iconKey === key) return;
            el.dataset.iconKey = key;
            el.style.width = size + 'px';
            el.style.height = size + 'px';
            el.innerHTML = iconSvg(iconName);
            const svg = el.firstElementChild as SVGElement | null;
            if (svg) {
              svg.setAttribute('width', String(size));
              svg.setAttribute('height', String(size));
            }
          } else {
            setIconSlot(el, iconName, sizeOf(build.kind === 'button' ? 15 : 17));
          }
        });
        continue;
      }

      if (name === 'src' && build.kind === 'image') {
        updates.push(() => {
          const v = this.interpolate(raw, env);
          // Only touch the attribute when it really changes: re-assigning an
          // identical src would refire `load` and re-decode the bitmap.
          if (el.getAttribute('src') !== v) {
            if (v) el.setAttribute('src', v);
            else el.removeAttribute('src');
          }
        });
        continue;
      }

      if (name === 'text') {
        const target = build.kind === 'button' ? (el.querySelector('.btn-text') as HTMLElement) : el;
        const apply = () => {
          const value = this.renderText(raw, env);
          if (target === el && build.kind === 'modal') return;
          if (target === el) el.textContent = value;
          else target.textContent = value;
        };
        updates.push(apply);
        continue;
      }

      if (name === 'bind') {
        this.bindTwoWay(el, build, raw, env, updates);
        continue;
      }

      if (build.kind === 'code' && name === 'value') {
        updates.push(() => build.api?.setValue(this.evalBinding(raw, env)));
        continue;
      }
      if (build.kind === 'code' && (name === 'lang' || name === 'language')) {
        updates.push(() => build.api?.setLang(this.interpolate(raw, env)));
        continue;
      }

      if (name === 'value' && (build.kind === 'progress')) {
        updates.push(() => {
          const n = Math.max(0, Math.min(100, Number(this.evalBinding(raw, env)) || 0));
          const bar = el.firstElementChild as HTMLElement | null;
          if (bar) bar.style.width = `${n}%`;
        });
        continue;
      }

      if (name === 'value' || name === 'checked' || name === 'selected') {
        updates.push(() => {
          const val = this.evalBinding(raw, env);
          if (name === 'checked') {
            const input = el instanceof HTMLInputElement ? el : (el.querySelector('input') as HTMLInputElement | null);
            if (input) input.checked = this.truthy(val);
          } else if (name === 'value') {
            if (build.kind === 'select') (el as HTMLSelectElement).value = this.interp.toStr(val);
            else {
              const input = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
                ? el
                : (el.querySelector('input,textarea') as HTMLInputElement | null)) as HTMLInputElement | HTMLTextAreaElement | null;
              if (input && input.value !== this.interp.toStr(val)) input.value = this.interp.toStr(val);
            }
          }
        });
        continue;
      }

      if (name === 'disabled') {
        updates.push(() => {
          const v = this.truthy(this.evalBinding(raw, env)) ? true : false;
          if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) el.disabled = v;
        });
        continue;
      }

      if (name === 'title' || name === 'placeholder') {
        // A <Window title> describes the OS window, not the DOM node. Writing
        // it to the element made every descendant inherit the shell's title
        // as a browser tooltip ("OS Shell" on every title bar).
        if (build.kind === 'window' && name === 'title') {
          const applyTitle = () =>
            this.host.window.setTitle(raw.includes('{') ? this.interpolate(raw, env) : autoT(raw));
          updates.push(applyTitle);
          continue;
        }
        if (raw.includes('{')) {
          updates.push(() => ((el as any)[name] = this.interpolate(raw, env)));
        } else {
          (el as any)[name] = autoT(raw);
        }
        continue;
      }

      if (LAYOUT_ATTRS.has(name)) {
        if (raw.includes('{')) updates.push(() => applyLayout(el, name, this.interpolate(raw, env)));
        else applyLayout(el, name, raw);
        continue;
      }

      if (name === 'options' || name === 'size' || name === 'name' || name === 'min' || name === 'max' || name === 'step') {
        continue;
      }

      // data-* / aria-* always land on the DOM, bindings included.
      if (name.startsWith('data-') || name.startsWith('aria-')) {
        if (raw.includes('{')) updates.push(() => el.setAttribute(name, this.interpolate(raw, env)));
        else el.setAttribute(name, raw);
        continue;
      }

      // pass-through HTML attributes (spellcheck, type, autocomplete…)
      if (!raw.includes('{')) el.setAttribute(name, raw);
    }

    // text content inside the element
    const childHost = build.childrenHost ?? el;
    const children: Mounted[] = [];
    if (!build.noChildren) {
      for (const child of node.children) children.push(this.mountNode(child, childHost, env));
    }

    if (build.kind === 'modal') {
      const titleEl = el.querySelector('.modal-title-text') as HTMLElement;
      const iconEl = el.querySelector('.modal-icon') as HTMLElement;
      if (attrs.title) {
        if (attrs.title.includes('{')) updates.push(() => (titleEl.textContent = this.interpolate(attrs.title!, env)));
        else titleEl.textContent = attrs.title;
      } else {
        (el.querySelector('.modal-title') as HTMLElement).style.display = 'none';
      }
      if (attrs.icon) {
        iconEl.innerHTML = iconSvg(attrs.icon);
        iconEl.style.display = 'inline-flex';
        iconEl.style.width = '18px';
        iconEl.style.height = '18px';
      }
    }

    for (const u of updates) {
      try {
        u();
      } catch (e) {
        this.reportError(e, `${node.tag} ${JSON.stringify(attrs)}`);
      }
    }

    return {
      update() {
        for (const u of updates) u();
        for (const c of children) c.update();
      },
      nodes: () => [el],
      dispose() {
        for (const c of children) c.dispose?.();
      },
    };
  }

  /**
   * `<For each="items" as="x" index="i" key="id">`
   *
   * With `key`, rows are reconciled by identity: existing DOM survives, only
   * new rows are built and vanished ones removed. That keeps focus, scroll and
   * input state inside list rows. Without `key` the list is rebuilt whenever
   * its serialized data changes (the original behaviour).
   */
  private mountFor(node: OElement, parent: Node, env: Env): Mounted {
    const each = node.attrs.each ?? '[]';
    const asName = node.attrs.as ?? 'item';
    const indexName = node.attrs.index ?? 'i';
    const keyExpr = node.attrs.key ?? null;
    const anchor = document.createComment('for');
    parent.appendChild(anchor);

    interface Row {
      env: Env;
      mounted: Mounted[];
    }
    /** Nodes a row owns *right now* — `if` branches may have swapped them. */
    const liveNodes = (row: Row): ChildNode[] =>
      row.mounted.flatMap((m) => (m.nodes ? m.nodes() : []));
    let rows = new Map<string, Row>();
    let signature: string | null = null;
    let order: string[] = [];

    const makeEnv = (item: any, idx: number) => {
      const childEnv = new Env(env);
      childEnv.define(asName, item);
      childEnv.define(indexName, idx);
      return childEnv;
    };

    const build = (item: any, idx: number): Row => {
      const childEnv = makeEnv(item, idx);
      const frag = document.createDocumentFragment();
      const mounted: Mounted[] = [];
      for (const childNode of node.children) mounted.push(this.mountNode(childNode, frag, childEnv));
      const host = anchor.parentNode;
      if (host) host.insertBefore(frag, anchor);
      return { env: childEnv, mounted };
    };

    const keyOf = (item: any, idx: number): string => {
      if (!keyExpr) return String(idx);
      try {
        return this.interp.toStr(this.evalBinding(keyExpr, makeEnv(item, idx)));
      } catch (e) {
        this.reportError(e, `key=${keyExpr}`);
        return String(idx);
      }
    };

    const updateAll = () => {
      for (const row of rows.values()) for (const m of row.mounted) m.update();
    };

    const dropRow = (row: Row) => {
      for (const n of liveNodes(row)) n.remove();
      for (const m of row.mounted) m.dispose?.();
    };

    return {
      update: () => {
        let value: any;
        try {
          value = this.evalBinding(each, env);
        } catch (e) {
          this.reportError(e, 'for/each');
          value = [];
        }
        const items = Array.isArray(value) ? value : value instanceof Map ? [...value.values()] : [];

        if (!keyExpr) {
          const sig = serialize(items);
          if (sig !== signature) {
            signature = sig;
            for (const row of rows.values()) dropRow(row);
            rows = new Map();
            items.forEach((item, idx) => rows.set(String(idx), build(item, idx)));
          }
          updateAll();
          return;
        }

        const keys = items.map((item, idx) => keyOf(item, idx));
        const sameOrder = keys.length === order.length && keys.every((k, i) => k === order[i]);
        const next = new Map<string, Row>();
        items.forEach((item, idx) => {
          const key = keys[idx];
          const existing = rows.get(key);
          if (existing) {
            // Same identity, possibly a fresh object: rebind and reuse the DOM.
            existing.env.define(asName, item);
            existing.env.define(indexName, idx);
            next.set(key, existing);
          } else {
            next.set(key, build(item, idx));
          }
        });
        if (!sameOrder) {
          const host = anchor.parentNode;
          if (host) {
            for (const key of keys) {
              const row = next.get(key);
              if (row) for (const n of liveNodes(row)) host.insertBefore(n, anchor);
            }
          }
          order = keys;
        }
        for (const [key, row] of rows) {
          if (!next.has(key)) dropRow(row);
        }
        rows = next;
        updateAll();
      },
      nodes: () => {
        const out: ChildNode[] = [];
        for (const row of rows.values()) out.push(...liveNodes(row));
        out.push(anchor);
        return out;
      },
      dispose: () => {
        for (const row of rows.values()) dropRow(row);
        rows = new Map();
        anchor.remove();
      },
    };
  }

  private bindEvent(el: HTMLElement, type: string, src: string, env: Env) {
    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      const event = {
        type: e.type,
        key: (e as KeyboardEvent).key ?? '',
        code: (e as KeyboardEvent).code ?? '',
        value: (target as HTMLInputElement)?.value ?? '',
        checked: !!(target as HTMLInputElement)?.checked,
        selStart: typeof (target as HTMLTextAreaElement)?.selectionStart === 'number' ? (target as HTMLTextAreaElement).selectionStart : 0,
        selEnd: typeof (target as HTMLTextAreaElement)?.selectionEnd === 'number' ? (target as HTMLTextAreaElement).selectionEnd : 0,
        x: (e as MouseEvent).clientX ?? 0,
        y: (e as MouseEvent).clientY ?? 0,
        button: (e as MouseEvent).button ?? 0,
        deltaY: (e as WheelEvent).deltaY ?? 0,
        deltaX: (e as WheelEvent).deltaX ?? 0,
        rect: (() => {
          // Use the element the handler is bound to, not the inner SVG/text
          // that happened to be under the pointer.
          const r = el.getBoundingClientRect();
          return r
            ? { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
            : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
        })(),
        shift: (e as MouseEvent).shiftKey ?? false,
        ctrl: (e as MouseEvent).ctrlKey ?? false,
        meta: (e as MouseEvent).metaKey ?? false,
        alt: (e as MouseEvent).altKey ?? false,
        target,
        dragSource: this.dragPayload,
        prevent: () => e.preventDefault(),
        stop: () => e.stopPropagation(),
      };
      const local = new Env(env);
      local.define('event', event);
      try {
        this.interp.runStatements(src, local);
      } catch (err) {
        this.reportError(err, src);
      }
      this.scheduleRefresh();
    };
    el.addEventListener(type, handler);
    if (type === 'contextmenu') el.addEventListener('contextmenu', (e) => e.preventDefault());
    // A drop handler implies this element accepts the drag: without a
    // dragover preventDefault the browser refuses to fire `drop`.
    if (type === 'drop') el.addEventListener('dragover', (e) => e.preventDefault());
  }

  private bindTwoWay(el: HTMLElement, build: WidgetBuild, varName: string, env: Env, updates: Array<() => void>) {
    if (build.kind === 'code') {
      const api = build.api;
      const input = api?.input as HTMLTextAreaElement | undefined;
      if (!input) return;
      input.addEventListener('input', () => {
        env.set(varName, input.value);
        this.scheduleRefresh();
      });
      updates.push(() => {
        let value: any;
        try {
          value = env.get(varName);
        } catch {
          return;
        }
        api?.setValue(value === null || value === undefined ? '' : this.interp.toStr(value));
      });
      return;
    }
    const kind = build.kind;
    const isCheck = kind === 'checkbox' || kind === 'switch';
    const isSlider = kind === 'slider';
    const input = isCheck ? (el.querySelector('input') as HTMLInputElement) : (el as HTMLInputElement);
    if (!input) return;
    const sync = () => {
      if (isCheck) env.set(varName, input.checked);
      else if (isSlider) env.set(varName, Number(input.value));
      else env.set(varName, input.value);
      this.scheduleRefresh();
    };
    input.addEventListener(isCheck ? 'change' : 'input', sync);
    updates.push(() => {
      let value: any;
      try {
        value = env.get(varName);
      } catch {
        return;
      }
      if (isCheck) {
        const b = this.truthy(value);
        if (input.checked !== b) input.checked = b;
      } else if (isSlider) {
        const n = String(Number(value));
        if (input.value !== n) input.value = n;
      } else {
        const s = value === null || value === undefined ? '' : this.interp.toStr(value);
        if (input.value !== s) input.value = s;
      }
    });
  }
}
