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
import { saveActiveResultRow } from '../result-edit-session'
import { canMutateResultRows, editTableNameOf, type ActiveResult } from './result-toolbar-model'

export interface ResultRowActionInputs {
  tabId: string
  connectionId: string
  result: ActiveResult
  checkedCount: number
  rowInsertion: ResultRowInsertion
}

function useResultRowEdits(tabId: string): Omit<RowActionHandlers, 'onDelete'> {
  const insertDraftRow = useQueryStore((state) => state.insertDraftRow)
  const cloneSelectedRow = useQueryStore((state) => state.cloneSelectedRow)
  const discardCurrentRow = useQueryStore((state) => state.discardCurrentRow)
  return {
    onAdd: useCallback(() => insertDraftRow(tabId), [insertDraftRow, tabId]),
    onClone: useCallback(() => cloneSelectedRow(tabId), [cloneSelectedRow, tabId]),
    onSave: useCallback(() => void saveActiveResultRow(tabId), [tabId]),
    onDiscard: useCallback(() => discardCurrentRow(tabId), [discardCurrentRow, tabId]),
  }
}

function useResultRowDeletion(inputs: ResultRowActionInputs, deleteTargetCount: number) {
  const { tabId } = inputs
  const deleteResultRows = useQueryStore((state) => state.deleteResultRows)
  const deleteRows = useCallback(async () => {
    await deleteResultRows(tabId)
  }, [deleteResultRows, tabId])
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
  const rowEdits = useResultRowEdits(inputs.tabId)
  const deletion = useResultRowDeletion(inputs, deleteTargetCount)
  const availability = rowActionAvailability({
    canMutate: canMutateResultRows(result, isConnectionReadOnly),
    canAddRow: rowInsertion.canAddRow,
    canCloneSelection: rowInsertion.canCloneSelection,
    deleteTargetCount: deleteTargetCount,
    hasPendingChanges: hasPendingRowChanges(result.editState),
    isBusy: result.rowActionProgress !== null,
  })
  return {
    availability: availability,
    deleteButton: deleteButtonCopyFor(deleteTargetCount),
    handlers: { ...rowEdits, onDelete: deletion.requestDelete },
    deletion: deletion,
  }
}
