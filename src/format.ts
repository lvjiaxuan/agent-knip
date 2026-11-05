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

const SOURCE_LABELS = {
  location: '路径',
  package: '包记录',
  binary: '命令文件',
  probe: '运行探测',
}
const STATUS_LABELS = {
  'found': '已找到',
  'not-found': '未找到',
  'skipped': '已跳过',
  'error': '出错',
}
const STATE_LABELS = {
  installed: '找到安装线索',
  configured: '未找到安装线索',
  unknown: '检查未完成',
}
const REASON_LABELS: Record<string, string> = {
  'credentials': '凭据文件',
  'symlink': '符号链接或目录联接',
  'install-found': '检测到安装线索',
  'unknown': '检测未完成',
  'linked-ancestor': '上级目录含符号链接或目录联接',
  'type-mismatch': '路径类型与登记信息不符',
  'credentials-inside': '目录内含已知凭据文件',
  'shared-or-overlapping-location': '与其他工具共用或嵌套的路径',
  'unreadable': '无法完整读取或核验路径',
  'recent': '最近 7 天内有修改',
}

export function formatReason(reason: string): string {
  return REASON_LABELS[reason] ?? reason
}

function textWidth(text: string): number {
  return [...text].reduce((width, char) => width + (/\p{Script=Han}/u.test(char)
    ? 2
    : 1), 0)
}

function padText(text: string, width: number, start = false): string {
  const padding = ' '.repeat(Math.max(0, width - textWidth(text)))
  return start
    ? padding + text
    : text + padding
}

const COLUMNS = {
  directory: '路径',
  modified: '修改时间',
  agent: '工具',
  result: '处理结果',
}

interface DecisionItem {
  report: AgentReport
  path?: PathReport
}

const GROUP_IDS: ReportGroup[] = [
  'noInstallFound',
  'checkYourself',
  'installFound',
]

export function formatPath(path: Pick<PathReport, 'path' | 'base' | 'env' | 'resolvedPath'>): string {
  if ((path.base || path.env) && path.resolvedPath) {
    return path.resolvedPath
  }
  if (path.env) {
    return `$${path.env}`
  }
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
    return '今天'
  }
  if (days < 30) {
    return `${days} 天前`
  }
  return `${Math.floor(days / 30)} 个月前`
}

export function formatReport(reports: AgentReport[], options: FormatOptions): string {
  const { now, color = false, forceRecent = false } = options
  const paint: Paint = (format, text) => (color
    ? styleText(format, text)
    : text)
  const count = reports.length

  if (count === 0) {
    return `  ${paint('bold', 'agent-knip')} ${paint('dim', '· 未找到已登记的工具数据或安装线索')}\n`
  }

  const items: DecisionItem[] = []
  for (const report of reports) {
    if (report.paths.length === 0) {
      items.push({ report })
      continue
    }
    for (const path of report.paths) {
      items.push({ report, path })
    }
  }
  const candidates: DecisionItem[] = []
  const kept: DecisionItem[] = []
  for (const item of items) {
    if (item.path && !pruneBlockReason(item.report, item.path, now, forceRecent)) {
      candidates.push(item)
    }
    else {
      kept.push(item)
    }
  }
  const pathWidth = Math.max(16, ...items.flatMap((item) => {
    if (!item.path) {
      return []
    }
    return [
      textWidth(formatPath(item.path)),
    ]
  }))
  const agentWidth = Math.max(4, ...reports.map(report => textWidth(report.agent.name)))
  const lines = [`  ${paint('bold', 'agent-knip')} ${paint('dim', `· ${count} 个工具`)}`]

  lines.push(
    ...renderDecisionGroup('可移入隔离区', candidates, now, pathWidth, agentWidth, forceRecent, paint),
    ...renderDecisionGroup('保留原位', kept, now, pathWidth, agentWidth, forceRecent, paint),
    '',
  )

  if (candidates.length > 0) {
    lines.push(`  ${candidates.length} 条路径符合隔离条件。本次未做任何修改。`)
    lines.push('  使用 `agent-knip prune --agent <id>` 预览单个工具；确认后添加 `--yes`。')
  }
  else {
    lines.push('  没有可移入隔离区的路径。本次未做任何修改。')
  }

  if (options.explain) {
    lines.push('', ...explainReports(reports, now, forceRecent))
  }
  return `${lines.join('\n')}\n`
}

