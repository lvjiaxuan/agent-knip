# agent-knip

> Trim the config directories left behind by AI agents you no longer use.

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

卸载了 Claude Code、Codex、Cursor，`~/.claude`、`~/.codex`、`~/.cursor` 还在。它们不会自己消失，往往带着几百 MB 的会话记录，安静地躺在用户目录里。

agent-knip 找出这些已经没有对应软件的目录，量出体积，然后移进隔离区。**默认什么都不删**，确认之后也只是移动，`restore` 一条命令就能放回去。

## 用法

```bash
# 只体检，不改任何文件
npx agent-knip

# 看完报告，确认后收进隔离区
npx agent-knip prune --yes

# 反悔了
npx agent-knip restore --all

# 忘了怎么用
npx agent-knip -h
```

需要 Node.js 22 或更高版本，没有运行时依赖。

典型输出，结果按可信度分成三组：

```text
  agent-knip · 4 agents, 1.25 GB

  Unused (2)                      only config left, safe to prune
  ~/.claude          412 MB    18d ago    Claude Code
  ~/.claude.json     514 B    18d ago    Claude Code     ⚠ credentials, skipped
  ~/.codex            38 MB    94d ago    Codex CLI

  Unknown (1)                     never cleaned, check it yourself
  ~/.gemini           11 MB     6d ago    Gemini CLI      bin found, --version failed

  In use (1)
  ~/.cursor          790 MB     3d ago    Cursor

  450 MB can be reclaimed. Nothing has been changed.
  Run `agent-knip prune` to move them to ~/.agent-knip/trash.
```

需要给脚本用时加 `--json`，输出带 schema 版本的稳定结构。

## 它怎么判断"已经没装了"

只看三类本地证据，不联网：

| 证据 | 说明 |
| --- | --- |
| 可执行文件 | `PATH` 里能不能找到这个 agent 的命令 |
| 安装记录 | npm 全局目录、pipx、Homebrew、应用安装目录 |
| 配置目录 | `~/.claude` 这类目录本身 |

三者组合出三种状态，而不是一个布尔值：

| 状态 | 含义 | 会被清理吗 |
| --- | --- | --- |
| `installed` | 至少有一个强证据 | 不会，只报告 |
| `unknown` | 有二进制但跑不起来，或目录读不了 | 不会，只报告 |
| `configured` | 只剩目录，找不到任何软件痕迹 | 会，且需显式确认 |

这套判断不可能 100% 准确：便携版、WSL 里装的、dotfiles 同步过来的配置，都可能被误判成"没装"。所以判断结果只决定"要不要在报告里提醒你"，绝不直接决定删除。报告里 `Unknown` 单独成组，就是为了让拿不准的东西自己说话：它永远不会被清理。

## 安全设计

1. 默认只读。不带子命令就只打印报告，不写任何文件。
2. 只处理登记表里的路径。不扫全盘，不做猜测式删除。
3. 删除等于移动。目标 `~/.agent-knip/trash/`，附带 `manifest.json`，随时可还原。
4. 凭据文件不动手。`~/.claude.json` 这类独立凭据只标记、不移动；如果凭据位于被清理目录内部（例如 `~/.codex/auth.json`），它会随整个目录进入隔离区，仍然可以 `restore` 回来。
5. 7 天内有改动就跳过。正在使用的目录不会被动。
6. symlink / junction 只报告不动手。指向 OneDrive 的目录不会被递归删除。

## 还原

```bash
npx agent-knip restore --list   # 看看隔离区里有什么
npx agent-knip restore --all    # 全部放回原位
```

原路径如果已经被占用，`restore` 会拒绝执行并告诉你冲突在哪，不会覆盖、不会合并。

## 已知限制

- 检测基于本地痕迹，便携版、WSL 内安装、多机同步的配置会被判成 `installed`（偏保守，不会误删）
- 隔离区不会自动清理，需要你手动删 `~/.agent-knip`
- 0.1 的 agent 登记表只覆盖常见几个，其余靠 PR 补充
- SSD 上没有"彻底擦除"这回事，本工具也不假装提供

## 和 knip 的关系

没有关系。[knip](https://knip.dev) 找的是代码里没人引用的文件；agent-knip 找的是硬盘上没人使用的 agent 目录。`knip` 在荷兰语里是"修剪"的意思，这里借的是同一个意象。

## 添加一个 agent

在 `src/agents.ts` 里加一条记录，跑 `pnpm test`。收录标准只有一条：**路径在 Windows 和 macOS 上实机确认过**，猜的不收。

## License

[MIT](./LICENSE.md) License

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/agent-knip?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmx.dev/package/agent-knip
[npm-downloads-src]: https://img.shields.io/npm/dm/agent-knip?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmx.dev/package/agent-knip
[license-src]: https://img.shields.io/github/license/lvjiaxuan/agent-knip.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/lvjiaxuan/agent-knip/blob/main/LICENSE
