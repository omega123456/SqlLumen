import { useCallback } from 'react'
import { hasPendingRowChanges } from '../../../../lib/row-edit-state'
import { useConnectionStore } from '../../../../stores/connection-store'
import type {
  DataViewState,
  DataViewSurfaceRef,
} from '../../../../stores/data-view/data-view-types'
import { isSelectedRowInView } from '../../../../stores/data-view/data-view-selectors'
import { discardCurrentRow, insertDraftRow } from '../../../../stores/data-view/edit-actions'
import { cloneSelectedRow } from '../../../../stores/data-view/row-clone'
import { deleteRows } from '../../../../stores/data-view/row-deletion'
import {
  deleteButtonCopyFor,
  deleteTargetCountFor,
  rowActionAvailability,
  type RowActionHandlers,
} from '../../toolbar/row-actions/row-action-model'
import { useRowDeletionConfirm } from '../../toolbar/row-actions/use-row-deletion-confirm'
import { saveDataRow } from '../use-data-edit-session'
import { canMutateRows, editTableNameOf, type RowInsertion } from './data-toolbar-model'

export interface DataRowActionInputs {
  ref: DataViewSurfaceRef
  view: DataViewState
  checkedCount: number
  rowInsertion: RowInsertion
  isBusy: boolean
}

function useDataRowEdits(ref: DataViewSurfaceRef): Omit<RowActionHandlers, 'onDelete'> {
  return {
    onAdd: useCallback(() => insertDraftRow(ref), [ref]),
    onClone: useCallback(() => void cloneSelectedRow(ref), [ref]),
    onSave: useCallback(() => void saveDataRow(ref), [ref]),
    onDiscard: useCallback(() => discardCurrentRow(ref), [ref]),
  }
}

function useDataRowDeletion(inputs: DataRowActionInputs, deleteTargetCount: number) {
  const { ref } = inputs
  const deleteTargetRows = useCallback(async () => {
    await deleteRows(ref)
  }, [ref])
  return useRowDeletionConfirm({
    deleteTargetCount: deleteTargetCount,
    tableName: editTableNameOf(inputs.view),
    deleteRows: deleteTargetRows,
  })
}

export function useDataRowActions(inputs: DataRowActionInputs) {
  const { view, rowInsertion, isBusy } = inputs
  const isConnectionReadOnly = useConnectionStore(
    (state) => state.activeConnections[view.slot.connectionId]?.profile?.readOnly ?? false
  )
  const deleteTargetCount = deleteTargetCountFor(inputs.checkedCount, isSelectedRowInView(view))
  const rowEdits = useDataRowEdits(inputs.ref)
  const deletion = useDataRowDeletion(inputs, deleteTargetCount)
  const availability = rowActionAvailability({
    canMutate: canMutateRows(view, isConnectionReadOnly),
    canAddRow: rowInsertion.canAddRow,
    canCloneSelection: rowInsertion.canCloneSelection,
    deleteTargetCount: deleteTargetCount,
    hasPendingChanges: hasPendingRowChanges(view.edit.state),
    isBusy: isBusy,
  })
  return {
    availability: availability,
    deleteButton: deleteButtonCopyFor(deleteTargetCount),
    handlers: { ...rowEdits, onDelete: deletion.requestDelete },
    deletion: deletion,
  }
}
