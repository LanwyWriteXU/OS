/**
 * OML widget library. Each tag maps to a DOM skeleton; the renderer binds
 * attributes, text and events on top of it.
 */
import { icon as makeIcon, iconSvg } from '../ui/icons';
import { highlightCode } from '../ui/highlight';
import type { UiInstance } from '../oml/renderer';
import { mountTerminal } from '../shell/terminal';

export interface WidgetBuild {
  el: HTMLElement;
  kind: string;
  noChildren?: boolean;
  childrenHost?: HTMLElement;
  /** Optional imperative surface for complex widgets (used by CodeEditor). */
  api?: Record<string, any>;
}

const norm = {
  start: 'flex-start',
  end: 'flex-end',
  center: 'center',
  stretch: 'stretch',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
  baseline: 'baseline',
};

export function createWidget(tag: string, attrs: Record<string, string>, ui: UiInstance): WidgetBuild | null {
  const div = (cls: string) => {
    const el = document.createElement('div');
    el.className = cls;
    return el;
  };

  switch (tag) {
    case 'Window':
      return { el: div('oml-window ui-vbox'), kind: 'window' };
    case 'VBox':
    case 'Column':
      return { el: div('ui-vbox'), kind: 'box' };
    case 'HBox':
    case 'Row':
      return { el: div('ui-hbox'), kind: 'box' };
    case 'Grid':
      return { el: div('ui-grid'), kind: 'box' };
    case 'Stack':
    case 'Panel':
      return { el: div('ui-stack'), kind: 'box' };
    case 'Center':
      return { el: div('ui-center'), kind: 'box' };
    case 'Scroll':
      return { el: div('ui-scroll'), kind: 'box' };
    case 'Spacer':
    case 'Spring':
      return { el: div('ui-spring'), kind: 'box', noChildren: true };
    case 'Div':
    case 'Box':
      return { el: div(''), kind: 'box' };
    case 'Card':
      return { el: div('ui-card'), kind: 'box' };
    case 'Label':
    case 'Text':
      return { el: div('ui-label'), kind: 'text' };
    case 'Title':
      return { el: div('ui-title'), kind: 'text' };
    case 'Subtitle':
      return { el: div('ui-subtitle'), kind: 'text' };
    case 'Muted':
      return { el: div('ui-label ui-muted'), kind: 'text' };
    case 'Divider': {
      const hr = document.createElement('hr');
      hr.className = 'ui-divider';
      return { el: hr, kind: 'divider', noChildren: true };
    }
    case 'Button': {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'ui-btn';
      const ic = document.createElement('span');
      ic.className = 'btn-icon';
      const tx = document.createElement('span');
      tx.className = 'btn-text';
      el.append(ic, tx);
      return { el, kind: 'button' };
    }
    case 'IconButton': {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'ui-iconbtn';
      return { el, kind: 'iconbutton' };
    }
    case 'Icon': {
      const el = document.createElement('span');
      el.className = 'ui-icon';
      el.style.display = 'inline-flex';
      el.style.flex = 'none';
      return { el, kind: 'icon', noChildren: true };
    }
    case 'Image': {
      const el = document.createElement('img');
      el.className = 'ui-image';
      el.draggable = false;
      el.alt = attrs.alt ?? '';
      el.decoding = 'async';
      return { el, kind: 'image', noChildren: true };
    }
    case 'Input': {
      const el = document.createElement('input');
      el.className = 'ui-input';
      el.type = attrs.type ?? 'text';
      return { el, kind: 'input', noChildren: true };
    }
    case 'TextArea': {
      const el = document.createElement('textarea');
      el.className = 'ui-textarea';
      el.spellcheck = false;
      return { el, kind: 'textarea', noChildren: true };
    }
    case 'Select': {
      const el = document.createElement('select');
      el.className = 'ui-select';
      const opts = (attrs.options ?? '').split('|').filter(Boolean);
      for (const o of opts) {
        const [value, label] = o.includes(':') ? o.split(':') : [o, o];
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        el.appendChild(option);
      }
      return { el, kind: 'select', noChildren: true };
    }
    case 'Checkbox': {
      const el = document.createElement('label');
      el.className = 'ui-check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      const span = document.createElement('span');
      el.append(input, span);
      return { el, kind: 'checkbox' };
    }
    case 'Switch': {
      const el = document.createElement('label');
      el.className = 'ui-switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      const span = document.createElement('span');
      el.append(input, span);
      return { el, kind: 'switch' };
    }
    case 'Slider': {
      const el = document.createElement('input');
      el.type = 'range';
      el.className = 'ui-slider';
      el.min = attrs.min ?? '0';
      el.max = attrs.max ?? '100';
      el.step = attrs.step ?? '1';
      return { el, kind: 'slider', noChildren: true };
    }
    case 'Progress': {
      const el = div('ui-progress');
      const bar = document.createElement('i');
      bar.style.width = '0%';
      el.appendChild(bar);
      return { el, kind: 'progress', noChildren: true };
    }
    case 'Badge': {
      const el = document.createElement('span');
      el.className = 'ui-badge';
      return { el, kind: 'text' };
    }
    case 'Kbd': {
      const el = document.createElement('span');
      el.className = 'ui-kbd';
      return { el, kind: 'text' };
    }
    case 'List': {
      const el = div('ui-list');
      return { el, kind: 'box' };
    }
    case 'Toolbar': {
      const el = div('ui-hbox ui-toolbar');
      return { el, kind: 'box' };
    }
    case 'StatusBar': {
      const el = div('ui-hbox ui-statusbar');
      return { el, kind: 'box' };
    }
    case 'Modal': {
      const overlay = div('modal-layer');
      const card = div('modal');
      const title = div('modal-title');
      const iconSlot = document.createElement('span');
      iconSlot.className = 'modal-icon';
      const titleText = document.createElement('span');
      titleText.className = 'modal-title-text';
      title.append(iconSlot, titleText);
      const body = div('modal-body');
      card.append(title, body);
      overlay.appendChild(card);
      if (attrs.dismiss !== 'false') {
        overlay.addEventListener('mousedown', (e) => {
          if (e.target === overlay) overlay.dispatchEvent(new CustomEvent('dismiss', { bubbles: true }));
        });
      }
      return { el: overlay, kind: 'modal', childrenHost: body };
    }
    case 'TerminalView': {
      const el = div('term-wrap');
      el.style.flex = '1 1 auto';
      el.style.minHeight = '0';
      mountTerminal(el, ui.host);
      return { el, kind: 'terminal', noChildren: true };
    }
    case 'CodeEditor':
      return buildCodeEditor(attrs);
    default:
      console.warn(`[OML] unknown element <${tag}>`);
      return { el: div(`oml-${tag}`), kind: 'box' };
  }
}

