import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise, StopCircle } from '@phosphor-icons/react'
import {
  DEFAULT_EXCLUDE_IDLE_CONNECTIONS,
  DEFAULT_REFRESH_INTERVAL_MS,
  useProcessListStore,
} from '../../stores/processlist-store'
import { filterProcessListRows } from '../../lib/processlist-filter'
import { formatProcessListRefreshTime } from '../../lib/processlist-time'
import { useConnectionStore } from '../../stores/connection-store'
import { Dropdown } from '../common/Dropdown'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { KillSummaryDialog } from './KillSummaryDialog'
import { StatusArea } from '../shared/toolbar/StatusArea'
import { Button } from '../common/Button'
import sharedToolbarStyles from '../shared/toolbar/toolbar-items.module.css'
import { showErrorToast, showSuccessToast, showWarningToast } from '../../stores/toast-store'
import type { KillResult } from '../../lib/processlist-commands'
import styles from './ProcessListToolbar.module.css'
import { toErrorMessage } from '../../lib/error-message'

const SQL_PREVIEW_MAX_LENGTH = 80
const TRUNCATION_ELLIPSIS = '...'

const emptySet = new Set<number>()
const emptyRows: import('../../lib/processlist-commands').ProcessRow[] = []

const INTERVAL_OPTIONS = [
  { label: 'Off', value: '0' },
  { label: '1s', value: '1000' },
  { label: '2s', value: '2000' },
  { label: '5s', value: '5000' },
  { label: '10s', value: '10000' },
  { label: '30s', value: '30000' },
]

const FILTER_OPTIONS = [
  { label: 'Exclude idle', value: 'exclude-idle' },
  { label: 'Show all', value: 'show-all' },
]

const EXCLUDE_IDLE_FILTER_VALUE = 'exclude-idle'
const SHOW_ALL_FILTER_VALUE = 'show-all'

function truncateSql(sql: string | null): string {
  if (!sql) return '(no active query)'
  return sql.length > SQL_PREVIEW_MAX_LENGTH
    ? sql.slice(0, SQL_PREVIEW_MAX_LENGTH) + TRUNCATION_ELLIPSIS
    : sql
}

export interface ProcessListToolbarProps {
  connectionId: string
  sessionId: string
  onRefresh: () => void
  isActive?: boolean
  workspaceTabId?: string
}

