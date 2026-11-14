import { ConfirmDialog } from '../../dialogs/ConfirmDialog'
import { FilterDialog } from '../../dialogs/FilterDialog'
import { ViewModeGroup } from '../../shared/toolbar/ViewModeGroup'
import { PaginationGroup } from '../../shared/toolbar/PaginationGroup'
import { ExportButton } from '../../shared/toolbar/ExportButton'
import { CopySelectedRowsButton } from '../../shared/toolbar/CopySelectedRowsButton'
import { FilterToolbarButton } from '../../shared/FilterToolbarButton'
import type { DeleteCopy, ToolbarTabView } from './toolbar-model'
import type { useToolbarDeletion } from './use-toolbar-row-actions'
import type {
  useCopyCheckedRows,
  useToolbarFilter,
  useToolbarPaging,
  useToolbarViewActions,
} from './use-toolbar-navigation'
import styles from '../TableDataToolbar.module.css'

interface ToolbarRightSectionProps {
  view: ToolbarTabView
  isBusy: boolean
  filter: ReturnType<typeof useToolbarFilter>
  viewActions: ReturnType<typeof useToolbarViewActions>
  paging: ReturnType<typeof useToolbarPaging>
  onCopySelectedRows: ReturnType<typeof useCopyCheckedRows>
}

export function ToolbarRightSection(props: ToolbarRightSectionProps) {
  const { view, isBusy, filter, viewActions, paging } = props
  const isTableDataActionDisabled = isBusy || view.columns.length === 0
  return (
    <div className={styles.rightSection}>
      <FilterToolbarButton
        isActive={view.filterModel.length > 0}
        activeCount={view.filterModel.length}
        onFilterClick={filter.openFilterDialog}
        onClearClick={filter.handleClearFilter}
        isDisabled={isTableDataActionDisabled}
      />
      <div className={styles.divider} />
      <ViewModeGroup
        currentMode={view.viewMode}
        availableModes={['grid', 'form']}
        onModeChange={viewActions.handleViewMode}
        testIdPrefix="view-mode"
      />
      <ExportButton disabled={isTableDataActionDisabled} onClick={viewActions.handleExport} />
      <CopySelectedRowsButton
        disabled={isBusy || view.checkedRowKeys.length === 0}
        onClick={() => void props.onCopySelectedRows()}
      />
      <PaginationGroup
        currentPage={view.currentPage}
        paginationMode="unknown"
        pageSize={view.pageSize}
        disabled={isBusy}
        {...paging}
      />
    </div>
  )
}

interface ToolbarDialogsProps {
  view: ToolbarTabView
  deleteCopy: DeleteCopy
  deletion: ReturnType<typeof useToolbarDeletion>
  filter: ReturnType<typeof useToolbarFilter>
}

export function ToolbarDialogs({ view, deleteCopy, deletion, filter }: ToolbarDialogsProps) {
  return (
    <>
      <ConfirmDialog
        isOpen={deletion.showDeleteConfirm}
        title={deleteCopy.title}
        message={deleteCopy.message}
        confirmLabel="Delete"
        isDestructive={true}
        onConfirm={deletion.handleConfirmDelete}
        onCancel={deletion.handleCancelDelete}
      />
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
