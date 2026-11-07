# 系统源码链路 — 从 bundle 到 VFS

这个系统没有"安装目录"，也没有运行时 `fetch`。它自己的源码（shell、17 个应用、图标、
语言包、文档）在**构建时**被打成字符串常量，在**启动时**被写进虚拟文件系统，在
**运行时**优先从文件系统读取。

结果是：用户可以在文件管理器里打开正在跑的那份 `shell.osl`，改掉它，刷新一下，桌面
就变了。

配套文档：[bootstrap.md](bootstrap.md) 讲语言层的自举（用 OSL 写 OSL），本文讲系统层
的源码镜像与升级策略。两者共用同一套"可编辑真相"的前提，但改动互不重叠。

---

## 1. 四段链路

```
构建期  vite `?raw` ──► 字符串常量（进 bundle）
            │
启动期  Kernel.boot()
            ├─ seedSystemFiles()  写入 /usr/share/**、/etc/apps.json
            ├─ loadCatalogs()     /usr/share/i18n/*.json 覆盖内置词条
            └─ loadAppRegistry()  /etc/apps.json 覆盖内置元数据
            │
运行时  Kernel.open(app)
            ├─ 优先 vfs.read()    ← 用户看到并编辑的就是这份
            └─ 回退 bundle 常量    ← 文件被删掉时
```

### 1.1 构建期：内联

```ts
// src/core/kernel.ts:5-17
import shellOsl from '../system/shell.osl?raw';
import docOslZh from '../docs/osl.zh.md?raw';
```

- 17 个应用在 `src/apps/registry.ts:5-38` 成对导入 `.oml` / `.osl`，组成 `APPS`；
- 对话框与右键菜单在 `src/oml/overlay.ts:4-5`；
- 图标用批量 glob 内联，见 `src/ui/icons.ts:5-9`：

```ts
const modules = import.meta.glob('../assets/icons/*.svg', {
  query: '?raw', import: 'default', eager: true,
});
```

`src/env.d.ts` 声明了 `*.osl?raw` / `*.oml?raw` 的模块类型。**产物里没有一处
运行时网络请求**，所以 `base: './'` 就能部署到任意静态托管，离线可用。

### 1.2 启动期：镜像进 VFS

`Kernel.boot()` 的第一件事（`src/core/kernel.ts:236-294`）：

| 步骤 | 位置 | 产物 |
| --- | --- | --- |
| `seedSystemFiles()` | `kernel.ts:810-950` | `/usr/share/{os,apps,i18n,icons,applications,doc}`、`/etc/apps.json` |
| `loadCatalogs()` | `kernel.ts:984-1000` | `/usr/share/i18n/*.json` 浅合并到内置词条 |
| `loadAppRegistry()` | `kernel.ts:524-559` | `/etc/apps.json` 覆盖名称/图标/尺寸/隐藏 |

写入顺序：先建目录，再逐应用写 `.osl` / `.oml`（`kernel.ts:829-833`），然后元数据
（`app.json` 与 `/etc/apps.json` 只在缺失时创建，不覆盖用户编辑）、README、
shell 四件套（`kernel.ts:884-887`）、`lib/markdown.osl`、语言包、全部图标
（`kernel.ts:903-905`）、语言参考文档、模板应用 `hello`，最后 `manifest.save()`
并写 `/etc/apps-seed`。

VFS 本身是 `Map<path, FsNode>`（`src/core/fs.ts`）：**读同步**（OSL 是同步语言），
写进队列后 40 ms 批量刷进 IndexedDB（`fs.ts:168-194`），刷新页面文件还在。

### 1.3 运行时：VFS 优先

```ts
// 系统外壳 — kernel.ts:263-265
const shellOslSrc = this.vfs.exists('/usr/share/os/shell.osl')
  ? this.vfs.read('/usr/share/os/shell.osl') : shellOsl;

// 应用 — kernel.ts:414-426
const oslSrc = this.vfs.exists(oslPath) ? this.vfs.read(oslPath) : app.osl;
```

bundle 里的字符串只是**回退值**。模块加载同理：`interp.loader` 直接指向 VFS
（`kernel.ts:260`、`:396`），所以 `import "lib/x.osl"` 拿到的也是改过的版本。

两处例外同样遵循"文件优先"：

- **图标**：`setIconSource(name => resolveIcon(name))`（`kernel.ts:92`）把
  `iconSvg()` 的查找重定向到 `/usr/share/icons/<name>.svg`，带缓存，VFS 变更时
  失效（`kernel.ts:93-96`、`:509-522`）。
- **语言包**：`loadCatalogs()` 把 `/usr/share/i18n/*.json` 合并进内置目录，改完
  调 `i18n.reload()` 生效（`kernel.ts:999-1005`）。

### 1.4 改动生效方式

