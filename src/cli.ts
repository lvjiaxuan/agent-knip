#!/usr/bin/env node
import type { AgentReport, Ctx, PruneResult } from './types'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { agents } from './agents'
import { STALE_TRASH_MS, VERSION } from './constants'
import { createContext } from './context'
import { formatJson, formatPath, formatReason, formatReport } from './format'
import { errorCode } from './fs'
import { pruneBlockReason } from './policy'
import { prune, trashRoot } from './prune'
import { listTrash, restore } from './restore'
import { scan } from './scan'

const COMMANDS = ['scan', 'prune', 'restore']
const FLAGS = [
  'json',
  'explain',
  'agent',
  'yes',
  'force-recent',
  'list',
  'all',
]
const AGENT_IDS = agents.map(agent => agent.id).join(', ')

const HELP = `agent-knip ${VERSION}：查找 agent 遗留数据，经确认后移入可还原的隔离区

用法：
  agent-knip                  等同于 "agent-knip scan"
  agent-knip scan             扫描并报告遗留数据（只读）
  agent-knip prune --agent <id> 预览单个工具，加 --yes 后移入隔离区
  agent-knip restore          列出隔离区，加 --all 后全部还原

命令：
  scan [-h] [--json] [--explain] [--agent <id>]
  prune [-h] --agent <id> [--yes] [--force-recent] [--explain]
  restore [-h] [--list] [--all]

选项：
  -h, --help       显示帮助（所有命令均支持）
  -v, --version    显示版本
  --json           输出 JSON 报告，结构版本为 v4（仅 scan）
  --explain        显示检测依据、覆盖范围和清理决定
  --agent <id>     scan 筛选结果；prune 必填且仅处理一个 agent：${AGENT_IDS}
  --yes            确认 prune 将符合条件的路径移入隔离区
  --force-recent   包含最近 7 天内修改过的路径
  --list           列出隔离区条目（restore）
  --all            还原隔离区全部条目（restore）

安全说明：
  默认只读；只有 "prune --agent <id> --yes" 才会移动数据，不会永久删除数据。
  数据移入 ~/.agent-knip/trash，可用 "restore --all" 还原。
  清理必须指定单个 agent；只有通过路径安全检查的路径才能移动。
  没有找到安装依据，不代表已经卸载。
  含已知凭据的路径会保留；链接只移动入口，不触碰目标数据。

示例：
  npx agent-knip              # 查看遗留数据
  npx agent-knip prune --agent qoder --yes  # 将 Qoder 数据移入隔离区
  npx agent-knip restore --all # 全部还原
`

const SCAN_HELP = `agent-knip scan：扫描遗留数据，不修改文件

用法：agent-knip scan [选项]

选项：
  --json         输出 JSON 报告，结构版本为 v4
  --explain      显示检测依据和清理决定
  --agent <id>   仅显示指定 agent：${AGENT_IDS}
  -h, --help     显示帮助

退出码：0 没有符合条件的路径；1 出错；2 找到符合条件的路径（未修改文件）
`

const PRUNE_HELP = `agent-knip prune：预览或将符合条件的遗留数据移入隔离区

用法：agent-knip prune --agent <id> [选项]

选项：
  --yes          确认移动数据（未指定时仅预览）
  --agent <id>   必填；仅处理一个 agent：${AGENT_IDS}
  --force-recent 仅忽略修改时间限制，不绕过安装证据或路径安全保护
  --explain      显示检测依据和清理决定
  -h, --help     显示帮助

保留原位的路径会说明原因。数据不会永久删除；可用
"agent-knip restore --all" 还原。
`

const RESTORE_HELP = `agent-knip restore：将隔离区数据还原到原位置

用法：agent-knip restore [选项]

选项：
  --list         列出隔离区条目（默认行为）
  --all          还原全部条目
  -h, --help     显示帮助

原位置已有文件或目录时会拒绝还原，不会合并或覆盖。
`

const HELP_BY_COMMAND: Record<string, string> = {
  scan: SCAN_HELP,
  prune: PRUNE_HELP,
  restore: RESTORE_HELP,
}

const ALLOWED_FLAGS: Record<string, string[]> = {
  scan: ['json', 'agent', 'explain'],
  prune: [
    'yes',
    'agent',
    'force-recent',
    'explain',
  ],
  restore: ['list', 'all'],
}

