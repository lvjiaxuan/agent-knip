import type { TempHome } from './test-utils'
import { mkdir, readFile, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pathExists } from '../src/fs'
import { prune } from '../src/prune'
import { listTrash, restore } from '../src/restore'
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

  it('rejects calls without a single agent before creating quarantine data', async () => {
    temp = await createTempHome({ platform: 'win32' })
    const { ctx, home } = temp
    // @ts-expect-error JavaScript callers can omit the required options.
    await expect(prune(ctx)).rejects.toThrow('prune 必须指定一个 agent')
    // @ts-expect-error JavaScript callers can omit the required selector.
    await expect(prune(ctx, {})).rejects.toThrow('prune 必须指定一个 agent')
    await expect(prune(ctx, { agent: '' })).rejects.toThrow('prune 必须指定一个 agent')
    await expect(prune(ctx, { agent: 'claude,gemini' })).rejects.toThrow('未知 agent')
    expect(await pathExists(join(home, '.agent-knip'))).toBe(false)
  })

  it('moves only the explicitly selected agent when other candidates exist', async () => {
    temp = await createTempHome({ platform: 'win32' })
    const { ctx, home } = temp
    await mkdir(join(home, '.claude'))
    await mkdir(join(home, '.gemini'))
    await writeFile(join(home, '.gemini', 'session'), 'keep me')

    const result = await prune(ctx, { agent: 'claude', forceRecent: true })

    expect(result.moved.map(item => item.id)).toEqual(['claude'])
    expect(await pathExists(join(home, '.claude'))).toBe(false)
    expect(await readFile(join(home, '.gemini', 'session'), 'utf8')).toBe('keep me')
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
    }, { agent: 'claude' })

    expect(result.moved).toHaveLength(1)
    expect(result.trashDir).toBeTruthy()
    expect(await pathExists(join(home, '.claude'))).toBe(false)

    const manifest = JSON.parse(await readFile(join(result.trashDir!, 'manifest.json'), 'utf8'))
    expect(manifest.version).toBe(2)
    expect(manifest.items[0]).not.toHaveProperty('bytes')
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
    }, { agent: 'claude' })

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
    }, { agent: 'gemini' })

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
    }, { agent: 'gemini', forceRecent: true })

    expect(result.moved).toHaveLength(1)
    expect(await pathExists(join(home, '.gemini'))).toBe(false)
  })

  it('prunes and restores an environment-based path', async () => {
    temp = await createTempHome({ platform: 'win32' })
    const { ctx, home } = temp
    const appdata = join(home, 'AppData', 'Roaming')
    await mkdir(join(appdata, 'Zed'), { recursive: true })
    await writeFile(join(appdata, 'Zed', 'settings.json'), '{"theme":"dark"}')
    await age(join(appdata, 'Zed', 'settings.json'), 30)
    await age(join(appdata, 'Zed'), 30)

    const result = await prune({
      ...ctx,
      env: {
        ...ctx.env,
        APPDATA: appdata,
        LOCALAPPDATA: join(home, 'AppData', 'Local'),
      },
      now: Date.now(),
    }, { agent: 'zed' })

    expect(result.moved).toHaveLength(1)
    expect(result.moved[0].from).toBe(join(appdata, 'Zed'))
    expect(result.moved[0].to).toBe('zed/APPDATA/Zed')
    expect(await pathExists(join(appdata, 'Zed'))).toBe(false)

    const restored = await restore({
      ...ctx,
      env: {
        ...ctx.env,
        APPDATA: appdata,
        LOCALAPPDATA: join(home, 'AppData', 'Local'),
      },
    })

    expect(restored.restored).toHaveLength(1)
    expect(await readFile(join(appdata, 'Zed', 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
  })

  it('moves a symlink entry without touching its target, then restores it', async () => {
    temp = await createTempHome({ platform: 'win32' })
    const { ctx, home } = temp
    const target = join(home, 'cloud', 'cursor')
    const link = join(home, '.claude')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'state.json'), '{}')
    await symlink(target, link, process.platform === 'win32'
      ? 'junction'
      : 'dir')
    const result = await prune({
      ...ctx,
      now: Date.now(),
    }, { agent: 'claude', forceRecent: true })

    expect(result.moved).toHaveLength(1)
    expect(await pathExists(link)).toBe(false)
    expect(await readFile(join(target, 'state.json'), 'utf8')).toBe('{}')

    const restored = await restore(ctx)
    expect(restored.restored).toHaveLength(1)
    expect(await pathExists(link)).toBe(true)
    expect(await readFile(join(target, 'state.json'), 'utf8')).toBe('{}')
  })
})
