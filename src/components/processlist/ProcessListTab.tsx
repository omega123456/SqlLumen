import { useCallback, useEffect } from 'react'
import { DEFAULT_REFRESH_INTERVAL_MS, useProcessListStore } from '../../stores/processlist-store'
import { ProcessListToolbar } from './ProcessListToolbar'
import { ProcessListGridView } from './ProcessListGridView'
import styles from './ProcessListTab.module.css'

export interface ProcessListTabProps {
  connectionId: string
  sessionId: string
  workspaceTabId?: string
  isActive?: boolean
}

export default function ProcessListTab({
  connectionId,
  sessionId,
  workspaceTabId,
  isActive = true,
}: ProcessListTabProps) {
  const fetchProcessList = useProcessListStore((s) => s.fetchProcessList)
  const refreshIntervalMs = useProcessListStore(
    (s) => s.refreshIntervalMsByConnection[connectionId] ?? DEFAULT_REFRESH_INTERVAL_MS
  )
  const isConfirmDialogOpen = useProcessListStore(
    (s) => s.isConfirmDialogOpenByConnection[connectionId] ?? false
  )
  const isSummaryDialogOpen = useProcessListStore(
    (s) => s.isSummaryDialogOpenByConnection[connectionId] ?? false
  )
  const hasFetched = useProcessListStore((s) => s.hasFetchedByConnection[connectionId] ?? false)

  // Initial fetch on first activation
  useEffect(() => {
    if (isActive && !hasFetched) {
      fetchProcessList(connectionId, sessionId, false)
    }
  }, [isActive, hasFetched, connectionId, sessionId, fetchProcessList])

  const handleRefresh = useCallback(
    (isManual: boolean) => {
      fetchProcessList(connectionId, sessionId, isManual)
    },
    [connectionId, sessionId, fetchProcessList]
  )

  const handleManualRefresh = useCallback(() => {
    handleRefresh(true)
  }, [handleRefresh])

  // Auto-refresh interval — pause when any dialog is open
  useEffect(() => {
    if (!isActive || refreshIntervalMs <= 0 || isConfirmDialogOpen || isSummaryDialogOpen) {
      return
    }

    const id = setInterval(() => {
      handleRefresh(false)
    }, refreshIntervalMs)

    return () => clearInterval(id)
  }, [isActive, refreshIntervalMs, isConfirmDialogOpen, isSummaryDialogOpen, handleRefresh])

  return (
    <div className={styles.container} data-testid="processlist-tab">
      <ProcessListToolbar
        connectionId={connectionId}
        sessionId={sessionId}
        onRefresh={handleManualRefresh}
        isActive={isActive}
        workspaceTabId={workspaceTabId ?? connectionId}
      />
      <div className={styles.gridWrapper} data-testid="processlist-grid">
        <ProcessListGridView connectionId={connectionId} isActive={isActive} />
      </div>
    </div>
  )
}
