import type { AgentReport, PathReport, State } from './types'
import { styleText } from 'node:util'
import { SCHEMA_VERSION } from './constants'
import { pruneBlockReason } from './scan'

export interface FormatOptions {
  now: number
  color?: boolean
}

type Paint = (format: 'bold' | 'dim', text: string) => string

const DAY = 24 * 60 * 60 * 1000

interface Group {
  title: string
  note: string
  state: State
}

const GROUPS: Group[] = [
  { title: 'Unused', note: 'only config left, safe to prune', state: 'configured' },
  { title: 'Unknown', note: 'never cleaned, check it yourself', state: 'unknown' },
  { title: 'In use', note: '', state: 'installed' },
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
  const { now, color = false } = options
  const paint: Paint = (format, text) => (color
    ? styleText(format, text)
    : text)
  const count = reports.length

  if (count === 0) {
    return `  ${paint('bold', 'agent-knip')} ${paint('dim', '· no agent leftovers found')}\n`
  }

  const totalBytes = reports.reduce((sum, report) => sum + report.bytes, 0)
  const pathWidth = Math.max(16, ...reports.flatMap(report => report.paths.map(path => `~/${path.path}`.length)))
  const lines = [`  ${paint('bold', 'agent-knip')} ${paint('dim', `· ${count} agent${count === 1
    ? ''
    : 's'}, ${formatBytes(totalBytes)}`)}`]

  for (const group of GROUPS) {
    const members = reports
      .filter(report => report.state === group.state)
      .sort((a, b) => b.bytes - a.bytes || a.agent.id.localeCompare(b.agent.id))
    if (members.length === 0) {
      continue
    }
    lines.push('', groupHeading(group, members.length, paint), ...renderGroup(members, now, pathWidth))
  }

  lines.push('')
  const reclaimable = reclaimableBytes(reports, now)
  if (reclaimable > 0) {
    lines.push(`  ${formatBytes(reclaimable)} can be reclaimed. Nothing has been changed.`)
    lines.push('  Run `agent-knip prune` to move them to ~/.agent-knip/trash.')
  }
  else {
    lines.push('  Nothing to reclaim.')
  }

  return `${lines.join('\n')}\n`
}

function groupHeading(group: Group, count: number, paint: Paint): string {
  return `  ${`${group.title} (${count})`.padEnd(32)}${paint('dim', group.note)}`
}

function renderGroup(members: AgentReport[], now: number, pathWidth: number): string[] {
  const lines: string[] = []
  for (const report of members) {
    for (const path of report.paths) {
      const note = pathNote(report, path, now)
      const line = [
        `  ${`~/${path.path}`.padEnd(pathWidth)}`,
        formatBytes(path.bytes).padStart(8),
        formatAge(path.modifiedAt, now).padStart(8),
        `  ${report.agent.name}`,
        note
          ? `   ${note}`
          : '',
      ].join('  ')
      lines.push(line.replace(/\s+$/, ''))
    }
  }
  return lines
}

function reclaimableBytes(reports: AgentReport[], now: number): number {
  return reports
    .filter(report => report.state === 'configured')
    .reduce((sum, report) => sum + report.paths
      .filter(path => !pruneBlockReason(report.state, path, now))
      .reduce((inner, path) => inner + path.bytes, 0), 0)
}

function pathNote(report: AgentReport, path: PathReport, now: number): string {
  if (report.state === 'unknown') {
    return report.reason ?? ''
  }
  if (report.state !== 'configured') {
    return ''
  }
  const reason = pruneBlockReason(report.state, path, now)
  if (!reason) {
    return ''
  }
  if (reason === 'credentials') {
    return '⚠ credentials, skipped'
  }
  return reason === 'recent'
    ? 'recent, skipped'
    : `${reason}, skipped`
}

export function formatJson(reports: AgentReport[], now: number): string {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    scannedAt: now,
    groups: {
      unused: reports.filter(report => report.state === 'configured').map(report => report.agent.id),
      unknown: reports.filter(report => report.state === 'unknown').map(report => report.agent.id),
      inUse: reports.filter(report => report.state === 'installed').map(report => report.agent.id),
    },
    agents: reports,
  }, null, 2)
}
