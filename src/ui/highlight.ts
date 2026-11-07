/**
 * OSL syntax highlighter.
 *
 * A tiny hand-written scanner: it walks the source once and wraps tokens in
 * <span class="tok-*">. No parser dependency, no eval — the output only ever
 * contains escaped text.
 */

const KEYWORDS = new Set([
  'let', 'var', 'const', 'fn', 'class', 'if', 'elif', 'else', 'while', 'for', 'in',
  'return', 'break', 'continue', 'pass', 'and', 'or', 'not', 'True', 'False', 'None',
  'true', 'false', 'nil', 'null', 'try', 'except', 'finally', 'raise', 'throw', 'import', 'from',
  'as', 'extends', 'export', 'is',
]);

const BUILTINS = new Set([
  'print', 'len', 'range', 'str', 'int', 'float', 'bool', 'type', 'sum', 'min', 'max',
  'abs', 'round', 'sorted', 'reversed', 'enumerate', 'zip', 'map', 'filter', 'any', 'all',
  'chr', 'ord', 'eval', 'sleep', 'every', 'notify', 'open', 'uuid', 't', 'lang', 'refresh',
  'Error', 'TypeError', 'ValueError', 'RangeError',
]);

const NAMESPACES = new Set([
  'fs', 'paths', 'sys', 'ui', 'win', 'time', 'math', 'json', 'store', 'clip', 'console',
]);

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function span(cls: string, text: string): string {
  return `<span class="tok-${cls}">${esc(text)}</span>`;
}

export function highlightOsl(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  let prev = '';

  while (i < n) {
    const c = src[i];

    if (c === '#') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      out += span('com', src.slice(i, j));
      i = j;
      continue;
    }

    const isF = (c === 'f' || c === 'F') && (src[i + 1] === '"' || src[i + 1] === "'");
    if (isF || c === '"' || c === "'") {
      const start = i;
      let j = i;
      if (isF) j++;
      const quote = src[j];
      const triple = src.slice(j, j + 3) === quote.repeat(3);
      const width = triple ? 3 : 1;
      j += width;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (triple) {
          if (src.slice(j, j + 3) === quote.repeat(3)) {
            j += 3;
            break;
          }
        } else if (src[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      out += span(isF ? 'fstr' : 'str', src.slice(start, Math.min(j, n)));
      i = Math.min(j, n);
      prev = 'str';
      continue;
    }

    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < n && /[0-9_]/.test(src[j])) j++;
      if (src[j] === '.' && src[j + 1] >= '0' && src[j + 1] <= '9') {
        j++;
        while (j < n && /[0-9_]/.test(src[j])) j++;
      }
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (src[k] >= '0' && src[k] <= '9') {
          j = k;
          while (j < n && src[j] >= '0' && src[j] <= '9') j++;
        }
      }
      out += span('num', src.slice(i, j));
      i = j;
      prev = 'num';
      continue;
    }

    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      let cls = 'id';
      if (KEYWORDS.has(word)) cls = 'kw';
      else if (prev === 'fn') cls = 'fn';
      else if (prev === 'class') cls = 'cls';
      else if (NAMESPACES.has(word)) cls = 'ns';
      else if (BUILTINS.has(word)) cls = 'fn';
      out += span(cls, word);
      prev = word === 'fn' || word === 'class' ? word : 'id';
      i = j;
      continue;
    }

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      out += c;
      i++;
      continue;
    }

    if ('+-*/%<>=!&|?:'.includes(c)) {
      out += span('op', c);
      i++;
      prev = '';
      continue;
    }

    out += esc(c);
    i++;
    prev = '';
  }

  return out;
}

export function highlightCode(src: string, lang = 'osl'): string {
  if (lang === 'osl') return highlightOsl(src);
  return esc(src);
}
