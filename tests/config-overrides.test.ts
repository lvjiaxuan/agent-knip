import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { formatJson, formatReport } from '../src/format'
import { pathExists } from '../src/fs'
import { prune } from '../src/prune'
import { restore } from '../src/restore'
import { scan } from '../src/scan'
import { createTempHome } from './test-utils'

const overrides = [
  {
    agent: 'claude',
    env: 'CLAUDE_CONFIG_DIR',
    path: '.claude',
    credential: '.credentials.json',
  },
  {
    agent: 'codex',
    env: 'CODEX_HOME',
    path: '.codex',
    credential: 'auth.json',
  },
] as const

async function data(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'session'), 'keep me')
}

describe('configuration override integration', () => {
  it.each(overrides)('scans and labels $env without treating data as install evidence', async (entry) => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const custom = join(home, 'custom config', entry.agent)
      await data(custom)
      await data(join(home, entry.path))
      const reports = await scan({
        ...ctx,
        env: { ...ctx.env, [entry.env]: ` ${custom} ` },
      }, { agent: entry.agent })
      expect(reports[0].state).toBe('configured')
      expect(reports[0].evidence).toEqual([])
      expect(reports[0].paths).toHaveLength(1)
      expect(reports[0].paths[0]).toMatchObject({ env: entry.env, resolvedPath: custom, metadataComplete: true })
      const output = formatReport(reports, { now: ctx.now, forceRecent: true })
      expect(output).toContain(custom)
      expect(output).not.toContain(`$${entry.env}`)
      expect(output).not.toContain(`~/${entry.path}`)
      expect(JSON.parse(formatJson(reports, ctx.now)).agents[0].paths[0].resolvedPath).toBe(custom)
    }
    finally { await cleanup() }
  })

  it.each(overrides)('preserves default reports when $env is blank', async (entry) => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await data(join(home, entry.path))
      const reports = await scan({
        ...ctx,
        env: { ...ctx.env, [entry.env]: '   ' },
      }, { agent: entry.agent })
      expect(reports[0].paths[0]).not.toHaveProperty('env')
      expect(reports[0].paths[0].resolvedPath).toBe(join(home, entry.path))
      expect(formatReport(reports, { now: ctx.now })).toContain(`~/${entry.path}`)
    }
    finally { await cleanup() }
  })

  it.each(overrides)('keeps known credentials inside $env even when forced', async (entry) => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const custom = join(home, 'custom', entry.agent)
      await data(custom)
      await writeFile(join(custom, entry.credential), 'secret fixture')
      const overridden = {
        ...ctx,
        env: { ...ctx.env, [entry.env]: custom },
      }
      const [report] = await scan(overridden, { agent: entry.agent })
      expect(report.paths[0].blockedReason).toBe('credentials-inside')
      const result = await prune(overridden, { agent: entry.agent, forceRecent: true })
      expect(result.moved).toEqual([])
      expect(result.skipped[0]).toMatchObject({ env: entry.env, reason: 'credentials-inside' })
      expect(await readFile(join(custom, entry.credential), 'utf8')).toBe('secret fixture')
    }
    finally { await cleanup() }
  })

  it.each(overrides)('does not fall back or prune when $env is invalid', async (entry) => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await data(join(home, entry.path))
      const overridden = {
        ...ctx,
        env: { ...ctx.env, [entry.env]: './relative' },
      }
      const reports = await scan(overridden, { agent: entry.agent })
      expect(reports[0].state).toBe('unknown')
      expect(reports[0].checks.some(check => check.status === 'error' && check.detail.includes('绝对路径'))).toBe(true)
      expect(reports[0].paths).toEqual([])
      expect(JSON.parse(formatJson(reports, ctx.now)).candidates).toEqual([])
      expect((await prune(overridden, { agent: entry.agent, forceRecent: true })).moved).toEqual([])
      expect(await readFile(join(home, entry.path, 'session'), 'utf8')).toBe('keep me')
    }
    finally { await cleanup() }
  })

  it.each(overrides)('quarantines and restores $env outside home without needing the variable to restore', async (entry) => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    const outside = await createTempHome()
    try {
      const custom = join(outside.home, 'custom config')
      await data(custom)
      await data(join(home, entry.path))
      const overridden = {
        ...ctx,
        env: { ...ctx.env, [entry.env]: custom },
      }
      const result = await prune(overridden, { agent: entry.agent, forceRecent: true })
      expect(result.moved).toHaveLength(1)
      expect(result.moved[0]).toMatchObject({ from: custom, to: `${entry.agent}/${entry.env}/${entry.path}` })
      expect(await pathExists(custom)).toBe(false)
      expect(await readFile(join(home, entry.path, 'session'), 'utf8')).toBe('keep me')
      const restored = await restore(ctx)
      expect(restored.failed).toEqual([])
      expect(restored.restored).toHaveLength(1)
      expect(await readFile(join(custom, 'session'), 'utf8')).toBe('keep me')
    }
    finally {
      await cleanup()
      await outside.cleanup()
    }
  })

  it('keeps shared override directories protected even with an agent filter', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const shared = join(home, 'shared')
      await data(shared)
      const overridden = {
        ...ctx,
        env: { ...ctx.env, CLAUDE_CONFIG_DIR: shared, CODEX_HOME: shared },
      }
      const reports = await scan(overridden, { agent: 'claude' })
      expect(reports[0].paths[0].blockedReason).toBe('shared-or-overlapping-location')
      expect((await prune(overridden, { agent: 'claude', forceRecent: true })).moved).toEqual([])
      expect(await readFile(join(shared, 'session'), 'utf8')).toBe('keep me')
    }
    finally { await cleanup() }
  })

  it('does not follow a linked ancestor of a custom configuration directory', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const actual = join(home, 'actual')
      const link = join(home, 'linked')
      await data(join(actual, 'codex'))
      await symlink(actual, link, process.platform === 'win32'
        ? 'junction'
        : 'dir')
      const overridden = {
        ...ctx,
        env: {
          ...ctx.env,
          CODEX_HOME: join(link, 'codex'),
        },
      }
      const [report] = await scan(overridden, { agent: 'codex' })
      expect(report.paths[0].blockedReason).toBe('linked-ancestor')
      expect((await prune(overridden, { agent: 'codex', forceRecent: true })).moved).toEqual([])
      expect(await readFile(join(actual, 'codex', 'session'), 'utf8')).toBe('keep me')
    }
    finally { await cleanup() }
  })

  it('honors XDG_CONFIG_HOME for OpenCode without calling it an installation', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const root = join(home, 'xdg')
      await data(join(root, 'opencode'))
      const reports = await scan({
        ...ctx,
        env: { ...ctx.env, XDG_CONFIG_HOME: root },
      }, { agent: 'opencode' })
      expect(reports[0].state).toBe('configured')
      expect(reports[0].evidence).toEqual([])
      expect(reports[0].paths).toHaveLength(1)
      expect(reports[0].paths[0]).toMatchObject({
        base: 'XDG_CONFIG_HOME',
        path: 'opencode',
        resolvedPath: join(root, 'opencode'),
      })
    }
    finally { await cleanup() }
  })
})
