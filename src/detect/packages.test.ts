import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agents } from '../agents'
import { createTempHome } from '../test-utils'
import { findPackageRecord } from './packages'

const claude = agents.find(agent => agent.id === 'claude')!
const aider = agents.find(agent => agent.id === 'aider')!

describe('findPackageRecord', () => {
  it('finds a scoped npm package in the npm global root', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'linux' })
    try {
      await mkdir(join(home, '.npm-global', 'lib', 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true })

      expect(findPackageRecord(ctx, claude)).toBe('npm:@anthropic-ai/claude-code')
    }
    finally {
      await cleanup()
    }
  })

  it('finds npm packages under APPDATA on win32', async () => {
    const { ctx, home, cleanup } = await createTempHome()
    try {
      const appdata = join(home, 'AppData', 'Roaming')
      await mkdir(join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true })

      expect(findPackageRecord({
        ...ctx,
        platform: 'win32',
        env: { APPDATA: appdata },
      }, claude))
        .toBe('npm:@anthropic-ai/claude-code')
    }
    finally {
      await cleanup()
    }
  })

  it('finds pipx venvs', async () => {
    const { ctx, home, cleanup } = await createTempHome()
    try {
      await mkdir(join(home, '.local', 'pipx', 'venvs', 'aider-chat'), { recursive: true })

      expect(findPackageRecord(ctx, aider)).toBe('pipx:aider-chat')
    }
    finally {
      await cleanup()
    }
  })

  it('returns undefined when nothing matches', async () => {
    const { ctx, cleanup } = await createTempHome()
    try {
      expect(findPackageRecord(ctx, claude)).toBeUndefined()
    }
    finally {
      await cleanup()
    }
  })
})
