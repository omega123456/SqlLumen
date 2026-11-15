import { useCallback, useMemo } from 'react'
import type {
  CellClickGuardArgs,
  CellClickGuardResult,
  CellClipboardEditArgs,
  GridColumnDescriptor,
} from '../../../types/shared-data-view'
import type { EditorCallbacksContextType } from '../editor-callbacks-context'
import type { GridCellPosition, GridRowsChangeData } from '../glide/glide-grid-types'
import {
  cellTargetOf,
  isModifiedCellOf,
  leaveCurrentEditingRow,
  leaveEditingRowFor,
  releaseRowIfUnmodified,
  startEditingIfNeeded,
  type CellTarget,
  type GridRowData,
  type RowEditSession,
} from './row-edit-session'

export type GridRowLookup = (rowIndex: number) => GridRowData | undefined

export interface GridEditHandlerInputs<RowIdentity> {
  session: RowEditSession<RowIdentity>
  rowAt: GridRowLookup
  columns: GridColumnDescriptor[]
}

export interface GridEditHandlers {
  onCellClickGuard: (args: CellClickGuardArgs) => Promise<CellClickGuardResult>
  onCellClipboardEdit: (args: CellClipboardEditArgs) => Promise<boolean>
  onCellValueChange: (rowIndex: number, columnKey: string, value: unknown) => void
  onRowChanging: (fromRowIndex: number, toRowIndex: number) => Promise<boolean>
  onSelectedCellChange: (position: GridCellPosition) => void
  isModifiedCell: (rowData: GridRowData, columnKey: string) => boolean
  editorCallbacksContext: EditorCallbacksContextType
}

const FIRST_COLUMN_INDEX = 0

function blockedAt(rowIndex: number, columnIndex: number): CellClickGuardResult {
  return { proceed: false, targetRowIdx: rowIndex, targetColIdx: columnIndex, enableEditor: false }
}

function restoreEditingRowResult<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  args: CellClickGuardArgs,
  columnIndex: number
): CellClickGuardResult {
  return {
    proceed: false,
    targetRowIdx: session.editingRowIndex(args.rowIdx),
    targetColIdx: columnIndex,
    enableEditor: args.source !== 'keyboard',
    restoreFocus: true,
  }
}

function readOnlyCellResult<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  target: CellTarget<RowIdentity>,
  columnIndex: number
): CellClickGuardResult {
  const currentRowIndex = session.rowIndexOf(target.identity)
  return {
    proceed: true,
    targetRowIdx: currentRowIndex >= 0 ? currentRowIndex : target.rowIndex,
    targetColIdx: columnIndex,
    enableEditor: false,
  }
}

function editableCellResult<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  target: CellTarget<RowIdentity>,
  args: CellClickGuardArgs
): CellClickGuardResult {
  const columnIndex = session.columnIndexOf(args.columnKey)
  const currentRowIndex = session.rowIndexOf(target.identity)
  if (currentRowIndex < 0) return blockedAt(args.rowIdx, columnIndex)
  return {
    proceed: true,
    targetRowIdx: currentRowIndex,
    targetColIdx: columnIndex,
    enableEditor: args.source === 'keyboard-typing',
  }
}

async function runCellClickGuard<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  args: CellClickGuardArgs
): Promise<CellClickGuardResult> {
  const columnIndex = session.columnIndexOf(args.columnKey)
  if (columnIndex < 0) return blockedAt(args.rowIdx, FIRST_COLUMN_INDEX)
  const target = cellTargetOf(session, args)
  const canLeaveEditingRow = await leaveEditingRowFor(session, target.identity)
  if (!canLeaveEditingRow) return restoreEditingRowResult(session, args, columnIndex)
  session.selectCell(target)
  if (!session.isColumnEditable(args.columnKey)) {
    return readOnlyCellResult(session, target, columnIndex)
  }
  startEditingIfNeeded(session, target.identity, target.rowData)
  return editableCellResult(session, target, args)
}

function clipboardCellValue(args: CellClipboardEditArgs): unknown {
  if (args.action === 'cut') return null
  return args.text ?? args.rowData[args.columnKey]
}

