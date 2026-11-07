/**
 * OSL — Origin Software Language
 * Lexer: indentation-aware tokenizer.
 */

export interface Token {
  t: 'NEWLINE' | 'INDENT' | 'DEDENT' | 'NAME' | 'NUMBER' | 'STRING' | 'OP' | 'EOF';
  v?: any;
  /** 1-based line of the token start. */
  line: number;
  /** 1-based column of the token start, counted in characters (tab = 1). */
  col: number;
}

export class OslSyntaxError extends Error {
  line: number;
  col: number;
  constructor(message: string, line: number, col = 0) {
    super(col ? `${message} (line ${line}, col ${col})` : `${message} (line ${line})`);
    this.name = 'OslSyntaxError';
    this.line = line;
    this.col = col;
  }
}

export const KEYWORDS = new Set([
  'let', 'var', 'const', 'fn', 'class', 'if', 'elif', 'else', 'while', 'for', 'in', 'return',
  'break', 'continue', 'pass', 'and', 'or', 'not', 'True', 'False', 'None', 'try', 'catch',
  'except', 'finally', 'raise', 'throw', 'import', 'from', 'as', 'self', 'do', 'is',
]);

const OPS3 = ['**='];
const OPS2 = ['==', '!=', '<=', '>=', '//', '**', '+=', '-=', '*=', '/=', '%=', '=>', '->', '&&', '||'];

export function lex(src: string): Token[] {
  const toks: Token[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let atLineStart = true;
  let depth = 0;
  const indents: number[] = [0];

  /** 1-based column for a source index — scanning back to the previous newline. */
  const colAt = (idx: number) => idx - src.lastIndexOf('\n', idx - 1);
  // A token without a value carries no `v` key at all — the bootstrap lexer
  // has to reproduce that shape exactly, so don't emit `v: undefined`.
  const push = (t: Token['t'], v?: any, at: number = i) => {
    const tok = { t } as Token;
    if (v !== undefined) tok.v = v;
    tok.line = line;
    tok.col = colAt(at);
    toks.push(tok);
  };

  const readString = (quote: string, f: boolean, triple: boolean): string => {
    let out = '';
    const startCol = colAt(i);
    i += triple ? 3 : 1;
    while (i < n) {
      if (triple) {
        if (src.startsWith(quote.repeat(3), i)) {
          i += 3;
          return out;
        }
      } else if (src[i] === quote) {
        i++;
        return out;
      }
      if (src[i] === '\\') {
        const c = src[i + 1];
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'", '`': '`' };
        if (c === 'u' && src[i + 2] === '{') {
          const close = src.indexOf('}', i + 3);
          if (close > 0) {
            out += String.fromCharCode(parseInt(src.slice(i + 3, close), 16));
            i = close + 1;
            continue;
          }
        }
        if (c === 'x') {
          out += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16));
          i += 4;
          continue;
        }
        if (c in map) {
          out += map[c];
          i += 2;
          continue;
        }
        out += c ?? '';
        i += 2;
        continue;
      }
      if (src[i] === '\n') {
        if (!triple) throw new OslSyntaxError('Unterminated string literal', line, startCol);
        line++;
        out += '\n';
        i++;
        continue;
      }
      out += src[i];
      i++;
    }
    throw new OslSyntaxError('Unterminated string literal', line, startCol);
  };

  while (i < n) {
    if (atLineStart && depth === 0) {
      let j = i;
      let ind = 0;
      while (j < n && (src[j] === ' ' || src[j] === '\t')) {
        ind += src[j] === '\t' ? 4 : 1;
        j++;
      }
      if (j >= n) {
        i = j;
        break;
      }
      if (src[j] === '\n' || src[j] === '\r') {
        // A blank line advances by one line, not one character: CRLF must not
        // be counted twice or every later line number drifts.
        i = j + 1;
        if (src[j] === '\r' && src[i] === '\n') i++;
        line++;
        continue;
      }
      if (src[j] === '#') {
        while (j < n && src[j] !== '\n') j++;
        if (j < n) {
          j++;
          line++;
        }
        i = j;
        continue;
      }
      const top = indents[indents.length - 1];
      if (ind > top) {
        indents.push(ind);
        push('INDENT', undefined, j);
      } else if (ind < top) {
        while (ind < indents[indents.length - 1]) {
          indents.pop();
          push('DEDENT', undefined, j);
        }
        if (ind !== indents[indents.length - 1]) throw new OslSyntaxError('Inconsistent indentation', line, colAt(j));
      }
      i = j;
      atLineStart = false;
      continue;
    }

    const ch = src[i];

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\\' && src[i + 1] === '\n') {
      i += 2;
      line++;
      continue;
    }
    if (ch === '\n') {
      if (depth === 0) {
        const last = toks[toks.length - 1];
        if (last && last.t !== 'NEWLINE' && last.t !== 'INDENT' && last.t !== 'DEDENT') push('NEWLINE');
        atLineStart = true;
      }
      i++;
      line++;
      continue;
    }
    if (ch === '#') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }

    // f-string
    if ((ch === 'f' || ch === 'F') && (src[i + 1] === '"' || src[i + 1] === "'")) {
      const quote = src[i + 1];
      const triple = src.slice(i + 1, i + 4) === quote.repeat(3);
      const start = i;
      i++;
      const s = readString(quote, true, triple);
      push('STRING', { s, f: true }, start);
      continue;
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      const triple = src.slice(i, i + 3) === ch.repeat(3);
      const s = readString(ch, false, triple);
      push('STRING', { s, f: false }, start);
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < n && /[0-9_]/.test(src[j])) j++;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')) {
        j++;
        while (j < n && /[0-9_]/.test(src[j])) j++;
      }
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (/[0-9]/.test(src[k] ?? '')) {
          j = k;
          while (j < n && /[0-9]/.test(src[j])) j++;
        }
      }
      push('NUMBER', parseFloat(src.slice(i, j).replace(/_/g, '')));
      i = j;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      push('NAME', src.slice(i, j));
      i = j;
      continue;
    }

    const three = src.slice(i, i + 3);
    if (OPS3.includes(three)) {
      push('OP', three);
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) {
      push('OP', two);
      i += 2;
      continue;
    }
    if ('+-*/%<>=()[]{},:.?!'.includes(ch)) {
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      push('OP', ch);
      i++;
      continue;
    }
    if (ch === ';') {
      // statement separator — treat as newline
      if (depth === 0) {
        const last = toks[toks.length - 1];
        if (last && last.t !== 'NEWLINE') push('NEWLINE');
      }
      i++;
      continue;
    }

    throw new OslSyntaxError(`Unexpected character '${ch}'`, line, colAt(i));
  }

  const last = toks[toks.length - 1];
  if (last && last.t !== 'NEWLINE' && last.t !== 'INDENT') push('NEWLINE');
  while (indents.length > 1) {
    indents.pop();
    push('DEDENT');
  }
  push('EOF');
  return toks;
}
