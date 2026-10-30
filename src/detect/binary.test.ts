import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTempHome } from '../test-utils'
import { findBinary } from './binary'

describe('findBinary', () => {
  it('appends PATHEXT entries on win32 and strips quotes from PATH', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const binDir = join(home, 'Program Files', 'node')
      await mkdir(binDir, { recursive: true })
      await writeFile(join(binDir, 'claude.CMD'), '')

      const hit = findBinary(
        {
          ...ctx,
          env: { PATH: `"${binDir}"`, PATHEXT: '.COM;.EXE;.CMD' },
        },
        ['claude'],
      )

      expect(hit?.path).toBe(join(binDir, 'claude.CMD'))
      expect(hit?.probeable).toBe(false)
    }
    finally {
      await cleanup()
    }
  })

  it('treats .exe hits as probeable', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const binDir = join(home, 'bin')
      await mkdir(binDir, { recursive: true })
      await writeFile(join(binDir, 'codex.EXE'), '')

      const hit = findBinary({
        ...ctx,
        env: { PATH: binDir, PATHEXT: '.EXE' },
      }, ['codex'])

      expect(hit?.probeable).toBe(true)
    }
    finally {
      await cleanup()
    }
  })

  it('uses the first matching directory on PATH', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const first = join(home, 'first')
      const second = join(home, 'second')
      await mkdir(first, { recursive: true })
      await mkdir(second, { recursive: true })
      await writeFile(join(first, 'gemini.EXE'), '')
      await writeFile(join(second, 'gemini.EXE'), '')

      const hit = findBinary({
        ...ctx,
        env: { PATH: `${first};${second}`, PATHEXT: '.EXE' },
      }, ['gemini'])

      expect(hit?.path).toBe(join(first, 'gemini.EXE'))
    }
    finally {
      await cleanup()
    }
  })

  it.skipIf(process.platform === 'win32')('resolves bare executables on posix-style PATHs', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'linux' })
    try {
      const binDir = join(home, 'bin')
      await mkdir(binDir, { recursive: true })
      await writeFile(join(binDir, 'aider'), '')

      const hit = findBinary({
        ...ctx,
        env: { PATH: binDir },
      }, ['aider'])

      expect(hit?.path).toBe(join(binDir, 'aider'))
      expect(hit?.probeable).toBe(true)
    }
    finally {
      await cleanup()
    }
  })

  it.skipIf(process.platform === 'win32')('splits posix PATH on colons', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'linux' })
    try {
      const binDir = join(home, 'bin')
      await mkdir(binDir, { recursive: true })
      await writeFile(join(binDir, 'opencode'), '')

      const hit = findBinary({
        ...ctx,
        env: { PATH: `/nowhere:${binDir}` },
      }, ['opencode'])

      expect(hit?.path).toBe(join(binDir, 'opencode'))
    }
    finally {
      await cleanup()
    }
  })
})
