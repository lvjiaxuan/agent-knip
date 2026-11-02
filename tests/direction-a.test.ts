import { lstat, mkdir, readdir, readFile, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { formatJson, formatReport } from '../src/format'
import { resolveLocation, validRelativePath } from '../src/locations'
import { pruneBlockReason } from '../src/policy'
import { prune } from '../src/prune'
import { listTrash, restore } from '../src/restore'
import { scan } from '../src/scan'
import { createTempHome } from './test-utils'

async function oldData(target: string): Promise<void> {
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'session'), 'keep me')
  const old = new Date(Date.now() - 30 * 86400000)
  await utimes(join(target, 'session'), old, old)
  await utimes(target, old, old)
}

describe('direction A policy', () => {
  it('keeps generated references visible but never eligible, even when forced', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await oldData(join(home, '.config', 'amp'))
      const reports = await scan(ctx, { agent: 'amp' })
      expect(reports[0].cleanupSupported).toBe(false)
      expect(pruneBlockReason(reports[0], reports[0].paths[0], ctx.now, true)).toBe('reference-only')
      expect(formatReport(reports, { now: ctx.now, forceRecent: true })).toContain('Reference only')
      expect(JSON.parse(formatJson(reports, ctx.now)).candidates).toEqual([])
      const result = await prune(ctx, { agent: 'amp', forceRecent: true })
      expect(result.moved).toEqual([])
      expect(result.trashDir).toBeUndefined()
      expect(await readFile(join(home, '.config', 'amp', 'session'), 'utf8')).toBe('keep me')
      expect(await readdir(home)).not.toContain('.agent-knip')
    }
    finally { await cleanup() }
  })

  it('does not grant cleanup to an unverified platform merely because it is curated', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'linux' })
    try {
      await oldData(join(home, '.claude'))
      const reports = await scan(ctx, { agent: 'claude' })
      expect(reports[0].cleanupSupported).toBe(false)
      expect(formatReport(reports, { now: ctx.now })).toContain('Check yourself')
      expect((await prune(ctx, { agent: 'claude', forceRecent: true })).moved).toEqual([])
    }
    finally { await cleanup() }
  })

  it('known credential-bearing parents remain untouched when forced', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await oldData(join(home, '.codex'))
      await writeFile(join(home, '.codex', 'auth.json'), 'secret fixture, do not read')
      const reports = await scan(ctx, { agent: 'codex' })
      expect(reports[0].paths[0].blockedReason).toBe('credentials-inside')
      const result = await prune(ctx, { agent: 'codex', forceRecent: true })
      expect(result.moved).toEqual([])
      expect(result.skipped[0].reason).toBe('credentials-inside')
      expect((await lstat(join(home, '.codex', 'auth.json'))).isFile()).toBe(true)
    }
    finally { await cleanup() }
  })

  it('agent filters cannot hide shared parent/child locations from the cleanup gate', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await oldData(join(home, '.gemini', 'antigravity'))
      const reports = await scan(ctx, { agent: 'gemini' })
      expect(reports[0].paths[0].blockedReason).toBe('shared-or-overlapping-location')
      expect((await prune(ctx, { agent: 'gemini', forceRecent: true })).moved).toEqual([])
    }
    finally { await cleanup() }
  })

  it('retains install evidence when no data directory exists', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const appdata = join(home, 'roaming')
      await mkdir(join(appdata, 'npm', 'node_modules', '@openai', 'codex'), { recursive: true })
      const reports = await scan({
        ...ctx,
        env: { ...ctx.env, APPDATA: appdata },
      }, { agent: 'codex' })
      expect(reports[0].state).toBe('installed')
      expect(reports[0].paths).toEqual([])
      expect(formatReport(reports, { now: ctx.now, explain: true })).toContain('npm:@openai/codex')
    }
    finally { await cleanup() }
  })

  it('rejects relative environment bases rather than scanning the current directory', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await oldData(join(home, '.codex'))
      const reports = await scan({
        ...ctx,
        env: { ...ctx.env, APPDATA: './relative' },
      }, { agent: 'zed' })
      expect(reports[0].state).toBe('unknown')
      expect(reports[0].checks.some(check => check.status === 'error' && check.detail.includes('absolute'))).toBe(true)
    }
    finally { await cleanup() }
  })

  it('deduplicates identical environment aliases within an agent', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'linux' })
    try {
      const root = join(home, 'config')
      await oldData(join(root, 'zed'))
      const reports = await scan({
        ...ctx,
        env: { ...ctx.env, XDG_CONFIG_HOME: root, FLATPAK_XDG_CONFIG_HOME: root },
      }, { agent: 'zed' })
      expect(reports[0].paths).toHaveLength(1)
      expect(reports[0].checks.some(check => check.detail.includes('duplicate'))).toBe(true)
    }
    finally { await cleanup() }
  })

  it('never follows intermediate junctions for data cleanup', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const outside = join(home, 'other')
      await oldData(join(outside, 'Zed'))
      const appdata = join(home, 'roaming')
      await symlink(outside, appdata, process.platform === 'win32'
        ? 'junction'
        : 'dir')
      const result = await prune({
        ...ctx,
        env: {
          ...ctx.env,
          APPDATA: appdata,
          LOCALAPPDATA: join(home, 'local'),
        },
      }, { agent: 'zed', forceRecent: true })
      expect(result.moved).toEqual([])
      expect(await readFile(join(outside, 'Zed', 'session'), 'utf8')).toBe('keep me')
    }
    finally { await cleanup() }
  })

  it('same-time batches never overwrite earlier manifests or payload', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await oldData(join(home, '.claude'))
      const first = await prune(ctx, { agent: 'claude' })
      await oldData(join(home, '.gemini'))
      const second = await prune(ctx, { agent: 'gemini' })
      expect(first.trashDir).not.toBe(second.trashDir)
      expect(first.moved).toHaveLength(1)
      expect(second.moved).toHaveLength(1)
      expect((await listTrash(ctx)).flatMap(entry => entry.items)).toHaveLength(2)
      expect((await restore(ctx)).restored).toHaveLength(2)
      expect(await readFile(join(home, '.claude', 'session'), 'utf8')).toBe('keep me')
    }
    finally { await cleanup() }
  })
})

describe('location boundary', () => {
  it('rejects absolute and traversing registry paths', async () => {
    const { ctx, cleanup } = await createTempHome()
    try {
      for (const path of [
        '',
        '..',
        '../data',
        '/data',
        'C:/data',
        '.config/../data',
        'a\\b',
      ]) {
        expect(validRelativePath(path)).toBe(false)
        expect(() => resolveLocation(ctx, { path })).toThrow()
      }
      expect(resolveLocation(ctx, {
        path: 'Zed',
        base: 'APPDATA',
        platforms: ['darwin'],
      })).toBeUndefined()
    }
    finally { await cleanup() }
  })
})
