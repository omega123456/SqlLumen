import { useCallback, useMemo, useState } from 'react'
import {
  useQueryStore,
  getActiveResult,
  hasUnsavedModifications,
  type SingleResultState,
} from '../../../stores/query-store'
import type { FkLookupArgs } from '../../shared/fk-lookup-context'
import { columnIndexFromKey } from '../../../lib/col-key-utils'
import { buildForeignKeyLookup } from '../../../lib/foreign-key-utils'
import { hasModifiedColumns } from '../../../lib/row-edit-state'
import {
  cachedRowFromRowData,
  resolveLookupRow,
  rowIndexFromRowData,
  type ForeignKeyLookupContext,
} from './result-panel-model'

interface ResultForeignKeyLookupInputs {
  tabId: string
  activeResultIndex: number
  result: SingleResultState
  onRowSelected: (rowIndex: number) => void
}

export interface ResultForeignKeyLookup {
  context: ForeignKeyLookupContext | null
  openLookup: (args: FkLookupArgs) => Promise<void>
  applyLookup: (selectedValue: unknown) => void
  closeLookup: () => void
}

function useResolveResultForeignKey(result: SingleResultState) {
  const { editColumnBindings, editForeignKeys } = result
  const resultForeignKeyLookup = useMemo(
    () => buildForeignKeyLookup(editForeignKeys),
    [editForeignKeys]
  )
  return useCallback(
    (columnKey: string) => {
      const resultColumnIndex = columnIndexFromKey(columnKey)
      if (resultColumnIndex < 0) return null
      const sourceColumnName = editColumnBindings.get(resultColumnIndex)
      if (!sourceColumnName) return null
      const foreignKey = resultForeignKeyLookup.get(sourceColumnName.toLowerCase())
      if (!foreignKey) return null
      return { sourceColumnName, foreignKey }
    },
    [editColumnBindings, resultForeignKeyLookup]
  )
}

function useLeaveCurrentEditingRow(tabId: string) {
  const saveCurrentRow = useQueryStore((state) => state.saveCurrentRow)
  const discardCurrentRow = useQueryStore((state) => state.discardCurrentRow)
  return useCallback(
    async (currentResult: SingleResultState): Promise<boolean> => {
      if (hasUnsavedModifications(currentResult)) return saveCurrentRow(tabId)
      discardCurrentRow(tabId)
      return true
    },
    [discardCurrentRow, saveCurrentRow, tabId]
  )
}

interface OpenLookupInputs extends ResultForeignKeyLookupInputs {
  setContext: (context: ForeignKeyLookupContext | null) => void
}

function useOpenForeignKeyLookup(inputs: OpenLookupInputs) {
  const { tabId, activeResultIndex, result, onRowSelected, setContext } = inputs
  const startEditingRow = useQueryStore((state) => state.startEditingRow)
  const resolveResultForeignKey = useResolveResultForeignKey(result)
  const leaveCurrentEditingRow = useLeaveCurrentEditingRow(tabId)
  const { editMode } = result

  const moveEditingToRow = useCallback(
    async (args: FkLookupArgs, rowIndex: number): Promise<boolean> => {
      const currentActiveResult = getActiveResult(useQueryStore.getState().tabs[tabId])
      const currentEditingRow = currentActiveResult.editingRowIndex
      if (currentEditingRow === rowIndex) return true
      const isEditingOtherRow = currentEditingRow !== null
      if (isEditingOtherRow) {
        const canSwitchRows = await leaveCurrentEditingRow(currentActiveResult)
        if (!canSwitchRows) return false
      }
      const lookupRow = await resolveLookupRow(args.rowData, currentActiveResult.columns.length, {
        tabId: tabId,
        resultIndex: activeResultIndex,
        rowIndex: rowIndex,
      })
      startEditingRow(tabId, rowIndex, lookupRow)
      return true
    },
    [tabId, activeResultIndex, leaveCurrentEditingRow, startEditingRow]
  )

  return useCallback(
    async (args: FkLookupArgs) => {
      const resolved = resolveResultForeignKey(args.columnKey)
      if (!resolved) return
      if (!editMode) return
      const rowIndex = rowIndexFromRowData(args.rowData)
      const hasMoved = await moveEditingToRow(args, rowIndex)
      if (!hasMoved) return
      onRowSelected(rowIndex)
      setContext({
        columnKey: args.columnKey,
        sourceColumn: resolved.sourceColumnName,
        currentValue: args.currentValue,
        foreignKey: resolved.foreignKey,
        rowData: args.rowData,
      })
    },
    [resolveResultForeignKey, editMode, moveEditingToRow, onRowSelected, setContext]
  )
}

interface ApplyLookupInputs {
  tabId: string
  result: SingleResultState
  context: ForeignKeyLookupContext | null
  onRowSelected: (rowIndex: number) => void
  closeLookup: () => void
}

function isUnchangedLookupValue(
  selectedValue: unknown,
  context: ForeignKeyLookupContext,
  editedSameRow: { isSameRow: boolean; result: SingleResultState }
): boolean {
  if (selectedValue !== context.currentValue) return false
  if (!editedSameRow.isSameRow) return true
  return !hasModifiedColumns(editedSameRow.result.editState)
}

function useApplyForeignKeyLookup(inputs: ApplyLookupInputs) {
  const { tabId, context, onRowSelected, closeLookup } = inputs
  const { editingRowIndex } = inputs.result
  const columnCount = inputs.result.columns.length
  const startEditingRow = useQueryStore((state) => state.startEditingRow)
  const syncCellValue = useQueryStore((state) => state.syncCellValue)

  return useCallback(
    (selectedValue: unknown) => {
      if (!context) return
      const rowIndex = rowIndexFromRowData(context.rowData)
      const resultColumnIndex = columnIndexFromKey(context.columnKey)
      if (resultColumnIndex < 0) {
        closeLookup()
        return
      }
      const currentActiveResult = getActiveResult(useQueryStore.getState().tabs[tabId])
      const isSameRow = currentActiveResult.editState !== null && editingRowIndex === rowIndex
      const sameRowEdit = { isSameRow: isSameRow, result: currentActiveResult }
      if (isUnchangedLookupValue(selectedValue, context, sameRowEdit)) {
        onRowSelected(rowIndex)
        closeLookup()
        return
      }
      if (!isSameRow) {
        const cachedRow = cachedRowFromRowData(context.rowData, columnCount) ?? undefined
        startEditingRow(tabId, rowIndex, cachedRow)
      }
      syncCellValue(tabId, resultColumnIndex, selectedValue)
      onRowSelected(rowIndex)
      closeLookup()
    },
    [
      columnCount,
      context,
      tabId,
      editingRowIndex,
      onRowSelected,
      startEditingRow,
      syncCellValue,
      closeLookup,
    ]
  )
}

export function useResultForeignKeyLookup(
  inputs: ResultForeignKeyLookupInputs
): ResultForeignKeyLookup {
  const [context, setContext] = useState<ForeignKeyLookupContext | null>(null)
  const closeLookup = useCallback(() => setContext(null), [])
  const openLookup = useOpenForeignKeyLookup({ ...inputs, setContext: setContext })
  const applyLookup = useApplyForeignKeyLookup({
    tabId: inputs.tabId,
    result: inputs.result,
    context: context,
    onRowSelected: inputs.onRowSelected,
    closeLookup: closeLookup,
  })
  return { context, openLookup, applyLookup, closeLookup }
}
