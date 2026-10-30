import type { Ctx } from './types'
import { homedir } from 'node:os'
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
