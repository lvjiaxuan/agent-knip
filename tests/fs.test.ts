import { mkdir, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectPath, inspectTree } from '../src/fs'
import { createTempHome } from './test-utils'

const old = new Date(Date.now() - 30 * 86400000)

describe('path metadata', () => {
  it('checks a directory itself without walking its children', async () => {
    const { home, cleanup } = await createTempHome()
    try {
      const target = join(home, '.claude')
      await mkdir(join(target, 'projects'), { recursive: true })
      await writeFile(join(target, 'projects', 'session'), 'fixture')
      await utimes(target, old, old)

      const result = await inspectPath(target)

      expect(result.exists).toBe(true)
      expect(result.symlink).toBe(false)
      expect(result.metadataComplete).toBe(false)
      expect(result.modifiedAt).toBeCloseTo(old.getTime(), -1)
      expect(result).not.toHaveProperty('bytes')
    }
    finally { await cleanup() }
  })

  it('finds recent nested modifications even when the root directory is old', async () => {
    const { home, cleanup } = await createTempHome()
    try {
      const target = join(home, '.claude')
      const nested = join(target, 'projects')
      await mkdir(nested, { recursive: true })
      await writeFile(join(nested, 'session'), 'fixture')
      await utimes(nested, old, old)
      await utimes(target, old, old)

      const result = await inspectTree(target, Date.now() + 5000)

      expect(result.metadataComplete).toBe(true)
      expect(result.modifiedAt).toBeGreaterThan(old.getTime())
      expect(result).not.toHaveProperty('bytes')
    }
    finally { await cleanup() }
  })

  it('reports a missing path as absent', async () => {
    const { home, cleanup } = await createTempHome()
    try {
      const result = await inspectPath(join(home, '.nope'))
      expect(result.exists).toBe(false)
      expect(result.error).toBeUndefined()
    }
    finally { await cleanup() }
  })

  it('reads file metadata without walking', async () => {
    const { home, cleanup } = await createTempHome()
    try {
      await writeFile(join(home, '.claude.json'), 'fixture')
      const result = await inspectPath(join(home, '.claude.json'))
      expect(result.exists).toBe(true)
      expect(result.metadataComplete).toBe(true)
      expect(result.modifiedAt).toBeGreaterThan(0)
    }
    finally { await cleanup() }
  })

  it('reports symlinks and junctions without following them', async () => {
    const { home, cleanup } = await createTempHome()
    try {
      await mkdir(join(home, 'cloud', 'claude'), { recursive: true })
      await symlink(join(home, 'cloud', 'claude'), join(home, '.claude'), process.platform === 'win32'
        ? 'junction'
        : 'dir')
      const result = await inspectTree(join(home, '.claude'), Date.now() - 1)
      expect(result.exists).toBe(true)
      expect(result.symlink).toBe(true)
    }
    finally { await cleanup() }
  })

  it('blocks cleanup when the modification-time check exceeds its deadline', async () => {
    const { home, cleanup } = await createTempHome()
    try {
      await mkdir(join(home, '.claude'))
      const result = await inspectTree(join(home, '.claude'), Date.now() - 1)
      expect(result.metadataComplete).toBe(false)
    }
    finally { await cleanup() }
  })
})
