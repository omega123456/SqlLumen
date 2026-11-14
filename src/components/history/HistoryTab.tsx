import { useCallback, useEffect, useMemo, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useConnectionStore } from '../../stores/connection-store'
import { useHistoryStore } from '../../stores/history-store'
import { insertSqlIntoEditor } from '../../lib/query-tab-utils'
import { HistoryFilterPanel } from './HistoryFilterPanel'
import { HistoryTable } from './HistoryTable'
import { HistoryDetailPanel } from './HistoryDetailPanel'
import type { TimeRange } from './HistoryFilterPanel'
import type { HistoryEntry, HistoryTab as HistoryTabType } from '../../types/schema'
import styles from './HistoryTab.module.css'
import { MILLISECONDS_PER_DAY } from '../../lib/units'

const DAYS_PER_WEEK = 7
const DAYS_PER_MONTH_RANGE = 30

/** Stable default references to avoid infinite re-render from useSyncExternalStore. */
const EMPTY_ENTRIES: HistoryEntry[] = []

export interface HistoryTabProps {
  tab: HistoryTabType
  isActive?: boolean
}

/** Time range durations in milliseconds. */
const RANGE_MS: Record<Exclude<TimeRange, 'all'>, number> = {
  '24h': MILLISECONDS_PER_DAY,
  '7d': DAYS_PER_WEEK * MILLISECONDS_PER_DAY,
  '30d': DAYS_PER_MONTH_RANGE * MILLISECONDS_PER_DAY,
}

/**
 * Convert a {@link TimeRange} into an RFC-3339 lower bound for the backend
 * query, or `null` for the unbounded "all history" range.
 */
function rangeToSince(range: TimeRange): string | null {
  if (range === 'all') return null
  return new Date(Date.now() - RANGE_MS[range]).toISOString()
}

function useHistoryEntries(connectionId: string | null) {
  const loadHistory = useHistoryStore((state) => state.loadHistory)
  const entries = useHistoryStore((state) =>
    connectionId ? (state.entriesByConnection[connectionId] ?? EMPTY_ENTRIES) : EMPTY_ENTRIES
  )
  const isLoading = useHistoryStore((state) =>
    connectionId ? (state.isLoadingByConnection[connectionId] ?? false) : false
  )
  const error = useHistoryStore((state) =>
    connectionId ? (state.errorByConnection[connectionId] ?? null) : null
  )
  return { loadHistory, entries, isLoading, error }
}

function useHistoryTabView(connectionId: string | null, isActive: boolean) {
  const { loadHistory, entries, isLoading, error } = useHistoryEntries(connectionId)
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null)

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    setTimeRange(range)
    setSelectedEntryId(null)
  }, [])

  const reload = useCallback(
    (range: TimeRange) => {
      if (!connectionId) return
      void loadHistory(connectionId, { page: 1, since: rangeToSince(range) })
    },
    [connectionId, loadHistory]
  )

  useEffect(() => {
    if (!isActive) return
    if (!connectionId) return
    reload(timeRange)
  }, [isActive, connectionId, timeRange, reload])

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedEntryId) ?? null,
    [entries, selectedEntryId]
  )

  const handleOpenInEditor = useCallback(
    (entry: HistoryEntry) => {
      if (!connectionId) return
      insertSqlIntoEditor(connectionId, entry.sqlText, 'History query')
    },
    [connectionId]
  )

  return {
    entries,
    isLoading,
    error,
    timeRange,
    selectedEntryId,
    selectedEntry,
    setSelectedEntryId,
    handleTimeRangeChange,
    handleOpenInEditor,
    reload,
  }
}

export function HistoryTab({ tab, isActive = true }: HistoryTabProps) {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeConnection = activeConnections[tab.connectionId]
  const connectionId = activeConnection ? tab.connectionId : null

  const view = useHistoryTabView(connectionId, isActive)

  if (!connectionId) {
    return (
      <div className={styles.container} data-testid="history-tab">
        <div className={styles.noConnection}>
          <p>No active connection</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container} data-testid="history-tab">
      <div className={styles.filterSide}>
        <HistoryFilterPanel value={view.timeRange} onChange={view.handleTimeRangeChange} />
      </div>

      <Group orientation="horizontal" className={styles.panelGroup}>
        <Panel minSize="30%" className={styles.tablePanel}>
          <HistoryTable
            entries={view.entries}
            selectedEntryId={view.selectedEntryId}
            onSelectEntry={view.setSelectedEntryId}
            onOpenInEditor={view.handleOpenInEditor}
            connectionId={connectionId}
            isLoading={view.isLoading}
            error={view.error}
            onRetry={() => view.reload(view.timeRange)}
          />
        </Panel>
        <Separator className={styles.resizeHandle} />
        <Panel defaultSize="330px" minSize="240px" className={styles.detailPanel}>
          <HistoryDetailPanel
            entry={view.selectedEntry}
            onOpenInEditor={view.handleOpenInEditor}
            connectionName={activeConnection?.profile.name}
          />
        </Panel>
      </Group>
    </div>
  )
}
