/**
 * OSL devkit — 开发期工具，不进入产物 bundle。
 *
 * 构建并运行：
 *   ./node_modules/.bin/esbuild tools/osl-devkit.ts --bundle --platform=node \
 *     --format=cjs --outfile=.tmp/devkit.cjs
 *   node .tmp/devkit.cjs bench
 *   node .tmp/devkit.cjs tokens
 *   node .tmp/devkit.cjs ast
 *
 * 子命令：
 *   bench   语言运行时基准 + 语料规模统计（自举的预算基线）
 *   tokens  用 src/osl/self/lexer.osl 分词，与宿主 lexer 逐 token 比对
 *   ast     用 src/osl/self/parser.osl 解析，与宿主 AST 逐字段比对
 *
 * tokens / ast 在自举源码还不存在时只打印提示并以 0 退出，
 * 这样 harness 可以先于实现落地。
 */
import { Interpreter, NativeFunction, NativeObject } from '../src/osl/interp';
import { lex } from '../src/osl/lexer';
import { parseProgram } from '../src/osl/parser';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const SELF_LEXER = 'src/osl/self/lexer.osl';
const SELF_PARSER = 'src/osl/self/parser.osl';

/* ------------------------------------------------------------------ 语料 */

/**
 * 仓库里全部 .osl。直接遍历目录而不是 `git ls-files`——未提交的新文件也是语料，
 * 否则自举源码自己会被漏掉。
 */
function oslFiles(dir = 'src', out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) oslFiles(p, out);
    else if (e.name.endsWith('.osl')) out.push(p);
  }
  return out.sort();
}

function countNodes(ast: any): number {
  let n = 0;
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v.type === 'string') n++;
    for (const k of Object.keys(v)) if (k !== 'type') walk(v[k]);
  };
  walk(ast);
  return n;
}

/* ------------------------------------------------------- 最小宿主（跑 OSL） */

/** 只提供标准库中“纯计算”的部分，够 lexer/parser 用，且都不依赖 DOM / VFS。 */
function bareInterpreter(maxSteps = 900_000_000, maxDepth = 100_000): Interpreter {
  const i = new Interpreter({}, { maxSteps, maxDepth });
  i.print = () => null;
  const g: Record<string, any> = {
    print: () => null,
    len: (v: any) => (typeof v === 'string' ? v.length : Array.isArray(v) ? v.length : (v?.size ?? 0)),
    str: (v: any) => i.toStr(v),
    int: (v: any) => parseInt(String(v), 10) || 0,
    float: (v: any) => parseFloat(String(v)) || 0,
    bool: (v: any) => i.truthy(v),
    ord: (s: any) => String(s).charCodeAt(0),
    chr: (n: any) => String.fromCharCode(Number(n)),
    abs: Math.abs,
    round: Math.round,
    min: (...a: any[]) => Math.min(...a.map(Number)),
    max: (...a: any[]) => Math.max(...a.map(Number)),
    sum: (a: any[]) => (Array.isArray(a) ? a.reduce((x, y) => x + Number(y), 0) : 0),
    range: (a: number, b?: number) => {
      const s = b === undefined ? 0 : a;
      const e = b === undefined ? a : b;
      return Array.from({ length: Math.max(0, e - s) }, (_, k) => s + k);
    },
  };
  for (const [k, v] of Object.entries(g)) i.define(k, new NativeFunction(k, v as any));
  i.define('math', new NativeObject('math', { min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, round: Math.round, sqrt: Math.sqrt }));
  i.loader = (p: string) => {
    // 模块路径是 VFS 语义（/home/user/system/x.osl），这里映射回仓库路径
    const rel = p.replace(/^\/home\/user\//, '').replace(/^\//, '');
    for (const cand of [rel, 'src/' + rel, 'src/system/' + rel.split('/').pop()]) {
      if (cand && existsSync(cand)) return readFileSync(cand, 'utf8');
    }
    return null;
  };
  return i;
}

/** 载入一个自举源码文件并取出其中一个函数。 */
function loadSelfModule(file: string, fn: string, args: string) {
  const src = readFileSync(file, 'utf8');
  const i = bareInterpreter();
  // 让 `import "lexer.osl"` 这类相对路径解析到源码旁边（VFS 里是同目录）
  i.modulePath = file;
  i.run(src);
  const callable = i.globals.get(fn);
  return (input: string) => i.callFunction(callable, [input, ...args ? [args] : []]);
}

/* ------------------------------------------------------------- 比对工具 */

function diffValue(a: any, b: any, path = '$', out: string[] = []): string[] {
  if (out.length > 4) return out;
  const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      out.push(`${path}: 类型不同 (${Array.isArray(a) ? 'array' : typeof a} vs ${Array.isArray(b) ? 'array' : typeof b})`);
      return out;
    }
    if (a.length !== b.length) out.push(`${path}: 长度 ${a.length} vs ${b.length}`);
    for (let k = 0; k < Math.min(a.length, b.length); k++) diffValue(a[k], b[k], `${path}[${k}]`, out);
    return out;
  }
  if (isObj(a) || isObj(b)) {
    if (!isObj(a) || !isObj(b)) {
      out.push(`${path}: 类型不同 (${typeof a} vs ${typeof b})`);
      return out;
    }
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    for (const k of ka) if (!(k in b)) out.push(`${path}.${k}: 宿主有、自举缺失`);
    for (const k of kb) if (!(k in a)) out.push(`${path}.${k}: 自举多出、宿主没有`);
    // 键顺序也要一致：AST 快照按 JSON 序列化做缓存，顺序变了快照就不可复现
    if (ka.join('<') !== kb.join('<')) out.push(`${path}: 键顺序 ${ka.join(',')} vs ${kb.join(',')}`);
    for (const k of ka) if (k in b) diffValue(a[k], b[k], `${path}.${k}`, out);
    return out;
  }
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  return out;
}

