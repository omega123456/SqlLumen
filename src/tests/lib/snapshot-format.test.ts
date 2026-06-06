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
  it('formats an RFC-3339 timestamp for human display', () => {
    // Construct a local-time date so the assertion is timezone-independent.
    const date = new Date(2026, 5, 5, 14, 32, 0)
    expect(formatSnapshotTimestamp(date.toISOString())).toBe('Jun 5, 2026 · 14:32')
  })

  it('zero-pads hours and minutes', () => {
    const date = new Date(2026, 0, 9, 9, 5, 0)
    expect(formatSnapshotTimestamp(date.toISOString())).toBe('Jan 9, 2026 · 09:05')
  })

  it('falls back to the raw input when unparseable', () => {
    expect(formatSnapshotTimestamp('not-a-date')).toBe('not-a-date')
  })
})

describe('formatSnapshotCounts', () => {
  it('pluralizes connections and tabs', () => {
    expect(formatSnapshotCounts(3, 7)).toBe('3 connections · 7 tabs')
  })

  it('uses singular forms for a count of one', () => {
    expect(formatSnapshotCounts(1, 1)).toBe('1 connection · 1 tab')
  })

  it('handles zero counts', () => {
    expect(formatSnapshotCounts(0, 0)).toBe('0 connections · 0 tabs')
  })
})

describe('formatConnectionBreakdown', () => {
  const connections: SnapshotConnectionSummary[] = [
    { name: 'ProdDB', tabCount: 4 },
    { name: 'Staging', tabCount: 2 },
    { name: 'Analytics', tabCount: 1 },
  ]

  it('joins each connection as "{name}: {tabCount}"', () => {
    expect(formatConnectionBreakdown(connections)).toBe('ProdDB: 4 · Staging: 2 · Analytics: 1')
  })

  it('truncates with "+N more" beyond maxVisible', () => {
    const many: SnapshotConnectionSummary[] = [
      ...connections,
      { name: 'Reporting', tabCount: 3 },
      { name: 'Archive', tabCount: 1 },
    ]
    expect(formatConnectionBreakdown(many)).toBe(
      'ProdDB: 4 · Staging: 2 · Analytics: 1 · +2 more'
    )
  })

  it('respects a custom maxVisible', () => {
    expect(formatConnectionBreakdown(connections, 1)).toBe('ProdDB: 4 · +2 more')
  })

  it('returns an empty string when there are no connections', () => {
    expect(formatConnectionBreakdown([])).toBe('')
  })
})
