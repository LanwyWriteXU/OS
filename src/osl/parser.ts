/**
 * OSL — recursive-descent parser producing a plain-object AST.
 */
import { lex, Token, OslSyntaxError } from './lexer';

export interface Node {
  type: string;
  line?: number;
  [key: string]: any;
}

export class Parser {
  toks: Token[];
  pos = 0;

  constructor(src: string) {
    this.toks = lex(src);
  }

  /* ------------------------------------------------------------- utils */

  peek(off = 0): Token {
    return this.toks[Math.min(this.pos + off, this.toks.length - 1)];
  }
  at(t: Token['t']): boolean {
    return this.peek().t === t;
  }
  atOp(v: string): boolean {
    const t = this.peek();
    return t.t === 'OP' && t.v === v;
  }
  atKw(v: string): boolean {
    const t = this.peek();
    return t.t === 'NAME' && t.v === v;
  }
  next(): Token {
    return this.toks[this.pos++];
  }
  expect(t: Token['t'], msg = ''): Token {
    if (!this.at(t)) {
      const tok = this.peek();
      throw new OslSyntaxError(msg || `Expected ${t} but found ${tok.t}${tok.v ? ` '${tok.v}'` : ''}`, tok.line);
    }
    return this.next();
  }
  expectOp(v: string): Token {
    if (!this.atOp(v)) throw new OslSyntaxError(`Expected '${v}'`, this.peek().line);
    return this.next();
  }
  expectKw(v: string): Token {
    if (!this.atKw(v)) throw new OslSyntaxError(`Expected '${v}'`, this.peek().line);
    return this.next();
  }
  expectName(): string {
    const t = this.expect('NAME', 'Expected a name');
    return t.v;
  }
  endStatement() {
    if (this.at('NEWLINE')) this.next();
    else if (this.at('DEDENT') || this.at('EOF')) {
      /* ok */
    } else if (this.at('OP') && this.peek().v === ';') this.next();
    else throw new OslSyntaxError(`Unexpected token '${this.peek().v ?? this.peek().t}'`, this.peek().line);
  }

  /* ---------------------------------------------------------- program */

  parseProgram(): Node {
    const body: Node[] = [];
    while (!this.at('EOF')) {
      if (this.at('NEWLINE') || this.at('INDENT') || this.at('DEDENT')) {
        this.next();
        continue;
      }
      body.push(this.parseStatement());
    }
    return { type: 'Program', body };
  }

  parseBlock(): Node[] {
    this.expect('NEWLINE', "Expected ':' followed by a new line");
    if (this.at('INDENT')) {
      this.next();
      const body: Node[] = [];
      while (!this.at('DEDENT') && !this.at('EOF')) {
        if (this.at('NEWLINE')) {
          this.next();
          continue;
        }
        body.push(this.parseStatement());
      }
      if (this.at('DEDENT')) this.next();
      return body;
    }
    // inline body:  if x: return 1
    return [this.parseStatement()];
  }

  parseStatement(): Node {
    const tok = this.peek();
    const line = tok.line;
    if (tok.t === 'NAME') {
      switch (tok.v) {
        case 'let':
        case 'var':
        case 'const':
          return this.parseVarDecl();
        case 'fn':
          return this.parseFnDecl();
        case 'class':
          return this.parseClassDecl();
        case 'if':
          return this.parseIf();
        case 'while':
          return this.parseWhile();
        case 'for':
          return this.parseFor();
        case 'return': {
          this.next();
          let value: Node | null = null;
          if (!this.at('NEWLINE') && !this.at('DEDENT') && !this.at('EOF')) value = this.parseExpression();
          this.endStatement();
          return { type: 'Return', value, line };
        }
        case 'break':
          this.next();
          this.endStatement();
          return { type: 'Break', line };
        case 'continue':
          this.next();
          this.endStatement();
          return { type: 'Continue', line };
        case 'pass':
          this.next();
          this.endStatement();
          return { type: 'Pass', line };
        case 'raise': {
          this.next();
          const value = this.parseExpression();
          this.endStatement();
          return { type: 'Raise', value, line };
        }
        case 'try':
          return this.parseTry();
        case 'export':
          // `export let x` / `export fn f()` — modules expose every top-level
          // binding, so `export` is an explicit, optional marker.
          this.next();
          return this.parseStatement();
        case 'import':
          return this.parseImport();
        case 'from':
          return this.parseFromImport();
      }
    }

    const expr = this.parseExpression();
    const op = this.peek();
    if (op.t === 'OP' && ['=', '+=', '-=', '*=', '/=', '%=', '**='].includes(op.v)) {
      this.next();
      const value = this.parseExpression();
      this.endStatement();
      return { type: 'Assign', target: expr, op: op.v, value, line };
    }
    this.endStatement();
    return { type: 'ExprStmt', expr, line };
  }

