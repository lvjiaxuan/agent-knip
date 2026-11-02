import { describe, expect, it } from 'vitest'
import { agents } from '../src/agents'
import { importedAgents } from '../src/agents.generated'
import { validRelativePath } from '../src/locations'

const KINDS = new Set([
  'config',
  'history',
  'cache',
  'credentials',
])

describe('agents registry', () => {
  it('has unique ids, data locations and no empty bin lists', () => {
    expect(new Set(agents.map(agent => agent.id)).size).toBe(agents.length)
    for (const agent of agents) {
      expect(agent.locations.some(location => location.role === 'data')).toBe(true)
      if (agent.bins) {
        expect(agent.bins.length).toBeGreaterThan(0)
      }
      for (const location of agent.locations) {
        expect(validRelativePath(location.path)).toBe(true)
        expect(KINDS.has(location.kind)).toBe(true)
        for (const protectedFile of location.protectedFiles ?? []) {
          expect(validRelativePath(protectedFile)).toBe(true)
        }
      }
    }
  })

  it('never grants generated references cleanup support or install signals', () => {
    expect(importedAgents.length).toBeGreaterThan(50)
    for (const agent of importedAgents) {
      expect(agent.registry).toBe('reference')
      expect(agent.verifiedPlatforms).toBeUndefined()
      expect(agent.bins).toBeUndefined()
      expect(agent.locations.every(location => location.role === 'data')).toBe(true)
    }
  })

  it('only grants observed Windows support rather than claiming all-platform verification', () => {
    expect(agents.filter(agent => agent.verifiedPlatforms?.includes('win32')).map(agent => agent.id)).toEqual(['claude', 'codex', 'gemini', 'zed'])
    expect(agents.every(agent => !agent.verifiedPlatforms?.includes('darwin') && !agent.verifiedPlatforms?.includes('linux'))).toBe(true)
  })

  it('keeps Zed curated and distinguishes data from install evidence', () => {
    const zed = agents.find(agent => agent.id === 'zed')!
    expect(importedAgents.some(agent => agent.id === 'zed')).toBe(false)
    expect(zed.bins).toContain('zed')
    expect(zed.locations.filter(location => location.role === 'data').map(location => location.base)).toEqual([
      'XDG_CONFIG_HOME',
      'APPDATA',
      'LOCALAPPDATA',
      'FLATPAK_XDG_CONFIG_HOME',
    ])
    expect(zed.locations.some(location => location.role === 'install' && location.base === 'APPDATA')).toBe(false)
  })
})