/** Map → 普通对象，便于和宿主的 plain object AST 比较。 */
function plain(v: any): any {
  if (v instanceof Map) {
    const o: Record<string, any> = {};
    for (const [k, val] of v) o[String(k)] = plain(val);
    return o;
  }
  if (Array.isArray(v)) return v.map(plain);
  return v;
}

/* -------------------------------------------------------------- 子命令 */

function cmdBench() {
  const line = (s: string) => console.log(s);

  // 1) 原生解释器吞吐
  {
    const i = bareInterpreter();
    const t0 = performance.now();
    i.run(`fn fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
let v = fib(22)`);
    const dt = performance.now() - t0;
    line(`吞吐   fib(22) ${dt.toFixed(0)} ms / ${i.steps.toLocaleString()} 步 → ${Math.round(i.steps / (dt / 1000)).toLocaleString()} 步/秒`);
  }

  // 2) OSL 里跑一个最小求值器：每节点成本（带作用域链，和真实求值器同形）
  const mini = `fn env_get(e, nm):
    let cur = e
    while cur != None:
        if nm in cur.vars:
            return cur.vars[nm]
        cur = cur.parent
    return None

fn ev(node, env):
    let t = node.t
    if t == "num":
        return node.v
    if t == "name":
        return env_get(env, node.name)
    if t == "bin":
        let a = ev(node.l, env)
        let b = ev(node.r, env)
        if node.op == "+":
            return a + b
        if node.op == "-":
            return a - b
        return a * b
    return None

let nodes = []
let k = 0
while k < 3000:
    nodes.append({"t": "bin", "op": "+", "l": {"t": "num", "v": k}, "r": {"t": "bin", "op": "*", "l": {"t": "name", "name": "x"}, "r": {"t": "num", "v": 2}}})
    k += 1
let env = {"vars": {"x": 7}, "parent": None}
let acc = 0
for nd in nodes:
    acc += ev(nd, env)`;
  let stepsPerNode = 0;
  {
    const i = bareInterpreter();
    const t0 = performance.now();
    i.run(mini);
    const dt = performance.now() - t0;
    const nodesVisited = 3000 * 7;
    stepsPerNode = Math.round(i.steps / nodesVisited);
    line(`嵌套   ${nodesVisited.toLocaleString()} 个 AST 节点 ${dt.toFixed(0)} ms / ${i.steps.toLocaleString()} 步 → ${stepsPerNode} 步/节点，${Math.round(nodesVisited / (dt / 1000)).toLocaleString()} 节点/秒`);
    line(`       折算：自举解释器里每解释一个 AST 节点，要多花 ${stepsPerNode} 个外层步`);
  }

  // 3) OSL 调用深度上限（宿主 JS 栈）
  {
    let lo = 100;
    let hi = 8000;
    while (hi - lo > 50) {
      const mid = Math.floor((lo + hi) / 2);
      const i = bareInterpreter();
      try {
        i.run(`fn down(n):\n    if n <= 0:\n        return 0\n    return down(n - 1)\nlet v = down(${mid})`);
        lo = mid;
      } catch {
        hi = mid;
      }
    }
    line(`深度   OSL 调用栈实测上限 ≈ ${lo}（再深宿主抛 RangeError，不是干净报错）`);
  }

  // 4) 语料规模
  {
    let lines = 0, chars = 0, toks = 0, nodes = 0;
    const files = oslFiles();
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      lines += src.split('\n').length;
      chars += src.length;
      toks += lex(src).length;
      nodes += countNodes(parseProgram(src));
    }
    line(`语料   ${files.length} 个文件 / ${lines} 行 / ${chars.toLocaleString()} 字符 / ${toks.toLocaleString()} token / ${nodes.toLocaleString()} AST 节点`);
    // 实测：词法 68 步/字符、解析 109 步/字符（见 `pnpm frontend`）
    const perChar = 177;
    const rate = 450_000;
    line(`预算   前端（全语料）≈ ${((chars * perChar) / 1e6).toFixed(1)}M 步 ≈ ${((chars * perChar) / rate).toFixed(1)} s（按 ${(rate / 1000).toFixed(0)}k 步/秒）`);
  }

  // 5) 真实 OSL 负载
  {
    const doc = readFileSync('src/docs/osl.md', 'utf8');
    const i = bareInterpreter();
    i.define('DOC', doc);
    const t0 = performance.now();
    try {
      i.run(`import "system/markdown.osl" as md\nlet blocks = md.parse(DOC)`);
      const dt = performance.now() - t0;
      line(`负载   markdown.parse(${doc.length} 字符) ${dt.toFixed(0)} ms / ${i.steps.toLocaleString()} 步 → 自举后约 ${((i.steps * stepsPerNode) / 450_000).toFixed(1)} s（×${stepsPerNode}）`);
    } catch (e: any) {
      line(`负载   markdown.osl 失败：${String(e.message).split('\n')[0]}`);
    }
  }
}