  parseVarDecl(): Node {
    const kw = this.next();
    const name = this.expectName();
    let value: Node = { type: 'None' };
    if (this.atOp('=')) {
      this.next();
      value = this.parseExpression();
    }
    this.endStatement();
    return { type: 'VarDecl', kind: kw.v, name, value, line: kw.line };
  }

  parseParams(): Array<{ name: string; def: Node | null }> {
    this.expectOp('(');
    const params: Array<{ name: string; def: Node | null }> = [];
    while (!this.atOp(')')) {
      const name = this.expectName();
      let def: Node | null = null;
      if (this.atOp('=')) {
        this.next();
        def = this.parseExpression();
      }
      params.push({ name, def });
      if (this.atOp(',')) this.next();
      else break;
    }
    this.expectOp(')');
    return params;
  }

  /* -------------------------------------------------------------- modules */

  parseImport(): Node {
    const kw = this.expectKw('import');
    const path = this.expect('STRING', 'Expected a module path string').v.s;
    let alias: string | null = null;
    if (this.atKw('as')) {
      this.next();
      alias = this.expectName();
    }
    this.endStatement();
    return { type: 'Import', path, alias, line: kw.line };
  }

  parseFromImport(): Node {
    const kw = this.expectKw('from');
    const path = this.expect('STRING', 'Expected a module path string').v.s;
    this.expectKw('import');
    const names: Array<{ name: string; alias: string | null }> = [];
    while (true) {
      const name = this.expectName();
      let alias: string | null = null;
      if (this.atKw('as')) {
        this.next();
        alias = this.expectName();
      }
      names.push({ name, alias });
      if (this.atOp(',')) {
        this.next();
        continue;
      }
      break;
    }
    this.endStatement();
    return { type: 'FromImport', path, names, line: kw.line };
  }

  parseFnDecl(): Node {
    const kw = this.next();
    const name = this.expectName();
    const params = this.parseParams();
    if (this.atOp('->')) {
      this.next();
      this.expectName();
    }
    this.expectOp(':');
    const body = this.parseBlock();
    return { type: 'FuncDecl', name, params, body, line: kw.line };
  }

  parseClassDecl(): Node {
    const kw = this.next();
    const name = this.expectName();
    let parent: string | null = null;
    if (this.atKw('extends')) {
      this.next();
      parent = this.expectName();
    }
    this.expectOp(':');
    this.expect('NEWLINE');
    this.expect('INDENT', 'Expected class body');
    const methods: Node[] = [];
    while (!this.at('DEDENT') && !this.at('EOF')) {
      if (this.at('NEWLINE')) {
        this.next();
        continue;
      }
      if (this.atKw('fn')) methods.push(this.parseFnDecl());
      else if (this.atKw('pass')) this.next();
      else throw new OslSyntaxError('Only methods are allowed in a class body', this.peek().line);
    }
    this.expect('DEDENT');
    return { type: 'ClassDecl', name, parent, methods, line: kw.line };
  }

  parseIf(): Node {
    const kw = this.next();
    const branches: Array<{ cond: Node; body: Node[] }> = [];
    const cond = this.parseExpression();
    this.expectOp(':');
    branches.push({ cond, body: this.parseBlock() });
    while (this.atKw('elif')) {
      this.next();
      const c = this.parseExpression();
      this.expectOp(':');
      branches.push({ cond: c, body: this.parseBlock() });
    }
    let orelse: Node[] | null = null;
    if (this.atKw('else')) {
      this.next();
      this.expectOp(':');
      orelse = this.parseBlock();
    }
    return { type: 'If', branches, orelse, line: kw.line };
  }

  parseWhile(): Node {
    const kw = this.next();
    const cond = this.parseExpression();
    this.expectOp(':');
    const body = this.parseBlock();
    return { type: 'While', cond, body, line: kw.line };
  }

  parseFor(): Node {
    const kw = this.next();
    const name = this.expectName();
    if (this.atOp(',')) {
      // for k, v in items:  →  unpack
      this.next();
      const second = this.expectName();
      this.expectKw('in');
      const iter = this.parseExpression();
      this.expectOp(':');
      const body = this.parseBlock();
      return { type: 'For', name, name2: second, iter, body, line: kw.line };
    }
    this.expectKw('in');
    const iter = this.parseExpression();
    this.expectOp(':');
    const body = this.parseBlock();
    return { type: 'For', name, iter, body, line: kw.line };
  }

