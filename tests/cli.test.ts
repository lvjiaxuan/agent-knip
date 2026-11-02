import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/cli'
import { createTempHome } from './test-utils'

afterEach(() => vi.restoreAllMocks())

function capture(): { text: () => string } {
  const lines: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk))
    return true
  })
  return {
    text: () => lines.join(''),
  }
}

describe('cLI eligibility and explanations', () => {
  it('static help/version do not require a valid home', async () => {
    const output = capture()
    const invalid = {
      home: '',
      platform: 'win32' as const,
      env: {},
      now: 0,
    }
    expect(await main(['--help'], invalid)).toBe(0)
    expect(await main(['prune', '-h'], invalid)).toBe(0)
    expect(await main(['--version'], invalid)).toBe(0)
    expect(output.text()).toContain('--explain')
    expect(output.text()).toContain('Reference-only')
  })

  it('forced previews, explain decisions and --yes use the same candidates', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await mkdir(join(home, '.claude'))
      await writeFile(join(home, '.claude', 'session'), 'fixture')
      const output = capture()
      expect(await main(['prune', '--agent', 'claude'], ctx)).toBe(0)
      expect(await main([
        'prune',
        '--agent',
        'claude',
        '--force-recent',
        '--explain',
      ], ctx)).toBe(2)
      expect(output.text()).toContain('candidate (confirm)')
      expect(output.text()).toContain('Explanation')
      expect((await lstat(join(home, '.claude'))).isDirectory()).toBe(true)
      expect(await readdir(home)).not.toContain('.agent-knip')
      expect(await main([
        'prune',
        '--agent',
        'claude',
        '--force-recent',
        '--yes',
      ], ctx)).toBe(0)
      await expect(lstat(join(home, '.claude'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    finally { await cleanup() }
  })

  it('reference-only JSON/explain never advertises candidates or exits 2', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await mkdir(join(home, '.config', 'amp'), { recursive: true })
      const output = capture()
      expect(await main([
        'scan',
        '--agent',
        'amp',
        '--json',
        '--explain',
      ], ctx)).toBe(0)
      const data = JSON.parse(output.text())
      expect(data.version).toBe(2)
      expect(data.groups.reference).toEqual(['amp'])
      expect(data.candidates).toEqual([])
      expect(data.agents[0].cleanupSupported).toBe(false)
    }
    finally { await cleanup() }
  })

  it('rejects explain on restore rather than silently ignoring it', async () => {
    const output = capture()
    expect(await main(['restore', '--explain'])).toBe(1)
    expect(output.text()).toContain('not valid')
  })
})
