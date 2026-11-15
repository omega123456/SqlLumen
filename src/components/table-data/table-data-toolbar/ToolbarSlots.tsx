import { FilterDialog } from '../../dialogs/FilterDialog'
import { PaginationGroup } from '../../shared/toolbar/PaginationGroup'
import { ViewModeGroup } from '../../shared/toolbar/ViewModeGroup'
import { DataActionButtons } from '../../shared/toolbar/DataActionButtons'
import type { ToolbarTabView } from './toolbar-model'
import type { useToolbarDeletion } from './use-toolbar-row-actions'
import type {
  useCopyCheckedRows,
  useToolbarFilter,
  useToolbarPaging,
  useToolbarViewActions,
} from './use-toolbar-navigation'
import { DeleteRowsConfirmDialog } from '../../shared/toolbar/row-actions/DeleteRowsConfirmDialog'

interface TableDataViewModeProps {
  view: ToolbarTabView
  viewActions: ReturnType<typeof useToolbarViewActions>
}

export function TableDataViewMode({ view, viewActions }: TableDataViewModeProps) {
  return (
    <ViewModeGroup
      currentMode={view.viewMode}
      availableModes={['grid', 'form']}
      onModeChange={viewActions.handleViewMode}
      testIdPrefix="view-mode"
    />
  )
}

interface TableDataActionsProps {
  view: ToolbarTabView
  isBusy: boolean
  filter: ReturnType<typeof useToolbarFilter>
  viewActions: ReturnType<typeof useToolbarViewActions>
  onCopySelectedRows: ReturnType<typeof useCopyCheckedRows>
}

export function TableDataActions(props: TableDataActionsProps) {
  const { view, isBusy, filter } = props
  const isTableDataActionDisabled = isBusy || view.columns.length === 0
  return (
    <DataActionButtons
      filter={{
        isActive: view.filterModel.length > 0,
        activeCount: view.filterModel.length,
        onFilterClick: filter.openFilterDialog,
        onClearClick: filter.handleClearFilter,
        isDisabled: isTableDataActionDisabled,
      }}
      exportAction={{
        disabled: isTableDataActionDisabled,
        onClick: props.viewActions.handleExport,
      }}
      copySelected={{
        disabled: isBusy || view.checkedRowKeys.length === 0,
        onClick: () => void props.onCopySelectedRows(),
      }}
    />
  )
}

interface TableDataPagingProps {
  view: ToolbarTabView
  isBusy: boolean
  paging: ReturnType<typeof useToolbarPaging>
}

export function TableDataPaging({ view, isBusy, paging }: TableDataPagingProps) {
  return (
    <PaginationGroup
      currentPage={view.currentPage}
      paginationMode="unknown"
      pageSize={view.pageSize}
      disabled={isBusy}
      {...paging}
    />
  )
}

interface ToolbarDialogsProps {
  view: ToolbarTabView
  deletion: ReturnType<typeof useToolbarDeletion>
  filter: ReturnType<typeof useToolbarFilter>
}

export function ToolbarDialogs({ view, deletion, filter }: ToolbarDialogsProps) {
  return (
    <>
      <DeleteRowsConfirmDialog deletion={deletion} />
      <FilterDialog
        isOpen={filter.isFilterDialogOpen}
        initialConditions={filter.initialConditions}
        columns={view.columns.map((column) => column.name)}
        onApply={filter.handleFilterApply}
        onCancel={filter.closeFilterDialog}
      />
    </>
  )
}
