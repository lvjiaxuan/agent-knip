import type { Ctx } from '../types'
import { extname, join } from 'node:path'
import { isFileSync } from '../fs'

export interface BinaryHit {
  bin: string
  path: string
  /** `.cmd` / `.bat` need a shell, so they are installed evidence but never probed. */
  probeable: boolean
}

const UNPROBEABLE = new Set(['.cmd', '.bat', '.ps1'])

/**
 * Resolve a command on PATH without spawning anything. On Windows the
 * extensions from PATHEXT are appended; commands are never run here.
 */
export function findBinary(ctx: Ctx, bins: string[]): BinaryHit | undefined {
  const dirs = searchDirs(ctx)
  const extensions = candidateExtensions(ctx)

  for (const bin of bins) {
    const hit = findInDirs(bin, dirs, extensions)
    if (hit) {
      return hit
    }
  }
}

function searchDirs(ctx: Ctx): string[] {
  const rawPath = ctx.env.PATH ?? ctx.env.Path ?? ''
  const delimiter = ctx.platform === 'win32'
    ? ';'
    : ':'
  return rawPath
    .split(delimiter)
    .map(dir => dir.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
}

function candidateExtensions(ctx: Ctx): string[] {
  if (ctx.platform !== 'win32') {
    return ['']
  }
  return [
    '',
    ...(ctx.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean),
  ]
}

function findInDirs(bin: string, dirs: string[], extensions: string[]): BinaryHit | undefined {
  for (const dir of dirs) {
    for (const extension of extensions) {
      if (extension && bin.toLowerCase().endsWith(extension.toLowerCase())) {
        continue
      }
      const candidate = join(dir, bin + extension)
      if (!isFileSync(candidate)) {
        continue
      }
      return { bin, path: candidate, probeable: !UNPROBEABLE.has(extname(candidate).toLowerCase()) }
    }
  }
}
