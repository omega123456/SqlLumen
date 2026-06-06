/**
 * Pure formatting helpers for the Session Snapshots dialog.
 *
 * No IPC, no React — just stringify/format functions that turn snapshot
 * metadata into the human-readable labels shown in each row. Kept isolated so
 * they are trivially unit-testable.
 */

import type { SnapshotConnectionSummary, SnapshotTrigger } from './session-snapshot-commands'

/** Display labels for each snapshot trigger. */
const TRIGGER_LABELS: Record<SnapshotTrigger, string> = {
  onClose: 'On close',
  daily: 'Daily',
  weekly: 'Weekly',
  manual: 'Manual',
  beforeRestore: 'Before restore',
}

/** Map a trigger to its display label. */
export function formatSnapshotTrigger(trigger: SnapshotTrigger): string {
  return TRIGGER_LABELS[trigger] ?? trigger
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/**
 * Format an RFC-3339 timestamp string for human display, e.g.
 * `"Jun 5, 2026 · 14:32"`. Falls back to the raw input if it cannot be parsed.
 */
export function formatSnapshotTimestamp(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) {
    return createdAt
  }
  const month = MONTH_NAMES[date.getMonth()]
  const day = date.getDate()
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${month} ${day}, ${year} · ${hours}:${minutes}`
}

/**
 * Build the `"{n} connections · {m} tabs"` summary string with singular/plural
 * handling.
 */
export function formatSnapshotCounts(connectionCount: number, tabCount: number): string {
  const connectionLabel = connectionCount === 1 ? 'connection' : 'connections'
  const tabLabel = tabCount === 1 ? 'tab' : 'tabs'
  return `${connectionCount} ${connectionLabel} · ${tabCount} ${tabLabel}`
}

/**
 * Build the inline per-connection breakdown string, e.g.
 * `"ProdDB: 4 · Staging: 2 · Analytics: 1"`. When the number of connections
 * exceeds `maxVisible`, the remainder is collapsed into a trailing `"+N more"`.
 */
export function formatConnectionBreakdown(
  connections: SnapshotConnectionSummary[],
  maxVisible = 3
): string {
  if (connections.length === 0) {
    return ''
  }

  const visible = connections.slice(0, maxVisible)
  const parts = visible.map((connection) => `${connection.name}: ${connection.tabCount}`)

  const remaining = connections.length - visible.length
  if (remaining > 0) {
    parts.push(`+${remaining} more`)
  }

  return parts.join(' · ')
}
