import { useTableDataStore } from '../../stores/table-data-store'
import { useIsConnectionReadOnly } from '../../stores/connection-store'
import { TableDataToolbar } from './TableDataToolbar'
import { TableDataGrid } from './TableDataGrid'
import { TableDataFormView } from './TableDataFormView'
import type {
  PrimaryKeyInfo,
  TableDataColumnMeta,
  TableDataTabState,
  WorkspaceTab,
  TableDataTab as TableDataTabType,
} from '../../types/schema'
import { InfoBar } from '../common/InfoBar'
import { Button } from '../common/Button'
import styles from './TableDataTab.module.css'
import { useTableDataTabLifecycle } from './table-data-tab/use-table-data-tab-lifecycle'
import { TableDataTabDialogs } from './table-data-tab/TableDataTabDialogs'

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

function hasLoadedColumns(view: TableDataTabView): boolean {
  return !view.error && view.columns.length > 0
}

function isInitialLoad(view: TableDataTabView): boolean {
  return view.isLoading && !view.error && view.columns.length === 0
}

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
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const loadTableData = useTableDataStore((state) => state.loadTableData)
  const isConnectionReadOnly = useIsConnectionReadOnly(tableDataTab.connectionId)
  const isViewObject = tableDataTab.objectType === 'view'
  const view = tableDataTabView(tabState)
  useTableDataTabLifecycle({
    tab: tableDataTab,
    isActive: isActive,
    hasPendingNavigation: view.pendingNavigationAction !== null,
    isExportDialogOpen: view.isExportDialogOpen,
  })

  return (
    <div
      className={containerClassName(renderMode)}
      data-testid="table-data-tab"
      data-render-mode={renderMode}
    >
      <TableDataToolbar tabId={tabId} isView={isViewObject} />
      {shouldShowNoPrimaryKeyWarning(view, isViewObject) && <NoPrimaryKeyWarning />}
      {isInitialLoad(view) && <TableDataLoadingState />}
      {view.error && (
        <TableDataErrorState error={view.error} onRetry={() => loadTableData(tabId)} />
      )}
      {hasLoadedColumns(view) && (
        <TableDataContent
          tabId={tabId}
          view={view}
          isReadOnly={isConnectionReadOnly || isViewObject}
          isViewObject={isViewObject}
          isActive={isActive}
        />
      )}
      <TableDataTabDialogs
        tab={tableDataTab}
        tabState={tabState}
        isViewObject={isViewObject}
        saveError={view.saveError}
        isExportDialogOpen={view.isExportDialogOpen}
        hasPendingNavigation={view.pendingNavigationAction !== null}
      />
    </div>
  )
}
