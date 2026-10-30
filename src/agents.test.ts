import { describe, expect, it } from 'vitest'
import { agents } from './agents'

const KINDS = new Set([
  'config',
  'history',
  'cache',
  'credentials',
])
const PATH_SHAPE = /^\.[\w.-]+(\/[\w.-]+)*$/

describe('agents registry', () => {
  it('has unique ids and non-empty bins', () => {
    const ids = agents.map(agent => agent.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const agent of agents) {
      expect(agent.bins.length).toBeGreaterThan(0)
      expect(agent.paths.length).toBeGreaterThan(0)
    }
  })

  it('only registers home-relative paths, never filesystem escapes', () => {
    for (const agent of agents) {
      for (const path of agent.paths) {
        expect(path.path).toMatch(PATH_SHAPE)
        expect(path.path).not.toContain('\\')
        for (const segment of path.path.split('/')) {
          expect(segment).not.toBe('..')
          expect(segment).not.toBe('.')
        }
        expect(KINDS.has(path.kind)).toBe(true)
      }
    }
  })
})
