/**
 * OSL — tree-walking interpreter.
 * Values: number | string | boolean | null | Array | Map | OslFunction | NativeFunction |
 *         OslClass | OslInstance
 */
import { parseProgram, parseExpressionSource, parseStatementsSource, Node } from './parser';
import { OslSyntaxError } from './lexer';

export class OslError extends Error {
  line?: number;
  frames: string[] = [];
  decorated = false;
  constructor(message: string, line?: number) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'OslError';
    this.line = line;
  }
}

/**
 * A first-class error value, bound by `except e:`. It stringifies to its
 * message so `print("caught: " + e)` keeps working, while `e.message`,
 * `e.type` and `e.line` stay available.
 */
export class OslErrorValue {
  __kind = 'error' as const;
  constructor(
    public type: string,
    public message: string,
    public line?: number,
    public frames: string[] = [],
  ) {}
  toString() {
    return this.message;
  }
}

export class Env {
  vars = new Map<string, any>();
  consts = new Set<string>();
  parent: Env | null;
  constructor(parent: Env | null = null) {
    this.parent = parent;
  }
  define(name: string, value: any) {
    this.vars.set(name, value);
    return value;
  }
  defineConst(name: string, value: any) {
    this.vars.set(name, value);
    this.consts.add(name);
    return value;
  }
  has(name: string): boolean {
    return this.vars.has(name) || (this.parent?.has(name) ?? false);
  }
  hasLocal(name: string): boolean {
    return this.vars.has(name);
  }
  get(name: string): any {
    if (this.vars.has(name)) return this.vars.get(name);
    if (this.parent) return this.parent.get(name);
    throw new OslError(`Name '${name}' is not defined`);
  }
  /**
   * Assignment. Only updates an existing binding and never declares a new
   * one — `let` is the only way to introduce a name. Constants are enforced.
   */
  assign(name: string, value: any): any {
    if (this.vars.has(name)) {
      if (this.consts.has(name)) throw new OslError(`Cannot assign to constant '${name}'`);
      this.vars.set(name, value);
      return value;
    }
    if (this.parent) return this.parent.assign(name, value);
    throw new OslError(`Name '${name}' is not defined — use 'let ${name} = …' first`);
  }
  /** Lenient write used by two-way bindings, which may introduce a variable. */
  set(name: string, value: any) {
    if (this.vars.has(name)) {
      if (this.consts.has(name)) throw new OslError(`Cannot assign to constant '${name}'`);
      this.vars.set(name, value);
      return value;
    }
    if (this.parent && this.parent.has(name)) return this.parent.assign(name, value);
    this.vars.set(name, value);
    return value;
  }
  snapshot(): Record<string, any> {
    return Object.fromEntries(this.vars);
  }
}

/* --------------------------------------------------------------- values */

export class OslFunction {
  __kind = 'fn' as const;
  constructor(
    public name: string,
    public params: string[],
    public defaults: Array<Node | null>,
    public body: Node[],
    public closure: Env,
  ) {}
}

export class NativeFunction {
  __kind = 'native' as const;
  constructor(public name: string, public fn: (...args: any[]) => any) {}
}

export class OslClass {
  __kind = 'class' as const;
  methods = new Map<string, OslFunction>();
  parent: OslClass | null = null;
  constructor(public name: string) {}
}

export class OslInstance {
  __kind = 'instance' as const;
  fields = new Map<string, any>();
  constructor(public cls: OslClass) {}
}

export class NativeObject {
  __kind = 'object' as const;
  constructor(public name: string, public obj: Record<string, any>) {}
}

export type OslValue = any;

class ReturnSignal {
  constructor(public value: any) {}
}
class BreakSignal {}
class ContinueSignal {}

export function isCallable(v: any): boolean {
  return v instanceof OslFunction || v instanceof NativeFunction || v instanceof OslClass;
}

export function native(name: string, fn: (...args: any[]) => any): NativeFunction {
  return new NativeFunction(name, fn);
}

/* ---------------------------------------------------------- interpreter */

export class Interpreter {
  globals = new Env(null);
  steps = 0;
  maxSteps = 4_000_000;
  depth = 0;
  maxDepth = 180;
  print: (s: string) => void = (s) => console.log(s);
  private exprCache = new Map<string, Node>();
  private stmtCache = new Map<string, Node>();
  /** Optional hook used by the UI layer to trace execution. */
  onStatement?: (line: number) => void;

  /** Module support. `loader` returns the source for an absolute path. */
  loader: ((path: string) => string | null) | null = null;
  modulePath = '';
  modules = new Map<string, Env>();

