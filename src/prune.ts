import type { AgentReport, Ctx, Manifest, ManifestItem, PathReport, PruneOptions, PruneResult, Skip } from './types'
import { lstat, mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { MANIFEST_VERSION, METADATA_BUDGET_MS, TRASH_DIR, TRASH_SUBDIR } from './constants'
import { errorCode, inspectTree, movePath, pathExists } from './fs'
import { hasLinkedAncestor, resolveLocation } from './locations'
import { pruneBlockReason } from './policy'
import { scan } from './scan'

interface Candidate {
  report: AgentReport
  path: PathReport
}

export function trashRoot(ctx: Ctx): string {
  return join(ctx.home, TRASH_DIR, TRASH_SUBDIR)
}

/** Fresh scan and the same eligibility gate as the preview; no report is trusted as input. */
export async function prune(ctx: Ctx, options: PruneOptions): Promise<PruneResult> {
  if (typeof options?.agent !== 'string' || !options.agent) {
    throw new Error('prune 必须指定一个 agent')
  }
  const reports = await scan(ctx, { agent: options.agent })
  const skipped: Skip[] = []
  const candidates = collectCandidates(reports, ctx.now, options.forceRecent, skipped)
  if (candidates.length === 0) {
    return { moved: [], skipped }
  }

  const trash = resolveLocation(ctx, { path: `${TRASH_DIR}/${TRASH_SUBDIR}` })!
  if (await hasLinkedAncestor(trash) || await isLink(trash.path)) {
    throw new Error('拒绝使用符号链接或目录联接作为隔离区目录')
  }
  await mkdir(trash.path, { recursive: true })
  const stamp = new Date(ctx.now).toISOString().replace(/[:.]/g, '-')
  const root = await mkdtemp(join(trash.path, `${stamp}-`))
  const moved = await moveCandidates(ctx, root, candidates, skipped, options.forceRecent)
  return { trashDir: root, moved, skipped }
}

function collectCandidates(reports: AgentReport[], now: number, forceRecent: boolean | undefined, skipped: Skip[]): Candidate[] {
  const candidates: Candidate[] = []
  for (const report of reports) {
    for (const path of report.paths) {
      const reason = pruneBlockReason(report, path, now, forceRecent)
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

async function moveCandidates(ctx: Ctx, root: string, candidates: Candidate[], skipped: Skip[], forceRecent?: boolean): Promise<ManifestItem[]> {
  const moved: ManifestItem[] = []
  const manifest: Manifest = { version: MANIFEST_VERSION, createdAt: ctx.now, items: [] }
  for (const { report, path } of candidates) {
    const from = await revalidate(ctx, report, path, forceRecent)
    if (!from) {
      skipped.push(skipOf(report, path, '源路径在扫描后发生变化，请重新检查'))
      continue
    }
    const prefix = path.env ?? path.base
    const to = prefix
      ? `${report.agent.id}/${prefix}/${path.path}`
      : `${report.agent.id}/${path.path}`
    const item = {
      id: report.agent.id,
      from,
      to,
      kind: path.kind,
    }
    const target = join(root, ...to.split('/'))
    if (await pathExists(target)) {
      skipped.push(skipOf(report, path, '隔离区中已存在同名路径'))
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    manifest.items.push(item)
    // Persist the recovery intent BEFORE rename; a crash never strands an unrecorded payload.
    await saveManifest(root, manifest)
    try {
      await movePath(from, target)
      moved.push(item)
    }
    catch (error) {
      manifest.items.pop()
      await saveManifest(root, manifest)
      skipped.push(skipOf(report, path, `移动失败：${errorCode(error)}`))
    }
  }
  return moved
}

async function revalidate(ctx: Ctx, report: AgentReport, path: PathReport, forceRecent?: boolean): Promise<string | undefined> {
  const location = report.agent.locations.find(location => location.role === 'data' && location.path === path.path && location.base === path.base)
  if (!location) {
    return undefined
  }
  const resolved = resolveLocation(ctx, location)
  if (!resolved || resolved.path !== path.resolvedPath || await hasLinkedAncestor(resolved)) {
    return undefined
  }
  const fresh = await inspectTree(resolved.path, Date.now() + METADATA_BUDGET_MS)
  if (!fresh.exists || pruneBlockReason(report, {
    ...path,
    ...fresh,
  }, ctx.now, forceRecent)) {
    return undefined
  }
  for (const file of location.protectedFiles ?? []) {
    if (await pathExists(join(resolved.path, file))) {
      return undefined
    }
  }
  return resolve(resolved.path)
}

async function saveManifest(root: string, manifest: Manifest): Promise<void> {
  const temporary = join(root, 'manifest.json.tmp')
  await writeFile(temporary, JSON.stringify(manifest, null, 2), { flush: true })
  await rename(temporary, join(root, 'manifest.json'))
}

async function isLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink()
  }
  catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return false
    }
    throw error
  }
}

function skipOf(report: AgentReport, path: PathReport, reason: string): Skip {
  return {
    id: report.agent.id,
    path: path.path,
    ...(path.base
      ? { base: path.base }
      : {}),
    ...(path.env
      ? { env: path.env }
      : {}),
    reason,
  }
}
