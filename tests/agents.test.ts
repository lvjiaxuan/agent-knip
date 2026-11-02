import { describe, expect, it } from 'vitest'
import { agents } from '../src/agents'
import { importedAgents } from '../src/agents.generated'

const KINDS = new Set([
  'config',
  'history',
  'cache',
  'credentials',
])
const PATH_SHAPE = /^\.[\w.-]+(\/[\w.-]+)*$/
const PATH_BASES = new Set([
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'FLATPAK_XDG_CONFIG_HOME',
])
const SAFE_SEGMENT = /^[\w.-]+$/

describe('agents registry', () => {
  it('has unique ids, a path each, and no empty bin lists', () => {
    const ids = agents.map(agent => agent.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const agent of agents) {
      expect(agent.paths.length).toBeGreaterThan(0)
      if (agent.bins) {
        expect(agent.bins.length).toBeGreaterThan(0)
      }
    }
  })

  it('only registers home-relative paths, never filesystem escapes', () => {
    for (const agent of agents) {
      for (const path of agent.paths) {
        if (path.base) {
          expect(PATH_BASES.has(path.base)).toBe(true)
        }
        else {
          expect(path.path).toMatch(PATH_SHAPE)
        }
        expect(path.path).not.toContain('\\')
        for (const segment of path.path.split('/')) {
          expect(segment).toMatch(SAFE_SEGMENT)
          expect(segment).not.toBe('..')
          expect(segment).not.toBe('.')
        }
        expect(KINDS.has(path.kind)).toBe(true)
      }
    }
  })

  it('keeps the generated table populated', () => {
    expect(importedAgents.length).toBeGreaterThan(50)
  })

  it('keeps Zed hand-maintained with install evidence and platform paths', () => {
    const zed = agents.find(agent => agent.id === 'zed')

    expect(importedAgents.some(agent => agent.id === 'zed')).toBe(false)
    expect(zed?.bins).toContain('zed')
    expect(zed?.paths.map(path => path.base)).toEqual([
      'XDG_CONFIG_HOME',
      'APPDATA',
      'LOCALAPPDATA',
      'FLATPAK_XDG_CONFIG_HOME',
    ])
  })
})
