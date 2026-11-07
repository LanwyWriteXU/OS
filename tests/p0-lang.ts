/**
 * S0 验收：P0 三项语言改造（throw / 构造参数与中断 / 列号）+ 全语料解析回归。
 *
 * 运行：
 *   ./node_modules/.bin/esbuild tests/p0-lang.ts --bundle --platform=node \
 *     --format=cjs --outfile=.tmp/p0-lang.cjs
 *   node .tmp/p0-lang.cjs
 *
 * 失败时进程退出码为 1，可以直接接进 CI。
 */
import { Interpreter, NativeFunction, OslErrorValue } from '../src/osl/interp';
import { lex, OslSyntaxError } from '../src/osl/lexer';
import { parseProgram } from '../src/osl/parser';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
};

function mk(opts: any = {}) {
  const i = new Interpreter({}, opts);
  const out: string[] = [];
  i.define('print', new NativeFunction('print', (...a: any[]) => out.push(a.map((x) => i.toStr(x)).join(' '))));
  i.define('len', new NativeFunction('len', (v: any) => (typeof v === 'string' ? v.length : v?.length ?? v?.size ?? 0)));
  i.define('str', new NativeFunction('str', (v: any) => i.toStr(v)));
  for (const t of ['Error', 'TypeError', 'ValueError', 'RangeError']) {
    i.define(t, new NativeFunction(t, (m: any = '') => new OslErrorValue(t, String(m))));
  }
  return { i, out };
}

const LOOP = `let n = 0
while True:
    n += 1`;

// 1. throw 带 payload
{
  const { i, out } = mk();
  i.run(`try:
    throw {"kind": "ret", "v": 42}
except e:
    print(e.kind)
    print(e.v)`);
  ok('throw 携带 dict 原样到达 except', out.join(',') === 'ret,42', out.join(','));
}

// 2. 跨函数非局部跳转
{
  const { i, out } = mk();
  i.run(`fn deep(n):
    if n == 0:
        throw {"ctl": "ret", "v": "done"}
    deep(n - 1)
    print("unreachable" + str(n))

fn run():
    try:
        deep(3)
    except e:
        return e.v
    return "no"

print(run())`);
  ok('throw 穿透 3 层调用回到 catch', out.join(',') === 'done', out.join(','));
}

// 3. finally 仍然执行
{
  const { i, out } = mk();
  i.run(`try:
    try:
        throw 1
    finally:
        print("finally")
except e:
    print("caught " + str(e))`);
  ok('throw 时 finally 仍执行', out.join(',') === 'finally,caught 1', out.join(','));
}

// 4. raise 行为不变
{
  const { i, out } = mk();
  i.run(`try:
    raise ValueError("empty")
except e:
    print(e.type)
    print(e.message)
    print("s:" + e)`);
  ok('raise 仍产出错误对象', out.join(',') === 'ValueError,empty,s:empty', out.join(','));
}

// 5. 未捕获的 throw 变成可读错误
{
  const { i } = mk();
  let msg = '';
  try {
    i.run(`throw {"a": 1}`);
  } catch (e: any) {
    msg = String(e.message ?? e);
  }
  ok('未捕获 throw 报可读错误', msg.startsWith('未捕获的 throw'), msg.split(' (line')[0]);
}

// 6. onTick + requestCancel
{
  let ticks = 0;
  const { i } = mk({
    tickEvery: 1000,
    onTick: () => {
      ticks++;
      if (ticks === 3) i.requestCancel();
    },
  });
  let msg = '';
  const t0 = performance.now();
  try {
    i.run(LOOP);
  } catch (e: any) {
    msg = String(e.message);
  }
  ok('requestCancel 中断死循环', msg.includes('执行已取消'), `${(performance.now() - t0).toFixed(0)} ms, ticks=${ticks}`);
}

// 7. 构造参数
{
  const { i } = mk({ maxSteps: 5000 });
  let msg = '';
  try {
    i.run(LOOP);
  } catch (e: any) {
    msg = String(e.message);
  }
  ok('构造参数 maxSteps 生效', msg.includes('Execution limit'), msg.split('\n')[0]);

  const { i: i2 } = mk({ maxDepth: 60 });
  let msg2 = '';
  try {
    i2.run(`fn down(n):
    if n <= 0:
        return 0
    return down(n - 1)
print(down(200))`);
  } catch (e: any) {
    msg2 = String(e.message);
  }
  ok('构造参数 maxDepth 生效', msg2.includes('Maximum recursion depth (60)'), msg2.split('\n')[0]);
}

// 8. 列号
{
  const toks = lex(`let a = 1
if a:
    let bb = [1,
        2]`);
  const bb = toks.find((t) => t.v === 'bb');
  const two = toks.find((t) => t.v === 2);
  const ind = toks.find((t) => t.t === 'INDENT');
  ok('token 列号正确', bb?.col === 9 && two?.col === 9, `bb.col=${bb?.col} two.col=${two?.col}`);
  ok('INDENT 列号指向首个 token', ind?.col === 5, `INDENT.col=${ind?.col}`);

  let msg = '';
  try {
    parseProgram('let x = 1 +\n');
  } catch (e: any) {
    msg = e instanceof OslSyntaxError ? e.message : String(e);
  }
  ok('语法错误带列号', /col \d+/.test(msg), msg);
}

// 9. 全语料回归
{
  // 直接遍历目录：未提交的新 .osl 也要纳入回归
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.osl')) files.push(p);
    }
  };
  walk('src');
  let lines = 0, chars = 0, toks = 0, nodes = 0, bad = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    try {
      const tk = lex(src);
      const ast = parseProgram(src);
      let n = 0;
      const walk = (v: any) => {
        if (!v || typeof v !== 'object') return;
        if (Array.isArray(v)) return v.forEach(walk);
        if (typeof v.type === 'string') n++;
        for (const k of Object.keys(v)) if (k !== 'type') walk(v[k]);
      };
      walk(ast);
      lines += src.split('\n').length;
      chars += src.length;
      toks += tk.length;
      nodes += n;
    } catch (e: any) {
      bad++;
      console.log(`   ${f}: ${e.message}`);
    }
  }
  // 语料总数只做数量级守卫：精确的逐字段校验在 `devkit ast`，这里只确认
  // "所有 .osl 仍然可解析、规模没有塌掉"
  ok(
    '全部 .osl 可解析',
    bad === 0 && lines > 5000 && nodes > 15000,
    `${files.length} 文件 / ${lines} 行 / ${chars} 字符 / ${toks} token / ${nodes} 节点`,
  );
  void chars;
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exitCode = fails ? 1 : 0;
