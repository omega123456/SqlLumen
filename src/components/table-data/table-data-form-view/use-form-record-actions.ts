import { useCallback } from 'react'
import { useTableDataStore, isEditingRowKey } from '../../../stores/table-data-store'
import { saveCurrentRowWithFeedback } from '../row-save-feedback'
import {
  focusFormInput,
  isAtFirstRecord,
  navigateToRelativeRow,
  rowToValues,
  type FormTabView,
} from './form-view-model'
import type { FormCurrentRecord } from './use-form-current-record'

export interface FormRecordInputs {
  tabId: string
  view: FormTabView
  record: FormCurrentRecord
  isEditable: boolean
  hasTabState: boolean
}

export function useFormNavigation({ tabId, view, record, hasTabState }: FormRecordInputs) {
  const { isLoading, rows, currentPage, pageSize, primaryKeyColumns } = view
  const { localIndex } = record
  const requestNavigationAction = useTableDataStore((state) => state.requestNavigationAction)
  const fetchPage = useTableDataStore((state) => state.fetchPage)
  const navigateRelative = useCallback(
    (direction: -1 | 1) => {
      if (!hasTabState) return
      if (isLoading) return
      const isBackwardFromFirstRecord = direction < 0 && isAtFirstRecord(currentPage, localIndex)
      if (isBackwardFromFirstRecord) return
      const position = {
        localIndex: localIndex,
        rowCount: rows.length,
        currentPage: currentPage,
        pageSize: pageSize,
      }
      requestNavigationAction(tabId, () =>
        navigateToRelativeRow({
          tabId: tabId,
          direction: direction,
          position: position,
          primaryKeyColumns: primaryKeyColumns,
          fetchPage: fetchPage,
        })
      )
    },
    [
      hasTabState,
      isLoading,
      localIndex,
      rows.length,
      currentPage,
      pageSize,
      tabId,
      fetchPage,
      primaryKeyColumns,
      requestNavigationAction,
    ]
  )
  return {
    onNavigatePrevious: useCallback(() => navigateRelative(-1), [navigateRelative]),
    onNavigateNext: useCallback(() => navigateRelative(1), [navigateRelative]),
  }
}

export function useEnsureEditingCurrentRow({ tabId, view, record, isEditable }: FormRecordInputs) {
  const { columns, editState } = view
  const { currentRow, currentRowKey } = record
  const startEditing = useTableDataStore((state) => state.startEditing)
  return useCallback(() => {
    if (!isEditable) return
    if (!currentRow) return
    if (!currentRowKey) return
    if (isEditingRowKey(editState, currentRowKey)) return
    startEditing(tabId, currentRowKey, rowToValues(currentRow, columns))
  }, [isEditable, currentRow, currentRowKey, editState, columns, startEditing, tabId])
}

export function useFormEditing(inputs: FormRecordInputs) {
  const { tabId, view, record } = inputs
  const { currentRow, currentRowKey } = record
  const { editState, columns } = view
  const updateCellValue = useTableDataStore((state) => state.updateCellValue)
  const discardCurrentRow = useTableDataStore((state) => state.discardCurrentRow)
  const ensureEditingCurrentRow = useEnsureEditingCurrentRow(inputs)
  return {
    ensureEditingCurrentRow: ensureEditingCurrentRow,
    onEnsureEditing: useCallback(() => ensureEditingCurrentRow(), [ensureEditingCurrentRow]),
    onUpdateCell: useCallback(
      (columnKey: string, value: unknown) => {
        if (!currentRow) return
        if (!currentRowKey) return
        ensureEditingCurrentRow()
        updateCellValue(tabId, columnKey, value)
      },
      [currentRow, currentRowKey, ensureEditingCurrentRow, updateCellValue, tabId]
    ),
    onSave: useCallback(async () => {
      const validationError = await saveCurrentRowWithFeedback({
        tabId: tabId,
        editState: editState,
        columns: columns,
      })
      if (validationError) focusFormInput(validationError.columnName)
    }, [tabId, editState, columns]),
    onDiscard: useCallback(() => discardCurrentRow(tabId), [discardCurrentRow, tabId]),
  }
}
