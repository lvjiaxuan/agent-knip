import type { ReportGroup } from './policy'
import type { AgentReport, PathReport } from './types'
import { styleText } from 'node:util'
import { SCHEMA_VERSION } from './constants'
import { pruneBlockReason, reportGroup } from './policy'

export interface FormatOptions {
  now: number
  color?: boolean
  explain?: boolean
  forceRecent?: boolean
}

type Paint = (format: 'bold' | 'dim', text: string) => string

const DAY = 24 * 60 * 60 * 1000

const COLUMNS = {
  directory: 'DIRECTORY',
  size: 'SIZE',
  modified: 'MODIFIED',
  agent: 'AGENT',
  result: 'RESULT',
}

interface Group {
  title: string
  note: string
  id: ReportGroup
}

const GROUPS: Group[] = [
  { title: 'No install found', note: 'not proof of uninstallation; review before pruning', id: 'noInstallFound' },
  { title: 'Check yourself', note: 'uncertain or unverified platform; never pruned', id: 'checkYourself' },
  { title: 'Install found', note: 'installation evidence found; never pruned', id: 'installFound' },
  { title: 'Reference only', note: 'unverified registry; never pruned', id: 'reference' },
]

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = value < 10
    ? 2
    : value < 100
      ? 1
      : 0
  return `${Number.parseFloat(value.toFixed(digits))} ${units[unit]}`
}

export function formatPath(path: Pick<PathReport, 'path' | 'base'>): string {
  if (!path.base) {
    return `~/${path.path}`
  }
  const prefix = path.base === 'APPDATA' || path.base === 'LOCALAPPDATA'
    ? `%${path.base}%`
    : `$${path.base}`
  return `${prefix}/${path.path}`
}

export function formatAge(modifiedAt: number, now: number): string {
  if (!modifiedAt) {
    return '-'
  }
  const days = Math.floor((now - modifiedAt) / DAY)
  if (days <= 0) {
    return 'today'
  }
  if (days < 30) {
    return `${days}d ago`
  }
  return `${Math.floor(days / 30)}mo ago`
}

export function formatReport(reports: AgentReport[], options: FormatOptions): string {
  const { now, color = false, forceRecent = false } = options
  const paint: Paint = (format, text) => (color
    ? styleText(format, text)
    : text)
  const count = reports.length

  if (count === 0) {
    return `  ${paint('bold', 'agent-knip')} ${paint('dim', '· no registered agent data or install evidence found')}\n`
  }

  const totalBytes = reports.reduce((sum, report) => sum + report.bytes, 0)
  const pathWidth = Math.max(16, ...reports.flatMap(report => report.paths.map(path => formatPath(path).length)))
  const agentWidth = Math.max(COLUMNS.agent.length, ...reports.map(report => report.agent.name.length))
  const lines = [`  ${paint('bold', 'agent-knip')} ${paint('dim', `· ${count} agent${count === 1
    ? ''
    : 's'}, ${formatBytes(totalBytes)}`)}`]

  for (const group of GROUPS) {
    const members = reports
      .filter(report => reportGroup(report) === group.id)
      .sort((a, b) => b.bytes - a.bytes || a.agent.id.localeCompare(b.agent.id))
    if (members.length === 0) {
      continue
    }
    lines.push(
      '',
      groupHeading(group, members.length, paint),
      tableHeader(pathWidth, agentWidth, paint),
      ...renderGroup(members, now, pathWidth, agentWidth, forceRecent),
    )
  }

  lines.push('')
  const reclaimable = reclaimablePaths(reports, now, forceRecent)
  if (reclaimable.length > 0) {
    const bytes = reclaimable.reduce((sum, path) => sum + path.bytes, 0)
    lines.push(`  ${reclaimable.length} candidate path(s), ${formatBytes(bytes)}. Nothing has been changed.`)
    lines.push('  Review `agent-knip prune --explain` before confirming with --yes.')
  }
  else {
    lines.push('  No cleanup candidates. Nothing has been changed.')
  }

  if (options.explain) {
    lines.push('', ...explainReports(reports, now, forceRecent))
  }
  return `${lines.join('\n')}\n`
}

function groupHeading(group: Group, count: number, paint: Paint): string {
  const title = `${group.title} (${count})`
  if (!group.note) {
    return `  ${title}`
  }
  return `  ${title.padEnd(32)}${paint('dim', group.note)}`
}

function tableHeader(pathWidth: number, agentWidth: number, paint: Paint): string {
  return paint('dim', `  ${COLUMNS.directory.padEnd(pathWidth)}  ${COLUMNS.size.padStart(8)}  ${COLUMNS.modified.padStart(8)}  ${COLUMNS.agent.padEnd(agentWidth)}  ${COLUMNS.result}`)
}

function renderGroup(members: AgentReport[], now: number, pathWidth: number, agentWidth: number, forceRecent: boolean): string[] {
  const lines: string[] = []
  for (const report of members) {
    if (report.paths.length === 0) {
      lines.push(`  ${report.agent.name}: ${report.reason ?? report.state}; no registered data path found (use --explain)`)
    }
    for (const path of report.paths) {
      lines.push(`  ${formatPath(path).padEnd(pathWidth)}  ${formatBytes(path.bytes).padStart(8)}  ${formatAge(path.modifiedAt, now).padStart(8)}  ${report.agent.name.padEnd(agentWidth)}  ${pathResult(report, path, now, forceRecent)}`)
    }
  }
  return lines
}

function reclaimablePaths(reports: AgentReport[], now: number, forceRecent: boolean): PathReport[] {
  return reports.flatMap(report => report.paths.filter(path => !pruneBlockReason(report, path, now, forceRecent)))
}

function pathResult(report: AgentReport, path: PathReport, now: number, forceRecent: boolean): string {
  const reason = pruneBlockReason(report, path, now, forceRecent)
  if (!reason) {
    return 'candidate (confirm)'
  }
  return `kept: ${reason}`
}

function explainReports(reports: AgentReport[], now: number, forceRecent: boolean): string[] {
  const lines = [
    '  Explanation (local evidence only; missing evidence does not prove uninstallation)',
    '  Not checked: OS uninstall registry, running processes, portable/WSL installs, shell history.',
  ]
  for (const report of reports) {
    lines.push(`  ${report.agent.name} [${report.agent.id}] registry=${report.agent.registry}, cleanupSupported=${report.cleanupSupported}`)
    for (const check of report.checks) {
      lines.push(`    ${check.source} [${check.status}] ${check.detail}`)
    }
    for (const path of report.paths) {
      lines.push(`    ${formatPath(path)} -> ${path.resolvedPath ?? '(unresolved)'}`)
      lines.push(`      modified=${new Date(path.modifiedAt).toISOString()}, sizeComplete=${path.sizeComplete}, result=${pathResult(report, path, now, forceRecent)}`)
    }
    lines.push(`    Decision: ${report.reason ?? report.state}`)
  }
  return lines
}

export function formatJson(reports: AgentReport[], now: number): string {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    scannedAt: now,
    groups: Object.fromEntries(GROUPS.map(group => [
      group.id,
      reports.filter(report => reportGroup(report) === group.id).map(report => report.agent.id),
    ])),
    candidates: reclaimablePaths(reports, now, false).map(path => ({
      path: formatPath(path),
      bytes: path.bytes,
    })),
    agents: reports.map(report => ({
      ...report,
      paths: report.paths.map(path => ({ ...path, decision: pruneBlockReason(report, path, now) ?? 'candidate' })),
    })),
  }, null, 2)
}
