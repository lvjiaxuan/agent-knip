import type { AgentReport, AgentSpec, Ctx, EvidenceCheck, Location, PathReport, ProbeFn, ScanOptions } from './types'
import { lstat, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { agents } from './agents'
import { SIZE_BUDGET_MS, WEIGHT } from './constants'
import { findBinary } from './detect/binary'
import { findPackageRecord } from './detect/packages'
import { probeBinary } from './detect/probe'
import { errorCode, measurePath } from './fs'
import { hasLinkedAncestor, resolveLocation, validRelativePath } from './locations'
import { pruneBlockReason } from './policy'

interface Inspection {
  evidence: string[]
  score: number
  state: AgentReport['state']
  reason?: string
}

export async function scan(ctx: Ctx, options: ScanOptions = {}): Promise<AgentReport[]> {
  if (options.agent && !agents.some(agent => agent.id === options.agent)) {
    throw new Error(`Unknown agent: ${options.agent}`)
  }
  const reports: AgentReport[] = []
  // Output filters must not bypass overlapping/shared-directory protection.
  for (const spec of agents) {
    const report = await inspectAgent(ctx, spec, options.probe ?? probeBinary, options.agent === spec.id)
    if (report) {
      reports.push(report)
    }
  }
  protectOverlaps(reports, ctx.platform)
  for (const report of reports) {
    report.skips = [
      ...new Set(report.paths.map(path => pruneBlockReason(report, path, ctx.now)).filter((reason): reason is string => Boolean(reason))),
    ]
  }
  return reports.filter(report => !options.agent || report.agent.id === options.agent)
}

async function inspectAgent(ctx: Ctx, spec: AgentSpec, probe: ProbeFn, includeEmpty: boolean): Promise<AgentReport | undefined> {
  const checks: EvidenceCheck[] = []
  const { paths, installs } = await collectLocations(ctx, spec, checks)
  const inspection = await collectEvidence(ctx, spec, probe, installs, checks)
  if (paths.length === 0 && inspection.evidence.length === 0 && (spec.registry === 'reference' || inspection.state !== 'unknown') && !includeEmpty) {
    return undefined
  }
  const cleanupSupported = spec.registry === 'curated' && Boolean(spec.verifiedPlatforms?.includes(ctx.platform))
  checks.push({
    source: 'policy',
    status: cleanupSupported ? 'found' : 'skipped',
    detail: spec.registry === 'reference'
      ? 'Reference registry: cleanup is disabled on every platform.'
      : `Cleanup support for ${ctx.platform}: ${cleanupSupported ? 'verified' : 'not verified'}.`,
  })
  return {
    agent: spec,
    ...inspection,
    cleanupSupported,
    checks,
    paths,
    bytes: paths.reduce((sum, path) => sum + path.bytes, 0),
    skips: [],
  }
}

async function collectLocations(ctx: Ctx, spec: AgentSpec, checks: EvidenceCheck[]): Promise<{ paths: PathReport[], installs: string[] }> {
  const paths: PathReport[] = []
  const installs: string[] = []
  const seen = new Set<string>()
  const deadline = Date.now() + SIZE_BUDGET_MS
  for (const location of spec.locations) {
    try {
      const resolved = resolveLocation(ctx, location)
      if (!resolved) {
        checks.push({ source: 'location', status: 'skipped', detail: `${location.path}: platform or optional base not applicable` })
        continue
      }
      if (location.role === 'install') {
        await inspectInstall(resolved.path, installs, checks)
        continue
      }
      const key = pathKey(resolved.path, ctx.platform)
      if (seen.has(key)) {
        checks.push({ source: 'location', status: 'skipped', detail: `${resolved.path}: duplicate resolved data location` })
        continue
      }
      seen.add(key)
      const path = await inspectData(location, resolved, deadline, checks)
      if (path)
        paths.push(path)
    }
    catch (error) {
      checks.push({ source: 'location', status: 'error', detail: `${location.path}: ${errorCode(error)}` })
    }
  }
  return { paths, installs }
}

async function inspectData(location: Location, resolved: { path: string, root: string }, deadline: number, checks: EvidenceCheck[]): Promise<PathReport | undefined> {
  const linked = await hasLinkedAncestor(resolved)
  const measured = await measurePath(resolved.path, linked ? 0 : deadline)
  checks.push({
    source: 'location',
    status: measured.exists ? 'found' : 'not-found',
    detail: `data ${resolved.path}`,
  })
  if (!measured.exists)
    return undefined
  if (!measured.complete && !linked) {
    checks.push({ source: 'location', status: 'error', detail: `${resolved.path}: size/mtime walk incomplete; cleanup blocked` })
  }
  const blockedReason = measured.error
    ? 'unreadable'
    : await dataBlock(location, resolved.path, linked)
  return {
    path: location.path,
    ...(location.base
      ? { base: location.base }
      : {}),
    resolvedPath: resolved.path,
    type: location.type,
    kind: location.kind,
    bytes: measured.bytes,
    sizeComplete: measured.complete,
    modifiedAt: measured.modifiedAt,
    symlink: measured.symlink || linked,
    ...(measured.error
      ? { error: measured.error }
      : {}),
    ...(blockedReason
      ? { blockedReason }
      : {}),
  }
}

async function dataBlock(location: Location, path: string, linked: boolean): Promise<string | undefined> {
  if (linked)
    return 'linked-ancestor'
  const actual = await lstat(path)
  const expected = location.type === 'dir'
    ? actual.isDirectory()
    : actual.isFile()
  if (!actual.isSymbolicLink() && !expected)
    return 'type-mismatch'
  return credentialBlock(location, path)
}

async function inspectInstall(path: string, installs: string[], checks: EvidenceCheck[]): Promise<void> {
  try {
    const found = (await stat(path)).isDirectory()
    checks.push({
      source: 'location',
      status: found ? 'found' : 'error',
      detail: `install ${path}${found ? '' : ': not a directory'}`,
    })
    if (found) {
      installs.push(`app:${path}`)
    }
  }
  catch (error) {
    const missing = ['ENOENT', 'ENOTDIR'].includes(errorCode(error))
    checks.push({
      source: 'location',
      status: missing ? 'not-found' : 'error',
      detail: `install ${path}: ${errorCode(error)}`,
    })
  }
}

async function credentialBlock(location: Location, absolute: string): Promise<string | undefined> {
  for (const file of location.protectedFiles ?? []) {
    if (!validRelativePath(file)) {
      throw new Error('Invalid protected filename')
    }
    try {
      await lstat(join(absolute, ...file.split('/')))
      return 'credentials-inside'
    }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(errorCode(error))) {
        throw error
      }
    }
  }
}