  /** Innermost-last stack of active calls, used to build tracebacks. */
  private callStack: Array<{ name: string; line: number }> = [];
  private currentLine = 0;

  constructor(builtins: Record<string, any> = {}) {
    for (const [k, v] of Object.entries(builtins)) this.globals.define(k, v);
  }

  define(name: string, value: any) {
    this.globals.define(name, value);
  }

  get(name: string): any {
    return this.globals.get(name);
  }

  reset() {
    this.steps = 0;
    this.depth = 0;
  }

  /* ------------------------------------------------------------ modules */

  private resolveModulePath(request: string): string {
    let p = request.trim();
    if (p.startsWith('~')) p = '/home/user' + p.slice(1);
    if (!p.startsWith('/')) {
      const base = this.modulePath ? dirnameLocal(this.modulePath) : '/home/user';
      p = `${base}/${p}`;
    }
    if (!basenameLocal(p).includes('.')) p += '.osl';
    return normalizeLocal(p);
  }

  /** Loads (once) and returns the scope of a module. */
  loadModule(request: string): Env {
    const path = this.resolveModulePath(request);
    const cached = this.modules.get(path);
    if (cached) return cached;
    if (!this.loader) throw new OslError(`Cannot import '${request}': no module loader is installed`);
    const source = this.loader(path);
    if (source === null || source === undefined) {
      throw new OslError(`Cannot import '${request}': module not found (${path})`);
    }
    const modEnv = new Env(this.globals);
    // Cache before evaluation so circular imports resolve to a partial scope
    // instead of recursing forever.
    this.modules.set(path, modEnv);
    const previous = this.modulePath;
    this.modulePath = path;
    try {
      const ast = parseProgram(source);
      this.execBlock(ast.body, modEnv);
    } catch (e) {
      this.modules.delete(path);
      throw this.wrap(e);
    } finally {
      this.modulePath = previous;
    }
    return modEnv;
  }

  /* ------------------------------------------------------------ entry */

  run(source: string, env?: Env, path?: string): any {
    this.reset();
    if (path !== undefined) this.modulePath = path;
    const ast = parseProgram(source);
    try {
      return this.execBlock(ast.body, env ?? this.globals);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw this.wrap(e);
    }
  }

  runStatements(source: string, env: Env): any {
    this.reset();
    let ast = this.stmtCache.get(source);
    if (!ast) {
      ast = parseStatementsSource(source);
      this.stmtCache.set(source, ast);
    }
    try {
      return this.execBlock(ast.body, env);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw this.wrap(e);
    }
  }

  evalExpression(source: string, env: Env): any {
    let ast = this.exprCache.get(source);
    if (!ast) {
      ast = parseExpressionSource(source);
      this.exprCache.set(source, ast);
    }
    try {
      return this.eval(ast, env);
    } catch (e) {
      throw this.wrap(e);
    }
  }

  callByName(name: string, args: any[] = []): any {
    const fn = this.globals.get(name);
    if (!isCallable(fn)) return undefined;
    try {
      return this.call(fn, args, null);
    } catch (e) {
      throw this.wrap(e);
    }
  }

  callFunction(fn: any, args: any[] = [], self: any = null): any {
    try {
      return this.call(fn, args, self);
    } catch (e) {
      throw this.wrap(e);
    }
  }

  private wrap(e: any): Error {
    if (e instanceof OslSyntaxError) return e;
    const err = e instanceof OslError ? e : e instanceof OslErrorValue ? this.fromErrorValue(e) : new OslError(e instanceof Error ? e.message : String(e));
    if (!err.decorated) {
      err.decorated = true;
      if (!err.line && this.currentLine) err.line = this.currentLine;
      if (this.callStack.length) {
        err.frames = this.callStack
          .slice(-12)
          .reverse()
          .map((f) => (f.line ? `    at ${f.name} (line ${f.line})` : `    at ${f.name}`));
      }
      if (err.frames.length) err.message = `${err.message}\n${err.frames.join('\n')}`;
      else if (err.line && !String(err.message).includes('(line ')) err.message = `${err.message} (line ${err.line})`;
    }
    return err;
  }

  private fromErrorValue(v: OslErrorValue): OslError {
    const err = new OslError(v.type && v.type !== 'Error' ? `${v.type}: ${v.message}` : v.message, v.line);
    err.frames = v.frames;
    return err;
  }

