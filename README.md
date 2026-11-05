# agent-knip

> 扫描 AI 编程 agent 留下的数据；确认后移入可还原的隔离区，不会永久删除。

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

`agent-knip` 帮你检查常见 agent 的配置、历史和缓存目录。它不会判断你是否还在使用某个 agent；没有找到安装线索，也不代表 agent 已卸载。移动前请先检查报告和目标数据。

> npm 上的 `0.1.0` 仍是旧行为；以下命令需要 `0.2.0` 或更高版本。

## 快速开始

需要 Node.js 22 或更高版本。扫描只读，不会修改文件：

```bash
npx agent-knip scan
```

预览单个 agent 的可移动数据：

```bash
npx agent-knip prune --agent qoder
```

确认后移入隔离区：

```bash
npx agent-knip prune --agent qoder --yes
```

列出隔离区内容，或还原全部数据：

```bash
npx agent-knip restore --list
npx agent-knip restore --all
```

隔离数据保存在 `~/.agent-knip/trash`。还原遇到原位置同名文件或目录时会拒绝覆盖。

## 常用选项

- `--agent <id>`：筛选指定 agent；`prune` 必填且每次只能处理一个。可用 ID 见 `npx agent-knip --help`。
- `--explain`：查看检查依据和清理决定。
- `--json`：扫描结果以 JSON 输出，仅用于 `scan`。
- `--force-recent`：允许包含最近 7 天内修改过的路径，不会绕过其他保护规则。

查看完整帮助：

```bash
npx agent-knip --help
```

## 开发

```bash
pnpm install
pnpm run ci
```

## License

[MIT](./LICENSE.md)

[npm-version-src]: https://img.shields.io/npm/v/agent-knip?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmx.dev/package/agent-knip
[npm-downloads-src]: https://img.shields.io/npm/dm/agent-knip?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmx.dev/package/agent-knip
[license-src]: https://img.shields.io/github/license/lvjiaxuan/agent-knip.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/lvjiaxuan/agent-knip/blob/main/LICENSE.md
