import type { AgentReport, PathReport } from './types'
import { RECENT_WINDOW_MS } from './constants'

export type ReportGroup = 'noInstallFound' | 'checkYourself' | 'installFound' | 'reference'

export function reportGroup(report: AgentReport): ReportGroup {
  if (report.agent.registry === 'reference') {
    return 'reference'
  }
  if (report.state === 'installed') {
    return 'installFound'
  }
  return report.state === 'unknown' || !report.cleanupSupported
    ? 'checkYourself'
    : 'noInstallFound'
}

/** All callers use this gate; forcing age never overrides the trust boundary. */
export function pruneBlockReason(
  report: Pick<AgentReport, 'agent' | 'state' | 'cleanupSupported'>,
  path: PathReport,
  now: number,
  forceRecent = false,
): string | undefined {
  if (report.agent.registry !== 'curated') {
    return 'reference-only'
  }
  if (path.kind === 'credentials') {
    return 'credentials'
  }
  if (path.symlink) {
    return 'symlink'
  }
  if (!report.cleanupSupported) {
    return 'unverified-platform'
  }
  if (report.state !== 'configured') {
    return report.state === 'installed'
      ? 'install-found'
      : 'unknown'
  }
  if (path.blockedReason) {
    return path.blockedReason
  }
  if (path.error || !path.sizeComplete || !path.modifiedAt) {
    return 'unreadable'
  }
  if (!forceRecent && now - path.modifiedAt < RECENT_WINDOW_MS) {
    return 'recent'
  }
}