  private toErrorValue(e: any): OslErrorValue {
    if (e instanceof OslErrorValue) return e;
    if (e instanceof OslError) {
      const m = /^(\w+): (.*)$/s.exec(e.message);
      return new OslErrorValue(m ? m[1] : 'Error', m ? m[2] : e.message, e.line, e.frames);
    }
    return new OslErrorValue('Error', e instanceof Error ? e.message : String(e));
  }

  /* -------------------------------------------------------- statements */

  execBlock(stmts: Node[], env: Env): any {
    for (const stmt of stmts) this.exec(stmt, env);
    return undefined;
  }

  exec(node: Node, env: Env): any {
    if (node.line) this.currentLine = node.line;
    if (this.onStatement) this.onStatement(node.line ?? 0);
    switch (node.type) {
      case 'Program':
        return this.execBlock(node.body, env);

      case 'VarDecl': {
        const value = this.eval(node.value, env);
        if (node.kind === 'const') env.defineConst(node.name, value);
        else env.define(node.name, value);
        return;
      }

      case 'Assign': {
        const ref = this.resolveRef(node.target, env);
        let value = this.eval(node.value, env);
        if (node.op !== '=') {
          const op = node.op.slice(0, -1);
          value = this.binop(op, ref.get(), value, node);
        }
        ref.set(value);
        return;
      }

      case 'Import': {
        const modEnv = this.loadModule(node.path);
        const name = node.alias ?? basenameLocal(node.path).replace(/\.[^.]+$/, '');
        env.define(name, new NativeObject(name, Object.fromEntries(modEnv.vars)));
        return;
      }

      case 'FromImport': {
        const modEnv = this.loadModule(node.path);
        for (const item of node.names) {
          const value = modEnv.vars.get(item.name);
          if (value === undefined && !modEnv.vars.has(item.name)) {
            throw new OslError(`Module '${node.path}' has no export named '${item.name}'`, node.line);
          }
          env.define(item.alias ?? item.name, value);
        }
        return;
      }

      case 'FuncDecl': {
        const params = node.params.map((p: any) => p.name);
        const defaults = node.params.map((p: any) => p.def);
        env.define(node.name, new OslFunction(node.name, params, defaults, node.body, env));
        return;
      }

      case 'ClassDecl': {
        const cls = new OslClass(node.name);
        if (node.parent) {
          const parent = env.get(node.parent);
          if (!(parent instanceof OslClass)) throw new OslError(`'${node.parent}' is not a class`, node.line);
          cls.parent = parent;
        }
        for (const m of node.methods) {
          const params = m.params.map((p: any) => p.name);
          const defaults = m.params.map((p: any) => p.def);
          cls.methods.set(m.name, new OslFunction(m.name, params, defaults, m.body, env));
        }
        env.define(node.name, cls);
        return;
      }

      case 'If': {
        for (const br of node.branches) {
          if (this.truthy(this.eval(br.cond, env))) return this.execBlock(br.body, env);
        }
        if (node.orelse) return this.execBlock(node.orelse, env);
        return;
      }

      case 'While': {
        while (this.truthy(this.eval(node.cond, env))) {
          try {
            this.execBlock(node.body, env);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }

      case 'For': {
        const src = this.eval(node.iter, env);
        let pairs: Array<[any, any]>;
        if (node.name2) {
          // `for k, v in dict` walks entries; `for i, x in list` walks pairs.
          pairs =
            src instanceof Map
              ? [...src.entries()]
              : this.iterable(src).map((it) => {
                  const p = this.iterable(it);
                  return [p[0] ?? null, p[1] ?? null] as [any, any];
                });
        } else {
          pairs = this.iterable(src).map((it) => [it, null] as [any, any]);
        }
        for (const [first, second] of pairs) {
          env.define(node.name, first);
          if (node.name2) env.define(node.name2, second);
          try {
            this.execBlock(node.body, env);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }

      case 'Return': {
        throw new ReturnSignal(node.value ? this.eval(node.value, env) : null);
      }
      case 'Break':
        throw new BreakSignal();
      case 'Continue':
        throw new ContinueSignal();
      case 'Pass':
        return;

      case 'Raise': {
        const v = this.eval(node.value, env);
        if (v instanceof OslErrorValue) throw v;
        const message = this.toStr(v);
        const typed = /^(\w+):\s*([\s\S]*)$/.exec(message);
        throw new OslErrorValue(
          typed ? typed[1] : 'Error',
          typed ? typed[2] : message,
          node.line,
          this.callStack
            .slice()
            .reverse()
            .map((f) => (f.line ? `    at ${f.name} (line ${f.line})` : `    at ${f.name}`)),
        );
      }

      case 'Try': {
        try {
          this.execBlock(node.body, env);
        } catch (e) {
          if (e instanceof ReturnSignal || e instanceof BreakSignal || e instanceof ContinueSignal) throw e;
          if (!node.catchBody) throw e;
          env.define(node.catchName, this.toErrorValue(e));
          this.execBlock(node.catchBody, env);
        } finally {
          if (node.finallyBody) this.execBlock(node.finallyBody, env);
        }
        return;
      }

      case 'ExprStmt':
        this.eval(node.expr, env);
        return;
    }
    throw new OslError(`Unknown statement '${node.type}'`, node.line);
  }

  /**
   * Resolves an assignment target once, so `f().x += 1` evaluates `f()` a
   * single time instead of twice.
   */
  private resolveRef(target: Node, env: Env): { get(): any; set(v: any): void } {
    if (target.type === 'Name') {
      return { get: () => env.get(target.name), set: (v) => env.assign(target.name, v) };
    }
    if (target.type === 'Member') {
      const obj = this.eval(target.obj, env);
      return { get: () => this.getMember(obj, target.name), set: (v) => this.setMember(obj, target.name, v) };
    }
    if (target.type === 'Index') {
      const obj = this.eval(target.obj, env);
      const key = this.eval(target.index, env);
      return { get: () => this.getIndex(obj, key), set: (v) => this.setIndex(obj, key, v) };
    }
    throw new OslError('Invalid assignment target', target.line);
  }

  /* ------------------------------------------------------- expressions */

  eval(node: Node, env: Env): any {
    if (node.line) this.currentLine = node.line;
    if (++this.steps > this.maxSteps) {
      throw new OslError('Execution limit reached — possible infinite loop');
    }
    switch (node.type) {
      case 'Num':
        return node.value;
      case 'Str':
        return node.f ? this.interpolate(node.value, env) : node.value;
      case 'Bool':
        return node.value;
      case 'None':
        return null;
      case 'Name':
        return env.get(node.name);

      case 'List':
        return node.items.map((it: Node) => this.eval(it, env));

      case 'Dict': {
        const map = new Map<any, any>();
        for (const pair of node.pairs) {
          const key = this.eval(pair.k, env);
          const val = this.eval(pair.v, env);
          map.set(key, val);
        }
        return map;
      }

      case 'Lambda': {
        return new OslFunction(
          '<lambda>',
          node.params,
          node.defaults ?? node.params.map(() => null),
          [{ type: 'Return', value: node.body }],
          env,
        );
      }

      case 'LambdaBlock': {
        return new OslFunction(
          '<lambda>',
          node.params,
          node.defaults ?? node.params.map(() => null),
          node.body,
          env,
        );
      }

      case 'Unary': {
        if (node.op === 'not') return !this.truthy(this.eval(node.arg, env));
        const v = this.num(this.eval(node.arg, env), node);
        return node.op === '-' ? -v : v;
      }

      case 'Ternary':
        return this.truthy(this.eval(node.cond, env)) ? this.eval(node.a, env) : this.eval(node.b, env);

      case 'Bin': {
        if (node.op === 'and') {
          const l = this.eval(node.l, env);
          return this.truthy(l) ? this.eval(node.r, env) : l;
        }
        if (node.op === 'or') {
          const l = this.eval(node.l, env);
          return this.truthy(l) ? l : this.eval(node.r, env);
        }
        const l = this.eval(node.l, env);
        const r = this.eval(node.r, env);
        return this.binop(node.op, l, r, node);
      }

      case 'Call': {
        if (node.callee.type === 'Member') {
          const obj = this.eval(node.callee.obj, env);
          const fn = this.getMember(obj, node.callee.name);
          const args = node.args.map((a: Node) => this.eval(a, env));
          return this.call(fn, args, obj, node.line);
        }
        const fn = this.eval(node.callee, env);
        const args = node.args.map((a: Node) => this.eval(a, env));
        return this.call(fn, args, null, node.line);
      }

      case 'Member':
        return this.getMember(this.eval(node.obj, env), node.name);

      case 'Index':
        return this.getIndex(this.eval(node.obj, env), this.eval(node.index, env));

      case 'Slice': {
        const obj = this.eval(node.obj, env);
        const start = node.start ? this.num(this.eval(node.start, env), node) : null;
        const end = node.end ? this.num(this.eval(node.end, env), node) : null;
        if (Array.isArray(obj)) return obj.slice(start ?? 0, end ?? obj.length);
        if (typeof obj === 'string') return obj.slice(start ?? 0, end ?? obj.length);
        throw new OslError('Only lists and strings can be sliced', node.line);
      }
    }
    throw new OslError(`Unknown expression '${node.type}'`, node.line);
  }

  /* ---------------------------------------------------------- operators */

  binop(op: string, l: any, r: any, node?: Node): any {
    switch (op) {
      case '+':
        if (typeof l === 'number' && typeof r === 'number') return l + r;
        if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
        if (l === null || l === undefined) {
          if (typeof r === 'string') return 'None' + r;
          throw new OslError('Cannot add None to a number', node?.line);
        }
        if (r === null || r === undefined) {
          if (typeof l === 'string') return l + 'None';
          throw new OslError('Cannot add a number to None', node?.line);
        }
        return this.toStr(l) + this.toStr(r);
      case '-':
        return this.num(l, node) - this.num(r, node);
      case '*':
        if (typeof l === 'string' && typeof r === 'number') return l.repeat(Math.max(0, Math.floor(r)));
        return this.num(l, node) * this.num(r, node);
      case '/':
        return this.num(l, node) / this.num(r, node);
      case '//':
        return Math.floor(this.num(l, node) / this.num(r, node));
      case '%':
        return this.num(l, node) % this.num(r, node);
      case '**':
        return Math.pow(this.num(l, node), this.num(r, node));
      case '==':
        return this.eq(l, r);
      case '!=':
        return !this.eq(l, r);
      case '<':
      case '<=':
      case '>':
      case '>=': {
        let a = l;
        let b = r;
        if (typeof a === 'string' && typeof b === 'string') {
          /* lexicographic */
        } else {
          a = this.num(l, node);
          b = this.num(r, node);
        }
        if (op === '<') return a < b;
        if (op === '<=') return a <= b;
        if (op === '>') return a > b;
        return a >= b;
      }
      case 'in':
        return this.contains(r, l);
      case 'notin':
        return !this.contains(r, l);
      case 'is':
        return l === r;
      case 'isnot':
        return l !== r;
    }
    throw new OslError(`Unknown operator '${op}'`, node?.line);
  }

  contains(container: any, value: any): boolean {
    if (typeof container === 'string') return container.includes(this.toStr(value));
    if (Array.isArray(container)) return container.some((v) => this.eq(v, value));
    if (container instanceof Map) return container.has(value);
    if (container instanceof NativeObject) return value in container.obj;
    return false;
  }

  num(v: any, node?: Node): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
    throw new OslError(`Expected a number but got ${this.typeOf(v)}`, node?.line);
  }

  truthy(v: any): boolean {
    if (v === null || v === undefined || v === false) return false;
    if (v === 0 || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    if (v instanceof Map && v.size === 0) return false;
    return true;
  }

  eq(a: any, b: any): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => this.eq(v, b[i]));
    }
    if (a instanceof Map && b instanceof Map) {
      if (a.size !== b.size) return false;
      for (const [k, v] of a) if (!b.has(k) || !this.eq(v, b.get(k))) return false;
      return true;
    }
    return false;
  }

  iterable(v: any): any[] {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return v.split('');
    if (v instanceof Map) return [...v.keys()];
    if (v instanceof NativeObject) return Object.keys(v.obj);
    if (v === null) throw new OslError('None is not iterable');
    return [];
  }

  typeOf(v: any): string {
    if (v === null) return 'None';
    if (Array.isArray(v)) return 'list';
    if (v instanceof Map) return 'dict';
    if (v instanceof OslFunction || v instanceof NativeFunction) return 'function';
    if (v instanceof OslErrorValue) return 'error';
    if (v instanceof OslInstance) return v.cls.name;
    if (v instanceof OslClass) return 'class';
    if (typeof v === 'string') return 'str';
    if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
    if (typeof v === 'boolean') return 'bool';
    return typeof v;
  }

  /* ------------------------------------------------------------- strings */

  toStr(v: any): string {
    if (v === null || v === undefined) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (v instanceof OslErrorValue) return v.message;
    if (typeof v === 'string') return v;
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return String(v);
      const s = String(+v.toFixed(10));
      return s;
    }
    if (Array.isArray(v)) return '[' + v.map((x) => this.repr(x)).join(', ') + ']';
    if (v instanceof Map) {
      const parts: string[] = [];
      for (const [k, val] of v) parts.push(`${this.repr(k)}: ${this.repr(val)}`);
      return '{' + parts.join(', ') + '}';
    }
    if (v instanceof OslFunction) return `<function ${v.name}>`;
    if (v instanceof NativeFunction) return `<native ${v.name}>`;
    if (v instanceof OslInstance) return `<${v.cls.name} object>`;
    if (v instanceof OslClass) return `<class ${v.name}>`;
    if (v instanceof NativeObject) return `<${v.name}>`;
    return String(v);
  }

