import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { probeBinary } from './probe'

describe('probeBinary', () => {
  it('reports a live binary', async () => {
    expect(await probeBinary(process.execPath)).toBe(true)
  })

  it('reports a binary that cannot run', async () => {
    expect(await probeBinary(join(tmpdir(), 'agent-knip-no-such-binary'))).toBe(false)
  })
})
