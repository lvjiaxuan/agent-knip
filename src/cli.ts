#!/usr/bin/env node
import type { AgentReport, Ctx, PruneResult } from './types'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { agents } from './agents'
import { STALE_TRASH_MS, VERSION } from './constants'
import { createContext } from './context'
import { formatBytes, formatJson, formatPath, formatReport } from './format'
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

const HELP = `agent-knip ${VERSION}: review agent data and local installation evidence

Usage:
  agent-knip                  Same as "agent-knip scan"
  agent-knip scan             Report leftovers (read-only)
  agent-knip prune            Move verified cleanup candidates (needs --yes)
  agent-knip restore          List the trash, or put everything back with --all

Commands:
  scan [-h] [--json] [--explain] [--agent <id>]
  prune [-h] [--yes] [--agent <id>] [--force-recent] [--explain]
  restore [-h] [--list] [--all]

Options:
  -h, --help       Show help (available on every command)
  -v, --version    Show version
  --json           JSON report schema v2 (scan only)
  --explain        Show checked evidence, coverage limits and cleanup decisions
  --agent <id>     Limit to one agent: ${AGENT_IDS}
  --yes            Required for prune to move anything
  --force-recent   Also prune paths changed in the last 7 days
  --list           List the trash (restore)
  --all            Put every trash entry back (restore)

Safety:
  Nothing is deleted unless you run "prune --yes".
  Moves go to ~/.agent-knip/trash and "restore --all" puts them back.
  Reference-only and unverified-platform entries are never moved.
  Missing install evidence is not proof of uninstallation.
  Known credential containers and symlinks are skipped.

Examples:
  npx agent-knip              # see what is left over
  npx agent-knip prune --yes  # move it to the trash
  npx agent-knip restore --all
`

const SCAN_HELP = `agent-knip scan: report leftovers, change nothing

Usage: agent-knip scan [options]

Options:
  --json         JSON report schema v2
  --explain      Show evidence and cleanup decisions
  --agent <id>   Only this agent: ${AGENT_IDS}
  -h, --help     Show this help

Exit codes: 0 nothing to prune, 1 error, 2 leftovers found (nothing changed)
`

const PRUNE_HELP = `agent-knip prune: move verified cleanup candidates into the trash

Usage: agent-knip prune [options]

Options:
  --yes          Actually move anything (without it, this is a dry run)
  --agent <id>   Only this agent: ${AGENT_IDS}
  --force-recent Ignore age only; never bypass reference/platform/install guards
  --explain      Show evidence and cleanup decisions
  -h, --help     Show this help

Skipped on purpose: credentials, symlinks/junctions, unreadable paths and
anything whose agent still looks installed. Nothing is deleted; undo with
"agent-knip restore --all".
`

const RESTORE_HELP = `agent-knip restore: put pruned paths back where they came from

Usage: agent-knip restore [options]

Options:
  --list         List trash entries (default when nothing else is given)
  --all          Put everything back
  -h, --help     Show this help

An occupied target path is refused, never merged or overwritten.
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
    err(error instanceof Error
      ? error.message
      : String(error))
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

  if (values.agent && !agents.some(agent => agent.id === values.agent)) {
    err(`Unknown agent "${values.agent}". Known agents: ${AGENT_IDS}.`)
    return 1
  }

  const ctx = context ?? createContext()
  const color = Boolean(process.stdout.isTTY)

  if (command === 'scan') {
    return runScan(ctx, values.agent, values.json, color, values.explain)
  }
  if (command === 'prune') {
    return runPrune(ctx, values.agent, values.yes, values['force-recent'], color, values.explain)
  }
  return runRestore(ctx, values.all)
}

function splitCommand(argv: string[]): { command: string, args: string[], code?: number } {
  const args = [...argv]
  let command = 'scan'
  if (args[0] && !args[0].startsWith('-')) {
    command = args.shift()!
  }
  if (!COMMANDS.includes(command)) {
    err(`Unknown command "${command}". Try "agent-knip -h".`)
    return { command, args, code: 1 }
  }
  return { command, args }
}

function findInvalidFlag(command: string, values: Record<string, unknown>): string | undefined {
  for (const flag of FLAGS) {
    if (values[flag] !== undefined && !ALLOWED_FLAGS[command].includes(flag)) {
      return `Option --${flag} is not valid for "${command}".`
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
  out(`  ${stale.length} trash entr${stale.length === 1
    ? 'y is'
    : 'ies are'} older than 30 days. Run \`agent-knip restore --list\`.`)
}

async function runPrune(
  ctx: Ctx,
  agent: string | undefined,
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
  return result.skipped.some(skip => skip.reason.startsWith('move failed:'))
    ? 1
    : 0
}

async function previewPrune(ctx: Ctx, agent: string | undefined, color: boolean, forceRecent?: boolean, explain?: boolean): Promise<number> {
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
  out('  Dry run: nothing moved. Re-run `agent-knip prune --yes` to move the paths above.')
  return 2
}

function printPruneResult(result: PruneResult, ctx: Ctx): void {
  if (result.moved.length === 0) {
    out('  Nothing to prune.')
  }
  else {
    const bytes = result.moved.reduce((sum, item) => sum + item.bytes, 0)
    out(`  Moved ${result.moved.length} path${result.moved.length === 1
      ? ''
      : 's'} (${formatBytes(bytes)}) to ${tildify(result.trashDir!, ctx.home)}`)
    for (const item of result.moved) {
      out(`    ${tildify(item.from, ctx.home)}   ${formatBytes(item.bytes)}`)
    }
    out('')
    out('  Run `agent-knip restore --all` to undo.')
  }

  if (result.skipped.length === 0) {
    return
  }
  out('')
  out('  Skipped:')
  for (const skip of result.skipped) {
    out(`    ${formatPath(skip).padEnd(24)} ${skip.reason}`)
  }
}

async function runRestore(ctx: Ctx, all: boolean | undefined): Promise<number> {
  if (!all) {
    return listRestore(ctx)
  }

  const result = await restore(ctx)

  if (result.restored.length > 0) {
    out(`  Restored ${result.restored.length} path${result.restored.length === 1
      ? ''
      : 's'}:`)
    for (const item of result.restored) {
      out(`    ${tildify(item.from, ctx.home)}`)
    }
  }
  else if (result.failed.length === 0) {
    out('  Trash is empty.')
  }

  if (result.failed.length === 0) {
    return 0
  }
  out('')
  out('  Not restored:')
  for (const failure of result.failed) {
    out(`    ${tildify(failure.path, ctx.home)}   ${failure.reason}`)
  }
  return 1
}

async function listRestore(ctx: Ctx): Promise<number> {
  const entries = await listTrash(ctx)
  if (entries.length === 0) {
    out('  Trash is empty.')
    return 0
  }

  out(`  Trash: ${tildify(trashRoot(ctx), ctx.home)}`)
  for (const entry of entries) {
    const stamp = entry.dir.split(/[\\/]/).pop()!
    if (entry.error) {
      out(`  ${stamp}   ⚠ ${entry.error}`)
      continue
    }
    const bytes = entry.items.reduce((sum, item) => sum + item.bytes, 0)
    out(`  ${stamp}   ${entry.items.length} item${entry.items.length === 1
      ? ''
      : 's'}, ${formatBytes(bytes)}`)
    for (const item of entry.items) {
      out(`    ${tildify(item.from, ctx.home)}`)
    }
  }
  out('')
  out('  Run `agent-knip restore --all` to put everything back.')
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
    err(error instanceof Error
      ? error.message
      : String(error))
    process.exitCode = 1
  }
}
