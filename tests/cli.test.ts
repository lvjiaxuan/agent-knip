import { lstat, mkdir, readdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/cli'
import * as fileOps from '../src/fs'
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
    expect(output.text()).toContain('清理必须指定单个 agent')
    expect(output.text()).toContain('不会永久删除数据')
    expect(output.text()).toContain('用法：')
    expect(output.text()).toContain('agent-knip restore --all')
    expect(output.text()).not.toContain('Usage:')
  })

  it('requires --agent for both prune preview and confirmation', async () => {
    const { ctx, cleanup } = await createTempHome()
    try {
      const output = capture()
      expect(await main(['prune'], ctx)).toBe(1)
      expect(await main(['prune', '--yes'], ctx)).toBe(1)
      expect(output.text()).toContain('prune 必须指定一个 agent')
    }
    finally { await cleanup() }
  })

  it.each([
    [
      'prune',
      '--agent',
      'claude',
      '--agent',
      'gemini',
      '--yes',
    ],
    ['prune', '--agent=claude', '--agent=claude'],
  ])('rejects repeated prune selectors: %j', async (...args) => {
    const { ctx, home, cleanup } = await createTempHome()
    try {
      const output = capture()
      expect(await main(args, ctx)).toBe(1)
      expect(output.text()).toContain('每次只能指定一个 --agent')
      expect(await readdir(home)).not.toContain('.agent-knip')
    }
    finally { await cleanup() }
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
      expect(output.text()).toContain('可移入隔离区')
      expect(output.text()).toContain('检测依据')
      expect(output.text()).toContain('仅预览，未移动文件')
      expect(output.text()).toContain('prune --agent claude --yes --force-recent')
      expect((await lstat(join(home, '.claude'))).isDirectory()).toBe(true)
      expect(await readdir(home)).not.toContain('.agent-knip')
      expect(await main([
        'prune',
        '--agent',
        'claude',
        '--force-recent',
        '--yes',
      ], ctx)).toBe(0)
      expect(output.text()).toContain('已将 1 个路径移入隔离区：')
      await expect(lstat(join(home, '.claude'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await main(['restore', '--list'], ctx)).toBe(0)
      expect(output.text()).toContain('隔离区：')
      expect(output.text()).toContain('1 个条目')
      expect(await main(['restore', '--all'], ctx)).toBe(0)
      expect(output.text()).toContain('已还原 1 个路径：')
      expect((await lstat(join(home, '.claude'))).isDirectory()).toBe(true)
    }
    finally { await cleanup() }
  })

  it('scans every agent with the same rules and reports real cleanup candidates', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const dataDir = join(home, '.config', 'amp')
      await mkdir(dataDir, { recursive: true })
      await writeFile(join(dataDir, 'session'), 'fixture')
      const old = new Date(ctx.now - 30 * 86400000)
      await utimes(join(dataDir, 'session'), old, old)
      await utimes(dataDir, old, old)
      const output = capture()
      expect(await main([
        'scan',
        '--agent',
        'amp',
        '--json',
        '--explain',
      ], ctx)).toBe(2)
      const data = JSON.parse(output.text())
      expect(data.version).toBe(4)
      expect(data.groups.noInstallFound).toEqual(['amp'])
      expect(data.groups).not.toHaveProperty('reference')
      expect(data.candidates).toEqual([
        { path: '~/.config/amp' },
      ])
      expect(data.agents[0].agent).not.toHaveProperty('registry')
      expect(data.agents[0]).not.toHaveProperty('cleanupSupported')
    }
    finally { await cleanup() }
  })

  it.each([
    [
      ['--wat'],
      '未知选项：--wat',
    ],
    [
      ['scan', '-x'],
      '未知选项：-x',
    ],
    [
      ['scan', 'extra'],
      '不接受位置参数：extra',
    ],
    [
      ['scan', '--agent'],
      '选项 --agent 缺少参数值。',
    ],
    [
      ['scan', '--json=yes'],
      '选项 --json 不接受参数值。',
    ],
    [
      ['scan', '--agent', '--json'],
      '选项 --agent 缺少明确的参数值',
    ],
    [
      ['bad-command'],
      '未知命令："bad-command"',
    ],
    [
      ['scan', '--agent', 'bad-agent'],
      '未知 agent："bad-agent"',
    ],
  ])('reports Chinese validation errors for %j', async (args, message) => {
    const output = capture()
    expect(await main(args)).toBe(1)
    expect(output.text()).toContain(message)
    expect(output.text()).not.toContain('Unknown option')
    expect(output.text()).not.toContain('argument missing')
  })

  it('reports an empty quarantine in Chinese', async () => {
    const { ctx, cleanup } = await createTempHome()
    try {
      const output = capture()
      expect(await main(['restore', '--list'], ctx)).toBe(0)
      expect(await main(['restore', '--all'], ctx)).toBe(0)
      expect(output.text()).toContain('隔离区为空。')
    }
    finally { await cleanup() }
  })

  it('reports restore conflicts in Chinese without overwriting the target', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const target = join(home, '.claude')
      await mkdir(target)
      const output = capture()
      expect(await main([
        'prune',
        '--agent',
        'claude',
        '--force-recent',
        '--yes',
      ], ctx)).toBe(0)
      await mkdir(target)
      expect(await main(['restore', '--all'], ctx)).toBe(1)
      expect(output.text()).toContain('未还原：')
      expect(output.text()).toContain('目标路径已存在')
      expect(output.text()).not.toContain('target already exists')
      expect((await lstat(target)).isDirectory()).toBe(true)
    }
    finally { await cleanup() }
  })

  it('keeps move failure exit code and reports the native error code in Chinese', async () => {
    const { ctx, home, cleanup } = await createTempHome({ platform: 'win32' })
    try {
      const target = join(home, '.claude')
      await mkdir(target)
      vi.spyOn(fileOps, 'movePath').mockRejectedValueOnce(Object.assign(new Error('cross volume'), { code: 'EXDEV' }))
      const output = capture()
      expect(await main([
        'prune',
        '--agent',
        'claude',
        '--force-recent',
        '--yes',
      ], ctx)).toBe(1)
      expect(output.text()).toContain('已跳过：')
      expect(output.text()).toContain('移动失败：EXDEV')
      expect((await lstat(target)).isDirectory()).toBe(true)
    }
    finally { await cleanup() }
  })

  it('rejects explain on restore rather than silently ignoring it', async () => {
    const output = capture()
    expect(await main(['restore', '--explain'])).toBe(1)
    expect(output.text()).toContain('命令 "restore" 不支持选项 --explain。')
  })
})