async function collectEvidence(ctx: Ctx, spec: AgentSpec, probe: ProbeFn, installs: string[], checks: EvidenceCheck[]): Promise<Inspection> {
  const evidence = [...installs]
  let score = installs.length > 0
    ? WEIGHT.app
    : 0
  if (spec.registry === 'reference') {
    checks.push({ source: 'policy', status: 'skipped', detail: 'Unverified reference: directory presence is not install evidence.' })
    return {
      evidence: [],
      score: 0,
      state: 'unknown',
      reason: 'reference-only registry',
    }
  }
  let source: EvidenceCheck['source'] = 'package'
  try {
    const record = findPackageRecord(ctx, spec)
    checks.push({
      source: 'package',
      status: record ? 'found' : 'not-found',
      detail: record ?? 'No record in the supported fixed npm/pipx locations (not a complete package inventory).',
    })
    if (record) {
      evidence.push(record)
      score += WEIGHT.packages
    }
    source = 'binary'
    const bin = findBinary(ctx, spec.bins)
    checks.push({
      source: 'binary',
      status: bin ? 'found' : 'not-found',
      detail: bin?.path ?? `PATH: no match for ${(spec.bins ?? []).join(', ')}`,
    })
    if (bin) {
      evidence.push(`bin:${bin.path}`)
      score += WEIGHT.bin
    }
    source = 'probe'
    score += await inspectProbe(bin, installs.length > 0 || Boolean(record), probe, checks)
  }
  catch (error) {
    checks.push({ source, status: 'error', detail: `Install evidence could not be collected: ${errorCode(error)}` })
  }
  const failed = checks.some(check => check.status === 'error')
  if (failed) {
    return {
      evidence,
      score,
      state: 'unknown',
      reason: 'a detection check failed or could not be completed',
    }
  }
  if (evidence.length > 0) {
    return { evidence, score, state: 'installed' }
  }
  return {
    evidence,
    score,
    state: 'configured',
    reason: 'No supported install evidence found; this does not prove uninstallation.',
  }
}

async function inspectProbe(bin: ReturnType<typeof findBinary>, hasInstall: boolean, probe: ProbeFn, checks: EvidenceCheck[]): Promise<number> {
  if (!bin || hasInstall || !bin.probeable) {
    checks.push({ source: 'probe', status: 'skipped', detail: 'No binary, existing install evidence, or shell shim: --version not executed.' })
    return 0
  }
  const alive = await probe(bin.path)
  checks.push({
    source: 'probe',
    status: alive ? 'found' : 'error',
    detail: `${bin.path} --version ${alive ? 'succeeded' : 'failed or timed out'}`,
  })
  return alive ? WEIGHT.probe : 0
}

function pathKey(path: string, platform: Ctx['platform']): string {
  return platform === 'win32'
    ? path.toLowerCase()
    : path
}

function protectOverlaps(reports: AgentReport[], platform: Ctx['platform']): void {
  const paths = reports.flatMap(report => report.paths)
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const a = paths[i].resolvedPath
      const b = paths[j].resolvedPath
      if (a && b && overlaps(pathKey(a, platform), pathKey(b, platform))) {
        paths[i].blockedReason = 'shared-or-overlapping-location'
        paths[j].blockedReason = 'shared-or-overlapping-location'
      }
    }
  }
}

function overlaps(a: string, b: string): boolean {
  const child = relative(a, b)
  const parent = relative(b, a)
  return a === b || [child, parent].some(path => path && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}
