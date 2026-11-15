import { useCallback } from 'react'
import { useTableDataStore, isEditingRowKey } from '../../../stores/table-data-store'
import { useToastStore } from '../../../stores/toast-store'
import { useRowDeletionConfirm } from '../../shared/toolbar/row-actions/use-row-deletion-confirm'
import { saveTableEditingRow } from '../table-data-edit-session'
import {
  isTabSettledWithoutError,
  planCheckedRowDeletion,
  pluralRows,
  type ToolbarTabView,
} from './toolbar-model'

interface ToolbarActionInputs {
  tabId: string
  view: ToolbarTabView
  withNavigationGuard: (action: () => void) => void
}

function useDeleteCheckedRows({ tabId, view }: ToolbarActionInputs) {
  const { checkedRowKeys, editState } = view
  const deleteRows = useTableDataStore((state) => state.deleteRows)
  const setCheckedRowKeys = useTableDataStore((state) => state.setCheckedRowKeys)
  const discardCurrentRow = useTableDataStore((state) => state.discardCurrentRow)
  const showSuccess = useToastStore((state) => state.showSuccess)
  return useCallback(async () => {
    const plan = planCheckedRowDeletion(checkedRowKeys, editState)
    if (plan.discardsEditingRow) discardCurrentRow(tabId)
    const deletedCount = (await deleteRows(tabId, plan.rowKeysToDelete)) + plan.discardedDraftCount
    setCheckedRowKeys(tabId, [])
    const shouldConfirmDeletion = deletedCount > 0 && isTabSettledWithoutError(tabId)
    if (shouldConfirmDeletion) {
      showSuccess('Rows deleted', `${pluralRows(deletedCount)} deleted successfully.`)
    }
  }, [
    checkedRowKeys,
    editState,
    discardCurrentRow,
    deleteRows,
    setCheckedRowKeys,
    tabId,
    showSuccess,
  ])
}

function useDeleteSelectedRow({ tabId, view }: ToolbarActionInputs) {
  const { selectedRowKey, editState } = view
  const deleteRow = useTableDataStore((state) => state.deleteRow)
  const discardCurrentRow = useTableDataStore((state) => state.discardCurrentRow)
  const showSuccess = useToastStore((state) => state.showSuccess)
  return useCallback(async () => {
    if (!selectedRowKey) return
    if (isEditingRowKey(editState, selectedRowKey)) discardCurrentRow(tabId)
    await deleteRow(tabId, selectedRowKey)
    if (isTabSettledWithoutError(tabId)) showSuccess('Row deleted', 'Row deleted successfully.')
  }, [selectedRowKey, editState, discardCurrentRow, deleteRow, tabId, showSuccess])
}

export function useToolbarDeletion(inputs: ToolbarActionInputs, deleteTargetCount: number) {
  const deleteCheckedRows = useDeleteCheckedRows(inputs)
  const deleteSelectedRow = useDeleteSelectedRow(inputs)
  const hasCheckedRows = inputs.view.checkedRowKeys.length > 0
  const deleteRows = useCallback(async () => {
    if (hasCheckedRows) {
      await deleteCheckedRows()
      return
    }
    await deleteSelectedRow()
  }, [hasCheckedRows, deleteCheckedRows, deleteSelectedRow])
  return useRowDeletionConfirm({
    deleteTargetCount: deleteTargetCount,
    tableName: inputs.view.table,
    deleteRows: deleteRows,
  })
}

export function useToolbarRowEdits({ tabId, view, withNavigationGuard }: ToolbarActionInputs) {
  const { columns } = view
  const insertNewRow = useTableDataStore((state) => state.insertNewRow)
  const cloneSelectedRow = useTableDataStore((state) => state.cloneSelectedRow)
  const discardCurrentRow = useTableDataStore((state) => state.discardCurrentRow)
  return {
    onAdd: useCallback(
      () => withNavigationGuard(() => insertNewRow(tabId)),
      [withNavigationGuard, insertNewRow, tabId]
    ),
    onClone: useCallback(
      () => withNavigationGuard(() => cloneSelectedRow(tabId)),
      [withNavigationGuard, cloneSelectedRow, tabId]
    ),
    onSave: useCallback(() => void saveTableEditingRow(tabId, columns), [tabId, columns]),
    onDiscard: useCallback(() => discardCurrentRow(tabId), [discardCurrentRow, tabId]),
  }
}
