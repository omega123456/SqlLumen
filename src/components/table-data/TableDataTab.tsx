import type { ReactNode } from 'react'
import { useTableDataStore, type TableDataTabState } from '../../stores/table-data-store'
import { useIsConnectionReadOnly } from '../../stores/connection-store'
import { useDataView } from '../../stores/data-view/use-data-view'
import type { WorkspaceTab, TableDataTab as TableDataTabType } from '../../types/schema'
import { InfoBar } from '../common/InfoBar'
import { Button } from '../common/Button'
import { DataViewBody, type DataViewSlots } from '../shared/data-view/DataViewBody'
import type { DataToolbarReadiness } from '../shared/data-view/toolbar/data-toolbar-model'
import type { DataViewSource } from '../shared/data-view/data-view-source'
import { FOCUS_RING } from '../../lib/focus-ring'
import { joinClassNames } from '../../lib/class-names'
import { useTableDataTabLifecycle } from './table-data-tab/use-table-data-tab-lifecycle'
import { useTableDataViewSource } from './table-data-tab/table-data-view-source'
import { TableExportDialog } from './table-data-tab/TableExportDialog'
import { TableDataBadges } from './TableDataBadges'

interface TableDataTabProps {
  tab: WorkspaceTab
  isActive?: boolean
  renderMode?: 'standalone' | 'bottom-panel'
}

type TableLoadPhase = 'initial' | 'error' | 'loaded'

interface TableDataTabStatus {
  phase: TableLoadPhase
  error: string | null
  hasPrimaryKey: boolean
  isLoading: boolean
}

function loadPhaseOf(tabState: TableDataTabState | undefined): TableLoadPhase {
  if (!tabState) return 'initial'
  if (tabState.page.error) return 'error'
  const hasNoPage = tabState.view.slot.queryId === null
  if (hasNoPage) return 'initial'
  return 'loaded'
}

function useTableDataTabStatus(tabId: string): TableDataTabStatus {
  return {
    phase: useTableDataStore((state) => loadPhaseOf(state.tabs[tabId])),
    error: useTableDataStore((state) => state.tabs[tabId]?.page.error ?? null),
    hasPrimaryKey: useTableDataStore((state) => Boolean(state.tabs[tabId]?.meta.primaryKey)),
    isLoading: useTableDataStore((state) => state.tabs[tabId]?.page.isLoading ?? true),
  }
}

function isNoKeyVisible(status: TableDataTabStatus, isViewObject: boolean): boolean {
  if (isViewObject) return false
  if (status.hasPrimaryKey) return false
  if (status.isLoading) return false
  return status.phase === 'loaded'
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

function useTableMessage(tabId: string, status: TableDataTabStatus): ReactNode {
  const loadTableData = useTableDataStore((state) => state.loadTableData)
  if (status.error) {
    return <TableDataErrorState error={status.error} onRetry={() => void loadTableData(tabId)} />
  }
  if (status.phase === 'initial') return <TableDataLoadingState />
  return null
}

interface TableSlotInputs {
  tab: TableDataTabType
  status: TableDataTabStatus
  isExportOpen: boolean
}

function useTableSlots({ tab, status, isExportOpen }: TableSlotInputs): DataViewSlots {
  const isConnectionReadOnly = useIsConnectionReadOnly(tab.connectionId)
  const isViewObject = tab.objectType === 'view'
  const showsNoKey = isNoKeyVisible(status, isViewObject)
  return {
    editTarget: (
      <TableDataBadges
        isView={isViewObject}
        isConnectionReadOnly={isConnectionReadOnly}
        showNoKeyBadge={showsNoKey}
      />
    ),
    bands: showsNoKey ? <NoPrimaryKeyWarning /> : null,
    exportDialog: <TableExportDialog tab={tab} isOpen={isExportOpen} />,
  }
}

function tableReadiness(source: DataViewSource, status: TableDataTabStatus): DataToolbarReadiness {
  const hasData = status.phase === 'loaded' && !status.isLoading
  return { hasData: hasData, canInsertRows: hasData && source.capabilities.rowActions }
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

const NO_PANEL_ATTRIBUTES = {}

export function TableDataTab({
  tab,
  isActive = true,
  renderMode = 'standalone',
}: TableDataTabProps) {
  const tableDataTab = tab as TableDataTabType
  const tabId = tableDataTab.id
  const status = useTableDataTabStatus(tabId)
  const source = useTableDataViewSource({
    tabId: tabId,
    isActive: isActive,
    isView: tableDataTab.objectType === 'view',
  })
  const hasPendingNavigation = useDataView(
    source.ref,
    (view) => view.prompts.pendingNavigation !== null
  )
  const isExportOpen = useDataView(source.ref, (view) => view.prompts.isExportOpen)
  const slots = useTableSlots({ tab: tableDataTab, status: status, isExportOpen: isExportOpen })
  const message = useTableMessage(tabId, status)
  useTableDataTabLifecycle({
    tab: tableDataTab,
    isActive: isActive,
    hasPendingNavigation: hasPendingNavigation,
    isExportDialogOpen: isExportOpen,
  })

  return (
    <div
      className={CONTAINER_CLASSES[renderMode]}
      data-testid="table-data-tab"
      data-render-mode={renderMode}
    >
      <DataViewBody
        source={source}
        slots={slots}
        readiness={tableReadiness(source, status)}
        panelAttributes={NO_PANEL_ATTRIBUTES}
        message={message}
      />
    </div>
  )
}