| 想改 | 文件 | 怎么生效 |
| --- | --- | --- |
| 桌面 / 任务栏 / 开始菜单 | `/usr/share/os/shell.oml`、`shell.osl` | 刷新页面 |
| 对话框与右键菜单 | `/usr/share/os/dialog.oml`、`menu.oml` | 刷新页面 |
| 单个应用 | `/usr/share/apps/<id>/<id>.{oml,osl}` | 关掉窗口重开 |
| Markdown 渲染 | `/usr/share/os/lib/markdown.osl` | 重开应用（模块有 per-interpreter 缓存，`interp.ts:235`） |
| 图标 | `/usr/share/icons/<name>.svg` | 刷新页面 |
| 语言包 | `/usr/share/i18n/*.json` | `i18n.reload()` 或刷新 |
| 语言参考 | `/usr/share/doc/*.md` | 重开 Language Docs |
| 应用注册表 | `/etc/apps.json` | `sys.reloadApps()` |

---

## 2. 覆盖判定

`SystemManifest`（`src/core/manifest.ts`）在 `/etc/system-manifest.json` 里记录每个
系统文件的 FNV-1a 哈希，用来区分"出厂原样"和"用户改过"。

`install(path, content, force)` 的四种结果：

| 现场 | 动作 | 返回 |
| --- | --- | --- |
| 文件不存在 | 写入 | `created` |
| 内容完全相同 | 只更新哈希 | `same` |
| 哈希等于记录值（没动过） | 用新 bundle 覆盖 | `updated` |
| 哈希不等于记录值（改过） | 保留 | `kept` |

`force = true` 时跳过第 4 行的判断，直接覆盖。`force` 的来源是 seed 标记
（`kernel.ts:811-815`）：

```ts
const marker = '/etc/apps-seed';
const version = '14';
const force = !(this.vfs.exists(marker) && this.vfs.read(marker).trim() === version);
```

---

## 3. 现状缺陷

这四条是已确认的问题，修改方案见 §4。

### 3.1 `force` 会在升级时冲掉用户改动

`manifest.ts:74` 的 `if (!force && !this.isPristine(path)) return 'kept'` 意味着
seed 版本号一变，**所有用户改过的系统文件一并被覆盖**。README 里"升级不冲掉你的修改"
只在两次发版之间成立。

### 3.2 seed 版本号是手写常量

`'14'` 靠人记得改。忘了 bump → 新 bundle 被旧副本遮蔽，症状是"我明明改了源码，
系统没变"，而代码里那句 `Re-check right before loading`（`kernel.ts:418`）正是在
弥补这个问题。

### 3.3 shell 挂载失败没有退路

`kernel.ts:281-291`：`mount()` 抛异常时直接 `return`，而 `installShortcuts()` 排在
其后——此时快捷键一个都没装，桌面半死，只能开 devtools 清 IndexedDB。

矛盾之处在于：OSL 顶层报错**不会**阻止 mount（`kernel.ts:266-271` 只是通知），所以
"逻辑改坏"和"结构改坏"的后果完全不对称，后者是致命的。

### 3.4 用户不知道自己跑的是哪一份

没有任何界面提示"这个文件已被修改"。用户改完 `shell.osl` 又希望回到出厂版本时，
只能靠记忆删文件。

---

## 4. 目标链路

原则一句话：**用户改动永远优先，覆盖只发生在"你从没动过"的文件上。**

### 4.1 去掉 `force`（P0）

```ts
// manifest.ts — 判定收敛为单一路径
if (exists) {
  const current = this.vfs.read(path);
  if (current === content) { this.hashes.set(path, contentHash(content)); return 'same'; }
  if (!this.isPristine(path)) return 'kept';
  this.vfs.write(path, content);
  this.hashes.set(path, contentHash(content));
  return 'updated';
}
```

唯一需要无差别覆盖的场景是**恢复出厂**，那条路径本来就清库重建（Settings → Storage
→ Reset），不需要 `force` 参数。`install()` 的签名相应简化为两参。

### 4.2 seed 标识从内容派生（P0）

```ts
// kernel.ts — 源码变了才需要一次强制对齐
const SEED = contentHash(
  [shellOsl, shellOml, dialogOml, menuOml, markdownOsl,
   ...APPS.flatMap(a => [a.osl, a.oml])].join('\0'),
).toString(36);
```

去掉 4.1 的 `force` 之后，这个值退化为**可观测标记**（"这一版 bundle 的指纹"），
不再决定是否覆盖；它仍有两个用途：日志里能看出用户跑的是哪一版、以及配合 4.3 的
安全模式判断"坏的是旧文件还是新代码"。

### 4.3 启动降级与安全模式（P0）

顺序调整为：`seedSystemFiles` → `installShortcuts` → 挂载 shell。

挂载分两轮，失败后用**全新的 Interpreter** 重试内置版本（复用已污染的 env 会叠加
副作用）：

```ts
const attempts = [vfsSources, { osl: shellOsl, oml: shellOml }];
for (const [i, src] of attempts.entries()) {
  try { bootShell(src); break; }
  catch (e) {
    if (i === 0) {
      this.log('error', 'shell 自定制失败，回退内置版本');
      localStorage.setItem('os.shell.safe', '1');   // 下次启动跳过 VFS 覆盖
    } else throw e;
  }
}
```

