import type { Ctx } from './types'
import { homedir } from 'node:os'
import process from 'node:process'

export function createContext(overrides: Partial<Ctx> = {}): Ctx {
  return {
    home: homedir(),
    platform: process.platform,
    env: { ...process.env },
    now: Date.now(),
    ...overrides,
  }
}
