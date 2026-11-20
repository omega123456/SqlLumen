import { useEffect } from 'react'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useIsConnectionReadOnly } from '../../../stores/connection-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { TableDataTab } from '../../../types/schema'

interface TableDataTabLifecycle {
  tab: TableDataTab
  isActive: boolean
  hasPendingNavigation: boolean
  isExportDialogOpen: boolean
}

function useInitialTableLoad(tab: TableDataTab, isActive: boolean) {
  const initTab = useTableDataStore((state) => state.initTab)
  const loadTableData = useTableDataStore((state) => state.loadTableData)
  const { id: tabId, connectionId, databaseName: database, objectName: table, objectType } = tab
  useEffect(() => {
    const existing = useTableDataStore.getState().tabs[tabId]
    const needsInitialLoad = isActive && !existing
    if (!needsInitialLoad) return
    initTab(tabId, {
      connectionId: connectionId,
      database: database,
      table: table,
      isView: objectType === 'view',
    })
    void loadTableData(tabId)
  }, [tabId, connectionId, database, table, objectType, isActive, initTab, loadTableData])
}

function useEditTargetFollowsReadOnly(tab: TableDataTab) {
  const isConnectionReadOnly = useIsConnectionReadOnly(tab.connectionId)
  const refreshEditTarget = useTableDataStore((state) => state.refreshEditTarget)
  useEffect(() => {
    refreshEditTarget(tab.id)
  }, [isConnectionReadOnly, refreshEditTarget, tab.id])
}

export function useTableDataTabLifecycle(lifecycle: TableDataTabLifecycle) {
  const { tab, isActive, hasPendingNavigation, isExportDialogOpen } = lifecycle
  const tabId = tab.id
  const setBlockingNavigation = useWorkspaceStore((state) => state.setBlockingNavigation)
  const closeExportDialog = useTableDataStore((state) => state.closeExportDialog)
  useInitialTableLoad(tab, isActive)
  useEditTargetFollowsReadOnly(tab)

  useEffect(() => {
    setBlockingNavigation(tabId, hasPendingNavigation)
    return () => setBlockingNavigation(tabId, false)
  }, [hasPendingNavigation, setBlockingNavigation, tabId])

  useEffect(() => {
    if (isActive) return
    if (isExportDialogOpen) closeExportDialog(tabId)
  }, [closeExportDialog, isActive, isExportDialogOpen, tabId])
}
