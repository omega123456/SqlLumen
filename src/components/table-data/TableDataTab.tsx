/**
 * TableDataTab — main container for the table data browser/editor.
 *
 * Replaces TableDataPlaceholder. Renders the toolbar, grid (or form view),
 * export dialog, and unsaved-changes dialog for a single table-data tab.
 */

import { useEffect, useCallback } from 'react'
import { useTableDataStore } from '../../stores/table-data-store'
import { useIsConnectionReadOnly } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { exportTableData } from '../../lib/table-data-commands'
import { TableDataToolbar } from './TableDataToolbar'
import { TableDataGrid } from './TableDataGrid'
import { TableDataFormView } from './TableDataFormView'
import { UnsavedChangesDialog } from '../shared/UnsavedChangesDialog'
import ExportDialog from '../dialogs/ExportDialog'
import type {
  ExportOptions,
  FilterCondition,
  PrimaryKeyInfo,
  TableDataColumnMeta,
  TableDataTabState,
  WorkspaceTab,
  TableDataTab as TableDataTabType,
} from '../../types/schema'
import { InfoBar } from '../common/InfoBar'
import { Button } from '../common/Button'
import styles from './TableDataTab.module.css'

interface TableDataTabProps {
  tab: WorkspaceTab
  isActive?: boolean
  renderMode?: 'standalone' | 'bottom-panel'
}

interface TableDataTabView {
  isLoading: boolean
  error: string | null
  primaryKey: PrimaryKeyInfo | null
  viewMode: TableDataTabState['viewMode']
  isExportDialogOpen: boolean
  pendingNavigationAction: TableDataTabState['pendingNavigationAction']
  saveError: string | null
  columns: TableDataColumnMeta[]
  isRestoring: boolean
}

const EMPTY_TABLE_DATA_TAB_VIEW: TableDataTabView = {
  isLoading: true,
  error: null,
  primaryKey: null,
  viewMode: 'grid',
  isExportDialogOpen: false,
  pendingNavigationAction: null,
  saveError: null,
  columns: [],
  isRestoring: false,
}

function tableDataTabView(tabState: TableDataTabState | undefined): TableDataTabView {
  if (!tabState) return EMPTY_TABLE_DATA_TAB_VIEW
  return {
    isLoading: tabState.isLoading,
    error: tabState.error,
    primaryKey: tabState.primaryKey,
    viewMode: tabState.viewMode,
    isExportDialogOpen: tabState.isExportDialogOpen,
    pendingNavigationAction: tabState.pendingNavigationAction,
    saveError: tabState.saveError,
    columns: tabState.columns,
    isRestoring: tabState.rowResidency?.status === 'restoring',
  }
}

interface TableDataExportScope {
  filterModel?: FilterCondition[]
  sortColumn?: string
  sortDirection?: string
  page?: number
  pageSize?: number
}

function tableDataExportScope(tabState: TableDataTabState | undefined): TableDataExportScope {
  if (!tabState) return {}
  const hasActiveFilters = tabState.filterModel.length > 0
  return {
    filterModel: hasActiveFilters ? tabState.filterModel : undefined,
    sortColumn: tabState.sort?.column,
    sortDirection: tabState.sort?.direction,
    page: tabState.currentPage,
    pageSize: tabState.pageSize,
  }
}

function hasLoadedColumns(view: TableDataTabView): boolean {
  return !view.error && view.columns.length > 0
}

function isInitialLoad(view: TableDataTabView): boolean {
  return view.isLoading && !view.error && view.columns.length === 0
}

// Show no-PK warning only for actual tables, not views (views never have PKs)
function shouldShowNoPrimaryKeyWarning(view: TableDataTabView, isViewObject: boolean): boolean {
  if (isViewObject) return false
  if (view.primaryKey !== null) return false
  return !view.isLoading && hasLoadedColumns(view)
}

function NoPrimaryKeyWarning() {
  return (
    <div className={styles.warningHost}>
      <InfoBar
        severity="warning"
        title="Read only"
        message="This table has no primary key or unique key. Editing is disabled. Data can be browsed but not modified."
        data-testid="no-pk-warning"
      />
    </div>
  )
}

function TableDataLoadingState() {
  return (
    <div className={styles.loadingState}>
      <div className={styles.spinner} />
      <span>Loading table data...</span>
    </div>
  )
}

interface TableDataErrorStateProps {
  error: string
  onRetry: () => void
}

