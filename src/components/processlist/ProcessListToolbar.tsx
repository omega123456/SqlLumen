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
import { showErrorToast, showSuccessToast, showWarningToast } from '../../stores/toast-store'
import type { KillResult, ProcessRow } from '../../lib/processlist-commands'
import styles from './ProcessListToolbar.module.css'
import { toErrorMessage } from '../../lib/error-message'

const SQL_PREVIEW_MAX_LENGTH = 80
const TRUNCATION_ELLIPSIS = '...'

const emptySet = new Set<number>()
const emptyRows: ProcessRow[] = []

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
  if (!sql) return NO_ACTIVE_QUERY_LABEL
  return sql.length > SQL_PREVIEW_MAX_LENGTH
    ? sql.slice(0, SQL_PREVIEW_MAX_LENGTH) + TRUNCATION_ELLIPSIS
    : sql
}

const NO_ACTIVE_QUERY_LABEL = '(no active query)'

function killButtonLabel(selectedCount: number): string {
  if (selectedCount === 0) return 'Kill query'
  return `Kill ${selectedCount} ${selectedCount === 1 ? 'Query' : 'Queries'}`
}

function processSql(rows: ProcessRow[], id: number): string {
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) return NO_ACTIVE_QUERY_LABEL
  return truncateSql(row.info)
}

interface KillConfirmMessageProps {
  isOpen: boolean
  selectedIds: Set<number>
  rows: ProcessRow[]
}

function KillConfirmMessage({ isOpen, selectedIds, rows }: KillConfirmMessageProps) {
  if (!isOpen) return null
  if (selectedIds.size === 0) return null
  return (
    <>
      Kill {selectedIds.size} process{selectedIds.size === 1 ? '' : 'es'}?
      <ul style={{ margin: '8px 0 0', paddingLeft: '20px', textAlign: 'left' }}>
        {[...selectedIds].map((id) => (
          <li key={id}>
            ID {id}: {processSql(rows, id)}
          </li>
        ))}
      </ul>
    </>
  )
}

export interface ProcessListToolbarProps {
  connectionId: string
  sessionId: string
  onRefresh: () => void
  isActive?: boolean
  workspaceTabId?: string
}

function notifyKillResults(results: KillResult[]): void {
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
}

interface KillDialogsInput {
  connectionId: string
  sessionId: string
  isActive: boolean
}

function useKillDialogLifecycle({ connectionId, isActive }: KillDialogsInput, reset: () => void) {
  const setConfirmDialogOpen = useProcessListStore((state) => state.setConfirmDialogOpen)
  const setSummaryDialogOpen = useProcessListStore((state) => state.setSummaryDialogOpen)
  const isMountedRef = useRef(false)

  useEffect(() => {
    if (isActive) return
    setConfirmDialogOpen(connectionId, false)
    setSummaryDialogOpen(connectionId, false)
    reset()
  }, [connectionId, isActive, setConfirmDialogOpen, setSummaryDialogOpen, reset])

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

  return isMountedRef
}

function useKillDialogs(input: KillDialogsInput) {
  const { connectionId, sessionId } = input
  const setConfirmDialogOpen = useProcessListStore((state) => state.setConfirmDialogOpen)
  const setSummaryDialogOpen = useProcessListStore((state) => state.setSummaryDialogOpen)
  const killSelectedProcesses = useProcessListStore((state) => state.killSelectedProcesses)
  const setSelectedIds = useProcessListStore((state) => state.setSelectedIds)
  const fetchProcessList = useProcessListStore((state) => state.fetchProcessList)
  const [killResults, setKillResults] = useState<KillResult[] | null>(null)
  const [isKilling, setIsKilling] = useState(false)
  const resetKillState = useCallback(() => {
    setKillResults(null)
    setIsKilling(false)
  }, [])
  const isMountedRef = useKillDialogLifecycle(input, resetKillState)

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
    isMountedRef,
    killSelectedProcesses,
    setConfirmDialogOpen,
    setSummaryDialogOpen,
  ])

  const handleCloseSummary = useCallback(() => {
    setKillResults(null)
    setSummaryDialogOpen(connectionId, false)
    setSelectedIds(connectionId, new Set<number>())
    fetchProcessList(connectionId, sessionId, true)
  }, [connectionId, sessionId, setSummaryDialogOpen, setSelectedIds, fetchProcessList])

  return { killResults, isKilling, handleConfirmKill, handleCloseSummary }
}

interface ProcessListStatusSectionProps {
  connectionId: string
  rowCount: number
  onRefresh: () => void
}

function ProcessListStatusSection({
  connectionId,
  rowCount,
  onRefresh,
}: ProcessListStatusSectionProps) {
  const isFetching = useProcessListStore(
    (state) => state.isFetchingByConnection[connectionId] ?? false
  )
  const lastRefreshedAt = useProcessListStore(
    (state) => state.lastRefreshedAtByConnection[connectionId] ?? null
  )
  const isReadOnly = useConnectionStore(
    (state) => state.activeConnections[connectionId]?.profile.readOnly ?? false
  )
  return (
    <div className={styles.leftSection}>
      <StatusArea status={isFetching ? 'loading' : 'success'} totalRows={rowCount} />

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
  )
}

