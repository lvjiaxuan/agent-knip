import type { AgentReport, Ctx, Manifest, ManifestItem, PathReport, PruneOptions, PruneResult, Skip } from './types'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SCHEMA_VERSION, TRASH_DIR, TRASH_SUBDIR } from './constants'
import { resolveAgentPath } from './context'
import { errorCode, movePath, pathExists } from './fs'
import { pruneBlockReason, scan } from './scan'

interface Candidate {
  report: AgentReport
  path: PathReport
}

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
  const candidates = collectCandidates(reports, ctx.now, options.forceRecent, skipped)

  if (candidates.length === 0) {
    return { moved: [], skipped }
  }

  await mkdir(root, { recursive: true })
  const moved = await moveCandidates(ctx, root, candidates, skipped)

  if (moved.length === 0) {
    await rm(root, { recursive: true, force: true })
    return { moved, skipped }
  }

  const manifest: Manifest = { version: SCHEMA_VERSION, createdAt: ctx.now, items: moved }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return { trashDir: root, moved, skipped }
}

function collectCandidates(
  reports: AgentReport[],
  now: number,
  forceRecent: boolean | undefined,
  skipped: Skip[],
): Candidate[] {
  const candidates: Candidate[] = []
  for (const report of reports) {
    for (const path of report.paths) {
      const reason = pruneBlockReason(report.state, path, now, forceRecent)
      if (reason) {
        skipped.push(skipOf(report, path, reason))
      }
      else {
        candidates.push({ report, path })
      }
    }
  }
  return candidates
}

async function moveCandidates(ctx: Ctx, root: string, candidates: Candidate[], skipped: Skip[]): Promise<ManifestItem[]> {
  const moved: ManifestItem[] = []
  for (const { report, path } of candidates) {
    const to = trashPath(report, path)
    const target = join(root, ...to.split('/'))
    const from = resolveAgentPath(ctx, path)

    if (!from) {
      skipped.push(skipOf(report, path, 'path base unavailable'))
      continue
    }
    if (await pathExists(target)) {
      skipped.push(skipOf(report, path, 'already in trash'))
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
      skipped.push(skipOf(report, path, `move failed: ${errorCode(error)}`))
    }
  }
  return moved
}

function skipOf(report: AgentReport, path: PathReport, reason: string): Skip {
  return {
    id: report.agent.id,
    path: path.path,
    ...(path.base
      ? { base: path.base }
      : {}),
    reason,
  }
}

function trashPath(report: AgentReport, path: PathReport): string {
  return path.base
    ? `${report.agent.id}/${path.base}/${path.path}`
    : `${report.agent.id}/${path.path}`
}
