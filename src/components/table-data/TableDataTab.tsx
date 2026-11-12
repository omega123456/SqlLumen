/**
 * TableDataTab — main container for the table data browser/editor.
 *
 * Replaces TableDataPlaceholder. Renders the toolbar, grid (or form view),
 * export dialog, and unsaved-changes dialog for a single table-data tab.
 */

import { useEffect, useCallback } from 'react'
import { useTableDataStore } from '../../stores/table-data-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { exportTableData } from '../../lib/table-data-commands'
import { TableDataToolbar } from './TableDataToolbar'
import { TableDataGrid } from './TableDataGrid'
import { TableDataFormView } from './TableDataFormView'
import { UnsavedChangesDialog } from '../shared/UnsavedChangesDialog'
import ExportDialog from '../dialogs/ExportDialog'
import type { WorkspaceTab, TableDataTab as TableDataTabType } from '../../types/schema'
import { InfoBar } from '../common/InfoBar'
import { Button } from '../common/Button'
import styles from './TableDataTab.module.css'

interface TableDataTabProps {
  tab: WorkspaceTab
  isActive?: boolean
  renderMode?: 'standalone' | 'bottom-panel'
}

export function TableDataTab({
  tab,
  isActive = true,
  renderMode = 'standalone',
}: TableDataTabProps) {
  const tableDataTab = tab as TableDataTabType
  const tabId = tableDataTab.id
  const connectionId = tableDataTab.connectionId
  const database = tableDataTab.databaseName
  const table = tableDataTab.objectName

  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const initTab = useTableDataStore((state) => state.initTab)
  const loadTableData = useTableDataStore((state) => state.loadTableData)
  const confirmNavigationSave = useTableDataStore((state) => state.confirmNavigationSave)
  const confirmNavigationDiscard = useTableDataStore((state) => state.confirmNavigationDiscard)
  const cancelNavigation = useTableDataStore((state) => state.cancelNavigation)
  const closeExportDialog = useTableDataStore((state) => state.closeExportDialog)
  const setBlockingNavigation = useWorkspaceStore((state) => state.setBlockingNavigation)

  // Look up the active connection to get the profile for readOnly info
  const activeConnection = useConnectionStore((state) => state.activeConnections[connectionId])
  const isReadOnly = activeConnection?.profile?.readOnly ?? false
  const isViewObject = tableDataTab.objectType === 'view'
  const effectiveReadOnly = isReadOnly || isViewObject

  useEffect(() => {
    // Only init + load if we don't already have state for this tab
    // (prevents re-loading when switching back to the tab after it was unmounted)
    const existing = useTableDataStore.getState().tabs[tabId]
    if (isActive && !existing) {
      initTab(tabId, connectionId, database, table)
      loadTableData(tabId)
    }
    // DO NOT call cleanupTab on unmount — workspace-store handles that
    // when the tab is actually closed (via closeTab / closeTabsByDatabase etc.)
  }, [tabId, connectionId, database, table, isActive, initTab, loadTableData])

  const handleRetry = useCallback(() => {
    loadTableData(tabId)
  }, [loadTableData, tabId])

  const handleSaveNavigation = useCallback(async () => {
    await confirmNavigationSave(tabId)
  }, [confirmNavigationSave, tabId])

  const handleDiscardNavigation = useCallback(() => {
    confirmNavigationDiscard(tabId)
  }, [confirmNavigationDiscard, tabId])

  const handleCancelNavigation = useCallback(() => {
    cancelNavigation(tabId)
  }, [cancelNavigation, tabId])

  const filterModel = tabState?.filterModel
  const sort = tabState?.sort
  const currentPage = tabState?.currentPage
  const pageSize = tabState?.pageSize
  const hasActiveFilters = (filterModel?.length ?? 0) > 0
  const exportFilterModel = hasActiveFilters ? filterModel : undefined

  const handleExport = useCallback(
    async (options: {
      format: string
      filePath: string
      includeHeaders: boolean
      tableName: string
    }) => {
      await exportTableData({
        connectionId: connectionId,
        database: database,
        table: table,
        format: options.format,
        filePath: options.filePath,
        includeHeaders: options.includeHeaders,
        tableNameForSql: options.tableName,
        filterModel: exportFilterModel,
        sortColumn: sort?.column,
        sortDirection: sort?.direction,
        page: currentPage,
        pageSize: pageSize,
      })
      closeExportDialog(tabId)
    },
    [
      connectionId,
      database,
      table,
      exportFilterModel,
      sort,
      currentPage,
      pageSize,
      closeExportDialog,
      tabId,
    ]
  )

  const isLoading = tabState?.isLoading ?? true
  const error = tabState?.error ?? null
  const primaryKey = tabState?.primaryKey
  const viewMode = tabState?.viewMode ?? 'grid'
  const isExportDialogOpen = tabState?.isExportDialogOpen ?? false
  const pendingNavigationAction = tabState?.pendingNavigationAction ?? null
  const saveError = tabState?.saveError ?? null
  const columns = tabState?.columns ?? []
  const rowResidencyStatus = tabState?.rowResidency?.status ?? 'resident'
  const isRestoring = rowResidencyStatus === 'restoring'

  // Show no-PK warning only for actual tables, not views (views never have PKs)
  const showNoPrimaryKeyWarning =
    !isViewObject && primaryKey === null && !isLoading && !error && columns.length > 0

  useEffect(() => {
    setBlockingNavigation(tabId, pendingNavigationAction !== null)
    return () => setBlockingNavigation(tabId, false)
  }, [pendingNavigationAction, setBlockingNavigation, tabId])

  useEffect(() => {
    if (isActive) return
    if (isExportDialogOpen) closeExportDialog(tabId)
  }, [closeExportDialog, isActive, isExportDialogOpen, tabId])

  return (
    <div
      className={`${styles.container} ${
        renderMode === 'bottom-panel' ? styles.bottomPanelContainer : ''
      }`}
      data-testid="table-data-tab"
      data-render-mode={renderMode}
    >
      <TableDataToolbar tabId={tabId} isView={isViewObject} />

      {/* No-PK Warning Banner */}
      {showNoPrimaryKeyWarning && (
        <div className={styles.warningHost}>
          <InfoBar
            severity="warning"
            title="Read only"
            message="This table has no primary key or unique key. Editing is disabled. Data can be browsed but not modified."
            data-testid="no-pk-warning"
          />
        </div>
      )}

      {/* Loading state */}
      {isLoading && !error && columns.length === 0 && (
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
          <span>Loading table data...</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className={styles.errorState} data-testid="table-data-error">
          <span className={styles.errorMessage}>{error}</span>
          <Button
            variant="bare"
            className={styles.retryButton}
            onClick={handleRetry}
            data-testid="btn-retry"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Content area */}
      {!error && columns.length > 0 && (
        <div className={styles.content} aria-busy={isRestoring} data-testid="table-data-content">
          {viewMode === 'grid' && (
            <TableDataGrid
              tabId={tabId}
              isReadOnly={effectiveReadOnly || !primaryKey}
              isActive={isActive}
            />
          )}
          {viewMode === 'form' && (
            <TableDataFormView tabId={tabId} isView={isViewObject} isActive={isActive} />
          )}
          {isLoading && columns.length > 0 && (
            <div
              className={styles.restoringOverlay}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-testid="table-data-sort-overlay"
            >
              <div className={styles.spinner} aria-hidden="true" />
              <span>Loading…</span>
            </div>
          )}
          {isRestoring && (
            <div
              className={styles.restoringOverlay}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-testid="table-data-restore-overlay"
            >
              <div className={styles.spinner} aria-hidden="true" />
              <span>Restoring cached table data...</span>
            </div>
          )}
        </div>
      )}

      {/* Export Dialog */}
      {isExportDialogOpen && (
        <ExportDialog
          connectionId={connectionId}
          tabId={tabId}
          onClose={() => closeExportDialog(tabId)}
          onExport={handleExport}
          defaultTableName={table}
          isView={isViewObject}
        />
      )}

      {/* Unsaved Changes Dialog */}
      {pendingNavigationAction !== null && (
        <UnsavedChangesDialog
          tabId={tabId}
          onSave={handleSaveNavigation}
          onDiscard={handleDiscardNavigation}
          onCancel={handleCancelNavigation}
          error={saveError}
        />
      )}
    </div>
  )
}
