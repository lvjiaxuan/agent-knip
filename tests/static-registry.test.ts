import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatJson } from '../src/format'
import { prune } from '../src/prune'
import { scan } from '../src/scan'
import { createTempHome } from './test-utils'

describe('static upstream entries', () => {
  it.each(['eve', 'promptscript'])('keeps project-only %s configured without inventing global data or installation evidence', async (agent) => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      await mkdir(join(home, 'agent'))
      await mkdir(join(home, '.promptscript'))
      await writeFile(join(home, 'promptscript.yaml'), 'project configuration')
      const reports = await scan(ctx, { agent })
      expect(reports).toHaveLength(1)
      expect(reports[0].agent.id).toBe(agent)
      expect(reports[0].state).toBe('configured')
      expect(reports[0].paths).toEqual([])
      expect(reports[0].evidence).toEqual([])
      expect(JSON.parse(formatJson(reports, ctx.now)).candidates).toEqual([])
      const result = await prune(ctx, { agent, forceRecent: true })
      expect(result.moved).toEqual([])
      expect(result.trashDir).toBeUndefined()
      expect(await readFile(join(home, 'promptscript.yaml'), 'utf8')).toBe('project configuration')
    }
    finally { await cleanup() }
  })

  it.each(['replit', 'universal'])('keeps %s shared global skills as data, never installation evidence or cleanup targets', async (agent) => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const root = join(home, 'xdg')
      const shared = join(root, 'agents', 'skills')
      await mkdir(shared, { recursive: true })
      await writeFile(join(shared, 'skill.md'), 'shared skill')
      const context = {
        ...ctx,
        env: { ...ctx.env, XDG_CONFIG_HOME: root },
      }
      const reports = await scan(context, { agent })
      const [report] = reports
      expect(report.state).toBe('configured')
      expect(report.evidence).toEqual([])
      expect(report.paths).toHaveLength(1)
      expect(report.paths[0]).toMatchObject({
        base: 'XDG_CONFIG_HOME',
        path: 'agents/skills',
        resolvedPath: shared,
        blockedReason: 'shared-or-overlapping-location',
      })
      expect(JSON.parse(formatJson(reports, ctx.now)).candidates).toEqual([])
      const result = await prune(context, { agent, forceRecent: true })
      expect(result.moved).toEqual([])
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0].reason).toBe('shared-or-overlapping-location')
      expect(result.trashDir).toBeUndefined()
      expect(await readFile(join(shared, 'skill.md'), 'utf8')).toBe('shared skill')
    }
    finally { await cleanup() }
  })
})
