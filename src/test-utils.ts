import type { Ctx } from './types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

export interface TempHome {
  ctx: Ctx
  home: string
  cleanup: () => Promise<void>
}

/** A throwaway home directory; nothing ever touches the real `~`. */
export async function createTempHome(overrides: Partial<Ctx> = {}): Promise<TempHome> {
  const home = await mkdtemp(join(tmpdir(), 'agent-knip-'))
  const ctx: Ctx = {
    home,
    platform: process.platform,
    env: {},
    now: Date.now(),
    ...overrides,
  }
  return {
    ctx,
    home,
    cleanup: async () => {
      await rm(home, { recursive: true, force: true, maxRetries: 3 })
    },
  }
}
