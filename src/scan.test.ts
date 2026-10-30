import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { scan } from './scan'
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
      expect(reports[0].paths.map(path => path.path)).toEqual(['.claude'])
      expect(reports[0].bytes).toBeGreaterThan(0)
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
        env: { APPDATA: appdata },
      })

      expect(reports[0].state).toBe('installed')
      expect(reports[0].evidence).toContain('npm:@anthropic-ai/claude-code')
    }
    finally {
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
            PATH: join(home, 'bin'),
          },
        },
        {
          probe: async () => false,
        },
      )

      expect(reports[0].state).toBe('unknown')
      expect(reports[0].reason).toBe('bin found, --version failed')
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
})
