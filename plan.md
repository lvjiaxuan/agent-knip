# agent-knip 实现计划

> 卸载了工具，目录还赖在用户目录里。agent-knip 把它找出来、量一下多大，然后收进隔离区——随时能放回去。

| 项 | 结论 |
| --- | --- |
| 包名 / 命令 | `agent-knip`（npm 上尚未占用，2026-10-30 查 registry 返回 404） |
| 基座 | [antfu/starter-ts](https://github.com/antfu/starter-ts)，遵循 [antfu/skills](https://github.com/antfu/skills) 的工程约定 |
| 运行时 | Node >= 22，纯 ESM，**0 运行时依赖** |
| 安全模型 | 默认只报告；"删除"等于移入隔离区；凭据永不处理 |
| 首个版本 | 0.1.0，Windows 优先验证，macOS / Linux 同步支持 |

---

## 1. 问题与边界

Agent CLI 装的时候很自觉，卸的时候不收拾：`~/.claude`、`~/.codex`、`~/.cursor` 会一直留着，里面往往还有几百 MB 的会话历史。用户的实际感受只有两种：磁盘莫名其妙少了空间，或者目录列表里一堆看不懂的点开头的文件夹。

agent-knip 做的是一件事：**判断哪些 agent 目录已经没有对应软件，把它们列出来，并提供可还原的清理**。

明确不做（non-goals，写进 README 防止期待错位）：

- 不做通用清理器，不扫全盘，不碰非登记路径
- 不删凭据，不删正在使用的 agent 的任何东西
- 不做定时任务、不做后台常驻、不联网、不收集遥测
- 0.1 不做"彻底擦除"，SSD 上的安全擦除本来就是伪命题

## 2. 命名说明

`knip` 是荷兰语"剪、修剪"，也是 antfu 工具链里 [knip](https://knip.dev)（找无用代码）的同一个隐喻：找出没人再用的东西，剪掉。用 `agent-knip` 有三层好处：

- 语义准确：修剪的是"没人用的 agent 残留"，不是"垃圾"
- 动作可逆：剪下来的枝条还能插回去，正好对应隔离区
- 与目标用户的技术语境重合：会敲 `npx` 的人多半见过 `knip`

必须处理的风险：和 `knip` 撞名。README 首屏要有一句 "Not related to knip, the unused-code finder"，否则会持续收到 "这是 knip 的插件吗" 的 issue。

## 3. 与 starter-ts 的对齐清单

模板本身是库，本项目是 CLI，差异只在入口和分发字段，其余全部照抄。

| 模板约定 | agent-knip 做法 |
| --- | --- |
| `tsdown` 打包，纯 ESM，`dts` + `exports` + `publint` | 保持一致 |
| `src/index.ts` 作为唯一入口 | 增加 `src/cli.ts` 作为 bin 入口，`index.ts` 仍导出可编程 API |
| `knip.json` 只管 `project: ["src/**/*.ts"]` | 追加 `entry: ["src/cli.ts"]`，否则 bin 入口会被判成未使用文件 |
| `test` 先 build 再 vitest | 保持一致 |
| `ci` = lint → typecheck → knip → test --run | 保持一致，pre-commit 全量跑 |
| ESLint 用 `antfu({ type: 'lib', pnpm: true, antislop: true })` | `type: 'cli'` 不存在，仍用 `'lib'`；其余保持一致 |
| `package.json` 无 `bin` | 新增 `bin`、`files`、`engines`、`repository`、`keywords` |
| 发布走 npm Trusted Publishing（OIDC） | 保持一致，首次手动 `pnpm publish` 建包 |

`index.ts` 导出 `scan` / `prune` / `restore` 三个函数，CLI 只负责参数解析与输出。这样测试不需要 spawn 子进程，CI 在三个平台上都稳。

## 4. 目录结构

```text
agent-knip/
├── .github/workflows/{ci,autofix,release}.yml
├── .vscode/{settings,extensions}.json
├── eslint.config.js
├── knip.json
├── package.json
├── pnpm-workspace.yaml        # catalogs，沿用模板
├── tsconfig.json
├── tsdown.config.ts
├── vitest.config.ts
├── README.md
├── plan.md
└── src/
    ├── cli.ts                 # bin：参数解析、命令分发、退出码
    ├── index.ts               # 公开 API：scan / prune / restore
    ├── types.ts               # 所有 interface 与 type
    ├── constants.ts           # 权重、保护窗口、隔离目录名、版本
    ├── agents.ts              # 内置登记表（纯数据）
    ├── scan.ts                # 编排：逐个 agent 收集证据并打分
    ├── detect/
    │   ├── binary.ts          # PATH 解析（不 spawn）
    │   ├── packages.ts        # npm / pnpm / pipx / brew 清单
    │   └── probe.ts           # --version 存活探测（超时、无 shell）
    ├── fs.ts                  # 目录尺寸、mtime、symlink/junction 判断
    ├── prune.ts               # 隔离 + manifest
    ├── restore.ts             # 从隔离区还原
    └── format.ts              # 人话表格 / JSON
```

测试文件与被测文件同目录（`fs.ts` → `fs.test.ts`），遵循 antfu/skills 的约定，而不是模板里的 `test/` 目录。

所有模块接收显式上下文 `Ctx`，不直接读 `process.env` / `os.homedir()`：

```ts
interface Ctx {
  home: string
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  now: number
}
```

测试靠注入 `Ctx` 构造临时 home，不 mock 全局对象，也不按平台跳过用例。

## 5. 数据模型

```ts
export type DirKind = 'config' | 'history' | 'cache' | 'credentials'
export type State = 'installed' | 'configured' | 'unknown'

export interface PathSpec {
  path: string // 相对 home，统一用 / 分隔
  type: 'dir' | 'file'
  kind: DirKind
}

export interface AgentSpec {
  id: string // 'claude'
  name: string // 'Claude Code'
  bins: string[] // ['claude']
  packages?: string[] // npm 包名，用于清单比对
  paths: PathSpec[]
}

export interface PathReport {
  path: string
  kind: DirKind
  bytes: number
  sizeComplete: boolean // 超时或权限不足时为 false
  modifiedAt: number
}

export interface AgentReport {
  agent: AgentSpec
  state: State
  score: number
  evidence: string[] // ['bin:/usr/local/bin/claude', 'npm:@anthropic-ai/claude-code']
  paths: PathReport[]
  bytes: number
  skips: string[] // ['credentials', 'recent', 'symlink']
}
```

`type: 'file'` 是必须的：`~/.claude.json`、`~/.aider.conf.yml` 都是文件而不是目录。

### 5.1 什么是"登记表"

`src/agents.ts` 是一张硬编码的数据表，一行就是一个 agent 的档案。工具**只认这张表**：它不会扫描 home 去猜哪个目录像 agent，所以表的覆盖面就是工具的能力边界，也是它敢做清理的前提。

范围要覆盖三层：agent 的命令名（查 PATH）、包名（查包管理器清单）、以及它在 home 下留下的路径。

```ts
export const agents: AgentSpec[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    bins: ['claude'],
    packages: ['@anthropic-ai/claude-code'],
    paths: [
      { path: '.claude', type: 'dir', kind: 'history' },
      { path: '.claude.json', type: 'file', kind: 'credentials' },
    ],
  },
]
```

`kind` 决定 `prune` 时怎么对待这个路径：`history` 可清理、`cache` 可清理、`config` 可清理、`credentials` 永不清理。

0.1 的初始表只放 6 个：**Claude Code、Codex CLI、Gemini CLI、Cursor、Aider、OpenCode**。选它们是因为最常见、路径最稳定、且都能在开发机上验证。每一条都必须先在 Windows 和 macOS 上 `ls` 确认再合并——猜的路径不收，错一条就多一个误删入口。

## 6. 探测算法

信号只有四种，全部是本地、同步、无网络的读操作：

| 信号 | 做法 | 权重 | 成本 |
| --- | --- | --- | --- |
| PATH 命中 | 遍历 `PATH` + `PATHEXT`，`stat` 出可执行文件 | 40 | < 5ms |
| 包管理器记录 | 读 `%APPDATA%\npm\node_modules`、`~/.local/pipx/venvs`、`brew --prefix` 目录 | 30 | < 10ms |
| 应用安装痕迹 | `%LOCALAPPDATA%\Programs\<name>`、`/Applications/<Name>.app` | 30 | < 5ms |
| 存活探测 | `execFile(bin, ['--version'])`，2s 超时 | 20 | 0–2000ms |

判定为三态，而不是布尔：

- `installed`：有任一强信号（PATH / 包记录 / 应用目录）→ 完全不动，只报告
- `unknown`：解析到了二进制但探测失败，或路径存在但无法读取 → 按已安装处理，只报告
- `configured`：只有目录残留，没有任何强信号 → 唯一允许清理的状态

**探测是条件触发的**：拿到 PATH 命中 + 包记录就不跑 `--version`。绝大多数情况下一个 agent 的检测成本在 10ms 内，整轮扫描目标 < 300ms（不含目录尺寸统计）。

平台差异全部收敛在 `detect/` 里：

- `win32`：`PATH` 按 `;` 切分，扩展名补 `.EXE/.CMD/.BAT`；`stat` 不 spawn，避免 `where.exe` 的进程开销和沙箱限制
- `darwin`：额外看 `/Applications` 与 `/opt/homebrew/bin`
- `linux`：额外看 `~/.local/bin`

`.cmd` / `.bat` 一律跳过存活探测（那需要经过 `cmd.exe`，等于引入 shell 和转义问题）。它们本来就是 npm 装的，包记录已经够了。

## 7. 安全规则（精简版）

只保留和常见用户场景强相关的六条，其余进 issue 清单。

1. **默认只读。** `agent-knip` 不带参数只打印报告，不写任何文件；真正执行要 `prune --yes`。所有场景都需要。
2. **只处理登记表里的路径。** 深度固定（`~/.x` 或 `~/.config/x`），不做"扫描所有点目录再猜"的发现式删除。这是防止误删非 agent 目录的底线。
3. **删除 = 移入隔离区。** 目标是 `~/.agent-knip/trash/<timestamp>/`，写 `manifest.json` 记录原路径，`restore` 一键还原。误删不可怕，找不到才可怕。
4. **凭据目录永不处理。** `kind: 'credentials'` 的文件（`auth.json`、`.credentials.json`、`.claude.json` 里的 token）只在报告里标 ⚠，`prune` 直接跳过。删凭据不会损坏数据，但会让用户重新走一遍登录，体验极差。
5. **7 天内有改动就跳过。** 覆盖"便携版装在 D 盘、其实还在用"和"刚装完还没用"两种误判。要强制清理时给 `--force-recent`。
6. **symlink / junction 只报告不动手。** Windows 上 `~/.claude` 完全可能是指向 OneDrive 的 junction，递归删除会连带清空云端。`lstat().isSymbolicLink()` 在 Windows 上同样对 junction 返回 true。

明确延后到 issue 的（0.2+）：

- 进程检查（`tasklist`）、云同步目录告警、WSL 内部探测
- 注册表卸载项、`winget list`、Chocolatey / Scoop
- 交互式逐项勾选、`--include-credentials`
- 中文输出 / i18n、无 Node 的单文件 exe
- macOS 的 `~/Library/Application Support` 深度解析

## 8. CLI 接口

```text
agent-knip                        # 等价于 scan
agent-knip scan  [-h] [--json] [--agent <id>]
agent-knip prune [-h] [--yes] [--agent <id>] [--force-recent]
agent-knip restore [-h] [--list] [--all]
agent-knip -h | --help            # 全局帮助
agent-knip -v | --version
```

`-h` / `--help` 的约定：

- 全局和每个子命令都支持，`agent-knip prune -h` 只讲 prune 的用法
- 帮助文本是**纯静态**的：不读 home、不扫描、不探测。所以 `agent-knip -h` 是唯一可以无脑敲、绝对安全的入口
- 首次使用引导放在帮助尾部：三行示例（体检 / 清理 / 还原），用户看完不用再翻文档
- 帮助里必须包含一句安全声明：`Nothing is deleted unless you run "prune --yes".`

输出示例（尺寸是钩子，⚠ 是护栏，分组是可信度）：

```text
  agent-knip · 4 agents, 1.25 GB

  Unused (2)                        only config left, safe to prune
  ~/.claude          412 MB   18d ago   Claude Code
    ├ projects/      380 MB   23 sessions
    └ .credentials     2 KB   ⚠ skipped (credentials)
  ~/.codex            38 MB   94d ago   Codex CLI

  Unknown (1)                       never cleaned, check it yourself
  ~/.gemini           11 MB    6d ago   Gemini CLI      bin found, --version failed

  In use (1)
  ~/.cursor          790 MB    3d ago   Cursor          installed → skipped

  450 MB can be reclaimed. Nothing has been changed.
  Run `agent-knip prune` to move them to ~/.agent-knip/trash.
```

三组排序固定为 `Unused` → `Unknown` → `In use`，每组内按体积降序。`Unknown` 必须单独成组并写明"不会清理"，否则用户会以为漏了。

约定：

- 输出语言固定英文：Windows 老控制台是 GBK 代码页，中文会乱码；`--lang` 留到 0.2
- `--json` 输出 `{ version, scannedAt, groups: { unused, unknown, inUse }, agents: AgentReport[] }`，`version` 是 schema 版本，方便脚本消费
- 退出码：`0` 正常、`1` 运行错误、`2` 有可清理项但未执行（便于 CI 判断，不影响交互使用）
- `parseArgs` 来自 `node:util`，不引 `cac`；颜色用 `node:util` 的 `styleText`，自动尊重 `NO_COLOR`
- 帮助文本手写，不生成：四个命令的说明加起来不到 40 行，比维护一个模板系统便宜

## 9. 隔离与恢复

```text
~/.agent-knip/
└── trash/
    └── 2026-10-30T08-40-12Z/
        ├── manifest.json
        └── claude/          # 原 ~/.claude 整体搬入
```

`manifest.json`：

```json
{
  "version": 1,
  "createdAt": 1793000000000,
  "items": [
    { "id": "claude", "from": "C:\\Users\\PC\\.claude", "to": "claude", "kind": "history", "bytes": 432000000 }
  ]
}
```

实现要点：

- 同一分区用 `fs.rename`（原子、瞬时）；跨分区退化为 copy + 校验 + 删除，并打印进度
- 目标已存在（用户手建过同名目录）→ 跳过并报告，不覆盖
- `restore` 时若原路径已被占用 → 拒绝并提示，不合并、不覆盖
- 隔离区超过 30 天的条目在 `scan` 时提示可以 `restore --list` 或手动删，但**不自动清理**（自动删隔离区等于自动删用户数据）

## 10. 测试计划

| 文件 | 覆盖点 |
| --- | --- |
| `detect/binary.test.ts` | 临时 PATH、`PATHEXT` 补全、`.cmd` 跳过探测、路径含空格 |
| `detect/packages.test.ts` | npm 全局目录解析、包名归一化（`@scope/name` → `name`） |
| `scan.test.ts` | 三态判定、条件探测（有包记录时不 spawn）、`Ctx` 注入 |
| `fs.test.ts` | 尺寸统计、超时降级为 `sizeComplete: false`、junction 识别 |
| `prune.test.ts` | 隔离往返、凭据跳过、7 天窗口、symlink 跳过、目标冲突 |
| `restore.test.ts` | 正常还原、目标被占用时拒绝、manifest 缺失时报错 |
| `format.test.ts` | 人类输出快照（顺序稳定、不含绝对路径以外的机器信息）、JSON schema |

额外要求：

- 每个测试用 `mkdtemp` 建独立 home，跑完删除；**永不触碰真实 `~`**
- 断言不依赖当前平台，平台通过 `Ctx.platform` 注入
- 加一条守护测试：`agents.ts` 里每个 `path` 必须形如 `.<name>` 或 `.config/<name>`，防止有人提交 `..` 或绝对路径

## 11. 里程碑

| 阶段 | 内容 | 完成标准 |
| --- | --- | --- |
| M0 骨架 | 从模板初始化、加 bin、`-h` / `--help` / `--version`（纯静态，不读磁盘）、CI 绿 | `nr ci` 通过，`npx . -h` 能跑 |
| M1 扫描 | 登记表 6–10 个 agent、三态、尺寸、表格与 JSON 输出 | 在真机 Windows 上跑出正确报告 |
| M2 隔离 | `prune` / `restore` / manifest / 六条规则 | 往返测试全绿，手工验证一次还原 |
| M3 发布 | README、徽章、0.1.0、OIDC 建包 | `npx agent-knip` 从 npm 可用 |

M0 的隐藏工作量在 `tsdown` 对 bin 的处理：入口加 `src/cli.ts` 后要确认 `dist/cli.mjs` 带 shebang 且可执行，`package.json` 的 `bin` 指向它。这一步在 Windows 上跑 `pnpm dlx` 验证一次即可。

## 12. README 方案

语言：正文中文（目标用户在国内），首屏英文一句话 tagline 保留检索价值。结构：

1. 标题 + tagline + 三个徽章（version / license / node）
2. `npx agent-knip` 的一行示例和截图式输出块——**先给结果，再讲原理**
3. "为什么会有这个工具"：三段，讲卸载残留、讲尺寸、讲可还原
4. "它怎么判断有没有装"：三态表 + 三组输出的关系 + 一句承认检测不可能 100% 准
5. "安全设计"：六条规则，每条一行
6. "还原"：`prune` 之后怎么回去
7. "支持范围 / 已知限制"：Windows 优先验证、便携版和 WSL 会判成 installed
8. "和 knip 没关系"：单独一句
9. "添加一个 agent"：指向 `src/agents.ts`，说明必须实机验证路径
10. License

写作约束：不用"强大""一键""智能"这类词；所有数字（体积、耗时）都来自实测；不承诺"彻底清除"。

## 13. 风险与已定决策

| 风险 | 应对 |
| --- | --- |
| 检测误判导致用户信任崩塌 | 三态 + 默认只读 + 隔离区，误判最多是"多留一个目录" |
| 与 `knip` 混淆 | README 显式区分；npm keywords 不蹭 `knip` 词条 |
| 包名被抢注（恶意仿冒） | 发布同时注册 `agent-knips`、`agent-knip-cli` 等常见变体 |
| 大目录扫描卡住 | 单 agent 5s 预算，超时降级为 `sizeComplete: false` 并照常报告 |
| Windows 权限拒绝 | 全部 `try/catch` 降级为 `unknown`，绝不请求管理员权限 |

已定决策（2026-10-30）：

| 问题 | 决定 |
| --- | --- |
| `unknown` 是否单独成组 | **单独成组**，排在 `Unused` 之后、`In use` 之前，标题旁写明"不会清理"，并给出原因（如 `bin found, --version failed`） |
| 隔离区位置 | **自建 `~/.agent-knip/trash`**，跨平台一致，`restore` 完全可控；不接系统回收站 |
| 是否需要 `--dry-run` | 不需要，默认就是只读 |
| 帮助命令 | `-h` / `--help` 全局与子命令都支持，纯静态输出，不碰磁盘 |

## 附录 A：package.json 草案

```json
{
  "name": "agent-knip",
  "type": "module",
  "version": "0.0.0",
  "description": "Find and trim leftover config directories of AI coding agents you no longer use",
  "bin": { "agent-knip": "./dist/cli.mjs" },
  "files": ["dist"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsdown",
    "dev": "tsx src/cli.ts",
    "lint": "eslint --cache",
    "typecheck": "tsc",
    "knip": "knip",
    "test": "pnpm run build && vitest",
    "ci": "pnpm run lint && pnpm run typecheck && pnpm run knip && pnpm run test --run"
  },
  "simple-git-hooks": {
    "pre-commit": "pnpm i --frozen-lockfile --ignore-scripts --offline && pnpm run ci && pnpx nano-staged"
  },
  "nano-staged": {
    "*.{js,ts,tsx,json,css,md,yaml}": "eslint --fix --no-warn-ignored"
  }
}
```

`dependencies` 为空，`devDependencies` 全部走 `catalog:cli` / `catalog:testing`。

## 附录 B：初始登记表（需实机验证）

只收录能被验证的条目。**每个路径在 Windows 与 macOS 上各 `ls` 一次再合并，未验证不写进 `agents.ts`。**

| id | name | bin | paths | 备注 |
| --- | --- | --- | --- | --- |
| claude | Claude Code | `claude` | `.claude` (history), `.claude.json` (config) | 注意 `.claude.json` 是文件 |
| codex | Codex CLI | `codex` | `.codex` (config+history) | 含 `auth.json`，需标 credentials |
| gemini | Gemini CLI | `gemini` | `.gemini` (config+history) | |
| cursor | Cursor | `cursor-agent` | `.cursor` (cache) | GUI 版还要看 `%LOCALAPPDATA%\Programs\cursor` |
| aider | Aider | `aider` | `.aider.chat.history.md` (history, file), `.aider.tags.cache.v*` (cache) | pipx 安装 |
| opencode | OpenCode | `opencode` | `.config/opencode`, `.local/share/opencode` | XDG 布局 |

验证清单（M1 开工前完成）：

- [ ] Windows：`ls ~` 确认每个目录/文件的真实名称与大小
- [ ] macOS：同上，补 `~/Library/Application Support` 位置
- [ ] pipx 安装的 agent 的包记录路径
- [ ] 每个 `kind` 归类是否成立（尤其 credentials 与 history 的边界）

## 附录 C：发布到 npm（OIDC + release CI）

走 npm Trusted Publishing，仓库里不放任何 `NPM_TOKEN`。仓库必须是 **public**，否则 provenance 生成失败。

### C1. 一次性准备

1. `package.json` 补齐 `repository` / `homepage` / `bugs` / `author` / `license` / `files` / `bin` / `engines`。npm 用 `repository` 校验发布来源，缺了会拒。
2. 本地首次发布，把包名占住（Trusted Publisher 需要包已存在才能配置）：

```bash
pnpm run build
pnpm publish --access public   # 触发 prepack，本地登录 + OTP
```

3. 打开 `https://www.npmjs.com/package/agent-knip/access` → Trusted publishing → GitHub Actions，填：
   - Organization or user：你的 GitHub 用户名
   - Repository：`agent-knip`
   - Workflow filename：`release.yml`（必须和文件名一致，不是路径）
   - Environment：留空，除非 GitHub 里建了同名 environment
4. 配好之后本地 `npm logout`，后续不再需要本地 token。

### C2. `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    uses: sxzz/workflows/.github/workflows/release.yml@main
    with:
      publish: true
    permissions:
      contents: write
      id-token: write
```

- `publish: true` 会执行 `pnpm -r publish --access public --no-git-checks`。`-r` 在 pnpm 里覆盖 workspace 的所有项目**包括根项目**，单包仓库同样适用。
- `build` 输入留空，让 `prepack: nr build` 负责构建，保证本地与 CI 走同一条构建路径（避免出现两个构建入口时间差）。
- `id-token: write` 是 OIDC 的开关，缺了就是 401。`contents: write` 给 changelogithub 建 release 用。

### C3. 平时怎么发版

```bash
nr ci          # 必须绿
nr release     # bumpp：选版本 → 改 package.json → commit → tag v0.1.1 → push
```

tag 推上去触发 `release.yml`，CI 构建 + OIDC 发布 + 自动生成 provenance 与 GitHub Release。**不要**再在本地 `npm publish` 一次，会撞版本。

### C4. 验证

```bash
npm view agent-knip version dist-tags repository
npx agent-knip@latest -h
```

npm 页面应出现 provenance 徽章（"Built and published from GitHub Actions"），点开能看到 commit 与 workflow。

### C5. 常见失败

| 现象 | 原因 |
| --- | --- |
| `401 Unauthorized` / `ENEEDAUTH` | job 缺 `id-token: write`，或 Trusted Publisher 里的 workflow 文件名与实际不一致 |
| `E422` 版本已存在 | 首次手工发布用了 `0.1.0`，之后又 tag 了 `v0.1.0`；bumpp 必须升到新版本 |
| provenance 生成失败 | 仓库是 private，或 `repository.url` 与 GitHub 仓库不匹配 |
| 发出去的包缺 `dist/` | `files` 漏了 `dist`，或 `prepack` 没跑；用 `npm pack --dry-run` 先看清单 |
| Actions 里 `pnpm: not found` | 没有 `packageManager` 字段，corepack 猜不到版本 |