function renderDecisionGroup(
  title: string,
  items: DecisionItem[],
  now: number,
  pathWidth: number,
  agentWidth: number,
  forceRecent: boolean,
  paint: Paint,
): string[] {
  if (items.length === 0) {
    return []
  }

  const lines = ['', `  ${title} (${items.length})`]
  if (items.some(item => item.path)) {
    lines.push(tableHeader(pathWidth, agentWidth, paint))
  }
  for (const { report, path } of items) {
    if (!path) {
      lines.push(`  ${report.agent.name}: 未找到已登记的数据路径（使用 --explain 查看检测依据）`)
      continue
    }
    lines.push(`  ${padText(formatPath(path), pathWidth)}  ${padText(formatAge(path.modifiedAt, now), 10, true)}  ${padText(report.agent.name, agentWidth)}  ${pathResult(report, path, now, forceRecent)}`)
  }
  return lines
}

function tableHeader(pathWidth: number, agentWidth: number, paint: Paint): string {
  return paint('dim', `  ${padText(COLUMNS.directory, pathWidth)}  ${padText(COLUMNS.modified, 10, true)}  ${padText(COLUMNS.agent, agentWidth)}  ${COLUMNS.result}`)
}

function reclaimablePaths(reports: AgentReport[], now: number, forceRecent: boolean): PathReport[] {
  return reports.flatMap(report => report.paths.filter(path => !pruneBlockReason(report, path, now, forceRecent)))
}

function pathResult(report: AgentReport, path: PathReport, now: number, forceRecent: boolean): string {
  const reason = pruneBlockReason(report, path, now, forceRecent)
  if (!reason) {
    return '可移入隔离区（可还原）'
  }
  if (reason === 'unknown') {
    const failed = report.checks.find(check => check.status === 'error')
    const detail = failed
      ? `${SOURCE_LABELS[failed.source]}检查失败`
      : '检测未完成'
    return `需人工检查：${detail}（--explain 查看详情）`
  }
  return `保留：${formatReason(reason)}`
}

function explainReports(reports: AgentReport[], now: number, forceRecent: boolean): string[] {
  const lines = [
    '  检测依据（仅限本地线索；没有找到线索不代表已卸载）',
    '  未检查：系统卸载注册表、运行中的进程、便携版或 WSL 安装、shell 历史。',
  ]
  for (const report of reports) {
    lines.push(`  ${report.agent.name} [${report.agent.id}]`)
    for (const check of report.checks) {
      lines.push(`    ${SOURCE_LABELS[check.source]} [${STATUS_LABELS[check.status]}] ${check.detail}`)
    }
    for (const path of report.paths) {
      lines.push(`    路径 ${path.resolvedPath ?? formatPath(path)}`)
      lines.push(`      修改时间=${new Date(path.modifiedAt).toISOString()}，目录树修改时间检查=${path.metadataComplete ? '完整' : '未完整检查'}，处理结果=${pathResult(report, path, now, forceRecent)}`)
    }
    lines.push(`    判定：${report.reason ?? STATE_LABELS[report.state]}`)
  }
  return lines
}

export function formatJson(reports: AgentReport[], now: number): string {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    scannedAt: now,
    groups: Object.fromEntries(GROUP_IDS.map(id => [
      id,
      reports.filter(report => reportGroup(report) === id).map(report => report.agent.id),
    ])),
    candidates: reclaimablePaths(reports, now, false).map(path => ({
      path: formatPath(path),
    })),
    agents: reports.map(report => ({
      ...report,
      paths: report.paths.map(path => ({ ...path, decision: pruneBlockReason(report, path, now) ?? 'candidate' })),
    })),
  }, null, 2)
}
