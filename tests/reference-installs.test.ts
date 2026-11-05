import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatJson } from '../src/format'
import * as fileOps from '../src/fs'
import * as locations from '../src/locations'
import { pruneBlockReason } from '../src/policy'
import { prune } from '../src/prune'
import { scan } from '../src/scan'
import { createTempHome } from './test-utils'

const resolveLocation = locations.resolveLocation
let fixture: Awaited<ReturnType<typeof createTempHome>>

beforeEach(async () => {
  fixture = await createTempHome({ platform: 'darwin' })
  vi.spyOn(locations, 'resolveLocation').mockImplementation((ctx, location) => {
    const resolved = resolveLocation(ctx, location)
    if (!resolved || location.base !== 'APPLICATIONS') {
      return resolved
    }
    return resolveLocation(ctx, {
      ...location,
      base: undefined,
      path: `Applications/${location.path}`,
    })
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fixture.cleanup()
})

describe.each([
  { id: 'zcode', config: '.zcode', bundle: 'ZCode.app' },
  { id: 'minimax-code', config: '.minimax', bundle: 'MiniMax Code.app' },
])('$id install evidence', ({ id, config, bundle }) => {
  it('treats config-only data without install evidence as configured', async () => {
    const { ctx, home } = fixture
    await mkdir(join(home, config))

    const [report] = await scan(ctx, { agent: id })

    expect(report.state).toBe('configured')
    expect(report.evidence).toEqual([])
    expect(report.score).toBe(0)
    expect(report.paths.map(path => path.path)).toEqual([config])
  })

  it('reports a macOS app as installed and blocks cleanup, even forced', async () => {
    const { ctx, home } = fixture
    const app = join(home, 'Applications', bundle)
    await mkdir(app, { recursive: true })
    await mkdir(join(home, config))
    await writeFile(join(home, config, 'session'), 'keep me')

    const reports = await scan(ctx, { agent: id })
    const [report] = reports

    expect(report.state).toBe('installed')
    expect(report.evidence).toEqual([`app:${app}`])
    expect(report.paths.map(path => path.path)).toEqual([config])
    expect(pruneBlockReason(report, report.paths[0], ctx.now)).toBe('install-found')
    expect(pruneBlockReason(report, report.paths[0], ctx.now, true)).toBe('install-found')
    expect(JSON.parse(formatJson(reports, ctx.now)).candidates).toEqual([])

    const result = await prune(ctx, { agent: id, forceRecent: true })

    expect(result.moved).toEqual([])
    expect(result.trashDir).toBeUndefined()
    expect(result.skipped.map(item => item.reason)).toEqual(['install-found'])
    expect(await readFile(join(home, config, 'session'), 'utf8')).toBe('keep me')
    expect(await readdir(home)).not.toContain('.agent-knip')
  })

  it('keeps a found app visible without a config directory', async () => {
    const { ctx, home } = fixture
    const app = join(home, 'Applications', bundle)
    await mkdir(app, { recursive: true })

    const reports = await scan(ctx)
    const report = reports.find(report => report.agent.id === id)

    expect(report?.state).toBe('installed')
    expect(report?.evidence).toEqual([`app:${app}`])
    expect(report?.paths).toEqual([])
    expect(JSON.parse(formatJson(reports, ctx.now)).candidates).toEqual([])
  })

  it('keeps a missing app configured instead of inferring installation', async () => {
    const { ctx, home } = fixture
    const [report] = await scan(ctx, { agent: id })

    expect(report.state).toBe('configured')
    expect(report.evidence).toEqual([])
    expect(report.paths).toEqual([])
    expect(report.checks).toContainEqual({
      source: 'location',
      status: 'not-found',
      detail: expect.stringContaining(join(home, 'Applications', bundle)),
    })
  })

  it('never uses macOS application hints on Windows', async () => {
    const { ctx, home } = fixture
    await mkdir(join(home, 'Applications', bundle), { recursive: true })
    await mkdir(join(home, config))

    const [report] = await scan({ ...ctx, platform: 'win32' }, { agent: id })

    expect(report.state).toBe('configured')
    expect(report.evidence).toEqual([])
    expect(report.checks).toContainEqual({
      source: 'location',
      status: 'skipped',
      detail: expect.stringContaining(bundle),
    })
    expect(report.checks.some(check => check.status === 'found' && check.detail.includes(bundle))).toBe(false)
  })

  it('keeps a found non-directory app unknown without app evidence', async () => {
    const { ctx, home } = fixture
    await mkdir(join(home, 'Applications'))
    await writeFile(join(home, 'Applications', bundle), 'not an app directory')

    const [report] = await scan(ctx, { agent: id })

    expect(report.state).toBe('unknown')
    expect(report.evidence).toEqual([])
    expect(report.checks).toContainEqual({
      source: 'location',
      status: 'error',
      detail: expect.stringContaining(bundle),
    })
  })

  it('keeps detection errors unknown even with a found app', async () => {
    const { ctx, home } = fixture
    const app = join(home, 'Applications', bundle)
    const data = join(home, config)
    await mkdir(app, { recursive: true })
    await mkdir(data)
    const inspectPath = fileOps.inspectPath
    vi.spyOn(fileOps, 'inspectPath').mockImplementation(async (path) => {
      const metadata = await inspectPath(path)
      return path === data
        ? { ...metadata, metadataComplete: false, error: 'EACCES' }
        : metadata
    })

    const [report] = await scan(ctx, { agent: id })

    expect(report.state).toBe('unknown')
    expect(report.evidence).toEqual([`app:${app}`])
    expect(report.score).toBeGreaterThan(0)
    expect(report.checks).toContainEqual({
      source: 'location',
      status: 'found',
      detail: expect.stringContaining(app),
    })
    expect(report.checks).toContainEqual({
      source: 'location',
      status: 'error',
      detail: expect.stringContaining('EACCES'),
    })
    expect(pruneBlockReason(report, report.paths[0], ctx.now)).toBe('unknown')
    expect(pruneBlockReason(report, report.paths[0], ctx.now, true)).toBe('unknown')
    expect(JSON.parse(formatJson([report], ctx.now)).candidates).toEqual([])
  })
})
