import type { AgentReport, AgentSpec, PathReport } from '../src/types'
import { describe, expect, it } from 'vitest'
import { formatAge, formatBytes, formatJson, formatPath, formatReport } from '../src/format'

const now = 1_793_000_000_000
const DAY = 24 * 60 * 60 * 1000

const claude: AgentSpec = {
  id: 'claude',
  name: 'Claude Code',
  bins: ['claude'],
  registry: 'curated',
  locations: [],
}
const gemini: AgentSpec = {
  id: 'gemini',
  name: 'Gemini CLI',
  bins: ['gemini'],
  registry: 'curated',
  locations: [],
}
const cursor: AgentSpec = {
  id: 'cursor',
  name: 'Cursor',
  bins: ['cursor-agent'],
  registry: 'curated',
  locations: [],
}

function path(overrides: Partial<PathReport> & { path: string }): PathReport {
  return {
    type: 'dir',
    kind: 'history',
    bytes: 0,
    sizeComplete: true,
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
    cleanupSupported: true,
    paths: [],
    bytes: 0,
    skips: [],
    ...overrides,
  }
}

const reports: AgentReport[] = [
  report(claude, {
    paths: [
      path({ path: '.claude', bytes: 432_000_000, modifiedAt: now - 18 * DAY }),
      path({
        path: '.claude.json',
        type: 'file',
        kind: 'credentials',
        bytes: 514,
        modifiedAt: now - 18 * DAY,
      }),
    ],
    bytes: 432_000_514,
    skips: ['credentials'],
  }),
  report(gemini, {
    state: 'unknown',
    reason: 'bin found, --version failed',
    paths: [
      path({ path: '.gemini', bytes: 11_000_000, modifiedAt: now - 6 * DAY }),
    ],
    bytes: 11_000_000,
    skips: ['unknown'],
  }),
  report(cursor, {
    state: 'installed',
    paths: [
      path({
        path: '.cursor',
        kind: 'cache',
        bytes: 790_000_000,
        modifiedAt: now - 3 * DAY,
      }),
    ],
    bytes: 790_000_000,
    skips: ['installed'],
  }),
]

describe('formatReport', () => {
  it('orders groups Unused → Unknown → In use and marks skipped paths', () => {
    const output = formatReport(reports, { now })

    expect(output.indexOf('No install found (1)')).toBeLessThan(output.indexOf('Check yourself (1)'))
    expect(output.indexOf('Check yourself (1)')).toBeLessThan(output.indexOf('Install found (1)'))
    expect(output).toContain('~/.claude.json')
    expect(output).toContain('kept: credentials')
    expect(output).toContain('kept: unknown')
    expect(output).toContain('1 candidate path(s), 412 MB.')
    expect(output).toContain('Nothing has been changed.')
  })

  it('prints a column header once per group', () => {
    const output = formatReport(reports, { now })

    expect(output.match(/DIRECTORY/g)).toHaveLength(3)
    expect(output).toContain('SIZE')
    expect(output).toContain('MODIFIED')
    expect(output).toContain('AGENT')
    expect(output).toContain('RESULT')
  })

  it('prints no ANSI escapes when color is off and no absolute home path', () => {
    const output = formatReport(reports, { now })

    expect(output).not.toContain('\u001B')
    expect(output).not.toContain('/home/')
  })

  it('still reports reclaimable when a prunable path is empty', () => {
    const output = formatReport([
      report(claude, {
        paths: [
          path({ path: '.claude', bytes: 0, modifiedAt: now - 30 * DAY }),
        ],
        bytes: 0,
      }),
    ], { now })

    expect(output).toContain('candidate (confirm)')
    expect(output).toContain('1 candidate path(s), 0 B.')
  })

  it('says nothing to reclaim when every unused path is blocked', () => {
    const output = formatReport([
      report(claude, {
        paths: [
          path({ path: '.claude', bytes: 100, modifiedAt: now }),
        ],
        bytes: 100,
        skips: ['recent'],
      }),
    ], { now })

    expect(output).toContain('kept: recent')
    expect(output).toContain('No cleanup candidates.')
  })

  it('handles an empty scan', () => {
    expect(formatReport([], { now })).toContain('no registered agent data or install evidence found')
  })
})

describe('formatJson', () => {
  it('emits the stable schema with grouped ids', () => {
    const parsed = JSON.parse(formatJson(reports, now))

    expect(parsed.version).toBe(2)
    expect(parsed.scannedAt).toBe(now)
    expect(parsed.groups).toEqual({
      noInstallFound: ['claude'],
      checkYourself: ['gemini'],
      installFound: ['cursor'],
      reference: [],
    })
    expect(parsed.agents).toHaveLength(3)
  })
})

describe('formatBytes', () => {
  it('uses human units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(514)).toBe('514 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(432_000_000)).toBe('412 MB')
    expect(formatBytes(1_342_177_280)).toBe('1.25 GB')
  })
})

describe('formatAge', () => {
  it('formats relative ages', () => {
    expect(formatAge(0, now)).toBe('-')
    expect(formatAge(now - 1000, now)).toBe('today')
    expect(formatAge(now - 18 * DAY, now)).toBe('18d ago')
    expect(formatAge(now - 60 * DAY, now)).toBe('2mo ago')
  })
})

describe('formatPath', () => {
  it('shows home-relative paths with ~ and env-based paths with their variable', () => {
    expect(formatPath({ path: '.claude' })).toBe('~/.claude')
    expect(formatPath({ path: 'Zed', base: 'APPDATA' })).toBe('%APPDATA%/Zed')
    expect(formatPath({ path: 'zed', base: 'XDG_CONFIG_HOME' })).toBe('$XDG_CONFIG_HOME/zed')
  })
})
