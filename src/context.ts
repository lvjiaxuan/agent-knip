import type { Ctx, PathSpec } from './types'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

/** Default context; tests build their own instead of mocking globals. */
export function createContext(overrides: Partial<Ctx> = {}): Ctx {
  return {
    home: homedir(),
    platform: process.platform,
    env: process.env,
    now: Date.now(),
    ...overrides,
  }
}

/** Resolve a registered path against the injected home or environment base. */
export function resolveAgentPath(ctx: Ctx, spec: Pick<PathSpec, 'path' | 'base'>): string | undefined {
  if (!spec.base) {
    return join(ctx.home, ...spec.path.split('/'))
  }

  let root: string | undefined
  if (spec.base === 'XDG_CONFIG_HOME') {
    root = ctx.env.XDG_CONFIG_HOME?.trim() || join(ctx.home, '.config')
  }
  else if (spec.base === 'APPDATA' || spec.base === 'LOCALAPPDATA') {
    root = ctx.platform === 'win32'
      ? ctx.env[spec.base]?.trim()
      : undefined
  }
  else {
    root = ctx.env[spec.base]?.trim()
  }

  return root
    ? join(root, ...spec.path.split('/'))
    : undefined
}
