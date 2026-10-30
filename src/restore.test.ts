import type { TempHome } from './test-utils'
import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prune } from './prune'
import { listTrash, restore } from './restore'
import { createTempHome } from './test-utils'

const DAY = 24 * 60 * 60 * 1000

describe('restore', () => {
  let temp: TempHome | undefined

  afterEach(async () => {
    await temp?.cleanup()
  })

  it('refuses an occupied target and keeps the entry for a retry', async () => {
    temp = await createTempHome({ platform: 'win32' })
    const { ctx, home } = temp
    const old = new Date(Date.now() - 8 * DAY)
    await mkdir(join(home, '.gemini'))
    await writeFile(join(home, '.gemini', 'settings.json'), '{}')
    await utimes(join(home, '.gemini', 'settings.json'), old, old)
    await utimes(join(home, '.gemini'), old, old)

    await prune({
      ...ctx,
      now: Date.now(),
    })
    await mkdir(join(home, '.gemini'))
    await writeFile(join(home, '.gemini', 'mine.txt'), 'keep')

    const result = await restore(ctx)

    expect(result.restored).toHaveLength(0)
    expect(result.failed).toEqual([
      {
        path: join(home, '.gemini'),
        reason: 'target already exists',
      },
    ])
    const entries = await listTrash(ctx)
    expect(entries).toHaveLength(1)
    expect(entries[0].items).toHaveLength(1)
  })

  it('reports a trash entry whose manifest is missing', async () => {
    temp = await createTempHome({ platform: 'win32' })
    const { ctx, home } = temp
    const dir = join(home, '.agent-knip', 'trash', '2026-01-01T00-00-00Z')
    await mkdir(join(dir, 'gemini', '.gemini'), { recursive: true })

    const entries = await listTrash(ctx)
    expect(entries).toHaveLength(1)
    expect(entries[0].error).toMatch(/manifest/)

    const result = await restore(ctx)
    expect(result.failed[0].reason).toMatch(/manifest/)
    expect(result.trash).toEqual([])
  })

  it('is a no-op when the trash is empty', async () => {
    temp = await createTempHome({ platform: 'win32' })

    expect(await listTrash(temp.ctx)).toEqual([])
    expect(await restore(temp.ctx)).toEqual({ restored: [], failed: [], trash: [] })
  })
})
