import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as fileOps from '../src/fs'
import { scan } from '../src/scan'
import { createTempHome } from './test-utils'

async function makeFile(path: string, content = 'x'): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

describe('scan', () => {
  it('marks an agent with only its directory left as configured', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await makeFile(join(home, '.claude', 'projects', 'session.jsonl'))

      const reports = await scan(ctx)

      expect(reports).toHaveLength(1)
      expect(reports[0].state).toBe('configured')
      expect(reports[0].evidence).toEqual([])
      expect(reports[0].checks.some(check => check.status === 'not-found')).toBe(true)
      expect(reports[0].paths.map(path => path.path)).toEqual(['.claude'])
      expect(reports[0].paths[0].metadataComplete).toBe(true)
      expect(reports[0]).not.toHaveProperty('bytes')
      expect(reports[0].paths[0]).not.toHaveProperty('bytes')
    }
    finally {
      await cleanup()
    }
  })

  it('marks an agent as installed when a package record exists', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const appdata = join(home, 'AppData', 'Roaming')
      await mkdir(join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true })
      await makeFile(join(home, '.claude', 'settings.json'))

      const reports = await scan({
        ...ctx,
        env: { ...ctx.env, APPDATA: appdata },
      })

      expect(reports[0].state).toBe('installed')
      expect(reports[0].evidence).toContain('npm:@anthropic-ai/claude-code')
      expect(reports[0].paths[0].metadataComplete).toBe(false)
      expect(reports[0].checks.some(check => check.status === 'error')).toBe(false)
    }
    finally {
      await cleanup()
    }
  })

  it('does not walk data directories when installation is already found', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    const tree = vi.spyOn(fileOps, 'inspectTree')
    try {
      await mkdir(join(ctx.env.APPDATA!, 'npm', 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true })
      await makeFile(join(home, '.claude', 'projects', 'session'))
      const [report] = await scan(ctx, { agent: 'claude' })
      expect(report.state).toBe('installed')
      expect(report.paths[0].metadataComplete).toBe(false)
      expect(tree).not.toHaveBeenCalled()
    }
    finally {
      tree.mockRestore()
      await cleanup()
    }
  })

  it('marks a found-but-broken binary as unknown', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await makeFile(join(home, 'bin', 'claude'))
      await makeFile(join(home, '.claude', 'settings.json'))

      const reports = await scan(
        {
          ...ctx,
          env: {
            ...ctx.env,
            PATH: join(home, 'bin'),
          },
        },
        {
          probe: async () => false,
        },
      )

      expect(reports[0].state).toBe('unknown')
      expect(reports[0].checks.some(check => check.source === 'probe' && check.status === 'error')).toBe(true)
      expect(reports[0].skips).toContain('unknown')
    }
    finally {
      await cleanup()
    }
  })

  it('marks a live binary as installed', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await makeFile(join(home, 'bin', 'claude'))
      await makeFile(join(home, '.claude', 'settings.json'))

      const reports = await scan(
        {
          ...ctx,
          env: {
            ...ctx.env,
            PATH: join(home, 'bin'),
          },
        },
        {
          probe: async () => true,
        },
      )

      expect(reports[0].state).toBe('installed')
      expect(reports[0].evidence.some(line => line.startsWith('bin:'))).toBe(true)
    }
    finally {
      await cleanup()
    }
  })

  it('does not probe when a package record already proves installation', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const appdata = join(home, 'AppData', 'Roaming')
      await mkdir(join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true })
      await makeFile(join(home, 'bin', 'claude.EXE'))
      await makeFile(join(home, '.claude', 'settings.json'))
      const probe = vi.fn(async () => true)

      await scan({
        ...ctx,
        env: {
          ...ctx.env,
          APPDATA: appdata,
          PATH: join(home, 'bin'),
          PATHEXT: '.EXE',
        },
      }, { probe })

      expect(probe).not.toHaveBeenCalled()
    }
    finally {
      await cleanup()
    }
  })

  it('trusts .cmd shims without probing them', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await makeFile(join(home, 'bin', 'claude.CMD'))
      await makeFile(join(home, '.claude', 'settings.json'))
      const probe = vi.fn(async () => false)

      const reports = await scan(
        {
          ...ctx,
          env: {
            ...ctx.env,
            PATH: join(home, 'bin'),
            PATHEXT: '.CMD',
          },
        },
        { probe },
      )

      expect(reports[0].state).toBe('installed')
      expect(probe).not.toHaveBeenCalled()
    }
    finally {
      await cleanup()
    }
  })

  it('resolves %APPDATA% based paths on win32', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const appdata = join(home, 'AppData', 'Roaming')
      await makeFile(join(appdata, 'Zed', 'settings.json'), '{}')
      await makeFile(join(home, 'bin', 'zed.EXE'))

      const reports = await scan(
        {
          ...ctx,
          env: {
            ...ctx.env,
            APPDATA: appdata,
            LOCALAPPDATA: join(home, 'AppData', 'Local'),
            PATH: join(home, 'bin'),
            PATHEXT: '.EXE',
          },
        },
        {
          probe: async () => true,
        },
      )

      const zed = reports.find(report => report.agent.id === 'zed')
      expect(zed?.paths).toHaveLength(1)
      expect(zed?.paths[0].base).toBe('APPDATA')
      expect(zed?.state).toBe('installed')
      expect(zed?.evidence.some(line => line.startsWith('bin:'))).toBe(true)
    }
    finally {
      await cleanup()
    }
  })

  it('falls back to ~/.config for XDG_CONFIG_HOME paths', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'linux' })
    try {
      await makeFile(join(home, '.config', 'zed', 'settings.json'), '{}')

      const reports = await scan(ctx)

      const zed = reports.find(report => report.agent.id === 'zed')
      expect(zed?.paths[0].base).toBe('XDG_CONFIG_HOME')
      expect(zed?.state).toBe('configured')
    }
    finally {
      await cleanup()
    }
  })
})
