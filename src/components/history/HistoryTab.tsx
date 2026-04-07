import { useCallback, useEffect, useMemo, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useConnectionStore } from '../../stores/connection-store'
import { useHistoryStore } from '../../stores/history-store'
import { insertSqlIntoEditor } from '../../lib/query-tab-utils'
import { Button } from '../common/Button'
import { HistoryFilterPanel } from './HistoryFilterPanel'
import { HistoryTable } from './HistoryTable'
import { HistoryDetailPanel } from './HistoryDetailPanel'
import type { TimeRange } from './HistoryFilterPanel'
import type { HistoryEntry, HistoryTab as HistoryTabType } from '../../types/schema'
import styles from './HistoryTab.module.css'

/** Stable default references to avoid infinite re-render from useSyncExternalStore. */
const EMPTY_ENTRIES: HistoryEntry[] = []

export interface HistoryTabProps {
  tab: HistoryTabType
}

/** Time range durations in milliseconds. */
const RANGE_MS: Record<Exclude<TimeRange, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

export function HistoryTab({ tab }: HistoryTabProps) {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeConnection = activeConnections[tab.connectionId]
  const connectionId = activeConnection ? tab.connectionId : null

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

  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null)
  const [cutoffTimestamp, setCutoffTimestamp] = useState<number | null>(null)

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    setTimeRange(range)
    setCutoffTimestamp(range === 'all' ? null : Date.now() - RANGE_MS[range])
  }, [])

  // Load history on mount or when connectionId changes
  useEffect(() => {
    if (connectionId) {
      loadHistory(connectionId)
    }
  }, [connectionId, loadHistory])

  // Derive filtered entries based on time range
  const filteredEntries = useMemo(() => {
    if (!cutoffTimestamp) return entries
    return entries.filter((entry) => new Date(entry.timestamp).getTime() >= cutoffTimestamp)
  }, [entries, cutoffTimestamp])

  // Find the selected entry from filtered list
  const selectedEntry = useMemo(
    () => filteredEntries.find((e) => e.id === selectedEntryId) ?? null,
    [filteredEntries, selectedEntryId]
  )

  // Handle "Open in Editor" — reuse active query tab if one exists
  const handleOpenInEditor = useCallback(
    (entry: HistoryEntry) => {
      if (!connectionId) return
      insertSqlIntoEditor(connectionId, entry.sqlText, 'History Query')
    },
    [connectionId]
  )

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
        <HistoryFilterPanel value={timeRange} onChange={handleTimeRangeChange} />
      </div>

      {error ? (
        <div className={styles.errorState} data-testid="history-error">
          <p className={styles.errorMessage}>{error}</p>
          <Button
            variant="ghost"
            onClick={() => loadHistory(connectionId)}
            data-testid="history-retry"
          >
            Retry
          </Button>
        </div>
      ) : isLoading && entries.length === 0 ? (
        <div className={styles.loadingState} data-testid="history-loading">
          Loading history...
        </div>
      ) : (
        <Group orientation="horizontal" className={styles.panelGroup}>
          <Panel defaultSize="65%" minSize="30%" className={styles.tablePanel}>
            <HistoryTable
              entries={filteredEntries}
              selectedEntryId={selectedEntryId}
              onSelectEntry={setSelectedEntryId}
              onOpenInEditor={handleOpenInEditor}
              connectionId={connectionId}
            />
          </Panel>
          <Separator className={styles.resizeHandle}>
            <div className={styles.resizePill} />
          </Separator>
          <Panel defaultSize="35%" minSize="20%" className={styles.detailPanel}>
            <HistoryDetailPanel entry={selectedEntry} onOpenInEditor={handleOpenInEditor} />
          </Panel>
        </Group>
      )}
    </div>
  )
}
