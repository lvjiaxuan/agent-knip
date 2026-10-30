import type { AgentReport, Ctx, Manifest, ManifestItem, PathReport, PruneOptions, PruneResult, Skip } from './types'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SCHEMA_VERSION, TRASH_DIR, TRASH_SUBDIR } from './constants'
import { errorCode, movePath, pathExists } from './fs'
import { pruneBlockReason, scan } from './scan'

/** `2026-10-30T08-40-12Z`: sortable, no colons (Windows-safe). */
function trashStamp(now: number): string {
  return new Date(now).toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')
}

export function trashRoot(ctx: Ctx): string {
  return join(ctx.home, TRASH_DIR, TRASH_SUBDIR)
}

/**
 * Move every prunable path of a fresh scan into the trash, then write the
 * manifest. Nothing is deleted: `restore` can always put it back.
 */
export async function prune(ctx: Ctx, options: PruneOptions = {}): Promise<PruneResult> {
  const reports = await scan(ctx, { agent: options.agent })
  const root = join(trashRoot(ctx), trashStamp(ctx.now))
  const skipped: Skip[] = []
  const candidates: { report: AgentReport, path: PathReport }[] = []

  for (const report of reports) {
    for (const path of report.paths) {
      const reason = pruneBlockReason(report.state, path, ctx.now, options.forceRecent)
      if (reason) {
        skipped.push({ id: report.agent.id, path: path.path, reason })
      }
      else {
        candidates.push({ report, path })
      }
    }
  }

  if (candidates.length === 0) {
    return { moved: [], skipped }
  }

  await mkdir(root, { recursive: true })
  const moved: ManifestItem[] = []

  for (const { report, path } of candidates) {
    const to = `${report.agent.id}/${path.path}`
    const target = join(root, ...to.split('/'))
    const from = join(ctx.home, ...path.path.split('/'))

    if (await pathExists(target)) {
      skipped.push({ id: report.agent.id, path: path.path, reason: 'already in trash' })
      continue
    }

    try {
      await mkdir(dirname(target), { recursive: true })
      await movePath(from, target)
      moved.push({
        id: report.agent.id,
        from,
        to,
        kind: path.kind,
        bytes: path.bytes,
      })
    }
    catch (error) {
      skipped.push({ id: report.agent.id, path: path.path, reason: `move failed: ${errorCode(error)}` })
    }
  }

  if (moved.length === 0) {
    await rm(root, { recursive: true, force: true })
    return { moved, skipped }
  }

  const manifest: Manifest = { version: SCHEMA_VERSION, createdAt: ctx.now, items: moved }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return { trashDir: root, moved, skipped }
}
