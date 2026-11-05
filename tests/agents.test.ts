import { describe, expect, it } from 'vitest'
import { agents } from '../src/agents'
import { validRelativePath } from '../src/locations'

const KINDS = new Set([
  'config',
  'history',
  'cache',
  'credentials',
])

// Frozen inventory from vercel-labs/skills at 7ae8e2c63a163fcade6dd36f4223d37befa9b6f9.
const UPSTREAM_IDS = [
  'adal',
  'aider-desk',
  'amp',
  'antigravity',
  'antigravity-cli',
  'astrbot',
  'augment',
  'autohand-code',
  'bob',
  'claude-code',
  'cline',
  'codearts-agent',
  'codebuddy',
  'codemaker',
  'codestudio',
  'codex',
  'command-code',
  'continue',
  'cortex',
  'crush',
  'cursor',
  'deepagents',
  'devin',
  'dexto',
  'droid',
  'eve',
  'firebender',
  'forgecode',
  'fx',
  'gemini-cli',
  'github-copilot',
  'goose',
  'grok',
  'hermes-agent',
  'iflow-cli',
  'inference-sh',
  'jazz',
  'junie',
  'kilo',
  'kimchi',
  'kimi-code-cli',
  'kiro-cli',
  'kode',
  'lingma',
  'loaf',
  'mcpjam',
  'minimax-code',
  'mistral-vibe',
  'moxby',
  'mux',
  'neovate',
  'ona',
  'openclaw',
  'opencode',
  'openhands',
  'pi',
  'pochi',
  'posit-assistant',
  'promptscript',
  'qoder',
  'qoder-cn',
  'qwen-code',
  'reasonix',
  'replit',
  'roo',
  'rovodev',
  'sarvam-code',
  'tabnine-cli',
  'terramind',
  'tinycloud',
  'trae',
  'trae-cn',
  'universal',
  'warp',
  'windsurf',
  'zcode',
  'zed',
  'zencoder',
  'zenflow',
]

const LOCAL_IDS: Record<string, string> = {
  'claude-code': 'claude',
  'gemini-cli': 'gemini',
}

const agentsWithoutBinaryOrPackageHints = agents.filter(agent => !agent.bins && !agent.packages && !agent.pipx)

describe('agent inventory', () => {
  it('covers every frozen upstream agent plus the local Aider without duplicate identities', () => {
    expect(UPSTREAM_IDS).toHaveLength(79)
    expect(agents.map(agent => agent.id).sort()).toEqual([
      ...UPSTREAM_IDS.map(id => LOCAL_IDS[id] ?? id),
      'aider',
    ].sort())
    expect(agents).toHaveLength(80)
  })

  it('has unique ids, safe locations and no empty bin lists', () => {
    expect(new Set(agents.map(agent => agent.id)).size).toBe(agents.length)
    for (const agent of agents) {
      expect(agent.name.length).toBeGreaterThan(0)
      expect(agent).not.toHaveProperty('registry')
      if (agent.id === 'eve' || agent.id === 'promptscript') {
        expect(agent.locations).toEqual([])
      }
      else {
        expect(agent.locations.some(location => location.role === 'data')).toBe(true)
      }
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

  it('preserves local binary and package hints instead of replacing them with upstream directory detection', () => {
    expect(agents.filter(agent => agent.bins || agent.packages || agent.pipx).map(agent => ({
      id: agent.id,
      bins: agent.bins,
      packages: agent.packages,
      pipx: agent.pipx,
    }))).toEqual([
      {
        id: 'claude',
        bins: ['claude'],
        packages: ['@anthropic-ai/claude-code'],
        pipx: undefined,
      },
      {
        id: 'codex',
        bins: ['codex'],
        packages: ['@openai/codex'],
        pipx: undefined,
      },
      {
        id: 'gemini',
        bins: ['gemini'],
        packages: ['@google/gemini-cli'],
        pipx: undefined,
      },
      {
        id: 'cursor',
        bins: ['cursor-agent', 'cursor'],
        packages: undefined,
        pipx: undefined,
      },
      {
        id: 'aider',
        bins: ['aider'],
        packages: undefined,
        pipx: ['aider-chat'],
      },
      {
        id: 'opencode',
        bins: ['opencode'],
        packages: ['opencode-ai'],
        pipx: undefined,
      },
      {
        id: 'zed',
        bins: ['zed'],
        packages: undefined,
        pipx: undefined,
      },
      {
        id: 'pi',
        bins: ['pi'],
        packages: undefined,
        pipx: undefined,
      },
      {
        id: 'qoder',
        bins: ['qoder'],
        packages: undefined,
        pipx: undefined,
      },
      {
        id: 'qoder-cn',
        bins: ['qoder-cn'],
        packages: undefined,
        pipx: undefined,
      },
    ])
    expect(agents.find(agent => agent.id === 'claude')?.locations).toContainEqual({
      role: 'data',
      path: '.claude',
      env: 'CLAUDE_CONFIG_DIR',
      type: 'dir',
      kind: 'history',
      protectedFiles: ['.credentials.json'],
    })
    expect(agents.find(agent => agent.id === 'codex')?.locations).toContainEqual({
      role: 'data',
      path: '.codex',
      env: 'CODEX_HOME',
      type: 'dir',
      kind: 'history',
      protectedFiles: ['auth.json'],
    })
  })

  it('keeps macOS app-bundle install hints scoped to macOS', () => {
    for (const agent of agentsWithoutBinaryOrPackageHints) {
      expect(agent.bins).toBeUndefined()
      expect(agent.packages).toBeUndefined()
      expect(agent.pipx).toBeUndefined()
    }
    expect(agentsWithoutBinaryOrPackageHints.flatMap(agent => agent.locations
      .filter(location => location.role !== 'data')
      .map(location => ({ id: agent.id, ...location })))).toEqual([
      {
        id: 'minimax-code',
        role: 'install',
        base: 'APPLICATIONS',
        path: 'MiniMax Code.app',
        type: 'dir',
        kind: 'config',
        platforms: ['darwin'],
      },
      {
        id: 'zcode',
        role: 'install',
        base: 'APPLICATIONS',
        path: 'ZCode.app',
        type: 'dir',
        kind: 'config',
        platforms: ['darwin'],
      },
    ])
  })

  it('keeps Zed binary hints and distinguishes data from install evidence', () => {
    const zed = agents.find(agent => agent.id === 'zed')!
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
