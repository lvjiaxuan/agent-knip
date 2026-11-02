# agent-knip

> Review AI agent data directories and local installation evidence before cleaning up.

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

Agent 卸载后，配置、缓存和会话目录可能继续留在磁盘上。agent-knip 列出登记过的目录、统计体积，并解释它查到了哪些安装证据。

**找不到安装证据，不等于软件已卸载。** 工具默认只读；只有已维护、当前平台已核验的条目，才可能成为清理候选。确认之后移入隔离区，不直接删除。

Not related to [knip](https://knip.dev), the unused-code finder.

## 使用

需要 Node.js >=22，零运行时依赖。

```bash
# 只报告
npx agent-knip

# 为什么检测到了 / 为什么没进入清理候选
npx agent-knip scan --agent zed --explain

# 查看候选和每条保留理由，不做移动
npx agent-knip prune --explain

# 用户确认后移动候选
npx agent-knip prune --yes

# 还原
npx agent-knip restore --list
npx agent-knip restore --all
```

> npm 已发布的 0.1.0 仍使用旧行为。本分支的方向 A 重构尚未发布；本地运行 `pnpm build`，然后用 `node dist/cli.mjs scan --explain` 验证。

## 报告含义

| 分组 | 实际含义 | 会进入清理候选吗 |
| --- | --- | --- |
| `No install found` | 已核验平台上，在已支持的检测位置没有找到安装证据；**不是卸载证明** | 只有通过所有路径保护规则的条目 |
| `Check yourself` | 检测失败、目录无法完整读取，或当前平台未经核验 | 不会 |
| `Install found` | 找到命令、包记录或已登记的安装目录；不声称进程正在运行 | 不会 |
| `Reference only` | 从 `skills` 导入的未经核验目录信息 | 永远不会，包括 `--force-recent` |

每个分组保留 `DIRECTORY / SIZE / MODIFIED / AGENT / RESULT` 表头。`MODIFIED` 是目录树的最新修改时间，不是最后使用时间。`candidate (confirm)` 只表示可以由用户确认移动，不代表可以放心删除。

`--explain` 会逐项输出：

- 路径解析到哪里、存在/缺失/不适用/读取失败；
- PATH 命中、固定 npm/pipx 位置的包记录、安装目录；
- 是否运行了无 shell 的 `--version` 探测，成功、失败还是跳过；
- 条目的来源、当前平台的清理支持状态、每条路径的保留理由；
- 尚未覆盖的检查：操作系统卸载注册表、运行进程、便携版/WSL 安装和 shell 历史。

缺失证据会写成 `not-found`，不会伪装成“确认未安装”。`--agent` 过滤报告，但不会绕过跨 agent 的共享/嵌套目录保护。没有数据路径但有安装证据时仍会报告；指定一个完全不存在的 agent 时，`--explain` 也会展示已执行的检查。

## 已核验范围

目前仅以下**路径映射在 Windows 上有实机观察记录**，开放受保护的清理候选：

- Claude Code
- Codex CLI
- Gemini CLI
- Zed

这不是“完整卸载检测已核验”的保证。Cursor、Aider、OpenCode 保留人工维护的检测信息，但未核验平台的清理始终禁用。macOS/Linux 目前报告、解释和还原可用，**不开放自动候选清理**，直到补齐该平台的实机核验。

其余 69 个 `skills` 导入条目统一为 reference。它们的目录只能说明“有这份数据”，不能证明 agent 安装/卸载，也不能凭 7 天未改动升级成清理候选。

## 安全边界

1. 默认只读；CLI 只有 `prune --yes` 才执行移动。
2. reference、未核验平台、检测出错、存在安装证据的条目都不能清理。
3. 7 天内目录树有修改则保留；`--force-recent` **只绕过时间窗口**，不能绕过以上限制。
4. 独立凭据文件不移动。若目录内存在已登记的凭据文件名（如 Codex 的 `auth.json`），跳过整个目录；不读取凭据内容。未知名称的凭据无法自动识别，用户仍须检查配置和会话内容。
5. symlink/junction、带链接的祖先目录、相对环境变量根路径、类型不符、跨 agent 共享/嵌套路径都不能清理。环境变量解析到相同路径时不会重复计量或移动。
6. 隔离区每批使用独占目录；**先持久化 manifest，再 rename**。目标冲突不覆盖；隔离区链接被拒绝。跨分区返回 `EXDEV` 并保留原目录，不退化为 copy + delete。
7. restore 验证 v1 manifest 和 payload 路径；损坏/穿越/链接被拒绝。原路径已占用时保留隔离项用于重试；未登记的隔离区文件绝不递归删除。隔离区没有自动过期删除。

这些是普通本地操作的保护措施，不是对恶意并发文件替换的原子安全保证。Node 的路径检查与 rename 之间仍有竞态窗口，不要在其他程序正修改同一目录时清理。

## JSON / API

```bash
node dist/cli.mjs scan --json --explain
```

`--json` 始终只输出 JSON；解释数据在每个 agent 的 `checks` 中，不混入人类文本。

当前报告 schema 为 **v2**，分组键为 `noInstallFound / checkYourself / installFound / reference`，并提供 `candidates`。`cleanupSupported` 和每条路径的阻止理由用于解释决策；`score` 只是信号权重和，**不是置信概率**。

编程接口仍保留 `installed / configured / unknown` 作为证据状态，不再把它们等同于“正在使用 / 已卸载”。AgentSpec 从 `paths + apps` 改为统一 `locations`，API 使用方需要同步迁移。隔离 manifest 仍是 **v1**，与报告版本分开，旧批次不依赖新登记表也可还原。

退出码：`0` 正常且无待确认候选，`1` 运行错误，`2` 存在待确认候选但没有执行移动。prune 预览、`--force-recent`、实际执行使用同一个候选规则。

## 开发和添加 agent

```bash
pnpm install
pnpm gen:agents
pnpm run ci
```

人工维护 `src/agents.ts`。一个 Location 必须说明相对路径、base、平台、data/install 角色、类型和数据种类；配置目录不能充当 install 证据。路径必须是相对的、不能逃逸指定根目录。

生成文件 `src/agents.generated.ts` 只能由 `scripts/sync-agents.mjs` 生成，并且始终标记为 reference。升级到 curated 时先在脚本排除该 id，再补平台位置和安装检测测试。只有附带平台实机核验记录后才添加 `verifiedPlatforms`；不要为了让测试通过给所有平台开权限。

当前读取已安装 `skills` bundle 中表数据的生成方式依赖上游构建布局，升级 `skills` 后须检查生成 diff。运行时不加载 `skills`、不联网、不读取 shell 历史。

下一阶段再补 Windows 卸载注册表/开始菜单等独立证据提供者；本轮不以添加更多弱证据来扩大“已核验”范围。

## License

[MIT](./LICENSE.md)

[npm-version-src]: https://img.shields.io/npm/v/agent-knip?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmx.dev/package/agent-knip
[npm-downloads-src]: https://img.shields.io/npm/dm/agent-knip?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmx.dev/package/agent-knip
[license-src]: https://img.shields.io/github/license/lvjiaxuan/agent-knip.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/lvjiaxuan/agent-knip/blob/main/LICENSE.md
