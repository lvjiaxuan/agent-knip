import type { AgentSpec, Ctx } from '../types'
import { join } from 'node:path'
import { isDirectorySync } from '../fs'
import { resolveLocation } from '../locations'

interface PackageRoot {
  manager: 'npm' | 'pipx'
  dir: string
}

/**
 * Where package managers leave global records. Only fixed, well-known
 * locations: no shelling out to `npm root -g` or `brew --prefix`.
 */
function packageRoots(ctx: Ctx, spec: AgentSpec): PackageRoot[] {
  const roots: PackageRoot[] = []
  if (ctx.platform === 'win32') {
    if (spec.packages?.length) {
      const location = resolveLocation(ctx, { base: 'APPDATA', path: 'npm/node_modules' })!
      roots.push({ manager: 'npm', dir: location.path })
    }
  }
  else {
    roots.push({
      manager: 'npm',
      dir: join(ctx.home, '.npm-global', 'lib', 'node_modules'),
    })
    roots.push({ manager: 'npm', dir: '/usr/local/lib/node_modules' })
    if (ctx.platform === 'darwin') {
      roots.push({ manager: 'npm', dir: '/opt/homebrew/lib/node_modules' })
    }
  }
  roots.push({
    manager: 'pipx',
    dir: join(ctx.home, '.local', 'pipx', 'venvs'),
  })
  return roots
}

/** Return evidence like `npm:@anthropic-ai/claude-code`, or undefined. */
export function findPackageRecord(ctx: Ctx, spec: AgentSpec): string | undefined {
  for (const root of packageRoots(ctx, spec)) {
    const names = root.manager === 'npm'
      ? spec.packages
      : spec.pipx
    for (const name of names ?? []) {
      // `@scope/name` and `dir/name` both resolve as nested directories.
      if (isDirectorySync(join(root.dir, ...name.split('/')))) {
        return `${root.manager}:${name}`
      }
    }
  }
}