interface ProcessListRefreshControlsProps {
  connectionId: string
  excludeIdleConnections: boolean
  workspaceTabId: string | undefined
}

function ProcessListRefreshControls({
  connectionId,
  excludeIdleConnections,
  workspaceTabId,
}: ProcessListRefreshControlsProps) {
  const refreshIntervalMs = useProcessListStore(
    (state) => state.refreshIntervalMsByConnection[connectionId] ?? DEFAULT_REFRESH_INTERVAL_MS
  )
  const setRefreshInterval = useProcessListStore((state) => state.setRefreshInterval)
  const setExcludeIdleConnections = useProcessListStore((state) => state.setExcludeIdleConnections)
  return (
    <>
      <Dropdown
        id="processlist-filter"
        ariaLabel="Process list filter"
        data-testid="processlist-filter-dropdown"
        options={FILTER_OPTIONS}
        value={excludeIdleConnections ? EXCLUDE_IDLE_FILTER_VALUE : SHOW_ALL_FILTER_VALUE}
        onChange={(value) =>
          setExcludeIdleConnections(connectionId, value === EXCLUDE_IDLE_FILTER_VALUE)
        }
        workspaceTabId={workspaceTabId}
        className={styles.autoWidthDropdown}
        triggerSize="sm"
        triggerWidth="auto"
      />

      <Dropdown
        id="processlist-interval"
        ariaLabel="Auto-refresh interval"
        data-testid="processlist-interval-dropdown"
        options={INTERVAL_OPTIONS}
        value={String(refreshIntervalMs)}
        onChange={(value) => setRefreshInterval(connectionId, Number(value))}
        workspaceTabId={workspaceTabId}
        className={styles.autoWidthDropdown}
        triggerSize="sm"
        triggerWidth="auto"
      />
    </>
  )
}

function useProcessListToolbarRows(connectionId: string) {
  const rows = useProcessListStore((state) => state.rowsByConnection[connectionId] ?? emptyRows)
  const selectedIds = useProcessListStore(
    (state) => state.selectedIdsByConnection[connectionId] ?? emptySet
  )
  const excludeIdleConnections = useProcessListStore(
    (state) =>
      state.excludeIdleConnectionsByConnection[connectionId] ?? DEFAULT_EXCLUDE_IDLE_CONNECTIONS
  )
  const isConfirmDialogOpen = useProcessListStore(
    (state) => state.isConfirmDialogOpenByConnection[connectionId] ?? false
  )
  const rowCount = filterProcessListRows(rows, excludeIdleConnections).length
  return { rows, selectedIds, excludeIdleConnections, isConfirmDialogOpen, rowCount }
}

export function ProcessListToolbar({
  connectionId,
  sessionId,
  onRefresh,
  isActive = true,
  workspaceTabId,
}: ProcessListToolbarProps) {
  const { rows, selectedIds, excludeIdleConnections, isConfirmDialogOpen, rowCount } =
    useProcessListToolbarRows(connectionId)
  const setConfirmDialogOpen = useProcessListStore((state) => state.setConfirmDialogOpen)
  const killDialogs = useKillDialogs({
    connectionId: connectionId,
    sessionId: sessionId,
    isActive: isActive,
  })

  return (
    <div className={styles.toolbar} data-testid="processlist-toolbar">
      <ProcessListStatusSection
        connectionId={connectionId}
        rowCount={rowCount}
        onRefresh={onRefresh}
      />

      <div className={styles.rightSection}>
        <ProcessListRefreshControls
          connectionId={connectionId}
          excludeIdleConnections={excludeIdleConnections}
          workspaceTabId={workspaceTabId}
        />

        <div className={styles.divider} />

        <Button
          variant="bare"
          className={styles.toolbarButtonDanger}
          data-testid="processlist-kill-button"
          disabled={selectedIds.size === 0}
          onClick={() => setConfirmDialogOpen(connectionId, true)}
        >
          <StopCircle size={16} weight="regular" />
          {killButtonLabel(selectedIds.size)}
        </Button>
      </div>

      <ConfirmDialog
        isOpen={isConfirmDialogOpen}
        title="Kill processes"
        message={
          <KillConfirmMessage isOpen={isConfirmDialogOpen} selectedIds={selectedIds} rows={rows} />
        }
        confirmLabel="Kill"
        isDestructive
        isLoading={killDialogs.isKilling}
        nonDismissible={killDialogs.isKilling}
        onConfirm={killDialogs.handleConfirmKill}
        onCancel={() => setConfirmDialogOpen(connectionId, false)}
      />

      <KillSummaryDialog
        results={killDialogs.killResults}
        onClose={killDialogs.handleCloseSummary}
      />
    </div>
  )
}
