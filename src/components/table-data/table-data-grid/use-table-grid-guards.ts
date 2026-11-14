import { useCallback, type RefObject } from 'react'
import { useTableDataStore } from '../../../stores/table-data-store'
import type {
  CellClickGuardArgs,
  CellClickGuardResult,
  GridColumnDescriptor,
} from '../../../types/shared-data-view'
import {
  findRowIndexByKey,
  getRowKey,
  isPointerOrUnknownSource,
  type RowKey,
  type TableDataRow,
} from './table-data-grid-model'
import type { TableGridCommit } from './use-table-grid-commit'

export interface TableGridGuardInputs {
  tabId: string
  primaryKeyColumns: string[]
  descriptorColumns: GridColumnDescriptor[]
  rowDataRef: RefObject<TableDataRow[]>
  commit: TableGridCommit
}

interface TargetColumn {
  editable: boolean
  targetColIdx: number
}

export function resolveTargetColumn(
  descriptorColumns: GridColumnDescriptor[],
  columnKey: string
): TargetColumn | null {
  const targetColumnIndex = descriptorColumns.findIndex((column) => column.key === columnKey)
  if (targetColumnIndex < 0) return null
  const descriptor = descriptorColumns[targetColumnIndex]
  return { editable: descriptor.editable === true, targetColIdx: targetColumnIndex }
}

interface GuardedClick {
  args: CellClickGuardArgs
  targetRowKey: RowKey
  targetColumnIndex: number
}

function useEditableClickResult(inputs: TableGridGuardInputs) {
  const { primaryKeyColumns, rowDataRef, commit } = inputs
  const { ensureRowEditingStarted } = commit
  return useCallback(
    ({ args, targetRowKey, targetColumnIndex }: GuardedClick): CellClickGuardResult => {
      ensureRowEditingStarted(targetRowKey, args.rowData)
      const finalRowIndex = findRowIndexByKey(rowDataRef.current, targetRowKey, primaryKeyColumns)
      if (finalRowIndex >= 0) {
        return {
          proceed: true,
          targetRowIdx: finalRowIndex,
          targetColIdx: targetColumnIndex,
          enableEditor: args.source === 'keyboard-typing',
        }
      }
      return {
        proceed: false,
        targetRowIdx: args.rowIdx,
        targetColIdx: targetColumnIndex,
        enableEditor: false,
      }
    },
    [ensureRowEditingStarted, rowDataRef, primaryKeyColumns]
  )
}

function readOnlyClickResult(guarded: GuardedClick, currentRowIndex: number): CellClickGuardResult {
  return {
    proceed: true,
    targetRowIdx: currentRowIndex >= 0 ? currentRowIndex : guarded.args.rowIdx,
    targetColIdx: guarded.targetColumnIndex,
    enableEditor: false,
  }
}

function unknownColumnResult(args: CellClickGuardArgs): CellClickGuardResult {
  return { proceed: false, targetRowIdx: args.rowIdx, targetColIdx: 0, enableEditor: false }
}

export function useTableCellClickGuard(inputs: TableGridGuardInputs) {
  const { tabId, primaryKeyColumns, descriptorColumns, rowDataRef, commit } = inputs
  const { validateAndCommitCurrentEdit } = commit
  const setSelectedRow = useTableDataStore((state) => state.setSelectedRow)
  const setSelectedCell = useTableDataStore((state) => state.setSelectedCell)
  const clearColumnHighlight = useTableDataStore((state) => state.clearColumnHighlight)
  const editableClickResult = useEditableClickResult(inputs)

  return useCallback(
    async (args: CellClickGuardArgs): Promise<CellClickGuardResult> => {
      if (isPointerOrUnknownSource(args.source)) clearColumnHighlight(tabId)
      const targetRowKey = getRowKey(args.rowData, primaryKeyColumns)
      const target = resolveTargetColumn(descriptorColumns, args.columnKey)
      if (!target) return unknownColumnResult(args)
      const guardResult = await validateAndCommitCurrentEdit({
        targetRowKey: targetRowKey,
        fallbackRowIndex: args.rowIdx,
        targetColumnIndex: target.targetColIdx,
        enableEditorOnRestore: args.source !== 'keyboard',
      })
      if (!guardResult.passed) return guardResult.result
      setSelectedRow(tabId, targetRowKey)
      setSelectedCell(tabId, { columnKey: args.columnKey, value: args.rowData[args.columnKey] })
      const guarded = {
        args: args,
        targetRowKey: targetRowKey,
        targetColumnIndex: target.targetColIdx,
      }
      if (target.editable) return editableClickResult(guarded)
      const currentRowIndex = findRowIndexByKey(rowDataRef.current, targetRowKey, primaryKeyColumns)
      return readOnlyClickResult(guarded, currentRowIndex)
    },
    [
      primaryKeyColumns,
      tabId,
      descriptorColumns,
      rowDataRef,
      validateAndCommitCurrentEdit,
      editableClickResult,
      setSelectedRow,
      setSelectedCell,
      clearColumnHighlight,
    ]
  )
}