function TableDataErrorState({ error, onRetry }: TableDataErrorStateProps) {
  return (
    <div className={styles.errorState} data-testid="table-data-error">
      <span className={styles.errorMessage}>{error}</span>
      <Button
        variant="bare"
        className={styles.retryButton}
        onClick={onRetry}
        data-testid="btn-retry"
      >
        Retry
      </Button>
    </div>
  )
}

interface BusyOverlayProps {
  label: string
  testId: string
}

function BusyOverlay({ label, testId }: BusyOverlayProps) {
  return (
    <div
      className={styles.restoringOverlay}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid={testId}
    >
      <div className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

interface TableDataContentProps {
  tabId: string
  view: TableDataTabView
  isReadOnly: boolean
  isViewObject: boolean
  isActive: boolean
}

function TableDataContent({
  tabId,
  view,
  isReadOnly,
  isViewObject,
  isActive,
}: TableDataContentProps) {
  return (
    <div className={styles.content} aria-busy={view.isRestoring} data-testid="table-data-content">
      {view.viewMode === 'grid' && (
        <TableDataGrid
          tabId={tabId}
          isReadOnly={isReadOnly || !view.primaryKey}
          isActive={isActive}
        />
      )}
      {view.viewMode === 'form' && (
        <TableDataFormView tabId={tabId} isView={isViewObject} isActive={isActive} />
      )}
      {view.isLoading && <BusyOverlay label="Loading…" testId="table-data-sort-overlay" />}
      {view.isRestoring && (
        <BusyOverlay label="Restoring cached table data..." testId="table-data-restore-overlay" />
      )}
    </div>
  )
}

function containerClassName(renderMode: TableDataTabProps['renderMode']): string {
  const renderModeClassName = renderMode === 'bottom-panel' ? styles.bottomPanelContainer : ''
  return `${styles.container} ${renderModeClassName}`
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

  const isConnectionReadOnly = useIsConnectionReadOnly(connectionId)
  const isViewObject = tableDataTab.objectType === 'view'
  const effectiveReadOnly = isConnectionReadOnly || isViewObject

  useEffect(() => {
    // Only init + load if we don't already have state for this tab
    // (prevents re-loading when switching back to the tab after it was unmounted)
    const existing = useTableDataStore.getState().tabs[tabId]
    const needsInitialLoad = isActive && !existing
    if (needsInitialLoad) {
      initTab(tabId, { connectionId: connectionId, database: database, table: table })
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

  const handleExport = useCallback(
    async (options: Required<ExportOptions>) => {
      await exportTableData({
        connectionId: connectionId,
        database: database,
        table: table,
        format: options.format,
        filePath: options.filePath,
        includeHeaders: options.includeHeaders,
        tableNameForSql: options.tableName,
        ...tableDataExportScope(tabState),
      })
      closeExportDialog(tabId)
    },
    [connectionId, database, table, tabState, closeExportDialog, tabId]
  )

  const view = tableDataTabView(tabState)
  const hasPendingNavigation = view.pendingNavigationAction !== null

  useEffect(() => {
    setBlockingNavigation(tabId, hasPendingNavigation)
    return () => setBlockingNavigation(tabId, false)
  }, [hasPendingNavigation, setBlockingNavigation, tabId])

  useEffect(() => {
    if (isActive) return
    if (view.isExportDialogOpen) closeExportDialog(tabId)
  }, [closeExportDialog, isActive, view.isExportDialogOpen, tabId])

  return (
    <div
      className={containerClassName(renderMode)}
      data-testid="table-data-tab"
      data-render-mode={renderMode}
    >
      <TableDataToolbar tabId={tabId} isView={isViewObject} />

      {shouldShowNoPrimaryKeyWarning(view, isViewObject) && <NoPrimaryKeyWarning />}

      {isInitialLoad(view) && <TableDataLoadingState />}

      {view.error && <TableDataErrorState error={view.error} onRetry={handleRetry} />}

      {hasLoadedColumns(view) && (
        <TableDataContent
          tabId={tabId}
          view={view}
          isReadOnly={effectiveReadOnly}
          isViewObject={isViewObject}
          isActive={isActive}
        />
      )}

      {view.isExportDialogOpen && (
        <ExportDialog
          connectionId={connectionId}
          tabId={tabId}
          onClose={() => closeExportDialog(tabId)}
          onExport={handleExport}
          defaultTableName={table}
          isView={isViewObject}
        />
      )}

      {hasPendingNavigation && (
        <UnsavedChangesDialog
          tabId={tabId}
          onSave={handleSaveNavigation}
          onDiscard={handleDiscardNavigation}
          onCancel={handleCancelNavigation}
          error={view.saveError}
        />
      )}
    </div>
  )
}
