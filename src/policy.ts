import type { AgentReport, PathReport } from './types'
import { RECENT_WINDOW_MS } from './constants'

export type ReportGroup = 'noInstallFound' | 'checkYourself' | 'installFound'

export function reportGroup(report: AgentReport): ReportGroup {
  if (report.state === 'installed') {
    return 'installFound'
  }
  return report.state === 'unknown'
    ? 'checkYourself'
    : 'noInstallFound'
}

/** All callers use this gate; forceRecent only overrides the age limit. */
export function pruneBlockReason(
  report: Pick<AgentReport, 'state'>,
  path: PathReport,
  now: number,
  forceRecent = false,
): string | undefined {
  if (path.kind === 'credentials') {
    return 'credentials'
  }
  if (report.state !== 'configured') {
    return report.state === 'installed'
      ? 'install-found'
      : 'unknown'
  }
  if (path.blockedReason) {
    return path.blockedReason
  }
  if (path.error || !path.metadataComplete || !path.modifiedAt) {
    return 'unreadable'
  }
  if (!forceRecent && now - path.modifiedAt < RECENT_WINDOW_MS) {
    return 'recent'
  }
}
