import { format, isValid, parseISO } from 'date-fns'
import type { SnapshotConnectionSummary, SnapshotTrigger } from './session-snapshot-commands'

const TRIGGER_LABELS: Record<SnapshotTrigger, string> = {
  onClose: 'On close',
  daily: 'Daily',
  weekly: 'Weekly',
  manual: 'Manual',
  beforeRestore: 'Before restore',
}

export function formatSnapshotTrigger(trigger: SnapshotTrigger): string {
  return TRIGGER_LABELS[trigger] ?? trigger
}

const SNAPSHOT_TIMESTAMP_FORMAT = 'MMM d, yyyy · HH:mm'

export function formatSnapshotTimestamp(createdAt: string): string {
  const date = parseISO(createdAt)
  if (!isValid(date)) {
    return createdAt
  }
  return format(date, SNAPSHOT_TIMESTAMP_FORMAT)
}

export function formatSnapshotCounts(connectionCount: number, tabCount: number): string {
  const connectionLabel = connectionCount === 1 ? 'connection' : 'connections'
  const tabLabel = tabCount === 1 ? 'tab' : 'tabs'
  return `${connectionCount} ${connectionLabel} · ${tabCount} ${tabLabel}`
}

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
