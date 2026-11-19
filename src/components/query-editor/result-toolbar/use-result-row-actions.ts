import { useCallback } from 'react'
import { hasPendingRowChanges } from '../../../lib/row-edit-state'
import { useConnectionStore } from '../../../stores/connection-store'
import { isSelectedRowInView, useQueryStore } from '../../../stores/query-store'
import {
  deleteButtonCopyFor,
  deleteTargetCountFor,
  rowActionAvailability,
  type RowActionHandlers,
} from '../../shared/toolbar/row-actions/row-action-model'
import { useRowDeletionConfirm } from '../../shared/toolbar/row-actions/use-row-deletion-confirm'
import type { ResultRowInsertion } from '../result-panel/result-panel-model'
import { saveResultRow } from '../result-edit-session'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import { canMutateResultRows, editTableNameOf, type ActiveResult } from './result-toolbar-model'

export interface ResultRowActionInputs {
  surfaceRef: DataViewSurfaceRef
  connectionId: string
  result: ActiveResult
  checkedCount: number
  rowInsertion: ResultRowInsertion
}

function useResultRowEdits(surfaceRef: DataViewSurfaceRef): Omit<RowActionHandlers, 'onDelete'> {
  const insertDraftRow = useQueryStore((state) => state.insertDraftRow)
  const cloneSelectedRow = useQueryStore((state) => state.cloneSelectedRow)
  const discardCurrentRow = useQueryStore((state) => state.discardCurrentRow)
  return {
    onAdd: useCallback(() => insertDraftRow(surfaceRef), [insertDraftRow, surfaceRef]),
    onClone: useCallback(() => cloneSelectedRow(surfaceRef), [cloneSelectedRow, surfaceRef]),
    onSave: useCallback(() => void saveResultRow(surfaceRef), [surfaceRef]),
    onDiscard: useCallback(() => discardCurrentRow(surfaceRef), [discardCurrentRow, surfaceRef]),
  }
}

function useResultRowDeletion(inputs: ResultRowActionInputs, deleteTargetCount: number) {
  const { surfaceRef } = inputs
  const deleteResultRows = useQueryStore((state) => state.deleteResultRows)
  const deleteRows = useCallback(async () => {
    await deleteResultRows(surfaceRef)
  }, [deleteResultRows, surfaceRef])
  return useRowDeletionConfirm({
    deleteTargetCount: deleteTargetCount,
    tableName: editTableNameOf(inputs.result),
    deleteRows: deleteRows,
  })
}

export function useResultRowActions(inputs: ResultRowActionInputs) {
  const { result, rowInsertion } = inputs
  const isConnectionReadOnly = useConnectionStore(
    (state) => state.activeConnections[inputs.connectionId]?.profile?.readOnly ?? false
  )
  const deleteTargetCount = deleteTargetCountFor(inputs.checkedCount, isSelectedRowInView(result))
  const rowEdits = useResultRowEdits(inputs.surfaceRef)
  const deletion = useResultRowDeletion(inputs, deleteTargetCount)
  const availability = rowActionAvailability({
    canMutate: canMutateResultRows(result, isConnectionReadOnly),
    canAddRow: rowInsertion.canAddRow,
    canCloneSelection: rowInsertion.canCloneSelection,
    deleteTargetCount: deleteTargetCount,
    hasPendingChanges: hasPendingRowChanges(result.view.edit.state),
    isBusy: result.view.rowAction !== null,
  })
  return {
    availability: availability,
    deleteButton: deleteButtonCopyFor(deleteTargetCount),
    handlers: { ...rowEdits, onDelete: deletion.requestDelete },
    deletion: deletion,
  }
}
