import type { AgentReport, AgentSpec, Ctx, EvidenceCheck, Location, PathReport, ProbeFn, ScanOptions } from './types'
import { lstat, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { agents } from './agents'
import { METADATA_BUDGET_MS, WEIGHT } from './constants'
import { findBinary } from './detect/binary'
import { findPackageRecord } from './detect/packages'
import { probeBinary } from './detect/probe'
import { errorCode, inspectPath, inspectTree } from './fs'
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
    throw new Error(`未知 agent：${options.agent}`)
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
  if (paths.length === 0 && inspection.evidence.length === 0 && inspection.state !== 'unknown' && !includeEmpty) {
    return undefined
  }
  if (inspection.state === 'configured') {
    await inspectCleanupMetadata(paths, checks)
  }
  return {
    agent: spec,
    ...inspection,
    checks,
    paths,
    skips: [],
  }
}

async function inspectCleanupMetadata(paths: PathReport[], checks: EvidenceCheck[]): Promise<void> {
  const deadline = Date.now() + METADATA_BUDGET_MS
  for (const path of paths) {
    if (path.symlink || path.blockedReason || path.kind === 'credentials')
      continue
    const metadata = await inspectTree(path.resolvedPath!, deadline)
    path.modifiedAt = metadata.modifiedAt
    path.metadataComplete = metadata.metadataComplete
    path.symlink = metadata.symlink
    path.error = metadata.error
    if (!metadata.exists || !metadata.metadataComplete) {
      path.error = metadata.error ?? '修改时间检查未完成，或路径已不存在'
      checks.push({ source: 'location', status: 'error', detail: `${path.resolvedPath}: ${path.error}；已阻止清理` })
    }
  }
}

async function collectLocations(ctx: Ctx, spec: AgentSpec, checks: EvidenceCheck[]): Promise<{ paths: PathReport[], installs: string[] }> {
  const paths: PathReport[] = []
  const installs: string[] = []
  const seen = new Set<string>()
  for (const location of spec.locations) {
    try {
      const resolved = resolveLocation(ctx, location)
      if (!resolved) {
        checks.push({ source: 'location', status: 'skipped', detail: `${location.path}: 当前平台不适用，或未提供可选的基础目录` })
        continue
      }
      if (location.role === 'install') {
        await inspectInstall(resolved.path, installs, checks)
        continue
      }
      const key = pathKey(resolved.path, ctx.platform)
      if (seen.has(key)) {
        checks.push({ source: 'location', status: 'skipped', detail: `${resolved.path}: 解析后的数据路径重复` })
        continue
      }
      seen.add(key)
      const path = await inspectData(ctx, location, resolved, checks)
      if (path)
        paths.push(path)
    }
    catch (error) {
      checks.push({ source: 'location', status: 'error', detail: `${location.path}: ${errorCode(error)}` })
    }
  }
  return { paths, installs }
}

async function inspectData(ctx: Ctx, location: Location, resolved: { path: string, root: string }, checks: EvidenceCheck[]): Promise<PathReport | undefined> {
  const linked = await hasLinkedAncestor(resolved)
  const metadata = await inspectPath(resolved.path)
  checks.push({
    source: 'location',
    status: metadata.error
      ? 'error'
      : metadata.exists ? 'found' : 'not-found',
    detail: `数据路径 ${resolved.path}${metadata.error
      ? `: ${metadata.error}`
      : ''}`,
  })
  if (!metadata.exists)
    return undefined
  const blockedReason = metadata.error
    ? 'unreadable'
    : await dataBlock(location, resolved.path, linked)
  return {
    path: location.path,
    ...(location.base
      ? { base: location.base }
      : {}),
    ...(location.env && ctx.env[location.env]?.trim()
      ? { env: location.env }
      : {}),
    resolvedPath: resolved.path,
    type: location.type,
    kind: location.kind,
    metadataComplete: metadata.metadataComplete,
    modifiedAt: metadata.modifiedAt,
    symlink: metadata.symlink || linked,
    ...(metadata.error
      ? { error: metadata.error }
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
      detail: `安装路径 ${path}${found ? '' : '：不是目录'}`,
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
      detail: `安装路径 ${path}: ${errorCode(error)}`,
    })
  }
}

async function credentialBlock(location: Location, absolute: string): Promise<string | undefined> {
  for (const file of location.protectedFiles ?? []) {
    if (!validRelativePath(file)) {
      throw new Error('受保护文件名无效')
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
  let source: EvidenceCheck['source'] = 'package'
  try {
    const record = findPackageRecord(ctx, spec)
    checks.push({
      source: 'package',
      status: record ? 'found' : 'not-found',
      detail: record ?? '在支持的固定 npm/pipx 目录中未找到记录（未检查全部已安装包）。',
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
      detail: bin?.path ?? `PATH 中未找到匹配命令：${(spec.bins ?? []).join(', ')}`,
    })
    if (bin) {
      evidence.push(`bin:${bin.path}`)
      score += WEIGHT.bin
    }
    source = 'probe'
    score += await inspectProbe(bin, installs.length > 0 || Boolean(record), probe, checks)
  }
  catch (error) {
    checks.push({ source, status: 'error', detail: `无法收集安装依据：${errorCode(error)}` })
  }
  const failed = checks.some(check => check.status === 'error')
  if (failed) {
    return {
      evidence,
      score,
      state: 'unknown',
      reason: '某项检测失败或未能完成',
    }
  }
  if (evidence.length > 0) {
    return { evidence, score, state: 'installed' }
  }
  return {
    evidence,
    score,
    state: 'configured',
    reason: '在支持的检查范围内未找到安装依据；这不能证明已卸载。',
  }
}

async function inspectProbe(bin: ReturnType<typeof findBinary>, hasInstall: boolean, probe: ProbeFn, checks: EvidenceCheck[]): Promise<number> {
  if (!bin || hasInstall || !bin.probeable) {
    checks.push({ source: 'probe', status: 'skipped', detail: '未执行 --version：未找到命令、已有安装依据，或命令是 shell 包装脚本。' })
    return 0
  }
  const alive = await probe(bin.path)
  checks.push({
    source: 'probe',
    status: alive ? 'found' : 'error',
    detail: `${bin.path} --version ${alive ? '执行成功' : '执行失败或超时'}`,
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
