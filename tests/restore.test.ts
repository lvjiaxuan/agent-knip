import type { TempHome } from './test-utils'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listTrash, restore } from '../src/restore'
import { createTempHome } from './test-utils'

vi.mock('node:crypto', async (importOriginal) => {
  const crypto = await importOriginal<typeof import('node:crypto')>()
  return {
    ...crypto,
    randomUUID: vi.fn(crypto.randomUUID),
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    rename: vi.fn(fs.rename),
  }
})

describe('restore', () => {
  let temp: TempHome | undefined

  afterEach(async () => {
    vi.resetAllMocks()
    await temp?.cleanup()
  })

  async function createBatch() {
    temp = await createTempHome()
    const { ctx, home } = temp
    const dir = join(home, '.agent-knip', 'trash', '2026-01-01T00-00-00Z')
    const item = {
      id: 'retired-agent',
      from: join(home, '.legacy'),
      to: 'retired-agent/.legacy',
      kind: 'config',
    }
    const payload = join(dir, 'retired-agent', '.legacy')
    const manifestPath = join(dir, 'manifest.json')
    const manifest = {
      version: 2,
      createdAt: 1,
      items: [item],
    }
    await mkdir(dirname(payload), { recursive: true })
    await writeFile(payload, 'restore')
    await writeFile(manifestPath, JSON.stringify(manifest))
    return {
      ctx,
      home,
      dir,
      item,
      payload,
      manifest,
      manifestPath,
    }
  }

  it('restores a legacy v1 batch without consulting the registry or requiring a location role', async () => {
    const { ctx, dir, item, manifest, manifestPath } = await createBatch()
    await writeFile(manifestPath, JSON.stringify({
      ...manifest,
      version: 1,
      items: [
        { ...item, bytes: 7 },
      ],
    }))

    expect(await restore(ctx)).toEqual({
      restored: [
        { id: item.id, from: item.from },
      ],
      failed: [],
      trash: [dir],
    })
    expect(await readFile(item.from, 'utf8')).toBe('restore')
    await expect(lstat(dir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses an occupied target, retains its manifest, and supports a later retry', async () => {
    const { ctx, dir, item, payload, manifest, manifestPath } = await createBatch()
    await writeFile(item.from, 'keep')

    expect(await restore(ctx)).toEqual({
      restored: [],
      failed: [
        { path: item.from, reason: '目标路径已存在' },
      ],
      trash: [],
    })
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual(manifest)
    expect(await readFile(payload, 'utf8')).toBe('restore')
    expect(await readFile(item.from, 'utf8')).toBe('keep')
    expect((await listTrash(ctx))[0].items).toEqual([item])

    await unlink(item.from)
    expect(await restore(ctx)).toEqual({
      restored: [
        { id: item.id, from: item.from },
      ],
      failed: [],
      trash: [dir],
    })
  })

  it('preserves the original manifest if atomic replacement fails', async () => {
    const { ctx, dir, item, payload, manifestPath } = await createBatch()
    const original = await readFile(manifestPath, 'utf8')
    const uuid = '00000000-0000-4000-8000-000000000000'
    await writeFile(item.from, 'keep')
    vi.mocked(randomUUID).mockReturnValueOnce(uuid)
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('replacement refused'), { code: 'EACCES' }))

    const result = await restore(ctx)

    expect(result.failed).toContainEqual({ path: dir, reason: 'EACCES' })
    expect(await readFile(manifestPath, 'utf8')).toBe(original)
    expect(JSON.parse(await readFile(join(dir, `.manifest-${uuid}.json.tmp`), 'utf8'))).toEqual(JSON.parse(original))
    expect(await readFile(payload, 'utf8')).toBe('restore')
  })

  it('never overwrites a pre-existing manifest temporary file', async () => {
    const { ctx, dir, item, manifestPath } = await createBatch()
    const original = await readFile(manifestPath, 'utf8')
    const uuid = '00000000-0000-4000-8000-000000000000'
    const temporary = join(dir, `.manifest-${uuid}.json.tmp`)
    await writeFile(temporary, 'untracked recovery data')
    await writeFile(item.from, 'keep')
    vi.mocked(randomUUID).mockReturnValueOnce(uuid)

    const result = await restore(ctx)

    expect(result.failed).toContainEqual({ path: dir, reason: 'EEXIST' })
    expect(await readFile(manifestPath, 'utf8')).toBe(original)
    expect(await readFile(temporary, 'utf8')).toBe('untracked recovery data')
  })

  it('treats an occupied target junction as a conflict, not a destination to follow', async () => {
    const { ctx, home, item, payload, manifest, manifestPath } = await createBatch()
    const outside = join(home, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'keep'), 'untouched')
    await symlink(outside, item.from, 'junction')

    expect((await restore(ctx)).failed).toEqual([
      { path: item.from, reason: '目标路径已存在' },
    ])
    expect((await lstat(item.from)).isSymbolicLink()).toBe(true)
    expect(await readFile(payload, 'utf8')).toBe('restore')
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual(manifest)
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('untouched')
  })

  it('retains a missing payload in the manifest for retry', async () => {
    const { ctx, item, payload, manifest, manifestPath } = await createBatch()
    await unlink(payload)

    expect((await restore(ctx)).failed).toEqual([
      { path: item.from, reason: 'ENOENT' },
    ])
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual(manifest)
    await expect(lstat(item.from)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains only conflicted items after a partial restore', async () => {
    const { ctx, home, item, dir, manifest, manifestPath } = await createBatch()
    const conflict = {
      ...item,
      from: join(home, '.occupied'),
      to: 'retired-agent/.occupied',
    }
    await writeFile(join(dir, 'retired-agent', '.occupied'), 'pending')
    await writeFile(conflict.from, 'keep')
    await writeFile(manifestPath, JSON.stringify({
      ...manifest,
      items: [item, conflict],
    }))

    const result = await restore(ctx)

    expect(result.restored).toEqual([
      { id: item.id, from: item.from },
    ])
    expect(result.failed).toEqual([
      { path: conflict.from, reason: '目标路径已存在' },
    ])
    expect(result.trash).toEqual([])
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual({
      ...manifest,
      items: [conflict],
    })
    expect(await readFile(join(dir, 'retired-agent', '.occupied'), 'utf8')).toBe('pending')
  })

  it.each([
    ['version', 3],
    ['version', '1'],
    ['createdAt', 'yesterday'],
    ['createdAt', -1],
    ['items', {}],
    ['items', null],
  ])('rejects malformed manifest %s=%j without changing the batch', async (field, value) => {
    const { ctx, dir, payload, manifest, manifestPath, item } = await createBatch()
    const json = JSON.stringify({ ...manifest, [field as string]: value })
    await writeFile(manifestPath, json)

    const result = await restore(ctx)

    expect(result.restored).toEqual([])
    expect(result.failed).toEqual([
      {
        path: dir,
        reason: expect.stringMatching(/隔离清单/),
      },
    ])
    expect(result.trash).toEqual([])
    expect(await readFile(payload, 'utf8')).toBe('restore')
    expect(await readFile(manifestPath, 'utf8')).toBe(json)
    await expect(lstat(item.from)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['null', '[]', '{', '"manifest"'])('rejects invalid manifest JSON %s', async (json) => {
    const { ctx, payload, manifestPath } = await createBatch()
    await writeFile(manifestPath, json)

    expect((await restore(ctx)).failed[0].reason).toMatch(/隔离清单/)
    expect(await readFile(manifestPath, 'utf8')).toBe(json)
    expect(await readFile(payload, 'utf8')).toBe('restore')
  })

  it.each([
    { id: '' },
    { id: '../agent' },
    { id: 'not an id' },
    { from: 'relative' },
    { kind: 'unknown' },
  ])('rejects malformed item %j before moving any valid item', async (invalid) => {
    const { ctx, item, payload, manifest, manifestPath } = await createBatch()
    const json = JSON.stringify({
      ...manifest,
      items: [
        item,
        {
          ...item,
          ...invalid,
        },
      ],
    })
    await writeFile(manifestPath, json)

    const result = await restore(ctx)

    expect(result.restored).toEqual([])
    expect(result.failed[0].reason).toMatch(/无效/)
    expect(await readFile(payload, 'utf8')).toBe('restore')
    expect(await readFile(manifestPath, 'utf8')).toBe(json)
    await expect(lstat(item.from)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([null, false, 'item', {}])('rejects non-item entry %j', async (invalid) => {
    const { ctx, item, payload, manifest, manifestPath } = await createBatch()
    await writeFile(manifestPath, JSON.stringify({
      ...manifest,
      items: [item, invalid],
    }))

    expect((await restore(ctx)).restored).toEqual([])
    expect(await readFile(payload, 'utf8')).toBe('restore')
  })

  it('rejects an absolute but non-normalized destination without creating its parents', async () => {
    const { ctx, home, item, payload, manifest, manifestPath } = await createBatch()
    const from = `${join(home, 'new-parent')}/../.legacy`
    await writeFile(manifestPath, JSON.stringify({
      ...manifest,
      items: [
        { ...item, from },
      ],
    }))

    expect((await restore(ctx)).failed[0].reason).toMatch(/无效/)
    expect(await readFile(payload, 'utf8')).toBe('restore')
    await expect(lstat(join(home, 'new-parent'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    '',
    '..',
    '../outside',
    'agent/../outside',
    '/absolute',
    '\\absolute',
    'agent\\payload',
    'C:/outside',
    'C:outside',
    'agent//payload',
    './payload',
    'agent/.',
    'agent/',
    'agent/file:stream',
    'agent/NUL',
    'agent/file.',
  ])('rejects non-portable payload path %j before any mutation', async (to) => {
    const { ctx, home, item, payload, manifest, manifestPath } = await createBatch()
    const outside = join(home, 'outside')
    await writeFile(outside, 'untouched')
    const json = JSON.stringify({
      ...manifest,
      items: [
        item,
        {
          ...item,
          to,
          from: join(home, 'new-parent', 'target'),
        },
      ],
    })
    await writeFile(manifestPath, json)

    const result = await restore(ctx)

    expect(result.restored).toEqual([])
    expect(result.failed[0].reason).toMatch(/无效/)
    expect(await readFile(payload, 'utf8')).toBe('restore')
    expect(await readFile(outside, 'utf8')).toBe('untouched')
    expect(await readFile(manifestPath, 'utf8')).toBe(json)
    await expect(lstat(join(home, 'new-parent'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['manifest.json', 'retired-agent', 'retired-agent/.legacy'])('rejects manifest-as-payload and overlapping payload %s', async (to) => {
    const { ctx, item, payload, manifest, manifestPath } = await createBatch()
    await writeFile(manifestPath, JSON.stringify({
      ...manifest,
      items: [
        item,
        { ...item, to },
      ],
    }))

    expect((await restore(ctx)).restored).toEqual([])
    expect(await readFile(payload, 'utf8')).toBe('restore')
  })

  it.each([
    'batch',
    'trash-root',
    'payload-ancestor',
  ])('rejects a linked %s without following the junction', async (linked) => {
    const { ctx, home, dir, item, payload } = await createBatch()
    const outside = join(home, 'outside')
    const link = linked === 'batch'
      ? dir
      : linked === 'trash-root'
        ? dirname(dir)
        : linked === 'payload-ancestor'
          ? dirname(payload)
          : payload
    await rename(link, outside)
    await symlink(outside, link, 'junction')

    const result = await restore(ctx)

    expect(result.restored).toEqual([])
    expect(result.failed[0].reason).toMatch(/符号链接|目录联接/)
    expect(result.trash).toEqual([])
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    await expect(lstat(item.from)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await lstat(outside)).isDirectory()).toBe(true)
  })

  it('restores a linked payload without touching its target', async () => {
    const { ctx, home, dir, item, payload } = await createBatch()
    const outside = join(home, 'outside')
    await unlink(payload)
    await mkdir(outside)
    await writeFile(join(outside, 'keep'), 'untouched')
    await symlink(outside, payload, 'junction')

    const result = await restore(ctx)

    expect(result.restored).toEqual([
      {
        id: item.id,
        from: item.from,
      },
    ])
    expect((await lstat(item.from)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('untouched')
    await expect(lstat(dir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a manifest junction without entering its target directory', async () => {
    const { ctx, home, manifestPath, payload } = await createBatch()
    const outside = join(home, 'outside-manifest')
    await mkdir(outside)
    await writeFile(join(outside, 'keep'), 'untouched')
    await unlink(manifestPath)
    await symlink(outside, manifestPath, 'junction')

    expect((await restore(ctx)).failed[0].reason).toMatch(/符号链接|目录联接/)
    expect((await lstat(manifestPath)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('untouched')
    expect(await readFile(payload, 'utf8')).toBe('restore')
  })

  it('rejects a later linked payload before moving the first valid item', async () => {
    const { ctx, home, dir, item, payload, manifest, manifestPath } = await createBatch()
    const outside = join(home, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'keep'), 'untouched')
    await symlink(outside, join(dir, 'other'), 'junction')
    const json = JSON.stringify({
      ...manifest,
      items: [
        item,
        {
          ...item,
          from: join(home, '.other'),
          to: 'other/keep',
        },
      ],
    })
    await writeFile(manifestPath, json)

    expect((await restore(ctx)).restored).toEqual([])
    expect(await readFile(payload, 'utf8')).toBe('restore')
    expect(await readFile(manifestPath, 'utf8')).toBe(json)
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('untouched')
    await expect(lstat(item.from)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a linked manifest without reading or replacing its target', async (context) => {
    const { ctx, home, manifestPath, payload } = await createBatch()
    const outside = join(home, 'outside-manifest.json')
    await rename(manifestPath, outside)
    const json = await readFile(outside, 'utf8')
    try {
      await symlink(outside, manifestPath, 'file')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip('file symlinks require Windows developer mode or elevated privileges')
      }
      throw error
    }

    expect((await restore(ctx)).failed[0].reason).toMatch(/符号链接|目录联接/)
    expect(await readFile(outside, 'utf8')).toBe(json)
    expect(await readFile(payload, 'utf8')).toBe('restore')
    expect((await lstat(manifestPath)).isSymbolicLink()).toBe(true)
  })

  it('rejects a destination ancestor junction before moving any item', async () => {
    const { ctx, home, item, payload, manifest, manifestPath } = await createBatch()
    const outside = join(home, 'outside')
    const redirect = join(home, 'redirect')
    await mkdir(outside)
    await symlink(outside, redirect, 'junction')
    const target = join(redirect, 'target')
    const json = JSON.stringify({
      ...manifest,
      items: [
        item,
        { ...item, from: target, to: 'other/payload' },
      ],
    })
    await writeFile(manifestPath, json)

    expect((await restore(ctx)).restored).toEqual([])
    expect(await readFile(payload, 'utf8')).toBe('restore')
    expect(await readFile(manifestPath, 'utf8')).toBe(json)
    await expect(lstat(join(outside, 'target'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([true, false])('preserves orphan payload when items are empty: %s', async (emptyItems) => {
    const { ctx, dir, item, payload, manifest, manifestPath } = await createBatch()
    const orphan = join(dir, 'orphan.txt')
    await writeFile(orphan, 'do not erase')
    if (emptyItems) {
      await writeFile(manifestPath, JSON.stringify({ ...manifest, items: [] }))
    }

    const result = await restore(ctx)

    expect(result.restored).toEqual(emptyItems
      ? []
      : [
          { id: item.id, from: item.from },
        ])
    expect(result.failed).toEqual([
      {
        path: dir,
        reason: expect.stringMatching(/未登记的数据/),
      },
    ])
    expect(result.trash).toEqual([])
    expect(await readFile(orphan, 'utf8')).toBe('do not erase')
    await expect(lstat(manifestPath)).rejects.toMatchObject({ code: 'ENOENT' })
    if (emptyItems) {
      expect(await readFile(payload, 'utf8')).toBe('restore')
    }
  })

  it('does not follow or erase an untracked junction during cleanup', async () => {
    const { ctx, home, dir } = await createBatch()
    const outside = join(home, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'keep'), 'untouched')
    const link = join(dir, 'untracked')
    await symlink(outside, link, 'junction')

    expect((await restore(ctx)).failed[0].reason).toMatch(/未登记的数据/)
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('untouched')
  })

  it('removes only the consumed manifest and empty directories for an empty batch', async () => {
    const { ctx, dir, payload, manifest, manifestPath } = await createBatch()
    await unlink(payload)
    await mkdir(join(dir, 'empty', 'nested'), { recursive: true })
    await writeFile(manifestPath, JSON.stringify({ ...manifest, items: [] }))

    expect(await restore(ctx)).toEqual({
      restored: [],
      failed: [],
      trash: [dir],
    })
    await expect(lstat(dir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a trash entry whose manifest is missing without erasing payload', async () => {
    const { ctx, dir, payload, manifestPath } = await createBatch()
    await unlink(manifestPath)

    const entries = await listTrash(ctx)
    expect(entries).toHaveLength(1)
    expect(entries[0].error).toMatch(/隔离清单/)
    expect((await restore(ctx)).failed).toEqual([
      {
        path: dir,
        reason: expect.stringMatching(/隔离清单/),
      },
    ])
    expect(await readFile(payload, 'utf8')).toBe('restore')
  })

  it('is a no-op when the trash is empty', async () => {
    temp = await createTempHome()

    expect(await listTrash(temp.ctx)).toEqual([])
    expect(await restore(temp.ctx)).toEqual({ restored: [], failed: [], trash: [] })
  })
})
