import { useCallback, useEffect } from 'react'
import { DEFAULT_REFRESH_INTERVAL_MS, useProcessListStore } from '../../stores/processlist-store'
import { ProcessListToolbar } from './ProcessListToolbar'
import { ProcessListGridView } from './ProcessListGridView'

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
  const fetchProcessList = useProcessListStore((state) => state.fetchProcessList)
  const refreshIntervalMs = useProcessListStore(
    (state) => state.refreshIntervalMsByConnection[connectionId] ?? DEFAULT_REFRESH_INTERVAL_MS
  )
  const isConfirmDialogOpen = useProcessListStore(
    (state) => state.isConfirmDialogOpenByConnection[connectionId] ?? false
  )
  const isSummaryDialogOpen = useProcessListStore(
    (state) => state.isSummaryDialogOpenByConnection[connectionId] ?? false
  )
  useEffect(() => {
    if (isActive) {
      fetchProcessList(connectionId, sessionId, false)
    }
  }, [isActive, connectionId, sessionId, fetchProcessList])

  const handleRefresh = useCallback(
    (isManual: boolean) => {
      fetchProcessList(connectionId, sessionId, isManual)
    },
    [connectionId, sessionId, fetchProcessList]
  )

  const handleManualRefresh = useCallback(() => {
    handleRefresh(true)
  }, [handleRefresh])

  useEffect(() => {
    if (!isActive) return
    if (refreshIntervalMs <= 0) return
    if (isConfirmDialogOpen) return
    if (isSummaryDialogOpen) return

    const id = setInterval(() => {
      handleRefresh(false)
    }, refreshIntervalMs)

    return () => clearInterval(id)
  }, [isActive, refreshIntervalMs, isConfirmDialogOpen, isSummaryDialogOpen, handleRefresh])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" data-testid="processlist-tab">
      <ProcessListToolbar
        connectionId={connectionId}
        sessionId={sessionId}
        onRefresh={handleManualRefresh}
        isActive={isActive}
        workspaceTabId={workspaceTabId ?? connectionId}
      />
      <div className="min-h-0 flex-1 overflow-hidden" data-testid="processlist-grid">
        <ProcessListGridView connectionId={connectionId} isActive={isActive} />
      </div>
    </div>
  )
}