/**
 * 极端用例：语料里没出现、但词法器必须支持的写法。没有这一层，"通过"只证明
 * 适配了现有文件。
 */
const EDGE_CASES = [
  'a = 1\n',
  'if a:\n    b\n',
  'if a:\n\tb\n',
  'a = 1; b = 2\n',
  'a = 1 + \\\n    2\n',
  'a = "x\\n\\t\\\\ \\"y\\" \\x41 \\u{1F600}"\n',
  'a = """line1\nline2\n"""\n',
  'a = "single"\nf = f"v={a}"\n',
  'a = .5 + 1_000 + 1e9 + 2.5e-3\n',
  'x **= 2\n',
  'a = [1,\n  2,\n]\n',
  'a = [\n    1,\n]\n\nb\n',
  'for k, v in d:\n    pass\n',
  'a = b if c else d\n',
  'a = b ? c : d\n',
  'a = x => x * 2\n',
  'a = (x, y) => x\n',
  'class K extends B:\n    fn init(x):\n        self.x = x\n',
  'try:\n    a\nexcept e:\n    b\nfinally:\n    c\n',
  'throw {"k": 1}\n',
  '# only a comment\n',
  '\n\n\n',
  'a = 1  # tail comment\n',
  'if a:\n    if b:\n        c\nd\n',
  // CRLF：空行只能算一行（否则之后所有行号整体漂移）
  'a = 1\r\n\r\nlet b = 2\r\n',
  'a = [\r\n    1,\r\n]\r\n\r\nb\r\n',
];

function compareOne(label: string, src: string, kind: 'tokens' | 'ast', call: (s: string) => any): boolean {
  let want: any;
  try {
    want = kind === 'tokens' ? lex(src) : parseProgram(src);
  } catch (e: any) {
    console.log(`· ${label} 宿主本身就拒绝，跳过（${String(e.message).split('\n')[0]}）`);
    return true;
  }
  let got: any;
  try {
    got = plain(call(src));
  } catch (e: any) {
    console.log(`✗ ${label}\n    自举侧抛错：${String(e.message).split('\n')[0]}`);
    return false;
  }
  const d = diffValue(want, got);
  if (d.length) {
    console.log(`✗ ${label}\n    ${d.slice(0, 4).join('\n    ')}`);
    return false;
  }
  return true;
}