  repr(v: any): string {
    if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    return this.toStr(v);
  }

  private interpolate(template: string, env: Env): string {
    let out = '';
    let i = 0;
    while (i < template.length) {
      const ch = template[i];
      if (ch === '{' && template[i + 1] === '{') {
        out += '{';
        i += 2;
        continue;
      }
      if (ch === '}' && template[i + 1] === '}') {
        out += '}';
        i += 2;
        continue;
      }
      if (ch === '{') {
        let depth = 0;
        let j = i;
        for (; j < template.length; j++) {
          if (template[j] === '{') depth++;
          else if (template[j] === '}') {
            depth--;
            if (depth === 0) break;
          }
        }
        if (j >= template.length) {
          out += ch;
          i++;
          continue;
        }
        const src = template.slice(i + 1, j);
        out += this.toStr(this.evalExpression(src, env));
        i = j + 1;
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  }

  /* ------------------------------------------------------------- member */

  getMember(obj: any, name: string): any {
    if (obj instanceof OslInstance) {
      if (obj.fields.has(name)) return obj.fields.get(name);
      for (let cls: OslClass | null = obj.cls; cls; cls = cls.parent) {
        const method = cls.methods.get(name);
        if (method) return native(name, (...args: any[]) => this.call(method, args, obj));
      }
      throw new OslError(`${obj.cls.name} object has no attribute '${name}'`);
    }
    if (obj instanceof OslErrorValue) {
      if (name === 'message') return obj.message;
      if (name === 'type') return obj.type;
      if (name === 'line') return obj.line ?? null;
      if (name === 'frames') return obj.frames;
      return null;
    }
    if (obj instanceof Map) {
      // Stored keys win over method names: `fs.list()` entries carry a `size`
      // field, and that must not resolve to the Map's `size()` helper.
      if (obj.has(name)) return obj.get(name);
      const method = this.mapMethod(obj, name);
      if (method) return method;
      return null;
    }
    if (Array.isArray(obj)) {
      const method = this.listMethod(obj, name);
      if (method) return method;
      if (name === 'length') return obj.length;
      return null;
    }
    if (typeof obj === 'string') {
      const method = this.stringMethod(obj, name);
      if (method) return method;
      if (name === 'length') return obj.length;
      return null;
    }
    if (typeof obj === 'number') {
      if (name === 'toFixed') return native('toFixed', (n = 2) => obj.toFixed(n));
      if (name === 'abs') return native('abs', () => Math.abs(obj));
      return null;
    }
    if (obj instanceof NativeObject) {
      const v = obj.obj[name];
      return typeof v === 'function' ? native(name, v.bind(obj.obj)) : v ?? null;
    }
    if (obj instanceof OslClass) return null;
    if (obj === null || obj === undefined) throw new OslError(`None has no attribute '${name}'`);
    // plain JS object (events, native payloads)
    if (typeof obj === 'object') {
      const v = (obj as any)[name];
      if (typeof v === 'function') return native(name, v.bind(obj));
      return v ?? null;
    }
    return null;
  }

  setMember(obj: any, name: string, value: any) {
    if (obj instanceof OslInstance) {
      obj.fields.set(name, value);
      return;
    }
    if (obj instanceof Map) {
      obj.set(name, value);
      return;
    }
    if (obj instanceof NativeObject) {
      obj.obj[name] = value;
      return;
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      (obj as any)[name] = value;
      return;
    }
    throw new OslError(`Cannot set attribute '${name}'`);
  }

  getIndex(obj: any, key: any): any {
    if (Array.isArray(obj)) {
      let i = Math.trunc(this.num(key));
      if (i < 0) i += obj.length;
      return i >= 0 && i < obj.length ? obj[i] : null;
    }
    if (typeof obj === 'string') {
      let i = Math.trunc(this.num(key));
      if (i < 0) i += obj.length;
      return i >= 0 && i < obj.length ? obj[i] : '';
    }
    if (obj instanceof Map) return obj.has(key) ? obj.get(key) : null;
    if (obj && typeof obj === 'object') return (obj as any)[key] ?? null;
    throw new OslError('This value cannot be indexed');
  }

  setIndex(obj: any, key: any, value: any) {
    if (Array.isArray(obj)) {
      let i = Math.trunc(this.num(key));
      if (i < 0) i += obj.length;
      if (i >= 0 && i < obj.length) obj[i] = value;
      return;
    }
    if (obj instanceof Map) {
      obj.set(key, value);
      return;
    }
    if (obj && typeof obj === 'object') {
      (obj as any)[key] = value;
      return;
    }
    throw new OslError('This value cannot be indexed');
  }

  /* -------------------------------------------------------------- calls */

  call(fn: any, args: any[], self: any = null, line = 0): any {
    if (fn instanceof NativeFunction) return fn.fn(...args);
    if (fn instanceof OslFunction) {
      if (++this.depth > this.maxDepth) {
        this.depth--;
        throw new OslError(`Maximum recursion depth (${this.maxDepth}) exceeded`);
      }
      this.callStack.push({ name: fn.name || '<anonymous>', line });
      const env = new Env(fn.closure);
      env.define('self', self ?? null);
      for (let i = 0; i < fn.params.length; i++) {
        let v = i < args.length ? args[i] : null;
        if (i >= args.length && fn.defaults[i]) v = this.eval(fn.defaults[i]!, env);
        env.define(fn.params[i], v);
      }
      try {
        this.execBlock(fn.body, env);
        return null;
      } catch (e) {
        if (e instanceof ReturnSignal) return e.value;
        throw e;
      } finally {
        this.depth--;
        this.callStack.pop();
      }
    }
    if (fn instanceof OslClass) {
      const inst = new OslInstance(fn);
      let init: OslFunction | undefined;
      for (let cls: OslClass | null = fn; cls && !init; cls = cls.parent) {
        init = cls.methods.get('init') ?? cls.methods.get('__init__') ?? cls.methods.get('constructor');
      }
      if (init) this.call(init, args, inst, line);
      return inst;
    }
    throw new OslError(`'${this.toStr(fn)}' is not callable`);
  }

  /* ----------------------------------------------------------- methods */

  private listMethod(arr: any[], name: string): NativeFunction | null {
    const self = this;
    const make = (fn: (...a: any[]) => any) => native(name, fn);
    switch (name) {
      case 'append':
      case 'push':
        return make((v) => {
          arr.push(v);
          return null;
        });
      case 'extend':
        return make((v) => {
          arr.push(...self.iterable(v));
          return null;
        });
      case 'pop':
        return make((i?: number) => (i === undefined ? arr.pop() ?? null : arr.splice(i, 1)[0] ?? null));
      case 'shift':
        return make(() => arr.shift() ?? null);
      case 'insert':
        return make((i: number, v: any) => {
          arr.splice(Math.max(0, i), 0, v);
          return null;
        });
      case 'remove':
        return make((v) => {
          const i = arr.findIndex((x) => self.eq(x, v));
          if (i >= 0) arr.splice(i, 1);
          return null;
        });
      case 'index':
        return make((v) => arr.findIndex((x) => self.eq(x, v)));
      case 'count':
        return make((v) => arr.filter((x) => self.eq(x, v)).length);
      case 'sort':
        return make((fn?: any) => {
          if (fn && isCallable(fn)) arr.sort((a, b) => self.num(self.call(fn, [a, b])));
          else arr.sort((a, b) => (typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : self.num(a) - self.num(b)));
          return null;
        });
      case 'reverse':
        return make(() => {
          arr.reverse();
          return null;
        });
      case 'clear':
        return make(() => {
          arr.length = 0;
          return null;
        });
      case 'join':
        return make((sep = ',') => arr.map((v) => self.toStr(v)).join(self.toStr(sep)));
      case 'slice':
        return make((a = 0, b?: number) => arr.slice(a, b));
      case 'map':
        return make((fn: any) => arr.map((v, i) => self.call(fn, [v, i])));
      case 'filter':
        return make((fn: any) => arr.filter((v, i) => self.truthy(self.call(fn, [v, i]))));
      case 'find':
        return make((fn: any) => arr.find((v, i) => self.truthy(self.call(fn, [v, i]))) ?? null);
      case 'each':
      case 'forEach':
        return make((fn: any) => {
          arr.forEach((v, i) => self.call(fn, [v, i]));
          return null;
        });
      case 'sum':
        return make(() => arr.reduce((a, b) => a + self.num(b), 0));
      case 'first':
        return make(() => arr[0] ?? null);
      case 'last':
        return make(() => arr[arr.length - 1] ?? null);
      case 'contains':
        return make((v) => arr.some((x) => self.eq(x, v)));
      case 'clone':
        return make(() => [...arr]);
      case 'keys':
        return make(() => arr.map((_, i) => i));
    }
    return null;
  }

  private stringMethod(s: string, name: string): NativeFunction | null {
    const self = this;
    const make = (fn: (...a: any[]) => any) => native(name, fn);
    switch (name) {
      case 'upper':
      case 'toUpperCase':
        return make(() => s.toUpperCase());
      case 'lower':
      case 'toLowerCase':
        return make(() => s.toLowerCase());
      case 'strip':
      case 'trim':
        return make(() => s.trim());
      case 'lstrip':
        return make(() => s.replace(/^\s+/, ''));
      case 'rstrip':
        return make(() => s.replace(/\s+$/, ''));
      case 'split':
        return make((sep?: string) => (sep === undefined ? s.split(/\s+/) : s.split(self.toStr(sep))));
      case 'replace':
        return make((a: any, b: any) => s.split(self.toStr(a)).join(self.toStr(b)));
      case 'startswith':
      case 'startsWith':
        return make((p) => s.startsWith(self.toStr(p)));
      case 'endswith':
      case 'endsWith':
        return make((p) => s.endsWith(self.toStr(p)));
      case 'find':
        // The optional second argument is a start offset: scanning for the next
        // delimiter is a common need (link parsing, tokenising).
        return make((p, from: any = 0) => s.indexOf(self.toStr(p), Math.max(0, Number(from) || 0)));
      case 'contains':
        return make((p) => s.includes(self.toStr(p)));
      case 'count':
        return make((p) => (p === '' ? 0 : s.split(self.toStr(p)).length - 1));
      case 'repeat':
        return make((n = 1) => s.repeat(Math.max(0, Math.floor(n))));
      case 'charAt':
        return make((i) => s[Math.max(0, Math.min(s.length - 1, i))] ?? '');
      case 'capitalize':
        return make(() => (s.length ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s));
      case 'title':
        return make(() => s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1)));
      case 'slice':
        return make((a = 0, b?: number) => s.slice(a, b));
      case 'join':
        return make((list: any) => self.iterable(list).map((v) => self.toStr(v)).join(s));
      case 'format':
        return make((...args: any[]) => {
          let i = 0;
          return s.replace(/\{\}/g, () => self.toStr(args[i++] ?? ''));
        });
      case 'padStart':
        return make((n: number, c = ' ') => s.padStart(n, self.toStr(c)));
      case 'padEnd':
        return make((n: number, c = ' ') => s.padEnd(n, self.toStr(c)));
      case 'toString':
        return make(() => s);
    }
    return null;
  }