async function runClipboardEdit<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  args: CellClipboardEditArgs
): Promise<boolean> {
  if (!session.isColumnEditable(args.columnKey)) return false
  const target = cellTargetOf(session, args)
  const canLeaveEditingRow = await leaveEditingRowFor(session, target.identity)
  if (!canLeaveEditingRow) return false
  session.selectCell(target)
  startEditingIfNeeded(session, target.identity, target.rowData)
  session.commitCellValue(target, clipboardCellValue(args))
  return true
}

interface GridCellValue {
  rowIndex: number
  columnKey: string
  value: unknown
}

function commitGridCellValue<RowIdentity>(
  inputs: GridEditHandlerInputs<RowIdentity>,
  edit: GridCellValue
): void {
  const rowData = inputs.rowAt(edit.rowIndex)
  if (!rowData) return
  const target = cellTargetOf(inputs.session, {
    rowIdx: edit.rowIndex,
    columnKey: edit.columnKey,
    rowData: rowData,
  })
  inputs.session.commitCellValue(target, edit.value)
}

function releaseChangedRows<RowIdentity>(
  session: RowEditSession<RowIdentity>,
  rows: GridRowData[],
  data: GridRowsChangeData<GridRowData>
): void {
  for (const rowIndex of data.indexes) {
    const row = rows[rowIndex]
    if (row) releaseRowIfUnmodified(session, session.identityOf(row))
  }
}

async function leaveEditingRowAt<RowIdentity>(
  inputs: GridEditHandlerInputs<RowIdentity>,
  targetRowIndex: number
): Promise<boolean> {
  const targetRow = inputs.rowAt(targetRowIndex)
  if (!targetRow) return leaveCurrentEditingRow(inputs.session)
  return leaveEditingRowFor(inputs.session, inputs.session.identityOf(targetRow))
}

function selectCellAt<RowIdentity>(
  inputs: GridEditHandlerInputs<RowIdentity>,
  position: GridCellPosition
): void {
  const rowData = inputs.rowAt(position.rowIdx)
  const column = inputs.columns[position.idx]
  if (!rowData) return
  if (!column) return
  const target = cellTargetOf(inputs.session, {
    rowIdx: position.rowIdx,
    columnKey: column.key,
    rowData: rowData,
  })
  inputs.session.selectCell(target)
}

const SKIP_SYNC_WHILE_TYPING = () => {}

function editorCallbacksFor<RowIdentity>(
  session: RowEditSession<RowIdentity>
): EditorCallbacksContextType {
  return {
    tabId: session.tabId,
    updateCellValue: (_tabId, columnKey, value) => session.updateCell(columnKey, value),
    syncCellValue: SKIP_SYNC_WHILE_TYPING,
  }
}

export function useGridEditHandlers<RowIdentity>(
  inputs: GridEditHandlerInputs<RowIdentity>
): GridEditHandlers {
  const { session, rowAt, columns } = inputs
  return useMemo(() => {
    const bound = { session, rowAt, columns }
    return {
      onCellClickGuard: (args) => runCellClickGuard(session, args),
      onCellClipboardEdit: (args) => runClipboardEdit(session, args),
      onCellValueChange: (rowIndex, columnKey, value) =>
        commitGridCellValue(bound, { rowIndex: rowIndex, columnKey: columnKey, value: value }),
      onRowChanging: (_fromRowIndex, toRowIndex) => leaveEditingRowAt(bound, toRowIndex),
      onSelectedCellChange: (position) => selectCellAt(bound, position),
      isModifiedCell: (rowData, columnKey) => isModifiedCellOf(session, rowData, columnKey),
      editorCallbacksContext: editorCallbacksFor(session),
    }
  }, [session, rowAt, columns])
}

export function useReleaseUnmodifiedChangedRows<RowIdentity>(
  session: RowEditSession<RowIdentity>
): (rows: GridRowData[], data: GridRowsChangeData<GridRowData>) => void {
  return useCallback(
    (rows: GridRowData[], data: GridRowsChangeData<GridRowData>) =>
      releaseChangedRows(session, rows, data),
    [session]
  )
}
