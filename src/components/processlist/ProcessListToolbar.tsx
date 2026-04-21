import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise, StopCircle } from '@phosphor-icons/react'
import { useProcessListStore } from '../../stores/processlist-store'
import { formatProcessListRefreshTime } from '../../lib/processlist-time'
import { useConnectionStore } from '../../stores/connection-store'
import { Dropdown } from '../common/Dropdown'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { KillSummaryDialog } from './KillSummaryDialog'
import { StatusArea } from '../shared/toolbar/StatusArea'
import sharedToolbarStyles from '../shared/toolbar/toolbar-items.module.css'
import { showErrorToast, showSuccessToast, showWarningToast } from '../../stores/toast-store'
import type { KillResult } from '../../lib/processlist-commands'
import styles from './ProcessListToolbar.module.css'

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

function truncateSql(sql: string | null): string {
  if (!sql) return '(no active query)'
  return sql.length > 80 ? sql.slice(0, 80) + '...' : sql
}

export interface ProcessListToolbarProps {
  connectionId: string
  sessionId: string
  onRefresh: () => void
}

export function ProcessListToolbar({
  connectionId,
  sessionId,
  onRefresh,
}: ProcessListToolbarProps) {
  const rows = useProcessListStore((s) => s.rowsByConnection[connectionId] ?? emptyRows)
  const selectedIds = useProcessListStore(
    (s) => s.selectedIdsByConnection[connectionId] ?? emptySet
  )
  const selectedCount = selectedIds.size
  const rowCount = rows.length
  const isFetching = useProcessListStore((s) => s.isFetchingByConnection[connectionId] ?? false)
  const refreshIntervalMs = useProcessListStore(
    (s) => s.refreshIntervalMsByConnection[connectionId] ?? 5000
  )
  const lastRefreshedAt = useProcessListStore(
    (s) => s.lastRefreshedAtByConnection[connectionId] ?? null
  )
  const isConfirmDialogOpen = useProcessListStore(
    (s) => s.isConfirmDialogOpenByConnection[connectionId] ?? false
  )
  const setRefreshInterval = useProcessListStore((s) => s.setRefreshInterval)
  const setConfirmDialogOpen = useProcessListStore((s) => s.setConfirmDialogOpen)
  const setSummaryDialogOpen = useProcessListStore((s) => s.setSummaryDialogOpen)
  const killSelectedProcesses = useProcessListStore((s) => s.killSelectedProcesses)
  const setSelectedIds = useProcessListStore((s) => s.setSelectedIds)
  const fetchProcessList = useProcessListStore((s) => s.fetchProcessList)

  const activeConnections = useConnectionStore((s) => s.activeConnections)
  const isReadOnly = activeConnections[connectionId]?.profile.readOnly ?? false

  const [killResults, setKillResults] = useState<KillResult[] | null>(null)
  const [isKilling, setIsKilling] = useState(false)
  const isMountedRef = useRef(false)

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
    } catch (err) {
      if (!isMountedRef.current) return

      const msg = err instanceof Error ? err.message : String(err)
      showErrorToast('Kill failed', msg)
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
      : 'Kill Query'

  // Build the confirm content with truncated SQL for each selected process
  const confirmMessage =
    isConfirmDialogOpen && selectedIds.size > 0 ? (
      <>
        Kill {selectedIds.size} process{selectedIds.size === 1 ? '' : 'es'}?
        <ul style={{ margin: '8px 0 0', paddingLeft: '20px', textAlign: 'left' }}>
          {[...selectedIds].map((id) => {
            const row = rows.find((r) => r.id === id)
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

        <button
          type="button"
          className={styles.iconButton}
          onClick={onRefresh}
          title="Refresh"
          data-testid="processlist-refresh-button"
          aria-label="Refresh"
        >
          <ArrowCounterClockwise size={16} weight="bold" />
        </button>

        {lastRefreshedAt !== null && (
          <span className={styles.meta} data-testid="processlist-last-updated">
            Last updated: {formatProcessListRefreshTime(lastRefreshedAt)}
          </span>
        )}
      </div>

      {/* Right section: Interval dropdown + Kill button */}
      <div className={styles.rightSection}>
        <Dropdown
          id="processlist-interval"
          ariaLabel="Auto-refresh interval"
          data-testid="processlist-interval-dropdown"
          options={INTERVAL_OPTIONS}
          value={String(refreshIntervalMs)}
          onChange={handleIntervalChange}
          triggerClassName={sharedToolbarStyles.pageSizeSelect}
        />

        <div className={styles.divider} />

        <button
          type="button"
          className={styles.toolbarButtonDanger}
          data-testid="processlist-kill-button"
          disabled={selectedCount === 0 || isReadOnly}
          onClick={handleKillClick}
        >
          <StopCircle size={16} weight="regular" />
          {killLabel}
        </button>
      </div>

      <ConfirmDialog
        isOpen={isConfirmDialogOpen}
        title="Kill Processes"
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
