/**
 * OML — Origin Markup Language
 * A compact XML dialect used to describe every window in OS.
 */

export interface OElement {
  tag: string;
  attrs: Record<string, string>;
  children: ONode[];
  line: number;
}

export type ONode = OElement | OTextNode;

export interface OTextNode {
  text: string;
  line: number;
}

export class OmlError extends Error {
  line: number;
  constructor(msg: string, line: number) {
    super(`${msg} (line ${line})`);
    this.name = 'OmlError';
    this.line = line;
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? m;
  });
}

const NAME_RE = /[A-Za-z0-9_:.-]/;

export function parseOml(src: string): OElement {
  let i = 0;
  let line = 1;
  const n = src.length;

  const skipWs = () => {
    while (i < n) {
      if (src[i] === ' ' || src[i] === '\t' || src[i] === '\r') i++;
      else if (src[i] === '\n') {
        i++;
        line++;
      } else break;
    }
  };

  const readName = (): string => {
    let out = '';
    while (i < n && NAME_RE.test(src[i])) out += src[i++];
    if (!out) throw new OmlError('Expected a tag name', line);
    return out;
  };

  const skipComment = () => {
    const end = src.indexOf('-->', i);
    if (end < 0) throw new OmlError('Unterminated comment', line);
    for (let k = i; k < end; k++) if (src[k] === '\n') line++;
    i = end + 3;
  };

  const readAttrValue = (): string => {
    skipWs();
    const q = src[i];
    if (q === '"' || q === "'") {
      i++;
      let out = '';
      while (i < n && src[i] !== q) {
        if (src[i] === '\n') line++;
        out += src[i++];
      }
      if (i >= n) throw new OmlError('Unterminated attribute value', line);
      i++;
      return decodeEntities(out);
    }
    let out = '';
    while (i < n && !/[\s>\/]/.test(src[i])) out += src[i++];
    return decodeEntities(out);
  };

  // synthetic document root
  const root: OElement = { tag: '#document', attrs: {}, children: [], line: 1 };
  const stack: OElement[] = [root];
  let text = '';
  let textLine = line;

  const flushText = () => {
    if (!text) return;
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push({ text: decodeEntities(text), line: textLine });
    text = '';
  };

  while (i < n) {
    if (src[i] === '<') {
      if (src.startsWith('<!--', i)) {
        flushText();
        i += 4;
        skipComment();
        continue;
      }
      if (src.startsWith('</', i)) {
        flushText();
        const startLine = line;
        i += 2;
        const name = readName();
        skipWs();
        if (src[i] !== '>') throw new OmlError("Expected '>' in closing tag", line);
        i++;
        const top = stack[stack.length - 1];
        if (!top || top.tag !== name) throw new OmlError(`Unexpected closing tag </${name}> (open: ${top?.tag})`, startLine);
        stack.pop();
        continue;
      }
      flushText();
      const startLine = line;
      i++;
      const name = readName();
      const attrs: Record<string, string> = {};
      let selfClose = false;
      while (i < n) {
        skipWs();
        if (src[i] === '/' && src[i + 1] === '>') {
          selfClose = true;
          i += 2;
          break;
        }
        if (src[i] === '>') {
          i++;
          break;
        }
        if (src[i] === '/') {
          i++;
          continue;
        }
        const attrName = readName();
        skipWs();
        let value = 'true';
        if (src[i] === '=') {
          i++;
          value = readAttrValue();
        }
        attrs[attrName] = value;
      }
      const el: OElement = { tag: name, attrs, children: [], line: startLine };
      stack[stack.length - 1].children.push(el);
      if (!selfClose) stack.push(el);
      continue;
    }

    if (!text) textLine = line;
    if (src[i] === '\n') line++;
    text += src[i++];
  }
  flushText();

  if (stack.length !== 1) throw new OmlError(`Unclosed tag <${stack[stack.length - 1].tag}>`, stack[stack.length - 1].line);

  const elements = root.children.filter((c): c is OElement => 'tag' in c);
  const textNodes = root.children.filter((c): c is OTextNode => !('tag' in c) && c.text.trim() !== '');
  if (elements.length === 0) throw new OmlError('Document has no root element', 1);
  if (elements.length > 1) throw new OmlError('Document must have exactly one root element', elements[1].line);
  if (textNodes.length > 0) throw new OmlError('Unexpected text outside the root element', textNodes[0].line);
  return elements[0];
}
