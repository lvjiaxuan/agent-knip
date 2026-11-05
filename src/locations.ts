import type { Ctx, Location } from './types'
import { lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { TRASH_DIR } from './constants'

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
export function resolveLocation(ctx: Ctx, location: Pick<Location, 'path' | 'base' | 'env' | 'platforms'>): ResolvedLocation | undefined {
  if (!validRelativePath(location.path)) {
    throw new Error(`登记的相对路径无效：${location.path}`)
  }
  if (location.platforms && !location.platforms.includes(ctx.platform)) {
    return undefined
  }
  const override = location.env && ctx.env[location.env]?.trim()
  if (override) {
    if (!isAbsolute(override) || override.includes('\0')) {
      throw new Error(`配置目录必须是有效的绝对路径：${location.env}`)
    }
    const path = resolve(override)
    const trash = resolve(ctx.home, TRASH_DIR)
    // An override replaces the entire location, so it must not absorb home or recovery data.
    if (path === dirname(path) || containsPath(path, ctx.home) || containsPath(path, trash) || containsPath(trash, path)) {
      throw new Error(`配置目录不得覆盖根目录、用户主目录或隔离区：${location.env}`)
    }
    return { path, root: path }
  }
  const root = locationRoot(ctx, location.base)
  if (!root) {
    return undefined
  }
  if (!isAbsolute(root)) {
    throw new Error(`基础目录必须是绝对路径：${location.base ?? '用户主目录'}`)
  }
  return {
    path: resolve(root, ...location.path.split('/')),
    root: resolve(root),
  }
}

function containsPath(parent: string, path: string): boolean {
  const child = relative(parent, path)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
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
    throw new Error(`未知基础目录：${base}`)
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
    throw new Error(`基础目录不可用：${base}`)
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
