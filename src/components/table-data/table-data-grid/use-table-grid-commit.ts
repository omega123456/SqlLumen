import { useCallback } from 'react'
import { useTableDataStore, isSameRowKey } from '../../../stores/table-data-store'
import { useToastStore } from '../../../stores/toast-store'
import type { CellClickGuardResult } from '../../../types/shared-data-view'
import type { TableDataColumnMeta } from '../../../types/schema'
import { reportInvalidTemporalValue } from '../row-save-feedback'
import {
  currentValuesFromRow,
  resolveRestoreRowIndex,
  type CellSwitchGuardOutcome,
  type CellSwitchTarget,
  type RowKey,
  type TableDataRow,
  type TableEditState,
} from './table-data-grid-model'

interface TableGridCommitInputs {
  tabId: string
  columns: TableDataColumnMeta[]
}

function useEnsureRowEditingStarted({ tabId, columns }: TableGridCommitInputs) {
  const startEditing = useTableDataStore((state) => state.startEditing)
  return useCallback(
    (targetRowKey: RowKey, row: TableDataRow) => {
      const currentEditRowKey = useTableDataStore.getState().tabs[tabId]?.editState?.rowKey ?? null
      if (isSameRowKey(targetRowKey, currentEditRowKey)) return
      startEditing(tabId, targetRowKey, currentValuesFromRow(columns, row))
    },
    [columns, startEditing, tabId]
  )
}

function useCommitEditingRowBeforeSwitch({ tabId, columns }: TableGridCommitInputs) {
  const commitEditingRowIfNeeded = useTableDataStore((state) => state.commitEditingRowIfNeeded)
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)
  return useCallback(
    async (currentEditState: NonNullable<TableEditState>, targetRowKey: RowKey) => {
      if (reportInvalidTemporalValue(currentEditState, columns)) {
        setSelectedRow(tabId, currentEditState.rowKey)
        return false
      }
      const hadPendingChanges = currentEditState.modifiedColumns.size > 0
      await commitEditingRowIfNeeded(tabId, targetRowKey)
      const updatedState = useTableDataStore.getState().tabs[tabId]
      const saveError = updatedState?.saveError
      if (saveError) {
        showError('Save failed', saveError)
        if (updatedState.editState) setSelectedRow(tabId, updatedState.editState.rowKey)
        return false
      }
      if (hadPendingChanges) showSuccess('Row saved', 'Changes saved successfully.')
      return true
    },
    [tabId, columns, commitEditingRowIfNeeded, setSelectedRow, showError, showSuccess]
  )
}

function useValidateAndCommitCurrentEdit(inputs: TableGridCommitInputs) {
  const { tabId } = inputs
  const commitEditingRowBeforeSwitch = useCommitEditingRowBeforeSwitch(inputs)
  return useCallback(
    async (switchTarget: CellSwitchTarget): Promise<CellSwitchGuardOutcome> => {
      const { targetRowKey, fallbackRowIndex } = switchTarget
      const currentState = useTableDataStore.getState().tabs[tabId]
      const currentEditState = currentState?.editState ?? null
      const isSwitchingRows =
        currentEditState !== null && !isSameRowKey(targetRowKey, currentEditState.rowKey)
      if (!isSwitchingRows) return { passed: true }
      const restoreFocusResult: CellClickGuardResult = {
        proceed: false,
        targetRowIdx: resolveRestoreRowIndex(currentState, fallbackRowIndex),
        targetColIdx: switchTarget.targetColumnIndex,
        enableEditor: switchTarget.enableEditorOnRestore,
        restoreFocus: true,
      }
      const committed = await commitEditingRowBeforeSwitch(currentEditState, targetRowKey)
      if (!committed) return { passed: false, result: restoreFocusResult }
      return { passed: true }
    },
    [tabId, commitEditingRowBeforeSwitch]
  )
}

export function useTableGridCommit(inputs: TableGridCommitInputs) {
  return {
    ensureRowEditingStarted: useEnsureRowEditingStarted(inputs),
    validateAndCommitCurrentEdit: useValidateAndCommitCurrentEdit(inputs),
  }
}

export type TableGridCommit = ReturnType<typeof useTableGridCommit>
