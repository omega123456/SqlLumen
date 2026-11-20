import type { ReactNode } from 'react'
import { ViewModeGroup } from '../toolbar/ViewModeGroup'
import { DataActionButtons } from '../toolbar/DataActionButtons'
import { DataViewToolbar } from '../toolbar/DataViewToolbar'
import { RowActionButtons } from '../toolbar/row-actions/RowActionButtons'
import { DeleteRowsConfirmDialog } from '../toolbar/row-actions/DeleteRowsConfirmDialog'
import { LoadControlButton } from '../toolbar/LoadControlButton'
import { requestNavigationAction } from '../../../stores/data-view/navigation-guard'
import type { DataViewState, DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import type { DataViewReload, DataViewSource } from './data-view-source'
import { DataPaging } from './toolbar/DataPaging'
import { isRestoringRows, type DataToolbarReadiness } from './toolbar/data-toolbar-model'
import type { DataViewFilter } from './toolbar/use-data-filter'
import { useDataToolbar } from './toolbar/use-data-toolbar'

export interface DataToolbarProps {
  source: DataViewSource
  editTarget: ReactNode
  filter: DataViewFilter
  readiness: DataToolbarReadiness
}

function isCancellableLoad(view: DataViewState, reload: DataViewReload): boolean {
  return reload.isLoading && !isRestoringRows(view)
}

function guardedReload(surfaceRef: DataViewSurfaceRef, reload: DataViewReload): DataViewReload {
  return { ...reload, onReload: () => requestNavigationAction(surfaceRef, reload.onReload) }
}

interface ReloadSlotProps {
  source: DataViewSource
  view: DataViewState
  isBusy: boolean
}

function ReloadSlot({ source, view, isBusy }: ReloadSlotProps) {
  const reload = source.capabilities.reload
  if (!reload) return null
  return (
    <LoadControlButton
      reload={guardedReload(source.ref, reload)}
      isBusy={isBusy}
      isCancellable={isCancellableLoad(view, reload)}
    />
  )
}

export function DataToolbar({ source, editTarget, filter, readiness }: DataToolbarProps) {
  const toolbar = useDataToolbar(source, readiness)
  const { view, viewActions, rowActions, isBusy } = toolbar
  const filterModel = view.spec.filters
  const { paging } = source.capabilities

  return (
    <DataViewToolbar
      testId={source.testIds.toolbar}
      viewMode={
        <ViewModeGroup
          currentMode={view.mode}
          availableModes={source.capabilities.modes}
          onModeChange={viewActions.handleViewMode}
          testIdPrefix="view-mode"
        />
      }
      editTarget={editTarget}
      rowActions={
        source.capabilities.rowActions ? (
          <RowActionButtons
            availability={rowActions.availability}
            deleteButton={rowActions.deleteButton}
            handlers={rowActions.handlers}
          />
        ) : null
      }
      reload={<ReloadSlot source={source} view={view} isBusy={isBusy} />}
      dataActions={
        <DataActionButtons
          filter={{
            isActive: filterModel.length > 0,
            activeCount: filterModel.length,
            onFilterClick: filter.openFilterDialog,
            onClearClick: filter.clearFilter,
            isDisabled: toolbar.isFilterDisabled,
          }}
          exportAction={{
            disabled: !readiness.hasData,
            onClick: viewActions.handleExport,
            testId: 'export-button',
          }}
          copySelected={{
            disabled: toolbar.isCopySelectedDisabled,
            onClick: () => void toolbar.copyCheckedRows(),
          }}
        />
      }
      paging={
        paging ? <DataPaging surfaceRef={source.ref} paging={paging} isBusy={isBusy} /> : null
      }
      dialogs={<DeleteRowsConfirmDialog deletion={rowActions.deletion} />}
    />
  )
}
