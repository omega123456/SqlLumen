import type {
  TableDataColumnMeta,
  TableDataTabState,
  RowEditState,
  BlobEnvelope,
} from '../../types/schema'
import { normalizeTinyIntRows } from '../../lib/table-data-commands'
import type { CellValueSync } from '../../components/shared/editor-callbacks-context'
import { findRowIndexByKey, isDraftRowKey } from './row-keys'
import type { RowKey } from './row-keys'
import { reconcileSavedBlobValue } from './row-payloads'

export function applyInsertedRow(
  rows: unknown[][],
  columns: TableDataColumnMeta[],
  insertedData: [string, unknown][]
): unknown[][] {
  const returnedMap = Object.fromEntries(insertedData)
  const newRow = normalizeTinyIntRows(columns, [
    columns.map((column) => reconcileSavedBlobValue(returnedMap[column.name] ?? null)),
  ])[0]
  const newRows = [...rows]
  newRows[newRows.length - 1] = newRow
  return newRows
}

export function applyUpdatedRow(
  rows: unknown[][],
  columns: TableDataColumnMeta[],
  editState: RowEditState
): unknown[][] {
  const rowIndex = findRowIndexByKey(rows, columns, editState.rowKey)
  if (rowIndex === -1) return rows

  const newRows = [...rows]
  const updatedRow = [...newRows[rowIndex]]
  for (const [columnName, value] of Object.entries(editState.currentValues)) {
    const columnIndex = columns.findIndex((column) => column.name === columnName)
    if (columnIndex !== -1) {
      updatedRow[columnIndex] = reconcileSavedBlobValue(value)
    }
  }
  newRows[rowIndex] = updatedRow
  return newRows
}

export interface StagedBlobEnvelope {
  rowData: Record<string, unknown>
  column: string
  envelope: BlobEnvelope
}

export interface TableCellValueSync extends CellValueSync {
  rowKeyOverride?: Record<string, unknown>
}

export interface DraftRowSeed {
  tab: TableDataTabState
  rowValues: unknown[]
  modifiedColumns: Set<string>
}

export function withColumnModified(
  modifiedColumns: Set<string>,
  column: string,
  isModified: boolean
): Set<string> {
  const nextModifiedColumns = new Set(modifiedColumns)
  if (!isModified) {
    nextModifiedColumns.delete(column)
    return nextModifiedColumns
  }
  nextModifiedColumns.add(column)
  return nextModifiedColumns
}

export function rowDataBaseline(
  columns: TableDataColumnMeta[],
  rowData: Record<string, unknown>
): Record<string, unknown> {
  const baseline: Record<string, unknown> = {}
  for (const column of columns) {
    baseline[column.name] = rowData[column.name]
  }
  return baseline
}

function isRowIndexWithin(rowIndexHint: unknown, rowCount: number): rowIndexHint is number {
  return typeof rowIndexHint === 'number' && rowIndexHint >= 0 && rowIndexHint < rowCount
}

export function resolveStagedRowIndex(
  tab: Pick<TableDataTabState, 'rows' | 'columns'>,
  rowKey: RowKey,
  rowData: Record<string, unknown>
): number {
  const rowIndex = findRowIndexByKey(tab.rows, tab.columns, rowKey)
  if (rowIndex >= 0) return rowIndex
  if (!isDraftRowKey(rowKey)) return rowIndex
  const rowIndexHint = rowData.__rowIndex
  return isRowIndexWithin(rowIndexHint, tab.rows.length) ? rowIndexHint : tab.rows.length - 1
}

interface CellWrite {
  rowIndex: number
  columnIndex: number
  value: unknown
}

export function withCellWritten(rows: unknown[][], write: CellWrite): unknown[][] {
  const nextRows = [...rows]
  const nextRow = [...nextRows[write.rowIndex]]
  nextRow[write.columnIndex] = write.value
  nextRows[write.rowIndex] = nextRow
  return nextRows
}

export function withOriginalValuesRestored(
  row: unknown[],
  columns: TableDataColumnMeta[],
  originalValues: Record<string, unknown>
): unknown[] {
  const restoredRow = [...row]
  for (const [columnName, value] of Object.entries(originalValues)) {
    const columnIndex = columns.findIndex((column) => column.name === columnName)
    if (columnIndex !== -1) {
      restoredRow[columnIndex] = value
    }
  }
  return restoredRow
}
