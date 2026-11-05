import type { AgentReport, AgentSpec, PathReport } from '../src/types'
import { describe, expect, it } from 'vitest'
import { formatAge, formatJson, formatPath, formatReport } from '../src/format'

const now = 1_793_000_000_000
const DAY = 24 * 60 * 60 * 1000

const claude: AgentSpec = {
  id: 'claude',
  name: 'Claude Code',
  bins: ['claude'],
  locations: [],
}
const gemini: AgentSpec = {
  id: 'gemini',
  name: 'Gemini CLI',
  bins: ['gemini'],
  locations: [],
}
const cursor: AgentSpec = {
  id: 'cursor',
  name: 'Cursor',
  bins: ['cursor-agent'],
  locations: [],
}

function path(overrides: Partial<PathReport> & { path: string }): PathReport {
  return {
    type: 'dir',
    kind: 'history',
    metadataComplete: true,
    modifiedAt: now,
    symlink: false,
    ...overrides,
  }
}

function report(agent: AgentSpec, overrides: Partial<AgentReport>): AgentReport {
  return {
    agent,
    state: 'configured',
    score: 0,
    evidence: [],
    checks: [],
    paths: [],
    skips: [],
    ...overrides,
  }
}

const reports: AgentReport[] = [
  report(claude, {
    paths: [
      path({ path: '.claude', modifiedAt: now - 18 * DAY }),
      path({
        path: '.claude.json',
        type: 'file',
        kind: 'credentials',
        modifiedAt: now - 18 * DAY,
      }),
    ],
    skips: ['credentials'],
  }),
  report(gemini, {
    state: 'unknown',
    reason: '已找到命令，但 --version 执行失败',
    paths: [
      path({ path: '.gemini', modifiedAt: now - 6 * DAY }),
    ],
    skips: ['unknown'],
  }),
  report(cursor, {
    state: 'installed',
    paths: [
      path({
        path: '.cursor',
        kind: 'cache',
        modifiedAt: now - 3 * DAY,
      }),
    ],
    skips: ['installed'],
  }),
]

describe('formatReport', () => {
  it('groups paths by the action the user can take and shows why others stay', () => {
    const output = formatReport(reports, { now })

    expect(output.indexOf('可移入隔离区 (1)')).toBeLessThan(output.indexOf('保留原位 (3)'))
    expect(output).toContain('~/.claude.json')
    expect(output).toContain('保留：凭据文件')
    expect(output).toContain('需人工检查：检测未完成（--explain 查看详情）')
    expect(output).toContain('保留：检测到安装线索')
    expect(output).toContain('1 条路径符合隔离条件。')
    expect(output).toContain('本次未做任何修改。')
  })

  it('prints one table header per action group without size information', () => {
    const output = formatReport(reports, { now })

    expect(output.match(/修改时间/g)).toHaveLength(2)
    expect(output).not.toContain('SIZE')
    expect(output).not.toMatch(/\b(?:B|KB|MB|GB|TB)\b/)
    expect(output).toContain('修改时间')
    expect(output).toContain('工具')
    expect(output).toContain('处理结果')
  })

  it('prints no ANSI escapes when color is off and no absolute home path', () => {
    const output = formatReport(reports, { now })

    expect(output).not.toContain('\u001B')
    expect(output).not.toContain('/home/')
  })

  it('reports an eligible path without a size measurement', () => {
    const output = formatReport([
      report(claude, {
        paths: [
          path({ path: '.claude', modifiedAt: now - 30 * DAY }),
        ],
      }),
    ], { now })

    expect(output).toContain('可移入隔离区（可还原）')
    expect(output).toContain('1 条路径符合隔离条件。')
  })

  it('says nothing to reclaim when every unused path is blocked', () => {
    const output = formatReport([
      report(claude, {
        paths: [
          path({ path: '.claude', modifiedAt: now }),
        ],
        skips: ['recent'],
      }),
    ], { now })

    expect(output).toContain('保留：最近 7 天内有修改')
    expect(output).toContain('没有可移入隔离区的路径。')
  })

  it('explains whether metadata collection completed', () => {
    const output = formatReport(reports, { now, explain: true })

    expect(output).toContain('目录树修改时间检查=完整')
    expect(output).not.toContain('登记来源=')
    expect(output).not.toContain('cleanupSupported')
    expect(output).toContain('判定：找到安装线索')
    expect(output).not.toMatch(/registry=|cleanupSupported=|Decision:|kept:/)
    expect(output).not.toContain('sizeComplete')
  })

  it('translates evidence labels and keeps JSON status identifiers intact', () => {
    const data = [
      report(cursor, {
        state: 'installed',
        checks: [
          { source: 'binary', status: 'found', detail: 'zed.exe' },
          { source: 'probe', status: 'skipped', detail: '已跳过运行探测' },
          { source: 'location', status: 'error', detail: 'EACCES' },
        ],
      }),
    ]
    const output = formatReport(data, { now, explain: true })
    expect(output).toContain('命令文件 [已找到] zed.exe')
    expect(output).toContain('运行探测 [已跳过]')
    expect(output).toContain('路径 [出错] EACCES')
    expect(output).toContain('未找到已登记的数据路径')
    expect(JSON.parse(formatJson(data, now)).agents[0].checks[0]).toEqual({
      source: 'binary',
      status: 'found',
      detail: 'zed.exe',
    })
  })

  it('names the failed detection step in the result column', () => {
    const output = formatReport([
      report(gemini, {
        state: 'unknown',
        paths: [
          path({ path: '.gemini' }),
        ],
        checks: [
          { source: 'probe', status: 'error', detail: 'version timed out' },
        ],
      }),
    ], { now })

    expect(output).toContain('需人工检查：运行探测检查失败（--explain 查看详情）')
    expect(output).not.toContain('保留：检查未完成')
  })

  it('prints resolved base paths in the table and JSON candidates', () => {
    const resolvedPath = 'C:\\Users\\user\\AppData\\Roaming\\Zed'
    const data = [
      report({ id: 'zed', name: 'Zed', locations: [] }, {
        paths: [
          path({
            path: 'Zed',
            base: 'APPDATA',
            resolvedPath,
            modifiedAt: now - 30 * DAY,
          }),
        ],
      }),
    ]
    const output = formatReport(data, { now })

    expect(output).toContain(resolvedPath)
    expect(output).not.toContain('%APPDATA%')
    expect(JSON.parse(formatJson(data, now)).candidates).toEqual([
      { path: resolvedPath },
    ])
  })

  it('handles an empty scan', () => {
    expect(formatReport([], { now })).toContain('未找到已登记的工具数据或安装线索')
  })
})