export async function main(argv: string[], context?: Ctx): Promise<number> {
  if (argv[0] === '-h' || argv[0] === '--help') {
    out(HELP)
    return 0
  }
  if (argv[0] === '-v' || argv[0] === '--version') {
    out(`agent-knip/${VERSION}`)
    return 0
  }

  const { command, args, code } = splitCommand(argv)
  if (code !== undefined) {
    return code
  }

  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      tokens: true,
      options: {
        'help': { type: 'boolean', short: 'h' },
        'json': { type: 'boolean' },
        'explain': { type: 'boolean' },
        'agent': { type: 'string' },
        'yes': { type: 'boolean' },
        'force-recent': { type: 'boolean' },
        'list': { type: 'boolean' },
        'all': { type: 'boolean' },
      },
    })
  }
  catch (error) {
    err(formatArgumentError(error))
    err(HELP)
    return 1
  }
  const values = parsed.values

  if (values.help) {
    out(HELP_BY_COMMAND[command])
    return 0
  }

  const invalidFlag = findInvalidFlag(command, values as Record<string, unknown>)
  if (invalidFlag) {
    err(invalidFlag)
    return 1
  }

  if (command === 'prune' && parsed.tokens.filter(token => token.kind === 'option' && token.name === 'agent').length > 1) {
    err('prune 每次只能指定一个 --agent，不支持批量清理。')
    return 1
  }
  if (values.agent !== undefined && !agents.some(agent => agent.id === values.agent)) {
    err(`未知 agent："${values.agent}"。可选 agent：${AGENT_IDS}。`)
    return 1
  }
  if (command === 'prune' && !values.agent) {
    err('prune 必须指定一个 agent，例如：prune --agent qoder')
    return 1
  }

  const ctx = context ?? createContext()
  const color = Boolean(process.stdout.isTTY)

  if (command === 'scan') {
    return runScan(ctx, values.agent, values.json, color, values.explain)
  }
  if (command === 'prune') {
    return runPrune(ctx, values.agent!, values.yes, values['force-recent'], color, values.explain)
  }
  return runRestore(ctx, values.all)
}

function formatArgumentError(error: unknown): string {
  const code = errorCode(error)
  const message = error instanceof Error
    ? error.message
    : ''
  const token = message.match(/'([^']*)'/)?.[1] ?? ''
  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    return `未知选项：${token}`
  }
  if (code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') {
    return `不接受位置参数：${token}`
  }
  if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    if (message.includes('does not take an argument')) {
      return `选项 ${token} 不接受参数值。`
    }
    if (message.includes('ambiguous')) {
      return `选项 ${token} 缺少明确的参数值；以短横线开头的值请使用 ${token}=<值>。`
    }
    return `选项 ${token.replace(' <value>', '')} 缺少参数值。`
  }
  return `参数错误：${code}`
}

function splitCommand(argv: string[]): { command: string, args: string[], code?: number } {
  const args = [...argv]
  let command = 'scan'
  if (args[0] && !args[0].startsWith('-')) {
    command = args.shift()!
  }
  if (!COMMANDS.includes(command)) {
    err(`未知命令："${command}"。请运行 "agent-knip -h" 查看帮助。`)
    return { command, args, code: 1 }
  }
  return { command, args }
}

function findInvalidFlag(command: string, values: Record<string, unknown>): string | undefined {
  for (const flag of FLAGS) {
    if (values[flag] !== undefined && !ALLOWED_FLAGS[command].includes(flag)) {
      return `命令 "${command}" 不支持选项 --${flag}。`
    }
  }
}

async function runScan(ctx: Ctx, agent: string | undefined, json: boolean | undefined, color: boolean, explain?: boolean): Promise<number> {
  const reports = await scan(ctx, { agent })

  if (json) {
    out(formatJson(reports, ctx.now))
  }
  else {
    process.stdout.write(formatReport(reports, { now: ctx.now, color, explain }))
    await warnStaleTrash(ctx)
  }

  return hasReclaimable(reports, ctx.now)
    ? 2
    : 0
}

async function warnStaleTrash(ctx: Ctx): Promise<void> {
  const stale = (await listTrash(ctx))
    .filter(entry => entry.createdAt > 0 && ctx.now - entry.createdAt > STALE_TRASH_MS)
  if (stale.length === 0) {
    return
  }
  out(`  隔离区中有 ${stale.length} 批数据已超过 30 天。可运行 \`agent-knip restore --list\` 查看。`)
}

