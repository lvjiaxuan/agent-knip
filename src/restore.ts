import type { Ctx, Manifest, ManifestItem, RestoreResult, TrashEntry } from './types'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { MANIFEST_VERSION } from './constants'
import { errorCode, movePath, pathExists } from './fs'
import { trashRoot } from './prune'

/** Newest first. Invalid or linked batches are reported without following them. */
export async function listTrash(ctx: Ctx): Promise<TrashEntry[]> {
  const root = trashRoot(ctx)
  let names: string[]
  try {
    await assertNoLinks(root, true)
    names = await readdir(root)
  }
  catch (error) {
    return errorCode(error) === 'ENOENT'
      ? []
      : [
          {
            dir: root,
            createdAt: 0,
            items: [],
            error: errorCode(error),
          },
        ]
  }

  const entries: TrashEntry[] = []
  for (const name of names) {
    const dir = join(root, name)
    try {
      await assertNoLinks(dir)
      const manifestPath = join(dir, 'manifest.json')
      await assertNoLinks(manifestPath)
      if (!(await lstat(manifestPath)).isFile()) {
        throw new Error('隔离清单不是普通文件')
      }
      const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')), dir)
      // Validate every item before the first move or manifest rewrite in this batch.
      for (const item of manifest.items) {
        await assertNoLinks(payloadPath(dir, item), true, true)
        await assertNoLinks(dirname(item.from), true)
      }
      entries.push({ dir, createdAt: manifest.createdAt, items: manifest.items })
    }
    catch (error) {
      entries.push({
        dir,
        createdAt: 0,
        items: [],
        error: `隔离清单或隔离数据无效：${errorCode(error)}`,
      })
    }
  }

  return entries.sort((a, b) => b.createdAt - a.createdAt)
}

function validateManifest(value: unknown, dir: string): Manifest {
  if (!value || typeof value !== 'object') {
    throw new Error('隔离清单无效')
  }
  const manifest = value as Partial<Manifest>
  if (![1, MANIFEST_VERSION].includes(manifest.version!)
    || typeof manifest.createdAt !== 'number' || !Number.isFinite(manifest.createdAt) || manifest.createdAt < 0
    || !Array.isArray(manifest.items)) {
    throw new Error('隔离清单的版本、创建时间或条目列表无效')
  }
  const sources: string[] = []
  for (const item of manifest.items) {
    if (!item || typeof item !== 'object'
      || typeof item.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)
      || typeof item.from !== 'string' || item.from.includes('\0')
      || !isAbsolute(item.from) || normalize(item.from) !== item.from || resolve(item.from) !== item.from
      || typeof item.to !== 'string' || !portableRelative(item.to)
      || ![
        'config',
        'history',
        'cache',
        'credentials',
      ].includes(item.kind)) {
      throw new Error('隔离清单条目无效')
    }
    const source = payloadPath(dir, item)
    const inside = relative(dir, source)
    const sourceKey = sep === '\\'
      ? source.toLowerCase()
      : source
    const manifestKey = sep === '\\'
      ? join(dir, 'manifest.json').toLowerCase()
      : join(dir, 'manifest.json')
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)
      || sourceKey === manifestKey
      || sources.some(other => sourceKey === other || sourceKey.startsWith(`${other}${sep}`) || other.startsWith(`${sourceKey}${sep}`))) {
      throw new Error('隔离数据路径无效或相互重叠')
    }
    sources.push(sourceKey)
  }
  return manifest as Manifest
}

function portableRelative(path: string): boolean {
  return path.length > 0
    && !/[<>:"\\|?*\p{Cc}]/u.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..'
      && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
}

function payloadPath(dir: string, item: ManifestItem): string {
  return join(dir, ...item.to.split('/'))
}

/** Check from the filesystem root down, never lstat through an unchecked link. */
async function assertNoLinks(path: string, allowMissing = false, allowLeafLink = false): Promise<void> {
  const target = resolve(path)
  const ancestors: string[] = []
  for (let current = target; ; current = dirname(current)) {
    ancestors.push(current)
    if (dirname(current) === current) {
      break
    }
  }
  for (const ancestor of ancestors.reverse()) {
    try {
      await assertNoLink(ancestor, target, allowLeafLink)
    }
    catch (error) {
      if (allowMissing && errorCode(error) === 'ENOENT') {
        return
      }
      throw error
    }
  }
}

async function assertNoLink(path: string, target: string, allowLeafLink: boolean): Promise<void> {
  if (!(await lstat(path)).isSymbolicLink() || (allowLeafLink && path === target)) {
    return
  }
  throw new Error(`拒绝访问符号链接或目录联接：${path}`)
}

/** Remove directories only if empty; files and links are untracked payload. */
async function removeEmptyDirectories(dir: string): Promise<boolean> {
  await assertNoLinks(dir)
  for (const name of await readdir(dir)) {
    const path = join(dir, name)
    const stats = await lstat(path)
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      await removeEmptyDirectories(path)
    }
  }
  try {
    await rmdir(dir)
    return true
  }
  catch (error) {
    if (errorCode(error) === 'ENOTEMPTY' || errorCode(error) === 'EEXIST') {
      return false
    }
    throw error
  }
}

async function finishBatch(entry: TrashEntry, pending: ManifestItem[], result: RestoreResult): Promise<void> {
  const manifestPath = join(entry.dir, 'manifest.json')
  await assertNoLinks(manifestPath)
  if (pending.length > 0) {
    const manifest: Manifest = { version: MANIFEST_VERSION, createdAt: entry.createdAt, items: pending }
    const temporary = join(entry.dir, `.manifest-${randomUUID()}.json.tmp`)
    // Never truncate recovery metadata; retain failed snapshots for inspection.
    await writeFile(temporary, JSON.stringify(manifest, null, 2), { flag: 'wx', flush: true })
    await assertNoLinks(manifestPath)
    await rename(temporary, manifestPath)
    return
  }
  await unlink(manifestPath)
  if (await removeEmptyDirectories(entry.dir)) {
    result.trash.push(entry.dir)
  }
  else {
    result.failed.push({ path: entry.dir, reason: '隔离区中仍有未登记的数据' })
  }
}

/**
 * Put every trash item back. An occupied target path is refused, never
 * merged or overwritten; the item stays in the manifest so it can be retried.
 */
export async function restore(ctx: Ctx): Promise<RestoreResult> {
  const entries = await listTrash(ctx)
  const result: RestoreResult = { restored: [], failed: [], trash: [] }

  for (const entry of entries) {
    if (entry.error) {
      result.failed.push({ path: entry.dir, reason: entry.error })
      continue
    }

    const pending: ManifestItem[] = []

    for (const item of entry.items) {
      if (await pathExists(item.from)) {
        result.failed.push({ path: item.from, reason: '目标路径已存在' })
        pending.push(item)
        continue
      }

      try {
        await assertNoLinks(payloadPath(entry.dir, item), false, true)
        await assertNoLinks(dirname(item.from), true)
        await mkdir(dirname(item.from), { recursive: true })
        await movePath(payloadPath(entry.dir, item), item.from)
        result.restored.push({ id: item.id, from: item.from })
      }
      catch (error) {
        result.failed.push({
          path: item.from,
          reason: errorCode(error),
        })
        pending.push(item)
      }
    }

    try {
      await finishBatch(entry, pending, result)
    }
    catch (error) {
      result.failed.push({
        path: entry.dir,
        reason: errorCode(error),
      })
    }
  }

  return result
}