describe('formatJson', () => {
  it('emits schema v4 with evidence groups and no registry authorization fields', () => {
    const output = formatJson(reports, now)
    const parsed = JSON.parse(output)

    expect(parsed.version).toBe(4)
    expect(parsed.scannedAt).toBe(now)
    expect(parsed.groups).toEqual({
      noInstallFound: ['claude'],
      checkYourself: ['gemini'],
      installFound: ['cursor'],
    })
    expect(parsed.candidates).toEqual([
      { path: '~/.claude' },
    ])
    expect(parsed.agents).toHaveLength(3)
    expect(parsed.agents[0].paths[0].metadataComplete).toBe(true)
    expect(output).not.toContain('"bytes"')
    expect(output).not.toContain('"sizeComplete"')
    expect(output).not.toContain('"registry"')
    expect(output).not.toContain('"cleanupSupported"')
  })
})

describe('formatAge', () => {
  it('formats relative ages', () => {
    expect(formatAge(0, now)).toBe('-')
    expect(formatAge(now - 1000, now)).toBe('今天')
    expect(formatAge(now - 18 * DAY, now)).toBe('18 天前')
    expect(formatAge(now - 60 * DAY, now)).toBe('2 个月前')
  })
})

describe('formatPath', () => {
  it('shows resolved base paths and retains symbolic formatting without scan context', () => {
    expect(formatPath({ path: '.claude' })).toBe('~/.claude')
    expect(formatPath({ path: 'Zed', base: 'APPDATA' })).toBe('%APPDATA%/Zed')
    expect(formatPath({ path: 'Zed', base: 'APPDATA', resolvedPath: 'C:\\Users\\user\\AppData\\Roaming\\Zed' })).toBe('C:\\Users\\user\\AppData\\Roaming\\Zed')
    expect(formatPath({ path: 'zed', base: 'XDG_CONFIG_HOME' })).toBe('$XDG_CONFIG_HOME/zed')
    expect(formatPath({ path: 'zed', base: 'XDG_CONFIG_HOME', resolvedPath: '/home/user/.config/zed' })).toBe('/home/user/.config/zed')
    expect(formatPath({ path: '.claude', env: 'CLAUDE_CONFIG_DIR' })).toBe('$CLAUDE_CONFIG_DIR')
    expect(formatPath({ path: '.codex', env: 'CODEX_HOME' })).toBe('$CODEX_HOME')
  })
})