  parseTry(): Node {
    const kw = this.next();
    this.expectOp(':');
    const body = this.parseBlock();
    let catchName = 'e';
    let catchBody: Node[] | null = null;
    if (this.atKw('catch') || this.atKw('except')) {
      this.next();
      if (this.at('NAME')) catchName = this.expectName();
      this.expectOp(':');
      catchBody = this.parseBlock();
    }
    let finallyBody: Node[] | null = null;
    if (this.atKw('finally')) {
      this.next();
      this.expectOp(':');
      finallyBody = this.parseBlock();
    }
    return { type: 'Try', body, catchName, catchBody, finallyBody, line: kw.line };
  }

  /* ------------------------------------------------------- expressions */

  parseExpression(): Node {
    const expr = this.parseOr();
    if (this.atKw('if')) {
      this.next();
      const cond = this.parseOr();
      this.expectKw('else');
      const other = this.parseExpression();
      return { type: 'Ternary', cond, a: expr, b: other, line: expr.line };
    }
    if (this.atOp('?')) {
      this.next();
      const a = this.parseExpression();
      this.expectOp(':');
      const b = this.parseExpression();
      return { type: 'Ternary', cond: expr, a, b, line: expr.line };
    }
    return expr;
  }

  parseOr(): Node {
    let left = this.parseAnd();
    while (this.atKw('or') || this.atOp('||')) {
      this.next();
      const right = this.parseAnd();
      left = { type: 'Bin', op: 'or', l: left, r: right, line: left.line };
    }
    return left;
  }

  parseAnd(): Node {
    let left = this.parseNot();
    while (this.atKw('and') || this.atOp('&&')) {
      this.next();
      const right = this.parseNot();
      left = { type: 'Bin', op: 'and', l: left, r: right, line: left.line };
    }
    return left;
  }

  parseNot(): Node {
    if (this.atKw('not')) {
      const tok = this.next();
      return { type: 'Unary', op: 'not', arg: this.parseNot(), line: tok.line };
    }
    if (this.atOp('!')) {
      const tok = this.next();
      return { type: 'Unary', op: 'not', arg: this.parseNot(), line: tok.line };
    }
    return this.parseComparison();
  }

  parseComparison(): Node {
    let left = this.parseAdd();
    while (true) {
      const tok = this.peek();
      if (tok.t === 'OP' && ['==', '!=', '<', '<=', '>', '>='].includes(tok.v)) {
        this.next();
        const right = this.parseAdd();
        left = { type: 'Bin', op: tok.v, l: left, r: right, line: tok.line };
        continue;
      }
      if (tok.t === 'NAME' && tok.v === 'in') {
        this.next();
        const right = this.parseAdd();
        left = { type: 'Bin', op: 'in', l: left, r: right, line: tok.line };
        continue;
      }
      if (tok.t === 'NAME' && tok.v === 'not' && this.peek(1).t === 'NAME' && this.peek(1).v === 'in') {
        this.next();
        this.next();
        const right = this.parseAdd();
        left = { type: 'Bin', op: 'notin', l: left, r: right, line: tok.line };
        continue;
      }
      if (tok.t === 'NAME' && tok.v === 'is') {
        this.next();
        let negate = false;
        if (this.atKw('not')) {
          this.next();
          negate = true;
        }
        const right = this.parseAdd();
        left = { type: 'Bin', op: negate ? 'isnot' : 'is', l: left, r: right, line: tok.line };
        continue;
      }
      break;
    }
    return left;
  }

  parseAdd(): Node {
    let left = this.parseMul();
    while (this.atOp('+') || this.atOp('-')) {
      const tok = this.next();
      const right = this.parseMul();
      left = { type: 'Bin', op: tok.v, l: left, r: right, line: tok.line };
    }
    return left;
  }

  parseMul(): Node {
    let left = this.parseUnary();
    while (this.atOp('*') || this.atOp('/') || this.atOp('//') || this.atOp('%')) {
      const tok = this.next();
      const right = this.parseUnary();
      left = { type: 'Bin', op: tok.v, l: left, r: right, line: tok.line };
    }
    return left;
  }

  parseUnary(): Node {
    if (this.atOp('-') || this.atOp('+')) {
      const tok = this.next();
      return { type: 'Unary', op: tok.v, arg: this.parseUnary(), line: tok.line };
    }
    return this.parsePower();
  }

  parsePower(): Node {
    const base = this.parsePostfix();
    if (this.atOp('**')) {
      const tok = this.next();
      const exp = this.parseUnary();
      return { type: 'Bin', op: '**', l: base, r: exp, line: tok.line };
    }
    return base;
  }