  private mapMethod(map: Map<any, any>, name: string): NativeFunction | null {    const self = this;
    const make = (fn: (...a: any[]) => any) => native(name, fn);
    switch (name) {
      case 'get':
        return make((k: any, def: any = null) => (map.has(k) ? map.get(k) : def));
      case 'set':
        return make((k: any, v: any) => {
          map.set(k, v);
          return null;
        });
      case 'has':
        return make((k: any) => map.has(k));
      case 'remove':
      case 'delete':
        return make((k: any) => {
          map.delete(k);
          return null;
        });
      case 'keys':
        return make(() => [...map.keys()]);
      case 'values':
        return make(() => [...map.values()]);
      case 'items':
        return make(() => [...map.entries()].map(([k, v]) => [k, v]));
      case 'entries':
        return make(() => [...map.entries()]);
      case 'merge':
        return make((other: any) => {
          if (other instanceof Map) for (const [k, v] of other) map.set(k, v);
          return null;
        });
      case 'clear':
        return make(() => {
          map.clear();
          return null;
        });
      case 'size':
        return make(() => map.size);
      case 'clone':
        return make(() => new Map(map));
      case 'each':
        return make((fn: any) => {
          for (const [k, v] of map) self.call(fn, [k, v]);
          return null;
        });
    }
    return null;
  }
}

/* ------------------------------------------------------- module paths */

function normalizeLocal(input: string): string {
  const out: string[] = [];
  for (const seg of input.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return '/' + out.join('/');
}

function dirnameLocal(p: string): string {
  const n = normalizeLocal(p);
  const i = n.lastIndexOf('/');
  return i <= 0 ? '/' : n.slice(0, i);
}

function basenameLocal(p: string): string {
  const n = normalizeLocal(p);
  return n === '/' ? '/' : n.slice(n.lastIndexOf('/') + 1);
}
