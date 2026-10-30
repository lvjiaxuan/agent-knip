import type { Ctx, Manifest, ManifestItem, RestoreResult, TrashEntry } from './types'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SCHEMA_VERSION } from './constants'
import { errorCode, movePath, pathExists } from './fs'
import { trashRoot } from './prune'

/** Newest first. A trash directory without a readable manifest is reported, not hidden. */
export async function listTrash(ctx: Ctx): Promise<TrashEntry[]> {
  const root = trashRoot(ctx)
  let names: string[]
  try {
    names = await readdir(root)
  }
  catch {
    return []
  }

  const entries: TrashEntry[] = []
  for (const name of names) {
    const dir = join(root, name)
    try {
      const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Manifest
      entries.push({ dir, createdAt: manifest.createdAt, items: manifest.items })
    }
    catch {
      entries.push({
        dir,
        createdAt: 0,
        items: [],
        error: 'manifest missing or unreadable',
      })
    }
  }

  return entries.sort((a, b) => b.createdAt - a.createdAt)
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
        result.failed.push({ path: item.from, reason: 'target already exists' })
        pending.push(item)
        continue
      }

      try {
        await mkdir(dirname(item.from), { recursive: true })
        await movePath(join(entry.dir, ...item.to.split('/')), item.from)
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

    if (pending.length === 0) {
      await rm(entry.dir, { recursive: true, force: true })
      result.trash.push(entry.dir)
    }
    else {
      const manifest: Manifest = { version: SCHEMA_VERSION, createdAt: entry.createdAt, items: pending }
      await writeFile(join(entry.dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    }
  }

  return result
}
