import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { measurePath } from './fs'
import { createTempHome } from './test-utils'

describe('measurePath', () => {
  it('adds file sizes recursively and marks the result complete', async () => {
    const { home, cleanup } = await createTempHome()
    try {
      await mkdir(join(home, '.claude', 'projects', 'p1'), { recursive: true })
      await writeFile(join(home, '.claude', 'settings.json'), 'x'.repeat(100))
      await writeFile(join(home, '.claude', 'projects', 'p1', 'session.jsonl'), 'x'.repeat(50))

      const result = await measurePath(join(home, '.claude'))

      expect(result.exists).toBe(true)
      expect(result.symlink).toBe(false)
      expect(result.bytes).toBe(150)
      expect(result.complete).toBe(true)
    }
    finally {
      await cleanup()
    }
  })

  it('reports a missing path as absent and readable', async () => {
    const { home, cleanup } = await createTempHome()
    try {
      const result = await measurePath(join(home, '.nope'))

      expect(result.exists).toBe(false)
      expect(result.bytes).toBe(0)
      expect(result.error).toBeUndefined()
    }
    finally {
      await cleanup()
    }
  })

  it('measures a file without walking it', async () => {
    const { home, cleanup } = await createTempHome()
    try {
      await writeFile(join(home, '.claude.json'), 'x'.repeat(42))

      const result = await measurePath(join(home, '.claude.json'))

      expect(result.bytes).toBe(42)
      expect(result.complete).toBe(true)
    }
    finally {
      await cleanup()
    }
  })

  it('reports symlinks and junctions without following them', async () => {
    const { home, cleanup } = await createTempHome()
    try {
      await mkdir(join(home, 'cloud', 'claude'), { recursive: true })
      await writeFile(join(home, 'cloud', 'claude', 'big.jsonl'), 'x'.repeat(10_000))
      await symlink(join(home, 'cloud', 'claude'), join(home, '.claude'), process.platform === 'win32'
        ? 'junction'
        : 'dir')

      const result = await measurePath(join(home, '.claude'))

      expect(result.exists).toBe(true)
      expect(result.symlink).toBe(true)
      expect(result.bytes).toBe(0)
    }
    finally {
      await cleanup()
    }
  })

  it('degrades to incomplete instead of hanging past the deadline', async () => {
    const { home, cleanup } = await createTempHome()
    try {
      await mkdir(join(home, '.claude'), { recursive: true })
      await writeFile(join(home, '.claude', 'settings.json'), 'x')

      const result = await measurePath(join(home, '.claude'), Date.now() - 1)

      expect(result.complete).toBe(false)
    }
    finally {
      await cleanup()
    }
  })
})
