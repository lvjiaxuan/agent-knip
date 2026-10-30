import type { AgentReport, AgentSpec, PathReport } from './types'
import { describe, expect, it } from 'vitest'
import { formatAge, formatBytes, formatJson, formatReport } from './format'

const now = 1_793_000_000_000
const DAY = 24 * 60 * 60 * 1000

const claude: AgentSpec = {
  id: 'claude',
  name: 'Claude Code',
  bins: ['claude'],
  paths: [],
}
const gemini: AgentSpec = {
  id: 'gemini',
  name: 'Gemini CLI',
  bins: ['gemini'],
  paths: [],
}
const cursor: AgentSpec = {
  id: 'cursor',
  name: 'Cursor',
  bins: ['cursor-agent'],
  paths: [],
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

    expect(output.indexOf('Unused (1)')).toBeLessThan(output.indexOf('Unknown (1)'))
    expect(output.indexOf('Unknown (1)')).toBeLessThan(output.indexOf('In use (1)'))
    expect(output).toContain('~/.claude.json')
    expect(output).toContain('⚠ credentials, skipped')
    expect(output).toContain('bin found, --version failed')
    expect(output).toContain('412 MB can be reclaimed.')
    expect(output).toContain('Nothing has been changed.')
  })

  it('prints no ANSI escapes when color is off and no absolute home path', () => {
    const output = formatReport(reports, { now })

    expect(output).not.toContain('\u001B')
    expect(output).not.toContain('/home/')
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

    expect(output).toContain('recent, skipped')
    expect(output).toContain('Nothing to reclaim.')
  })

  it('handles an empty scan', () => {
    expect(formatReport([], { now })).toContain('no agent leftovers found')
  })
})

describe('formatJson', () => {
  it('emits the stable schema with grouped ids', () => {
    const parsed = JSON.parse(formatJson(reports, now))

    expect(parsed.version).toBe(1)
    expect(parsed.scannedAt).toBe(now)
    expect(parsed.groups).toEqual({
      unused: ['claude'],
      unknown: ['gemini'],
      inUse: ['cursor'],
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
