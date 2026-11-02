import type { Ctx, Location } from './types'
import { lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export interface ResolvedLocation {
  path: string
  root: string
}

export function validRelativePath(path: string): boolean {
  return path.length > 0 && path.split('/').every(segment =>
    /^[\w.@ ()-]+$/.test(segment) && segment !== '.' && segment !== '..'
    && !/[. ]$/.test(segment) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
  )
}

/** Resolve both data and install locations with the same validation and platform rules. */
export function resolveLocation(ctx: Ctx, location: Pick<Location, 'path' | 'base' | 'platforms'>): ResolvedLocation | undefined {
  if (!validRelativePath(location.path)) {
    throw new Error(`Invalid registered relative path: ${location.path}`)
  }
  if (location.platforms && !location.platforms.includes(ctx.platform)) {
    return undefined
  }
  const root = locationRoot(ctx, location.base)
  if (!root) {
    return undefined
  }
  if (!isAbsolute(root)) {
    throw new Error(`Location base must be absolute: ${location.base ?? 'home'}`)
  }
  return {
    path: resolve(root, ...location.path.split('/')),
    root: resolve(root),
  }
}

function locationRoot(ctx: Ctx, base: Location['base']): string | undefined {
  if (!base) {
    return ctx.home
  }
  if (base === 'XDG_CONFIG_HOME') {
    return ctx.env.XDG_CONFIG_HOME?.trim() || join(ctx.home, '.config')
  }
  if (base === 'FLATPAK_XDG_CONFIG_HOME') {
    return ctx.env.FLATPAK_XDG_CONFIG_HOME?.trim()
  }
  if (base === 'APPLICATIONS') {
    return ctx.platform === 'darwin'
      ? '/Applications'
      : undefined
  }
  const windowsBases = [
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMFILES',
    'PROGRAMFILES_X86',
  ]
  if (!windowsBases.includes(base)) {
    throw new Error(`Unknown location base: ${base}`)
  }
  if (ctx.platform !== 'win32') {
    return undefined
  }
  const key = base === 'PROGRAMFILES'
    ? 'ProgramFiles'
    : base === 'PROGRAMFILES_X86'
      ? 'ProgramFiles(x86)'
      : base
  const root = ctx.env[key]?.trim()
  if (!root && (base === 'APPDATA' || base === 'LOCALAPPDATA')) {
    throw new Error(`Location base is unavailable: ${base}`)
  }
  return root
}

/** Don't walk through a linked base or intermediate directory (including junctions). */
export async function hasLinkedAncestor(location: ResolvedLocation): Promise<boolean> {
  const ancestors: string[] = []
  for (let current = dirname(location.path); ; current = dirname(current)) {
    ancestors.push(current)
    if (current === dirname(current)) {
      break
    }
  }
  for (const current of ancestors.reverse()) {
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        return true
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw error
    }
  }
  return false
}
