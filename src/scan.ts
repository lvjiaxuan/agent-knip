import type { AgentReport, AgentSpec, Ctx, PathReport, PathSpec, ProbeFn, ScanOptions } from './types'
import { join } from 'node:path'
import { agents } from './agents'
import { RECENT_WINDOW_MS, SIZE_BUDGET_MS, WEIGHT } from './constants'
import { findBinary } from './detect/binary'
import { findPackageRecord } from './detect/packages'
import { probeBinary } from './detect/probe'
import { isDirectorySync, measurePath } from './fs'

interface Inspection {
  evidence: string[]
  score: number
  state: AgentReport['state']
  reason?: string
}

export async function scan(ctx: Ctx, options: ScanOptions = {}): Promise<AgentReport[]> {
  const specs = options.agent
    ? agents.filter(agent => agent.id === options.agent)
    : agents
  const probe = options.probe ?? probeBinary
  const reports: AgentReport[] = []

  for (const spec of specs) {
    const report = await inspectAgent(ctx, spec, probe)
    if (report) {
      reports.push(report)
    }
  }

  return reports
}

async function inspectAgent(ctx: Ctx, spec: AgentSpec, probe: ProbeFn): Promise<AgentReport | undefined> {
  const paths = await collectPaths(ctx, spec)
  if (paths.length === 0) {
    return undefined
  }

  const inspection = await collectEvidence(ctx, spec, probe, paths)
  const skips = [
    ...new Set(paths.map(path => pruneBlockReason(inspection.state, path, ctx.now)).filter(Boolean)),
  ] as string[]

  return {
    agent: spec,
    ...inspection,
    paths,
    bytes: paths.reduce((total, path) => total + path.bytes, 0),
    skips,
  }
}

async function collectPaths(ctx: Ctx, spec: AgentSpec): Promise<PathReport[]> {
  const deadline = Date.now() + SIZE_BUDGET_MS
  const paths: PathReport[] = []

  for (const specPath of spec.paths) {
    const measured = await measurePath(toAbsolute(ctx, specPath), deadline)
    if (!measured.exists) {
      continue
    }
    paths.push({
      path: specPath.path,
      type: specPath.type,
      kind: specPath.kind,
      bytes: measured.bytes,
      sizeComplete: measured.complete,
      modifiedAt: measured.modifiedAt,
      symlink: measured.symlink,
      ...(measured.error
        ? { error: measured.error }
        : {}),
    })
  }

  return paths
}

async function collectEvidence(ctx: Ctx, spec: AgentSpec, probe: ProbeFn, paths: PathReport[]): Promise<Inspection> {
  const evidence: string[] = []
  let score = 0

  const packageRecord = findPackageRecord(ctx, spec)
  if (packageRecord) {
    evidence.push(packageRecord)
    score += WEIGHT.packages
  }

  const app = findApp(ctx, spec)
  if (app) {
    evidence.push(`app:${app}`)
    score += WEIGHT.app
  }

  const bin = findBinary(ctx, spec.bins)
  if (bin) {
    evidence.push(`bin:${bin.path}`)
    score += WEIGHT.bin
  }

  if (packageRecord || app) {
    return { evidence, score, state: 'installed' }
  }

  if (bin) {
    if (!bin.probeable || await probe(bin.path)) {
      return { evidence, score: score + WEIGHT.probe, state: 'installed' }
    }
    return {
      evidence,
      score,
      state: 'unknown',
      reason: 'bin found, --version failed',
    }
  }

  if (paths.some(path => path.error || !path.sizeComplete)) {
    return {
      evidence,
      score,
      state: 'unknown',
      reason: 'path could not be fully read',
    }
  }

  return { evidence, score, state: 'configured' }
}

/**
 * The single source of truth for "may this path be moved?". Used by scan
 * (for display), prune and format.
 */
export function pruneBlockReason(
  state: AgentReport['state'],
  path: Pick<PathReport, 'kind' | 'symlink' | 'error' | 'sizeComplete' | 'modifiedAt'>,
  now: number,
  forceRecent = false,
): string | undefined {
  if (state === 'installed') {
    return 'installed'
  }
  if (state === 'unknown') {
    return 'unknown'
  }
  if (path.kind === 'credentials') {
    return 'credentials'
  }
  if (path.symlink) {
    return 'symlink'
  }
  if (path.error || !path.sizeComplete) {
    return 'unreadable'
  }
  if (!forceRecent && now - path.modifiedAt < RECENT_WINDOW_MS) {
    return 'recent'
  }
}

function toAbsolute(ctx: Ctx, spec: PathSpec): string {
  return join(ctx.home, ...spec.path.split('/'))
}

function findApp(ctx: Ctx, spec: AgentSpec): string | undefined {
  const key = ctx.platform === 'win32'
    ? 'win32'
    : ctx.platform === 'darwin'
      ? 'darwin'
      : 'linux'
  for (const location of spec.apps?.[key] ?? []) {
    const resolved = location.replace(/%([^%]+)%/g, (_, name: string) => ctx.env[name] ?? '')
    if (resolved.includes('%') || !isDirectorySync(resolved)) {
      continue
    }
    return resolved
  }
}