  parsePostfix(): Node {
    let expr = this.parsePrimary();
    while (true) {
      if (this.atOp('(')) {
        const tok = this.next();
        const args: Node[] = [];
        while (!this.atOp(')')) {
          args.push(this.parseExpression());
          if (this.atOp(',')) this.next();
          else break;
        }
        this.expectOp(')');
        expr = { type: 'Call', callee: expr, args, line: tok.line };
        continue;
      }
      if (this.atOp('[')) {
        const tok = this.next();
        let start: Node | null = null;
        let end: Node | null = null;
        let isSlice = false;
        if (!this.atOp(':')) start = this.parseExpression();
        if (this.atOp(':')) {
          isSlice = true;
          this.next();
          if (!this.atOp(']')) end = this.parseExpression();
        }
        this.expectOp(']');
        expr = isSlice
          ? { type: 'Slice', obj: expr, start, end, line: tok.line }
          : { type: 'Index', obj: expr, index: start, line: tok.line };
        continue;
      }
      if (this.atOp('.')) {
        const tok = this.next();
        let name: string;
        if (this.at('NAME')) name = this.expectName();
        else if (this.at('NUMBER')) name = String(this.next().v);
        else throw new OslSyntaxError('Expected a property name', tok.line);
        expr = { type: 'Member', obj: expr, name, line: tok.line };
        continue;
      }
      break;
    }
    return expr;
  }

  parsePrimary(): Node {
    const tok = this.peek();

    if (tok.t === 'NUMBER') {
      this.next();
      return { type: 'Num', value: tok.v, line: tok.line };
    }
    if (tok.t === 'STRING') {
      this.next();
      return { type: 'Str', value: tok.v.s, f: tok.v.f, line: tok.line };
    }
    if (tok.t === 'NAME') {
      if (tok.v === 'True' || tok.v === 'true') {
        this.next();
        return { type: 'Bool', value: true, line: tok.line };
      }
      if (tok.v === 'False' || tok.v === 'false') {
        this.next();
        return { type: 'Bool', value: false, line: tok.line };
      }
      if (tok.v === 'None' || tok.v === 'nil' || tok.v === 'null') {
        this.next();
        return { type: 'None', line: tok.line };
      }
      if (tok.v === 'fn' || tok.v === 'lambda') {
        this.next();
        const params = this.parseParams();
        if (this.atOp('=>')) {
          this.next();
          const body = this.parseExpression();
          return { type: 'Lambda', params: params.map((p) => p.name), defaults: params.map((p) => p.def), body, line: tok.line };
        }
        // block-bodied anonymous function:  fn(x):  followed by an indented body
        this.expectOp(':');
        const body = this.parseBlock();
        return { type: 'LambdaBlock', params: params.map((p) => p.name), defaults: params.map((p) => p.def), body, line: tok.line };
      }
      // single-argument arrow lambda:  x => x * 2
      if (this.peek(1).t === 'OP' && this.peek(1).v === '=>') {
        this.next();
        this.next();
        const body = this.parseExpression();
        return { type: 'Lambda', params: [tok.v], body, line: tok.line };
      }
      this.next();
      return { type: 'Name', name: tok.v, line: tok.line };
    }
    if (tok.t === 'OP' && tok.v === '(') {
      // try lambda
      const save = this.pos;
      try {
        this.next();
        const params: string[] = [];
        if (!this.atOp(')')) {
          while (true) {
            params.push(this.expectName());
            if (this.atOp(',')) {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expectOp(')');
        if (this.atOp('=>')) {
          this.next();
          const body = this.parseExpression();
          return { type: 'Lambda', params, body, line: tok.line };
        }
      } catch {
        /* not a lambda */
      }
      this.pos = save;
      this.next();
      const expr = this.parseExpression();
      this.expectOp(')');
      return expr;
    }
    if (tok.t === 'OP' && tok.v === '[') {
      this.next();
      const items: Node[] = [];
      while (!this.atOp(']')) {
        items.push(this.parseExpression());
        if (this.atOp(',')) this.next();
        else break;
      }
      this.expectOp(']');
      return { type: 'List', items, line: tok.line };
    }
    if (tok.t === 'OP' && tok.v === '{') {
      this.next();
      const pairs: Array<{ k: Node; v: Node }> = [];
      while (!this.atOp('}')) {
        const k = this.parseExpression();
        this.expectOp(':');
        const v = this.parseExpression();
        pairs.push({ k, v });
        if (this.atOp(',')) this.next();
        else break;
      }
      this.expectOp('}');
      return { type: 'Dict', pairs, line: tok.line };
    }

    throw new OslSyntaxError(`Unexpected token '${tok.v ?? tok.t}'`, tok.line);
  }
}

export function parseProgram(src: string): Node {
  return new Parser(src).parseProgram();
}

export function parseExpressionSource(src: string): Node {
  const p = new Parser(src);
  const expr = p.parseExpression();
  return expr;
}

export function parseStatementsSource(src: string): Node {
  return new Parser(src).parseProgram();
}