export function applyLayout(el: HTMLElement, name: string, raw: string) {
  const v = raw.trim();
  const px = (s: string) => (/^-?\d+(\.\d+)?$/.test(s) ? `${s}px` : s);
  const s = el.style;
  switch (name) {
    case 'gap':
      s.gap = px(v);
      break;
    case 'pad':
    case 'padding':
      s.padding = v
        .split(/\s+/)
        .map(px)
        .join(' ');
      break;
    case 'px':
      s.paddingLeft = px(v);
      s.paddingRight = px(v);
      break;
    case 'py':
      s.paddingTop = px(v);
      s.paddingBottom = px(v);
      break;
    case 'flex':
      s.flex = v === '1' ? '1 1 0%' : v;
      break;
    case 'align':
      s.alignItems = norm[v as keyof typeof norm] ?? v;
      break;
    case 'justify':
      s.justifyContent = norm[v as keyof typeof norm] ?? v;
      break;
    case 'wrap':
      s.flexWrap = v === 'true' ? 'wrap' : v;
      break;
    case 'cols':
      s.gridTemplateColumns = /^\d+$/.test(v) ? `repeat(${v}, minmax(0, 1fr))` : v;
      break;
    case 'rows':
      s.gridTemplateRows = /^\d+$/.test(v) ? `repeat(${v}, minmax(0, 1fr))` : v;
      break;
    case 'width':
      s.width = px(v);
      break;
    case 'height':
      s.height = px(v);
      break;
    case 'minw':
      s.minWidth = px(v);
      break;
    case 'maxw':
      s.maxWidth = px(v);
      break;
    case 'minh':
      s.minHeight = px(v);
      break;
    case 'maxh':
      s.maxHeight = px(v);
      break;
    case 'radius':
      s.borderRadius = px(v);
      break;
    case 'bg':
      s.background = v;
      break;
    case 'overflow':
      s.overflow = v;
      break;
    case 'z':
      s.zIndex = v;
      break;
  }
}

