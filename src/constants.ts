export const VERSION = '0.1.0'

/** Schema version of `scan --json` and of manifest.json. */
export const SCHEMA_VERSION = 1

export const TRASH_DIR = '.agent-knip'
export const TRASH_SUBDIR = 'trash'

export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const STALE_TRASH_MS = 30 * 24 * 60 * 60 * 1000

/** Per-agent budget for size measurement. */
export const SIZE_BUDGET_MS = 5000
export const PROBE_TIMEOUT_MS = 2000

export const WEIGHT = {
  bin: 40,
  packages: 30,
  app: 30,
  probe: 20,
} as const
