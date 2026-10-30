import type { TempHome } from './test-utils'
import { mkdir, readFile, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pathExists } from './fs'
import { prune } from './prune'
import { listTrash, restore } from './restore'
import { createTempHome } from './test-utils'

const DAY = 24 * 60 * 60 * 1000

async function age(path: string, days: number): Promise<void> {
  const date = new Date(Date.now() - days * DAY)
  await utimes(path, date, date)
}

describe('prune', () => {
  let temp: TempHome | undefined

  afterEach(async () => {
    await temp?.cleanup()
  })

  it('moves an unused path to the trash and restores it', async () => {
    temp = await createTempHome({ platform: 'win32' })
    const { ctx, home } = temp
    await mkdir(join(home, '.claude'))
    await writeFile(join(home, '.claude', 'session.jsonl'), 'hello')
    await age(join(home, '.claude', 'session.jsonl'), 8)
    await age(join(home, '.claude'), 8)

    const result = await prune({
      ...ctx,
      now: Date.now(),
    })

    expect(result.moved).toHaveLength(1)
    expect(result.trashDir).toBeTruthy()
    expect(await pathExists(join(home, '.claude'))).toBe(false)

    const manifest = JSON.parse(await readFile(join(result.trashDir!, 'manifest.json'), 'utf8'))
    expect(manifest.version).toBe(1)
    expect(manifest.items[0].from).toBe(join(home, '.claude'))
    expect(manifest.items[0].to).toBe('claude/.claude')

    const restored = await restore(ctx)

    expect(restored.restored).toHaveLength(1)
    expect(await readFile(join(home, '.claude', 'session.jsonl'), 'utf8')).toBe('hello')
    expect(await listTrash(ctx)).toHaveLength(0)
  })

  it('never moves credentials', async () => {
    temp = await createTempHome({ platform: 'win32' })
    const { ctx, home } = temp
    await writeFile(join(home, '.claude.json'), '{"token":"x"}')
    await age(join(home, '.claude.json'), 30)

    const result = await prune({
      ...ctx,
      now: Date.now(),
    })

    expect(result.moved).toHaveLength(0)
    expect(result.trashDir).toBeUndefined()
    expect(result.skipped).toEqual([
      { id: 'claude', path: '.claude.json', reason: 'credentials' },
    ])
    expect(await pathExists(join(home, '.claude.json'))).toBe(true)
  })

  it('skips paths modified within 7 days', async () => {
    temp = await createTempHome({ platform: 'win32' })
    const { ctx, home } = temp
    await mkdir(join(home, '.gemini'))
    await writeFile(join(home, '.gemini', 'settings.json'), '{}')

    const result = await prune({
      ...ctx,
      now: Date.now(),
    })

    expect(result.moved).toHaveLength(0)
    expect(result.skipped.some(skip => skip.reason === 'recent')).toBe(true)
    expect(await pathExists(join(home, '.gemini'))).toBe(true)
  })

  it('moves recent paths when forceRecent is set', async () => {
    temp = await createTempHome({ platform: 'win32' })
    const { ctx, home } = temp
    await mkdir(join(home, '.gemini'))
    await writeFile(join(home, '.gemini', 'settings.json'), '{}')

    const result = await prune({
      ...ctx,
      now: Date.now(),
    }, { forceRecent: true })

    expect(result.moved).toHaveLength(1)
    expect(await pathExists(join(home, '.gemini'))).toBe(false)
  })

  it('never moves symlinks or junctions', async () => {
    temp = await createTempHome({ platform: 'win32' })
    const { ctx, home } = temp
    await mkdir(join(home, 'cloud', 'cursor'), { recursive: true })
    await writeFile(join(home, 'cloud', 'cursor', 'state.json'), '{}')
    await symlink(join(home, 'cloud', 'cursor'), join(home, '.cursor'), process.platform === 'win32'
      ? 'junction'
      : 'dir')
    await age(join(home, 'cloud', 'cursor'), 30)

    const result = await prune({
      ...ctx,
      now: Date.now(),
    })

    expect(result.moved).toHaveLength(0)
    expect(result.skipped.some(skip => skip.reason === 'symlink')).toBe(true)
    expect(await pathExists(join(home, '.cursor'))).toBe(true)
  })
})
