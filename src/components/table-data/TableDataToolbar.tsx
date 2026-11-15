import { useCallback } from 'react'
import { useTableDataStore } from '../../stores/table-data-store'
import { useConnectionStore } from '../../stores/connection-store'
import { hasPendingRowChanges } from '../../lib/row-edit-state'
import { DataViewToolbar } from '../shared/toolbar/DataViewToolbar'
import { RowActionButtons } from '../shared/toolbar/row-actions/RowActionButtons'
import {
  deleteButtonCopyFor,
  deleteTargetCountFor,
  rowActionAvailability,
} from '../shared/toolbar/row-actions/row-action-model'
import {
  canCloneSelection,
  canMutateTableRows,
  hasDeletableSelection,
  isNoKeyBadgeVisible,
  toolbarTabView,
} from './table-data-toolbar/toolbar-model'
import { LoadControlButton, ToolbarBadges } from './table-data-toolbar/ToolbarParts'
import {
  TableDataActions,
  TableDataPaging,
  TableDataViewMode,
  ToolbarDialogs,
} from './table-data-toolbar/ToolbarSlots'
import {
  useCopyCheckedRows,
  useToolbarFilter,
  useToolbarPaging,
  useToolbarViewActions,
} from './table-data-toolbar/use-toolbar-navigation'
import {
  useToolbarDeletion,
  useToolbarRowEdits,
} from './table-data-toolbar/use-toolbar-row-actions'

interface TableDataToolbarProps {
  tabId: string
  isView?: boolean
}

function useToolbarState(tabId: string) {
  const tabState = useTableDataStore((state) => state.tabs[tabId])
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const view = toolbarTabView(tabState)
  const isConnectionReadOnly = useConnectionStore(
    (state) => state.activeConnections[view.connectionId]?.profile?.readOnly ?? false
  )
  const withNavigationGuard = useCallback(
    (action: () => void) => requestNavigationAction(tabId, action),
    [tabId, requestNavigationAction]
  )
  const isBusy = view.isLoading || view.isRestoring
  const deleteTargetCount = deleteTargetCountFor(
    view.checkedRowKeys.length,
    hasDeletableSelection(view)
  )
  const availability = rowActionAvailability({
    canMutate: canMutateTableRows(view, isConnectionReadOnly),
    canAddRow: view.editState?.isNewRow !== true,
    canCloneSelection: canCloneSelection(view),
    deleteTargetCount: deleteTargetCount,
    hasPendingChanges: hasPendingRowChanges(view.editState),
    isBusy: isBusy,
  })
  return {
    view: view,
    isConnectionReadOnly: isConnectionReadOnly,
    withNavigationGuard: withNavigationGuard,
    isBusy: isBusy,
    deleteTargetCount: deleteTargetCount,
    deleteButton: deleteButtonCopyFor(deleteTargetCount),
    availability: availability,
  }
}

export function TableDataToolbar({ tabId, isView = false }: TableDataToolbarProps) {
  const toolbar = useToolbarState(tabId)
  const { view, isConnectionReadOnly, isBusy, deleteTargetCount } = toolbar
  const actionInputs = {
    tabId: tabId,
    view: view,
    withNavigationGuard: toolbar.withNavigationGuard,
  }
  const deletion = useToolbarDeletion(actionInputs, deleteTargetCount)
  const rowEdits = useToolbarRowEdits(actionInputs)
  const viewActions = useToolbarViewActions(actionInputs)
  const filter = useToolbarFilter(actionInputs)
  const paging = useToolbarPaging(actionInputs)
  const handleCopySelectedRows = useCopyCheckedRows(view)

  return (
    <DataViewToolbar
      testId="table-data-toolbar"
      viewMode={<TableDataViewMode view={view} viewActions={viewActions} />}
      editTarget={
        <ToolbarBadges
          isView={isView}
          isConnectionReadOnly={isConnectionReadOnly}
          showNoKeyBadge={isNoKeyBadgeVisible(isView, view)}
        />
      }
      rowActions={
        isView ? null : (
          <RowActionButtons
            availability={toolbar.availability}
            deleteButton={toolbar.deleteButton}
            handlers={{ ...rowEdits, onDelete: deletion.requestDelete }}
          />
        )
      }
      reload={
        <LoadControlButton
          view={view}
          isBusy={isBusy}
          onCancelLoad={viewActions.handleCancelLoad}
          onRefresh={viewActions.handleRefresh}
        />
      }
      dataActions={
        <TableDataActions
          view={view}
          isBusy={isBusy}
          filter={filter}
          viewActions={viewActions}
          onCopySelectedRows={handleCopySelectedRows}
        />
      }
      paging={<TableDataPaging view={view} isBusy={isBusy} paging={paging} />}
      dialogs={<ToolbarDialogs view={view} deletion={deletion} filter={filter} />}
    />
  )
}
