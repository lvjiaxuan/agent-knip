export type DirKind = 'config' | 'history' | 'cache' | 'credentials'
/** Evidence states, not a claim that an agent was uninstalled or is running. */
export type State = 'installed' | 'configured' | 'unknown'
export type ProbeFn = (bin: string) => Promise<boolean>
export type PathBase = 'APPDATA' | 'LOCALAPPDATA' | 'XDG_CONFIG_HOME' | 'FLATPAK_XDG_CONFIG_HOME' | 'PROGRAMFILES' | 'PROGRAMFILES_X86' | 'APPLICATIONS'

export interface Ctx {
  home: string
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  now: number
}

export interface PathSpec {
  /** Relative to home or the declared base. Absolute paths and traversal are rejected. */
  path: string
  base?: PathBase
  /** Overrides the entire path, not the base; only populated in reports when set. */
  env?: 'CLAUDE_CONFIG_DIR' | 'CODEX_HOME'
  platforms?: NodeJS.Platform[]
  type: 'dir' | 'file'
  kind: DirKind
}

export type Location = PathSpec & {
  role: 'data' | 'install'
  /** Known credential filenames inside a data directory; contents are never read. */
  protectedFiles?: string[]
}

export interface AgentSpec {
  id: string
  name: string
  bins?: string[]
  packages?: string[]
  pipx?: string[]
  locations: Location[]
}

export interface EvidenceCheck {
  source: 'location' | 'binary' | 'package' | 'probe'
  status: 'found' | 'not-found' | 'error' | 'skipped'
  detail: string
}

export interface PathReport {
  path: string
  base?: PathBase
  /** Overrides the entire path, not the base; only populated in reports when set. */
  env?: 'CLAUDE_CONFIG_DIR' | 'CODEX_HOME'
  /** Resolved by scan, never accepted as a user-selected cleanup target. */
  resolvedPath?: string
  type: 'dir' | 'file'
  kind: DirKind
  /** True only when the latest modification time covers the entire tree. */
  metadataComplete: boolean
  modifiedAt: number
  symlink: boolean
  error?: string
  blockedReason?: string
}

export interface AgentReport {
  agent: AgentSpec
  state: State
  /** Sum of observed signals, NOT a probability or confidence percentage. */
  score: number
  evidence: string[]
  checks: EvidenceCheck[]
  paths: PathReport[]
  skips: string[]
  reason?: string
}

export interface ScanOptions {
  agent?: string
  probe?: ProbeFn
}

export interface PruneOptions {
  agent: string
  forceRecent?: boolean
}

export interface ManifestItem {
  id: string
  from: string
  to: string
  kind: DirKind
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
  base?: PathBase
  /** Overrides the entire path, not the base; only populated in reports when set. */
  env?: 'CLAUDE_CONFIG_DIR' | 'CODEX_HOME'
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