async function runPrune(
  ctx: Ctx,
  agent: string,
  yes: boolean | undefined,
  forceRecent: boolean | undefined,
  color: boolean,
  explain?: boolean,
): Promise<number> {
  if (!yes) {
    return previewPrune(ctx, agent, color, forceRecent, explain)
  }
  if (explain) {
    const reports = await scan(ctx, { agent })
    process.stdout.write(formatReport(reports, {
      now: ctx.now,
      color,
      explain,
      forceRecent,
    }))
  }
  const result = await prune(ctx, { agent, forceRecent })
  printPruneResult(result, ctx)
  return result.skipped.some(skip => skip.reason.startsWith('移动失败：'))
    ? 1
    : 0
}

async function previewPrune(ctx: Ctx, agent: string, color: boolean, forceRecent?: boolean, explain?: boolean): Promise<number> {
  const reports = await scan(ctx, { agent })
  process.stdout.write(formatReport(reports, {
    now: ctx.now,
    color,
    explain,
    forceRecent,
  }))
  if (!hasReclaimable(reports, ctx.now, forceRecent)) {
    return 0
  }
  out(`  仅预览，未移动文件。运行 \`agent-knip prune --agent ${agent} --yes${forceRecent ? ' --force-recent' : ''}\` 可将上述路径移入隔离区。`)
  return 2
}

function printPruneResult(result: PruneResult, ctx: Ctx): void {
  if (result.moved.length === 0) {
    out('  没有路径可移入隔离区。')
  }
  else {
    out(`  已将 ${result.moved.length} 个路径移入隔离区：${tildify(result.trashDir!, ctx.home)}`)
    for (const item of result.moved) {
      out(`    ${tildify(item.from, ctx.home)}`)
    }
    out('')
    out('  可运行 `agent-knip restore --all` 还原。')
  }

  if (result.skipped.length === 0) {
    return
  }
  out('')
  out('  已跳过：')
  for (const skip of result.skipped) {
    out(`    ${formatPath(skip).padEnd(24)} ${formatReason(skip.reason)}`)
  }
}

async function runRestore(ctx: Ctx, all: boolean | undefined): Promise<number> {
  if (!all) {
    return listRestore(ctx)
  }

  const result = await restore(ctx)

  if (result.restored.length > 0) {
    out(`  已还原 ${result.restored.length} 个路径：`)
    for (const item of result.restored) {
      out(`    ${tildify(item.from, ctx.home)}`)
    }
  }
  else if (result.failed.length === 0) {
    out('  隔离区为空。')
  }

  if (result.failed.length === 0) {
    return 0
  }
  out('')
  out('  未还原：')
  for (const failure of result.failed) {
    out(`    ${tildify(failure.path, ctx.home)}   ${formatReason(failure.reason)}`)
  }
  return 1
}

async function listRestore(ctx: Ctx): Promise<number> {
  const entries = await listTrash(ctx)
  if (entries.length === 0) {
    out('  隔离区为空。')
    return 0
  }

  out(`  隔离区：${tildify(trashRoot(ctx), ctx.home)}`)
  for (const entry of entries) {
    const stamp = entry.dir.split(/[\\/]/).pop()!
    if (entry.error) {
      out(`  ${stamp}   ⚠ ${formatReason(entry.error)}`)
      continue
    }
    out(`  ${stamp}   ${entry.items.length} 个条目`)
    for (const item of entry.items) {
      out(`    ${tildify(item.from, ctx.home)}`)
    }
  }
  out('')
  out('  可运行 `agent-knip restore --all` 全部还原。')
  return 0
}

function hasReclaimable(reports: AgentReport[], now: number, forceRecent = false): boolean {
  return reports.some(report =>
    report.paths.some(path => !pruneBlockReason(report, path, now, forceRecent)),
  )
}

function tildify(path: string, home: string): string {
  if (path === home) {
    return '~'
  }
  if (!path.startsWith(home)) {
    return path
  }
  return `~${path.slice(home.length).replace(/\\/g, '/')}`
}

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

function err(line: string): void {
  process.stderr.write(`${line}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  }
  catch (error) {
    err(`操作失败：${errorCode(error)}`)
    process.exitCode = 1
  }
}