export const LAYOUT_ATTRS = new Set([
  'gap', 'pad', 'padding', 'px', 'py', 'flex', 'align', 'justify', 'wrap', 'cols', 'rows',
  'width', 'height', 'minw', 'maxw', 'minh', 'maxh', 'radius', 'bg', 'overflow', 'z',
]);

export function setIconSlot(el: HTMLElement, name: string, size = 16) {
  const slot = el.querySelector('.btn-icon') as HTMLElement | null;
  const host = slot ?? el;
  const key = `${name || ''}@${size}`;
  if (host.dataset.iconKey === key) return;
  host.dataset.iconKey = key;
  if (!slot) {
    if (!el.classList.contains('ui-iconbtn')) return;
    if (!name) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = iconSvg(name);
    const svg = el.firstElementChild as SVGElement | null;
    if (svg) {
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
      svg.style.width = `${size}px`;
      svg.style.height = `${size}px`;
    }
    return;
  }
  if (!name) {
    slot.innerHTML = '';
    slot.style.display = 'none';
    return;
  }
  slot.style.display = 'inline-flex';
  slot.style.width = `${size}px`;
  slot.style.height = `${size}px`;
  slot.innerHTML = iconSvg(name);
  const svg = slot.firstElementChild as SVGElement | null;
  if (svg) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  }
}

export { makeIcon };

/**
 * CodeEditor — a textarea layered over a highlighted <pre>.
 *
 * The textarea owns the caret, selection and scrolling; the <pre> underneath
 * paints the colours. Both use identical font metrics and padding, so the two
 * layers stay pixel-aligned. Line numbers live in a gutter that is translated
 * by the textarea's scrollTop.
 */
function buildCodeEditor(attrs: Record<string, string>): WidgetBuild {
  const wrap = document.createElement('div');
  wrap.className = 'code-editor';

  const gutter = document.createElement('div');
  gutter.className = 'code-gutter';
  const gutterInner = document.createElement('div');
  gutterInner.className = 'code-gutter-inner';
  gutterInner.textContent = '1';
  gutter.appendChild(gutterInner);

  const area = document.createElement('div');
  area.className = 'code-area';

  const pre = document.createElement('pre');
  pre.className = 'code-highlight';
  pre.setAttribute('aria-hidden', 'true');
  const code = document.createElement('code');
  pre.appendChild(code);

  const input = document.createElement('textarea');
  input.className = 'code-input';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('wrap', 'off');
  input.setAttribute('aria-label', attrs.lang === 'oml' ? 'OML source' : 'OSL source');

  area.append(pre, input);
  wrap.append(gutter, area);

  let lang = attrs.lang ?? 'osl';

  const syncScroll = () => {
    pre.scrollTop = input.scrollTop;
    pre.scrollLeft = input.scrollLeft;
    gutterInner.style.transform = `translateY(${-input.scrollTop}px)`;
  };

  const render = () => {
    const src = input.value;
    code.innerHTML = highlightCode(src, lang) + '\n';
    const lines = src.split('\n').length;
    let numbers = '';
    for (let i = 1; i <= lines; i++) numbers += (i === 1 ? '' : '\n') + i;
    gutterInner.textContent = numbers;
    syncScroll();
  };

  const emit = () => input.dispatchEvent(new Event('input', { bubbles: true }));

  const insert = (text: string) => {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    const caret = start + text.length;
    input.selectionStart = caret;
    input.selectionEnd = caret;
    render();
    emit();
  };

  input.addEventListener('input', render);
  input.addEventListener('scroll', syncScroll);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      insert('    ');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      if (start !== end) return;
      const before = input.value.slice(0, start);
      const lineStart = before.lastIndexOf('\n') + 1;
      const line = before.slice(lineStart);
      const match = /^[ \t]*/.exec(line);
      let indent = match ? match[0] : '';
      if (/:\s*$/.test(line)) indent += '    ';
      e.preventDefault();
      insert('\n' + indent);
    }
  });

  render();

  return {
    el: wrap,
    kind: 'code',
    noChildren: true,
    api: {
      input,
      getValue: () => input.value,
      setValue(v: any) {
        const next = v === null || v === undefined ? '' : String(v);
        if (input.value === next) return;
        input.value = next;
        input.scrollTop = 0;
        input.scrollLeft = 0;
        render();
      },
      setLang(next: string) {
        lang = next === 'oml' ? 'oml' : 'osl';
        render();
      },
      focus: () => input.focus(),
    },
  };
}