function compareCorpus(kind: 'tokens' | 'ast') {
  const file = kind === 'tokens' ? SELF_LEXER : SELF_PARSER;
  if (!existsSync(file)) {
    console.log(`${file} 还不存在 —— ${kind === 'tokens' ? 'S1' : 'S2'} 阶段未开始，跳过。`);
    return 0;
  }
  const fn = kind === 'tokens' ? 'lex' : 'parse';
  const call = loadSelfModule(file, fn, '');
  let bad = 0;
  let total = 0;

  // 1) 仓库里的全部 .osl，原样与归一化成 LF 各跑一遍——CRLF 下的空行计数是
  //    宿主的一个历史行为，必须一起对齐
  for (const f of oslFiles()) {
    const raw = readFileSync(f, 'utf8');
    const variants: Array<[string, string]> = [
      ['', raw],
      [' (LF)', raw.replace(/\r\n/g, '\n')],
    ];
    for (const [tag, src] of variants) {
      total++;
      if (compareOne(f + tag, src, kind, call)) console.log(`✓ ${f}${tag}`);
      else bad++;
    }
  }

  // 2) 极端用例
  {
    for (let k = 0; k < EDGE_CASES.length; k++) {
      total++;
      const label = `case ${String(k).padStart(2, '0')} ${JSON.stringify(EDGE_CASES[k]).slice(0, 44)}`;
      if (compareOne(label, EDGE_CASES[k], kind, call)) console.log(`✓ ${label}`);
      else bad++;
    }
  }

  console.log(`\n${bad === 0 ? `全部一致（${total} 项）` : `${bad} / ${total} 项不一致`}`);
  return bad === 0 ? 0 : 1;
}

/**
 * 前端成本实测：自举词法器 / 解析器跑全语料要多少步、多少秒。
 * 这两个数字决定了 L0（半自举）能不能真的用起来。
 */
function cmdFrontend() {
  const files = oslFiles();
  if (!existsSync(SELF_LEXER)) {
    console.log(`${SELF_LEXER} 不存在，S1 未开始。`);
    return 0;
  }

  // 每个阶段单独一个解释器实例，模块加载与前面的测量互不干扰
  const lexer = bareInterpreter();
  lexer.modulePath = SELF_LEXER;
  lexer.run(readFileSync(SELF_LEXER, 'utf8'));
  const lexFn = lexer.globals.get('lex');
  let chars = 0;
  let toks = 0;
  lexer.steps = 0;
  let t0 = performance.now();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    chars += src.length;
    toks += (lexer.callFunction(lexFn, [src]) as any[]).length;
  }
  let dt = performance.now() - t0;
  console.log(
    `词法   ${files.length} 文件 / ${chars.toLocaleString()} 字符 → ${toks.toLocaleString()} token，` +
      `${dt.toFixed(0)} ms / ${lexer.steps.toLocaleString()} 步 → ${Math.round(lexer.steps / chars)} 步/字符，` +
      `${Math.round(chars / (dt / 1000)).toLocaleString()} 字符/秒`,
  );

  if (!existsSync(SELF_PARSER)) {
    console.log(`${SELF_PARSER} 不存在，S2 未开始。`);
    return 0;
  }

  const parser = bareInterpreter();
  parser.modulePath = SELF_PARSER;
  parser.run(readFileSync(SELF_PARSER, 'utf8'));
  const parseFn = parser.globals.get('parse');
  const shell = readFileSync('src/system/shell.osl', 'utf8');
  parser.steps = 0;
  t0 = performance.now();
  parser.callFunction(parseFn, [shell]);
  dt = performance.now() - t0;
  console.log(
    `解析   shell.osl ${shell.length.toLocaleString()} 字符 → ${dt.toFixed(0)} ms / ${parser.steps.toLocaleString()} 步`,
  );

  parser.steps = 0;
  t0 = performance.now();
  for (const f of files) parser.callFunction(parseFn, [readFileSync(f, 'utf8')]);
  dt = performance.now() - t0;
  const total = lexer.steps + parser.steps;
  console.log(
    `合计   全语料 词法 ${(lexer.steps / 1e6).toFixed(1)}M + 解析 ${(parser.steps / 1e6).toFixed(1)}M ` +
      `= ${(total / 1e6).toFixed(1)}M 步 ≈ ${(total / 450_000).toFixed(1)} s（按 450k 步/秒）`,
  );
  return 0;
}

const cmd = process.argv[2] || 'bench';
if (cmd === 'bench') cmdBench();
else if (cmd === 'frontend') process.exitCode = cmdFrontend();
else if (cmd === 'tokens' || cmd === 'ast') process.exitCode = compareCorpus(cmd);
else console.log(`未知子命令 '${cmd}'，可用：bench | frontend | tokens | ast`);