export function ProcessListToolbar({
  connectionId,
  sessionId,
  onRefresh,
  isActive = true,
  workspaceTabId,
}: ProcessListToolbarProps) {
  const rows = useProcessListStore((state) => state.rowsByConnection[connectionId] ?? emptyRows)
  const selectedIds = useProcessListStore(
    (state) => state.selectedIdsByConnection[connectionId] ?? emptySet
  )
  const isFetching = useProcessListStore(
    (state) => state.isFetchingByConnection[connectionId] ?? false
  )
  const refreshIntervalMs = useProcessListStore(
    (state) => state.refreshIntervalMsByConnection[connectionId] ?? DEFAULT_REFRESH_INTERVAL_MS
  )
  const excludeIdleConnections = useProcessListStore(
    (state) =>
      state.excludeIdleConnectionsByConnection[connectionId] ?? DEFAULT_EXCLUDE_IDLE_CONNECTIONS
  )
  const lastRefreshedAt = useProcessListStore(
    (state) => state.lastRefreshedAtByConnection[connectionId] ?? null
  )
  const isConfirmDialogOpen = useProcessListStore(
    (state) => state.isConfirmDialogOpenByConnection[connectionId] ?? false
  )
  const setRefreshInterval = useProcessListStore((state) => state.setRefreshInterval)
  const setExcludeIdleConnections = useProcessListStore((state) => state.setExcludeIdleConnections)
  const setConfirmDialogOpen = useProcessListStore((state) => state.setConfirmDialogOpen)
  const setSummaryDialogOpen = useProcessListStore((state) => state.setSummaryDialogOpen)
  const killSelectedProcesses = useProcessListStore((state) => state.killSelectedProcesses)
  const setSelectedIds = useProcessListStore((state) => state.setSelectedIds)
  const fetchProcessList = useProcessListStore((state) => state.fetchProcessList)

  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const isReadOnly = activeConnections[connectionId]?.profile.readOnly ?? false
  const visibleRows = filterProcessListRows(rows, excludeIdleConnections)
  const selectedCount = selectedIds.size
  const rowCount = visibleRows.length

  const [killResults, setKillResults] = useState<KillResult[] | null>(null)
  const [isKilling, setIsKilling] = useState(false)
  const isMountedRef = useRef(false)

  useEffect(() => {
    if (isActive) return
    setConfirmDialogOpen(connectionId, false)
    setSummaryDialogOpen(connectionId, false)
    setKillResults(null)
    setIsKilling(false)
  }, [connectionId, isActive, setConfirmDialogOpen, setSummaryDialogOpen])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      const isSummaryDialogOpen =
        useProcessListStore.getState().isSummaryDialogOpenByConnection[connectionId] ?? false
      if (isSummaryDialogOpen) {
        setSummaryDialogOpen(connectionId, false)
      }
    }
  }, [connectionId, setSummaryDialogOpen])

  const notifyKillResults = useCallback((results: KillResult[]) => {
    const successCount = results.filter((result) => result.success).length
    const failures = results.filter((result) => !result.success)

    if (successCount > 0) {
      showSuccessToast(successCount === 1 ? '1 process killed' : `${successCount} processes killed`)
    }

    if (failures.length > 0) {
      const failureSummary = failures
        .map((failure) => `ID ${failure.id}: ${failure.error ?? 'Unknown error'}`)
        .join('; ')
      showWarningToast(
        failures.length === 1
          ? '1 process failed to kill'
          : `${failures.length} processes failed to kill`,
        failureSummary
      )
    }
  }, [])

  const handleIntervalChange = useCallback(
    (value: string) => {
      setRefreshInterval(connectionId, Number(value))
    },
    [connectionId, setRefreshInterval]
  )

  const handleFilterChange = useCallback(
    (value: string) => {
      setExcludeIdleConnections(connectionId, value === EXCLUDE_IDLE_FILTER_VALUE)
    },
    [connectionId, setExcludeIdleConnections]
  )

  const handleKillClick = useCallback(() => {
    setConfirmDialogOpen(connectionId, true)
  }, [connectionId, setConfirmDialogOpen])

  const handleConfirmKill = useCallback(async () => {
    setIsKilling(true)
    try {
      const results = await killSelectedProcesses(connectionId, sessionId)
      if (!isMountedRef.current) return

      setConfirmDialogOpen(connectionId, false)
      setKillResults(results)
      notifyKillResults(results)
      setSummaryDialogOpen(connectionId, true)
    } catch (error) {
      if (!isMountedRef.current) return

      const message = toErrorMessage(error)
      showErrorToast('Kill failed', message)
      setConfirmDialogOpen(connectionId, false)
    } finally {
      if (isMountedRef.current) {
        setIsKilling(false)
      }
    }
  }, [
    connectionId,
    sessionId,
    killSelectedProcesses,
    notifyKillResults,
    setConfirmDialogOpen,
    setSummaryDialogOpen,
  ])

  const handleCancelKill = useCallback(() => {
    setConfirmDialogOpen(connectionId, false)
  }, [connectionId, setConfirmDialogOpen])

  const handleCloseSummary = useCallback(() => {
    setKillResults(null)
    setSummaryDialogOpen(connectionId, false)
    setSelectedIds(connectionId, new Set<number>())
    fetchProcessList(connectionId, sessionId, true)
  }, [connectionId, sessionId, setSummaryDialogOpen, setSelectedIds, fetchProcessList])

  const killLabel =
    selectedCount > 0
      ? `Kill ${selectedCount} ${selectedCount === 1 ? 'Query' : 'Queries'}`
      : 'Kill query'

  // Build the confirm content with truncated SQL for each selected process
  const confirmMessage =
    isConfirmDialogOpen && selectedIds.size > 0 ? (
      <>
        Kill {selectedIds.size} process{selectedIds.size === 1 ? '' : 'es'}?
        <ul style={{ margin: '8px 0 0', paddingLeft: '20px', textAlign: 'left' }}>
          {[...selectedIds].map((id) => {
            const row = rows.find((candidate) => candidate.id === id)
            const sql = row ? truncateSql(row.info) : '(no active query)'
            return (
              <li key={id}>
                ID {id}: {sql}
              </li>
            )
          })}
        </ul>
      </>
    ) : (
      ''
    )

  return (
    <div className={styles.toolbar} data-testid="processlist-toolbar">
      {/* Left section: Status + refresh + meta */}
      <div className={styles.leftSection}>
        {/* Status — shared component */}
        <StatusArea status={isFetching ? 'loading' : 'success'} totalRows={rowCount} />

        {/* Read-only badge */}
        {isReadOnly && (
          <span className={styles.readonlyBadge} data-testid="processlist-readonly-badge">
            &#x1F512; READ-ONLY
          </span>
        )}

        <div className={styles.divider} />

        <Button
          variant="bare"
          className={styles.iconButton}
          onClick={onRefresh}
          title="Refresh"
          data-testid="processlist-refresh-button"
          aria-label="Refresh"
        >
          <ArrowCounterClockwise size={16} weight="bold" />
        </Button>

        {lastRefreshedAt !== null && (
          <span className={styles.meta} data-testid="processlist-last-updated">
            Last updated: {formatProcessListRefreshTime(lastRefreshedAt)}
          </span>
        )}
      </div>

      {/* Right section: Interval dropdown + Kill button */}
      <div className={styles.rightSection}>
        <Dropdown
          id="processlist-filter"
          ariaLabel="Process list filter"
          data-testid="processlist-filter-dropdown"
          options={FILTER_OPTIONS}
          value={excludeIdleConnections ? EXCLUDE_IDLE_FILTER_VALUE : SHOW_ALL_FILTER_VALUE}
          onChange={handleFilterChange}
          workspaceTabId={workspaceTabId}
          className={styles.autoWidthDropdown}
          triggerClassName={sharedToolbarStyles.pageSizeSelect}
        />

        <Dropdown
          id="processlist-interval"
          ariaLabel="Auto-refresh interval"
          data-testid="processlist-interval-dropdown"
          options={INTERVAL_OPTIONS}
          value={String(refreshIntervalMs)}
          onChange={handleIntervalChange}
          workspaceTabId={workspaceTabId}
          className={styles.autoWidthDropdown}
          triggerClassName={sharedToolbarStyles.pageSizeSelect}
        />

        <div className={styles.divider} />

        <Button
          variant="bare"
          className={styles.toolbarButtonDanger}
          data-testid="processlist-kill-button"
          disabled={selectedCount === 0}
          onClick={handleKillClick}
        >
          <StopCircle size={16} weight="regular" />
          {killLabel}
        </Button>
      </div>

      <ConfirmDialog
        isOpen={isConfirmDialogOpen}
        title="Kill processes"
        message={confirmMessage}
        confirmLabel="Kill"
        isDestructive
        isLoading={isKilling}
        nonDismissible={isKilling}
        onConfirm={handleConfirmKill}
        onCancel={handleCancelKill}
      />

      <KillSummaryDialog results={killResults} onClose={handleCloseSummary} />
    </div>
  )
}
