import { statSync } from 'node:fs'
import { lstat, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'

export interface PathMetadata {
  exists: boolean
  symlink: boolean
  metadataComplete: boolean
  modifiedAt: number
  error?: string
}

/** Inspect only the path itself; directory contents are not read. */
export async function inspectPath(target: string): Promise<PathMetadata> {
  try {
    const stats = await lstat(target)
    return {
      exists: true,
      symlink: stats.isSymbolicLink(),
      metadataComplete: !stats.isDirectory(),
      modifiedAt: stats.mtimeMs,
    }
  }
  catch (error) {
    const missing = errorCode(error) === 'ENOENT'
    return {
      exists: !missing,
      symlink: false,
      metadataComplete: missing,
      modifiedAt: 0,
      ...(missing
        ? {}
        : {
            error: errorCode(error),
          }),
    }
  }
}

/** Check tree modification times for cleanup without following links. */
export async function inspectTree(target: string, deadline: number): Promise<PathMetadata> {
  const result = await inspectPath(target)
  if (!result.exists || result.error || result.symlink || result.metadataComplete) {
    return result
  }
  const stack = [target]
  result.metadataComplete = true
  while (stack.length > 0) {
    if (Date.now() > deadline) {
      result.metadataComplete = false
      break
    }
    const dir = stack.pop()!
    let names: string[]
    try {
      names = await readdir(dir)
    }
    catch (error) {
      result.metadataComplete = false
      result.error ??= `${dir}: ${errorCode(error)}`
      continue
    }
    for (const name of names) {
      const path = join(dir, name)
      try {
        const stats = await lstat(path)
        result.modifiedAt = Math.max(result.modifiedAt, stats.mtimeMs)
        if (stats.isDirectory() && !stats.isSymbolicLink()) {
          stack.push(path)
        }
      }
      catch (error) {
        result.metadataComplete = false
        result.error ??= `${path}: ${errorCode(error)}`
      }
    }
  }
  return result
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(errorCode(error))) {
      return false
    }
    throw error
  }
}

export function isDirectorySync(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(errorCode(error))) {
      return false
    }
    throw error
  }
}

export function isFileSync(path: string): boolean {
  try {
    return statSync(path).isFile()
  }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(errorCode(error))) {
      return false
    }
    throw error
  }
}

/** Cross-volume moves fail closed: no partial copies or source deletion. */
export async function movePath(from: string, to: string): Promise<'renamed'> {
  await rename(from, to)
  return 'renamed'
}

export function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  return code ?? (error instanceof Error
    ? error.message
    : String(error))
}
