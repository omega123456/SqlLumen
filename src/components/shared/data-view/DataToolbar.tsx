import type { ReactNode } from 'react'
import { ViewModeGroup } from '../toolbar/ViewModeGroup'
import { DataActionButtons } from '../toolbar/DataActionButtons'
import { DataViewToolbar } from '../toolbar/DataViewToolbar'
import { RowActionButtons } from '../toolbar/row-actions/RowActionButtons'
import { DeleteRowsConfirmDialog } from '../toolbar/row-actions/DeleteRowsConfirmDialog'
import type { DataViewSource } from './data-view-source'
import type { DataToolbarReadiness } from './toolbar/data-toolbar-model'
import type { DataViewFilter } from './toolbar/use-data-filter'
import { useDataToolbar } from './toolbar/use-data-toolbar'

export interface DataToolbarProps {
  source: DataViewSource
  editTarget: ReactNode
  filter: DataViewFilter
  readiness: DataToolbarReadiness
}

export function DataToolbar({ source, editTarget, filter, readiness }: DataToolbarProps) {
  const toolbar = useDataToolbar(source.ref, readiness)
  const { view, viewActions, rowActions } = toolbar
  const filterModel = view.spec.filters

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
        <RowActionButtons
          availability={rowActions.availability}
          deleteButton={rowActions.deleteButton}
          handlers={rowActions.handlers}
        />
      }
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
      dialogs={<DeleteRowsConfirmDialog deletion={rowActions.deletion} />}
    />
  )
}