`os.shell.safe` 存在时，启动直接使用 bundle 版本并在通知里给出"修复后清除安全模式"
的入口。这样坏掉的文件不会让人永远进不去系统。

### 4.4 三态可见 + 对比（P1）

不合并，只呈现。编辑器打开系统文件时，用 `manifest.isPristine()` 给出状态：

| 状态 | 条件 | 界面 |
| --- | --- | --- |
| 出厂 | 哈希匹配 | 无提示 |
| 已修改 | 哈希不匹配 | 标题栏徽章"已修改" |
| 两边都变 | 不匹配且 bundle 也变了 | 徽章 + "查看差异" |

动作只有三个：**采用出厂版本**（`forget()` 后重写）、**保留我的**、**另存为 `.bak`**。
差异视图需要 base 副本：只对"被改过的系统文件"保留一份原样，落在
`/var/lib/os/base/<原路径>`，文本量很小。

### 4.5 性能（P1/P2）

| 项 | 位置 | 改法 |
| --- | --- | --- |
| OML 每次 mount 重新解析 | `oml/renderer.ts:62` | 按源码哈希 LRU 缓存 AST（32 条），AST 无状态可复用 |
| 一个文件变更就全窗口重绘 | `kernel.ts:93-102` | `scheduleRefresh` 跳过隐藏/最小化窗口，切回时补一帧 |
| boot 全量哈希 | `kernel.ts:810` | 约 120 个文件，量级可接受；若变慢再引入 mtime 短路 |

OSL 只可缓存 `parse`，顶层执行有副作用，不能缓存。这与
[bootstrap.md](bootstrap.md) §7 的"AST 快照按 `path + mtime`"是同一件事，可合并实施。

---

## 5. 为什么不自动合并

结论：**不做三路合并**，理由按权重排序。

1. **没有 base 版本。** 三路合并要 base/ours/theirs 三方，bundle 里只有当前版本。
   为一个九成用户碰不到的功能长期保留旧副本不划算。
2. **冲突概率低，处理成本高。** 本地编辑多是一行两行的试手，发版常整段重写
   （`shell.osl` 1406 行）。重叠时行级 diff 会碎成几十块，人工看比机器合并更快。
3. **缩进敏感语言上线级合并会产出坏文件。** 常见后果是 `INDENT`/`DEDENT` 错位，
   而 `shell.osl` 在启动路径上——合并算法越"聪明"，坏文件越难排查。
4. **`shell.osl` 坏了会自锁，可预测性比省事重要。** 冲突处理应该是"选择"，不是"融合"。

重新评估的条件只有两个：VFS 接云端多端同步，或出现第三方应用生态需要跟随升级。
两者都不成立时（单作者、单写者、无同步），直接导出 VFS 目录交给真实 git 更划算。

---

## 6. 实施清单

| 编号 | 内容 | 文件 | 风险 |
| --- | --- | --- | --- |
| P0-1 | 去掉 `force`，判定单一路径 | `manifest.ts:65-82` | 低，纯函数易测 |
| P0-2 | seed 标识内容派生 | `kernel.ts:810-816` | 低 |
| P0-3 | 快捷键前置 + 挂载双轮 + 安全模式 | `kernel.ts:236-294` | 中，改启动流程 |
| P1-1 | 三态徽章 + 对比 + base 副本 | `apps/editor`、`manifest.ts`、新增 `/var/lib/os/base` | 中 |
| P1-2 | OML AST LRU | `oml/renderer.ts:60-70` | 低 |
| P1-3 | 隐藏窗口不刷新 | `oml/renderer.ts`、`kernel.ts:93-102` | 低 |
| P2-1 | `tests/manifest.ts`：四态 + 冲突保留 | `tests/` | 低 |

### 验收

```bash
pnpm check     # tsc --noEmit + 语言验收（现有 12 项不受影响）
```

`SystemManifest` 不依赖 DOM，可直接用假 VFS 单测；建议新增 `tests/manifest.ts`
覆盖：缺失写入、相同跳过、pristine 升级、已修改保留、删除后重建。

人工回归三步：

1. 改 `/usr/share/os/shell.osl` 里一个标签 → 刷新 → 改动仍在（P0-1 生效）。
2. 改仓库里的 `src/system/shell.osl` 并提高构建号 → 启动 → 没动过的文件更新、
   改过的保留（P0-2 生效）。
3. 把 `/usr/share/os/shell.oml` 改成非法 XML → 刷新 → 应回退内置版本、弹出通知、
   `Ctrl + Alt + T` 仍可用（P0-3 生效）。

---

## 7. 明确不做

- **加密哈希或签名。** 没有安全模型，`crypto.subtle` 还是异步的，会把同步的 boot
  链路搞复杂。当前哈希只回答"和你给我的那份是否一致"，文档里不要写成"完整性保护"。
- **把样式表塞回 VFS。** 1.1.9 试过又撤了（`kernel.ts:906-908`），纯解释型系统用不到。
- **自动合并。** 见 §5。
- **在 L3 之前重做刷新模型。** 全量刷新是可预测性的来源，等闭包编译把 ×20 的税率
  降下来再谈。
