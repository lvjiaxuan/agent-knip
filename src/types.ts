export type DirKind = 'config' | 'history' | 'cache' | 'credentials'
export type State = 'installed' | 'configured' | 'unknown'
export type ProbeFn = (bin: string) => Promise<boolean>

export interface Ctx {
  home: string
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  now: number
}

export interface PathSpec {
  /** Path relative to home, always `/`-separated. */
  path: string
  type: 'dir' | 'file'
  kind: DirKind
}

export interface AgentSpec {
  id: string
  name: string
  bins: string[]
  /** npm package names, compared against global node_modules. */
  packages?: string[]
  /** pipx venv names. */
  pipx?: string[]
  /** App install locations; `%VAR%` is resolved from Ctx.env. */
  apps?: Partial<Record<'win32' | 'darwin' | 'linux', string[]>>
  paths: PathSpec[]
}

export interface PathReport {
  path: string
  type: 'dir' | 'file'
  kind: DirKind
  bytes: number
  sizeComplete: boolean
  modifiedAt: number
  symlink: boolean
  error?: string
}

export interface AgentReport {
  agent: AgentSpec
  state: State
  score: number
  /** e.g. `bin:/usr/local/bin/claude`, `npm:@anthropic-ai/claude-code` */
  evidence: string[]
  paths: PathReport[]
  bytes: number
  /** Why a path will not be pruned: credentials, recent, symlink, unreadable… */
  skips: string[]
  reason?: string
}

export interface ScanOptions {
  agent?: string
  probe?: ProbeFn
}

export interface PruneOptions {
  agent?: string
  forceRecent?: boolean
}

export interface ManifestItem {
  id: string
  from: string
  /** Path relative to the trash entry directory. */
  to: string
  kind: DirKind
  bytes: number
}

export interface Manifest {
  version: number
  createdAt: number
  items: ManifestItem[]
}

export interface TrashEntry {
  dir: string
  createdAt: number
  items: ManifestItem[]
  error?: string
}

export interface Skip {
  id: string
  path: string
  reason: string
}

export interface PruneResult {
  trashDir?: string
  moved: ManifestItem[]
  skipped: Skip[]
}

export interface RestoreResult {
  restored: { id: string, from: string }[]
  failed: { path: string, reason: string }[]
  trash: string[]
}
