import * as promises from 'node:fs/promises'
import { mkdir, readFile, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fileOps from '../src/fs'
import { pruneBlockReason } from '../src/policy'
import { prune } from '../src/prune'
import { scan } from '../src/scan'
import { createTempHome } from './test-utils'

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    writeFile: vi.fn(fs.writeFile),
  }
})

const old = new Date(Date.now() - 30 * 86400000)
afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe('fail-closed detection and recovery', () => {
  it('missing required package roots produce check-yourself, not absence of installation', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await mkdir(join(home, '.codex'))
      await utimes(join(home, '.codex'), old, old)
      const env = { PATH: '' }
      const reports = await scan({ ...ctx, env }, { agent: 'codex' })
      expect(reports[0].state).toBe('unknown')
      expect(reports[0].checks.some(check => check.status === 'error')).toBe(true)
      expect((await prune({ ...ctx, env }, { agent: 'codex', forceRecent: true })).moved).toEqual([])
    }
    finally { await cleanup() }
  })

  it('rejects junctions above an environment root', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const outside = join(home, 'outside')
      await mkdir(join(outside, 'Roaming', 'Zed'), { recursive: true })
      await writeFile(join(outside, 'Roaming', 'Zed', 'settings.json'), '{}')
      const link = join(home, 'linked')
      await symlink(outside, link, process.platform === 'win32'
        ? 'junction'
        : 'dir')
      const result = await prune({
        ...ctx,
        env: {
          ...ctx.env,
          APPDATA: join(link, 'Roaming'),
        },
      }, { agent: 'zed', forceRecent: true })
      expect(result.moved).toEqual([])
      expect(await readFile(join(outside, 'Roaming', 'Zed', 'settings.json'), 'utf8')).toBe('{}')
    }
    finally { await cleanup() }
  })

  it('does not move a source when persisting recovery intent fails', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await mkdir(join(home, '.claude'))
      await writeFile(join(home, '.claude', 'session'), 'keep')
      const move = vi.spyOn(fileOps, 'movePath')
      vi.spyOn(promises, 'writeFile').mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
      await expect(prune(ctx, { agent: 'claude', forceRecent: true })).rejects.toMatchObject({ code: 'ENOSPC' })
      expect(move).not.toHaveBeenCalled()
      expect(await readFile(join(home, '.claude', 'session'), 'utf8')).toBe('keep')
    }
    finally {
      vi.restoreAllMocks()
      await cleanup()
    }
  })

  it('cross-volume failure keeps the source and never falls back to copy/delete', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await mkdir(join(home, '.claude'))
      await writeFile(join(home, '.claude', 'session'), 'keep')
      vi.spyOn(fileOps, 'movePath').mockRejectedValueOnce(Object.assign(new Error('cross volume'), { code: 'EXDEV' }))
      const result = await prune(ctx, { agent: 'claude', forceRecent: true })
      expect(result.moved).toEqual([])
      expect(result.skipped[0].reason).toContain('EXDEV')
      expect(await readFile(join(home, '.claude', 'session'), 'utf8')).toBe('keep')
    }
    finally {
      vi.restoreAllMocks()
      await cleanup()
    }
  })

  it('age override bypasses only recency, including the exact seven-day boundary', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await mkdir(join(home, '.claude'))
      const [report] = await scan(ctx, { agent: 'claude' })
      const path = report.paths[0]
      const week = 7 * 86400000
      expect(pruneBlockReason(report, { ...path, modifiedAt: ctx.now - week }, ctx.now)).toBeUndefined()
      expect(pruneBlockReason(report, { ...path, modifiedAt: ctx.now - week + 1 }, ctx.now)).toBe('recent')
      expect(pruneBlockReason(report, { ...path, kind: 'credentials' }, ctx.now, true)).toBe('credentials')
      expect(pruneBlockReason({ ...report, cleanupSupported: false }, path, ctx.now, true)).toBe('unverified-platform')
    }
    finally { await cleanup() }
  })
})
