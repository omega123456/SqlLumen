import { useCallback, useEffect, useMemo, useState } from 'react'
import { sub, type Duration } from 'date-fns'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useConnectionStore } from '../../stores/connection-store'
import { useHistoryStore } from '../../stores/history-store'
import { insertSqlIntoEditor } from '../../lib/query-tab-utils'
import { HistoryFilterPanel } from './HistoryFilterPanel'
import { HistoryTable } from './HistoryTable'
import { HistoryDetailPanel } from './HistoryDetailPanel'
import type { TimeRange } from './HistoryFilterPanel'
import type { HistoryEntry, HistoryTab as HistoryTabType } from '../../types/schema'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'

const EMPTY_ENTRIES: HistoryEntry[] = []

const HISTORY_TAB_FRAME = 'flex h-full w-full flex-row overflow-hidden'

const PANEL_FRAME = 'flex flex-col overflow-hidden'

const RESIZE_HANDLE = joinClassNames([
  'relative w-px shrink-0 cursor-col-resize bg-light-stroke-divider after:absolute after:inset-y-0 after:-inset-x-0.75 hover:bg-light-primary resize-dragging:bg-light-primary dark:bg-dark-stroke-divider dark:hover:bg-dark-primary dark:resize-dragging:bg-dark-primary',
  FOCUS_RING,
])

export interface HistoryTabProps {
  tab: HistoryTabType
  isActive?: boolean
}

const RANGE_DURATION: Record<Exclude<TimeRange, 'all'>, Duration> = {
  '24h': { hours: 24 },
  '7d': { days: 7 },
  '30d': { days: 30 },
}

function rangeToSince(range: TimeRange): string | null {
  if (range === 'all') return null
  return sub(new Date(), RANGE_DURATION[range]).toISOString()
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
      <div className={HISTORY_TAB_FRAME} data-testid="history-tab">
        <div className="flex h-full items-center justify-center text-size-body text-light-on-surface-variant dark:text-dark-on-surface-variant">
          <p className="wrap-break-word">No active connection</p>
        </div>
      </div>
    )
  }

  return (
    <div className={HISTORY_TAB_FRAME} data-testid="history-tab">
      <div className="w-50 shrink-0 overflow-hidden border-r border-light-stroke-divider dark:border-dark-stroke-divider">
        <HistoryFilterPanel value={view.timeRange} onChange={view.handleTimeRangeChange} />
      </div>

      <Group orientation="horizontal" className="min-w-0 flex-1">
        <Panel minSize="30%" className={PANEL_FRAME}>
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
        <Separator className={RESIZE_HANDLE} />
        <Panel defaultSize="330px" minSize="240px" className={PANEL_FRAME}>
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
