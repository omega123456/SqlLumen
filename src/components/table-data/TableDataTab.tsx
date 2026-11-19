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
import { DataViewModeSwitch } from '../shared/data-view/DataViewModeSwitch'
import { FOCUS_RING } from '../../lib/focus-ring'
import { joinClassNames } from '../../lib/class-names'
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
    <div className="shrink-0 px-3 pb-2.5">
      <InfoBar
        severity="warning"
        title="Read only"
        message="This table has no primary key or unique key. Editing is disabled. Data can be browsed but not modified."
        data-testid="no-pk-warning"
      />
    </div>
  )
}

function TableDataSpinner() {
  return (
    <div
      className="size-6 animate-spin-700ms rounded-round border-2 border-light-primary-a20 border-t-light-primary window-blurred:animate-spin-700ms-paused dark:border-dark-primary-a20 dark:border-t-dark-primary"
      aria-hidden="true"
    />
  )
}

function TableDataLoadingState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
      <TableDataSpinner />
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
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6"
      data-testid="table-data-error"
    >
      <span className="max-w-125 text-center text-size-caption wrap-anywhere text-light-error dark:text-dark-error">
        {error}
      </span>
      <Button
        variant="bare"
        className={joinClassNames([
          'flex h-control cursor-pointer items-center gap-1.5 rounded-control border border-light-stroke-card bg-transparent px-4 text-size-caption font-regular text-light-on-surface-variant transition-color-border-background hover:border-light-primary-a35 hover:bg-light-fill-subtle-hover hover:text-light-primary dark:border-dark-stroke-card dark:text-dark-on-surface-variant dark:hover:border-dark-primary-a35 dark:hover:bg-dark-fill-subtle-hover dark:hover:text-dark-primary',
          FOCUS_RING,
        ])}
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
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-light-surface-container-lowest text-size-row text-light-on-surface-variant opacity-85 dark:bg-dark-surface-container-lowest dark:text-dark-on-surface-variant"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid={testId}
    >
      <TableDataSpinner />
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
    <div
      className="relative flex-1 overflow-hidden"
      aria-busy={view.isRestoring}
      data-testid="table-data-content"
    >
      <DataViewModeSwitch
        mode={view.viewMode}
        grid={
          <TableDataGrid
            tabId={tabId}
            isReadOnly={isReadOnly || !view.primaryKey}
            isActive={isActive}
          />
        }
        form={<TableDataFormView tabId={tabId} isView={isViewObject} isActive={isActive} />}
      />
      {view.isLoading && <BusyOverlay label="Loading…" testId="table-data-sort-overlay" />}
      {view.isRestoring && (
        <BusyOverlay label="Restoring cached table data..." testId="table-data-restore-overlay" />
      )}
    </div>
  )
}

type RenderMode = NonNullable<TableDataTabProps['renderMode']>

const CONTAINER_FRAME = 'relative flex h-full w-full flex-col overflow-hidden'

const CONTAINER_CLASSES: Record<RenderMode, string> = {
  standalone: CONTAINER_FRAME,
  'bottom-panel': joinClassNames([
    CONTAINER_FRAME,
    'bg-light-surface-container-lowest dark:bg-dark-surface-container-lowest',
  ]),
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
      className={CONTAINER_CLASSES[renderMode]}
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
