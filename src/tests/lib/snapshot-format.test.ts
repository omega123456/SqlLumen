import { describe, expect, it } from 'vitest'
import {
  formatConnectionBreakdown,
  formatSnapshotCounts,
  formatSnapshotTimestamp,
  formatSnapshotTrigger,
} from '../../lib/snapshot-format'
import type { SnapshotConnectionSummary } from '../../lib/session-snapshot-commands'

describe('formatSnapshotTrigger', () => {
  it('maps each trigger to its display label', () => {
    expect(formatSnapshotTrigger('onClose')).toBe('On close')
    expect(formatSnapshotTrigger('daily')).toBe('Daily')
    expect(formatSnapshotTrigger('weekly')).toBe('Weekly')
    expect(formatSnapshotTrigger('manual')).toBe('Manual')
    expect(formatSnapshotTrigger('beforeRestore')).toBe('Before restore')
  })
})

describe('formatSnapshotTimestamp', () => {
  it('falls back to the raw input when unparseable', () => {
    expect(formatSnapshotTimestamp('not-a-date')).toBe('not-a-date')
  })
})

describe('formatSnapshotCounts', () => {
  it('uses singular forms for a count of one', () => {
    expect(formatSnapshotCounts(1, 1)).toBe('1 connection · 1 tab')
  })
})

describe('formatConnectionBreakdown', () => {
  const connections: SnapshotConnectionSummary[] = [
    { name: 'ProdDB', tabCount: 4 },
    { name: 'Staging', tabCount: 2 },
    { name: 'Analytics', tabCount: 1 },
  ]

  it('respects a custom maxVisible', () => {
    expect(formatConnectionBreakdown(connections, 1)).toBe('ProdDB: 4 · +2 more')
  })

  it('returns an empty string when there are no connections', () => {
    expect(formatConnectionBreakdown([])).toBe('')
  })
})
