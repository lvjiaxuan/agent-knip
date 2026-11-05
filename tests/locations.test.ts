import type { Ctx, Location } from '../src/types'
import { dirname, join, parse } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveLocation } from '../src/locations'
import { createTempHome } from './test-utils'

const overrides = [
  { path: '.claude', env: 'CLAUDE_CONFIG_DIR' },
  { path: '.codex', env: 'CODEX_HOME' },
] as const

describe('configuration directory overrides', () => {
  it.each(overrides)('uses $env as the entire location with whitespace trimmed', async (location) => {
    const { ctx, home, cleanup } = await createTempHome()
    try {
      const target = join(home, 'custom config', location.path)
      const resolved = resolveLocation({
        ...ctx,
        env: { ...ctx.env, [location.env]: ` ${target} ` },
      }, location)
      expect(resolved).toEqual({ path: target, root: target })
    }
    finally { await cleanup() }
  })

  it.each(overrides)('falls back to the registered path when $env is unset or blank', async (location) => {
    const { ctx, home, cleanup } = await createTempHome()
    try {
      for (const value of [undefined, '', '   ']) {
        expect(resolveLocation({
          ...ctx,
          env: { ...ctx.env, [location.env]: value },
        }, location)).toEqual({
          path: join(home, location.path),
          root: home,
        })
      }
    }
    finally { await cleanup() }
  })

  it.each(overrides)('rejects unsafe $env values rather than falling back', async (location) => {
    const { ctx, home, cleanup } = await createTempHome()
    try {
      for (const value of [
        './relative',
        join(home, 'bad\0path'),
        home,
        dirname(home),
        parse(home).root,
        join(home, '.agent-knip'),
        join(home, '.agent-knip', 'trash'),
      ]) {
        const overridden: Ctx = {
          ...ctx,
          env: { ...ctx.env, [location.env]: value },
        }
        expect(() => resolveLocation(overridden, location)).toThrow()
      }
    }
    finally { await cleanup() }
  })

  it('still validates the registry path and platform before using an override', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const env = {
        ...ctx.env,
        CODEX_HOME: join(home, 'custom'),
      }
      expect(() => resolveLocation({ ...ctx, env }, { path: '../escape', env: 'CODEX_HOME' })).toThrow()
      expect(resolveLocation({ ...ctx, env }, {
        path: '.codex',
        env: 'CODEX_HOME',
        platforms: ['darwin'],
      })).toBeUndefined()
    }
    finally { await cleanup() }
  })

  it('does not apply agent overrides to unrelated XDG locations', async () => {
    const { ctx, home, cleanup } = await createTempHome()
    try {
      const root = join(home, 'xdg')
      const location: Pick<Location, 'path' | 'base'> = { path: 'opencode', base: 'XDG_CONFIG_HOME' }
      expect(resolveLocation({
        ...ctx,
        env: {
          ...ctx.env,
          CODEX_HOME: join(home, 'codex'),
          XDG_CONFIG_HOME: root,
        },
      }, location)).toEqual({
        path: join(root, 'opencode'),
        root,
      })
    }
    finally { await cleanup() }
  })
})
