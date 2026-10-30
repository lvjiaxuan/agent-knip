import { statSync } from 'node:fs'
import { cp, lstat, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

export interface MeasuredPath {
  exists: boolean
  symlink: boolean
  bytes: number
  complete: boolean
  modifiedAt: number
  error?: string
}

interface DirectoryUsage {
  bytes: number
  complete: boolean
  modifiedAt: number
}

/**
 * Measure one path. Symlinks are reported, never followed. A `deadline`
 * (epoch ms) degrades the walk to `complete: false` instead of hanging.
 */
export async function measurePath(target: string, deadline = Number.POSITIVE_INFINITY): Promise<MeasuredPath> {
  let stats
  try {
    stats = await lstat(target)
  }
  catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
    return {
      exists: !missing,
      symlink: false,
      bytes: 0,
      complete: missing,
      modifiedAt: 0,
      ...(missing
        ? {}
        : {
            error: errorCode(error),
          }),
    }
  }

  if (stats.isSymbolicLink()) {
    return {
      exists: true,
      symlink: true,
      bytes: 0,
      complete: true,
      modifiedAt: stats.mtimeMs,
    }
  }
  if (!stats.isDirectory()) {
    return {
      exists: true,
      symlink: false,
      bytes: stats.size,
      complete: true,
      modifiedAt: stats.mtimeMs,
    }
  }

  const usage = await walk(target, stats.mtimeMs, deadline)
  return { exists: true, symlink: false, ...usage }
}

async function walk(root: string, rootMtime: number, deadline: number): Promise<DirectoryUsage> {
  const total: DirectoryUsage = { bytes: 0, complete: true, modifiedAt: rootMtime }
  const stack = [root]

  while (stack.length > 0) {
    if (Date.now() > deadline) {
      total.complete = false
      break
    }
    const usage = await readDirectory(stack.pop()!, stack)
    total.bytes += usage.bytes
    total.modifiedAt = Math.max(total.modifiedAt, usage.modifiedAt)
    total.complete = total.complete && usage.complete
  }

  return total
}

/** Adds child directories to the stack; counts files, never follows links. */
async function readDirectory(dir: string, stack: string[]): Promise<DirectoryUsage> {
  let names: string[]
  try {
    names = await readdir(dir)
  }
  catch {
    return { bytes: 0, complete: false, modifiedAt: 0 }
  }

  const usage: DirectoryUsage = { bytes: 0, complete: true, modifiedAt: 0 }
  for (const name of names) {
    const path = join(dir, name)
    let stats
    try {
      stats = await lstat(path)
    }
    catch {
      usage.complete = false
      continue
    }
    usage.modifiedAt = Math.max(usage.modifiedAt, stats.mtimeMs)
    if (stats.isSymbolicLink()) {
      continue
    }
    if (stats.isDirectory()) {
      stack.push(path)
    }
    else {
      usage.bytes += stats.size
    }
  }
  return usage
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  }
  catch {
    return false
  }
}

export function isDirectorySync(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  }
  catch {
    return false
  }
}

export function isFileSync(path: string): boolean {
  try {
    return statSync(path).isFile()
  }
  catch {
    return false
  }
}

/**
 * Rename when possible (same volume, atomic), otherwise copy then remove.
 * The caller reports per-path failures; nothing is swallowed here.
 */
export async function movePath(from: string, to: string): Promise<'renamed' | 'copied'> {
  try {
    await rename(from, to)
    return 'renamed'
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw error
    }
  }
  await cp(from, to, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
  })
  await rm(from, { recursive: true, force: true })
  return 'copied'
}

export function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  return code ?? (error instanceof Error
    ? error.message
    : String(error))
}
